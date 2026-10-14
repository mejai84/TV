/**
 * epg.js — Guia de programacion (EPG) con navegacion de mando.
 *
 * Diseno pensado para televisor:
 *  - Rejilla de tiempo clásica: canales en vertical, horas en horizontal.
 *    Se construye con flexbox + posicion absoluta, no con CSS Grid, porque
 *    los navegadores de TV de 2015-2018 no lo soportan.
 *  - La columna de canales queda fija y la pista temporal se desplaza: es lo
 *    unico que se maneja bien con D-pad sin scroll fino.
 *  - Ventana deslizante por defecto de 6 horas, ampliable por dias.
 *
 * Formato normalizado que produce Epg.normalize():
 *   { id, channelId, title, start, end, type, desc, subtitle }
 *   start / end en epoch ms.
 */

var Epg = {

  MIN_MS: 60 * 1000,
  HOUR_MS: 60 * 60 * 1000,

  /* ---------------------------------------------------------------- *
   * Tiempo
   * ---------------------------------------------------------------- */

  /** Acepta epoch (numero o string numerico) o ISO-8601. Devuelve ms. */
  parseTs: function (v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
    var s = String(v).trim();
    if (/^-?\d+$/.test(s)) {
      var n = parseInt(s, 10);
      return n < 1e11 ? n * 1000 : n;
    }
    // "2026-10-13 20:30:00" sin zona: se interpreta como hora local, que es
    // lo que quiere un usuario de TV ("empieza a las 20:30 aqui").
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    }
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  },

  /** Redondea hacia abajo a la hora en curso. */
  hourFloor: function (ts) {
    var d = new Date(ts);
    d.setMinutes(0, 0, 0);
    return d.getTime();
  },

  startOfDay: function (ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },

  pad2: function (n) { return (n < 10 ? '0' : '') + n; },

  fmtTime: function (ts) {
    if (!ts) return '--:--';
    var d = new Date(ts);
    return Epg.pad2(d.getHours()) + ':' + Epg.pad2(d.getMinutes());
  },

  fmtDay: function (ts) {
    var dias = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
    var meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var d = new Date(ts);
    return dias[d.getDay()] + ' ' + d.getDate() + ' ' + meses[d.getMonth()];
  },

  /** Duracion legible: 1h30, 45min */
  fmtDur: function (ms) {
    var m = Math.round(ms / Epg.MIN_MS);
    if (m < 60) return m + 'min';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? (h + 'h' + Epg.pad2(r)) : (h + 'h');
  },

  /* ---------------------------------------------------------------- *
   * Normalizacion
   * ---------------------------------------------------------------- */

  /**
   * Acepta varias formas de proveedor y devuelve el formato interno.
   * Se reales porque la app nativa usa nombres distintos al nuestro:
   *   programName / name / title      -> titulo
   *   startTime / start / begin       -> inicio
   *   endTime / end / stop            -> fin
   *   channelCode / channelId / chId  -> canal
   */
  normalize: function (raw) {
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i] || {};
      var start = Epg.parseTs(r.start !== undefined ? r.start
                          : (r.startTime !== undefined ? r.startTime : r.begin));
      var end   = Epg.parseTs(r.end !== undefined ? r.end
                          : (r.endTime !== undefined ? r.endTime : r.stop));
      if (!start) continue;
      if (!end || end <= start) end = start + 30 * Epg.MIN_MS; // default razonable

      out.push({
        id: r.id || (String(r.channelId || r.channelCode || '') + '-' + start),
        channelId: String(r.channelId !== undefined ? r.channelId
                    : (r.channelCode !== undefined ? r.channelCode : '')),
        title: r.title || r.programName || r.name || 'Sin titulo',
        start: start,
        end: end,
        type: (r.type || 'program').toString().toLowerCase(),
        desc: r.desc || r.remark || r.description || '',
        subtitle: r.subtitle || r.alias || ''
      });
    }
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  },

  /** Agrupa por canal y ordena dentro de cada canal. */
  byChannel: function (programs) {
    var map = {}, order = [];
    for (var i = 0; i < programs.length; i++) {
      var ch = programs[i].channelId;
      if (!Object.prototype.hasOwnProperty.call(map, ch)) { map[ch] = []; order.push(ch); }
      map[ch].push(programs[i]);
    }
    // Orden estable: los canales que tienen algo antes de "ahora" primero.
    // Ojo: firstOverlap es metodo de Epg, no una funcion suelta. Llamado
    // sin el prefijo lanza ReferenceError y tumblea toda la guia.
    var now = Date.now();
    order.sort(function (a, b) {
      var aNow = Epg.firstOverlap(map[a], now);
      var bNow = Epg.firstOverlap(map[b], now);
      if (aNow === -1 && bNow !== -1) return 1;
      if (aNow !== -1 && bNow === -1) return -1;
      if (aNow !== -1) return aNow - bNow;
      return a < b ? -1 : 1;
    });
    return { map: map, order: order };
  },

  /** Programa en curso de un canal, o -1. */
  current: function (list, now) {
    now = now || Date.now();
    for (var i = 0; i < list.length; i++) {
      if (list[i].start <= now && list[i].end > now) return i;
    }
    return -1;
  },

  firstOverlap: function (list, now) {
    var idx = Epg.current(list, now);
    if (idx !== -1) return now;
    for (var i = 0; i < list.length; i++) {
      if (list[i].start > now) return list[i].start;
    }
    return -1;
  },

  /** Programa que empieza dentro de la ventana visible. */
  visible: function (programs, winStart, winEnd) {
    var out = [];
    for (var i = 0; i < programs.length; i++) {
      var p = programs[i];
      if (p.end > winStart && p.start < winEnd) out.push(p);
    }
    return out;
  }
};

/* ================================================================== *
 * Guide — render y navegacion de la rejilla temporal
 * ================================================================== */
function Guide(rootEl, opts) {
  this.root = rootEl;
  this.opts = opts || {};
  this.hours = this.opts.hours || 6;
  this.dayOffset = this.opts.dayOffset || 0;
  this.programs = [];
  this.channels = { map: {}, order: [] };
  this.channelNames = this.opts.channelNames || {};
  this.focus = { ch: 0, prog: 0 };
  this.onPlay = this.opts.onPlay || null;
  this.selected = null;

  // No hay _bind(): la entrada por teclado la despacha app.js, que ya tiene
  // el mapa de codigos de cada mando. Aqui solo se pintan los bloques.
  this.render();
}

/** Inicio de la ventana visible: la hora actual, o las 00:00 del dia elegido. */
Guide.prototype.windowStart = function () {
  var day = Epg.startOfDay(Date.now() + (this.dayOffset * 24 * Epg.HOUR_MS));
  if (this.dayOffset === 0) {
    var nowH = Epg.hourFloor(Date.now());
    // Un poco de margen a la izquierda para no abrir el programa en curso
    // justo en el borde, que queda cortado.
    return nowH - Epg.HOUR_MS;
  }
  return day;
};

Guide.prototype.setData = function (programs) {
  this.programs = Epg.normalize(programs || []);
  var b = Epg.byChannel(this.programs);
  this.channels = b;
  this.focus = { ch: 0, prog: 0 };
  this.render();
};

Guide.prototype.setDay = function (offset) {
  this.dayOffset = offset;
  this.render();
  this._scrollToNow();
};

/* ---------------------------------------------------------------- *
 * Render
 * ---------------------------------------------------------------- */
Guide.prototype.render = function () {
  var self = this;
  var winStart = this.windowStart();
  var winEnd = winStart + (this.hours * Epg.HOUR_MS);
  var span = winEnd - winStart;
  var now = Date.now();

  // Marcas de hora del eje superior.
  var axis = '';
  for (var t = winStart; t <= winEnd; t += Epg.HOUR_MS) {
    axis += '<div class="epg-slot" style="width:' + (Epg.HOUR_MS / span * 100) + '%">' +
            '<span>' + Epg.fmtTime(t) + '</span></div>';
  }

  var labels = '', rows = '';
  var list = Epg.visible(this.programs, winStart, winEnd);

  for (var c = 0; c < this.channels.order.length; c++) {
    var chId = this.channels.order[c];
    var chPrograms = list.filter(function (p) { return p.channelId === chId; });
    // Un canal solo aparece si tiene algo en la ventana.
    if (!chPrograms.length) continue;

    var name = this.channelNames[chId] || chId;
    var idxNow = Epg.current(this.channels.map[chId], now);

    labels += '<div class="epg-label' + (c === this.focus.ch ? ' focused' : '') +
              '" data-ch="' + c + '" tabindex="0">' +
              '<span class="epg-logoname">' + Utils.esc(name) + '</span>' +
              '<span class="epg-now">' + Utils.esc(idxNow > -1 ? this.channels.map[chId][idxNow].title : '') + '</span>' +
            '</div>';

    var blocks = '';
    for (var p = 0; p < chPrograms.length; p++) {
      var pr = chPrograms[p];
      // Recorte a la ventana: un programa puede empezar antes.
      var s = Math.max(pr.start, winStart);
      var e = Math.min(pr.end, winEnd);
      var left = (s - winStart) / span * 100;
      var width = (e - s) / span * 100;
      var isNow = (pr.start <= now && pr.end > now);
      var isSel = (c === this.focus.ch && p === this.focus.prog);

      blocks += '<div class="epg-prog t-' + Utils.esc(pr.type) +
                (isNow ? ' now' : '') + (isSel ? ' sel' : '') +
                '" style="left:' + left.toFixed(3) + '%;width:' + width.toFixed(3) + '%" ' +
                'data-ch="' + c + '" data-prog="' + p + '" tabindex="0" ' +
                'title="' + Utils.esc(Epg.fmtTime(pr.start) + ' - ' + Epg.fmtTime(pr.end) + ' ' + pr.title) + '">' +
                '<b>' + Utils.esc(pr.title) + '</b>' +
                '<i>' + Epg.fmtTime(pr.start) + ' · ' + Epg.fmtDur(pr.end - pr.start) + '</i>' +
              '</div>';
    }
    rows += '<div class="epg-row">' + blocks + '</div>';
  }

  // Indicador "ahora" en la pista.
  var nowPct = now >= winStart && now <= winEnd
    ? ((now - winStart) / span * 100).toFixed(3) : -1;

  this.root.innerHTML =
    '<div class="epg-head">' +
      '<button class="epg-nav" id="epgPrev" tabindex="0">◀ ' + Epg.fmtDay(winStart) + '</button>' +
      '<span class="epg-range">' + Epg.fmtTime(winStart) + ' – ' + Epg.fmtTime(winEnd) + '</span>' +
      '<button class="epg-nav" id="epgNext" tabindex="0">' + Epg.fmtDay(winStart) + ' ▶</button>' +
    '</div>' +
    '<div class="epg-body">' +
      '<div class="epg-labels">' + labels + '</div>' +
      '<div class="epg-scroll" id="epgScroll">' +
        '<div class="epg-axis">' + axis + '</div>' +
        '<div class="epg-tracks">' +
          (nowPct > 0 ? '<div class="epg-needle" style="left:' + nowPct + '%"></div>' : '') +
          rows +
        '</div>' +
      '</div>' +
    '</div>' +
    (this.programs.length ? '' : '<div class="epg-empty">Sin guia para este periodo.<br>Revisa la fuente EPG en <code>CONFIG.source</code>.</div>');

  var prev = this.root.querySelector('#epgPrev');
  var next = this.root.querySelector('#epgNext');
  if (prev) prev.addEventListener('click', function () { self.setDay(self.dayOffset - 1); });
  if (next) next.addEventListener('click', function () { self.setDay(self.dayOffset + 1); });

  var self2 = this;
  var nodes = this.root.querySelectorAll('.epg-prog');
  for (var i = 0; i < nodes.length; i++) {
    (function (n) {
      n.addEventListener('click', function () {
        var ch = parseInt(n.getAttribute('data-ch'), 10);
        var pg = parseInt(n.getAttribute('data-prog'), 10);
        self2.focus = { ch: ch, prog: pg };
        self2.activate();
      });
    })(nodes[i]);
  }
};

/* ---------------------------------------------------------------- *
 * Navegacion con mando
 * ---------------------------------------------------------------- */
Guide.prototype.move = function (dc, dr) {
  var self = this;
  var ch = this.focus.ch;
  var pg = this.focus.prog;

  if (dc) {
    var row = this.root.querySelectorAll('.epg-row')[ch];
    if (row) {
      var blocks = row.querySelectorAll('.epg-prog');
      var nextIdx = pg + dc;
      if (nextIdx >= 0 && nextIdx < blocks.length) pg = nextIdx;
    }
  }
  if (dr) {
    ch = Math.max(0, Math.min(this.channels.order.length - 1, ch + dr));
    // Al cambiar de fila, se queda en el programa que mas se solapa con la
    // posicion temporal anterior; si no, el primero.
    pg = 0;
  }
  this.focus = { ch: ch, prog: pg };
  this._paint();
  this._reveal();
};

Guide.prototype.activate = function () {
  var row = this.root.querySelectorAll('.epg-row')[this.focus.ch];
  if (!row) return;
  var block = row.querySelectorAll('.epg-prog')[this.focus.prog];
  if (!block) return;
  this.selected = {
    channelId: block.getAttribute('data-chid') || this.channels.order[this.focus.ch],
    title: (block.querySelector('b') || {}).textContent || ''
  };
  if (this.onPlay) this.onPlay(this.selected, block);
};

/** Marca visualmente el bloque enfocado sin volver a renderizar todo. */
Guide.prototype._paint = function () {
  var labels = this.root.querySelectorAll('.epg-label');
  for (var i = 0; i < labels.length; i++) {
    labels[i].className = labels[i].className.replace(/\s*focused\b/, '');
  }
  if (labels[this.focus.ch]) labels[this.focus.ch].className += ' focused';

  var blocks = this.root.querySelectorAll('.epg-prog');
  for (var j = 0; j < blocks.length; j++) {
    blocks[j].className = blocks[j].className.replace(/\s*sel\b/, '');
  }
  var row = this.root.querySelectorAll('.epg-row')[this.focus.ch];
  if (row) {
    var sel = row.querySelectorAll('.epg-prog')[this.focus.prog];
    if (sel) sel.className += ' sel';
  }
};

/** Mantiene el bloque enfocado dentro de la vista. */
Guide.prototype._reveal = function () {
  var row = this.root.querySelectorAll('.epg-row')[this.focus.ch];
  if (!row) return;
  var block = row.querySelectorAll('.epg-prog')[this.focus.prog];
  if (!block) return;

  var sc = this.root.querySelector('#epgScroll');
  if (!sc) return;

  var bLeft = block.offsetLeft, bRight = bLeft + block.offsetWidth;
  if (bLeft < sc.scrollLeft) sc.scrollLeft = bLeft - 8;
  else if (bRight > sc.scrollLeft + sc.clientWidth) {
    sc.scrollLeft = bRight - sc.clientWidth + 8;
  }
  block.scrollIntoView ? null : null;
};

/** Al abrir la guia, deja el canal actual a la vista. */
Guide.prototype._scrollToNow = function () {
  var sc = this.root.querySelector('#epgScroll');
  if (!sc || this.dayOffset !== 0) return;
  var winStart = this.windowStart();
  var pct = (Date.now() - winStart) / (this.hours * Epg.HOUR_MS);
  sc.scrollLeft = Math.max(0, pct * sc.clientWidth - sc.clientWidth * 0.25);
};