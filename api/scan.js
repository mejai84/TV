/**
 * api/scan.js — escáner de novedades (cron).
 *
 * Corre una vez al día (ver `crons` en vercel.json). Consulta el índice de la
 * caché de resolución de NasriPlay de los últimos días y hace upsert en la BD.
 *
 *   - Solo 2 peticiones (movie + tv), muy por debajo de los límites.
 *   - No guarda enlaces: solo metadatos.
 *   - No enumera IDs de TMDB: usa /content/resolved, el endpoint previsto
 *     precisamente para descubrir contenido sin hacer scraping.
 *
 * Protección: si hay CRON_SECRET configurada, exige la cabecera
 * `Authorization: Bearer <CRON_SECRET>` (Vercel la añade automáticamente).
 */

const NSRPLAY_BASE = 'https://nsrplay.space/api/v1';

import { configured as dbConfigured, upsert as dbUpsert } from '../lib/supabase.js';
import { itemToRow } from '../lib/titles.js';

function fixEncoding(value) {
  if (typeof value !== 'string') return value;
  if (!/[ÂÃ]/.test(value)) return value;
  try {
    var fixed = Buffer.from(value, 'latin1').toString('utf8');
    if (fixed.indexOf('�') === -1) return fixed;
  } catch (e) { /* se deja como vino */ }
  return value;
}

function rowFromResolved(x, kind) {
  var id = x.tmdbId || x.id;
  return itemToRow({
    id: String(id),
    tmdbId: String(id),
    title: fixEncoding(x.title || x.originalTitle || 'Sin título'),
    originalTitle: x.originalTitle || '',
    year: String(x.year || ''),
    poster: x.poster || '',
    rating: x.rating == null ? '' : String(x.rating),
    description: (x.genres || []).join(' · '),
    source: 'resolved',
    lastResolvedAt: x.lastResolvedAt || ''
  }, kind);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Autenticación del cron.
  var secret = process.env.CRON_SECRET || '';
  if (secret) {
    var auth = String(req.headers.authorization || '');
    if (auth !== 'Bearer ' + secret) {
      res.status(401).json({ error: 'no autorizado' });
      return;
    }
  }

  if (!dbConfigured()) {
    res.status(503).json({ error: 'Supabase no configurada (falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }

  var key = process.env.NSRPLAY_API_KEY || '';
  var headers = key ? { 'X-API-Key': key } : {};
  var results = [];
  var types = [
    { t: 'movie', kind: 'movie' },
    { t: 'tv', kind: 'series' }
  ];

  for (var i = 0; i < types.length; i++) {
    var cfg = types[i];
    try {
      var url = NSRPLAY_BASE + '/content/resolved?type=' + cfg.t + '&days=3&limit=50&page=1';
      var r = await fetch(url, { headers: headers });
      if (!r.ok) throw new Error('nsrplay HTTP ' + r.status);
      var d = await r.json();
      var list = (d && d.data) || [];
      var rows = [];
      for (var j = 0; j < list.length; j++) {
        var id = list[j].tmdbId || list[j].id;
        if (!id) continue;
        rows.push(rowFromResolved(list[j], cfg.kind));
      }
      if (rows.length) await dbUpsert('titles', rows);
      results.push({ type: cfg.t, upserted: rows.length });
    } catch (e) {
      results.push({ type: cfg.t, error: String(e.message || e) });
    }
  }

  res.status(200).json({ ok: true, scannedAt: new Date().toISOString(), results: results });
}
