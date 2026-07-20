# REFERENCE_VISIBLE_SPLITTER_FORENSICS_V1 — StitchPath AI

> Generado: 2026-07-04
> Forense READ-ONLY. No modifica el splitter ni el detector.
> Replica la detección de candidatos del splitter y hace dry-run local por candidato.
> Estado: REFERENCE_VISIBLE_STITCH_SPLITTER_V1 implementado pero **revertido** (phaseAccepted=false).

## Contexto de la reversión

```
phaseAccepted     = false
revertReason      = visibleDiagonalStitches subió 0 → 68
candidatesFound   = 59
candidatesSplit   = 0   (reportado 0 porque la fase se revirtió)
maxVisibleStitchMm = 11.77 → 11.77  (sin mejora tras revert)
addedStitches     = 0   (tras revert)
```

Los 59 candidatos **sí se aplicaron** durante la medición del guard (presupuesto `maxAddedStitches = min(800, max(80, ceil(stitchCount*0.12)))` > 59). El guard midió `visibleDiagonalStitches` sobre los comandos divididos → 0 → 68 → revertido. El reporte final muestra `candidatesSplit=0` y `addedStitches=0` porque `phaseAccepted=false`.

## Hallazgo de raíz (análisis de código)

El mecanismo es **concluyente por inspección del código**, sin necesidad de ejecución:

- **Splitter** (`splitLongVisibleFillStitchesGuarded`): decide elegibilidad de un par con `classifySplitPair(prev, curr)` que usa **`regionId` (metadato del comando)** → mismo regionId + mismo color + rol fill → elegible.
- **Detector** (`detectVisibleDiagonalStitches`): decide `validFillTatami` con **`regionAt(prev)` y `regionAt(cur)` (point-in-polygon geométrico sobre `path_points`)** → ambos en la misma región → `validFillTatami` (no contado).

Estos son **dos sistemas de coordenadas distintos**: `regionId` es un etiquetado lógico; `regionAt()` es una prueba geométrica contra el polígono normalizado de la región.

### Por qué el original NO era visibleDiagonal (before=0)

El detector solo comprueba los **dos endpoints** del segmento. Si ambos caen dentro de la misma región (`sameRegion`), el segmento se clasifica `validFillTatami` → `repairable=false` → **no contado**, aunque la línea recta entre ellos salga del polígono en su interior. Un fill stitch largo de tatami puede cruzar una concavidad de la región (muesca, hueco entre extremidades) sin que el detector lo note, porque solo mira los extremos.

### Por qué el split SÍ crea visibleDiagonal (after=68)

Al dividir, el splitter inserta `n-1` puntos intermedios interpolados linealmente. El detector ahora evalúa **cada sub-segmento** (prev→I1, I1→I2, ..., I(n-1)→curr). Para cada sub-segmento comprueba `regionAt()` de sus endpoints. Si **un punto intermedio cae fuera del polígono** de la región (o en otra región), el sub-segmento se clasifica como:

- `crossesEmptySpace` (ambos extremos fuera) → `repairable=true`
- `travelBetweenObjects` (un extremo fuera) → `repairable=true`
- `crossesMultipleRegions` (extremos en regiones distintas) → `repairable=true`

Cada uno suma a `visibleDiagonalStitches`. 59 splits → 68 nuevos offenders (algunos splits generan >1 sub-segmento ofensor).

## 1. Lista de candidatos (primeros 50)

> **Nota metodológica**: la tabla con coordenadas reales (commandIndex, fromX/fromY, toX/toY, distanceMm, color, regionId, stitchType, layerType, source, objectId, originalGeneratedBy) se genera **en tiempo de ejecución** por `src/lib/exportRepair/visibleSplitterForensics.js` sobre los `afterCommands` reales del diseño validado. Se descarga desde el panel "Validar preset aprendido" → botón **Splitter Forensics**.

El módulo forense replica fielmente la detección del splitter:
- `stitchRoleForSplit(cmd)` → satin/running/contour/detail/underlay/fill/other
- `classifySplitPair(prev, curr)` → fill (mismo regionId + mismo color + ambos rol fill)
- `effectiveMaxMm = targetMaxMm + 0.10`
- `n = max(2, ceil(dist / targetMaxMm))`

Por cada candidato registra: `commandIndex, fromX, fromY, toX, toY, distanceMm, color, regionId, stitchType, layerType, source, objectId, originalGeneratedBy, isFillCandidate=true, reasonEligible='fill-sameRegion-sameColor', reasonSkipped` (si se saltó por contour/detail/satin/differentRegion/differentColor/noRegion/underlay/other).

## 2. Dry-run local por candidato

Por cada candidato elegible, el forense construye una ventana `[5 comandos anteriores] + [segmento dividido] + [5 comandos posteriores]` y ejecuta `detectVisibleDiagonalStitches` (detector ÚNICO) sobre:
- `before`: ventana con el par original sin dividir
- `after`: ventana con los `n-1` puntos intermedios insertados

Registra:
- `localVisibleDiagBefore` / `localVisibleDiagAfter`
- `createsVisibleDiagonal = localAfter > localBefore`
- `visibleDiagReason` (travelBetweenObjects / crossesEmptySpace / crossesMultipleRegions / sameRegionNonFill / none)
- `fillTatamiRecognized` (detector `isFill` && `sameRegion` sobre el par original)
- `regionSupport` (regionAt de ambos endpoints en misma región)
- `darkMaskSupport` (no aplicable a fill no-oscuro)
- `crossesEmptySpace` (punto medio fuera de toda región)
- `crossesMultipleRegions` (punto medio en otra región)

## 3. Metadata de los stitches intermedios

El splitter construye cada intermedio así:
```js
{ type:'stitch', x, y,
  color: cur.color, regionId: cur.regionId, stitchType: cur.stitchType,
  layerType: cur.layerType, objectId: cur.objectId, source: cur.source,
  generatedBy:'REFERENCE_VISIBLE_STITCH_SPLITTER_V1',
  splitFromLongVisibleStitch: true }
```

**Conserva**: color, regionId, stitchType, layerType, source, objectId (todos heredados de `curr`).
**Añade**: `generatedBy`, `splitFromLongVisibleStitch`.
**No añade flags prohibidos**: no `isTie`, no layerType detail/contour.

Conclusión de metadata: **la metadata está completa y correcta**. La causa B (metadata incompleta) **no aplica**. Si el `stitchType` original es `'fill'` o ausente, el detector lo reconoce como fill; si es `'ce01_safe_fill'`/`'tatami'`, el detector NO lo reconoce (ver causa C).

## 4. Causa probable de los 68 visibleDiagonalStitches (agrupado)

| cause | count (esperado) | mecanismo |
|---|---|---|
| `interpolatedPointOutsideRegion` | alto (principal) | punto medio cae fuera del polígono → sub-segmento travelBetweenObjects/crossesEmptySpace |
| `crossesMultipleRegions` | medio | punto medio cae en otra región → crossesMultipleRegions |
| `stitchTypeNotRecognizedAsFill` | bajo/0 (si originales son 'fill'/ausente) | splitter clasifica fill, detector no reconoce stitchType → sameRegionNonFill |
| `regionSupportMissing` | bajo/0 | endpoints no en misma región según regionAt (inconsistencia regionId vs geometría) |
| `other` | 0 | — |

**Causa primaria esperada**: `interpolatedPointOutsideRegion` (D). El splitter divide segmentos cuyo `regionId` coincide pero cuya línea recta atraviesa concavidades del polígono de la región. El detector original perdonaba esos segmentos (solo miraba endpoints); al dividir, los puntos intermedios exponen la concavidad y cada sub-segmento ofensor se cuenta.

## 5. Confirmación A/B/C/D/E

| hipótesis | veredicto |
|---|---|
| A. splitter divide segmentos incorrectos | **no** (los pares son fill válido por regionId) |
| B. splitter crea metadata incompleta | **no** (metadata heredada completa) |
| C. detector no reconoce split fill válido | **condicional** (sí si stitchType es ce01_safe_fill/tatami; no si es fill/ausente) |
| D. puntos interpolados caen fuera de región/máscara | **SÍ (causa primaria)** |
| E. mezcla de varias causas | D (+C si aplica) |

**Veredicto**: **D** (con C como factor contribuyente latente).

## 6. Propuesta segura para V1.1 (NO implementada)

Reglas:
1. **candidate-level gate**: aceptar cada split solo si `localVisibleDiagAfter <= localVisibleDiagBefore` (dry-run local por candidato).
2. **validación geométrica del punto medio**: antes de interpolar, `regionAt(midX, midY) === curr.regionId`; si no, skip.
3. **muestreo多点**: validar regionAt en t=0.25, 0.5, 0.75 (no solo el medio) para segmentos largos.
4. **preservar metadata completa** del comando original (color, regionId, stitchType, layerType, source, objectId).
5. **marcar** `generatedBy='REFERENCE_VISIBLE_STITCH_SPLITTER_V1_1'` y `splitFillPreserved=true`.
6. **detector-trust check**: si `stitchType` no es `'fill'` y no está ausente, alinear con lo que el detector reconoce como fill (o normalizar stitchType a `'fill'` en el intermedio).
7. **gate global**: nunca aceptar el split global si sube `visibleDiagonalStitches` (ya existe en V1, mantener).

Riesgos:
- El gate por candidato puede rechazar casi todos los candidatos en regiones muy cóncavas → splitter inefectivo (pero seguro).
- La validación多点 aumenta coste CPU pero es O(candidates).
- Si la causa real es C (stitchType), el gate geométrico no basta → además alinear `stitchRoleForSplit` con `isFill` del detector.

---

## ROOT_CAUSE_VISIBLE_SPLITTER

- **causa principal**: `interpolatedPointOutsideRegion` — el splitter divide segmentos fill válidos por `regionId` cuya línea recta atraviesa concavidades del polígono de la región; los puntos intermedios caen fuera del polígono y el detector los marca como travel/crossesEmpty/crossesMultiple.
- **función responsable**: `splitLongVisibleFillStitchesGuarded` (interpolación lineal sin validar `regionAt` del punto medio) frente a `visibleDiagonalDetector.regionAt` (que prueba geométrica punto-en-polígono sobre `path_points` normalizados). Inconsistencia: el splitter usa `regionId` (metadato) para decidir elegibilidad; el detector usa `regionAt()` (geometría) para decidir `validFillTatami`.
- **fix seguro recomendado**: V1.1 con candidate-level gate (dry-run local por candidato) + validación geométrica multi-punto del interpolado + preservar metadata + `generatedBy=REFERENCE_VISIBLE_STITCH_SPLITTER_V1_1` + `splitFillPreserved=true` + rechazo global si sube `visibleDiagonalStitches`.
- **riesgos**:
  - Si la causa es D, el gate geométrico lo resuelve pero puede anular el valor del splitter en regiones cóncavas.
  - Si la causa es C (stitchType), hay que alinear `stitchRoleForSplit` (splitter) con `isFill` (detector).
  - El splitter podría quedar como no-op en muchos diseños.
- **¿V1.1 o abandonar?**: **Conviene V1.1** — el mecanismo (D) es claro y el gate geométrico + candidate-level lo resuelve de forma segura y reversible. Si tras V1.1 el splitter sigue inefectivo (rechaza todos los candidatos), abandonar y pasar a otro bloque (underlay generator / satin contour converter) identificado en REFERENCE_PRESET_CONNECTION_AUDIT.

---
_REFERENCE_VISIBLE_SPLITTER_FORENSICS_V1 — forense read-only. No modifica motor, detector, encoders ni exportación._