import { describe, expect, it } from 'vitest';
import {
  HATCH_AB_REFERENCE_FIXTURES,
  HATCH_AB_REFERENCE_SOURCE,
  HATCH_REFERENCE_DESIGN_MM,
  createHatchReferenceRegion,
} from './fixtures/hatchABReferenceFixtures.js';
import { ingestV1RegionsToRegionGraphV2 } from '../ingestion/regionIngestion.js';
import { buildEmbroideryObjectProposalPlan } from '../planning/objectPlanningPipeline.js';
import { planEmbroideryRoleForRegion } from '../planning/embroideryRolePlanner.js';
import { resolveObjectPlanningConfig } from '../planning/planningConfig.js';
import {
  HATCH_HOLE_MEASUREMENT_TOLERANCES,
  evaluateHatchHoleProtection,
  measureHoleMinimumSpanMm,
} from '../rules/hatchEvidence/holes.js';
import { HATCH_WIDTH_EVIDENCE_LIMITS } from '../rules/hatchEvidence/widths.js';
import { createSemanticRegionAssessmentV2 } from '../semantics/semanticRoleModel.js';

const SATIN_RANGE = 'SATIN-RANGE-OBSERVED-001';
const HOLE_PRESERVE = 'HOLE-PRESERVE-001';
const HOLE_MIN_SIZE = 'HOLE-MIN-SIZE-001';
const DEFAULT_TECHNICAL_CONFIG = Object.freeze({});
const EXPERIMENTAL_TECHNICAL_CONFIG = Object.freeze({
  satin: Object.freeze({ maximumWidthMm: 9.18 }),
});

function dimensions(points) {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {
    widthMm: Math.max(...xs) - Math.min(...xs),
    heightMm: Math.max(...ys) - Math.min(...ys),
  };
}

function hatchConfig(ruleIds) {
  return {
    designWidthMm: HATCH_REFERENCE_DESIGN_MM.width,
    designHeightMm: HATCH_REFERENCE_DESIGN_MM.height,
    hatchEvidenceProfile: 'hatch-a-f-experimental',
    hatchEvidenceRuleFlags: Object.fromEntries(ruleIds.map(ruleId => [ruleId, true])),
    hatchEvidenceContext: {
      fabricProfile: 'Pure Cotton',
      referenceScaleCompatible: true,
    },
  };
}

function planSource(source, role, ruleIds, technicalConfig) {
  const ingestion = ingestV1RegionsToRegionGraphV2([source], {
    coordinateSpace: 'millimeter',
    designWidthMm: HATCH_REFERENCE_DESIGN_MM.width,
    designHeightMm: HATCH_REFERENCE_DESIGN_MM.height,
  });
  expect(ingestion.valid).toBe(true);
  const region = ingestion.regions[0];
  const semanticAssessment = createSemanticRegionAssessmentV2({
    regionId: region.id,
    semanticRole: role,
    confidence: 0.95,
    evidence: [{ code: 'HATCH_REFERENCE_FIXTURE', message: 'Derived from the verified Hatch master reference.' }],
  });
  return planEmbroideryRoleForRegion({
    region,
    graph: ingestion.graph,
    semanticAssessment,
    config: resolveObjectPlanningConfig(hatchConfig(ruleIds)),
    technicalConfig,
  });
}

function planReference(referenceId, technicalConfig) {
  return planSource(
    createHatchReferenceRegion(referenceId),
    'internal_feature',
    [SATIN_RANGE],
    technicalConfig,
  );
}

function buildReferencePlan(referenceId, config, technicalConfig) {
  const source = createHatchReferenceRegion(referenceId);
  const ingestion = ingestV1RegionsToRegionGraphV2([source], {
    coordinateSpace: 'millimeter',
    designWidthMm: HATCH_REFERENCE_DESIGN_MM.width,
    designHeightMm: HATCH_REFERENCE_DESIGN_MM.height,
  });
  const region = ingestion.regions[0];
  const assessment = createSemanticRegionAssessmentV2({
    regionId: region.id,
    semanticRole: 'internal_feature',
    confidence: 0.95,
    evidence: [{ code: 'HATCH_REFERENCE_FIXTURE', message: 'Derived from the verified Hatch master reference.' }],
  });
  return buildEmbroideryObjectProposalPlan({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult: {
      assessments: [assessment],
      byRegionId: { [region.id]: assessment },
    },
    config,
    technicalConfig,
  });
}

function rotatePoints(points, center, angleDegrees) {
  const angle = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.map(point => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return {
      x: center.x + x * cosine - y * sine,
      y: center.y + x * sine + y * cosine,
    };
  });
}

describe('Hatch A/B verified reference fixtures', () => {
  it('binds the verified package and every SVG/CSV/XLSX artifact used for derivation', () => {
    expect(HATCH_AB_REFERENCE_SOURCE).toMatchObject({
      packageName: 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F.zip',
      packageSha256: 'd2ca1f36db18a6d48fe8d471f66d4cf1f96e2804ca65979d57752e97812bf8e3',
      packageByteLength: 320891578,
      derivation: {
        runtimeDependency: 'none; fixtures are checked-in test constants and never read the 320 MB package at runtime',
      },
    });
    expect(Object.values(HATCH_AB_REFERENCE_SOURCE.artifacts)).toHaveLength(6);
    Object.values(HATCH_AB_REFERENCE_SOURCE.artifacts).forEach(artifact => {
      expect(artifact.path).toMatch(/\.(svg|csv|xlsx)$/);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
    Object.values(HATCH_AB_REFERENCE_FIXTURES).forEach(fixture => {
      expect(fixture.sourceArtifacts).toHaveLength(3);
      expect(fixture.csvLine).toBeGreaterThan(1);
      expect(fixture.xlsxRange).toMatch(/!.+:.+/);
    });
  });

  it('preserves the exact A8 rectangle, C6 quadratics and D6 capsule source families', () => {
    const { A8, C6, D6 } = HATCH_AB_REFERENCE_FIXTURES;
    expect(A8).toMatchObject({
      geometryFamily: 'barra_recta',
      sourceWidthMm: 8,
      sourceHeightMm: 16,
      observedHatchWidthMm: 8.04,
      svgPrimitive: { type: 'rect', x: 89, y: 5, width: 8, height: 16 },
    });
    expect(dimensions(A8.geometryMm)).toEqual({ widthMm: 8, heightMm: 16 });

    expect(C6).toMatchObject({
      geometryFamily: 'forma_afilada',
      sourceWidthMm: 8,
      sourceHeightMm: 14,
      observedHatchWidthMm: 8.04,
      quadraticSamplesPerSegment: 8,
    });
    expect(C6.svgQuadraticSegments).toHaveLength(4);
    expect(C6.svgPathData.match(/\bQ\b/g)).toHaveLength(4);
    expect(dimensions(C6.geometryMm)).toEqual({ widthMm: 8, heightMm: 14 });

    expect(D6).toMatchObject({
      geometryFamily: 'capsula',
      sourceWidthMm: 9,
      sourceHeightMm: 14,
      sourceRadiusMm: 4.5,
      observedHatchWidthMm: 9.18,
      svgPrimitive: { type: 'rect', width: 9, height: 14, rx: 4.5, ry: 4.5 },
    });
    expect(dimensions(D6.geometryMm).widthMm).toBeCloseTo(9, 10);
    expect(dimensions(D6.geometryMm).heightMm).toBeCloseTo(14, 10);
  });

  it('keeps source and observed satin widths as separate magnitudes', () => {
    expect(HATCH_WIDTH_EVIDENCE_LIMITS).toMatchObject({
      maximumSourceSatinWidthMm: 9,
      maximumObservedSatinWidthMm: 9.18,
    });
    expect(HATCH_AB_REFERENCE_FIXTURES.D6).toMatchObject({
      sourceWidthMm: 9,
      observedHatchWidthMm: 9.18,
    });
  });

  it.each(['A8', 'C6', 'D6'])('retains tatami for %s with the effective default 7 mm maximum', referenceId => {
    const proposal = planReference(referenceId, DEFAULT_TECHNICAL_CONFIG);
    const evaluation = proposal.source.hatchEvidence.evaluations[0];
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(evaluation).toMatchObject({
      applicable: false,
      effectiveTechnicalSatinMaximumWidthMm: 7,
      fallbackReason: 'width_above_technical_maximum',
    });
    expect(evaluation.localWidthProfile.maximumWidthMm)
      .toBeCloseTo(HATCH_AB_REFERENCE_FIXTURES[referenceId].sourceWidthMm, 6);
  });

  it.each(['A8', 'C6', 'D6'])('evaluates %s from its source width with an explicit effective 9.18 mm maximum', referenceId => {
    const proposal = planReference(referenceId, EXPERIMENTAL_TECHNICAL_CONFIG);
    const evaluation = proposal.source.hatchEvidence.evaluations[0];
    expect(proposal.proposedStitchType).toBe('satin');
    expect(evaluation).toMatchObject({
      applicable: true,
      maximumSourceSatinWidthMm: 9,
      maximumObservedSatinWidthMm: 9.18,
      effectiveTechnicalSatinMaximumWidthMm: 9.18,
      fallbackReason: null,
    });
    expect(evaluation.localWidthProfile.maximumWidthMm)
      .toBeCloseTo(HATCH_AB_REFERENCE_FIXTURES[referenceId].sourceWidthMm, 6);
  });

  it('keeps the A8 satin candidate and trace when the resolved plan config is reused', () => {
    const first = buildReferencePlan(
      'A8',
      hatchConfig([SATIN_RANGE]),
      EXPERIMENTAL_TECHNICAL_CONFIG,
    );
    const second = buildReferencePlan('A8', first.config, EXPERIMENTAL_TECHNICAL_CONFIG);
    const regionId = 'hatch-reference-a8';
    [first, second].forEach(plan => {
      expect(plan.valid).toBe(true);
      expect(plan.byRegionId[regionId].proposedStitchType).toBe('satin');
      expect(plan.config.extras).not.toHaveProperty('extras');
    });
    expect(second.config).toEqual(first.config);
    expect(second.byRegionId[regionId].source.hatchEvidence)
      .toEqual(first.byRegionId[regionId].source.hatchEvidence);
  });

  it('rejects a synthetic source above 9 mm even when the effective technical maximum is 9.18 mm', () => {
    const syntheticWidthMm = 9.01;
    const source = {
      id: 'synthetic-source-above-accredited-family',
      color: '#111111',
      region_class: 'detail',
      path_points: [
        { x: 40, y: 30 },
        { x: 40 + syntheticWidthMm, y: 30 },
        { x: 40 + syntheticWidthMm, y: 44 },
        { x: 40, y: 44 },
      ],
      holes: [],
      source: { fixtureClass: 'synthetic_boundary_probe', referenceDerived: false },
    };
    const proposal = planSource(source, 'internal_feature', [SATIN_RANGE], EXPERIMENTAL_TECHNICAL_CONFIG);
    expect(proposal.proposedStitchType).toBe('tatami');
    expect(proposal.source.hatchEvidence.evaluations[0]).toMatchObject({
      maximumSourceSatinWidthMm: 9,
      effectiveTechnicalSatinMaximumWidthMm: 9.18,
      fallbackReason: 'width_above_source_family',
    });
  });
});

describe('H9 circular-hole fidelity', () => {
  it('preserves the exact 20 x 14 mm source object and its four SVG circle diameters together', () => {
    const { H9 } = HATCH_AB_REFERENCE_FIXTURES;
    expect(H9).toMatchObject({
      geometryFamily: 'rectangulo_umbral_huecos',
      sourceWidthMm: 20,
      sourceHeightMm: 14,
      observedHatchResult: '3/4 visibles; Ø0,8 colapsa, Ø1,2+ se conservan',
    });
    expect(dimensions(H9.geometryMm)).toEqual({ widthMm: 20, heightMm: 14 });
    expect(H9.sourceCircles.map(circle => circle.diameterMm)).toEqual([0.8, 1.2, 1.8, 2.5]);
    expect(H9.holesMm).toHaveLength(4);
    expect(H9.holesMm.every(hole => hole.length === 32)).toBe(true);
  });

  it('measures and classifies all four real H9 circular holes in the same object', () => {
    const { H9 } = HATCH_AB_REFERENCE_FIXTURES;
    const result = evaluateHatchHoleProtection({
      geometryMm: H9.geometryMm,
      holesMm: H9.holesMm,
      context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
      enabledRuleIds: [HOLE_PRESERVE, HOLE_MIN_SIZE],
    });
    expect(result.measurements).toHaveLength(4);
    result.measurements.forEach((measurement, index) => {
      expect(measurement.minimumSpanMm).toBeCloseTo(H9.sourceCircles[index].diameterMm, 6);
      expect(measurement).toMatchObject({
        measurementValid: true,
        evidenceCompatible: true,
        measurementMethod: 'approximately_circular_mean_radius_diameter',
        geometryFamily: 'approximately_circular',
      });
      expect(measurement.circularity.maximumRadialDeviationRatio)
        .toBeLessThanOrEqual(HATCH_HOLE_MEASUREMENT_TOLERANCES.maximumRadialDeviationRatio);
    });
    expect(result.measurements.map(measurement => measurement.disposition)).toEqual([
      'reject_automatic_generation',
      'protect',
      'protect',
      'protect',
    ]);
    expect(result.automaticGenerationRejected).toBe(true);
    expect(result.requiresManualReview).toBe(true);
    expect(result.evaluations.map(evaluation => evaluation.ruleId)).toEqual([
      HOLE_PRESERVE,
      HOLE_MIN_SIZE,
    ]);
  });

  it('routes the integrated H9 object to manual review because its Ø0.8 hole blocks automation', () => {
    const proposal = planSource(
      createHatchReferenceRegion('H9'),
      'primary_shape',
      [HOLE_PRESERVE, HOLE_MIN_SIZE],
    );
    expect(proposal.proposedStitchType).toBe('manual');
    expect(proposal.holesMm).toHaveLength(4);
    const evaluations = proposal.source.hatchEvidence.evaluations;
    expect(evaluations.map(evaluation => evaluation.ruleId)).toEqual([
      HOLE_PRESERVE,
      HOLE_MIN_SIZE,
    ]);
    expect(evaluations[1].measurements.map(measurement => measurement.disposition)).toEqual([
      'reject_automatic_generation',
      'protect',
      'protect',
      'protect',
    ]);
  });

  it('returns the same H9 circle diameter after an arbitrary orientation change', () => {
    const { H9 } = HATCH_AB_REFERENCE_FIXTURES;
    H9.holesMm.forEach((hole, index) => {
      const circle = H9.sourceCircles[index];
      const rotated = rotatePoints(hole, { x: circle.centerX, y: circle.centerY }, 17);
      expect(measureHoleMinimumSpanMm(rotated)).toBeCloseTo(circle.diameterMm, 6);
    });
  });

  it('keeps an irregular concave hole outside the accredited measurement family', () => {
    const { H9 } = HATCH_AB_REFERENCE_FIXTURES;
    const irregularConcaveHole = [
      { x: 9, y: 65.5 },
      { x: 11, y: 65.5 },
      { x: 10.2, y: 67 },
      { x: 11, y: 68.5 },
      { x: 9, y: 68.5 },
      { x: 9.8, y: 67 },
    ];
    const result = evaluateHatchHoleProtection({
      geometryMm: H9.geometryMm,
      holesMm: [irregularConcaveHole],
      context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
      enabledRuleIds: [HOLE_MIN_SIZE],
    });
    expect(result.automaticGenerationRejected).toBe(false);
    expect(result.requiresManualReview).toBe(false);
    expect(result.measurements[0]).toMatchObject({
      minimumSpanMm: null,
      measurementValid: true,
      evidenceCompatible: false,
      disposition: 'fallback',
      fallbackReason: 'rotated_or_unsupported_hole_geometry',
    });
  });
});
