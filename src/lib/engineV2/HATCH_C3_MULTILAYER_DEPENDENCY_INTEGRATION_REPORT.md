# Hatch C3 — integración experimental de precedencia multicapa

## Estado

`MULTILAYER-DEPENDENCY-001` queda aprobado técnicamente como guard experimental parcial con `scope:"precedence_only"`, OFF por defecto, sin activación productiva y con cero bloqueos técnicos pendientes. La auditoría independiente final C3‑R2 fue superada y no hace falta otra ronda técnica. C3‑R1 y C3‑R2 se conservan a continuación como historial de hallazgos corregidos y cerrados.

Base de trabajo:

- rama `engine-v2`;
- HEAD y upstream: `de27c61245e1bba9214f2f70599d3e5bc613a196`;
- divergencia: `+0/-0`;
- C1 y C2 publicados, experimentales y OFF por defecto;
- staging vacío;
- ningún staging, commit, push, rebase, merge, tag ni amend durante C3, C3‑R1 o C3‑R2.

## Alcance acreditable

C3 acredita exclusivamente precedencia digital:

```text
scope: "precedence_only"
cutoutEvaluated: false
cutoutCorrectnessClaimed: false
orderModified: false
dependenciesModified: false
geometryModified: false
physicalImprovementClaimed: false
```

Una claim exige participantes núcleo automáticos y stitchables, relaciones `contains` canónicas, al menos tres participantes y un camino canónico de al menos dos aristas. `inner_outline` y `outer_outline` siguen delegados a C1 y no cuentan para el mínimo C3.

C3 no implementa recortes, booleanas geométricas, oclusión, underlap, selección de técnica, densidad, puntadas, comandos ni DST/DSB. No existe sew-out ni demostración de mejora física, registro o densidad.

## Hallazgo histórico corregido 1 — autoridad regional downstream

### Reproducción

Un C12 válido se secuenciaba con C3 ON. Después se modificaba el hueco de la región verde para eliminar la contención y se entregaban esas regiones actuales a los consumidores. La validación downstream podía omitir `regions`; el evaluador reconstruía entonces una instantánea regional desde la geometría almacenada en objetos y los artefactos previos podían aparentar vigencia.

### Causa

`authoritativeRegions` aceptaba `regions === undefined` y sintetizaba regiones desde objetos. Además, las validaciones internas física y orquestada volvían a llamar `validateGlobalSequencePlan` sin transportar la autoridad regional recibida por la invocación.

### Corrección C3‑R1

- C3 ON exige el array actual y explícito de `RegionV2`.
- Ausencia, `undefined`, `null`, no-array, array incompleto o región malformada producen `MULTILAYER_AUTHORITATIVE_REGIONS_MISSING`.
- No se reconstruyen regiones desde objetos, planes, contratos ni metadata.
- La coherencia de huecos entre el `RegionV2` actual y el objeto participante se comprueba explícitamente.
- `physicalStitchPipeline`, `canonicalCommandCompiler` y los call sites internos estrictamente necesarios transportan `regions` a `validateGlobalSequencePlan`.
- C3 OFF no adquiere ningún requisito C3 nuevo; la validación de secuencia y el consumidor físico conservan la ruta anterior sin regiones. La validación técnica previa del compilador mantiene su conducta legacy propia cuando no recibe regiones.

La reproducción versionada exige validación C3 inválida, contrato almacenado obsoleto, físico inválido con cero disposiciones, paths, subpaths, puntos y puntadas, y compilación inválida con cero comandos.

## Hallazgo histórico corregido 2 — aplicabilidad y alcance de claims

### Reproducción

Dos participantes núcleo automáticos, geométricamente desconectados y sin cadena `contains`, con una dependencia directa entre ellos, eran rechazados por C3 con `MULTILAYER_COMPONENT_MISMATCH` aunque no existía claim C3 aplicable.

### Causa

C3 inspeccionaba componentes, aristas y ciclos de todos los objetos núcleo antes de derivar los componentes reclamables. Las dependencias almacenadas podían influir en una decisión que debía pertenecer al DAG general fuera de C3.

### Corrección C3‑R1

1. Los participantes, el grafo `contains` y las aristas esperadas se rederivan primero desde autoridad semántica y geométrica actual.
2. La proyección entregada a `buildEmbroideryProposalDependencies` vacía deliberadamente `dependencyIds`; las dependencias almacenadas no deciden la aplicabilidad.
3. Los claims se identifican antes de inspeccionar aristas recibidas.
4. Duplicados, dirección, aristas requeridas o inesperadas, componentes y ciclos C3 se limitan al subgrafo inducido por los participantes reclamados.
5. El DAG y los validadores generales conservan autoridad sobre dependencias y ciclos externos.

La reproducción de dos participantes desconectados queda `not_applicable`, con cero claims y sin causa `MULTILAYER_COMPONENT_MISMATCH`. Un claim C12 válido ignora una dependencia o un ciclo totalmente externos; las aristas ausentes, invertidas, transitivas directas, inesperadas y los ciclos internos siguen bloqueando.

`dependencyPlanner.js` y el scheduler nominal no fueron modificados.

## Hallazgo histórico corregido C3‑R2 — integridad estructural de RegionV2

### Reproducción exacta

Sobre una cadena sintética C3 válida de tres niveles se sustituyó la segunda región mediante:

```js
const malformed = Object.assign([], structuredClone(validRegion));
regions[1] = malformed;
```

La prueba confirma literalmente `Array.isArray(regions[1]) === true`. Antes de C3‑R2, el array podía presentar propiedades con forma regional y atravesar las comprobaciones basadas solo en campos, degradando una cadena aplicable a una clasificación sin acreditación suficiente.

La reproducción se ejecuta por dos recorridos independientes:

1. planificación C3 nueva con la región malformada, sin contrato válido previo;
2. entrega downstream de la misma entrada a un plan C3 previamente válido, cuyos artefactos almacenados quedan obsoletos y no acreditados.

Ambos recorridos producen `MULTILAYER_AUTHORITATIVE_REGIONS_MISSING` en `regions[1]`, estado `blocked`, `applied:false`, `evaluatorInvoked:true`, cero claims y contrato nuevo nulo. La planificación nueva queda inválida y atómica; el físico queda inválido con cero disposiciones, paths, puntos y puntadas; el canónico queda inválido con cero comandos. El primer recorrido no depende de `MULTILAYER_CONTRACT_STALE`, por lo que acredita la región no plain object como causa raíz.

### Causa y corrección

`authoritativeRegions` comprobaba campos y `validateRegionV2`, pero no exigía primero que cada elemento fuera un objeto plano real. Tampoco cerraba completamente la identidad de la colección antes del grafo, lo que dejaba pasar representaciones con identidad estructural impropia.

C3‑R2 valida toda la colección antes de construir el grafo, derivar componentes, decidir aplicabilidad, calcular claims o acreditar un contrato:

- el contenedor debe ser el array regional explícito;
- con participantes C3 presentes, el array no puede estar vacío;
- cada elemento debe ser un objeto no nulo, no array y con prototipo `Object.prototype` o `null`;
- se rechazan arrays con propiedades añadidas, instancias de clases, prototipos personalizados o ajenos, `null`, números, strings, booleanos y funciones;
- el ID canónico de `RegionV2`, campo propio `id`, debe ser string no vacío y único, sin coerción, reconstrucción, descarte ni deduplicación silenciosa;
- la comprobación de plain object precede a `validateRegionV2`;
- geometría, huecos y validación completa de `RegionV2` conservan sus autoridades existentes;
- cualquier fallo estructural o de identidad conserva como código primario `MULTILAYER_AUTHORITATIVE_REGIONS_MISSING`, con path, índice, `regionId` legible sin coerción, motivo y evidencia plana.
- ninguna entrada inválida puede degradarse silenciosamente a un estado satisfactorio `not_applicable`.

La definición implementada acepta objetos con prototipo nulo porque satisface el predicado documentado y `validateRegionV2` los admite. Existe un positivo específico que acredita esa decisión. El caso histórico de cero regiones y cero participantes conserva el `not_applicable` original; un array vacío frente a participantes C3 reales se bloquea.

C3 OFF no invoca el evaluador experimental ni adquiere errores `MULTILAYER_*` nuevos. No se modificaron consumidores, orquestador, scheduler, planificador general, C1/C2 ni propagación de errores durante C3‑R2.

## Autoridad, contrato y atomicidad

La autoridad actual se rederiva con `buildRegionGraphV2` y `buildEmbroideryProposalDependencies`. El contrato, su huella, el marcador, la evaluación y la traza son evidencia verificable, no autoridad.

C3‑R1 recompone de forma adversaria todos esos artefactos después de introducir por separado:

1. una arista requerida invertida;
2. una arista transitiva almacenada como directa;
3. una secuencia invertida;
4. regiones actuales incompatibles después de secuenciar.

Cada variante conserva una causa C3 explícita por etapa, propagación plana, serialización determinista, idempotencia y cero salida física o canónica.

La nulidad atómica bloquea pasos, selecciones, transiciones, thread blocks, disposiciones físicas, paths, puntos, puntadas y comandos. No se acepta salida parcial.

## Matriz adversaria versionada

La evidencia C3 original conserva sin cambios 97 casos. C3‑R1 conserva sus 45 casos, que cubren literalmente:

- `regions` ausente, `undefined`, `null`, no-array, incompleto, malformado y copia estructural válida;
- C3 OFF sin autoridad regional C3;
- cambio del hueco verde después de secuenciar y rechazo por ambos consumidores;
- dos participantes desconectados con dependencia y cero claims;
- dependencia y ciclo externos ignorados por C3;
- arista obligatoria ausente, invertida, inesperada/transitiva y ciclo interno;
- autocertificación recompuesta para las cuatro mutaciones enumeradas;
- participantes, componentes, cierre transitivo y posiciones manipulados con huella recompuesta;
- `cutoutEvaluated`, `cutoutCorrectnessClaimed`, `physicalImprovementClaimed`, `orderModified`, `dependenciesModified` y `geometryModified`;
- `regionId` realmente eliminado, vacío, alterado, no textual y duplicado;
- flag C3 `undefined` y `null`, ambos rechazados explícitamente;
- thread block incompatible;
- ID de execution step desconocido;
- objeto de ejecución desconocido como caso separado;
- IDs genuinamente no topológicos;
- entrada regional y de objetos invertida;
- cadenas reales de 3, 4, 5 y 6 niveles;
- componentes desconectados;
- fork con autoridad geométrica real;
- diamante real de C12 producido por el planner y delegado terminalmente a C1;
- `exact`, `beam`, configuración resuelta reutilizada y dos ejecuciones deterministas;
- paridad de objetos, dependencias, pasos, thread blocks, geometría, huecos, roles, técnicas, paths, puntos, puntadas, comandos y hashes físicos y canónicos.

C3‑R2 añade 29 pruebas. Su matriz negativa aislada contiene 19 casos separados:

1. propiedad `regions` ausente;
2. `regions` explícitamente `undefined`;
3. contenedor `null`;
4. contenedor numérico;
5. contenedor string;
6. objeto no array;
7. array vacío frente a participantes C3;
8. región array con todas las propiedades válidas añadidas;
9. instancia de clase con campos válidos;
10. objeto con prototipo personalizado;
11. región `null`;
12. región numérica;
13. región string;
14. región booleana;
15. región función;
16. ID propio eliminado;
17. ID vacío;
18. ID no textual;
19. dos plain objects con ID duplicado.

Cada caso acredita el evaluador y la validación global. Número regional, string regional, array vacío, región no plain object e ID duplicado alcanzan además planificación nueva, físico y canónico con nulidad atómica completa. Se añaden por separado los dos recorridos de la reproducción literal, C3 OFF sin autoridad experimental nueva, plain objects y clon estructural equivalentes, y la aceptación documentada de un `RegionV2` con prototipo nulo.

El diamante no se inyecta: C12 con C1 ON produce verde→blanco→naranja y el contorno negro depende de los tres rellenos mediante la autoridad real de C1. C3 acredita solo el núcleo y registra negro como auxiliar delegado.

También permanecen cubiertos C12 nominal verde→blanco→naranja, retirada blanco→verde en draft y objeto final, las ocho combinaciones C1/C2/C3, C3 OFF sin artefactos, legacy, C1 y C2 intactas e independientes, las otras cinco reglas C y D–G inactivas, A/B estable, fidelidad, corpus, scheduler nominal intacto y la deuda separada `MISSING_INITIAL_POSITION_COMMAND` sin cambios.

## Resultados reales

| Comprobación | Resultado real |
| --- | --- |
| C3 original, filtro `^Hatch C3(?!-R[12])` | 1 archivo, 97/97 |
| C3‑R1, filtro `^Hatch C3-R1` | 1 archivo, 45/45 |
| C3‑R2, filtro `^Hatch C3-R2` | 1 archivo, 29/29 |
| Regresiones C3‑R1 específicas | 1 archivo, 2/2 |
| C3 completo | 1 archivo, 171/171 |
| C3 y registro | 2 archivos, 198/198 |
| C1+C2+C3 y registro | 6 archivos, 439/439 |
| Consumidores físicos y canónicos | 19 archivos, 363/363 |
| A/B, fidelidad, corpus y registro | 4 archivos, 107/107 |
| Engine V2 completo, `--testTimeout=30000` | 146 archivos, 3795/3795 |
| Suite completa, `--testTimeout=30000` | 146 archivos, 3795/3795 |
| ESLint de JavaScript acumulados afectados | 18 archivos, sin errores |
| Whitespace | 19/19 archivos correctos |
| `git diff --check` | correcto |
| `git diff --cached --check` | correcto |
| Inventario acumulado | 19 archivos: 16 tracked modificados y 3 nuevos |
| Fuera de Engine V2 | 0 |
| DST/DSB creados o modificados | 0 |
| Staging | vacío |

## Lote reproducible de consumidores

Comando ejecutado:

```powershell
npx vitest run src/lib/engineV2/__tests__/canonicalCommandCompiler.test.js src/lib/engineV2/__tests__/canonicalCommandId.test.js src/lib/engineV2/__tests__/canonicalCompilationConfig.test.js src/lib/engineV2/__tests__/canonicalCompilationDiagnostics.test.js src/lib/engineV2/__tests__/canonicalCompilationModel.test.js src/lib/engineV2/__tests__/canonicalCompilationValidation.test.js src/lib/engineV2/__tests__/objectCommandCompiler.test.js src/lib/engineV2/__tests__/threadBlockCommandCompiler.test.js src/lib/engineV2/__tests__/physicalGenerationConfig.test.js src/lib/engineV2/__tests__/physicalStitchDiagnostics.test.js src/lib/engineV2/__tests__/physicalStitchModel.test.js src/lib/engineV2/__tests__/physicalStitchPipeline.test.js src/lib/engineV2/__tests__/physicalStitchValidation.test.js src/lib/engineV2/__tests__/physicalUnderlayGenerator.test.js src/lib/engineV2/__tests__/runningStitchGenerator.test.js src/lib/engineV2/__tests__/satinStitchGenerator.test.js src/lib/engineV2/__tests__/stitchGeometry.test.js src/lib/engineV2/__tests__/stitchLengthDistribution.test.js src/lib/engineV2/__tests__/tatamiStitchGenerator.test.js --reporter=dot
```

Inventario exacto:

- `canonicalCommandCompiler.test.js`;
- `canonicalCommandId.test.js`;
- `canonicalCompilationConfig.test.js`;
- `canonicalCompilationDiagnostics.test.js`;
- `canonicalCompilationModel.test.js`;
- `canonicalCompilationValidation.test.js`;
- `objectCommandCompiler.test.js`;
- `threadBlockCommandCompiler.test.js`;
- `physicalGenerationConfig.test.js`;
- `physicalStitchDiagnostics.test.js`;
- `physicalStitchModel.test.js`;
- `physicalStitchPipeline.test.js`;
- `physicalStitchValidation.test.js`;
- `physicalUnderlayGenerator.test.js`;
- `runningStitchGenerator.test.js`;
- `satinStitchGenerator.test.js`;
- `stitchGeometry.test.js`;
- `stitchLengthDistribution.test.js`;
- `tatamiStitchGenerator.test.js`.

## Inventario acumulado

Tracked modificados:

- `src/lib/engineV2/__tests__/hatchCColorGroupHeuristicIntegration.test.js`;
- `src/lib/engineV2/__tests__/hatchCContourLastIntegration.test.js`;
- `src/lib/engineV2/__tests__/hatchEvidenceRegistry.test.js`;
- `src/lib/engineV2/commandCompilation/canonicalCommandCompiler.js`;
- `src/lib/engineV2/index.js`;
- `src/lib/engineV2/orchestration/regionToBinaryOrchestrator.js`;
- `src/lib/engineV2/rules/hatchEvidence/index.js`;
- `src/lib/engineV2/rules/hatchEvidence/overlapProfiles.js`;
- `src/lib/engineV2/rules/hatchEvidence/overlaps.js`;
- `src/lib/engineV2/sequencing/globalSequencePlanner.js`;
- `src/lib/engineV2/sequencing/sequencePlanningDiagnostics.js`;
- `src/lib/engineV2/sequencing/sequencePlanningModel.js`;
- `src/lib/engineV2/sequencing/sequencePlanningValidation.js`;
- `src/lib/engineV2/stitchGeneration/physicalStitchDiagnostics.js`;
- `src/lib/engineV2/stitchGeneration/physicalStitchPipeline.js`;
- `src/lib/engineV2/stitchGeneration/physicalStitchValidation.js`.

Nuevos:

- `src/lib/engineV2/HATCH_C3_MULTILAYER_DEPENDENCY_INTEGRATION_REPORT.md`;
- `src/lib/engineV2/__tests__/hatchCMultilayerDependencyIntegration.test.js`;
- `src/lib/engineV2/rules/hatchEvidence/multilayerDependency.js`.

Total acumulado: 19 archivos, todos bajo `src/lib/engineV2/`.

## Archivos modificados por C3‑R1

C3‑R1 modificó exclusivamente:

- `src/lib/engineV2/rules/hatchEvidence/multilayerDependency.js`;
- `src/lib/engineV2/stitchGeneration/physicalStitchPipeline.js`;
- `src/lib/engineV2/stitchGeneration/physicalStitchValidation.js`;
- `src/lib/engineV2/stitchGeneration/physicalStitchDiagnostics.js`;
- `src/lib/engineV2/commandCompilation/canonicalCommandCompiler.js`;
- `src/lib/engineV2/orchestration/regionToBinaryOrchestrator.js`;
- `src/lib/engineV2/__tests__/hatchCMultilayerDependencyIntegration.test.js`;
- `src/lib/engineV2/HATCH_C3_MULTILAYER_DEPENDENCY_INTEGRATION_REPORT.md`.

Los cinco call sites adicionales solo transportan `regions` y conservan la validación previa; no cambian algoritmos físicos, generación de puntadas, compilación de comandos ni salida válida.

## Archivos modificados por C3‑R2

C3‑R2 modificó exclusivamente:

- `src/lib/engineV2/rules/hatchEvidence/multilayerDependency.js`;
- `src/lib/engineV2/__tests__/hatchCMultilayerDependencyIntegration.test.js`;
- `src/lib/engineV2/HATCH_C3_MULTILAYER_DEPENDENCY_INTEGRATION_REPORT.md`.

No fue necesario modificar ningún consumidor, orquestador, scheduler, planificador general, C1/C2, propagación de errores ni un cuarto archivo. El inventario acumulado permanece en 19 archivos.

Permanecen intactos `dependencyPlanner.js`, `dependencyAwareScheduler.js`, `errorPropagation.js`, evaluadores y contratos C1/C2, materialización, planificación técnica, fixture C12, Base44, CE01, exportadores, encoders y algoritmos geométricos.

## Estado Git final

- rama `engine-v2`;
- HEAD y `origin/engine-v2`: `de27c61245e1bba9214f2f70599d3e5bc613a196`;
- divergencia `+0/-0`;
- 16 tracked modificados y 3 nuevos, todos bajo Engine V2;
- staging vacío;
- cero archivos fuera de Engine V2;
- cero DST/DSB creados o modificados;
- sin commit ni push.

C3 queda aprobado técnicamente como guard experimental parcial `precedence_only`, OFF por defecto y sin activación productiva. C3‑R1 y C3‑R2 permanecen como historial técnico corregido; la auditoría independiente final fue superada, no existen bloqueos técnicos pendientes y no hace falta otra ronda técnica.
