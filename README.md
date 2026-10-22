# Cliente web de TV

Cliente HTML5 para ver televisión en el navegador de un televisor
(Hisense VIDAA, LG webOS, Samsung Tizen, Fire TV). Sin build, sin framework:
se abre `index.html` y funciona.

> **Qué hay en este repositorio.** Solo la aplicación web, que es lo que se
> despliega: `index.html`, `css/`, `js/`, `api/` y `serve.py`. El análisis
> de ingeniería inversa de APKs que se hizo por separado vive en
> `analisis/` y **no forma parte de la aplicación**: no se despliega, no se
> importa desde el código y no es necesario para que la tele funcione.
> Si solo quieres la app, `analisis/` se puede borrar entero.

```
py -3 serve.py --port 8777
```

```
aqui    : http://127.0.0.1:8777/index.html
tele    : http://IP-DE-TU-PC:8777/index.html
```

Si la tele no conecta, abre el puerto 8777 en el cortafuegos de Windows.

---

## Proxy de streaming

`hls.js` necesita `Access-Control-Allow-Origin` en el manifiesto **y en cada
segmento**. Casi ningún servidor de televisión lo envía, así que el navegador
bloquea la petición antes de mirar el contenido. El reproductor no puede hacer
nada: la respuesta es una pantalla negra.

Por eso las apps nativas usan ExoPlayer o ijkplayer — a ellos no les aplica la
política de origen cruzado.

El proxy resuelve esto: `serve.py` expone `/proxy/stream?u=<url>` y la versión de
Vercel `api/stream.js` expone `/api/stream?u=<url>`. El proxy descarga el
manifiesto remoto, **reescribe** todas las URLs internas para que vuelvan a pasar
por él y añade CORS. Cubre líneas sueltas (segmentos y variantes), atributos
`URI="..."` en `#EXT-X-MEDIA` / `#EXT-X-KEY` / `#EXT-X-MAP`, y playlists
M3U/IPTV.

**Está apagado por defecto**, porque retransmitir los segmentos consume datos y
cuota. Hay dos formas de encenderlo:

- **Botón “Proxy”** de la barra superior: lo activa o desactiva y recuerda la
  elección en `localStorage` de ese navegador. Si hay un canal en marcha, se
  reconecta solo.
- **`?proxy=on`** en la URL: lo fuerza mientras esa URL esté abierta.

Los embeds de películas y series no usan el proxy.

Bloquea destinos privados. Con `--allow-private` se desactiva, para cuando el
contenido legítimo esté en tu LAN.

---

## Fuentes de contenido

Todo pasa por `CONFIG.source` en `js/config.js`:

| Valor | Qué hace |
|---|---|
| `'iptvorg'` | [iptv-org](https://github.com/iptv-org/iptv). Es la que se usa por defecto |
| `'provider'` | API con token (ver más abajo) |

Sin parámetros la app carga el índice completo de iptv-org (11 262 canales).
Para acotarlo, `?cc=es`, `?cc=mx`, `?cc=movies`… También se cambia desde el
lateral, en la sección **Listas**.

Las URLs de una M3U se reproducen directas por defecto. Si un canal no carga
por CORS, pulsa el botón **Proxy** de la barra (o abre la app con `?proxy=on`).

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

## Contenido bajo demanda (películas y series)

Además de la TV en vivo, la app puede servir VOD desde NasriPlay
(`?src=embeds`, accesos **Películas / Series / Novedades** de la banda superior).
NasriPlay **no aloja vídeo**: indexa proveedores públicos al momento.

Flujo:

```
api/catalog.js   → Películas desde /content/resolved; Series desde /content/catalog
api/novelties.js → títulos recientes (índice de resolución)
api/scan.js      → cron diario que rellena la BD
api/nsrplay.js   → proxy de la API avanzada (sources → resolve → playUrl)
```

La API key de NasriPlay vive en `NSRPLAY_API_KEY` (server-side).

### Base de datos (Supabase) y novedades

La BD es **opcional**. Sin ella, todo funciona con NasriPlay en caliente y
`localStorage`. Con ella:

- `api/catalog` sirve primero desde la tabla `titles` (rápido, sin gastar cuota).
- `api/scan` corre una vez al día (`crons` en `vercel.json`), consulta
  `/content/resolved` (películas y series) y hace *upsert* de metadatos.
- `api/novelties` devuelve lo detectado en los últimos días.
- La sección **Novedades** marca en dorado lo aún no visto (ventana de 14 días).

Solo se guardan **metadatos** (id, título, año, póster, rating, géneros,
fechas). Nunca enlaces: los `playUrl` son de un solo uso y caducan a los 5 min.

Puesta en marcha:

1. Crea un proyecto en <https://supabase.com>.
2. En el **SQL Editor** ejecuta `supabase/schema.sql`.
   Si ya tenías una tabla antigua creada con la clave primaria solo por `id`,
   ejecuta también `supabase/migration-001-composite-pk.sql` (la clave pasa a
   ser `(id, kind)`, porque TMDB usa espacios de ID distintos para películas
   y series).
3. Copia `Project Settings → API`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (solo servidor)
4. Añade ambas como variables de entorno en Vercel (Production).
5. Añade también `CRON_SECRET` (una cadena larga aleatoria): el escáner queda
   cerrado sin ella; Vercel la envía automáticamente en el header
   `Authorization` de los cron jobs.
6. Redespliega. `api/scan` se ejecutará solo cada día; para probar:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<tu-dominio>/api/scan`

### Variables opcionales

- `PROXY_ALLOWED_HOSTS` (lista separada por comas): si se define, `/api/stream`
  solo retransmite hosts que terminen en uno de esos sufijos.
- `ADMIN_TOKEN`: si se define, añadir un título por TMDB exige
  `Authorization: Bearer <token>`; el cliente lo envía si guardas el token en
  `localStorage.xupper_admin_token`.
- `APP_ORIGINS`: orígenes adicionales permitidos en los endpoints que mutan
  datos (previews de Vercel, por ejemplo).

No hace falta `package.json`: el cliente de la BD usa solo `fetch` (PostgREST).

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