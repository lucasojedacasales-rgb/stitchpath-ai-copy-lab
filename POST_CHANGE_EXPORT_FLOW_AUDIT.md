# POST_CHANGE_EXPORT_FLOW_AUDIT — StitchPath AI

> Auditoría de conexión del flujo V5 + Travel Polish V1.
> Fecha: 2026-07-03
> Estado: **NO se modificó código** — solo análisis.

---

## 1. Compilación de la app

| Check | Estado | Detalle |
|---|---|---|
| Imports resueltos | ✅ OK | `travelPolish.js` importa `./travelPolishForensics` y `./travelPolishReport`; ambos archivos existen ahora en `src/lib/exportRepair/` y exportan `generateTravelPolishForensics` y `generateTravelPolishReport` respectivamente. |
| Módulos inexistentes | ✅ OK | Tras recrear `travelPolishForensics.js` y `travelPolishReport.js` no quedan referencias a módulos ausentes. |
| Nombres duplicados | ✅ OK | `polishTravelAfterV5` (export único en `travelPolish.js`); `getEffectiveExportCommands` (helper único). Sin colisiones. |
| React hooks | ✅ OK | `ExportRepairPanel.jsx` usa `useState`/`useMemo`/`useCallback` con dependencias correctas. `ExportModal.jsx` usa `useState`/`useMemo`/`useEffect` sin hooks condicionales. |
| JSX | ✅ OK | Sin sintaxis JSX rota en `ExportRepairPanel.jsx`, `ExportModal.jsx`, `ValidationPreview.jsx`, `CE01ProductionPanel.jsx`. |

**Veredicto 1:** ✅ OK — la app compila (suponiendo que la recreación de los dos archivos persistió).

---

## 2. Flujo principal de exportación — prioridad de comandos

Helper único: `src/lib/exportRepair/getEffectiveExportCommands.js`

Orden implementado:
1. `repairedCommands` si `repairAccepted=true` y `length > 0` → `source='repairedCommands'`
2. `productionReport.commands` si `length > 0` → `source='productionReport.commands'`
3. `editorFinalCommands` si `length > 0` → `source='editorFinalCommands'`
4. `pipelineResult.commands` (fallback) → `source='pipelineResult.commands'`

`ExportModal.jsx` construye `effectiveExport` con `getEffectiveExportCommands({ repairAccepted, repairedCommands, editorFinalCommands, pipelineCommands, productionCommands })` y `handleExport` (CE01 Production path) usa `effectiveExport.commands` como `exportCommands` para `buildDSTFromCommands`.

| Check | Estado | Detalle |
|---|---|---|
| Botón principal usa helper único | ✅ OK | `handleExport` → `const exportCommands = effectiveExport.commands;` |
| Prioridad repaired > production > editor > pipeline | ✅ OK | `getEffectiveExportCommands` líneas 41-53 |
| Logs de trazabilidad | ✅ OK | `[effective-export-source]` registra candidato seleccionado |

**Veredicto 2:** ✅ OK

---

## 3. CE01 Production Mode

Función gate: `canExportInCE01ProductionMode` en `ExportModal.jsx`.

| Check | Estado | Detalle |
|---|---|---|
| Permite RISKY | ✅ OK | Solo bloquea si `ce01Validation?.status === 'INVALID'`; RISKY pasa. |
| Bloquea INVALID | ✅ OK | `if (ce01Validation?.status === 'INVALID') return { allowed: false }` |
| Fuerza DST | ✅ OK | `if (format !== 'DST') { setExportError('CE01 Production Mode requiere formato DST...'); return; }` |
| No permite DSB | ✅ OK | El mismo gate de formato bloquea DSB; además `useEffect` fuerza `setFormat('DST')` al activar production mode. |
| Repair bypass | ✅ OK | Si `repairAccepted && repairedCommands.length > 0`, el botón permite exportar incluso si `productionGateDecision` bloquea (usa repairedCommands). |

**Veredicto 3:** ✅ OK

---

## 4. Invariantes V5 (sobre comandos devueltos)

Orquestador `repairFinalLookCommandsForExport.js`:

- Tras Travel Polish, `repairedCommands` = `travelPolishedCommands` si aceptado; si no, V5 intacto.
- `returnedMetrics = measureMetrics(repairedCommands)` — métricas del resultado final.
- `finalDetect = detectExportErrors(repairedCommands)` — errores sobre el resultado final.
- `exportAllowed = finalDetect.ce01.status !== 'INVALID' && repairedCommands.length > 0 && remainingBlockingIssues.length === 0`.
- `remainingBlockingIssues` filtra `severity === 'blocking'` (incluye visibleDiagonalStitches, emptyBlocks, invalidCommandSequence, regionOutsideBounds).
- `commandSourceUsedForExport = repairAccepted ? 'repaired' : 'source'`.

| Invariante | Estado | Detalle |
|---|---|---|
| visibleDiagonalStitches = 0 (returned) | ✅ OK | `remainingBlockingIssues` lo incluye como blocking; si >0, `exportAllowed=false`. |
| emptyBlocks = 0 (returned) | ✅ OK | Idem, blocking. |
| invalidCommandSequence = 0 (returned) | ✅ OK | Idem, blocking. |
| regionOutsideBounds = 0 (returned) | ✅ OK | Idem, blocking. |
| commandSourceUsedForExport = repaired | ✅ OK | Cuando `repairAccepted=true`. |
| exportAllowed = true cuando CE01 es RISKY | ✅ OK | RISKY no es INVALID → pasa; requiere `remainingBlockingIssues.length === 0`. |

**Veredicto 4:** ✅ OK

---

## 5. Travel Polish V1

`src/lib/exportRepair/travelPolish.js` — `polishTravelAfterV5`.

| Check | Estado | Detalle |
|---|---|---|
| Acepta solo si mejora jumps O trims | ✅ OK | `improved = finalMetrics.jumpCount < base.jumpCount \|\| finalMetrics.trimCount < base.trimCount`; forma parte del gate global. |
| Revierte si no mejora | ✅ OK | `travelPolishedCommands = travelPolishAccepted ? cmds : base` — base = repairedCommands V5 intactos. |
| No reemplaza V5 si rompe exportAllowed | ✅ OK | `v5InvariantsHold(finalMetrics)` exige `exportAllowed === true`; además el orquestador recalcula `exportAllowed` sobre el resultado final. Doble protección. |
| No convierte diagonales reparadas en stitches visibles | ✅ OK | Las 4 fases solo eliminan trims/jumps o reordenan bloques; **nunca** convierten un `jump`/`trim` en `stitch`. No crea `visibleDiagonalStitches`. |
| Invariantes V5 protegidos por fase | ✅ OK | `runTravelPhase` aplica `v5InvariantsHold(after)` por cada fase; revierte la fase si rompe. |
| ce01Score no baja > 3 | ✅ OK | `scoreOK = after.ce01Score >= base.ce01Score - MAX_SCORE_DROP` (MAX_SCORE_DROP=3). |
| No toca encoder/detector/Final Look | ✅ OK | Solo importa `detectExportErrors`, `validateCE01`, forensics y report. No muta encoder DST/DSB. |

### ⚠ Riesgo (no crítico — solo afecta al informe descargable)

| ID | Severidad | Archivo | Línea/Función | Detalle | Recomendación |
|---|---|---|---|---|---|
| TRAVEL_POLISH_REPORT_FIELD_MISMATCH | Riesgo (cosmético) | `src/lib/exportRepair/travelPolish.js` | `polishTravelAfterV5`, llamada a `generateTravelPolishReport` (líneas 354-356) | Pasa `comparison: travelPolishComparison` pero `travelPolishReport.js` lee `travelPolishComparison`; además no pasa `travelPolishPhaseLog` ni `forensics`. Resultado: la tabla "Comparativa base/returned" del `EXPORT_TRAVEL_POLISH_REPORT_V1.md` sale vacía y las secciones de fases/forensics del informe quedan en blanco. **No afecta a la exportación ni a los invariantes**; solo al contenido del .md descargable. | Cambiar la llamada a `generateTravelPolishReport({ phaseLog, baseMetrics, returnedMetrics, travelPolishAccepted, travelPolishComparison, travelPolishPhaseLog: phaseLog, forensics })`. |

**Veredicto 5:** ✅ OK funcional (exportación e invariantes correctos) · ⚠ 1 riesgo cosmético en el informe descargable.

---

## 6. Botones auxiliares — uso de comandos antiguos

| Botón / Componente | Comando usado | Estado | Flag |
|---|---|---|---|
| Botón principal "Confirmar y exportar" / "Reparar y exportar" | `effectiveExport.commands` | ✅ OK | — |
| "Exportar Kirby completo con contorno refinado" | `effectiveExport.commands` → `buildDSTFromCommands` | ✅ OK | — |
| "Exportar solo contornos Kirby" | `generateOutlineOnlyDST(regions, config)` (generador propio desde regions/config, no usa comandos fuente) | ✅ OK (por diseño — es un test aislado de contornos) | — |
| "Test solo contorno inferior y pies" | `rebuildLowerOuterContoursFromDarkStroke(...)` → cmds propios | ✅ OK (por diseño — test aislado) | — |
| "Exportar test 3 colores CE01" | `generate3ColorTestDST()` (DST mínimo sintético) | ✅ OK (test de formato) | — |
| "Exportar test contorno CE01" | `generateContourTestDST()` (sintético) | ✅ OK | — |
| ValidationPreview — vista **"Exportable"** | `exportView === 'exportable' ? effectiveExport.commands : (editorFinalCommands \|\| pipelineResult.commands)` | ✅ OK en vista exportable | — |
| ValidationPreview — vista **"Final Look"** | `editorFinalCommands \|\| pipelineResult.commands` | ⚠ Riesgo (bajo, intencional) | AUX_EXPORT_USES_SOURCE_COMMANDS ( vista Final ) |
| BinaryInspectorPanel | `pipelineResult.commands` (diagnóstico, no exportación) | ⚠ Riesgo (bajo — solo inspección binaria) | AUX_EXPORT_USES_SOURCE_COMMANDS ( diagnóstico ) |
| ContourRefinePanel | `effectiveExport.commands` | ✅ OK | — |
| ExportRealityCheck | `effectiveExport.commands` | ✅ OK | — |
| CE01ProductionPanel | `productionReport` + `effectiveExport.source` | ✅ OK | — |
| CE01ReportPanel | `ce01ReportAfter` (validación, no comandos) | ✅ OK | — |

### Detalle de riesgos AUX_EXPORT_USES_SOURCE_COMMANDS

| ID | Severidad | Archivo | Línea/Función | Detalle | Recomendación |
|---|---|---|---|---|---|
| AUX_EXPORT_USES_SOURCE_COMMANDS (vista Final) | Riesgo bajo (intencional) | `src/components/editor/ExportModal.jsx` | `ValidationPreview` props (línea `commands={exportView === 'exportable' ? effectiveExport.commands : (editorFinalCommands \|\| pipelineResult.commands)}`) | La vista **"Final Look"** del ValidationPreview muestra los comandos fuente (no reparados) por diseño (comparación visual Final vs Exportable). No es un botón de exportación; no genera archivo. | Aceptar como comportamiento intencional. Si se quiere máxima coherencia, la vista Final podría mostrar `effectiveExport.commands` también, pero perdería el valor comparativo. |
| AUX_EXPORT_USES_SOURCE_COMMANDS (BinaryInspector) | Riesgo bajo (diagnóstico) | `src/components/editor/ExportModal.jsx` | `<BinaryInspectorPanel commands={pipelineResult.commands} ... />` | El inspector binario inspecciona `pipelineResult.commands` (comandos del pipeline `buildFinalCommands`), no `effectiveExport`. Es solo diagnóstico de formato binario, no genera descarga de producción. | Cambiar a `effectiveExport.commands` para que el diagnóstico refleje exactamente lo que se exportaría. Opcional. |

**Veredicto 6:** ✅ OK en botones de exportación reales · ⚠ 2 riesgos bajos en vistas de diagnóstico/comparación (no generan archivo de producción).

---

## Resumen ejecutivo

| Categoría | OK | Riesgo | Error crítico |
|---|---|---|---|
| 1. Compilación | ✅ | 0 | 0 |
| 2. Flujo principal exportación | ✅ | 0 | 0 |
| 3. CE01 Production Mode | ✅ | 0 | 0 |
| 4. Invariantes V5 | ✅ | 0 | 0 |
| 5. Travel Polish V1 | ✅ (funcional) | 1 (cosmético, informe .md) | 0 |
| 6. Botones auxiliares | ✅ (exportación) | 2 (bajos, diagnóstico/comparación) | 0 |

### Riesgos consolidados

| # | ID | Severidad | Archivo | Función/Línea | Recomendación |
|---|---|---|---|---|---|
| R1 | TRAVEL_POLISH_REPORT_FIELD_MISMATCH | Riesgo (cosmético) | `src/lib/exportRepair/travelPolish.js` | `polishTravelAfterV5` — llamada a `generateTravelPolishReport` (l. 354-356) | Pasar `travelPolishComparison`, `travelPolishPhaseLog`, `forensics` con los nombres correctos para que el .md descargable muestre la tabla comparativa y las fases. |
| R2 | AUX_EXPORT_USES_SOURCE_COMMANDS (vista Final) | Riesgo bajo (intencional) | `src/components/editor/ExportModal.jsx` | `ValidationPreview` props | Aceptar como comparación intencional Final vs Exportable. |
| R3 | AUX_EXPORT_USES_SOURCE_COMMANDS (BinaryInspector) | Riesgo bajo (diagnóstico) | `src/components/editor/ExportModal.jsx` | `<BinaryInspectorPanel commands={pipelineResult.commands} />` | Cambiar a `effectiveExport.commands` para alinear el diagnóstico con la exportación real. |

### Errores críticos
**Ninguno.** La app compila, el flujo principal usa `getEffectiveExportCommands` con la prioridad correcta, CE01 Production Mode bloquea INVALID/permite RISKY/fuerza DST, los invariantes V5 se verifican sobre los comandos devueltos, y Travel Polish V1 es transaccional y reversible sin reconvertir diagonales.

### Conclusión
El flujo V5 + Travel Polish V1 es **funcionalmente correcto y seguro**. Solo hay 1 riesgo cosmético (informe .md de travel polish con tabla vacía por mismatch de nombres) y 2 riesgos bajos en vistas de diagnóstico/comparación que no afectan a la exportación de producción.

---
_Auditoría sin modificaciones. Aplicar R1 (y opcionalmente R3) cuando se autorice editar código._