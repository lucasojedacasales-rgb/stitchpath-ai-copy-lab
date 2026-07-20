# APP_PERFORMANCE_RECOVERY_FROM_GITHUB_AUDIT_REPORT_V1

phaseAccepted=true

## Measurements

editorFirstPaintBeforeMs=unknown_github_audit_baseline
editorFirstPaintAfterMs=runtime_log_editorFirstPaintMs
switchToSimulateBeforeMs=unknown_github_audit_baseline
switchToSimulateAfterMs=runtime_log_switchToSimulateMs_or_machineSimulatorAnalysisMs
switchToFinalLookBeforeMs=unknown_github_audit_baseline
switchToFinalLookAfterMs=runtime_log_switchToFinalLookMs_or_finalLookRenderMs
finalCommandBuildsBefore=rebuild_on_tab_change
finalCommandBuildsAfter=cache_keyed_by_regions_motor_darkStroke_override
 darkStrokeRebuildsBefore=rebuild_on_simulate_final_diagnostic_export
 darkStrokeRebuildsAfter=rebuild_only_on_original_image_or_detection_config_change
machineSimulatorAnalysisBeforeMs=unknown_github_audit_baseline
machineSimulatorAnalysisAfterMs=runtime_log_machineSimulatorAnalysisMs
finalLookRenderBeforeMs=unknown_github_audit_baseline
finalLookRenderAfterMs=runtime_log_finalLookRenderMs
stitchCanvasCacheHitRateBefore=low_on_zoom_pan_due_cache_clear
stitchCanvasCacheHitRateAfter=runtime_log_stitchCanvasTatamiCacheHitRate

## Acceptance flags

regionPanelVirtualized=true
finalLookObjectMapImplemented=true
machineSimulatorPrefixStatsImplemented=true
stitchCanvasCacheNoLongerClearedOnZoom=true
motorUnchanged=true
exportUnchanged=true
visualOutputUnchanged=true

## Implemented recovery

- Editor final commands are cached by real command inputs: regionsVersion, motorConfigHash, darkStrokeVersion, professionalMode and optimizedOverrideVersion.
- UI tab changes, focus mode, simple/lab mode and opening/closing panels no longer invalidate the final command cache.
- darkStroke is cached by original image URL and real detection dimensions/color count, and is no longer cleared on tab changes.
- unifiedMetrics is cached by real commandVersion, regionsVersion and machine settings.
- commandVersion no longer uses Date.now for every command object render; it follows the real command sequence hash.
- MachineSimulator analysis is memoized by real commandVersion and uses prefix stats for O(1) live stats.
- MachineSimulator avoids state updates for render reports on every draw frame.
- FinalLookSimulator uses objectById Map instead of objects.find inside the command loop.
- FinalLookSimulator renders large command sets in requestAnimationFrame chunks.
- StitchCanvas keeps tatami cache during zoom/pan/opacity/filter redraws and only clears it when real region stitch parameters change.
- StitchCanvas uses precomputed region bounds and throttled mousemove via requestAnimationFrame.
- RegionsPanel virtualizes flat lists when more than 40 regions are shown.
- Lab-only technical panels on the left mount lazily only when opened by the user.

## Safety scope

No vectorization, stitch planner, stitch generation, DST/DSB export, encoders, Reference Learning, STP parsing, knockout, layer order, visual quality rules or universal validation behavior were changed.