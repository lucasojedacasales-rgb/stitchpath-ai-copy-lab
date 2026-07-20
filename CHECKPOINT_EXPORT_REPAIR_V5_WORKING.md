# CHECKPOINT — EXPORT_REPAIR_V5_WORKING

> Fecha: 2026-07-03
> Estado: **ESTABLE / CONFIRMADO**
> Flujo: Exportación reparada (pre-export repair pipeline v5)

## Motivo

El flujo de exportación reparada ya funciona. `EXPORT_REPAIR_REPORT_V5` confirma
que los `repairedCommands` se aceptan, se validan y se usan para exportar DST/DSB,
sin errores bloqueantes restantes y respetando el Final Look visual.

## Estado confirmado por EXPORT_REPAIR_REPORT_V5

| Métrica | Valor |
|---|---|
| repairAccepted | **SÍ** |
| exportAllowed | **SÍ** |
| commandSourceUsedForExport | **repaired** |
| DST usa repairedCommands | **true** |
| DSB usa repairedCommands | **true** |
| visibleDiagonalStitches | **11 → 0** |
| emptyBlocks | **1 → 0** |
| CE01 status | **RISKY** (no INVALID) |
| CE01 score | **53 → 59** |
| Errores bloqueantes restantes | **0** |

## Criterios de éxito cumplidos

- ✅ `visibleDiagonalStitches` returned = 0
- ✅ `emptyBlocks` returned = 0
- ✅ `commandSourceUsedForExport` = repaired
- ✅ `exportAllowed` = true
- ✅ CE01 status ≠ INVALID (RISKY = exportar con advertencia)
- ✅ DST/DSB exportan `repairedCommands`
- ✅ No desaparecen boca, ojos, pies ni contorno
- ✅ Final Look y Export sincronizados

## Pipeline V5 (orden confirmado)

1. `removeEmptyBlocks`
2. `repairVisibleDiagonalStitches` — aceptada aunque `longSt` suba (soft para blockingFix)
3. `removeDuplicateStitches`
4. `addTieInTieOff`
5. `reduceColorChangesIfSafe`
6. `removeEmptyBlocksFinal`
7. Final validation

## Cambios clave del estado (no revertir)

- **Detector de longSt** (`exportErrorDetector.js`): `prevStitch` se actualiza al
  aterrizar un `jump`, de modo que la puntada siguiente se mide desde la posición
  real de la aguja. Antes medía desde el último stitch → inflaba `longSt` al
  convertir diagonales en `trim+jump` (39→41 falso). Ahora: before=0, after=0.
- **Aceptación transaccional** (`repairFinalLookCommandsForExport.js`):
  `unsupportedLongStitches` es métrica *soft* para fases `blockingFix`; no revierte
  `repairVisibleDiagonalStitches` solo por un leve aumento de `longSt`. Se marca
  `acceptedDespiteLongStIncrease`.
- **Decisión global**: acepta `repairedCommands` si `emptyBlocks=0`,
  `visibleDiag=0`, `invalidCmd=0`, `outOfBounds=0`, CE01 ≠ INVALID y sin regresión
  grave. No bloquea por RISKY, ni por warnings de shortSt/longSt/trims/jumps.
- **Report V5** (`exportRepairReport.js`): veredicto + bloqueos + fase diagonal
  (detected/removed/converted/acceptedDespiteLongStIncrease/longSt before-after) +
  final validation source/repaired/returned.

## Archivos que NO se modifican a partir de aquí (salvo requerimiento explícito)

- DST encoder / DSB encoder
- CE01 loader
- Detector universal de contornos
- Aprendizaje del corpus (Reference Learning)
- Final Look visual
- Colores principales
- Clasificación `validFillTatami`
- Clasificación `contourWithDarkMask`

## Punto de retorno seguro

Si una regresión futura rompe la exportación reparada, volver a este checkpoint:
- `repairVisibleDiagonalStitches` debe quedar **aceptada** con
  `acceptedDespiteLongStIncrease = true`.
- `visibleDiagonalStitches` returned debe ser **0**.
- `commandSourceUsedForExport` debe ser **repaired**.
- CE01 debe quedar **RISKY o SAFE**, nunca **INVALID**.