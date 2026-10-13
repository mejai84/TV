"""Decode the binary AndroidManifest.xml and list assets/config entries so the
app's own identity and any bundled endpoint configuration are visible.

Usage: py -3 apk_manifest.py <apk>
"""

import struct
import sys
import zipfile

# --- minimal binary AXML (resources.arsc format) string pool reader ---
# Layout is stable across AAPT2 output: header, string-pool chunk, then
# resource chunks whose keys reference the pool by index.


def read_chunk(buf, offset):
    kind, header_size, size = struct.unpack_from("<HHI", buf, offset)
    return kind, header_size, size


def read_string_pool(buf, offset):
    _, header_size, chunk_size = read_chunk(buf, offset)
    string_count, style_count, flags, strings_start, styles_start = struct.unpack_from(
        "<IIIII", buf, offset + header_size
    )
    offsets_at = offset + header_size + 20
    data_at = offset + strings_start
    utf8 = bool(flags & (1 << 8))

    strings = []
    for i in range(string_count):
        (rel,) = struct.unpack_from("<I", buf, offsets_at + i * 4)
        pos = data_at + rel
        if utf8:
            # Two length prefixes (ULEB128-style) then the payload.
            n1 = buf[pos]
            pos += 2 if n1 & 0x80 else 1
            n2 = buf[pos]
            pos += 2 if n2 & 0x80 else 1
            strings.append(buf[pos:pos + n2].decode("utf-8", "replace"))
        else:
            (length,) = struct.unpack_from("<H", buf, pos)
            strings.append(buf[pos + 2:pos + 2 + length * 2].decode("utf-16-le", "replace"))
    return strings, chunk_size


def manifest_strings(raw):
    """Return the AXML string pool, tolerating format variants."""
    try:
        strings, size = read_string_pool(raw, 8)
        if strings:
            return strings
    except (struct.error, IndexError):
        pass
    # Fallback: the pool always follows a fixed offset in practice.
    for base in (8, 0x0C, 0x10):
        try:
            strings, _ = read_string_pool(raw, base)
            if strings:
                return strings
        except (struct.error, IndexError):
            continue
    return []


def main(argv):
    apk = argv[0]
    with zipfile.ZipFile(apk) as zf:
        names = zf.namelist()

        print("=" * 78)
        print(f"APK: {apk}")
        print("=" * 78)

        print("\n--- MANIFEST STRINGS (identidad + declarations) ---")
        raw = zf.read("AndroidManifest.xml")
        strings = manifest_strings(raw)
        print(f"  ({len(strings)} strings en el pool)\n")
        for s in strings:
            if s.strip():
                print(f"  {s}")

        print("\n--- ASSETS / CONFIG (posible endpoint embebido) ---")
        for name in names:
            low = name.lower()
            if low.startswith(("assets/", "res/raw/")) or low.endswith(
                (".json", ".js", ".conf", ".cfg", ".properties", ".ini", ".txt", ".env")
            ):
                try:
                    info = zf.getinfo(name)
                except KeyError:
                    continue
                print(f"\n  [{name}]  {info.file_size} bytes")
                blob = zf.read(name)
                if info.file_size <= 40000 and b"\x00" not in blob[:64]:
                    text = blob.decode("utf-8", "replace").strip()
                    print("      " + text[:1200].replace("\n", "\n      "))

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))