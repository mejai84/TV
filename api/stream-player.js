/**
 * api/stream-player.js — construye la URL de un embed.
 *
 *   GET /api/stream-player?source=<provider>&type=movie|tv&id=<tmdb_id>
 *
 * La clave de NasriPlay NO se incrusta en la URL que recibe el navegador:
 * quedaría visible en el HTML y en el historial. El flujo con clave vive
 * en /api/nsrplay (servidor a servidor).
 */

import { commonHeaders, rateLimit } from '../lib/api-guard.js';

const ALLOWED_SOURCES = ['vidsrc', 'vidlink', 'vimeus', 'nasriplay', 'peliapi-player'];

function buildUrl(source, type, id, season, episode) {
  const t = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  const se = (t === 'tv' && season && episode)
    ? '/' + encodeURIComponent(season) + '/' + encodeURIComponent(episode)
    : '';
  switch (source) {
    case 'vidsrc':
      return 'https://vidsrc.to/embed/' + t + '/' + encodeURIComponent(id) + se;
    case 'vidlink':
      return 'https://vidlink.pro/' + t + '/' + encodeURIComponent(id) + se;
    case 'vimeus':
      return 'https://vimeus.com/embed/' + t + '/' + encodeURIComponent(id) + se;
    case 'nasriplay':
    case 'peliapi-player':
      // Embed público. Sin apiKey en la URL.
      return 'https://nsrplay.space/embed/' + t + '/' + encodeURIComponent(id) + se;
    default:
      return null;
  }
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
  if (!rateLimit(req, res, 'stream-player', 120, 60 * 1000)) return;

  const source = String(req.query.source || '').toLowerCase();
  const type = String(req.query.type || 'movie').toLowerCase();
  const id = String(req.query.id || '').trim();
  const season = String(req.query.season || '').trim();
  const episode = String(req.query.episode || '').trim();

  if (!source || ALLOWED_SOURCES.indexOf(source) === -1) {
    res.status(400).json({ error: 'source no permitido' });
    return;
  }
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    res.status(400).json({ error: 'id invalido' });
    return;
  }
  if ((season && !/^\d{1,3}$/.test(season)) || (episode && !/^\d{1,4}$/.test(episode))) {
    res.status(400).json({ error: 'temporada/episodio invalido' });
    return;
  }

  const url = buildUrl(source, type, id, season, episode);
  if (!url) {
    res.status(400).json({ error: 'no se pudo construir la url' });
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ url: url, source: source, type: type, id: id });
}
