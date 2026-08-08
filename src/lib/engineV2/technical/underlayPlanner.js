import { TECHNICAL_PLANNING_NUMERIC_DEFAULTS } from './materialProfileModel.js';
import { createUnderlayPlanV2 } from './technicalPlanningModel.js';

export function planObjectUnderlay({ object, geometryMetrics, materialProfile, stitchParameters, config }) {
  const source = { planner: 'engineV2', materialProfileId: materialProfile.id, generatedCoordinates: false, preserveHoles: geometryMetrics.hasHoles };
  if (object.stitchType === 'running') return createUnderlayPlanV2({ applicable: false, enabled: false, sequence: [], source, confidence: 1 });
  if (object.stitchType === 'manual') return createUnderlayPlanV2({ applicable: true, enabled: false, sequence: [], source, confidence: 0, warnings: [{ code: 'UNDERLAY_MANUAL_REQUIRED' }] });
  const scale = materialProfile.underlayScale;
  const sequence = [];
  if (object.stitchType === 'tatami' && !geometryMetrics.isSmall) {
    sequence.push({ type: 'edge_run', insetMm: config.underlay.edgeInsetMm * scale, targetStitchLengthMm: config.running.targetStitchLengthMm, source });
    sequence.push({ type: 'tatami_lattice', spacingMm: config.underlay.latticeSpacingMm / scale, angleDegrees: config.tatami.defaultAngleDegrees, coverageRatio: Math.min(1, config.underlay.latticeCoverageRatio * scale), source });
    if (materialProfile.surface === 'high_loft') sequence.push({ type: 'tatami_lattice', spacingMm: TECHNICAL_PLANNING_NUMERIC_DEFAULTS.underlay.latticeSpacingMm / scale, angleDegrees: (config.tatami.defaultAngleDegrees + TECHNICAL_PLANNING_NUMERIC_DEFAULTS.profiles.parentAngleDifferenceDegrees) % 180, coverageRatio: Math.min(1, config.underlay.latticeCoverageRatio * scale), source });
  }
  if (object.stitchType === 'satin' && stitchParameters.suitable) {
    sequence.push({ type: 'center_run', targetStitchLengthMm: config.underlay.centerRunTargetStitchLengthMm, source });
    if (geometryMetrics.estimatedMedianWidthMm >= config.underlay.wideSatinThresholdMm) sequence.push({ type: 'zigzag', spacingMm: config.underlay.zigzagSpacingMm / scale, coverageRatio: Math.min(1, TECHNICAL_PLANNING_NUMERIC_DEFAULTS.underlay.latticeCoverageRatio * scale), source });
  }
  return createUnderlayPlanV2({ applicable: true, enabled: sequence.length > 0, sequence, source, confidence: sequence.length ? 0.85 : 0.75 });
}
