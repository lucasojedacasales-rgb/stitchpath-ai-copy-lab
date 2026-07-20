# UNDERLAY_GENERATOR_REPORT_V1 — StitchPath AI

> Fecha: 2026-07-05
> Fase: UNDERLAY_GENERATOR_V1
> Tipo: centerline-only, post-generador, transaccional y reversible

---

## Veredicto

- phaseAccepted: false
- revertReason: visibleDiagonalStitches subió durante la medición experimental
- commandsReturnedSource: beforeUnderlay

La fase fue ejecutada en modo seguro y se revirtió automáticamente porque el guard transaccional detectó regresión potencial en diagonales visibles. No se conservaron comandos underlay en la salida final.

---

## Candidatos

| Métrica | Valor |
|---|---:|
| candidatesFound | 6 |
| candidatesAccepted | 0 |
| candidatesSkippedTooSmall | no bloqueante en la salida final |
| candidatesSkippedDetail | no bloqueante en la salida final |
| candidatesSkippedContour | safe_contour excluido |
| candidatesSkippedUnsafeGeometry | 3 |
| candidatesSkippedNoStableRegion | 0 |
| addedUnderlayStitches | 0 retornados |

---

## Métricas before/after retornadas

Como la fase se revirtió, las métricas after reflejan los comandos retornados finales, no el experimento descartado.

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
| professionalScore | estable | estable |
| finalLookExportMismatch | false | false |

---

## Decisión

UNDERLAY_GENERATOR_V1 queda implementado, pero en este diseño concreto el guard lo revierte correctamente.

safeToKeepUnderlay: false

Motivo: no se debe conservar underlay si incrementa diagonales visibles en la medición experimental.