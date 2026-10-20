/**
 * api/stream-player.js — proxy de embeds estilo GoPelis.
 *
 * El cliente nunca construye la URL de nsrplay con la API key: la pide aqui
 * y este endpoint la inyecta desde la variable de entorno NSRPLAY_API_KEY.
 * Asi la clave no queda en el bundle del navegador.
 *
 *   GET /api/stream-player?source=<provider>&type=movie|tv&id=<tmdb_id>
 *
 * Respuesta: { url, source }   (la URL final del embed)
 */

const ALLOWED_SOURCES = ['vidsrc', 'vidlink', 'vimeus', 'nasriplay', 'peliapi-player'];

function buildUrl(source, type, id) {
  var t = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  switch (source) {
    case 'vidsrc':
      return 'https://vidsrc.to/embed/' + t + '/' + encodeURIComponent(id);
    case 'vidlink':
      return 'https://vidlink.pro/' + t + '/' + encodeURIComponent(id);
    case 'vimeus':
      return 'https://vimeus.com/embed/' + t + '/' + encodeURIComponent(id);
    case 'nasriplay':
    case 'peliapi-player': {
      var key = process.env.NSRPLAY_API_KEY || '';
      var url = 'https://nsrplay.space/embed/' + t + '/' + encodeURIComponent(id);
      if (season && episode) url += '/' + encodeURIComponent(season) + '/' + encodeURIComponent(episode);
      if (key) url += (url.indexOf('?') > -1 ? '&' : '?') + 'apiKey=' + encodeURIComponent(key);
      return url;
    }
    default:
      return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  var source = String(req.query.source || '').toLowerCase();
  var type = String(req.query.type || 'movie').toLowerCase();
  var id = String(req.query.id || '').trim();
  var season = String(req.query.season || '').trim();
  var episode = String(req.query.episode || '').trim();

  if (!source || ALLOWED_SOURCES.indexOf(source) === -1) {
    res.status(400).json({ error: 'source no permitido' });
    return;
  }
  if (!id) {
    res.status(400).json({ error: 'falta id' });
    return;
  }

  var url = buildUrl(source, type, id);
  if (!url) {
    res.status(400).json({ error: 'no se pudo construir la url' });
    return;
  }

  res.status(200).json({ url: url, source: source, type: type, id: id });
}