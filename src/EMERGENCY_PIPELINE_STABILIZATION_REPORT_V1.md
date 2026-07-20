# EMERGENCY_PIPELINE_STABILIZATION_REPORT_V1

appStableBefore=false
appStableAfter=true
editorLoads=true
exportBlockedBefore=true
exportBlockedAfter=false
realExportBlockingReasonBefore=validation/adaptive/reference/UI gates could block on non-hard conditions
realExportBlockingReasonAfter=only hard command/file errors: empty commands, non-finite coordinates, impossible coordinates, missing/duplicate/non-final END, unsupported format, no stitch data, encoder failure
referenceLearningWasAutoRunning=true
stpFilesAutoProcessedOnBoot=false
stpFilesQuarantined=true
vectorizationRunCount=runtime_logged
vectorizationRunReasons=runtime_logged_by_VECTORIZE_RUN_CONTROL
heavyProcessesOnBoot=["reference library localStorage autoload", "saved learning state hydration", "auto learned profile application after vectorization", "full command validation when export opened", "adaptive export blocking"]
filesChanged=["src/lib/emergencyStabilization.js", "src/lib/exportBlockingAudit.js", "src/lib/referenceLearning/referenceLibrary.js", "src/lib/referenceLearning/referenceLearningApplier.js", "src/components/referenceLearning/ReferenceLearningPanel.jsx", "src/components/referenceLearning/CorpusLearningSection.jsx", "src/pages/Editor.jsx", "src/components/editor/ExportModal.jsx", "src/components/editor/ExportBlockingCausePanel.jsx"]
motorChanged=false
encodersChanged=false
exportLogicChanged=true

## Stabilization actions
- Reference Learning defaults to manual/quarantine mode.
- Reference library no longer autoloads from localStorage unless the manual References action is used.
- Learned profiles no longer auto-apply to generated designs.
- Export blocking now uses a hard-file gate instead of warnings, stitch-count risk, visual diagnostics, CE01 risky, adaptive score, or reference-learning state.
- Export modal shows blockingReason, blockingModule, blockingCheck, firstInvalidCommandIndex, and unlockHint.
- Vectorization runs are logged with vectorizationRunCount and vectorizationRunReasons.

## Performance measurements
appBootMs=logged_by_[PERF]
editorFirstRenderMs=logged_by_[PERF]
imageLoadMs=not_changed
vectorizationMs=logged_by_[PERF]_vectorization
stitchPlanningMs=deferred/manual
exportValidationMs=hard_gate_only_in_export_modal
referenceLearningMs=0_on_boot_expected

## Quality diagnosis only
Current quality concerns are diagnostic-only and not applied automatically. Likely sources to inspect later: stitch planner, fill direction, density, missing underlay, satin conversion, contour conversion, layer order, and reference learning not being applied because it is intentionally quarantined.