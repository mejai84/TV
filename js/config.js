/**
 * config.js — Configuracion y adaptadores de proveedor.
 *
 * La app no depende de ningun backend concreto. Habla con un "adapter" que
 * cumple la misma interfaz. Asi puedes:
 *   - usar tu propia lista M3U / Xtream
 *   - usar streams publicos para probar
 *   - enchufar la API del proveedor cuando tengas portalCode + token
 *
 * Interfaz del adapter (implementa esto):
 *   adapter.list()            -> Promise<Item[]>
 *   adapter.epg()             -> Promise<EpgProgram[]>
 *   adapter.resolve(item)     -> Promise<Stream[]>   // [principal, ...respaldo]
 *   adapter.requestUrl?()     -> no requerido
 *
 * Item  = { id, title, kind, poster, year, description }
 * EpgProgram = { id, title, start, end, channelId }
 * Stream = { url, quality, headers, expiresAt }  // expiresAt en ms epoch, o 0
 */

/** Fusion simple, ES5, sin dependencias. */
function merge(base, extra) {
  var out = {};
  var k;
  for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
  for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
  return out;
}

/* ------------------------------------------------------------------ *
 * Config global. Edita SOLO esto para cambiar de fuente de contenido.
 * ------------------------------------------------------------------ */
var CONFIG = {
  /**
   * Fuente activa: 'iptvorg' | 'provider'
   *
   * iptv-org es la fuente real: sin listas de prueba. Antes existia una
   * 'demo' con tres streams de ejemplo que era la que se abria por defecto,
   * y hacia que en pantalla solo aparecieran 3 canales, muy lejos de los
   * 11262 que publica iptv-org. Se ha eliminado.
   */
  source: 'iptvorg',

  /**
   * Configuracion de TMDB para la fuente 'embeds' (estilo GoPelis).
   * Obten una API key gratuita en https://www.themoviedb.org/settings/api
   * (clave v3). Sin clave, el catalogo sale de NasriPlay (server-side).
   */
  tmdb: {
    apiKey: '',
    language: 'es-CO',
    baseUrl: 'https://api.themoviedb.org/3'
  },

  /**
   * Proveedores de embed activos para la fuente 'embeds'.
   * Cada uno recibe el id de TMDB y devuelve un iframe reproducible.
   * El orden es el de preferencia (el primero que cargue gana).
   */
  embeds: {
    // Reproducción directa con embeds públicos: no consume la cuota de
    // NasriPlay. Para volver a usar playUrl sin anuncios, abre la app con
    // ?nsr=on (se añade 'nasriplay' a la lista en buildAdapter).
    providers: ['vidsrc', 'vidlink', 'vimeus']
  },

  /**
   * nsrplay.space ("API Embed") — proveedor de embeds.
   * Su API key se envia en cada request como header X-API-Key o
   * parametro ?apiKey=. IMPORTANTE: al estar en el bundle del cliente,
   * la clave es visible para cualquiera que inspeccione el codigo.
   * Si quieres mantenerla secreta, proxea las llamadas por /api/stream-player
   * y guarda la clave en una variable de entorno de Vercel.
   */
  nsrplay: {
    // La clave vive ahora en la variable de entorno NSRPLAY_API_KEY de Vercel.
    // Este campo se mantiene por compatibilidad con desarrollo local; si lo
    // rellenas, el cliente la usara directamente (menos seguro).
    apiKey: '',
    baseUrl: 'https://nsrplay.space'
  },

  /**
   * Listas de iptv-org (https://github.com/iptv-org/iptv).
   *
   * El sitio publica playlists M3U por pais, idioma, categoria y region.
   * Todas envian Access-Control-Allow-Origin: *, asi que la lista se puede
   * leer directamente del navegador sin proxy.
   *
   * 'country' vacio = index.m3u completo (11262 canales, 2.5 MB), que es lo
   * que se pide por defecto. Con un valor se carga solo esa lista:
   *   'es'     -> countries/es.m3u (324 canales, 80 KB)
   *   'uk'     -> countries/uk.m3u (300)
   *   'movies' -> categories/movies.m3u (786)
   *
   * Aviso sobre el indice completo: son 2.5 MB y 11262 canales. Parsearlo
   * lleva su tiempo en el motor de un televisor viejo, y ademas muchos de
   * esos canales llevan anos caidos. Las listas por pais o categoria cargan
   * casi al instante y son mucho mas manejables con el D-pad.
   */
  iptvorg: {
    country: '',
    base: 'https://iptv-org.github.io/iptv'
  },

  // Sin marca: la interfaz no lleva logotipo ni nombre propio.
  // Si algun dia se quiere una marca, poner aqui el nombre y poner el
  // bloque .brand en la cabecera.
  brand: {
    name: '',
    logo: ''
  },

  // Puerta del reproductor. Si tu proveedor no permite quality manual,
  // pon false y el reproductor usa el nivel automatico.
  allowQualitySwitch: true,

  // Guia de programacion.
  //   url: ''  -> sin guia. Para obtener una: ver EPG.md
  //   url: XML -> XMLTV (comprimido con .gz no se soporta en el navegador;
  //                  descomprime antes y pon un .xml)
  //   url: JSON-> array de programas (ver Epg.normalize en epg.js)
  //
  // Sobre iptv-org: el repositorio iptv-org/epg NO aloja el XML, solo
  // agrega guias de terceros y las lista en GUIDES.md. De las que quedan
  // en pie, la unica con XML completo no envia Access-Control-Allow-Origin,
  // asi que el navegador la bloquea y solo se lee a traves del proxy de
  // serve.py. epg.pw/xmltv/epg_XX.xml si envia CORS, pero la de Espana
  // esta congelada en 2023; las de US y GB se actualizan a diario.
  // Para Espana hoy la opcion es bajar el XML y servirlo desde aqui.
  epg: {
    url: 'epg.json',
    // Asocia los programas de la guia con los canales del catalogo.
    // 'title' compara por nombre (lo normal en listas IPTV sin tvg-id comun).
    // 'exact' exige coincidencia exacta del tvg-id.
    matchBy: 'title',
    // Horas visibles de la rejilla.
    hours: 6
  },

  // Segundos de margen antes de renovar una URL firmada que caduca.
  // inspiration: el backend expone urlInvalidTime por recurso; aqui se
  //pte reserva margen para refrescar antes de que muera.
  urlRefreshMarginSec: 45,

  // Reintentos y timeout de red.
  retry: { attempts: 3, backoffMs: 1200, timeoutMs: 15000 }
};

/* ------------------------------------------------------------------ *
 * Utilidades compartidas
 * ------------------------------------------------------------------ */
var Utils = {
  now: function () { return Date.now(); },

  isBlank: function (v) {
    return v === null || v === undefined || (typeof v === 'string' && v.replace(/^\s+|\s+$/g, '') === '');
  },

  /** fetch con timeout, compatible con navegadores antiguos. */
  fetch: function (url, options, timeoutMs) {
    options = options || {};
    var xhr = new XMLHttpRequest();
    var started = Utils.now();

    return new Promise(function (resolve, reject) {
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else {
          reject(new Error('HTTP ' + xhr.status + ' en ' + url));
        }
      };
      xhr.onerror = function () { reject(new Error('Error de red en ' + url)); };

      xhr.open(options.method || 'GET', url, true);
      if (options.headers) {
        for (var h in options.headers) {
          if (Object.prototype.hasOwnProperty.call(options.headers, h)) {
            xhr.setRequestHeader(h, options.headers[h]);
          }
        }
      }
      xhr.send(options.body || null);

      // Timeout manual: no usamos Promise.race para no depender de ES6.
      setTimeout(function () {
        if (xhr.readyState !== 4) { try { xhr.abort(); } catch (e) {} }
      }, timeoutMs || CONFIG.retry.timeoutMs);
    });
  },

  /** M3U con campos extendidos (#EXTINF tvg-id etc). */
  parseM3U: function (text) {
    var lines = text.split(/\r?\n/);
    var items = [];
    var pending = null;

    function flush(url) {
      if (!pending) return;
      pending.url = url;
      items.push(pending);
      pending = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = Utils.trim(lines[i]);
      if (!line) continue;

      if (line.indexOf('#EXTM3U') === 0) continue;

      if (line.indexOf('#EXTINF') === 0) {
        flush(null);
        pending = { kind: 'live', id: null, title: '', poster: '', group: '', tvgId: '' };
        var dur = Utils.extinfComma(line);
        if (dur > -1) pending.title = Utils.trim(line.slice(dur + 1));
        var idm = line.match(/tvg-id="([^"]*)"/);
        if (idm) pending.tvgId = idm[1];
        var logom = line.match(/tvg-logo="([^"]*)"/);
        if (logom) pending.poster = logom[1];
        var gm = line.match(/group-title="([^"]*)"/);
        if (gm) pending.group = gm[1];
      } else if (line.charAt(0) === '#') {
        continue; // otros comentarios
      } else if (pending) {
        flush(line);
      }
    }
    flush(null);

    // El id cae al titulo si la lista no trae tvg-id.
    for (var j = 0; j < items.length; j++) {
      if (Utils.isBlank(items[j].id)) {
        items[j].id = items[j].tvgId || items[j].title || ('idx-' + j);
      }
    }
    return items;
  },

  trim: function (s) { return String(s).replace(/^\s+|\s+$/g, ''); },

  /**
   * Posicion de la coma que separa los atributos de #EXTINF del titulo.
   *
   * No puede ser la primera coma de la linea: iptv-org anade un atributo
   * user-agent con el navegador entero, y ahi hay comas dentro, por ejemplo
   * en "(KHTML, like Gecko)". Cortando por la primera, el titulo salia
   * desde dentro del user-agent y en pantalla se leia
   * " like Gecko) Chrome/149... group-title=...,1+1 International".
   *
   * Se recorre la linea saltando los tramos entrecomillados.
   */
  extinfComma: function (line) {
    var dentro = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') dentro = !dentro;
      else if (c === ',' && !dentro) return i;
    }
    return -1;
  },

  /**
   * Normaliza un nombre de canal para poder compararlo entre fuentes distintas.
   * "3Cat Cameres del temps (1080p) [Geo-blocked]" y "3cat-cameres-del-temps"
   * deben acabar siendo la misma clave, o la guia y el catalogo no se
   * enlazan y no hay forma de abrir un programa desde la guia.
   *
   * Quita: acentos, mayusculas, puntuacion, etiquetas entre parentesis y
   * corchetes, y colapsa espacios.
   */
  normTitle: function (s) {
    if (s === null || s === undefined) return '';
    var t = String(s).toLowerCase();
    t = t.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    // Normaliza acentos. Se hace a mano porque TVs sin Intl no traen
    // String.prototype.normalize y lo perderian en silencio.
    t = t.normalize ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    : t.replace(/[\u00e0-\u00ff]/g, '');
    t = t.replace(/[^a-z0-9]+/g, ' ');
    return Utils.trim(t);
  },

  /**
   * Limpia el titulo de un canal para que concuerde con su logotipo.
   * iptv-org anade etiquetas de calidad y geo-bloqueo al final: "(720p)",
   * "(1080p)", "(576i)", "[Geo-blocked]". El logo es la marca limpia, asi
   * que se quitan esas etiquetas para que nombre e imagen coincidan.
   */
  cleanTitle: function (s) {
    var t = Utils.trim(s);
    // Etiquetas entre corchetes al final: [Geo-blocked], [Not 24/7], etc.
    t = t.replace(/\s*\[[^\]]*\]\s*$/g, '');
    // Resolucion entre parentesis al final: (720p), (1080p), (576i), (480p).
    t = t.replace(/\s*\(\d{3,4}[pi]\)\s*$/i, '');
    return Utils.trim(t);
  },

  /** Escapa texto antes de inyectarlo en el DOM. */
  esc: function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};

/* ------------------------------------------------------------------ *
 * Proxy
 *
 * hls.js exige Access-Control-Allow-Origin en el manifiesto y en cada
 * segmento. Casi ningun servidor de television lo envia, y sin el proxy el
 * navegador bloquea antes de mirar el contenido. serve.py reescribe las URLs
 * Para que vuelvan a pasar por el y añade la cabecera.
 *
 * Por defecto esta apagado (consume datos y cuota). Se enciende con el boton
 * "Proxy" de la barra o con ?proxy=on; el boton lo recuerda en localStorage.
 * ------------------------------------------------------------------ */
var PROXY = {
  // Por defecto se reproduce directo: el proxy de streaming consume mucho
  // ancho de banda y agota la cuota. Se activa a propósito con ?proxy=on
  // o con el botón "Proxy" de la barra (se recuerda en localStorage).
  useProxy: (function () {
    try {
      if (/(?:[?&])proxy=on(?:&|$)/i.test(window.location.search || '')) return true;
      return localStorage.getItem('tv_proxy') === '1';
    } catch (e) { return false; }
  })(),

  /** Activa o desactiva el proxy y recuerda la elección entre visitas. */
  set: function (on) {
    this.useProxy = !!on;
    try { localStorage.setItem('tv_proxy', on ? '1' : '0'); } catch (e) { /* file:// */ }
  },

  /** ¿Está el proxy activado ahora mismo? */
  isOn: function () { return !!this.useProxy; },

  /**
   * Ruta del proxy. Hay dos porque viven en sitios distintos:
   *   '/proxy/stream?u=' -> serve.py, en local
   *   '/api/stream?u='  -> api/stream.js, en Vercel
   * Se detecta solo: si la pagina se sirve desde Vercel (o desde cualquier
   * despliegue donde no exista serve.py) se usa la funcion.
   */
  path: function () {
    var host = '';
    try { host = window.location.hostname || ''; } catch (e) { /* file:// */ }
    var enVercel = /\.vercel\.app$/.test(host) || window.__FORCE_API_PROXY__;
    return enVercel ? '/api/stream?u=' : '/proxy/stream?u=';
  },

  /** Envuelve una URL remota para que pase por el proxy. */
  wrap: function (url) {
    if (!this.useProxy) return url;
    if (url && url.charAt(0) === '/') return url;   // ya proxificada
    return PROXY.path() + encodeURIComponent(url);
  }
};

/* ------------------------------------------------------------------ *
 * ADAPTER: M3U / Xtream
 * ------------------------------------------------------------------ */
function M3UAdapter(opts) {
  // Se acepta una sola url o una lista de candidatas: en ese caso se van
  // probando hasta que una devuelva canales.
  this.urls = opts.urls || [opts.url];
  this.url = this.urls[0];
  this.label = opts.label || 'M3U';
  // Si es falso se respeta el group-title tal cual venga en la lista.
  this.mergeCategories = (opts.mergeCategories !== false);
}

/**
 * iptv-org encadena varias categorias con punto y coma en el group-title
 * ("Classic;Comedy;Public;Series"), asi que sin limpiar una lista de
 * Espana produce 43 grupos y el lateral del televisor queda inservible. Se queda
 * con la primera, que es la de contenido, y el resto se descarta.
 *
 * "Undefined" no es una categoria: es la que asigna iptv-org cuando el
 * canal no tiene ninguna, y se traduce a "Otros".
 */
function primaryGroup(name) {
  var parts = Utils.trim(String(name || '')).split(';');
  var first = Utils.trim(parts[0]);
  if (!first || first.toLowerCase() === 'undefined') return 'Otros';
  return first;
}

M3UAdapter.prototype.list = function () {
  var self = this;
  var index = 0;

  function attempt() {
    if (index >= self.urls.length) {
      // Se agotaron las candidatas: se devuelve la ultima URL para que el
      // error diga algo util y no un "undefined" sin contexto.
      return Promise.reject(new Error(
        'Ninguna lista de iptv-org devolvio canales (probadas: ' + self.urls.join(', ') + ')'
      ));
    }
    var url = self.urls[index++];
    return Utils.fetch(url, null, CONFIG.retry.timeoutMs).then(function (text) {
      var raw = Utils.parseM3U(text);
      // Una lista vacia o un 404 con cuerpo de error no cuenta: se pasa a
      // la siguiente candidata antes de rendah.
      if (!raw.length) return attempt();
      self.url = url;
      return raw;
    }).catch(function (e) {
      if (index >= self.urls.length) throw e;
      return attempt();
    });
  }

  return attempt().then(function (raw) {
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var it = raw[i];
      out.push({
        id: it.id,
        title: Utils.cleanTitle(it.title || ('Canal ' + (i + 1))),
        kind: 'live',
        group: self.mergeCategories ? primaryGroup(it.group) : (it.group || 'Otros'),
        poster: it.poster,
        year: '',
        description: ''
      });
      // Guardamos la URL original para resolver().
      out[out.length - 1]._url = it.url;
    }
    return out;
  });
};

M3UAdapter.prototype.resolve = function (item) {
  // Directo por defecto. Con ?proxy=on se fuerza el proxy CORS para los
  // canales que no mandan Access-Control-Allow-Origin.
  return Promise.resolve([{ url: PROXY.wrap(item._url), quality: 'auto', headers: {}, expiresAt: 0 }]);
};

M3UAdapter.prototype.epg = function () { return EpgSource.load(); };

/* ------------------------------------------------------------------ *
 * EpgSource — carga la guia desde CONFIG.epg.url
 *
 * Acepta dos formatos:
 *   XMLTV (.xml)  -> se parsea con DOMParser, disponible en TVs antiguos
 *   JSON (.json)  -> array de objetos {channelId, title, start, end, type}
 *
 * XMLTV usa nombres de canal en <display-name>, no ids numericos. Por eso
 * despues associates por texto: es lo unico que coincide de forma fiable
 * entre un XMLTV y una lista IPTV cualesquiera.
 * ------------------------------------------------------------------ */
var EpgSource = {
  _cache: null,

  load: function () {
    var self = this;
    var url = (CONFIG.epg && CONFIG.epg.url) || '';
    if (!url) return Promise.resolve([]);
    if (this._cache) return Promise.resolve(this._cache);

    return Utils.fetch(url, null, 30000).then(function (text) {
      var progs = /\.json(\?|$)/i.test(url)
        ? JSON.parse(text)
        : EpgSource.parseXmltv(text);
      var items = Epg.normalize(progs || []);
      self._cache = items;
      return items;
    }).catch(function (e) {
      // Una guia que falla no debe tumbar el catalogo.
      return [];
    });
  },

  parseXmltv: function (xmlText) {
    if (typeof DOMParser === 'undefined') return [];
    var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (!doc || !doc.documentElement) return [];

    var out = [];
    var progs = doc.getElementsByTagName('programme');

    for (var i = 0; i < progs.length; i++) {
      var p = progs[i];
      var start = EpgSource.parseXmltvTime(p.getAttribute('start'));
      var stop = EpgSource.parseXmltvTime(p.getAttribute('stop'));
      if (!start) continue;
      if (!stop || stop <= start) stop = start + 30 * 60000;

      var ch = p.getAttribute('channel') || '';
      var titles = p.getElementsByTagName('title');
      var descs = p.getElementsByTagName('desc');
      var cats = p.getElementsByTagName('category');

      out.push({
        id: ch + '-' + start,
        channelId: ch,
        title: titles.length ? EpgSource.text(titles[0]) : 'Sin titulo',
        desc: descs.length ? EpgSource.text(descs[0]) : '',
        type: (cats.length ? EpgSource.text(cats[0]) : 'program').toLowerCase(),
        start: Epg.parseTs(start),
        end: Epg.parseTs(stop)
      });
    }
    return out;
  },

  /**
   * XMLTV usa "20261013183000 +0200" (sin separadores, con offset).
   * Se convierte a ISO que es lo que entiende Date.
   */
  parseXmltvTime: function (v) {
    if (!v) return 0;
    var m = String(v).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
    if (!m) return Epg.parseTs(v);
    var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
    if (m[7]) {
      iso += m[7].slice(0, 3) + ':' + m[7].slice(3);
    }
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  },

  text: function (node) {
    return Utils.trim(node.textContent || node.innerText || '');
  },

  /**
   * Asocia cada programa con el id de canal del catalogo.
   * Sin esto, la guia mostraria "3Cat" y el catalogo "3Cat Cameres del temps",
   * que no son la misma cadena, y no se podrian enlazar.
   */
  matchToCatalog: function (items, catalog) {
    if (!items.length || !catalog.length) return items;

    var byTitle = {}, byId = {};
    for (var i = 0; i < catalog.length; i++) {
      var it = catalog[i];
      var norm = Utils.normTitle(it.title);
      if (!byTitle[norm]) byTitle[norm] = it.id;   // el primero gana
      byId[it.id] = it;
    }

    var matched = 0;
    for (var j = 0; j < items.length; j++) {
      var prog = items[j];

      // 1) Coincidencia por id exacto (tvg-id compartido)
      if (byId[prog.channelId]) {
        prog.title = prog.title;
        matched++;
        continue;
      }

      // 2) Por nombre normalizado: sin acentos, sin parentesis de calidad,
      //    sin marcas de geobloqueo.
      var key = Utils.normTitle(prog.channelId);
      if (byTitle[key]) { prog.channelId = byTitle[key]; matched++; continue; }

      // 3) Preferencia: el titulo del programa empieza por el nombre del
      //    canal, patron habitual en XMLTV.
      var found = null;
      for (var t2 in byTitle) {
        if (!Object.prototype.hasOwnProperty.call(byTitle, t2)) continue;
        if (t2.length >= 4 && Utils.normTitle(prog.title).indexOf(t2) === 0) {
          found = byTitle[t2];
          break;
        }
      }
      if (found) { prog.channelId = found; matched++; }
    }

    // Solo se conserva lo que se pudo asociar: el resto no se puede abrir.
    var out = [];
    for (var k = 0; k < items.length; k++) {
      if (byId[items[k].channelId]) out.push(items[k]);
    }
    return out;
  }
};

/* ------------------------------------------------------------------ *
 * ADAPTER: JSON estatico (bueno para probar sin servidor)
 *   espera: [ { title, kind, url, poster, quality, expiresAt } ]
 * ------------------------------------------------------------------ */
function JsonAdapter(opts) {
  this.url = opts.url;
}

JsonAdapter.prototype.list = function () {
  var self = this;
  return Utils.fetch(this.url, null, CONFIG.retry.timeoutMs).then(function (text) {
    var raw = JSON.parse(text);
    return raw.map(function (r, i) {
      return {
        id: r.id || ('i' + i),
        title: r.title,
        kind: r.kind || 'live',
        group: r.group || '',
        poster: r.poster || '',
        year: r.year || '',
        description: r.description || ''
      };
    });
  });
};

JsonAdapter.prototype.resolve = function (item) {
  var self = this;
  return Utils.fetch(this.url, null, CONFIG.retry.timeoutMs).then(function (text) {
    var raw = JSON.parse(text);
    var entry = null;
    for (var i = 0; i < raw.length; i++) {
      if ((raw[i].id || ('i' + i)) === item.id) { entry = raw[i]; break; }
    }
    if (!entry) throw new Error('Item no encontrado: ' + item.id);
    var urls = [].concat(entry.url || []);
    return urls.map(function (u, i) {
      return {
        url: typeof u === 'string' ? u : u.url,
        quality: (typeof u === 'object' && u.quality) || 'auto',
        headers: (typeof u === 'object' && u.headers) || {},
        expiresAt: parseInt(entry.expiresAt || 0, 10) || 0
      };
    });
  });
};

JsonAdapter.prototype.epg = function () { return EpgSource.load(); };

/* ------------------------------------------------------------------ *
 * ADAPTER: API con token (el que usaras con el proveedor)
 *
 * El esquema de peticion que se observo en la app nativa:
 *   POST {base}/{serviceName}/{method}/{uri}
 *   Body JSON plano con CommonParams + el bean de la peticion
 *
 * Rellena estos valores cuando tengas portalCode + userToken. Hasta
 * entonces devuelve la lista vacia en vez de fallar en silencio.
 * ------------------------------------------------------------------ */
function ProviderAdapter(opts) {
  this.base = opts.base || '';
  this.portalCode = opts.portalCode || '';
  this.userId = opts.userId || '';
  this.userToken = opts.userToken || '';
  this.lang = opts.lang || 'pt';
  this.timeout = opts.timeoutMs || 20000;
}

ProviderAdapter.prototype.credentialsReady = function () {
  return !Utils.isBlank(this.base) &&
         !Utils.isBlank(this.portalCode) &&
         !Utils.isBlank(this.userToken);
};

/** Construye el cuerpo con los parametros comunes. */
ProviderAdapter.prototype.body = function (extra) {
  var base = {
    portalCode: this.portalCode,
    userId: this.userId,
    userToken: this.userToken,
    appLanguage: this.lang,
    apkVersion: '1.0.0',
    loginType: 'normal'
  };
  return merge(base, extra || {});
};

ProviderAdapter.prototype.call = function (serviceName, method, uri, extra) {
  if (!this.credentialsReady()) {
    return Promise.reject(new Error(
      'ProviderAdapter sin credenciales: define base, portalCode y userToken en config.js'
    ));
  }
  var url = this.base + '/' + serviceName + '/' + method + '/' + String(uri).replace(/^\/+/, '');
  return Utils.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(this.body(extra))
  }, this.timeout).then(function (text) {
    return JSON.parse(text);
  });
};

/** Sustituye estos cuerpos por las rutas reales cuando tengas credenciales. */
ProviderAdapter.prototype.list = function () {
  if (!this.credentialsReady()) return Promise.resolve([]);
  return this.call('portal', 'getHome', '', {}).then(function (res) {
    var out = [];
    var recs = (res && res.data && res.data.recommendList) || [];
    for (var i = 0; i < recs.length; i++) {
      var assets = recs[i].assetList || [];
      for (var j = 0; j < assets.length; j++) {
        out.push({
          id: assets[j].contentId,
          title: assets[j].name,
          kind: 'vod',
          group: recs[i].name,
          poster: (assets[j].posterList && assets[j].posterList[0] &&
                   assets[j].posterList[0].fileUrl) || '',
          year: '',
          description: ''
        });
      }
    }
    return out;
  });
};

ProviderAdapter.prototype.resolve = function (item) {
  if (!this.credentialsReady()) return Promise.resolve([]);
  // El endpoint real exige ademas un license emitido por el servidor.
  // Devolvemos la forma esperada para que la UI funcione aunque el token
  // de licencia no llegue.
  return this.call('portal', 'getVodPlayUrl', '', {
    media_code: item.id,
    auth: '',
    license: ''
  }).then(function (res) {
    var data = (res && res.data) || {};
    var url = data.media_url || data.idx_url || '';
    if (!url) return [];
    return [{
      url: url,
      quality: 'auto',
      headers: {},
      expiresAt: parseInt(data.urlInvalidTime || 0, 10) || 0
    }];
  }).catch(function () { return []; });
};

ProviderAdapter.prototype.epg = function () {
  // El servicio EPG del backend no es alcanzable sin credenciales, asi que se
  // cae a la guia externa. Cuando haya token, quitar este return.
  return EpgSource.load();
};

/* ------------------------------------------------------------------ *
 * EmbedAdapter - agregador de embeds estilo GoPelis.
 *
 * No almacena video: para cada pelicula (identificada por su id de TMDB)
 * devuelve varias URLs de embed (vidsrc, vidlink, vimeus, nasriplay...) en
 * orden de preferencia. El reproductor prueba la primera y, si falla, pasa
 * a la siguiente sin intervencion.
 *
 * La lista se obtiene de TMDB (popular/trending). Sin API key cae a un
 * catalogo local minimo para que la UI no quede vacia.
 * ------------------------------------------------------------------ */
function EmbedAdapter(opts) {
  this.tmdbKey = (opts && opts.tmdbKey) || '';
  this.tmdbBase = (opts && opts.tmdbBase) || 'https://api.themoviedb.org/3';
  this.tmdbLang = (opts && opts.tmdbLang) || 'es-ES';
  this.providers = (opts && opts.providers) || ['vidsrc', 'vidlink', 'vimeus'];
  // La API de NasriPlay solo se usa si se pide explícitamente con ?nsr=on.
  this.useNasriplay = !!(opts && opts.useNasriplay);
}

EmbedAdapter.prototype._tmdb = function (path) {
  var url = this.tmdbBase + path;
  if (this.tmdbKey) url += (path.indexOf('?') > -1 ? '&' : '?') + 'api_key=' + encodeURIComponent(this.tmdbKey) + '&language=' + encodeURIComponent(this.tmdbLang);
  return url;
};

EmbedAdapter.prototype.list = function () {
  var self = this;
  if (!this.tmdbKey) {
    // Sin TMDB key el catálogo sale de NasriPlay (server-side) o de la BD.
    // Se piden varias páginas para no perder títulos recién añadidos.
    function fetchPages(type) {
      var pages = [1, 2, 3];
      return Promise.all(pages.map(function (pg) {
        return fetch('/api/catalog?type=' + encodeURIComponent(type) + '&page=' + pg)
          .then(function (r) { return r.json(); })
          .then(function (d) { return (d && d.items) || []; })
          .catch(function () { return []; });
      })).then(function (parts) {
        var seen = {};
        var out = [];
        for (var i = 0; i < parts.length; i++) {
          for (var j = 0; j < parts[i].length; j++) {
            var it = parts[i][j];
            if (!it || !it.id) continue;
            if (seen[it.id]) continue;
            seen[it.id] = 1;
            out.push(it);
          }
        }
        return out;
      });
    }

    var moviesP = fetchPages('movie');
    var seriesP = fetchPages('series');

    return Promise.all([moviesP, seriesP]).then(function (parts) {
      var all = parts[0].concat(parts[1]);
      if (all.length) return all;
      // Último recurso: catálogo local mínimo para que la UI no quede vacía.
      return [
        { id: '550', title: 'Fight Club', kind: 'movie', poster: '', year: '1999', description: 'Un oficinista insomne y un fabricante de jabón forman un club de lucha clandestino.' },
        { id: '27205', title: 'Inception', kind: 'movie', poster: '', year: '2010', description: 'Un ladrón que roba secretos corporativos mediante la tecnología de compartir sueños.' },
        { id: '1396', title: 'Breaking Bad', kind: 'series', poster: '', year: '2008', description: 'Un profesor de química diagnosticado con cáncer se convierte en fabricante de metanfetamina.' }
      ];
    });
  }
  // Peliculas y series en paralelo; se mezclan y se etiquetan con 'kind'.
  var moviesP = fetch(self._tmdb('/movie/popular?page=1'))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var out = [];
      var results = (data && data.results) || [];
      for (var i = 0; i < results.length; i++) {
        var m = results[i];
        out.push({
          id: String(m.id),
          title: m.title || m.name || 'Sin titulo',
          kind: 'movie',
          poster: m.poster_path ? 'https://image.tmdb.org/t/p/w342' + m.poster_path : '',
          year: (m.release_date || '').slice(0, 4),
          description: m.overview || ''
        });
      }
      return out;
    })
    .catch(function () { return []; });

  var seriesP = fetch(self._tmdb('/tv/popular?page=1'))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var out = [];
      var results = (data && data.results) || [];
      for (var i = 0; i < results.length; i++) {
        var m = results[i];
        out.push({
          id: String(m.id),
          title: m.name || m.title || 'Sin titulo',
          kind: 'series',
          poster: m.poster_path ? 'https://image.tmdb.org/t/p/w342' + m.poster_path : '',
          year: (m.first_air_date || '').slice(0, 4),
          description: m.overview || ''
        });
      }
      return out;
    })
    .catch(function () { return []; });

  return Promise.all([moviesP, seriesP]).then(function (parts) {
    return parts[0].concat(parts[1]);
  });
};

EmbedAdapter.prototype._embedUrl = function (provider, item) {
  // Cada proveedor tiene su propio formato de URL de embed.
  // Para series se usa el path /tv/ en vez de /movie/, y si hay
  // season/episode seleccionados se incluyen en la URL.
  var id = item && item.id;
  var isSeries = item && (item.kind === 'series' || item.kind === 'tv');
  var typePath = isSeries ? 'tv' : 'movie';
  var season = (item && item.season) || '';
  var episode = (item && item.episode) || '';

  // Sufijo de temporada/episodio (solo para series).
  var seSuffix = '';
  if (isSeries && season && episode) {
    seSuffix = '/' + encodeURIComponent(season) + '/' + encodeURIComponent(episode);
  }

  switch (provider) {
    case 'vidsrc':
      return 'https://vidsrc.to/embed/' + typePath + '/' + encodeURIComponent(id) + seSuffix;
    case 'vidlink':
      return 'https://vidlink.pro/' + typePath + '/' + encodeURIComponent(id) + seSuffix;
    case 'vimeus':
      return 'https://vimeus.com/embed/' + typePath + '/' + encodeURIComponent(id) + seSuffix;
    case 'nasriplay':
    case 'peliapi-player':
      // Estos pasan por nuestro backend para que la API key de nsrplay
      // no quede expuesta en el bundle del cliente.
      var url = '/api/stream-player?source=' + encodeURIComponent(provider) +
             '&type=' + encodeURIComponent(typePath) +
             '&id=' + encodeURIComponent(id);
      if (seSuffix) url += '&season=' + encodeURIComponent(season) + '&episode=' + encodeURIComponent(episode);
      return url;
    default:
      return null;
  }
};

/* Resolución para títulos del catálogo NasriPlay (identificados por slug).
 * info/:slug (películas) o servers?slug (series) -> resolve-url -> playUrl.
 * Se prueban como máximo 2 servidores para cuidar la cuota de la API. */
EmbedAdapter.prototype._resolveBySlug = function (item) {
  var isSeries = item && (item.kind === 'series' || item.kind === 'tv');
  var slug = encodeURIComponent(item.slug);

  var serversP;
  if (isSeries) {
    var sn = encodeURIComponent(item.season || 1);
    var ep = encodeURIComponent(item.episode || 1);
    serversP = fetch('/api/nsrplay?action=servers&slug=' + slug + '&season=' + sn + '&episode=' + ep)
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d && d.data && d.data.servers) || []; });
  } else {
    serversP = fetch('/api/nsrplay?action=info&slug=' + slug + '&type=movie')
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d && d.data && d.data.servers) || []; });
  }

  return serversP.then(function (servers) {
    var out = [];
    var idx = 0;

    function step() {
      if (idx >= servers.length || out.length >= 2) return Promise.resolve();
      var s = servers[idx++] || {};
      var eu = s.embedUrl || s.url;
      if (!eu) return step();
      return fetch('/api/nsrplay?action=resolve-url&url=' + encodeURIComponent(eu))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var play = d && d.data && (d.data.playUrl || d.data.play_url);
          if (play) {
            out.push({ url: play, quality: 'FHD', headers: {}, expiresAt: 0, label: s.language || s.name || '' });
            return; // ya tenemos uno reproducible
          }
          return step();
        })
        .catch(function () { return step(); });
    }

    return step().then(function () {
      if (out.length) return out;
      // Respaldo: primer embed directo (puede traer anuncios).
      if (servers.length && (servers[0].embedUrl || servers[0].url)) {
        return [{ url: servers[0].embedUrl || servers[0].url, quality: 'FHD', headers: {}, expiresAt: 0 }];
      }
      return [];
    });
  }).catch(function () { return []; });
};

EmbedAdapter.prototype.resolve = function (item) {
  var self = this;
  if (!item) return Promise.resolve([]);

  // Las series del catálogo NasriPlay se enriquecen en /api/catalog con un
  // tmdbId. Con ese ID se usan los embeds públicos y no se gasta cuota.
  if (item.tmdbId) {
    item = {
      id: String(item.tmdbId),
      kind: item.kind,
      season: item.season,
      episode: item.episode,
      title: item.title
    };
  }

  var id = item && item.id;
  if (!id) return Promise.resolve([]);

  // Item del catálogo NasriPlay sin tmdbId (no se pudo emparejar): el flujo
  // por slug solo está disponible si se activó ?nsr=on.
  if (item.slug) {
    return this.useNasriplay ? this._resolveBySlug(item) : Promise.resolve([]);
  }

  var isSeries = item && (item.kind === 'series' || item.kind === 'tv');
  var typePath = isSeries ? 'tv' : 'movie';
  var season = (item && item.season) || '';
  var episode = (item && item.episode) || '';

  var providers = self.providers.slice();
  // Los títulos añadidos manualmente (o ya resueltos por NasriPlay) intentan
  // el flujo nasriplay (playUrl sin anuncios) aunque no se haya activado
  // ?nsr=on globalmente.
  if ((item.source === 'manual' || item.resolved) && providers.indexOf('nasriplay') === -1) {
    providers.push('nasriplay');
  }

  var priority = [];   // nsrplay/playUrl: reproduccion directa sin anuncios
  var others = [];     // iframes publicos de respaldo
  var tasks = [];

  for (var i = 0; i < providers.length; i++) {
    var provider = providers[i];

    if (provider === 'nasriplay') {
      // Modo avanzado (2 pasos): sources -> resolve del token -> playUrl.
      // Se prueba servidor por servidor (maximo 3) para no gastar cuota.
      tasks.push((function () {
        var srcUrl = '/api/nsrplay?action=sources&type=' + encodeURIComponent(typePath) + '&id=' + encodeURIComponent(id);
        if (isSeries && season && episode) srcUrl += '&season=' + encodeURIComponent(season) + '&episode=' + encodeURIComponent(episode);
        return fetch(srcUrl).then(function (r) { return r.json(); }).then(function (data) {
          var servers = (data && data.servers) || (data && data.data && data.data.servers) || [];
          if (!servers.length) throw new Error('sin servidores');

          var tried = 0;
          function attempt(idx) {
            if (idx >= servers.length || tried >= 3) throw new Error('sin playUrl');
            tried++;
            var srv = servers[idx] || {};
            var token = srv.token || srv.id || srv.serverToken;
            if (!token) return attempt(idx + 1);
            return fetch('/api/nsrplay?action=resolve&token=' + encodeURIComponent(token))
              .then(function (r2) { return r2.json(); })
              .then(function (d2) {
                var play = d2 && (d2.playUrl || d2.play_url || (d2.data && d2.data.playUrl));
                if (play) {
                  priority.push({ url: play, quality: 'FHD', headers: {}, expiresAt: 0, label: srv.language || srv.name || 'NsrPlay' });
                  return;
                }
                return attempt(idx + 1);
              })
              .catch(function () { return attempt(idx + 1); });
          }
          return attempt(0);
        }).catch(function () {
          // Respaldo: iframe directo (con anuncios, pero funciona).
          var fallback = 'https://nsrplay.space/embed/' + typePath + '/' + encodeURIComponent(id);
          if (isSeries && season && episode) fallback += '/' + encodeURIComponent(season) + '/' + encodeURIComponent(episode);
          priority.push({ url: fallback, quality: 'FHD', headers: {}, expiresAt: 0 });
        });
      })());
    } else {
      // Proveedores publicos: URL directa de embed (iframe).
      var url = self._embedUrl(provider, item);
      if (url) others.push({ url: url, quality: 'FHD', headers: {}, expiresAt: 0 });
    }
  }

  if (tasks.length === 0) return Promise.resolve(others);

  return Promise.all(tasks).then(function () {
    // playUrl (sin anuncios) siempre primero; iframes despues como respaldo.
    return priority.concat(others);
  });
};

EmbedAdapter.prototype.epg = function () {
  return EpgSource.load();
};

/* ------------------------------------------------------------------ *
 * Fabrica
 *
 * Ya no hay listas de prueba: solo iptv-org y, si algun dia se conecta un
 * portal con token, 'provider'. El parametro src= se conserva para poder
 * forzar el portal sin editar ficheros ni volver a desplegar.
 * ------------------------------------------------------------------ */
function activeSource() {
  try {
    var m = /[?&]src=([a-z]+)/i.exec(window.location.search || '');
    if (m && ['iptvorg', 'provider', 'embeds'].indexOf(m[1].toLowerCase()) > -1) {
      return m[1].toLowerCase();
    }
  } catch (e) { /* file:// o sandbox sin location.search */ }
  return CONFIG.source;
}

/**
 * Compone las URLs candidatas de una playlist de iptv-org.
 *
 * El sitio publica las listas en carpetas por tipo, asi que un mismo valor
 * puede ser un pais, un idioma, una categoria o una region. Ademas los
 * codigos no siempre son los que uno espera (Reino Unido es 'gb', no 'uk'),
 * asi que se devuelven varias candidatas y el adaptador se queda con la
 * primera que traiga canales. Sin esto, un codigo mal escrito dejaba la
 * pantalla vacia sin decir nada.
 */
function iptvOrgUrls(key) {
  var cfg = CONFIG.iptvorg || {};
  var base = cfg.base || 'https://iptv-org.github.io/iptv';
  key = Utils.trim(String(key || '')).toLowerCase();

  if (!key) return [base + '/index.m3u'];

  // El orden importa: 'lat' existe como region y no como pais, y
  // 'movies' como categoria y no como pais. Se prueban primero los
  // identificadores geograficos (lo habitual en un mando de TV) y luego el
  // contenido. Con otro orden, 'lat' se comia una lista de idioma de dos
  // canales en vez de la regional.
  var kinds = ['countries', 'regions', 'categories', 'languages'];
  if (cfg.kind && kinds.indexOf(cfg.kind) > -1) {
    return [base + '/' + cfg.kind + '/' + key + '.m3u'];
  }

  var urls = [], i;
  for (i = 0; i < kinds.length; i++) {
    urls.push(base + '/' + kinds[i] + '/' + key + '.m3u');
  }
  // Al final queda siempre el indice completo, que no puede fallar.
  urls.push(base + '/index.m3u');
  return urls;
}

function buildAdapter(name) {
  switch (name) {
    case 'iptvorg':
    default:
      // iptv-org: coleccion abierta de cadenas en abierto, actualizada a
      // diario. Sin cc= se carga el indice completo (11262 canales):
      //   index.html            -> todos los paises
      //   index.html?cc=es      -> solo Espana
      var cc = (CONFIG.iptvorg || {}).country || '';
      try {
        var m = /[?&]cc=([a-z0-9-]*)/i.exec(window.location.search || '');
        if (m) cc = m[1].toLowerCase();
      } catch (e) { /* sin location.search */ }
      return new M3UAdapter({ urls: iptvOrgUrls(cc) });
    case 'provider':
      return new ProviderAdapter({
        base: 'https://TU-DOMINIO',   // <- cuando lo tengas
        portalCode: 'TU-PORTAL-CODE',
        userId: '',
        userToken: '',
        lang: 'pt'
      });
    case 'embeds': {
      var useNsr = false;
      try {
        useNsr = /(?:[?&])nsr=on(?:&|$)/i.test(window.location.search || '');
      } catch (e) { /* sin location.search */ }
      var providers = ((CONFIG.embeds && CONFIG.embeds.providers) || ['vidsrc', 'vidlink', 'vimeus']).slice();
      if (useNsr && providers.indexOf('nasriplay') === -1) providers.push('nasriplay');
      return new EmbedAdapter({
        tmdbKey: (CONFIG.tmdb && CONFIG.tmdb.apiKey) || '',
        tmdbBase: (CONFIG.tmdb && CONFIG.tmdb.baseUrl) || 'https://api.themoviedb.org/3',
        tmdbLang: (CONFIG.tmdb && CONFIG.tmdb.language) || 'es-ES',
        providers: providers,
        useNasriplay: useNsr
      });
    }
  }
}