import { TECHNICAL_PLANNING_NUMERIC_DEFAULTS } from './materialProfileModel.js';

export const normalizeFillAngle = angle => ((angle % 180) + 180) % 180;

export function planFillAngle({ object, geometryMetrics, parentSpecification, config }) {
  const notApplicable = { applicable: false, angleDegrees: null, normalizedAngleDegrees: null, strategy: 'not_applicable', principalAxisDegrees: geometryMetrics.principalAxisDegrees, parentAngleDegrees: null, alternateFromParentDegrees: null, confidence: 1, evidence: [{ code: 'FILL_ANGLE_NOT_APPLICABLE' }], warnings: [] };
  if (object.stitchType === 'running' || object.stitchType === 'manual') return notApplicable;
  const override = object?.parameters?.technicalPlanning?.fillAngleDegrees;
  if (override !== undefined) {
    if (Number.isFinite(override) && object?.parameters?.technicalPlanning?.fillAngleSource) return { ...notApplicable, applicable: true, angleDegrees: override, normalizedAngleDegrees: normalizeFillAngle(override), strategy: 'explicit_override', confidence: 1, evidence: [{ code: 'EXPLICIT_FILL_ANGLE', source: object.parameters.technicalPlanning.fillAngleSource }], warnings: [] };
    return { ...notApplicable, strategy: 'manual_required', confidence: 0, warnings: [{ code: 'INVALID_FILL_ANGLE_OVERRIDE', message: 'Explicit fill angle requires a finite angle and recorded source.' }] };
  }
  if (parentSpecification?.fillAnglePlan?.applicable && ['tatami', 'satin'].includes(object.stitchType)) {
    const parentAngleDegrees = parentSpecification.fillAnglePlan.normalizedAngleDegrees;
    const alternate = TECHNICAL_PLANNING_NUMERIC_DEFAULTS.profiles.parentAngleDifferenceDegrees;
    const angleDegrees = normalizeFillAngle(parentAngleDegrees + alternate);
    return { applicable: true, angleDegrees, normalizedAngleDegrees: angleDegrees, strategy: 'alternate_from_parent', principalAxisDegrees: geometryMetrics.principalAxisDegrees, parentAngleDegrees, alternateFromParentDegrees: alternate, confidence: 0.9, evidence: [{ code: 'ALTERNATED_FROM_STRUCTURAL_PARENT' }], warnings: [] };
  }
  if (Number.isFinite(geometryMetrics.principalAxisDegrees)) {
    const angleDegrees = object.stitchType === 'tatami' ? normalizeFillAngle(geometryMetrics.principalAxisDegrees + 90) : normalizeFillAngle(geometryMetrics.principalAxisDegrees);
    return { applicable: true, angleDegrees, normalizedAngleDegrees: angleDegrees, strategy: object.stitchType === 'tatami' ? 'perpendicular_to_principal_axis' : 'principal_axis', principalAxisDegrees: geometryMetrics.principalAxisDegrees, parentAngleDegrees: null, alternateFromParentDegrees: null, confidence: 0.9, evidence: [{ code: 'GEOMETRY_AXIS_FILL_ANGLE' }], warnings: [] };
  }
  return { applicable: true, angleDegrees: config.tatami.defaultAngleDegrees, normalizedAngleDegrees: normalizeFillAngle(config.tatami.defaultAngleDegrees), strategy: 'configured_default', principalAxisDegrees: null, parentAngleDegrees: null, alternateFromParentDegrees: null, confidence: 0.6, evidence: [{ code: 'CONFIGURED_DEFAULT_FILL_ANGLE' }], warnings: [] };
}
