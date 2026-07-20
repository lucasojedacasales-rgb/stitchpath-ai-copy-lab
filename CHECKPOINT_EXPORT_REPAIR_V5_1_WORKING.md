# CHECKPOINT_EXPORT_REPAIR_V5_1_WORKING — StitchPath AI

> **Checkpoint estable de rollback.** No modificar código bajo este estado.
> Generado: 2026-07-04

## Motivo

V5.1 recupera el flujo exportable y corrige `emptyBlocks`. Este checkpoint marca el
punto estable al que se puede revertir si una futura modificación rompe la
exportación o reintroduce bloques vacíos.

## Pipeline V5.1 (orden de fases transaccionales)

```
removeEmptyBlocks → repairVisibleDiagonalStitches → removeDuplicateStitches
  → reduceColorChangesIfSafe → removeEmptyBlocksFinal → addTieInTieOff
```

- `removeEmptyBlocks` robusto: 8 casos (leading/trailing/between colorChanges,
  saltos sueltos, colorChange redundante, bloque con solo trim/jump/end, etc.).
- `addTieInTieOff` al FINAL: el gate transaccional lo revierte si crea
  `visibleDiag` o `longSt` nuevos (queda desactivado de forma segura vía revert).
- `globalRepairAccepted` admite mejora parcial: acepta `repaired` si CE01 no es
  INVALID y los bloqueos totales no empeoraron respecto al source.

## Estado confirmado

| Métrica | Valor |
|---|---|
| repairAccepted | **SÍ** |
| exportAllowed | **SÍ** |
| commandSourceUsedForExport | **repaired** |
| DST usa repairedCommands | **true** |
| DSB usa repairedCommands | **true** |
| CE01 status | **RISKY** (no INVALID) |
| CE01 score | **56** |
| visibleDiagonalStitches | **0** |
| emptyBlocks | **0** |
| invalidCommandSequence | **0** |
| regionOutsideBounds | **0** |
| errores bloqueantes restantes | **0** |
| jumpCount (returned) | **46** |
| trimCount (returned) | **28** |
| colorCount (returned) | **3** |

## Invariantes V5 protegidos

- `visibleDiagonalStitches === 0`
- `emptyBlocks === 0`
- `invalidCommandSequence === 0`
- `regionOutsideBounds === 0`
- `ce01Status !== 'INVALID'`
- `exportAllowed === true`

## Ficheros clave (no modificar bajo este checkpoint)

- `src/lib/exportRepair/repairFinalLookCommandsForExport.js` — orquestador V5.1
- `src/lib/exportRepair/preExportRepairer.js` — removeEmptyBlocks robusto + addTieInTieOff
- `src/lib/exportRepair/exportErrorDetector.js` — detector universal
- `src/lib/exportRepair/emptyBlockForensics.js` — forense granular de bloques vacíos
- `src/lib/exportRepair/exportRepairReport.js` — reporte V5.1 + tracking emptyBlocks por fase
- `src/lib/exportRepair/getEffectiveExportCommands.js` — prioridad repaired > production > editor > pipeline
- `src/components/editor/ExportRepairPanel.jsx` — UI + descargas de reportes
- `src/lib/dstDirectExport.js` / `src/lib/dsbEncoder.js` — encoders (usan repairedCommands)

## Notas de rollback

Si una modificación futura rompe la exportación:

1. Revertir a este checkpoint (estado de los ficheros listados).
2. Confirmar que `repairAccepted = SÍ` y `emptyBlocks = 0` con los mismos
   valores de la tabla anterior.
3. Si `emptyBlocks > 0` reaparece, descargar `EMPTY_BLOCK_FORENSICS.md` desde el
   panel de reparación y comparar el caso contra los 8 cubiertos por
   `removeEmptyBlocks`.
4. Si `repairAccepted = NO`, verificar que `globalRepairAccepted` sigue
   admitiendo mejora parcial y que `addTieInTieOff` no fue aceptado creando
   `visibleDiag`/`longSt` (debe revertirse transaccionalmente).

---

_Estado: ESTABLE. Punto de rollback confirmado._