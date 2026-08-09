# HATCH A/B R02 — métricas numéricas aisladas de Engine V2

## Alcance

R02 mide de forma determinista el efecto lógico y computacional de las cuatro reglas Hatch A/B ya integradas. El recorrido cubierto es:

1. ingestión;
2. planificación de propuestas;
3. materialización de borradores y objetos con hilo;
4. planificación técnica;
5. secuenciación global;
6. generación física independiente de máquina;
7. compilación canónica previa a exportación.

No se ejecutan adaptadores de máquina, exportadores, DST, DSB ni encoders binarios. No se evalúa calidad física del bordado.

## Historial de verificación

### Ejecución efectiva R02 previa

Comando:

```text
npm run test:engine-v2 -- src/lib/engineV2/__tests__/hatchABR02Metrics.test.js src/lib/engineV2/__tests__/hatchABExperimentalIntegration.test.js src/lib/engineV2/__tests__/hatchABPlanningCorpus.test.js
```

Resultado:

- Código de salida: `0`.
- Suites: `3/3` aprobadas.
- Pruebas: `65/65` aprobadas.
- Duración Vitest: `6.50 s`.

Antes de esa ejecución efectiva hubo un intento inicial dentro del sandbox que terminó durante el arranque con `spawn EPERM`, antes de cargar la configuración de Vitest y sin ejecutar suites ni pruebas. La ejecución efectiva R02 se realizó una sola vez fuera de esa restricción.

### Intento R02-F1 del 9 de agosto de 2026

Tras añadir las expectativas literales y las dos proyecciones regionales se invocó exactamente una vez el mismo comando prescrito. Resultado:

- Código de salida del proceso: `1`.
- Fallo: `spawn EPERM` durante `failed to load config from .../vitest.engine-v2.config.js`.
- Vitest no terminó de cargar su configuración.
- Suites cargadas: `0`.
- Pruebas ejecutadas: `0`.
- No se realizó ningún reintento automático de aquella invocación.

Este incidente queda conservado como antecedente de infraestructura. Cargó cero suites, ejecutó cero pruebas y ya no bloquea R02.

### Verificación efectiva R02-F1 posterior

Una ejecución efectiva posterior verificó la corrección R02-F1 completa. Resultado:

- Código de salida: `0`.
- Vitest: `v4.1.10`.
- Inicio: `04:52:01`.
- Duración: `5.53 s`.
- Suites: `3/3` aprobadas.
- Pruebas: `65/65` aprobadas.
- Fallos: `0`.
- Prueba R02: `1/1` aprobada.

La prueba R02 ejecutó los ocho brazos dos veces y validó las expectativas literales, los deltas frente a LEGACY, las proyecciones regionales intrínseca y global, los hashes completos acreditados y el hash común de geometría.

## Corpus sintético principal

| Región | Rol controlado | Geometría |
|---|---|---|
| `corpus-satin` | `internal_feature` | Rectángulo de `8 × 16 mm` |
| `corpus-local` | `internal_feature` | Rectángulo de `6 × 15 mm` |
| `corpus-hole-safe` | `primary_shape` | `25 × 25 mm`, hueco cuadrado de `1.2 mm` |
| `corpus-hole-small` | `primary_shape` | `25 × 25 mm`, hueco cuadrado de `0.8 mm` |

## Configuración controlada

La prueba separa expresamente dos clases de entrada:

### Entradas operacionales comunes

- el mismo corpus sintético, geometría de entrada y roles semánticos controlados;
- diseño efectivo de `100 × 100 mm`;
- la misma configuración base de planificación, excluidos los campos Hatch experimentales;
- el mismo perfil técnico de material por defecto;
- la misma configuración técnica, secuencial, física y de compilación canónica;
- máximo técnico de satén de `9.18 mm`, salvo el control negativo explícito de `7 mm`.

`controlledConfigurationFor` normaliza estas entradas. La prueba compara la proyección `common` de cada brazo con LEGACY y fija por separado el máximo técnico esperado de cada brazo.

### Variable experimental Hatch

- `LEGACY` no recibe perfil, contexto ni flags Hatch.
- `FLAGS-OFF` recibe el perfil experimental con los cuatro flags desactivados.
- Los brazos individuales activan exclusivamente su regla correspondiente.
- `ALL-ON` activa las cuatro reglas.

`Pure Cotton` y `referenceScaleCompatible: true` solo forman parte del contexto de evidencia de los brazos Hatch. No son una propiedad común atribuida artificialmente a LEGACY.

La normalización ordena las claves de objetos y redondea los números a seis decimales antes del SHA-256. Cada brazo se calcula dos veces dentro de la prueba y ambas salidas normalizadas deben ser idénticas.

## Matriz de brazos

| Brazo | Perfil/reglas | Máximo técnico de satén |
|---|---|---:|
| `LEGACY` | Sin perfil Hatch | 9.18 |
| `FLAGS-OFF` | Perfil experimental; cuatro flags OFF | 9.18 |
| `SATIN-RANGE` | Solo `SATIN-RANGE-OBSERVED-001` | 9.18 |
| `LOCAL-WIDTH` | Solo `LOCAL-WIDTH-PROFILE-001` | 9.18 |
| `HOLE-PRESERVE` | Solo `HOLE-PRESERVE-001` | 9.18 |
| `HOLE-MIN-SIZE` | Solo `HOLE-MIN-SIZE-001` | 9.18 |
| `SATIN-NEGATIVE` | Solo `SATIN-RANGE-OBSERVED-001` | 7 |
| `ALL-ON` | Las cuatro reglas | 9.18 |

## Trazabilidad literal R02-F1

La prueba ya no depende de salida por consola para acreditar resultados. Las expectativas independientes quedan fijadas en constantes estáticas:

- `EXPECTED_ARM_METRICS`: las 33 métricas publicadas de cada uno de los ocho brazos;
- `EXPECTED_ARM_DELTAS`: todos los deltas no nulos frente a LEGACY, además de objetos vacíos explícitos para los brazos con delta cero;
- `EXPECTED_GLOBAL_REGION_RESULTS`: el desglose final completo de las 32 combinaciones brazo/región, incluidos comandos, conectores, jumps, trims y posición secuencial;
- `EXPECTED_INTRINSIC_REGION_RESULTS`: las 32 proyecciones anteriores a resecuenciación y compilación global;
- `EXPECTED_ARM_HASHES`: los ocho hashes completos acreditados;
- `EXPECTED_COMMON_GEOMETRY_HASH`: el hash común de geometría;
- `EXPECTED_REFERENCE_CORPUS_HASH`: el hash independiente de A8/C6/D6/H9;
- `EXPECTED_HATCH_TREATMENTS` y `EXPECTED_TECHNICAL_SATIN_MAXIMUM_BY_ARM`: tratamiento Hatch y máximo técnico esperados por brazo.

Cada resultado calculado se compara mediante `expect(...).toEqual(...)` o `expect(...).toBe(...)` con estas constantes. Las expectativas no se construyen a partir del resultado real de la ejecución.

## Resultados numéricos completos

Abreviaturas: `L` = LEGACY, `OFF` = FLAGS-OFF, `SR` = SATIN-RANGE, `LW` = LOCAL-WIDTH, `HP` = HOLE-PRESERVE, `HM` = HOLE-MIN-SIZE, `NEG` = control negativo y `ALL` = ALL-ON.

### Planificación, objetos y comandos

| Métrica | L | OFF | SR | LW | HP | HM | NEG | ALL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `proposalCount` | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| `activeProposalCount` | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 3 |
| `manualReviewCount` | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 |
| `technicalSatinMaximumWidthMm` | 9.18 | 9.18 | 9.18 | 9.18 | 9.18 | 9.18 | 7 | 9.18 |
| `objectCount` | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 3 |
| `physicalStitchCount` | 1337 | 1337 | 1310 | 1337 | 1337 | 765 | 1337 | 738 |
| `stitchCommands` | 1516 | 1516 | 1450 | 1516 | 1516 | 876 | 1516 | 810 |
| `jumpCommands` | 25 | 25 | 24 | 25 | 25 | 17 | 25 | 16 |
| `trimCommands` | 24 | 24 | 23 | 24 | 24 | 16 | 24 | 15 |
| Objetos tatami | 3 | 3 | 2 | 3 | 3 | 2 | 3 | 1 |
| Objetos satin | 1 | 1 | 2 | 1 | 1 | 1 | 1 | 2 |
| Objetos running | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `commandCount` | 1567 | 1567 | 1499 | 1567 | 1567 | 911 | 1567 | 843 |
| `physicalSourceStitchCommandCount` | 1337 | 1337 | 1310 | 1337 | 1337 | 765 | 1337 | 738 |
| `connectorStitchCommandCount` | 179 | 179 | 140 | 179 | 179 | 111 | 179 | 72 |
| `colorChangeCommands` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| `endCommands` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

### Puntadas, longitudes, secuencia e integridad geométrica

| Métrica | L | OFF | SR | LW | HP | HM | NEG | ALL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `underlayStitchCount` | 407 | 407 | 411 | 407 | 407 | 247 | 407 | 251 |
| `topStitchCount` | 930 | 930 | 899 | 930 | 930 | 518 | 930 | 487 |
| `runningStitchCount` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `tatamiStitchCount` | 894 | 894 | 824 | 894 | 894 | 482 | 894 | 412 |
| `satinStitchCount` | 36 | 36 | 75 | 36 | 36 | 36 | 36 | 75 |
| Longitud mínima (mm) | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 |
| Longitud máxima (mm) | 6.412488 | 6.412488 | 8.409518 | 6.412488 | 6.412488 | 6.412488 | 6.412488 | 8.409518 |
| Longitud media (mm) | 3.044895 | 3.044895 | 3.145165 | 3.044895 | 3.044895 | 3.086962 | 3.044895 | 3.266487 |
| Longitud total (mm) | 4071.024903 | 4071.024903 | 4120.165996 | 4071.024903 | 4071.024903 | 2361.526188 | 4071.024903 | 2410.667281 |
| `estimatedTravelMm` | 26 | 26 | 26 | 26 | 26 | 21 | 26 | 21 |
| `transitionCount` | 3 | 3 | 3 | 3 | 3 | 2 | 3 | 2 |
| `threadChangeCount` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| `threadRevisitCount` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `explicitHoleObjectCount` | 2 | 2 | 2 | 2 | 2 | 1 | 2 | 1 |
| `holeCrossingSegmentCount` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `invalidOutsidePointCount` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Diferencias respecto a LEGACY

`FLAGS-OFF`, `LOCAL-WIDTH` y `HOLE-PRESERVE` tienen delta cero en todas las métricas finales. `LOCAL-WIDTH` y `HOLE-PRESERVE` cambian únicamente la traza diagnóstica, por lo que sus hashes completos difieren del hash legacy aunque su proyección regional intrínseca sea idéntica.

El control negativo tiene delta cero en toda métrica operacional; solo cambia `technicalSatinMaximumWidthMm` en `-2.18 mm` y añade la traza de evaluación SATIN-RANGE.

| Métrica modificada | SATIN-RANGE | HOLE-MIN-SIZE | ALL-ON |
|---|---:|---:|---:|
| `activeProposalCount` | 0 | -1 | -1 |
| `manualReviewCount` | 0 | +1 | +1 |
| `objectCount` | 0 | -1 | -1 |
| `physicalStitchCount` | -27 | -572 | -599 |
| `stitchCommands` | -66 | -640 | -706 |
| `jumpCommands` | -1 | -8 | -9 |
| `trimCommands` | -1 | -8 | -9 |
| Objetos tatami | -1 | -1 | -2 |
| Objetos satin | +1 | 0 | +1 |
| `underlayStitchCount` | +4 | -160 | -156 |
| `topStitchCount` | -31 | -412 | -443 |
| `tatamiStitchCount` | -70 | -412 | -482 |
| `satinStitchCount` | +39 | 0 | +39 |
| Longitud máxima (mm) | +1.997030 | 0 | +1.997030 |
| Longitud media (mm) | +0.100270 | +0.042067 | +0.221592 |
| Longitud total (mm) | +49.141093 | -1709.498715 | -1660.357622 |
| `estimatedTravelMm` | 0 | -5 | -5 |
| `transitionCount` | 0 | -1 | -1 |
| `commandCount` | -68 | -656 | -724 |
| `physicalSourceStitchCommandCount` | -27 | -572 | -599 |
| `connectorStitchCommandCount` | -39 | -68 | -107 |
| `explicitHoleObjectCount` | 0 | -1 | -1 |

Las métricas no incluidas en la tabla de deltas permanecen sin cambios. En particular, los tres brazos mantienen `proposalCount = 4`, `runningStitchCount = 0`, un cambio de hilo, cero revisitas, cero cruces de huecos y cero puntos inválidos fuera de geometría.

## Resultados por región

`U/T` significa puntadas de underlay/top. `S/J/T` significa comandos stitch/jump/trim. `Conn` es el número de conectores stitch. Un guion en la traza significa que no existe evaluación Hatch.

| Brazo | Región | Propuesta → final | Revisión | Obj./seq. | Puntadas | U/T | Longitud mm | Cmd. | S/J/T | Conn | Traza Hatch |
|---|---|---|---:|---|---:|---|---:|---:|---|---:|---|
| LEGACY | hole-safe | tatami → tatami | no | 1 / 1 | 572 | 160/412 | 1706.133030 | 659 | 641/9/9 | 69 | — |
| LEGACY | hole-small | tatami → tatami | no | 1 / 0 | 572 | 160/412 | 1709.498715 | 654 | 641/7/6 | 69 | — |
| LEGACY | local | satin → satin | no | 1 / 2 | 80 | 44/36 | 295.363033 | 90 | 81/4/4 | 1 | — |
| LEGACY | satin | tatami → tatami | no | 1 / 3 | 113 | 43/70 | 360.030126 | 164 | 153/5/5 | 40 | — |
| FLAGS-OFF | hole-safe | tatami → tatami | no | 1 / 1 | 572 | 160/412 | 1706.133030 | 659 | 641/9/9 | 69 | — |
| FLAGS-OFF | hole-small | tatami → tatami | no | 1 / 0 | 572 | 160/412 | 1709.498715 | 654 | 641/7/6 | 69 | — |
| FLAGS-OFF | local | satin → satin | no | 1 / 2 | 80 | 44/36 | 295.363033 | 90 | 81/4/4 | 1 | — |
| FLAGS-OFF | satin | tatami → tatami | no | 1 / 3 | 113 | 43/70 | 360.030126 | 164 | 153/5/5 | 40 | — |
| SATIN-RANGE | hole-safe | tatami → tatami | no | 1 / 1 | 572 | 160/412 | 1706.133030 | 659 | 641/9/9 | 69 | — |
| SATIN-RANGE | hole-small | tatami → tatami | no | 1 / 0 | 572 | 160/412 | 1709.498715 | 654 | 641/7/6 | 69 | — |
| SATIN-RANGE | local | satin → satin | no | 1 / 2 | 80 | 44/36 | 295.363033 | 90 | 81/4/4 | 1 | SATIN-RANGE |
| SATIN-RANGE | satin | satin → satin | no | 1 / 3 | 86 | 47/39 | 409.171218 | 96 | 87/4/4 | 1 | SATIN-RANGE |
| LOCAL-WIDTH | hole-safe | tatami → tatami | no | 1 / 1 | 572 | 160/412 | 1706.133030 | 659 | 641/9/9 | 69 | — |
| LOCAL-WIDTH | hole-small | tatami → tatami | no | 1 / 0 | 572 | 160/412 | 1709.498715 | 654 | 641/7/6 | 69 | — |
| LOCAL-WIDTH | local | satin → satin | no | 1 / 2 | 80 | 44/36 | 295.363033 | 90 | 81/4/4 | 1 | LOCAL-WIDTH |
| LOCAL-WIDTH | satin | tatami → tatami | no | 1 / 3 | 113 | 43/70 | 360.030126 | 164 | 153/5/5 | 40 | LOCAL-WIDTH |
| HOLE-PRESERVE | hole-safe | tatami → tatami | no | 1 / 1 | 572 | 160/412 | 1706.133030 | 659 | 641/9/9 | 69 | HOLE-PRESERVE |
| HOLE-PRESERVE | hole-small | tatami → tatami | no | 1 / 0 | 572 | 160/412 | 1709.498715 | 654 | 641/7/6 | 69 | HOLE-PRESERVE |
| HOLE-PRESERVE | local | satin → satin | no | 1 / 2 | 80 | 44/36 | 295.363033 | 90 | 81/4/4 | 1 | — |
| HOLE-PRESERVE | satin | tatami → tatami | no | 1 / 3 | 113 | 43/70 | 360.030126 | 164 | 153/5/5 | 40 | — |
| HOLE-MIN-SIZE | hole-safe | tatami → tatami | no | 1 / 0 | 572 | 160/412 | 1706.133030 | 657 | 642/8/7 | 70 | HOLE-MIN-SIZE |
| HOLE-MIN-SIZE | hole-small | manual → — | sí | 0 / — | 0 | 0/0 | 0 | 0 | 0/0/0 | 0 | HOLE-MIN-SIZE |
| HOLE-MIN-SIZE | local | satin → satin | no | 1 / 1 | 80 | 44/36 | 295.363033 | 90 | 81/4/4 | 1 | — |
| HOLE-MIN-SIZE | satin | tatami → tatami | no | 1 / 2 | 113 | 43/70 | 360.030126 | 164 | 153/5/5 | 40 | — |
| SATIN-NEGATIVE | hole-safe | tatami → tatami | no | 1 / 1 | 572 | 160/412 | 1706.133030 | 659 | 641/9/9 | 69 | — |
| SATIN-NEGATIVE | hole-small | tatami → tatami | no | 1 / 0 | 572 | 160/412 | 1709.498715 | 654 | 641/7/6 | 69 | — |
| SATIN-NEGATIVE | local | satin → satin | no | 1 / 2 | 80 | 44/36 | 295.363033 | 90 | 81/4/4 | 1 | SATIN-RANGE |
| SATIN-NEGATIVE | satin | tatami → tatami | no | 1 / 3 | 113 | 43/70 | 360.030126 | 164 | 153/5/5 | 40 | SATIN-RANGE |
| ALL-ON | hole-safe | tatami → tatami | no | 1 / 0 | 572 | 160/412 | 1706.133030 | 657 | 642/8/7 | 70 | PRESERVE + MIN-SIZE |
| ALL-ON | hole-small | manual → — | sí | 0 / — | 0 | 0/0 | 0 | 0 | 0/0/0 | 0 | PRESERVE + MIN-SIZE |
| ALL-ON | local | satin → satin | no | 1 / 1 | 80 | 44/36 | 295.363033 | 90 | 81/4/4 | 1 | LOCAL-WIDTH + SATIN-RANGE |
| ALL-ON | satin | satin → satin | no | 1 / 2 | 86 | 47/39 | 409.171218 | 96 | 87/4/4 | 1 | LOCAL-WIDTH + SATIN-RANGE |

El desglose muestra por qué las reducciones de HOLE-MIN-SIZE y ALL-ON no deben describirse como eficiencia: `corpus-hole-small` deja de materializarse automáticamente y pasa a revisión manual.

### Dos niveles de comparación regional

La **proyección regional intrínseca** conserva geometría, huecos, estado de revisión, existencia del objeto, técnica propuesta y materializada, puntadas físicas, underlay, top stitches, comandos procedentes de la generación física local y cruces de huecos. Excluye conectores, jumps y trims introducidos o redistribuidos posteriormente por la secuenciación y compilación global.

Con esta proyección:

- FLAGS-OFF, LOCAL-WIDTH, HOLE-PRESERVE y SATIN-NEGATIVE son intrínsecamente idénticos a LEGACY en las cuatro regiones;
- SATIN-RANGE solo cambia intrínsecamente `corpus-satin`;
- HOLE-MIN-SIZE solo cambia intrínsecamente `corpus-hole-small`;
- ALL-ON solo cambia intrínsecamente `corpus-satin` y `corpus-hole-small`.

La **proyección final global** no elimina ni normaliza ninguna consecuencia de secuenciación. Cuando `corpus-hole-small` se retira, `corpus-hole-safe` pasa de `659/641/9/9/69` a `657/642/8/7/70` en comandos totales/stitch/jump/trim/conectores. Estas diferencias están fijadas literalmente tanto para HOLE-MIN-SIZE como para ALL-ON.

Por tanto, las regiones supervivientes son **intrínsecamente idénticas antes de la resecuenciación y compilación global**. Los cambios de conectores, jumps y trims son consecuencias globales deterministas de retirar un objeto; no acreditan una modificación geométrica ni una alteración de sus puntadas físicas locales.

## Hashes deterministas

El hash completo se calcula sobre métricas, desglose regional final —incluida la traza `hatchRuleIds`— y geometría de propuesta. Por ello LOCAL-WIDTH y HOLE-PRESERVE pueden tener un hash completo distinto aunque sean intrínsecamente idénticos a LEGACY. La paridad intrínseca se acredita separadamente mediante `EXPECTED_INTRINSIC_REGION_RESULTS`; no se confunde con el hash completo.

| Brazo | SHA-256 completo de salida normalizada | Hash repetido | Hash de geometría |
|---|---|---|---|
| LEGACY | `9e61060cb7ac1456ddcc51bde010f2a0792bb57b59a5ee2babd7bcd6374625d5` | igual | `2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b` |
| FLAGS-OFF | `9e61060cb7ac1456ddcc51bde010f2a0792bb57b59a5ee2babd7bcd6374625d5` | igual | `2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b` |
| SATIN-RANGE | `11fd394533cebae1e2e3512c3a3040584e40303891a25aebc48b5b3e1b728364` | igual | `2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b` |
| LOCAL-WIDTH | `cb035fd8781db67af564a1f32db49f9cf14e9a9c8d02577db362e4f5ee75f5eb` | igual | `2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b` |
| HOLE-PRESERVE | `68f7de328f6b73cde55b3745a6197c83cbf79c25f64ce879ecc981a8e3bab30b` | igual | `2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b` |
| HOLE-MIN-SIZE | `893c7f1800eb34fe6ed28cdefc22f49ce5a85558ce8dae660d52b9fd50b5dcca` | igual | `2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b` |
| SATIN-NEGATIVE | `f99bb2ba1d45fe977a7c8cd2046955080d38691a14fc2faf7d17fbbfb20d613b` | igual | `2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b` |
| ALL-ON | `682d1a23f14fb6a384fe787500a41d34dcfbb76e7b15f0bf1e5d2279fb5b9983` | igual | `2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b` |

El hash independiente del corpus Hatch A8/C6/D6/H9 es `69ef7cbd8078753d7739ea09cbaf91d3832e547e41219fce8fd70a03f9db703f`.

## Corpus Hatch de referencia independiente

Los resultados siguientes no se incluyen en ningún total del corpus sintético.

| Caso | Familia | Fuente (mm) | Ancho Hatch observado | Mín./mediana/máx. medidos (mm) | Aspecto | Eje principal |
|---|---|---|---:|---|---:|---:|
| A8 | barra recta | 8 × 16 | 8.04 | 8 / 8 / 8 | 2 | 90° |
| C6 | forma afilada | 8 × 14 | 8.04 | 3.5 / 6.875 / 8 | 1.75 | 90° |
| D6 | cápsula | 9 × 14 | 9.18 | 8.314916 / 9 / 9 | 1.555556 | 90° |

H9 mantiene juntos los cuatro huecos circulares reales. Las medidas fueron `0.8`, `1.2`, `1.8` y `2.5 mm`, con disposiciones `reject_automatic_generation`, `protect`, `protect` y `protect`. El hueco de `0.8 mm` activa revisión manual y rechazo de generación automática.

## Invariantes verificadas

- LEGACY y FLAGS-OFF: salida normalizada y hash exactamente iguales.
- LOCAL-WIDTH y HOLE-PRESERVE: proyección regional intrínseca idéntica a LEGACY; solo añaden traza diagnóstica.
- SATIN-RANGE: la única región modificada intrínsecamente es `corpus-satin`, de tatami a satin. `corpus-local` ya era satin en legacy y se conserva.
- SATIN-NEGATIVE a `7 mm`: `corpus-satin` permanece tatami y las cuatro regiones son intrínsecamente idénticas a LEGACY.
- HOLE-MIN-SIZE: únicamente `corpus-hole-small` pasa a `manual_review`; las diferencias de comandos de `corpus-hole-safe` proceden exclusivamente de la resecuenciación global acreditada.
- ALL-ON: combina el cambio intrínseco de `corpus-satin` y la revisión de `corpus-hole-small`; las diferencias globales adicionales son solo consecuencias deterministas de secuencia y compilación.
- Los ocho brazos tienen `holeCrossingSegmentCount = 0` e `invalidOutsidePointCount = 0`.
- Todos los contadores de pérdida silenciosa comprobados en planificación, materialización, planificación técnica, secuencia, generación física y compilación canónica son cero.
- Ninguna ejecución muta la entrada; los metadatos de mutación son falsos.
- El hash de geometría es idéntico en los ocho brazos.
- No existe artefacto exportado, adaptación de máquina ni codificación binaria.

## Limitaciones

> “Una reducción de puntadas, comandos o desplazamientos no demuestra por sí sola una mejora física del bordado.”

- HOLE-MIN-SIZE reduce totales porque retira un objeto de la generación automática y lo envía a revisión manual.
- SATIN-RANGE reduce el número de puntadas y comandos del candidato, pero aumenta la longitud total generada del corpus en `49.141093 mm` y eleva la longitud máxima de puntada calculada. Ninguno de esos cambios acredita calidad física.
- Los conteos de comandos incluyen conectores canónicos y no equivalen uno a uno a las puntadas físicas.
- No se realizó sew-out ni se controlaron aguja, hilo, estabilizador, tensión, velocidad, bastidor o condiciones reales de tela.
- El contexto de evidencia Hatch A/B usado por los brazos experimentales está acotado a Pure Cotton, escala compatible y las familias representadas por los fixtures heredados.
- No se validan cobertura, registro, fruncido, perforación, roturas, brillo, tacto ni durabilidad.
- A8, C6, D6 y H9 son fixtures deterministas con metadatos de procedencia heredados; R02 no revalida los artefactos originales y sus curvas se representan mediante muestreo poligonal.
- El corpus es pequeño y determinista; no constituye evidencia estadística de comportamiento en producción.

## Conclusión lógica y computacional

R02 acredita aislamiento de flags y determinismo del pipeline previo a exportación:

- FLAGS-OFF conserva paridad exacta con LEGACY.
- LOCAL-WIDTH y HOLE-PRESERVE permanecen diagnósticas cuando se activan individualmente.
- SATIN-RANGE cambia únicamente el candidato acreditado `corpus-satin` cuando el máximo técnico efectivo es `9.18 mm`; el control de `7 mm` impide el cambio.
- HOLE-MIN-SIZE convierte únicamente el caso de hueco pequeño en revisión manual a nivel intrínseco; retirar ese objeto resecuencia comandos globales de forma determinista.
- ALL-ON combina ambos efectos intrínsecos sin introducir cruces de huecos, puntos inválidos, pérdidas silenciosas ni mutaciones de entrada.

Estas conclusiones describen comportamiento lógico y coste computacional. No acreditan una mejora física del bordado.
