"""Desensamblador DEX minimo para cuando la descompilacion a Java falla.

JADX devuelve "no decompiled body" en algunos metodos (puentes sinteticos de
Kotlin, metodos con codigo no lineal). Escribir el desensamblado a mano desde
las tablas del DEX da la evidencia sin depender de que el descompilador acepte
o no renderizar ese metodo.

Solo lectura. No ejecuta nada del APK.

Uso:
  py -3 dexdump.py <apk> <clase.pkg.Clase> [metodo]
  py -3 dexdump.py <apk> t5.j                 # todas las clases que coinciden
  py -3 dexdump.py <apk> t5.j compare
"""

import struct
import sys
import zipfile

# Formato del code_item y de las tablas de identificadores del DEX.
OP_FMT = {}


def u1(b, o): return b[o]
def u2(b, o): return struct.unpack_from("<H", b, o)[0]
def u4(b, o): return struct.unpack_from("<I", b, o)[0]


class Dex:
    def __init__(self, blob):
        self.b = blob
        if blob[:4] != b"dex\n":
            raise ValueError("no es un DEX (magic incorrecto)")
        # Cabecera DEX. Ojo: la firma SHA-1 ocupa 20 bytes en 0x0C, asi que
        # todo lo posterior va desplazado 4 respecto a lo que parece.
        #   0x20 file_size   0x24 header_size (112)   0x28 endian_tag
        #   0x34 map_off
        #   0x38 string_ids_size  0x3C string_ids_off
        #   0x40 type_ids_size    0x44 type_ids_off
        #   0x48 proto_ids_size   0x4C proto_ids_off
        #   0x50 field_ids_size   0x54 field_ids_off
        #   0x58 method_ids_size  0x5C method_ids_off
        #   0x60 class_defs_size  0x64 class_defs_off
        self.file_size = u4(blob, 0x20)
        self.header_size = u4(blob, 0x24)
        self.string_ids_size = u4(blob, 0x38)
        self.string_ids_off = u4(blob, 0x3C)
        self.type_ids_off = u4(blob, 0x44)
        self.proto_ids_off = u4(blob, 0x4C)
        self.field_ids_off = u4(blob, 0x54)
        self.method_ids_off = u4(blob, 0x5C)
        self.class_defs_size = u4(blob, 0x60)
        self.class_defs_off = u4(blob, 0x64)

        # Autovalidacion: la primera tabla arranca tras la cabecera y la
        # siguiente justo despues. Si esto no cuadra, los offsets estan mal.
        esperado = self.header_size + self.string_ids_size * 4
        if self.string_ids_off != self.header_size or esperado != self.type_ids_off:
            raise ValueError(
                "cabecera incoherente: string_ids_off=%d header_size=%d, "
                "string_ids_off+size*4=%d type_ids_off=%d"
                % (self.string_ids_off, self.header_size, esperado, self.type_ids_off))

    # ---- tablas ----
    def string(self, idx):
        off = u4(self.b, self.string_ids_off + idx * 4)
        # uleb128 size, luego MUTF-8
        p = off
        n, p = self._uleb(p)
        end = self.b.find(b"\x00", p)
        return self.b[p:end].decode("utf-8", "replace")

    def _uleb(self, p):
        r = s = 0
        while True:
            x = self.b[p]; p += 1
            r |= (x & 0x7F) << s
            if not x & 0x80:
                return r, p
            s += 7

    def type_name(self, idx):
        return self.string(u4(self.b, self.type_ids_off + idx * 4))

    def method_ref(self, idx):
        off = self.method_ids_off + idx * 8
        cls = u2(self.b, off)
        proto = u2(self.b, off + 2)
        name = u4(self.b, off + 4)
        # proto -> return type
        ret = self.type_name(u4(self.b, self.proto_ids_off + proto * 12 + 4))
        return f"{self.type_name(cls)}->{self.string(name)}:{ret}"

    def field_ref(self, idx):
        off = self.field_ids_off + idx * 8
        return f"{self.type_name(u2(self.b, off))}->{self.string(u4(self.b, off + 4))}"

    # ---- clases ----
    def classes(self):
        for i in range(self.class_defs_size):
            off = self.class_defs_off + i * 32
            yield {
                "name": self.type_name(u4(self.b, off)),
                "access": u4(self.b, off + 4),
                "class_data_off": u4(self.b, off + 24),
            }

    def methods(self, cdef):
        """Devuelve [(nombre, access_flags, code_off, method_idx)] de la clase.

        class_data_item = uleb(static_fields) encoded_field* uleb(instance_fields)
        encoded_field* uleb(direct_methods) encoded_method* uleb(virtual_methods)
        encoded_method = uleb(method_idx_diff) uleb(access) uleb(code_off)

        Los indices son DIFERENCIAS acumuladas y de longitud variable: no se
        pueden saltar con aritmetica fija, o el puntero se desincroniza y todos
        los indices posteriores salen basura.
        """
        if not cdef["class_data_off"]:
            return []
        p = cdef["class_data_off"]

        n, p = self._uleb(p)          # static fields
        for _ in range(n):
            _, p = self._uleb(p)       # field_idx_diff
            _, p = self._uleb(p)       # access_flags

        n, p = self._uleb(p)          # instance fields
        for _ in range(n):
            _, p = self._uleb(p)
            _, p = self._uleb(p)

        out = []
        for grupo in (0, 1):          # 0 = direct, 1 = virtual
            n, p = self._uleb(p)
            idx = 0
            for _ in range(n):
                d, p = self._uleb(p)   # method_idx_diff
                a, p = self._uleb(p)   # access_flags
                c, p = self._uleb(p)   # code_off
                idx += d
                out.append((self.string(self.method_idx_name(idx)), a, c, idx))
        return out

    def method_idx_name(self, idx):
        return u4(self.b, self.method_ids_off + idx * 8 + 4)

    def code(self, code_off):
        """(registros, ins, outs, [unidades de 16 bits])."""
        if not code_off:
            return None
        o = code_off
        regs = u2(self.b, o); ins = u2(self.b, o + 2); outs = u2(self.b, o + 4)
        tries = u2(self.b, o + 6)
        insns_size = u4(self.b, o + 12)
        insns = []
        p = o + 16
        for _ in range(insns_size):
            insns.append(u2(self.b, p)); p += 2
        return regs, ins, outs, insns


# --- tabla minima de opcodes: longitud en unidades de 16 bits ---
def insn_len(op, b, i):
    """Longitud de la instruccion en unidades de 16 bits."""
    if op in (0x00,): return 1                       # nop
    if op in (0x01, 0x04, 0x07, 0x0A, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12,
              0x1D, 0x1E, 0x21, 0x27, 0x28, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F,
              0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
              0x8A, 0x8B, 0x8C, 0x8D, 0x8E, 0x8F, 0x90, 0x91, 0x92, 0x93,
              0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0x9B, 0x9C, 0x9D,
              0x9E, 0x9F, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
              0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB0, 0xB1,
              0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB,
              0xBC, 0xBD, 0xBE, 0xBF, 0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5,
              0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF,
              0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9,
              0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xE0, 0xE1, 0xE2):
        return 1
    if op in (0x02, 0x05, 0x08, 0x13, 0x15, 0x16, 0x19, 0x1A, 0x1C, 0x1F,
              0x20, 0x22, 0x23, 0x29): return 2          # 2 unidades
    if op in (0x03, 0x06, 0x09, 0x14, 0x17, 0x1B, 0x24, 0x25, 0x26): return 3
    if 0x2D <= op <= 0x3D: return 2                    # opcode 0t + AA|op BBBB
    if 0x44 <= op <= 0x6D: return 3                    # 23t -> 2/3 segun registro
    if 0x6E <= op <= 0x72: return 3
    if 0x74 <= op <= 0x78: return 3
    if 0x90 <= op <= 0xAF: return 2                    # 23x -> depende del registro
    if op in (0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9,
              0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xC0, 0xC1, 0xC2, 0xD7,
              0xD8, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xE0, 0xE1,
              0xE2, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF):
        return 3
    if op in (0x18,): return 5                         # const-wide
    if op in (0x21,): return 2
    if op in (0x23,): return 2
    return 1


def fmt(dex, insns, i):
    """Devuelve (texto, unidades consumidas)."""
    w = insns[i]; op = w & 0xFF; hi = w >> 8
    n = insn_len(op, insns, i)

    def reg(bb): return f"v{hi}, v{bb}" if bb < 256 else f"v{hi}, v{bb-256}"

    if op == 0x1A:   # const-string
        idx = insns[i+1]
        return f"const-string {reg(insns[i+1])}, \"{dex.string(idx)}\"", n
    if op == 0x1B:   # const-string/jumbo
        idx = insns[i+1] | (insns[i+2] << 16)
        return f"const-string/jumbo v{hi}, \"{dex.string(idx)}\"", 3
    if 0x6E <= op <= 0x72:   # invoke-*
        kinds = {0x6E: "virtual", 0x6F: "super", 0x70: "direct",
                 0x71: "static", 0x72: "interface"}
        idx = insns[i+1]
        argc = hi >> 4
        return f"invoke-{kinds[op]} {{{argc} args}}, {dex.method_ref(idx)}", 3
    if 0x74 <= op <= 0x78:   # invoke-*/range
        kinds = {0x74: "virtual/range", 0x75: "super/range", 0x76: "direct/range",
                 0x77: "static/range", 0x78: "interface/range"}
        idx = insns[i+1]
        return f"invoke-{kinds[op]} {dex.method_ref(idx)}", 3
    if 0x52 <= op <= 0x6D:   # iget/iput
        kinds = {0x52: "iget", 0x53: "iget-wide", 0x54: "iget-object",
                 0x55: "iget-boolean", 0x56: "iget-byte", 0x57: "iget-char",
                 0x58: "iget-short", 0x59: "iput", 0x5A: "iput-wide",
                 0x5B: "iput-object", 0x5C: "iput-boolean", 0x62: "sget",
                 0x63: "sget-wide", 0x64: "sget-object", 0x65: "sget-boolean",
                 0x66: "sget-byte", 0x67: "sget-char", 0x68: "sget-short",
                 0x69: "iput-virtual", 0x6A: "sput", 0x6B: "sput-wide",
                 0x6C: "sput-object", 0x6D: "sput-boolean"}
        name = kinds.get(op, f"op_{op:02x}")
        idx = insns[i+1]
        return f"{name} {reg(insns[i+1] if op < 0x60 else hi)}, {dex.field_ref(idx)}", 2
    if op == 0x22:  # new-instance
        return f"new-instance {reg(insns[i+1])}, {dex.type_name(insns[i+1])}", 2
    if op == 0x1F:  # check-cast
        return f"check-cast {reg(insns[i+1])}, {dex.type_name(insns[i+1])}", 2
    if op == 0x12:  # const/4
        return f"const/4 v{hi}, {((hi & 0xF) ^ 0x8) - (hi & 0x8)}", 1
    if op == 0x13:  # const/16
        val = insns[i+1]
        return f"const/16 v{hi}, {val - 65536 if val > 32767 else val}", 2
    if op == 0x14:  # const
        return f"const v{hi}, 0x{struct.unpack('<i', bytes(insns[i+1:i+3]))[0] and 0xFFFFFFFF:08x}", 3
    if op == 0x15:  # const/high16
        return f"const/high16 v{hi}, 0x{insns[i+1]:04x}0000", 2
    if op == 0x16:  # const-wide/16
        return f"const-wide/16 v{hi}, {insns[i+1]}", 2
    if op == 0x0E:  # return-void
        return "return-void", 1
    if op == 0x0F:  # return
        return f"return {reg(hi)}", 1
    if op == 0x11:  # return-object
        return f"return-object {reg(hi)}", 1
    if op == 0x10:  # return-wide
        return f"return-wide {reg(hi)}", 1
    if op == 0x0C:  # move-result-object
        return f"move-result-object {reg(hi)}", 1
    if op == 0x0A:  # move-result
        return f"move-result {reg(hi)}", 1
    if 0x28 <= op <= 0x2B:
        return f"op_{op:02x} {reg(insns[i+1])}", 1
    if 0x21 <= op <= 0x27:
        return f"array-op_{op:02x} {reg(hi)}", 2
    if op == 0x32:  # if-eq
        return f"if-eq {reg(insns[i+1])}, {struct.unpack('<h', struct.pack('<H', insns[i+2]))[0]}", 2
    if op == 0x33:
        return f"if-ne {reg(insns[i+1])}, {struct.unpack('<h', struct.pack('<H', insns[i+2]))[0]}", 2
    if op == 0x38:  # if-eqz
        return f"if-eqz {reg(hi)}, +{struct.unpack('<h', struct.pack('<H', insns[i+1]))[0]}", 2
    if op == 0x39:
        return f"if-nez {reg(hi)}, +{struct.unpack('<h', struct.pack('<H', insns[i+1]))[0]}", 2
    if 0x32 <= op <= 0x37:
        return f"if-* {reg(insns[i+1])}, branch", 2
    if op == 0x00:
        return "nop", 1
    return f"op_{op:02x} raw={w:04x}", n


def dump_dex(dex, cls_filter, meth_filter):
    hits = 0
    for cdef in dex.classes():
        name = cdef["name"]
        simple = name.rsplit("/", 1)[-1].replace(";", "")
        if cls_filter not in simple and cls_filter not in name:
            continue
        hits += 1
        acc = cdef["access"]
        kinds = []
        if acc & 0x1: kinds.append("public")
        if acc & 0x10: kinds.append("final")
        if acc & 0x400: kinds.append("abstract")
        if acc & 0x200: kinds.append("interface")
        print("=" * 76)
        print(f"CLASE  {name.replace('/', '.')}")
        print(f"       acceso: {' '.join(kinds) or 'package-private'}")
        print("=" * 76)
        for mname, macc, coff, midx in dex.methods(cdef):
            if meth_filter and meth_filter != mname:
                continue
            flags = []
            if macc & 0x1: flags.append("public")
            if macc & 0x2: flags.append("private")
            if macc & 0x4: flags.append("protected")
            if macc & 0x8: flags.append("static")
            if macc & 0x100: flags.append("native")
            if macc & 0x400: flags.append("abstract")
            if macc & 0x10000: flags.append("constructor")
            c = dex.code(coff)
            print(f"\n  METODO {mname}  [{' '.join(flags) or 'package'}]  method_idx={midx}")
            if c is None:
                print("    <sin code_item: abstracto, nativo o sin cuerpo>")
                continue
            regs, ins, outs, insns = c
            print(f"    code_item: registers={regs} ins={ins} outs={outs} insns_size={len(insns)}")
            if not insns:
                print("    <cuerpo vacio>")
                continue
            i = 0
            while i < len(insns):
                if i % 2 == 0:
                    print(f"    {i:04x}:  ", end="")
                try:
                    text, n = fmt(dex, insns, i)
                except Exception as e:
                    text, n = f"<desensamblado fallido: {e}>", 1
                print(text)
                if i % 2 != 0:
                    print()
                i += max(1, n)
            print()
    if not hits:
        print(f"Sin coincidencias para '{cls_filter}'")


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    apk, cls = argv[0], argv[1]
    meth = argv[2] if len(argv) > 2 else None
    with zipfile.ZipFile(apk) as zf:
        names = [n for n in zf.namelist()
                 if n.startswith("classes") and n.endswith(".dex")]
        for n in sorted(names):
            print(f"\n########## {n} ##########")
            dump_dex(Dex(zf.read(n)), cls, meth)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))