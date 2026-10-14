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

  /** Caratulas que se pintan de golpe en una estanteria. */
  var CHUNK = 40;

  /* ---------------------------------------------------------------- *
   * Categorias de iptv-org: vienen en ingles y agrupadas con ';', asi que
   * se traducen y se les asigna un tema para el fondo de la pantalla.
   *
   * El tema no es una imagen generada (no se pueden generar aqui y
   * meterian peso y peticiones de red) sino un degradado CSS por familia,
   * que son unos pocos KiB y se pintan al instante en cualquier motor.
   * ---------------------------------------------------------------- */
  var CATEGORIAS = [
    [/^sports?|deportes/i,        'Deportes',      'sports'],
    [/^movies?|peliculas?/i,      'Peliculas',     'movies'],
    [/^series?/i,                 'Series',        'series'],
    [/^kids?|children|infantil/i, 'Infantil',      'kids'],
    [/^animation|anime/i,         'Animacion',     'kids'],
    [/^news|noticias|actualidad/i,'Noticias',      'news'],
    [/^documentary|documentales/i,'Documentales',  'docs'],
    [/^music|musica/i,            'Musica',        'music'],
    [/^entertainment|entretenim/i,'Entretenimiento','entertainment'],
    [/^comedy|comedia/i,          'Comedia',       'entertainment'],
    [/^religious|religios/i,      'Religiosos',    'faith'],
    [/^culture|cultura/i,         'Cultura',       'culture'],
    [/^classic|clasicos?/i,       'Clasicos',      'culture'],
    [/^lifestyle|estilo/i,        'Estilo de vida','lifestyle'],
    [/^family|familiar/i,         'Familiar',      'family'],
    [/^cooking|cocina/i,          'Cocina',        'lifestyle'],
    [/^travel|viajes/i,           'Viajes',        'lifestyle'],
    [/^auto|motor/i,              'Motor',         'sports'],
    [/^outdoor|aire libre/i,      'Aire libre',    'sports'],
    [/^business|negocios/i,       'Negocios',      'business'],
    [/^education|educacion/i,     'Educacion',     'education'],
    [/^legislative|legislativo/i, 'Legislativo',   'education'],
    [/^health|salud/i,            'Salud',         'education'],
    [/^weather|meteorolog/i,      'Meteorologia',  'news'],
    [/^public|publico/i,          'Publico',       'public'],
    [/^classic$/i,                'Clasicos',      'culture'],
    [/^other|otros|undefined/i,   'Otros',         'other']
  ];

  /** Devuelve [nombre en espanol, tema] para un group-title de iptv-org. */
  function categoriaEs(nombre) {
    var n = String(nombre || '');
    for (var i = 0; i < CATEGORIAS.length; i++) {
      if (CATEGORIAS[i][0].test(n)) return [CATEGORIAS[i][1], CATEGORIAS[i][2]];
    }
    // Sin coincidencia: se conserva el nombre original, en mayusculas y
    // sin acentos raros, para que al menos se lea bien en pantalla.
    return [n || 'Otros', 'other'];
  }

  /* ---------------------------------------------------------------- *
   * Iconos del lateral. Cada entrada devuelve un nombre de clase, no un
   * caracter: los emojis no existen en los navegadores nativos de
   * televisor y salian como recuadros vacios. Las formas se dibujan con
   * CSS puro a partir de estas clases (ver .si en app.css).
   * ---------------------------------------------------------------- */
  var ICONS = [
    [/serie|drama|telenovela/i, 'serie'],
    [/kidd|infantil|children|Disney/i, 'kids'],
    [/anime|anime|toon/i, 'anime'],
    [/deport|sport|futbol|caja/i, 'sport'],
    [/notic|news|actualidad|informativ/i, 'news'],
    [/document|docu|cientific/i, 'doc'],
    [/musica|music/i, 'music'],
    [/adult|xxx|erotic/i, 'lock'],
    [/relig|creencias/i, 'cross'],
    [/guia|tvguia/i, 'guide'],
    [/explor|buscar|search/i, 'search'],
    [/tv|televis|live|directo|general|destacad|principal|vod|pelicula|cine/i, 'tv']
  ];

  function iconFor(name) {
    for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(name)) return ICONS[i][1];
    return 'tv';
  }

  /**
   * Listas de iptv-org que se pueden elegir desde el lateral. La primera
   * entrada es el indice completo, que es lo que se carga por defecto.
   *
   * Las de contenido llevan "Solo" porque en el mismo lateral aparecen
   * tambien las categorias con esos nombres: sin el prefijo, "Peliculas"
   * seria a la vez una lista y una categoria y no se sabria que abre.
   */
  var SOURCES = [
    { key: '',       name: 'Todos los paises' },
    { key: 'es',     name: 'España' },
    { key: 'lat',    name: 'Latino' },
    { key: 'mx',     name: 'México' },
    { key: 'uk',     name: 'UK' },
    { key: 'us',     name: 'USA' },
    { key: 'br',     name: 'Brasil' },
    { key: 'ar',     name: 'Argentina' },
    { key: 'movies', name: 'Solo Peliculas' },
    { key: 'series', name: 'Solo Series' },
    { key: 'kids',   name: 'Solo Infantil' },
    { key: 'news',   name: 'Solo Noticias' },
    { key: 'sports', name: 'Solo Deportes' }
  ];

  /* ---------------------------------------------------------------- *
   * Estado
   * ---------------------------------------------------------------- */
  var state = {
    adapter: null,
    items: [],
    groups: [],            // [{ name, items: [...] }]
    side: [],              // [{ type:'group'|'source'|'guide'|'search', ... }]
    activeSource: '',      // clave de la lista cargada, para marcarla
    shown: {},           // { shelfIndex: caratulas pintadas hasta ahora }
    todo: null,          // catalogo completo agrupado y traducido
    todoBase: 0,
    indice: null,        // indice de busqueda { n, t, g }
    filtro: '',          // categoria activa del buscador ('' = todas)
    byId: {},
    onAir: {},
    epgItems: [],
    hero: [],              // [{ item, group }]
    heroAt: 0,
    stopped: false,       // el canal se detuvo a proposito desde el reproductor
    playing: null,        // canal que se esta emitiendo, para poder reanudarlo
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
    el.brand     = $('brand') || null;
    el.search    = $('searchInput');
    el.toast     = $('toast');
    el.panel     = $('searchPanel');
    el.count     = $('searchCount');
    el.filters   = $('searchFilters');
    el.langBtn   = $('langSelect');
    el.btnPiP    = $('btnPiP');
    el.langBtn   = $('langSelect');
    el.btnPiP    = $('btnPiP');

    // Que lista esta cargada ahora, para marcarla en el lateral.
    state.activeSource = currentSourceKey();

    // Idioma de la UI: ES (español), EN (inglés), PT (portugués)
    state.lang = localStorage.getItem('tv_lang') || 'es';
    updateLangUI();

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

    // Resultados en vivo: busqueda incremental con debounce de 300ms.
    // Evita que el motor se dispare en cada tecla en televisores lentos.
    var searchTimeout = null;
    el.search.addEventListener('input', function () {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function () {
        state.query = Utils.trim(el.search.value);
        state.zone = 'shelf';
        state.card = 0;
        buildGroups();
        updateSearchUi();
      }, 300);
    });

    el.search.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 || e.keyCode === 27) el.search.blur();
    });

    var btnSearch = $('btnSearch');
    if (btnSearch) btnSearch.addEventListener('click', function () { openSearch(); });
    var btnGuide = $('btnGuide');
    if (btnGuide) btnGuide.addEventListener('click', function () { showScreen('guide'); });
    $('btnStop').addEventListener('click', function () { stopPlayback(); });
    $('btnBack').addEventListener('click', function () { goBackToList(); });

    // selector de idioma en la banda
    el.langBtn.addEventListener('click', function () {
      // ciclo: ES -> EN -> PT -> ES
      if (state.lang === 'es') state.lang = 'en';
      else if (state.lang === 'en') state.lang = 'pt';
      else state.lang = 'es';
      localStorage.setItem('tv_lang', state.lang);
      updateLangUI();
    });

    // Picture in Picture
    el.btnPiP.addEventListener('click', function () {
      var video = el.video;
      if (document.pictureInPictureElement === video) {
        document.exitPictureInPicture();
      } else {
        video.requestPictureInPicture().catch(function (error) {
          toast('No se pudo activar PiP: ' + error.message);
        });
      }
    });

    bindSwipe();

    applyBrand();

    window.TV = { state: state, guide: guide, player: player, show: showScreen, reload: loadCatalog };

    loadCatalog();
  }

  /** Lee de la URL la lista activa de iptv-org ('' = indice completo). */
  function currentSourceKey() {
    try {
      var m = /[?&]cc=([a-z0-9-]*)/i.exec(window.location.search || '');
      return (m ? m[1] : ((CONFIG.iptvorg || {}).country || '')).toLowerCase();
    } catch (e) {
      return (CONFIG.iptvorg || {}).country || '';
    }
  }

  /**
   * Logotipo opcional. Sin CONFIG.brand.name no se pinta nada: la
   * cabecera arranca directamente con las pestañas.
   */
  function applyBrand() {
    var name = (CONFIG.brand && CONFIG.brand.name) || '';
    var mark = $('brand'), markTop = $('brandMark'), markSub = $('brandText');
    if (!name || !mark) return;

    var parts = Utils.trim(name).split(/\s+/);
    markTop.textContent = parts[0].toUpperCase();
    markSub.innerHTML = Utils.esc(parts.slice(1).join(' ').toUpperCase());
  }

  function loadCatalog() {
    state.adapter.list().then(function (items) {
      state.items = items || [];
      state.byId = {};
      for (var i = 0; i < state.items.length; i++) state.byId[state.items[i].id] = state.items[i];
      buildGroups();
      render();
      startHero();
      if (!state.items.length) {
        // Sin esto la pantalla queda en negro sin explicar nada, que es lo
        // que mas desconcierta cuando una lista remota falla o va vacia.
        el.shelves.innerHTML =
          '<div class="epg-empty">No se encontro ninguna lista.<br>' +
          'Prueba otra fuente: <code>?src=iptvorg&amp;cc=gb</code>, ' +
          '<code>?cc=mx</code>, <code>?cc=uk</code> o <code>?cc=movies</code>.<br>' +
          'Revisa <code>CONFIG.iptvorg</code> en <code>js/config.js</code>.</div>';
        return;
      }
      // EPG loading disabled to prevent app hang;
      // guide accessible via Tab Guide
    }).catch(function (e) {
      toast('No se pudo cargar el catalogo: ' + e.message);
      el.shelves.innerHTML =
        '<div class="epg-empty">No se pudo cargar el catalogo.<br>' +
        Utils.esc(e.message) + '</div>';
    });
  }

  /* ---------------------------------------------------------------- *
   * Agrupacion
   * ---------------------------------------------------------------- */
  function buildGroups() {
    // El tema se fija antes de nada: al arrancar, la pantalla ya aparece
    // con el color de la primera categoria en vez de arrancar neutra y
    // cambiar despues.
    applyTheme('all');

    // El catalogo completo se monta una vez y se reutiliza: antes se
    // reconstruia en cada pulsacion de tecla al buscar, y con 11262
    // canales eso hacia que el buscador se trabara.
    if (!state.todo || state.todoBase !== state.items.length) {
      var mapa = {}, orden = [];
      for (var j = 0; j < state.items.length; j++) {
        var it = state.items[j];
        var g = it.group || 'Otros';
        if (!Object.prototype.hasOwnProperty.call(mapa, g)) { mapa[g] = []; orden.push(g); }
        mapa[g].push(it);
      }

      // Se traduce la categoria y se le asigna un tema antes de pintar nada:
      // los nombres de iptv-org vienen en ingles ('Sports', 'News') y salen
      // tal cual si no se pasan por aqui.
      var gs = [];
      for (var k = 0; k < orden.length; k++) {
        var par = categoriaEs(orden[k]);
        gs.push({ name: par[0], theme: par[1], items: mapa[orden[k]] });
      }

      // Orden alfabetico: el lateral queda ordenado y es predecible.
      gs.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

      // "Todos" primero, y una estanteria deccion destacada arriba.
      gs.unshift({ name: 'Todos los canales', theme: 'all', items: state.items.slice() });
      state.todo = gs;
      state.todoBase = state.items.length;
      state.indice = null;
    }

    state.shown = {};

    if (state.query || state.filtro) {
      var hits = buscar(state.query, state.filtro);
      var tema = state.filtro ? (temaDeFiltro(state.filtro) || 'all') : 'all';
      state.groups = [{ name: 'Resultados: ' + hits.length, theme: tema,
                        items: hits, artificial: true }];
      buildSide();
      applyTheme(tema);
      render();
      return;
    }

    state.groups = state.todo;
    buildSide();
    buildHero();
    renderFilters();
    updateSearchUi();
  }

  /**
   * Busca sobre TODO el catalogo, no solo dentro del grupo abierto, y con
   * el filtro de categoria si hay uno.
   *
   * Antes comparaba el titulo contra el grupo visible y en pantalla
   * cabian 40 resultados, asi que con la lista de iptv-org escribir "esp"
   * no encontraba nada util.
   */
  function buscar(texto, filtro) {
    // Indice una vez: titulo normalizado y categoria de cada canal.
    if (!state.indice) {
      state.indice = [];
      for (var i = 0; i < state.items.length; i++) {
        var par = categoriaEs(state.items[i].group || 'Otros');
        state.indice.push({
          n: Utils.normTitle(state.items[i].title),
          t: String(state.items[i].title),
          g: par[0]
        });
      }
    }

    var qn = Utils.normTitle(texto);
    var q = Utils.trim(texto).toLowerCase();
    var out = [];
    for (var k = 0; k < state.indice.length; k++) {
      var e = state.indice[k];
      if (filtro && e.g !== filtro) continue;
      if (qn && e.n.indexOf(qn) === -1 && e.t.toLowerCase().indexOf(q) === -1) continue;
      out.push(state.items[k]);
    }
    return out;
  }

  function temaDeFiltro(nombre) {
    for (var i = 0; i < state.todo.length; i++) {
      if (state.todo[i].name === nombre) return state.todo[i].theme;
    }
    return null;
  }

  /**
   * Lateral: selector de origen arriba, una entrada por grupo y los accesos
   * fijos al final.
   *
   * El selector no es un lujo: iptv-org publica 11262 canales repartidos en
   * listas por pais, region y categoria, y sin un sitio visible para
   * cambiar de lista solo se ve un countries/es.m3u con 324 canales y parece
   * que faltan todos los demas.
   */
  function buildSide() {
    var side = [];
    side.push({ type: 'head', name: 'Listas' });
    for (var s = 0; s < SOURCES.length; s++) {
      side.push({ type: 'source', key: SOURCES[s].key,
                  name: SOURCES[s].name, count: 0 });
    }
    side.push({ type: 'head', name: 'Canales' });
    for (var i = 0; i < state.groups.length; i++) {
      side.push({ type: 'group', idx: i, name: state.groups[i].name, count: state.groups[i].items.length });
    }
    side.push({ type: 'head', name: 'Aplicacion' });
    side.push({ type: 'search', name: 'Explorar', count: 0 });
    side.push({ type: 'guide',  name: 'Guia de TV', count: 0 });
    state.side = side;
    if (state.cat >= side.length) state.cat = 0;
  }

  /** Cambia de lista recargando con la fuente elegida en la URL. */
  function openSource(key) {
    // Sin codigo = indice completo de iptv-org (11262 canales).
    location.href = 'index.html' + (key ? '?cc=' + encodeURIComponent(key) : '');
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
    var html = '';
    for (var i = 0; i < state.side.length; i++) {
      var it = state.side[i];

      // Los separadores separan: no se pintan como boton ni se pueden
      // seleccionar con el D-pad, o el foco se quedaria clavado en ellos.
      if (it.type === 'head') {
        html += '<div class="sidehead">' + Utils.esc(it.name) + '</div>';
        continue;
      }

      var icon = (it.type === 'source') ? 'list' : iconFor(it.name);
      html += '<button class="sideItem' + (it.type === 'source' ? ' isSource' : '') +
              '" data-cat="' + i + '" tabindex="0">' +
              '<span class="si ' + icon + '"></span>' +
              '<span class="st">' + Utils.esc(it.name) + '</span>' +
              (it.count ? '<span class="sn">' + it.count + '</span>' : '') +
              '</button>';
    }
    el.cats.innerHTML = html;

    var nodes = el.cats.querySelectorAll('.sideItem');
    for (var j = 0; j < nodes.length; j++) {
      (function (n) {
        n.addEventListener('click', function () {
          // El indice sale del propio nodo, no de su posicion en el DOM:
          // el lateral incluye separadores que no son .sideItem, asi que
          // el numero de orden en la lista no coincide con j y el foco
          // acababa en la entrada equivocada.
          selectCategory(parseInt(n.getAttribute('data-cat'), 10));
        });
      })(nodes[j]);
    }
  }

  function renderHero() {
    if (!state.hero.length) {
      el.hero.innerHTML = '<div class="cardelaEmpty">Sin destacados todavia. ' +
        'Revisa <code>CONFIG.source</code> en <code>js/config.js</code>.</div>';
      return;
    }

    var html = '<div class="cardelaTrack" id="heroTrack">';
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
                '<p>' + Utils.esc(live ? ('Ahora: ' + live) : (it.description || 'Canal en directo')) + '</p>' +
                '<div class="meta">' +
                  '<span class="tag live">&#9654; Reproducir</span>' +
                  (live ? '<span class="tag ghost">' + Utils.esc(live) + '</span>' : '') +
                '</div>' +
              '</div></div>';
    }
    html += '</div>' +
            '<div class="edge l"></div><div class="edge r"></div>' +
            '<div class="cardelaDots" id="heroDots">';
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

    var dots = el.hero.querySelectorAll('.cardelaDots i');
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

    var dots = el.hero.querySelectorAll('.cardelaDots i');
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

  /* ---------------------------------------------------------------- *
   * Buscador: filtros por categoria y contador de resultados
   * ---------------------------------------------------------------- */
  function renderFilters() {
    if (!state.todo) { el.filters.innerHTML = ''; return; }

    // Solo las categorias con contenido; "Todos los canales" no aporta
    // como filtro porque es lo mismo que no filtrar.
    var cats = [], i;
    for (i = 1; i < state.todo.length; i++) cats.push(state.todo[i].name);
    cats.sort(function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); });

    var html = '<button class="chipFilter' + (state.filtro ? '' : ' on') +
               '" data-f="" tabindex="0">Todas</button>';
    // Chip "En vivo": solo canales que emiten ahora
    html += '<button class="chipFilter' + (state.onlyLive ? ' on' : '') +
              '" data-f="en-vivo" tabindex="0">En vivo</button>';
    for (i = 0; i < cats.length; i++) {
      html += '<button class="chipFilter' + (state.filtro === cats[i] ? ' on' : '') +
              '" data-f="' + Utils.esc(cats[i]) + '" tabindex="0">' +
              Utils.esc(cats[i]) + '</button>';
    }
    el.filters.innerHTML = html;

    var chips = el.filters.querySelectorAll('.chipFilter');
    for (var j = 0; j < chips.length; j++) {
      (function (n) {
        n.addEventListener('click', function () {
          var f = n.getAttribute('data-f');
          // Chip "En vivo": alterna solo canales en emision
          if (f === 'en-vivo') {
            state.onlyLive = !state.onlyLive;
            state.card = 0;
            buildGroups();
            updateSearchUi();
            renderFilters();
            return;
          }
          state.filtro = f;
          state.card = 0;
          buildGroups();
          updateSearchUi();
          renderFilters();
        });
      })(chips[j]);
    }
  }

  function updateSearchUi() {
    // El panel queda siempre a la vista: con 11262 canales el buscador es
    // la navegacion principal, no algo escondido. Solo el contador depende
    // de si se esta buscando.
    el.panel.className = 'searchPanel on';
    var buscando = !!(state.query || state.filtro);

    if (!buscando) { el.count.textContent = ''; return; }

    var n = state.groups.length ? state.groups[0].items.length : 0;
    el.count.textContent = n + (n === 1 ? ' canal' : ' canales') +
      ' de ' + state.items.length;
  }

  function updateLangUI() {
    // actualiza el botón de idioma en la banda
    var langBtn = $('langSelect');
    if (!langBtn) return;

    // actualiza el texto del botón
    var langLabels = { es: 'ES', en: 'EN', pt: 'PT' };
    langBtn.textContent = langLabels[state.lang] || 'ES';

    // actualiza el texto "En directo" en el tally
    var tallyText = $('tallyText');
    if (tallyText) {
      var labels = { es: 'En directo', en: 'Live', pt: 'Ao vivo' };
      tallyText.textContent = labels[state.lang] || 'En directo';
    }

    // guarda la preferencia
    localStorage.setItem('tv_lang', state.lang);
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

      // Cada estanteria se dibuja por tramos de 40, no entera: la de "Todos
      // los canales" del indice de iptv-org tiene 11262 y pintarlos todos
      // de golpe deja el navegador sin aire. El tramo crece segun se avanza
      // con el D-pad, asi que se llega a todos sin pagar el coste al entrar.
      var shown = state.shown[s] || CHUNK;
      var limit = Math.min(g.items.length, shown);
      if (limit < g.items.length) {
        html += '<span class="moreHint">' + limit + ' de ' + g.items.length +
                ' canales · sigue avanzando para ver mas</span>';
      }
      for (var i = 0; i < limit; i++) {
        var it = g.items[i];
        var live = state.onAir[it.id] || state.onAir[it.tvgId];
        // Si soloLive está activo, saltar canales que no emiten ahora
        if (state.onlyLive && !live) continue;
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
    if (it.type === 'source') {
      // Ya estamos en esa lista: no se recarga nada.
      if (it.key === state.activeSource) { render(); paintFocus(); return; }
      openSource(it.key);
      return;
    }

    state.shelf = it.idx;
    state.card = 0;
    state.zone = 'shelf';
    applyTheme(state.groups[it.idx] && state.groups[it.idx].theme);
    render();
    revealCard();
  }

  /**
   * Cambia el fondo de la pantalla segun la categoria elegida. El tema son
   * unos pocos degradados en CSS: no hay imagenes que generar ni descargas,
   * y el cambio de color se pinta al instante incluso en un motor viejo.
   */
  function applyTheme(theme) {
    var app = document.body;
    app.className = app.className.replace(/\btema-\S+/g, '').replace(/\s+/g, ' ').trim();
    app.className += ' tema-' + (theme || 'other');
  }

  function openSearch() {
    // El panel siempre esta visible; aqui solo se le da el foco al campo.
    el.panel.className = 'searchPanel on';
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
    // El panel se queda visible; solo se vacia el contador si no se busca.
    if (!state.query && !state.filtro) el.count.textContent = '';
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
    state.playing = item;
    state.stopped = false;
    var aviso = $('playerStopped');
    if (aviso) aviso.style.display = 'none';
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

  /**
   * Detener: corta la emision pero se queda en la pantalla del
   * reproductor, para poder volver a darle al play sin salir.
   *
   * player.stop(true) es lo que corta el HLS de verdad. Si solo se
   * pausara el <video>, hls.js seguiria pidiendo segmentos en segundo
   * plano y el canal continuaria descargando aunque no se viera nada.
   */
  function stopPlayback() {
    player.stop(true);
    el.video.pause();
    el.video.removeAttribute('src');
    try { el.video.load(); } catch (e) { /* navegadores viejos */ }

    state.stopped = true;
    var aviso = $('playerStopped');
    if (aviso) aviso.style.display = 'block';
    el.status.textContent = 'Emision detenida';
    toast('Emision detenida');
  }

  /** Volver: cierra el reproductor y regresa a la lista de canales. */
  function goBackToList() {
    if (state.stopped) {
      // Ya estaba parado: solo hay que cerrar la pantalla.
      state.stopped = false;
      var aviso = $('playerStopped');
      if (aviso) aviso.style.display = 'none';
      showScreen('catalog');
      return;
    }
    player.stop(true);
    el.video.pause();
    el.video.removeAttribute('src');
    try { el.video.load(); } catch (e) { /* navegadores viejos */ }
    showScreen('catalog');
  }

  function showScreen(name) {
    state.screen = name;
    // catalogScreen es flex por CSS; dejarlo en block rompia el .layout.
    el.catalogUI.style.display = (name === 'catalog') ? 'flex' : 'none';
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
          // En el reproductor: si se detuvo antes, OK vuelve a emitir el
          // mismo canal en vez de solo reanudar un video que ya no existe.
          if (state.stopped && state.playing) {
            var aviso = $('playerStopped');
            if (aviso) aviso.style.display = 'none';
            state.stopped = false;
            playItem(state.playing);
          } else {
            var p = el.video.play(); if (p && p.catch) p.catch(function () {});
          }
        }
        e.preventDefault(); return;
      }

      if (isKey(e, KEY.BACK)) {
        // BACK en el reproductor es "salir": corta la emision y regresa a
        // la lista, que es distinto del boton Detener.
        if (state.screen === 'player') { goBackToList(); }
        else if (state.screen === 'guide') { showScreen('catalog'); }
        else if (el.search === document.activeElement || el.search.value) {
          el.search.value = ''; state.query = '';
          closeSearch(); buildGroups(); updateSearchUi(); render();
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

  /**
 * Siguiente entrada del lateral a la que se puede parar: se salta los
 * separadores. Si se topa con un borde, se queda en el ultimo (o primero)
 * elemento seleccionable en lugar de clavarse en una cabecera.
 */
function nextSelectable(from, dir) {
  var i = from;
  for (var intentos = 0; intentos < state.side.length + 1; intentos++) {
    i += dir;
    if (i < 0 || i >= state.side.length) return from;
    if (state.side[i].type !== 'head') return i;
  }
  return from;
}

/** dc horizontal, dr vertical. Devuelve true si consumio la pulsacion. */
  function move(dc, dr) {
    /* ---- lateral ---- */
    if (state.zone === 'cat') {
      if (dr) {
        state.cat = nextSelectable(state.cat, dr);
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
        applyTheme(state.groups[state.shelf] && state.groups[state.shelf].theme);
        renderShelves();
        revealCard();
      }
      paintFocus();
      return true;
    }

    /* ---- estanterias ---- */
    var g = state.groups[state.shelf];
    if (!g) return false;
    var pintadas = state.shown[state.shelf] || CHUNK;
    var len = Math.min(g.items.length, pintadas);

    if (dc) {
      if (dc > 0) {
        if (state.card >= len - 1 && len < g.items.length) {
          // Se ha llegado al final de lo pintado: se pinta otro tramo y se
          // sigue. Asi el canal 9000 se alcanza igual que el primero.
          state.shown[state.shelf] = len + CHUNK;
          renderShelves();
        }
        // Sin el "|| CHUNK" el min() recibiria undefined y devolveria NaN,
        // dejando el foco roto: la flecha derecha dejaba de funcionar.
        var tope = Math.min(g.items.length, state.shown[state.shelf] || CHUNK);
        state.card = Math.min(tope - 1, state.card + 1);
      }
      else if (state.card > 0) state.card -= 1;
      else { state.zone = 'hero'; }        // izquierda en el primer elemento
    }

    if (dr) {
      var prev = state.shelf;
      var target = prev + dr;
      if (target < 0) { state.zone = 'hero'; state.card = 0; }
      else if (target < state.groups.length) {
        state.shelf = target;
        var tope = Math.min(state.groups[target].items.length,
                            state.shown[target] || CHUNK);
        state.card = Math.min(state.card, Math.max(0, tope - 1));
        applyTheme(state.groups[target].theme);
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
    // GUIAS DESACTIVADAS: sin carga automática.
    // El usuario puede abrir la guía manualmente presionando el botón Tab Guide.
    return Promise.resolve([]);
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