/**
 * api/catalog.js — catálogo para la fuente 'embeds' (películas y series).
 *
 * Con Supabase configurada (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   1. Intenta servir desde la BD (índice persistente: rápido y sin gastar
 *      cuota de NasriPlay).
 *   2. Si la BD está vacía, consulta a NasriPlay y rellena la BD (write-through).
 *
 * Sin Supabase, funciona como antes: NasriPlay en caliente con caché CDN.
 *
 * GET /api/catalog?type=movie|series&page=1
 *   → { items: [{ id, slug?, tmdbId?, title, kind, poster, year, rating,
 *                 description, firstSeenAt? }] }
 */

const NSRPLAY_BASE = 'https://nsrplay.space/api/v1';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_LANG = 'es-CO';

import { configured as dbConfigured, select as dbSelect, upsert as dbUpsert } from '../lib/supabase.js';
import { rowToItem, itemToRow } from '../lib/titles.js';

/* Caché en memoria del proceso: las búsquedas de TMDB cambian poco y así
   no se repiten en cada visita a /api/catalog. */
const tmdbSearchCache = new Map();

function normName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pickBestTv(results, title, wantedRating) {
  var q = normName(title);
  var qWords = q ? q.split(' ') : [];
  var best = null;
  var bestScore = -1;

  for (var i = 0; i < results.length; i++) {
    var r = results[i] || {};
    var name = normName(r.name);
    var original = normName(r.original_name);
    var words = (name || original) ? (name || original).split(' ') : [];
    var exact = (name && name === q) || (original && original === q);
    var score = 0;

    if (exact) {
      score += 200;
    } else {
      // Coincidencia flexible solo si comparte al menos dos palabras
      // distintivas. Evita que "Guerra" termine en "Guerra de vecinos".
      var hits = 0;
      for (var j = 0; j < qWords.length; j++) {
        if (qWords[j] && words.indexOf(qWords[j]) > -1) hits++;
      }
      var precision = qWords.length ? hits / qWords.length : 0;
      if (hits < 2 || precision < 0.5) {
        // Un único resultado con una nota muy parecida a la del catálogo
        // suele ser una traducción del mismo título (p. ej. Merry Berry Love).
        var singleRating = results.length === 1 && wantedRating &&
          r.vote_average && Math.abs(Number(r.vote_average) - Number(wantedRating)) <= 0.6;
        if (!singleRating) continue;
        score += 40;
      } else {
        score += 80 * precision + 40 * (hits / (words.length || 1));
      }
    }

    var year = parseInt(String(r.first_air_date || '').slice(0, 4), 10) || 0;
    if (year >= 2020) score += 28;
    else if (year >= 2010) score += 12;

    if (r.vote_count) score += Math.min(8, Math.log(r.vote_count + 1));
    if (r.poster_path) score += 2;

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

async function tmdbSearchTv(title, wantedRating) {
  var key = process.env.TMDB_API_KEY || '';
  var token = process.env.TMDB_READ_TOKEN || '';
  if (!key && !token) return null;

  var cacheKey = normName(title) + '|' + String(wantedRating || '');
  if (tmdbSearchCache.has(cacheKey)) return tmdbSearchCache.get(cacheKey);

  var url = TMDB_BASE + '/search/tv?language=' + encodeURIComponent(TMDB_LANG) +
            '&query=' + encodeURIComponent(title);
  if (key) url += '&api_key=' + encodeURIComponent(key);

  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;

  try {
    var r = await fetch(url, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      signal: controller ? controller.signal : undefined
    });
    if (!r.ok) return null;
    var data = await r.json();
    var best = pickBestTv((data && data.results) || [], title, wantedRating);
    if (best) tmdbSearchCache.set(cacheKey, best);
    return best;
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Las series del catálogo de NasriPlay solo traen slug. Se buscan en TMDB
 * para obtener un tmdbId con el que los embeds públicos (vidsrc/vidlink)
 * puedan reproducirlas sin gastar la cuota de NasriPlay.
 */
async function enrichSeries(items) {
  if (!process.env.TMDB_API_KEY && !process.env.TMDB_READ_TOKEN) return items;

  var out = items.slice();
  var index = 0;
  var workers = [];
  var deadline = Date.now() + 6000;

  async function worker() {
    while (index < out.length && Date.now() < deadline) {
      var i = index++;
      var it = out[i];
      if (!it || !it.title) continue;
      try {
        var best = await tmdbSearchTv(it.title, it.rating);
        if (!best) continue;
        it.tmdbId = String(best.id);
        it.year = String(best.first_air_date || '').slice(0, 4);
        if (best.vote_average) it.rating = String(Math.round(best.vote_average * 10) / 10);
        if (best.poster_path) {
          it.poster = 'https://image.tmdb.org/t/p/w500' + best.poster_path;
        }
      } catch (e) { /* una serie sin match no rompe el catálogo */ }
    }
  }

  for (var w = 0; w < 6; w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

/**
 * NasriPlay devuelve algunos textos con el UTF-8 interpretado como Latin-1
 * ("niÃ±a" en vez de "niña"). Se re-codifica solo si el resultado es válido.
 */
function fixEncoding(value) {
  if (typeof value !== 'string') return value;
  if (!/[ÂÃ]/.test(value)) return value;
  try {
    var fixed = Buffer.from(value, 'latin1').toString('utf8');
    if (fixed.indexOf('�') === -1) return fixed;
  } catch (e) { /* se deja como vino */ }
  return value;
}

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
      tmdbId: String(id),
      title: fixEncoding(x.title || x.originalTitle || 'Sin título'),
      originalTitle: x.originalTitle || '',
      kind: kind,
      poster: x.poster || '',
      year: String(x.year || ''),
      rating: x.rating == null ? '' : String(x.rating),
      description: fixEncoding((x.genres || []).join(' · ')),
      lastResolvedAt: x.lastResolvedAt || ''
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
      title: cleanTitle(fixEncoding(x.title)) || 'Sin título',
      kind: kind,
      poster: x.poster || '',
      year: '',
      rating: x.rating == null ? '' : String(x.rating),
      description: x.provider ? ('Fuente: ' + fixEncoding(x.provider)) : ''
    });
  }
  return out;
}

/** Deduplica por id conservando el primero. */
function dedupe(items) {
  var seen = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || !it.id || seen[it.id]) continue;
    seen[it.id] = 1;
    out.push(it);
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

  /* 1) Servir desde la BD si hay índice. */
  if (dbConfigured()) {
    try {
      var offset = (page - 1) * 50;
      var rows = await dbSelect('titles', {
        filters: { kind: 'eq.' + kind },
        order: 'first_seen_at.desc',
        limit: '50',
        offset: String(offset)
      });
      if (rows && rows.length) {
        res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
        res.status(200).json({ items: rows.map(rowToItem), type: kind, page: page, source: 'db' });
        return;
      }
    } catch (e) { /* la BD falló: se intenta NasriPlay */ }
  }

  /* 2) NasriPlay. */
  var items = [];

  if (!isSeries) {
    try {
      var rd = await getJson(NSRPLAY_BASE + '/content/resolved?type=movie&days=90&limit=50&page=' + page);
      items = normResolved((rd && rd.data) || [], kind);
    } catch (e) { items = []; }
  }

  if (!items.length) {
    try {
      var cd = await getJson(NSRPLAY_BASE + '/content/catalog?type=' + (isSeries ? 'series' : 'movie') + '&page=' + page);
      var list = (cd && cd.data && cd.data.items) || [];
      items = normCatalog(list, kind);
      if (isSeries) items = await enrichSeries(items);
    } catch (e) { items = []; }
  }

  items = dedupe(items);

  /* 3) Write-through: rellena la BD para la próxima visita. */
  if (dbConfigured() && items.length) {
    try {
      var rowsToUpsert = items.map(function (it) { return itemToRow(it, kind); });
      await dbUpsert('titles', rowsToUpsert);
    } catch (e) { /* si falla la escritura, la app sigue funcionando */ }
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
  res.status(200).json({ items: items, type: kind, page: page, source: 'nsrplay' });
}
