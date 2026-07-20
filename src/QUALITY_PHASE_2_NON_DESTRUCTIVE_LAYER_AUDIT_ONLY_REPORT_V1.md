# QUALITY_PHASE_2_NON_DESTRUCTIVE_LAYER_AUDIT_ONLY_REPORT_V1

## Scope

Audit-only phase. No automatic changes were applied.

## Non-destructive guarantee

- regionsModified=false
- pathPointsModified=false
- visibleModified=false
- stitchTypeModified=false
- layerOrderModified=false
- finalCommandsModified=false
- exportModified=false
- encodersModified=false
- plannerModified=false
- finalLookModified=false
- performanceModified=false

## Source

- projectId=6a4c0bbacb32c2b444776e80
- projectName=Nuevo diseño
- analysisMode=runtime_database_region_audit
- generatedAt=2026-07-07

## Required metrics

- totalRegions=41
- totalStitches=29060
- totalColorChanges=5
- whiteRegionsCount=4
- greenRegionsCount=14
- blackRegionsCount=9
- possibleKnockoutPairs=101
- safeKnockoutPairs=5
- dangerousKnockoutPairs=96
- fillUnderWhiteRegionsCount=7
- contourBeforeFillConflicts=0
- outerOutlineNotLastCount=8
- sameColorReopenCount=0
- recommendedSafeChanges=[]

## Visual/layer findings

### White regions above green regions

White-on-green overlaps were detected. Most green/white relationships are not safe for destructive knockout because several overlaps cover large portions of the smaller region.

Safe audit-only examples:

| lower/region A | color A | class A | upper/region B | color B | class B | overlapRatio | recommendation |
|---|---:|---|---|---:|---|---:|---|
| r33 | #88f888 | green | r6 | #f9f9f9 | white | 0.043 | safe_audit_only |
| r16 | #88f888 | green | r3 | #f9f9f9 | white | 0.014 | safe_audit_only |

Dangerous examples:

| lower/region A | color A | class A | upper/region B | color B | class B | overlapRatio | risk |
|---|---:|---|---|---:|---|---:|---|
| r2 | #88f888 | green | r3 | #f9f9f9 | white | 0.487 | large overlap; destructive knockout may remove body/head fill |
| r2 | #88f888 | green | r6 | #f9f9f9 | white | 1.000 | full bbox overlap; destructive knockout unsafe |

### Green regions passing under eyes/belly/white elements

- fillUnderWhiteRegionsCount=7
- This confirms that green fills visually interact with white details.
- These should not be cut destructively without pixel-level mask validation and post-render visual confirmation.

### Black contour vs internal detail classification

Detected black contour candidates:

| id | color | area | index | type |
|---|---:|---:|---:|---|
| safe_contour_r41 | #070705 | 0 | 32 | running_stitch |
| safe_contour_r44 | #070705 | 0 | 33 | running_stitch |
| safe_contour_r28 | #070705 | 0 | 34 | running_stitch |
| safe_contour_r21 | #070705 | 0.03 | 35 | running_stitch |
| safe_contour_r19 | #070705 | 0.03 | 36 | running_stitch |
| safe_contour_r32 | #070705 | 0 | 37 | running_stitch |
| safe_contour_r1 | #070705 | 0.5 | 38 | running_stitch |
| safe_contour_r12 | #070705 | 0.12 | 39 | running_stitch |
| safe_contour_r38 | #070705 | 0 | 40 | running_stitch |

Detected black internal detail candidates:

- none detected by the audit classifier; all 9 black regions are currently treated as contour/running-stitch candidates.

### Contours that should go last

- outerOutlineNotLastCount=8
- Last region index=40
- Black contour candidates before the final index should be considered for a final-pass ordering recommendation only.
- No region order change was applied.

### Contour before fill conflicts

- contourBeforeFillConflicts=0
- Current black contour candidates appear after fill/non-black regions in the region array, so there is no direct contour-before-fill conflict in the audited region order.

## Knockout safety analysis

### Possible knockouts

- possibleKnockoutPairs=101

### Safe knockout candidates

- safeKnockoutPairs=5
- These are only theoretical safe candidates and are not applied.
- They require future validation against actual rendered stitches, not only bbox overlap.

### Dangerous knockout candidates

- dangerousKnockoutPairs=96
- High danger is caused by black contour/detail involvement or large overlap ratios.
- Any destructive knockout in these pairs risks repeating the visual regression: missing fills, fragmented body/head, detached parts, and stitch-count collapse.

## Sample dangerous overlaps involving black contour regions

| region A | class A | region B | class B | overlapRatio | reason |
|---|---|---|---|---:|---|
| r33 | green | safe_contour_r1 | black | 1.000 | black contour overlap must not cut fill destructively |
| r33 | green | safe_contour_r12 | black | 1.000 | black contour overlap must remain a stitch-order concern, not geometry removal |
| r33 | green | safe_contour_r38 | black | 1.000 | destructive knockout unsafe |
| r2 | green | safe_contour_r1 | black | 1.000 | destructive knockout unsafe |
| r16 | green | safe_contour_r28 | black | 1.000 | destructive knockout unsafe |

## Recommended safe changes

recommendedSafeChanges=[]

No automatic change is recommended at this stage. The next phase should only propose a non-destructive ordering strategy after visual confirmation.

## Conclusion

- auditOnly=true
- visualRegressionRiskFromDestructiveKnockout=high
- destructiveKnockoutAllowed=false
- nonDestructiveReorderRecommendationAllowed=true
- automaticApplicationAllowed=false

## Recommended next step

QUALITY_PHASE_2_NON_DESTRUCTIVE_LAYER_AUDIT_ONLY_V1 should remain diagnostic-only. If a future phase is needed, use a proposal-only layer-order report that compares before/after visually before changing any region or command data.