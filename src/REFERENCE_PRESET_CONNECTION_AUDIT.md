# REFERENCE_PRESET_CONNECTION_AUDIT — StitchPath AI

> Generado: 2026-07-04
> Auditoría de conexión entre el preset aprendido (Reference Learning Engine v2) y
> las funciones que generan/modifican los comandos reales.
> **Solo informe. No se aplica ninguna mejora. No se toca V5.1, safeAddTieInTieOffV2,
> removeEmptyBlocks, repairVisibleDiagonalStitches, ni encoders DST/DSB.**

---

## Resumen ejecutivo

El preset aprendido se mapea a `config.learned*` keys (vía `presetToConfigPatch`) y
**sí llega al pipeline profesional** (`applyProfessionalPipeline`), pero **NO llega al
generador base de comandos** (`buildFinalCommands` / `flattenToCommands`). El resultado
es que varias keys se aplican "en config" pero **no gobiernan los comandos reales**:

- `learnedMaxVisibleStitchMm` no divide puntadas; solo umbraliza conversión de
  diagonales oscuras/no soportadas → **maxVisibleStitchMm 7.31 → 11.77 (> preset 4.03)**.
- `learnedUnderlayEnabled` es **completamente huérfana**: nadie la lee → underlayCount=0.
- `learnedUseSatinForOuterContours=true` es **no-op**: el pipeline solo convierte
  satin→running cuando es `false`; nunca convierte running→satin → satinContourCount=0.
- `learnedTrimBeforeTravelMm` sí se aplica, **sin límite ni deduplicación global** →
  trimCount 91 → 314 (+223).
- `learnedConvertTravelAboveMmToJump` elimina diagonales (7→0) pero **no reduce** saltos
  largos same-region → jumpCount 301 → 307 (+6).

Veredicto global: **WORSENED** se explica por trimCount▲ (+223), jumpCount▲ (+6) y
maxVisibleStitchMm▲ (7.31→11.77), mientras que visibleDiagonalStitches✅ (7→0) no compensa.

---

## Flujo real (trazado)

`learnedPresetValidator.js`:
- **ANTES**: `buildFinalCommands(regiones, beforeConfig {professionalMode:false, sin learned*})` →
  `professionalEmbroideryQualityGate` (NO `applyProfessionalPipeline`, porque
  `professionalMode=false` hace que retorne early en línea 504).
- **DESPUÉS**: `buildFinalCommands(regiones, afterConfig {learned* + professionalMode=true})` →
  `applyProfessionalPipeline({commands, objects, regions, config, darkStroke})` → gate.

`buildFinalCommands` (`exportPipeline.js`) **solo lee** `config.width_mm`,
`config.height_mm`, `config.ce01SafeFillMode`, `config.darkStroke`. **No lee ninguna
key `learned*`**. Por tanto las keys aprendidas atraviesan `buildFinalCommands` sin
efecto y solo son consumidas después por `applyProfessionalPipeline`.

---

## 1. learnedMaxVisibleStitchMm (preset = 4.03mm)

| Punto de control | ¿Llega? | Evidencia |
|---|---|---|
| Se guarda en config | ✅ | `referenceLearningApplier.presetToConfigPatch` línea 140: `learnedMaxVisibleStitchMm: preset.maxVisibleStitchMm` |
| Llega a `buildFinalCommands` | ❌ | `exportPipeline.buildFinalCommands`/`flattenToCommands` no leen `config.learnedMaxVisibleStitchMm`. Dividen puntadas en `ms.maxStitchLength` (12.1mm), no en 4.03mm (línea 252). |
| Llega a `applyProfessionalPipeline` | ✅ | `professionalDigitizingMode.js` líneas 512-518: `learnedParams.maxVisibleStitchMm = config.learnedMaxVisibleStitchMm`; además `suspiciousDiagonalMinMm = min(2.5, 4.03) = 2.5` (clampeado, NO sube a 4.03). |
| Llega a `classifyVisibleDiagonalStitch` | ⚠️ parcial | Usa `p.suspiciousDiagonalMinMm` (2.5) y `p.longConnectorMm`, **no** `maxVisibleStitchMm`. El umbral sospechoso sigue en 2.5mm. |
| Llega al "detector de maxVisibleStitchMm" | n/a | No hay tal detector. El valor medido en el informe (`after.maxVisibleStitchMm`) lo calcula `learnedPresetValidator.maxVisibleStitchMm()` (líneas 177-188): **máxima longitud de puntada en el stream**, no el config. |
| Se usa para cortar/split/convertir | ⚠️ parcial | `validateVisibleStitchesBeforeExport` (líneas 146, 159) convierte a trim+jump solo si `dist > maxVisibleStitchMm` **Y** (dark sin máscara sin región) **O** (no-dark sin región). **No divide** puntadas; **no corta** same-region fills. |

### ¿Por qué maxVisibleStitchMm preset=4.03 pero medido 7.31 → 11.77?

1. `buildFinalCommands` genera puntadas de relleno de hasta **12.1mm** (límite DST),
   no 4.03mm. No existe un splitter que capee cada puntada visible a 4.03mm.
2. `validateVisibleStitchesBeforeExport` solo convierte a jump+trim las puntadas
   largas que son **oscuras sin soporte de máscara/región** o **no-oscuras sin región**.
   Una puntada de relleno **dentro de su misma región** (same-region fill) de 11.77mm
   **se conserva intacta** porque tiene `regionSup` y/o `maskSup`.
3. `classifyVisibleDiagonalStitch` descarta same-region fills explícitamente
   (`sameRegionFill`, línea 197) → no se marcan como sospechosas → no se reparan.
4. Por tanto el valor medido `maxVisibleStitchMm` refleja la puntada same-region más
   larga, que el preset **no gobierna**. El preset solo controla el umbral de
   conversión de travel/diagonales no soportadas.

**configApplied**: true · **consumedByFunction**: parcial (validateVisibleStitchesBeforeExport) ·
**changedCommands**: solo para diagonales/travel no soportados, NO para same-region fills ·
**responsable**: `src/lib/exportPipeline.js` (splitter usa 12.1mm) +
`src/lib/professionalDigitizingMode.js` (sin splitter de visible-stitch).

---

## 2. learnedConvertTravelAboveMmToJump

| Punto de control | ¿Llega? | Evidencia |
|---|---|---|
| Se mapea a `longConnectorMm` | ✅ | `applyProfessionalPipeline` líneas 531-533: `learnedParams.longConnectorMm = config.learnedConvertTravelAboveMmToJump` |
| Se aplica antes de generar commands | ❌ | Se aplica **después** de `buildFinalCommands`, dentro de `applyProfessionalPipeline`, vía `classifyVisibleDiagonalStitch` (línea 201: `longConnector = dist > p.longConnectorMm`). |
| Convierte stitches >6mm visibles en jump/trim | ⚠️ parcial | Solo stitches que además son **diagonales que cruzan regiones** (angle diagonal + crosses + black/contour/longConnector). `repairVisibleDiagonalStitches` los convierte a trim+jump. Same-region long travel **no se convierte**. |
| Respeta regiones y máscara | ✅ | `regionSupportForPoint` + `segmentDarkSupport` (líneas 76-108). |

**Veredicto**: consumido y eficaz para diagonales que cruzan espacio vacío (por eso
`visibleDiagonalStitches 7 → 0`), pero **no reduce** `maxVisibleStitchMm` porque no
afecta same-region fills. Mapeo correcto; alcance limitado por diseño del clasificador.

**configApplied**: true · **consumedByFunction**: true · **changedCommands**: true (solo diagonales) ·
**responsable**: `src/lib/professionalDigitizingMode.js` (`classifyVisibleDiagonalStitch`, `repairVisibleDiagonalStitches`).

---

## 3. learnedTrimBeforeTravelMm

| Punto de control | ¿Llega? | Evidencia |
|---|---|---|
| Se usa para añadir trim antes de saltos largos | ✅ | `applyProfessionalPipeline` líneas 583-586 → `insertTrimBeforeLongJumps(procCommands, trimBeforeMm)` (líneas 616-635). Inserta `{type:'trim'}` antes de cada `jump` con `dist > trimBeforeMm`. |
| ¿Está causando trimCount 91 → 314? | ✅ MUY PROBABLE | +223 trims coincide con la inserción de un trim antes de cada salto largo. Tras `repairVisibleDiagonalStitches` + `validateVisibleStitchesBeforeExport`, muchas diagonales/travels se convirtieron en trim+jump, generando muchos saltos largos; `insertTrimBeforeLongJumps` añade un trim delante de cada uno. |
| Existe límite máximo o deduplicación | ❌ | Solo dedup local: si el comando anterior inmediato ya es `trim`, no inserta otro (línea 626). **No hay tope máximo**, **no hay batch**, **no hay agrupación por color/bloque**. Firing ilimitado. |

**Veredicto**: consumido y eficaz, pero **sin techo**. Es la causa principal del
WORSENED vía trimCount▲. Requiere un máximo / deduplicación global (no implementado).

**configApplied**: true · **consumedByFunction**: true · **changedCommands**: true (inserta trims) ·
**responsable**: `src/lib/professionalDigitizingMode.js` (`insertTrimBeforeLongJumps`).

---

## 4. learnedUseSatinForOuterContours

| Punto de control | ¿Llega? | Evidencia |
|---|---|---|
| Llega al generador de contornos | ❌ | `contourExportBuilder.buildContourObjects`/`generateContourStitches` usan constantes estáticas de `cleanCartoonOutlineCE01` (outerSatinWidthMm, outerSatinDensityMm) y heurísticas de `stitch_type`/ancho. **No leen** `config.learnedUseSatinForOuterContours`. La key solo llega a `applyProfessionalPipeline`. |
| Intenta convertir outer outline a satin | ❌ | `applyProfessionalPipeline` líneas 575-578 **solo actúa si `=== false`** (convierte satin→running). El branch `=== true` (override cartoon) **no hace nada**: no convierte running→satin. |
| ¿Por qué satinContourCount sigue 0? | — | El motor base genera contornos `running_stitch` por defecto. El pipeline profesional nunca crea satin a partir de running. Con `useSatinForOuterContours=true` no hay conversión → satinContourCount=0. |
| ¿Por qué runningContourCount sigue 3? | — | Los 3 contornos running existentes no se modifican (no hay conversión en ningún sentido cuando el flag es true). |

**Veredicto**: **fake config success** cuando `=true`. La key solo tiene efecto real
cuando `=false` (satin→running). Para conseguir satin outer habría que inyectar la
conversión running→satin en el generador de contornos, que hoy no existe.

**configApplied**: true · **consumedByFunction**: solo rama `=== false` ·
**changedCommands**: false cuando `=true` · **responsable**: `src/lib/contourExportBuilder.js`
(no lee la key) + `src/lib/professionalDigitizingMode.js` (solo convierte satin→running).

---

## 5. learnedContourAfterFill

| Punto de control | ¿Llega? | Evidencia |
|---|---|---|
| `reorderProfessionalLayers` lo usa | ✅ | `reorderProfessionalLayers` línea 285: `contourAfterFill = params.contourAfterFill !== false`. `applyProfessionalPipeline` líneas 556-559 lo pasa. Con `true` los contornos mantienen prioridad tras relleno (default); con `false` restan 45 (contorno antes). |
| El contorno exterior queda después del relleno | ✅ | Con `true` el orden se preserva (contornos prioritarios 50/60 tras fills 20). Efecto real. |
| ¿Genera exceso de trims? | ⚠️ indirecto | `reorderProfessionalLayers` inserta `color_change` entre bloques (línea 316) pero **no inserta trims**. Sin embargo, reordenar bloques cambia las distancias de salto → `insertTrimBeforeLongJumps` (#3) dispara más trims. Contribuyente indirecto a trimCount▲. |

**Veredicto**: consumido y eficaz para orden de capas. El exceso de trims es efecto
secundario vía #3, no directo.

**configApplied**: true · **consumedByFunction**: true · **changedCommands**: true (orden) ·
**responsable**: `src/lib/professionalDigitizingMode.js` (`reorderProfessionalLayers`).

---

## 6. learnedUnderlayEnabled

| Punto de control | ¿Llega? | Evidencia |
|---|---|---|
| `underlayEnabled=true` llega al generador | ❌ | `presetToConfigPatch` línea 147 fija `learnedUnderlayEnabled`, pero **nadie lo lee**. `applyProfessionalPipeline` no mapea `config.learnedUnderlayEnabled` a ningún `learnedParams.*` (no aparece en líneas 511-545). `PROFESSIONAL_PARAMS` tiene `underlayMinAreaMm2` pero no hay fase generadora de underlay en el pipeline profesional. |
| ¿Por qué underlayCount sigue 0? | — | (a) Las regiones de relleno usan `generateCE01SafeFillCommands` en `flattenToCommands` (líneas 167-192), que **byassea** `processObjectStitches` (donde estaría el underlay). (b) `processObjectStitches` (industrialStitchProcessor) puede tener lógica de underlay propia, pero **no lee** `learnedUnderlayEnabled` y no etiqueta comandos con `layerType/source` 'underlay' que el gate cuente. El gate cuenta underlays por `layerType`/`source` que incluyan 'underlay' (línea 462); al no generarse, underlayCount=0. |

**Veredicto**: **fake config success total**. La key es huérfana: se escribe en config
pero ninguna función la consume. Requiere un generador de underlay conectado a la key.

**configApplied**: true · **consumedByFunction**: false · **changedCommands**: false ·
**responsable**: `src/lib/referenceLearning/referenceLearningApplier.js` (define la key) —
sin consumidor en `src/lib/professionalDigitizingMode.js` ni `src/lib/exportPipeline.js`.

---

## 7. Detección de fake config success

Tabla consolidada de parámetros que aparecen como "aplicados en config" pero su efecto
real sobre los comandos es nulo o parcial:

| Parámetro | configApplied | consumedByFunction | changedCommands | Evidencia | Archivo/función responsable |
|---|---|---|---|---|---|
| `learnedMaxVisibleStitchMm` | ✅ true | ⚠️ parcial (`validateVisibleStitchesBeforeExport`) | ⚠️ solo diagonales/travel no soportados; NO same-region fills | preset=4.03, medido=11.77. No hay splitter que capee visible stitches; buildFinalCommands divide a 12.1mm | `exportPipeline.js` (splitter 12.1mm) + `professionalDigitizingMode.js` (sin splitter visible) |
| `learnedConvertTravelAboveMmToJump` | ✅ true | ✅ true (`classifyVisibleDiagonalStitch` vía `longConnectorMm`) | ✅ true (solo diagonales que cruzan) | visibleDiagonalStitches 7→0; no afecta same-region fills | `professionalDigitizingMode.js` |
| `learnedTrimBeforeTravelMm` | ✅ true | ✅ true (`insertTrimBeforeLongJumps`) | ✅ true (inserta trims) | trimCount 91→314 (+223); sin tope/dedup global | `professionalDigitizingMode.js` |
| `learnedUseSatinForOuterContours` | ✅ true | ⚠️ solo rama `=== false` | ❌ false cuando `=true` | satinContourCount 0→0; no existe running→satin | `contourExportBuilder.js` (no lee key) + `professionalDigitizingMode.js` (solo satin→running) |
| `learnedContourAfterFill` | ✅ true | ✅ true (`reorderProfessionalLayers`) | ✅ true (orden capas) | efecto real; trim▲ es indirecto vía #3 | `professionalDigitizingMode.js` |
| `learnedUnderlayEnabled` | ✅ true | ❌ false | ❌ false | underlayCount 0→0; key huérfana sin consumidor | `referenceLearningApplier.js` (define) — sin lector |
| `learnedDetailsLast` | ✅ true | ✅ true (`reorderProfessionalLayers`) | ✅ true (orden detalles) | efecto real | `professionalDigitizingMode.js` |

### Resumen de gaps accionables (no aplicados — solo documentados)

1. **maxVisibleStitchMm**: falta un splitter de visible-stitches quecapee same-region
   fills a 4.03mm (o que aplique la regla J003 sobre todas las puntadas, no solo las no
   soportadas). Hoy el límite lo fija `ms.maxStitchLength`=12.1mm en `flattenToCommands`.
2. **useSatinForOuterContours=true**: falta conversión running→satin en el generador
   de contornos cuando la key es true y el ancho lo permite (≥ `minSatinWidthMm`).
3. **underlayEnabled**: falta una fase generadora de underlay conectada a la key.
4. **trimBeforeTravelMm**: falta tope máximo / deduplicación global / agrupación por
   bloque para evitar trimCount▲ descontrolado.

---

## Notas metodológicas

- Toda la evidencia se obtuvo leyendo el código fuente:
  `referenceLearningApplier.js`, `learnedPresetValidator.js`,
  `referenceLearningValidatedReport.js`, `cartoonOutlineOverride.js`,
  `professionalDigitizingMode.js`, `exportPipeline.js`, `contourExportBuilder.js`,
  `industrialStitchProcessor.js`.
- No se ejecutó el pipeline (corre en navegador). Los valores numéricos del informe
  (4.03, 11.77, 91→314, etc.) provienen de los datos reales reportados por el usuario
  (REFERENCE_LEARNING_VALIDATED_REPORT).
- **No se modificó ningún archivo de código.** Este documento es solo auditoría.

---
---

## 8. ROOT_CAUSE_SUMMARY

### Parámetros que SÍ llegan a comandos reales (changedCommands=true)

| Parámetro | Vía | Efecto real |
|---|---|---|
| `learnedConvertTravelAboveMmToJump` | `longConnectorMm` → `classifyVisibleDiagonalStitch` → `repairVisibleDiagonalStitches` | convierte diagonales que cruzan espacio vacío a trim+jump (visibleDiagonalStitches 7→0) |
| `learnedTrimBeforeTravelMm` | `insertTrimBeforeLongJumps` | inserta trim antes de saltos largos (trimCount 91→314) |
| `learnedContourAfterFill` | `reorderProfessionalLayers` | ordena contornos tras relleno |
| `learnedDetailsLast` | `reorderProfessionalLayers` | reordena detalles al final |

### Parámetros que SOLO cambian config (changedCommands=false o parcial)

| Parámetro | configApplied | consumedByFunction | changedCommands | Causa raíz |
|---|---|---|---|---|
| `learnedMaxVisibleStitchMm` | ✅ | ⚠️ parcial | ⚠️ solo diagonales no soportadas | `buildFinalCommands` divide a 12.1mm (ms.maxStitchLength), no a 4.03mm. No existe splitter de visible-stitch para same-region fills. |
| `learnedUseSatinForOuterContours` | ✅ | ⚠️ solo rama `=== false` | ❌ cuando `=true` | `contourExportBuilder` no lee la key; `applyProfessionalPipeline` solo convierte satin→running, nunca running→satin. |
| `learnedUnderlayEnabled` | ✅ | ❌ | ❌ | **key huérfana**: escrita por `presetToConfigPatch`, sin ningún lector. No hay fase generadora de underlay en el pipeline profesional. |

### Funciones que ignoran keys `learned*`

- `buildFinalCommands` / `flattenToCommands` (`src/lib/exportPipeline.js`): solo leen `config.width_mm`, `config.height_mm`, `config.ce01SafeFillMode`, `config.darkStroke`. **No leen ninguna key `learned*`** → los valores aprendidos atraviesan el generador base sin efecto.
- `contourExportBuilder.buildContourObjects` / `generateContourStitches` (`src/lib/contourExportBuilder.js`): usan constantes estáticas de `cleanCartoonOutlineCE01` y heurísticas de `stitch_type`/ancho. **No leen** `config.learnedUseSatinForOuterContours`.
- `generateCE01SafeFillCommands` (`src/lib/ce01SafeFillGenerator.js`): bypass del underlay en `flattenToCommands`.
- `processObjectStitches` (`src/lib/industrialStitchProcessor.js`): no lee `learnedUnderlayEnabled` y no etiqueta comandos con `layerType/source='underlay'`.

### Funciones que usan valores hardcoded

- `flattenToCommands`: splitter hardcoded a `ms.maxStitchLength` = **12.1mm** (límite DST). No existe un splitter con el valor aprendido 4.03mm.
- `applyProfessionalPipeline`: `suspiciousDiagonalMinMm = min(2.5, config.learnedMaxVisibleStitchMm)` → clampeado a **2.5mm**; no sube a 4.03mm.
- `cleanCartoonOutlineCE01`: `outerSatinWidthMm`, `outerSatinDensityMm`, `minSatinWidthMm` constantes.
- `PROFESSIONAL_PARAMS`: `underlayMinAreaMm2` definido pero sin fase generadora que lo consuma.

### Arreglos seguros (no tocan V5.1 / Safe Tie / encoders / exportación)

1. **`learnedMaxVisibleStitchMm`** — añadir un splitter de visible-stitch en `applyProfessionalPipeline` (post-`buildFinalCommands`) que divida same-region fills >4.03mm en sub-puntadas. Reversible, no toca el generador base ni el encoder.
2. **`learnedUseSatinForOuterContours=true`** — en `applyProfessionalPipeline`, convertir contornos outer `running_stitch` a `satin` cuando el ancho lo permita (≥ `minSatinWidthMm`). Reversible, no toca `contourExportBuilder`.
3. **`learnedUnderlayEnabled`** — añadir una fase generadora de underlay en `applyProfessionalPipeline` conectada a la key, etiquetando comandos con `layerType='underlay'`. No toca el generador base.
4. **`learnedTrimBeforeTravelMm`** — añadir tope máximo + deduplicación global / agrupación por bloque en `insertTrimBeforeLongJumps`. Reversible, no toca V5.1.

### Arreglos peligrosos (requieren tocar motor protegido)

1. **Modificar `buildFinalCommands` / `flattenToCommands`** para que divida a `learnedMaxVisibleStitchMm` → **PELIGROSO**: cambia el generador base usado por simulación, validation y export; rompería la equivalencia Final Look ↔ Exportable y el invariant SIMULATION_EXPORT_MISMATCH.
2. **Modificar `contourExportBuilder`** para leer `learnedUseSatinForOuterContours` → **PELIGROSO**: el generador de contornos alimenta el motor base y el Final Look; cambiar stitch_type ahí afecta a toda la cadena de visualización y exportación.
3. **Modificar `removeEmptyBlocks` / `repairVisibleDiagonalStitches`** para honrar `learnedMaxVisibleStitchMm` → **PROHIBIDO** por checkpoint (V5.1 intacto).
4. **Modificar `dstDirectExport` / `dstEncoder`** → **PROHIBIDO** por checkpoint (encoders intactos).
5. **Modificar `getEffectiveExportCommands` / `handleExport` / `canExportInCE01ProductionMode`** → **PROHIBIDO** por checkpoint (exportación intacta).

### Conclusión raíz

El preset aprendido se aplica "en config" pero **3 keys son fake config success**:
`learnedMaxVisibleStitchMm` (parcial), `learnedUseSatinForOuterContours` (no-op cuando true),
`learnedUnderlayEnabled` (huérfana). Las 3 producen `changedCommands=false`, lo que explica
satinContourCount 0→0, runningContourCount 3→3, underlayCount 0→0 y maxVisibleStitchMm 7.31→11.77.
El WORSENED lo domina `learnedTrimBeforeTravelMm` sin techo (trimCount 91→314). Los arreglos seguros
se confinan a `applyProfessionalPipeline` (capa post-generador) y no tocan el motor protegido.

---
_Auditoría de conexión del preset aprendido — Reference Learning Engine v2. Solo informe._