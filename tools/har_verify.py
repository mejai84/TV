"""Verificacion independiente de un HAR: extrae hechos y no interpretaciones.

Sirve para contrastar un informe generado automaticamente contra el archivo real.
Uso: py -3 har_verify.py <archivo.har>
"""

import collections
import hashlib
import json
import os
import sys


def human(ms):
    return f"{ms:.2f} ms" if ms is not None else "-"


def main(path):
    raw = open(path, "rb").read()
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        har = json.load(f)

    log = har["log"]
    entries = log["entries"]

    print("=" * 74)
    print("IDENTIDAD DEL ARCHIVO")
    print("=" * 74)
    print(f"  archivo       : {os.path.basename(path)}")
    print(f"  bytes         : {len(raw):,}")
    print(f"  lineas        : {raw.count(b'\n') + 1:,}")
    print(f"  sha256        : {hashlib.sha256(raw).hexdigest()}")
    print(f"  har version   : {har.get('version')}")
    print(f"  creator       : {log.get('creator', {}).get('name')} {log.get('creator', {}).get('version')}")

    pages = log.get("pages", [])
    if pages:
        p = pages[0]
        print(f"  page title    : {p.get('title')}")
        print(f"  page started  : {p.get('startedDateTime')}")
        for k, v in sorted(p.get("pageTimings", {}).items()):
            print(f"  timing {k:<14}: {v}")

    print(f"\n  transacciones : {len(entries)}")

    # --- inventario de peticiones ---
    print("\n" + "=" * 74)
    print("TRANSACCIONES")
    print("=" * 74)
    domains = collections.Counter()
    for e in entries:
        req, res = e["request"], e["response"]
        host = req["url"].split("/")[2] if "://" in req["url"] else "?"
        domains[host] += 1
        print(f"\n  [{req['method']}] {req['url']}")
        print(f"      httpVersion={req.get('httpVersion')}  status={res['status']} {res.get('statusText','')}")
        print(f"      tiempo total={human(e.get('time'))}")
        print(f"      cuerpo req={len(req.get('postData', {}).get('text', ''))} B   "
              f"mime respuesta={res['content'].get('mimeType','?')}")
        st = res["content"].get("text", "")
        if st:
            print(f"      cuerpo respuesta ({len(st)} B): {st[:200]}")

    print(f"\n  dominios contactados: {dict(domains)}")

    # --- metodos y capacidades ---
    print("\n" + "=" * 74)
    print("DATOS SENSIBLES")
    print("=" * 74)
    cookies_sent = sum(len(e["request"].get("cookies", [])) for e in entries)
    cookies_set = sum(len(e["response"].get("cookies", [])) for e in entries)
    posts = [e for e in entries if e["request"]["method"] not in ("GET", "HEAD")]
    queries = [e for e in entries if "?" in e["request"]["url"]]
    auth = []
    for e in entries:
        for h in e["request"].get("headers", []):
            if h["name"].lower() in ("authorization", "cookie", "proxy-authorization", "x-api-key"):
                auth.append((h["name"], len(h.get("value", ""))))
    print(f"  cookies enviadas        : {cookies_sent}")
    print(f"  cookies recibidas (Set-Cookie en header): "
          f"{sum(1 for e in entries for h in e['response'].get('headers', []) if h['name'].lower()=='set-cookie')}")
    print(f"  peticiones no-GET       : {len(posts)}")
    print(f"  URLs con query string   : {len(queries)}")
    print(f"  cabeceras de credencial : {auth if auth else 'ninguna'}")
    print(f"  cuerpos de respuesta con datos: "
          f"{sum(1 for e in entries if e['response']['content'].get('text'))}")

    # --- cabeceras: duplicados y valores unicos ---
    print("\n" + "=" * 74)
    print("CABECERAS DE RESPUESTA")
    print("=" * 74)
    for e in entries:
        url = e["request"]["url"].split("/")[2]
        print(f"\n  --- {url} [{e['response']['status']}] ---")
        seen = collections.defaultdict(list)
        for h in e["response"].get("headers", []):
            seen[h["name"]].append(h["value"])
        for name in sorted(seen):
            vals = seen[name]
            flag = "  <-- DUPLICADO" if len(vals) > 1 else ""
            for v in vals:
                print(f"    {name}: {v[:150]}{flag if v is vals[-1] else ''}")

    # --- timings detail ---
    print("\n" + "=" * 74)
    print("DESGLOSE DE TIEMPOS")
    print("=" * 74)
    for e in entries:
        t = e.get("timings", {})
        parts = ", ".join(f"{k}={human(v)}" for k, v in t.items() if v is not None and v >= 0)
        wait = t.get("wait", 0) or 0
        total = e.get("time") or 0
        pct = (wait / total * 100) if total else 0
        print(f"  {e['request']['url'][:58]:<58} {parts}  espera={pct:.1f}%")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))