# CHECKPOINT_PROFESSIONAL_STITCH_PLANNER_REPAIR_V1

phase=PROFESSIONAL_STITCH_PLANNER_REPAIR_V1
buildPasses=true
encodersUnchanged=true
exportModalUnchanged=true
universalValidationUnchanged=true
referenceLearningUnchanged=true
stpFilesProcessed=false
globalRegionReorder=false
globalStitchReduction=false
segmentationVisualBaseUnchanged=true
colorDetectionUnchanged=true
imageLoadingUnchanged=true

Checkpoint condition: the runtime phase is accepted only when export is no longer blocked by excessive visible stitch and no critical stitch >12.1mm remains. If that condition fails at runtime, the repair pass reverts automatically and logs revertReason.