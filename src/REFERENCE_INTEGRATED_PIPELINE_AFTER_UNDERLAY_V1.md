# REFERENCE_INTEGRATED_PIPELINE_AFTER_UNDERLAY_V1 — StitchPath AI

> Fecha: 2026-07-05
> Punto de partida: CHECKPOINT_REFERENCE_LEARNING_TRIM_GUARD_SATIN_CONTOUR_STABLE
> Validación integrada después de implementar UNDERLAY_GENERATOR_V1

---

## Orden validado

1. buildFinalCommands
2. applyProfessionalPipeline con preset learned*
3. reorderProfessionalLayers
4. UNDERLAY_GENERATOR_V1
5. reparación de diagonales/travel existente
6. travel sanitize existente
7. REFERENCE_TRIM_GUARD_V1
8. REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2
9. SATIN_OUTER_CONTOUR_CONVERTER_V1
10. professionalEmbroideryQualityGate final

---

## Flags integrados

| Flag | Valor |
|---|---:|
| integratedValidation | true |
| underlayPhaseApplied | true |
| underlayPhaseAccepted | false |
| trimGuardApplied | true |
| visibleSplitterStatus | medido por pipeline |
| satinPhaseApplied | true |
| qualityGateMeasuredFinalReturnedCommands | true |
| safeToKeepUnderlay | false |

---

## Resultado underlay

| Métrica | Before | After retornado |
|---|---:|---:|
| underlayCount | 0 | 0 |
| stitchCount | 5873 | 5873 |
| jumpCount | 301 | 301 |
| trimCount | 91 | 91 |
| visibleDiagonalStitches | 74 | 74 |
| emptyBlocks | 0 | 0 |
| unsupportedLongStitches | 0 | 0 |
| CE01 status | RISKY | RISKY |
| finalLookExportMismatch | false | false |

---

## Criterio safeToKeepUnderlay

safeToKeepUnderlay requiere:

- integratedValidation=true
- underlayCount sube
- visibleDiagonalStitches no sube
- emptyBlocks no sube
- unsupportedLongStitches no sube
- jumpCount no sube más de 6
- trimCount no sube más de 6
- CE01 no pasa a INVALID
- finalLookExportMismatch sigue false
- professionalScore no baja más de 3
- stitchCount sube dentro del presupuesto

Resultado actual:

- integratedValidation=true
- underlayCount no sube en comandos retornados
- la fase experimental se revirtió por seguridad

Por tanto:

safeToKeepUnderlay=false

---

## Decisión integrada

UNDERLAY_GENERATOR_V1 está conectado en el punto correcto del pipeline y funciona como fase reversible.

En el diseño validado, la decisión correcta es conservar beforeUnderlay para no degradar la salida estable.