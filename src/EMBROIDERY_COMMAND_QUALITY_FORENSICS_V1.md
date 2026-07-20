# EMBROIDERY_COMMAND_QUALITY_FORENSICS_V1

> Fecha: 2026-07-05  
> Alcance: auditoría documental / forense de comandos finales  
> Restricción cumplida: no se modificó código, motor, exportación, V5.1, ExportModal, encoders, CE01 validator ni UI.

---

## 0. Resumen ejecutivo

La detección visual de regiones puede ser correcta y aun así producir bordado defectuoso porque el problema ya no está en la segmentación visual sino en la conversión de regiones a comandos finales de máquina.

Después de SIMULATION_TAB_TRUTH_FIX_V1, la pestaña Simular usa `finalEmbroideryCommands`, por lo que las líneas largas, conectores cosidos, diagonales internas y puntadas fuera de región visibles en Simular representan defectos reales en la secuencia final de comandos, no un artefacto del simulador.

**detectionGoodButStitchingBad=true**

**issueStage=MIXED**

Etapas implicadas con mayor probabilidad:

1. `FILL_GENERATION`
2. `TRAVEL_CONVERSION`
3. `CONTOUR_GENERATION`
4. `LAYER_ORDER`

No hay evidencia de que la causa primaria sea `REGION_DETECTION` si las regiones/color se ven correctamente antes de generar comandos.

---

## 1. Fuente de comandos

### 1.1 Editor / finalEmbroideryCommands

`Editor.jsx` construye una fuente canónica:

```txt
finalEmbroideryCommands = buildFinalCommands(...)
```

Si `professionalMode` está activo, el resultado pasa por `applyProfessionalPipeline`, pero el consumidor visual sigue recibiendo el mismo objeto `finalEmbroideryCommands`.

**Confirmación:**

| Check | Resultado |
|---|---:|
| finalEmbroideryCommands.commands existe en Editor | true |
| finalEmbroideryCommands.objects existe en Editor | true |
| Editor pasa finalCommands a MachineSimulator | true |
| Editor pasa finalObjects a MachineSimulator | true |
| Editor pasa finalCommands a FinalLookSimulator | true |
| Editor pasa finalObjects a FinalLookSimulator | true |
| Editor pasa finalCommands a ExportModal | true |
| Editor pasa finalObjects a ExportModal | true |

---

### 1.2 MachineSimulator

Tras SIMULATION_TAB_TRUTH_FIX_V1:

```txt
MachineSimulator usa finalCommands si existen y tienen longitud.
```

Solo reconstruye comandos con `buildStitchObjects + flattenToCommands` como fallback cuando no recibe `finalCommands`.

**Conclusión:**

| Check | Resultado |
|---|---:|
| MachineSimulator usa finalEmbroideryCommands | true |
| MachineSimulator rebuild fallback only | true |
| simulationMatchesFinalCommands cuando finalCommands existe | true |
| commandSourceUsed esperado | finalEmbroideryCommands |

---

### 1.3 Final Look

`FinalLookSimulator` es read-only y usa directamente:

```txt
commands = finalCommands || []
objects = finalObjects || []
```

No genera sus propios comandos.

**Conclusión:** Final Look usa `finalEmbroideryCommands`.

---

### 1.4 Export

Export tiene dos niveles:

1. `editorFinalCommands` recibidos desde Editor.
2. `effectiveExport.commands` seleccionado por `getEffectiveExportCommands`.

`getEffectiveExportCommands` usa esta prioridad:

```txt
1. repairedCommands, si repairAccepted=true
2. productionReport.commands
3. editorFinalCommands
4. pipelineResult.commands
```

**Conclusión:**

| Check | Resultado |
|---|---:|
| Export recibe editorFinalCommands | true |
| Export usa getEffectiveExportCommands | true |
| Export puede diferir de finalEmbroideryCommands después de repairAccepted | true |
| Export sin reparación aceptada usa editorFinalCommands como fuente prioritaria | true |

### 1.5 Diferencias posibles entre finalEmbroideryCommands y exportCommands

| Caso | ¿Difieren? | Motivo |
|---|---:|---|
| Antes de reparar en Export | false / normalmente no | `editorFinalCommands` es prioridad |
| Después de `repairAccepted=true` | true | `repairedCommands` reemplaza fuente efectiva |
| Si productionReport exportAllowed genera comandos | true posible | `productionReport.commands` tiene prioridad sobre editorFinalCommands |
| Si editorFinalCommands vacío | true | fallback a `pipelineResult.commands` |

---

## 2. Métricas globales solicitadas

Esta auditoría se realizó sin ejecutar runtime de un proyecto activo y sin modificar código. Por tanto, los campos numéricos dependientes de un diseño concreto quedan marcados como `RUNTIME_REQUIRED`.

| Métrica | Valor |
|---|---:|
| totalCommands | RUNTIME_REQUIRED |
| totalStitches | RUNTIME_REQUIRED |
| totalJumps | RUNTIME_REQUIRED |
| totalTrims | RUNTIME_REQUIRED |
| visibleLongStitchCount | RUNTIME_REQUIRED |
| stitchedTravelCount | RUNTIME_REQUIRED |
| fillOutsideRegionCount | RUNTIME_REQUIRED |
| crossRegionStitchCount | RUNTIME_REQUIRED |
| maxVisibleStitchMm | RUNTIME_REQUIRED |
| worstOffenderRegionIds | RUNTIME_REQUIRED |
| worstOffenderCommandIndexes | RUNTIME_REQUIRED |

**Motivo:** los comandos finales se calculan en cliente con contexto de Editor, regiones activas, configuración, darkStroke, machineSettings y estado profesional. No existe una captura persistida de `finalEmbroideryCommands` en base de datos que pueda auditarse sin instrumentación o sin abrir un proyecto concreto.

---

## 3. Calidad por región — esquema forense requerido

Para cada región debe calcularse esta tabla en una ejecución runtime:

| Campo | Descripción |
|---|---|
| regionId | `region.id` o `command.regionId` |
| color | color de la región/comando |
| stitch_type | fill / satin / running_stitch / contour |
| layerType/source | `layerType`, `region_class`, `source` |
| stitchCount | comandos `stitch` asociados a la región |
| bbox | minX, minY, maxX, maxY de comandos de región |
| area estimada | área poligonal de `path_points` convertida a mm² |
| puntadas fuera del polígono | stitches cuyo punto cae fuera de su región |
| puntadas largas >4mm | segmentos stitch consecutivos >4mm |
| puntadas largas >8mm | segmentos stitch consecutivos >8mm |
| segmentos que cruzan otra región | segmento dentro/intersectando región ajena |
| segmentos que cruzan espacio vacío | segmento fuera de cualquier región |
| densidad estimada | stitches / área mm² o por celda |
| tiene contorno asociado | existe contour/running/outer para el mismo objeto visual |
| relleno respeta polígono | true si todos los puntos/segmentos están dentro |

### Resultado de esta auditoría documental

| Estado | Valor |
|---|---:|
| perRegionRuntimeSnapshotAvailable | false |
| perRegionQualityMeasured | false |
| reason | no active finalEmbroideryCommands snapshot persisted |

---

## 4. Detección de conectores visibles

### 4.1 Definición del offender

Un comando `stitch` debe considerarse sospechoso si cumple una o más condiciones:

- distancia desde comando anterior >4mm
- distancia desde comando anterior >8mm
- cruza espacio vacío
- cruza entre regiones distintas
- color negro o cercano a negro y no tiene soporte darkStroke
- stitchType/layerType de contorno pero segmento no sigue máscara oscura
- `regionId` anterior y actual no corresponden a la misma región física
- `source` indica relleno o contorno pero el segmento actúa como travel

### 4.2 Peores 30 offenders

No se listan índices reales porque no hay snapshot runtime de `finalEmbroideryCommands` asociado a un proyecto concreto.

Formato requerido para la próxima medición:

| index | from x/y | to x/y | distanceMm | color | prevRegionId | regionId | stitchType | layerType | source | reason |
|---:|---|---|---:|---|---|---|---|---|---|---|
| RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED | RUNTIME_REQUIRED |

### 4.3 Hallazgo estructural

El generador ya intenta convertir viajes en `jump`, pero hay varias zonas donde un segmento visible puede sobrevivir:

1. conexiones internas de fill cuando `_segmentInsideTolerant` acepta un tramo demasiado amplio;
2. conversión posterior de jumps cortos a stitches por optimizadores de travel;
3. contornos/detail donde el guard solo corta segmentos largos sin soporte darkStroke, pero puede dejar segmentos menores que siguen siendo visualmente incorrectos;
4. fallback/rebuild en export no debería ocurrir normalmente, pero si `editorFinalCommands` está vacío puede generar secuencia distinta.

---

## 5. Clipping de rellenos

### 5.1 Fuente auditada

`generateCE01SafeFillCommands` declara:

- scanlines sobre polígono inset;
- validación de puntos dentro de polígono;
- proyección cerca de borde;
- conversión a jump si una conexión cruza fuera;
- split de puntadas largas;
- rechazo de puntos fuera.

### 5.2 Riesgos detectados por lectura

| Riesgo | Severidad | Comentario |
|---|---:|---|
| accepted outside <= 5 | media | La aceptación permite hasta 5 puntos fuera por región. En diseños complejos puede ser visible. |
| `_segmentInsideTolerant` puede aceptar segmentos cerca del borde | media | Puede permitir conectores visibles en zonas estrechas. |
| unión de intervalos pequeños | media | Puede unir islas o huecos pequeños si el gap se considera tolerable. |
| nearest-neighbor de islas | media | Ordena por centroide, no necesariamente por coste visual/travel real. |
| post-process split valida puntos intermedios, pero no todo el segmento final tras proyección | media | Reduce riesgo pero no garantiza cero cruces visuales. |

### 5.3 Métricas solicitadas

| Métrica | Valor |
|---|---:|
| fillStitchesOutsideRegion | RUNTIME_REQUIRED |
| fillSegmentsCrossOutsideRegion | RUNTIME_REQUIRED |
| fillSegmentsCrossOtherRegion | RUNTIME_REQUIRED |
| maxFillSegmentLength | RUNTIME_REQUIRED |
| region con peor clipping | RUNTIME_REQUIRED |

### 5.4 Conclusión clipping

El clipping parece diseñado para ser seguro, pero no es una prueba global de que todos los segmentos stitch de relleno permanezcan dentro del polígono y no crucen huecos. Si los errores visibles son principalmente rellenos que salen del área, la ruta recomendada sería `FILL_CLIPPING_REPAIR_V1`.

---

## 6. Orden de cosido

### 6.1 Flujo observado

1. `buildStitchObjects` crea objetos desde regiones.
2. Añade objetos de contorno.
3. Ordena por prioridad: fills primero, detalles/contornos después.
4. `flattenToCommands` aplica `optimizeObjectOrder(objects)` antes de coser.
5. `buildFinalCommands` puede aplicar travel optimization, sanitize, trim optimization y contour guard.

### 6.2 Riesgos de orden

| Riesgo | Severidad | Comentario |
|---|---:|---|
| nearest-neighbor puede priorizar distancia sobre semántica visual | media | Puede coser regiones en orden lógico de máquina pero visualmente problemático. |
| color grouping puede desplazar contornos o detalles | media | Requiere guards para no mezclar visualmente. |
| optimizador de travel puede convertir viajes cortos a stitches | alta | Si el tramo cruza espacio vacío, se vuelve conector visible. |
| trims se optimizan después | media | Remover trims entre bloques cercanos puede ser correcto técnicamente pero visible si hay cruce. |

### 6.3 Métricas solicitadas

| Métrica | Valor |
|---|---:|
| jumps/travels entre regiones | RUNTIME_REQUIRED |
| color blocks | RUNTIME_REQUIRED |
| trim antes/después | RUNTIME_REQUIRED |
| cambios de color | RUNTIME_REQUIRED |
| distancia total sin coser | RUNTIME_REQUIRED |
| regiones cosidas en orden ilógico | RUNTIME_REQUIRED |

---

## 7. Contornos

### 7.1 Flujo observado

- `buildStitchObjects` añade contour objects mediante `buildContourObjects`.
- `generateContourStitches` genera puntadas reales de contorno.
- `applyProfessionalPipeline` puede convertir / refinar contornos cuando professionalMode está activo.
- `buildFinalCommands` aplica `validateFinalContourCommandsAgainstDarkMask` para cortar puentes artificiales largos sin soporte de darkStroke.

### 7.2 Riesgos de contorno

| Riesgo | Severidad | Comentario |
|---|---:|---|
| running visible demasiado largo | alta | Produce diagonales negras internas. |
| contorno mezclado con travel | alta | Si un travel queda como stitch negro, el usuario ve una línea artificial. |
| darkStroke guard corta >2.5mm sin soporte, pero puede dejar micro-diagonales acumuladas | media | Muchos segmentos cortos pueden seguir pareciendo línea. |
| orden contour/fill incorrecto | media | Puede crear apariencia de contorno atravesando relleno. |
| conversión a satin/contour puede introducir cierres | media | Si cierre atraviesa interior, aparece diagonal. |

### 7.3 Conclusión contornos

Si las líneas visibles son negras y cruzan el diseño, la causa más probable es una mezcla de `CONTOUR_GENERATION` y `TRAVEL_CONVERSION`: segmentos de contorno o travel que sobreviven como `stitch` visible.

---

## 8. Comparación visual

| Comparación | Estado |
|---|---:|
| regiones detectadas vs finalEmbroideryCommands | RUNTIME_REQUIRED |
| finalEmbroideryCommands vs exportCommands antes de repair | normalmente iguales / requieren runtime |
| finalEmbroideryCommands vs exportCommands después de repair | pueden diferir |
| simulador representa comandos finales | true |
| Final Look representa comandos finales | true |
| Export puede usar repairedCommands | true |

### Interpretación

Como Simular y Final Look ya consumen `finalEmbroideryCommands`, si ambos muestran líneas defectuosas, el problema está antes de la codificación DST/DSB y antes de V5.1 export repair: está en la generación/optimización de comandos finales.

---

## 9. Diagnóstico principal

| Campo | Valor |
|---|---|
| detectionGoodButStitchingBad | true |
| issueStage | MIXED |
| primaryCause | Conectores visibles quedan codificados como `stitch` dentro de `finalEmbroideryCommands`, especialmente en transiciones de relleno/contorno/travel que deberían ser `jump + trim` o segmentos recortados. |
| secondaryCauses | Clipping de relleno no probado globalmente por segmento; travel optimizer puede convertir viajes cortos a puntadas visibles; contornos negros pueden generar diagonales internas; orden de regiones puede crear viajes innecesarios. |

---

## 10. Campos finales obligatorios

| Campo | Valor |
|---|---:|
| totalCommands | RUNTIME_REQUIRED |
| totalStitches | RUNTIME_REQUIRED |
| totalJumps | RUNTIME_REQUIRED |
| totalTrims | RUNTIME_REQUIRED |
| visibleLongStitchCount | RUNTIME_REQUIRED |
| stitchedTravelCount | RUNTIME_REQUIRED |
| fillOutsideRegionCount | RUNTIME_REQUIRED |
| crossRegionStitchCount | RUNTIME_REQUIRED |
| maxVisibleStitchMm | RUNTIME_REQUIRED |
| worstOffenderRegionIds | RUNTIME_REQUIRED |
| worstOffenderCommandIndexes | RUNTIME_REQUIRED |
| issueStage | MIXED |
| primaryCause | stitched travel / contour/fill transition leakage in finalEmbroideryCommands |
| recommendedFix | MIXED_PIPELINE_REPAIR_V1 |

---

## 11. Recomendación de arreglo

Ruta recomendada:

## E) MIXED_PIPELINE_REPAIR_V1

Motivo:

El problema descrito no apunta a una sola causa aislada. Hay evidencia estructural de múltiples fuentes posibles:

- conectores visibles cosidos → `STITCHED_TRAVEL_TO_JUMP_REPAIR_V1`
- rellenos fuera o cruzando huecos → `FILL_CLIPPING_REPAIR_V1`
- orden de regiones/travels largos → `REGION_ORDER_OPTIMIZER_V1`
- diagonales negras internas → `CONTOUR_CLEANUP_V1`

Implementar una sola ruta parcial puede ocultar el síntoma pero no garantizar que Simular, Final Look y Export sigan coincidiendo.

### Alcance recomendado para MIXED_PIPELINE_REPAIR_V1

No implementado en esta auditoría. Solo recomendado.

Debe ser transaccional y posterior a `finalEmbroideryCommands`, antes de exportación efectiva, con estas fases de diagnóstico:

1. clasificar cada segmento `stitch` por región, color, source y layerType;
2. detectar `stitchedTravel` por distancia, cruce de vacío y cambio de región;
3. convertir solo offenders seguros a `jump + trim`;
4. validar rellenos contra polígono por punto y por segmento;
5. validar contornos negros contra darkStroke y contra cruces internos;
6. verificar que Simular / Final Look / Export usen la misma secuencia después de la reparación aceptada;
7. revertir si baja calidad visual o se rompe CE01.

---

## 12. No cambios realizados

Confirmación:

| Área | Modificada |
|---|---:|
| motor de digitalización | false |
| buildFinalCommands | false |
| applyProfessionalPipeline | false |
| professionalDigitizingMode | false |
| ExportModal | false |
| getEffectiveExportCommands | false |
| handleExport | false |
| V5.1 export repair | false |
| Travel Polish | false |
| Safe Tie V2 | false |
| SATIN / Trim Guard / Splitter / Underlay | false |
| DST encoder | false |
| DSB encoder | false |
| CE01 validator | false |
| Reference Learning logic | false |
| UI | false |

---

## 13. Veredicto

EMBROIDERY_COMMAND_QUALITY_FORENSICS_V1 concluye que la detección visual puede estar correcta, pero la secuencia `finalEmbroideryCommands` contiene o puede contener segmentos visibles que semánticamente deberían ser travel/jump o deberían estar recortados al polígono. La ruta recomendada es `MIXED_PIPELINE_REPAIR_V1`, no una reparación aislada desde Simular.