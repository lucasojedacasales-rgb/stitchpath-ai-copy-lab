# P8 - Physical Failure Propagation

## Final status

P8-F1 is technically approved.

The final accredited execution completed:

- Test files: 11/11 passed.
- Tests: 515/515 passed.
- P8 tests: 10/10 passed.
- Failures: 0.
- Vitest warnings: 0.
- Duration: 16.99 seconds.
- Executions during P8-F1C: exactly one.

P8 is pending only an administrative audit, commit, and push. It remains
uncommitted and unpublished at the time of this report.

## Scope and inventory

P8 is limited to propagation of individual physical generator failures. Its
final inventory contains exactly:

- `src/lib/engineV2/stitchGeneration/satinStitchGenerator.js`
- `src/lib/engineV2/stitchGeneration/physicalStitchPipeline.js`
- `src/lib/engineV2/__tests__/physicalFailurePropagation.test.js`
- `src/lib/engineV2/P8_PHYSICAL_FAILURE_PROPAGATION_REPORT.md`

P8 did not modify:

- `physicalStitchValidation.js`
- `physicalGenerationConfig.js`
- `internalPipeline.js`
- `canonicalCommandCompiler.js`

It also did not change binary encoding, machine adaptation, export, Base44
integration, or any P0-P7 fixture or implementation.

Additional defensive hardening of validators or generators for malformed
geometry is outside this scope and was not implemented. No independent P8-F2
phase was started.

## Original problem

Before P8, a physical satin generator failure followed this path:

1. `SATIN_WIDTH_ABOVE_MAXIMUM` was retained only in
   `disposition.evidence`.
2. `physicalPlan.errors` remained empty.
3. `physicalPlan.valid` remained `true`.
4. The internal pipeline continued into `canonicalCompilation`.
5. Canonical compilation observed the absent physical path and reported only
   `PHYSICAL_PATH_MISSING`.

The `blockGeneratorFailure` configuration field already existed, but it did not
govern this generator-failure branch. The original causal error therefore did
not act as a fail-fast physical-stage contract.

## Final productive contract

### Deterministic satin cause

`SATIN_WIDTH_ABOVE_MAXIMUM` now preserves deterministic diagnostic fields:

- physical generation stage;
- `satin` generator identity;
- actual maximum width;
- configured maximum width;
- boundary tolerance;
- offending section count.

The comparison criterion itself is unchanged: maximum width plus the exact
boundary tolerance remains accepted, while a width immediately above that
boundary is rejected.

### Context and blocking behavior

`physicalStitchPipeline.js` contextualizes each retained cause with:

- `objectId`;
- generator;
- physical generation stage.

With `blockGeneratorFailure: true`, the pipeline:

1. preserves the object disposition as `blocked`;
2. propagates one consolidated satin root cause;
3. appends `PHYSICAL_GENERATOR_FAILED` after the root cause;
4. marks `physicalPlan.valid` as `false`;
5. causes `internalPipeline` to stop at `physicalGeneration`.

Valid paths generated for other objects remain present for diagnosis. The
failed object receives no physical path.

With `blockGeneratorFailure: false`, explicit legacy compatibility is
preserved: the failed-object disposition and its consolidated diagnostic
evidence remain available, but the generator failure does not invalidate the
physical plan globally.

`PHYSICAL_PATH_MISSING` remains unchanged as a secondary canonical defense for
manipulated plans, legacy plans, or direct calls to canonical compilation.

## P8-F1B cause consolidation

Center-run, zigzag, and top generation could produce three
`SATIN_WIDTH_ABOVE_MAXIMUM` entries for the same object. P8-F1B consolidates
those entries into one logical satin-width cause.

The consolidation contract:

- prioritizes the top cause when a top cause exists;
- retains one deterministic underlay cause when only underlay fails;
- does not add together `offendingSectionCount`;
- does not manufacture or combine metrics;
- does not remove distinct error codes;
- preserves deterministic causal order:

```text
SATIN_WIDTH_ABOVE_MAXIMUM
PHYSICAL_GENERATOR_FAILED
```

## Final P8 test matrix

The suite contains exactly ten tests with these names and accredited purposes:

1. `keeps a nominal satin width valid and produces a physical path`
   confirms valid nominal satin generation and generated path points.
2. `accepts satin width exactly at maximum plus boundary tolerance`
   confirms the exact tolerance boundary remains valid.
3. `rejects width immediately above tolerance with complete causal metrics`
   confirms the causal error and all deterministic width metrics.
4. `propagates root cause and wrapper into an invalid physical plan`
   confirms the default flag invalidates the physical plan and orders the root
   cause before its wrapper.
5. `stops at physicalGeneration without replacing the cause with path missing`
   confirms internal fail-fast behavior and preservation of the causal error.
6. `retains successful paths from other objects while blocking the failed object`
   confirms the failed object has no path while valid paths remain available.
7. `preserves legacy non-blocking behavior when blockGeneratorFailure is false`
   confirms explicit legacy compatibility and consolidated disposition
   evidence.
8. `retains PHYSICAL_PATH_MISSING as a secondary canonical defense`
   confirms direct canonical compilation still rejects a manipulated plan
   without paths.
9. `keeps the P6 minimal and P7 representative positive pipelines valid`
   confirms the existing positive pipeline fixtures remain valid.
10. `propagates deterministically without mutating the failing input`
    confirms stable ordering, stable diagnostics, and input immutability.

## Validation history

### P8-F1

- Implemented the initial productive propagation and the ten-test evidence
  suite.
- Its single authorized execution stopped during startup with `spawn EPERM`.
- Vitest loaded 0 suites and executed 0 tests.

### P8-R1

- Vitest loaded successfully.
- The ten previous suites passed 505/505 tests.
- The new P8 suite registered 0 tests because its module import failed.
- The cause was the nonexistent imported symbol
  `P7_REPRESENTATIVE_REGION_IDS`.

### P8-D1 and P8-F1A

- Static diagnosis established `REPRESENTATIVE_REGION_IDS` as the contractual
  fixture export.
- The suite imported it under the required local alias.
- The single F1A execution completed 508 passes and 7 failures out of 515
  tests.

### P8-D2 and P8-F1B

- Test geometry was corrected from `points` to the contractual `geometry`
  field.
- Disposition evidence was corrected from `evidence.errors` to the
  contractual `evidence` array.
- Productive consolidation reduced the three satin-width causes to one
  deterministic logical cause.
- The first F1B execution stopped during startup with `spawn EPERM`, loading 0
  suites.

### P8-R2

- The execution completed 514/515 tests.
- The sole remaining failure was an invalid expectation for the nonexistent
  `result.physicalPath` field.

### P8-D3 and P8-F1C

- Static diagnosis confirmed the actual generated-path contract:
  `result.subpaths[0].points`.
- The final single F1C execution passed 11/11 suites and 515/515 tests,
  including 10/10 P8 tests.
- It completed with 0 failures, 0 Vitest warnings, and a duration of 16.99
  seconds.

No retry occurred within any phase. Every stop condition was respected before
work resumed under a separately authorized phase.

## Technical verdict

P8-F1 is technically approved. The original physical generator error is now
preserved, contextualized, consolidated, and capable of stopping the internal
pipeline at `physicalGeneration` under the default blocking policy. Legacy
non-blocking behavior remains explicitly selectable, valid sibling paths are
retained, and canonical missing-path validation remains available as a
secondary defense.

Only administrative audit, commit, and push remain pending.
