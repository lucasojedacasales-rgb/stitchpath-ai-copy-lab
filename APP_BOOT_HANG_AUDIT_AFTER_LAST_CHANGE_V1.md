# APP_BOOT_HANG_AUDIT_AFTER_LAST_CHANGE_V1

- appBootsSuccessfullyBeforeFix=false
- appBootsSuccessfullyAfterFix=true
- rootCause=Reference Learning remained eligible for automatic safe-profile application and synchronous localStorage parsing after the accepted Wilcom sample update. The last change also introduced non-numeric learned Wilcom fields into a config diff surface that expected numeric values. No build-time import/export failure was found.
- changedFiles=["src/lib/safeBoot.js","src/lib/referenceLearning/referenceLearningApplier.js","src/lib/referenceLearning/referenceLearningState.js","src/components/editor/LearnedConfigDiffPanel.jsx","src/pages/Editor.jsx"]
- errorMessagesFound=["Potential synchronous localStorage parse during learned profile auto-apply","Potential NaN display from non-numeric learnedMachineAcceptedFormat"]
- infiniteRenderLoopDetected=false
- heavyRuntimeAuditOnBootDetected=false
- referenceLearningAutoRunDetected=true
- universalValidatorAutoRunDetected=false
- localStorageIssueDetected=true
- fixedBySafeBoot=true
- functionsMovedToManualExecution=["autoApplyLearnedProfileForDesign","reference learning accepted Wilcom calibration auto-apply"]
- motorFilesUnchanged=true
- encodersUnchanged=true
- exportLogicUnchanged=true
- visualPipelineUnchanged=true

## Fix
SAFE_APP_BOOT_MODE_V1 now prevents reference-learning auto-apply on boot/automatic flows, logs safe boot status, ignores oversized/corrupt learning localStorage, and keeps heavy learning/validation work behind manual buttons.

## Explicitly unchanged
No digitization motor, DST/DSB encoder, ExportModal, V5.1 repair, Simular, Final Look, stitch generation, or stitch reduction files were modified.