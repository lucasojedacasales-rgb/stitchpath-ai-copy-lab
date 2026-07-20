# REFERENCE_LEARNING_RUNTIME_APPLICATION_TRUTH_AUDIT_V1

> Fecha: 2026-07-05
> Proyecto auditado: Nuevo diseño (`6a4a7e854bc251c661fa8b6f`)
> Alcance: solo auditoría + conexión mínima segura de persistencia de config aprendida. No se reprocesaron `.stp`, no se tocaron encoders, ExportModal, V5.1, segmentación, orden global ni reducción de puntadas.

## Resumen ejecutivo

learnedPresetExists=false
professionalModeEnabled=false
configPatchApplied=false
learnedValuesReachProfessionalPipeline=false
learnedValuesConsumedByPlanner=false
learnedValuesChangeFinalCommands=false
finalEmbroideryCommandsSource=buildFinalCommands -> ce01_safe_pipeline
simulationCommandSource=finalEmbroideryCommands
finalLookCommandSource=finalEmbroideryCommands
exportCommandSource=getEffectiveExportCommands(finalEmbroideryCommands/effectiveExport)
currentRuntimeTotalCommands=19381
currentRuntimeTotalStitches=17238
currentRuntimeTotalJumps=1523
currentRuntimeTotalTrims=596
currentRuntimeTotalColors=10
currentRuntimeMaxVisibleStitchMm=5.214
currentRuntimeMacroCriticalLongStitches=0
currentRuntimeVisibleLongStitchCount=0
currentRuntimeSevereVisibleLongStitchCount=0
currentRuntimeStitchedTravelCount=14506
currentRuntimeFillOutsideRegionCount=42
exportBlocked=false
exportBlockingReason=none
reportMetricsMismatch=true
orphanLearnedKeys=["learnedFillDensityMm","learnedFillAngleDeg","learnedSatinColumnSpacingMm","learnedSatinWidthMm","learnedPullCompensationMm","learnedMaxVisibleStitchMm","learnedConvertTravelAboveMmToJump","learnedTrimBeforeTravelMm","learnedUnderlayEnabled","learnedDetailsLast","learnedUseSatinForOuterContours"]
recommendedNextFix=REFERENCE_LEARNING_CONFIG_PERSISTENCE_FIX_V1 applied; run Validar preset once again so learned* keys persist on Project.config; if finalCommandsChanged remains false then planner ignores professional constraints and use PROFESSIONAL_STITCH_PLANNER_REPAIR_V1.
safeToProceed=true

## 1. Ruta del preset aprendido

| Paso | recibe learnedFillDensityMm | recibe learnedFillAngleDeg | recibe learnedMaxVisibleStitchMm | recibe learnedConvertTravelAboveMmToJump | recibe learnedTrimBeforeTravelMm | recibe learnedUnderlayEnabled | usa realmente esos valores | modifica comandos finales |
|---|---|---|---|---|---|---|---|---|
| ReferenceLearningEngine / learned corpus | sí, como preset.fillRowSpacingMm | sí, como preset.fillAngleDeg | sí, como preset.maxVisibleStitchMm | sí, como preset.convertTravelAboveMmToJump | sí, como preset.trimBeforeTravelMm | sí, como preset.underlayEnabled | sí para construir preset | no, solo produce preset/configPatch |
| learnedPreset -> presetToConfigPatch | sí | sí | sí | sí | sí | sí | sí, mapea a config learned* | no, solo patch |
| config patch en Editor | sí si se aplica | sí si se aplica | sí si se aplica | sí si se aplica | sí si se aplica | sí si se aplica | antes: solo estado React; ahora: estado + persistencia Project.config | indirecto: dispara rebuild de finalEmbroideryCommands |
| Project.config runtime actual auditado | no | no | no | no | no | no | no | no |
| professionalMode config runtime actual | false | false | false | false | false | false | no | no |
| applyProfessionalPipeline | sí si config.professionalMode=true y learned* existe | sí si config.professionalMode=true y learned* existe | sí si config.professionalMode=true y learned* existe | sí si config.professionalMode=true y learned* existe | sí si config.professionalMode=true y learned* existe | sí si config.professionalMode=true y learned* existe | código preparado; runtime actual no entra por professionalMode=false | no en runtime actual |
| stitch planner / buildStitchObjects | sí solo para density vía genRegions cuando professionalMode=true | sí solo para angle vía genRegions cuando professionalMode=true | no directo | no directo | no directo | no directo | parcialmente, solo density/angle si config existe | no en runtime actual |
| buildFinalCommands / finalEmbroideryCommands | recibe config completa | recibe config completa | recibe config completa | recibe config completa | recibe config completa | recibe config completa | no en runtime actual por ausencia de keys | no por aprendizaje; sí por pipeline CE01/professional repair |
| Simular | no patch directo; recibe finalEmbroideryCommands | no patch directo | no patch directo | no patch directo | no patch directo | no patch directo | usa comandos ya generados | no, lectura |
| Final Look | no patch directo; recibe finalEmbroideryCommands | no patch directo | no patch directo | no patch directo | no patch directo | no patch directo | usa comandos ya generados | no, lectura |
| Export | no patch directo; recibe effectiveExport.commands | no patch directo | no patch directo | no patch directo | no patch directo | no patch directo | usa misma secuencia efectiva | no, descarga/encode |

Conclusión de ruta: el código sí tiene rutas de consumo para varias keys aprendidas, pero el proyecto runtime auditado no contiene `learned*` ni `professionalMode=true`. Por tanto, en este estado el aprendizaje no llega al pipeline real.

## 2. Valores huérfanos / consumo real

| Key | definedWhere | passedWhere | consumedWhere | effectOnFinalCommands |
|---|---|---|---|---|
| learnedFillDensityMm | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | Editor `finalEmbroideryCommands` mapea a `region.density`; `applyProfessionalPipeline` lo copia a `professionalParams.fillDensityMm` | false en runtime actual; true si Project.config contiene la key |
| learnedFillAngleDeg | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | Editor alterna `region.angle` por región fill; `applyProfessionalPipeline` lo copia a `professionalParams.fillAngleDeg` | false en runtime actual; true si Project.config contiene la key |
| learnedSatinColumnSpacingMm | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | `applyProfessionalPipeline` lo copia a `professionalParams.satinDensityMm` | false/huérfano práctico: no se observa uso directo posterior que regenere columnas satin existentes |
| learnedSatinWidthMm | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | `convertRunningOuterContoursToSatinGuardedV1` usa ancho satin | false en runtime actual; true solo si satin converter encuentra candidatos y acepta fase |
| learnedPullCompensationMm | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | `applyProfessionalPipeline` lo copia a `professionalParams.pullCompMm` | false/huérfano práctico: no se observa uso directo posterior que desplace geometría final |
| learnedMaxVisibleStitchMm | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | `applyProfessionalPipeline`, visible repair, splitter V1_2, quality gate | false en runtime actual; true si la key existe y splitter/repair acepta |
| learnedConvertTravelAboveMmToJump | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | `applyProfessionalPipeline` lo mapea a `professionalParams.longConnectorMm` para detector de diagonales | false en runtime actual; true si professionalMode está activo |
| learnedTrimBeforeTravelMm | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | `insertTrimBeforeLongJumpsGuarded` | false en runtime actual; true si trim guard acepta |
| learnedUnderlayEnabled | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | `generateCenterlineUnderlayGuardedV1` | false en runtime actual; true solo si underlay acepta sin regresión |
| learnedDetailsLast | `presetToConfigPatch`, `buildConfigDiff` | Editor config / Project.config | `reorderProfessionalLayers` | false en runtime actual; true si professionalMode activo |
| learnedUseSatinForOuterContours | `presetToConfigPatch`, `buildConfigDiff`, cartoon override | Editor config / Project.config | `convertOuterSatinToRunning` cuando false; `convertRunningOuterContoursToSatinGuardedV1` cuando true | false en runtime actual; true solo si converter acepta |

Huérfanos prácticos detectados: `learnedSatinColumnSpacingMm` y `learnedPullCompensationMm` se copian a `professionalParams`, pero no tienen efecto claro y directo sobre la geometría final actual. El resto tiene rutas de consumo, pero no se activan si el patch no está en `Project.config`.

## 3. Verificación de comandos reales

La auditoría runtime se ejecutó con `buildFinalCommands(regions, config, machineSettings, 'DST')`, no con métricas del informe de aprendizaje.

| Métrica | Valor runtime real |
|---|---:|
| totalCommands | 19381 |
| totalStitches | 17238 |
| totalJumps | 1523 |
| totalTrims | 596 |
| totalColors | 10 |
| maxVisibleStitchMm | 5.214 |
| macroCriticalLongStitches | 0 |
| visibleLongStitchCount | 0 |
| severeVisibleLongStitchCount | 0 |
| stitchedTravelCount | 14506 |
| fillOutsideRegionCount | 42 |
| exportBlocked | false |
| blockingReason | none |

No se aceptan métricas del diseño actual con `stitchCount=0`: existen comandos reales y el conteo real es 17,238 puntadas.

## 4. Comparación informe vs realidad

El `REFERENCE_LEARNING_APPLIED_REPORT` puede mostrar:

- `maxVisibleStitchMm actual = 5.21mm`
- `stitchCount=0`
- `jumpCount=0`
- `trimCount=0`

La realidad runtime auditada muestra:

- `stitchCount=17238`
- `jumpCount=1523`
- `trimCount=596`
- `maxVisibleStitchMm=5.214`
- `macroCriticalLongStitches=0` en el estado actual posterior al repair transaccional

mismatchExplanation=El informe de aplicación se genera desde `applyLearnedProfileToProfessionalMode` usando `beforeComparison`, que recibe `currentCommands` desde el caller. Hay rutas donde ese caller pasa `[]` o comandos aún diferidos por Lightweight Boot, por eso el informe puede documentar `stitchCount=0` aunque el Editor ya tenga `finalEmbroideryCommands` reales. Además, ese informe documenta `configPatch`, pero no prueba que `Project.config` final lo conserve ni que `buildFinalCommands` se haya regenerado con ese patch persistido. En el proyecto auditado, `Project.config` no contiene `learned*`, por lo que el preset no está activo en runtime.

Causas confirmadas:

- informe lee datos vacíos o diferidos: true
- informe corre antes de generar comandos finales reales: true en la ruta de applied report
- informe usa preview/objects/comparison en vez de `finalEmbroideryCommands`: true para el applied report
- Professional Mode se aplica a config patch pero no estaba persistido en Project.config auditado: true
- quality gate no demuestra estado post-persistencia: true
- Simular/Final/Export usan otra fuente: false; en Editor usan `finalEmbroideryCommands` / `effectiveExport` de la misma secuencia

## 5. Corrección mínima aplicada

Se aplicó una conexión segura mínima: cuando el panel de validación/aprendizaje aplica un `configPatch`, ahora actualiza el estado del Editor y persiste el `Project.config` con ese patch. Esto evita que el preset aprendido exista solo en memoria o solo en informe descargado.

No se cambiaron algoritmos de calidad, encoders, ExportModal, V5.1, segmentación, reducción de puntadas ni orden global.

Archivo tocado por esta conexión: `src/pages/Editor.jsx`.

## 6. Diagnóstico si el preset vuelve a llegar pero no cambia comandos

Si tras pulsar de nuevo `Validar preset` el proyecto queda con `professionalMode=true` y `learned*` en `Project.config`, pero `finalCommandsChanged=false`, entonces el diagnóstico debe ser:

learnedValuesReachPlanner=true
learnedValuesConsumed=true
finalCommandsChanged=false
rootCause=planner ignores professional constraints
recommendedNextFix=PROFESSIONAL_STITCH_PLANNER_REPAIR_V1

En el estado runtime actual, ese diagnóstico todavía no aplica porque las keys aprendidas no están presentes en `Project.config`.

## 7. Respuestas al criterio de éxito

A) El aprendizaje solo parchea config pero no afecta comandos.

- Estado actual auditado: sí. El proyecto no conserva `learned*`, por lo que no afecta `finalEmbroideryCommands`.
- Se aplicó persistencia mínima para futuras aplicaciones del preset.

B) El aprendizaje afecta comandos pero el planner sigue generando puntadas malas.

- No confirmado en este runtime, porque el preset no está activo.
- Si tras persistir learned* los comandos no cambian o siguen malos, usar `PROFESSIONAL_STITCH_PLANNER_REPAIR_V1`.

C) El informe está leyendo datos equivocados.

- Sí. `REFERENCE_LEARNING_APPLIED_REPORT` puede usar `currentCommands=[]` o comandos diferidos, mientras el runtime real tiene 17,238 puntadas.

D) Simular/Final/Export no usan la misma fuente.

- No. Editor pasa `finalEmbroideryCommands` a Simular y Final Look, y Export usa `effectiveExport` priorizando esa misma fuente.

E) El bloqueo viene de otra validación posterior.

- En el runtime actual no hay bloqueo (`exportBlocked=false`).
- La evidencia histórica de `INVALID` y puntada crítica de ~28.5mm era compatible con una fase anterior donde el planner generaba una puntada visible macro crítica. Ese problema queda fuera del aprendizaje si el preset no estaba activo/persistido.

## 8. Veredicto

reportMetricsMismatch=true
safeToProceed=true

Veredicto: el problema principal auditado no es falta de corpus ni falta de preset; es que el applied report no prueba aplicación runtime y el proyecto actual no conserva el patch aprendido en `Project.config`. La ruta Simular/Final/Export sí está sincronizada con `finalEmbroideryCommands`. La siguiente validación real debe ejecutarse después de aplicar/persistir el preset; si entonces los comandos no cambian, el motor de planificación está ignorando restricciones profesionales y debe usarse `PROFESSIONAL_STITCH_PLANNER_REPAIR_V1`.