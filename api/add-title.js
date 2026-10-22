/**
 * api/add-title.js — agrega manualmente un título por su TMDB ID.
 *
 * POST /api/add-title  { "id": "TMDB_ID", "type": "movie"|"tv" }
 *
 * 1. Consulta TMDB para obtener metadatos (título, año, póster, rating, sinopsis).
 * 2. Si Supabase está configurada, hace upsert en `titles` (persistente).
 * 3. Devuelve el item normalizado para que el cliente lo muestre de inmediato.
 *
 * Útil para títulos que no aparecen en el catálogo de NasriPlay (PelisPlus).
 *
 * Seguridad: solo POST, validación de ID, rate limit, Origin permitido y,
 * opcionalmente, ADMIN_TOKEN (si está configurado).
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_LANG = 'es-ES';
const NSRPLAY_BASE = 'https://nsrplay.space/api/v1';

import { configured as dbConfigured, upsert as dbUpsert } from '../lib/supabase.js';
import {
  adminAllowed, commonHeaders, isValidTmdbId, originAllowed, rateLimit, readBody
} from '../lib/api-guard.js';

export default async function handler(req, res) {
  commonHeaders(res);
  const origin = String(req.headers.origin || '');
  if (origin && originAllowed(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'metodo no permitido; usa POST' });
    return;
  }
  if (!originAllowed(req)) {
    res.status(403).json({ error: 'origen no permitido' });
    return;
  }
  if (!adminAllowed(req)) {
    res.status(401).json({ error: 'no autorizado' });
    return;
  }
  if (!rateLimit(req, res, 'add-title', 10, 60 * 1000)) return;

  const body = readBody(req);
  const id = String(body.id || '').trim();
  const type = String(body.type || 'movie').toLowerCase();
  if (!isValidTmdbId(id)) {
    res.status(400).json({ error: 'id invalido (TMDB ID numerico)' });
    return;
  }
  const isTv = (type === 'tv' || type === 'series');
  const t = isTv ? 'tv' : 'movie';

  const key = process.env.TMDB_API_KEY || '';
  const token = process.env.TMDB_READ_TOKEN || '';
  if (!key && !token) {
    res.status(503).json({ error: 'TMDB no configurada (falta TMDB_API_KEY)' });
    return;
  }

  function url(path) {
    let u = TMDB_BASE + path + '?language=' + encodeURIComponent(TMDB_LANG);
    if (key) u += '&api_key=' + encodeURIComponent(key);
    return u;
  }
  function headers() {
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  try {
    const r = await fetch(url('/' + t + '/' + encodeURIComponent(id)), {
      headers: headers(),
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) {
      res.status(r.status).json({ error: 'TMDB HTTP ' + r.status + ' (¿ID válido?)' });
      return;
    }
    const d = await r.json();

    const genres = (d.genres || []).map(function (g) { return g.name; }).join(' · ');
    const item = {
      id: String(d.id),
      tmdbId: String(d.id),
      title: d.title || d.name || 'Sin título',
      originalTitle: d.original_title || d.original_name || '',
      kind: isTv ? 'series' : 'movie',
      poster: d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : '',
      backdrop: d.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + d.backdrop_path : '',
      year: String((d.release_date || d.first_air_date || '').slice(0, 4)),
      rating: d.vote_average == null ? '' : String(Math.round(d.vote_average * 10) / 10),
      description: d.overview || '',
      overview: d.overview || '',
      genres: genres,
      source: 'manual',
      resolved: false
    };

    // Búsqueda secundaria: ¿está en el índice de NasriPlay?
    try {
      const nsrKey = process.env.NSRPLAY_API_KEY || '';
      const nr = await fetch(NSRPLAY_BASE + '/content/resolved?type=' +
        (isTv ? 'tv' : 'movie') + '&days=90&limit=50&page=1', {
        headers: nsrKey ? { 'X-API-Key': nsrKey } : {},
        signal: AbortSignal.timeout(12000)
      });
      if (nr.ok) {
        const nd = await nr.json();
        const list = (nd && nd.data) || [];
        for (let i = 0; i < list.length; i++) {
          if (String(list[i].tmdbId || list[i].id) === String(d.id)) {
            item.resolved = true;
            break;
          }
        }
      }
    } catch (e) { /* la búsqueda secundaria no es crítica */ }

    let persisted = false;
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
          genres: item.genres,
          description: item.overview,
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
