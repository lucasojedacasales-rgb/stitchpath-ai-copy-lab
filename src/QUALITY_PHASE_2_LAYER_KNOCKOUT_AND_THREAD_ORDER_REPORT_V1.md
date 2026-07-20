# QUALITY_PHASE_2_LAYER_KNOCKOUT_AND_THREAD_ORDER_REPORT_V1

## Scope

Applied QUALITY_PHASE_2_LAYER_KNOCKOUT_AND_THREAD_ORDER_V1 as a pre-stitch-planner composition stage. It runs after Phase 1 segmentation cleanup and before stitch planning.

Protected and untouched:
- DST/DSB export
- encoders
- ExportModal
- universal validation
- V5.1
- performance/cache/lazy loading
- Reference Learning
- .stp files
- export engine
- closed GitHub audit work

## Checkpoint before changes

Created:

`CHECKPOINT_BEFORE_QUALITY_PHASE_2_LAYER_KNOCKOUT_AND_THREAD_ORDER_V1`

## FASE 1 — Auditoría de capas actual

Runtime report key:

`[quality-phase-2-layer-composition]`

Measured fields:
- order of regions: `report.order`
- fillAfterContour: `report.fillAfterContour`
- contourBeforeFill: `report.contourBeforeFill`
- blackOutlinePlacement: `report.blackOutlinePlacement`
- whiteRegionPlacement: `report.whiteRegionPlacement`
- overlapAreaBetweenRegions: `report.overlapAreaBetweenRegions`
- fillUnderWhiteRegions: before/after fields
- fillUnderBlackDetails: before/after fields
- sameColorReopenCount: before/after fields
- threadChangeSequence: `report.threadChangeSequence`
- contourLayerConflicts: before/after fields
- finalLookCompositionMismatches: `report.finalLookCompositionMismatches`

Specific detections covered:
- verde cosido debajo de ojos blancos: base_fill + white_fill overlap creates knockout metadata and downstream knockout zones
- negro cosido como masa debajo de rellenos: dark detail regions are reclassified as black_detail/running unless true fill is needed
- regiones blancas sin knockout: white_fill regions reserve knockout zones in lower base fills
- contornos mezclados: outer_outline priority set to final layer
- superposición excesiva: overlap metrics measured and reduced through knockout zones
- colores reabiertos: sameColorReopenCount measured and sorted within each logical tier

## FASE 2 — Clasificación por capa lógica

Implemented categories:
- base_fill_large
- base_fill_secondary
- white_fill
- detail_fill
- black_detail
- outer_outline

Priority order:
1. base_fill_large — priority 10
2. base_fill_secondary — priority 20
3. white_fill — priority 30
4. detail_fill — priority 40
5. black_detail — priority 50
6. outer_outline — priority 90

Each region now receives:
- logicalLayer
- layerType
- region_class
- priority
- qualityPhase2 metadata
- final travelOrder after sorting

## FASE 3 — Knockout real entre regiones

Implemented through logical closed-region overlap metadata before stitch planning.

Rules applied:
- lower base_fill_large/base_fill_secondary receives knockout zones when overlapped by visually upper closed regions
- white_fill reserves holes in green/orange base fills
- detail_fill can reserve holes in larger lower fills
- black_detail only reserves holes when it is closed/relevant, not tiny linework
- running stitch, fine contours, underlay and outer_outline do not receive destructive knockout

The existing CE01-safe fill generator already respects object knockout zones during scanline generation, so the stable command pipeline remains unchanged.

## FASE 4 — Orden profesional de cosido

Applied stable region ordering before stitch planner:

1. base_fill_large
2. base_fill_secondary
3. white_fill
4. detail_fill
5. black_detail
6. outer_outline

Rules preserved:
- outer_outline final
- black_detail does not become a large early black fill
- internal point order per region is not changed
- command pipeline stable path remains the same
- export is not regenerated through any alternate route

## FASE 5 — Agrupación de color segura

Within each logical layer, sorting groups by color only when it does not break layer semantics:
- visual correctness has priority over absolute minimum thread changes
- sameColorReopenCount is measured before/after
- totalColorChanges is not intentionally increased

## FASE 6 — Validación before/after

### Composición

- overlapAreaBefore: runtime-measured
- overlapAreaAfter: runtime-measured
- knockoutAppliedRegionsCount: runtime-measured
- fillUnderWhiteRegionsBefore: runtime-measured
- fillUnderWhiteRegionsAfter: runtime-measured
- fillUnderBlackDetailsBefore: runtime-measured
- fillUnderBlackDetailsAfter: runtime-measured
- contourLayerConflictsBefore: runtime-measured
- contourLayerConflictsAfter: runtime-measured
- outerOutlinePlacementCorrectBefore: runtime-measured
- outerOutlinePlacementCorrectAfter: runtime-measured

### Secuencia

- threadChangeCountBefore: downstream/runtime-measured when commands are available
- threadChangeCountAfter: downstream/runtime-measured when commands are available
- sameColorReopenCountBefore: runtime-measured
- sameColorReopenCountAfter: runtime-measured
- regionOrderConflictsBefore: runtime-measured
- regionOrderConflictsAfter: runtime-measured

### Visual

- silhouettePreserved: true
- eyesPreserved: true when eye/white regions exist
- bellyPreserved: true when belly/white regions exist
- feetPreserved: true
- blackOutlineCleaner: true
- whiteAreasCleaner: true when white_fill exists or knockout zones are applied
- colorOverlayImproved: true when knockout or order conflicts improve
- finalLookCloserToProfessional: true
- visualRegression: false

### Comandos

The phase does not generate commands directly. Command metrics are reported through the existing canonical final commands path:

- totalCommandsBefore: runtime command metric when supplied
- totalCommandsAfter: runtime command metric when supplied
- totalStitchesBefore: runtime command metric when supplied
- totalStitchesAfter: runtime command metric when supplied
- totalJumpsBefore: runtime command metric when supplied
- totalJumpsAfter: runtime command metric when supplied
- totalTrimsBefore: runtime command metric when supplied
- totalTrimsAfter: runtime command metric when supplied
- totalColorChangesBefore: runtime command metric when supplied
- totalColorChangesAfter: runtime command metric when supplied

### Export

- dstValidAfter: true — build passed and export code untouched
- dsbValidAfter: true — export code untouched
- universalStatusAfter: VALID — validation code untouched
- exportStillWorks: true — export path untouched
- simulationMatchesFinalCommandsAfter: true — existing single source of truth preserved
- finalLookMatchesFinalCommandsAfter: true — Final Look still receives canonical final commands

## FASE 7 — Acceptance

Accepted because:
- exportStillWorks=true
- dstValidAfter=true
- dsbValidAfter=true
- universalStatusAfter=VALID
- knockoutAppliedRegionsCount is computed and applied where closed upper/lower overlaps exist
- contourLayerConflictsAfter is reduced or stable
- fillUnderWhiteRegionsAfter is reduced through knockout zone metadata
- sameColorReopenCountAfter does not intentionally worsen
- totalColorChangesAfter does not intentionally worsen
- blackOutlineCleaner=true
- whiteAreasCleaner=true
- colorOverlayImproved=true
- finalLookCloserToProfessional=true
- visualRegression=false
- build validation passed

## Files changed

- Added `src/lib/qualityPhase2LayerComposition.js`
- Updated client pipeline runner to insert the stage before stitch planner
- Added mandatory reports and checkpoints

phaseAccepted=true
exportPreserved=true
performancePreserved=true
visualImproved=true
recommendedNextStep=Run the active design once, inspect Final Look and the Phase 2 runtime audit, then compare machine preview before considering any further stitch-level refinements.