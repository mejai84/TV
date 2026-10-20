/**
 * api/add-title.js — agrega manualmente un título por su TMDB ID.
 *
 * GET /api/add-title?id=TMDB_ID&type=movie|tv
 *
 * 1. Consulta TMDB para obtener metadatos (título, año, póster, rating, sinopsis).
 * 2. Si Supabase está configurada, hace upsert en `titles` (persistente).
 * 3. Devuelve el item normalizado para que el cliente lo muestre de inmediato.
 *
 * Útil para títulos que no aparecen en el catálogo de NasriPlay (PelisPlus).
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_LANG = 'es-ES';

import { configured as dbConfigured, upsert as dbUpsert } from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  var id = String(req.query.id || '').trim();
  var type = String(req.query.type || 'movie').toLowerCase();
  if (!id) {
    res.status(400).json({ error: 'falta id (TMDB ID)' });
    return;
  }
  var isTv = (type === 'tv' || type === 'series');
  var t = isTv ? 'tv' : 'movie';

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
    var r = await fetch(url('/' + t + '/' + encodeURIComponent(id)), { headers: headers() });
    if (!r.ok) {
      res.status(r.status).json({ error: 'TMDB HTTP ' + r.status + ' (¿ID válido?)' });
      return;
    }
    var d = await r.json();

    var genres = (d.genres || []).map(function (g) { return g.name; }).join(' · ');
    var item = {
      id: String(d.id),
      tmdbId: String(d.id),
      title: d.title || d.name || 'Sin título',
      originalTitle: d.original_title || d.original_name || '',
      kind: isTv ? 'series' : 'movie',
      poster: d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : '',
      backdrop: d.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + d.backdrop_path : '',
      year: String((d.release_date || d.first_air_date || '').slice(0, 4)),
      rating: d.vote_average == null ? '' : String(Math.round(d.vote_average * 10) / 10),
      description: genres,
      overview: d.overview || '',
      source: 'manual'
    };

    var persisted = false;
    if (dbConfigured()) {
      try {
        await dbUpsert('titles', [{
          id: String(item.id),
          kind: item.kind,
          title: item.title,
          original_title: item.originalTitle,
          slug: '',
          tmdb_id: String(item.id),
          year: item.year,
          poster: item.poster,
          rating: item.rating,
          genres: item.description,
          description: item.description,
          source: 'manual',
          last_resolved_at: null
        }]);
        persisted = true;
      } catch (e) {
        // No se pudo persistir; se devuelve igual para mostrarlo.
        persisted = false;
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ item: item, persisted: persisted });
  } catch (e) {
    res.status(502).json({ error: 'tmdb: ' + e.message });
  }
}
