import re, io

src = io.open("css/app.css", encoding="utf-8").read()

# Resolucion de las variables del :root a su valor literal.
root = re.search(r":root\s*\{(.*?)\}", src, re.S).group(1)
vals = dict(re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", root))

VAR = re.compile(r"var\(\s*(--[a-z0-9-]+)\s*\)")

def fallback(decl):
    """Si la declaracion usa var(), devuelve la misma declaracion con el
    valor ya resuelto, para ponerla ANTES como respaldo."""
    names = VAR.findall(decl)
    if not names:
        return None
    lit = decl
    for n in names:
        if n not in vals:
            return None
        lit = lit.replace("var(%s)" % n, vals[n].strip())
    return lit

out, pending = [], []
for line in src.split("\n"):
    stripped = line.strip()
    if pending and stripped.startswith("--"):
        pending.pop()
        continue                      # las variables del :root ya van fijas
    m = re.match(r"^(\s*)([a-z-]+)\s*:\s*(.+?);\s*$", line)
    if m and "var(" in m.group(3):
        lit = fallback("%s: %s" % (m.group(2), m.group(3)))
        if lit:
            out.append(m.group(1) + lit + "  /* respaldo sin var() */")
    out.append(line)

io.open("css/app.css", "w", encoding="utf-8", newline="\n").write("\n".join(out))
print("fallbacks anadidos:", sum(1 for l in out if "respaldo sin var()" in l))
