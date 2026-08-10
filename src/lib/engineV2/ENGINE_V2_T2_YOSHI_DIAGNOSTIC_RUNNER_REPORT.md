# T2 — Harness diagnóstico local Yoshi mediante T1

Fecha de implementación: 2026-08-10.

## Resultado

T2 implementa un harness interno y exclusivamente de desarrollo para preparar la primera ejecución real de `YOSHI-FUENTE-ORIGINAL.jpeg` mediante el conector T1. La implementación no ejecutó Yoshi, no inició Vite/Base44, no hizo llamadas remotas y no creó EMB, DST, DSB, ZIP ni ningún artefacto binario.

La rama de trabajo es `engine-v2-yoshi-t2-diagnostic-runner` y conserva como HEAD base `e0e3f0f629ea3a8f009013b04128a387f7473332`. El flag global `experimentalEngineV2RasterObservation` permanece literalmente en `false`; la activación `true` se entrega únicamente como cuarto argumento de una ejecución manual T2.

## Superficie y aislamiento

El panel se integra en `EngineV2DiagnosticLab` sin añadir rutas. Hereda su autenticación y el guard de rol administrador. Se declara mediante `React.lazy` dentro de una condición `import.meta.env.DEV` y solo se renderiza en la pestaña de inspección cuando esa condición es verdadera.

El build de producción no emitió un chunk T2/Yoshi. No se modificaron `App.jsx`, Editor, el runner, T1, Engine V2, Base44, CE01, exportadores, encoders ni superficies binarias.

El panel:

- admite un único archivo `image/jpeg`;
- rechaza selección ausente o múltiple y, por contrato de nombre/tipo, ZIP, EMB, DST y DSB;
- valida antes de habilitar la ejecución el nombre, 31.496 bytes, 360 × 482 px y SHA-256 `066F5629D48AA4D62E8B2D3EDF57B499B4438381653AAA156FBCE2EDD23D7827`;
- obtiene las dimensiones con `createImageBitmap(file)`, sin crear una object URL;
- expone el botón explícito `Ejecutar T2` solo tras acreditar el archivo;
- usa un gate de ejecución para impedir doble clic y concurrencia;
- no reintenta automáticamente;
- muestra las nueve etapas literales del pipeline heredado;
- muestra el código gobernante exacto cuando T1 o T2 bloquean;
- no habilita descargas si falla una condición.

## Configuración contractual

La configuración inmutable y literal es:

```js
{
  mode: 'hybrid',
  width_mm: 83.4,
  height_mm: 114.3,
  color_count: 8,
  fabric_type: 'Algodón',
  remove_bg: false,
  contourSafeMode: true,
  useVectorFusion: false,
  experimentalDetailPreservation: false,
  experimentalOutlineGenerator: false,
  tatami_density: 0.4,
  machine_speed: 800
}
```

La única llamada de ejecución prevista es:

```js
runExperimentalRasterEngineV2Connector(
  imageObjectUrl,
  YOSHI_T2_PIPELINE_CONFIG,
  { onProgress },
  true,
)
```

La object URL de entrada se crea únicamente dentro del bloque de ejecución y se intenta revocar siempre en `finally`. El resultado legacy sigue gobernando. Solo después de un T1 `completed` se reejecuta `adaptLegacyRasterPipelineResultToEngineV2Input(observation.legacyResult)`, y su única salida publicada es `sourceRegions`.

No se llama a entidades, almacenamiento, persistencia, endpoints de resultados ni funciones de descarga productivas. Las únicas operaciones remotas posibles en la futura ejecución manual son las ya contenidas en las etapas legacy híbridas.

## Condiciones de éxito y bloqueo

Antes de construir artefactos, T2 exige conjuntamente:

1. las nueve etapas legacy presentes, únicas y con `ok: true`;
2. regiones legacy no vacías;
3. T1 solicitado y en estado `completed`;
4. Engine V2 con `valid: true`;
5. `documentValidation.valid: true`;
6. comandos canónicos no vacíos y por identidad iguales a `document.commands`;
7. métricas y trazas presentes;
8. regiones adaptadas no vacías;
9. gobierno literal `legacy`;
10. metadata de frontera T1 presente con `machineAdaptationApplied`, `encodingApplied` y `binaryArtifactCreated` literalmente en `false`, más `dstArtifactCount` y `dsbArtifactCount` finitos y literalmente en `0`; resultado y documento Engine V2 conservan y exigen sus tres booleanos propios;
11. ausencia de buffers, typed arrays, Blob, formatos DST/DSB, URLs externas/locales/de descarga, contadores o señales binarias en las superficies T1/V2 publicables;
12. serialización determinista completa.

Un estado T1 `blocked` o `failed` conserva su `reasonCode` como código gobernante. Cualquier excepción queda capturada por código y no se propaga. Un bloqueo devuelve `artifacts: null`; el adaptador no se reejecuta si T1 no completó.

## Artefactos de texto en memoria

Tras validar todo se construyen, en este orden:

1. `yoshi-t2-legacy-summary.json`;
2. `yoshi-t2-source-regions.json`;
3. `yoshi-t2-engine-v2-document.json`;
4. `yoshi-t2-canonical-commands.json`;
5. `yoshi-t2-metrics.json`;
6. `yoshi-t2-traces.json`;
7. `yoshi-t2-vs-r02-comparison.md`;
8. `MANIFEST_SHA256.txt`.

Los seis JSON usan orden canónico de propiedades, indentación de dos espacios y LF final. Markdown y manifest usan LF canónico. El manifest contiene SHA-256 mayúsculo de los siete artefactos de contenido; no se incluye a sí mismo.

La construcción usa listas blancas para el resumen legacy y rechaza campos sensibles o temporales en las superficies V2. No publica `imageUrl`, object URLs, Blob de preprocesado, tiempos, tokens, credenciales, usuarios ni sesiones. Una estructura no serializable, cíclica o binaria bloquea la construcción completa.

Las descargas son individuales y exclusivamente textuales. Cada clic crea un Blob local después de la validación, activa un enlace desprendido y revoca inmediatamente su object URL. No existe descarga agrupada ni ZIP y no se escribe en el repositorio.

## Referencia profesional R02

La comparación fija únicamente como referencias diagnósticas:

- 18.145 puntadas EMB;
- 18.139 puntadas DST;
- 26 objetos nativos;
- 6 colores;
- 7 bloques;
- orden verde, blanco, naranja, rojo, naranja, amarillo, negro.

El informe generado indica expresamente que comandos canónicos, objetos V2, hilos V2 y bloques de hilo V2 no acreditan por sí solos equivalencia con puntadas, objetos, colores o bloques profesionales. T2 no afirma equivalencia física, calidad ni mejora de bordado.

## Pruebas T2

La prueba focalizada contiene 43 casos y usa contextos de harness controlados. No procesa el JPEG Yoshi ni acredita una generación real.

La cobertura incluye:

- contrato literal de archivo y configuración;
- rechazo de selección múltiple;
- inspección SHA/dimensiones sin object URL y cierre del bitmap;
- las nueve etapas presentes, únicas y correctas;
- etapa ausente, duplicada o fallida;
- regiones legacy o adaptadas vacías;
- T1 `blocked` y `failed` con código exacto;
- resultado o documento inválido;
- comandos vacíos o separados del documento;
- métricas o trazas ausentes;
- metadata incompatible en las tres superficies;
- señales DST, payload binario y URL de descarga;
- serialización, LF y determinismo;
- exclusión de URL, tiempos y datos sensibles;
- manifest SHA-256 independiente;
- constantes y limitación R02;
- flag global OFF;
- conservación por identidad del resultado legacy entregado al adaptador;
- gate contra ejecución concurrente;
- revocación de object URL en éxito, bloqueo y excepción;
- cero trabajo de descarga ante fallo;
- Blob textual y revocación inmediata tras éxito.

## Puertas ejecutadas

Entorno: Vitest `v4.1.10`, Vite `v6.4.1`.

Resultados finales efectivos:

| Puerta | Resultado final |
| --- | --- |
| T2 focalizada | 1/1 suites, 43/43 pruebas, 0 fallos |
| T1 + T2 | 2/2 suites, 220/220 pruebas, 0 fallos |
| Bridge/pipeline relacionada, un worker | 5/5 suites, 244/244 pruebas, 0 fallos |
| Engine V2 completa, un worker | 22/22 suites, 1.064/1.064 pruebas, 0 fallos |
| ESLint focalizado | código 0 |
| Imports del alcance | 19/19 resueltos |
| `git diff --check` | código 0 |
| Build de producción | código 0; 2.163 módulos; 18,26 s |

Incidentes no gobernantes registrados:

- el primer intento focalizado quedó antes de cargar Vitest con `spawn EPERM`: 0 suites y 0 pruebas; se ejecutó fuera del sandbox;
- la primera carga focalizada ejecutó 43 casos y detectó que el dato negativo de SHA repetía accidentalmente el primer carácter real: 42/43; se corrigió exclusivamente el fixture negativo;
- una invocación posterior agotó 120 s antes del banner de Vitest y dejó procesos auxiliares huérfanos, que fueron identificados y cerrados; 0 suites y 0 pruebas acreditables;
- una ejecución paralela T1+T2 obtuvo 219/220 por timeout de una prueba T1; el comando idéntico posterior obtuvo 220/220;
- una ejecución relacionada paralela obtuvo 240/244 por cuatro timeouts de fixtures protegidos; la misma selección con un worker, sin alterar código ni timeouts, obtuvo 244/244.

## T2-R1 — correcciones de auditoría

T2-R1 corrige los hallazgos de la auditoría final sin modificar `EngineV2DiagnosticLab.jsx`, T1, el runner legacy, Engine V2, Base44, CE01, encoders ni exportadores. El SHA-256 de `EngineV2DiagnosticLab.jsx` antes de R1 era `474D5DE6B6C0B71D3CE4DCC40D2FD891E3A4EE50FD46B76F194278C1AFAD30A2`; la puerta final debe conservar exactamente ese valor.

### Ciclo de vida e invalidación de UI

El panel real incorpora referencias explícitas de montaje, token de inspección, token de ejecución, gate síncrono de UI, gate contractual del helper, resultado descargable y object URL activa. El cleanup de `useEffect`:

- marca el componente como desmontado;
- invalida inspecciones y ejecuciones pendientes;
- limpia gates y referencias descargables;
- revoca inmediatamente la object URL activa;
- deja el controlador local en estado dispuesto para que el `finally` posterior sea idempotente;
- no llama a `setState`.

Cada callback asíncrono comprueba montaje y token vigente antes de actualizar selección, progreso, resultado o estado de ejecución. Una selección A que resuelva después de B no puede gobernar. Seleccionar de nuevo elimina inmediatamente los artefactos anteriores.

Esta invalidación es exclusivamente de UI y recursos locales. `runPipeline` no expone en este contrato un `AbortSignal`; por ello T2-R1 no afirma cancelarlo. El conector puede terminar en segundo plano después del desmontaje, pero su resolución o rechazo ya no actualiza la UI y su intento posterior de revocación es un no-op seguro.

### Validación JPEG reforzada

Además del nombre, MIME declarado, 31.496 bytes, dimensiones y SHA-256 exacto, la inspección local exige:

- inicio `FF D8 FF`;
- terminación `FF D9`;
- coincidencia entre bytes leídos y `file.size`.

La firma se comprueba antes del hash y del decoder. Un PNG renombrado, bytes arbitrarios o un JPEG sin EOI se bloquean sin crear object URL. El SHA exacto sigue siendo la identidad gobernante del archivo; la firma JPEG es una defensa adicional independiente de `file.type`.

### Artefactos, secretos y URLs

Las claves se normalizan a minúsculas eliminando separadores. Por ejemplo, `api_key`, `access-token`, `clientSecret` y `base44Url` se convierten respectivamente en `apikey`, `accesstoken`, `clientsecret` y `base44url`. Se bloquean claves de autenticación, tokens, cookies, usuarios, sesiones, API keys, secretos, claves privadas e identificadores/URLs Base44.

También se bloquean valores `blob:`, `file:`, `http://`, `https://` y dominios Base44 aunque aparezcan bajo una clave inocua. `diagnostic.metadata` y `diagnostic.source` se inspeccionan junto con resultado, documento, comandos, métricas y trazas; un contador DST/DSB no nulo bloquea la ejecución.

### Readaptación contractual

La readaptación posterior usa `adaptLegacyRasterPipelineResultToEngineV2Input(observation.legacyResult)` una sola vez. Antes de construir artefactos se contrastan:

- `coordinateContract`, metadata y provenance observados por T1 frente a la readaptación;
- número y orden de regiones;
- ID, color, geometría, huecos, rol semántico, visibilidad y evidencia admitida frente al documento Engine V2;
- la transformación contractual real de puntos `[x, y]` a `{x, y}`.

Una discrepancia de metadata/provenance de readaptación devuelve `T2_ADAPTATION_SOURCE_MISMATCH`; cualquier divergencia acreditada entre contrato de coordenadas, source regions y documento devuelve `T2_SOURCE_REGIONS_DOCUMENT_MISMATCH`. En ambos casos queda `artifacts: null`. Una prueba usa el adaptador T1 y `runExperimentalEngineV2Bridge` reales para acreditar esta comparación sin ejecutar `runPipeline` ni Yoshi.

### Comparación R02 y anisotropía

Las métricas ausentes o no enteras se publican como `no comparable`; nunca como `undefined`. Los objetos V2 también quedan marcados sin equivalencia profesional acreditada.

Las dimensiones solicitadas no conservan exactamente la relación de aspecto del JPEG: 83,4/360 = 0,23167 mm/px y 114,3/482 = 0,23714 mm/px. La diferencia de escala entre ejes es aproximadamente 2,36 %. T2-R1 documenta esta posible anisotropía, pero no afirma su efecto físico porque Yoshi no se ha ejecutado.

### Pruebas React reales

Durante R1 el proyecto no tenía instalados Testing Library, jsdom, happy-dom ni react-test-renderer. Aquella cobertura usó `react-dom/client`, `React.act` y un DOM mínimo; T2-R2 la sustituye íntegramente por jsdom real, como se documenta más abajo.

Los casos React cubren:

- render con dependencias válidas;
- selección válida e inválida;
- doble clic y botón bloqueado;
- progreso del conector simulado;
- unmount durante inspección;
- unmount durante resolución y rechazo pendientes;
- revocación inmediata e idempotente de la URL;
- carrera A → B;
- eliminación de artefactos al seleccionar de nuevo;
- ausencia de descargas en `blocked` y `failed`;
- exactamente ocho descargas tras `completed`.

Los tests de descarga del helper acreditan además que un fallo parcial revoca cualquier URL local creada. Estas pruebas renderizan el panel React real, pero el conector está simulado salvo en la prueba separada del adaptador/bridge; no afirman ejecutar `runPipeline`.

### Puertas T2-R1

Entorno: Vitest `v4.1.10`.

| Puerta | Resultado T2-R1 |
| --- | --- |
| T2 focalizada, helpers + contrato real + panel React | 1/1 suites, 73/73 pruebas, 0 fallos |
| T1 + T2 | 2/2 suites, 250/250 pruebas, 0 fallos |
| Engine V2 completa, un worker | 22/22 suites, 1.094/1.094 pruebas, 0 fallos |
| ESLint focalizado | código 0 |

No se reejecutó el build productivo porque la orden R1 prohíbe ejecutar Vite. El build de 2.163 módulos y la ausencia de chunk T2 de la sección inicial permanecen como evidencia histórica de T2, no como una puerta revalidada por R1.

## T2-R2 — correcciones de segunda auditoría

T2-R2 corrige íntegramente los hallazgos acreditados por la segunda auditoría dentro del alcance autorizado. `EngineV2DiagnosticLab.jsx` no se editó y conserva SHA-256 `474D5DE6B6C0B71D3CE4DCC40D2FD891E3A4EE50FD46B76F194278C1AFAD30A2`.

### Código contractual y metadata descriptor-safe

El único código de divergencia entre contrato de coordenadas, source regions y documento es ahora `T2_SOURCE_REGIONS_DOCUMENT_MISMATCH`. El código anterior se eliminó de implementación, pruebas e informe.

La metadata de frontera T1 exige cinco propiedades propias de datos:

```js
machineAdaptationApplied === false
encodingApplied === false
binaryArtifactCreated === false
dstArtifactCount === 0
dsbArtifactCount === 0
```

Los descriptores se consultan con `Object.getOwnPropertyDescriptor`; no se lee ningún valor mediante acceso ordinario. La ausencia de una propiedad, un accessor, tipo distinto, contador no finito, proxy revocado o valor diferente bloquea con `T2_BINARY_METADATA_INVALID`. El resultado y el documento Engine V2 no conservan contadores DST/DSB en su `PIPELINE_METADATA`; no se inventan. En esas dos superficies se exigen descriptor-safe los tres booleanos que sí preserva su contrato, mientras los contadores gobernantes se exigen en la metadata T1.

Los campos adicionales siguen sometidos a inspección recursiva por descriptores. Encoder invocado, URL de descarga, `ArrayBuffer`, `Blob` o typed array bloquean antes de construir artefactos. Las pruebas de cada fallo verifican además que el helper de descarga realiza cero trabajo.

### URLs y claves sensibles

La normalización elimina separadores y diferencia de caso. Reconoce literalmente `appbaseurl`, `serverurl`, `uploadurl`, `downloadurl` y `objecturl`, incluidas sus formas camelCase, snake_case, kebab-case, mayúsculas y con espacios. La inspección cubre arrays, metadata, `stageLog`, documento, comandos, métricas, trazas, procedencia y source regions.

Los valores con esquemas `http:`, `https:`, `blob:`, `file:`, `data:` y `javascript:` se bloquean sin distinguir caso y aunque tengan espacios iniciales. La detección de `data:` exige límite de palabra para no confundir texto ordinario como `metadata:`. Claves legítimas como `user_defined_color`, `normalizedToken` y reason codes inocuos permanecen admitidas; no se bloquea por una subcadena genérica `user` o `token`.

### Coherencia source/document y dimensiones

Los negativos aislados cubren ID, orden, color, punto exterior, hueco, región adicional/ausente, source ID, visibilidad, rol, evidencia, coordinate space y dimensiones. Todos devuelven literalmente `T2_SOURCE_REGIONS_DOCUMENT_MISMATCH`, con cero artefactos y cero descargas.

El documento Engine V2 conserva de manera contrastable:

- `regions[].source.coordinateSpace`;
- `regions[].source.originalSource.sourceWidthPx` y `sourceHeightPx` dentro de la procedencia copiada;
- ID, orden, color, geometría, huecos, rol, source ID, visibilidad y `originalSource`.

El documento no conserva `designWidthMm` ni `designHeightMm`. Esas dimensiones no se declaran como comparación documental independiente: se contrastan entre `diagnostic.source.coordinateContract`, capturado por T1, y la readaptación posterior independiente. Esta limitación está expresamente documentada y no se añade ningún campo ficticio al documento.

### Markdown R02

`yoshi-t2-vs-r02-comparison.md` incluye literalmente:

- JPEG: 360 × 482 px;
- objetivo: 83,4 × 114,3 mm;
- escala horizontal aproximada: 0,23167 mm/px;
- escala vertical aproximada: 0,23714 mm/px;
- diferencia aproximada: 2,36%;
- la medida objetivo reproduce la referencia profesional R02;
- la diferencia no se atribuye automáticamente a un defecto del motor;
- comandos canónicos no equivalen automáticamente a puntadas DST.

Una prueba compara el bloque literal generado.

### Lifecycle y jsdom real

La creación de la object URL comprueba montaje y disposición antes de llamar a `URL.createObjectURL`; conserva además la comprobación posterior y la revocación defensiva para una disposición síncrona durante esa llamada.

`jsdom` no estaba resoluble al inicio de R2. Se ejecutó una sola vez la instalación autorizada `npm install --save-dev jsdom`, que resolvió `jsdom@30.0.1` sobre Node `v24.18.0`. Delta controlado:

- `package.json`: una línea, `"jsdom": "^30.0.1"` en `devDependencies`;
- `package-lock.json`: 540 líneas añadidas, 0 eliminadas y 38 entradas `node_modules` directas/transitivas añadidas;
- ninguna otra dependencia directa se añadió o cambió deliberadamente.

La instalación informó 21 hallazgos de auditoría npm ya fuera del objetivo de esta corrección; no se ejecutó `npm audit fix` ni se alteraron otras dependencias.

La nueva suite `yoshiT2RunnerPanel.test.jsx` declara `// @vitest-environment jsdom` y usa `react-dom/client`, `React.act`, `document`, `Event`, `HTMLInputElement` y nodos DOM reales. El simulador Mini DOM de R1 fue eliminado. Como la configuración autorizada existente descubre `*.test.js`, la suite contractual principal también declara el entorno jsdom e importa el archivo JSX; así el gate Engine V2 existente ejecuta ambas coberturas sin modificar `vitest.engine-v2.config.js`.

Los casos jsdom acreditan render, selección válida/inválida, doble clic en el mismo tick, progreso, carrera A → B, limpieza de artefactos, resultados bloqueados/fallidos, ocho descargas tras éxito, resolución/rechazo tardíos sin actualización React, revocación exactamente una vez y rechazo de una creación URL diferida después del unmount antes de invocar la API subyacente.

### Puertas T2-R2

Entorno: Vitest `v4.1.10`, jsdom `v30.0.1`, Node `v24.18.0`.

| Puerta | Resultado T2-R2 |
| --- | --- |
| T2 focalizada, contrato + helpers + jsdom real | 1/1 suites, 136/136 pruebas, 0 fallos, 0 omitidas |
| T1 + T2 | 2/2 suites, 313/313 pruebas, 0 fallos |
| Engine V2 completa, un worker | 22/22 suites, 1.157/1.157 pruebas, 0 fallos |
| ESLint focalizado, incluidos ambos tests T2 | código 0 |

Incidentes no gobernantes de R2:

- el primer intento focal quedó antes de cargar Vitest por `spawn EPERM`: 0 suites y 0 pruebas;
- la primera repetición fuera del sandbox agotó el timeout del worker `forks`: 0 suites y 0 pruebas;
- la primera ejecución efectiva con pool de hilos obtuvo 122/148 y expuso cuatro correcciones locales: import clásico JSX, conflicto del Mini DOM heredado, expectativa del nuevo gate de metadata y proyección de `coordinateSpace`;
- una sonda intermedia del Mini DOM heredado obtuvo 137/148; se eliminó por completo ese simulador en vez de omitirlo;
- las repeticiones finales limpias obtuvieron 136/136, 313/313 y 1.157/1.157.

No se reejecutó build, Vite, Base44, la aplicación interactiva ni Yoshi por prohibición expresa de R2.

## T2-R3 — cierre de los cuatro hallazgos de auditoría final

T2-R3 se limita a los cuatro hallazgos acreditados por la auditoría final. No cambia el contrato funcional de los artefactos ni amplía el alcance a otros archivos.

### Restauración exacta del entorno React act

La suite jsdom captura antes de configurar las pruebas el descriptor propio completo de `globalThis.IS_REACT_ACT_ENVIRONMENT` y distingue expresamente una propiedad ausente de una propiedad existente. El hook `afterAll` restaura con `Object.defineProperty` el descriptor original completo —valor, `writable`, `enumerable`, `configurable`, getter y setter— o elimina la propiedad cuando inicialmente no existía. La instalación y restauración rechazan los casos no configurables que no puedan tratarse con seguridad; la restauración permanece registrada aunque falle un test.

### Guardia asíncrona real y lifecycle

El panel exporta y usa en producción la única guardia central `commitIfCurrent(mountedRef, tokenRef, expectedToken, commit)`. Los commits posteriores a callbacks o esperas asíncronas pasan por ella; la inyección de test `commitState` envuelve únicamente el commit ya autorizado y no puede eludir la comprobación de montaje/token.

La cobertura jsdom real añade:

- progreso retenido e invocado después del unmount, sin excepción, sin alcanzar el commit/setter instrumentado, sin reaparición de DOM ni descarga y con la URL revocada;
- limpieza repetida e idempotente, incluida la revocación exactamente una vez;
- una segunda ejecución secuencial completa, que vuelve a producir sus ocho descargas.

### Negativos JPEG y ausencia de trabajo remoto

La suite contractual añade un JPEG truncado con cabeceras válidas y tamaño inválido, además de rechazos independientes de `arrayBuffer`, digest criptográfico y decodificación de imagen. Cada caso acredita su reason code literal, el número exacto de llamadas a digest/decoder y la ausencia total de ejecución del conector, creación de object URL o descarga.

### Inventario acumulado exacto

El inventario de T2 a T2-R3 consta exactamente de estos ocho archivos:

1. `package.json`
2. `package-lock.json`
3. `src/pages/EngineV2DiagnosticLab.jsx`
4. `src/components/diagnostic/YoshiT2RunnerPanel.jsx`
5. `src/lib/engineV2Bridge/yoshiT2DiagnosticArtifacts.js`
6. `src/lib/engineV2/__tests__/yoshiT2DiagnosticArtifacts.test.js`
7. `src/lib/engineV2/__tests__/yoshiT2RunnerPanel.test.jsx`
8. `src/lib/engineV2/ENGINE_V2_T2_YOSHI_DIAGNOSTIC_RUNNER_REPORT.md`

T2-R3 modificó exclusivamente el panel, los dos tests T2 y este informe. `package.json`, `package-lock.json`, `src/pages/EngineV2DiagnosticLab.jsx` y `src/lib/engineV2Bridge/yoshiT2DiagnosticArtifacts.js` permanecieron byte a byte intactos respecto de los hashes iniciales entregados para R3.

### Puertas T2-R3

Entorno: Vitest `v4.1.10`, jsdom `v30.0.1`, Node `v24.18.0`.

| Puerta | Resultado T2-R3 |
| --- | --- |
| Panel jsdom real, filtro focalizado | 1/1 suites, 16/16 pruebas seleccionadas, 0 fallos |
| T2 focalizada, contrato + helpers + jsdom real | 1/1 suites, 143/143 pruebas, 0 fallos |
| T1 + T2 | 2/2 suites, 320/320 pruebas, 0 fallos |
| Engine V2 completa, un worker | 22/22 suites, 1.164/1.164 pruebas, 0 fallos |
| ESLint focalizado, panel y ambos tests T2 | código 0 |

No se ejecutó build porque R3 prohíbe ejecutar Vite. Tampoco se ejecutaron Yoshi, Base44 ni la aplicación interactiva.

## T2-R4 — cierre de build y distribución

T2-R4 se limita al build productivo, la inspección del `dist` resultante y esta documentación. No modifica código ni pruebas. La rama permaneció en `engine-v2-yoshi-t2-diagnostic-runner`, HEAD permaneció en `e0e3f0f629ea3a8f009013b04128a387f7473332` y el staging permaneció vacío. La rama no tiene upstream configurado; sin hacer `fetch`, la comparación explícita `git rev-list --left-right --count HEAD...origin/main` contra la referencia remota local ya existente devolvió `0 0`.

### Build limpio de producción

`package.json` conserva como script productivo vigente `"build": "vite build"`. Antes del build se acreditó mediante `.gitignore:15:dist` que `dist` estaba ignorado, se comprobó que contenía cero rutas tracked y se resolvió la ruta exacta `C:\Users\lucas\Documents\Codex\stitchpath-ai-copy-lab\dist`. El directorio ya estaba ausente; la limpieza acotada `git clean -fdX -- dist/` fue por ello un no-op y garantizó un build completamente nuevo sin eliminar ninguna ruta tracked.

El primer intento dentro del sandbox no llegó a cargar la configuración de Vite ni creó `dist`. Fue una incidencia de ejecución no acreditable: comando `npm run build`, inicio `2026-08-10T21:07:15.179+02:00`, fin `2026-08-10T21:07:19.306+02:00`, duración de pared `4.119 s`, exit code `1`, mensaje exacto `failed to load config from C:\Users\lucas\Documents\Codex\stitchpath-ai-copy-lab\vite.config.js` y error exacto `Error: spawn EPERM`. Como el fallo era el bloqueo de creación de procesos del sandbox y `dist` seguía ausente, el mismo comando se repitió fuera del sandbox sin cambiar archivos ni configuración.

Resultado productivo efectivo:

| Campo | Valor |
| --- | --- |
| Comando real | `npm run build` |
| Script resuelto | `vite build` |
| Inicio | `2026-08-10T21:07:40.529+02:00` |
| Fin | `2026-08-10T21:08:20.716+02:00` |
| Vite | `v6.4.1` |
| Módulos transformados | 2.168 |
| Duración informada por Vite | `33.45 s` |
| Duración de pared medida | `40.183 s` |
| Exit code | `0` |
| Resultado | BUILD APROBADO |

El único warning fue `Browserslist: browsers data (caniuse-lite) is 6 months old`; no se ejecutó la actualización sugerida ni se instaló nada. La línea `[base44] Proxy not enabled (VITE_BASE44_APP_BASE_URL not set)` fue informativa: no se inició Base44, no se habilitó proxy y no hubo operación remota. El build emitió 98 archivos en `dist`.

### Inspección completa de `dist`

Cada búsqueda fue ordinal y abarcó el contenido completo de los 98 archivos recién generados. Cero coincidencias significa que no existe archivo ni contexto que clasificar para ese literal.

| Búsqueda literal | Coincidencias | Archivo y contexto |
| --- | ---: | --- |
| `YoshiT2RunnerPanel` | 0 | Ausente |
| `Ejecutar T2` | 0 | Ausente |
| `YOSHI-FUENTE-ORIGINAL.jpeg` | 0 | Ausente |
| `066F5629D48AA4D62E8B2D3EDF57B499B4438381653AAA156FBCE2EDD23D7827` | 0 | Ausente |
| `yoshi-t2-legacy-summary.json` | 0 | Ausente |
| `yoshi-t2-source-regions.json` | 0 | Ausente |
| `yoshi-t2-engine-v2-document.json` | 0 | Ausente |
| `yoshi-t2-canonical-commands.json` | 0 | Ausente |
| `yoshi-t2-metrics.json` | 0 | Ausente |
| `yoshi-t2-traces.json` | 0 | Ausente |
| `yoshi-t2-vs-r02-comparison.md` | 0 | Ausente |
| `MANIFEST_SHA256.txt` | 0 | Ausente |
| `83.4` | 0 | Ausente |
| `114.3` | 0 | Ausente |
| `stitchpath-yoshi-t2` | 0 | Ausente |
| `jsdom` | 0 | Ausente |
| `T2_SOURCE_REGIONS_DOCUMENT_MISMATCH` | 0 | Ausente |

Las búsquedas de control `YOSHI_T2_`, `YoshiT2` y `T2_` devolvieron también cero coincidencias. Ningún nombre de archivo de `dist` contiene `yoshi`, `t2` o `jsdom`. Por tanto no hay chunk ejecutable T2, el panel está ausente, `jsdom` está ausente del bundle, la configuración T2/Yoshi, el hash, los nombres de los ocho artefactos y los códigos T2 están ausentes, y el build general queda aprobado.

Como control de falsos positivos, la búsqueda amplia case-insensitive `yoshi` encontró ocho menciones históricas ajenas al runner T2. Se clasificaron así:

| Archivo | Offset(s) | Coincidencias y contexto |
| --- | --- | --- |
| `dist/assets/CommandRuntimeForensicsPanel-Dnd4s54g.js` | 14259 | Una referencia al perfil productivo preexistente `yoshi_wilcom_reference` |
| `dist/assets/Editor-CJPRBeL7.js` | 209624 | Una referencia al fallback preexistente `yoshi_wilcom_reference` |
| `dist/assets/EngineV2ObjectStitchEditor-BhU22qig.js` | 17040, 17190, 17348, 19740 | Tres textos preexistentes de plantilla/detalle Yoshi y la detección genérica `/yoshi/i` al cargar un plan |
| `dist/assets/exportPipeline-CdjbXe6F.js` | 233286 | Una comprobación preexistente de `yoshi_wilcom_reference` |
| `dist/assets/regression.worker-0pUTuZ7U.js` | 217928 | Una comprobación preexistente de `yoshi_wilcom_reference` en el worker |

Estas ocho menciones no contienen `T2_`, `YoshiT2`, el panel, el JPEG, la configuración literal 83,4 × 114,3 mm, el hash, los artefactos ni el código gobernante buscado; no constituyen código ni configuración del runner T2.

### Custodia posterior al build

Tras el build, `git check-ignore` siguió resolviendo `dist` y `dist/index.html` mediante `.gitignore:15:dist`; `git status --ignored --short -- dist` mostró exclusivamente `!! dist/`, `git ls-files -- dist` devolvió cero rutas y el estado Git normal no incluyó `dist`.

Los siete hashes protegidos permanecieron intactos:

| Archivo | SHA-256 |
| --- | --- |
| `package.json` | `4613778A1B4DF696369A2B48F607305C533B76C36A255533B38A6EA92A6A69DD` |
| `package-lock.json` | `8614513AEFCC958B9539C3A4512D8EEF617F00BFAA28064E3B673AD1AAC480AA` |
| `src/pages/EngineV2DiagnosticLab.jsx` | `474D5DE6B6C0B71D3CE4DCC40D2FD891E3A4EE50FD46B76F194278C1AFAD30A2` |
| `src/lib/engineV2Bridge/yoshiT2DiagnosticArtifacts.js` | `918B981F811D11B5446D04620B2199AC9BB782A70764CD0088D64C6E3D71E4C2` |
| `src/components/diagnostic/YoshiT2RunnerPanel.jsx` | `D640B43A82C402744A5B24AA4273B68C7C168418BB4BB86A57EAAA822000FF31` |
| `src/lib/engineV2/__tests__/yoshiT2DiagnosticArtifacts.test.js` | `1F07D3CE98B038034B20C182D5D5DF0CA43F805FEFE20338B4B23217A3238628` |
| `src/lib/engineV2/__tests__/yoshiT2RunnerPanel.test.jsx` | `35E7DF80DA0C190FB1516FBC5CE4E7010927180A12DF16716D57BA34A89C771C` |

El hash inicial acreditado de este informe fue `388E85402561F97185101DF62CFA5698DB8F845ED048888F5B918766C9275BC1`. El inventario Git acumulado continuó exactamente en ocho archivos:

1. `package.json`
2. `package-lock.json`
3. `src/pages/EngineV2DiagnosticLab.jsx`
4. `src/components/diagnostic/YoshiT2RunnerPanel.jsx`
5. `src/lib/engineV2Bridge/yoshiT2DiagnosticArtifacts.js`
6. `src/lib/engineV2/__tests__/yoshiT2DiagnosticArtifacts.test.js`
7. `src/lib/engineV2/__tests__/yoshiT2RunnerPanel.test.jsx`
8. `src/lib/engineV2/ENGINE_V2_T2_YOSHI_DIAGNOSTIC_RUNNER_REPORT.md`

T2-R4 modificó únicamente este informe. No repitió Vitest ni ESLint; conserva como evidencia T2-R3 los resultados 16/16, 143/143, 320/320 y 1.164/1.164. No ejecutó Yoshi, Base44, Vite dev ni la aplicación interactiva; no instaló dependencias; no hizo `fetch`, `pull`, cambio de rama, staging, commit, push, PR ni ninguna operación remota.

## Estado de cierre

T2-R4 queda cerrada con build productivo limpio aprobado y ausencia acreditada del runner T2 y de jsdom en la distribución. No se generaron artefactos diagnósticos reales, EMB, DST, DSB, ZIP ni binarios T2; el único cambio de R4 es este informe y el `dist` nuevo permanece local, ignorado y fuera del inventario Git.
