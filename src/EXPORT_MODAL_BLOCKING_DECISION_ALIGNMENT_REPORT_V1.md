# EXPORT_MODAL_BLOCKING_DECISION_ALIGNMENT_REPORT_V1

Objetivo: alinear la decisión de ExportModal con la validación universal/formato real, sin tocar comandos, motor visual, encoders, V5.1, Simular ni Final Look.

## Auditoría del bloqueo

exportBlockedBefore=true
exportBlockedAfter=false
exportBlockedSourceBefore=ExportModal pipelineResult.blockingErrors / AdaptiveOptimizationEngine score gate / CE01 production DST-only gate
exportBlockedSourceAfter=REAL_EXPORT_GATE
exportBlockedReasonBefore=warnings reparables tratados como bloqueo visual o adaptive readyToExport=false por score bajo
exportBlockedReasonAfter=none
blockingModule=none
blockingCheck=HARD_EXPORT_GATE / REAL_EXPORT_GATE
readyToExport=true
validationPassed=true

## Validación real

universalStatus=VALID
formatStatusDST=VALID
formatStatusDSB=VALID
finalLookExportMismatch=false
exportUsesSameCommandSequence=true

## Adaptive Optimizer

adaptiveReadyToExportBefore=false
adaptiveReadyToExportAfter=true
adaptiveStatusAfter=WARNING
adaptiveScore=0
adaptiveBlockReasonsBefore=["Stability score < 98", "warnings reparables / score bajo"]
adaptiveBlockReasonsAfter=[]
adaptiveWarningsAfter=["VIBRATION", "warnings no bloqueantes"]

## Errores reales bloqueantes

blockingErrorsReal=[]

Criterios que siguen bloqueando:
- commands vacío
- coordenadas NaN/undefined
- END duplicado o fuera de posición
- formato DST/DSB INVALID
- encoder failure
- coordenadas imposibles/fuera de rango codificable
- secuencia corrupta
- colorChange inválido real
- comando imposible de codificar

## Warnings no bloqueantes

warningsNonBlocking=[
  "shortStitches",
  "duplicateStitches",
  "excessiveTrims",
  "efficiency low",
  "score low",
  "CE01 warnings",
  "density high",
  "many stitches",
  "many jumps",
  "visual warnings",
  "VIBRATION"
]

shortStitchesBlockingBefore=true
duplicateStitchesBlockingBefore=true
excessiveTrimsBlockingBefore=true
scoreBlockingBefore=true
warningsNowNonBlocking=true

## ExportModal

exportButtonEnabled=true
exportButtonLabel="Exportar con advertencias"
dstExportAllowed=true
dsbExportAllowed=true
exportBlockedTextShownWhenWarningsOnly=false
repairLoopAvoided=true
repairButtonDesprioritizedWhenExportAllowed=true

## Alcance protegido

encodersUnchanged=true
motorUnchanged=true
visualPipelineUnchanged=true
commandsTouched=false
visualRegenerated=false
simularUnchanged=true
finalLookUnchanged=true
referenceLearningUnchanged=true
ce01SafeFillGeneratorUnchanged=true
professionalDigitizingModeUnchangedInThisStep=true
v51Unchanged=true

## Criterio de aceptación

acceptancePassed=true
noRealFormatErrors=true
DSTStillValid=true
DSBStillValid=true
ExportModalAllowsExportWithWarnings=true
noCommandRepairApplied=true
noVisualQualityChange=true
finalLookExportMismatch=false

## Decisión final

ExportModal ya no bloquea por score, shortStitches, duplicateStitches, excessiveTrims ni warnings CE01. Si Universal y Formato son válidos y el hard gate no detecta corrupción real, la exportación queda habilitada como "Exportar con advertencias".