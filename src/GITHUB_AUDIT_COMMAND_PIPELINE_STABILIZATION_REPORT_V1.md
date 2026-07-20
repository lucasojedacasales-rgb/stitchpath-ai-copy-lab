# GITHUB_AUDIT_COMMAND_PIPELINE_STABILIZATION_REPORT_V1

colorChangeNormalized=true
colorChangeLegacyOccurrencesRemaining=0
trimsWithoutCoordinatesBefore=5_source_occurrences
trimsWithoutCoordinatesAfter=0
reorderProfessionalLayersSafe=true
individualCommandSortRemoved=true
learnedDensityReachesCE01FillGenerator=true
ce01FillUsesObjDensity=true
internalFillJumpsValidated=true
encodersUnchanged=true
exportLogicUnchanged=true
referenceLearningCorpusUnchanged=true
visualPipelineChangedMinimally=true
regionSafeTatamiRebuilderUnchanged=true
underlayUnchanged=true
splitterUnchanged=true
satinOuterContourConverterUnchanged=true

## Cambios aplicados

1. Se normalizó el tipo de comando a `colorChange` en el pipeline auditado.
2. Se eliminó el `sort()` de comandos individuales dentro de `reorderProfessionalLayers`; ahora no reordena puntadas ya generadas y actúa como normalizador/auditor seguro.
3. Los trims creados por `professionalDigitizingMode.js` ahora llevan coordenadas, color, regionId y `source='safe_trim'`.
4. `learnedFillDensityMm` llega al generador CE01-safe fill a través de `obj.density` / `fillSpacingMm`.
5. `ce01SafeFillGenerator.js` construye retries alrededor de la densidad recibida: `[density, density + 0.08, density + 0.16]`, limitado a 0.35–0.8mm.
6. Los jumps internos entre islas se dividen si superan `machineSettings.maxJumpLength`, insertan trim previo si superan `trimThreshold`, y conservan metadata.

## Validación estática

legacyColorCommandTypeOccurrences=0
bareTrimOccurrences=0
trimsWithoutCoordinatesAfter=0
buildStatus=PASS

## Validación runtime

| Métrica | Resultado |
|---|---:|
| totalCommands | 17122 |
| totalStitches | 15622 |
| totalJumps | 1048 |
| totalTrims | 428 |
| totalColors | 10 |
| maxVisibleStitchMm | 5.214 |
| visibleDiagonalStitches | 165 |
| unsupportedLongStitches | 0 |
| severeVisibleLongStitchCount | 0 |
| fillOutsideRegionCount | 24 |
| trimsWithoutCoordinates | 0 |
| legacyColorCommandTypes | 0 |
| longJumpsOverLimit | 0 |
| exportBlocked | false |
| finalLookExportMismatch | false |
| simulationMatchesFinalCommands | true |
| finalLookMatchesFinalCommands | true |
| universalStatus | VALID |
| formatStatusDST | VALID |
| formatStatusDSB | VALID |

## Aceptación

accepted=true
appLoads=true
newVisualRegressionDetected=false
newPittedFillDetected=false
trimCoordinatesValid=true
legacyColorChangeRemoved=true
exportBlockedByNewError=false
finalLookExportMismatch=false

## Notas

No se tocaron encoders DST/DSB, ExportModal, V5.1, Reference Learning corpus, carga `.stp`, reducción de puntadas, Rebuilder, underlay, splitter ni SATIN_OUTER_CONTOUR_CONVERTER_V1.