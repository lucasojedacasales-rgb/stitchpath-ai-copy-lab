# T1-R3 — Conector experimental raster → Engine V2

Fecha de cierre técnico: 2026-08-10.

## Resultado

T1 conecta de forma interna, paralela y desactivada por defecto el contexto completo del pipeline raster heredado con el bridge experimental existente y `runEngineV2InternalPipeline`.

T1-R2 corrigió precedencia de excepciones, referencias no clonables, saneamiento de resultados inválidos, carga diferida, canonicalización integral, aislamiento de procedencia legacy, detección de colisiones y cobertura negativa.

La tercera auditoría devolvió veredicto B por dos defectos funcionales y una insuficiencia de acreditación: ciclos publicados como diagnósticos no serializables, rechazo no capturado de los imports activos y pruebas de carga apoyadas en funciones importadas antes del reinicio del grafo. T1-R3 corrige exclusivamente esos puntos y completa las combinaciones negativas señaladas. No modifica el runner, Base44, Editor, CE01, encoders ni superficies binarias.

El resultado legacy conserva siempre la referencia exacta y el gobierno de la ejecución. El sidecar T1 no crea DST/DSB, no adapta a máquina y no ejecuta encoding.

## Frontera legacy y runner real

La frontera es el `PipelineContext` devuelto por el `runPipeline` productivo después de estas nueve etapas literales:

1. `image_analysis`;
2. `image_enhancement`;
3. `contour_engine`;
4. `semantic_segmentation`;
5. `vector_engine`;
6. `region_builder`;
7. `quality_phase_1_input_segmentation_cleanup`;
8. `stitch_planner`;
9. `stitch_optimizer`.

T1 exige que las nueve entradas de `stageLog` estén presentes, sean únicas y tengan `ok: true`. Un contexto parcial o con una etapa fallida queda bloqueado antes de Engine V2.

La prueba no sustituye el runner, `CLIENT_STAGES`, `createContext`, `logStage` ni su bucle secuencial. Solo simula las cinco etapas que requieren navegador, imagen/canvas, Base44 o red: análisis, mejora, contorno, segmentación semántica y vectorización. Permanecen reales `region_builder`, limpieza Quality Phase 1, `stitch_planner` y `stitch_optimizer`.

Recuento exacto de las 177 pruebas T1-R3:

- pruebas que invocan `runPipeline` real: 2;
- pruebas con doble del runner: 0;
- pruebas que no invocan el runner: 175.

Una prueba acredita el comportamiento OFF y otra la cadena runner real → adaptador → Engine V2, la reutilización estable de los módulos activos y los fallos independientes de importación. Son dos casos de prueba con runner real y cinco invocaciones efectivas del runner: una OFF y cuatro dentro del caso activo. No se procesa Yoshi en estas pruebas.

## Activación y carga diferida

La activación sigue siendo el booleano interno `experimentalEngineV2RasterObservation`, cuyo valor por defecto es `false`.

| Valor | Estado | Efecto T1 |
| --- | --- | --- |
| ausente, `undefined` o `false` | `not_requested` | no inspecciona regiones ni carga adaptador/Engine V2 |
| `true` | sujeto a validación | carga dinámicamente adaptador y bridge, adapta copias y ejecuta V2 |
| cualquier otro valor | `blocked` | no inspecciona la fuente ni carga adaptador/Engine V2 |

El conector solo importa estáticamente el flag. El runner legacy se carga y ejecuta conforme a su contrato porque produce el resultado gobernante. El adaptador y el bridge se importan dinámicamente únicamente tras acreditar `activation === true`.

Las pruebas aisladas reinician el registro de módulos. Sus fábricas llaman a `vi.importActual`, por lo que evalúan la implementación real dentro del grafo nuevo en vez de devolver funciones importadas antes del reinicio. Demuestran:

- importar el conector: 0 cargas de adaptador y 0 cargas de V2;
- ausencia, `undefined`, OFF o activación inválida: 0 y 0;
- primera activación explícita `true`: una evaluación real de cada módulo;
- segunda activación ON en el mismo grafo: los contadores permanecen en una evaluación por módulo;
- fallo independiente del import del adaptador o del bridge: diagnóstico `T1_ENGINE_V2_DEPENDENCY_UNAVAILABLE`, sin propagación y conservando el resultado legacy.

## Adaptación y canonicalización integral

`adaptLegacyRasterPipelineResultToEngineV2Input` inspecciona por descriptores, no muta la entrada y devuelve estructuras nuevas profundamente congeladas.

Cada región requiere color HEX, geometría normalizada explícita, visibilidad válida y, cuando existe, evidencia semántica dentro del dominio admitido. No se importan técnica, `stitch_type`, underlay, densidad, parámetros físicos ni relaciones legacy.

La salida contractual se canonicaliza antes de formar identidad o entrar en V2:

- `#RGB` y `#RRGGBB` se convierten a seis dígitos en minúsculas;
- `-0` se convierte en `0`;
- se eliminan duplicados consecutivos y el cierre explícito correcto;
- cada anillo queda abierto y con orientación estable;
- cada anillo rota al inicio lexicográficamente canónico por coordenadas numéricas;
- los huecos se canonicalizan individualmente y se ordenan canónicamente;
- no se redondean ni escalan coordenadas válidas.

La prueba integral entrega dos fuentes equivalentes con IDs aleatorios, variantes de color, rotación, orientación, cierre, duplicados, `-0` y orden de huecos. Acredita igualdad exacta de la entrada V2 contractual, documento V2, comandos canónicos, métricas y trazas.

## Identidad y procedencia

Cada `sourceRegion.id` se deriva con FNV-1a de 64 bits sobre posición, color canónico, anillo exterior canónico y huecos canónicos. El algoritmo no usa aleatoriedad, tiempo, locale ni estado global.

El prefijo ordinal distingue regiones duplicadas en posiciones diferentes. Además, cada adaptación mantiene un registro local `fingerprint → serialización canónica`: si el mismo fingerprint aparece con una serialización distinta, falla determinísticamente con `T1_RASTER_REGION_ID_COLLISION`; nunca comparte identidad en silencio.

El ID legacy queda exclusivamente en `nonContractualProvenance`, marcado como diagnóstico. No entra en `sourceRegions`, configuración del bridge, documento V2, comandos, métricas, trazas, decisiones ni fingerprints. Las pruebas buscan literalmente el ID legacy en todas las superficies contractuales y acreditan su ausencia.

## Precedencia de excepciones

El valor original lanzado se captura sin serializarlo y se inspecciona antes de normalizar el error:

1. inspección descriptor-safe del valor original;
2. si es hostil, excede límites o contiene una señal incompatible: `T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION`;
3. solo si es compatible se extraen `code`, `path` y `message` mediante descriptores de datos;
4. se crea un error plano interno;
5. se devuelve `T1_ENGINE_V2_EXECUTION_FAILED`.

Los prototipos nativos admitidos son los de `Error`, `EvalError`, `RangeError`, `ReferenceError`, `SyntaxError`, `TypeError`, `URIError` y `AggregateError` cuando existe. El descriptor nativo `stack` puede ser accessor en el runtime: se omite sin ejecutarlo ni copiarlo. No se admite de forma general ningún prototipo personalizado.

Nunca se adjuntan el valor lanzado, `cause`, payload, referencia externa ni `stack`. Getters, setters, `toString`, `valueOf` y serializadores externos no se ejecutan.

Los fallos de los imports activos se capturan después de obtener el resultado legacy y antes de invocar el observador. Devuelven un error plano interno `T1_ENGINE_V2_DEPENDENCY_UNAVAILABLE`; no adjuntan la excepción del loader ni rechazan la promesa del conector.

## Política de tipos de la frontera

Se admiten explícitamente:

- `null`, `undefined`, strings, booleanos, números y bigint;
- arrays densos ordinarios con propiedades indexadas de datos;
- objetos con `Object.prototype`;
- objetos con prototipo `null`, conservando ese prototipo;
- aliases compartidos no cíclicos, conservando identidad mediante `WeakMap`;
- datos congelados, que se clonan y vuelven a congelar en el diagnóstico.

Se rechazan:

- funciones en raíz, objetos, arrays o excepciones;
- símbolos como clave o valor;
- getters, setters, propiedades ocultas y arrays adulterados o dispersos;
- prototipos personalizados y clases desconocidas;
- `WeakMap`, `WeakSet`, `Promise`, `URL`, `Date` y `RegExp` como objetos operacionales;
- `Buffer`, `ArrayBuffer`, `SharedArrayBuffer`, `DataView`, typed arrays y `Blob`;
- payloads y campos exactos de binario, DST/DSB, descargas u object URLs;
- señales de encoder/adaptador distintas de `false` y contadores distintos de cero;
- proxies revocados y traps hostiles.

Los ciclos se rechazan explícitamente. El inspector mantiene además un `WeakSet` de ancestros activos: reencontrar un ancestro produce `T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION`, mientras que reencontrar un objeto ya clonado fuera de la rama activa conserva un alias seguro. Ningún clon parcial alcanza el diagnóstico.

La política se acredita en resultado raíz, objeto anidado, array, excepción, `valid:false`, metadata, comandos, métricas y trazas. Tanto los resultados bloqueados como los completados con aliases seguros se serializan con `JSON.stringify` sin lanzar y quedan profundamente congelados.

Texto documental inocuo y una URL documental almacenada como string no se interpretan como artefactos. La detección sigue fallando cerrado si los constructores globales `Buffer`, `ArrayBuffer`, `SharedArrayBuffer` o `Blob` están temporalmente ausentes; cada prueba restaura exactamente el descriptor global original.

La inspección mantiene límites productivos de profundidad 64, 250.000 objetos y 2.000.000 de propiedades. Profundidad, nodos y propiedades están cubiertos tanto para resultados como para excepciones, sin asignar estructuras de tamaño productivo en la prueba.

## Resultados inválidos y frontera binaria

Toda salida se inspecciona antes de leer o clasificar `valid`.

Una violación devuelve siempre:

```text
status: blocked
reasonCode: T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION
engineV2Result: null
errors: []
canonicalCommands: []
metrics: null
traces: null
```

Un resultado compatible con `valid: false` devuelve `T1_ENGINE_V2_RESULT_BLOCKED`, pero no adjunta el objeto externo ni sus errores, documento, referencias, comandos, métricas o trazas. Todos esos campos quedan saneados a `null` o listas vacías según el contrato.

Un resultado completado exige metadata literalmente falsa en el resultado y el documento:

```text
machineAdaptationApplied: false
encodingApplied: false
binaryArtifactCreated: false
dstArtifactCount: 0
dsbArtifactCount: 0
```

## Matriz de cobertura R3

La prueba focal cubre, además de la matriz R1:

- import del conector, ausencia, `undefined`, OFF, inválida y ON en módulos aislados;
- función en raíz, objeto, array, getter y excepción;
- símbolos como valores;
- referencias no clonables y objetos operacionales desconocidos;
- `valid: false` combinado con cada familia binaria o incompatible;
- excepción ordinaria, binaria, anidada, con URL operativa, accessor y proxy revocado;
- prototipo `null`, aliases no cíclicos y objetos congelados;
- profundidad, nodos y propiedades;
- constructores globales ausentes y restauración;
- equivalencia contractual integral;
- aislamiento literal de procedencia legacy;
- estrategia de colisión determinista;
- no ejecución de getters/setters y no mutación de entradas.

T1-R3 añade literalmente:

- ciclos en raíz, objeto, array, excepción, `valid:false`, metadata, comandos, métricas y trazas;
- serialización JSON del diagnóstico y de la observación completa;
- Error con `cause` seguro, objeto plano, string, número y `null` lanzados;
- excepción cíclica, demasiado profunda y excediendo nodos o propiedades;
- DataView, DST y DSB combinados con excepción y con `valid:false`;
- alias hacia el mismo buffer, `Symbol.toStringTag` falso y array disperso;
- dos ejecuciones ON sobre el mismo grafo;
- fallo independiente del import real del adaptador y del bridge.

## Archivos

Inventario acumulado T1:

- modificado: `src/lib/engineV2Bridge/featureFlags.js`;
- nuevo: `src/lib/engineV2Bridge/legacyRasterToEngineV2Input.js`;
- nuevo: `src/lib/engineV2Bridge/runExperimentalRasterEngineV2Connector.js`;
- nuevo: `src/lib/engineV2/__tests__/experimentalRasterEngineV2Connector.test.js`;
- nuevo: `src/lib/engineV2/ENGINE_V2_T1_RASTER_BRIDGE_REPORT.md`.

T1-R3 modificó exclusivamente conector, prueba focal e informe. No fue necesario crear un archivo de prueba adicional. `featureFlags.js` permaneció byte a byte intacto, con SHA-256 `A4B043C5CAB42DB842918D2C77A48258674576B78FDC2D8DFE81146046283A50`. El adaptador permaneció también byte a byte intacto, con SHA-256 `29166568FA2A9BF4D359EFEFC4099F5B58D2CAC34AB9BEFA0C7C9ACB1F47479A`.

## Historial de ejecución T1-R2 y T1-R3

Vitest: `v4.1.10`.

Incidentes y correcciones:

1. El primer intento focalizado no cargó Vitest por `spawn EPERM`: 0 suites y 0 pruebas. Fue un incidente de sandbox.
2. La primera ejecución efectiva obtuvo 1/1 suites, 114/152 aprobadas y 38 fallos. La causa fue que el runtime expone `Error.stack` como accessor nativo propio; el inspector lo rechazaba antes de clasificar errores seguros. Se corrigió admitiendo y omitiendo únicamente ese descriptor nativo, sin ejecutarlo ni copiarlo.
3. La primera ejecución completa obtuvo 21/21 suites cargadas y 995/996 pruebas aprobadas. La única prueba falló por timeout de 5 s bajo concurrencia, sin discrepancia de aserción. Se fijó en 15 s el timeout de la prueba integral que ejecuta dos pipelines V2 reales.
4. La tercera auditoría estática devolvió B antes de ejecutar pruebas: detectó el diagnóstico cíclico, el rechazo no capturado de `import()` y la insuficiencia del aislamiento de módulos.
5. El primer intento focal T1-R3 volvió a detenerse por `spawn EPERM` antes de cargar Vitest: 0 suites y 0 pruebas. La repetición efectiva y todas las puertas posteriores finalizaron sin fallos funcionales ni timeout.

Resultados finales válidos:

- T1 focalizada: 1/1 suites, 177/177 pruebas, 0 fallos; inicio 12:13:01, duración 5,22 s.
- Integración real focalizada: 1/1 prueba aprobada y 176 omitidas; inicio 12:13:23, duración 2,38 s.
- Bridge/pipeline relacionadas: 6/6 suites, 219/219 pruebas, 0 fallos; inicio 12:13:43, duración 6,35 s.
- Engine V2 completo: 21/21 suites, 1021/1021 pruebas, 0 fallos; inicio 12:14:00, duración 22,20 s.
- ESLint focalizado: código de salida 0, sin errores ni advertencias.
- Referencias relativas de módulo: 17 revisadas, 17 resueltas, 0 sin resolver.
- `git diff --check`: código de salida 0.

La prueba integral de canonicalización conserva timeout explícito de 15 s. El caso filtrado de runner/carga usa 30 s porque ejecuta cuatro contextos legacy activos; sumado al caso OFF, existen cinco invocaciones dentro de dos casos de prueba. Las duraciones observadas fueron 5,22 s para toda la suite focal y 2,38 s para el filtro, por lo que los límites no ocultaron bloqueos.

## Limitaciones

- No se procesó la imagen Yoshi.
- No se creó un DST Yoshi ni otro artefacto binario.
- No existe lector EMB nuevo.
- No existe encoder DST/DSB nuevo ni se invocan encoders existentes.
- No se importaron Y1/Y2 desde snapshots ZIP.
- Las relaciones topológicas entre hueco y contorno no se validan en esta frontera porque la ingestión V2 actual no las exige.
- No se modificaron Base44, Editor, runner, CE01, persistencia, adaptadores de máquina, exportadores ni superficies binarias.
- T1 no tiene consumidor en la UI.
- T1 no demuestra calidad física, sew-out, reducción de puntadas ni aptitud productiva.
- `productionIntegration` no se activa; T1 continúa exclusivamente experimental e interno.
- No se realizó staging, commit, push, PR ni operación remota.
