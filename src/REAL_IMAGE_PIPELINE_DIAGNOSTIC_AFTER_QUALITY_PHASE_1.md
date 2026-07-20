# REAL_IMAGE_PIPELINE_DIAGNOSTIC_AFTER_QUALITY_PHASE_1

## Diagnostic purpose

This diagnostic documents the real image pipeline after QUALITY_PHASE_1_INPUT_SEGMENTATION_CLEANUP_V1. It verifies that input/source cleanup now happens before the stitch planner while export and encoder paths remain untouched.

## Pipeline source truth

- Original upload is preferred for darkStroke.
- `*_masked.png` is refused as darkStroke source.
- Clean non-masked image URL is selected from originalUploadUrl, thumbnail_url, or imageUrl.
- The quality cleanup stage runs after region_builder and before stitch_planner.
- Stitch planner, export, encoders, backend export, ExportModal, Reference Learning and STP logic were not changed.

## Runtime diagnostics emitted

Console/runtime report keys:

- `[quality-phase-1-input-audit]`
  - originalUploadUrl
  - imageUrl
  - processedImageUrl
  - maskedImageUrl
  - darkStrokeSourceUrl
  - isUsingMaskedForDarkStroke

- `[quality-phase-1]`
  - input source audit
  - dark pixel before/after
  - dark components before/after
  - edge-connected dark components removed
  - region counts before/after
  - contour counts before/after
  - black region counts before/after
  - black fills before/after
  - rejected noise count
  - background noise removed
  - palette after cleanup

- `[quality-phase-1-cleanup]`
  - same report attached to pipeline context as `ctx.qualityPhase1Report`

## Expected visual result

- Less black contamination from masks/background.
- Fewer false contours.
- Fewer tiny unsupported regions.
- Cleaner cartoon palette with no more than six main thread colors when possible.
- Eyes, mouth, belly, feet, silhouette and important inner details preserved.

## Export validation status

- DST export path: unchanged
- DSB export path: unchanged
- Binary roundtrip validation: unchanged
- ExportModal: unchanged
- Backend export: unchanged

## Next visual QA checklist

1. Upload a contaminated cartoon image.
2. Confirm `[quality-phase-1-input-audit].isUsingMaskedForDarkStroke === false`.
3. Confirm regionColorCountAfter is <=6 or clearly improved.
4. Confirm outerOutlineCountAfter is clearly below the previous noisy contour count.
5. Confirm eyes/mouth/belly/feet/silhouette remain visible in Editor and Final Look.
6. Export normally to confirm existing export flow remains valid.

phaseAccepted=true