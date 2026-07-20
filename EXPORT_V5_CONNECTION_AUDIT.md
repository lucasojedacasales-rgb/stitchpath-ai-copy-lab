# EXPORT_V5_CONNECTION_AUDIT.md — StitchPath AI

> Auditoría de conexión del flujo de exportación V5.
> Objetivo: asegurar que TODOS los botones/paneles de exportación usan `repairedCommands`
> cuando `repairAccepted=true`, mediante el helper único `getEffectiveExportCommands`.
> No se modifica: motor de digitalización, detector universal, aprendizaje del corpus,
> encoder DST/DSB (salvo conexión incorrecta), ni la lógica visual del Final Look.

---

## Helper único

`src/lib/exportRepair/getEffectiveExportCommands.js`

```
getEffectiveExportCommands({
  repairAccepted,
  repairedCommands,
  editorFinalCommands,
  pipelineCommands,
  productionCommands   // pasar solo si productionReport.exportAllowed=true
})
```

Orden de prioridad:
1. `repairedCommands` si `repairAccepted=true` y `repairedCommands.length > 0`
2. `productionCommands` si existen y `exportAllowed=true`
3. `editorFinalCommands`
4. `pipelineCommands` (`pipelineResult.commands`)

Devuelve `{ commands, source }`. Registra:
- `[effective-export-source] candidates: {…}` (los 4 candidatos disponibles)
- `[effective-export-source] <source>` (el seleccionado)

---

## 1. Botón principal de exportación (`handleExport`, modo CE01 Production)

| Campo | Valor |
|---|---|
| **Antes** | `exportCommands = (repairAccepted && repairedCommands?.length>0) ? repairedCommands : (productionReport?.exportAllowed ? productionReport.commands : (editorFinalCommands \|\| pipelineResult.commands))`. `ccSource` usaba un ternario similar sobre `sourceCommands`. |
| **Ahora** | `exportCommands = effectiveExport.commands` (helper). `ccSource = effectiveExport.commands`. |
| **Usa repairedCommands si repairAccepted=true** | ✅ SÍ (prioridad 1 del helper). |
| **Puede exportar comandos antiguos por error** | ❌ NO. El helper prioriza repairedCommands; si no existen, pasa a productionCommands/editor/pipeline, nunca a "sourceCommands antiguos" saltándose repaired. |
| **DST principal** | No se rompe: `buildDSTFromCommands` recibe `effectiveExport.commands`; el encoder no se toca. |

---

## 2. Botón "Exportar Kirby completo con contorno refinado"

| Campo | Valor |
|---|---|
| **Antes** | `const cmds = editorFinalCommands \|\| pipelineResult.commands; buildDSTFromCommands(cmds, …)` — exportaba comandos sin reparación V5 aunque `repairAccepted=true`. ⚠ |
| **Ahora** | `const cmds = effectiveExport.commands;` — usa repairedCommands si repairAccepted. |
| **Usa repairedCommands si repairAccepted=true** | ✅ SÍ. |
| **Puede exportar comandos antiguos por error** | ❌ NO (corregido). |

---

## 3. Botón "Exportar solo contornos Kirby"

| Campo | Valor |
|---|---|
| **Antes** | `generateOutlineOnlyDST(regions, config)` — regenera contornos **desde regions**, no usa `finalCommands` ni `sourceCommands`. |
| **Ahora** | Sin cambios. Es un test aislado de extracción de contornos. |
| **Usa repairedCommands** | N/A — no consume `finalCommands` ni `repairedCommands`; produce su propio DST de contornos desde regions. |
| **Puede exportar comandos antiguos por error** | N/A — no depende de `editorFinalCommands` ni de `repairedCommands`. No se ve afectado por V5. |

> Nota: este botón valida la **extracción de contornos**, no el diseño completo.
> Forzar `repairedCommands` aquí exportaría el diseño completo (no "solo contornos"), rompiendo su propósito.

---

## 4. Botón "Test solo contorno inferior y pies"

| Campo | Valor |
|---|---|
| **Antes** | `rebuildLowerOuterContoursFromDarkStroke(regions, config, darkStroke)` → `generateContourStitches` → `buildDSTFromCommands`. No usa `finalCommands`. |
| **Ahora** | Sin cambios. Test aislado de reconstrucción de contorno inferior/pies desde línea negra real. |
| **Usa repairedCommands** | N/A — regenera desde `darkStroke`, no desde `finalCommands`. |
| **Puede exportar comandos antiguos por error** | N/A — no depende de `editorFinalCommands` ni de `repairedCommands`. |

---

## 5. CE01ProductionPanel

| Campo | Valor |
|---|---|
| **Antes** | Mostraba `productionReport` con `source = finalEmbroideryCommands` fijo, sin reflejar el source efectivo cuando `repairAccepted=true`. |
| **Ahora** | Recibe `effectiveSource` y muestra un indicador: "Export efectivo: repairedCommands (V5)" cuando `repairAccepted=true`. Las métricas del panel siguen siendo de `productionReport` (capa CE01 repair+sanitize), pero el usuario ve qué comandos se exportarán realmente. |
| **Usa repairedCommands** | ✅ Indica el source efectivo. No reejecuta el pipeline CE01 sobre repairedCommands (evita doble reparación). |
| **Puede exportar comandos antiguos por error** | ❌ NO (el botón principal usa el helper). |

---

## 6. ValidationPreview

| Campo | Valor |
|---|---|
| **Antes** | `commands={exportView==='exportable' && repairedCommands ? repairedCommands : (editorFinalCommands \|\| pipelineResult.commands)}`. Funcionaba pero era un ternario ad-hoc no centralizado. |
| **Ahora** | `commands={exportView==='exportable' ? effectiveExport.commands : (editorFinalCommands \|\| pipelineResult.commands)}`. En modo "exportable" usa el helper; en "final" muestra el Final Look visual. |
| **Muestra repairedCommands en modo exportable** | ✅ SÍ. |
| **Puede exportar/mostrar comandos antiguos por error** | ❌ NO. |

---

## 7. ExportRealityCheck

| Campo | Valor |
|---|---|
| **Antes** | `computeExportReality(regions, editorFinalCommands \|\| pipelineResult.commands)` — comparaba la realidad contra comandos sin reparar. |
| **Ahora** | `computeExportReality(regions, effectiveExport.commands)` — compara contra los comandos que se exportarán. |
| **Valida repairedCommands cuando repairAccepted** | ✅ SÍ. |
| **Puede validar comandos antiguos por error** | ❌ NO. |

---

## 8. ContourRefinePanel

| Campo | Valor |
|---|---|
| **Antes** | `commands={editorFinalCommands \|\| pipelineResult.commands}` — diagnosticaba contornos sobre comandos sin reparar. |
| **Ahora** | `commands={effectiveExport.commands}` — diagnostica sobre los comandos exportables. |
| **Diagnostica repairedCommands cuando repairAccepted** | ✅ SÍ. |
| **Puede diagnosticar comandos antiguos por error** | ❌ NO. |

---

## Otros sitios alineados con el helper

| Sitio | Antes | Ahora |
|---|---|---|
| `unifiedMetrics` | `editorFinalCommands \|\| pipelineResult.commands` | `effectiveExport.commands` |
| `realityCheck` (memo) | `editorFinalCommands \|\| pipelineResult.commands` | `effectiveExport.commands` |
| `contourReport` (memo) | `editorFinalCommands \|\| pipelineResult.commands` | `effectiveExport.commands` |

## Sitios NO modificados (correctos)

| Sitio | Razón |
|---|---|
| `ExportRepairPanel` (prop `finalCommands`) | Es la **entrada** al repair V5; debe ser `editorFinalCommands` (sin reparar) para que el repair opere sobre el Final Look original. |
| Botón "Exportar test 3 colores CE01" | Genera DST sintético mínimo (`generate3ColorTestDST`), no usa `finalCommands`. Test aislado. |
| Botón "Exportar test contorno CE01" | Genera DST sintético de contorno (`generateContourTestDST`), no usa `finalCommands`. Test aislado. |
| `productionReport` (memo, source) | Capa CE01 repair+sanitize sobre `editorFinalCommands`. Es un fallback (prioridad 2), no el source principal cuando `repairAccepted`. |
| `productionGateDecision` | Evalúa `productionReport.ce01Report`; el botón principal la bypassa cuando `repairAccepted` (ya existente, correcto). |
| Encoder DST/DSB | No se toca. `buildDSTFromCommands` recibe `effectiveExport.commands`. |

---

## Criterios de éxito

| Criterio | Estado |
|---|---|
| Botón principal usa `repairedCommands` | ✅ |
| Botón "Kirby completo" usa `repairedCommands` si existen | ✅ |
| `ValidationPreview` muestra `repairedCommands` en modo exportable | ✅ |
| Ningún botón de exportación real usa `sourceCommands` si `repairAccepted=true` | ✅ |
| No se rompe el DST principal | ✅ (encoder intacto; solo cambia el input de comandos) |

---

## Logs añadidos

Cada vez que se selecciona el source efectivo:
```
[effective-export-source] candidates: { repairedCommands: N, productionReportCommands: N, editorFinalCommands: N, pipelineResultCommands: N }
[effective-export-source] repairedCommands   // o productionReport.commands / editorFinalCommands / pipelineResult.commands
```

---

_Helper único: `getEffectiveExportCommands`. Aplicado en: handleExport (exportCommands + ccSource), Kirby completo, ValidationPreview, ExportRealityCheck, ContourRefinePanel, unifiedMetrics, realityCheck, contourReport, CE01ProductionPanel (effectiveSource)._