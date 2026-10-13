# Informe de enriquecimiento de indicadores (IOC)

**Fecha de análisis:** 13 de octubre de 2026
**Método:** pasivo (WHOIS/RDAP, DNS, PTR). **No se contactó con ningún host.**
**Herramienta:** `tools/enrich_ioc.py`

> Consultar un dominio malicioso con un GET desde tu IP genera tráfico hacia
> quien lo opera y puede incluir tu dirección en listas de reputación. Todo lo
> que sigue procede de bases de registro, que no alertan al objetivo.

---

## 1. Indicadores analizados

```
yuwc.swzablvpm.com:80
ebgpbvi.cdun5kmepb.com:443
149.34.250.105:26070        TCP
186.81.124.13:35669         UDP
186.85.240.28:4280          UDP
```

---

## 2. Resultados

| Indicador | Registrado | Resuelve a | Nameservers / Hosting |
|---|---|---|---|
| `swzablvpm.com` | **2025-11-26** · Dynadot | `yuwc.` → 66.225.197.106 | `UMA/WEST.NS.CLOUDFLARE.COM` |
| `cdun5kmepb.com` | **2024-11-13** · NameCheap | `ebgpbvi.` → 104.18.50.2, 104.18.55.61, 2×IPv6 | `CELINE/CHRIS.NS.CLOUDFLARE.COM` |
| `149.34.250.105:26070` | bloque 2022-04-21 | PTR `unn-149-34-250-105.datapacket.com` | Vultr / Datapacket · `CDNEXT-MIA-CG` |
| `186.81.124.13:35669` | bloque 2008-10-28 | PTR `static-ip-1868112413.cable.net.co` | Colombia · ISP residencial |
| `186.85.240.28:4280` | bloque 2009-05-19 | PTR `static-ip-1868524028.cable.net.co` | Colombia · ISP residencial |

Ambos dominios presentan `client transfer prohibited` y expiran en noviembre de
2026.

---

## 3. Evaluación de la entropía

Shannon sobre la etiqueta registrada (no sobre el subdominio):

```
swzablvpm     3.17
cdun5kmepb    3.32
pornboxhub    2.92      ← marca real y legible
hpplay        2.25      ← marca real
yuwc          2.00      ← subdominio, no la parte generada
```

**Interpretación correcta:** los valores están por encima de una palabra real
pero **no alcanzan el rango de un DGA genuino** (habitualmente 3.5–4.0). Lo que
describe el conjunto encaja igual de bien con dos hipótesis:

1. **Nombres elegidos al azar para impersonación** — el operador del malware
   escoge una cadena aleatoria para el dominio y un subdominio corto y
   memorable (`yuwc`, `ebgpbvi`).
2. **Generador determinista de baja entropía** — un DGA que usa un alfabeto
   reducido o una plantilla fija.

**Distinguirlas exige histórico de consultas (Passive DNS)**, no la entropía de
una muestra aislada.

> Corrección: una primera versión de este análisisWTO los dominios por DGA. La
> medición no lo sostiene y se ha corregido.

---

## 4. Hallazgos

### 4.1 Los dos UDP son equipos de consumo, no servidores

`cable.net.co` es un **ISP residencial colombiano**. Los PTR tienen el formato
`static-ip-<numeros>.cable.net.co`, característico de asignaciones dinámicas de
clientes, no de un datacenter.

Puertos UDP altos (`35669`, `4280`) sobre equipos domésticos es el patrón
clásico de **botnet de routers comprometidos**, donde el dispositivo infectado
actúa como nodo P2P o como beacon de C2.

Es el indicio más fuerte del conjunto y el único que apunta a un_vector de
ataque concreto.

### 4.2 Ambos dominios se ocultan tras Cloudflare

- Los nameservers de los dos dominios son de Cloudflare.
- `cdun5kmepb.com` resuelve **directamente a rangos de Cloudflare**
  (104.18.0.0/16) y a dos direcciones IPv6 del mismo proveedor.

Uso deliberado de infraestructura legítima como capa de ocultación: dificulta
el bloqueo por IP, aporta tolerancia de DDoS y evita que el visitante asocie el
tráfico a un servidor propio.

### 4.3 Registradores y edades divergentes

| Dominio | Registrador | Fecha |
|---|---|---|
| `cdun5kmepb.com` | NameCheap | 2024-11-13 |
| `swzablvpm.com` | Dynadot | 2025-11-26 |

Más de un año de diferencia y dos registradores distintos. Sugiere **dos
campañas o dos operadores**, no una campaña única con dominios rotados.

### 4.4 Correlación no confirmada: Miami

El titular de `149.34.250.105` es `CDNEXT-MIA-CG` (**Miami**). En una captura
HAR paralela del mismo conjunto de investigación, el nodo de borde de
Cloudflare observado fue igualmente **MIA**.

**No debe tratarse como hallazgo.** Dos proveedores independientes pueden
operar en la misma ciudad sin relación alguna. Anotado para que se verifique,
no para que se cite como conclusión.

---

## 5. Lo que NO puede determinarse con análisis pasivo

| Pregunta | Por qué no se responde |
|---|---|
| ¿Son los puertos UDP C2? | Un UDP alto abierto es compatible con C2, P2P, VoIP, juegos o VPN. Solo una captura lo distingue. |
| ¿Son DGA los dominios? | Requiere histórico de consultas: fechas de primera resolución y secuencia de dominios generados. |
| ¿Hay relación con otros indicadores? | Requiere correlación de Passive DNS, no consultas aisladas. |
| ¿Están activos hoy? | Se observó resolución DNS. La actividad real exige conexión, que no se realizó deliberadamente. |

---

## 6. Pruebas recomendadas (todas pasivas)

1. **Passive DNS** — SecurityTrails, VirusTotal: primera y última resolución de
   cada dominio, y dominios vecinos del mismo registro.
2. **Certificate Transparency** — `crt.sh` con `%25.<dominio>`: revela
   subdominios adicionales bajo el mismo control, incluidos los internos si el
   certificado se emitió sin validación adecuada.
3. **Reputación** — consultas a VT / AbuseIPDB para cada IP, que suelen
   agregar contexto histórico.
4. **Captura de tráfico** — la única vía para confirmar el papel de los UDP.
   Un PCAP de la red donde se observaron los indicadores.

---

## 7. Herramienta

```
py -3 tools/enrich_ioc.py "dominio:puerto" "ip:puerto UDP"
```

Salida: resolución DNS, PTR,|RDAP del dominio y del bloque IP, entropía de la
etiqueta registrada y aviso sobre puertos UDP.

### Fallos corregidos durante el desarrollo

| Fallo | Causa | Corrección |
|---|---|---|
| RDAP devolvía "no disponible" | Se consultaba el subdominio; RDAP solo admite el dominio registrable | Función `registrable()` que reduce a las dos últimas etiquetas |
| Entropía medida sobre la etiqueta izquierda | Para `ebgpbvi.cdun5kmepb.com` se medía `ebgpbvi` | Se mide `cdun5kmepb` |
| Parseo de `country` en vCard `adr` | Se asumía una posición fija en la lista | Búsqueda por clave `country` |
| RDAP sin plan B | El endpoint directo puede no estar publicado para un TLD | Bootstrap `rdap.org` |

**Limitación conocida:** `registrable()` es aproximada. Es válida para TLD de
una sola etiqueta; para sufijos públicos compuestos (`.co.uk`, `.com.ar`)
haría falta una Public Suffix List.