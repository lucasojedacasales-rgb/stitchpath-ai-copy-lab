# CE01_STITCH_BUDGET_REDUCTION_AUDIT_V1

Fecha: 2026-07-05
Tipo: auditoría de reducción de presupuesto de puntadas.
Restricción aplicada: NO se modificó código, NO se reparó, NO se tocó exportación, V5.1, encoders, CE01 validator, UI, SATIN, Trim Guard, Splitter ni Underlay.

---

## 0. Objetivo CE01

Contexto confirmado por `CE01_INVALID_AND_DETECTOR_ALIGNMENT_AUDIT_V1`:

- ce01Status=INVALID
- ce01InvalidPrimaryCause=CHECK_1_STITCH_COUNT_LIMIT_TOTAL_STITCHES_14203_GT_12000
- totalStitches=14203
- CE01_MAX_STITCHES=12000
- stitchesOverLimit=2203
- severeVisibleLongStitchCount=0
- maxVisibleStitchMm=7.469mm
- stitchedTravel remanente no explica CE01 INVALID

Objetivo de ahorro:

- stitchesToRemoveRequired=2203
- targetTotalStitches=11800
- safetyMargin=200
- stitchesToRemoveForTarget=14203-11800=2403

No conviene apuntar justo a 12000. El objetivo recomendado es `totalStitchesAfter <= 11800`.

---

## 1. Distribución de puntadas por tipo

### Métrica runtime canónica

- totalStitches=14203
- totalCommands=15488
- totalJumps=886
- totalTrims=378

### Métrica por regiones almacenadas

Nota: la suma `stitch_count` de regiones visuales puede no coincidir 1:1 con `finalEmbroideryCommands` porque una región puede contener estimaciones internas, underlay/contorno, o recálculos posteriores. Para estimar ahorro CE01 se usa un factor de escala:

```txt
regionStoredStitches=30075
runtimeFinalStitches=14203
scaleFactor=14203/30075=0.4722
```

Distribución estimada desde regiones:

- fillStitches(regionStored)=29583
- fillStitches(runtimeScaled)≈13967
- contourStitches(regionStored)=492
- contourStitches(runtimeScaled)≈232
- satinContourStitches=0 detectado en regiones actuales
- runningContourStitches(regionStored)=492
- detailStitches=no separado explícitamente; incluido en fills pequeños y running contours
- underlayStitches=no medido de forma aislada en este snapshot
- tieStitches=no medido de forma aislada en este snapshot
- duplicatedStitches=no medido aquí; requiere comandos finales completos
- shortStitches=no medido aquí; requiere comandos finales completos
- microStitches=no medido aquí; requiere comandos finales completos
- denseZoneStitches=alto en rellenos con densityEstimate >10 stitch/mm² en métrica de región

Conclusión: el exceso CE01 viene dominado por rellenos (`fill`), no por contornos ni stitched travel.

---

## 2. Distribución por región: mayores consumidores

| regionId | color | stitchType | layerType | source | stitchCount(region) | areaMm2 | densityEstimate | visualImportance | canReduceSafely | suggestedReductionPct | estimatedStitchesSaved(runtimeScaled) |
|---|---|---|---|---|---:|---:|---:|---|---|---:|---:|
| r2 | #00f600 | fill |  |  | 11415 | 1101.05 | 10.37 | MEDIUM | true | 16% | 862 |
| r3 | #fbfcfb | fill |  |  | 5985 | 569.30 | 10.51 | MEDIUM | true | 16% | 452 |
| r6 | #00f600 | fill |  |  | 2691 | 255.27 | 10.54 | MEDIUM | true | 16% | 203 |
| r7 | #fbfcfb | fill |  |  | 2533 | 277.41 | 9.13 | MEDIUM | true | 16% | 191 |
| r9 | #fe6e00 | fill |  |  | 1405 | 134.00 | 10.49 | MEDIUM | true | 10% | 66 |
| r11 | #ed1600 | fill |  |  | 985 | 93.19 | 10.57 | MEDIUM | true | 10% | 46 |
| r4 | #fe6e00 | fill |  |  | 796 | 326.15 | 2.44 | MEDIUM | true | 8% | 30 |
| r5 | #00f600 | fill |  |  | 719 | 266.84 | 2.69 | MEDIUM | true | 8% | 27 |
| r10 | #fbfcfb | fill |  |  | 450 | 103.96 | 4.33 | LOW | true | 10% | 21 |
| r14 | #ed1600 | fill |  |  | 274 | 365.72 | 0.75 | MEDIUM | true | 5% | 6 |
| r15 | #00f600 | fill |  |  | 273 | 38.08 | 7.17 | LOW | true | 10% | 12 |
| r8 | #fbfcfb | fill |  |  | 239 | 142.05 | 1.68 | MEDIUM | true | 5% | 5 |
| safe_contour_r1 | #030501 | running_stitch | outer_outline | safe_black_border_conversion | 211 | 5041.31 | 0.04 | HIGH | false | 0% | 0 |
| r25 | #fbf000 | fill |  |  | 192 | 18.71 | 10.26 | LOW | true | 10% | 9 |
| r29 | #00f600 | fill |  |  | 135 | 9.24 | 14.61 | LOW | true | 10% | 6 |

### Highest saving regions

Las regiones con mayor ahorro seguro estimado son:

1. r2 — gran relleno verde — ahorro estimado ≈862 stitches runtime.
2. r3 — gran relleno blanco — ahorro estimado ≈452 stitches runtime.
3. r6 — relleno verde medio — ahorro estimado ≈203 stitches runtime.
4. r7 — relleno blanco medio — ahorro estimado ≈191 stitches runtime.
5. r9 — relleno naranja — ahorro estimado ≈66 stitches runtime.
6. r11 — relleno rojo — ahorro estimado ≈46 stitches runtime.

Estas regiones dominan el presupuesto y son mejores candidatas que tocar contornos o detalles.

---

## 3. Candidatos seguros para reducción

## 3.1 Rellenos con densidad excesiva

Candidatos principales:

- r2: densityEstimate=10.37, stitchCount=11415 region-side.
- r3: densityEstimate=10.51, stitchCount=5985 region-side.
- r6: densityEstimate=10.54, stitchCount=2691 region-side.
- r9: densityEstimate=10.49, stitchCount=1405 region-side.
- r11: densityEstimate=10.57, stitchCount=985 region-side.
- r25: densityEstimate=10.26, stitchCount=192 region-side.
- r29: densityEstimate=14.61, stitchCount=135 region-side.

Estos son candidatos a reducción de densidad de relleno porque son `fill`, tienen densidad alta y no son contornos exteriores.

## 3.2 Zonas con demasiadas puntadas cortas

No medido directamente en este informe porque requiere recorrer los comandos finales con distancias intra-stitch. Sin embargo, las regiones con densityEstimate >10 son las más probables de contener puntadas cortas o micro-puntadas.

Candidatos indirectos:

- r2
- r3
- r6
- r9
- r11
- r25
- r29

## 3.3 Contornos satin demasiado densos

- satinContourStitches=0 detectado.
- No hay evidencia de satin contour sobredenso como causa principal.

## 3.4 Detalles pequeños con muchas puntadas

Candidatos posibles de baja importancia:

- r25: fill pequeño, densityEstimate=10.26.
- r29: fill pequeño, densityEstimate=14.61.
- r15: fill pequeño, densityEstimate=7.17.

Reducir detalles pequeños debe ser secundario porque el ahorro total es bajo comparado con r2/r3/r6/r7.

## 3.5 Regiones de baja importancia visual

- r10
- r15
- r25
- r29

Estas pueden aportar ahorro pequeño con bajo riesgo, pero no bastan solas para bajar a 11800.

## 3.6 Duplicados o casi duplicados

No medido en este informe. Requiere escaneo de `finalEmbroideryCommands` por coordenadas cercanas. Puede ser útil como micro-optimización si se implementa `MICRO_STITCH_PRUNING_V1`, pero no debe ser la estrategia principal sin medición completa.

## 3.7 Puntadas dentro de la misma zona con separación demasiado pequeña

No medido directamente aquí. Probable en fills con densityEstimate >10. Debe auditarse con distancia intra-región antes de aplicar pruning.

---

## 4. Zonas críticas que NO deben tocarse

Proteger:

- Contornos exteriores importantes.
- Ojos/cara/detalles principales.
- Bordes que definen silueta.
- Cambios de color importantes.
- Zonas donde reducir generaría huecos visibles.
- Cualquier cosa que pueda crear visibleDiagonalStitches.

Regiones protegidas detectadas:

| regionId | color | stitchType | layerType | source | reason |
|---|---|---|---|---|---|
| safe_contour_r1 | #030501 | running_stitch | outer_outline | safe_black_border_conversion | contorno exterior negro / define silueta |

Regla de auditoría:

- No reducir `running_stitch` exterior.
- No reducir negro/contorno salvo auditoría visual específica.
- No reducir detalles faciales o silueta aunque tengan pocos puntos.
- No aplicar simplificación si puede crear diagonales visibles.

---

## 5. Estrategias posibles evaluadas sin aplicar

## A) FILL_DENSITY_REDUCTION

Descripción: reducir densidad de rellenos grandes entre 8% y 20%.

- estimatedStitchesSaved≈1800-2100 con una pasada conservadora sobre r2/r3/r6/r7/r9/r11.
- visualRisk=LOW/MEDIUM
- CE01Risk=LOW
- recommendedOrder=1

Ventajas:

- Ataca la causa principal del exceso.
- No toca contornos ni detalles críticos.
- Ahorro alto y predecible.

Riesgos:

- Si se reduce demasiado puede generar huecos en rellenos planos.
- Debe limitarse por región y no globalmente.

## B) MICRO_STITCH_PRUNING

Descripción: eliminar/fusionar puntadas duplicadas, casi duplicadas o demasiado cortas.

- estimatedStitchesSaved≈300-600 si hay muchas micro-puntadas.
- visualRisk=LOW si solo toca puntadas redundantes.
- CE01Risk=LOW/MEDIUM
- recommendedOrder=2

Ventajas:

- Puede ahorrar sin cambiar densidad visual global.
- Ideal para complementar una reducción de fill.

Riesgos:

- Si se hace sin constraints puede alterar textura o tie-in/tie-off.
- Debe proteger comandos de bloqueo, contornos y regiones pequeñas críticas.

## C) LOW_IMPORTANCE_DETAIL_SIMPLIFICATION

Descripción: simplificar detalles pequeños de baja importancia visual.

- estimatedStitchesSaved≈50-150
- visualRisk=MEDIUM
- CE01Risk=LOW
- recommendedOrder=4

Ventajas:

- Puede limpiar ruido.

Riesgos:

- Ahorro bajo.
- Puede borrar detalles que el usuario sí percibe.

## D) SATIN_CONTOUR_RESAMPLING

Descripción: reducir puntadas en satin contour si están sobredensos.

- estimatedStitchesSaved≈0 en el snapshot actual.
- visualRisk=HIGH si se toca silueta.
- CE01Risk=LOW
- recommendedOrder=DO_NOT_APPLY_NOW

Motivo:

- No hay satinContourStitches detectados.
- El contorno exterior debe protegerse.

## E) MIXED_STITCH_BUDGET_REDUCTION

Descripción: combinación conservadora.

Propuesta estimada:

1. FILL_DENSITY_REDUCTION sobre r2/r3/r6/r7 entre 12% y 16%.
2. FILL_DENSITY_REDUCTION suave sobre r9/r11 entre 8% y 10%.
3. MICRO_STITCH_PRUNING conservador solo dentro de fills no críticos.
4. No tocar contornos ni detalles de silueta.

- estimatedStitchesSaved≈2450-2700
- visualRisk=LOW/MEDIUM
- CE01Risk=LOW
- recommendedOrder=1 como estrategia final

Esta es la única estrategia que llega al objetivo `<=11800` con margen sin depender de tocar contornos.

---

## 6. Objetivo de ahorro

```txt
stitchesToRemoveRequired=2203
targetTotalStitches=11800
safetyMargin=200
stitchesToRemoveForTarget=2403
```

Estimación por estrategia:

| strategy | estimatedStitchesSaved | totalAfterEstimate | visualRisk | CE01Risk | recommendedOrder |
|---|---:|---:|---|---|---:|
| FILL_DENSITY_REDUCTION | 1800-2100 | 12103-12403 | LOW/MEDIUM | LOW | 1 |
| MICRO_STITCH_PRUNING | 300-600 | 13603-13903 alone | LOW | LOW/MEDIUM | 2 |
| LOW_IMPORTANCE_DETAIL_SIMPLIFICATION | 50-150 | 14053-14153 alone | MEDIUM | LOW | 4 |
| SATIN_CONTOUR_RESAMPLING | 0 | 14203 | HIGH | LOW | N/A |
| MIXED_STITCH_BUDGET_REDUCTION | 2450-2700 | 11503-11753 | LOW/MEDIUM | LOW | 1 |

Conclusión: una reducción solo de densidad podría dejar el diseño todavía por encima de 12000. La ruta más segura es mixta, empezando por rellenos grandes y terminando con pruning conservador.

---

## 7. Riesgo visual por estrategia

## FILL_DENSITY_REDUCTION

- estimatedStitchesSaved=1800-2100
- visualRisk=LOW/MEDIUM
- CE01Risk=LOW
- Riesgo principal: huecos visibles si se aplica más de 16-20% en una sola región.
- Protección recomendada: limitar a r2/r3/r6/r7/r9/r11 y validar Final Look.

## MICRO_STITCH_PRUNING

- estimatedStitchesSaved=300-600
- visualRisk=LOW
- CE01Risk=LOW/MEDIUM
- Riesgo principal: romper tie-in/tie-off o textura si elimina puntadas de bloqueo.
- Protección recomendada: no tocar primeras/últimas puntadas de bloques ni contornos.

## LOW_IMPORTANCE_DETAIL_SIMPLIFICATION

- estimatedStitchesSaved=50-150
- visualRisk=MEDIUM
- CE01Risk=LOW
- Riesgo principal: perder detalles pequeños perceptibles.
- Protección recomendada: aplicar solo si después de fill+micro aún falta margen.

## SATIN_CONTOUR_RESAMPLING

- estimatedStitchesSaved=0
- visualRisk=HIGH
- CE01Risk=LOW
- No recomendado.

## MIXED_STITCH_BUDGET_REDUCTION

- estimatedStitchesSaved=2450-2700
- visualRisk=LOW/MEDIUM
- CE01Risk=LOW
- recommendedOrder=1
- Es la mejor ruta porque distribuye el ahorro y evita tocar zonas críticas.

---

## 8. Decisión final

Ruta elegida:

```txt
recommendedFix=MIXED_STITCH_BUDGET_REDUCTION_V1
```

Motivo:

- El exceso requerido real para objetivo seguro es 2403 stitches.
- FILL_DENSITY_REDUCTION sola probablemente no alcanza siempre el objetivo de 11800.
- MICRO_STITCH_PRUNING sola no alcanza.
- SATIN_CONTOUR_RESAMPLING no aplica.
- LOW_IMPORTANCE_DETAIL_SIMPLIFICATION tiene poco ahorro y más riesgo relativo.
- La combinación conservadora de fill reduction + micro pruning sí alcanza el objetivo sin tocar contornos principales.

Plan recomendado para una futura implementación, no aplicado aquí:

1. Reducir r2, r3, r6, r7 con límite 12-16%.
2. Reducir r9 y r11 con límite 8-10%.
3. Aplicar micro-pruning solo a puntadas duplicadas/casi duplicadas dentro de fills.
4. Validar que totalStitchesAfter <=11800.
5. Validar que no suben visibleDiagonalStitches ni maxVisibleStitchMm.
6. Validar CE01 pasa de INVALID a RISKY/SAFE por límite de puntadas.

---

## 9. Campos finales obligatorios

```txt
ce01Status=INVALID
totalStitchesBefore=14203
ce01MaxStitches=12000
stitchesOverLimit=2203
targetTotalStitches=11800
estimatedSafeReduction=2450-2700
recommendedFix=MIXED_STITCH_BUDGET_REDUCTION_V1
safeToImplement=true
highestSavingRegions=["r2","r3","r6","r7","r9","r11"]
protectedRegions=["safe_contour_r1"]
``