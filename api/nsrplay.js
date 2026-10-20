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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  var action = String(req.query.action || '').toLowerCase();
  var key = process.env.NSRPLAY_API_KEY || '';

  if (action === 'sources') {
    var type = String(req.query.type || 'movie').toLowerCase();
    var id = String(req.query.id || '').trim();
    var season = String(req.query.season || '').trim();
    var episode = String(req.query.episode || '').trim();
    if (!id) { res.status(400).json({ error: 'falta id' }); return; }

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
      var r = await fetch(url, { headers: key ? { 'X-API-Key': key } : {} });
      var data = await r.json();
      res.status(r.status).json(data);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  if (action === 'resolve') {
    var token = String(req.query.token || '').trim();
    if (!token) { res.status(400).json({ error: 'falta token' }); return; }

    var parentUrl = String(req.query.parentUrl || '').trim();
    var url = NSRPLAY_BASE + '/embed/resolve?token=' + encodeURIComponent(token);
    if (parentUrl) url += '&parentUrl=' + encodeURIComponent(parentUrl);

    try {
      var r = await fetch(url, { headers: key ? { 'X-API-Key': key } : {} });
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
    if (!slug) { res.status(400).json({ error: 'falta slug' }); return; }

    var infoUrl = NSRPLAY_BASE + '/content/info/' + encodeURIComponent(slug) +
                  '?type=' + encodeURIComponent(itype === 'movie' ? 'movie' : 'series');
    try {
      var ri = await fetch(infoUrl, { headers: key ? { 'X-API-Key': key } : {} });
      var di = await ri.json();
      res.status(ri.status).json(di);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  if (action === 'servers') {
    var sslug = String(req.query.slug || '').trim();
    if (!sslug) { res.status(400).json({ error: 'falta slug' }); return; }
    var sseason = String(req.query.season || '1').trim();
    var sepisode = String(req.query.episode || '1').trim();

    var srvUrl = NSRPLAY_BASE + '/content/servers?slug=' + encodeURIComponent(sslug) +
                 '&season=' + encodeURIComponent(sseason) +
                 '&episode=' + encodeURIComponent(sepisode);
    try {
      var rs = await fetch(srvUrl, { headers: key ? { 'X-API-Key': key } : {} });
      var ds = await rs.json();
      res.status(rs.status).json(ds);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  if (action === 'resolve-url') {
    var embedUrl = String(req.query.url || '').trim();
    if (!embedUrl) { res.status(400).json({ error: 'falta url' }); return; }

    var resUrl = NSRPLAY_BASE + '/content/resolve?url=' + encodeURIComponent(embedUrl);
    var parent = String(req.query.parentUrl || '').trim();
    if (parent) resUrl += '&parentUrl=' + encodeURIComponent(parent);

    try {
      var rr = await fetch(resUrl, { headers: key ? { 'X-API-Key': key } : {} });
      var dr = await rr.json();
      res.status(rr.status).json(dr);
    } catch (e) {
      res.status(502).json({ error: 'no se pudo contactar con nsrplay: ' + e.message });
    }
    return;
  }

  res.status(400).json({ error: 'action no reconocida (sources|resolve|info|servers|resolve-url)' });
}