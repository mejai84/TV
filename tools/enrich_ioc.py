"""Enriquecimiento pasivo de indicadores (IOC).

Solo consulta fuentes publicas de registro: NO contacta los hosts analizados.
Contactarlos avisaria a quien los opera, y ademas un dominio malicioso
respondiendo a un GET desde tu IP te mete en listas de reputacion.

Uso: py -3 enrich_ioc.py <dominio[:puerto]> | <ip[:puerto][udp]>
"""

import ipaddress
import json
import re
import socket
import sys
import urllib.request

TIMEOUT = 15
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
RDAP = {
    "com": "https://rdap.verisign.com/com/v1/domain/{d}",
    "net": "https://rdap.verisign.com/net/v1/domain/{d}",
    "org": "https://rdap.publicinterestregistry.org/rdap/domain/{d}",
    "live": "https://rdap.nic.live/domain/{d}",
    "io":  "https://rdap.identitydigital.services/rdap/domain/{d}",
}
# rdap.org resuelve el TLD correcto y salta al registro autoritativo. Se usa
# como plan B cuando el endpoint directo falla o no esta publicado para el TLD.
RDAP_BOOTSTRAP = "https://rdap.org/domain/{d}"
IP_RDAP = "https://rdap.arin.net/registry/ip/{ip}"
# Registro europeo: algunos bloques de RIPE/NIC son solo WHOIS, sin RDAP.
RIPE_RDAP = "https://rdap.db.ripe.net/ip/{ip}"


def get(url):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None


def split_ind(indicator):
    """Separa host/IP, puerto y protocolo. UDP no tiene separador en la IP."""
    proto = "TCP"
    m = re.match(r"^(.*)\s+UDP$", indicator, re.I)
    if m:
        indicator, proto = m.group(1).strip(), "UDP"
    host, _, port = indicator.partition(":")
    return host, port or "", proto


def registrable(host):
    """Reduce 'sub.dominio.tld' a 'dominio.tld'.

    RDAP solo admite el dominio registrable: consultar 'yuwc.swzablvpm.com'
    devuelve 404 porque el subdominio no es una entrada del registro. Es un
    error silencioso salvo que se mire el codigo de respuesta.

    Limitacion: es una aproximacion valida para TLD de una sola etiqueta
    (.com, .net, .io). Para sufijos publicos compuestos (.co.uk, .com.br,
    .com.ar) haria falta una Public Suffix List, que no se incluye para no
    depender de datos externos actualizables.
    """
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def whois_domain(host):
    target = registrable(host)
    if target != host:
        print(f"  (consultando el dominio registrable: {target})")
    tld = target.rsplit(".", 1)[-1]
    url = RDAP.get(tld)
    data = get(url.format(d=target)) if url else None
    if not data:
        data = get(RDAP_BOOTSTRAP.format(d=target))
    if not data:
        return None
    out = {"registrar": None, "created": None, "updated": None,
           "expires": None, "nameservers": [], "status": data.get("status", [])}
    for e in data.get("events", []):
        if e.get("eventAction") == "registration":
            out["created"] = e.get("eventDate")
        elif e.get("eventAction") == "expiration":
            out["expires"] = e.get("eventDate")
        elif e.get("eventAction") == "last changed":
            out["updated"] = e.get("eventDate")
    for ent in data.get("entities", []):
        if "registrar" in (ent.get("roles") or []):
            vcard = ent.get("vcardArray", [None, []])[1]
            out["registrar"] = next((v[3] for v in vcard if v[0] == "fn"), None)
    out["nameservers"] = [n.get("ldhName") for n in data.get("nameservers", [])]
    return out


def whois_ip(ip):
    data = get(IP_RDAP.format(ip=ip)) or get(RIPE_RDAP.format(ip=ip))
    if not data:
        return None
    out = {"name": data.get("name"), "handle": data.get("handle"),
           "range": None, "country": None, "created": None}
    cidr = data.get("cidr0_cidrs") or []
    if cidr:
        out["range"] = f"{cidr[0].get('v4prefix') or cidr[0].get('v6prefix')}"
    for e in data.get("events", []):
        if e.get("eventAction") in ("registration", "last changed"):
            out["created"] = out["created"] or e.get("eventDate")
    for ent in data.get("entities", []):
        roles = ent.get("roles") or []
        if not ({"registrant", "administrative", "owner"} & set(roles)):
            continue
        vcard = ent.get("vcardArray", [None, []])[1]
        for v in vcard:
            # adr es un campo compuesto: ["adr", ["","","",[...componentes...]]].
            # El codigo de pais cuelga de una entrada "country" dentro del
            # ultimo elemento, no de una posicion fija. Se busca por clave.
            if v[0] != "adr" or not isinstance(v[-1], list):
                continue
            for comp in v[-1]:
                if isinstance(comp, list) and comp and comp[0] == "country":
                    out["country"] = comp[-1]
        break
    return out


def resolve(host):
    try:
        ips = socket.getaddrinfo(host, None)
        return sorted({i[4][0] for i in ips})
    except socket.gaierror:
        return []


def reverse(ip):
    try:
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        return None


def entropy(s):
    """Entropia de Shannon. Nombres generados al azar tienen valores altos."""
    from collections import Counter
    import math
    if not s:
        return 0.0
    c = Counter(s.lower())
    n = len(s)
    return -sum((v / n) * math.log2(v / n) for v in c.values())


def main(argv):
    for indicator in argv:
        host, port, proto = split_ind(indicator)
        print("=" * 74)
        print(f"INDICADOR: {indicator}")
        print("=" * 74)

        is_ip = False
        try:
            ipaddress.ip_address(host)
            is_ip = True
        except ValueError:
            pass

        # --- resolucion ---
        if is_ip:
            rdns = reverse(host)
            print(f"  tipo        : IP publica")
            print(f"  PTR         : {rdns or '(sin registro inverso)'}")
            who = whois_ip(host)
            if who:
                print(f"  ASN/holder  : {who.get('name')}")
                print(f"  handle      : {who.get('handle')}")
                print(f"  rango       : {who.get('range')}")
                print(f"  pais        : {who.get('country')}")
                print(f"  registro    : {who.get('created')}")
        else:
            ips = resolve(host)
            print(f"  tipo        : dominio")
            print(f"  resuelve a  : {', '.join(ips) if ips else 'NO RESUELVE'}")

            # La entropia se mide sobre la etiqueta REGISTRADA (la inmediatamente
            # a la izquierda del TLD), no sobre la subdominio. Medir el
            # subdominio mislead: en "ebgpbvi.cdun5kmepb.com" la parte
            # generada es "cdun5kmepb", no "ebgpbvi".
            reg_label = ".".join(host.split(".")[:-1]).split(".")[-1] if host.count(".") else host
            ent = entropy(reg_label)
            print(f"  etiqueta registrada: {reg_label}   (long {len(reg_label)}, entropia {ent:.2f})")
            if ent > 3.5:
                print("  ^ entropia muy alta: compatible con DGA")
            elif ent > 3.0:
                print("  ^ entropia elevada: nombre aleatorio/ofuscado probable,")
                print("    pero NO prueba DGA (una marca legible suele dar 2.2-2.9)")
            else:
                print("  ^ entropia baja: parece un nombre legible, no generado")
            who = whois_domain(host)
            if who:
                print(f"  registrador : {who.get('registrar')}")
                print(f"  creado      : {who.get('created')}")
                print(f"  actualizado : {who.get('updated')}")
                print(f"  expira      : {who.get('expires')}")
                print(f"  estado      : {', '.join(who.get('status') or [])}")
                print(f"  NS          : {', '.join(who.get('nameservers') or [])}")
            else:
                print("  registro    : no disponible via RDAP")

        if port:
            print(f"  puerto      : {port}/{proto}")
            if proto == "UDP":
                print("  ^ UDP en puerto alto: compatible con C2, P2P o beaconing;")
                print("    no se confirma desde aqui. Requiere captura de trafico.")

        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))