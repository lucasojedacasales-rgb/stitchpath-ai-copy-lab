# Cierre administrativo aprobado de Hatch C1 — `CONTOUR-LAST-001`

Fecha de cierre técnico: 2026-07-25.

## Estado y alcance

C1 queda aprobada técnicamente como guard experimental tras superar la auditoría independiente final. `CONTOUR-LAST-001` permanece OFF por defecto y no queda activada para producción. El cierre registra cero bloqueos técnicos pendientes.

La evidencia aprobada comprende una matriz negativa 70/70 —68 combinaciones de forma/tipo y 2 escenarios de assessments duplicados— y 6/6 positivos. Las focales C1-R5 y registro alcanzaron 174/174, los consumidores 296/296, A/B, fidelidad y corpus 107/107, Engine V2 3530/3530 y la suite completa 3530/3530. ESLint focalizado terminó sin errores y `git diff --check` fue correcto.

C1-R5 completó exclusivamente la evidencia omitida de C1-R4 sin modificar código productivo. A/B permanece estable; las otras siete reglas C y las reglas D–G continúan inactivas. No se creó ni modificó ningún DST/DSB ni ningún archivo fuera de Engine V2.

No se modificaron Base44, CE01, exportadores, encoders, fixtures DST/DSB ni algoritmos físicos. El guard no aporta un sew-out ni una demostración de mejora física, y no modifica geometría, huecos, colores, roles, técnicas, puntadas ni comandos nominales.

Estado confirmado antes de C1-R2:

- rama `engine-v2`;
- HEAD local y upstream `f1aa5b11c83d5d01233a58688642f85de777e5f1`, sin divergencia;
- staging vacío;
- 18 archivos tracked modificados y 6 nuevos: los 24 archivos acumulados de C1/C1-R1;
- A/B aprobado y estable;
- ese estado histórico fue superado por las correcciones y auditorías C1-R2–C1-R5.

## Cuatro hallazgos C1-R1: reproducción, solución y sonda posterior

| Hallazgo | Reproducción anterior | Solución C1-R2 | Sonda posterior |
| --- | --- | --- | --- |
| Autocertificación del contrato | Era posible eliminar la arista C8, vaciar claims, recomponer el cuerpo, calcular una huella nueva y regenerar una traza coherente con el estado manipulado. | `deriveCanonicalContourDependencyContract` vuelve a derivar desde propuestas, regiones, roles semánticos, grafo/componentes, dependencias, elegibilidad, evidencia `source` y configuración efectiva. El contrato recibido se compara exactamente con esa rederivación; nunca se acredita recalculando su propia huella. | Incluso recomponiendo contrato, huella, marcador, traza y evaluación, el plan emite `CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING` y `CONTOUR_LAST_CONTRACT_STALE`. |
| Capas no exactamente canónicas | Una forma como `[[], [fill], [outline]]` conservaba cobertura y precedencia y podía aceptarse. | Las capas actuales se comparan mediante igualdad estructural exacta con `deriveProposalExecutionLayers`: misma cantidad de capas, mismos IDs y orden determinista, sin capas vacías ni agrupamientos alternativos. | Capas vacías al inicio/final/intermedio, redundantes, desplazadas o agrupadas de otro modo emiten `PROPOSAL_EXECUTION_LAYERS_NOT_CANONICAL`. |
| Desambiguación multicontorno declarativa | Dos contornos con `associationDisambiguated: true` podían reclamar el mismo relleno explícito. | La desambiguación se concluye solo desde la evidencia explícita actual. Se verifican método, IDs existentes, pertenencia al componente y exclusividad. La evidencia normalizada forma parte de las firmas y del contrato. | Dos asociaciones explícitas al mismo relleno bloquean globalmente y todas las evaluaciones quedan `applied: false`; asociaciones explícitas a rellenos distintos siguen válidas. |
| Pérdida de causa raíz | Las etapas posteriores podían sustituir el error C original por un `INVALID_*_UPSTREAM`. | Cada guard conserva los errores causales completos, incluida su `evidence`, y añade envolventes sin borrar la raíz. La deduplicación mantiene orden estable. | `CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING` y su evidencia permanecen identificables en review, drafts, objetos, técnica, secuencia, físico y resultado canónico. |

## Dos hallazgos C1-R2: reproducción y solución C1-R3

| Hallazgo | Reproducción anterior | Solución C1-R3 | Sonda posterior |
| --- | --- | --- | --- |
| Autoridad semántica divergente | La construcción consultaba `semanticResult.byRegionId`, mientras que la rederivación canónica consultaba `semanticResult.assessments`. Una mutación unilateral podía producir roles distintos entre el plan almacenado y el reconstruido. | `normalizeCanonicalSemanticResult` normaliza ambas representaciones, valida forma e IDs, rechaza duplicados, exige conjuntos y proyecciones relevantes idénticos cuando ambas existen, y permite una sola fuente válida. La misma proyección se usa para planificar, derivar participantes y revalidar. La firma `semanticAuthority` registra presencia, validez, IDs y proyecciones; contrato, marcador y traza pasan a R3. C OFF conserva la lectura legacy de `byRegionId`. | Mutar solo `byRegionId`, solo `assessments`, eliminar una región o duplicar/contradecir un assessment invalida C8 con `INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS`, `DUPLICATE_SEMANTIC_ASSESSMENT_REGION_ID` o `CONTOUR_LAST_CONTRACT_STALE`. Ambas representaciones equivalentes siguen válidas y todos los participantes cumplen `stored.semanticRole === freshlyRebuilt.semanticRole`. |
| Árboles recursivos de errores | Cada `INVALID_*_UPSTREAM` incrustaba la colección completa de errores anterior dentro de `evidence`; el tamaño serializado crecía recursivamente y repetía causa y evidencia. | `errorPropagation.js` aporta una identidad estable, merge plano, referencias compactas y propagación idempotente. Los siete consumidores conservan la raíz una vez y añaden como máximo un envoltorio por transición, cuyo `evidence` solo contiene etapa e ID estable. Las validaciones derivadas se omiten cuando el upstream ya es inválido. | En la cadena de siete etapas, `CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING` aparece exactamente una vez, su evidencia aparece una vez, no existe ningún árbol de errores dentro de `evidence`, el conteo crece 4→10 y el tamaño de `errors` crece de forma lineal y acotada. |

## Hallazgo C1-R3: validación semántica estricta

Reproducción bloqueante anterior:

```js
delete semanticResult.byRegionId[outlineId].regionId;
```

Con `assessments` intacto, el normalizador devolvía `valid:true`: sintetizaba silenciosamente la identidad desde la clave `outlineId`, construía la proyección y podía acreditar un contrato C1. La sonda previa exacta produjo `valid:true`, `errors:[]` y `signature.byRegionId.valid:true`.

C1-R4 endurece exclusivamente `normalizeCanonicalSemanticResult`:

- reutiliza `ARTWORK_SEMANTIC_ROLES`, el catálogo cerrado productivo;
- exige plain objects reales, propiedades propias `regionId` y `semanticRole`, tipos string, contenido no vacío tras `trim` e identidad exacta clave/valor;
- no convierte tipos, no completa campos y no reconstruye IDs;
- valida cada assessment con las mismas reglas y mantiene la unicidad por `regionId`;
- rechaza una representación malformada aunque la otra sea completa;
- conserva una sola representación válida cuando el contrato público lo permite;
- devuelve errores específicos y deterministas;
- si la semántica estricta es inválida, la derivación devuelve `contract:null`; C1 permanece activo, con marcador y traza bloqueada, sin contrato acreditado;
- C OFF conserva la ruta legacy y no queda sometido a estas exigencias experimentales.

La reproducción exacta ahora devuelve `valid:false` con `INVALID_SEMANTIC_RESULT_REGION_ID`; `validateEmbroideryObjectProposalPlan` también devuelve `valid:false`.

### Matriz final C1-R5 de entradas inválidas

Cada fila se ejecutó para `byRegionId` y `assessments`, primero como única representación y después manteniendo la otra representación completa y válida: 17 × 2 × 2 = 68 combinaciones negativas de forma/tipo.

| Caso | Valor o mutación | Error explícito principal |
| ---: | --- | --- |
| 1 | `regionId` propio ausente | `INVALID_SEMANTIC_RESULT_REGION_ID` |
| 2 | `regionId: ""` | `INVALID_SEMANTIC_RESULT_REGION_ID` |
| 3 | `regionId: "   "` | `INVALID_SEMANTIC_RESULT_REGION_ID` |
| 4 | `regionId: 7` | `INVALID_SEMANTIC_RESULT_REGION_ID` |
| 5 | `regionId: null` | `INVALID_SEMANTIC_RESULT_REGION_ID` |
| 6 | `regionId` objeto | `INVALID_SEMANTIC_RESULT_REGION_ID` |
| 7 | `regionId: []` | `INVALID_SEMANTIC_RESULT_REGION_ID` |
| 8 | `regionId` textual distinto de la identidad | `INVALID_SEMANTIC_RESULT_REGION_ID` para mapa; `INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS` para assessment |
| 9 | entrada array, no plain object | `INVALID_SEMANTIC_RESULT_BY_REGION_ENTRY` / `INVALID_SEMANTIC_RESULT_ASSESSMENT` |
| 10 | `semanticRole` propio ausente | `INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE` |
| 11 | `semanticRole: ""` | `INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE` |
| 12 | `semanticRole: "   "` | `INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE` |
| 13 | `semanticRole: 7` | `INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE` |
| 14 | `semanticRole: null` | `INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE` |
| 15 | `semanticRole` array | `INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE` |
| 16 | `semanticRole: { value: "dark_mark" }` | `INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE` |
| 17 | rol textual fuera del dominio | `INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE` |

En las 68 combinaciones: normalizador, planificación y validación quedan inválidos; no existe contrato acreditado; el marcador conserva `active:true`; la traza conserva `evaluatorInvoked:true`, `applied:false` y `status:"blocked"`.

La matriz adicional de assessments duplicados contiene dos escenarios: assessments como única fuente y assessments duplicados junto a `byRegionId` válido. Ambos conservan `DUPLICATE_SEMANTIC_ASSESSMENT_REGION_ID`, invalidan normalizador, validación y reconstrucción, dejan contrato nulo, marcador activo y traza bloqueada, e impiden decisiones aceptadas, drafts, objetos, especificaciones, pasos, paths, puntos y comandos.

Resultado versionado de evidencia: 68/68 casos de forma/tipo, 2/2 escenarios de duplicados, total negativo 70/70 y positivos existentes 6/6.

Las sondas adicionales cubren clave `byRegionId` vacía, divergencias unilaterales de `semanticRole`, `confidence` y `sourceRole`, regiones ausentes y contradicciones. Los seis positivos aceptan ambas representaciones idénticas, las dos fuentes individuales tanto en normalización como en reconstrucción y la configuración resuelta reutilizada.

C1-R5 no necesitó cambios productivos: modificó únicamente el test parametrizado y este informe. La reproducción independiente anterior de `delete semanticResult.byRegionId[outlineId].regionId` permanece documentada y cerrada por C1-R4.

## Derivación canónica autoritativa

`dependencyPlanner.js` contiene una única función productiva, `deriveCanonicalContourDependencyContract`, utilizada tanto durante la construcción como durante la validación. Sus entradas actuales son:

- propuestas activas, identidades, regiones, roles y tipos de puntada;
- regiones productivas y roles fuente disponibles;
- autoridad semántica actual normalizada desde `byRegionId` y/o `assessments`;
- grafo, componentes y miembros actuales;
- dependencias actuales;
- elegibilidad actual de cada contorno;
- evidencia explícita actual en `proposal.source.contourDependencyAssociation`;
- perfil y flag C1 efectivos.

El resultado canónico incluye:

- configuración de integración efectiva;
- IDs de todas las propuestas activas;
- firmas normalizadas de propuestas, regiones, roles, componentes, dependencias, elegibilidad y evidencia;
- presencia, validez, IDs y proyección semántica relevante de cada representación autoritativa;
- aristas C requeridas;
- asociaciones explícitas normalizadas;
- claims y participantes derivados;
- huella determinista adicional.

La validación ejecuta nuevamente esa función con las entradas actuales y compara el contrato completo mediante igualdad estructural determinista. La huella recibida solo se compara con la huella de la rederivación autoritativa; no se recalcula sobre el contrato recibido para aceptarlo contra sí mismo.

Si C1 debía estar activo y faltan regiones, grafo o evaluaciones semánticas actuales, se falla de forma cerrada con `CONTOUR_LAST_AUTHORITATIVE_INPUTS_MISSING` o el error autoritativo específico.

## Marcador estructural e integración coherente

Los planes C ON conservan `hatchOverlapIntegrationMarker`, que registra determinísticamente:

- versión del marcador;
- regla y perfil efectivos;
- estado activo;
- reglas habilitadas;
- versión y huella del contrato derivado.

El validador cruza configuración, marcador, contrato, metadatos de invocación, evaluaciones conservadas en las propuestas y traza. Si se eliminan conjuntamente configuración, contrato, marcador y traza pero permanecen metadatos o evaluaciones históricas, se emiten:

- `CONTOUR_LAST_INTEGRATION_STATE_MISMATCH`;
- `CONTOUR_LAST_CONTRACT_MISSING`;
- `CONTOUR_LAST_INTEGRATION_MARKER_MISSING`;
- `CONTOUR_LAST_TRACE_MISSING`.

Este marcador no se presenta como seguridad criptográfica ante un atacante capaz de borrar y reconstruir todo el plan. Su objetivo es impedir desactivaciones silenciosas y mutaciones accidentales coherentemente recompuestas.

C OFF no conserva contrato, marcador, evaluación ni traza C1.

## Capas canónicas y topología

La ejecución continúa derivándose únicamente del DAG, nunca del orden lexicográfico de IDs o del orden de entrada. Para `a-outline → z-fill`, las capas canónicas siguen siendo:

```text
[[z-fill], [a-outline]]
```

Se conservan las regresiones con IDs invertidos, aleatorios y entrada invertida. Además de validar cobertura, duplicados, IDs desconocidos y precedencia, C1-R2 exige igualdad exacta con las capas recalculadas desde las dependencias actuales.

## Asociación multicontorno verificable

La asociación general sigue siendo conservadora por componente conectado y no acredita una relación geométrica exacta contorno-relleno.

La evidencia explícita solo es válida si:

- usa `explicit_proposal_ids`;
- contiene al menos un ID;
- todos los IDs existen;
- todos corresponden a participantes stitchables del componente actual;
- la asociación está presente actualmente en `source`.

`associationDisambiguated` es una conclusión derivada. Dos claims del mismo componente que comparten un dependiente exclusivo son ambiguos, aunque ambos aporten evidencia explícita. El plan se bloquea transaccionalmente y ninguna evaluación conserva `applied: true`.

Los contornos interior/exterior acreditados explícitamente contra rellenos distintos continúan válidos. Los componentes desconectados no interfieren entre sí. Retirar o modificar la evidencia cambia la rederivación y vuelve obsoleto el contrato almacenado.

## Propagación atómica plana con causa raíz

Ante un upstream C inválido se mantienen:

- 0 decisiones;
- 0 drafts;
- 0 objetos;
- 0 especificaciones técnicas;
- 0 pasos;
- 0 paths y puntos físicos;
- 0 comandos canónicos.

Los cambios de C1-R3 usan una única utilidad en todos los consumidores:

- `proposalReviewResolver` rederiva la integridad con regiones, grafo y semántica actuales;
- `objectDraftMaterializer` y `finalObjectMaterializer` bloquean sin materialización parcial;
- `technicalPlanningPipeline`, `globalSequencePlanner`, `physicalStitchPipeline` y `canonicalCommandCompiler` conservan la colección plana y añaden un solo envoltorio de transición;
- los envoltorios solo conservan `stage` e `upstreamErrorId`, sin código, evidencia ni resultado upstream copiado;
- la identidad estable deduplica con orden determinista y una segunda propagación en la misma etapa es idempotente.

`CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING` conserva evidencia con el contorno, dependencia requerida, método/evidencia de asociación y huella del contrato canónico hasta el resultado final.

Sonda exacta sobre C8 con la dependencia requerida eliminada; el tamaño es `JSON.stringify(result.errors).length`:

| Etapa | Errores superiores | Apariciones de la causa | Tamaño serializado | Salida aceptada |
| --- | ---: | ---: | ---: | ---: |
| Review | 4 | 1 | 1621 | 0 |
| Drafts | 5 | 1 | 1893 | 0 |
| Objetos | 6 | 1 | 2209 | 0 |
| Técnica | 7 | 1 | 2527 | 0 |
| Secuencia | 8 | 1 | 2793 | 0 |
| Físico | 9 | 1 | 3055 | 0 |
| Canónico | 10 | 1 | 3314 | 0 |

Cada transición añade exactamente un error superior y entre 259 y 318 bytes en esta sonda. La serialización y el orden fueron idénticos en dos ejecuciones independientes.

## Deuda preexistente separada: cero objetos válidos

El caso de un diseño vacío o con todos los objetos excluidos que termina en `MISSING_INITIAL_POSITION_COMMAND` reproduce el comportamiento de HEAD y no es una regresión C1 ni una responsabilidad de C1-R3.

C1-R3 no modifica ese comportamiento. La atomicidad descrita en este informe se aplica a upstream explícitamente inválido, no al soporte general de diseños válidos con cero objetos. Esta deuda permanece separada para una fase futura.

## Configuración, registro y límites

La activación continúa independiente de A/B:

- perfil por defecto `legacy`;
- perfil opt-in `hatch-c-experimental`;
- único flag reconocido `CONTOUR-LAST-001`, `false` por defecto;
- configuración cruda, resuelta y reutilizada de forma idempotente;
- perfiles, campos y flags desconocidos rechazados;
- `undefined` explícito inválido para perfil, mapa de flags y valor del flag;
- activación bajo `legacy` rechazada.

Las otras siete reglas C conservan `activatedInProfiles: []`:

- `OVERLAP-CUTOUT-001`
- `SPLIT-OCCLUDED-001`
- `SAME-COLOR-UNION-001`
- `WHITE-FABRIC-001`
- `ADJACENT-UNDERLAP-001`
- `COLOR-GROUP-HEURISTIC-001`
- `MULTILAYER-DEPENDENCY-001`

Recorte, unión booleana, MultiPolygon, underlap, compensación, clasificación automática del blanco, optimización nueva por color y tratamiento multicapa permanecen fuera de C1.

## Alcance real de los fixtures

Paquete de referencia: `PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F.zip`.

- SHA-256: `d2ca1f36db18a6d48fe8d471f66d4cf1f96e2804ca65979d57752e97812bf8e3`
- tamaño: `320891578` bytes

| Artefacto | Ruta dentro del paquete | SHA-256 |
| --- | --- | --- |
| SVG | `PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F/03_SOLAPES/00_Fuentes/Vectores/HATCH-C-OVERLAPS-EXACT-100x80mm.svg` | `08aff6f030fa7850e7e3f5a7e19113dc42a7d322835f5b382c0b45f5769dbc6b` |
| CSV | `PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F/03_SOLAPES/05_Datos_Objetos/HATCH-C-OVERLAPS-map.csv` | `2615f1a4cb62fbba70f5324c2f864baed70c1e784f682342e8abcdbb6b69c921` |
| XLSX | `PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F/03_SOLAPES/05_Datos_Objetos/HATCH-C-OVERLAPS-R01-analisis.xlsx` | `3a80a22334c2c403fd8759dc25717b3a788fc853d6027d4c54796c09d91f4851` |

Los roles de C7/C8/C11/C12 proceden de la referencia cerrada y se suministran explícitamente al pipeline. No se demuestra que el analizador productivo descubra esos roles desde una imagen.

C7 demuestra únicamente la preservación de un hueco explícito ya suministrado; no demuestra clasificación automática del blanco. C1 no demuestra recorte ni asociación geométrica general, y C12 no afirma recorte correcto.

## Paridad digital ON/OFF

ON y OFF conservan propuestas, geometría, dependencias, capas, puntadas y comandos nominales idénticos:

| Caso | Estado ON | Puntos físicos | SHA-256 físico ON = OFF | Comandos | SHA-256 comandos ON = OFF |
| --- | --- | ---: | --- | ---: | --- |
| C7 | `not_applicable`, `applied: false` | 412 | `734a4beb305bc6d3cf1eb790c4de283a8d585f976a33d2af928abec994de385a` | 427 | `34515292bce20add7f4ebc9ab8f88047fdf725e5aa9d519cf41fda5bbad317d0` |
| C8 | `validated`, `applied: true` | 285 | `6c9ce744f573b8009c5ae70c9010665005c04b9781b79756493aff89837b4237` | 291 | `a7d030f4dea4ae5cd80e98ff6b0c4391e47f4aede777a5695cbfec4038287d2e` |
| C11 | `validated`, `applied: true` | 371 | `10e80f957920e77dc8c92e8e9706ef3c7c3ef2392c378b4c0a15ad822d259c50` | 379 | `2ac7dbf99d6d65863c0698affea8a2bd25a7f685c91aecd8f18708858cfdd958` |
| C12 | `validated`, `applied: true` | 428 | `500114469154a0191259d437f09226a7a9c4e5c2d0bbfc3275e5e3f24880d2bf` | 440 | `14a9034a8b2ca0a6fe129f074fddbd7ca825610d191c137b9aa8df73e5082dae` |

Las 16 combinaciones A/B con C OFF mantienen el hash exacto pre-C `4f8f345d3f099ec7dc6ca0695427ebfbc1741e16df83ced707bfee908cfd0f0`. A/B y C pueden coexistir sin mezclar sus trazas.

## Pruebas adversariales y regresiones

Las pruebas nuevas cubren directamente:

1. arista C8 eliminada con claims, huella, marcador y traza recompuestos;
2. componente del grafo alterado después de crear el contrato;
3. configuración, contrato, marcador y traza retirados con historia residual;
4. evidencia explícita retirada del `source`;
5. capa vacía inicial;
6. capas vacías finales/intermedias, redundantes, desplazadas o agrupadas alternativamente;
7. dos asociaciones explícitas exclusivas al mismo relleno;
8. asociaciones interior/exterior explícitas y distintas;
9. propagación extremo a extremo de causa y evidencia;
10. C OFF sin contrato, marcador, evaluación ni traza;
11. paridad nominal C7/C8/C11/C12;
12. todas las regresiones C1-R1: topología independiente de IDs, `undefined`, ciclos, dependencias desconocidas/propias, multicontorno y atomicidad.
13. divergencia unilateral de `byRegionId` y de `assessments`;
14. región semántica ausente, assessment duplicado/contradictorio y representaciones mal formadas;
15. representaciones equivalentes y fuentes únicas permitidas;
16. identidad de roles almacenados y rederivados para todos los participantes;
17. causa y evidencia únicas, ausencia de árboles upstream, un envoltorio por etapa, idempotencia, determinismo y crecimiento lineal;
18. cero decisiones, drafts, objetos, especificaciones, pasos, paths, puntos y comandos ante el upstream C inválido.

Resultados:

| Comprobación | Resultado |
| --- | --- |
| C1/C1-R1/C1-R2/C1-R3/C1-R4/C1-R5 focalizadas y registro | 3 archivos, 174/174 pruebas |
| Consumidores reforzados + C1-R5 | 8 archivos, 296/296 pruebas |
| A/B, fidelidad, corpus y registro | 4 archivos, 107/107 pruebas |
| Engine V2 completo, `--testTimeout=30000` | 143 archivos, 3530/3530 pruebas |
| Suite total, `--testTimeout=30000` | 143 archivos, 3530/3530 pruebas |
| ESLint focalizado sobre los JavaScript afectados | 24 archivos, 0 errores |
| Whitespace y `git diff --check` | exit 0, sin errores |
| DST/DSB | ningún archivo creado o modificado |

## Inventario exacto

El conjunto acumulado contiene 25 archivos: 18 tracked modificados y 7 nuevos. C1-R3 preservó los 24 archivos recibidos y añadió únicamente la utilidad plana dentro de Engine V2.

Tracked modificados:

- `src/lib/engineV2/__tests__/hatchEvidenceRegistry.test.js`
- `src/lib/engineV2/commandCompilation/canonicalCommandCompiler.js`
- `src/lib/engineV2/index.js`
- `src/lib/engineV2/materialization/objectDraftMaterializer.js`
- `src/lib/engineV2/materialization/proposalReviewResolver.js`
- `src/lib/engineV2/planning/dependencyPlanner.js`
- `src/lib/engineV2/planning/objectPlanningDiagnostics.js`
- `src/lib/engineV2/planning/objectPlanningPipeline.js`
- `src/lib/engineV2/planning/objectPlanningValidation.js`
- `src/lib/engineV2/planning/planningConfig.js`
- `src/lib/engineV2/rules/hatchEvidence/index.js`
- `src/lib/engineV2/rules/hatchEvidence/model.js`
- `src/lib/engineV2/rules/hatchEvidence/overlaps.js`
- `src/lib/engineV2/rules/hatchEvidence/registry.js`
- `src/lib/engineV2/sequencing/globalSequencePlanner.js`
- `src/lib/engineV2/stitchGeneration/physicalStitchPipeline.js`
- `src/lib/engineV2/technical/technicalPlanningPipeline.js`
- `src/lib/engineV2/threads/finalObjectMaterializer.js`

Nuevos:

- `src/lib/engineV2/HATCH_C1_CONTOUR_LAST_INTEGRATION_REPORT.md`
- `src/lib/engineV2/errorPropagation.js`
- `src/lib/engineV2/__tests__/fixtures/hatchCReferenceFixtures.js`
- `src/lib/engineV2/__tests__/hatchCContourLastIntegration.test.js`
- `src/lib/engineV2/__tests__/hatchCContourLastR1.test.js`
- `src/lib/engineV2/rules/hatchEvidence/contourLast.js`
- `src/lib/engineV2/rules/hatchEvidence/overlapProfiles.js`

C1-R2 modificó dentro de ese conjunto exactamente estos 15 archivos:

- `src/lib/engineV2/HATCH_C1_CONTOUR_LAST_INTEGRATION_REPORT.md`
- `src/lib/engineV2/__tests__/hatchCContourLastIntegration.test.js`
- `src/lib/engineV2/__tests__/hatchCContourLastR1.test.js`
- `src/lib/engineV2/commandCompilation/canonicalCommandCompiler.js`
- `src/lib/engineV2/index.js`
- `src/lib/engineV2/materialization/objectDraftMaterializer.js`
- `src/lib/engineV2/materialization/proposalReviewResolver.js`
- `src/lib/engineV2/planning/dependencyPlanner.js`
- `src/lib/engineV2/planning/objectPlanningPipeline.js`
- `src/lib/engineV2/planning/objectPlanningValidation.js`
- `src/lib/engineV2/rules/hatchEvidence/contourLast.js`
- `src/lib/engineV2/sequencing/globalSequencePlanner.js`
- `src/lib/engineV2/stitchGeneration/physicalStitchPipeline.js`
- `src/lib/engineV2/technical/technicalPlanningPipeline.js`
- `src/lib/engineV2/threads/finalObjectMaterializer.js`

C1-R3 modificó exactamente estos 15 archivos, todos dentro de Engine V2:

- `src/lib/engineV2/HATCH_C1_CONTOUR_LAST_INTEGRATION_REPORT.md`
- `src/lib/engineV2/__tests__/hatchCContourLastR1.test.js`
- `src/lib/engineV2/commandCompilation/canonicalCommandCompiler.js`
- `src/lib/engineV2/errorPropagation.js`
- `src/lib/engineV2/index.js`
- `src/lib/engineV2/materialization/objectDraftMaterializer.js`
- `src/lib/engineV2/materialization/proposalReviewResolver.js`
- `src/lib/engineV2/planning/dependencyPlanner.js`
- `src/lib/engineV2/planning/objectPlanningPipeline.js`
- `src/lib/engineV2/planning/objectPlanningValidation.js`
- `src/lib/engineV2/rules/hatchEvidence/contourLast.js`
- `src/lib/engineV2/sequencing/globalSequencePlanner.js`
- `src/lib/engineV2/stitchGeneration/physicalStitchPipeline.js`
- `src/lib/engineV2/technical/technicalPlanningPipeline.js`
- `src/lib/engineV2/threads/finalObjectMaterializer.js`

C1-R4 modificó exactamente estos 3 archivos, todos dentro de Engine V2:

- `src/lib/engineV2/HATCH_C1_CONTOUR_LAST_INTEGRATION_REPORT.md`
- `src/lib/engineV2/__tests__/hatchCContourLastR1.test.js`
- `src/lib/engineV2/planning/dependencyPlanner.js`

No modificó `errorPropagation.js` ni ninguno de los siete consumidores aprobados en C1-R3.

C1-R5 modificó exclusivamente estos 2 archivos:

- `src/lib/engineV2/HATCH_C1_CONTOUR_LAST_INTEGRATION_REPORT.md`
- `src/lib/engineV2/__tests__/hatchCContourLastR1.test.js`

No modificó código productivo, configuración, registro, reglas, pipelines ni consumidores.

## Estado Git previo al checkpoint local

Estado administrativo verificado antes de crear el checkpoint: rama `engine-v2`, HEAD/upstream `f1aa5b11c83d5d01233a58688642f85de777e5f1`, divergencia `+0/-0`, 18 archivos tracked modificados y 7 nuevos, staging vacío, sin push, rebase, merge ni tag.

C1-R5 completa únicamente la evidencia omitida. La auditoría independiente final está superada, C1 queda aprobada técnicamente como guard experimental y `CONTOUR-LAST-001` continúa OFF por defecto.
