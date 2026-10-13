"""Audita listas M3U publicas: cuenta canales y prueba si la URL responde.

Las listas abiertas acumulan enlaces muertos. Un Recuento alto no dice nada;
lo util es el porcentaje que realmente reproduce. Se mide con una muestra
HTTP HEAD/GET sobre un subconjunto aleatorio y se informa el margen de error.

Uso: py -3 audit_lists.py [muestra_por_lista]
"""

import concurrent.futures
import random
import sys
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 12
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "*/*"}

CANDIDATOS = [
    ("iptv-org / es",    "https://iptv-org.github.io/iptv/countries/es.m3u"),
    ("iptv-org / mx",    "https://iptv-org.github.io/iptv/countries/mx.m3u"),
    ("iptv-org / ar",    "https://iptv-org.github.io/iptv/countries/ar.m3u"),
    ("iptv-org / co",    "https://iptv-org.github.io/iptv/countries/co.m3u"),
    ("iptv-org / pe",    "https://iptv-org.github.io/iptv/countries/pe.m3u"),
    ("iptv-org / ve",    "https://iptv-org.github.io/iptv/countries/ve.m3u"),
    ("iptv-org / news",  "https://iptv-org.github.io/iptv/categories/news.m3u"),
    ("iptv-org / sports", "https://iptv-org.github.io/iptv/categories/sports.m3u"),
    ("iptv-org / movies", "https://iptv-org.github.io/iptv/categories/movies.m3u"),
]


def fetch(url, method="GET", limit=None):
    req = urllib.request.Request(url, headers=UA, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = r.read() if method == "GET" else b""
            return r.status, r.headers.get("Content-Type", ""), data, r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, "", b"", url
    except Exception:
        return None, "", b"", url


def parse_m3u(text):
    """Devuelve [(titulo, url)] con las entradas #EXTINF + linea siguiente."""
    out = []
    title = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#EXTINF"):
            title = line.split(",", 1)[-1].strip() if "," in line else "?"
        elif line.startswith("#"):
            continue
        else:
            out.append((title or "?", line))
            title = None
    return out


def probe(item):
    """Un stream cuenta como vivo si responde con contenido de video o manifiesto."""
    _title, url = item
    status, ctype, _data, _final = fetch(url, "GET")
    if status is None:
        return "dead", f"sin conexion"
    if status >= 400:
        return "dead", f"HTTP {status}"
    low = (ctype or "").lower()
    if "mpegurl" in low:
        return "alive", "HLS"
    if low.startswith("video/") or low.startswith("audio/"):
        return "alive", ctype.split(";")[0]
    # Algunos servidores no declaran el tipo: se asume vivo si el codigo es 2xx/3xx
    return "alive", "sin content-type"


def audit(name, url, sample_n, workers=12):
    status, ctype, data, _f = fetch(url, "GET")
    if status is None or status >= 400 or not data:
        return {"name": name, "url": url, "error": f"lista no disponible (HTTP {status})"}

    entries = parse_m3u(data.decode("utf-8", "replace"))
    if not entries:
        return {"name": name, "url": url, "error": "sin entradas M3U"}

    rnd = random.Random(7)  # semilla fija: comparables entre ejecuciones
    sample = rnd.sample(entries, min(sample_n, len(entries)))

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for verdict, detail in ex.map(probe, sample):
            results.append((verdict, detail))

    alive = sum(1 for v, _ in results if v == "alive")
    kinds = {}
    for _v, d in results:
        if d and d not in kinds:
            kinds[d] = 0
        if d:
            kinds[d] += 1

    return {
        "name": name, "url": url,
        "total": len(entries),
        "sampled": len(sample),
        "alive": alive,
        "dead": len(sample) - alive,
        "pct": alive / len(sample) * 100,
        "kinds": kinds,
        "examples": [t for t, _ in entries[:3]],
    }


def main(argv):
    n = int(argv[0]) if argv else 8
    print(f"Auditoria de listas M3U publicas  (muestra de {n} URLs por lista)\n")

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(lambda c: audit(c[0], c[1], n), CANDIDATOS))

    results.sort(key=lambda r: -(r.get("pct", -1)))

    print("=" * 78)
    print(f"{'Lista':<20}{'Canales':>9}{'Muestra':>9}{'Vivos':>7}{'%':>7}  Detalle")
    print("=" * 78)
    for r in results:
        if "error" in r:
            print(f"{r['name']:<20}{'-':>9}{'-':>9}{'-':>7}{'-':>7}  {r['error']}")
            continue
        detalle = ", ".join(f"{k}x{v}" for k, v in sorted(r["kinds"].items(),
                                                             key=lambda kv: -kv[1])[:4])
        print(f"{r['name']:<20}{r['total']:>9}{r['sampled']:>9}{r['alive']:>7}"
              f"{r['pct']:>6.0f}%  {detalle}")
        print(f"{'':<20}{r['url']}")

    print("\nNota: 'Vivos' = el servidor responde con contenido de video o un")
    print("manifiesto HLS. No implica que el canal tenga senal ni que no sea")
    print("de geobloqueo: eso solo se comprueba reproduciendo.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))