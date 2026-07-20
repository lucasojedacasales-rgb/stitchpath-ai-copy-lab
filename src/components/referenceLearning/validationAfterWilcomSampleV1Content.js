export const VALIDATION_AFTER_WILCOM_SAMPLE_V1_MD = `# REFERENCE_LEARNING_VALIDATION_AFTER_WILCOM_SAMPLE_V1

## Current design validation after Wilcom accepted sample

- currentDesignTotalStitches≈14203
- currentDesignNoLongerPenalizedBy12000=true
- universalValidationStatus=VALID_OR_WARNING_EXPECTED
- formatValidationStatus=VALID_OR_WARNING_EXPECTED
- machineProfileStatus=VALID_OR_WARNING_EXPECTED
- exportAllowed=true_if_no_real_invalid_reasons
- warnings=["Stitch count over 12000 is not a warning by itself after observed Wilcom accepted sample", "Warnings may still appear for real format, coordinate, END, trim, jump, or visual quality issues"]
- invalidReasons=[]

## Acceptance logic
A design with about 14203 stitches is below the observed accepted Wilcom sample of about 33845 stitches and must not be rejected or degraded only because of total stitch count.

## Real blockers only
Invalid status must be caused by real issues such as NaN coordinates, undefined coordinates, broken sequence, missing END in encoded file, encoder error, coordinate overflow, or hoop/format incompatibility — never by the old 12000 stitch limit.
`;