import { analyzeEmbroideryObjectGeometry } from '../../technical/objectGeometryMetrics.js';
import { defineHatchEvidenceRules } from './model.js';
import { hatchEvidenceContextMatchesPureCotton } from './profiles.js';

const HOLE_PRESERVE_RULE_ID = 'HOLE-PRESERVE-001';
const HOLE_MIN_SIZE_RULE_ID = 'HOLE-MIN-SIZE-001';
const AXIS_TOLERANCE_MM = 1e-6;
const TURN_TOLERANCE_MM2 = 1e-9;

export const HATCH_HOLE_MEASUREMENT_TOLERANCES = Object.freeze({
  approximatelyCircularMinimumPointCount: 16,
  maximumRadialDeviationRatio: 0.02,
  maximumAngularGapToUniformRatio: 2,
});

const LIMITS = Object.freeze([
  'Visual analysis only; no physical sew-out was performed.',
  'The minimum-hole observation is specific to the tested geometry, scale and Pure Cotton profile.',
  'Bridge preservation at 1 mm remains visual evidence only.',
]);

export const HATCH_HOLE_EVIDENCE_LIMITS = Object.freeze({
  observedNotPreservedMm: 0.8,
  smallestObservedPreservedMm: 1.2,
  visuallyPreservedBridgeMm: 1,
});

export const HATCH_HOLE_EVIDENCE_RULES = defineHatchEvidenceRules({
  phase: 'B_Huecos',
  phaseStatus: 'visual-analysis-complete',
  artifactPath: '02_HUECOS/06_Reglas/HATCH-B-HOLES-reglas.json',
  artifactSha256: 'a0fa1078e833852e6a7a5f6a67114f40da3ac4c9c7bc35491deceb6a3d2fc669',
  implementationActive: true,
  limits: LIMITS,
  rules: [
    { id: 'HOLE-PRESERVE-001', sourceState: 'candidata', implementationActive: true, condition: 'Región cerrada con uno o más huecos; tela estable', candidateAction: 'Representar cada hueco como anillo interior protegido y excluirlo de los rellenos vecinos.', confidence: 0.95, evidence: 'H1–H6, H8, H10, H11' },
    { id: 'HOLE-MIN-SIZE-001', sourceState: 'candidata', implementationActive: true, condition: 'Pure Cotton; escala actual; autodigitalización Hatch', candidateAction: 'No prometer huecos <1,2 mm. Entre 0,8 y 1,2 mm usar advertencia, ampliar o convertir a detalle alternativo.', confidence: 0.9, evidence: 'H9: Ø0,8 perdido; Ø1,2/1,8/2,5 conservados' },
    { id: 'ISLAND-SPLIT-001', sourceState: 'candidata', condition: 'Región dentro de un hueco que vuelve al color del padre', candidateAction: 'Crear un objeto independiente para la isla y mantener el hueco protector alrededor.', confidence: 0.95, evidence: 'H7' },
    { id: 'BRIDGE-MIN-001', sourceState: 'validando', condition: 'Puente geométrico continuo entre hueco y borde', candidateAction: 'No eliminar el puente durante simplificación; marcarlo como zona crítica.', confidence: 0.75, evidence: 'H8 y H10, conservación visual' },
    { id: 'DISCONNECTED-ISLANDS-001', sourceState: 'candidata', condition: 'Mismo color, componentes separados', candidateAction: 'Mantener componentes como objetos independientes y optimizar su secuencia después.', confidence: 0.95, evidence: 'H12' },
    { id: 'COMPOUND-SPLIT-001', sourceState: 'validando', condition: 'Muchos huecos pequeños o cambios fuertes de dirección', candidateAction: 'Permitir subobjetos internos, pero conservar la topología y evitar costuras radiales visibles excesivas.', confidence: 0.8, evidence: 'H6 y H9' },
  ],
});

function validHolePoint(point) {
  return Boolean(point)
    && typeof point === 'object'
    && !Array.isArray(point)
    && Object.hasOwn(point, 'x')
    && Object.hasOwn(point, 'y')
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function cleanHolePoints(hole = []) {
  const points = Array.isArray(hole) ? hole : [];
  const unique = points.filter((point, index) => index === 0
    || Math.abs(point.x - points[index - 1].x) > AXIS_TOLERANCE_MM
    || Math.abs(point.y - points[index - 1].y) > AXIS_TOLERANCE_MM);
  if (unique.length > 1
    && Math.abs(unique[0].x - unique.at(-1).x) <= AXIS_TOLERANCE_MM
    && Math.abs(unique[0].y - unique.at(-1).y) <= AXIS_TOLERANCE_MM) unique.pop();
  return unique;
}

function convexReferenceGeometry(points) {
  let direction = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    const turn = (next.x - current.x) * (afterNext.y - next.y)
      - (next.y - current.y) * (afterNext.x - next.x);
    if (Math.abs(turn) <= TURN_TOLERANCE_MM2) continue;
    const currentDirection = Math.sign(turn);
    if (direction !== 0 && currentDirection !== direction) return false;
    direction = currentDirection;
  }
  return direction !== 0;
}

function axisAlignedReferenceGeometry(points) {
  if (points.length < 3) return false;
  return convexReferenceGeometry(points) && points.every((point, index) => {
    const next = points[(index + 1) % points.length];
    const horizontal = Math.abs(next.y - point.y) <= AXIS_TOLERANCE_MM;
    const vertical = Math.abs(next.x - point.x) <= AXIS_TOLERANCE_MM;
    return horizontal !== vertical;
  });
}

function analyzeApproximatelyCircularGeometry(points) {
  if (points.length < HATCH_HOLE_MEASUREMENT_TOLERANCES.approximatelyCircularMinimumPointCount
    || !convexReferenceGeometry(points)) return { valid: false };
  const center = points.reduce((sum, pointValue) => ({
    x: sum.x + pointValue.x / points.length,
    y: sum.y + pointValue.y / points.length,
  }), { x: 0, y: 0 });
  const radii = points.map(pointValue => Math.hypot(pointValue.x - center.x, pointValue.y - center.y));
  const meanRadiusMm = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  if (!Number.isFinite(meanRadiusMm) || meanRadiusMm <= 0) return { valid: false };
  const maximumRadialDeviationRatio = Math.max(...radii.map(radius => Math.abs(radius - meanRadiusMm))) / meanRadiusMm;
  const angles = points
    .map(pointValue => Math.atan2(pointValue.y - center.y, pointValue.x - center.x))
    .sort((a, b) => a - b);
  const angularGaps = angles.map((angle, index) => {
    const next = index === angles.length - 1 ? angles[0] + 2 * Math.PI : angles[index + 1];
    return next - angle;
  });
  const maximumAngularGapToUniformRatio = Math.max(...angularGaps) / (2 * Math.PI / points.length);
  const valid = maximumRadialDeviationRatio
      <= HATCH_HOLE_MEASUREMENT_TOLERANCES.maximumRadialDeviationRatio
    && maximumAngularGapToUniformRatio
      <= HATCH_HOLE_MEASUREMENT_TOLERANCES.maximumAngularGapToUniformRatio;
  return {
    valid,
    center,
    meanRadiusMm,
    maximumRadialDeviationRatio,
    maximumAngularGapToUniformRatio,
  };
}

function analyzeHoleMeasurement(hole = [], holeIndex = 0) {
  const points = Array.isArray(hole) ? hole : [];
  if (points.some(point => !validHolePoint(point))) {
    return Object.freeze({
      holeIndex,
      minimumSpanMm: null,
      measurementValid: false,
      evidenceCompatible: false,
      measurementMethod: null,
      disposition: 'fallback',
      fallbackReason: 'invalid_or_non_finite_hole_point',
    });
  }
  const cleaned = cleanHolePoints(points);
  const geometryMetrics = analyzeEmbroideryObjectGeometry({
    id: `hatch-hole-measurement:${holeIndex}`,
    geometry: cleaned,
    holes: [],
    stitchType: 'tatami',
  });
  if (!geometryMetrics.geometryValid) {
    return Object.freeze({
      holeIndex,
      minimumSpanMm: null,
      measurementValid: false,
      evidenceCompatible: false,
      measurementMethod: null,
      disposition: 'fallback',
      fallbackReason: 'invalid_or_insufficient_hole_geometry',
    });
  }
  const axisAligned = axisAlignedReferenceGeometry(cleaned);
  const circular = axisAligned ? { valid: false } : analyzeApproximatelyCircularGeometry(cleaned);
  if (!axisAligned && !circular.valid) {
    return Object.freeze({
      holeIndex,
      minimumSpanMm: null,
      measurementValid: true,
      evidenceCompatible: false,
      measurementMethod: null,
      disposition: 'fallback',
      fallbackReason: 'rotated_or_unsupported_hole_geometry',
    });
  }
  const xs = cleaned.map(pointValue => pointValue.x); const ys = cleaned.map(pointValue => pointValue.y);
  const measuredSpanMm = axisAligned
    ? Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    : circular.meanRadiusMm * 2;
  const minimumSpanMm = Math.round(measuredSpanMm * 1e6) / 1e6;
  if (!Number.isFinite(minimumSpanMm) || minimumSpanMm <= 0) {
    return Object.freeze({
      holeIndex,
      minimumSpanMm: null,
      measurementValid: false,
      evidenceCompatible: false,
      measurementMethod: null,
      disposition: 'fallback',
      fallbackReason: 'non_finite_or_non_positive_measurement',
    });
  }
  const disposition = minimumSpanMm <= HATCH_HOLE_EVIDENCE_LIMITS.observedNotPreservedMm ? 'reject_automatic_generation'
    : minimumSpanMm < HATCH_HOLE_EVIDENCE_LIMITS.smallestObservedPreservedMm ? 'protect_and_require_review'
      : 'protect';
  return Object.freeze({
    holeIndex,
    minimumSpanMm,
    measurementValid: true,
    evidenceCompatible: true,
    measurementMethod: axisAligned
      ? 'axis_aligned_minimum_span'
      : 'approximately_circular_mean_radius_diameter',
    geometryFamily: axisAligned ? 'orthogonal_polygon' : 'approximately_circular',
    circularity: circular.valid ? Object.freeze({
      maximumRadialDeviationRatio: circular.maximumRadialDeviationRatio,
      maximumAngularGapToUniformRatio: circular.maximumAngularGapToUniformRatio,
    }) : null,
    disposition,
    fallbackReason: null,
  });
}

export function measureHoleMinimumSpanMm(hole = []) {
  return analyzeHoleMeasurement(hole).minimumSpanMm;
}

function enabled(enabledRuleIds, ruleId) {
  return Array.isArray(enabledRuleIds) && enabledRuleIds.includes(ruleId);
}

export function evaluateHatchHoleProtection({
  geometryMm = [],
  holesMm = [],
  context = {},
  enabledRuleIds = [],
} = {}) {
  const sourceHoles = Array.isArray(holesMm) ? holesMm : [];
  const preserveEnabled = enabled(enabledRuleIds, HOLE_PRESERVE_RULE_ID);
  const minimumSizeEnabled = enabled(enabledRuleIds, HOLE_MIN_SIZE_RULE_ID);
  if ((!preserveEnabled && !minimumSizeEnabled) || !sourceHoles.length || !hatchEvidenceContextMatchesPureCotton(context)) {
    return Object.freeze({
      applied: false,
      preserveGeometry: true,
      geometryMutationAllowed: false,
      requiresManualReview: false,
      automaticGenerationRejected: false,
      measurements: [],
      ruleIds: [],
      evaluations: [],
      evidence: [],
    });
  }

  const geometryMetrics = analyzeEmbroideryObjectGeometry({
    id: 'hatch-hole-protection',
    geometry: geometryMm,
    holes: sourceHoles,
    stitchType: 'tatami',
  });
  const allHolePointsValid = sourceHoles.every(hole => (
    Array.isArray(hole) && hole.every(point => validHolePoint(point))
  ));
  const geometryValid = geometryMetrics.geometryValid
    && geometryMetrics.holeGeometryValid
    && allHolePointsValid;
  const measurements = sourceHoles.map((hole, holeIndex) => analyzeHoleMeasurement(hole, holeIndex));
  const compatibleMeasurements = measurements.filter(item => item.measurementValid && item.evidenceCompatible);
  const preserveApplicable = preserveEnabled && geometryValid;
  const minimumSizeApplicable = minimumSizeEnabled
    && context.referenceScaleCompatible === true
    && geometryValid
    && compatibleMeasurements.length > 0;
  const blocking = minimumSizeApplicable && compatibleMeasurements.some(item => (
    item.disposition === 'reject_automatic_generation' || item.disposition === 'protect_and_require_review'
  ));
  const belowObservedLoss = minimumSizeApplicable
    && compatibleMeasurements.some(item => item.disposition === 'reject_automatic_generation');
  const evaluations = [
    ...(preserveEnabled ? [{
      ruleId: HOLE_PRESERVE_RULE_ID,
      evaluated: true,
      applicable: preserveApplicable,
      applied: preserveApplicable,
      preserveGeometry: true,
      geometryMutationAllowed: false,
      fallbackReason: geometryValid ? null : 'invalid_hole_or_outer_geometry',
    }] : []),
    ...(minimumSizeEnabled ? [{
      ruleId: HOLE_MIN_SIZE_RULE_ID,
      evaluated: true,
      applicable: minimumSizeApplicable,
      applied: minimumSizeApplicable,
      requiresManualReview: blocking,
      automaticGenerationRejected: belowObservedLoss,
      fallbackReason: context.referenceScaleCompatible !== true ? 'scale_outside_evidence'
        : !geometryValid ? 'invalid_hole_or_outer_geometry'
          : compatibleMeasurements.length === 0 ? 'no_evidence_compatible_measurement'
            : null,
      measurements,
    }] : []),
  ];
  const evidence = [
    ...(preserveApplicable ? [{
      code: 'HATCH_B_HOLE_PROTECTION_APPLIED',
      message: 'Explicit valid holes remain protected geometric exclusions.',
      source: HOLE_PRESERVE_RULE_ID,
    }] : []),
    ...(blocking ? [{
      code: belowObservedLoss ? 'HATCH_B_HOLE_AUTOMATION_REJECTED' : 'HATCH_B_HOLE_REVIEW_REQUIRED',
      message: belowObservedLoss
        ? 'Automatic generation is rejected at or below the observed loss boundary.'
        : 'Manual review is required below the smallest observed preserved hole.',
      source: HOLE_MIN_SIZE_RULE_ID,
    }] : []),
  ];
  return Object.freeze({
    applied: evaluations.some(evaluation => evaluation.applied),
    preserveGeometry: true,
    geometryMutationAllowed: false,
    requiresManualReview: blocking,
    automaticGenerationRejected: belowObservedLoss,
    measurements: Object.freeze(measurements),
    ruleIds: evaluations.map(evaluation => evaluation.ruleId),
    evaluations: Object.freeze(evaluations.map(evaluation => Object.freeze(evaluation))),
    evidence: Object.freeze(evidence.map(item => Object.freeze(item))),
  });
}
