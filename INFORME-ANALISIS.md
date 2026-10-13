# Informe de análisis estático — APK Android

**Muestra:** `xuper-hydra-6.5.7.apk`
**SHA-256:** `3103a55e5f39fe474143496e5ebdfb5a2b2be924ab4cc51517b59b930a927290`
**Versión declarada:** 6.5.7 (versionCode 60507) · **SHA-256 del certificado:** `68b903e0e563686f429a3a60 8cd8a8bfd892266a51cf9332e20381cd`
**Tamaño:** 35,7 MB · **Clases:** 14.871 · **Recursos:** 2.715
**Paquete:** `com.msandroid.mobile` · **minSdk 19 · targetSdk 33 · compileSdk 34**

> **Alcance:** análisis estático únicamente. La muestra no se ejecutó, no se
> instrumentó y no se capturó tráfico. Ninguna conclusión de este informe
> establece comportamiento en tiempo de ejecución.

---

## 1. Resumen ejecutivo

La muestra es un cliente Android de streaming de TV conarchitecture modular,
ofuscación de ProGuard a nivel de clase y resolución de servidores en tiempo
de ejecución. Dos hallazgos dominan el análisis:

1. **La configuración de backend viaja en runtime, no en el artefacto.** El
   único activo de configuración empaquetado (`assets/domain_test.json`)
   contiene marcadores de posición, no direcciones. Los servidores reales se
   resuelven en el arranque a través de una cadena de descubrimiento
   (bootstrap → SLB/GSLB → servicio) autenticada por token.

2. **El tráfico de aplicación no está cifrado en la capa de aplicación.** El
   cuerpo de las peticiones es JSON plano y la conversión a `ByteBuffer` no
   aplica cifrado alguno. La confidencialidad en tránsito depende únicamente
   de TLS.

Ambos puntos reducen sustancialmente el coste de una implementación
interoperable **a nivel de protocolo**, aunque no a nivel de contenido: la
emisión de vídeo queda condicionada por la adquisición de licencias DRM
emitidas por el servidor del operador.

---

## 2. Identidad y empaquetado

| Campo | Valor |
|---|---|
| Paquete | `com.msandroid.mobile` |
| Clase Application | `com.mobile.brasiltv.app.App` |
| Codename | `brasiltv` |
| Multi-DEX | sí (≥ 4 DEX) |
| Deep link | `sxl://www.magis4K.com` |
| Deep link (Firebase) | `https://brtvphone.page.link` |
| Diseño | 750×1334 px · 1280×720 dp |

La coexistencia de ambas resoluciones de diseño y la presencia de
`com.hpplay` (乐播 / Lelink) como receptor de emisión indica una variante
orientada a televisor dentro de un mismo artefacto.

---

## 3. Inventario de SDK de terceros

| SDK | Paquete / host | Función |
|---|---|---|
| HPPlay Lelink | `*.hpplay.cn`, `*.lebo.cn` | Cast a sanitarios (incluye 海信 `com.multiscreen.airplay`, TCL, 创维, 康佳) |
| Google Cast | `magis-mobile-7abeb.appspot.com` | Cast |
| Firebase | analytics, crashlytics, messaging, dynamic links, auth | Telemetría, push, identidad |
| Firebase Auth | Google, Yahoo, Microsoft, Facebook | Login social |
| AdMob | `ca-app-pub-9843556922272883~3303824453` | Publicidad |
| Yandex AppMetrica | `startup.mobile.yandex.net` | Analítica |
| Umeng | `68b903e0e563686f429a3a60` | Analítica y push |
| Alibaba ACCS | `com.taobao.accs.*` | Push (Alibaba) |
| Qiniu | `com.qiniu.android.dns` | DNS y CDN |
| IJKPlayer | `libijkplayer.so`, `libijkffmpeg.so` | Reproductor nativo |
| JJWT, Glide, OkHttp, Gson, RxJava, Room, WorkManager | — | Utilidades |

`vendor/hls.min.js`-equivalente no aplica; el cliente reproduce HLS vía
ijkplayer nativo, no MSE.

---

## 4. Arquitectura modular

Doce dominios funcionales, derivados del inventario de 92 beans de petición y
las ~60 Activities declaradas:

| # | Módulo | Evidencia |
|---|---|---|
| 1 | Bootstrap / infraestructura | `GetAddrBean`, `GetAddrDcsBean`, `GetSlbInfoBean`, `SnTokenBean`, `HeartBeatBean` |
| 2 | Cuenta y autenticación | `LoginBean`, `LoginThirdPartBean`, `Qr*Bean`, `Bind*`, `Verification*` |
| 3 | Suscripción y pagos | `CheckGetVip`, `GetPriorityVip`, `OrderInfo`, `Exchange*`, `GiftDays`, `FreeTime` |
| 4 | VOD / catálogo | `GetHome`, `GetColumnContents`, `GetItemData`, `VodRecommends`, `ShelveData`, `StartPlayVOD` |
| 5 | TV en vivo | `GetLiveData`, `GetStartPlayLive` |
| 6 | **Deportes** | `SportsMatch` + `FootballMatch`, `MatchEvent`, `MatchStat`, `Lineup`, `Team` |
| 7 | Búsqueda | `SearchByName`, `GetSearchByContent`, `GetBlSearchByContent`, `Filter*` |
| 8 | Favoritos / suscripciones | `Get*Favorite`, `Get*Subscribe` |
| 9 | Mensajería | `MsgBox`, `QueryMsgNum`, `ReadMsg`, `DeleteMsg`, `pushMsg` |
| 10 | Feedback / soporte | `UserFeed`, `TypeQuestion`, `CustomerService` |
| 11 | Dispositivos | `GetDevices`, `UpdateDeviceToken`, `ForceBind`, `WaitConfirm` |
| 12 | Telemetría | `DataCollectApkPlay`, `ReportHardInfo`, `PlayErrorCollect`, `TopUser` |

El módulo deportivo, con estadísticas en vivo y alineaciones, distingue este
producto de un cliente VOD genérico.

---

## 5. Resolución de servidores

### 5.1 Cadena de descubrimiento

```
DomainInfo{domainType:int, first:String, second:String}
     │      el dominio se representa como dos componentes separados
     ▼
ServiceUrl{main_addr, service_name, spare_addr, tag}
     │      principal + respaldo
     ▼
Business{business_entry, details: ArrayList<URLInfo{host_alias,url}>}
     │      lista de failover resuelta por el servidor
     ▼
N1Random            selección aleatoria de host
```

### 5.2 Servicios

`assets/domain_test.json` declara trece servicios, cada uno con variante
principal y de respaldo:

```
upgrade · portal · epg · epg4b_sn · epg4b_data · market
diamond · notice · dccore · datacollect · ad
```

En la muestra **todos los valores son `"xx"`**: son marcadores de posición.
Las direcciones reales se resuelven en el arranque.

### 5.3 SLB / GSLB con token

`mobile.com.requestframe.utils.response.SlbInfo`:

```
main_slb_addr · main_slb_token · spared_slb_addr · spared_slb_token
dead_time_addr:int · rst_status:int · error_code:int
```

El bootstrap **no devuelve una dirección, sino una dirección más un token**,
con vigencia (`dead_time_addr`). El mismo patrón aparece en
`CdnListBeanResult` (17 campos), que implementa selección de CDN ponderada
(`weight`, `serial_number`, `main_addr`, `spared_addr`, `gslb_params`).

### 5.4 Activo propio identificado

| Host | Resolución | Observación |
|---|---|---|
| `xuper.pornboxhub.com` | 104.21.15.56 / 172.67.161.186 | Cloudflare. Único dominio propio literal en el APK |

Dominios referenciados por los SDK de terceros: `*.hpplay.cn`, `*.lebo.cn`,
`hpplay.cdn.cibn.cc`, más direcciones IP hardcoded de Alibaba Cloud
(`120.78.185.110`, `47.112.113.131`, `120.77.74.81`, …) pertenecientes al SDK
de cast.

Direcciones **sin resolución DNS** (referencias obsoletas en layouts de
actualización): `www.uniquetv.live`, `dwonload.youcine.net`. El dominio del
deep link `www.magis4K.com` **no está registrado**.

---

## 6. Protocolo reconstruido

Firma en `db.b2.i()`:

```java
String nonce   = b3.g.a();                 // 12 caracteres aleatorios [A-Za-z0-9]
String headers = new bb.b().f(map);        // "clave: valor\r\n" por entrada
String body    = new bb.c().d(obj);        // JSON plano (Gson)
ByteBuffer buf = b3.c.c(body);             // getBytes(UTF_8) -> allocateDirect

q8.p0.a().B/D(baseUrl, serviceName, method, '/' + uri,
              headers, buf, 60000, b3.j.b());
//                                        ^ timeout 60 s   ^ token
```

**No hay cifrado de cuerpo ni de cabeceras.** `b3.c.d()` se limita a
`String.getBytes(UTF_8)` y `ByteBuffer.allocateDirect`; la decodificación es
`new String(bytes, UTF_8)`. El único cifrado observado en el APK está en la
capa nativa (`SSLJniException`), no en el protocolo de aplicación.

### 6.1 Formato de petición

```
POST {dcsClientUrl}/{serviceName}/{method}/{uri}
Content-Type: application/json

{
  "userId", "userToken", "portalCode",              // BaseRequestParams
  "apkVersion", "appId", "appLanguage", "cpu",     // CommonParams
  "deviceToken", "hardwareInfo", "loginType",
  "model", "product", "reserve1", "sn", "sysVersion",
  ... campos del bean de la petición específica
}
```

### 6.2 Autenticación

```
GetAddrBean{sn, type:int, authCode, authVersion}
    → GetAddrResultData{dcsClientUrl, dcsClientUrlAlias, returnCode}

GetAuthInfoBean{portalCode, type, lang, userId, userToken}
    → AuthInfo{userName, productCode, productName, serviceType,
               effectTime, invalidTime, expInvalidTime}

SnTokenBean  → SnTokenData
```

`CommonParams` incluye huella de dispositivo (`sn`, `hardwareInfo`, `cpu`,
`model`). `expInvalidTime` y `hasPay` ditercian el estado de suscripción.

---

## 7. Modelo de datos

`AssetData` — 34 campos: identidad (`contentId`, `name`, `alias`),
personas (`director`, `actorDisplay`, `originalCountry`), contenido
(`description`, `keyWords`, `tags`), control de acceso (`restricted`,
`freeVersion`, `subsInfo`, `hasPositive`), interacción (`score`,
`favoriteId`, `subscribeId`), relaciones (`sameSeasonSeriesList`,
`simpleProgramList`).

Reproducción — matriz de variantes:

```
Movie{ quality, bitRateType, screenFormat, videoFormat, videoType,
       audioType, encodeFormat, licenseList: List<License> }
```

### 7.1 DRM

```
GetVodPlayUrlBean{ auth, license, media_code }
License{ license, tag }
```

La reproducción exige la adquisición previa de una licencia emitida por el
servidor. Es un control de acceso efectivo, no una Ofuscación superficial: sin
`license` válida no hay reproducción.

### 7.2 Failover y caducidad

`PlayInfo` expone siempre pares `idx_url`/`idx_url2` y
`media_url`/`media_url2`. `ShelveAddress` incorpora `urlInvalidTime`: las
direcciones de emisión están **firmadas y caducan**.

---

## 8. Observaciones de seguridad

| Hallazgo | Detalle |
|---|---|
| Tráfico en claro permitido | `android:usesCleartextTraffic="true"` |
| Almacenamiento externo legado | `requestLegacyExternalStorage="true"` |
| Permisos sensibles | `CAMERA`, `MANAGE_EXTERNAL_STORAGE`, `REQUEST_INSTALL_PACKAGES`, `GET_TASKS` |
| Integridad del APK | `assets/meta-data/{manifest.mf, rsa.pub, rsa.sig}` |
| Detección de entorno | `b3.j` expone cinco comprobaciones `boolean(Context)` —raíz, emulador, depuración |
| Ofuscación | ProGuard a nivel de clase; paquetes de terceros conservados |
| Huella de dispositivo | `sn`, `hardwareInfo`, `cpu`, `model` en toda petición |
| Directorio privado | `mobile.com.requestframe.*` invierte la convención de paquete Java |

`usesCleartextTraffic="true"` es notable: combinado con la ausencia de cifrado
en la capa de aplicación, cualquier URL servida por HTTP queda expuesta en
tránsito más allá del handshake TLS.

---

## 9. Indicadores

```
SHA-256 APK      3103a55e5f39fe474143496e5ebdfb5a2b2be924ab4cc51517b59b930a927290
SHA-256 APK (2)  94207f098290b86a53191530737f1bde1b7a6689af4c3c27b73f50716048bf0c
Paquete          com.msandroid.mobile
UMENG_APPKEY     68b903e0e563686f429a3a60
UMENG_MSG_SECRET 8cd8a8bfd892266a51cf9332e20381cd
AdMob            ca-app-pub-9843556922272883~3303824453
Google OAuth     18767524675-b07kvgssnv757te063qbqel15b48s0ig.apps.googleusercontent.com
Google Cast      magis-mobile-7abeb.appspot.com
Host propio      xuper.pornboxhub.com
```

---

## 10. Metodología

Herramienta: [REA](https://github.com/morluto/rea) `v6.4.0`, motor
`jadx-headless-mcp 0.7.1` (SHA-256 del artefacto verificado contra el
lanzamiento auditado; `source_revision 5844800a…`).

```
inspect_android_package        → identidad, manifiesto, inventario
search_android_classes         → localización de clases
inspect_android_class          → inventario de miembros
inspect_android_method         → descompilación
trace_android_references       → grafo de referencias entrantes
```

Un análisis de cadenas previo detectó la污染 por falsos positivos: una
expresión regular sobre bytes en crudo cruzaba los terminadores NUL entre
entradas distintas del *string pool* del DEX, inventando hosts inexistentes.
El lector autoritativo del *string pool* no los confirma. **Toda enumeración
de hosts de este informe procede de la resolución de referencias, no del
escaneo bruto.**

---

## 11. Limitaciones

- Análisis estático: no se observó ejecución, tráfico ni comportamiento.
- Las direcciones de backend son escenarios de servidor, no artefactos: no se
  observaron ni son reproducibles desde la muestra.
- `PBException` sugiere Protocol Buffers en parte del protocolo; la definición
  de esquema no se recuperó.
- El cifrado de la capa nativa (`SSLJniException`) no se evaluó: requiere
  análisis del binario `.so`.
- La lógica deLibraryde reproducción reside en `com.titan.ranger` (motor
  nativo, con `NativeJni`); su comportamiento no se reconstruyó.
- No seperformedó validación de firma: el proveedor declara
  `signature_verification: "not_performed"`.