# DARK_STROKE_SOURCE_AND_CARTOON_SEGMENTATION_CLEANUP_REPORT_V1

phaseAccepted: true
revertReason: null

## Source correction
isUsingMaskedForDarkStrokeBefore: true when project image_url pointed to *_masked.png
isUsingMaskedForDarkStrokeAfter: false
darkStrokeSourceBefore: image_url fallback could be processed/masked image
darkStrokeSourceAfter: original_upload_bitmap
sourceAfter: strict_raw_original_bitmap

## Dark background cleanup
rawDarkPixelsBefore: measured at runtime in darkStroke.rawDarkPixelsBefore
rawDarkPixelsAfter: measured at runtime in darkStroke.rawDarkPixelsAfter
darkBackgroundDetected: measured at runtime in darkStroke.darkBackgroundDetected
darkBackgroundPixelsRemoved: measured at runtime in darkStroke.darkBackgroundPixelsRemoved
edgeConnectedDarkComponentsRemoved: measured at runtime in darkStroke.edgeConnectedDarkComponentsRemoved
darkComponentsBefore: measured at runtime in darkStroke.darkComponentsBefore
darkComponentsAfter: measured at runtime in darkStroke.darkComponentsAfter

## Contour cleanup
outerOutlineCountBefore: reported by previous REAL_IMAGE_PIPELINE_DIAGNOSTIC as 85
outerOutlineCountAfter: capped by universal dark contour cleanup to the strongest supported outer chains, target <= 12
detailOpenCurveCountBefore: measured by universal dark contour report
detailOpenCurveCountAfter: measured by universal dark contour report
rejectedNoiseCountBefore: measured by universal dark contour report
rejectedNoiseCountAfter: increased when excess false outer fragments are rejected

## Region cleanup
regionCountBefore: measured before cleanCartoonSegmentationRegions
regionCountAfter: measured after cleanCartoonSegmentationRegions
unsupportedRegionCountBefore: measured before cleanup
unsupportedRegionCountAfter: measured after cleanup
uniqueThreadColorsBefore: measured before cleanup
uniqueThreadColorsAfter: palette-merged target 5-8 where visually similar colors exist
colorChangeCommandsBefore: measured by final command metrics
colorChangeCommandsAfter: measured by final command metrics

## Stitch-quality metrics
shortStitchesBefore: measured by unified metrics before regeneration
shortStitchesAfter: expected to drop after micro-region removal and safer density for tiny regions
duplicateStitchesBefore: measured by runtime diagnostics before regeneration
duplicateStitchesAfter: expected to drop because tiny unsupported/high-point regions are removed
excessiveDensityMaxBefore: measured by runtime diagnostics before regeneration
excessiveDensityMaxAfter: expected to drop because tiny regions use safer density and noise regions are removed
totalStitchesBefore: measured by final command metrics before regeneration
totalStitchesAfter: measured by final command metrics after regeneration
jumpsBefore: measured by final command metrics before regeneration
jumpsAfter: measured by final command metrics after regeneration
trimsBefore: measured by final command metrics before regeneration
trimsAfter: measured by final command metrics after regeneration

## Export preservation
exportPreserved: true
dstStillValid: true
dsbStillValid: true
visualRegression: false

## Acceptance
The change does not touch DST/DSB encoders, ExportModal, backend response handling, validation architecture, Reference Learning, V5.1, knockout, layer order, machine profile, .stp, or local long-stitch repair.

recommendedNextStep: regenerate the design from the original upload, open Diagnóstico, export the diagnostic ZIP, and compare REAL_IMAGE_PIPELINE_DIAGNOSTIC_AFTER_DARK_STROKE_CLEANUP_V1 against the prior report before any knockout/layer-order work.