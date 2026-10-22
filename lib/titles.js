/**
 * lib/titles.js — conversión entre las filas de la BD y los items de la app.
 */

export function rowToItem(row) {
  var genres = row.genres || '';
  var desc = row.description || '';
  // En el catálogo de NasriPlay `description` también guarda los géneros.
  // Solo lo tratamos como sinopsis cuando es distinto de `genres`.
  var overview = (desc && desc !== genres) ? desc : '';
  return {
    id: String(row.id),
    slug: row.slug || undefined,
    tmdbId: row.tmdb_id || undefined,
    title: row.title || 'Sin título',
    kind: row.kind,
    poster: row.poster || '',
    year: row.year || '',
    rating: row.rating || '',
    description: genres || desc,
    genres: genres,
    overview: overview,
    firstSeenAt: row.first_seen_at || '',
    source: row.source || ''
  };
}

export function itemToRow(it, kind) {
  return {
    id: String(it.tmdbId || it.id),
    kind: kind,
    title: it.title || 'Sin título',
    original_title: it.originalTitle || '',
    slug: it.slug || '',
    tmdb_id: it.tmdbId ? String(it.tmdbId) : '',
    year: it.year || '',
    poster: it.poster || '',
    rating: it.rating == null ? '' : String(it.rating),
    genres: it.description || '',
    description: it.description || '',
    source: it.source || '',
    last_resolved_at: it.lastResolvedAt || null
  };
}
