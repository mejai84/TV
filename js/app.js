/**
 * app.js — Interfaz de television: lateral de categorias + carrusel + estanterias.
 *
 * Diseno equivalente al del cliente original: una columna lateral de categorias
 * (ColumnListAty), un carrusel grande de destacados y filas horizontales de
 * contenido (ShelveData). Es lo que hace que un mando D-pad funcione sin scroll
 * fino, a diferencia de una rejilla plana.
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
   * Iconos del lateral. Emojiegis: cada uno es un solo caracter, sin
   * peticiones de red, y todos los navegadores los pintan.
   * ---------------------------------------------------------------- */
  var ICONS = [
    [/tv|televis|live|directo|general|destacad|principal|vod|pelicula|cine/i, '\uD83D\uDCFA'],
    [/serie|drama|telenovela/i, '\uD83C\uDFAC'],
    [/kidd|infantil|children|Disney/i, '\uD83C\uDF1A'],
    [/anime|anime|toon/i, '\uD83D\uDC80'],
    [/deport|sport|futbol|caja/i, '\u26BD'],
    [/notic|news|actualidad|informativ/i, '\uD83D\uDCF0'],
    [/document|docu|cientific/i, '\uD83D\uDCD6'],
    [/musica|music/i, '\uD83C\uDFB5'],
    [/adult|xxx|erotic/i, '\uD83D\uDD11'],
    [/relig|creencias/i, '\u271D'],
    [/guia|tvguia/i, '\uD83D\uDCC5'],
    [/explor|buscar|search/i, '\uD83D\uDD0D']
  ];

  function iconFor(name) {
    for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(name)) return ICONS[i][1];
    return '\uD83D\uDCFA';
  }

  /* ---------------------------------------------------------------- *
   * Estado
   * ---------------------------------------------------------------- */
  var state = {
    adapter: null,
    items: [],
    groups: [],            // [{ name, items: [...] }]
    side: [],              // [{ type:'group', idx } | { type:'guide' } | { type:'search' }]
    byId: {},
    onAir: {},
    epgItems: [],
    hero: [],              // [{ item, group }]
    heroAt: 0,
    query: '',
    screen: 'catalog',
    zone: 'cat',           // 'cat' (lateral) | 'hero' | 'shelf'
    cat: 0,
    shelf: 0,
    card: 0
  };

  var player = null;
  var guide = null;
  var heroTimer = null;
  var el = {};
  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- *
   * Arranque
   * ---------------------------------------------------------------- */
  function boot() {
    el.shelves   = $('shelves');
    el.hero      = $('hero');
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

    state.adapter = buildAdapter(activeSource());

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

    el.search.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 || e.keyCode === 27) el.search.blur();
    });

    $('btnSearch').addEventListener('click', function () { openSearch(); });
    $('btnGuide').addEventListener('click', function () { showScreen('guide'); });
    bindSwipe();

    applyBrand();

    window.TV = { state: state, guide: guide, player: player, show: showScreen, reload: loadCatalog };

    loadCatalog();
  }

  /** CONFIG.brand.name personalize el logotipo del cliente. */
  function applyBrand() {
    var name = (CONFIG.brand && CONFIG.brand.name) || '';
    if (!name) return;
    var parts = Utils.trim(name).split(/\s+/);
    el.brand.querySelector('.brandMark').textContent = parts[0].charAt(0).toUpperCase();
    el.brand.querySelector('.brandText').innerHTML =
      Utils.esc(parts.slice(1).join(' ') || parts[0]) + '<em>TV</em>';
  }

  function loadCatalog() {
    state.adapter.list().then(function (items) {
      state.items = items || [];
      state.byId = {};
      for (var i = 0; i < state.items.length; i++) state.byId[state.items[i].id] = state.items[i];
      buildGroups();
      render();
      startHero();
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
      buildSide();
      return;
    }

    var map = {}, order = [];
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
    buildSide();
    buildHero();
  }

  /** Lateral: una entrada por grupo, mas las accesos fijos de la aplicacion. */
  function buildSide() {
    var side = [];
    for (var i = 0; i < state.groups.length; i++) {
      side.push({ type: 'group', idx: i, name: state.groups[i].name, count: state.groups[i].items.length });
    }
    side.push({ type: 'search', name: 'Explorar', count: 0 });
    side.push({ type: 'guide',  name: 'Guia de TV', count: 0 });
    state.side = side;
    if (state.cat >= side.length) state.cat = 0;
  }

  /**
   * Destacados del carrusel: se reparte el catalogo para que no salgan cinco
   * canales del mismo grupo, y se prefieren los que traen logotipo.
   */
  function buildHero() {
    var pool = state.items || [];
    var picked = [], used = {};

    for (var pass = 0; pass < 2 && picked.length < 8; pass++) {
      var step = Math.max(1, Math.floor(pool.length / 8));
      for (var i = 0; i < pool.length && picked.length < 8; i += step) {
        var it = pool[i];
        if (!it || used[it.id]) continue;
        if (pass === 0 && !it.poster) continue;    // 1a pasada: solo con imagen
        used[it.id] = 1;
        picked.push({ item: it, group: it.group || 'Destacado' });
      }
    }

    state.hero = picked;
    if (state.heroAt >= picked.length) state.heroAt = 0;
  }

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  function render() {
    renderCategories();
    renderHero();
    renderShelves();
    paintFocus();
  }

  function renderCategories() {
    var html = '<div class="sidehead">Navegacion</div>';
    for (var i = 0; i < state.side.length; i++) {
      var it = state.side[i];
      html += '<button class="sideItem" data-cat="' + i + '" tabindex="0">' +
              '<span class="si">' + iconFor(it.name) + '</span>' +
              '<span class="st">' + Utils.esc(it.name) + '</span>' +
              (it.count ? '<span class="sn">' + it.count + '</span>' : '') +
              '</button>';
    }
    el.cats.innerHTML = html;

    var nodes = el.cats.querySelectorAll('.sideItem');
    for (var j = 0; j < nodes.length; j++) {
      (function (n, idx) {
        n.addEventListener('click', function () { selectCategory(idx); });
      })(nodes[j], j);
    }
  }

  function renderHero() {
    if (!state.hero.length) {
      el.hero.innerHTML = '<div class="heroEmpty">Sin destacados todavia. ' +
        'Revisa <code>CONFIG.source</code> en <code>js/config.js</code>.</div>';
      return;
    }

    var html = '<div class="heroTrack" id="heroTrack">';
    for (var i = 0; i < state.hero.length; i++) {
      var h = state.hero[i];
      var it = h.item;
      var live = state.onAir[it.id] || state.onAir[it.tvgId];

      html += '<div class="slide" data-slide="' + i + '">';
      html += it.poster
        ? '<div class="artbg" style="background-image:url(\'' + Utils.esc(it.poster) + '\')"></div>'
        : '<div class="artbg blank"></div>';
      if (it.poster) {
        html += '<img class="art" src="' + Utils.esc(it.poster) + '" alt="" ' +
                'onerror="this.className=\'art blank\';this.remove();">';
      }
      html += '<div class="scrim"></div>' +
              '<div class="info">' +
                '<span class="chip">' + Utils.esc(h.group) + '</span>' +
                '<h1>' + Utils.esc(it.title) + '</h1>' +
                (live ? '<p>Ahora: ' + Utils.esc(live) + '</p>' : '<p></p>') +
                '<div class="meta">' +
                  '<span class="tag live">EN VIVO</span>' +
                  (live ? '<span class="tag">' + Utils.esc(live) + '</span>' : '') +
                '</div>' +
              '</div></div>';
    }
    html += '</div>' +
            '<div class="edge l"></div><div class="edge r"></div>' +
            '<div class="heroDots" id="heroDots">';
    for (var d = 0; d < state.hero.length; d++) {
      html += '<i data-dot="' + d + '"></i>';
    }
    html += '</div>';

    el.hero.innerHTML = html;

    var slides = el.hero.querySelectorAll('.slide');
    for (var s = 0; s < slides.length; s++) {
      (function (n) {
        n.addEventListener('click', function () {
          var idx = parseInt(n.getAttribute('data-slide'), 10);
          state.heroAt = idx;
          paintFocus();
          var h = state.hero[idx];
          if (h) playItem(h.item);
        });
      })(slides[s]);
    }

    var dots = el.hero.querySelectorAll('.heroDots i');
    for (var q = 0; q < dots.length; q++) {
      (function (n) {
        n.addEventListener('click', function (e) {
          e.stopPropagation();
          state.heroAt = parseInt(n.getAttribute('data-dot'), 10);
          paintFocus();
        });
      })(dots[q]);
    }

    paintHero();
  }

  function paintHero() {
    var track = $('heroTrack');
    if (track) track.style.transform = 'translateX(' + (-100 * state.heroAt) + '%)';

    var slides = el.hero.querySelectorAll('.slide');
    for (var i = 0; i < slides.length; i++) {
      slides[i].className = slides[i].className.replace(/\s*active\b/, '');
    }
    if (slides[state.heroAt]) slides[state.heroAt].className += ' active';

    var dots = el.hero.querySelectorAll('.heroDots i');
    for (var j = 0; j < dots.length; j++) {
      dots[j].className = (j === state.heroAt) ? 'on' : '';
    }
  }

  /**
   * Deslizar el carrusel con el dedo. En televisor esto no pasa, porque
   * ahi se mueve con el D-pad; se registra igualmente porque solo se
   * dispara si el dedo toca la pantalla.
   */
  function bindSwipe() {
    var x0 = 0, y0 = 0, tracking = false;

    el.hero.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      tracking = true;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    }, false);

    el.hero.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      if (!t) return;

      var dx = t.clientX - x0, dy = t.clientY - y0;
      // Solo si el gesto fue claramente horizontal: si el dedo se fue
      // hacia arriba es un scroll y no debe cambiar de slide.
      if (Math.abs(dx) < 45 || Math.abs(dy) > Math.abs(dx)) return;

      var next = state.heroAt + (dx < 0 ? 1 : -1);
      if (next >= 0 && next < state.hero.length) {
        state.heroAt = next;
        paintFocus();
      }
    }, false);
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
      html += '<section class="shelf" data-shelf="' + s + '">' +
                '<div class="shelfhead"><h2>' + Utils.esc(g.name) + '</h2>' +
                '<em>' + g.items.length + ' canales</em><span class="rule"></span></div>' +
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
    var it = state.side[idx];
    if (!it) return;
    state.cat = idx;

    if (it.type === 'search') { render(); paintFocus(); openSearch(); return; }
    if (it.type === 'guide')  { render(); paintFocus(); showScreen('guide'); return; }

    state.shelf = it.idx;
    state.card = 0;
    state.zone = 'shelf';
    render();
    revealCard();
  }

  function openSearch() {
    el.search.className = 'search open';
    el.search.focus();
    // En televisor se teclea con el mando (hay que abrir el teclado en
    // pantalla); en movil y tableta ya hay teclado fisico y el aviso sobra.
    toast(isTouch() ? 'Escribe el nombre de un canal'
                    : 'Escribe con el teclado remoto y pulsa BACK para cerrar');
  }

  /** true en movil o tableta: cambia el texto de ayuda, no el comportamiento. */
  function isTouch() {
    return !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  }

  function closeSearch() {
    el.search.className = 'search';
    el.search.blur();
  }

  /* ---------------------------------------------------------------- *
   * Foco
   * ---------------------------------------------------------------- */
  function paintFocus() {
    var cats = el.cats.querySelectorAll('.sideItem');
    for (var i = 0; i < cats.length; i++) {
      cats[i].className = cats[i].className.replace(/\s*active\b/, '');
    }
    if (state.zone === 'cat' && cats[state.cat]) cats[state.cat].className += ' active';

    if (el.hero) el.hero.className = el.hero.className.replace(/\s*focused\b/, '');
    if (state.zone === 'hero') el.hero.className += ' focused';
    paintHero();

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
    // En movil el contenedor es un bloque que se desplaza; si se deja en
    // block, Safari y WebKit de Android lo comentan al cambiar de pantalla
    // y al volver el contenido aparece en blanco.
    el.guideUI.style.display   = (name === 'guide')   ? 'block' : 'none';
    el.playerUI.style.display  = (name === 'player')  ? 'block' : 'none';
    if (name !== 'player') player.stop(true);
    if (name === 'player') stopHero();
    else if (name === 'catalog') startHero();

    el.tabCatalog.className = (name === 'catalog') ? 'active' : '';
    el.tabGuide.className   = (name === 'guide')   ? 'active' : '';

    if (name === 'guide' && guide) guide.render();
  }

  /* ---------------------------------------------------------------- *
   * Rotacion automatica de los destacados
   * ---------------------------------------------------------------- */
  function startHero() {
    stopHero();
    if (!state.hero.length || state.hero.length < 2) return;
    heroTimer = setInterval(function () {
      if (state.screen !== 'catalog') return;
      state.heroAt = (state.heroAt + 1) % state.hero.length;
      paintFocus();
    }, 7000);
  }

  function stopHero() {
    if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
  }

  /* ---------------------------------------------------------------- *
   * Navegacion
   * ---------------------------------------------------------------- */
  function bindInput() {
    document.addEventListener('keydown', function (e) {
      if (e.target === el.search && e.keyCode !== 27 && e.keyCode !== 8) return;

      if (isKey(e, KEY.OK)) {
        if (state.screen === 'catalog') {
          if (state.zone === 'cat') selectCategory(state.cat);
          else if (state.zone === 'hero') {
            var h = state.hero[state.heroAt];
            if (h) playItem(h.item);
          } else {
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
        else if (el.search === document.activeElement || el.search.value) {
          el.search.value = ''; state.query = ''; closeSearch(); buildGroups(); render();
        }
        else if (state.zone === 'shelf') { state.zone = 'hero'; paintFocus(); }
        else if (state.zone === 'hero') { state.zone = 'cat'; paintFocus(); }
        else if (window.history.length > 1) { window.history.back(); }
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
    /* ---- lateral ---- */
    if (state.zone === 'cat') {
      if (dr) {
        state.cat = Math.max(0, Math.min(state.side.length - 1, state.cat + dr));
        paintFocus();
      }
      if (dc > 0) { state.zone = 'hero'; paintFocus(); }
      else if (dc < 0 && el.search.value) { closeSearch(); }
      return true;
    }

    /* ---- carrusel ---- */
    if (state.zone === 'hero') {
      if (dc) {
        var next = state.heroAt + dc;
        if (next < 0) state.zone = 'cat';
        else if (next < state.hero.length) state.heroAt = next;
      }
      if (dr > 0) {
        state.zone = 'shelf';
        var it = state.side[state.cat];
        state.shelf = (it && it.type === 'group') ? it.idx : state.shelf;
        state.card = 0;
        renderShelves();
        revealCard();
      }
      paintFocus();
      return true;
    }

    /* ---- estanterias ---- */
    var g = state.groups[state.shelf];
    if (!g) return false;
    var len = Math.min(g.items.length, 40);

    if (dc) {
      if (dc > 0) state.card = Math.min(len - 1, state.card + 1);
      else if (state.card > 0) state.card -= 1;
      else { state.zone = 'hero'; }        // izquierda en el primer elemento
    }

    if (dr) {
      var prev = state.shelf;
      var target = prev + dr;
      if (target < 0) { state.zone = 'hero'; state.card = 0; }
      else if (target < state.groups.length) {
        state.shelf = target;
        state.card = Math.min(state.card, Math.max(0, Math.min(state.groups[target].items.length, 40) - 1));
        // Solo se repinta si la estanteria enfocada entra o sale de la ventana
        // de 9 filas que se pinta alrededor del foco.
        if (target < 4 || target >= state.groups.length - 5 || Math.abs(target - prev) > 4) {
          renderShelves();
        }
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
        else if (state.zone === 'hero') { var h = state.hero[state.heroAt]; if (h) playItem(h.item); }
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

  var WEEK = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  var MONTH = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

  function startClock() {
    function tick() {
      var d = new Date();
      var h = d.getHours();
      var ap = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12; if (h12 === 0) h12 = 12;
      el.clock.innerHTML =
        Epg.pad2(h12) + ':' + Epg.pad2(d.getMinutes()) + ' ' + ap +
        '<small>' + WEEK[d.getDay()] + ' ' + Epg.pad2(d.getDate()) + ' ' + MONTH[d.getMonth()] + '</small>';
    }
    tick();
    setInterval(tick, 15000);
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
    renderHero();
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