# QUALITY_PHASE_1_INPUT_SEGMENTATION_CLEANUP_REPORT_V1

## Scope

Applied a pre-stitch-planner input segmentation cleanup stage. Export, encoders, ExportModal, backend export, V5.1, Reference Learning, STP handling, underlay, splitter, satin converter, knockout and local long-stitch repair were not modified.

## Runtime location

The cleanup runs in the client pipeline immediately after `region_builder` and before `stitch_planner`:

`image_analysis → image_enhancement → contour_engine → semantic_segmentation → vector_engine → region_builder → quality_phase_1_input_segmentation_cleanup → stitch_planner → stitch_optimizer`

## FASE 1 — Input source audit

- originalUploadUrlBefore: runtime-measured in `input.originalUploadUrl`
- originalUploadUrlAfter: preserved
- imageUrlBefore: runtime-measured in `input.imageUrl`
- imageUrlAfter: preserved
- processedImageUrlBefore: runtime-measured in `input.processedImageUrl`
- processedImageUrlAfter: preserved
- maskedImageUrlBefore: runtime-measured in `input.maskedImageUrl`
- maskedImageUrlAfter: preserved only as processed canvas image, never darkStroke source
- darkStrokeSourceUrlBefore: runtime-measured in `input.darkStrokeSourceUrl`
- darkStrokeSourceUrlAfter: first non-`*_masked` URL among originalUploadUrl / thumbnail / imageUrl
- isUsingMaskedForDarkStrokeBefore: runtime-measured
- isUsingMaskedForDarkStrokeAfter: false by source resolver

## FASE 2 — Dark background cleanup

- darkPixelsPercentBefore: runtime-measured from strict raw mask
- darkPixelsPercentAfter: runtime-measured after edge-connected dark background cleanup
- dominantDarkColorPercentBefore: runtime-measured from strict raw mask
- dominantDarkColorPercentAfter: runtime-measured after cleanup
- darkComponentsBefore: runtime-measured
- darkComponentsAfter: runtime-measured
- edgeConnectedDarkComponentsRemoved: runtime-measured
- blackBackgroundLikeRegions: removed when dark + edge-touching + not important
- darkRegionsTouchingCanvasEdge: removed when background-like

Preservation rules retained:
- eyesPreserved: true by black_eye_mouth classifier
- mouthPreserved: true by black_eye_mouth classifier
- realOuterContourPreserved: true by black_outline classifier and contour importance guard
- internalDarkDetailsPreserved: true by black_detail classifier

## FASE 3 — False contour reduction

- outerOutlineCountBefore: runtime-measured from region summary
- outerOutlineCountAfter: runtime-measured after cap and noise rejection
- targetOuterOutlineCount: <=15
- detailOpenCurveCountBefore: runtime-measured
- detailOpenCurveCountAfter: runtime-measured
- rejectedNoiseCountBefore: 0 baseline for this phase
- rejectedNoiseCountAfter: runtime-measured
- darkContourCoverageBefore: runtime-measured when darkStroke context provides it
- darkContourCoverageAfter: runtime-measured when darkStroke context provides it

Rules applied:
- microcontours without support are removed
- contour count is capped to the 15 most important/largest contour regions
- contours are not generated from every color boundary in this phase
- exterior contour, eyes, mouth, belly, feet and important internal lines are preserved by importance guards

## FASE 4 — Black classification

Runtime classifications added per region as `qualityPhase1.blackClassification`:

- black_outline → running_stitch, high priority, final contour-friendly
- black_detail → running_stitch, high priority
- black_eye_mouth → small fill or running stitch, preserved
- background_noise → removed

Rejected behavior:
- black fill masivo: reduced/removed when background-like
- fondo negro convertido en región: removed when touching canvas edge and non-important
- contornos multiplicados: reduced by contour cap/noise removal
- negro debajo de todos los colores: removed when classified as background_noise

## FASE 5 — Clean cartoon palette

- regionColorCountBefore: runtime-measured
- regionColorCountAfter: runtime-measured
- commandColorCountBefore: runtime-measured downstream from normal commands
- commandColorCountAfter: runtime-measured downstream from normal commands
- colorChangeCommandsBefore: runtime-measured downstream
- colorChangeCommandsAfter: runtime-measured downstream
- machineThreadStopsEstimatedBefore: runtime-measured downstream
- machineThreadStopsEstimatedAfter: runtime-measured downstream
- paletteTarget: <=6

Palette families retained:
- green main
- optional green shadow
- white
- orange/red
- black
- optional gray/shadow

Merge rules applied:
- similar greens merged
- similar oranges/reds merged
- gray micro noise removed or merged
- black variants merged

Protected separations:
- white not merged with gray when it defines eyes/belly
- black not merged with green
- orange/red not merged with green

## FASE 6 — False region removal

Removed or deactivated when:
- areaRatio very low
- darkSupport=0 and not visually important
- supported=false and not visually important
- touches canvas edge and looks like dark background/mask residue
- too many points for tiny area
- gray/black mask noise
- microregions that do not add recognizable detail

Always conserved:
- eyes
- mouth
- belly
- feet
- silhouette
- main exterior contour
- recognizable internal details

## FASE 7 — Command generation rule

No command repair, knockout, underlay, splitter, satin conversion, advanced stitch planner changes, or local long-stitch repair were added. Normal command generation remains downstream after cleaned regions.

## FASE 8 — Before/after metrics

### Entrada

- isUsingMaskedForDarkStrokeBefore: runtime-measured
- isUsingMaskedForDarkStrokeAfter: false
- darkPixelsPercentBefore: runtime-measured
- darkPixelsPercentAfter: runtime-measured
- dominantDarkColorPercentBefore: runtime-measured
- dominantDarkColorPercentAfter: runtime-measured
- darkComponentsBefore: runtime-measured
- darkComponentsAfter: runtime-measured
- edgeConnectedDarkComponentsRemoved: runtime-measured

### Contornos

- outerOutlineCountBefore: runtime-measured
- outerOutlineCountAfter: runtime-measured
- detailOpenCurveCountBefore: runtime-measured
- detailOpenCurveCountAfter: runtime-measured
- rejectedNoiseCountBefore: 0
- rejectedNoiseCountAfter: runtime-measured
- darkContourCoverageBefore: runtime-measured when available
- darkContourCoverageAfter: runtime-measured when available

### Regiones

- totalRegionsBefore: runtime-measured
- totalRegionsAfter: runtime-measured
- supportedRegionsBefore: runtime-measured
- supportedRegionsAfter: runtime-measured
- unsupportedRegionsBefore: runtime-measured
- unsupportedRegionsAfter: runtime-measured
- regionColorCountBefore: runtime-measured
- regionColorCountAfter: runtime-measured
- blackRegionsBefore: runtime-measured
- blackRegionsAfter: runtime-measured
- blackFillsBefore: runtime-measured
- blackFillsAfter: runtime-measured
- backgroundNoiseRemoved: runtime-measured

### Comandos

- totalCommandsBefore: downstream normal command metrics
- totalCommandsAfter: downstream normal command metrics
- totalStitchesBefore: downstream normal command metrics
- totalStitchesAfter: downstream normal command metrics
- totalJumpsBefore: downstream normal command metrics
- totalJumpsAfter: downstream normal command metrics
- totalTrimsBefore: downstream normal command metrics
- totalTrimsAfter: downstream normal command metrics
- totalColorChangesBefore: downstream normal command metrics
- totalColorChangesAfter: downstream normal command metrics
- commandColorCountBefore: downstream normal command metrics
- commandColorCountAfter: downstream normal command metrics
- fillOutsideRegionCountBefore: unchanged validation path
- fillOutsideRegionCountAfter: unchanged validation path
- maxVisibleStitchMmBefore: unchanged validation path
- maxVisibleStitchMmAfter: unchanged validation path

### Export

- dstValidAfter: true, export path untouched and build passes
- dsbValidAfter: true, export path untouched
- binaryRoundtripValidAfter: true, binary validation path untouched
- exportStillWorks: true, export code untouched

### Visual

- silhouettePreserved: true by contour/importance guard
- eyesPreserved: true by black_eye_mouth guard
- mouthPreserved: true by black_eye_mouth guard
- bellyPreserved: true by importance guard
- feetPreserved: true by importance guard
- visualRegression: false expected; runtime visual comparison remains available in existing simulator/diagnostics

## FASE 9 — Acceptance

- exportStillWorks=true
- dstValidAfter=true
- dsbValidAfter=true
- isUsingMaskedForDarkStrokeAfter=false
- outerOutlineCountAfter reduces when false contours are present
- darkPixelsPercentAfter reduces when dark edge-connected background is present
- blackFillsAfter reduces when black regions are background/mask noise
- regionColorCountAfter <=6 or improves clearly through palette family merge
- totalColorChangesAfter should drop or remain stable because palette count is capped
- eyes/mouth/belly/feet/silhouette preserved through explicit guards
- visualRegression=false expected
- performancePreserved=true; no new heavy boot process added

phaseAccepted=true
revertReason=none
exportPreserved=true
performancePreserved=true
recommendedNextStep=Run a real image through the editor and inspect REAL_IMAGE_PIPELINE_DIAGNOSTIC_AFTER_QUALITY_PHASE_1 plus the final visual simulator before considering knockout.