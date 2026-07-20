# EMBROIDERY_COMMAND_RUNTIME_FORENSICS_IMPLEMENTATION_REPORT_V1

Fecha: 2026-07-05

## Estado de implementación

runtimeButtonAdded=true
runtimeSnapshotAvailable=true
runtimeReportHasNoRuntimeRequired=true
finalCommandsUsed=true
worstOffendersListed=true
motorFilesUnchanged=true
exportLogicUnchanged=true

## Ubicación

Botón técnico añadido en:

- Herramientas técnicas → Diagnóstico
- Texto del botón: `Auditar comandos finales`
- Archivo descargado: `EMBROIDERY_COMMAND_RUNTIME_FORENSICS_V1.md`

## Fuentes runtime usadas

- `finalEmbroideryCommands.commands`
- `finalEmbroideryCommands.objects`
- `regions`
- `config`
- `darkStroke`
- `editorMachineSettings`

## Métricas reales generadas al pulsar el botón

El informe descargado se calcula en el navegador sobre el diseño activo y termina con campos reales, sin placeholders:

- `runtimeSnapshotAvailable=true`
- `commandSourceUsed=finalEmbroideryCommands`
- `totalCommands=<número real>`
- `totalStitches=<número real>`
- `totalJumps=<número real>`
- `totalTrims=<número real>`
- `visibleLongStitchCount=<número real>`
- `severeVisibleLongStitchCount=<número real>`
- `stitchedTravelCount=<número real>`
- `fillOutsideRegionCount=<número real>`
- `crossRegionStitchCount=<número real>`
- `blackContourOffenderCount=<número real>`
- `maxVisibleStitchMm=<número real>`
- `worstOffenderRegionIds=[...]`
- `worstOffenderCommandIndexes=[...]`
- `issueStage=<clasificación calculada>`
- `primaryCause=<texto calculado>`
- `recommendedFix=<fix recomendado>`

## Restricciones verificadas

motorFilesUnchanged=true
exportLogicUnchanged=true
v51Unchanged=true
exportModalUnchanged=true
encodersUnchanged=true
ce01ValidatorUnchanged=true
satinTrimGuardSplitterUnderlayUnchanged=true
commandsNotModified=true
regionsNotModified=true

## Resultado

La implementación añade diagnóstico runtime real y descarga el informe `EMBROIDERY_COMMAND_RUNTIME_FORENSICS_V1.md` desde el diseño activo sin reparar ni mutar comandos.