# REVERT_REGION_SAFE_TATAMI_FILL_REBUILDER_REPORT_V1

revertApplied=true
filesReverted=["src/lib/ce01SafeFillGenerator.js","src/lib/exportPipeline.js"]
filesRemoved=["src/lib/regionSafeTatamiFillRebuilder.js","src/REGION_SAFE_TATAMI_FILL_REBUILDER_REPORT_V1.md","src/TATAMI_FILL_RUNTIME_FORENSICS_AFTER_REBUILDER_V1.md","src/CHECKPOINT_REGION_SAFE_TATAMI_FILL_REBUILDER_V1_STABLE.md"]
checkpointUsed=manual_revert_to_pre_REGION_SAFE_TATAMI_FILL_REBUILDER_V1
visualRegressionRemoved=true
fillGeneratorRestored=true
referenceLearningPreserved=true
professionalModePreserved=true
encodersUnchanged=true
exportLogicUnchanged=true
validationUniversalUnchanged=true
exportModalUnchanged=true
simularUnchanged=true
finalLookUnchanged=true
v51Unchanged=true
stpFilesUntouched=true

## Revert scope

Solo se revirtió el cambio REGION_SAFE_TATAMI_FILL_REBUILDER_V1:

- Eliminado el nuevo generador global de rebuild de tatami/fill.
- Eliminado el override que reemplazaba `generateCE01SafeFillCommands`.
- Restaurado el generador CE01-safe fill anterior dentro de `src/lib/ce01SafeFillGenerator.js`.
- Restaurada la llamada anterior desde `flattenToCommands` sin pasar `config` ni `learnedMaxVisibleStitchMm` al generador fill.
- Eliminados los informes/checkpoint del Rebuilder que ya no deben considerarse estables.

No se tocó Reference Learning, `project.config learned*`, Professional Mode, validación universal, encoders, ExportModal, V5.1, Simular, Final Look, SATIN, Trim Guard ni archivos `.stp`.

## Metrics after revert

maxVisibleStitchMmAfterRevert=5.214
visibleDiagonalStitchesAfterRevert=164
unsupportedLongStitchesAfterRevert=0
severeVisibleLongStitchCountAfterRevert=0
macroCriticalLongStitchesAfterRevert=0
fillOutsideRegionCountAfterRevert=42
exportBlockedAfterRevert=false
finalLookExportMismatchAfterRevert=false
universalStatusAfterRevert=VALID
formatStatusDSTAfterRevert=VALID
formatStatusDSBAfterRevert=VALID

| metric | after revert |
|---|---:|
| totalCommands | 19381 |
| totalStitches | 17238 |
| totalJumps | 1523 |
| totalTrims | 596 |
| totalColors | 10 |
| maxVisibleStitchMm | 5.214 |
| maxFillSegmentMm | 4.000 |
| visibleDiagonalStitches | 164 |
| severeVisibleLongStitchCount | 0 |
| unsupportedLongStitches | 0 |
| fillOutsideRegionCount | 42 |
| exportBlocked | false |
| finalLookExportMismatch | false |
| universalStatus | VALID |
| formatStatusDST | VALID |
| formatStatusDSB | VALID |

## Success criteria

- diseño vuelve al comportamiento de relleno anterior al Rebuilder=true
- no hay rellenos picados nuevos del Rebuilder=true
- no se aplican nuevos cortes verticales masivos del Rebuilder=true
- finalLookExportMismatch=false
- exportBlocked=false
- Simular y Final siguen usando finalEmbroideryCommands=true
- Reference Learning sigue persistido=true
- Professional Mode sigue disponible=true

## recommendedNextFix

No intentar otro rebuild global de fill. Si se retoma la mejora de puntadas largas, hacer un fix local/transaccional sobre casos puntuales y con validación visual, nunca reemplazando globalmente todos los rellenos.