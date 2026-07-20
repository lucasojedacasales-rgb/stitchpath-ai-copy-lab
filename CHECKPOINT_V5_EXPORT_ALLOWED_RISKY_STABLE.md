# CHECKPOINT_V5_EXPORT_ALLOWED_RISKY_STABLE — StitchPath AI

> **Checkpoint estable de rollback.** No modifica código. Documenta el estado
> verificado del flujo de exportación V5 como punto de retorno seguro.
>
> Fecha: 2026-07-03

---

## Motivo

El flujo V5 ya permite exportar usando `repairedCommands`. Este checkpoint fija
el estado estable para poder revertir a él si una modificación futura rompe el
flujo de exportación o los invariantes de CE01.

---

## Estado confirmado

| Campo | Valor |
|---|---|
| repairAccepted | **SÍ** |
| exportAllowed | **SÍ** |
| commandSourceUsedForExport | **repaired** |
| DST usa repairedCommands | **true** |
| DSB usa repairedCommands | **true** |
| visibleDiagonalStitches (returned) | **0** |
| emptyBlocks (returned) | **0** |
| invalidCommandSequence (returned) | **0** |
| regionOutsideBounds (returned) | **0** |
| CE01 status | **RISKY** (no INVALID) |
| CE01 score | **59** |
| Errores bloqueantes restantes | **ninguno** |

---

## Invariantes del checkpoint (no deben romperse)

1. `commandSourceUsedForExport = repaired` — todo botón de exportación real
   (DST/DSB) usa `repairedCommands` cuando `repairAccepted=true`.
2. `exportAllowed = true` requiere `ce01.status !== 'INVALID'` y
   `remainingBlockingIssues.length === 0`.
3. `visibleDiagonalStitches = 0` y `emptyBlocks = 0` en los comandos devueltos.
4. `invalidCommandSequence = 0` y `regionOutsideBounds = 0` en los comandos devueltos.
5. CE01 nunca pasa a `INVALID` por el repair; `RISKY` permite exportación con advertencia.
6. Encoder DST/DSB no se modifica por el repair — solo cambia el input de comandos.
7. Detector universal, aprendizaje del corpus y Final Look visual permanecen intactos.

---

## Flujo V5 (orden de fases transaccional)

```
finalLookCommands
  → removeEmptyBlocks        (transaccional: revierte si empeora)
  → repairVisibleDiagonalStitches  (blockingFixPriority: prioridad sobre score)
  → removeDuplicateStitches
  → addTieInTieOff
  → reduceColorChangesIfSafe
  → removeEmptyBlocksFinal
  → globalRepairAccepted?   (no bloqueos restantes + CE01 no INVALID + sin regresión grave)
  → polish V1 (post-V5, solo warnings, reversible)
  → returnedMetrics (sobre comandos devueltos)
  → exportAllowed + remainingBlockingIssues
```

---

## Helper de selección de comandos

`getEffectiveExportCommands` centraliza la selección con prioridad:

1. `repairedCommands` (si `repairAccepted`)
2. `productionReport.commands` (si `exportAllowed`)
3. `editorFinalCommands`
4. `pipelineResult.commands`

Integrado en: `ExportModal` (handleExport, botón Kirby completo, ValidationPreview
modo exportable, ExportRealityCheck, ContourRefinePanel, unifiedMetrics,
realityCheck, contourReport) y `CE01ProductionPanel` (prop `effectiveSource`).

---

## Criterios de rollback (cuándo volver a este checkpoint)

Volver a este checkpoint si una modificación futura provoca **cualquiera** de:

- `commandSourceUsedForExport` deja de ser `repaired` cuando `repairAccepted=true`.
- `exportAllowed = false` con `ce01.status = RISKY` y sin bloqueantes restantes.
- `visibleDiagonalStitches > 0` en los comandos devueltos.
- `emptyBlocks > 0` en los comandos devueltos.
- `ce01.status = INVALID` tras el repair.
- Encoder DST/DSB recibe comandos no reparados cuando `repairAccepted=true`.
- Regresión en `duplicateStitches`, `shortStitches` o `stitchCountOverLimit`
  más allá de los umbrales del gate global.

---

## Archivos que constituyen el checkpoint (no modificar sin volver a documentar)

- `src/lib/exportRepair/repairFinalLookCommandsForExport.js` — orquestador V5 + polish.
- `src/lib/exportRepair/exportErrorDetector.js` — detección de errores + CE01.
- `src/lib/exportRepair/preExportRepairer.js` — fases de reparación.
- `src/lib/exportRepair/exportPolish.js` — polish V1 (post-V5).
- `src/lib/exportRepair/exportPolishReport.js` — informe de polish.
- `src/lib/exportRepair/exportRepairReport.js` — EXPORT_REPAIR_REPORT_V5.
- `src/lib/exportRepair/visibleDiagonalDetector.js` — detector universal (compartido).
- `src/lib/exportRepair/getEffectiveExportCommands.js` — helper de selección.
- `src/lib/ce01Validator.js` — validador CE01 (no relajado).
- `src/lib/dstEncoder.js` / `src/lib/dsbEncoder.js` — encoders (intactos).
- `src/components/editor/ExportModal.jsx` — uso del helper en exportación real.
- `src/components/editor/CE01ProductionPanel.jsx` — muestra `effectiveSource`.
- `src/components/editor/ExportRepairPanel.jsx` — UI del repair V5 + polish.

---

## Documentos relacionados

- `EXPORT_V5_CONNECTION_AUDIT.md` — auditoría de conexión de botones al helper.
- `src/CE01_INVALID_FORENSICS_REPORT.md` — forense de un caso INVALID anterior
  (causa: reglas no vigiladas por el reporte V5: check 1 / check 13). Este
  checkpoint corresponde al estado donde ese caso ya está resuelto (RISKY).

---

## Estado: ESTABLE ✅

Este es el punto de rollback oficial del flujo de exportación V5. Cualquier
cambio futuro que rompa los invariantes anteriores debe revertirse a este estado.

_Checkpoint de solo documentación. Sin cambios de código._