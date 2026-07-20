# REFERENCE_INTEGRATED_PIPELINE_AFTER_SATIN_V2_RUNTIME — StitchPath AI

> Generado: 2026-07-05
> Proyecto medido: Nuevo diseño (`6a48d4f03ec7e0d075352fc9`)
> Regiones: 16
> Fuente: `prof.report.integratedSatinValidation`

---

## 1. Flags reales

| Flag | Valor real |
|---|---:|
| integratedValidation | true |
| trimGuardApplied | true |
| visibleSplitterStatus | NO_EFFECTIVE_REVERTED |
| satinPhaseApplied | true |
| qualityGateMeasuredFinalReturnedCommands | true |
| safeToKeepSatin | true |

Contexto de fase:

| Campo | Valor real |
|---|---|
| splitterStatusBeforeSatin | NO_EFFECTIVE_REVERTED |
| commandsSourceBeforeSatin | beforeSplitter |
| commandsSourceAfterSatin | satinAccepted |

---

## 2. Antes de SATIN, después de Trim Guard + Splitter

| Métrica | Valor real |
|---|---:|
| stitchCount | 5799 |
| jumpCount | 375 |
| trimCount | 205 |
| visibleDiagonalStitches | 0 |
| maxVisibleStitchMm | 11.77 |
| satinContourCount | 0 |
| runningContourCount | 3 |
| underlayCount | 0 |
| professionalScore | 90 |
| finalLookExportMismatch | false |
| ce01Status | RISKY |

---

## 3. Después de SATIN y quality gate final

| Métrica | Valor real |
|---|---:|
| stitchCount | 5799 |
| jumpCount | 375 |
| trimCount | 205 |
| visibleDiagonalStitches | 0 |
| maxVisibleStitchMm | 11.77 |
| satinContourCount | 1 |
| runningContourCount | 2 |
| underlayCount | 0 |
| professionalScore | 90 |
| finalLookExportMismatch | false |
| ce01Status | RISKY |

---

## 4. Evaluación final safeToKeepSatin

| Criterio | Evaluación real |
|---|---|
| integratedValidation=true | PASS |
| satinContourCount sube | PASS — 0 → 1 |
| runningContourCount baja o se mantiene | PASS — 3 → 2 |
| visibleDiagonalStitches no sube | PASS — 0 → 0 |
| jumpCount no sube más de 10 | PASS — 375 → 375 |
| trimCount no sube más de 10 | PASS — 205 → 205 |
| CE01 no pasa a INVALID | PASS — RISKY → RISKY |
| finalLookExportMismatch sigue false | PASS — false → false |
| professionalScore no baja más de 3 | PASS — 90 → 90 |

Resultado: `safeToKeepSatin=true`.

---

## 5. Conclusión

Decisión: **KEEP_SATIN_AND_CHECKPOINT**

SATIN_OUTER_CONTOUR_CONVERTER_V1 queda validado integrado en el orden correcto: después de Trim Guard, después de Splitter V1_2 con `NO_EFFECTIVE_REVERTED`, y antes del quality gate final. La fase aumenta `satinContourCount`, reduce `runningContourCount`, no introduce regresiones de saltos, trims, diagonales visibles, CE01, mismatch ni score profesional.