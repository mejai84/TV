/**
 * api/nsrplay.js — proxy para la API avanzada de NasriPlay.
 *
 * Modo 2 pasos (sin anuncios, playUrl directo):
 *   1) sources:  GET /api/nsrplay?action=sources&type=movie&id=550
 *      → devuelve la lista de servidores (cada uno con un token de un solo uso)
 *   2) resolve:  GET /api/nsrplay?action=resolve&token=TOKEN
 *      → devuelve { playUrl, directUrl }  (usar siempre playUrl)
 *
 * La API key vive en la env var NSRPLAY_API_KEY (server-side).
 */

const NSRPLAY_BASE = 'https://nsrplay.space/api/v1';

import { commonHeaders, rateLimit } from '../lib/api-guard.js';

/**
 * Algunos campos de NasriPlay llegan con el UTF-8 interpretado como Latin-1
 * ("niÃ±a" en vez de "niña"). Se re-codifica solo cuando el resultado es
 * UTF-8 válido, para no romper textos que ya venían bien.
 */
function fixEncoding(value) {
  if (typeof value !== 'string') return value;
  if (!/[\u00C2\u00C3]/.test(value)) return value;
  try {
    var bytes = Buffer.from(value, 'latin1');
    var fixed = bytes.toString('utf8');
    if (fixed.indexOf('\uFFFD') === -1) return fixed;
  } catch (e) { /* se deja como vino */ }
  return value;
}

function validHttpUrl(value) {
  try {
    var u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

function cleanMetadata(value) {
  if (typeof value === 'string') return fixEncoding(value);
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) value[i] = cleanMetadata(value[i]);
    return value;
  }
  if (value && typeof value === 'object') {
    for (var k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) value[k] = cleanMetadata(value[k]);
    }
    return value;
  }
  return value;
}

export default async function handler(req, res) {
  commonHeaders(res);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'metodo no permitido' });
    return;
  }
  // La API key de NasriPlay vive en el servidor: sin límite, un tercero
  // podría consumir la cuota haciendo peticiones al proxy.
  if (!rateLimit(req, res, 'nsrplay', 120, 60 * 1000)) return;

  var action = String(req.query.action || '').toLowerCase();
  var key = process.env.NSRPLAY_API_KEY || '';

  if (action === 'sources') {
    var type = String(req.query.type || 'movie').toLowerCase();
    var id = String(req.query.id || '').trim();
    var season = String(req.query.season || '').trim();
    var episode = String(req.query.episode || '').trim();
    if (!id || id.length > 200) { res.status(400).json({ error: 'id invalido' }); return; }

    var t = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
    var path;
    if (t === 'tv' && season && episode) {
      path = '/embed/sources/tv/' + encodeURIComponent(id) + '/' + encodeURIComponent(season) + '/' + encodeURIComponent(episode);
    } else if (t === 'tv') {
      // Sin season/episode no se puede; pedimos temporada 1 episodio 1 por defecto
      path = '/embed/sources/tv/' + encodeURIComponent(id) + '/1/1';
    } else {
      path = '/embed/sources/movie/' + encodeURIComponent(id);
    }

    var fast = req.query.fast === 'true' ? '?fast=true' : '';
    var url = NSRPLAY_BASE + path + fast;

    try {
      var r = await fetch(url, { headers: key ? { 'X-API-Key': key } : {}, signal: AbortSignal.timeout(15000) });
      var data = await r.json();
      res.status(r.status).json(data);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  if (action === 'resolve') {
    var token = String(req.query.token || '').trim();
    if (!token || token.length > 2048) { res.status(400).json({ error: 'token invalido' }); return; }

    var parentUrl = String(req.query.parentUrl || '').trim();
    if (parentUrl && (parentUrl.length > 2048 || !validHttpUrl(parentUrl))) {
      res.status(400).json({ error: 'parentUrl invalida' });
      return;
    }
    var url = NSRPLAY_BASE + '/embed/resolve?token=' + encodeURIComponent(token);
    if (parentUrl) url += '&parentUrl=' + encodeURIComponent(parentUrl);

    try {
      var r = await fetch(url, { headers: key ? { 'X-API-Key': key } : {}, signal: AbortSignal.timeout(15000) });
      var data = await r.json();
      res.status(r.status).json(data);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  /* ---- Flujo por slug (catálogo propio de NasriPlay) ----------------
   * Películas y series identificadas por slug en vez de TMDB ID.
   */

  if (action === 'info') {
    var slug = String(req.query.slug || '').trim();
    var itype = String(req.query.type || 'series').toLowerCase();
    if (!slug || slug.length > 200) { res.status(400).json({ error: 'slug invalido' }); return; }

    var infoUrl = NSRPLAY_BASE + '/content/info/' + encodeURIComponent(slug) +
                  '?type=' + encodeURIComponent(itype === 'movie' ? 'movie' : 'series');
    try {
      var ri = await fetch(infoUrl, { headers: key ? { 'X-API-Key': key } : {}, signal: AbortSignal.timeout(15000) });
      var di = await ri.json();
      // Sinopsis, reparto y títulos llegan a veces con el UTF-8 mal decodificado.
      if (di && di.data) {
        cleanMetadata(di.data);
        if (typeof di.data.originalTitle === 'string') {
          di.data.originalTitle = di.data.originalTitle
            .replace(/^[\s@]+/, '')
            .replace(/\s+/g, ' ')
            .trim();
        }
      }
      res.status(ri.status).json(di);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  if (action === 'servers') {
    var sslug = String(req.query.slug || '').trim();
    if (!sslug || sslug.length > 200) { res.status(400).json({ error: 'slug invalido' }); return; }
    var sseason = String(req.query.season || '1').trim();
    var sepisode = String(req.query.episode || '1').trim();

    var srvUrl = NSRPLAY_BASE + '/content/servers?slug=' + encodeURIComponent(sslug) +
                 '&season=' + encodeURIComponent(sseason) +
                 '&episode=' + encodeURIComponent(sepisode);
    try {
      var rs = await fetch(srvUrl, { headers: key ? { 'X-API-Key': key } : {}, signal: AbortSignal.timeout(15000) });
      var ds = await rs.json();
      res.status(rs.status).json(ds);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  if (action === 'resolve-url') {
    var embedUrl = String(req.query.url || '').trim();
    if (!embedUrl || embedUrl.length > 2048 || !validHttpUrl(embedUrl)) {
      res.status(400).json({ error: 'url invalida' });
      return;
    }

    var resUrl = NSRPLAY_BASE + '/content/resolve?url=' + encodeURIComponent(embedUrl);
    var parent = String(req.query.parentUrl || '').trim();
    if (parent && (parent.length > 2048 || !validHttpUrl(parent))) {
      res.status(400).json({ error: 'parentUrl invalida' });
      return;
    }
    if (parent) resUrl += '&parentUrl=' + encodeURIComponent(parent);

    try {
      var rr = await fetch(resUrl, { headers: key ? { 'X-API-Key': key } : {}, signal: AbortSignal.timeout(15000) });
      var dr = await rr.json();
      res.status(rr.status).json(dr);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  res.status(400).json({ error: 'action no reconocida (sources|resolve|info|servers|resolve-url)' });
}