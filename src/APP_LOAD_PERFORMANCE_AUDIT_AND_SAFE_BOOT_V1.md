# APP_LOAD_PERFORMANCE_AUDIT_AND_SAFE_BOOT_V1

- appLoadBeforeMs=heavy/near-hang observed after previous change
- appLoadAfterMs=fast initial render; Dashboard and Editor verified in preview after lightweight boot
- slowestFunctionBefore=finalEmbroideryCommands/buildFinalCommands and dark-stroke command analysis eligible during Editor boot
- slowestFunctionAfter=deferred until Simular/Final/Export/Lab manual views
- heavyProcessesDetectedOnBoot=["buildFinalCommands from Editor useMemo", "strict dark-stroke context analysis", "full command metrics over generated commands"]
- movedToManualExecution=["reference learning auto apply", "accepted Wilcom learning calibration auto-apply", "dark-stroke analysis", "final command generation", "full command metrics"]
- localStorageLargeDataDetected=true
- infiniteRenderLoopDetected=false
- automaticReportGenerationDetected=false
- automaticReferenceLearningDetected=true
- automaticUniversalValidationDetected=false
- fixedFiles=["src/lib/safeBoot.js","src/main.jsx","src/pages/Editor.jsx","src/lib/referenceLearning/referenceLearningApplier.js","src/lib/referenceLearning/referenceLearningState.js","src/components/editor/LearnedConfigDiffPanel.jsx"]
- motorFilesUnchanged=true
- encodersUnchanged=true
- exportLogicUnchanged=true
- visualPipelineUnchanged=true

## Implementation
LIGHTWEIGHT_APP_BOOT_V1 renders the Editor first using cached region stitch counts. Heavy command generation and dark-stroke analysis are deferred until the user opens Simular, Final Look, Export, or Lab/professional tools.

## Performance logs added
- [PERF] app boot start
- [PERF] Editor mount start
- [PERF] load config ms
- [PERF] load reference learning ms
- [PERF] universal validator ms
- [PERF] command analysis ms
- [PERF] report generation ms
- [PERF] first render complete ms

## Explicitly unchanged
No digitization motor, stitch generation, DST/DSB encoder, ExportModal, V5.1 repair, Simular, Final Look, SATIN, Trim Guard, Splitter, Underlay, stitch reduction, or visual embroidery rendering logic was changed.