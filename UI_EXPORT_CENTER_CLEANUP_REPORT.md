# UI_EXPORT_CENTER_CLEANUP_V1 — StitchPath AI

> Generado: 2026-07-04
> Objetivo: limpiar la interfaz del centro de exportación para usuario normal, manteniendo las herramientas técnicas en modo Laboratorio.
> **NO se modificó la lógica de exportación.** Solo UI, etiquetas y organización visual.

---

## 1. Alcance y restricciones respetadas

NO se tocó (lógica estable intacta):
- V5.1 repair pipeline (`repairFinalLookCommandsForExport.js`, `preExportRepairer.js`)
- Travel Polish (`travelPolish.js`, `travelPolishReport.js`, `travelPolishForensics.js`)
- `getEffectiveExportCommands.js` — helper ÚNICO de command source, sin cambios
- DST encoder (`dstDirectExport.js`, `dstEncoder.js`)
- DSB encoder (`dsbEncoder.js`)
- CE01 validator (`ce01Validator.js`)
- `repairVisibleDiagonalStitches`
- `removeEmptyBlocks`
- Reference Learning engine (`src/lib/referenceLearning/*`)
- Safe Tie V2 logic (`safeAddTieInTieOffV2.js`, `runSafeTieV2Experiment.js`)

Confirmación explícita:
- **`getEffectiveExportCommands` sigue intacto** — no se editó. Sigue siendo la única fuente de comandos para exportación.
- **V5.1 no se modificó** — ni el orquestador, ni las fases, ni el reporte V5_1. Solo se cambió la etiqueta visible del botón de descarga (V5 → V5_1) y el comentario de cabecera del panel.

---

## 2. Archivos tocados

| Archivo | Tipo de cambio |
|---|---|
| `src/components/editor/exportCenter/ExportTrafficLight.jsx` | **NUEVO** — bloque semáforo de estado |
| `src/components/editor/exportCenter/LabSection.jsx` | **NUEVO** — sección plegable para modo Laboratorio |
| `src/components/editor/ExportModal.jsx` | Reorganización UI: toggle Simple/Lab, semáforo, secciones laboratorio, selector de formato CE01, etiqueta botón exportar |
| `src/components/editor/ExportRepairPanel.jsx` | Prop `uiMode`, ocultar experimentos/forensics en Simple, corregir etiquetas (V5_1, Report V4) |

---

## 3. Modo de interfaz (Simple / Laboratorio)

- Nuevo estado `uiMode` en `ExportModal`, por defecto **`'simple'`**.
- Toggle Simple / Laboratorio en la cabecera del cuerpo de exportación.
- `ExportRepairPanel` recibe `uiMode` y deriva `lab = uiMode === 'lab'`.

### 3.1 Modo Simple — visible
- Toggle de modo
- **Bloque semáforo** (Estado de exportación): CE01 status, CE01 score, commandSource, exportAllowed, visibleDiagonalStitches, emptyBlocks, invalidCommandSequence, regionOutsideBounds, jumps, trims, colors, formato
- ExportRepairPanel (errores detectados, fases, comparativa, veredicto, botón **Reparar y validar**, descarga EXPORT_REPAIR_REPORT_V5_1)
- Banner de limpieza automática
- Banners de validación
- CE01ProductionPanel (modo producción)
- ValidationPreview
- Aviso de contorno débil (informativo)
- Stats grid (puntadas/saltos/trims/colores/tiempo/tamaño)
- Selector de formato (con restricciones CE01 Production)
- Metadatos de máquina
- Botón **Exportar DST** (footer, modo producción CE01)

### 3.2 Modo Simple — oculto (movido a Laboratorio)
- Exportar test 3 colores CE01
- Exportar test contorno CE01
- Exportar solo contornos Kirby
- Exportar Kirby completo con contorno refinado
- Test solo contorno inferior y pies
- RawDarkStrokeTestPanel
- ExportRealityCheck (diagnóstico visual)
- ContourRefinePanel (diagnóstico contornos)
- CE01ReportPanel (forensics antes/después sanitizer)
- ExportDebugPanel + toggle Modo Debug
- BinaryInspectorPanel
- CE01FormatTestPanel
- Safe Tie V2 experiment (dentro de ExportRepairPanel)
- Forensics downloads secundarios (VISIBLE_DIAGONAL_FORENSICS, EMPTY_BLOCK_FORENSICS)
- Polish V1 detail block
- Travel Polish V1 detail block

### 3.3 Modo Laboratorio — secciones plegables
Todo lo anterior se mantiene dentro de secciones plegables (`LabSection`):
- **Diagnóstico visual y contornos** — ExportRealityCheck, ContourRefinePanel
- **Tests y diagnóstico Kirby** — test 3 colores, test contorno CE01, solo contornos Kirby, Kirby completo, test inferior y pies, RawDarkStrokeTestPanel
- **Forensics CE01** — CE01ReportPanel
- **Debug avanzado** — toggle Modo Debug + ExportDebugPanel
- **Forensics y tests de formato** — BinaryInspectorPanel, CE01FormatTestPanel
- **Polish V1 / Travel Polish V1 / Safe Tie V2** — dentro de ExportRepairPanel (visibles en Lab)

---

## 4. Botones movidos a Laboratorio

| Botón / componente | Sección Laboratorio |
|---|---|
| Exportar test 3 colores CE01 | Tests y diagnóstico Kirby |
| Exportar test contorno CE01 | Tests y diagnóstico Kirby |
| Exportar solo contornos Kirby | Tests y diagnóstico Kirby |
| Exportar Kirby completo con contorno refinado | Tests y diagnóstico Kirby |
| Test solo contorno inferior y pies | Tests y diagnóstico Kirby |
| RawDarkStrokeTestPanel | Tests y diagnóstico Kirby |
| ExportRealityCheck | Diagnóstico visual y contornos |
| ContourRefinePanel | Diagnóstico visual y contornos |
| CE01ReportPanel | Forensics CE01 |
| Modo Debug + ExportDebugPanel | Debug avanzado |
| BinaryInspectorPanel | Forensics y tests de formato |
| CE01FormatTestPanel | Forensics y tests de formato |
| Descargar VISIBLE_DIAGONAL_FORENSICS.md | dentro de ExportRepairPanel (Lab) |
| Descargar EMPTY_BLOCK_FORENSICS.md | dentro de ExportRepairPanel (Lab) |
| Polish V1 detail | dentro de ExportRepairPanel (Lab) |
| Travel Polish V1 detail | dentro de ExportRepairPanel (Lab) |
| Safe Tie V2 experiment | dentro de ExportRepairPanel (Lab) |

---

## 5. Etiquetas corregidas

| Antes | Después |
|---|---|
| Descargar EXPORT_REPAIR_REPORT_V5.md | Descargar EXPORT_REPAIR_REPORT_V5_1.md |
| Safe Tie Report V3 | Report V4 (filename: SAFE_TIE_V2_EXPERIMENT_REPORT_V4.md) |
| Exportar versión actual (footer CE01) | Exportar DST |
| Cabecera ExportRepairPanel "(v2 transaccional)" | "(V5.1 transaccional)" |
| Comentario informe EXPORT_REPAIR_REPORT_V2.md | EXPORT_REPAIR_REPORT_V5_1.md |

Nombres de archivos de descarga consistentes:
- `EXPORT_REPAIR_REPORT_V5_1.md`
- `SAFE_TIE_V2_EXPERIMENT_REPORT_V4.md`
- `TRAVEL_POLISH_REPORT_V1.md`
- `EXPORT_POLISH_REPORT_V1.md`
- `VISIBLE_DIAGONAL_FORENSICS.md`
- `EMPTY_BLOCK_FORENSICS.md`

---

## 6. CE01 Production Mode — formato

- Banner claro: **"Formato CE01: DST — modo producción activo. DSB/PES/JEF/EXP no disponibles."**
- Selector de formato: botones no-DST quedan **disabled, atenuados y tachados** cuando `ce01ProductionMode === true`.
- No es posible seleccionar DSB (ni PES/JEF/EXP) con CE01 Production Mode activo.
- El warning "DSB experimental" solo se muestra fuera de modo producción.

---

## 7. Bloque semáforo (ExportTrafficLight)

Semáforo de estado de exportación en la parte superior del cuerpo:

| Nivel | Condición | Color |
|---|---|---|
| 🟢 Verde | exportAllowed true y CE01 no INVALID (SAFE) | emerald |
| 🟡 Amber | CE01 RISKY pero exportable | amber |
| 🔴 Rojo | CE01 INVALID o bloqueos restantes | red |

Muestra: CE01 status, CE01 score, commandSourceUsedForExport, visibleDiagonalStitches, emptyBlocks, jumps, trims, colorCount, formato.

Cálculo del nivel (solo lectura, no afecta al gate de exportación):
```
lightLevel = (ce01.status === 'INVALID' || remainingBlocking.length > 0)
  ? 'red'
  : (ce01.status === 'RISKY' ? 'amber' : 'green');
```
`remainingBlocking` se deriva de `detectExportErrors` sobre `effectiveExport.commands` — mismo detector que el panel de reparación, sin lógica nueva de exportación.

---

## 8. Confirmaciones finales

- ✅ `getEffectiveExportCommands` **sin cambios** — sigue siendo el helper único; `effectiveExport` se usa igual en exportación, validación y métricas.
- ✅ V5.1 **sin cambios** — orquestador, fases, criterios y reporte V5_1 intactos. Solo etiqueta visible del botón y cabecera del panel.
- ✅ Travel Polish, Polish V1, Safe Tie V2 **sin cambios lógicos** — solo ocultos en Simple.
- ✅ DST/DSB encoders, CE01 validator, `repairVisibleDiagonalStitches`, `removeEmptyBlocks`, Reference Learning **intactos**.
- ✅ La lógica de `handleExport` y el gate `canExportInCE01ProductionMode` **sin cambios**.
- ✅ Cambios puramente UI: toggle, semáforo, secciones plegables, etiquetas, restricciones de selector de formato.

---

_UI_EXPORT_CENTER_CLEANUP_V1 — solo UI, etiquetas y organización visual. Motor estable intacto._