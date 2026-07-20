export const INTEGRATED_PIPELINE_AFTER_SATIN_V2_MD = `# REFERENCE_INTEGRATED_PIPELINE_AFTER_SATIN_V2 — StitchPath AI

> Generado: 2026-07-05
> Objetivo: validar SATIN_OUTER_CONTOUR_CONVERTER_V1 integrado después de Trim Guard + Splitter V1_2 y antes del quality gate final.

## Estado de integración

| Flag obligatorio | Valor |
|---|---|
| integratedValidation | true |
| trimGuardApplied | runtime: true/false según ejecución de REFERENCE_TRIM_GUARD_V1 |
| visibleSplitterStatus | runtime: NO_EFFECTIVE_REVERTED / OTHER |
| satinPhaseApplied | runtime: true/false según ejecución de SATIN_OUTER_CONTOUR_CONVERTER_V1 |
| qualityGateMeasuredFinalReturnedCommands | true |
| safeToKeepSatin | runtime: calculado por criterios estrictos |

## Medición integrada runtime

La medición integrada queda instrumentada en prof.report.integratedSatinValidation dentro de applyProfessionalPipeline.

### Antes de SATIN, después de Trim Guard + Splitter

| Métrica | Fuente runtime |
|---|---|
| stitchCount | integratedSatinValidation.beforeSatin.stitchCount |
| jumpCount | integratedSatinValidation.beforeSatin.jumpCount |
| trimCount | integratedSatinValidation.beforeSatin.trimCount |
| visibleDiagonalStitches | integratedSatinValidation.beforeSatin.visibleDiagonalStitches |
| maxVisibleStitchMm | integratedSatinValidation.beforeSatin.maxVisibleStitchMm |
| satinContourCount | integratedSatinValidation.beforeSatin.satinContourCount |
| runningContourCount | integratedSatinValidation.beforeSatin.runningContourCount |
| underlayCount | integratedSatinValidation.beforeSatin.underlayCount |
| professionalScore | integratedSatinValidation.beforeSatin.professionalScore |
| finalLookExportMismatch | integratedSatinValidation.beforeSatin.finalLookExportMismatch |
| ce01Status | integratedSatinValidation.beforeSatin.ce01Status |

### Después de SATIN y antes/después del quality gate final

| Métrica | Fuente runtime |
|---|---|
| stitchCount | integratedSatinValidation.afterSatin.stitchCount |
| jumpCount | integratedSatinValidation.afterSatin.jumpCount |
| trimCount | integratedSatinValidation.afterSatin.trimCount |
| visibleDiagonalStitches | integratedSatinValidation.afterSatin.visibleDiagonalStitches |
| maxVisibleStitchMm | integratedSatinValidation.afterSatin.maxVisibleStitchMm |
| satinContourCount | integratedSatinValidation.afterSatin.satinContourCount |
| runningContourCount | integratedSatinValidation.afterSatin.runningContourCount |
| underlayCount | integratedSatinValidation.afterSatin.underlayCount |
| professionalScore | integratedSatinValidation.afterSatin.professionalScore |
| finalLookExportMismatch | integratedSatinValidation.afterSatin.finalLookExportMismatch |
| ce01Status | integratedSatinValidation.afterSatin.ce01Status |

## safeToKeepSatin=true

safeToKeepSatin solo es true si integratedValidation=true, satinContourCount sube, runningContourCount baja o se mantiene, visibleDiagonalStitches no sube, jumpCount no sube más de 10, trimCount no sube más de 10, CE01 no pasa a INVALID, finalLookExportMismatch sigue false y professionalScore no baja más de 3.

## Conclusión

SATIN_PHASE_ORDER_FIX_V1 deja la validación integrada activa en el orden nuevo.
`;