/**
 * api/tmdb.js — proxy de TMDB para la ficha de películas y series.
 *
 * La clave de TMDB solo vive en el servidor (TMDB_API_KEY); este endpoint
 * la oculta y devuelve los metadatos en español.
 *
 * GET /api/tmdb?action=details&type=movie|tv&id=TMDB_ID
 *   → overview, genres, runtime, poster, backdrop, rating, year, seasons (solo tv)
 * GET /api/tmdb?action=season&id=TMDB_ID&season=N
 *   → episodes: [{ number, name, overview, still, air_date }]
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_LANG = 'es-ES';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  var action = String(req.query.action || 'details').toLowerCase();
  var type = String(req.query.type || 'movie').toLowerCase();
  var id = String(req.query.id || '').trim();
  var season = String(req.query.season || '1').trim();

  if (!id) {
    res.status(400).json({ error: 'falta id' });
    return;
  }

  var key = process.env.TMDB_API_KEY || '';
  var token = process.env.TMDB_READ_TOKEN || '';
  if (!key && !token) {
    res.status(503).json({ error: 'TMDB no configurada (falta TMDB_API_KEY)' });
    return;
  }

  function url(path) {
    var u = TMDB_BASE + path + '?language=' + encodeURIComponent(TMDB_LANG);
    if (key) u += '&api_key=' + encodeURIComponent(key);
    return u;
  }

  function headers() {
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  try {
    if (action === 'details') {
      var t = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
      var path = '/' + t + '/' + encodeURIComponent(id);
      var r = await fetch(url(path), { headers: headers() });
      if (!r.ok) {
        res.status(r.status).json({ error: 'tmdb HTTP ' + r.status });
        return;
      }
      var d = await r.json();
      var genres = (d.genres || []).map(function (g) { return g.name; }).join(' · ');
      var out = {
        id: String(d.id),
        title: d.title || d.name || '',
        originalTitle: d.original_title || d.original_name || '',
        overview: d.overview || '',
        genres: genres,
        poster: d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : '',
        backdrop: d.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + d.backdrop_path : '',
        rating: d.vote_average == null ? '' : String(Math.round(d.vote_average * 10) / 10),
        year: String((d.release_date || d.first_air_date || '').slice(0, 4)),
        runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0,
        seasons: (d.seasons || []).map(function (s) {
          return { number: s.season_number, name: s.name, episodeCount: s.episode_count };
        }).filter(function (s) { return s.number > 0; })
      };
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
      res.status(200).json(out);
      return;
    }

    if (action === 'season') {
      var spath = '/tv/' + encodeURIComponent(id) + '/season/' + encodeURIComponent(season);
      var sr = await fetch(url(spath), { headers: headers() });
      if (!sr.ok) {
        res.status(sr.status).json({ error: 'tmdb HTTP ' + sr.status });
        return;
      }
      var sd = await sr.json();
      var eps = (sd.episodes || []).map(function (e) {
        return {
          number: e.episode_number,
          name: e.name || ('Episodio ' + e.episode_number),
          overview: e.overview || '',
          still: e.still_path ? 'https://image.tmdb.org/t/p/w300' + e.still_path : '',
          air_date: e.air_date || ''
        };
      });
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
      res.status(200).json({ season: Number(season), episodes: eps });
      return;
    }

    res.status(400).json({ error: 'action no reconocida (details|season)' });
  } catch (e) {
    res.status(502).json({ error: 'tmdb: ' + e.message });
  }
}
