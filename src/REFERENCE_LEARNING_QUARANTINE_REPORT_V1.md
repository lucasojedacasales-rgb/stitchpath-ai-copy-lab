# REFERENCE_LEARNING_QUARANTINE_REPORT_V1

totalStpFilesDetected=78
autoLoadDisabled=true
autoTrainingDisabled=true
manualReferenceAnalysisAvailable=true
referenceLearningNoLongerBlocksExport=true
referenceLearningNoLongerRunsOnBoot=true

## Flags
referenceLearningEnabled=false
referenceLearningAutoRun=false
referenceLibraryAutoLoad=false
stpTrainingAutoProcess=false

## Behavior
The 78 .stp/reference files are not loaded at app boot, not processed when opening the Editor, not processed during vectorization, and cannot modify commands, validation, export gates, or presets unless the user explicitly enters the manual reference tools and runs analysis/apply actions.

## Manual entry point
Herramientas técnicas → Referencias → Analizar referencias.

User message shown in the UI:
“Reference Learning está en modo manual para evitar lentitud y errores.”