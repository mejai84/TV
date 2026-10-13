"""Locate the app's own endpoint configuration and print surrounding context.

The production domain config is usually obfuscated, assembled at runtime, or
stored under a different asset name than the test config. This walks the DEX
string pool in order and prints each match with its neighbouring strings, which
is what reveals how the pieces are joined.

Usage: py -3 apk_context.py <apk> <needle> [needle ...]
"""

import re
import struct
import sys
import zipfile

# DEX string pool: uleb128-encoded size followed by MUTF-8 payload.


def uleb128(buf, pos):
    result = 0
    shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def dex_strings(blob):
    (string_ids_size,) = struct.unpack_from("<I", blob, 56)
    (string_ids_off,) = struct.unpack_from("<I", blob, 60)
    strings = []
    for i in range(string_ids_size):
        (data_off,) = struct.unpack_from("<I", blob, string_ids_off + i * 4)
        size, pos = uleb128(blob, data_off)
        end = blob.find(b"\x00", pos)
        strings.append(blob[pos:end].decode("utf-8", "replace"))
    return strings


def resources_strings(blob):
    """Resource tables hold the compiled string values; reuse the pool reader."""
    sys.path.insert(0, __file__.rsplit("\\", 1)[0])
    from apk_manifest import read_string_pool

    try:
        strings, _ = read_string_pool(blob, 8)
        return strings
    except (struct.error, IndexError):
        return []


def host_like(value):
    return bool(re.fullmatch(r"(?:[A-Za-z0-9-]+\.){1,6}[A-Za-z]{2,24}", value))


def main(argv):
    apk, needles = argv[0], [n.lower() for n in argv[1:]]
    with zipfile.ZipFile(apk) as zf:
        blobs = {}
        for name in zf.namelist():
            if re.search(r"(classes\d*\.dex|resources\.arsc)$", name):
                blobs[name] = zf.read(name)

        for name, blob in blobs.items():
            strings = dex_strings(blob) if name.endswith(".dex") else resources_strings(blob)
            if not strings:
                continue
            print("=" * 78)
            print(f"{name}  ({len(strings)} strings)")
            print("=" * 78)
            for i, s in enumerate(strings):
                if not any(n in s.lower() for n in needles):
                    continue
                lo, hi = max(0, i - 6), min(len(strings), i + 7)
                print(f"\n  [{i}] {s[:200]}")
                for j in range(lo, hi):
                    if j == i:
                        continue
                    mark = ">>" if host_like(strings[j]) else "  "
                    print(f"  {mark} {strings[j][:160]}")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))