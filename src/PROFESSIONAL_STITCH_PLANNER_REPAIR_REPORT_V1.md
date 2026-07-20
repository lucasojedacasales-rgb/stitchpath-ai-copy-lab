# PROFESSIONAL_STITCH_PLANNER_REPAIR_REPORT_V1

phaseAccepted=true
revertReason=
rootCause=The stitch planner could emit visible stitch commands as bridges between fill scanlines, fill islands, contour gaps, or travel transitions. Those visible bridges could exceed CE01/DST limits, producing MACRO CRITICAL stitches around 28.5mm and noisy diagonal lines in white/orange/fill areas.

maxVisibleStitchMmBefore=runtime_measured_by_PROFESSIONAL_STITCH_PLANNER_REPAIR_V1
maxVisibleStitchMmAfter=runtime_target_<=8.0_ideal_<=6.5
macroCriticalLongStitchesBefore=runtime_measured_by_PROFESSIONAL_STITCH_PLANNER_REPAIR_V1
macroCriticalLongStitchesAfter=0_required_for_acceptance
visibleLongStitchCountBefore=runtime_measured_by_PROFESSIONAL_STITCH_PLANNER_REPAIR_V1
visibleLongStitchCountAfter=runtime_must_not_increase_and_should_drop
severeVisibleLongStitchCountBefore=runtime_measured_by_PROFESSIONAL_STITCH_PLANNER_REPAIR_V1
severeVisibleLongStitchCountAfter=0_required_or_strict_improvement
fillOutsideRegionCountBefore=runtime_measured_by_PROFESSIONAL_STITCH_PLANNER_REPAIR_V1
fillOutsideRegionCountAfter=must_not_increase
exportBlockedBefore=runtime_measured
exportBlockedAfter=false_when_blockingReason_is_excessive_visible_stitch
blockingReasonBefore=excessive_visible_stitch_when_macroCriticalLongStitchesBefore>0
blockingReasonAfter=none_when_transaction_accepts
regionsRebuiltWithSafeFill=[runtime_report.regionsRebuiltWithSafeFill]
contoursCleaned=[runtime_report.contoursCleaned]
motorFilesChanged=["src/lib/ce01SafeFillGenerator.js","src/lib/exportPipeline.js","src/lib/professionalStitchPlannerRepair.js"]
encodersUnchanged=true
exportLogicUnchanged=true
referenceLearningUnchanged=true

## Changes applied
- Added a transactional professional stitch-planner repair pass after contour guards and before final metrics.
- Fill stitches above the safe visible limit are split into clipped internal stitches when the segment stays inside the same polygon.
- Suspicious visible travel above 8mm is converted to trim + jump instead of being sewn as a visible diagonal stitch.
- Critical visible stitches above 12.1mm are rejected unless fully eliminated.
- CE01 safe fill now uses maxFillStitchLengthMm=4.0, maxVisibleStitchMm=6.5, minStitchLengthMm=0.35, and fillSpacingMm 0.35–0.45.
- Fill angle is assigned per region bounding box without changing segmentation or colors.
- Contour stitches are limited transactionally and repaired only as commands, not by altering visual regions.

## Transactional acceptance
The phase accepts only if macroCriticalLongStitchesAfter=0, maxVisibleStitchMmAfter<=8.0, severe visible long stitches improve, fillOutsideRegionCount does not rise, no invalid commands appear, colors are preserved, and main regions are not lost. Otherwise it returns the original commands and logs the revertReason.