# CE01_INVALID_AND_DETECTOR_ALIGNMENT_AUDIT_V1

Fecha: 2026-07-05
Tipo: auditoría documental/runtime basada en los reportes descargados y en la lectura de los detectores actuales.
Restricción aplicada: NO se modificó código, NO se reparó, NO se tocó motor, exportación, V5.1, encoders, ExportModal ni UI.

---

## 0. Datos de entrada auditados

### EMBROIDERY_COMMAND_RUNTIME_FORENSICS_AFTER_TRANSITION_GUARD_V1

- totalCommands=15488
- totalStitches=14203
- totalJumps=886
- totalTrims=378
- visibleLongStitchCount=29
- severeVisibleLongStitchCount=0
- stitchedTravelCount=20
- fillOutsideRegionCount=17
- maxVisibleStitchMm=7.468969331004324
- simulationMatchesFinalCommands=true
- finalLookMatchesFinalCommands=true

### STITCHED_TRANSITION_TO_JUMP_GUARD_REPORT_V1

- phaseAccepted=false
- convertedTransitions=0
- stitchedTravelCount before=0 after=0
- CE01 status before=INVALID after=INVALID
- commandsReturnedSource=beforeTransitionGuard

---

## 1. CE01 INVALID root cause

### Validador CE01 usado por exportación

El validador CE01 actual marca `INVALID` cuando `blockingIssues.length > 0`.
Los bloqueos explícitos del validador actual son:

1. Secuencia vacía.
2. Total de puntadas mayor que el límite CE01.
3. Coordenadas fuera del bastidor.
4. Bounding box del diseño mayor que 100×100mm.
5. Objetos contour tratados como fill.

### Resultado CE01 observado

- ce01Status=INVALID
- Evidencia directa disponible: `STITCHED_TRANSITION_TO_JUMP_GUARD_REPORT_V1` reporta `CE01 status before=INVALID after=INVALID`.
- Evidencia indirecta fuerte: runtime after guard reporta `totalStitches=14203`.
- Límite CE01 en el validador actual: `CE01_MAX_STITCHES=12000`.
- Exceso de puntadas: `14203 - 12000 = 2203`.

### Causa primaria inferida

El bloqueo CE01 más probable y suficiente es:

```txt
CHECK_1_STITCH_COUNT_LIMIT
14203 puntadas exceden el límite CE01 de 12000.
```

Esto por sí solo basta para que el estado sea `INVALID`, incluso aunque las líneas largas visibles ya estén controladas.

### Campos solicitados

- ce01Status: INVALID
- invalidReasons:
  - `14203 puntadas exceden el límite CE01 (12000).`
- errorCodes:
  - `CHECK_1_STITCH_COUNT_LIMIT`
- blockingErrors:
  - `check=1 totalStitches=14203 max=12000 overBy=2203`
- firstInvalidCommandIndex:
  - `N/A_AGGREGATE_STITCH_COUNT_LIMIT`
  - Motivo: el bloqueo de puntadas totales es una regla agregada, no un comando individual.
- invalidCommandIndexes top 50:
  - `[]` para la causa primaria confirmada.
  - Motivo: la causa primaria no es indexada por comando en el validador actual.
- invalidCommandTypes:
  - `stitch` por exceso agregado de puntadas.
- invalidDistances:
  - No confirmado como causa CE01 INVALID en los datos aportados.
  - El runtime indica `maxVisibleStitchMm=7.468969331004324`, por debajo del umbral de puntada larga CE01 de 8.0mm.
- invalidCoordinates:
  - No confirmado en los datos aportados.
- unsupportedCommandSequences:
  - No confirmado en los datos aportados.
- hoopBoundsViolations:
  - No confirmado en los datos aportados.
- maxStitchLengthViolations:
  - No confirmado como bloqueo.
  - Runtime after guard: severeVisibleLongStitchCount=0 y maxVisibleStitchMm=7.469mm.
- maxJumpLengthViolations:
  - No reportado por el validador CE01 actual como bloqueo directo; los jumps excesivos son riesgo/warning salvo otras reglas.
- trimSequenceViolations:
  - No confirmado en los datos aportados.
- colorChangeSequenceViolations:
  - No confirmado en los datos aportados.
- emptyBlocks:
  - No confirmado en los datos aportados.
- NaN/undefined coordinates:
  - No confirmado en los datos aportados.
- commandsAfterEnd:
  - No confirmado en los datos aportados.
- endMissingOrDuplicated:
  - No confirmado en los datos aportados.

### Conclusión CE01

El diseño puede verse mucho más limpio en Simular / Final Look y aun así seguir `CE01 INVALID`, porque el bloqueo actual más evidente no es visual: es el límite agregado de puntadas CE01.

---

## 2. Comparación de detectores

## 2.1 EMBROIDERY_COMMAND_RUNTIME_FORENSICS detector

- input commands source: `finalEmbroideryCommands` ya reparado / secuencia canónica visible para Simular y Final Look.
- totalCommands=15488
- totalStitches=14203
- stitchedTravelCount=20
- visibleLongStitchCount=29
- severeVisibleLongStitchCount=0
- maxVisibleStitchMm=7.468969331004324

### Thresholds usados

- visibleLongStitch: `distanceMm > 4`
- severeVisibleLongStitch: `distanceMm > 8`
- stitchedTravelCandidate:
  - `visibleLongStitch=true`
  - y además cruza espacio vacío, cruza otra región o cambia de región.
- Por tanto, runtime puede contar `stitchedTravelCount` con distancias entre 4mm y 8mm.

## 2.2 STITCHED_TRANSITION_TO_JUMP_GUARD_V1 detector

- input commands source: comandos antes/después dentro de la fase transaccional del guard.
- totalCommands before/after: no aportado explícitamente en el resumen del guard.
- stitchedTravelCount before=0 after=0
- visibleLongStitchCount: no aportado en el resumen del usuario.
- severeVisibleLongStitchCount: no aportado en el resumen del usuario.
- maxVisibleStitchMm: no aportado en el resumen del usuario.
- CE01 status before=INVALID after=INVALID

### Thresholds usados

El guard solo intenta convertir si:

```txt
type === 'stitch'
distanceMm > 8
isSuspicious=true
severity HIGH/CRITICAL
converted < 260
```

Y además define `stitchedTravelCandidate` internamente con:

```txt
stitchedTravelCandidate = distanceMm > 8 && (...cambio/crossing/soporte...)
```

## 2.3 CE01 validator detector

- input commands source: comandos finales entregados al flujo de validación/exportación.
- ce01Status=INVALID
- totalStitches=14203 inferido del runtime after guard.
- stitchedTravelCount: no mide este concepto.
- visibleLongStitchCount: no mide este concepto con el mismo nombre.
- severeVisibleLongStitchCount: no mide este concepto con el mismo nombre.
- maxVisibleStitchMm: no reporta este campo.

### Thresholds usados por CE01 relevantes aquí

- CE01_MAX_STITCHES=12000
- CE01_MAX_STITCH=8.0mm como warning de puntadas largas.
- CE01_TRIM_THRESHOLD=3.5mm para jumps largos sin trim previo, tratado como warning/riesgo, no bloqueo directo.
- Coordenadas fuera de bastidor: bloqueo.
- Bounding box >100×100mm: bloqueo.

---

## 2.4 Por qué runtime detecta stitchedTravel=20 y Transition Guard detecta 0

La discrepancia viene de umbrales distintos:

- Runtime forensics cuenta stitchedTravel si `distanceMm > 4` y cruza vacío/región.
- Transition Guard solo considera stitchedTravel si `distanceMm > 8`.
- El runtime after guard tiene `maxVisibleStitchMm=7.468969331004324`.
- Como `7.469mm < 8mm`, todos los stitchedTravel restantes pueden existir para runtime, pero ser invisibles para el guard.

Por eso:

```txt
runtimeStitchedTravelCount=20
transitionGuardStitchedTravelCount=0
detectorMismatch=true
```

Esto no significa que el guard esté fallando mecánicamente; significa que el guard fue diseñado para casos HIGH/CRITICAL >8mm y el remanente actual está por debajo de ese umbral.

---

## 3. Listado de los 20 stitchedTravel restantes

El resumen aportado no incluye la tabla de offenders con índices exactos. Por tanto, no se pueden enumerar los 20 comandos con `index`, `previousIndex`, coordenadas y razón exacta sin el cuerpo completo de `EMBROIDERY_COMMAND_RUNTIME_FORENSICS_AFTER_TRANSITION_GUARD_V1.md`.

Aun así, por definición del detector runtime, los 20 cumplen este patrón:

- type=stitch
- distanceMm > 4
- distanceMm <= 7.468969331004324
- severeVisibleLongStitch=false
- severeVisibleLongStitchCount=0
- stitchedTravelCandidate=true según runtime porque cruzan vacío, cruzan otra región o cambian región.

### Tabla solicitada

| index | previousIndex | distanceMm | color | prevRegionId | regionId | stitchType | layerType | source | reason | por qué el Transition Guard los saltó | decisión |
|---:|---:|---:|---|---|---|---|---|---|---|---|---|
| N/D | N/D | 4.000-7.469 | N/D | N/D | N/D | N/D | N/D | N/D | stitchedTravelCandidate runtime | `distanceMm <= 8`, por tanto no entra en `shouldConvert` del guard | No convertir todavía salvo que se implemente cleanup conservador de viajes pequeños |

### Interpretación

- No son candidatos para REGION_ORDER_OPTIMIZER_V1 todavía.
- No son severos.
- No exceden 8mm.
- Pueden ensuciar levemente la simulación, pero ya no explican CE01 INVALID.
- Si se reparan, debería hacerse como `SMALL_STITCHED_TRAVEL_CLEANUP_V1`, no como reordenador global.

---

## 4. Determinar siguiente fix

Opciones evaluadas:

### A) CE01_SEQUENCE_REPAIR_V1

No elegida.

No hay evidencia suficiente de que el `INVALID` venga de trims duplicados, jumps mal ordenados, color changes o END. El CE01 INVALID está explicado de forma suficiente por el exceso de puntadas.

### B) CE01_GEOMETRY_BOUNDS_REPAIR_V1

No elegida.

No hay evidencia en los resúmenes de coordenadas fuera de bastidor, NaN, violaciones de bounds o puntadas >8mm. El maxVisibleStitchMm actual es 7.469mm.

### C) DETECTOR_ALIGNMENT_FIX_V1

Elegida como siguiente paso técnico seguro.

Motivo:

- El problema explícito de diagnóstico es real: runtime mide `stitchedTravelCount=20` y guard mide `0`.
- La causa es una divergencia de umbral y definición:
  - runtime stitchedTravel: `distance > 4mm`
  - guard stitchedTravel: `distance > 8mm`
- Antes de implementar otra reparación, conviene alinear detectores para que los reportes y el guard hablen el mismo lenguaje.
- Esta ruta no implica reordenar regiones ni tocar motor.

### D) SMALL_STITCHED_TRAVEL_CLEANUP_V1

No elegida todavía como fix principal.

Puede ser la siguiente micro-reparación visual después de alinear detectores, pero no resolverá CE01 INVALID si el bloqueo principal sigue siendo `totalStitches > 12000`.

### E) NO_REPAIR_EXPORT_ONLY

No elegida.

No hay evidencia suficiente de que CE01 INVALID sea solo una medición incorrecta ni de que Export V5.1 ya corrija el exceso de puntadas agregado antes del bloqueo.

---

## 5. Decisión final

### Ruta recomendada

```txt
recommendedFix=DETECTOR_ALIGNMENT_FIX_V1
```

### Razón

El siguiente paso no debe ser un reordenador global porque:

- severeVisibleLongStitchCount=0
- maxVisibleStitchMm=7.469mm
- Simular y Final Look ya coinciden con finalEmbroideryCommands
- El problema de CE01 INVALID se explica por límite agregado de puntadas, no por líneas largas visibles
- Los detectores no están alineados y eso puede inducir reparaciones equivocadas

### Qué debe hacer DETECTOR_ALIGNMENT_FIX_V1 cuando se implemente después

No implementado en este informe, pero debería:

1. Separar métricas:
   - `stitchedTravelGt4Count`
   - `stitchedTravelGt8Count`
   - `severeStitchedTravelCount`
2. Hacer que el guard reporte explícitamente:
   - runtime-compatible stitchedTravel >4
   - guard-actionable stitchedTravel >8
3. Evitar que `phaseAccepted=false` parezca fallo si solo quedan viajes pequeños.
4. Mantener el guard conservador para conversiones >8mm.
5. Considerar un futuro `SMALL_STITCHED_TRAVEL_CLEANUP_V1` solo para viajes 4-8mm si visualmente siguen molestando.

---

## 6. Campos finales obligatorios

```txt
ce01Status=INVALID
ce01InvalidPrimaryCause=CHECK_1_STITCH_COUNT_LIMIT_TOTAL_STITCHES_14203_GT_12000
blockingErrorCount=1_inferred_from_available_summary
firstBlockingCommandIndex=N/A_AGGREGATE_STITCH_COUNT_LIMIT
runtimeStitchedTravelCount=20
transitionGuardStitchedTravelCount=0
detectorMismatch=true
recommendedFix=DETECTOR_ALIGNMENT_FIX_V1
safeToProceedWithRepair=false
```

### Nota sobre safeToProceedWithRepair

`safeToProceedWithRepair=false` porque este informe pidió auditoría sin reparar y porque la causa CE01 primaria inferida es el exceso agregado de puntadas. Antes de reparar, conviene alinear detectores y descargar/analizar el CE01 report completo con índices si se necesita una reparación quirúrgica.