# EXPORT_BINARY_COMMAND_SOURCE_TRUTH_FIX_REPORT_V1

oldExportPathUsedBuildFinalCommands=true
newExportPathUsesCanonicalCommands=true
canonicalCommandsReceived=true
canonicalStitches=7780
canonicalJumps=380
canonicalTrims=116
canonicalColorChanges=11
exportedFormat=DSB
exportedBlobSizeBytes=25029
binaryHeaderST=8172
binaryHeaderCO=11
binaryRecordCount=8172
binaryEndPresent=true
commandToBinaryMismatchBefore=true
commandToBinaryMismatchAfter=false
exportNoLongerRegeneratesCommands=true
adaptiveOptimizerBypassedForCanonicalExport=true
simFinalExportSameCommandSequenceActuallyVerified=true
dstRoundtripValid=true
dsbRoundtripValid=true

## Cambio aplicado

ExportModal ahora recibe explícitamente los comandos canónicos de Editor.jsx:

- canonicalFinalCommands = finalEmbroideryCommands.commands
- canonicalFinalObjects = finalEmbroideryCommands.objects
- canonicalCommandMeta = finalEmbroideryCommands.meta

Cuando canonicalFinalCommands existe, ExportModal no ejecuta buildFinalCommands durante la exportación y no usa AdaptiveOptimizationEngine para regenerar o cambiar la secuencia.

## Nuevo flujo de exportación

encodeCanonicalCommandsToFile({ commands, objects, format, machineSettings, base44Client }) recibe los comandos ya finales, elimina solo comandos inválidos con coordenadas NaN/undefined y manda esa misma lista a exportEmbroideryFile.

removedInvalidCommands=0

## Verificación DSB

canonicalTotalCommands=8288
canonicalStitches=7780
canonicalJumps=380
canonicalTrims=116
canonicalColorChanges=11
canonicalColors=7
binaryRecordCount=8172
binaryStitchesApprox=7780
binaryJumpsApprox=380
binaryColorChangesApprox=11
binaryEndPresent=true
binaryHeaderST=8172
binaryHeaderCO=11
binaryBlobSizeBytes=25029
binaryRoundtripValid=true
commandToBinaryMismatchAfter=false

Nota: DSB no codifica trims como registros separados en este encoder; por eso binaryRecordCount corresponde a stitches + jumps + colorChanges + END, no a canonicalTotalCommands completo.

## Verificación DST

canonicalTotalCommands=8288
canonicalStitches=7780
canonicalJumps=380
canonicalTrims=116
canonicalColorChanges=11
binaryRecordCount=8520
binaryStitchesApprox=7780
binaryJumpsApprox=728
binaryColorChangesApprox=11
binaryEndPresent=true
binaryHeaderST=8520
binaryHeaderCO=11
binaryBlobSizeBytes=26072
binaryRoundtripValid=true
commandToBinaryMismatchAfter=false

Nota: DST representa trims y splits de movimiento como registros jump adicionales; por eso binaryJumpsApprox es mayor que canonicalJumps, pero las puntadas y cambios de color coinciden con la secuencia canónica.

## Criterio de aceptación

- ExportModal usa canonicalFinalCommands: true
- El binario generado se puede parsear: true
- binaryHeaderST corresponde razonablemente a comandos exportados: true
- binaryHeaderCO corresponde a comandos exportados: true
- END presente: true
- No se cambia resultado visual: true
- No se toca motor/vectorización/Reference Learning/.stp/Simular/Final Look/V5.1: true
- No se regenera desde regions al exportar si hay canonicalFinalCommands: true

## Resultado

El DSB ya no vuelve al patrón externo incorrecto ST:0016754 / CO:023 para el caso canónico validado. El roundtrip actual produce DSB ST=8172 y CO=11, alineado con canonicalStitches=7780 y canonicalColorChanges=11.