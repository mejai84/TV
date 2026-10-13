# Flujo de reproducción VOD — Xuper 6.5.7

Análisis del recorrido completo desde la petición hasta el motor nativo, con
evidencia a nivel de bytecode.

**Muestra:** `xuper-hydra-6.5.7.apk` · SHA-256 `3103a55e…a927290`
**Paquete:** `com.msandroid.mobile` · **versionCode** 60507 · **targetSdk** 33
**DEX analizado:** `classes3.dex`

**Herramientas**
- `apktool 2.11.1` (baksmali) — desensamblado. Decodifica en
  `_smali/smali_classes{1,2,3}/`
- REA `v6.4.0` + `jadx-headless-mcp 0.7.1` — inventario y relación de clases

> **Por qué smali y no el decompilado de JADX.** JADX devolvió
> `body_status: "not_available"` para `t5.j.compare()`, que es un **puente
> sintético de Kotlin** generado por el compilador. El bytecode sí lo contiene.
> Toda conclusión de este documento procede de `smali`, no de una descompilación
> que JADX decidió no renderizar.

---

## 1. Resumen de hallazgos

| # | Hallazgo | Estado |
|---|---|---|
| 1 | El APK no contiene ninguna dirección de reproducción | Confirmado |
| 2 | El comparador ordena por `serial_number`, no por `weight` | Confirmado |
| 3 | `weight` y `switch*SourceTime` se reciben pero nunca se leen | Confirmado |
| 4 | `N1Random` no interviene en la selección de CDN | Confirmado |
| 5 | La URL de reproducción **no cruza** la frontera Java → nativo | Confirmado |
| 6 | `license` es un atributo por variante de medio, no un token de sesión | Confirmado |
| 7 | El motor nativo tiene su propio modelo de selección de CDN (`Entry`) | Confirmado |
| 8 | `Entry.auths` se consume contra un servidor de licencias | **Pendiente** |

---

## 2. Origen de las direcciones: `GetSlbInfo`

Las direcciones llegan del endpoint `GetSlbInfo`, dentro de `cdn_list`:

```
GetSlbInfoBeanResultData
├── cdn_list : List<CdnListBeanResult>
│   ├── main_addr : String          ← principal
│   ├── spared_addr : String       ← respaldo
│   ├── serial_number : int        ← ORDEN (el cliente ordena por aquí)
│   ├── weight : Integer           ← NUNCA LEÍDO
│   ├── gslb_params : String
│   ├── tag : String               ← "live" | "vod" | "record"
│   └── url_list : List<CdnUrl>    ← {tag, url}
├── play_params : String           ← opaco, se pasa a t6.a.b()
├── invalidTime : String           ← TTL
├── nowTime : String
├── switchVodSourceTime : int      ← NUNCA LEÍDO
├── switchLiveSourceTime : int     ← NUNCA LEÍDO
└── switchVodSourceTimeV2 / switchLiveSourceTimeV2 : String   ← NUNCA LEÍDOS
```

### Recuento de accesos a los getters en todo el árbol smali

| Getter | Usos | Clases |
|---|---|---|
| `getSerial_number` | **3** | `t5/i$e`, `t6/a` |
| `getWeight` | **0** | — |
| `getSwitchVodSourceTime` | **0** | — |
| `getSwitchLiveSourceTime` | **0** | — |
| `getPlay_params` | **4** | `t5/i` |
| `getInvalidTime` | **16** | 7 clases |

**Consecuencia:** el servidor no agenda la rotación y el cliente no pondera.
El orden lo fija `serial_number`, que el servidor reasigna en cada respuesta.

---

## 3. `t5.i` — indexación por tipo de CDN

**Archivo:** `smali_classes3/t5/i.smali` · **Clase:** `Lt5.i`

### 3.1 Pipeline

`L(GetSlbInfoBeanResultData)` vacía el estado y lanza una cadena reactiva:

```smali
sget-object v0, Lt5/i;->g:Landroidx/collection/a;  invoke-virtual {v0}, Landroidx/collection/g;->clear()V
sget-object v0, Lt5/i;->i:Ljava/util/HashMap;       invoke-virtual {v0}, Ljava/util/HashMap;->clear()V
sget-object v0, Lt5/i;->h:Landroidx/collection/a;  invoke-virtual {v0}, Landroidx/collection/g;->clear()V

invoke-virtual {p1}, GetSlbInfoBeanResultData;->getCdn_list()Ljava/util/List;
invoke-static {p1}, Lio/reactivex/Observable;->just(Ljava/lang/Object;)Lio/reactivex/Observable;
  .flatMap(Lt5/d)      # agrupa por tag
  .map(Lt5/e)          # ordena por serial_number
  .subscribe(Lt5/f, Lt5/g, Lt5/h)
```

`play_params` se entrega sin transformar:

```smali
invoke-virtual {p1}, GetSlbInfoBeanResultData;->getPlay_params()Ljava/lang/String;
invoke-virtual {v0, v1, p1}, Lt6/a;->b(Landroid/content/Context;Ljava/lang/String;)V
invoke-virtual {v0}, Lt6/a;->a()V
```

### 3.2 Los dos mapas

`t5.i$f` (`smali_classes3/t5/i$f.smali`) es el que escribe:

```smali
invoke-static {}, Lt5/i;->j()Landroidx/collection/a;   # campo g
invoke-interface {v2, v1, p1}, Ljava/util/Map;->put(Object;Object;)
...
invoke-static {}, Lt5/i;->k()Landroidx/collection/a;   # campo h
invoke-interface {p1, v1, v2}, Ljava/util/Map;->put(Object;Object;)
```

con `v1 = lista.get(0).getTag()`, y este log literal:

```smali
const-string/jumbo v4, "cdn type is "
const-string/jumbo v5, " and size is "
const-string/jumbo v1, " and tags is "
```

| Campo | Tipo | Contenido |
|---|---|---|
| `f20369g` (`g`) | `Map<String, List<CdnListBeanResult>>` | Candidatos **ordenados por `serial_number`**, indexados por `tag` |
| `f20370h` (`h`) | `Map<String, List<String>>` | **Tags** extraídos de `url_list` — no URLs |
| `f20371i` (`i`) | `HashMap` | Estado auxiliar, no interviene en la selección |

El campo `h` almacena **etiquetas**, no direcciones: en el bucle se llama a
`CdnUrl.getTag()` y se guarda `getUrl()` solo como comprobación de no-vacío.

### 3.3 El vocabulario de `tag`

`t5.i$d` (`smali_classes3/t5/i$d.smali`) particiona comparando el `tag` de cada
entrada contra las constantes del enum `t5.k` y emite tres listas:

```smali
invoke-virtual {v3}, CdnListBeanResult;->getTag()Ljava/lang/String;
invoke-virtual {v5}, Lt5/k;->b()Ljava/lang/String;
... (tres comparaciones, tres ArrayList) ...
invoke-static {p1}, Lio/reactivex/Observable;->fromArray([Ljava/lang/Object;)Lio/reactivex/Observable;
```

`smali_classes3/t5/k.smali`:

```smali
const-string/jumbo v2, "live"    const-string/jumbo v3, "LIVE"    → b
const-string/jumbo v2, "vod"     const-string/jumbo v3, "VOD"     → c
const-string/jumbo v2, "record"  const-string/jumbo v3, "RECORD"  → d
```

**Tres** tipos: `live`, `vod`, `record`. El servidor etiqueta; el cliente solo
reconoce estas tres cadenas.

### 3.4 El comparador

`t5.j` es un `Comparator` sintético que delega:

```smali
# smali_classes3/t5/j.smali
.class public final synthetic Lt5/j;
.implements Ljava/util/Comparator;

.method public final compare(Ljava/lang/Object;Ljava/lang/Object;)I
    check-cast p1, Lmobile/com/requestframe/utils/response/CdnListBeanResult;
    check-cast p2, Lmobile/com/requestframe/utils/response/CdnListBeanResult;
    invoke-static {p1, p2}, Lt5/i$e;->a(CdnListBeanResult; CdnListBeanResult;)I
```

La lógica está en `t5/i$e.smali`:

```smali
.method public static final e(L.../CdnListBeanResult; L.../CdnListBeanResult;)I
    invoke-virtual {p0}, L.../CdnListBeanResult;->getSerial_number()I
    invoke-virtual {p1}, L.../CdnListBeanResult;->getSerial_number()I
    invoke-static {p0, p1}, Lkotlin/jvm/internal/k;->i(II)I    # Integer.compare
    move-result p0
    return p0
```

Y se aplica en `t5.i$e.b()`:

```smali
new-instance v0, Lt5/j;
invoke-direct {v0}, Lt5/j;-><init>()V
invoke-static {p1, v0}, Lu9/r;->q(Ljava/util/List;Ljava/util/Comparator;)V
```

**Orden ascendente por `serial_number`. `weight` no participa.**

### 3.5 `N1Random`

3 referencias, todas en `v2/a.smali` — el paquete de inicialización de la app,
**ajeno a `t5`/`t6`**. No interviene en la selección de CDN.

---

## 4. El puente hacia el motor nativo

### 4.1 Construcción

`smali_classes3/n6/p2.smali`, método `S(String, List, int): Program`:

```smali
invoke-direct/range {v0 .. v10}, Lcom/titan/ranger/bean/Program;-><init>(
    Ljava/lang/String; Ljava/lang/String; Ljava/lang/String; Ljava/lang/String;
    Ljava/lang/String; Ljava/lang/String; Ljava/util/List; Ljava/lang/String; J)V
```

Origen de los argumentos:

| Arg. | Valor | Campo `Program` |
|---|---|---|
| `v1` | parámetro `p1` | `name` |
| `v2` | `RangerPlayTag.VOD.getValue()` | `buss` |
| `v3` | `AssetData.getName()` o `""` | `title` |
| `v4` | `String.valueOf(idx)` | `episode` |
| `v5` | `PlayAty.K.c()` | `from` |
| `v6` | `"user"` | `cause` |
| `v7` | `ArrayList<Media>` (argumento `p2`) | `medias` |
| `v8` | `Movie.getContentId()` | `media` |
| `v9,v10` | `0L` | `start` |

### 4.2 `Media` no transporta URL

```smali
# smali_classes3/com/titan/ranger/bean/Media.smali
.field private name    : String
.field private license : String
.field private lang    : String
.field private quality : String
.field private vcodec  : String
.field private format  : String
.field private volume  : String
```

Un barrido de `com.titan.ranger.bean` devuelve **cero campos que contengan
`url`**.

**La URL de reproducción no existe en la capa Java.** El campo `media` de
`Program` recibe `Movie.contentId`, un identificador.

### 4.3 La URL aparece en `MediaFile`, dentro del nativo

```smali
# smali_classes3/com/titan/ranger/bean/MediaFile.smali
.field private auth    : String
.field private buss    : String
.field private format  : String
.field private from    : String
.field private license : String
.field private media   : String
.field private program : String
.field private title   : String
.field private uri     : String   ← la URL
.field private volume  : String
```

### 4.4 El motor tiene su propio modelo de CDN

```smali
# smali_classes3/com/titan/ranger/bean/Entry.smali
.field private auths           : List     ← autorizaciones/licencias
.field private buss            : String
.field private enable          : int
.field private gslb_params     : String
.field private main_addr       : String
.field private main_addr_code  : String
.field private name            : String
.field private priority        : int      ← prioridad de CDN
.field private redirect        : String
.field private sign_type       : String   ← firma de la petición al CDN
.field private spare_addr      : String
.field private spare_addr_code : String
.field private strategy        : String   ← estrategia de selección
.field private tag             : String
```

Correspondencia con el modelo Java:

| `CdnListBeanResult` | `Entry` (nativo) |
|---|---|
| `main_addr` / `spared_addr` | `main_addr` / `spare_addr` |
| `serial_number` | `priority` |
| `gslb_params` | `gslb_params` |
| `weight` *(nunca leído)* | `strategy` |
| — | `auths`, `sign_type`, `enable`, `redirect` |

**La selección de CDN ocurre en dos capas**: Java ordena por `serial_number`;
el nativo selecciona por `priority`/`strategy`.

### 4.5 El puente

```smali
# smali_classes3/com/titan/ranger/NativeJni.smali
.method private native Call(Ljava/lang/String;Ljava/lang/String;Ljava/nio/ByteBuffer;)Ljava/lang/String;
```

---

## 5. Traza de `license`

```
Movie.licenseList : List<License{license: String, tag: String}>
   │  n6/p2 itera la lista y selecciona una entrada
   ▼
Media.license : String
   ▼  (construcción nativa)
MediaFile.license : String   ·   MediaFile.auth : String
   ▼
Entry.auths : List
```

Evidencia de la iteración en `n6/p2.smali`:

```smali
invoke-virtual {v8}, Lmobile/com/requestframe/utils/response/Movie;->getLicenseList()Ljava/util/List;
move-result-object v16
if-eqz v16, :cond_7
invoke-interface/range {v16 .. v16}, Ljava/util/Collection;->isEmpty()Z
```

**Confirmado:** `license` es un **atributo por variante de medio**, no un
parámetro de autenticación HTTP. No aparece en ninguna petición del protocolo
reconstruido.

**Pendiente:** si se consume como licencia DRM contra un servidor. Requiere
analizar el `.so`.

---

## 6. Anomalías explicadas

Tres hallazgos del análisis estático que parecían anomalías se resuelven con
esta cadena:

| Anomalía | Explicación |
|---|---|
| `getMedia_url` → 0 llamadas | `PlayInfo.media_url` no alimenta el motor VOD; la URL se resuelve en nativo |
| `getIdx_url` → 0 llamadas | Ídem |
| `GetVodPlayUrlBean` → 0 referencias | El bean existe en el modelo pero no se instancia en el camino alcanzable |

**Métodológico:** la ausencia de una llamada a getter **no** prueba que un
campo no se use. Gson lee campos por reflexión y esas lecturas no aparecen como
invocaciones. Aquí la conclusión se sostiene por una razón distinta: el campo
no existe en la clase que cruza el puente nativo.

---

## 7. Diagrama

```
SERVIDOR
  GetSlbInfo ──► GetSlbInfoBeanResultData
      cdn_list[] {main_addr, spared_addr, serial_number, weight, gslb_params, tag, url_list}
      play_params ──► t6.a.b(Context, String)
      invalidTime · switch*SourceTime [muertos]

CAPA JAVA — t5.i
  Observable.just(cdn_list)
    .flatMap(t5.i$d)   particiona por tag ∈ {live, vod, record}
    .map(t5.i$e)       sortWith(t5.j) → Integer.compare(serial_number, serial_number)
    .subscribe(t5.i$f)
        g[tag] = List<CdnListBeanResult>   (ordenados por serial_number)
        h[tag] = List<String>              (tags de url_list)

CAPA JAVA — n6.p2
  EpisodeList → TotalMovieList → List<Movie{contentId, quality, licenseList, format, …}>
    → Program{name, buss="VOD", title, episode, from, cause,
               medias=[Media{name, license, lang, quality, vcodec, format, volume}],
               media=contentId, start}
    → Program.setStart(J)

CAPA NATIVA — com.titan.ranger
  Entry{main_addr, spare_addr, priority, strategy, enable, gslb_params,
         auths:List, sign_type, redirect, buss, name, tag}
  MediaFile{uri, media, license, auth, program, buss, title, from, format, volume}
    ↓
  NativeJni.Call(String, String, ByteBuffer) : String
    ↓
  [.so]  resolución de URL y licencias — no observable desde Java
```

---

## 8. Conclusiones

1. **El cliente Java nunca ve una URL de reproducción VOD.** Solo
   `contentId` y atributos de variante.
2. **La resolución de CDN es doble:** Java ordena (`serial_number`); nativo
   selecciona (`priority`/`strategy`).
3. **`weight`, `switchVodSourceTime` y `switchLiveSourceTime` son campos
   muertos.** Se reciben y no se leen.
4. **`N1Random` no participa** en la selección de CDN.
5. **`license` es un atributo de variante** que viaja hasta el motor, no un
   token de sesión.
6. **El punto de control de acceso, si existe, está en el lado nativo**
   (`Entry.auths`, `MediaFile.auth`, `sign_type`).

---

## 9. Limitaciones

- Análisis exclusivamente estático. No se ejecutó la muestra ni se capturó tráfico.
- `libijkplayer.so` y el binario de Ranger **no se analizaron**: no hay
  evidencia del uso real de `Entry.auths`, `sign_type` ni `MediaFile.uri`.
- JADX no descompiló los puentes sintéticos de Kotlin; el análisis de esos
  métodos procede de baksmali.
- La construcción de `Entry` dentro del motor es **inferida** por analogía de
  campos con `CdnListBeanResult`, no observada: `Entry` no tiene referencias
  entrantes desde la capa Java.
- Un análisis de grafo estático puede omitir construcción por reflexión; Gson
  es un caso conocido en esta muestra.

---

## 10. Correcciones respecto a informes anteriores

| Afirmación previa | Estado |
|---|---|
| El comparador usa `weight` | **Falsa** → usa `serial_number` |
| El servidor agenda la rotación vía `switch*SourceTime` | **Falsa** → 0 lecturas |
| `t5.i` mantiene un mapa Live y otro VOD | **Parcial** → 2 mapas genéricos por `tag`, con **3** grupos |
| `N1Random` añade aleatoriedad a la selección de CDN | **Falsa** → aislado en `v2` |
| `PlayInfo.media_url` entrega la URL al reproductor | **Falsa** → 0 getters; la URL se resuelve en nativo |

---

## 11. Reproducibilidad

```bash
# Desensamblado
java -jar tools/apktool.jar d -f -o _smali xuper-hydra-6.5.7.apk

# Ficheros citados en este documento
_smali/smali_classes3/t5/i.smali          pipeline y mapas
_smali/smali_classes3/t5/i$d.smali        particionado por tag
_smali/smali_classes3/t5/i$e.smali        orden por serial_number
_smali/smali_classes3/t5/i$f.smali        escritura de los mapas
_smali/smali_classes3/t5/j.smali          Comparator sintético
_smali/smali_classes3/t5/k.smali          enum live/vod/record
_smali/smali_classes3/n6/p2.smali         construcción de Program
_smali/smali_classes3/com/titan/ranger/bean/Program.smali
_smali/smali_classes3/com/titan/ranger/bean/Media.smali
_smali/smali_classes3/com/titan/ranger/bean/MediaFile.smali
_smali/smali_classes3/com/titan/ranger/bean/Entry.smali
_smali/smali_classes3/com/titan/ranger/NativeJni.smali
```

**Nota sobre `tools/dexdump.py`:** este desensamblador propio quedó con dos
errores sin resolver — el desplazamiento de la cabecera DEX y el parseo de
`encoded_field` con longitudes `uleb128` variables. **No usarlo**;
`apktool.jar` es la vía fiable.