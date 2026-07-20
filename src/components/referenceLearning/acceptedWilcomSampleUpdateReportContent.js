export const ACCEPTED_WILCOM_SAMPLE_UPDATE_REPORT_V1_MD = `# REFERENCE_LEARNING_ACCEPTED_WILCOM_SAMPLE_UPDATE_REPORT_V1

## Summary
REFERENCE_LEARNING_ACCEPTED_WILCOM_SAMPLE_UPDATE_V1 has been applied as a positive observed machine-accepted learning sample.

- referenceStored=true
- machineAcceptedSample=true
- sourceWilcom=true
- observedStitchCount≈33845
- old12000LimitIgnored=true
- learnedPresetUpdated=true
- learnedValuesChanged=["learnedMachineAcceptedStitchRangeMin","learnedMachineAcceptedStitchRangeObserved","learnedMachineAcceptedFormat","learnedMachineAcceptedHoopSize","learnedMachineAcceptedDensityRange","learnedMachineAcceptedTrimRange","learnedMachineAcceptedColorCount","learnedMachineAcceptedMaxStitchMm","learnedMachineAcceptedMaxJumpMm"]
- validationModeStillUniversal=true
- noMotorChanges=true
- noEncoderChanges=true
- noStitchReductionApplied=true

## Stored reference
- referenceType=accepted_machine_sample
- source=Wilcom
- machineAccepted=true
- estimatedStitches=33845
- qualityLabel=GOOD_REFERENCE
- format=DSB
- machineProfile=CE01_observed_accepted
- doNotUseAsStrictLimit=true

## Learning rule
33845 is stored as observed positive acceptance evidence, not as a maximum. 12000 is explicitly ignored as a strict limit. Designs around 14203 stitches must not be penalized only because of stitch quantity.

## Separation of concerns
- universal validity remains separate from observed machine compatibility.
- format validity remains separate from visual quality.
- observed machine compatibility calibrates warnings only, not blockers.
`;