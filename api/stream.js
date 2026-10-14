/**
 * api/stream.js — proxy CORS para transmisiones HLS.
 *
 * Es la version en Vercel Functions del proxy de serve.py. Hace falta
 * porque hls.js carga el manifiesto y los segmentos con XMLHttpRequest, y
 * el navegador los bloquea si el servidor de origen no manda
 * Access-Control-Allow-Origin. VLC y VLC-android no lo exigen por eso alli
 * "abren todos los canales" y aqui no: no es que los canales esten caidos,
 * es que el navegador los rechaza antes de mirar el contenido.
 *
 * Ademas hay que reescribir el manifiesto: si solo se anade la cabecera a la
 * respuesta inicial, los segmentos que vienen dentro apuntan a las URLs
 * originales y vuelven a fallar. Por eso todo lo que el manifiesto
 * referencia pasa tambien por aqui.
 *
 *   GET /api/stream?u=<url codificada>
 */

const CHUNK = 64 * 1024;

/** Atributos URI="..." de las etiquetas HLS. */
const URI_ATTR_RE = /URI="([^"]*)"/g;

/**
 * Bloquea destinos en la red interna. Sin esto la funcion se podria usar
 * para alcanzar servicios del propio proyecto o de la red de Vercel.
 */
function isBlocked(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal' || h.endsWith('.metadata.google.internal')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (h === '::1' || h.startsWith('[::1]')) return true;
  return false;
}

/**
 * Convierte todas las URLs del manifiesto en rutas de este proxy.
 * Cubre los tres formatos de HLS:
 *   - lineas sueltas (segmentos y playlists variantes)
 *   - URI="..." en #EXT-X-MEDIA, #EXT-X-KEY, #EXT-X-MAP
 *   - playlists M3U/IPTV, que son el mismo formato
 */
function rewriteManifest(body, baseUrl, prefix) {
  const base = baseUrl.slice(0, baseUrl.lastIndexOf('/') + 1);
  const toProxy = (raw) => {
    const clean = raw.trim();
    if (!clean) return clean;
    let absolute;
    try {
      absolute = new URL(clean, base).toString();
    } catch (e) {
      return clean;
    }
    return prefix + encodeURIComponent(absolute);
  };

  const out = [];
  for (const line of body.toString('utf8').split('\n')) {
    const stripped = line.trim();
    if (stripped && !stripped.startsWith('#')) {
      out.push(toProxy(line));
      continue;
    }
    if (stripped.startsWith('#')) {
      out.push(line.replace(URI_ATTR_RE, (m, url) => 'URI="' + toProxy(url) + '"'));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
}

export default async function handler(req, res) {
  withCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const target = (req.query.u || '').toString();
  if (!target) {
    res.status(400).send('Falta el parametro u');
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch (e) {
    res.status(400).send('URL invalida');
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(403).send('Solo se permiten http y https');
    return;
  }
  if (isBlocked(parsed.hostname)) {
    res.status(403).send('Destino no permitido');
    return;
  }

  // El prefijo que se inyecta en el manifiesto debe apuntar a esta misma
  // funcion, con el prefijo real del despliegue (/api delante si hay).
  const prefix = (req.headers['x-forwarded-prefix'] || '') + '/api/stream?u=';

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        // Algunos servidores de stream rechazan peticiones sin Referer de
        // navegador, asi que se envia uno neutro.
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        Accept: '*/*',
      },
      redirect: 'follow',
    });
  } catch (e) {
    res.status(502).send('No se pudo contactar con el origen: ' + e.message);
    return;
  }

  const type = upstream.headers.get('content-type') || '';
  const isManifest =
    type.toLowerCase().includes('mpegurl') ||
    type.toLowerCase().includes('m3u') ||
    /\.m3u8?(\?|$)/i.test(parsed.pathname);

  if (isManifest) {
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(rewriteManifest(text, upstream.url || target, prefix));
    return;
  }

  // Segmento binario: se reenvia en bloques para no cargarlo entero en
  // memoria, que un segmento de video no es pequeno.
  res.status(upstream.status);
  res.setHeader('Content-Type', type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'max-age=30');
  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
  } catch (e) {
    // Una conexion cortada a mitad no se puede recuperar aqui; hls.js
    // reintenta el segmento por su cuenta.
  } finally {
    res.end();
  }
}