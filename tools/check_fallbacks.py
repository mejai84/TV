import io, re
lines = io.open("css/app.css", encoding="utf-8").read().split("\n")
root = dict(re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);",
                      re.search(r":root\s*\{(.*?)\}", "\n".join(lines), re.S).group(1)))
bad = []
for i, l in enumerate(lines):
    if "var(--" not in l:
        continue
    prev = ""
    for j in range(i - 1, -1, -1):
        if lines[j].strip():
            prev = lines[j].strip()
            break
    if not prev:
        continue
    m = re.match(r"^([a-z-]+)\s*:", l.strip())
    p = re.match(r"^([a-z-]+)\s*:", prev)
    if not m or not p or m.group(1) != p.group(1):
        bad.append("%d: %s  <- previa: %s" % (i + 1, l.strip(), prev[:60]))
print("declaraciones var() sin respaldo literal:", len(bad))
for b in bad:
    print("  ", b)
