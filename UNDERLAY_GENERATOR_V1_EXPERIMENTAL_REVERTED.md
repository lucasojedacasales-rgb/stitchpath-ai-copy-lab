# UNDERLAY_GENERATOR_V1_EXPERIMENTAL_REVERTED — StitchPath AI

> Fecha: 2026-07-05  
> Estado: cierre experimental revertido  
> Punto de referencia estable anterior: CHECKPOINT_REFERENCE_LEARNING_TRIM_GUARD_SATIN_CONTOUR_STABLE

---

## 1. Veredicto ejecutivo

UNDERLAY_GENERATOR_V1 queda cerrado como experimento revertido.

La fase existe como una capa experimental, reversible y transaccional, pero en el diseño validado no se acepta como mejora estable.

Resultado final:

- UNDERLAY_GENERATOR_V1 existe como fase experimental reversible.
- En este diseño NO se acepta.
- Devuelve `beforeUnderlay`.
- No modifica la salida final.
- No se considera mejora estable.
- No debe usarse para crear un checkpoint estable.
- No insistir con underlay V1 salvo una auditoría nueva específica.
- Mantener SATIN / Trim Guard / Splitter como la cadena estable anterior.

---

## 2. Evidencia: UNDERLAY_GENERATOR_REPORT_V1

Resultado observado:

| Campo | Valor |
|---|---:|
| phaseAccepted | false |
| revertReason | visibleDiagonalStitches subió durante la medición experimental |
| commandsReturnedSource | beforeUnderlay |
| candidatesFound | 6 |
| candidatesAccepted | 0 |
| candidatesSkippedUnsafeGeometry | 3 |
| underlayCount | 0 → 0 |
| safeToKeepUnderlay | false |

Interpretación:

La fase detectó candidatos, pero no produjo una salida segura que pudiera conservarse. Al activar el guard transaccional, el sistema revirtió correctamente a la secuencia previa.

---

## 3. Evidencia: REFERENCE_INTEGRATED_PIPELINE_AFTER_UNDERLAY_V1

Resultado observado:

| Campo | Valor |
|---|---:|
| integratedValidation | true |
| underlayPhaseApplied | true |
| underlayPhaseAccepted | false |
| trimGuardApplied | true |
| satinPhaseApplied | true |
| qualityGateMeasuredFinalReturnedCommands | true |
| safeToKeepUnderlay | false |

Interpretación:

La validación integrada confirma que UNDERLAY_GENERATOR_V1 se ejecuta dentro del orden medido del pipeline, pero no se conserva porque la fase no supera los criterios de seguridad.

El quality gate final mide los comandos retornados, y esos comandos son `beforeUnderlay`.

---

## 4. Impacto en salida final

UNDERLAY_GENERATOR_V1 no modifica la salida final en este diseño.

La salida final se mantiene en el estado estable previo:

- No se añaden puntadas underlay.
- No se incrementa underlayCount.
- No se altera exportación.
- No se modifica V5.1.
- No se modifica SATIN.
- No se modifica Trim Guard.
- No se modifica Splitter.
- No se modifica buildFinalCommands.
- No se modifican encoders.
- No se modifica CE01 validator.

---

## 5. Decisión de checkpoint

No crear checkpoint estable basado en UNDERLAY_GENERATOR_V1.

Motivo:

- `phaseAccepted=false`.
- `commandsReturnedSource=beforeUnderlay`.
- `safeToKeepUnderlay=false`.
- La fase experimental no añade mejora conservada.
- El riesgo observado fue aumento de visibleDiagonalStitches durante la medición experimental.

Por tanto, UNDERLAY_GENERATOR_V1 queda documentado como experimento revertido, no como avance estable.

---

## 6. Cadena estable que se conserva

La cadena estable anterior sigue siendo:

CHECKPOINT_REFERENCE_LEARNING_TRIM_GUARD_SATIN_CONTOUR_STABLE

Componentes que deben mantenerse como base estable:

1. Reference Learning preset aplicado.
2. REFERENCE_TRIM_GUARD_V1.
3. REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2 con reversión segura cuando no es efectivo.
4. SATIN_OUTER_CONTOUR_CONVERTER_V1 integrado después de Trim Guard y Splitter.
5. Quality Gate final midiendo comandos realmente retornados.

---

## 7. Recomendación operativa

No implementar UNDERLAY V1_1 todavía.

No insistir con underlay V1 salvo que exista una auditoría nueva específica, con nueva hipótesis técnica y nuevos criterios de seguridad.

Próxima fase recomendada:

Validar calidad visual final y exportación CE01 con el pipeline estable actual:

CHECKPOINT_REFERENCE_LEARNING_TRIM_GUARD_SATIN_CONTOUR_STABLE

La prioridad debe volver a la validación visual/exportable del pipeline estable, no a extender underlay.

---

## 8. Estado final

UNDERLAY_GENERATOR_V1_EXPERIMENTAL_REVERTED=true

UNDERLAY_GENERATOR_V1 queda cerrado como experimento reversible no aceptado.

No se promueve.
No se usa como checkpoint estable.
No se implementa V1_1.