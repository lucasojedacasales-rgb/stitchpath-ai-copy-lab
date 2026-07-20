# APP_UI_VISUAL_SIMPLIFICATION_V2_REPORT

> Fecha: 2026-07-05  
> Alcance: simplificación visual del Editor  
> Tipo: UI only  
> Restricción: sin cambios en motor ni exportación

---

## Resultado

| Campo | Estado |
|---|---:|
| focusModeAdded | true |
| cleanModeRightPanelHidden | true |
| cleanModeLeftPanelCollapsible | true |
| labTabsGrouped | true |
| canvasPriorityImproved | true |
| technicalControlsHiddenInClean | true |
| exportLogicUnchanged | true |
| motorFilesUnchanged | true |

---

## Cambios aplicados

### 1. Modo enfoque

focusModeAdded=true

Se añadió el botón **Modo enfoque** en la cabecera superior, junto al selector de Vista limpia / Herramientas técnicas.

Cuando está activo:

- se oculta el panel lateral izquierdo
- se oculta el panel lateral derecho
- se oculta la barra secundaria de pestañas
- se mantiene el área central del bordado
- se mantienen los botones principales:
  - Exportar
  - Procesar
  - Guardar
- se mantiene el selector Vista limpia / Herramientas técnicas
- se permite salir con **Salir de enfoque**

---

### 2. Vista limpia

cleanModeRightPanelHidden=true  
technicalControlsHiddenInClean=true

En Vista limpia se oculta completamente el panel derecho:

- EIE v2.0
- Métricas
- Aplicar EIE
- Fix errores
- Calibrar
- Tipo de puntada
- Ángulo de relleno
- Densidad
- Compensación
- Underlay
- Prioridad y recorrido

También se ocultan barras debug y controles técnicos secundarios.

---

### 3. Panel izquierdo limpio

cleanModeLeftPanelCollapsible=true

En Vista limpia el panel izquierdo es plegable:

- cerrado muestra solo el botón **Configuración**
- abierto muestra ConfigPanel básico
- se cierra automáticamente en Final y Simular

---

### 4. Herramientas técnicas agrupadas

labTabsGrouped=true

En Herramientas técnicas las pestañas visibles principales quedan reducidas a:

- Editor
- Simular
- Final
- Exportar
- Más...

Dentro de **Más...** quedan:

- Máscara
- Planner
- Travel
- Validar
- Detalles
- Diagnóstico
- Profesional
- Aprendizaje

---

### 5. Prioridad visual del lienzo

canvasPriorityImproved=true

El lienzo central gana espacio mediante:

- ocultación del panel derecho en Vista limpia
- panel izquierdo plegable en Vista limpia
- ocultación de paneles laterales en Modo enfoque
- ocultación de barras debug fuera de Herramientas técnicas
- agrupación de pestañas técnicas en Más...

---

## Contrato de no modificación

No se modificó:

- motor
- buildFinalCommands
- applyProfessionalPipeline
- professionalDigitizingMode
- ExportModal
- getEffectiveExportCommands
- handleExport
- validadores
- encoders
- Reference Learning logic
- CE01 validator
- V5.1
- SATIN / Trim Guard / Splitter / Underlay

---

## Veredicto

APP_UI_VISUAL_SIMPLIFICATION_V2 aplicado como cambio exclusivamente visual del Editor.