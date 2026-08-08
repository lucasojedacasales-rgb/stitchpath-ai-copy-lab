# Informe de integración experimental Hatch C2 — `COLOR-GROUP-HEURISTIC-001`

Fecha de cierre técnico de la implementación: 2026-07-25.

## Estado

C2 queda aprobada técnicamente como guard experimental de secuenciación, con cero bloqueos técnicos pendientes. La auditoría independiente final C2-R2 fue superada después del cierre de la coherencia de motivos en C2-R1 y de la identidad y pertenencia bidireccional de thread blocks en C2-R2.

`COLOR-GROUP-HEURISTIC-001` permanece `false` por defecto, exige opt-in explícito bajo `hatch-c-experimental` y es independiente de `CONTOUR-LAST-001`. Esta aprobación no activa C2 para producción. C1 permanece intacta y conserva sus focales 174/174.

El cierre administrativo acredita:

- scheduler nominal sin cambios;
- prioridad del DAG sobre el agrupamiento por hilo;
- contrato, marcador, evaluación y traza canónicos;
- coherencia canónica exacta de los motivos de revisita;
- proyección bidireccional de execution steps y thread blocks;
- rechazo de autocertificación aun después de recomponer contrato, huella, marcador, evaluación, traza y metadata;
- atomicidad física y canónica con cero salida parcial ante contradicciones;
- C1 intacta, las otras seis reglas C inactivas y las reglas D–G inactivas;
- inventario acumulado de 17 archivos, todos bajo Engine V2, con cero DST/DSB y cero cambios fuera de Engine V2.

## Base exacta y alcance

La implementación partió de:

- rama `engine-v2`;
- HEAD local y `origin/engine-v2` en `1bb2e5b7b4e75a252b60c34a76097769d90663ca`;
- divergencia inicial `+0/-0`;
- árbol, staging y untracked vacíos.

Todos los cambios están bajo `src/lib/engineV2/`. No se modificaron Base44, CE01, exportadores, encoders, algoritmos de geometría, pipelines físicos, compiladores canónicos ni `errorPropagation.js`. No se creó ni modificó ningún DST/DSB.

C2-R1 trabajó sobre ese estado acumulado sin revertir ni reconstruir C2. Su cambio productivo se limita al evaluador/validador C2; añade una prueba independiente y actualiza únicamente este informe. No modificó configuración, registro, C1, `dependencyAwareScheduler.js`, `errorPropagation.js` ni los pipelines físico y canónico.

C2-R2 trabajó sobre C2-R1 y modificó exclusivamente el mismo evaluador, el archivo de pruebas R1 ya existente y este informe. No creó otro archivo de pruebas ni modificó `globalSequencePlanner.js`, `sequencePlanningValidation.js`, modelos, configuración, registro, C1 o consumidores.

## Autoridad cerrada de C_Solapes

La regla se reutiliza sin reinterpretar el paquete cerrado:

- ID: `COLOR-GROUP-HEURISTIC-001`;
- condición: optimización global de cambios de color;
- acción candidata: agrupar por color únicamente como heurística, respetando primero el grafo inferior–superior–contorno;
- evidencia: secuencia de objetos 2–28;
- confianza registrada: `0.95`.

El registro permite bajo `hatch-c-experimental` únicamente las integraciones independientes C1 y C2. Las otras seis reglas C y las reglas D–G continúan inactivas.

## Configuración independiente

El perfil reconoce:

- `CONTOUR-LAST-001`;
- `COLOR-GROUP-HEURISTIC-001`.

Ambos flags:

- son booleanos e independientes;
- permanecen `false` por defecto;
- se rechazan si se habilitan bajo `legacy`;
- rechazan valores no booleanos;
- conservan el rechazo de flags y campos Hatch desconocidos;
- se resuelven idempotentemente tanto desde configuración cruda como desde una configuración resuelta reutilizada.

Las cuatro combinaciones C1 OFF/C2 OFF, C1 ON/C2 OFF, C1 OFF/C2 ON y C1 ON/C2 ON están cubiertas. C2 OFF no deja contrato, marcador, evaluación, traza ni metadata de invocación C2.

## Comportamiento existente reutilizado

No se modificó `dependencyAwareScheduler.js`. Su comportamiento previo ya:

1. deriva el conjunto dependency-ready antes de considerar el hilo;
2. restringe la selección al hilo actual cuando existe algún objeto ready de ese hilo;
3. permite cambiar de hilo cuando no existe un candidato ready del hilo actual;
4. conserva el desempate y el coste existentes;
5. marca las revisitas como `dependency_gated_revisit`;
6. funciona con búsqueda `exact` y `beam`.

C2 acredita ese comportamiento sin cambiar el orden nominal. El primer paso permanece libre de obligación de continuidad y el agrupamiento por hilo es siempre secundario al DAG.

## Evaluador, contrato, marcador y traza

El evaluador C2 está separado del guard C1. La construcción y la validación rederivan desde los objetos programados, sus `threadId`, dependencias actuales, ejecución actual, algoritmo y configuración efectiva:

- objetos restantes por prefijo;
- objetos ya satisfechos;
- conjunto dependency-ready;
- hilo actual;
- candidatos ready del hilo actual;
- objeto e hilo seleccionados;
- cambio de hilo;
- cierre dependency-gated;
- revisita y su justificación;
- motivo reproducible de cada decisión.

El contrato canónico incluye:

- versión, fase y regla;
- perfil, flag C2 y reglas habilitadas;
- algoritmo solicitado y usado;
- política efectiva de continuidad y revisita;
- IDs, `threadId` y dependencias;
- orden y proyección canónica completa de execution steps;
- proyección canónica de thread blocks, tramos y pertenencia;
- decisiones por prefijo;
- cambios y revisitas;
- declaración de cero cambios geométricos, físicos o de hilo;
- huella determinista.

El marcador vincula perfil, regla, reglas habilitadas y huella. La evaluación y la traza registran `active`, `evaluatorInvoked`, `applied`, `status`, decisiones acreditadas, bloqueos y huella. La validación compara exactamente contrato, marcador, evaluación y traza con una rederivación actual; no acredita el plan recalculando únicamente datos almacenados en su propio contrato.

## Hallazgo y corrección C2-R1

La reproducción independiente anterior al arreglo partió de un plan C2 ON válido con revisita dependency-gated. Al sustituir únicamente `threadBlock.repeatedThreadReason` por `explicit_sequence_override`, `validateGlobalSequencePlan` devolvía `valid: true`, el físico generaba 3 paths y 84 puntos y el canónico generaba 93 comandos. La sustitución del motivo del paso inicial de revisita por `bounded_search_revisit` también era aceptada con los mismos conteos de salida.

La causa era doble:

- la validación general del bloque solo exigía que el motivo perteneciera a `REPEATED_THREAD_REASONS`, sin compararlo con la conclusión C2;
- el motivo almacenado en `executionStep.source` no se contrastaba con la autoridad rederivada y la identidad estructural del paso no formaba parte del contrato C2.

C2-R1 reutiliza la rederivación canónica existente desde objetos, DAG, prefijo ejecutado, conjunto dependency-ready, hilo actual, cierres y revisitas. Sin consultar ninguno de los dos motivos almacenados, concluye para cada bloque y paso:

- revisita C2 justificada: motivo exacto `dependency_gated_revisit`;
- bloque o paso no revisitado: propiedad propia presente con valor `null`.

Un motivo ausente, eliminado, distinto o válido solo para otra causa general queda rechazado. El contrato incorpora además ID, índice, objeto e hilo de cada execution step para impedir que un ID duplicado con contenido distinto se autoacredite. C2 OFF conserva la validación legacy general.

Los errores localizables añadidos son:

- `COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH`;
- `COLOR_GROUP_EXECUTION_STEP_REVISIT_REASON_MISMATCH`.

Cada error conserva path exacto, bloque, paso/objeto, motivo esperado, motivo recibido y decisión canónica. La validación se repite de forma determinista e idempotente y la propagación mantiene una sola tupla causal `código + path`, sin árboles anidados.

## Hallazgo y corrección C2-R2

La reproducción previa a C2-R2 alteró exclusivamente `executionSteps[0].threadBlockId` a `thread-block:forged` sobre un plan C2 ON válido. Tanto `validateGlobalSequencePlan` como el validador C2 devolvían válido; el físico aceptaba 3 paths y 84 puntos y el canónico producía 93 comandos.

La causa era que C2-R1 incorporaba ID, índice, objeto e hilo del paso a la huella, pero no acreditaba su `threadBlockId` ni proyectaba canónicamente los bloques. La validación general comprobaba cobertura y orden agregado de objetos, pero no la identidad bidireccional exacta entre cada paso y su tramo canónico.

C2-R2 deriva sin confiar en `executionStep.threadBlockId`, `threadBlocks`, sus IDs, sus `objectIds` ni los artefactos C2 recibidos:

1. ordena la ejecución por `sequenceIndex`;
2. resuelve cada `objectId` contra el objeto programado autoritativo;
3. toma el `threadId` del objeto, no del paso o bloque recibido;
4. divide la ejecución en tramos contiguos del mismo hilo;
5. asigna ordinal e índices inicial/final;
6. genera el ID determinista con el formato del constructor de bloques y su sanitizador compartido;
7. deriva la revisita desde las decisiones y prefijos C2-R1;
8. compara de forma bidireccional cada paso y bloque recibido contra esa proyección.

La proyección contractual incluida en la huella contiene por paso:

- ID determinista;
- `sequenceIndex`;
- `objectId`;
- `threadId` autoritativo;
- `threadBlockId` canónico.

Por bloque contiene:

- ID determinista y ordinal;
- hilo autoritativo;
- `startSequenceIndex` y `endSequenceIndex`;
- `objectIds` exactos y ordenados según ejecución;
- motivo canónico de revisita.

La validación rechaza IDs de paso o bloque falsificados, índices no canónicos, objetos desconocidos, hilos contradictorios, pertenencia u orden alterados, duplicados, bloques añadidos/eliminados y correspondencia incompleta. Recalcular de forma coherente contrato, huella, marcador, evaluación, traza y metadata a partir de un `threadBlockId` falsificado no concede autoridad: la rederivación desde objetos y ejecución actuales continúa rechazándolo.

## Fallo cerrado

Se rechazan de forma determinista:

- dependencia ejecutada después de su dependiente;
- objeto no dependency-ready seleccionado;
- abandono de un hilo con candidatos ready;
- revisita no justificada;
- orden, dependencias, IDs o `threadId` alterados;
- contrato ausente o stale;
- marcador ausente o incoherente;
- evaluación ausente o incoherente;
- traza ausente o stale;
- desactivación silenciosa;
- configuración contradictoria.

Los códigos C2 ejercitados incluyen:

- `COLOR_GROUP_DEPENDENCY_PRECEDENCE_VIOLATION`;
- `COLOR_GROUP_NON_READY_OBJECT_SELECTED`;
- `COLOR_GROUP_READY_THREAD_SKIPPED`;
- `COLOR_GROUP_THREAD_REVISIT_NOT_JUSTIFIED`;
- `COLOR_GROUP_CONTRACT_MISSING`;
- `COLOR_GROUP_CONTRACT_STALE`;
- `COLOR_GROUP_TRACE_MISSING`;
- `COLOR_GROUP_TRACE_STALE`;
- `COLOR_GROUP_INTEGRATION_STATE_MISMATCH`;
- `COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH`;
- `COLOR_GROUP_EXECUTION_STEP_REVISIT_REASON_MISMATCH`;
- `COLOR_GROUP_EXECUTION_STEP_STRUCTURE_MISMATCH`;
- `COLOR_GROUP_EXECUTION_STEP_SEQUENCE_INDEX_MISMATCH`;
- `COLOR_GROUP_EXECUTION_STEP_OBJECT_MISMATCH`;
- `COLOR_GROUP_EXECUTION_STEP_ID_MISMATCH`;
- `COLOR_GROUP_EXECUTION_STEP_THREAD_MISMATCH`;
- `COLOR_GROUP_EXECUTION_STEP_THREAD_BLOCK_ID_MISMATCH`;
- `COLOR_GROUP_THREAD_BLOCK_ID_MISMATCH`;
- `COLOR_GROUP_THREAD_BLOCK_OBJECTS_MISMATCH`;
- `COLOR_GROUP_THREAD_BLOCK_THREAD_MISMATCH`;
- `COLOR_GROUP_THREAD_BLOCK_STRUCTURE_MISMATCH`.

Una infracción bloquea transaccionalmente la salida: no se aceptan pasos, selecciones, transiciones ni bloques en una construcción inválida; los consumidores existentes producen cero paths, cero puntos físicos y cero comandos canónicos. La causa raíz C2 se conserva mediante la propagación plana aprobada en C1, sin modificar `errorPropagation.js`.

## Cobertura positiva y negativa

La focal C2 contiene 42/42 pruebas y cubre:

- mismo hilo ready frente a otro hilo ready;
- hilo actual bloqueado por dependencia;
- cambio obligado por DAG;
- revisita posterior justificada;
- revisita no justificada;
- tres hilos;
- cadenas de dependencias;
- componentes desconectados;
- IDs no topológicos y orden de entrada invertido;
- `exact` y `beam`;
- configuración resuelta reutilizada;
- cuatro combinaciones C1/C2;
- estado C2 totalmente ausente cuando está OFF;
- manipulaciones de orden, dependencias, IDs, `threadId`, contrato, marcador, evaluación y traza;
- contradicción y desactivación silenciosa;
- fallo cerrado de físico y canónico;
- rederivación independiente desde las autoridades actuales.

La focal independiente C2-R1 añade 26/26 pruebas sin relajar ni modificar las 42 originales:

| Matriz C2-R1 | Casos reales |
| --- | ---: |
| Coherencia negativa de motivos: bloque, paso, ambos, ausencias, inyecciones y contradicciones cruzadas | 9/9 |
| Positivos: revisita correcta `exact`, revisita correcta `beam`, ausencia de revisita y motivos legacy con C2 OFF | 4/4 |
| Estructura de ejecución: paso duplicado, paso eliminado, objeto desconocido e ID duplicado con contenido distinto | 4/4 |
| Integridad: huella aislada, retirada conjunta, C2 OFF con estado y retirada individual de contrato/marcador/evaluación/traza | 7/7 |
| Autocertificación coherente adversaria: precedencia y conservación del hilo ready | 2/2 |
| **Total focal C2-R1** | **26/26** |

Los nueve negativos de motivos verifican validación directa y C2 inválidas, acreditación no aceptada, cero disposiciones físicas, paths, puntos y puntadas, y cero comandos canónicos. Las manipulaciones restantes exigen igualmente causa explícita, fallo cerrado y propagación plana. En los dos intentos de autocertificación se recompusieron contrato, huella, marcador, evaluación, traza y metadata con referencias internas coherentes; la rederivación desde la ejecución actual detectó pese a ello la infracción de precedencia o de continuidad.

La ampliación C2-R2 dentro del mismo archivo añade 26/26 casos:

| Matriz C2-R2 | Casos reales |
| --- | ---: |
| Negativos aislados de `threadBlockId` recibido: falsificado, nulo, ausente, otro bloque real e intercambio entre pasos | 5/5 |
| Negativos aislados del bloque: ID, hilo, objeto añadido/eliminado/duplicado/reordenado/movido y bloque añadido/eliminado | 9/9 |
| Identidad aislada de execution step: ID desconocido, objeto desconocido e ID de otro paso | 3/3 |
| Motivo dependency-gated cambiado a `null` | 1/1 |
| Autocertificación completa posterior a `threadBlockId` falsificado | 1/1 |
| Positivos y límites: bloque único/múltiple, cambio sin revisita, revisita, tres hilos, `exact`, `beam`, configuración reutilizada, C2 OFF y legacy | 7/7 |
| **Total focal C2-R2** | **26/26** |

Cada negativo alcanza la validación C2 y comprueba error específico, plan inválido, cero disposiciones físicas aceptadas, cero paths/puntos/puntadas y cero comandos canónicos. Los casos de ID desconocido y objeto desconocido son mutaciones independientes.

## Paridad nominal ON/OFF

Las pruebas comparan C2 OFF y C2 ON y confirman igualdad nominal en:

- objetos de entrada;
- geometría y huecos;
- colores visuales y `threadId`;
- roles y técnicas;
- orden y pasos;
- selecciones, transiciones y bloques;
- paths y puntadas físicas;
- comandos canónicos.

C2 ON añade únicamente acreditación experimental. No cambia el desempate del scheduler para crear una diferencia artificial.

## Resultados reales

| Comprobación | Resultado real |
| --- | --- |
| Focal C2 original | 1 archivo, 42/42 pruebas |
| Focal C2-R1 | 1 archivo, 26/26 pruebas |
| Focal C2-R2 | 1 archivo, 26/26 pruebas |
| Archivo focal C2-R1/R2 completo | 1 archivo, 52/52 pruebas |
| Focal C1+C2+C2-R1+C2-R2 y registro | 5 archivos, 268/268 pruebas |
| Focal C1 y registro | 3 archivos, 174/174 pruebas |
| Consumidores de secuencia ampliados | 14 archivos, 302/302 pruebas |
| A/B, fidelidad, corpus y registro | 4 archivos, 107/107 pruebas |
| Engine V2 completo, `--testTimeout=30000` | 145 archivos, 3624/3624 pruebas |
| Suite completa, `--testTimeout=30000` | 145 archivos, 3624/3624 pruebas |
| ESLint final de JavaScript afectados | 16 archivos, 0 errores |
| Whitespace y `git diff --check` final | correctos |

La matriz negativa C1 permanece 70/70, sus positivos 6/6 y las referencias C7/C8/C11/C12 siguen cubiertas por las focales C1. A/B conserva sus 16 combinaciones, legacy y C OFF.

## Inventario

Tracked modificados:

- `src/lib/engineV2/__tests__/hatchCContourLastIntegration.test.js`
- `src/lib/engineV2/__tests__/hatchEvidenceRegistry.test.js`
- `src/lib/engineV2/index.js`
- `src/lib/engineV2/rules/hatchEvidence/index.js`
- `src/lib/engineV2/rules/hatchEvidence/overlapProfiles.js`
- `src/lib/engineV2/rules/hatchEvidence/overlaps.js`
- `src/lib/engineV2/rules/hatchEvidence/registry.js`
- `src/lib/engineV2/sequencing/globalSequencePlanner.js`
- `src/lib/engineV2/sequencing/sequencePlanningConfig.js`
- `src/lib/engineV2/sequencing/sequencePlanningDiagnostics.js`
- `src/lib/engineV2/sequencing/sequencePlanningModel.js`
- `src/lib/engineV2/sequencing/sequencePlanningValidation.js`

Nuevos:

- `src/lib/engineV2/HATCH_C2_COLOR_GROUP_HEURISTIC_INTEGRATION_REPORT.md`
- `src/lib/engineV2/__tests__/fixtures/hatchCColorGroupFixtures.js`
- `src/lib/engineV2/__tests__/hatchCColorGroupHeuristicIntegration.test.js`
- `src/lib/engineV2/__tests__/hatchCColorGroupHeuristicR1.test.js`
- `src/lib/engineV2/rules/hatchEvidence/colorGroupHeuristic.js`

Total: 17 archivos —12 tracked modificados y 5 nuevos—, todos bajo Engine V2.

C2-R1 y C2-R2 modificaron dentro de ese conjunto acumulado exactamente los mismos tres archivos autorizados:

- `src/lib/engineV2/HATCH_C2_COLOR_GROUP_HEURISTIC_INTEGRATION_REPORT.md`;
- `src/lib/engineV2/__tests__/hatchCColorGroupHeuristicR1.test.js`;
- `src/lib/engineV2/rules/hatchEvidence/colorGroupHeuristic.js`.

## Límites

C2 no demuestra sew-out ni una mejora física. No existe evidencia física nueva, y no se afirma una reducción real de cambios de color en máquina. La implementación acredita que el orden nominal ya producido respeta la prioridad del DAG y la continuidad de hilo definida; no modifica geometría, huecos, recortes, objetos, colores, roles, técnicas, puntadas, underlay, coordenadas, comandos ni binarios.

## Estado Git previo al checkpoint administrativo

Estado verificado antes del staging controlado: rama `engine-v2`, HEAD y `origin/engine-v2` en `1bb2e5b7b4e75a252b60c34a76097769d90663ca`, divergencia `+0/-0`, 12 tracked modificados y 5 nuevos, total 17, staging vacío.

La única modificación posterior a la auditoría independiente final fue este cierre administrativo del informe. El cierre autoriza un único checkpoint local separado de C1; no autoriza push, rebase, merge, tag ni amend.
