# UI_EXPORT_CENTER_VALIDATION_REPORT — StitchPath AI

> Fecha: 2026-07-04
> Alcance: validar UI_EXPORT_CENTER_CLEANUP_V1 sin modificar código.
> Método: inspección de src/components/editor/ExportModal.jsx, ExportRepairPanel.jsx, exportCenter/ExportTrafficLight.jsx, exportCenter/LabSection.jsx, lib/exportRepair/getEffectiveExportCommands.js, repairFinalLookCommandsForExport.js, travelPolish.js, dstDirectExport.js, ce01Validator.js, preExportRepairer.js, safeAddTieInTieOffV2.js.

---

## Resultado global

| Flag | Valor |
|---|---|
| `uiCleanupValidated` | ✅ true |
| `exportLogicUnchanged` | ✅ true |
| `ce01DstLocked` | ✅ true |
| `laboratoryToolsHiddenInSimple` | ✅ true |

---

## 1. Modo Simple

`const [uiMode, setUiMode] = useState('simple');` — **Simple por defecto** ✅

Elementos visibles en Simple (verificados en el cuerpo de ExportModal):

| Elemento | Visible en Simple | Evidencia |
|---|---|---|
| Semáforo de estado (ExportTrafficLight) | ✅ | renderizado fuera de cualquier gate `uiMode === 'lab'` |
| CE01 status | ✅ | prop `ce01Status={techDetection.ce01.status}` |
| CE01 score | ✅ | prop `ce01Score={techDetection.ce01.score}` |
| commandSourceUsedForExport | ✅ | prop `commandSource={effectiveExport.source}` |
| visibleDiagonalStitches | ✅ | prop `visibleDiagonalStitches={techDetection.counts.visibleDiag}` |
| emptyBlocks | ✅ | prop `emptyBlocks={techDetection.counts.emptyBlocks}` |
| invalidCommandSequence | ✅ | prop desde `techDetection.errors.find(...invalidCommandSequence)?.count` |
| regionOutsideBounds | ✅ | prop desde `techDetection.errors.find(...regionOutsideBounds)?.count` |
| jumpCount | ✅ | `unifiedMetrics.jumpCount` |
| trimCount | ✅ | `unifiedMetrics.trimCount` |
| colorCount | ✅ | `unifiedMetrics.colorCount` |
| Botón "Reparar y validar" | ✅ | ExportRepairPanel renderizado sin gate (botón interno `handleRepair`) |
| Botón "Exportar DST" | ✅ | footer: `<>... Exportar DST</>` cuando `ce01ProductionMode` y exportación permitida |

ExportTrafficLight renderiza grid 4×3 con celdas: CE01 status, CE01 score, commandSource, exportAllowed, visibleDiag, emptyBlocks, invalidCmd, outOfBounds, jumps, trims, colors, formato. **Todas las métricas requeridas presentes.** ✅

---

## 2. Modo Laboratorio

Verificado que cada herramienta técnica está envuelta en `{uiMode === 'lab' && (<LabSection ...>...</LabSection>)}`:

| Herramienta | Sección LabSection | Gate `uiMode==='lab'` |
|---|---|---|
| ExportRealityCheck + ContourRefinePanel | "Diagnóstico visual y contornos" | ✅ |
| Test 3 colores CE01 | "Tests y diagnóstico Kirby" | ✅ |
| Test contorno CE01 | "Tests y diagnóstico Kirby" | ✅ |
| Kirby outlines only | "Tests y diagnóstico Kirby" | ✅ |
| Kirby completo con contorno refinado | "Tests y diagnóstico Kirby" | ✅ |
| Test solo contorno inferior y pies | "Tests y diagnóstico Kirby" | ✅ |
| RawDarkStrokeTestPanel | "Tests y diagnóstico Kirby" | ✅ |
| CE01ReportPanel (forensics) | "Forensics CE01" | ✅ (además `!ce01ProductionMode`) |
| Modo Debug + ExportDebugPanel | "Debug avanzado" | ✅ |
| BinaryInspectorPanel + CE01FormatTestPanel | "Forensics y tests de formato" | ✅ |
| Safe Tie V2 experiment | dentro de ExportRepairPanel | ✅ (`lab && repair?.repairAccepted`) |
| Polish V1 detail | dentro de ExportRepairPanel | ✅ (`lab && repair?.repairReport?.polish`) |
| Travel Polish V1 detail | dentro de ExportRepairPanel | ✅ (`lab && repair?.repairReport?.travelPolish`) |
| VISIBLE_DIAGONAL_FORENSICS.md download | dentro de ExportRepairPanel | ✅ (`lab &&`) |
| EMPTY_BLOCK_FORENSICS.md download | dentro de ExportRepairPanel | ✅ (`lab &&`) |

**`laboratoryToolsHiddenInSimple = true`** ✅ — ninguna de estas se renderiza cuando `uiMode === 'simple'`.

---

## 3. Exportación real

Ruta de exportación CE01 Production en `handleExport`:

```js
const exportCommands = effectiveExport.commands;          // línea 320
const { bytes, blob, meta } = buildDSTFromCommands(exportCommands, { label, ce01Strict: true });
```

`effectiveExport` se calcula vía:
```js
const effectiveExport = useMemo(() => getEffectiveExportCommands({
  repairAccepted, repairedCommands,
  editorFinalCommands,
  pipelineCommands: pipelineResult.commands,
  productionCommands: productionReport?.exportAllowed ? productionReport?.commands : null,
}), [...]);
```

Orden de prioridad (getEffectiveExportCommands.js):
1. `repairedCommands` si `repairAccepted=true` y length>0 → source `'repairedCommands'`
2. `productionCommands` si existen → source `'productionReport.commands'`
3. `editorFinalCommands` → source `'editorFinalCommands'`
4. `pipelineCommands` → source `'pipelineResult.commands'`

| Criterio | Verificado |
|---|---|
| Usa `effectiveExport.commands` | ✅ línea 320 |
| Usa `getEffectiveExportCommands` | ✅ useMemo en effectiveExport |
| `repairedCommands` si `repairAccepted=true` | ✅ prioridad 1 |
| `productionReport.commands` solo si corresponde | ✅ prioridad 2, y solo se pasa si `productionReport?.exportAllowed` |
| Nunca usa comandos experimentales Safe Tie | ✅ `expResult.safeCommands` vive solo dentro de ExportRepairPanel; nunca alimenta `effectiveExport` ni `handleExport` |
| Nunca usa comandos de debug/test | ✅ los botones de test llaman a `buildDSTFromCommands` directamente con sus propios cmds y NO tocan `handleExport`; el botón Exportar DST solo usa `effectiveExport.commands` |

**Exportación real usa exclusivamente `effectiveExport.commands`.** ✅

---

## 4. CE01 Production

| Criterio | Verificado | Evidencia |
|---|---|---|
| Formato fijo DST | ✅ | `useEffect` fuerza `setFormat('DST')` al activar ce01ProductionMode |
| DSB/PES/JEF/EXP deshabilitados | ✅ | `const disabled = ce01ProductionMode && f !== 'DST';` en el selector; `disabled` + `line-through` + `opacity-30 cursor-not-allowed` |
| No se puede exportar DSB en CE01 Production | ✅ | handleExport: `if (format !== 'DST') { setExportError('Formato no es DST'); return; }` y `if (usingDSB) { setExportError('usingDSB es true — no permitido en CE01'); return; }` |
| Nombre visible del botón: "Exportar DST" | ✅ | footer: `<><Download .../> Exportar DST</>` en rama ce01ProductionMode permitida |
| Banner "Formato CE01: DST — modo producción activo..." | ✅ | bloque condicional `ce01ProductionMode ?` |

**`ce01DstLocked = true`** ✅

---

## 5. Etiquetas corregidas

| Etiqueta esperada | Encontrada | Archivo |
|---|---|---|
| `EXPORT_REPAIR_REPORT_V5_1.md` | ✅ | ExportRepairPanel `a.download = 'EXPORT_REPAIR_REPORT_V5_1.md'` |
| `SAFE_TIE_V2_EXPERIMENT_REPORT_V4.md` | ✅ | ExportRepairPanel `a.download = 'SAFE_TIE_V2_EXPERIMENT_REPORT_V4.md'` |
| `EXPORT_TRAVEL_POLISH_REPORT_V1.md` | ✅ | ExportRepairPanel `a.download = 'EXPORT_TRAVEL_POLISH_REPORT_V1.md'` |
| `EXPORT_POLISH_REPORT_V1.md` | ✅ | ExportRepairPanel `a.download = 'EXPORT_POLISH_REPORT_V1.md'` |
| Botón "Report V4" (Safe Tie) | ✅ | ExportRepairPanel `> Report V4</>` |
| Cabecera "Reparación técnica pre-export" (V5.1 transaccional) | ✅ | ExportRepairPanel comentario + título |

Textos antiguos ausentes:
- ❌ "Report V3" — no encontrado
- ❌ "EXPORT_REPAIR_REPORT_V5.md" (sin _1) — no encontrado
- ❌ "EXPORT_REPAIR_REPORT_V2.md" — no encontrado
- ❌ "Exportar versión actual" — reemplazado por "Exportar DST"

**Etiquetas corregidas = true** ✅

---

## 6. No tocar motor

| Archivo del motor | Modificado en esta iteración | Evidencia |
|---|---|---|
| `src/lib/exportRepair/getEffectiveExportCommands.js` | ❌ No | sin edición; orden de prioridad intacto |
| `src/lib/exportRepair/repairFinalLookCommandsForExport.js` | ❌ No | sin edición; pipeline V5.1 intacto |
| `src/lib/exportRepair/travelPolish.js` | ❌ No | sin edición |
| `src/lib/exportRepair/travelPolishReport.js` | ❌ No | sin edición |
| `src/lib/dstDirectExport.js` | ❌ No | sin edición |
| `src/lib/ce01Validator.js` | ❌ No | sin edición |
| `src/lib/exportRepair/preExportRepairer.js` (removeEmptyBlocks, repairVisibleDiagonalStitches) | ❌ No | sin edición |
| `src/lib/exportRepair/safeAddTieInTieOffV2.js` | ❌ No | sin edición |
| `src/lib/exportRepair/runSafeTieV2Experiment.js` | ❌ No | sin edición (V4 ya existente) |

Archivos tocados en UI_EXPORT_CENTER_CLEANUP_V1 (solo UI/etiquetas):
- `src/components/editor/exportCenter/ExportTrafficLight.jsx` (nuevo)
- `src/components/editor/exportCenter/LabSection.jsx` (nuevo)
- `src/components/editor/ExportModal.jsx` (UI: toggle, semáforo, LabSections, selector formato, etiqueta botón)
- `src/components/editor/ExportRepairPanel.jsx` (UI: prop uiMode, gate `lab`, etiquetas V5_1/V4)

**`exportLogicUnchanged = true`** ✅

---

## 7. Conclusión

UI_EXPORT_CENTER_CLEANUP_V1 pasa todas las validaciones:
- Modo Simple por defecto con semáforo y métricas completas.
- Herramientas técnicas confinadas en Laboratorio (ocultas en Simple).
- Exportación real usa exclusivamente `effectiveExport.commands` (helper único); nunca comandos experimentales ni de test.
- CE01 Production bloquea DSB/PES/JEF/EXP y fija DST.
- Etiquetas V5_1 / V4 / V1 correctas; sin restos antiguos.
- Motor del pipeline (V5.1, Travel Polish, encoders, CE01 validator, Safe Tie V2) sin modificaciones.

`uiCleanupValidated = true`
`exportLogicUnchanged = true`
`ce01DstLocked = true`
`laboratoryToolsHiddenInSimple = true`

---
_Validación solo lectura. No se modificó código._