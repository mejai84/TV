# Cliente web de TV

Cliente HTML5 para ver televisión en el navegador de un televisor
(Hisense VIDAA, LG webOS, Samsung Tizen, Fire TV). Sin build, sin framework:
se abre `index.html` y funciona.

```
py -3 serve.py --port 8777
```

```
aqui    : http://127.0.0.1:8777/index.html
tele    : http://IP-DE-TU-PC:8777/index.html
```

Si la tele no conecta, abre el puerto 8777 en el cortafuegos de Windows.

---

## El proxy no es opcional

`hls.js` necesita `Access-Control-Allow-Origin` en el manifiesto **y en cada
segmento**. Casi ningún servidor de televisión lo envía, así que el navegador
bloquea la petición antes de mirar el contenido. El reproductor no puede hacer
nada: la respuesta es una pantalla negra.

Por eso las apps nativas usan ExoPlayer o ijkplayer — a ellos no les aplica la
política de origen cruzado.

`serve.py` resuelve esto: sirve los estáticos y expone
`/proxy/stream?u=<url>`, que descarga el manifiesto remoto, **reescribe** todas
las URLs internas para que vuelvan a pasar por el proxy, y añade CORS. Cubre
líneas sueltas (segmentos y variantes), atributos `URI="..."` en
`#EXT-X-MEDIA` / `#EXT-X-KEY` / `#EXT-X-MAP`, y playlists M3U/IPTV.

Los segmentos binarios se retransmiten en bloques de 64 KB sin cargar el
fichero entero en memoria.

Bloquea destinos privados. Con `--allow-private` se desactiva, para cuando el
contenido legítimo esté en tu LAN.

---

## Fuentes de contenido

Todo pasa por `CONFIG.source` en `js/config.js`:

| Valor | Qué hace |
|---|---|
| `'demo'` | `streams.json` — tres entradas de prueba, funciona sin red |
| `'json'` | Tu propio `streams.json` |
| `'m3u'` | Lista M3U / Xtream. Por defecto: [iptv-org](https://github.com/iptv-org/iptv) |
| `'provider'` | API con token (ver más abajo) |

Las URLs de una M3U pasan por el proxy automáticamente. No hay que hacer nada
más.

Muchos canales de las listas abiertas están **bloqueados geográficamente** y no
reproducen fuera de su país; la propia lista lo marca con `[Geo-blocked]`.

### URLs firmadas

Si caducan, pon la expiración en epoch ms y el reproductor pide una nueva 45
segundos antes:

```json
{ "id": "x", "url": ["https://.../a.m3u8?token=..."], "expiresAt": 1767225600000 }
```

El orden de `url` importa: el primero es el principal y, si falla, el
reproductor pasa al siguiente sin intervención.

### API con token

`ProviderAdapter` ya está escrito: el esquema observado en el cliente nativo era
JSON plano sobre POST, con `portalCode` + `userToken`. Rellena `base`,
`portalCode` y `userToken` en `buildAdapter()`.

---

## Adaptador propio

```js
{
  list:    function () { return Promise<Item[]> },
  resolve: function (item) { return Promise<Stream[]> },
  epg:     function () { return Promise<EpgProgram[]> },
}
```

```js
Item    = { id, title, kind, poster, year, description, group }
Stream  = { url, quality, headers, expiresAt }
EpgProg = { id, channelId, title, start, end, type, desc }
```

`resolve` debe devolver **varios** candidatos en orden de preferencia.

---

## Guía de programación (EPG)

`js/epg.js` implementa la rejilla de tiempo clásica: canales en vertical, horas
en horizontal, con marcador del instante actual y navegación por columnas.

Fuente en `CONFIG.epg.url`, dos formatos:

- **XMLTV** (`.xml`) — se parsea con `DOMParser`
- **JSON** (`.json`) — array de programas

Sin configurar, la guía sale vacía. Para generarla con datos de prueba:

```bash
# desde web-tv/
python -c "import json;json.dump([{'id':str(i),'channelId':'CANAL','title':'Programa '+str(i),'type':'news','start':0,'end':1} for i in range(10)],open('epg.json','w'))"
```

Los programas se **asocian** al catálogo por `tvg-id` exacto y, si no coincide,
por nombre normalizado (sin acentos, sin etiquetas de calidad ni de geobloqueo).

---

## Compatibilidad con televisores

- **hls.js va en local** (`vendor/`), no desde un CDN: en TVs con conexión
  restringida, depender de un CDN es causa habitual de "no reproduce nada".
- **ES5 + Promise.** Sin `let`/`const`, sin template literals, sin funciones
  flecha, sin CSS Grid. Necesario para navegadores de 2015-2018.
- **Los scripts llevan `?v=N`.** El caché de un TV sobrevive varias sesiones;
  sin versionado se sirve código viejo.
- **hls.js tiene prioridad sobre el HLS nativo** aunque el navegador diga que lo
  soporta: `canPlayType` devuelve `"maybe"` en navegadores que luego fallan, y
  el camino nativo deja sin selector de calidad.
- **Autoplay bloqueado** es normal: el primer OK actúa como play.
- **Códigos de mando** cubiertos: Android TV (`461` = back) y webOS
  (`10009` = back).

## Controles

| Tecla | Acción |
|---|---|
| Flechas | Lateral ↔ estanterías ↔ fichas |
| OK / Enter | Reproducir · Pausar |
| BACK / Esc | Volver |
| Arrastra | Los controles nativos del vídeo |

---

## Análisis estático

`INFORME-ANALISIS.md` documenta el análisis de una muestra APK: arquitectura,
13 SDK de terceros, 12 módulos funcionales, cadena de resolución de servidores,
protocolo de red reconstruido y modelo de datos.

`IOC-ANALISIS.md` documenta el enriquecimiento pasivo de un conjunto de
indicadores.

Las herramientas están en `tools/` y no dependen de nada externo:

```
py -3 tools/enrich_ioc.py "dominio:puerto" "ip:puerto UDP"
py -3 tools/audit_lists.py 10
py -3 tools/har_verify.py captura.har
py -3 tools/scan_apk.py muestra.apk
```

Todas consultan fuentes públicas de registro y **no contactan con los hosts
analizados**.

---

## Licencia

MIT. Las listas de canales de terceros y el contenido que reproducen no son
parte de este proyecto: es responsabilidad de quien configura la fuente.