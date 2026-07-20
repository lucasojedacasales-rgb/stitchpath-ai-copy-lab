# SATIN_PHASE_ORDER_FIX_REPORT_V1 — StitchPath AI

> Generado: 2026-07-05
> Alcance: solo se modificó `src/lib/professionalDigitizingMode.js`.

## oldOrder

1. proyección learned* a professionalParams
2. reducción de colores
3. reordenamiento de capas
4. SATIN_OUTER_CONTOUR_CONVERTER_V1
5. reparación/conversión de diagonales visibles y travel existente
6. sanitizado/travel existente
7. conversión useSatinForOuterContours=false si aplica
8. REFERENCE_TRIM_GUARD_V1
9. REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2
10. professionalEmbroideryQualityGate final

## newOrder

1. proyección learned* a professionalParams
2. reducción de colores
3. reordenamiento de capas
4. reparación/conversión de diagonales visibles y travel existente
5. sanitizado/travel existente
6. conversión useSatinForOuterContours=false si aplica
7. REFERENCE_TRIM_GUARD_V1
8. REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2
9. SATIN_OUTER_CONTOUR_CONVERTER_V1
10. professionalEmbroideryQualityGate final

## Flags

| Flag | Valor |
|---|---|
| satinMovedAfterTrimGuard | true |
| satinMovedAfterSplitter | true |
| satinRunsBeforeFinalQualityGate | true |
| satinRunsOnlyOnce | true |
| splitterStatusBeforeSatin | runtime: visibleSplitter.phaseStatus / NOT_RUN |
| commandsSourceBeforeSatin | runtime: visibleSplitter.commandsReturnedSource / trimGuard / postTravelRepair |
| commandsSourceAfterSatin | runtime: satinAccepted / beforeSatin |

## codeFilesModified

- `src/lib/professionalDigitizingMode.js`

## Notas

- No se tocó UI_EXPORT_CENTER_CLEANUP_V1.
- No se tocó exportación.
- No se tocó V5.1.
- No se cambió la lógica interna de Trim Guard, Splitter V1_2 ni SATIN.
- Solo se movió el punto de llamada de SATIN dentro de `applyProfessionalPipeline`.