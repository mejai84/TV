"""Static endpoint discovery for APKs: pulls URLs, hosts and IPs out of the
binary artifacts without decompiling anything (no JDK/JADX required).

Usage: py -3 scan_apk.py <apk> [apk ...]
"""

import collections
import ipaddress
import re
import sys
import zipfile

# DEX string pools and AXML string pools both keep literal bytes verbatim,
# so scanning raw bytes finds the URLs even when the code is obfuscated.
URL_RE = re.compile(rb"(?:https?|wss?|ftp)://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]{4,300}")
HOST_RE = re.compile(
    rb"\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+"
    rb"(?:com|net|org|io|tv|app|dev|cc|co|xyz|me|info|cloud|live|site|top|win|pro|ru|es|uk|de|fr|br|mx|ar|cl|py|ve|ec|pe|bo|uy|do|pa|ni|cr|gt|sv|hn|pr|cu)\b"
)
IP_RE = re.compile(rb"\b(?:\d{1,3}\.){3}\d{1,3}\b(?::\d{1,5})?")

# Obfuscated/native plumbing that would otherwise drown the real API hosts.
NOISE = re.compile(
    r"^(?:schemas\.android|www\.w3\.org|apache\.org|purl\.org|xmlpull\.org|"
    r"ns\.adobe|xml\.gnu|json-schema\.org|github\.com/(?!(?:skylot|flutter)|"
    r"[A-Za-z0-9_-]+/[A-Za-z0-9_.-]*$)|fonts\.googleapis|fonts\.gstatic|"
    r"android\.com|google\.com/(?:android|maven|a/)|"
    r"repo\d|maven\.|jcenter|bintray|jitpack|oss\.sonatype)",
    re.I,
)

SCANNED_EXT = (".dex", ".arsc", ".xml", ".json", ".so", ".txt", ".properties",
               ".cfg", ".ini", ".js", ".html", ".html", ".conf", ".env")


def clean(match):
    """Drop matches that straddle two adjacent pool entries.

    Raw-byte regexes happily span the NUL terminators between separate DEX /
    AXML strings, which invents hosts that never existed. A genuine literal can
    never contain a NUL, so rejecting those matches removes the false positives.
    """
    text = match.decode("utf-8", "replace")
    return None if "\x00" in text else text


def looks_like_artifact(path):
    lowered = path.lower()
    return lowered.endswith(SCANNED_EXT) or lowered in (
        "androidmanifest.xml", "resources.arsc", "packagedmanifest")


def collect(paths, label):
    urls = collections.defaultdict(set)
    hosts = collections.defaultdict(set)
    ips = collections.defaultdict(set)
    scanned = 0
    skipped = 0

    for member, blob in paths:
        if not looks_like_artifact(member):
            skipped += 1
            continue
        if not blob:
            continue
        scanned += 1
        # One pass per artifact: URLs first, then hosts, then IPs.
        for match in URL_RE.findall(blob):
            urls[match.decode("utf-8", "replace")].add(member)
        for match in HOST_RE.findall(blob):
            hosts[match.decode("utf-8", "replace").lower()].add(member)
        for match in IP_RE.findall(blob):
            text = match.decode("ascii", "replace")
            try:
                addr = ipaddress.ip_address(text.split(":")[0])
            except ValueError:
                continue
            if addr.is_private or addr.is_loopback or addr.is_link_local:
                continue
            ips[text].add(member)

    return {"scanned": scanned, "skipped": skipped, "urls": urls,
            "hosts": hosts, "ips": ips}


def interesting(paths):
    """Rank entries by how many distinct artifacts mention them."""
    weight = collections.Counter()
    for _, blob in paths:
        found = set()
        for match in URL_RE.findall(blob):
            found.add(match.decode("utf-8", "replace"))
        for text in found:
            weight[text] += 1
    return weight


def report(apk_path, paths):
    data = collect(paths, apk_path)
    print("=" * 78)
    print(f"APK: {apk_path}")
    print(f"  artifacts scanned: {data['scanned']}   (skipped {data['skipped']})")
    print("=" * 78)

    print(f"\n--- URLS ({len(data['urls'])}) ---")
    for url in sorted(data["urls"]):
        if NOISE.search(url):
            continue
        where = ", ".join(sorted(data["urls"][url])[:3])
        print(f"  {url}\n      [{where}]")

    print(f"\n--- HOSTS ({len(data['hosts'])}) ---")
    ranked = sorted(data["hosts"].items(), key=lambda kv: -len(kv[1]))
    for host, members in ranked:
        if NOISE.search(host):
            continue
        print(f"  {host:<55} ({len(members)} archivos)")

    print(f"\n--- PUBLIC IPs ({len(data['ips'])}) ---")
    for ip in sorted(data["ips"]):
        where = ", ".join(sorted(data["ips"][ip])[:3])
        print(f"  {ip}   [{where}]")


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    for apk_path in argv:
        paths = []
        with zipfile.ZipFile(apk_path) as zf:
            for info in zf.infolist():
                if info.is_dir() or info.file_size > 80 * 1024 * 1024:
                    continue
                paths.append((info.filename, zf.read(info.filename)))
        report(apk_path, paths)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))