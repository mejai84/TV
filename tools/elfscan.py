"""Analisis estatico de librerias nativas ELF para Android.

Extrae:
  - Simbolos exportados (.dynsym / .symtab)
  - Secciones
  - Cadenas relevantes (red, DNS, GSLB, reproduccion)
No ejecuta nada del binario.

Uso: py -3 elfscan.py <apk> <ruta .so dentro del apk> [filtro_cadenas]
"""

import re
import struct
import sys
import zipfile

# Palabras clave para clasificar la funcion de una cadena.
KEYWORDS = {
    "red": [
        "http://", "https://", "curl", "socket", "connect", "send", "recv",
        "getaddrinfo", "res_query", "dns", "DoH", "udp", "tcp", "Host:",
        "User-Agent", "Content-Type", "GET ", "POST ", "HEAD ",
    ],
    "gslb/cdn": [
        "gslb", "GSLB", "cdn", "CDN", "main_addr", "spare_addr", "priority",
        "strategy", "serial_number", "auths", "sign_type", "redirect", "Entry",
    ],
    "reproduccion": [
        "MediaFile", "Program", "uri", "license", "auth", "m3u8", "mp4",
        "hls", "HLS", "segment", "ts_url", "key_url", "extractor", "demuxer",
    ],
    "seguridad": [
        "aes", "AES", "encrypt", "decrypt", "hmac", "HMAC", "sha256", "SHA256",
        "md5", "MD5", "sign", "verify", "widevine", "drm", "DRM",
    ],
}

INTERESTING_SECTIONS = (".dynsym", ".dynstr", ".rodata", ".data.rel.ro", ".plt", ".got")


def u16(b, o): return struct.unpack_from("<H", b, o)[0]
def u32(b, o): return struct.unpack_from("<I", b, o)[0]
def u64(b, o): return struct.unpack_from("<Q", b, o)[0]


class Elf:
    def __init__(self, b):
        self.b = b
        self.is64 = b[4] == 2
        self.machine = u16(b, 18)
        if self.is64:
            self.e_shoff = u64(b, 0x28)
            self.e_shentsize = u16(b, 0x3A)
            self.e_shnum = u16(b, 0x3C)
            self.e_shstrndx = u16(b, 0x3E)
        else:
            self.e_shoff = u32(b, 0x20)
            self.e_shentsize = u16(b, 0x2E)
            self.e_shnum = u16(b, 0x30)
            self.e_shstrndx = u16(b, 0x32)
        self.sections = []
        for i in range(self.e_shnum):
            o = self.e_shoff + i * self.e_shentsize
            if self.is64:
                s = dict(name=u32(b, o), typ=u32(b, o + 4), flags=u64(b, o + 8),
                         addr=u64(b, o + 0x10), off=u64(b, o + 0x18),
                         size=u64(b, o + 0x20), link=u32(b, o + 0x28),
                         entsize=u64(b, o + 0x38))
            else:
                s = dict(name=u32(b, o), typ=u32(b, o + 4), flags=u32(b, o + 8),
                         addr=u32(b, o + 0xC), off=u32(b, o + 0x10),
                         size=u32(b, o + 0x14), link=u32(b, o + 0x18),
                         entsize=u32(b, o + 0x24))
            self.sections.append(s)
        sh = self.sections[self.e_shstrndx]
        self.shstrtab = self._slice(sh["off"], sh["size"])

    def _slice(self, off, size):
        return self.b[off:off + size]

    def secname(self, s):
        e = self.shstrtab.find(b"\x00", s["name"])
        return self.shstrtab[s["name"]:e].decode("utf-8", "replace")

    def section(self, name):
        for s in self.sections:
            if self.secname(s) == name:
                return self._slice(s["off"], s["size"])
        return None

    def dynsyms(self):
        """[(nombre, valor, tamaño, tipo)] de .dynsym con nombre no vacío."""
        dyn = self.section(".dynsym")
        str_ = self.section(".dynstr")
        if not dyn or not str_:
            return []
        out = []
        # Symbol ELF64: st_name(4) st_info(1) st_other(1) st_shndx(2) st_value(8) st_size(8)
        entsize = 24 if self.is64 else 16
        n = len(dyn) // entsize
        for i in range(n):
            o = i * entsize
            name_off = u32(dyn, o)
            info = dyn[o + 4]
            if self.is64:
                value = u64(dyn, o + 8)
                size = u64(dyn, o + 16)
            else:
                value = u32(dyn, o + 4)
                size = u32(dyn, o + 8)
            e = str_.find(b"\x00", name_off)
            name = str_[name_off:e].decode("utf-8", "replace")
            if name:
                out.append((name, value, size, info & 0xF))
        return out

    def strings(self, minlen=4):
        """Cadenas ASCII imprimibles del binario completo."""
        pat = re.compile(rb"[\x20-\x7e]{%d,}" % minlen)
        for m in pat.finditer(self.b):
            yield m.start(), m.group().decode("ascii")


def main(argv):
    apk, so_path = argv[0], argv[1]
    filtro = argv[2].lower() if len(argv) > 2 else None

    with zipfile.ZipFile(apk) as zf:
        blob = zf.read(so_path)

    e = Elf(blob)
    MACH = {0x28: "ARM (32)", 0xB7: "AArch64 (64)", 0x3E: "x86-64", 0x03: "x86"}
    bits = "ELF64" if e.is64 else "ELF32"

    print("=" * 78)
    print(f"LIBRERIA: {so_path}")
    print(f"  formato : {bits} · {MACH.get(e.machine, hex(e.machine))}")
    print(f"  bytes   : {len(blob):,}")
    print("=" * 78)

    print("\n--- SECCIONES ---")
    for s in e.sections:
        n = e.secname(s)
        if n and (n in INTERESTING_SECTIONS or n.startswith((".text", ".rodata"))):
            print(f"  {n:<18} off=0x{s['off']:08x}  size={s['size']:>10,}")

    syms = e.dynsyms()
    print(f"\n--- SIMBOLOS EXPORTADOS/DINAMICOS: {len(syms)} ---")

    jni = [s for s in syms if "JNI" in s[0] or s[0].startswith("Java_")]
    print(f"\n  JNI ({len(jni)}):")
    for name, val, size, typ in sorted(jni, key=lambda x: x[0]):
        print(f"    0x{val:08x}  {name}")

    otros = [s for s in syms if s[3] == 2 and "JNI" not in s[0] and not s[0].startswith("Java_")]
    if otros:
        print(f"\n  FUNCIONES EXPORTADAS no-JNI ({len(otros)}), primeras 60:")
        for name, val, size, typ in sorted(otros, key=lambda x: x[0])[:60]:
            print(f"    0x{val:08x}  {name}")

    print("\n--- CADENAS POR CATEGORIA ---")
    cats = {k: [] for k in KEYWORDS}
    for off, s in e.strings(6):
        low = s.lower()
        if filtro and filtro not in low:
            continue
        for cat, kws in KEYWORDS.items():
            for kw in kws:
                if kw.lower() in low:
                    cats[cat].append((off, s))
                    break

    for cat, items in cats.items():
        uniq = {}
        for off, s in items:
            uniq.setdefault(s, off)
        print(f"\n  [{cat}] {len(uniq)} cadenas distintas")
        for s, off in sorted(uniq.items(), key=lambda kv: kv[0])[:35]:
            print(f"    0x{off:08x}  {s[:110]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))