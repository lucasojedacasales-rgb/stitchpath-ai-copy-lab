import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEmbroideryPlanningFixture } from '../fixtures/embroideryPlanningFixture.js';
import { ingestV1RegionsToRegionGraphV2 } from '../ingestion/regionIngestion.js';
import { buildEmbroideryObjectProposalPlan } from '../planning/objectPlanningPipeline.js';
import { planEmbroideryRoleForRegion } from '../planning/embroideryRolePlanner.js';
import { resolveObjectPlanningConfig } from '../planning/planningConfig.js';
import { evaluateHatchHoleProtection } from '../rules/hatchEvidence/holes.js';
import {
  HATCH_EVIDENCE_RULE_IDS,
  resolveHatchEvidenceIntegrationConfig,
} from '../rules/hatchEvidence/profiles.js';
import { evaluateHatchWidthTechniqueCandidate } from '../rules/hatchEvidence/widths.js';
import { analyzeSemanticRegionRoles } from '../semantics/semanticRoleAnalyzer.js';
import { createSemanticRegionAssessmentV2 } from '../semantics/semanticRoleModel.js';

const SATIN_RANGE = 'SATIN-RANGE-OBSERVED-001';
const LOCAL_WIDTH = 'LOCAL-WIDTH-PROFILE-001';
const HOLE_PRESERVE = 'HOLE-PRESERVE-001';
const HOLE_MIN_SIZE = 'HOLE-MIN-SIZE-001';
const DEFAULT_TECHNICAL_CONFIG = Object.freeze({});
const EXPERIMENTAL_SATIN_TECHNICAL_CONFIG = Object.freeze({
  satin: Object.freeze({ maximumWidthMm: 9.18 }),
});

function experimentalConfig(ruleIds = [], context = {}) {
  return {
    hatchEvidenceProfile: 'hatch-a-f-experimental',
    hatchEvidenceRuleFlags: Object.fromEntries(ruleIds.map(ruleId => [ruleId, true])),
    hatchEvidenceContext: {
      fabricProfile: 'Pure Cotton',
      referenceScaleCompatible: true,
      ...context,
    },
  };
}

function rectangle(id, widthMm, heightMm = 16) {
  const x1 = 0.2; const y1 = 0.1;
  return {
    id,
    color: '#111111',
    region_class: 'detail',
    path_points: [[x1, y1], [x1 + widthMm / 100, y1], [x1 + widthMm / 100, y1 + heightMm / 100], [x1, y1 + heightMm / 100]],
  };
}

function locallyWideRectangle(id) {
  return {
    id,
    color: '#111111',
    region_class: 'detail',
    path_points: [
      [0.2, 0.1],
      [0.28, 0.1],
      [0.26, 0.14],
      [0.26, 0.26],
      [0.22, 0.26],
      [0.22, 0.14],
    ],
  };
}

function rotatedRectangle(id, widthMm, heightMm, angleDegrees = 45) {
  const center = { x: 0.5, y: 0.5 };
  const angle = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(angle); const sine = Math.sin(angle);
  const corners = [
    [-widthMm / 2, -heightMm / 2],
    [widthMm / 2, -heightMm / 2],
    [widthMm / 2, heightMm / 2],
    [-widthMm / 2, heightMm / 2],
  ].map(([x, y]) => [
    center.x + (x * cosine - y * sine) / 100,
    center.y + (x * sine + y * cosine) / 100,
  ]);
  return { id, color: '#111111', region_class: 'detail', path_points: corners };
}

function squareHole(sideMm, center = 0.5) {
  const half = sideMm / 200;
  return [[center - half, center - half], [center - half, center + half], [center + half, center + half], [center + half, center - half]];
}

function rotatedSquareHole(diagonalMm, center = 0.5) {
  const half = diagonalMm / 200;
  return [[center, center - half], [center + half, center], [center, center + half], [center - half, center]];
}

function regionWithHoles(id, holes) {
  return {
    id,
    color: '#55aa66',
    region_class: 'body',
    path_points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
    holes,
  };
}

function planOne(source, role, config = {}, technicalConfig) {
  const ingestion = ingestV1RegionsToRegionGraphV2([source], { coordinateSpace: 'normalized' });
  const region = ingestion.regions[0];
  const semanticAssessment = createSemanticRegionAssessmentV2({
    regionId: region.id,
    semanticRole: role,
    confidence: 0.95,
    evidence: [{ code: 'TEST', message: 'Controlled Hatch integration test.' }],
  });
  return planEmbroideryRoleForRegion({
    region,
    graph: ingestion.graph,
    semanticAssessment,
    config: resolveObjectPlanningConfig(config),
    technicalConfig,
  });
}

function buildPlanOne(source, role, config = {}, technicalConfig) {
  const ingestion = ingestV1RegionsToRegionGraphV2([source], { coordinateSpace: 'normalized' });
  const region = ingestion.regions[0];
  const assessment = createSemanticRegionAssessmentV2({
    regionId: region.id,
    semanticRole: role,
    confidence: 0.95,
    evidence: [{ code: 'TEST', message: 'Controlled Hatch integration test.' }],
  });
  const semanticResult = {
    assessments: [assessment],
    byRegionId: { [region.id]: assessment },
  };
  return buildEmbroideryObjectProposalPlan({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    config,
    technicalConfig,
  });
}

function evaluatedRuleIds(proposal) {
  return proposal.source?.hatchEvidence?.evaluations?.map(item => item.ruleId) || [];
}

describe('independent Hatch A/B flags', () => {
  it.each(Array.from({ length: 16 }, (_, mask) => [mask]))('resolves ON/OFF combination %# independently', mask => {
    const requested = Object.fromEntries(HATCH_EVIDENCE_RULE_IDS.map((ruleId, index) => [ruleId, Boolean(mask & (1 << index))]));
    const resolved = resolveHatchEvidenceIntegrationConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: requested,
    });
    expect(resolved.ruleFlags).toEqual(requested);
    expect(resolved.enabledRuleIds).toEqual(HATCH_EVIDENCE_RULE_IDS.filter(ruleId => requested[ruleId]));
  });

  it('evaluates only SATIN-RANGE when it is the sole enabled rule', () => {
    const proposal = planOne(
      rectangle('satin-only', 8),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
    );
    expect(proposal.proposedStitchType).toBe('satin');
    expect(evaluatedRuleIds(proposal)).toEqual([SATIN_RANGE]);
  });

  it('evaluates only LOCAL-WIDTH when it is the sole enabled rule', () => {
    const proposal = planOne(rectangle('local-only', 8), 'internal_feature', experimentalConfig([LOCAL_WIDTH]));
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(evaluatedRuleIds(proposal)).toEqual([LOCAL_WIDTH]);
    expect(proposal.source.hatchEvidence.evaluations[0]).toMatchObject({
      applied: true,
      candidateActionApplied: false,
    });
  });

  it('evaluates only HOLE-PRESERVE when it is the sole enabled rule', () => {
    const proposal = planOne(regionWithHoles('preserve-only', [squareHole(0.8)]), 'primary_shape', experimentalConfig([HOLE_PRESERVE]));
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(evaluatedRuleIds(proposal)).toEqual([HOLE_PRESERVE]);
  });

  it('evaluates only HOLE-MIN-SIZE when it is the sole enabled rule', () => {
    const proposal = planOne(regionWithHoles('minimum-only', [squareHole(0.8)]), 'primary_shape', experimentalConfig([HOLE_MIN_SIZE]));
    expect(proposal.proposedStitchType).toBe('manual');
    expect(evaluatedRuleIds(proposal)).toEqual([HOLE_MIN_SIZE]);
    expect(proposal.evidence.map(item => item.code)).not.toContain('HATCH_B_HOLE_PROTECTION_APPLIED');
  });
});

describe('SATIN-RANGE-OBSERVED-001 safe applicability', () => {
  it.each([13, 16])('includes the observed %s mm height boundary', heightMm => {
    expect(planOne(
      rectangle(`height-${heightMm}`, 8, heightMm),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
    ).proposedStitchType).toBe('satin');
  });

  it.each([12.99, 16.01])('falls back outside the observed %s mm height', heightMm => {
    expect(planOne(
      rectangle(`height-${heightMm}`, 8, heightMm),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
    ).proposedStitchType).toBe('tatami');
  });

  it('includes the 9 mm source-family boundary and falls back immediately above it', () => {
    const boundary = planOne(
      rectangle('width-boundary', 9),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
    );
    expect(boundary.proposedStitchType).toBe('satin');
    expect(boundary.source.hatchEvidence.evaluations[0]).toMatchObject({
      maximumSourceSatinWidthMm: 9,
      maximumObservedSatinWidthMm: 9.18,
    });
    const outsideSourceFamily = planOne(
      rectangle('width-outside', 9.00001),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
    );
    expect(outsideSourceFamily.proposedStitchType).toBe('tatami');
    expect(outsideSourceFamily.source.hatchEvidence.evaluations[0].fallbackReason)
      .toBe('width_above_source_family');
  });

  it.each([
    [9, true, null],
    [9 + 0.5e-6, true, null],
    [9 + 1e-6, true, null],
    [9 + 2e-6, false, 'width_above_source_family'],
  ])('uses one source-family predicate at the exact %s mm probe', (widthMm, applied, fallbackReason) => {
    const result = evaluateHatchWidthTechniqueCandidate({
      legacyTechnique: 'tatami',
      geometryMm: [
        { x: 0, y: 0 },
        { x: widthMm, y: 0 },
        { x: widthMm, y: 14 },
        { x: 0, y: 14 },
      ],
      context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
      technicalConfig: EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
      enabledRuleIds: [SATIN_RANGE],
      minimumSatinWidthMm: 1,
      minimumSatinAspectRatio: 1.5,
    });
    const evaluation = result.evaluations[0];
    expect(evaluation.applied).toBe(applied);
    expect(evaluation.fallbackReason).toBe(fallbackReason);
    expect(result.technique).toBe(applied ? 'satin' : 'tatami');
    expect(evaluation.applied && evaluation.fallbackReason !== null).toBe(false);
  });

  it('requires compatible fabric and reference scale', () => {
    const wrongFabric = experimentalConfig([SATIN_RANGE], { fabricProfile: 'Chiffon' });
    const wrongScale = experimentalConfig([SATIN_RANGE], { referenceScaleCompatible: false });
    expect(planOne(rectangle('wrong-fabric', 8), 'internal_feature', wrongFabric, EXPERIMENTAL_SATIN_TECHNICAL_CONFIG).proposedStitchType).toBe('tatami');
    expect(planOne(rectangle('wrong-scale', 8), 'internal_feature', wrongScale, EXPERIMENTAL_SATIN_TECHNICAL_CONFIG).proposedStitchType).toBe('tatami');
  });

  it('ignores a disconnected Hatch claim of 9.18 mm when the effective technical maximum remains 7 mm', () => {
    const disconnectedClaim = experimentalConfig([SATIN_RANGE], {
      technicalSatinMaximumWidthMm: 9.18,
      technicalSatinValidationPassed: true,
    });
    const rejected = planOne(
      rectangle('technical-limit', 8),
      'internal_feature',
      disconnectedClaim,
      DEFAULT_TECHNICAL_CONFIG,
    );
    expect(rejected.proposedStitchType).toBe('tatami');
    expect(rejected.source.hatchEvidence.evaluations[0]).toMatchObject({
      effectiveTechnicalSatinMaximumWidthMm: 7,
      fallbackReason: 'width_above_technical_maximum',
    });
  });

  it('promotes 8 x 16 mm only when the effective technical configuration carries 9.18 mm', () => {
    const proposal = planOne(
      rectangle('effective-experimental-maximum', 8),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
    );
    expect(proposal.proposedStitchType).toBe('satin');
    expect(proposal.source.hatchEvidence.evaluations[0]).toMatchObject({
      effectiveTechnicalSatinMaximumWidthMm: 9.18,
      technicalConfigValidationPassed: true,
      fallbackReason: null,
    });
  });

  it('uses maximum local width rather than a safe-looking median against the technical maximum', () => {
    const proposal = planOne(
      locallyWideRectangle('local-maximum-technical-limit'),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      DEFAULT_TECHNICAL_CONFIG,
    );
    expect(proposal.proposedStitchType).toBe('tatami');
    const evaluation = proposal.source.hatchEvidence.evaluations[0];
    expect(evaluation).toMatchObject({
      effectiveTechnicalSatinMaximumWidthMm: 7,
      fallbackReason: 'width_above_technical_maximum',
      localWidthProfile: {
        medianWidthMm: 4,
      },
    });
    expect(evaluation.localWidthProfile.maximumWidthMm).toBeCloseTo(8, 10);
  });

  it('falls back when the effective technical configuration is absent or invalid', () => {
    const config = experimentalConfig([SATIN_RANGE]);
    const absent = planOne(rectangle('technical-absent', 8), 'internal_feature', config);
    const invalid = planOne(
      rectangle('technical-invalid', 8),
      'internal_feature',
      config,
      { satin: { maximumWidthMm: Number.NaN } },
    );
    expect(absent.proposedStitchType).toBe('tatami');
    expect(absent.source.hatchEvidence.evaluations[0].fallbackReason).toBe('technical_config_not_provided');
    expect(invalid.proposedStitchType).toBe('tatami');
    expect(invalid.source.hatchEvidence.evaluations[0].fallbackReason).toBe('technical_config_invalid');
  });

  it('does not apply to detail geometry containing holes', () => {
    const source = { ...rectangle('detail-with-hole', 8), holes: [squareHole(1.2, 0.23)] };
    const proposal = planOne(source, 'internal_feature', experimentalConfig([SATIN_RANGE]), EXPERIMENTAL_SATIN_TECHNICAL_CONFIG);
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(proposal.source.hatchEvidence.evaluations[0]).toMatchObject({
      applicable: false,
      fallbackReason: 'geometry_outside_evidence',
    });
  });

  it('falls back for a rotated geometry outside the reference orientation', () => {
    const proposal = planOne(
      rotatedRectangle('rotated-satin', 8, 16),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
    );
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(proposal.source.hatchEvidence.evaluations[0]).toMatchObject({
      applicable: false,
      fallbackReason: 'height_or_orientation_outside_evidence',
    });
  });
});

describe('LOCAL-WIDTH-PROFILE-001 trace boundary', () => {
  it('records only the fields that Engine V2 actually calculates', () => {
    const proposal = planOne(rectangle('local-fields', 8), 'internal_feature', experimentalConfig([LOCAL_WIDTH]));
    const evaluation = proposal.source.hatchEvidence.evaluations[0];
    expect(evaluation.measuredFields).toEqual([
      'minimumWidthMm',
      'medianWidthMm',
      'maximumWidthMm',
      'widthVariationRatio',
      'aspectRatio',
      'principalAxisDegrees',
    ]);
    expect(evaluation.unavailableFields).toEqual(['meanWidthMm', 'sustainedMaximumPercentage', 'curvature', 'endShape']);
    expect(proposal.proposedStitchType).toBe('tatami');
  });

  it('does not trace the rule when its flag is disabled', () => {
    const proposal = planOne(
      rectangle('local-disabled', 8),
      'internal_feature',
      experimentalConfig([SATIN_RANGE]),
      EXPERIMENTAL_SATIN_TECHNICAL_CONFIG,
    );
    expect(evaluatedRuleIds(proposal)).not.toContain(LOCAL_WIDTH);
  });
});

describe('independent Hatch B hole rules and safe measurement fallbacks', () => {
  it.each([
    [0.8, 'reject_automatic_generation'],
    [0.800001, 'protect_and_require_review'],
    [1.199999, 'protect_and_require_review'],
    [1.2, 'protect'],
  ])('classifies the evidence-compatible %s mm boundary as %s', (sizeMm, disposition) => {
    const outer = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }];
    const hole = squareHole(sizeMm).map(([x, y]) => ({ x: x * 100, y: y * 100 }));
    const result = evaluateHatchHoleProtection({
      geometryMm: outer,
      holesMm: [hole],
      context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
      enabledRuleIds: [HOLE_MIN_SIZE],
    });
    expect(result.measurements[0].disposition).toBe(disposition);
  });

  it('keeps invalid or insufficient holes on legacy fallback without claiming observed loss', () => {
    const result = evaluateHatchHoleProtection({
      geometryMm: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
      holesMm: [[{ x: 40, y: 40 }, { x: 41, y: 40 }]],
      context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
      enabledRuleIds: [HOLE_MIN_SIZE],
    });
    expect(result.automaticGenerationRejected).toBe(false);
    expect(result.evidence.map(item => item.code)).not.toContain('HATCH_B_HOLE_AUTOMATION_REJECTED');
    expect(result.evaluations[0]).toMatchObject({
      applied: false,
      fallbackReason: 'invalid_hole_or_outer_geometry',
    });
    expect(result.measurements[0]).toMatchObject({
      minimumSpanMm: null,
      disposition: 'fallback',
    });
  });

  it.each([
    ['null point', [{ x: 39.6, y: 39.6 }, null, { x: 40.4, y: 40.4 }, { x: 39.6, y: 40.4 }]],
    ['missing coordinate', [{ x: 39.6, y: 39.6 }, { x: 40.4 }, { x: 40.4, y: 40.4 }, { x: 39.6, y: 40.4 }]],
    ['NaN coordinate', [{ x: 39.6, y: 39.6 }, { x: Number.NaN, y: 39.6 }, { x: 40.4, y: 40.4 }, { x: 39.6, y: 40.4 }]],
    ['positive Infinity', [{ x: 39.6, y: 39.6 }, { x: Number.POSITIVE_INFINITY, y: 39.6 }, { x: 40.4, y: 40.4 }, { x: 39.6, y: 40.4 }]],
    ['negative Infinity', [{ x: 39.6, y: 39.6 }, { x: 40.4, y: Number.NEGATIVE_INFINITY }, { x: 40.4, y: 40.4 }, { x: 39.6, y: 40.4 }]],
    ['mixed valid and invalid points', [{ x: 39.6, y: 39.6 }, { x: 40.4, y: 39.6 }, { invalid: true }, { x: 40.4, y: 40.4 }, { x: 39.6, y: 40.4 }]],
  ])('rejects every %s before duplicate cleanup', (_label, hole) => {
    const result = evaluateHatchHoleProtection({
      geometryMm: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
      holesMm: [hole],
      context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
      enabledRuleIds: [HOLE_MIN_SIZE],
    });
    expect(result.requiresManualReview).toBe(false);
    expect(result.automaticGenerationRejected).toBe(false);
    expect(result.measurements[0]).toMatchObject({
      minimumSpanMm: null,
      measurementValid: false,
      evidenceCompatible: false,
      disposition: 'fallback',
      fallbackReason: 'invalid_or_non_finite_hole_point',
    });
  });

  it('still measures a finite evidence-compatible hole with a duplicate point', () => {
    const result = evaluateHatchHoleProtection({
      geometryMm: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
      holesMm: [[
        { x: 39.6, y: 39.6 },
        { x: 40.4, y: 39.6 },
        { x: 40.4, y: 39.6 },
        { x: 40.4, y: 40.4 },
        { x: 39.6, y: 40.4 },
      ]],
      context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
      enabledRuleIds: [HOLE_MIN_SIZE],
    });
    expect(result.automaticGenerationRejected).toBe(true);
    expect(result.measurements[0]).toMatchObject({
      minimumSpanMm: 0.8,
      measurementValid: true,
      evidenceCompatible: true,
      disposition: 'reject_automatic_generation',
      fallbackReason: null,
    });
  });

  it('falls back for rotated unsupported hole geometry', () => {
    const source = regionWithHoles('rotated-hole', [rotatedSquareHole(1)]);
    const proposal = planOne(source, 'primary_shape', experimentalConfig([HOLE_MIN_SIZE]));
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(proposal.evidence.map(item => item.code)).not.toContain('HATCH_B_HOLE_AUTOMATION_REJECTED');
    expect(proposal.source.hatchEvidence.evaluations[0].measurements[0]).toMatchObject({
      minimumSpanMm: null,
      disposition: 'fallback',
      fallbackReason: 'rotated_or_unsupported_hole_geometry',
    });
  });

  it('does not extrapolate the size threshold without compatible scale', () => {
    const proposal = planOne(
      regionWithHoles('scale-fallback', [squareHole(0.8)]),
      'primary_shape',
      experimentalConfig([HOLE_MIN_SIZE], { referenceScaleCompatible: false }),
    );
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(proposal.source.hatchEvidence.evaluations[0]).toMatchObject({
      applied: false,
      fallbackReason: 'scale_outside_evidence',
    });
  });

  it('does not mutate source geometry while evaluating multiple holes', () => {
    const source = regionWithHoles('compound', [squareHole(1.2, 0.35), squareHole(1.8, 0.65)]);
    const before = structuredClone(source);
    const proposal = planOne(source, 'primary_shape', experimentalConfig([HOLE_PRESERVE, HOLE_MIN_SIZE]));
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(proposal.holesMm).toHaveLength(2);
    expect(source).toEqual(before);
  });
});

describe('resolved Hatch configuration reuse', () => {
  it('keeps the 0.8 mm HOLE-MIN-SIZE rejection and trace across repeated planning', () => {
    const source = regionWithHoles('resolved-hole-reuse', [squareHole(0.8)]);
    const first = buildPlanOne(source, 'primary_shape', experimentalConfig([HOLE_MIN_SIZE]));
    const second = buildPlanOne(source, 'primary_shape', first.config);
    const firstProposal = first.byRegionId['resolved-hole-reuse'];
    const secondProposal = second.byRegionId['resolved-hole-reuse'];
    [first, second].forEach(plan => {
      expect(plan.valid).toBe(true);
      expect(plan.config.extras).not.toHaveProperty('extras');
    });
    [firstProposal, secondProposal].forEach(proposal => {
      expect(proposal).toMatchObject({
        proposedStitchType: 'manual',
        needsReview: true,
      });
      expect(proposal.source.hatchEvidence.evaluations[0]).toMatchObject({
        ruleId: HOLE_MIN_SIZE,
        applied: true,
        requiresManualReview: true,
        automaticGenerationRejected: true,
        fallbackReason: null,
      });
    });
    expect(second.config).toEqual(first.config);
    expect(secondProposal.source.hatchEvidence).toEqual(firstProposal.source.hatchEvidence);
  });
});

describe('strict legacy parity', () => {
  it('preserves the exact pre-integration representative plan hash', () => {
    const ingestion = ingestV1RegionsToRegionGraphV2(createEmbroideryPlanningFixture(), { coordinateSpace: 'normalized' });
    const semanticResult = analyzeSemanticRegionRoles(ingestion.regions, ingestion.graph);
    const plan = buildEmbroideryObjectProposalPlan({ regions: ingestion.regions, graph: ingestion.graph, semanticResult });
    const hash = crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    expect(hash).toBe('b076b8e44015b2c8d8b5152bd14c6fe8ac526d02cc7f8170dd9d0a11b3e010a7');
  });

  it('keeps explicit legacy identical to unflagged planning without Hatch trace', () => {
    const source = rectangle('legacy-parity', 8);
    const implicit = planOne(source, 'internal_feature');
    const explicit = planOne(source, 'internal_feature', { hatchEvidenceProfile: 'legacy' });
    expect(explicit).toEqual(implicit);
    expect(explicit.source).not.toHaveProperty('hatchEvidence');
  });

  it('keeps an experimental profile with all flags OFF identical to legacy', () => {
    const source = rectangle('all-off-parity', 8);
    const allOff = experimentalConfig([]);
    expect(planOne(source, 'internal_feature', allOff)).toEqual(planOne(source, 'internal_feature'));
  });
});
