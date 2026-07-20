# EXPORT_BLOCKING_ROOT_CAUSE_REPORT_V1

exportAllowed=true
blockingReason=none_unless_hard_command_or_file_error
blockingModule=emergencyHardExportGate
oldCe01LimitStillPresent=false
universalStatus=diagnostic_only_for_warnings
formatStatusDST=allowed_when_commands_are_valid
formatStatusDSB=diagnostic/experimental_but_not_hard_blocked_by_stitch_count
machineProfileStatus=diagnostic_only_unless_hard_command_error
finalCommandsAvailable=true_when_Editor_or_Export_builds_finalEmbroideryCommands
encoderErrors=[]
recommendedFix=Use ExportBlockingCausePanel. If blocked, fix the specific hard reason shown: commands_empty, nan_or_undefined_coordinates, impossible_coordinates, missing_end_command, duplicate_end_command, end_not_last, unsupported_format, file_has_no_stitch_data, or encoder failure.

## Removed false blockers
- totalStitches > 12000 no longer blocks.
- Reference Learning incomplete no longer blocks.
- Visual warnings no longer block.
- stitchedTravel/visibleDiagonal diagnostics no longer block.
- machine profile warnings no longer block.
- Universal/CE01 risky state no longer blocks without a hard command/file error.
- Adaptive stability score no longer blocks the standard export route during emergency stabilization.