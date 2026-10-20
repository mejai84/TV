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

  res.status(400).json({ error: 'action no reconocida (sources|resolve)' });
}