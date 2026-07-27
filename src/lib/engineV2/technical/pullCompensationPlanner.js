import { createPullCompensationPlanV2 } from './technicalPlanningModel.js';

export function planPullCompensation({ object, geometryMetrics, materialProfile, config }) {
  const maximumAllowedMm = config.pullCompensation.maximumMm;
  if (object.stitchType === 'running' || !config.pullCompensation.enabled) return createPullCompensationPlanV2({ applicable: object.stitchType !== 'manual', enabled: false, strategy: 'none', amountMm: 0, axisDegrees: null, maximumAllowedMm, materialScale: materialProfile.pullCompensationScale, confidence: 1, evidence: [{ code: 'PULL_COMPENSATION_NOT_REQUIRED' }] });
  if (object.stitchType === 'manual' || !Number.isFinite(geometryMetrics.principalAxisDegrees)) return createPullCompensationPlanV2({ applicable: true, enabled: false, strategy: 'manual_required', amountMm: 0, axisDegrees: null, maximumAllowedMm, materialScale: materialProfile.pullCompensationScale, confidence: 0, evidence: [{ code: 'PULL_COMPENSATION_MANUAL_REQUIRED' }] });
  const base = object.stitchType === 'satin' ? config.pullCompensation.satinMm : config.pullCompensation.tatamiMm;
  const requested = base * materialProfile.pullCompensationScale;
  const amountMm = Math.min(maximumAllowedMm, requested);
  const warnings = requested > maximumAllowedMm ? [{ code: 'PULL_COMPENSATION_CLAMPED', requestedMm: requested, maximumAllowedMm }] : [];
  return createPullCompensationPlanV2({ applicable: true, enabled: amountMm > 0, strategy: config.pullCompensation.axisAware ? 'axis_aware' : 'uniform', amountMm, axisDegrees: config.pullCompensation.axisAware ? geometryMetrics.secondaryAxisDegrees : null, maximumAllowedMm, materialScale: materialProfile.pullCompensationScale, confidence: 0.85, evidence: [{ code: 'PULL_COMPENSATION_PLANNED_WITHOUT_OFFSET' }], warnings });
}
