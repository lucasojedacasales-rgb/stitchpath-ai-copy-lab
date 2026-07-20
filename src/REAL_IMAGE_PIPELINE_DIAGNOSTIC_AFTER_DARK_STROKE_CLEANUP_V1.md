# REAL_IMAGE_PIPELINE_DIAGNOSTIC_AFTER_DARK_STROKE_CLEANUP_V1

This diagnostic is generated after DARK_STROKE_SOURCE_AND_CARTOON_SEGMENTATION_CLEANUP_V1.

## Expected runtime source flags
- DARKSTROKE_USING_ORIGINAL_UPLOAD_BITMAP
- isUsingMaskedForDarkStroke=false
- darkStrokeSource=original_upload_bitmap
- source=strict_raw_original_bitmap
- processedImageUrl may still be used for preview/vectorization, but not for dark stroke detection.

## Runtime metrics to verify in the diagnostic ZIP
- rawDarkPixelsBefore = darkStroke.rawDarkPixelsBefore
- rawDarkPixelsAfter = darkStroke.rawDarkPixelsAfter
- darkBackgroundDetected = darkStroke.darkBackgroundDetected
- darkBackgroundPixelsRemoved = darkStroke.darkBackgroundPixelsRemoved
- edgeConnectedDarkComponentsRemoved = darkStroke.edgeConnectedDarkComponentsRemoved
- darkComponentsBefore = darkStroke.darkComponentsBefore
- darkComponentsAfter = darkStroke.darkComponentsAfter
- outerOutlineCount = universal dark contour report outerOutlineCount
- detailOpenCurveCount = universal dark contour report detailOpenCurveCount
- rejectedNoiseCount = universal dark contour report rejectedNoiseCount
- regionCount = current visual regions count
- supportedRegionCount = regions not marked unsupported
- unsupportedRegionCount = regions marked supported=false or darkSupport=0
- uniqueThreadColors = visual thread colors after cleanup
- totalStitches / jumps / trims / colorChangeCommands = finalEmbroideryCommands metrics
- shortStitches / duplicateStitches / excessiveDensityMax = runtime forensics metrics
- universalStatus / dstStatus / dsbStatus = export validation reports

## Acceptance checklist
- isUsingMaskedForDarkStroke=false
- outerOutlineCount significantly below prior 85, target <= 12
- eyes/mouth/main outline/orange feet/belly preserved visually
- short stitches and duplicate stitches reduced after regeneration
- density max reduced after regeneration
- DST remains VALID
- DSB remains VALID
- visualRegression=false