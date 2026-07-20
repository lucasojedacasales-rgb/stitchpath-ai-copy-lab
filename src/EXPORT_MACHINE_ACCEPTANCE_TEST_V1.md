# EXPORT_MACHINE_ACCEPTANCE_TEST_V1

Objetivo: congelar el estado estable validado y preparar prueba real de exportación en máquina antes de seguir con mejoras visuales.

## Checkpoint

checkpointCreated=true
checkpointName=CHECKPOINT_PIPELINE_STABLE_EXPORT_READY_V1

## Estado de exportación

exportAllowed=true
exportBlocked=false
exportBlockingReason=none
universalStatus=VALID
formatStatusDST=VALID
formatStatusDSB=VALID

## Archivos generados

commandSource=finalEmbroideryCommands
dstGenerated=true
dsbGenerated=true
recommendedFirstFormat=DSB
recommendedSecondFormat=DST

## Sincronización

finalLookExportMismatch=false
simulationMatchesFinalCommands=true
finalLookMatchesFinalCommands=true
exportUsesSameCommandSequence=true

## Métricas de aceptación

totalCommands=8288
totalStitches=7780
totalJumps=380
totalTrims=116
totalColors=7
maxVisibleStitchMm=5.316
visibleDiagonalStitches=86
unsupportedLongStitches=0
fillOutsideRegionCount=38

## Estado visual validado

visualWorse=false
visualSame=true
fillStillPicado=false
silhouettePreserved=true
eyesMouthPreserved=true
orangeFeetPreserved=true
blackOutlineTooDirty=false

## Instrucciones visibles para el usuario

Prueba recomendada:
1. Exporta primero DSB.
2. Si DSB no abre, prueba DST.
3. Haz foto de la pantalla de la máquina.
4. Comprueba si la máquina muestra tamaño, colores y puntadas.
5. No bordar todavía si visualmente ves líneas peligrosas; primero confirmar que lo acepta.

## Decisión

machineTestReady=true
recommendedFirstFormat=DSB
recommendedSecondFormat=DST
safeToProceedToLocalLongStitchRepair=true

## Restricciones cumplidas

localLongStitchRepairApplied=false
qualityImprovementApplied=false
commandsTouched=false
fillsRebuilt=false
stpProcessed=false
referenceLearningChanged=false
encodersChanged=false
exportModalChanged=false