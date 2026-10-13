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
   * Fuente activa: 'demo' | 'json' | 'm3u' | 'provider'
   *
   * Por defecto 'demo' porque funciona en cualquier sitio, incluido un
   * despliegue estatico como Vercel: son tres streams que ya traen CORS y no
   * pasan por el proxy. Las demas fuentes necesitan el proxy de serve.py,
   * que no existe en un despliegue estatico: el catalogo se veria pero el
   * video no.
   *
   * Se puede forzar desde la URL sin editar el fichero:
   *   index.html?src=m3u
   */
  source: 'demo',

  // Marca visible en la interfaz (multi-tenant, estilo portal).
  brand: {
    name: 'Mi TV',
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
        var dur = line.indexOf(',');
        if (dur > -1) pending.title = line.slice(dur + 1);
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
 * para que vuelvan a pasar por el y añade la cabecera.
 *
 * Si abres la app por file:// o desde un servidor sin proxy, pon
 * useProxy:false y solo funcionaran los streams que ya traigan CORS.
 * ------------------------------------------------------------------ */
var PROXY = {
  useProxy: true,

  /** Envuelve una URL remota para que pase por el proxy local. */
  wrap: function (url) {
    if (!this.useProxy) return url;
    if (url && url.charAt(0) === '/') return url;   // ya proxificada
    return '/proxy/stream?u=' + encodeURIComponent(url);
  }
};

/* ------------------------------------------------------------------ *
 * ADAPTER: M3U / Xtream
 * ------------------------------------------------------------------ */
function M3UAdapter(opts) {
  this.url = opts.url;
  this.label = opts.label || 'M3U';
}

M3UAdapter.prototype.list = function () {
  var self = this;
  return Utils.fetch(this.url, null, CONFIG.retry.timeoutMs).then(function (text) {
    var raw = Utils.parseM3U(text);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var it = raw[i];
      out.push({
        id: it.id,
        title: it.title || ('Canal ' + (i + 1)),
        kind: 'live',
        group: it.group,
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
  // Todo pasa por el proxy: sin el, la mayoria de canales no reproduce.
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
 * Fabrica
 *
 * Un parametro en la URL manda sobre CONFIG.source, para probar otra fuente
 * sin editar ficheros ni tener que volver a desplegar:
 *   index.html?src=m3u
 * ------------------------------------------------------------------ */
function activeSource() {
  try {
    var m = /[?&]src=([a-z]+)/i.exec(window.location.search || '');
    if (m && ['demo', 'json', 'm3u', 'provider'].indexOf(m[1].toLowerCase()) > -1) {
      return m[1].toLowerCase();
    }
  } catch (e) { /* file:// o sandbox sin location.search */ }
  return CONFIG.source;
}

function buildAdapter(name) {
  switch (name) {
    case 'm3u':
      // iptv-org: coleccion abierta de cadenas en abierto (TDT, etc).
      // Listos disponibles en https://github.com/iptv-org/iptv
      return new M3UAdapter({ url: 'https://iptv-org.github.io/iptv/countries/es.m3u' });
    case 'json':
      return new JsonAdapter({ url: 'streams.json' });
    case 'provider':
      return new ProviderAdapter({
        base: 'https://TU-DOMINIO',   // <- cuando lo tengas
        portalCode: 'TU-PORTAL-CODE',
        userId: '',
        userToken: '',
        lang: 'pt'
      });
    default:
      return new JsonAdapter({ url: 'streams.json' });
  }
}