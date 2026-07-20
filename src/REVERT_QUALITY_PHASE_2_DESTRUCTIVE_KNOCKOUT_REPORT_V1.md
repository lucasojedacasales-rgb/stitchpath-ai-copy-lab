# REVERT_QUALITY_PHASE_2_DESTRUCTIVE_KNOCKOUT_REPORT_V1

## Motivo

Se revierte QUALITY_PHASE_2_LAYER_KNOCKOUT_AND_THREAD_ORDER_V1 por regresión visual grave: personaje desmontado, grandes rellenos ausentes, huecos excesivos y caída de puntadas desde una versión estable aproximada de ~8472 a ~1371/1456.

## Cambios revertidos

- Eliminado `src/lib/qualityPhase2LayerComposition.js`.
- Retirada la importación de `qualityPhase2LayerComposition` del pipeline.
- Retirada la etapa `quality_phase_2_layer_knockout_and_thread_order` del pipeline.
- Retirada la función `runQualityPhase2LayerComposition` del runner.
- Eliminado el checkpoint estable de fase 2 para que no figure como fase aceptada.

## Preservado

- Fase 1 de limpieza de segmentación.
- Exportación DST/DSB.
- Encoders.
- ExportModal.
- Rendimiento/cache/lazy loading.
- Validación universal.
- Reference Learning.
- Archivos `.stp`.

## Recuperación esperada

Al reprocesar el diseño activo, el flujo vuelve a:

`region_builder → quality_phase_1_input_segmentation_cleanup → stitch_planner`

sin la fase 2 destructiva intermedia que alteraba prioridad, layerType, region_class y knockoutZones.

## Métricas solicitadas

- reverted=true
- restoredCheckpoint=CHECKPOINT_BEFORE_QUALITY_PHASE_2_LAYER_KNOCKOUT_AND_THREAD_ORDER_V1
- totalStitchesBeforeBroken=1371/1456 observado en la regresión visual reportada
- totalStitchesAfterRevert=runtime-measured-after-regenerate; esperado volver al rango estable aproximado 8000+
- visualRestored=runtime-confirmed-after-regenerate; esperado true al retirar la fase destructiva
- exportPreserved=true
- dstValid=true
- dsbValid=true
- performancePreserved=true
- exportStillWorks=true

## Estado de build

Build validation: passed.

## remainingProblem

La composición profesional todavía debe resolverse, pero no mediante knockout destructivo ni modificación de geometría/orden sin una auditoría visual real. El siguiente intento debe ser solo diagnóstico/no destructivo.

## recommendedNextStep

QUALITY_PHASE_2_NON_DESTRUCTIVE_LAYER_AUDIT_ONLY_V1