#!/usr/bin/env python3
"""serve.py — Servidor local para el cliente web de TV.

Hace dos cosas:
  1. Sirve los estaticos de web-tv/
  2. Proxy con CORS para listas M3U y transmisiones HLS, reescribiendo las
     URLs internas para que vuelvan a pasar por aqui.

El punto 2 no es opcional: hls.js necesita Access-Control-Allow-Origin en el
manifiesto y en cada segmento, y casi ningun servidor de television lo envia.
Sin esto el navegador bloquea la peticion antes de mirar el contenido, y el
reproductor no puede hacer nada.

Sin dependencias externas. Solo stdlib.

    py -3 serve.py --port 8777
    py -3 serve.py --allow-private   # habilita destinos en la LAN
"""

import argparse
import ipaddress
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHUNK = 64 * 1024
TIMEOUT = 25

# Tipos que se sirven tal cual, sin reescribir.
BINARY_TYPES = {
    "video/mp2t": ".ts",
    "video/mp4": ".m4s",
    "video/aac": ".aac",
    "audio/mpeg": ".mp3",
    "audio/aac": ".aac",
    "video/webm": ".webm",
}

# Atributos URI="..." dentro de etiquetas HLS.
URI_ATTR_RE = re.compile(rb'URI="([^"]+)"')


class Settings:
    port = 8777
    root = "web-tv"
    allow_private = False


def is_blocked(host):
    """Evita que el proxy se use para alcanzar la red interna.

    Sin esto, cualquiera que abra el puerto podria preguntar al servidor por
    169.254.169.254 o por los routers de la casa. Se puede desactivar con
    --allow-private cuando el contenido legitimo este en la LAN.
    """
    if Settings.allow_private:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return True
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return True
    return False


def fetch(url):
    """Descarga una URL remota. Devuelve (status, headers, content-type, response).

    No se usa 'with' a proposito: el llamante necesita leer el cuerpo en
    streaming (los segmentos HLS pueden pesar cientos de MB) y cerrarlo en su
    propio finally. Devolver la respuesta desde dentro de un 'with' la cerraba
    antes de tiempo y todo llegaba vacio.
    """
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "*/*",
        },
    )
    resp = urllib.request.urlopen(req, timeout=TIMEOUT)
    ctype = resp.headers.get("Content-Type", "")
    return resp.status, dict(resp.headers), ctype, resp


def rewrite_manifest(body, base_url):
    """Convierte todas las URLs del manifiesto en rutas del proxy.

    Cubre los tres casos de HLS:
      - lineas sueltas (segmentos y playlists variantes)
      - URI="..." en #EXT-X-MEDIA, #EXT-X-KEY, #EXT-X-MAP, #EXT-X-I-FRAME-STREAM-INF
      - playlists M3U/IPTV, que son el mismo formato
    """
    base = base_url.rsplit("/", 1)[0] + "/"
    prefix = "/proxy/stream?u="

    def to_proxy(raw):
        raw = raw.strip()
        if not raw:
            return raw
        absolute = urllib.parse.urljoin(base, raw)
        return prefix + urllib.parse.quote(absolute, safe="")

    out = []
    for line in body.split(b"\n"):
        stripped = line.strip()
        if stripped and not stripped.startswith(b"#"):
            # Linea de URL (segmento o variante).
            out.append(to_proxy(line.decode("utf-8", "replace")).encode())
            continue
        if stripped.startswith(b"#"):
            # Atributos URI="..." dentro de etiquetas HLS.
            def sub(m):
                return b'URI="' + to_proxy(m.group(1).decode("utf-8", "replace")).encode() + b'"'
            out.append(URI_ATTR_RE.sub(sub, line))
            continue
        out.append(line)
    return b"\n".join(out)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # -------- utilidades --------

    def log_message(self, fmt, *args):
        # Sin esto, cada segmento HLS imprime una linea y satura la consola.
        if "/proxy/" not in (args[0] if args else ""):
            sys.stderr.write("  %s\n" % (fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "*")

    def _send(self, status, body=b"", ctype="text/plain; charset=utf-8", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    # -------- rutas --------

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/proxy/stream":
            return self.proxy_stream(parsed)
        if parsed.path == "/proxy/playlist":
            return self.proxy_stream(parsed, force="audio/x-mpegurl")
        return self.serve_static(parsed.path)

    # -------- proxy --------

    def proxy_stream(self, parsed, force=None):
        params = urllib.parse.parse_qs(parsed.query)
        target = (params.get("u") or [""])[0]
        if not target:
            return self._send(400, b"Falta el parametro u")

        host = urllib.parse.urlparse(target).hostname
        if not host or is_blocked(host):
            return self._send(403, b"Destino no permitido")

        try:
            status, headers, ctype, resp = fetch(target)
        except urllib.error.HTTPError as e:
            return self._send(e.code, ("Error remoto %s" % e.code).encode())
        except Exception as e:
            return self._send(502, ("No se pudo contactar: %s" % e).encode())

        is_manifest = "mpegurl" in ctype.lower() or force is not None

        if is_manifest:
            try:
                body = resp.read()
            finally:
                resp.close()
            body = rewrite_manifest(body, target)
            return self._send(status, body, "application/vnd.apple.mpegurl")

        # Segmento binario: se retransmite en bloques sin cargar el fichero entero.
        ext = BINARY_TYPES.get(ctype.split(";")[0].strip(), "")
        try:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "max-age=30")
            self.end_headers()
            while True:
                chunk = resp.read(CHUNK)
                if not chunk:
                    break
                self.wfile.write(chunk)
        finally:
            resp.close()

    # -------- estaticos --------

    def serve_static(self, path):
        import os

        if path in ("/", ""):
            path = "/index.html"

        # Sin path traversal: todo debe quedarse dentro de root.
        rel = path.lstrip("/").replace("\\", "/")
        target = os.path.normpath(os.path.join(Settings.root, rel))
        root_abs = os.path.abspath(Settings.root)
        if not os.path.abspath(target).startswith(root_abs):
            return self._send(403, b"Ruta no permitida")

        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".m3u": "audio/x-mpegurl",
            ".m3u8": "audio/x-mpegurl",
        }
        if not os.path.isfile(target):
            return self._send(404, b"No encontrado")

        ext = os.path.splitext(target)[1].lower()
        with open(target, "rb") as f:
            body = f.read()
        # Cache corta: al probar cambios hay que recargar, pero en la tele
        # interesa que no se descarte del todo.
        return self._send(200, body, types.get(ext, "application/octet-stream"),
                          {"Cache-Control": "no-cache"})


def main():
    ap = argparse.ArgumentParser(description="Servidor + proxy CORS para cliente TV")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--dir", default="web-tv")
    ap.add_argument("--allow-private", action="store_true",
                    help="permite destinos en la red local (desactiva el filtro SSRF)")
    args = ap.parse_args()

    Settings.port = args.port
    Settings.root = args.dir
    Settings.allow_private = args.allow_private

    try:
        local = socket.gethostbyname(socket.gethostname())
    except socket.gaierror:
        local = "127.0.0.1"

    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    srv.daemon_threads = True

    print("Cliente TV")
    print("  aqui    : http://127.0.0.1:%d/index.html" % args.port)
    print("  tele    : http://%s:%d/index.html" % (local, args.port))
    print("  proxy   : /proxy/stream?u=<url-encoded>")
    if args.allow_private:
        print("  aviso   : destinos privados permitidos")
    print("  Ctrl-C para parar")
    print()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nParado.")
    srv.server_close()


if __name__ == "__main__":
    main()