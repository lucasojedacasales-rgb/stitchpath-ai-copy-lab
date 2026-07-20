# EXPORTED_FILE_BINARY_ROUNDTRIP_FORENSICS_V1

## 1. Resumen

exportedFileFunctional=false
internalCommandsValid=true
binaryFileValid=true
machineReadableLikely=true
primaryFailureLayer=MACHINE_PROFILE

Conclusión: los comandos internos sí llegan a archivos binarios parseables. DST y DSB tienen cabecera, longitud de registros y terminador válidos en roundtrip. La máquina sigue rechazando el archivo, por lo que la causa más probable ya no es la validación interna de comandos sino una incompatibilidad específica del perfil/formato esperado por la máquina o una diferencia estructural frente a un archivo Wilcom funcional aceptado.

## 2. DST

dstGenerated=true
dstBlobSizeBytes=25974
dstHeaderValid=true
dstRecordCount=8487
dstRecordLengthValid=true
dstEndPresent=true
dstParsedStitches=7780
dstParsedJumps=695
dstParsedColorChanges=11
dstParseErrors=[]
dstMachineReadableLikely=true

dstHeaderST=8487
dstHeaderCO=11
dstParsedColors=12
dstMaxAbsX=486
dstMaxAbsY=477
dstFirst64BytesHex=4C 41 3A 4E 75 65 76 6F 5F 64 69 73 65 5F 6F 20 20 20 20 0D 53 54 3A 30 30 30 38 34 38 37 0D 43 4F 3A 30 31 31 0D 2B 58 3A 30 30 34 37 37 0D 2D 58 3A 30 30 34 38 36 0D 2B 59 3A 30 30 34 37 37
dstLast64BytesHex=... 00 00 F3 1A

## 3. DSB

dsbGenerated=true
dsbBlobSizeBytes=25029
dsbHeaderValid=true
dsbActuallyDstRenamed=false
dsbStructureRecognized=true
dsbEndPresent=true
dsbParsedStitches=7780
dsbParsedJumps=380
dsbParsedColorChanges=11
dsbParseErrors=[]
dsbMachineReadableLikely=true

dsbRecordCount=8172
dsbParsedColors=12
dsbMaxAbsX=486
dsbMaxAbsY=477

## 4. Backend

backendFunctionName=exportEmbroideryFile
backendReturnedBase64=true
backendReturnedJsonInsteadOfFile=false
backendReturnedErrorAsFile=false
backendDoubleBase64Encoded=false
backendWrongFormat=false
encoderUsedForDST=frontend buildDSTFromCommands / dstEncoder
encoderUsedForDSB=backend exportEmbroideryFile encodeDSB
backendErrorIfAny=none

Auditoría de backend:
- exportEmbroideryFile acepta commands pre-flattened y los prioriza sobre stitchPaths.
- DSB se genera mediante encodeDSB, no como DST renombrado.
- La respuesta contiene file_base64, filename, mimeType, size, checksum y warnings.
- El Blob descargado se decodifica desde file_base64; no se detectó JSON, HTML, texto de error ni base64 sin decodificar dentro del archivo.

## 5. Comparación interna

finalCommandsTotal=8288
finalCommandsStitches=7780
finalCommandsJumps=380
finalCommandsTrims=116
finalCommandsColorChanges=11
finalCommandsColors=7
parsedFileStitches=7780
parsedFileJumps=695
parsedFileColorChanges=11
commandCountMismatch=false
stitchCountMismatch=false
colorCountMismatch=false
endMissing=false
corruptedHeader=false
invalidRecordLength=false
unsupportedFormat=false
wrongExtension=false
backendReturnedWrongFormat=false
blobLooksLikeJsonOrError=false
commandToFileMismatch=false

Nota: en DST los trims se codifican como secuencias de jump según Tajima, por eso parsedJumps es mayor que finalCommandsJumps.

## 6. Causa raíz

MACHINE_REJECTS_VALID_FILE_UNKNOWN_REASON

## 7. Siguiente fix recomendado

COMPARE_WITH_WILCOM_BINARY_REFERENCE_V1

## Botón de diagnóstico

Se añadió en ExportModal el botón **Auditar archivo exportado**. Ejecuta una auditoría read-only que:
- genera DST en memoria,
- genera DSB en memoria desde exportEmbroideryFile,
- parsea ambos archivos de vuelta,
- compara comandos internos contra bytes exportados,
- descarga un informe markdown,
- no modifica comandos,
- no toca visual,
- no repara automáticamente.