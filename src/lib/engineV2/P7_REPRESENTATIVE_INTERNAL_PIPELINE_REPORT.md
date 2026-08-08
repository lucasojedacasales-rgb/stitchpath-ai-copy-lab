# P7 — Representative Internal Pipeline Corpus

## Alcance

P7 valida el pipeline interno completo de Engine V2 con geometría sintética y
determinista inspirada únicamente en la complejidad estructural de un diseño
multicapa. No integra imágenes, personajes, EMB, DST ni DSB, y no pretende
reproducir geometría protegida, un sew-out ni un conteo físico de puntadas.

La fase añade exclusivamente:

- `fixtures/representativeInternalPipelineFixture.js`;
- `__tests__/internalPipelineRepresentative.test.js`;
- `P7_REPRESENTATIVE_INTERNAL_PIPELINE_REPORT.md`.

No modifica P0–P6, el API público, el pipeline, la fixture mínima, reglas Hatch,
Base44, exportadores, adaptadores, encoders ni configuración de paquetes.

## Corpus sintético

La fixture contiene siete regiones poligonales sencillas:

- tres regiones de la cadena multicapa relleno A → relleno B → detalle A;
- un relleno solapado y un detalle interior asociado;
- dos contornos explícitos separados;
- seis colores exactos, con A repetido en dos bloques no consecutivos;
- regiones exteriores, interiores, solapadas y contenidas.

La cadena de dependencias obliga a abandonar y revisitar el hilo A. C1 se activa
solo dentro de la fixture mediante el guard experimental existente para acreditar
que los contornos se secuencian después de sus rellenos asociados. C2 y C3
permanecen inactivos. La configuración física experimental permanece desactivada.

## Diagnóstico P7-D1

La primera ejecución de P7 falló en `objectPlanning`. Los dos contornos elegibles
pertenecían al mismo componente conectado y, al no existir asociaciones explícitas
por IDs, C1 aplicó su asociación conservadora por componente. Ambos contornos
reclamaron dependencias compartidas y el guard bloqueó el plan con:

`CONTOUR_LAST_MULTIPLE_CONTOUR_ASSOCIATION_AMBIGUOUS`

P7-D1 clasificó el problema como defecto de fixture y descartó un defecto del
runtime. También descartó que A₁ → B → A₂ fuese un ciclo: son tres objetos
distintos, aunque A₁ y A₂ comparten color.

## Corrección P7-F1

La geometría se separó en dos componentes sin contacto, solape ni conexión
transitiva:

- componente 1: contorno exterior, relleno A₁, relleno B y detalle A₂;
- componente 2: relleno secundario, contorno interior y highlight.

El segundo componente conserva un solape local válido entre el highlight y el
contorno interior. Cada componente tiene exactamente un contorno elegible, por
lo que las asociaciones conservadoras de C1 ya no comparten dependencias. No se
añadió `proposal.source.contourDependencyAssociation` ni plumbing productivo.

## Cobertura P7

La suite contiene exactamente ocho pruebas:

1. finalización de las diez etapas en `documentValidation`;
2. validez de `EngineDocumentV2`;
3. seis hilos, siete bloques y una revisita no consecutiva;
4. dependencias multicapa y contornos posteriores al relleno;
5. determinismo e inmutabilidad;
6. comandos `stitch` y un único `end` final;
7. flag físico experimental desactivado;
8. ausencia de adaptación, encoding, DST, DSB y artefactos binarios.

## Verificación

La única ejecución autorizada de Vitest se realizó el 27 de julio de 2026 y
activó la condición de parada de P7:

- suites: 9 aprobadas y 1 fallida de 10;
- pruebas: 498 aprobadas y 7 fallidas de 505;
- suite fallida: `__tests__/internalPipelineRepresentative.test.js`;
- duración: 15.57 s;
- advertencias Vitest: 0.

La prueba de determinismo e inmutabilidad fue la única prueba P7 aprobada. Las
otras siete fallaron porque la ejecución representativa devolvió `valid:false`
antes de producir `document`, `documentValidation`, `physicalGeneration` y sus
contratos posteriores. El reporter de la ejecución no imprimió `terminalStage`
ni `errors`, por lo que esta evidencia no atribuye una etapa causal sin una
ejecución adicional, expresamente prohibida tras el fallo.

Después de ese fallo inicial no se corrigió el runtime, la fixture ni las pruebas
y no se realizó una segunda ejecución dentro de P7. P7 quedó entonces sin aprobar
y conservó la evidencia para el diagnóstico estático P7-D1.

## Resultado P7-F1

La única ejecución autorizada de Vitest para P7-F1 se realizó el 27 de julio de
2026 y no aprobó la fase:

- suites: 9 aprobadas y 1 fallida de 10;
- pruebas: 497 aprobadas y 8 fallidas de 505;
- suite fallida: `__tests__/internalPipelineRepresentative.test.js`;
- duración: 15.04 s;
- advertencias Vitest: 0.

Las ocho pruebas P7 fallaron en la comprobación fail-fast con la misma evidencia:

- `terminalStage: "canonicalCompilation"`;
- error: `PHYSICAL_PATH_MISSING`;
- objeto: `object:proposal:p7-repeated-color-detail:internal_detail`.

La llegada a `canonicalCompilation` acredita que la separación P7-F1 eliminó el
bloqueo anterior de `objectPlanning`. La nueva incompatibilidad aparece después
de `physicalGeneration`, cuando la compilación canónica requiere un path físico
para el detalle interior de color repetido.

Conforme a la condición de parada, no se corrigió ningún archivo después del
fallo ni se realizó una segunda ejecución. P7 permanece sin aprobar.

## Diagnóstico P7-D2

La inspección estática trazó el segundo bloqueo hasta el detalle interior de
color repetido. La región `p7-repeated-color-detail`, clasificada como `detail`,
producía un objeto `internal_detail` con técnica `satin`. Su sección física
efectiva medía 7,2 mm frente al máximo permitido de 7 mm. La cadena causal fue:

`SATIN_WIDTH_ABOVE_MAXIMUM`
→ `PHYSICAL_GENERATOR_FAILED`
→ `PHYSICAL_PATH_MISSING`

P7-D2 clasificó la incompatibilidad como defecto de fixture. El objeto no era
auxiliar, vacío ni degenerado, y no se requirió modificar el runtime.

## Corrección P7-F2

La misma región conserva su ID `p7-repeated-color-detail`, su color `#2e7d32` y
su geometría. Únicamente se sustituyó su representación semántica:

- nombre: `synthetic repeated inset fill`;
- `region_class`: `detail` → `belly`;
- semántica: `internal_feature` → `secondary_shape`;
- rol: `internal_detail` → `foreground_fill`;
- técnica: `satin` → `tatami`;
- objeto esperado:
  `object:proposal:p7-repeated-color-detail:foreground_fill`.

La corrección no altera dimensiones, límites satin, tolerancias, asociaciones
explícitas ni configuración técnica. Se conservan siete regiones, seis
colores/hilos, siete bloques, dos componentes desconectados, un contorno
elegible por componente, el solape local, los rellenos anidados y la cadena
acíclica A₁ → B → A₂ con revisita no consecutiva del hilo A.

## Resultado P7-F2

La única ejecución completa autorizada de Vitest para P7-F2 se realizó el 27 de
julio de 2026 y no aprobó la fase:

- suites: 9 aprobadas y 1 fallida de 10;
- pruebas: 504 aprobadas y 1 fallida de 505;
- suite fallida: `__tests__/internalPipelineRepresentative.test.js`;
- prueba fallida:
  `preserves six threads and seven blocks with one non-consecutive revisit`;
- duración: 16.83 s;
- advertencias Vitest: 0.

Las otras siete pruebas P7 y las 497 pruebas anteriores se aprobaron. El pipeline
representativo alcanzó `documentValidation`, produjo un documento y no devolvió
errores de pipeline. El único fallo ocurrió después, dentro de la tercera prueba:
la búsqueda de una asignación por `normalizedVisualColor` devolvió `undefined` y
el acceso posterior a `.threadId` produjo:

`TypeError: Cannot read properties of undefined (reading 'threadId')`

No hubo un objeto físico bloqueado ni reaparecieron
`SATIN_WIDTH_ABOVE_MAXIMUM`, `PHYSICAL_GENERATOR_FAILED` o
`PHYSICAL_PATH_MISSING`. Conforme a la condición de parada, no se modificó la
fixture, la prueba ni el runtime después del fallo y no se realizó una segunda
ejecución. P7 permanece sin aprobar.

## Corrección P7-F3

P7-F3 corrige exclusivamente la identificación contractual del hilo repetido en
la tercera prueba. La búsqueda cromática mediante `normalizedVisualColor` se
sustituye por las identidades estructurales de las regiones A₁ y A₂:

- A₁: `p7-base-fill`;
- A₂: `p7-repeated-color-detail`.

Cada identidad localiza su `DraftThreadAssignmentV2` mediante el campo público
`regionId`. La prueba exige que ambas asignaciones existan antes de consultar
`threadId`, que compartan hilo, que ese hilo figure en el catálogo y que sus dos
bloques contengan respectivamente los objetos finales asociados a A₁ y A₂.
También exige un bloque de otro hilo entre ambos y acredita la revisita mediante
`repeatedThreadReason: "dependency_gated_revisit"`.

La fixture P7 permanece byte a byte intacta y no se añade ninguna propiedad al
runtime.

## Resultado P7-F3

La única ejecución completa autorizada de Vitest para P7-F3 se realizó el 27 de
julio de 2026 y aprobó la fase:

- suites: 10 aprobadas de 10;
- pruebas: 505 aprobadas de 505;
- pruebas P7: 8 aprobadas de 8;
- fallos: 0;
- duración: 15.59 s;
- advertencias Vitest: 0.

La tercera prueba acreditó seis hilos, siete bloques, una única revisita de hilo
y dos bloques no consecutivos para A₁ y A₂, con al menos un bloque de otro hilo
entre ambos. Las asignaciones se resolvieron por `regionId`, compartieron
`threadId`, el hilo existió en el catálogo y el segundo bloque conservó
`repeatedThreadReason: "dependency_gated_revisit"`.

P7 queda técnicamente aprobada como corpus sintético representativo del pipeline
interno. Esta aprobación no incorpora imágenes, EMB, DST, DSB, adaptación de
máquina, encoding, artefactos binarios, geometría protegida, sew-out ni
demostración de mejora física.
