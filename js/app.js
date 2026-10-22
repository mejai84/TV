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
    seriesItem: null,     // serie en reproduccion (para el selector de capítulos)
    seriesSeason: 1,      // temporada actual del reproductor
    seriesEpisode: 1,     // episodio actual del reproductor
    panelSeason: 1,       // temporada visible en el selector del reproductor
    catalogAll: [],       // catálogo VOD completo para los filtros
    catalogGenre: '',     // filtro de género activo
    catalogYear: '',      // filtro de año activo
    query: '',
    deepLinkDone: false,   // ?play= ya procesado
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
    theme: 'light',        // tema: light | contrast (la app es clara por defecto)
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
    el.scrollHint= $('scrollHint');
    el.band      = document.querySelector('.band');
    el.status    = $('playerStatus');
    el.playerUI  = $('playerScreen');
    el.catalogUI = $('catalogScreen');
    el.guideUI   = $('guideScreen');
    el.epgRoot   = $('epg');
    el.tabCatalog= $('tabCatalog');
    el.tabGuide  = $('tabGuide');
    el.clock     = $('clock');
    el.video     = $('video');
    el.playerStage = $('playerStage');
    el.embedFrame = $('embedFrame');
    el.btnOpenEmbed = $('btnOpenEmbed');
    el.title     = $('nowTitle');
    el.quality   = $('quality');
    el.brand     = $('brand') || null;
    el.search    = $('searchInput');
    el.toast     = $('toast');
    el.panel     = $('searchPanel');
    el.count     = $('searchCount');
    el.langBtn   = $('langSelect');
    el.btnProxy  = $('btnProxy');
    el.btnPiP    = $('btnPiP');

    // Que lista esta cargada ahora, para marcarla en el lateral.
    state.activeSource = currentSourceKey();

    // Idioma de la UI: ES (español), EN (inglés), PT (portugués)
    state.lang = localStorage.getItem('tv_lang') || 'es';
    updateLangUI();
    updateProxyBtn();

    player = new Player(el.video, el.status);
    player.onError = function (m) { toast(m); };
    player.onLevels = function (l) { renderQuality(l); };
    player.onStreamChange = function () { updateServerActive(); updatePlayerMode(); };

    guide = new Guide(el.epgRoot, {
      hours: (CONFIG.epg && CONFIG.epg.hours) || 6,
      onPlay: function (sel) {
        var item = state.byId[sel.channelId];
        if (!item) { toast('Ese canal no esta en el catalogo'); return; }
        playItem(item);
      }
    });

    state.adapter = buildAdapter(activeSource());

    // Modo embeds (peliculas/series): oculta la barra de busqueda de canales
    // y la banda "en directo", que solo tiene sentido para TV en vivo.
    try {
      if (activeSource() === 'embeds') document.body.classList.add('embeds-mode');
    } catch (e) { /* */ }

    // Marca el boton activo de la navegacion rapida.
    try {
      var qm = /[?&]src=([a-z]+)/i.exec(window.location.search || '');
      var qk = /[?&]kind=([a-z]+)/i.exec(window.location.search || '');
      var srcNow = qm ? qm[1].toLowerCase() : (CONFIG.source || 'iptvorg');
      var kindNow = qk ? qk[1].toLowerCase() : '';
      // Normaliza plurales para que coincida con data-kind de las pestañas.
      if (kindNow === 'movies') kindNow = 'movie';
      if (kindNow === 'tv') kindNow = 'series';
      var btns = document.querySelectorAll('.quickNav .qn');
      for (var qi = 0; qi < btns.length; qi++) {
        var b = btns[qi];
        var bs = b.getAttribute('data-src') || '';
        var bk = b.getAttribute('data-kind') || '';
        var active = (bs === srcNow) && (bk === kindNow || (bk === '' && !kindNow && bs === 'iptvorg'));
        if (active) b.classList.add('active');
      }
    } catch (e) { /* */ }

    bindInput();
    bindRemote();
    bindTabs();
    bindQuickNav();
    startClock();

    // La banda puede medir una o dos filas segun el ancho. Se sincroniza
    // con el CSS para que buscador y guia queden justo debajo.
    syncBandHeight();
    if (el.scrollHint) {
      el.scrollHint.addEventListener('click', scrollShelvesPage);
    }
    if (el.shelves) {
      el.shelves.addEventListener('scroll', updateScrollHint);
    }
    window.addEventListener('resize', function () {
      syncBandHeight();
      updateScrollHint();
    });

    // Doble clic (raton) o doble toque (telefono/tablet) sobre el video:
    // pantalla completa. En modo embed el iframe del servidor se queda con
    // el evento; alli se usa el boton "Completa" de la app.
    if (el.playerStage) {
      el.playerStage.addEventListener('dblclick', function (e) {
        if (e.target && e.target.id === 'embedFrame') return;
        toggleFullscreen();
      });
      var lastTap = 0;
      el.playerStage.addEventListener('touchend', function (e) {
        var target = e.target;
        if (target && target.id !== 'video' && target !== el.playerStage) return;
        var now = Date.now();
        if (now - lastTap < 360) {
          e.preventDefault();
          toggleFullscreen();
          lastTap = 0;
        } else {
          lastTap = now;
        }
      }, false);
    }

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
      if (e.keyCode === 13) el.search.blur();
      else if (e.keyCode === 27) { e.preventDefault(); clearSearch(); }
    });

    var btnSearch = $('btnSearch');
    if (btnSearch) btnSearch.addEventListener('click', function () { openSearch(); });
    var btnOpenSearch = $('btnOpenSearch');
    if (btnOpenSearch) btnOpenSearch.addEventListener('click', function () { toggleSearch(); });
    var btnCloseSearch = $('btnCloseSearch');
    if (btnCloseSearch) btnCloseSearch.addEventListener('click', function () { clearSearch(); });

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
    // Cuando el stage entra a pantalla completa, la barra superior tapa el
    // boton de cerrar del anuncio del embed. Se oculta en ese estado.
    function syncFullscreenClass() {
      var doc = document;
      var fsEl = doc.fullscreenElement || doc.webkitFullscreenElement ||
                 doc.mozFullScreenElement || doc.msFullscreenElement;
      if (el.playerUI) {
        if (fsEl) el.playerUI.classList.add('fs-active');
        else el.playerUI.classList.remove('fs-active');
      }
    }
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange',
     'MSFullscreenChange'].forEach(function (ev) {
      document.addEventListener(ev, syncFullscreenClass);
    });
    var btnOpenEmbed = $('btnOpenEmbed');
    if (btnOpenEmbed) btnOpenEmbed.addEventListener('click', function () { openCurrentEmbed(); });
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

    var btnProxy = $('btnProxy');
    if (btnProxy) btnProxy.addEventListener('click', function () { toggleProxy(); });

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

    var btnAddTitle = $('btnAddTitle');
    if (btnAddTitle) btnAddTitle.addEventListener('click', function () { openAddTitle(); });
    var btnAddTitleSubmit = $('btnAddTitleSubmit');
    if (btnAddTitleSubmit) btnAddTitleSubmit.addEventListener('click', function () { submitAddTitle(); });
    var btnAddTitleCancel = $('btnAddTitleCancel');
    if (btnAddTitleCancel) btnAddTitleCancel.addEventListener('click', function () { closeAddTitle(); });
    // El campo de TMDB es el unico input de texto de la app. Enter confirma
    // sin cerrar el modal; el manejador global de teclas no debe interceptar
    // letras, numeros ni Backspace (ver bindInput).
    var addTitleIdEl = $('addTitleId');
    if (addTitleIdEl) {
      addTitleIdEl.addEventListener('keydown', function (e) {
        if (e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); submitAddTitle(); }
      });
    }

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
      // La app es clara por defecto. El modo "dark" anterior se migra a claro;
      // solo se conserva la preferencia de alto contraste.
      var t = localStorage.getItem('tv_theme');
      state.theme = (t === 'contrast') ? 'contrast' : 'light';
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

  /** Carga la sección Novedades desde el índice del servidor. */
  function loadNovelties(lb) {
    fetch('/api/novelties?days=14')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var items = (d && d.items) || [];
        state.allItems = items;
        state.failed = loadFailed();
        state.items = state.allItems.filter(function (it) { return state.failed.indexOf(it.id) === -1; });
        state.indice = null;
        state.byId = {};
        for (var i = 0; i < state.items.length; i++) state.byId[state.items[i].id] = state.items[i];
        buildGroups();
        maybeOpenDeepLink();
        if (!state.items.length) {
          el.shelves.innerHTML =
            '<div class="epg-empty">Aún no hay novedades registradas.<br>' +
            'Solo se muestran títulos detectados recientemente por el escáner diario ' +
            '(últimos 14 días). El catálogo completo está en Películas y Series.</div>';
        }
        if (lb) lb.className = 'loadingBar';
      })
      .catch(function (e) {
        toast('No se pudo cargar novedades: ' + e.message);
        el.shelves.innerHTML =
          '<div class="epg-empty">No se pudo cargar novedades.<br>' +
          Utils.esc(e.message) + '</div>';
        if (lb) lb.className = 'loadingBar';
      });
  }

  function loadCatalog() {
    var lb = $('loadingBar');
    if (lb) lb.className = 'loadingBar on';

    // Sección Novedades: no usa el adaptador, consulta el índice reciente.
    if (isNoveltiesMode()) {
      loadNovelties(lb);
      return;
    }

    state.adapter.list().then(function (items) {
      state.allItems = items || [];
      state.failed = loadFailed();
      state.items = state.allItems.filter(function (it) { return state.failed.indexOf(it.id) === -1; });

      // Filtro por kind cuando se pide via ?kind=movies|series (navegacion
      // rapida estilo GoPelis). Solo aplica a la fuente 'embeds'.
      try {
        var km = /[?&]kind=([a-z]+)/i.exec(window.location.search || '');
        if (km) {
          var k = km[1].toLowerCase();
          if (k === 'movies' || k === 'movie') {
            state.items = state.items.filter(function (it) { return it.kind === 'movie' || it.kind === 'vod'; });
          } else if (k === 'series' || k === 'tv') {
            state.items = state.items.filter(function (it) { return it.kind === 'series' || it.kind === 'tv'; });
          }
        }
      } catch (e) { /* sin location.search */ }

      // El índice de búsqueda se construye con state.items; al cambiar de
      // sección o de filtro hay que invalidarlo o el buscador VOD devuelve
      // resultados de la lista anterior.
      state.indice = null;
      state.byId = {};
      for (var i = 0; i < state.items.length; i++) state.byId[state.items[i].id] = state.items[i];
      buildGroups();
      maybeOpenDeepLink();
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
  function isEmbedsMode() {
    try { return activeSource() === 'embeds'; } catch (e) { return false; }
  }

  function catalogKind() {
    var m = /[?&]kind=([a-z]+)/i.exec(window.location.search || '');
    if (!m) return 'movie';
    var k = m[1].toLowerCase();
    if (k === 'series' || k === 'tv') return 'series';
    if (k === 'novelties') return 'novelties';
    return 'movie';
  }

  /** Sección "Novedades": índice reciente, sin crawler. */
  function isNoveltiesMode() {
    return catalogKind() === 'novelties';
  }

  function catalogTitle() {
    if (isNoveltiesMode()) return 'Novedades';
    return catalogKind() === 'series' ? 'Series' : 'Películas';
  }

  /* ---- Control local de "ya visto" para las novedades ------------------ */
  function noveltySeenSet() {
    try { return JSON.parse(localStorage.getItem('tv_novelty_seen') || '[]'); }
    catch (e) { return []; }
  }

  function isSeenNovelty(id) {
    return noveltySeenSet().indexOf(id) !== -1;
  }

  function isNoveltyFresh(iso) {
    var t = Date.parse(String(iso).replace(' ', 'T'));
    if (!t) return false;
    return (Date.now() - t) < 14 * 864e5; // 14 días
  }

  /** Marca un título de novedades como visto (al abrir su ficha). */
  function touchNovelty(id) {
    if (!id) return;
    var seen = noveltySeenSet();
    if (seen.indexOf(id) === -1) {
      seen.push(id);
      if (seen.length > 800) seen = seen.slice(-800);
      try { localStorage.setItem('tv_novelty_seen', JSON.stringify(seen)); } catch (e) {}
    }
  }

  function buildGroups() {
    applyTheme('all');
    state.shown = {};

    // Catálogo VOD: se muestran todos los títulos y los filtros de
    // género/año trabajan sobre la lista completa en memoria.
    if (isEmbedsMode()) {
      state.catalogAll = state.items.slice();
      state.catalogGenre = '';
      state.catalogYear = '';
      state.isFavsFilter = false;
    }

    var hasFilter = (state.quickFilter && state.quickFilter !== 'all') || (state.sortBy && state.sortBy !== 'name');

    if (state.query || hasFilter) {
      var hits;
      if (state.query) {
        hits = buscar(state.query);
      } else {
        hits = buscar('');
      }
      var name = state.query ? 'Resultados' : (isEmbedsMode()
        ? catalogTitle()
        : 'Todos los canales');
      state.groups = [{ name: name, theme: 'all', items: hits, artificial: !!state.query, all: true }];
      state.shown = { 0: isEmbedsMode() ? hits.length : Math.min(hits.length, 48) };
    } else {
      var baseName = isEmbedsMode()
        ? catalogTitle()
        : 'Todos los canales';
      state.groups = [{ name: baseName, theme: 'all', items: state.items }];
      state.shown = { 0: isEmbedsMode() ? state.items.length : 48 };
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
    // El panel se abre solo cuando el usuario busca o filtra: en TV en vivo
    // es util, pero no debe tapar los accesos a Peliculas/Series.
    if (!state.query) { el.count.textContent = ''; return; }

    var n = state.groups.length ? state.groups[0].items.length : 0;
    var unit = isEmbedsMode()
      ? (n === 1 ? ' resultado' : ' resultados')
      : (n === 1 ? ' canal' : ' canales');
    el.count.textContent = n + unit + ' de ' + state.items.length;
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

    // Catálogo uniforme (TV, películas y series): cuadrícula estilo GoPelis.
    renderCatalogPage(g);
  }

  /* ---------------------------------------------------------------- *
   * Altura de la banda y pista de desplazamiento.
   *
   * En movil la banda ocupa dos filas; el buscador y la guia se colocan
   * con la variable --band-h. En el televisor, el mando mueve el foco y
   * la cuadricula se desplaza, pero el usuario necesita una pista visual
   * de que quedan filas abajo.
   * ---------------------------------------------------------------- */
  function syncBandHeight() {
    if (!el.band) return;
    var h = el.band.offsetHeight || 62;
    try { document.documentElement.style.setProperty('--band-h', h + 'px'); } catch (e) {}
  }

  function updateScrollHint() {
    if (!el.scrollHint || !el.shelves) return;
    var s = el.shelves;
    var more = (s.scrollHeight - s.scrollTop - s.clientHeight) > 16;
    var show = more && state.screen === 'catalog';
    if (show) el.scrollHint.className = 'scrollHint on';
    else el.scrollHint.className = 'scrollHint';
  }

  function scrollShelvesPage() {
    if (!el.shelves) return;
    var max = el.shelves.scrollHeight - el.shelves.clientHeight;
    if (max <= 0) return;
    if (el.shelves.scrollTop >= max - 8) {
      var mas = $('btnMas');
      if (mas) { mas.click(); return; }
    }
    var step = Math.max(140, Math.round(el.shelves.clientHeight * 0.82));
    el.shelves.scrollTop = Math.min(max, el.shelves.scrollTop + step);
    updateScrollHint();
  }

  /* ---------------------------------------------------------------- *
   * Catálogo VOD estilo GoPelis: cabecera, filtros y cuadrícula 2:3.
   * ---------------------------------------------------------------- */
  function catalogGenres() {
    var seen = {}, out = [];
    var list = state.catalogAll || [];
    for (var i = 0; i < list.length; i++) {
      var parts = String(list[i].description || '').split(' · ');
      for (var j = 0; j < parts.length; j++) {
        var g = parts[j];
        // Descarta descripciones largas que algunos respaldos meten en el
        // campo de género; un género real no pasa de unas pocas palabras.
        if (!g || g.length > 24 || /^fuente:/i.test(g)) continue;
        if (!seen[g]) { seen[g] = 1; out.push(g); }
      }
    }
    out.sort(function (a, b) { return a.localeCompare(b, 'es'); });
    return out;
  }

  function catalogYears() {
    var seen = {}, out = [];
    var list = state.catalogAll || [];
    for (var i = 0; i < list.length; i++) {
      var y = String(list[i].year || '');
      if (y && !seen[y]) { seen[y] = 1; out.push(y); }
    }
    out.sort(function (a, b) { return b - a; });
    return out;
  }

  function channelInitials(title) {
    var clean = String(title || '').replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ]/g, ' ').trim();
    var parts = clean.split(/\s+/);
    var out = (parts[0] || '?').charAt(0);
    if (parts[1]) out += parts[1].charAt(0);
    return out.toUpperCase();
  }

  function renderCatalogPage(g) {
    var embeds = isEmbedsMode();
    var isSeries = embeds && catalogKind() === 'series';
    var items = g.items || [];
    var genres = embeds && !isSeries ? catalogGenres() : [];
    var years = embeds && !isSeries ? catalogYears() : [];
    var showFilters = !state.isFavsFilter && !isSeries && (genres.length || years.length);

    var title = g.name || (embeds ? (isSeries ? 'Series' : 'Películas') : 'TV en Vivo');
    if (title === 'Todos los canales') title = 'TV en Vivo';

    var unit = embeds
      ? (items.length === 1 ? ' título' : ' títulos')
      : (items.length === 1 ? ' canal' : ' canales');

    var total = items.length;
    var initial = embeds ? total : 48;
    var limit = Math.min(total, state.shown[0] || initial);
    var hayMas = limit < total;

    var html = '<div class="catalogPage">' +
      '<div class="catalogHead"><h1>' + Utils.esc(title) + '</h1>' +
      '<span class="catalogCount">' + total + unit + '</span></div>';

    // Aclaracion para que no se confunda con el catalogo completo: Novedades
    // solo muestra titulos detectados recientemente por el escaner diario.
    if (isNoveltiesMode()) {
      html += '<p class="catalogSub">' +
        'Títulos detectados recientemente (últimos 14 días). ' +
        'El catálogo completo está en Películas y Series.' +
        '</p>';
    }

    html += '<div class="catalogLayout">';

    if (showFilters) {
      html += '<aside class="catalogFilters">';
      if (genres.length) {
        html += '<div class="filterGroup"><h3>Género</h3><div class="filterChips">' +
                '<button class="chip' + (!state.catalogGenre ? ' active' : '') +
                '" data-genre="" tabindex="0">Todos</button>';
        for (var gi = 0; gi < genres.length; gi++) {
          html += '<button class="chip' + (state.catalogGenre === genres[gi] ? ' active' : '') +
                  '" data-genre="' + Utils.esc(genres[gi]) + '" tabindex="0">' +
                  Utils.esc(genres[gi]) + '</button>';
        }
        html += '</div></div>';
      }
      if (years.length) {
        html += '<div class="filterGroup"><h3>Año</h3><div class="filterChips filterYears">' +
                '<button class="chip' + (!state.catalogYear ? ' active' : '') +
                '" data-year="" tabindex="0">Todos</button>';
        for (var yi = 0; yi < years.length; yi++) {
          html += '<button class="chip' + (state.catalogYear === years[yi] ? ' active' : '') +
                  '" data-year="' + Utils.esc(years[yi]) + '" tabindex="0">' +
                  Utils.esc(years[yi]) + '</button>';
        }
        html += '</div></div>';
      }
      html += '</aside>';
    }

    html += '<div class="posterGrid" id="posterGrid">';
    if (!items.length) {
      html += '<div class="catalogEmpty">' +
        (embeds ? 'No hay títulos para este filtro.' : 'No hay canales para mostrar.') +
        '</div>';
    }
    for (var i = 0; i < limit; i++) {
      var it = items[i];
      var focused = (i === state.card) && !state.masFocus;
      var live = !embeds ? (state.onAir[it.id] || state.onAir[it.tvgId]) : '';
      var meta = [];

      if (embeds) {
        if (it.year) meta.push(it.year);
        if (it.description && !/^fuente:/i.test(it.description)) {
          meta.push(String(it.description).split(' · ')[0]);
        } else if (isSeries) {
          meta.push('Serie');
        }
      } else if (live) {
        meta.push(live);
      } else if (it.group) {
        meta.push(it.group);
      }

      html += '<div class="card posterCard' + (embeds ? '' : ' liveCard') +
              (focused ? ' focused' : '') +
              '" data-card="' + i + '" tabindex="0">' +
              '<div class="posterFrame">';

      if (embeds) {
        var cardKind = (it.kind === 'series' || it.kind === 'tv') ? 'SERIE' : 'PELÍCULA';
        var isNovel = isNoveltiesMode() && it.firstSeenAt &&
          isNoveltyFresh(it.firstSeenAt) && !isSeenNovelty(it.id);
        html += (isNovel ? '<span class="pNew">NUEVO</span>' : '') +
          (it.poster
          ? '<img src="' + Utils.esc(it.poster) + '" alt="" loading="lazy">'
          : '<div class="thumb blank" style="position:absolute;inset:0;border:0;border-radius:0;padding:0;"></div>') +
          (it.rating ? '<span class="pRate">&#9733; ' + Utils.esc(it.rating) + '</span>' : '') +
          '<span class="pQual">HD</span>' +
          '<span class="pKind">' + cardKind + '</span>';
      } else {
        html += '<div class="chanBg"></div>' +
          (it.poster
            ? '<img class="chanLogo" src="' + Utils.esc(it.poster) + '" alt="" loading="eager" ' +
              'decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">'
            : '') +
          '<span class="chanInitials">' + Utils.esc(channelInitials(it.title)) + '</span>' +
          '<span class="pKind live">EN VIVO</span>' +
          (isFav(it.id) ? '<span class="cardFavStar" title="Favorito">&#9733;</span>' : '');
      }

      html += '<div class="pOverlay"><h3>' + Utils.esc(it.title) + '</h3>' +
        (meta.length ? '<p class="pMeta">' + Utils.esc(meta.join(' · ')) + '</p>' : '') +
        '</div></div>' +
        '<div class="pTitle">' + Utils.esc(it.title) + '</div>' +
        '</div>';
    }

    if (hayMas) {
      html += '<button id="btnMas" class="catalogMore' + (state.masFocus ? ' focused' : '') + '" tabindex="0">' +
        '<span class="btnMasText">' + (embeds ? 'Ver más títulos' : 'Ver más canales') + '</span>' +
        '<span class="btnMasCount">' + limit + ' de ' + total + '</span>' +
        '</button>';
    }

    html += '</div></div></div>';

    var keepScroll = el.shelves.scrollTop;
    el.shelves.innerHTML = html;
    el.shelves.scrollTop = keepScroll;

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

    var chips = el.shelves.querySelectorAll('.chip');
    for (var k = 0; k < chips.length; k++) {
      (function (chip) {
        chip.addEventListener('click', function () {
          if (chip.hasAttribute('data-genre')) {
            state.catalogGenre = chip.getAttribute('data-genre') || '';
          }
          if (chip.hasAttribute('data-year')) {
            state.catalogYear = chip.getAttribute('data-year') || '';
          }
          applyCatalogFilter();
        });
      })(chips[k]);
    }

    var mas = $('btnMas');
    if (mas) mas.addEventListener('click', function () { verMas(); });
    updateScrollHint();
  }

  function applyCatalogFilter() {
    var all = state.catalogAll || [];
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var it = all[i];
      if (state.catalogGenre) {
        var parts = String(it.description || '').split(' · ');
        if (parts.indexOf(state.catalogGenre) === -1) continue;
      }
      if (state.catalogYear && String(it.year || '') !== state.catalogYear) continue;
      out.push(it);
    }
    if (!state.groups[0]) return;
    state.groups[0].items = out;
    state.shown[0] = out.length;
    state.card = 0;
    state.masFocus = false;
    state.zone = 'shelf';
    render();
    revealCard();
  }

  /** Columnas visibles de la cuadrícula (coincide con las media queries). */
  function gridColumns() {
    var w = window.innerWidth || document.documentElement.clientWidth || 1200;
    if (w > 1240) return 5;
    if (w > 1040) return 4;
    if (w > 560) return 3;
    return 2;
  }

  /* ---------------------------------------------------------------- *
   * Navegación espacial con el mando (flechas + OK).
   * Sirve para la cuadrícula, la ficha y el selector de episodios.
   * ---------------------------------------------------------------- */
  function spatialNodes(container) {
    if (!container) return [];
    var all = container.querySelectorAll('button, [tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.disabled) continue;
      if (n.getAttribute('aria-hidden') === 'true') continue;
      if (n.offsetWidth === 0 && n.offsetHeight === 0) continue;
      out.push(n);
    }
    return out;
  }

  function focusNode(container, node) {
    var cards = container.querySelectorAll('.posterCard');
    for (var i = 0; i < cards.length; i++) {
      cards[i].className = cards[i].className.replace(/\s*focused\b/, '');
    }
    if (node.classList && node.classList.contains('posterCard')) {
      node.className += ' focused';
      state.card = parseInt(node.getAttribute('data-card'), 10) || 0;
    }
    // Si el foco cae en un capitulo de la ficha, el boton "Ver" debe
    // reflejar ese capitulo (algunos TV no disparan eventos focus).
    if (node.classList && node.classList.contains('episodeCard')) {
      var epFocus = parseInt(node.getAttribute('data-episode'), 10);
      if (epFocus) {
        seriesOverlayState.currentEpisode = epFocus;
        markSelectedEpisode();
      }
    }
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }

    // scrollIntoView con opciones no funciona en varios navegadores de TV:
    // el foco se movia pero la cuadricula no bajaba. Se ajusta el scroll
    // del contenedor a mano, que es compatible con todos.
    if (container && container.scrollHeight > container.clientHeight) {
      var nr = node.getBoundingClientRect();
      var cr = container.getBoundingClientRect();
      var pad = 18;
      if (nr.bottom > cr.bottom - pad) {
        container.scrollTop += (nr.bottom - cr.bottom) + pad;
      } else if (nr.top < cr.top + pad) {
        container.scrollTop -= (cr.top - nr.top) + pad;
      }
    }
    updateScrollHint();
  }

  function spatialMove(container, dx, dy) {
    var nodes = spatialNodes(container);
    if (!nodes.length) return false;

    var cur = document.activeElement;
    if (!cur || nodes.indexOf(cur) === -1) {
      cur = container.querySelector('.posterCard.focused') || null;
    }
    if (!cur) { focusNode(container, nodes[0]); return true; }

    var cr = cur.getBoundingClientRect();
    var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    var best = null, bestScore = 1e9;

    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === cur) continue;
      var r = n.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var ddx = x - cx, ddy = y - cy;
      if (dx && (dx > 0 ? ddx < 2 : ddx > -2)) continue;
      if (dy && (dy > 0 ? ddy < 2 : ddy > -2)) continue;
      var primary = dx ? Math.abs(ddx) : Math.abs(ddy);
      var perp = dx ? Math.abs(ddy) : Math.abs(ddx);
      var score = primary + perp * 2.4;
      if (score < bestScore) { bestScore = score; best = n; }
    }

    if (!best) return false;
    focusNode(container, best);
    return true;
  }

  /** Pinta el siguiente tramo y deja el foco en el primer canal nuevo. */
  function verMas() {
    var g = state.groups[0];
    if (!g) return;
    var total = g.items.length;
    var embeds = isEmbedsMode();
    var step = embeds ? total : 48;
    var shown = state.shown[0] || (embeds ? total : 48);
    if (shown >= total) return;

    state.card = shown;
    state.masFocus = false;
    state.shown[0] = Math.min(total, shown + step);
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
    // En VOD el iframe debe ocupar toda la pantalla. Si fullscreeneamos el
    // documento, el stage sigue limitado por 78vh y el botón de cerrar del
    // anuncio queda por debajo del área visible.
    var elem = (isEmbedsMode() && el.playerStage) ? el.playerStage : document.documentElement;
    var isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
    if (!isFs) {
      try {
        if (elem.requestFullscreen) elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
        else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
        else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
        toast('Pantalla completa');
      } catch (e) {
        toast('Pantalla completa no disponible');
      }
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
    var src = activeSource();
    var q = '?play=' + encodeURIComponent(state.playing.id) + '&src=' + encodeURIComponent(src);
    if (src === 'embeds') {
      var isSeries = state.playing.kind === 'series' || state.playing.kind === 'tv';
      q += '&kind=' + (isSeries ? 'series' : 'movie');
      // En NasriPlay el id puede ser el slug; el tmdbId permite abrir la
      // ficha aunque el título no esté en las primeras páginas del catálogo.
      if (state.playing.tmdbId && String(state.playing.tmdbId) !== String(state.playing.id)) {
        q += '&tmdb=' + encodeURIComponent(state.playing.tmdbId);
      }
    } else {
      var cc = currentSourceKey();
      if (cc) q += '&cc=' + encodeURIComponent(cc);
    }
    var url = location.href.split('?')[0] + q;
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
    state.theme = (state.theme === 'contrast') ? 'light' : 'contrast';
    try { localStorage.setItem('tv_theme', state.theme); } catch (e) {}
    applyThemeMode();
    toast('Tema: ' + (state.theme === 'light' ? 'claro' : 'alto contraste'));
  }

  function applyThemeMode() {
    document.body.className = document.body.className
      .replace(/\btema-claro\b/g, '').replace(/\balto-contraste\b/g, '').replace(/\s+/g, ' ').trim();
    document.body.className += ' tema-claro';
    if (state.theme === 'contrast') document.body.className += ' alto-contraste';
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

  /* ---------------------------------------------------------------- *
   * Proxy de streaming
   *
   * El proxy es optativo: gasta datos y ancho de banda, así que por
   * defecto está apagado. El botón de la barra lo enciende o apaga y
   * la elección se recuerda en localStorage; ?proxy=on también lo
   * fuerza mientras la URL lo lleve.
   * ---------------------------------------------------------------- */
  function updateProxyBtn() {
    var btn = el.btnProxy || $('btnProxy');
    if (!btn) return;
    var on = PROXY.isOn();
    if (btn.classList) btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('title', on
      ? 'Proxy activado: los canales pasan por el proxy (consumo extra). Pulsa para desactivar.'
      : 'Activar proxy: los canales pasan por el proxy (consumo extra).');
    var label = btn.querySelector ? btn.querySelector('.proxyLabel') : null;
    if (label) label.textContent = on ? 'Proxy ON' : 'Proxy';
  }

  function toggleProxy() {
    PROXY.set(!PROXY.isOn());
    updateProxyBtn();
    toast(PROXY.isOn() ? 'Proxy activado' : 'Proxy desactivado');
    // Si hay un canal de TV en marcha, reconectar para que coja el proxy.
    // Los embeds de películas/series no usan el proxy.
    if (state.playing && state.playing.kind === 'live') reloadCurrentStream();
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

  function openAddTitle() {
    var o = $('addTitleOverlay');
    if (o) o.style.display = 'flex';
    var st = $('addTitleStatus');
    if (st) st.textContent = '';
    var inp = $('addTitleId');
    if (inp) { inp.value = ''; try { inp.focus(); } catch (e) {} }
  }

  function closeAddTitle() {
    var o = $('addTitleOverlay');
    if (o) o.style.display = 'none';
  }

  function submitAddTitle() {
    var id = Utils.trim(($('addTitleId') && $('addTitleId').value) || '');
    var type = ($('addTitleType') && $('addTitleType').value) || 'movie';
    var st = $('addTitleStatus');
    if (!id) { if (st) st.textContent = 'Ingresa un TMDB ID.'; return; }
    if (!/^\d{1,10}$/.test(id)) { if (st) st.textContent = 'El ID de TMDB debe ser numérico.'; return; }
    if (st) st.textContent = 'Buscando…';
    var headers = { 'Content-Type': 'application/json' };
    try {
      var adminToken = localStorage.getItem('xupper_admin_token') || '';
      if (adminToken) headers.Authorization = 'Bearer ' + adminToken;
    } catch (e) { /* localStorage puede estar bloqueado */ }
    fetch('/api/add-title', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ id: id, type: type })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d || !res.d.item) {
          if (st) st.textContent = (res.d && res.d.error) ? res.d.error : 'Error al agregar.';
          return;
        }
        var item = res.d.item;
        // Si no estamos en modo VOD, redirigir a la sección correspondiente.
        if (!isEmbedsMode()) {
          var k = (item.kind === 'series' || item.kind === 'tv') ? 'series' : 'movie';
          window.location.href = window.location.pathname + '?src=embeds&kind=' + k;
          return;
        }
        // Agregar a la lista en memoria si no existe.
        if (!state.items) state.items = [];
        var exists = false;
        for (var i = 0; i < state.items.length; i++) {
          if (state.items[i].id === item.id) { exists = true; break; }
        }
        if (!exists) state.items.push(item);
        state.indice = null;
        if (!state.allItems) state.allItems = state.items.slice();
        else {
          var aexists = false;
          for (var j = 0; j < state.allItems.length; j++) {
            if (state.allItems[j].id === item.id) { aexists = true; break; }
          }
          if (!aexists) state.allItems.push(item);
        }
        state.byId[item.id] = item;
        buildGroups();
        updateSearchUi();
        if (st) st.textContent = (res.d.persisted ? 'Agregado y guardado en la BD.' : 'Agregado (no persistido: BD no configurada).') +
          (item.resolved ? ' Encontrado en NasriPlay (sin anuncios posible).' : ' No está en NasriPlay (con anuncios).');
        toast('Agregado: ' + item.title);
        // Cerrar tras un momento.
        setTimeout(function () { closeAddTitle(); }, 1200);
      })
      .catch(function (e) {
        if (st) st.textContent = 'Error: ' + e.message;
      });
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
    // En peliculas/series el overlay se queda visible (barra superior compacta)
    // para no tapar los controles del reproductor embebido; solo se oculta
    // solo en TV en vivo.
    if (state.screen === 'player' && !state.stopped && !isEmbedsMode()) {
      playerControlsTimer = setTimeout(hidePlayerControls, 3000);
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
    // Ojo: no borrar "tema-claro". Antes se usaba /\btema-\S+/ y al cambiar
    // de categoria o al buscar se perdia el tema claro.
    app.className = app.className
      .replace(/\btema-(?:all|sports|movies|series|kids|news|docs|music|entertainment|faith|culture|lifestyle|family|business|education|public|other)\b/g, '')
      .replace(/\s+/g, ' ').trim();
    app.className += ' tema-' + (theme || 'other');
  }

  function openSearch() {
    var vod = isEmbedsMode();
    state.searchOpen = true;
    el.panel.className = 'searchPanel on';
    el.search.className = 'search open';
    el.search.setAttribute('placeholder', vod
      ? 'Buscar películas y series...'
      : 'Buscar canales...');
    el.search.focus();
    toast(vod
      ? (isTouch() ? 'Escribe un título para filtrar el catálogo'
                   : 'Escribe un título; ESC o × para cerrar')
      : (isTouch() ? 'Escribe el nombre de un canal'
                   : 'Escribe para buscar y pulsa BACK o ESC para cerrar'));
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
    if (el.panel) el.panel.className = 'searchPanel';
  }

  /** Cierra el buscador y devuelve el catálogo completo (X o ESC). */
  function clearSearch() {
    if (el.search) el.search.value = '';
    state.query = '';
    state.shelf = 0;
    state.card = 0;
    state.masFocus = false;
    closeSearch();
    buildGroups();
    render();
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
    // Películas y series: ficha estilo GoPelis antes de reproducir.
    if (isEmbedsMode()) {
      openDetail(item);
      return;
    }

    // Series: mostrar selector de temporada/episodio (estilo GoPelis)
    // en lugar de reproducir directamente.
    if (item && (item.kind === 'series' || item.kind === 'tv') && state.adapter && typeof state.adapter._tmdb === 'function') {
      openDetail(item);
      return;
    }

    startPlayback(item);
  }

  /** Reproduce un título (película o canal) en el reproductor. */
  function startPlayback(item) {
    state.seriesItem = null;
    state.seriesSeason = 1;
    state.seriesEpisode = 1;
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
      renderServerPanel(streams);
      return player.play(item, streams, function (i) { return state.adapter.resolve(i); });
    }).catch(function (e) {
      // Marcar el canal como fallido para no volver a intentarlo.
      try {
        var failed = JSON.parse(localStorage.getItem('tv_failed') || '[]');
        if (failed.indexOf(item.id) === -1) failed.push(item.id);
        localStorage.setItem('tv_failed', JSON.stringify(failed));
        state.failed = failed;
        state.items = state.allItems.filter(function (it) { return state.failed.indexOf(it.id) === -1; });
        state.indice = null;
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
      if (isEmbedsMode() && seriesOverlayState.item) { showScreen('detail'); return; }
      showScreen('catalog');
      return;
    }
    player.stop(true);
    el.video.pause();
    el.video.removeAttribute('src');
    try { el.video.load(); } catch (e) { /* navegadores viejos */ }
    if (isEmbedsMode() && seriesOverlayState.item) { showScreen('detail'); return; }
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
    var detailUI = $('detailScreen');
    if (detailUI) detailUI.style.display = (name === 'detail') ? 'block' : 'none';
    if (name === 'detail' && detailUI) { try { detailUI.scrollTop = 0; } catch (e) {} }
    el.playerUI.style.display  = (name === 'player')  ? 'block' : 'none';

    // En Películas/Series el reproductor deja de ser pantalla completa:
    // el vídeo va arriba y debajo el selector de capítulos (GoPelis).
    var vod = (name === 'player') && isEmbedsMode();
    var pePanel = $('playerEpisodePanel');
    var isSeriesPlay = !!(state.seriesItem && (state.seriesItem.kind === 'series' || state.seriesItem.kind === 'tv'));
    el.playerUI.className = vod ? ('vod' + (isSeriesPlay ? ' has-episodes' : '')) : '';
    updatePlayerMode();
    if (pePanel) pePanel.style.display = (vod && isSeriesPlay) ? 'block' : 'none';
    var btnEp = $('btnEpisodes');
    if (btnEp) btnEp.style.display = (vod && isSeriesPlay) ? 'inline-flex' : 'none';
    var btnSrv = $('btnServers');
    if (btnSrv && !vod) btnSrv.style.display = 'none';
    if (name !== 'player') closeServerPanel();
    if (vod) { try { el.playerUI.scrollTop = 0; } catch (e) {} }

    if (name !== 'player') player.stop(true);
    if (name === 'player') {
      showPlayerControls();
      resetPlayerControlsTimer();
      if (vod && isSeriesPlay) renderPlayerPanel();
    } else {
      if (playerControlsTimer) { clearTimeout(playerControlsTimer); playerControlsTimer = null; }
      showPlayerControls();
    }

    el.tabCatalog.className = (name === 'catalog') ? 'active' : '';
    el.tabGuide.className   = (name === 'guide')   ? 'active' : '';

    syncBandHeight();
    updateScrollHint();

    if (name === 'guide' && guide) guide.render();
  }

  /* ---------------------------------------------------------------- *
   * Navegacion
   * ---------------------------------------------------------------- */
  function bindInput() {
    document.addEventListener('keydown', function (e) {
      // Los campos de formulario (alta manual, selects) deben recibir sus
      // teclas normales. Antes, el manejador global se comia letras y
      // Backspace y era imposible escribir un TMDB ID con el mando.
      var tgt = e.target;
      var tag = tgt && tgt.tagName ? String(tgt.tagName).toUpperCase() : '';
      var formField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
                      !!(tgt && tgt.isContentEditable);
      if (formField && tgt !== el.search) {
        if (e.keyCode === 27) {
          var addOv = $('addTitleOverlay');
          if (addOv && addOv.style.display !== 'none') { closeAddTitle(); e.preventDefault(); }
        }
        return;
      }

      // El buscador conserva el BACK del mando para cerrar; el resto de
      // teclas (letras, borrar con el teclado en pantalla) son suyas.
      if (tgt === el.search && e.keyCode !== 27 && e.keyCode !== 8) return;

      // En el reproductor, cualquier tecla vuelve a mostrar la barra de
      // controles (que se oculta sola) para que no se pierdan las opciones.
      if (state.screen === 'player' && !state.stopped) resetPlayerControlsTimer();

      if (isKey(e, KEY.OK)) {
        if (state.screen === 'catalog') {
          var ae = document.activeElement;
          if (ae && ae.classList && ae.classList.contains('chip')) {
            ae.click();
          } else if (ae && ae.id === 'btnMas') {
            verMas();
          } else {
            var it = state.groups[0] && state.groups[0].items[state.card];
            if (it) playItem(it);
          }
        } else if (state.screen === 'detail') {
          var ae2 = document.activeElement;
          if (ae2 && ae2 !== document.body && typeof ae2.click === 'function') ae2.click();
          else { var pb = $('btnDetailPlay'); if (pb) pb.click(); }
        } else if (state.screen === 'guide') {
          guide.activate();
        } else {
          // Reproductor: OK activa el control enfocado o reproduce/pausa.
          if (isEmbedsMode()) {
            var ae3 = document.activeElement;
            if (ae3 && ae3 !== document.body && typeof ae3.click === 'function') {
              ae3.click();
            } else {
              var pp = el.video.play(); if (pp && pp.catch) pp.catch(function () {});
            }
            resetPlayerControlsTimer();
          } else if (state.stopped && state.playing) {
            // Si se detuvo antes, OK vuelve a emitir el mismo canal en vez
            // de solo reanudar un video que ya no existe.
            var aviso = $('playerStopped');
            if (aviso) aviso.style.display = 'none';
            state.stopped = false;
            playItem(state.playing);
          } else {
            var p = el.video.play(); if (p && p.catch) p.catch(function () {});
            resetPlayerControlsTimer();
          }
        }
        e.preventDefault(); return;
      }

      if (isServerPanelOpen() && (isKey(e, KEY.BACK) || e.keyCode === 27)) {
        closeServerPanel();
        e.preventDefault(); return;
      }

      if (isKey(e, KEY.BACK)) {
        if (state.screen === 'player') { goBackToList(); }
        else if (state.screen === 'detail') { showScreen('catalog'); }
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

      if (state.screen === 'detail') {
        var ddx = isKey(e, KEY.RIGHT) ? 1 : isKey(e, KEY.LEFT) ? -1 : 0;
        var ddy = isKey(e, KEY.DOWN) ? 1 : isKey(e, KEY.UP) ? -1 : 0;
        if (ddx || ddy) {
          if (spatialMove($('detailScreen'), ddx, ddy)) e.preventDefault();
          return;
        }
      }

      if (state.screen === 'player') {
        resetPlayerControlsTimer();
        if (isEmbedsMode()) {
          // VOD: las flechas recorren controles y capítulos con el mando.
          var panelOpen = isServerPanelOpen();
          var navRoot = panelOpen ? $('serverPanel') : el.playerUI;
          var pdx = isKey(e, KEY.RIGHT) ? 1 : isKey(e, KEY.LEFT) ? -1 : 0;
          var pdy = isKey(e, KEY.DOWN) ? 1 : isKey(e, KEY.UP) ? -1 : 0;
          if (pdx || pdy) {
            var moved = spatialMove(navRoot, pdx, pdy);
            // Si ya no hay otro control en esa direccion (p.ej. final de la
            // lista de capitulos), desplazamos la pantalla para poder seguir
            // viendo el resto sin depender de la barra de scroll.
            if (!moved && pdy && !panelOpen) {
              var c = el.playerUI;
              if (c && c.scrollHeight > c.clientHeight) {
                var stageH = (el.playerStage && el.playerStage.offsetHeight) || 0;
                var step = Math.max(120, Math.round((c.clientHeight - stageH) * 0.75));
                c.scrollTop += (pdy > 0 ? step : -step);
              }
            }
            e.preventDefault();
            return;
          }
          return;
        }
        if (isKey(e, KEY.RIGHT)) { playNextChannel(); e.preventDefault(); return; }
        if (isKey(e, KEY.LEFT))  { playPrevChannel(); e.preventDefault(); return; }
        if (isKey(e, KEY.UP))    { toggleMute(); resetPlayerControlsTimer(); e.preventDefault(); return; }
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
              var step = isEmbedsMode() ? g.items.length : 48;
              if (li >= (state.shown[0] || step)) {
                state.shown[0] = Math.max(state.shown[0] || step, li + 1);
                renderShelves();
              }
              paintFocus(); revealCard();
              var jumpNode = cardNode();
              if (jumpNode) {
                try { jumpNode.focus({ preventScroll: true }); } catch (e4) { jumpNode.focus(); }
              }
              e.preventDefault(); return;
            }
          }
        }
      }

      // Navegación espacial en la cuadrícula (también con el mando).
      var gdx = isKey(e, KEY.LEFT) ? -1 : isKey(e, KEY.RIGHT) ? 1 : 0;
      var gdy = isKey(e, KEY.UP) ? -1 : isKey(e, KEY.DOWN) ? 1 : 0;
      if (gdx || gdy) {
        if (spatialMove(el.shelves, gdx, gdy)) e.preventDefault();
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
    if (!(CONFIG.epg && CONFIG.epg.enabled)) {
      el.tabGuide.style.display = 'none';
    }
  }

  function bindQuickNav() {
    var btns = document.querySelectorAll('.quickNav .qn');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var src = btn.getAttribute('data-src') || 'iptvorg';
          var kind = btn.getAttribute('data-kind') || '';
          var url = window.location.pathname + '?src=' + encodeURIComponent(src);
          if (kind) url += '&kind=' + encodeURIComponent(kind);
          window.location.href = url;
        });
      })(btns[i]);
    }
  }

  /* ---------------------------------------------------------------- *
   * Selector de temporadas/episodios para series (estilo GoPelis).
   * ---------------------------------------------------------------- */
  var seriesOverlayState = { item: null, seasons: [], currentSeason: 1, episodes: [] };

  function detailGenresList(item) {
    var out = [];
    var raw = item.genres || item.description || '';
    if (Object.prototype.toString.call(raw) === '[object Array]') raw = raw.join(' · ');
    var parts = String(raw).split(' · ');
    for (var i = 0; i < parts.length; i++) {
      var g = parts[i];
      if (!g || /^fuente:/i.test(g)) continue;
      out.push(g);
    }
    return out;
  }

  function addTechRow(label, value) {
    var dl = $('detailTech');
    if (!dl || !value) return;
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function fillDetailTech(item, isSeries, extra) {
    var dl = $('detailTech');
    var box = $('detailTechBox');
    if (!dl || !box) return;
    dl.innerHTML = '';
    box.style.display = 'block';
    addTechRow('Tipo', isSeries ? 'Serie' : 'Película');
    addTechRow('Año', item.year || (extra && extra.year) || '');
    addTechRow('Calidad', 'HD');
    var genres = detailGenresList(item);
    if (genres.length) addTechRow('Géneros', genres.join(', '));
    if (isSeries && item.slug) addTechRow('Fuente', 'NasriPlay');
    if (extra && extra.originalTitle && extra.originalTitle !== item.title) {
      addTechRow('Título original', extra.originalTitle);
    }
    if (extra && extra.seasons) addTechRow('Temporadas', String(extra.seasons));
    if (extra && extra.episodes) addTechRow('Episodios', String(extra.episodes));
  }

  function fillDetailHero(item) {
    var isSeries = (item.kind === 'series' || item.kind === 'tv');
    var poster = item.poster || '';

    var img = $('detailPoster');
    if (img) {
      if (poster) { img.src = poster; img.style.display = 'block'; }
      else { img.removeAttribute('src'); img.style.display = 'none'; }
    }
    var bd = $('detailBackdrop');
    if (bd) {
      if (poster) { bd.src = poster; bd.style.display = 'block'; }
      else { bd.removeAttribute('src'); bd.style.display = 'none'; }
    }

    if ($('detailTitle')) $('detailTitle').textContent = item.title || (isSeries ? 'Serie' : 'Película');
    if ($('detailRating')) $('detailRating').textContent = item.rating ? ('★ ' + item.rating) : '';
    if ($('detailYear')) $('detailYear').textContent = item.year || '';
    if ($('detailCounts')) {
      $('detailCounts').textContent = isSeries ? 'Serie' : 'Película';
    }
    if ($('detailQuality')) $('detailQuality').textContent = 'HD';

    var genres = detailGenresList(item);
    var gEl = $('detailGenres');
    if (gEl) {
      gEl.innerHTML = '';
      for (var i = 0; i < genres.length; i++) {
        var s = document.createElement('span');
        s.className = 'genreChip';
        s.textContent = genres[i];
        gEl.appendChild(s);
      }
    }

    // `overview` es la sinopsis real. En el catálogo antiguo de NasriPlay
    // las series traían la sinopsis en `description`; en películas esa
    // descripción son los géneros, por eso solo se usa como respaldo.
    var desc = item.overview || '';
    if (!desc && isSeries && item.description && !item.genres &&
        !/^fuente:/i.test(item.description)) {
      desc = item.description;
    }
    if ($('detailOverview')) {
      $('detailOverview').textContent = desc || (isSeries ? 'Cargando sinopsis…' : 'Sin sinopsis disponible.');
    }
  }

  /** Lee un parámetro de la URL sin depender de URLSearchParams (TV viejos). */
  function queryParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)', 'i').exec(window.location.search || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1] || ''); } catch (e) { return m[1] || ''; }
  }

  function findCatalogItem(id, kind) {
    if (!id) return null;
    var want = '';
    if (kind === 'series' || kind === 'tv') want = 'series';
    else if (kind === 'movie' || kind === 'vod') want = 'movie';
    function sameKind(it) {
      if (!want) return true;
      var k = (it.kind === 'series' || it.kind === 'tv') ? 'series' : 'movie';
      return k === want;
    }
    var direct = state.byId && state.byId[id];
    if (direct && sameKind(direct)) return direct;
    var lists = [state.items, state.allItems, state.catalogAll];
    for (var l = 0; l < lists.length; l++) {
      var arr = lists[l] || [];
      for (var i = 0; i < arr.length; i++) {
        if ((String(arr[i].id) === String(id) ||
             String(arr[i].tmdbId || '') === String(id)) && sameKind(arr[i])) {
          return arr[i];
        }
      }
    }
    return null;
  }

  function fetchTmdbDeepLink(type, id) {
    var t = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
    return fetch('/api/tmdb?action=details&type=' + t + '&id=' + encodeURIComponent(id))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); });
  }

  function openDeepLinkDetail(data, type, fallbackId) {
    if (!data || data.error || !data.title) return false;
    var isSeries = (type === 'tv' || type === 'series');
    openDetail({
      id: String(data.id || fallbackId),
      tmdbId: String(data.id || fallbackId),
      title: data.title,
      kind: isSeries ? 'series' : 'movie',
      poster: data.poster || '',
      year: data.year || '',
      rating: data.rating || '',
      description: data.overview || '',
      overview: data.overview || '',
      genres: data.genres || ''
    });
    return true;
  }

  /**
   * Enlaces compartidos: ?play=<id>&src=embeds&kind=movie|series.
   * En TV en vivo reproduce el canal; en VOD abre la ficha, aunque el
   * título no esté en las primeras páginas del catálogo (usa TMDB).
   */
  function maybeOpenDeepLink() {
    if (state.deepLinkDone) return false;
    var id = queryParam('play');
    if (!id) return false;
    state.deepLinkDone = true;

    if (!isEmbedsMode()) {
      var live = findCatalogItem(id);
      if (live) { playItem(live); return true; }
      return false;
    }

    var kind = catalogKind();
    var hasKind = /[?&]kind=/.test(window.location.search || '');
    var isSeries = kind === 'series';
    var kindFilter = (hasKind && kind !== 'novelties') ? (isSeries ? 'series' : 'movie') : '';
    var found = findCatalogItem(id, kindFilter);
    if (found) { openDetail(found); return true; }

    var lookup = queryParam('tmdb') || id;
    var firstType = isSeries ? 'tv' : 'movie';
    fetchTmdbDeepLink(firstType, lookup)
      .then(function (res) {
        if (res && res.ok && res.d && !res.d.error && res.d.title) {
          openDeepLinkDetail(res.d, firstType, lookup);
          return;
        }
        // Enlaces antiguos sin &kind=: probar el otro tipo antes de fallar.
        if (!/[?&]kind=/.test(window.location.search || '')) {
          var altType = isSeries ? 'movie' : 'tv';
          return fetchTmdbDeepLink(altType, lookup).then(function (res2) {
            if (res2.ok && res2.d && !res2.d.error && res2.d.title) {
              openDeepLinkDetail(res2.d, altType, lookup);
            } else {
              toast('No se pudo abrir el título compartido.');
            }
          });
        }
        toast('No se pudo abrir el título compartido.');
      })
      .catch(function () { toast('No se pudo abrir el título compartido.'); });
    return true;
  }

  function openDetail(item) {
    if (!item) return;
    if (isNoveltiesMode()) touchNovelty(item.id);
    seriesOverlayState.item = item;
    seriesOverlayState.seasons = [];
    seriesOverlayState.episodes = [];
    seriesOverlayState.currentSeason = 1;
    seriesOverlayState.currentEpisode = 1;

    var isSeries = (item.kind === 'series' || item.kind === 'tv');

    fillDetailHero(item);
    fillDetailTech(item, isSeries);

    var episodesBox = $('detailEpisodesBox');
    var castBox = $('detailCastBox');
    if (episodesBox) episodesBox.style.display = isSeries ? 'block' : 'none';
    if (castBox) castBox.style.display = 'none';
    if ($('detailPlayText')) $('detailPlayText').textContent = isSeries ? 'Ver T1 E1' : 'Ver ahora';
    if (isSeries) updateDetailPlayButton();

    showScreen('detail');

    // Deja el foco en "Ver" para que el mando pueda reproducir de inmediato.
    var playBtn = $('btnDetailPlay');
    if (playBtn) {
      try { playBtn.focus({ preventScroll: true }); } catch (e) { playBtn.focus(); }
    }

    if (isSeries) {
      if (item.slug) loadFromNasriplay(item);
      else loadSeasonsFromTmdb(item);
    } else if (item.tmdbId || (item.id && /^\d+$/.test(item.id))) {
      loadMovieDetails(item);
    }
  }

  function loadMovieDetails(item) {
    var id = item.tmdbId || item.id;
    if (!id) return;
    fetch('/api/tmdb?action=details&type=movie&id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.overview && $('detailOverview')) {
          $('detailOverview').textContent = data.overview;
        }
        if (data.poster && !item.poster) {
          item.poster = data.poster;
          var pi = $('detailPoster');
          if (pi) { pi.src = data.poster; pi.style.display = 'block'; }
          var bi = $('detailBackdrop');
          if (bi) { bi.src = data.backdrop || data.poster; bi.style.display = 'block'; }
        }
        if (data.year && !item.year) {
          item.year = data.year;
          var yEl = $('detailYear');
          if (yEl) yEl.textContent = data.year;
        }
        if (data.overview) item.overview = data.overview;
        if (data.genres) {
          item.genres = data.genres;
          item.description = data.genres;
        }
        fillDetailHero(item);
        fillDetailTech(item, false, { year: data.year || item.year });
      })
      .catch(function () {});
  }

  function loadSeasonsFromTmdb(item) {
    var el2 = $('episodeList');
    var id = item.tmdbId || item.id;
    if (!id) {
      if (el2) el2.innerHTML = '<div class="catalogEmpty">Sin datos de TMDB para esta serie.</div>';
      return;
    }
    if (el2) el2.innerHTML = '<div class="catalogEmpty">Cargando capítulos…</div>';

    fetch('/api/tmdb?action=details&type=tv&id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.overview && $('detailOverview')) {
          $('detailOverview').textContent = data.overview;
        }
        if (data.poster && !item.poster) {
          item.poster = data.poster;
          var pi = $('detailPoster');
          if (pi) { pi.src = data.poster; pi.style.display = 'block'; }
          var bi = $('detailBackdrop');
          if (bi) { bi.src = data.backdrop || data.poster; bi.style.display = 'block'; }
        }
        if (data.overview) item.overview = data.overview;
        if (data.genres) {
          item.genres = data.genres;
          item.description = data.genres;
        }
        fillDetailHero(item);
        fillDetailTech(item, true, { seasons: (data.seasons || []).length });
        var seasons = data.seasons || [];
        var norm = [];
        for (var i = 0; i < seasons.length; i++) {
          if (seasons[i].number > 0) {
            norm.push({ number: seasons[i].number, name: seasons[i].name });
          }
        }
        if (!norm.length) {
          for (var j = 0; j < seasons.length; j++) {
            norm.push({ number: seasons[j].number, name: seasons[j].name });
          }
        }
        seriesOverlayState.seasons = norm;
        if (norm.length) seriesOverlayState.currentSeason = norm[0].number;
        var counts = $('detailCounts');
        if (counts) {
          counts.textContent = norm.length + (norm.length === 1 ? ' temporada' : ' temporadas');
        }
        renderSeasonTabs();
        if (norm.length) loadEpisodes(seriesOverlayState.currentSeason);
        else if (el2) el2.innerHTML = '<div class="catalogEmpty">Sin temporadas disponibles.</div>';
      })
      .catch(function () {
        if (el2) el2.innerHTML = '<div class="catalogEmpty">Error al cargar temporadas.</div>';
      });
  }

  // Temporadas/episodios desde NasriPlay (info/:slug).
  function loadFromNasriplay(item) {
    var el2 = $('episodeList');
    if (el2) el2.innerHTML = '<div class="catalogEmpty">Cargando capítulos…</div>';

    fetch('/api/nsrplay?action=info&type=series&slug=' + encodeURIComponent(item.slug))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var data = (d && d.data) || {};
        var seasons = data.seasons || [];
        var norm = [];
        var totalEps = 0;
        for (var i = 0; i < seasons.length; i++) {
          var s = seasons[i] || {};
          var eps = [];
          var list = s.episodes || [];
          for (var j = 0; j < list.length; j++) {
            var rawTitle = String(list[j].title || '');
            var name = 'Episodio ' + list[j].number;
            // NasriPlay antepone el nombre de la serie y "1x1" al título.
            // Si queda un título real lo usamos; si no, "Episodio N".
            if (rawTitle) {
              var cleaned = rawTitle
                .replace(/^.*?\d+\s*x\s*\d+\s*[-–:·]?\s*/i, '')
                .trim();
              if (cleaned) name = cleaned;
            }
            eps.push({ number: list[j].number, name: name, still: '' });
          }
          totalEps += eps.length;
          norm.push({ number: s.number, name: s.name || ('Temporada ' + s.number), episodes: eps });
        }
        if (!norm.length) throw new Error('sin temporadas');
        seriesOverlayState.seasons = norm;
        seriesOverlayState.currentSeason = norm[0].number;

        // Completa la ficha con los metadatos de la API.
        if (data.synopsis) {
          item.overview = data.synopsis;
          if ($('detailOverview')) $('detailOverview').textContent = data.synopsis;
        }
        if (data.poster && !item.poster) {
          item.poster = data.poster;
          var pi = $('detailPoster');
          if (pi) { pi.src = data.poster; pi.style.display = 'block'; }
          var bi = $('detailBackdrop');
          if (bi) { bi.src = data.poster; bi.style.display = 'block'; }
        }
        var counts = $('detailCounts');
        if (counts) {
          counts.textContent = norm.length + (norm.length === 1 ? ' temporada' : ' temporadas') +
            ' · ' + totalEps + (totalEps === 1 ? ' episodio' : ' episodios');
        }
        if (data.year) {
          item.year = String(data.year);
          var yearEl = $('detailYear');
          if (yearEl) yearEl.textContent = item.year;
        }
        fillDetailTech(item, true, {
          originalTitle: data.originalTitle || '',
          seasons: norm.length,
          episodes: totalEps,
          year: data.year || ''
        });

        renderSeasonTabs();
        selectSeason(seriesOverlayState.currentSeason);
        renderPlayerPanel();
      })
      .catch(function () {
        if (el2) el2.innerHTML = '<div class="catalogEmpty">No se pudieron cargar los capítulos.</div>';
      });
  }

  /** Refresca el boton grande de la ficha con la temporada/episodio elegidos. */
  function updateDetailPlayButton() {
    var txt = $('detailPlayText');
    if (!txt) return;
    var it = seriesOverlayState.item;
    if (!it || (it.kind !== 'series' && it.kind !== 'tv')) {
      txt.textContent = 'Ver ahora';
      return;
    }
    var sn = parseInt(seriesOverlayState.currentSeason, 10) || 1;
    var en = parseInt(seriesOverlayState.currentEpisode, 10) || 1;
    txt.textContent = 'Ver T' + sn + ' E' + en;
  }

  function selectSeason(seasonNum) {
    var seasons = seriesOverlayState.seasons || [];
    for (var i = 0; i < seasons.length; i++) {
      if (seasons[i].number === seasonNum) {
        seriesOverlayState.episodes = seasons[i].episodes || [];
        break;
      }
    }
    renderEpisodes(seriesOverlayState.episodes, seasonNum);
  }

  function renderSeasonTabs() {
    var tabs = document.getElementById('seasonTabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    for (var i = 0; i < seriesOverlayState.seasons.length; i++) {
      var s = seriesOverlayState.seasons[i];
      var btn = document.createElement('button');
      btn.className = 'seasonTab' + (s.number === seriesOverlayState.currentSeason ? ' active' : '');
      btn.textContent = s.name || ('Temporada ' + s.number);
      btn.setAttribute('data-season', s.number);
      btn.setAttribute('tabindex', '0');
      btn.addEventListener('click', function () {
        var sn = parseInt(this.getAttribute('data-season'), 10);
        seriesOverlayState.currentSeason = sn;
        seriesOverlayState.currentEpisode = 1;
        renderSeasonTabs();
        loadEpisodes(sn);
        updateDetailPlayButton();
      });
      tabs.appendChild(btn);
    }
  }

  function loadEpisodes(seasonNum) {
    // Si los episodios de esta temporada ya están en memoria, usarlos.
    var seasonObj = null;
    for (var si = 0; si < seriesOverlayState.seasons.length; si++) {
      if (seriesOverlayState.seasons[si].number === seasonNum) { seasonObj = seriesOverlayState.seasons[si]; break; }
    }
    if (seasonObj && seasonObj.episodes && seasonObj.episodes.length) {
      selectSeason(seasonNum);
      return;
    }

    var el2 = document.getElementById('episodeList');
    if (el2) el2.innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">Cargando episodios...</div>';

    var id = (seriesOverlayState.item && (seriesOverlayState.item.tmdbId || seriesOverlayState.item.id)) || '';
    if (!id) {
      if (el2) el2.innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">Sin datos de TMDB.</div>';
      return;
    }

    fetch('/api/tmdb?action=season&id=' + encodeURIComponent(id) + '&season=' + encodeURIComponent(seasonNum))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var raw = (data && data.episodes) || [];
        var eps = [];
        for (var i = 0; i < raw.length; i++) {
          eps.push({
            number: raw[i].number,
            name: raw[i].name || ('Episodio ' + raw[i].number),
            still: raw[i].still || ''
          });
        }
        seriesOverlayState.episodes = eps;
        for (var s = 0; s < seriesOverlayState.seasons.length; s++) {
          if (seriesOverlayState.seasons[s].number === seasonNum) {
            seriesOverlayState.seasons[s].episodes = eps;
            break;
          }
        }
        renderEpisodes(eps, seasonNum);
        renderPlayerPanel();
      }).catch(function () {
        if (el2) el2.innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">Error al cargar episodios.</div>';
      });
  }

  function markSelectedEpisode() {
    var cards = document.querySelectorAll('#episodeList .episodeCard');
    for (var i = 0; i < cards.length; i++) {
      var n = parseInt(cards[i].getAttribute('data-episode'), 10);
      var on = n === seriesOverlayState.currentEpisode;
      cards[i].className = 'episodeCard' + (on ? ' active' : '');
    }
    updateDetailPlayButton();
  }

  function renderEpisodes(episodes, seasonNum) {
    var el2 = document.getElementById('episodeList');
    if (!el2) return;
    el2.innerHTML = '';
    if (!episodes.length) {
      el2.innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">Sin episodios disponibles.</div>';
      return;
    }
    for (var i = 0; i < episodes.length; i++) {
      (function (ep) {
        var card = document.createElement('div');
        card.className = 'episodeCard';
        card.setAttribute('tabindex', '0');
        card.setAttribute('data-episode', String(ep.number));
        var still = ep.still || '';
        var imgHtml = still ? '<img class="epStill" src="' + Utils.esc(still) + '" alt="" loading="lazy">' : '';
        card.innerHTML = imgHtml +
          '<span class="epNum">E' + Epg.pad2(ep.number) + '</span>' +
          '<span class="epName">' + Utils.esc(ep.name || ('Episodio ' + ep.number)) + '</span>';
        if (seasonNum === seriesOverlayState.currentSeason && ep.number === seriesOverlayState.currentEpisode) {
          card.className += ' active';
        }
        card.addEventListener('focus', function () {
          seriesOverlayState.currentSeason = seasonNum;
          seriesOverlayState.currentEpisode = ep.number;
          markSelectedEpisode();
        });
        card.addEventListener('click', function () {
          seriesOverlayState.currentSeason = seasonNum;
          seriesOverlayState.currentEpisode = ep.number;
          markSelectedEpisode();
          playSeriesEpisode(seriesOverlayState.item, seasonNum, ep.number);
        });
        el2.appendChild(card);
      })(episodes[i]);
    }
  }

  function playSeriesEpisode(item, season, episode) {
    state.seriesItem = item;
    state.seriesSeason = season;
    state.seriesEpisode = episode;
    state.panelSeason = season;
    seriesOverlayState.currentSeason = season;
    seriesOverlayState.currentEpisode = episode;
    updateDetailPlayButton();

    var epItem = {
      id: item.id,
      slug: item.slug,
      tmdbId: item.tmdbId,
      title: item.title + ' - T' + season + ' E' + episode,
      kind: 'series',
      season: season,
      episode: episode,
      poster: item.poster,
      year: item.year,
      description: item.description
    };

    el.title.textContent = epItem.title || '';
    el.quality.innerHTML = '';
    state.playing = epItem;
    state.stopped = false;
    addRecent(epItem);
    updatePlayerFavBtn();
    updateMuteUI();
    var aviso = $('playerStopped');
    if (aviso) aviso.style.display = 'none';
    showScreen('player');
    renderPlayerPanel();

    state.adapter.resolve(epItem).then(function (streams) {
      if (!streams || !streams.length) {
        toast('Sin URL disponible para "' + epItem.title + '"');
        return;
      }
      renderServerPanel(streams);
      return player.play(epItem, streams, function (i) { return state.adapter.resolve(i); });
    }).catch(function (e) {
      toast('Error: ' + e.message);
    });
  }

  /* ---------------------------------------------------------------- *
   * Selector de servidor (cambiar de fuente sin salir del capitulo)
   * ---------------------------------------------------------------- */
  function isServerPanelOpen() {
    var p = $('serverPanel');
    return !!(p && p.style.display !== 'none');
  }

  function closeServerPanel() {
    var p = $('serverPanel');
    if (p) p.style.display = 'none';
    var b = $('btnServers');
    if (b && b.style.display !== 'none') {
      try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
    }
  }

  /**
   * Ajusta la UI según el tipo de stream actual. En un iframe (vidsrc,
   * vidlink, vimeus) no se puede controlar el audio ni el aspect ratio desde
   * fuera, y conviene ofrecer "Abrir en pestaña" por si la publicidad tapa
   * el video o su botón de cerrar.
   */
  function updatePlayerMode() {
    var embed = false;
    try {
      var streams = player ? player.getStreams() : [];
      var cur = player ? player.getCurrent() : 0;
      embed = !!(streams[cur] && Player.isEmbedUrl(streams[cur].url));
    } catch (e) { embed = false; }

    if (el.playerUI) {
      if (embed) el.playerUI.classList.add('embed-current');
      else el.playerUI.classList.remove('embed-current');
    }
    if (el.btnOpenEmbed) {
      el.btnOpenEmbed.style.display = (isEmbedsMode() && embed) ? 'inline-flex' : 'none';
    }
  }

  function openCurrentEmbed() {
    if (!player) return;
    var streams = player.getStreams();
    var cur = player.getCurrent();
    var s = streams[cur];
    if (!s || !Player.isEmbedUrl(s.url)) {
      toast('Este servidor no se puede abrir en otra pestaña.');
      return;
    }
    var win = window.open(s.url, '_blank');
    if (win) {
      try { win.opener = null; } catch (e) {}
    } else {
      toast('El navegador bloqueó la pestaña. Permite las ventanas emergentes.');
    }
  }

  function updateServerActive() {
    var list = $('serverList');
    if (!list || !player) return;
    var cur = player.getCurrent();
    var rows = list.querySelectorAll('.serverBtn');
    for (var i = 0; i < rows.length; i++) {
      var on = parseInt(rows[i].getAttribute('data-server'), 10) === cur;
      rows[i].className = 'serverBtn' + (on ? ' active' : '');
      var now = rows[i].querySelector('.sNow');
      if (now) now.style.display = on ? '' : 'none';
    }
  }

  function renderServerPanel(streams) {
    var list = $('serverList');
    var btn = $('btnServers');
    if (!list) return;
    list.innerHTML = '';

    if (!streams || !streams.length) {
      if (btn) btn.style.display = 'none';
      var p0 = $('serverPanel');
      if (p0) p0.style.display = 'none';
      return;
    }

    for (var i = 0; i < streams.length; i++) {
      (function (idx) {
        var s = streams[idx] || {};
        var isDirect = !Player.isEmbedUrl(s.url);
        var label = s.label || ('Servidor ' + (idx + 1));
        var isPublicEmbed = /vidsrc|vidlink|vimeus/i.test(label);
        var tag = /latino|\blat\b/i.test(label) ? 'Latino'
                : (isPublicEmbed ? 'Con anuncios' : (isDirect ? 'Directo' : 'Embed'));
        var row = document.createElement('button');
        row.className = 'serverBtn';
        row.setAttribute('tabindex', '0');
        row.setAttribute('data-server', String(idx));
        row.innerHTML = '<span class="sTag">' + Utils.esc(tag) + '</span>' +
                        '<span class="sName">' + Utils.esc(label) + '</span>' +
                        '<span class="sNow" style="display:none">Actual</span>';
        row.addEventListener('click', function () {
          if (!player) return;
          player.setStream(idx);
          closeServerPanel();
        });
        list.appendChild(row);
      })(i);
    }

    if (btn && isEmbedsMode()) btn.style.display = 'inline-flex';
    updateServerActive();
  }

  function openServerPanel() {
    var p = $('serverPanel');
    if (!p) return;
    if (!player || !player.getStreams().length) { toast('Sin servidores disponibles'); return; }
    p.style.display = 'flex';
    updateServerActive();
    var first = p.querySelector('.serverBtn') || $('serverClose');
    if (first) {
      try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
    }
  }

  /* ---------------------------------------------------------------- *
   * Selector de capítulos debajo del reproductor (GoPelis).
   * ---------------------------------------------------------------- */
  function renderPlayerPanel() {
    var item = state.seriesItem;
    var panel = $('playerEpisodePanel');
    if (!panel || !item) { if (panel) panel.style.display = 'none'; return; }

    var seasons = seriesOverlayState.seasons || [];
    if (!seasons.length) { panel.style.display = 'none'; return; }

    if ($('peSeriesTitle')) $('peSeriesTitle').textContent = item.title || 'Serie';
    if ($('peNowLabel')) {
      $('peNowLabel').textContent = 'Temporada ' + state.seriesSeason + ' · Episodio ' + state.seriesEpisode;
    }

    var currentSeason = state.panelSeason || state.seriesSeason || seasons[0].number;
    state.panelSeason = currentSeason;

    var tabs = $('playerSeasonTabs');
    if (tabs) {
      tabs.innerHTML = '';
      for (var i = 0; i < seasons.length; i++) {
        (function (s) {
          var b = document.createElement('button');
          b.className = 'seasonTab' + (s.number === currentSeason ? ' active' : '');
          b.textContent = s.name || ('Temporada ' + s.number);
          b.setAttribute('tabindex', '0');
          b.addEventListener('click', function () {
            state.panelSeason = s.number;
            renderPlayerPanel();
          });
          tabs.appendChild(b);
        })(seasons[i]);
      }
    }

    var seasonObj = null;
    for (var k = 0; k < seasons.length; k++) {
      if (seasons[k].number === currentSeason) { seasonObj = seasons[k]; break; }
    }
    var eps = (seasonObj && seasonObj.episodes) || [];

    if ($('peSeasonTitle')) {
      $('peSeasonTitle').textContent = 'Episodios de la temporada ' + currentSeason;
    }

    var list = $('playerEpisodeList');
    if (!list) return;
    list.innerHTML = '';
    if (!eps.length) {
      list.innerHTML = '<div class="catalogEmpty">Sin episodios disponibles.</div>';
      return;
    }
    for (var e = 0; e < eps.length; e++) {
      (function (ep) {
        var row = document.createElement('div');
        row.className = 'peItem' +
          (currentSeason === state.seriesSeason && ep.number === state.seriesEpisode ? ' active' : '');
        row.setAttribute('tabindex', '0');
        row.innerHTML = '<span class="peNum">' + Epg.pad2(ep.number) + '</span>' +
          '<span class="peName">' + Utils.esc(ep.name) + '</span>' +
          '<span class="pePlay">&#9654;</span>';
        row.addEventListener('click', function () {
          playSeriesEpisode(item, currentSeason, ep.number);
        });
        row.addEventListener('focus', function () {
          var container = el.playerUI;
          if (!container) return;
          var stageH = (el.playerStage && el.playerStage.offsetHeight) || 0;
          var cRect = container.getBoundingClientRect();
          var rRect = row.getBoundingClientRect();
          var topLimit = cRect.top + stageH + 8;
          var bottomLimit = cRect.bottom - 8;
          if (rRect.bottom > bottomLimit) {
            container.scrollTop += (rRect.bottom - bottomLimit);
          } else if (rRect.top < topLimit) {
            container.scrollTop -= (topLimit - rRect.top);
          }
        });
        list.appendChild(row);
      })(eps[e]);
    }
  }

  /** Anterior/siguiente capítulo (cruza de temporada si hace falta). */
  function stepEpisode(dir) {
    var item = state.seriesItem;
    var seasons = seriesOverlayState.seasons || [];
    if (!item || !seasons.length) return;

    var si = -1, ei = 0;
    for (var i = 0; i < seasons.length; i++) {
      if (seasons[i].number === state.seriesSeason) {
        si = i;
        var eps = seasons[i].episodes || [];
        for (var j = 0; j < eps.length; j++) {
          if (eps[j].number === state.seriesEpisode) { ei = j; break; }
        }
        break;
      }
    }
    if (si === -1) return;

    var current = seasons[si].episodes || [];
    var ni = ei + dir;
    if (ni >= 0 && ni < current.length) {
      playSeriesEpisode(item, seasons[si].number, current[ni].number);
      return;
    }
    var ns = si + dir;
    if (ns >= 0 && ns < seasons.length) {
      var list = seasons[ns].episodes || [];
      if (list.length) {
        playSeriesEpisode(item, seasons[ns].number, list[dir > 0 ? 0 : list.length - 1].number);
      }
    }
  }

  // Botones de la ficha y del reproductor VOD.
  document.addEventListener('DOMContentLoaded', function () {
    var back = $('btnDetailBack');
    if (back) back.addEventListener('click', function () { showScreen('catalog'); });

    var play = $('btnDetailPlay');
    if (play) play.addEventListener('click', function () {
      var it = seriesOverlayState.item;
      if (!it) return;
      if (it.kind === 'series' || it.kind === 'tv') {
        var seasons = seriesOverlayState.seasons || [];
        if (!seasons.length) {
          // Sin TMDB key o sin slug: reproducir T1 E1 directamente.
          // Los embeds públicos y NasriPlay ya soportan temporada/episodio
          // en la URL (/tv/{id}/1/1), no hace falta cargar la lista.
          playSeriesEpisode(it, 1, 1);
          return;
        }
        var sn = parseInt(seriesOverlayState.currentSeason, 10) || seasons[0].number;
        var en = parseInt(seriesOverlayState.currentEpisode, 10) || 1;
        var seasonObj = null;
        for (var si = 0; si < seasons.length; si++) {
          if (seasons[si].number === sn) { seasonObj = seasons[si]; break; }
        }
        var eps = (seasonObj && seasonObj.episodes) || [];
        if (!eps.length) {
          // La temporada aun no tiene episodios cargados: el embed acepta
          // la temporada/episodio igualmente.
          playSeriesEpisode(it, sn, en);
          return;
        }
        var exists = false;
        for (var ei = 0; ei < eps.length; ei++) {
          if (eps[ei].number === en) { exists = true; break; }
        }
        playSeriesEpisode(it, sn, exists ? en : eps[0].number);
      } else {
        startPlayback(it);
      }
    });

    var prev = $('btnPrevEpisode');
    if (prev) prev.addEventListener('click', function () { stepEpisode(-1); });
    var next = $('btnNextEpisode');
    if (next) next.addEventListener('click', function () { stepEpisode(1); });

    function scrollEpisodePanel(dir) {
      var c = el.playerUI;
      if (!c) return;
      var stageH = (el.playerStage && el.playerStage.offsetHeight) || 0;
      var amount = Math.max(120, Math.round((c.clientHeight - stageH) * 0.75));
      c.scrollTop += (dir > 0 ? amount : -amount);
    }
    var peUp = $('peScrollUp');
    if (peUp) peUp.addEventListener('click', function () { scrollEpisodePanel(-1); });
    var peDown = $('peScrollDown');
    if (peDown) peDown.addEventListener('click', function () { scrollEpisodePanel(1); });

    var btnEp = $('btnEpisodes');
    if (btnEp) btnEp.addEventListener('click', function () {
      var panel = $('playerEpisodePanel');
      if (!panel) return;
      try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (e) { panel.scrollIntoView(); }
    });

    var btnSrv = $('btnServers');
    if (btnSrv) btnSrv.addEventListener('click', function () {
      if (isServerPanelOpen()) closeServerPanel(); else openServerPanel();
    });
    var srvClose = $('serverClose');
    if (srvClose) srvClose.addEventListener('click', closeServerPanel);
    var srvPanel = $('serverPanel');
    if (srvPanel) srvPanel.addEventListener('click', function (e) {
      if (e.target === srvPanel) closeServerPanel();
    });
  });

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