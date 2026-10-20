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
  var CHUNK = 4;

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
    allItems: [],          // catalogo crudo sin filtrar
    failed: [],            // ids de canales que no reproducen
    side: [],              // [{ type:'group'|'source'|'guide'|'search', ... }]
    activeSource: '',      // clave de la lista cargada, para marcarla
    shown: {},           // { shelfIndex: caratulas pintadas hasta ahora }
    todo: null,          // catalogo completo agrupado y traducido
    todoBase: 0,
    indice: null,        // indice de busqueda { n, t }
    filtro: '',          // ya no se usa: sin filtros de categoria
    byId: {},
    onAir: {},
    epgItems: [],
    hero: [],              // sin carrusel: se conserva vacio
    heroAt: 0,
    stopped: false,       // el canal se detuvo a proposito desde el reproductor
    playing: null,        // canal que se esta emitiendo, para poder reanudarlo
    query: '',
    screen: 'catalog',
    zone: 'shelf',
    shelf: 0,
    card: 0,
    favs: [],              // Lista de IDs de canales favoritos guardados en localStorage
    recents: [],           // Historial de canales reproducidos recientemente
    isFavsFilter: false,
    masFocus: false,        // el foco esta en el boton "Ver más"
    quickFilter: 'all',    // filtro rapido: all | hd | live | recent
    sortBy: 'name',        // orden: name | recent | quality
    aspectIdx: 0,          // indice del modo de aspecto
    theme: 'dark',         // tema: dark | light | contrast
    fontSize: 0            // 0 normal, 1 grande, 2 extra
  };

  var player = null;
  var guide = null;
  var playerControlsTimer = null;
  var el = {};
  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- *
   * Arranque
   * ---------------------------------------------------------------- */
  function boot() {
    el.shelves   = $('shelves');
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
        state.shelf = 0;
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
    var btnOpenSearch = $('btnOpenSearch');
    if (btnOpenSearch) btnOpenSearch.addEventListener('click', function () { toggleSearch(); });
    var btnCloseSearch = $('btnCloseSearch');
    if (btnCloseSearch) btnCloseSearch.addEventListener('click', function () { closeSearch(); });

    var btnGuide = $('btnGuide');
    if (btnGuide) btnGuide.addEventListener('click', function () { showScreen('guide'); });
    $('btnStop').addEventListener('click', function () { stopPlayback(); });
    $('btnBack').addEventListener('click', function () { goBackToList(); });

    // Nuevas acciones del reproductor y cabecera
    var btnHeaderFavs = $('btnHeaderFavs');
    if (btnHeaderFavs) btnHeaderFavs.addEventListener('click', function () { showFavoritesView(); });
    var btnFav = $('btnFav');
    if (btnFav) btnFav.addEventListener('click', function () { toggleFav(state.playing); });
    var btnReload = $('btnReload');
    if (btnReload) btnReload.addEventListener('click', function () { reloadCurrentStream(); });
    var btnPrev = $('btnPrevChannel');
    if (btnPrev) btnPrev.addEventListener('click', function () { playPrevChannel(); });
    var btnNext = $('btnNextChannel');
    if (btnNext) btnNext.addEventListener('click', function () { playNextChannel(); });
    var btnMute = $('btnMute');
    if (btnMute) btnMute.addEventListener('click', function () { toggleMute(); });
    var btnFs = $('btnFullscreen');
    if (btnFs) btnFs.addEventListener('click', function () { toggleFullscreen(); });
    var btnAspect = $('btnAspect');
    if (btnAspect) btnAspect.addEventListener('click', function () { toggleAspect(); });
    var btnInfo = $('btnInfo');
    if (btnInfo) btnInfo.addEventListener('click', function () { showChannelInfo(); });
    var btnCopyUrl = $('btnCopyUrl');
    if (btnCopyUrl) btnCopyUrl.addEventListener('click', function () { copyStreamUrl(); });
    var btnShare = $('btnShare');
    if (btnShare) btnShare.addEventListener('click', function () { shareChannel(); });
    var btnSource = $('btnSourceSelect');
    if (btnSource) btnSource.addEventListener('click', function () { cycleSource(); });

    var btnRandom = $('btnRandom');
    if (btnRandom) btnRandom.addEventListener('click', function () { playRandom(); });

    var btnTheme = $('btnTheme');
    if (btnTheme) btnTheme.addEventListener('click', function () { toggleTheme(); });

    var btnFont = $('btnFont');
    if (btnFont) btnFont.addEventListener('click', function () { cycleFontSize(); });

    var btnHelp = $('btnHelp');
    if (btnHelp) btnHelp.addEventListener('click', function () { openHelp(); });
    var btnCloseHelp = $('btnCloseHelp');
    if (btnCloseHelp) btnCloseHelp.addEventListener('click', function () { closeHelp(); });

    var btnCloseGuide = $('btnCloseGuide');
    if (btnCloseGuide) btnCloseGuide.addEventListener('click', function () { showScreen('catalog'); });

    var btnVoice = $('btnVoiceSearch');
    if (btnVoice) btnVoice.addEventListener('click', function () { voiceSearch(); });

    var btnSort = $('btnSort');
    if (btnSort) btnSort.addEventListener('click', function () {
      var modes = ['name', 'recent', 'quality'];
      var labels = ['Nombre', 'Recientes', 'Calidad'];
      var idx = modes.indexOf(state.sortBy);
      idx = (idx + 1) % modes.length;
      state.sortBy = modes[idx];
      btnSort.textContent = 'Orden: ' + labels[idx];
      state.card = 0; state.masFocus = false; state.shown = {};
      buildGroups(); updateSearchUi();
    });

    var qfButtons = document.querySelectorAll('.qf');
    for (var qi = 0; qi < qfButtons.length; qi++) {
      (function (n) {
        n.addEventListener('click', function () {
          state.quickFilter = n.getAttribute('data-qf') || 'all';
          state.card = 0; state.masFocus = false; state.shown = {};
          buildGroups(); updateSearchUi();
          // marcar activo
          var all = document.querySelectorAll('.qf');
          for (var k = 0; k < all.length; k++) all[k].className = 'qf' + (all[k].getAttribute('data-qf') === state.quickFilter ? ' on' : '');
        });
      })(qfButtons[qi]);
    }

    // Inicializar tema y tamano de fuente guardados.
    try {
      var t = localStorage.getItem('tv_theme'); if (t) state.theme = t;
      var f = localStorage.getItem('tv_font'); if (f) state.fontSize = parseInt(f, 10) || 0;
    } catch (e) {}
    applyThemeMode();
    applyFontSize();
    applyHighContrast();

    // Confirmar antes de salir.
    window.addEventListener('beforeunload', function (e) {
      if (state.playing) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Auto-ocultar los controles del reproductor tras unos segundos.
    if (el.video) {
      el.video.addEventListener('click', function () {
        if (state.screen !== 'player') return;
        var ov = el.playerUI.querySelector('.overlay');
        if (!ov) return;
        if (ov.className.indexOf('hidden') > -1) {
          showPlayerControls();
          resetPlayerControlsTimer();
        } else {
          if (playerControlsTimer) clearTimeout(playerControlsTimer);
          ov.className += ' hidden';
        }
      });
    }
    if (el.playerUI) {
      el.playerUI.addEventListener('mousemove', function () {
        if (state.screen === 'player') resetPlayerControlsTimer();
      });
      el.playerUI.addEventListener('touchstart', function () {
        if (state.screen === 'player') resetPlayerControlsTimer();
      });
    }

    // Cargar favoritos y recientes
    loadFavorites();
    loadRecents();

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
    var lb = $('loadingBar');
    if (lb) lb.className = 'loadingBar on';
    state.adapter.list().then(function (items) {
      state.allItems = items || [];
      state.failed = loadFailed();
      state.items = state.allItems.filter(function (it) { return state.failed.indexOf(it.id) === -1; });
      state.byId = {};
      for (var i = 0; i < state.items.length; i++) state.byId[state.items[i].id] = state.items[i];
      buildGroups();
      if (!state.items.length) {
        // Sin esto la pantalla queda en negro sin explicar nada, que es lo
        // que mas desconcierta cuando una lista remota falla o va vacia.
        el.shelves.innerHTML =
          '<div class="epg-empty">No se encontro ninguna lista.<br>' +
          'Prueba otra fuente: <code>?src=iptvorg&amp;cc=gb</code>, ' +
          '<code>?cc=mx</code>, <code>?cc=uk</code> o <code>?cc=movies</code>.<br>' +
          'Revisa <code>CONFIG.iptvorg</code> en <code>js/config.js</code>.</div>';
        if (lb) lb.className = 'loadingBar';
        return;
      }
      // EPG loading disabled to prevent app hang;
      // guide accessible via Tab Guide
      if (lb) lb.className = 'loadingBar';
    }).catch(function (e) {
      toast('No se pudo cargar el catalogo: ' + e.message);
      el.shelves.innerHTML =
        '<div class="epg-empty">No se pudo cargar el catalogo.<br>' +
        Utils.esc(e.message) + '</div>';
      if (lb) lb.className = 'loadingBar';
    });
  }

  /* ---------------------------------------------------------------- *
   * Lista unica. Sin categorias, sin carrusel: todo el catalogo vive en
   * una sola lista y el buscador la recorre entera.
   * ---------------------------------------------------------------- */
  function buildGroups() {
    applyTheme('all');
    state.shown = {};

    var hasFilter = (state.quickFilter && state.quickFilter !== 'all') || (state.sortBy && state.sortBy !== 'name');

    if (state.query || hasFilter) {
      var hits;
      if (state.query) {
        hits = buscar(state.query);
      } else {
        hits = buscar('');
      }
      var name = state.query ? 'Resultados' : 'Todos los canales';
      state.groups = [{ name: name, theme: 'all', items: hits, artificial: !!state.query, all: true }];
      state.shown = { 0: hits.length };
    } else {
      state.groups = [{ name: 'Todos los canales', theme: 'all', items: state.items }];
      state.shown = { 0: CHUNK };
    }

    updateSearchUi();
    state.masFocus = false;
    if (!state.groups[0] || state.card >= state.groups[0].items.length) state.card = 0;
    render();
  }

  /**
   * Busca sobre TODO el catalogo y devuelve todas las coincidencias.
   * No hay filtros: lo que coincide se pinta entero.
   */
  function buscar(texto) {
    if (!state.indice) {
      state.indice = [];
      for (var i = 0; i < state.items.length; i++) {
        state.indice.push({
          n: Utils.normTitle(state.items[i].title),
          t: String(state.items[i].title).toLowerCase()
        });
      }
    }

    var qn = Utils.normTitle(texto);
    var q = Utils.trim(texto).toLowerCase();
    var out = [];
    for (var k = 0; k < state.indice.length; k++) {
      var e = state.indice[k];
      var it = state.items[k];
      if (qn && e.n.indexOf(qn) === -1 && e.t.indexOf(q) === -1) continue;

      // Filtros rapidos.
      if (state.quickFilter === 'hd') {
        if (!/hd|1080|720/i.test(it.title)) continue;
      } else if (state.quickFilter === 'live') {
        var live = state.onAir[it.id] || state.onAir[it.tvgId];
        if (!live) continue;
      } else if (state.quickFilter === 'recent') {
        if (state.recents.indexOf(it.id) === -1) continue;
      }

      out.push(it);
    }

    // Orden.
    if (state.sortBy === 'recent') {
      out.sort(function (a, b) {
        var ia = state.recents.indexOf(a.id), ib = state.recents.indexOf(b.id);
        if (ia === -1) ia = 9999; if (ib === -1) ib = 9999;
        return ia - ib;
      });
    } else if (state.sortBy === 'quality') {
      out.sort(function (a, b) {
        var qa = /\d{3,4}[pi]/.exec(a.title), qb = /\d{3,4}[pi]/.exec(b.title);
        var na = qa ? parseInt(qa[0]) : 0, nb = qb ? parseInt(qb[0]) : 0;
        return nb - na;
      });
    } else {
      out.sort(function (a, b) { return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0); });
    }

    return out;
  }

  /** Recorre las listas de iptv-org en orden y recarga con la elegida. */
  function cycleSource() {
    var cur = currentSourceKey();
    var idx = -1;
    for (var i = 0; i < SOURCES.length; i++) {
      if (SOURCES[i].key === cur) { idx = i; break; }
    }
    var next = SOURCES[(idx + 1 + SOURCES.length) % SOURCES.length];
    toast('Lista: ' + next.name);
    openSource(next.key);
  }

  /** Cambia de lista recargando con la fuente elegida en la URL. */
  function openSource(key) {
    // Sin codigo = indice completo de iptv-org (11262 canales).
    location.href = 'index.html' + (key ? '?cc=' + encodeURIComponent(key) : '');
  }

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  function render() {
    renderShelves();
    paintFocus();
  }

  /* ---------------------------------------------------------------- *
   * Buscador: contador de resultados
   * ---------------------------------------------------------------- */

  function updateSearchUi() {
    // El panel queda siempre a la vista: con mas de 11000 canales el
    // buscador es la navegacion principal, no algo escondido.
    el.panel.className = 'searchPanel on';
    if (!state.query) { el.count.textContent = ''; return; }

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

  /* ---------------------------------------------------------------- *
   * Lista vertical. Una sola columna: se recorre con arriba/abajo y,
   * cuando quedan canales por pintar, aparece un boton "Ver más".
   * ---------------------------------------------------------------- */
  function renderShelves() {
    var g = state.groups[0];
    if (!g) {
      el.shelves.innerHTML = '<div class="epg-empty">Nada que mostrar.<br>' +
        'Revisa <code>CONFIG.source</code> en <code>js/config.js</code>.</div>';
      return;
    }

    var total = g.items.length;
    var limit = Math.min(total, state.shown[0] || CHUNK);
    var hayMas = limit < total;

    var html = '<section class="shelf" data-shelf="0">' +
               '<div class="shelfhead"><h2>' + Utils.esc(g.name) + '</h2>' +
               '<em>' + total + (total === 1 ? ' canal' : ' canales') + '</em>' +
               '</div><div class="row verticalResults" id="row-0">';

    for (var i = 0; i < limit; i++) {
      var it = g.items[i];
      var live = state.onAir[it.id] || state.onAir[it.tvgId];
      var focused = (i === state.card) && !state.masFocus;

      html += '<div class="card verticalCard' + (focused ? ' focused' : '') +
                '" data-card="' + i + '" tabindex="0">';

      if (it.poster) {
        html += '<div class="thumb"><img src="' + Utils.esc(it.poster) + '" alt="" loading="lazy" ' +
                'onerror="this.parentNode.className=\'thumb blank\';this.remove();"></div>';
      } else {
        html += '<div class="thumb blank"></div>';
      }

      html += '<span class="badge live">EN VIVO</span>' +
              (isFav(it.id) ? '<span class="cardFavStar" title="Favorito">&#9733;</span>' : '') +
              '<div class="ttl">' + Utils.esc(it.title) + '</div>' +
              (live ? '<span class="onair">' + Utils.esc(live) + '</span>' : '') +
              '</div>';
    }

    if (hayMas) {
      html += '<button id="btnMas" class="btnMas' + (state.masFocus ? ' focused' : '') +
              '" tabindex="0">' +
              '<span class="btnMasText">Ver más canales</span>' +
              '<span class="btnMasFlecha" aria-hidden="true">&#9660;</span>' +
              '<span class="btnMasCount">' + limit + ' de ' + total + '</span>' +
              '</button>';
    }

    html += '</div></section>';
    el.shelves.innerHTML = html;

    var cards = el.shelves.querySelectorAll('.card');
    for (var c = 0; c < cards.length; c++) {
      (function (n) {
        n.addEventListener('click', function () {
          var d = parseInt(n.getAttribute('data-card'), 10);
          state.card = d;
          state.masFocus = false;
          state.zone = 'shelf';
          var it2 = state.groups[0].items[d];
          if (it2) playItem(it2);
        });
      })(cards[c]);
    }

    var mas = $('btnMas');
    if (mas) mas.addEventListener('click', function () { verMas(); });
  }

  /** Pinta el siguiente tramo y deja el foco en el primer canal nuevo. */
  function verMas() {
    var g = state.groups[0];
    if (!g) return;
    var total = g.items.length;
    var shown = state.shown[0] || CHUNK;
    if (shown >= total) return;

    state.card = shown;
    state.masFocus = false;
    state.shown[0] = shown + CHUNK;
    renderShelves();
    paintFocus();
    revealCard();
  }

  /* ---------------------------------------------------------------- *
   * Favoritos y Recientes
   * ---------------------------------------------------------------- */
  function loadFavorites() {
    try {
      var raw = localStorage.getItem('tv_favs');
      state.favs = raw ? JSON.parse(raw) : [];
    } catch (e) { state.favs = []; }
    updateFavsUI();
  }

  function loadFailed() {
    try {
      var raw = localStorage.getItem('tv_failed');
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveFavorites() {
    try {
      localStorage.setItem('tv_favs', JSON.stringify(state.favs));
    } catch (e) {}
    updateFavsUI();
  }

  function isFav(id) {
    if (!state.favs || !id) return false;
    return state.favs.indexOf(id) !== -1;
  }

  function toggleFav(item) {
    if (!item || !item.id) return;
    var idx = state.favs.indexOf(item.id);
    if (idx !== -1) {
      state.favs.splice(idx, 1);
      toast('Eliminado de favoritos');
    } else {
      state.favs.unshift(item.id);
      toast('⭐ Añadido a favoritos');
    }
    saveFavorites();
    updatePlayerFavBtn();
    if (state.isFavsFilter) showFavoritesView();
  }

  function updateFavsUI() {
    var badge = $('favCountBadge');
    if (badge) badge.textContent = state.favs.length;
  }

  function updatePlayerFavBtn() {
    var btn = $('btnFav');
    if (!btn || !state.playing) return;
    var isF = isFav(state.playing.id);
    var icon = $('favPlayerIcon');
    var txt = $('favPlayerText');
    if (isF) {
      btn.className = 'pbtn pbtn-fav active';
      if (icon) icon.innerHTML = '&#9733;';
      if (txt) txt.textContent = 'Guardado';
    } else {
      btn.className = 'pbtn pbtn-fav';
      if (icon) icon.innerHTML = '&#9734;';
      if (txt) txt.textContent = 'Favorito';
    }
  }

  function showFavoritesView() {
    state.isFavsFilter = true;
    state.query = '';
    var favItems = [];
    for (var i = 0; i < state.favs.length; i++) {
      var it = state.byId[state.favs[i]];
      if (it) favItems.push(it);
    }
    if (!favItems.length) {
      toast('No tienes canales favoritos todavía');
    }
    state.groups = [{ name: 'Mis Favoritos', theme: 'all', items: favItems }];
    state.shown = {};
    state.shelf = 0;
    state.card = 0;
    state.masFocus = false;
    state.zone = 'shelf';
    applyTheme('all');
    updateSearchUi();
    render();
    revealCard();
  }

  function loadRecents() {
    try {
      var raw = localStorage.getItem('tv_recents');
      state.recents = raw ? JSON.parse(raw) : [];
    } catch (e) { state.recents = []; }
  }

  function addRecent(item) {
    if (!item || !item.id) return;
    var idx = state.recents.indexOf(item.id);
    if (idx !== -1) state.recents.splice(idx, 1);
    state.recents.unshift(item.id);
    if (state.recents.length > 20) state.recents.pop();
    try { localStorage.setItem('tv_recents', JSON.stringify(state.recents)); } catch (e) {}
  }

  function showRecentsView() {
    state.isFavsFilter = false;
    state.query = '';
    var recentItems = [];
    for (var i = 0; i < state.recents.length; i++) {
      var it = state.byId[state.recents[i]];
      if (it) recentItems.push(it);
    }
    if (!recentItems.length) {
      toast('No hay canales recientes todavía');
    }
    state.groups = [{ name: 'Vistos Recientemente', theme: 'all', items: recentItems }];
    state.shown = {};
    state.shelf = 0;
    state.card = 0;
    state.masFocus = false;
    state.zone = 'shelf';
    applyTheme('all');
    updateSearchUi();
    render();
    revealCard();
  }

  /* ---------------------------------------------------------------- *
   * Zapping, Recarga, Mute, Pantalla Completa
   * ---------------------------------------------------------------- */
  function playNextChannel() {
    if (!state.playing) return;
    var list = (state.groups && state.groups[state.shelf] && state.groups[state.shelf].items.length)
      ? state.groups[state.shelf].items : state.items;
    if (!list || !list.length) return;
    var currIdx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.playing.id) { currIdx = i; break; }
    }
    var nextIdx = (currIdx + 1) % list.length;
    state.card = nextIdx;
    playItem(list[nextIdx]);
    toast('Canal: ' + list[nextIdx].title);
  }

  function playPrevChannel() {
    if (!state.playing) return;
    var list = (state.groups && state.groups[state.shelf] && state.groups[state.shelf].items.length)
      ? state.groups[state.shelf].items : state.items;
    if (!list || !list.length) return;
    var currIdx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.playing.id) { currIdx = i; break; }
    }
    var prevIdx = (currIdx - 1 + list.length) % list.length;
    state.card = prevIdx;
    playItem(list[prevIdx]);
    toast('Canal: ' + list[prevIdx].title);
  }

  function reloadCurrentStream() {
    if (!state.playing) return;
    toast('Reconectando señal...');
    playItem(state.playing);
  }

  function toggleMute() {
    if (!el.video) return;
    el.video.muted = !el.video.muted;
    updateMuteUI();
    toast(el.video.muted ? '🔇 Audio silenciado' : '🔊 Audio activado');
  }

  function updateMuteUI() {
    var btn = $('btnMute');
    if (!btn || !el.video) return;
    var icon = $('mutePlayerIcon');
    var txt = $('mutePlayerText');
    if (el.video.muted) {
      btn.className = 'pbtn pbtn-mute muted';
      if (icon) icon.innerHTML = '&#128263;';
      if (txt) txt.textContent = 'Mute';
    } else {
      btn.className = 'pbtn pbtn-mute';
      if (icon) icon.innerHTML = '&#128266;';
      if (txt) txt.textContent = 'Sonido';
    }
  }

  function toggleFullscreen() {
    var doc = document;
    var elem = document.documentElement;
    var isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
    if (!isFs) {
      if (elem.requestFullscreen) elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
      else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
      else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
      toast('Pantalla completa');
    } else {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
      else if (doc.msExitFullscreen) doc.msExitFullscreen();
      toast('Modo ventana');
    }
  }

  function toggleAspect() {
    var modes = ['contain', 'cover', 'fill'];
    if (state.aspectIdx === undefined) state.aspectIdx = 0;
    state.aspectIdx = (state.aspectIdx + 1) % modes.length;
    if (el.video) el.video.style.objectFit = modes[state.aspectIdx];
    toast('Aspecto: ' + modes[state.aspectIdx]);
    resetPlayerControlsTimer();
  }

  function showChannelInfo() {
    if (!state.playing) return;
    var it = state.playing;
    var msg = it.title || '';
    if (it.group) msg += ' · ' + it.group;
    if (it.tvgId) msg += ' · ' + it.tvgId;
    toast(msg);
    resetPlayerControlsTimer();
  }

  function playRandom() {
    if (!state.items.length) return;
    var i = Math.floor(Math.random() * state.items.length);
    var it = state.items[i];
    if (it) playItem(it);
  }

  function copyStreamUrl() {
    if (!state.playing || !state.playing._url) {
      toast('No hay URL disponible');
      return;
    }
    var url = PROXY.wrap ? PROXY.wrap(state.playing._url) : state.playing._url;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('URL copiada'); }, function () { toast('No se pudo copiar'); });
    } else {
      toast('URL: ' + url);
    }
    resetPlayerControlsTimer();
  }

  function shareChannel() {
    if (!state.playing) return;
    var url = location.href.split('?')[0] + '?play=' + encodeURIComponent(state.playing.id);
    if (navigator.share) {
      navigator.share({ title: state.playing.title, url: url }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('Enlace copiado'); }, function () { toast('No se pudo copiar'); });
    } else {
      toast('Enlace: ' + url);
    }
    resetPlayerControlsTimer();
  }

  function toggleTheme() {
    if (state.theme === 'dark') state.theme = 'light';
    else if (state.theme === 'light') state.theme = 'contrast';
    else state.theme = 'dark';
    try { localStorage.setItem('tv_theme', state.theme); } catch (e) {}
    applyThemeMode();
    toast('Tema: ' + (state.theme === 'dark' ? 'oscuro' : (state.theme === 'light' ? 'claro' : 'alto contraste')));
  }

  function applyThemeMode() {
    document.body.className = document.body.className
      .replace(/\btema-claro\b/g, '').replace(/\balto-contraste\b/g, '').replace(/\s+/g, ' ').trim();
    if (state.theme === 'light') document.body.className += ' tema-claro';
    else if (state.theme === 'contrast') document.body.className += ' alto-contraste';
  }

  function applyFontSize() {
    document.body.className = document.body.className.replace(/\bfont-lg\b/g, '').replace(/\bfont-xl\b/g, '').replace(/\s+/g, ' ').trim();
    if (state.fontSize === 1) document.body.className += ' font-lg';
    else if (state.fontSize === 2) document.body.className += ' font-xl';
  }

  function applyHighContrast() {
    // reservado: se activa con ?contrast=1
    if (/[?&]contrast=1/.test(location.search)) document.body.className += ' alto-contraste';
  }

  function cycleFontSize() {
    state.fontSize = (state.fontSize + 1) % 3;
    try { localStorage.setItem('tv_font', state.fontSize); } catch (e) {}
    applyFontSize();
    toast('Tamaño de fuente: ' + ['normal', 'grande', 'extra'][state.fontSize]);
  }

  function openHelp() {
    var o = $('helpOverlay');
    if (o) o.style.display = 'flex';
  }

  function closeHelp() {
    var o = $('helpOverlay');
    if (o) o.style.display = 'none';
  }

  function voiceSearch() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Búsqueda por voz no disponible en este navegador'); return; }
    var r = new SR();
    r.lang = state.lang === 'en' ? 'en-US' : (state.lang === 'pt' ? 'pt-BR' : 'es-ES');
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = function (e) {
      var t = e.results[0][0].transcript;
      el.search.value = t;
      state.query = Utils.trim(t);
      state.card = 0; state.masFocus = false; state.shown = {};
      buildGroups(); updateSearchUi();
    };
    r.onerror = function () { toast('No se pudo reconocer la voz'); };
    r.start();
    toast('Escuchando...');
  }

  function showPlayerControls() {
    if (!el.playerUI) return;
    var ov = el.playerUI.querySelector('.overlay');
    if (ov) ov.className = ov.className.replace(/\s*hidden\b/, '');
  }

  function hidePlayerControls() {
    if (!el.playerUI || state.stopped) return;
    var ov = el.playerUI.querySelector('.overlay');
    if (ov && ov.className.indexOf('hidden') === -1) ov.className += ' hidden';
  }

  function resetPlayerControlsTimer() {
    showPlayerControls();
    if (playerControlsTimer) clearTimeout(playerControlsTimer);
    if (state.screen === 'player' && !state.stopped) {
      playerControlsTimer = setTimeout(hidePlayerControls, 4000);
    }
  }

  function toggleSearch() {
    if (state.searchOpen) {
      closeSearch();
    } else {
      openSearch();
    }
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
    state.searchOpen = true;
    el.panel.className = 'searchPanel on';
    el.search.className = 'search open';
    el.search.focus();
    toast(isTouch() ? 'Escribe el nombre de un canal'
                    : 'Escribe para buscar y pulsa BACK o ESC para cerrar');
  }

  /** true en movil o tableta: cambia el texto de ayuda, no el comportamiento. */
  function isTouch() {
    return !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  }

  function closeSearch() {
    state.searchOpen = false;
    el.search.className = 'search';
    el.search.blur();
    el.count.textContent = '';
  }

  /* ---------------------------------------------------------------- *
   * Foco
   * ---------------------------------------------------------------- */
  function paintFocus() {
    var cards = el.shelves.querySelectorAll('.card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].className = cards[j].className.replace(/\s*focused\b/, '');
    }

    var mas = $('btnMas');
    if (mas) mas.className = mas.className.replace(/\s*focused\b/, '');

    if (state.zone === 'shelf') {
      if (state.masFocus && mas) {
        mas.className += ' focused';
      } else {
        var node = cardNode();
        if (node) node.className += ' focused';
      }
    }
  }

  function cardNode() {
    if (state.masFocus) return $('btnMas');
    return el.shelves.querySelector('.card[data-card="' + state.card + '"]');
  }

  /** Centra la ficha enfocada verticalmente para que no quede en el borde inferior. */
  function revealCard() {
    var node = cardNode();
    if (!node) return;

    var nr = node.getBoundingClientRect();
    var cr = el.shelves.getBoundingClientRect();
    var delta = (nr.top + nr.height / 2) - (cr.top + cr.height / 2);
    el.shelves.scrollTop += delta;
  }

  /* ---------------------------------------------------------------- *
   * Reproduccion
   * ---------------------------------------------------------------- */
  function playItem(item) {
    el.title.textContent = item.title || '';
    el.quality.innerHTML = '';
    state.playing = item;
    state.stopped = false;
    addRecent(item);
    updatePlayerFavBtn();
    updateMuteUI();
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
      // Marcar el canal como fallido para no volver a intentarlo.
      try {
        var failed = JSON.parse(localStorage.getItem('tv_failed') || '[]');
        if (failed.indexOf(item.id) === -1) failed.push(item.id);
        localStorage.setItem('tv_failed', JSON.stringify(failed));
        state.failed = failed;
        state.items = state.allItems.filter(function (it) { return state.failed.indexOf(it.id) === -1; });
        state.byId = {};
        for (var i = 0; i < state.items.length; i++) state.byId[state.items[i].id] = state.items[i];
        buildGroups(); updateSearchUi();
      } catch (err) {}
      toast('Canal fallido y ocultado: ' + e.message);
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
    if (playerControlsTimer) { clearTimeout(playerControlsTimer); playerControlsTimer = null; }
    showPlayerControls();
    var aviso = $('playerStopped');
    if (aviso) aviso.style.display = 'block';
    el.status.textContent = 'Emision detenida';
    toast('Emision detenida');
  }

  /** Volver: cierra el reproductor y regresa a la lista de canales. */
  function goBackToList() {
    if (state.stopped) {
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
    if (name === 'player') {
      showPlayerControls();
      resetPlayerControlsTimer();
    } else {
      if (playerControlsTimer) { clearTimeout(playerControlsTimer); playerControlsTimer = null; }
      showPlayerControls();
    }

    el.tabCatalog.className = (name === 'catalog') ? 'active' : '';
    el.tabGuide.className   = (name === 'guide')   ? 'active' : '';

    if (name === 'guide' && guide) guide.render();
  }

  /* ---------------------------------------------------------------- *
   * Navegacion
   * ---------------------------------------------------------------- */
  function bindInput() {
    document.addEventListener('keydown', function (e) {
      if (e.target === el.search && e.keyCode !== 27 && e.keyCode !== 8) return;

      if (isKey(e, KEY.OK)) {
        if (state.screen === 'catalog') {
          if (state.masFocus) {
            verMas();
          } else {
            var it = state.groups[0] && state.groups[0].items[state.card];
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
          resetPlayerControlsTimer();
        }
        e.preventDefault(); return;
      }

      if (isKey(e, KEY.BACK)) {
        if (state.screen === 'player') { goBackToList(); }
        else if (state.screen === 'guide') { showScreen('catalog'); }
        else if (el.search === document.activeElement || el.search.value || state.searchOpen) {
          el.search.value = '';
          state.query = '';
          state.shelf = 0;
          state.card = 0;
          state.masFocus = false;
          closeSearch();
          buildGroups();
          render();
        }
        else if (window.history.length > 1) { window.history.back(); }
        e.preventDefault(); return;
      }

      if (state.screen === 'player') {
        resetPlayerControlsTimer();
        if (isKey(e, KEY.RIGHT)) { playNextChannel(); e.preventDefault(); return; }
        if (isKey(e, KEY.LEFT))  { playPrevChannel(); e.preventDefault(); return; }
        if (isKey(e, KEY.UP))    { toggleMute(); e.preventDefault(); return; }
        if (isKey(e, KEY.DOWN))  { reloadCurrentStream(); e.preventDefault(); return; }
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
      // Salto rapido por letra inicial.
      if (e.keyCode >= 65 && e.keyCode <= 90 && !state.searchOpen) {
        var letter = String.fromCharCode(e.keyCode).toLowerCase();
        var g = state.groups[0];
        if (g) {
          for (var li = 0; li < g.items.length; li++) {
            if (g.items[li].title.toLowerCase().charAt(0) === letter) {
              state.card = li; state.masFocus = false;
              if (li >= (state.shown[0] || CHUNK)) {
                state.shown[0] = li + CHUNK;
                renderShelves();
              }
              paintFocus(); revealCard();
              e.preventDefault(); return;
            }
          }
        }
      }
      if (move(isKey(e, KEY.LEFT) ? -1 : isKey(e, KEY.RIGHT) ? 1 : 0,
               isKey(e, KEY.UP) ? -1 : isKey(e, KEY.DOWN) ? 1 : 0)) {
        e.preventDefault();
      }
    });
  }

  /** dc horizontal (salto de pagina), dr vertical (paso a paso). */
  function move(dc, dr) {
    var g = state.groups[0];
    if (!g) return false;

    var total = g.items.length;
    var limit = Math.min(total, state.shown[0] || CHUNK);
    var hayMas = limit < total;
    var PAGINA = 4;

    if (dc) {
      if (dc > 0) {
        // Derecha: avanza una pagina; si toca el final, cae en "Ver más".
        if (state.masFocus) { verMas(); return true; }
        var next = state.card + PAGINA;
        if (next >= limit) {
          if (hayMas) { state.card = limit; state.masFocus = true; }
          else { state.card = limit - 1; }
        } else {
          state.card = next;
        }
      } else {
        // Izquierda: retrocede una pagina.
        if (state.masFocus) { state.masFocus = false; state.card = limit - 1; }
        else { state.card = Math.max(0, state.card - PAGINA); }
      }
      paintFocus();
      revealCard();
      return true;
    }

    if (dr > 0) {
      if (state.masFocus) return true;
      if (state.card < limit - 1) {
        state.card += 1;
      } else if (hayMas) {
        state.card = limit;          // foco al boton "Ver más"
        state.masFocus = true;
      }
      paintFocus();
      revealCard();
      return true;
    }

    if (dr < 0) {
      if (state.masFocus) {
        state.masFocus = false;
        state.card = limit - 1;
      } else if (state.card > 0) {
        state.card -= 1;
      }
      paintFocus();
      revealCard();
      return true;
    }

    return false;
  }

  function bindRemote() {
    if (window.navigator && navigator.remote && navigator.remote.playButton) {
      navigator.remote.playButton.addEventListener('click', function () {
        if (state.screen !== 'catalog') return;
        if (state.masFocus) { verMas(); return; }
        var it = state.groups[0] && state.groups[0].items[state.card];
        if (it) playItem(it);
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