export const INTEGRATED_PIPELINE_REPORT_MD = `# REFERENCE_INTEGRATED_PIPELINE_AFTER_SATIN_V1 — StitchPath AI

> Generado: 2026-07-05
> Tipo: informe obligatorio de validación integrada posterior a SATIN_OUTER_CONTOUR_CONVERTER_V1.
> Restricción: NO modificar código.
> No se regeneran: SATIN_OUTER_CONTOUR_CONVERTER_REPORT_V1.md ni REFERENCE_LEARNING_VALIDATED_REPORT_AFTER_SATIN_OUTER_CONTOUR.md.

---

## 1. Resultado ejecutivo obligatorio

integratedValidation=false
trimGuardApplied=true
visibleSplitterStatus=NO_EFFECTIVE_REVERTED
satinPhaseApplied=true
qualityGateMeasuredFinalReturnedCommands=true
safeToKeepSatin=false

Motivo principal: safeToKeepSatin=false en esta validación integrada estricta porque el criterio exige integratedValidation=true, y el pipeline actual no mide SATIN en el orden obligatorio solicitado.

---

## 2. Pipeline obligatorio a medir

1. buildFinalCommands
2. applyProfessionalPipeline con preset learned*
3. conversión/reparación de diagonales/travel existente
4. REFERENCE_TRIM_GUARD_V1
5. REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2
   - debe quedar NO_EFFECTIVE_REVERTED
   - debe devolver beforeSplitter
   - no debe añadir puntadas reales
6. SATIN_OUTER_CONTOUR_CONVERTER_V1
7. professionalEmbroideryQualityGate final

---

## 3. Orden real observado del pipeline actual

El orden efectivo actual de applyProfessionalPipeline es:

1. proyección de preset learned* a professionalParams
2. reducción de colores
3. reordenamiento de capas
4. SATIN_OUTER_CONTOUR_CONVERTER_V1
5. reparación de diagonales visibles
6. sanitizado/travel existente
7. conversión useSatinForOuterContours=false, si aplica
8. REFERENCE_TRIM_GUARD_V1
9. REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2
10. professionalEmbroideryQualityGate final

Validación de integración: integratedValidation=false.

Razón: el contrato obligatorio pide medir SATIN después de Trim Guard y Splitter, pero el pipeline actual ejecuta SATIN antes de reparación de diagonales/travel, Trim Guard y Splitter.

---

## 4. Flags requeridos

| Flag | Valor | Justificación |
|---|---|---|
| integratedValidation | false | SATIN no está medido después de Trim Guard + Splitter. |
| trimGuardApplied | true | REFERENCE_TRIM_GUARD_V1 está en el pipeline y se ejecuta cuando trimBeforeTravelMm > 0. |
| visibleSplitterStatus | NO_EFFECTIVE_REVERTED | Estado esperado/declarado para V1_2; al quedar no efectivo debe devolver beforeSplitter. |
| satinPhaseApplied | true | SATIN_OUTER_CONTOUR_CONVERTER_V1 está implementado y aplicado cuando professionalMode=true + learnedUseSatinForOuterContours=true. |
| qualityGateMeasuredFinalReturnedCommands | true | El quality gate final mide procCommands después de las fases transaccionales y sus reversiones. |

---

## 5. Verificación específica de Splitter V1_2

| Condición requerida | Resultado |
|---|---|
| Debe quedar NO_EFFECTIVE_REVERTED | true esperado |
| Debe devolver beforeSplitter | true esperado |
| No debe añadir puntadas reales | true esperado |

Cuando V1_2 queda como NO_EFFECTIVE_REVERTED, el comportamiento correcto es:

phaseAccepted=false
phaseStatus=NO_EFFECTIVE_REVERTED
commandsReturnedSource=beforeSplitter
addedStitchesReturned=0

---

## 6. Tabla antes/después de SATIN dentro del pipeline integrado

La tabla integrada estricta no puede certificarse como medida en el orden obligatorio sin modificar el pipeline o añadir un validador dedicado, porque SATIN actualmente ocurre antes de Trim Guard + Splitter.

### Antes de SATIN — estado integrado requerido

| Métrica | Valor integrado requerido |
|---|---|
| stitchCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| jumpCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| trimCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| visibleDiagonalStitches | NOT_MEASURED_IN_REQUIRED_ORDER |
| maxVisibleStitchMm | NOT_MEASURED_IN_REQUIRED_ORDER |
| satinContourCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| runningContourCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| underlayCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| professionalScore | NOT_MEASURED_IN_REQUIRED_ORDER |
| finalLookExportMismatch | NOT_MEASURED_IN_REQUIRED_ORDER |
| ce01Status | NOT_MEASURED_IN_REQUIRED_ORDER |

### Después de SATIN — estado integrado requerido

| Métrica | Valor integrado requerido |
|---|---|
| stitchCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| jumpCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| trimCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| visibleDiagonalStitches | NOT_MEASURED_IN_REQUIRED_ORDER |
| maxVisibleStitchMm | NOT_MEASURED_IN_REQUIRED_ORDER |
| satinContourCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| runningContourCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| underlayCount | NOT_MEASURED_IN_REQUIRED_ORDER |
| professionalScore | NOT_MEASURED_IN_REQUIRED_ORDER |
| finalLookExportMismatch | NOT_MEASURED_IN_REQUIRED_ORDER |
| ce01Status | NOT_MEASURED_IN_REQUIRED_ORDER |

---

## 7. Valores existentes, no integrados en el orden obligatorio

Estos valores existen en los reportes previos, pero no deben confundirse con la tabla integrada estricta.

| Métrica | Antes SATIN local | Después SATIN local | Interpretación |
|---|---:|---:|---|
| satinContourCount | 0 | 1 | SATIN mejora contorno localmente |
| runningContourCount | 3 | 2 | SATIN reduce running contour localmente |
| jumpCount | 301 | 301 | sin regresión local |
| trimCount | 91 | 91 | sin regresión local |
| visibleDiagonalStitches | 6 | 6 | no cambia en validación global/local aportada |
| professionalScore | 60 | 60 | no cambia en validación global/local aportada |
| ce01Status | RISKY | RISKY | sin regresión local |
| finalLookExportMismatch | false | false | sin regresión local |

Estos valores sostienen que SATIN es localmente no regresivo, pero no prueban integratedValidation=true.

---

## 8. Criterio safeToKeepSatin

safeToKeepSatin=true solo si:

- integratedValidation=true
- satinContourCount sube
- runningContourCount baja o se mantiene
- visibleDiagonalStitches no sube respecto al estado integrado anterior
- jumpCount no sube más de 10
- trimCount no sube más de 10
- CE01 no pasa a INVALID
- finalLookExportMismatch sigue false
- professionalScore no baja más de 3

Evaluación:

| Criterio | Resultado |
|---|---|
| integratedValidation=true | false |
| satinContourCount sube | localmente 0 → 1 |
| runningContourCount baja o se mantiene | localmente 3 → 2 |
| visibleDiagonalStitches no sube | valores aportados 6 → 6 |
| jumpCount no sube más de 10 | 301 → 301 |
| trimCount no sube más de 10 | 91 → 91 |
| CE01 no pasa a INVALID | RISKY → RISKY |
| finalLookExportMismatch sigue false | false → false |
| professionalScore no baja más de 3 | 60 → 60 |

Resultado: safeToKeepSatin=false.

Motivo: aunque los criterios técnicos locales pasan, falla el primer criterio obligatorio: integratedValidation=true.

---

## 9. Diagnóstico de visibleDiagonalStitches 6→6 y professionalScore 60→60

Si el informe vuelve a mostrar visibleDiagonalStitches 6→6 y professionalScore 60→60, la explicación correcta es:

B) baseline aislado de satin
C) fallo de integración del validador

A) baseline anterior al professional pipeline: no es la explicación principal.
B) baseline aislado de satin: sí, el reporte SATIN mide el antes/después local de la fase convertRunningOuterContoursToSatinGuardedV1.
C) fallo de integración del validador: sí, para el objetivo solicitado, porque no construye snapshotBeforeSatin después de Trim Guard + Splitter ni snapshotAfterSatin sobre ese estado.
D) fallo real del pipeline integrado: no demostrado; no hay evidencia de degradación, solo falta de cobertura de validación en el orden contractual.

---

## 10. Conclusión final

integratedValidation=false
trimGuardApplied=true
visibleSplitterStatus=NO_EFFECTIVE_REVERTED
satinPhaseApplied=true
qualityGateMeasuredFinalReturnedCommands=true
safeToKeepSatin=false

Conclusión: el informe integrado obligatorio existe, la validación estricta falla por orden de medición, los valores locales de SATIN no muestran regresión, pero por criterio explícito safeToKeepSatin queda false hasta medir SATIN como paso 6 real.

---

## 11. Cambios realizados

Ningún cambio de código de pipeline.
No se regeneraron los reportes SATIN ni AFTER_SATIN anteriores.
Este contenido corresponde a REFERENCE_INTEGRATED_PIPELINE_AFTER_SATIN_V1.md.
`;