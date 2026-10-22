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
 *
 * Endurecimiento (auditoria):
 *   - resuelve DNS y bloquea IP privadas/enlace local (no solo el nombre)
 *   - valida cada redireccion, no solo la URL inicial
 *   - limita tamano de manifiestos y segmentos
 *   - rate limit por IP (en memoria, por instancia)
 *   - PROXY_ALLOWED_HOSTS opcional para cerrar del todo el proxy
 */

import { lookup } from 'node:dns/promises';
import net from 'node:net';

const CHUNK = 64 * 1024;
const MAX_MANIFEST = 4 * 1024 * 1024;   // 4 MiB
const MAX_SEGMENT = 40 * 1024 * 1024;   // 40 MiB
const MAX_REDIRECTS = 3;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 240;                    // peticiones por IP y minuto

/** Atributos URI="..." de las etiquetas HLS. */
const URI_ATTR_RE = /URI="([^"]*)"/g;

/** Rate limit simple, por instancia. No sustituye a un WAF, pero corta
 *  el abuso trivial de un proxy abierto. */
const hits = new Map();

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  const row = hits.get(ip);
  if (!row || now - row.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 2000) {
      for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k);
    }
    return false;
  }
  row.n++;
  return row.n > RATE_MAX;
}

/** Hostnames que nunca deben ser alcanzables desde la funcion. */
function isBlockedHost(host) {
  if (!host) return true;
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal' || h.endsWith('.metadata.google.internal')) return true;
  if (h === 'metadata' || h === 'instance-data') return true;
  return false;
}

/** Puertos de servicios de infraestructura que no tienen sentido aquí. */
const BLOCKED_PORTS = new Set([
  '22', '23', '25', '53', '110', '143', '465', '587', '993', '995',
  '2375', '2376', '3306', '5432', '6379', '9200', '9300', '11211', '27017'
]);

function isPrivateIp(address) {
  if (!address) return true;
  if (!net.isIP(address)) return true;
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
    if (p[0] >= 224) return true; // multicast / reservado
    return false;
  }
  const h = address.toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^fe[89ab]/.test(h)) return true;       // link-local fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local
  if (h.startsWith('::ffff:')) return isPrivateIp(h.slice(7));
  return false;
}

function allowedHosts() {
  const raw = String(process.env.PROXY_ALLOWED_HOSTS || '').trim();
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { throw new Error('URL invalida'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Solo se permiten http y https');
  }
  if (u.username || u.password) throw new Error('No se permiten credenciales en la URL');
  if (isBlockedHost(u.hostname)) throw new Error('Destino no permitido');
  if (u.port && BLOCKED_PORTS.has(u.port)) throw new Error('Puerto no permitido');

  const allow = allowedHosts();
  if (allow) {
    const h = u.hostname.toLowerCase();
    const ok = allow.some((a) => h === a || h.endsWith('.' + a));
    if (!ok) throw new Error('Host fuera de PROXY_ALLOWED_HOSTS');
  }

  // Resolver DNS y comprobar TODAS las respuestas. Bloquear solo por el
  // nombre dejaba pasar dominios que apuntan a 127.0.0.1 o a la metadata
  // del proveedor cloud (SSRF).
  let rows;
  try {
    rows = await lookup(u.hostname, { all: true, verbatim: true });
  } catch (e) {
    throw new Error('No se pudo resolver el destino');
  }
  if (!rows || !rows.length) throw new Error('Destino sin DNS');
  for (const row of rows) {
    if (isPrivateIp(row.address)) throw new Error('Destino privado no permitido');
  }
  return u;
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function fetchFollowingSafeRedirects(target, req) {
  let current = target;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const safe = await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let upstream;
    try {
      upstream = await fetch(safe.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
          Accept: '*/*',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get('location');
      if (!loc) return { upstream, finalUrl: safe.toString() };
      if (i === MAX_REDIRECTS) throw new Error('Demasiadas redirecciones');
      current = new URL(loc, safe).toString();
      continue;
    }
    return { upstream, finalUrl: safe.toString() };
  }
  throw new Error('Demasiadas redirecciones');
}

async function readLimited(resp, max) {
  if (!resp.body) return '';
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) throw new Error('Respuesta demasiado grande');
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { await reader.cancel(); } catch (e) {}
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  withCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Metodo no permitido');
    return;
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    res.setHeader('Retry-After', '60');
    res.status(429).send('Demasiadas peticiones al proxy. Espera un minuto.');
    return;
  }

  const target = (req.query.u || '').toString();
  if (!target) {
    res.status(400).send('Falta el parametro u');
    return;
  }
  if (target.length > 4096) {
    res.status(414).send('URL demasiado larga');
    return;
  }

  // El prefijo que se inyecta en el manifiesto debe apuntar a esta misma
  // funcion, con el prefijo real del despliegue (/api delante si hay).
  const prefix = (req.headers['x-forwarded-prefix'] || '') + '/api/stream?u=';

  let upstream;
  let finalUrl;
  try {
    const result = await fetchFollowingSafeRedirects(target, req);
    upstream = result.upstream;
    finalUrl = result.finalUrl;
  } catch (e) {
    res.status(403).send(e.message || 'Destino no permitido');
    return;
  }

  const type = upstream.headers.get('content-type') || '';
  const isManifest =
    type.toLowerCase().includes('mpegurl') ||
    type.toLowerCase().includes('m3u') ||
    /\.m3u8?(\?|$)/i.test(new URL(finalUrl).pathname);

  if (isManifest) {
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared && declared > MAX_MANIFEST) {
      res.status(413).send('Manifiesto demasiado grande');
      return;
    }
    let body;
    try {
      body = await readLimited(upstream, MAX_MANIFEST);
    } catch (e) {
      res.status(413).send('Manifiesto demasiado grande');
      return;
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(rewriteManifest(body, finalUrl, prefix));
    return;
  }

  // Segmento binario: se reenvia en bloques para no cargarlo entero en
  // memoria, que un segmento de video no es pequeno.
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared && declared > MAX_SEGMENT) {
    res.status(413).send('Segmento demasiado grande');
    return;
  }
  res.status(upstream.status);
  res.setHeader('Content-Type', type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'max-age=30');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD' || !upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_SEGMENT) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
  } catch (e) {
    // Una conexion cortada a mitad no se puede recuperar aqui; hls.js
    // reintenta el segmento por su cuenta.
  } finally {
    try { await reader.cancel(); } catch (e) {}
    res.end();
  }
}
