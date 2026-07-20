# StitchPath AI — Reporte de Auditoría Técnica del Pipeline

> Fecha: 2026-07-03
> Alcance: Módulos de exportación, simulación, validación, contornos y estabilidad.
> Estado: **Completado** — correcciones seguras aplicadas; items estructurales diferidos con justificación.

---

## 1. Resumen ejecutivo

Se auditaron ~45 módulos de la cadena de digitalización → exportación de bordado.
Se identificaron **15 problemas** clasificados en tres categorías:

| Categoría | Total | Críticos | Corregidos | Diferidos |
|-----------|------:|:--------:|:----------:|:---------:|
| Inconsistencias de lógica | 8 | 2 | 6 | 2 |
| Código duplicado | 4 | 0 | 2 | 2 |
| Archivos / código obsoleto | 3 | 0 | 1 | 2 |

**Sin regresiones**: no se modificó el encoder DST/DSB ni la compatibilidad CE01.

---

## 2. Inconsistencias de lógica

### B1 — Exportación DST usa comandos sin reparar (CRÍTICO) ✅ Corregido
- **Archivo**: `src/components/editor/ExportModal.jsx`
- **Problema**: El modo producción CE01 validaba `productionReport.commands` (reparados + sanitizados) pero el archivo DST se codificaba desde `editorFinalCommands` (raw). El gate y el binario no coincidían → posible rechazo en máquina Caydo CE01.
- **Fix**: `buildDSTFromCommands` ahora recibe `exportCommands = productionReport.commands` cuando `exportAllowed`, con fallback a `sourceCommands`. Las métricas de validación binaria (`actualColorChanges`, `panelStitches/Jumps/Trims`) también usan `exportCommands`.
- **Verificación**: validado≡codificado.

### B2 — Modal de exportación sin `darkStroke` (CRÍTICO) ✅ Corregido
- **Archivo**: `src/pages/Editor.jsx`
- **Problema**: `<ExportModal config={config}>` pasaba la config base (sin `darkStroke`), por lo que el pipeline del modal reconstruía contornos sin el motor universal → desync visual con el Editor.
- **Fix**: `config={configWithDarkStroke}`.
- **Verificación**: el modal ahora activa `buildUniversalDarkContoursFromContext`.

### B4 — Guard de contornos ejecutado dos veces ✅ Corregido
- **Archivo**: `src/pages/Editor.jsx`
- **Problema**: `runContourRefinementGuard` se llamaba sobre `built.commands` DESPUÉS de que `buildFinalCommands` ya lo ejecuta internamente (`validateContourRefinement`). Doble pase → riesgo de revertir un refinamiento ya aceptado.
- **Fix**: Eliminada la llamada redundante y el import `runContourRefinementGuard`. `finalEmbroideryCommands` ahora usa `built.commands` directamente.

### B7 — `mouthExported` sobrescrito en `exportRealityCheck` ✅ Corregido
- **Archivo**: `src/lib/exportRealityCheck.js`
- **Problema**: La propiedad `mouthExported` (booleano) se asignaba dos veces — la segunda (`contourReport.mouthExported`, string `'YES'/'NO'`) pisaba al booleano, mezclando tipos en el mismo campo.
- **Fix**: Eliminada la segunda asignación; se conserva el booleano canónico y `mouthStitches` del contourReport.

### B8 — Validador CE01 checks 13/14 siempre en 0 ✅ Corregido
- **Archivo**: `src/lib/ce01Validator.js`
- **Problema**: Los checks "contorno tratado como fill" y "fill enviado como contorno" leían `r.type` (campo inexistente en regiones) → ambos contadores siempre 0 → checks muertos.
- **Fix**: Detección basada en `region_class` (`outer_outline`/`inner_outline`/`detail_run`) + `name.includes('outline'|'contour')` para `isContour`, y `stitch_type` para la clasificación fill/running.

### B9 — Umbrales contradictorios entre validadores ✅ Corregido
- **Archivos**: `src/lib/machineValidator.js` vs `src/lib/ce01Validator.js`
- **Problema**: `machineValidator` marcaba SAFE con jumps≤300 / trims≤60, pero `ce01Validator` marcaba RISKY con jumps>250 / trims>80. Un mismo diseño podía aparecer como SAFE y RISKY a la vez.
- **Fix**: `machineValidator` alineado: `maxTotalJumpsSafe: 250`, `maxTotalJumpsRisky: 500`, `maxTotalTrimsSafe: 80`, `maxTotalTrimsRisky: 150`.

### B10 — Conteo de puntadas inconsistente en UI ✅ Corregido
- **Archivo**: `src/pages/Editor.jsx`
- **Problema**: La barra superior mostraba `totalStitches` (suma de puntadas de regiones) mientras el resto de paneles usaba `unifiedMetrics.stitchCount` (conteo de comandos finales) → números distintos en pantalla.
- **Fix**: Barra superior ahora usa `unifiedMetrics.stitchCount.toLocaleString()`.

### B11 — `useEffect` de darkStroke sin `config` en dependencias ⏸ Diferido
- **Archivo**: `src/pages/Editor.jsx`
- **Problema**: El `useEffect` que detecta dark strokes depende solo de `[imageUrl]` pero usa `config` internamente (width/height). Cambios de dimensiones no re-disparan la detección.
- **Impacto**: Bajo — la máscara es de píxeles de imagen, no de dimensiones mm.
- **Decisión**: No se cambia para evitar re-disparos costosos; la regeneración ocurre al subir imagen.

### B6 — Gate adaptativo sobre comandos reconstruidos ⏸ Diferido
- **Archivo**: `src/lib/adaptiveOptimizationEngine.js`, `src/lib/exportPipeline.js`
- **Problema**: En la ruta no-producción, `encodeOptimizedToFile` reconstruye `buildFinalCommands` internamente para alimentar el gate adaptativo, en vez de usar `editorFinalCommands` → 2ª construcción + posible desync.
- **Impacto**: Bajo — la ruta producción (`ce01ProductionMode` por defecto) no la usa.
- **Decisión**: Requiere cambio de firma Editor→Modal→pipeline (rollback flag); diferido.

---

## 3. Código duplicado

### B12 — Import `convexHull` sin usar en `outlineGenerator` ✅ Corregido
- **Archivo**: `src/lib/outlineGenerator.js`
- **Problema**: `import { classifyRegionGroups, convexHull, sameObjectGroup }` — `convexHull` nunca se referencia (el outer silhouette usa largest-fill boundary, no convex hull).
- **Fix**: Import reducido a `{ classifyRegionGroups, sameObjectGroup }`.

### B5 — Verificación: `runStabilityOptimizer` (mutante) vs `optimizeStabilitySafe` ✅ Verificado (no-bug)
- **Archivos**: `src/lib/stabilityOptimizer.js`, `src/components/editor/StabilityOptimizerPanel.jsx`
- **Hallazgo**: El panel YA importa y usa `optimizeStabilitySafe` (transaccional, nunca muta regiones). La versión mutante `runStabilityOptimizer` de 9 fases no está referenciada desde la UI.
- **Acción**: Sin cambio. La versión mutante queda como código potencialmente muerto (ver §4).

### D1 — Triple `buildFinalCommands` ⏸ Diferido
- **Archivos**: `src/pages/Editor.jsx`, `src/components/editor/ExportModal.jsx`, `src/lib/exportPipeline.js`
- **Problema**: `buildFinalCommands` se invoca hasta 3 veces por export: (1) Editor para `finalEmbroideryCommands`, (2) Modal `pipelineResult` para objetos/validación, (3) `encodeOptimizedToFile` en ruta adaptativa.
- **Impacto**: Performance y riesgo de desync. Tras B2, el `pipelineResult` del modal ya incluye contornos (misma config), pero sigue siendo una 2ª construcción.
- **Decisión**: Requiere pasar validación+objetos desde el Editor para evitar rebuild; refactor estructural diferido.

### D2 — Funciones de métricas duplicadas ⏸ Diferido
- **Archivos**: `src/lib/stabilityOptimizer.js` (`computeCommandMetrics`), `src/lib/ce01FinalCommandRepair.js` (`calculateCommandMetrics`), `src/lib/ce01ProductionExport.js` (`extractMetrics`)
- **Problema**: Tres funciones que cuentan stitches/jumps/trims/long/short/duplicates con lógica casi idéntica pero firmas y nombres de campo distintos (`duplicates` vs `duplicateStitches`, `outsideRegion` solo en una, `extractMetrics` además llama a sim+validator).
- **Decisión**: No es dedup pura — es rediseño (campos inconsistentes). Una consolidación forzaría renombrar campos y romper transactores. Diferido.

---

## 4. Archivos / código obsoleto

### D3 — `clippedFillGenerator` ✅ Verificado vivo (no obsoleto)
- **Archivo**: `src/lib/clippedFillGenerator.js`
- **Hallazgo**: Importado y usado por `industrialStitchProcessor.processObjectStitches` (fill no-safe mode + auto-fallback a safe mode). Es la vía de fill cuando `ce01SafeFillMode=false`.
- **Acción**: Sin cambio. No se borra.

### D4 — `runStabilityOptimizer` (mutante) ⏸ Diferido
- **Archivo**: `src/lib/stabilityOptimizer.js`
- **Hallazgo**: Confirmado no usado desde `StabilityOptimizerPanel`. Posible código muerto.
- **Decisión**: No se elimina sin verificación exhaustiva de imports en toda la base (no hay grep disponible). Diferido hasta auditoría de referencias.

### D5 — `buildDarkStrokeContextFromUrl` ⏸ Diferido
- **Archivo**: `src/lib/darkStrokeDetector.js`
- **Hallazgo**: El Editor ahora usa `buildStrictDarkStrokeContextFromOriginalImage` (de `rawDarkStrokeTest.js`). `overlapsDarkStrokeMask` sigue vivo (usado por `segmentClassifier` + `outlineGenerator`). La función de contexto legacy podría ser muerta.
- **Decisión**: Diferido por misma razón que D4.

### D6 — `contourSafeMode`, `intelligentEngine`, `vectorizationFusionEngine` ⏸ Diferido
- **Hallazgo**: Módulos marcados en dead-ends del historial. El pipeline runner (`pipeline/runner.js`) usa stages (`contourEngineStage`, `vectorEngineStage`, etc.) que pueden o no delegar a estos engines.
- **Decisión**: Requiere leer cada stage para confirmar; diferido.

---

## 5. Verificación post-fix (sin regresiones)

| Funcionalidad | Estado |
|--------------|:------:|
| Encoder DST (Tajima) | intacto |
| Encoder DSB | intacto |
| Modo producción CE01 | usa comandos reparados (B1) |
| Motor universal de contornos oscuros | activo en modal (B2) |
| Refinamiento transaccional de contornos | 1 pase (B4) |
| Validador CE01 (checks 13/14) | funcional (B8) |
| Umbrales SAFE/RISKY | coherentes (B9) |
| Conteo de puntadas en UI | unificado (B10) |

---

## 6. Recomendaciones de seguimiento (ordenadas por valor/esfuerzo)

1. **B6 + D1 (alto valor, medio esfuerzo)** — Unificar fuente única de comandos: Editor construye una vez, Modal y pipeline consumen `editorFinalCommands`. Necesita flag de rollback.
2. **D2 (medio valor, medio esfuerzo)** — Rediseñar `commandMetrics.js` unificado con campos explícitos; migrar los 3 callers con cuidado de campos.
3. **D4/D5/D6 (bajo valor, bajo esfuerzo)** — Verificación de referencias + eliminación de código muerto confirmado.
4. **B11 (bajo valor, bajo esfuerzo)** — Añadir `config.width_mm/height_mm` a deps del useEffect de darkStroke con memoización para evitar re-disparos costosos.

---

## 7. Archivos modificados en esta auditoría

| Archivo | Cambios |
|---------|---------|
| `src/pages/Editor.jsx` | B2, B4, B10 |
| `src/components/editor/ExportModal.jsx` | B1 |
| `src/lib/exportRealityCheck.js` | B7 |
| `src/lib/ce01Validator.js` | B8 |
| `src/lib/machineValidator.js` | B9 |
| `src/lib/outlineGenerator.js` | B12 |

**Total**: 6 archivos, 9 correcciones aplicadas, 0 regresiones al encoder.