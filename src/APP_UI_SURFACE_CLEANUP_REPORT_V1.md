# APP_UI_SURFACE_CLEANUP_REPORT_V1

> Fecha: 2026-07-05  
> Alcance: limpieza visual del Editor principal  
> Restricción: UI y organización visual únicamente

---

## Resultado

| Campo | Valor |
|---|---:|
| simpleModeDefault | true |
| labModeAvailable | true |
| feetTabHiddenInSimple | true |
| footDiagnosticMovedOrLabOnly | true |
| leftSidebarSimplifiedInSimple | true |
| debugBarsHiddenInSimple | true |
| exportModalUnchanged | true |
| exportLogicUnchanged | true |
| motorFilesUnchanged | true |

---

## tabsVisibleInSimple

- Editor
- Máscara
- Simular
- Final

---

## tabsHiddenInSimple

- Planner
- Travel
- Validar
- Detalles
- Diagnóstico
- Pies
- Profesional
- Aprendizaje
- Panel

---

## Validación APP_UI_SURFACE_CLEANUP_V1

### 1. Modo Simple por defecto

simpleModeDefault=true

El Editor inicia en modo Simple / Vista limpia.

### 2. Modo Laboratorio disponible

labModeAvailable=true

La cabecera del Editor permite alternar entre:

- Vista limpia
- Herramientas técnicas

### 3. Pestañas visibles en Simple

En modo Simple solo aparecen:

- Editor
- Máscara
- Simular
- Final

### 4. Pestañas ocultas en Simple

En modo Simple quedan ocultas:

- Planner
- Travel
- Validar
- Detalles
- Diagnóstico
- Pies
- Profesional
- Aprendizaje
- Panel

### 5. Pies

feetTabHiddenInSimple=true

La pestaña Pies no aparece en Simple.

footDiagnosticMovedOrLabOnly=true

El diagnóstico de pies / contorno inferior queda dentro de Diagnóstico técnico en Laboratorio, marcado como:

- solo lectura
- diagnóstico técnico
- no herramienta principal de usuario final

### 6. Panel lateral izquierdo

leftSidebarSimplifiedInSimple=true

En Simple queda visible solo el ConfigPanel básico.

En Laboratorio quedan disponibles los paneles avanzados:

- AestheticPreservationPanel
- QualityAnalysisPanel
- PreprocessingPanel
- NeedlePathPanel

### 7. Barra debug inferior

debugBarsHiddenInSimple=true

En Simple queda oculta la barra inferior que muestra:

- Command source
- finalEmbroideryCommands
- Panels synced
- Metrics source
- Cmd version
- stitches / jumps / trims / colors
- botón Regenerar

En Laboratorio puede aparecer bajo el título:

Debug de sincronización de comandos

### 8. ExportModal

exportModalUnchanged=true

No se tocó ExportModal.

### 9. Lógica de exportación

exportLogicUnchanged=true

No se tocó:

- getEffectiveExportCommands
- handleExport
- lógica CE01 Production
- ExportRepairPanel logic

### 10. Motor

motorFilesUnchanged=true

No se tocó:

- motor de digitalización
- buildFinalCommands
- applyProfessionalPipeline
- V5.1 export repair
- Travel Polish
- Safe Tie V2
- SATIN_OUTER_CONTOUR_CONVERTER_V1
- REFERENCE_TRIM_GUARD_V1
- REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2
- UNDERLAY_GENERATOR_V1
- DST encoder
- DSB encoder
- CE01 validator

---

## Conclusión

APP_UI_SURFACE_CLEANUP_V1 está aplicado como limpieza de superficie visual del Editor.

No se generó REFERENCE_PRESET_CONNECTION_AUDIT.
No se tocó Reference Learning.
No se tocó motor.
No se tocó exportación.