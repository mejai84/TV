/**
 * api/novelties.js — títulos detectados recientemente.
 *
 * Con Supabase: devuelve las filas cuyo first_seen_at es de los últimos
 * `days` días (el escáner /api/scan las fue marcando).
 * Sin Supabase: consulta a NasriPlay /content/resolved (caché compartida) y
 * marca firstSeenAt con el lastResolvedAt del proveedor.
 *
 * GET /api/novelties?days=14
 *   → { items: [{ id, title, kind, poster, year, rating, firstSeenAt }] }
 *
 * El cliente decide qué es "NUEVO": compara firstSeenAt con una ventana y con
 * el conjunto de IDs ya vistos guardado en localStorage. No hay estado por
 * usuario en el servidor.
 */

const NSRPLAY_BASE = 'https://nsrplay.space/api/v1';

import { configured as dbConfigured, select as dbSelect } from '../lib/supabase.js';
import { rowToItem } from '../lib/titles.js';

function fixEncoding(value) {
  if (typeof value !== 'string') return value;
  if (!/[ÂÃ]/.test(value)) return value;
  try {
    var fixed = Buffer.from(value, 'latin1').toString('utf8');
    if (fixed.indexOf('�') === -1) return fixed;
  } catch (e) { /* se deja como vino */ }
  return value;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  var days = parseInt(req.query.days, 10) || 14;
  if (days < 1) days = 1;
  if (days > 30) days = 30;

  var items = [];

  if (dbConfigured()) {
    try {
      var since = new Date(Date.now() - days * 864e5).toISOString();
      var rows = await dbSelect('titles', {
        filters: { first_seen_at: 'gte.' + since },
        order: 'first_seen_at.desc',
        limit: '50'
      });
      items = (rows || []).map(rowToItem);
    } catch (e) { items = []; }
  }

  if (!items.length) {
    var key = process.env.NSRPLAY_API_KEY || '';
    try {
      var r = await fetch(NSRPLAY_BASE + '/content/resolved?type=all&days=' + days + '&limit=50', {
        headers: key ? { 'X-API-Key': key } : {}
      });
      var d = await r.json();
      var list = (d && d.data) || [];
      items = list.map(function (x) {
        var id = x.tmdbId || x.id;
        return {
          id: String(id),
          tmdbId: String(id),
          title: fixEncoding(x.title || x.originalTitle || 'Sin título'),
          kind: x.mediaType === 'tv' ? 'series' : 'movie',
          poster: x.poster || '',
          year: String(x.year || ''),
          rating: x.rating == null ? '' : String(x.rating),
          description: (x.genres || []).join(' · '),
          firstSeenAt: x.lastResolvedAt || ''
        };
      });
    } catch (e) { items = []; }
  }

  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=600');
  res.status(200).json({ items: items, days: days });
}
