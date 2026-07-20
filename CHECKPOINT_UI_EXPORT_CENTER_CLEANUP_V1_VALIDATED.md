# CHECKPOINT_UI_EXPORT_CENTER_CLEANUP_V1_VALIDATED — StitchPath AI

> Fecha: 2026-07-04
> Tipo: checkpoint estable (rollback seguro)
> Estado: VALIDADO — sin cambios en la lógica de exportación

---

## Motivo

UI_EXPORT_CENTER_CLEANUP_V1 ha sido validado. La limpieza del centro de exportación
(Simple/Lab, semáforo, secciones plegables, etiquetas, restricciones de formato CE01)
se aplicó **exclusivamente a la UI**. El motor de exportación no se modificó.

Este checkpoint fija el estado estable para futuras iteraciones.

---

## Estado validado

| Flag | Valor |
|---|---|
| `uiCleanupValidated` | ✅ true |
| `exportLogicUnchanged` | ✅ true |
| `ce01DstLocked` | ✅ true |
| `laboratoryToolsHiddenInSimple` | ✅ true |

### UI
- Modo **Simple** por defecto (`useState('simple')`).
- Modo **Laboratorio** disponible (toggle en cabecera del cuerpo de exportación).
- **Semáforo de estado visible en Simple** (`ExportTrafficLight`).
- Herramientas técnicas **ocultas en Simple** (gates `uiMode === 'lab'`).
- Tests CE01 / Kirby / debug / forensics **movidos a Laboratorio** dentro de
  `LabSection` plegables.
- Botón principal: **Exportar DST** (footer CE01 Production).

### CE01 Production
- Formato **fijo DST** al activar `ce01ProductionMode`.
- **DSB / PES / JEF / EXP deshabilitados** en el selector (`disabled` + atenuado + tachado).
- Bloqueo duro en `handleExport`: `format !== 'DST'` y `usingDSB` → error y return.

---

## Motor intacto (no modificado en esta iteración)

| Componente | Estado |
|---|---|
| `getEffectiveExportCommands` | ✅ intacto — helper único de selección de comandos |
| `handleExport` (ExportModal) | ✅ intacto — usa `effectiveExport.commands` |
| `canExportInCE01ProductionMode` | ✅ intacto — único gate de exportación producción |
| `repairFinalLookCommandsForExport` (V5.1) | ✅ intacto |
| `preExportRepairer` (removeEmptyBlocks, repairVisibleDiagonalStitches) | ✅ intacto |
| `travelPolish` (Travel Polish V1) | ✅ intacto |
| `travelPolishReport` / `travelPolishForensics` | ✅ intacto |
| `exportPolish` (Polish V1) | ✅ intacto |
| `safeAddTieInTieOffV2` (Safe Tie V2) | ✅ intacto |
| `runSafeTieV2Experiment` (V4, solo informe) | ✅ intacto |
| `dstDirectExport` / `dstEncoder` (DST encoder) | ✅ intacto |
| `dsbEncoder` | ✅ intacto |
| `ce01Validator` | ✅ intacto |
| `ce01CommandSanitizer` | ✅ intacto |
| `ce01ProductionExport` | ✅ intacto |
| `exportErrorDetector` | ✅ intacto |
| `exportRepairReport` (V5_1) | ✅ intacto |
| Reference Learning engine (`src/lib/referenceLearning/*`) | ✅ intacto |
| `buildFinalCommands` / `exportPipeline` | ✅ intacto |
| `unifiedCommandMetrics` | ✅ intacto |
| `computeExportReality` | ✅ intacto |
| `getContourExportReport` / `contourExportBuilder` | ✅ intacto |

---

## Archivos UI modificados (solo UI / etiquetas)

| Archivo | Cambio |
|---|---|
| `src/components/editor/exportCenter/ExportTrafficLight.jsx` | nuevo — semáforo de estado |
| `src/components/editor/exportCenter/LabSection.jsx` | nuevo — sección plegable Laboratorio |
| `src/components/editor/ExportModal.jsx` | toggle Simple/Lab, semáforo, LabSections, selector formato CE01, etiqueta botón Exportar DST |
| `src/components/editor/ExportRepairPanel.jsx` | prop `uiMode`, gate `lab`, etiquetas V5_1 / Report V4 |

Ningún archivo bajo `src/lib/exportRepair/`, `src/lib/ce01*`, `src/lib/dst*`,
`src/lib/dsb*`, ni `src/lib/referenceLearning/` fue modificado.

---

## Invariante de exportación (se mantiene)

Orden de prioridad de `getEffectiveExportCommands` (sin cambios):
1. `repairedCommands` si `repairAccepted=true` y length>0
2. `productionReport.commands` si existen y `exportAllowed=true`
3. `editorFinalCommands`
4. `pipelineResult.commands`

`handleExport` usa **exclusivamente** `effectiveExport.commands` → `buildDSTFromCommands`.
Nunca usa `safeCommands` del experimento Safe Tie V2.
Nunca usa comandos de botones de test/debug.

---

## Restricciones respetadas

- NO se modificó el motor.
- NO se modificó la exportación.
- NO se modificó V5.1.
- NO se modificó Safe Tie.
- NO se modificó Reference Learning.

---

## Documentos relacionados

- `src/UI_EXPORT_CENTER_CLEANUP_REPORT.md` — descripción de cambios UI.
- `src/UI_EXPORT_CENTER_VALIDATION_REPORT.md` — validación punto por punto.
- `CHECKPOINT_EXPORT_REPAIR_V5_1_TRAVEL_WORKING_SCORE67.md` — checkpoint previo del pipeline V5.1.

---

## Rollback

Para volver a este estado estable: revertir únicamente los 4 archivos UI listados
arriba. El motor y la lógica de exportación no requieren rollback (no fueron tocados).

---
_CHECKPOINT_UI_EXPORT_CENTER_CLEANUP_V1_VALIDATED — UI validada, motor intacto._