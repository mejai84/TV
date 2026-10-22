/**
 * lib/api-guard.js — utilidades compartidas de seguridad para /api.
 *
 * No hay dependencias externas. El rate limit es en memoria y por instancia:
 * Vercel puede tener varias instancias, así que no es una cuota exacta, pero
 * corta el abuso trivial y los bucles de un cliente.
 */

const buckets = new Map();

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Devuelve true si la petición debe rechazarse.
 * @param {object} req
 * @param {string} bucket  nombre del endpoint para que no comparta cupo
 * @param {number} max     peticiones permitidas por ventana
 * @param {number} window  ventana en ms
 */
export function isRateLimited(req, bucket, max, window) {
  const ip = clientIp(req);
  const key = bucket + ':' + ip;
  const now = Date.now();
  let row = buckets.get(key);
  if (!row || now - row.start >= window) {
    row = { start: now, n: 0 };
    buckets.set(key, row);
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now - v.start > window) buckets.delete(k);
    }
  }
  row.n++;
  return row.n > max;
}

/** Aplica el rate limit y responde 429 si se supera. */
export function rateLimit(req, res, bucket, max, window) {
  if (!isRateLimited(req, bucket, max, window)) return true;
  res.setHeader('Retry-After', '60');
  res.status(429).json({ error: 'demasiadas peticiones; espera un minuto' });
  return false;
}

export function commonHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

/**
 * Comprueba el Origin en endpoints que mutan datos. Las peticiones
 * same-origin del navegador pueden no enviar Origin; se permiten.
 * Configura APP_ORIGINS (separados por coma) para previews/dominios extra.
 */
export function originAllowed(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  const raw = String(process.env.APP_ORIGINS ||
    'https://tv-player-tan.vercel.app').split(',');
  const allow = raw.map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (allow.indexOf(origin) !== -1) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** Token opcional de administración para /api/add-title. */
export function adminAllowed(req) {
  const expected = String(process.env.ADMIN_TOKEN || '').trim();
  if (!expected) return true;
  const auth = String(req.headers.authorization || '').trim();
  return auth === 'Bearer ' + expected;
}

/** Valida un TMDB ID numérico (acepta strings de dígitos). */
export function isValidTmdbId(id) {
  return /^\d{1,10}$/.test(String(id || '').trim());
}

/** Lee el cuerpo JSON tanto si Vercel ya lo parseó como si llega string. */
export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body)); } catch (e) { return {}; }
}
