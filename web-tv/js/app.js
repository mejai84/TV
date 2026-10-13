/**
 * app.js — Interfaz de television: columna de categorias + estanterias.
 *
 * Diseno equivalente al del cliente original: una columna lateral de categorias
 * (ColumnListAty) y filas horizontales de contenido (ShelveData). Es lo que hace
 * que un mando D-pad funcione sin scroll fino, a diferencia de una rejilla plana.
 *
 * El teclado se mapea por codigo de tecla, nunca por caracter: un mando de
 * televisor no es un teclado. Se cubren Android TV y webOS/VIDAA.
 */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- *
   * Mandos
   * ---------------------------------------------------------------- */
  var KEY = {
    OK:      [13, 23, 66],
    LEFT:    [37, 21],
    RIGHT:   [39, 22],
    UP:      [38, 19],
    DOWN:    [40, 20],
    BACK:    [8, 461, 10009, 111]
  };

  function isKey(e, list) {
    for (var i = 0; i < list.length; i++) if (e.keyCode === list[i]) return true;
    return false;
  }

  /* ---------------------------------------------------------------- *
   * Estado
   * ---------------------------------------------------------------- */
  var state = {
    adapter: null,
    items: [],
    groups: [],            // [{ name, items: [...] }]
    byId: {},
    onAir: {},
    epgItems: [],
    query: '',
    screen: 'catalog',
    zone: 'cat',           // 'cat' (lateral) | 'shelf'
    cat: 0,
    shelf: 0,
    card: 0
  };

  var player = null;
  var guide = null;
  var el = {};
  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- *
   * Arranque
   * ---------------------------------------------------------------- */
  function boot() {
    el.shelves   = $('shelves');
    el.cats      = $('categories');
    el.status    = $('playerStatus');
    el.playerUI  = $('playerScreen');
    el.catalogUI = $('catalogScreen');
    el.guideUI   = $('guideScreen');
    el.epgRoot   = $('epg');
    el.tabCatalog= $('tabCatalog');
    el.tabGuide  = $('tabGuide');
    el.clock     = $('clock');
    el.video     = $('video');
    el.title     = $('nowTitle');
    el.quality   = $('quality');
    el.brand     = $('brand');
    el.search    = $('searchInput');
    el.toast     = $('toast');

    player = new Player(el.video, el.status);
    player.onError = function (m) { toast(m); };
    player.onLevels = function (l) { renderQuality(l); };

    guide = new Guide(el.epgRoot, {
      hours: (CONFIG.epg && CONFIG.epg.hours) || 6,
      onPlay: function (sel) {
        var item = state.byId[sel.channelId];
        if (!item) { toast('Ese canal no esta en el catalogo'); return; }
        playItem(item);
      }
    });

    state.adapter = buildAdapter(CONFIG.source);

    bindInput();
    bindRemote();
    bindTabs();
    startClock();

    el.search.addEventListener('input', function () {
      state.query = Utils.trim(el.search.value).toLowerCase();
      // Al buscar se ignoran las categorias: se muestra todo en una sola
      // estanteria, que es lo unico manejable con el mando.
      state.zone = 'shelf';
      buildGroups();
      render();
    });

    window.TV = { state: state, guide: guide, player: player, show: showScreen, reload: loadCatalog };

    loadCatalog();
  }

  function loadCatalog() {
    state.adapter.list().then(function (items) {
      state.items = items || [];
      state.byId = {};
      for (var i = 0; i < state.items.length; i++) state.byId[state.items[i].id] = state.items[i];
      buildGroups();
      render();
      return loadEpg();
    }).catch(function (e) {
      toast('No se pudo cargar el catalogo: ' + e.message);
    });
  }

  /* ---------------------------------------------------------------- *
   * Agrupacion
   * ---------------------------------------------------------------- */
  function buildGroups() {
    if (state.query) {
      var hits = [];
      for (var i = 0; i < state.items.length; i++) {
        if (String(state.items[i].title).toLowerCase().indexOf(state.query) > -1) hits.push(state.items[i]);
      }
      state.groups = [{ name: 'Resultados (' + hits.length + ')', items: hits, artificial: true }];
      return;
    }

    var map = {}, order = [], q = state.query;
    for (var j = 0; j < state.items.length; j++) {
      var it = state.items[j];
      var g = it.group || 'Otros';
      if (!Object.prototype.hasOwnProperty.call(map, g)) { map[g] = []; order.push(g); }
      map[g].push(it);
    }

    var groups = [];
    for (var k = 0; k < order.length; k++) {
      groups.push({ name: order[k], items: map[order[k]] });
    }

    // "Todos" primero, y una estanteria deccion destacada arriba.
    groups.unshift({ name: 'Todos los canales', items: state.items.slice() });

    state.groups = groups;
  }

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  function render() {
    renderCategories();
    renderShelves();
    paintFocus();
  }

  function renderCategories() {
    var html = '<div class="sidehead">Categorias</div>';
    for (var i = 0; i < state.groups.length; i++) {
      html += '<button class="cat" data-cat="' + i + '" tabindex="0">' +
              Utils.esc(state.groups[i].name) +
              ' <em style="color:#5d6675;font-style:normal">' + state.groups[i].items.length + '</em>' +
              '</button>';
    }
    el.cats.innerHTML = html;

    var nodes = el.cats.querySelectorAll('.cat');
    for (var j = 0; j < nodes.length; j++) {
      (function (n, idx) {
        n.addEventListener('click', function () { selectCategory(idx); });
      })(nodes[j], j);
    }
  }

  function renderShelves() {
    if (!state.groups.length) {
      el.shelves.innerHTML = '<div class="epg-empty">Nada que mostrar.<br>' +
        'Revisa <code>CONFIG.source</code> en <code>js/config.js</code>.</div>';
      return;
    }

    var html = '';
    // Se muestran las 14 estanterias alrededor del foco para no pintar
    // 44 listas de 300 canales cada una en cada repintado.
    var from = Math.max(0, state.shelf - 4);
    var to = Math.min(state.groups.length, from + 9);

    for (var s = from; s < to; s++) {
      var g = state.groups[s];
      var shelfIdx = s - from;
      html += '<section class="shelf" data-shelf="' + s + '">' +
                '<div class="shelfhead"><h2>' + Utils.esc(g.name) + '</h2>' +
                '<em>' + g.items.length + ' canales</em></div>' +
                '<div class="row" id="row-' + s + '">';

      var limit = Math.min(g.items.length, 40);
      for (var i = 0; i < limit; i++) {
        var it = g.items[i];
        var live = state.onAir[it.id] || state.onAir[it.tvgId];
        var focused = (s === state.shelf && i === state.card);

        html += '<div class="card' + (focused ? ' focused' : '') +
                  '" data-shelf="' + s + '" data-card="' + i + '" tabindex="0">';

        if (it.poster) {
          html += '<div class="thumb"><img src="' + Utils.esc(it.poster) + '" alt="" ' +
                  'onerror="this.parentNode.className=\'thumb blank\';this.remove();"></div>';
        } else {
          html += '<div class="thumb blank"></div>';
        }

        html += '<span class="badge live">EN VIVO</span>' +
                (live ? '<span class="live idle">AHORA</span>' : '') +
                '<div class="ttl">' + Utils.esc(it.title) + '</div>' +
                (live ? '<span class="onair">' + Utils.esc(live) + '</span>' : '') +
                '</div>';
      }

      html += '</div></section>';
    }
    el.shelves.innerHTML = html;

    var cards = el.shelves.querySelectorAll('.card');
    for (var c = 0; c < cards.length; c++) {
      (function (n) {
        n.addEventListener('click', function () {
          var s = parseInt(n.getAttribute('data-shelf'), 10);
          var d = parseInt(n.getAttribute('data-card'), 10);
          state.shelf = s; state.card = d; state.zone = 'shelf';
          var it = state.groups[s] && state.groups[s].items[d];
          if (it) playItem(it);
        });
      })(cards[c]);
    }
  }

  function selectCategory(idx) {
    state.cat = idx;
    state.shelf = idx;
    state.card = 0;
    state.zone = 'shelf';
    render();
    revealCard();
  }

  /* ---------------------------------------------------------------- *
   * Foco
   * ---------------------------------------------------------------- */
  function paintFocus() {
    var cats = el.cats.querySelectorAll('.cat');
    for (var i = 0; i < cats.length; i++) {
      cats[i].className = cats[i].className.replace(/\s*active\b/, '');
    }
    if (state.zone === 'cat' && cats[state.cat]) cats[state.cat].className += ' active';

    var cards = el.shelves.querySelectorAll('.card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].className = cards[j].className.replace(/\s*focused\b/, '');
    }
    if (state.zone === 'shelf') {
      var node = cardNode();
      if (node) node.className += ' focused';
    }
  }

  function cardNode() {
    var sel = '.card[data-shelf="' + state.shelf + '"][data-card="' + state.card + '"]';
    return el.shelves.querySelector(sel);
  }

  /** Mantiene la ficha enfocada dentro de la vista horizontal y vertical. */
  function revealCard() {
    var node = cardNode();
    if (!node) return;

    var row = node.parentNode;
    var left = node.offsetLeft, right = left + node.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left - 20;
    else if (right > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = right - row.clientWidth + 20;
    }

    var top = node.offsetTop, bottom = top + node.offsetHeight;
    var vt = el.shelves.scrollTop, vb = vt + el.shelves.clientHeight;
    if (top < vt) el.shelves.scrollTop = top - 20;
    else if (bottom > vb) el.shelves.scrollTop = bottom - el.shelves.clientHeight + 20;
  }

  /* ---------------------------------------------------------------- *
   * Reproduccion
   * ---------------------------------------------------------------- */
  function playItem(item) {
    el.title.textContent = item.title || '';
    el.quality.innerHTML = '';
    showScreen('player');
    state.adapter.resolve(item).then(function (streams) {
      if (!streams || !streams.length) {
        toast('Sin URL disponible para "' + item.title + '"');
        return;
      }
      return player.play(item, streams, function (i) { return state.adapter.resolve(i); });
    }).catch(function (e) {
      toast('Error al resolver: ' + e.message);
    });
  }

  function renderQuality(levels) {
    if (!CONFIG.allowQualitySwitch || !levels.length) { el.quality.innerHTML = ''; return; }
    var html = '<button class="q" data-level="-1" tabindex="0">Auto</button>';
    var seen = {};
    for (var i = 0; i < levels.length; i++) {
      var h = levels[i].height || (Math.round(levels[i].bitrate / 1000) + 'k');
      if (Object.prototype.hasOwnProperty.call(seen, h)) continue;
      seen[h] = 1;
      html += '<button class="q" data-level="' + levels[i].index + '" tabindex="0">' +
              Utils.esc(h) + 'p</button>';
    }
    el.quality.innerHTML = html;
    var bs = el.quality.querySelectorAll('.q');
    for (var j = 0; j < bs.length; j++) {
      (function (n) {
        n.addEventListener('click', function () {
          player.setLevel(parseInt(n.getAttribute('data-level'), 10));
          for (var k = 0; k < bs.length; k++) bs[k].className = bs[k].className.replace(/\s*active\b/, '');
          n.className += ' active';
        });
      })(bs[j]);
    }
  }

  function showScreen(name) {
    state.screen = name;
    el.catalogUI.style.display = (name === 'catalog') ? 'block' : 'none';
    el.guideUI.style.display   = (name === 'guide')   ? 'block' : 'none';
    el.playerUI.style.display  = (name === 'player')  ? 'block' : 'none';
    if (name !== 'player') player.stop(true);

    el.tabCatalog.className = (name === 'catalog') ? 'active' : '';
    el.tabGuide.className   = (name === 'guide')   ? 'active' : '';

    if (name === 'guide' && guide) guide.render();
  }

  /* ---------------------------------------------------------------- *
   * Navegacion
   * ---------------------------------------------------------------- */
  function bindInput() {
    document.addEventListener('keydown', function (e) {
      if (e.target === el.search && e.keyCode !== 27) return;

      if (isKey(e, KEY.OK)) {
        if (state.screen === 'catalog') {
          if (state.zone === 'cat') { selectCategory(state.cat); }
          else {
            var it = state.groups[state.shelf] && state.groups[state.shelf].items[state.card];
            if (it) playItem(it);
          }
        } else if (state.screen === 'guide') {
          guide.activate();
        } else {
          var p = el.video.play(); if (p && p.catch) p.catch(function () {});
        }
        e.preventDefault(); return;
      }

      if (isKey(e, KEY.BACK)) {
        if (state.screen === 'player') { showScreen('catalog'); }
        else if (state.screen === 'guide') { showScreen('catalog'); }
        else if (state.zone === 'shelf') { state.zone = 'cat'; paintFocus(); }
        else if (el.search.value) {
          el.search.value = ''; state.query = ''; buildGroups(); render();
        } else if (window.history.length > 1) { window.history.back(); }
        e.preventDefault(); return;
      }

      if (state.screen === 'guide') {
        var dc = 0, dr = 0;
        if (isKey(e, KEY.RIGHT)) dc = 1;
        else if (isKey(e, KEY.LEFT)) dc = -1;
        else if (isKey(e, KEY.DOWN)) dr = 1;
        else if (isKey(e, KEY.UP)) dr = -1;
        else return;
        guide.move(dc, dr);
        e.preventDefault(); return;
      }

      if (state.screen !== 'catalog') return;
      if (move(isKey(e, KEY.LEFT) ? -1 : isKey(e, KEY.RIGHT) ? 1 : 0,
               isKey(e, KEY.UP) ? -1 : isKey(e, KEY.DOWN) ? 1 : 0)) {
        e.preventDefault();
      }
    });
  }

  /** dc horizontal, dr vertical. Devuelve true si consumio la pulsacion. */
  function move(dc, dr) {
    if (state.zone === 'cat') {
      if (dr) {
        state.cat = Math.max(0, Math.min(state.groups.length - 1, state.cat + dr));
        paintFocus();
      }
      if (dc > 0) { state.zone = 'shelf'; state.shelf = state.cat; state.card = 0; renderShelves(); paintFocus(); revealCard(); }
      return true;
    }

    var g = state.groups[state.shelf];
    if (!g) return false;
    var len = Math.min(g.items.length, 40);

    if (dc) {
      if (dc > 0) state.card = Math.min(len - 1, state.card + 1);
      else if (state.card > 0) state.card -= 1;
      else { state.zone = 'cat'; }        // izquierda en el primer elemento
    }

    if (dr) {
      var next = state.shelf + dr;
      if (next >= 0 && next < state.groups.length) {
        state.shelf = next;
        state.card = Math.min(state.card, Math.max(0, Math.min(state.groups[next].items.length, 40) - 1));
        if (next - state.shelf < -4 || next - state.shelf > 8) renderShelves();
      }
    }

    paintFocus();
    if (state.zone === 'shelf') revealCard();
    return true;
  }

  function bindRemote() {
    if (window.navigator && navigator.remote && navigator.remote.playButton) {
      navigator.remote.playButton.addEventListener('click', function () {
        if (state.screen !== 'catalog') return;
        if (state.zone === 'cat') selectCategory(state.cat);
        else {
          var it = state.groups[state.shelf] && state.groups[state.shelf].items[state.card];
          if (it) playItem(it);
        }
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Pestanas, reloj, guia
   * ---------------------------------------------------------------- */
  function bindTabs() {
    el.tabCatalog.addEventListener('click', function () { showScreen('catalog'); });
    el.tabGuide.addEventListener('click', function () { showScreen('guide'); });
  }

  function startClock() {
    function tick() {
      var d = new Date();
      el.clock.textContent = Epg.fmtDay(d.getTime()) + '  ' +
        Epg.pad2(d.getHours()) + ':' + Epg.pad2(d.getMinutes());
    }
    tick();
    setInterval(tick, 30000);
  }

  function loadEpg() {
    var url = (CONFIG.epg && CONFIG.epg.url) || '';
    if (!url || !state.adapter.epg) { guide.setData([]); return Promise.resolve(); }
    return state.adapter.epg().then(function (raw) {
      var items = EpgSource.matchToCatalog(raw || [], state.items);
      state.epgItems = items;
      guide.setData(items);
      if (items.length) paintOnAir();
      return items;
    }).catch(function (e) {
      if (window.console && console.warn) console.warn('EPG: no se pudo cargar', e);
      guide.setData([]);
      return [];
    });
  }

  function paintOnAir() {
    var now = Date.now();
    var byCh = Epg.byChannel(state.epgItems);
    state.onAir = {};
    for (var ch in byCh.map) {
      if (!Object.prototype.hasOwnProperty.call(byCh.map, ch)) continue;
      var i = Epg.current(byCh.map[ch], now);
      if (i > -1) state.onAir[ch] = byCh.map[ch][i].title;
    }
    renderShelves();
    paintFocus();
  }

  /* ---------------------------------------------------------------- */
  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.style.display = 'none'; }, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();