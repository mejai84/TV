/**
 * lib/supabase.js — cliente mínimo de Supabase (PostgREST) sin dependencias.
 * (ver api/_lib/supabase.js anterior; movido a /lib para que Vercel no lo
 * trate como función serverless).
 */

const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export function configured() {
  return !!(URL && KEY);
}

function qs(params) {
  var out = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v === undefined || v === null || v === '') continue;
    out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}

async function request(path, opts) {
  opts = opts || {};
  var headers = {
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json'
  };
  if (opts.prefer) headers.Prefer = opts.prefer;

  var r = await fetch(URL + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body,
    signal: AbortSignal.timeout(15000)
  });
  return r;
}

export async function select(table, params) {
  params = params || {};
  var p = { select: params.select || '*' };
  var filters = params.filters || {};
  for (var k in filters) {
    if (!Object.prototype.hasOwnProperty.call(filters, k)) continue;
    p[k] = filters[k];
  }
  ['order', 'limit', 'offset'].forEach(function (k) {
    if (params[k] !== undefined && params[k] !== null) p[k] = params[k];
  });
  var r = await request(table + '?' + qs(p));
  if (!r.ok) {
    var t = await r.text();
    throw new Error('supabase select ' + r.status + ' ' + t.slice(0, 200));
  }
  return r.json();
}

export async function upsert(table, rows) {
  if (!rows || !rows.length) return true;
  var r = await request(table, {
    method: 'POST',
    body: JSON.stringify(rows),
    prefer: 'return=minimal,resolution=merge-duplicates'
  });
  if (!r.ok) {
    var t = await r.text();
    throw new Error('supabase upsert ' + r.status + ' ' + t.slice(0, 200));
  }
  return true;
}

export async function update(table, filters, patch) {
  var p = {};
  for (var k in filters) {
    if (!Object.prototype.hasOwnProperty.call(filters, k)) continue;
    p[k] = filters[k];
  }
  var r = await request(table + '?' + qs(p), {
    method: 'PATCH',
    body: JSON.stringify(patch),
    prefer: 'return=minimal'
  });
  if (!r.ok) {
    var t = await r.text();
    throw new Error('supabase update ' + r.status + ' ' + t.slice(0, 200));
  }
  return true;
}
