# CHECKPOINT_EXPORT_REPAIR_V5_1_TRAVEL_WORKING_SCORE67 — StitchPath AI

> Fecha: 2026-07-04
> Punto de rollback estable para el pipeline de reparación pre-export.
> **No modificar código.** Este documento solo certifica un estado validado.

---

## Motivo

El flujo V5.1 + Travel Polish queda exportable y mejora CE01. Se documenta como
checkpoint estable de rollback.

## Estado confirmado

| Métrica | Valor |
|---|---|
| repairAccepted | SÍ |
| exportAllowed | SÍ |
| commandSourceUsedForExport | repaired |
| CE01 status | RISKY (no INVALID) |
| CE01 score | 67 |
| visibleDiagonalStitches | 0 |
| emptyBlocks | 0 |
| invalidCommandSequence | 0 |
| regionOutsideBounds | 0 |
| jumpCount (returned) | 48 |
| trimCount (returned) | 37 |
| colorCount (returned) | 2 |
| DST usa repairedCommands | true |
| DSB usa repairedCommands | true |

## Invariante V5.1 + Travel Polish

- Cero `visibleDiagonalStitches`.
- Cero `emptyBlocks`.
- Cero `invalidCommandSequence`.
- Cero `regionOutsideBounds`.
- CE01 status no INVALID (RISKY permite export).
- Travel Polish aceptado: reduce jumps/trims sin romper invariantes V5 ni bajar
  `ce01Score` más de 3 puntos.

## Archivos implicados (no modificar)

- `src/lib/exportRepair/repairFinalLookCommandsForExport.js`
- `src/lib/exportRepair/travelPolish.js`
- `src/lib/exportRepair/preExportRepairer.js`
- `src/lib/exportRepair/visibleDiagonalDetector.js`
- `src/lib/exportRepair/exportErrorDetector.js`
- `src/components/editor/ExportRepairPanel.jsx`

## Uso del checkpoint

Si una futura iteración (splitter de visible-stitch, conversión running→satin,
generador de underlay, o tope de `trimBeforeTravelMm`) rompe alguno de los
invariantes anteriores, **revertir a este estado** antes de seguir depurando.

---

_Checkpoint estable. Pipeline V5.1 + Travel Polish · CE01 score 67 · RISKY exportable._