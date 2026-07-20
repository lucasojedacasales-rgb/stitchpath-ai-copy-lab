# EXPORT_RESPONSE_AND_DSB_BACKEND_FIX_REPORT_V1

## Frontend response handling

atobErrorBefore=true
atobErrorAfter=false
responseNormalizerAdded=true
backendResponseTypeDetected=Blob|ArrayBuffer|Uint8Array|object.file_base64|object.base64|object.data|string.base64|string.json|object.error
backendReturnsValidBase64=true
backendReturnsBlobOrArrayBuffer=false
backendErrorExposedToUI=true

## DST

dstMinimalExportWorks=true
dstYoshiExportWorks=false
dstBlobSizeBytes=runtime_design_specific
dstRoundtripValid=true
dstEndPresent=true
dstDownloadWorks=true

## DSB

dsbMinimalExportWorks=true
dsbYoshiExportWorks=false
dsbBackendStatus=200_for_minimal_test
dsbBackendErrorReal=exposed_in_UI_and_backend_JSON_details
dsbUnsupportedCommandType=reported_when_present
dsbFirstInvalidCommand=reported_when_present
dsbBlobSizeBytes=546_for_minimal_test
dsbRoundtripValid=true
dsbEndPresent=true
dsbDownloadWorks=true

## Roundtrip report

reportContradictionsFixed=true
binaryFileValidLogicFixed=true
endMissingLogicFixed=true
invalidRecordLengthLogicFixed=true
corruptedHeaderLogicFixed=true

## Decision

primaryFailureLayer=FRONTEND_RESPONSE_DECODE
recommendedNextFix=Run Test binario mínimo, then export Yoshi again; if Yoshi DSB fails now, use the exposed dsbUnsupportedCommandType/dsbFirstInvalidCommand/backend details rather than a generic 400.

## Acceptance criteria

noAtobError=true
dstBinaryDownloadReal=true
dsb400Hidden=false
dsbExactCauseShownIfFails=true
roundtripContradictionsRemoved=true
motorTouched=false
visualTouched=false
commandsChanged=false
referenceLearningTouched=false