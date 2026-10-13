# Cliente web para TV

Cliente HTML5 para reproducir TV en el navegador de un televisor
(Hisense VIDAA, LG webOS, Samsung Tizen, Fire TV). Sin build, sin framework:
se abre `index.html` y funciona.

## Arrancar

Hace falta el proxy, no basta con abrir el HTML:

```bash
cd C:\Xupper
py -3 serve.py --port 8777
```

```
aqui    : http://127.0.0.1:8777/index.html
tele    : http://IP-DE-TU-PC:8777/index.html
```

Si la tele no conecta, abre el puerto 8777 en el cortafuegos de Windows.

## Por qué el proxy es obligatorio

`hls.js` necesita `Access-Control-Allow-Origin` en el manifiesto **y en cada
segmento**. Casi ningún servidor de televisión lo envía, así que el navegador
bloquea la petición antes de mirar el contenido. El reproductor no puede hacer
nada: la respuesta es una pantalla negra.

Por eso las apps nativas usan ExoPlayer o ijkplayer — a ellos no les aplica la
política de origen cruzado.

`serve.py` resuelve esto:
1. Sirve los estáticos de `web-tv/`
2. `/proxy/stream?u=<url>` descarga el manifiesto remoto, **reescribe** todas
   las URLs internas para que vuelvan a pasar por el proxy, y añade CORS

Cubre los tres casos de HLS: líneas sueltas (segmentos y variantes),
atributos `URI="..."` en `#EXT-X-MEDIA` / `#EXT-X-KEY` / `#EXT-X-MAP`, y
playlists M3U/IPTV.

Los segmentos binarios se retransmiten en bloques de 64 KB sin cargar el
fichero entero en memoria.

Bloquea destinos privados (evita que el puerto se use para alcanzar la red
interna). Con `--allow-private` se desactiva, para cuando el contenido legítimo
esté en tu LAN.

## Estructura

```
C:\Xupper\
  serve.py            proxy con CORS  <-- obligatorio
  web-tv\
    index.html
    css/app.css
    js/config.js      CONFIG + adaptadores   <- edita aquí
    js/player.js      failover, calidad, URLs firmadas
    js/epg.js         guía de programación
    js/app.js         interfaz, filtros, mando
    vendor/hls.min.js
    streams.json      fuente de demo
```

## Fuentes de contenido

Todo pasa por `CONFIG.source` en `js/config.js`:

| Valor | Qué hace |
|---|---|
| `'demo'` | `streams.json` — streams públicos de prueba |
| `'json'` | Tu propio `streams.json` |
| `'m3u'` | Lista M3U / Xtream. Por defecto: iptv-org |
| `'provider'` | API con token (ver abajo) |

### M3U

Por defecto usa [`iptv-org`](https://github.com/iptv-org/iptv), una colección
abierta de cadenas en abierto (TDT y otras públicas). Listas por país:

```
https://iptv-org.github.io/iptv/countries/es.m3u
https://iptv-org.github.io/iptv/countries/mx.m3u
```

Para la tuya, en `buildAdapter()`:

```js
return new M3UAdapter({ url: 'http://tu-servidor/lista.m3u8' });
```

Las URLs pasan por el proxy automáticamente. No hace falta hacer nada más.

Muchos canales de estas listas están **bloqueados geográficamente** y no
reproducen fuera de su país; la propia lista lo indica con `[Geo-blocked]`.
Con 325 entradasae SCC siempre funciona alguno.

### `streams.json` a mano

```json
[
  {
    "id": "canal1",
    "title": "Nombre del canal",
    "kind": "live",
    "group": "Deportes",
    "url": [
      "https://cdn.example.com/primario.m3u8",
      "https://backup.example.com/respaldo.m3u8"
    ]
  }
]
```

**El orden de `url` importa.** El primero es el principal; si falla, el
reproductor pasa al siguiente sin que intervenga el usuario.

Si las URLs son relativas (`/proxy/stream?...`) déjalas tal cual: el proxy ya
las reescribió.

### URLs firmadas

Si caducan, pon la expiración en epoch ms y el reproductor pedirá una nueva
45 segundos antes:

```json
{ "id": "x", "url": ["https://.../a.m3u8?token=..."], "expiresAt": 1767225600000 }
```

### API con token

`ProviderAdapter` ya está escrito: el esquema de petición que se observó en la
app nativa era JSON plano sobre POST, con `portalCode` + `userToken`. Rellena
`base`, `portalCode` y `userToken` en `buildAdapter()`.

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

## Compatibilidad con televisores

- **hls.js va en local** (`vendor/`). No se depende de un CDN: en TVs con
  conexión restringida, eso es causa habitual de "no reproduce nada".
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
| Flechas | Mover foco por la rejilla |
| OK / Enter | Reproducir · Pausar |
| BACK / Esc | Volver al catálogo |
| Arrastra | Los controles nativos del vídeo |

## Estado

**Funciona y está probado:**
- Failover principal/respaldo (probado con URL rota)
- Selector de calidad (6 niveles detectados en streams multi-bitrate)
- URLs firmadas con renovación automática
- Navegación con D-pad
- Filtro por grupo y búsqueda
- Proxy CORS con reescritura de manifiestos HLS
- Reproducción real de canales en abierto vía M3U

**Pendiente:**
- **EPG**: `js/epg.js` está escrito (rejilla temporal, navegación, formato
  normalizado) pero **no está conectado a la pantalla**. Falta el HTML, los
  estilos y el enganche en `app.js`.
- Favoritos y cuenta locales con `localStorage`
- SID/HLS con cookies: algunos servidores requieren sesión; `withCredentials`
  no está expuesto en la interfaz actual
- DRM: no implementado. Widevine/PlayReady necesita EME, que muchos
  navegadores de TV no traen