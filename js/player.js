/**
 * player.js — Reproductor con failover y renovacion de URLs firmadas.
 *
 * Decisiones de diseño que vienen del analisis de la app nativa:
 *
 *  - FALLOVER: cada recurso llega como lista ordenada [principal, ...respaldo].
 *    El nativo expone idx_url / idx_url2 y media_url / media_url2, siempre en
 *    par. Si el primario muere se pasa al siguiente sin intervencion del usuario.
 *
 *  - URLs FIRMADAS: el nativo trae urlInvalidTime por recurso. Las URLs caducan.
 *    Antes de que venza pedimos una nueva al adaptador y seguimos en el mismo
 *    stream. Este es el bug mas comun en TV y el que mas时长 se pierde.
 *
 *  - NIVELES: el nativo devuelve una matriz calidad/bitrate/formato. Se traduce
 *    a los levels que hls.js ya conoce.
 *
 * Se apoya en ES5 + Promise para correr en el navegador de televisores viejos.
 */

/**
 * Fuentes de hls.js, en orden de preferencia.
 *
 * Se prueba primero el archivo local (vendor/hls.min.js): en televisores con
 * conexion lenta o restringida, depender de un CDN en tiempo de ejecucion es
 * una causa habitual de "no reproduce nada". El CDN queda como ultimo recurso.
 */
var HLS_SOURCES = [
  'vendor/hls.min.js',
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js'
];

function Player(videoEl, statusEl) {
  this.video = videoEl;
  this.iframe = document.getElementById('embedFrame');
  this.statusEl = statusEl;

  this.streams = [];        // [{ url, quality, headers, expiresAt }]
  this.current = -1;        // indice del stream en uso
  this.resolver = null;     // function(item) -> Promise<Stream[]>
  this.item = null;

  this.hls = null;
  this.hlsLib = null;       // instancia global de hls.js, creada una sola vez
  this.embedMode = false;    // true cuando el stream es un iframe (embed)
  this.attempt = 0;         // reintentos del stream actual
  this.refreshTimer = null;
  this.levels = [];
  this.wantedLevel = -1;    // -1 = automatico
  this.onError = null;      // callback para la UI
  this.onStreamChange = null; // callback al cambiar de servidor
  this._switching = false;  // evita failover mientras se cambia de servidor
  this._errorBound = false; // listener de error montado una sola vez
  this._embedTimer = null;  // vence si el iframe del embed nunca carga
  this._detaching = false;  // evita errores espurios al limpiar el <video>
}

/* ------------------------------------------------------------------ *
 * Carga de hls.js (una vez, con reintento)
 * ------------------------------------------------------------------ */
Player.loadHls = function () {
  if (window.Hls) return Promise.resolve(window.Hls);

  function loadOne(i) {
    if (i >= HLS_SOURCES.length) {
      return Promise.reject(new Error('No se pudo cargar hls.js desde ninguna fuente'));
    }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = HLS_SOURCES[i];
      s.onload = function () {
        if (window.Hls) resolve(window.Hls);
        else loadOne(i + 1).then(resolve, reject);
      };
      s.onerror = function () { loadOne(i + 1).then(resolve, reject); };
      document.head.appendChild(s);
    });
  }
  return loadOne(0);
};

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */

/**
 * @param {Object} item    el elemento que se quiere reproducir
 * @param {Array}  streams lista ordenada de candidatos
 * @param {Function} resolver function(item) -> Promise<Stream[]>
 */
// Detecta si una URL es un embed (iframe) y no un stream HLS/MP4 directo.
Player.isEmbedUrl = function (url) {
  if (!url || typeof url !== 'string') return false;
  var u = url.toLowerCase().split('?')[0];
  // El proxy HLS de NasriPlay devuelve un manifest aunque la URL no
  // termine en .m3u8: se reproduce con hls.js, no en un iframe.
  if (u.indexOf('/embed/stream-proxy') > -1) return false;
  return !(u.match(/\.(m3u8|m3u|mp4|ts|mpd|mkv|webm|avi|mov)$/) ||
           u.indexOf('/api/stream?') > -1);
};

Player.prototype.play = function (item, streams, resolver) {
  this.stop(true);
  this.item = item;
  this.streams = streams || [];
  this.resolver = resolver || null;
  this.current = 0;
  this.attempt = 0;
  this.wantedLevel = -1;

  if (!this.streams.length) {
    this._fail('No hay ninguna URL disponible para este contenido.');
    return Promise.resolve();
  }
  // Modo embed: si la primera URL es un iframe, activamos el modo embed.
  this.embedMode = Player.isEmbedUrl(this.streams[0].url);
  this._attach();
  return this._openCurrent();
};

/** Lista de servidores disponibles para el contenido actual. */
Player.prototype.getStreams = function () { return (this.streams || []).slice(); };

/** Indice del servidor que se esta usando. */
Player.prototype.getCurrent = function () { return this.current; };

/**
 * Cambia al servidor indicado sin salir del capitulo/pelicula.
 * Vuelve a montar el reproductor (iframe u HLS) con la nueva URL.
 */
Player.prototype.setStream = function (index) {
  index = parseInt(index, 10);
  if (!this.streams || !(index >= 0 && index < this.streams.length)) return false;
  this.current = index;
  this.attempt = 0;
  this._switching = true;
  this._detach();
  this.embedMode = Player.isEmbedUrl(this.streams[index].url);
  this._attach();
  var p = this._openCurrent();
  this._switching = false;
  return true;
};

Player.prototype._attach = function () {
  var self = this;
  if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
  this.video.removeAttribute('src');
  if (this.iframe) { this.iframe.removeAttribute('src'); this.iframe.style.display = 'none'; }

  if (this.embedMode) {
    // Modo iframe: ocultamos el video y mostramos el iframe.
    this.video.style.display = 'none';
    if (this.iframe) this.iframe.style.display = 'block';
  } else {
    this.video.style.display = '';
    if (this.iframe) this.iframe.style.display = 'none';
  }

  if (!this._errorBound) {
    this.video.addEventListener('error', function () {
      // El elemento <video> fallo: normalmente el stream esta caido.
      // Al cambiar de servidor se limpia el src y algunos TV disparan error:
      // ese caso no debe saltar al siguiente servidor.
      if (self._switching || self._detaching) return;
      self._onStreamError();
    });
    this._errorBound = true;
  }
};

Player.prototype._openCurrent = function () {
  var self = this;
  var stream = this.streams[this.current];

  if (!stream) { this._fail('Se agotaron todos los servidores.'); return Promise.resolve(); }

  this._setStatus('Conectando (' + (this.current + 1) + '/' + this.streams.length + ')…');
  if (this.onStreamChange) this.onStreamChange(this.current, this.streams);
  // Modo embed (iframe): no hay HLS que cargar, solo se asigna el src.
  // Si el iframe no dispara load en 20 s (DNS, X-Frame-Options, servidor
  // caído), se pasa al siguiente proveedor. Los anuncios internos del
  // embed no se pueden controlar desde aquí.
  if (this.embedMode) {
    if (this._embedTimer) { clearTimeout(this._embedTimer); this._embedTimer = null; }
    if (this.iframe) {
      // Bloqueo experimental de ventanas emergentes del embed.
      var blockPopups = false;
      try { blockPopups = localStorage.getItem('tv_block_popups') === '1'; } catch (e) {}
      if (blockPopups) {
        this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      } else {
        this.iframe.removeAttribute('sandbox');
      }
      var embedLoaded = false;
      this.iframe.onload = function () {
        embedLoaded = true;
        if (self._embedTimer) { clearTimeout(self._embedTimer); self._embedTimer = null; }
        self._setStatus('Reproduciendo · ' + (stream.label || ('servidor ' + (self.current + 1))));
      };
      this.iframe.onerror = function () {
        if (self._embedTimer) { clearTimeout(self._embedTimer); self._embedTimer = null; }
        self._onStreamError(new Error('el servidor embed no cargó'));
      };
      this.iframe.src = stream.url;
      this.iframe.style.display = 'block';
      this.video.style.display = 'none';
      this._embedTimer = setTimeout(function () {
        self._embedTimer = null;
        if (!embedLoaded) self._onStreamError(new Error('el servidor embed no respondió'));
      }, 20000);
    }
    this._setStatus('Conectando embed · ' + (stream.label || ('servidor ' + (this.current + 1))));
    return Promise.resolve();
  }

  this._armRefresh(stream);

  var headers = stream.headers || {};

  // Se prefiere hls.js y no el HLS nativo aunque el navegador anuncie
  // soporte: canPlayType devuelve "maybe" en navegadores que despues fallan,
  // y el camino nativo deja sin selector de calidad ni control de fragmentos.
  // El nativo queda como respaldo cuando no hay MSE.
  return Player.loadHls().then(function (Hls) {
    if (self.hlsLib) { try { self.hlsLib.destroy(); } catch (e) {} }

    if (!Hls.isSupported()) {
      // Sin MSE: algunos TV solo reproducen HLS nativo.
      if (self.video.canPlayType('application/vnd.apple.mpegurl')) {
        self._setStatus('HLS nativo (sin calidad manual)');
        if (Object.keys(headers).length) self._xhrHook(headers);
        self.video.src = stream.url;
        var np = self.video.play();
        if (np && np.catch) np.catch(function (e) { self._onStreamError(e); });
        return;
      }
      self._fail('Este TV no soporta HLS: sin MSE ni HLS nativo.');
      return;
    }

    var hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      // Reintento rapido: si el stream caido es el primario, saltamos al
      // respaldo antes de agotar los reintentos.
      manifestLoadingTimeOut: 12000,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 3,
      fragLoadingMaxRetry: 4,
      fragLoadingTimeOut: 20000,
      // Hook para meter los headers que exija el CDN.
      xhrSetup: function (xhr) {
        for (var k in headers) {
          if (Object.prototype.hasOwnProperty.call(headers, k)) {
            xhr.setRequestHeader(k, headers[k]);
          }
        }
      }
    });

    self.hls = hls;
    self.hlsLib = hls;
    self._collectLevels(hls);

    hls.on(Hls.Events.ERROR, function (_evt, data) {
      if (!data || !data.fatal) return;
      self._onStreamError(new Error('HLS fatal: ' + data.type + '/' + data.details));
    });

    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      self._setStatus('Reproduciendo' + (stream.label ? ' · ' + stream.label : ''));
      self._applyLevel();
      var pp = self.video.play();
      if (pp && pp.catch) pp.catch(function () {
        // Autoplay bloqueado: el usuario debe pulsar. Es normal en TV.
        self._setStatus('Pulsa Reproducir');
      });
    });

    hls.loadSource(stream.url);
    hls.attachMedia(self.video);
  }).catch(function (err) {
    self._onStreamError(err);
  });
};

/** Marca los niveles disponibles de hls.js. */
Player.prototype._collectLevels = function (hls) {
  var self = this;
  this.levels = [];
  hls.on(window.Hls.Events.LEVEL_SWITCHED, function () { /* no-op */ });
  setTimeout(function () {
    if (!hls.levels || !hls.levels.length) return;
    var out = [];
    for (var i = 0; i < hls.levels.length; i++) {
      var L = hls.levels[i];
      out.push({ index: i, height: L.height, bitrate: L.bitrate });
    }
    self.levels = out;
    if (self.onLevels) self.onLevels(out);
  }, 600);
};

/* ------------------------------------------------------------------ *
 * Manejo de error y failover
 * ------------------------------------------------------------------ */
Player.prototype._onStreamError = function (err) {
  var self = this;
  this.attempt++;

  // 1) Reintento del mismo servidor mientras queden intentos. En un embed
  // no tiene sentido esperar otro ciclo de 20 s: se prueba el respaldo.
  if (!this.embedMode && this.attempt < CONFIG.retry.attempts) {
    this._setStatus('Reintentando (' + this.attempt + '/' + (CONFIG.retry.attempts - 1) + ')…');
    this.video.removeAttribute('src');
    if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
    setTimeout(function () { self._openCurrent(); }, CONFIG.retry.backoffMs * this.attempt);
    return;
  }

  // 2) Salto al siguiente servidor de la lista.
  this.attempt = 0;
  this.current++;
  if (this.current < this.streams.length) {
    this._setStatus('Servidor caído, probando respaldo…');
    this._detach();
    // _detach() apaga embedMode; hay que recalcularlo para el siguiente
    // servidor. Sin esto, un respaldo HLS se cargaba dentro del iframe.
    var next = this.streams[this.current];
    this.embedMode = Player.isEmbedUrl(next && next.url);
    setTimeout(function () { self._openCurrent(); }, 250);
    return;
  }

  // 3) Agotados: avisamos. La UI decide si reintenta mas tarde.
  this._fail('No se pudo reproducir en ningun servidor. ' + (err ? '(' + err.message + ')' : ''));
};

Player.prototype._fail = function (message) {
  // Se detiene en silencio (true) a proposito: stop(false) borra el texto de
  // estado y el mensaje de error desapareceria al instante.
  this._setStatus(message, true);
  this.stop(true);
  if (this.onError) this.onError(message);
};

/* ------------------------------------------------------------------ *
 * Renovacion de URLs firmadas
 * ------------------------------------------------------------------ */
Player.prototype._armRefresh = function (stream) {
  var self = this;
  if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }

  var expiresAt = parseInt(stream.expiresAt || 0, 10);
  // Sin caducidad conocida o sin resolver: no hay nada que renovar.
  if (!expiresAt || !this.resolver) return;

  var delay = expiresAt - Utils.now() - (CONFIG.urlRefreshMarginSec * 1000);
  if (delay < 5000) delay = 5000; // si ya esta a punto de caducar, refresca ya

  this.refreshTimer = setTimeout(function () {
    self._setStatus('Renovando enlace…');
    self.resolver(self.item).then(function (fresh) {
      if (!fresh || !fresh.length) { self._setStatus('No se pudo renovar el enlace'); return; }
      self.streams = fresh;
      var wasQuality = self.wantedLevel;
      self._openCurrent().then(function () { self.wantedLevel = wasQuality; });
    }).catch(function () {
      self._setStatus('Falló la renovación del enlace');
    });
  }, delay);
};

/* ------------------------------------------------------------------ *
 * Calidad
 * ------------------------------------------------------------------ */
Player.prototype.setLevel = function (index) {
  this.wantedLevel = (typeof index === 'number' ? index : -1);
  this._applyLevel();
  return this.wantedLevel;
};

Player.prototype._applyLevel = function () {
  if (!this.hls || !this.levels.length) return;
  try { this.hls.currentLevel = this.wantedLevel; }
  catch (e) { this.hls.currentLevel = -1; }
};

/* ------------------------------------------------------------------ *
 * Ciclo de vida
 * ------------------------------------------------------------------ */
Player.prototype._detach = function () {
  var self = this;
  this._detaching = true;
  if (this.hls) { try { this.hls.destroy(); } catch (e) {} }
  if (this.hlsLib) { try { this.hlsLib.destroy(); } catch (e) {} }
  this.hls = null;
  this.hlsLib = null;
  this.video.removeAttribute('src');
  try { this.video.load(); } catch (e) {}
  if (this._embedTimer) { clearTimeout(this._embedTimer); this._embedTimer = null; }
  if (this.iframe) {
    this.iframe.onload = null;
    this.iframe.onerror = null;
    this.iframe.removeAttribute('src');
    this.iframe.style.display = 'none';
  }
  this.video.style.display = '';
  this.embedMode = false;
  // El error de un <video> al que se le quita el src suele llegar en el
  // siguiente tick. Se ignora ese tick y luego se vuelve a escuchar.
  setTimeout(function () { self._detaching = false; }, 0);
};

Player.prototype.stop = function (silent) {
  if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
  this._detach();
  if (!silent) this._setStatus('');
};

Player.prototype._setStatus = function (text, isError) {
  if (!this.statusEl) return;
  this.statusEl.textContent = text || '';
  this.statusEl.className = isError ? 'status error' : 'status';
};

/**
 * Permite poner cabeceras en la peticion nativa via XHRsync cuando el
 * navegador no expone otra via. Solo se usa en el camino sin hls.js.
 */
Player.prototype._xhrHook = function (headers) {
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var pending = headers;
  XMLHttpRequest.prototype.open = function (m, u) {
    this._url = u;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (pending && this._url) {
      for (var k in pending) {
        if (Object.prototype.hasOwnProperty.call(pending, k)) {
          try { this.setRequestHeader(k, pending[k]); } catch (e) {}
        }
      }
      pending = null;
    }
    return origSend.apply(this, arguments);
  };
};