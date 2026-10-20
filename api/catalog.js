/**
 * api/catalog.js — catálogo real para la fuente 'embeds'.
 *
 * Sin TMDB API key, el catálogo se alimenta de NasriPlay:
 *   - Películas: /content/resolved (índice de la caché de resolución,
 *     con metadatos TMDB limpios y pósteres oficiales).
 *   - Series:    /content/catalog?type=series (incluye el slug, que es
 *     lo que necesitan /content/info y /content/servers).
 *
 * La API key nunca sale del servidor: NSRPLAY_API_KEY.
 *
 * GET /api/catalog?type=movie|series&page=1
 *   → { items: [{ id, slug?, title, kind, poster, year, rating, description }] }
 */

const NSRPLAY_BASE = 'https://nsrplay.space/api/v1';

function cleanTitle(t) {
  return String(t || '')
    .replace(/^\s*ver\s+/i, '')
    .replace(/\s+online\s+gratis(\s+hd)?\s*$/i, '')
    .replace(/\s+-\s+pel[ií]cula completa.*$/i, '')
    .trim();
}

function normResolved(list, kind) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var x = list[i] || {};
    var id = x.tmdbId || x.id;
    if (!id) continue;
    out.push({
      id: String(id),
      title: x.title || x.originalTitle || 'Sin título',
      kind: kind,
      poster: x.poster || '',
      year: String(x.year || ''),
      rating: x.rating == null ? '' : String(x.rating),
      description: (x.genres || []).join(' · ')
    });
  }
  return out;
}

function normCatalog(list, kind) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var x = list[i] || {};
    var slug = x.slug || x.id;
    if (!slug) continue;
    out.push({
      id: String(slug),
      slug: String(slug),
      title: cleanTitle(x.title) || 'Sin título',
      kind: kind,
      poster: x.poster || '',
      year: '',
      rating: x.rating == null ? '' : String(x.rating),
      description: x.provider ? ('Fuente: ' + x.provider) : ''
    });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  var type = String(req.query.type || 'movie').toLowerCase();
  var page = parseInt(req.query.page, 10) || 1;
  if (page < 1) page = 1;
  if (page > 20) page = 20;

  var isSeries = (type === 'series' || type === 'tv');
  var kind = isSeries ? 'series' : 'movie';
  var key = process.env.NSRPLAY_API_KEY || '';
  var headers = key ? { 'X-API-Key': key } : {};

  async function getJson(url) {
    var r = await fetch(url, { headers: headers });
    if (!r.ok) throw new Error('nsrplay HTTP ' + r.status);
    return r.json();
  }

  var items = [];

  // 1) Películas: mejor metadato (TMDB) desde el índice de resueltos.
  if (!isSeries) {
    try {
      var rd = await getJson(NSRPLAY_BASE + '/content/resolved?type=movie&days=90&limit=50&page=' + page);
      items = normResolved((rd && rd.data) || [], kind);
    } catch (e) {
      items = [];
    }
  }

  // 2) Respaldo (y fuente de series): catálogo con slug.
  if (!items.length) {
    try {
      var cd = await getJson(NSRPLAY_BASE + '/content/catalog?type=' + (isSeries ? 'series' : 'movie') + '&page=' + page);
      var list = (cd && cd.data && cd.data.items) || [];
      items = normCatalog(list, kind);
    } catch (e) {
      items = [];
    }
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
  res.status(200).json({ items: items, type: kind, page: page });
}
