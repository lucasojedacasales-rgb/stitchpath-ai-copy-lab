import { createGeneratorReadinessV2 } from './technicalPlanningModel.js';

const evidence = code => ({ code, source: 'engineV2_technical_planning' });

export function evaluateStitchTypeCompatibility({ object, geometryMetrics, config }) {
  const blockingReasons = []; const warnings = [...(geometryMetrics?.warnings || [])]; const stitchType = object?.stitchType;
  if (!geometryMetrics?.geometryValid || !geometryMetrics?.holeGeometryValid) blockingReasons.push({ code: 'INVALID_GEOMETRY_FOR_STITCH_TYPE', message: 'Object geometry is invalid for technical planning.' });
  if (stitchType === 'tatami') {
    if (!geometryMetrics?.isClosedGeometry) blockingReasons.push({ code: 'TATAMI_REQUIRES_CLOSED_GEOMETRY', message: 'Tatami requires closed region geometry.' });
    if (geometryMetrics?.effectiveAreaMm2 < config.tatami.minimumAreaMm2) blockingReasons.push({ code: 'TATAMI_AREA_BELOW_MINIMUM', message: 'Tatami effective area is below the configured minimum.' });
  } else if (stitchType === 'satin') {
    if (!geometryMetrics?.isClosedGeometry || !Number.isFinite(geometryMetrics?.principalAxisDegrees)) blockingReasons.push({ code: 'SATIN_DIRECTION_UNAVAILABLE', message: 'Satin requires valid region-backed geometry and a principal direction.' });
    if (geometryMetrics?.estimatedMedianWidthMm < config.satin.minimumWidthMm) blockingReasons.push({ code: 'SATIN_WIDTH_BELOW_MINIMUM', message: 'Estimated satin width is below the configured minimum.' });
    if (geometryMetrics?.estimatedMedianWidthMm > config.satin.maximumWidthMm || geometryMetrics?.isLarge) blockingReasons.push({ code: 'SATIN_WIDTH_ABOVE_MAXIMUM', message: 'Broad geometry is unsuitable for automatic satin planning.' });
    if (geometryMetrics?.widthVariationRatio > config.satin.maximumWidthVariationRatio) blockingReasons.push({ code: 'SATIN_WIDTH_VARIATION_EXCESSIVE', message: 'Estimated satin width variation is excessive.' });
    else if (geometryMetrics?.widthVariationRatio > config.satin.warningWidthVariationRatio) warnings.push({ code: 'SATIN_WIDTH_VARIATION_WARNING', message: 'Estimated satin width variation requires review.' });
  } else if (stitchType === 'running') {
    const explicitLineIntent = object?.parameters?.technicalIntent?.lineIntent === true || object?.source?.technicalGeometryIntent === 'open_path';
    const outlineIntent = ['outer_outline', 'inner_outline'].includes(object?.role);
    if (!explicitLineIntent && !outlineIntent) blockingReasons.push({ code: 'RUNNING_PATH_INTENT_REQUIRED', disposition: 'manual_required', message: 'Running stitch cannot invent a centerline from broad polygon geometry.' });
  } else if (stitchType === 'manual') {
    blockingReasons.push({ code: 'MANUAL_STITCH_REQUIRES_OPERATOR', disposition: 'manual_required', message: 'Manual stitch remains an explicit manual requirement.' });
  } else blockingReasons.push({ code: 'UNSUPPORTED_STITCH_TYPE', message: `Unsupported stitch type: ${String(stitchType)}.` });
  const compatible = blockingReasons.length === 0;
  return { compatible, stitchType, confidence: compatible ? Math.min(1, object?.confidence ?? 0) : 0, blockingReasons, warnings, evidence: [evidence('STITCH_TYPE_COMPATIBILITY_EVALUATED')] };
}

export function planStitchParameters({ object, geometryMetrics, materialProfile, compatibility, config }) {
  const source = { planner: 'engineV2', materialProfileId: materialProfile.id, generatedCoordinates: false };
  if (object.stitchType === 'tatami') return {
    spacingMm: materialProfile.defaultTatamiSpacingMm,
    targetStitchLengthMm: config.tatami.targetStitchLengthMm,
    minimumStitchLengthMm: config.tatami.minimumStitchLengthMm,
    maximumStitchLengthMm: config.tatami.maximumStitchLengthMm,
    edgeInsetMm: config.tatami.edgeInsetMm,
    staggerRatio: config.tatami.staggerRatio,
    reversibleRows: true,
    preserveHoles: geometryMetrics.hasHoles,
    source,
  };
  if (object.stitchType === 'satin') return {
    spacingMm: materialProfile.defaultSatinSpacingMm,
    estimatedWidthMm: geometryMetrics.estimatedMedianWidthMm,
    minimumAllowedWidthMm: config.satin.minimumWidthMm,
    maximumAllowedWidthMm: config.satin.maximumWidthMm,
    widthVariationRatio: geometryMetrics.widthVariationRatio,
    suitable: compatibility.compatible,
    suitabilityReasons: compatibility.blockingReasons.map(item => item.code),
    source,
  };
  if (object.stitchType === 'running') return {
    targetStitchLengthMm: materialProfile.defaultRunningLengthMm,
    minimumStitchLengthMm: config.running.minimumStitchLengthMm,
    maximumStitchLengthMm: config.running.maximumStitchLengthMm,
    passes: config.running.defaultPasses,
    closedPathExpected: geometryMetrics.isClosedGeometry,
    source,
  };
  return { automaticGenerationAllowed: false, reason: compatibility.blockingReasons[0]?.code ?? 'MANUAL_STITCH_REQUIRED', source };
}

export function evaluateGeneratorReadiness({ object, geometryMetrics, compatibility, stitchParameters, fillAnglePlan, entryCandidates, exitCandidates }) {
  const missingRequirements = [];
  const validEntries = entryCandidates.filter(item => item.valid); const validExits = exitCandidates.filter(item => item.valid);
  if (!compatibility.compatible) missingRequirements.push(...compatibility.blockingReasons.map(item => item.code));
  if (!geometryMetrics.geometryValid || !geometryMetrics.holeGeometryValid) missingRequirements.push('VALID_GEOMETRY_REQUIRED');
  if (!validEntries.length) missingRequirements.push('VALID_ENTRY_CANDIDATE_REQUIRED');
  if (!validExits.length) missingRequirements.push('VALID_EXIT_CANDIDATE_REQUIRED');
  if (object.stitchType === 'tatami') {
    if (!(stitchParameters.spacingMm > 0)) missingRequirements.push('VALID_TATAMI_SPACING_REQUIRED');
    if (!fillAnglePlan.applicable || !Number.isFinite(fillAnglePlan.normalizedAngleDegrees)) missingRequirements.push('VALID_FILL_ANGLE_REQUIRED');
    if (stitchParameters.preserveHoles !== geometryMetrics.hasHoles) missingRequirements.push('VALID_HOLE_HANDLING_REQUIRED');
  } else if (object.stitchType === 'satin') {
    if (!stitchParameters.suitable) missingRequirements.push('SATIN_SUITABILITY_REQUIRED');
    if (!fillAnglePlan.applicable) missingRequirements.push('SATIN_DIRECTION_REQUIRED');
  } else if (object.stitchType === 'running') {
    if (!(stitchParameters.minimumStitchLengthMm <= stitchParameters.maximumStitchLengthMm)) missingRequirements.push('VALID_RUNNING_LENGTH_RANGE_REQUIRED');
  } else missingRequirements.push('MANUAL_GENERATOR_NOT_AUTOMATIC');
  const generator = ['tatami', 'satin', 'running'].includes(object.stitchType) ? object.stitchType : 'manual';
  return createGeneratorReadinessV2({ generator, ready: missingRequirements.length === 0 && generator !== 'manual', confidence: missingRequirements.length ? 0 : Math.min(object.confidence ?? 0, compatibility.confidence), missingRequirements: [...new Set(missingRequirements)], warnings: compatibility.warnings, source: { planner: 'engineV2', physicalStitchesGenerated: false } });
}
