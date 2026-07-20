# SAFE_TIE_V2_IMPLEMENTATION_CHECK — StitchPath AI

> Auditoría de implementación real. Solo lectura. No se modificó código.
> Generado: 2026-07-04
> Checkpoint de referencia: `CHECKPOINT_EXPORT_REPAIR_V5_1_WORKING.md`

---

## Veredicto: ✅ IMPLEMENTED

`safeAddTieInTieOffV2` **existe realmente** y está integrada en modo
experimental, sin tocar el pipeline V5.1 ni sustituir `addTieInTieOff`.

---

## 1. ¿Existe `safeAddTieInTieOffV2`?

**SÍ.** Existe como función real, exportada y funcional.

## 2. Archivo exacto donde está

`src/lib/exportRepair/safeAddTieInTieOffV2.js` (331 líneas)

## 3. Línea exacta donde se exporta

**Línea 122:**
```js
export function safeAddTieInTieOffV2(commands, objects = [], regions = [], config = {}, darkStroke = null, report = {}) {
```

## 4. ¿Se importa en `repairFinalLookCommandsForExport.js`?

**NO.** El orquestador del pipeline V5.1 **no importa** `safeAddTieInTieOffV2`.

- `src/lib/exportRepair/repairFinalLookCommandsForExport.js` → 0 menciones de
  `safeAddTieInTieOffV2`.
- Es importada únicamente por `src/lib/exportRepair/runSafeTieV2Experiment.js`
  (línea 18): `import { safeAddTieInTieOffV2 } from './safeAddTieInTieOffV2';`

## 5. ¿Se ejecuta solo en modo experimental?

**SÍ.** La cadena de ejecución es estrictamente experimental:

- `safeAddTieInTieOffV2` → importada solo por `runSafeTieV2Experiment.js`.
- `runSafeTieV2Experiment` → invocada solo por `ExportRepairPanel.jsx`, dentro del
  botón "Experimental: Safe Tie V2", y solo cuando `repair.repairAccepted === true`
  (es decir, después de V5.1, sobre `repairedCommands` V5.1).
- **No** se ejecuta en el pipeline V5.1, ni en el encoder DST, ni en DSB, ni en
  CE01 production export, ni en `getEffectiveExportCommands`.
- El resultado (`safeCommands`) **no** se usa para exportación; solo alimenta el
  informe `SAFE_TIE_V2_EXPERIMENT_REPORT.md`.

## 6. ¿Genera `SAFE_TIE_V2_EXPERIMENT_REPORT`?

**SÍ.** `runSafeTieV2Experiment.js` genera el informe markdown
(`SAFE_TIE_V2_EXPERIMENT_REPORT.md`) con before/after de missingTieIn, missingTieOff,
visibleDiagonalStitches, unsupportedLongStitches, emptyBlocks, CE01 score/status,
exportAllowed, bloques tied/skipped y razones de skip. El panel expone un botón de
descarga del informe.

## 7. ¿NO sustituye todavía `addTieInTieOff` del pipeline V5.1?

**Confirmado: NO lo sustituye.**

- El array `phases` del orquestador V5.1 sigue conteniendo:
  `{ name: 'addTieInTieOff', fn: addTieInTieOff, seed: {} }` como fase final.
- `PHASE_TARGETS.addTieInTieOff = 'missingTie'` se mantiene.
- `safeAddTieInTieOffV2` no aparece en `phases`, ni en `PHASE_TARGETS`, ni en
  ningún gate transaccional del orquestador.
- El flujo de exportación sigue usando `repairedCommands` V5.1, no `safeCommands`.

## 8. ¿Mantiene intacto `CHECKPOINT_EXPORT_REPAIR_V5_1_WORKING`?

**SÍ.**

- `CHECKPOINT_EXPORT_REPAIR_V5_1_WORKING.md` sigue existiendo sin modificaciones.
- El pipeline V5.1 (`repairFinalLookCommandsForExport.js`) sigue invocando
  `addTieInTieOff` (fase 6, final) — verificado en el array `phases` y en
  `PHASE_TARGETS`.
- Ninguno de los componentes prohibidos fue tocado: `removeEmptyBlocks`,
  `repairVisibleDiagonalStitches`, `reduceColorChangesIfSafe`, Travel Polish,
  DST/DSB encoders, CE01 loader, detector universal, `visibleDiagonalDetector`,
  Final Look, aprendizaje del corpus.

---

## 9. Marcadores requeridos — presencia real en código

| término | presente | archivo(s) |
|---|---|---|
| `safeAddTieInTieOffV2` | ✅ | `safeAddTieInTieOffV2.js`, `runSafeTieV2Experiment.js`, `ExportRepairPanel.jsx` |
| `safeTieInAdded` | ✅ | `safeAddTieInTieOffV2.js`, `runSafeTieV2Experiment.js` |
| `safeTieOffAdded` | ✅ | `safeAddTieInTieOffV2.js`, `runSafeTieV2Experiment.js` |
| `SAFE_TIE_V2_EXPERIMENT_REPORT` | ✅ | `safeAddTieInTieOffV2.js`, `runSafeTieV2Experiment.js`, `ExportRepairPanel.jsx` |
| `generatedBy: 'safeAddTieInTieOffV2'` | ✅ | `safeAddTieInTieOffV2.js` (marcador en tie stitches) |
| `tieKind: 'safeTieIn'` | ✅ | `safeAddTieInTieOffV2.js` |
| `tieKind: 'safeTieOff'` | ✅ | `safeAddTieInTieOffV2.js` |

---

## 10. Resumen de la cadena de aislamiento

```
[ExportRepairPanel.jsx]
   └─ botón "Experimental: Safe Tie V2" (solo si repair.repairAccepted)
       └─ runSafeTieV2Experiment(repairedCommands V5.1, ...)
           └─ safeAddTieInTieOffV2(...)   ← safeAddTieInTieOffV2.js (export line 122)
               └─ genera safeCommands + report (NO se exportan)
               └─ genera SAFE_TIE_V2_EXPERIMENT_REPORT.md (descargable)

[repairFinalLookCommandsForExport.js]  ← V5.1 intacto, NO importa safeAddTieInTieOffV2
   └─ phases: removeEmptyBlocks → repairVisibleDiagonalStitches → removeDuplicateStitches
       → reduceColorChangesIfSafe → removeEmptyBlocksFinal → addTieInTieOff (V5.1 estable)
```

- `safeAddTieInTieOffV2` **no** entra en el pipeline V5.1.
- `safeAddTieInTieOffV2` **no** entra en exportación DST/DSB.
- `safeAddTieInTieOffV2` **no** sustituye `addTieInTieOff`.
- El checkpoint V5.1 sigue siendo el estado de producción.

---

## 11. Notas

- La función está implementada con las 10 reglas obligatorias: bloques reales
  (≥8 stitches), dirección interna (first→second / last→prev), ties a ≤0.45mm
  del stitch real, no cruzar regiones, ventana local prev5+ties+next5 para
  detectar `visibleDiagonalStitches`, comprobación de `unsupportedLongStitches`
  locales, sin crear `emptyBlocks` (no añade colorChange/jump/trim), marcas
  `isTie/tieKind/generatedBy` y `hasTieIn/hasTieOff` en el primer/último stitch real,
  y métricas completas en `report`.
- `runSafeTieV2Experiment.js` mide before/after con `detectExportErrors` y aplica
  los 8 criterios de éxito experimental; `experimentAccepted` solo es `true` si
  todos los invariantes se mantienen.

---

_SAFE_TIE_V2_IMPLEMENTATION_CHECK — verificación completada. Implementación real, aislada, experimental. V5.1 intacto._