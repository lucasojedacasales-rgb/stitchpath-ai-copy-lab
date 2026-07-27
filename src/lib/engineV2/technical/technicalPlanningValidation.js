import { isPointInEffectiveObjectArea, isPointOnObjectBoundary } from './objectGeometryMetrics.js';
import { validateMaterialProfileV2 } from './materialProfileModel.js';
import { ENTRY_EXIT_KINDS, ENTRY_EXIT_SOURCE_TYPES, FILL_ANGLE_STRATEGIES, GENERATOR_TYPES, PULL_COMPENSATION_STRATEGIES, TECHNICAL_SPECIFICATION_STATUSES, UNDERLAY_COMPONENT_TYPES, technicalSpecificationIdForObject } from './technicalPlanningModel.js';
import { TECHNICAL_PLANNING_PROFILES } from './technicalPlanningConfig.js';

const issue = (code, path, message) => ({ code, path, message });
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);

function fingerprint(value) {
  let text = ''; try { text = JSON.stringify(value); } catch { text = ''; }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function forbiddenFields(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  const forbidden = new Set(['stitches', 'stitchCoordinates', 'underlayCoordinates', 'threadBlocks', 'commands', 'canonicalCommands', 'sequenceIndex', 'globalSequence', 'travelRoute', 'route', 'machineProfile', 'machineLimits', 'ce01', 'encoder', 'dst', 'dsb']);
  Object.entries(value).forEach(([key, nested]) => {
    if (forbidden.has(key)) errors.push(issue('FORBIDDEN_TECHNICAL_FIELD', `${path}.${key}`, `${key} is forbidden in Phase 7.`));
    else forbiddenFields(nested, `${path}.${key}`, errors);
  });
}

function validateParameters(specification, errors, path) {
  const values = specification.stitchParameters;
  if (!values || typeof values !== 'object') { errors.push(issue('INVALID_STITCH_PARAMETERS', `${path}.stitchParameters`, 'Stitch parameters are required.')); return; }
  if (specification.stitchType === 'tatami' || specification.stitchType === 'running') {
    if (!(values.minimumStitchLengthMm >= 0) || !(values.maximumStitchLengthMm >= values.minimumStitchLengthMm) || !(values.targetStitchLengthMm >= values.minimumStitchLengthMm && values.targetStitchLengthMm <= values.maximumStitchLengthMm)) errors.push(issue('INVALID_STITCH_PARAMETER_RANGE', `${path}.stitchParameters`, 'Stitch-length range is invalid.'));
  }
  if (specification.stitchType === 'tatami' && !(values.spacingMm > 0)) errors.push(issue('INVALID_STITCH_SPACING', `${path}.stitchParameters.spacingMm`, 'Tatami spacing must be positive.'));
  if (specification.stitchType === 'satin' && (!(values.spacingMm > 0) || values.minimumAllowedWidthMm > values.maximumAllowedWidthMm)) errors.push(issue('INVALID_SATIN_PARAMETERS', `${path}.stitchParameters`, 'Satin spacing or width range is invalid.'));
}

function validateCandidates(specification, object, config = { entryExit: { maximumCandidatesPerObject: Infinity } }, errors, path) {
  const candidates = [...(specification.entryCandidates || []), ...(specification.exitCandidates || [])];
  const ids = new Set();
  candidates.forEach((candidate, index) => {
    const candidatePath = `${path}.candidates[${index}]`;
    if (!candidate.id || candidate.objectId !== object.id || !ENTRY_EXIT_KINDS.includes(candidate.kind) || !ENTRY_EXIT_SOURCE_TYPES.includes(candidate.sourceType) || !finitePoint(candidate.point)) errors.push(issue('INVALID_ENTRY_EXIT_CANDIDATE', candidatePath, 'Entry/exit candidate is malformed.'));
    if (ids.has(candidate.id)) errors.push(issue('DUPLICATE_CANDIDATE_ID', candidatePath, `Duplicate candidate ID "${candidate.id}".`)); ids.add(candidate.id);
    if (candidate.valid && candidate.sourceType === 'interior_point' && !isPointInEffectiveObjectArea(candidate.point, object, { boundaryInside: false })) errors.push(issue('INTERIOR_CANDIDATE_OUTSIDE_EFFECTIVE_AREA', candidatePath, 'Valid interior candidate lies outside effective area or inside a hole.'));
    if (candidate.valid && candidate.sourceType !== 'interior_point' && !isPointOnObjectBoundary(candidate.point, object)) errors.push(issue('BOUNDARY_CANDIDATE_OUTSIDE_SOURCE_GEOMETRY', candidatePath, 'Boundary candidate is not on source geometry.'));
  });
  if (specification.entryCandidates.length > config.entryExit.maximumCandidatesPerObject || specification.exitCandidates.length > config.entryExit.maximumCandidatesPerObject) errors.push(issue('TOO_MANY_ENTRY_EXIT_CANDIDATES', path, 'Candidate count exceeds the configured maximum.'));
}

export function validateObjectTechnicalSpecificationV2(specification, options = {}) {
  const errors = []; const warnings = []; const path = options.path ?? 'specification'; const object = options.object;
  if (!specification || typeof specification !== 'object') return { valid: false, errors: [issue('INVALID_TECHNICAL_SPECIFICATION', path, 'Technical specification must be an object.')], warnings };
  if (!specification.id) errors.push(issue('MISSING_TECHNICAL_SPECIFICATION_ID', `${path}.id`, 'Specification ID is required.'));
  if (!specification.objectId) errors.push(issue('MISSING_TECHNICAL_OBJECT_REFERENCE', `${path}.objectId`, 'Object reference is required.'));
  if (specification.objectId && specification.id !== technicalSpecificationIdForObject(specification.objectId)) errors.push(issue('NONDETERMINISTIC_TECHNICAL_SPECIFICATION_ID', `${path}.id`, 'Specification ID is not deterministic.'));
  if (!TECHNICAL_SPECIFICATION_STATUSES.includes(specification.status)) errors.push(issue('INVALID_TECHNICAL_STATUS', `${path}.status`, 'Technical status is invalid.'));
  if (!TECHNICAL_PLANNING_PROFILES.includes(specification.planningProfile)) errors.push(issue('INVALID_SPECIFICATION_PLANNING_PROFILE', `${path}.planningProfile`, 'Planning profile is invalid.'));
  validateParameters(specification, errors, path);
  if (!specification.fillAnglePlan || !FILL_ANGLE_STRATEGIES.includes(specification.fillAnglePlan.strategy)) errors.push(issue('INVALID_FILL_ANGLE_PLAN', `${path}.fillAnglePlan`, 'Fill-angle plan is invalid.'));
  else if (specification.fillAnglePlan.applicable && (!Number.isFinite(specification.fillAnglePlan.normalizedAngleDegrees) || specification.fillAnglePlan.normalizedAngleDegrees < 0 || specification.fillAnglePlan.normalizedAngleDegrees >= 180)) errors.push(issue('FILL_ANGLE_OUT_OF_RANGE', `${path}.fillAnglePlan.normalizedAngleDegrees`, 'Normalized fill angle must be in [0, 180).'));
  (specification.underlayPlan?.sequence || []).forEach((component, index) => { if (!UNDERLAY_COMPONENT_TYPES.includes(component.type)) errors.push(issue('INVALID_UNDERLAY_COMPONENT', `${path}.underlayPlan.sequence[${index}]`, 'Unknown underlay component.')); forbiddenFields(component, `${path}.underlayPlan.sequence[${index}]`, errors); });
  if (!PULL_COMPENSATION_STRATEGIES.includes(specification.pullCompensationPlan?.strategy) || specification.pullCompensationPlan?.amountMm < 0 || specification.pullCompensationPlan?.amountMm > specification.pullCompensationPlan?.maximumAllowedMm) errors.push(issue('INVALID_PULL_COMPENSATION_PLAN', `${path}.pullCompensationPlan`, 'Pull compensation is invalid or above its maximum.'));
  if (!GENERATOR_TYPES.includes(specification.generatorReadiness?.generator)) errors.push(issue('INVALID_GENERATOR_READINESS', `${path}.generatorReadiness`, 'Generator readiness is invalid.'));
  if (specification.generatorReadiness?.ready && specification.generatorReadiness.missingRequirements?.length) errors.push(issue('GENERATOR_READY_WITH_MISSING_REQUIREMENTS', `${path}.generatorReadiness`, 'Ready generator has missing requirements.'));
  if (specification.stitchType === 'manual' && specification.generatorReadiness?.ready) errors.push(issue('MANUAL_GENERATOR_MARKED_READY', `${path}.generatorReadiness`, 'Manual objects cannot be automatically ready.'));
  if (object) validateCandidates(specification, object, options.config, errors, path);
  forbiddenFields(specification, path, errors);
  return { valid: errors.length === 0, errors, warnings };
}

export function validateTechnicalEmbroideryPlan(plan, threadedObjectMaterialization, regions = []) {
  const errors = []; const warnings = [];
  const objects = threadedObjectMaterialization?.objects || []; const specifications = plan?.specifications || [];
  const objectMap = new Map(objects.map(item => [item.id, item])); const regionIds = new Set(regions.map(item => item.id)); const counts = new Map(); const specificationIds = new Set();
  const materialValidation = validateMaterialProfileV2(plan?.materialProfile); errors.push(...materialValidation.errors.map(item => ({ ...item, path: `materialProfile.${item.path}` })));
  specifications.forEach((specification, index) => {
    const path = `specifications[${index}]`; const object = objectMap.get(specification.objectId);
    if (specificationIds.has(specification.id)) errors.push(issue('DUPLICATE_TECHNICAL_SPECIFICATION_ID', `${path}.id`, `Duplicate specification ID "${specification.id}".`)); specificationIds.add(specification.id);
    counts.set(specification.objectId, (counts.get(specification.objectId) || 0) + 1);
    if (!object) errors.push(issue('UNKNOWN_TECHNICAL_OBJECT_REFERENCE', `${path}.objectId`, `Unknown object "${specification.objectId}".`));
    if (!regionIds.has(specification.regionId)) errors.push(issue('UNKNOWN_TECHNICAL_REGION_REFERENCE', `${path}.regionId`, `Unknown region "${specification.regionId}".`));
    const validation = validateObjectTechnicalSpecificationV2(specification, { object, config: plan.config, path }); errors.push(...validation.errors);
    if (object) {
      if (specification.threadId !== object.threadId) errors.push(issue('TECHNICAL_THREAD_ID_MUTATION', `${path}.threadId`, 'Thread ID changed.'));
      if (specification.role !== object.role) errors.push(issue('TECHNICAL_ROLE_MUTATION', `${path}.role`, 'Role changed.'));
      if (specification.stitchType !== object.stitchType) errors.push(issue('TECHNICAL_STITCH_TYPE_MUTATION', `${path}.stitchType`, 'Stitch type changed.'));
      const contract = specification.source?.objectContract;
      if (contract) {
        if (contract.geometryFingerprint !== fingerprint(object.geometry)) errors.push(issue('TECHNICAL_GEOMETRY_MUTATION', `${path}.source.objectContract.geometryFingerprint`, 'Object geometry changed after planning.'));
        if (contract.holesFingerprint !== fingerprint(object.holes)) errors.push(issue('TECHNICAL_HOLE_MUTATION', `${path}.source.objectContract.holesFingerprint`, 'Object holes changed after planning.'));
        if (contract.visualColorFingerprint !== fingerprint(object.visualColor)) errors.push(issue('TECHNICAL_VISUAL_COLOR_MUTATION', `${path}.source.objectContract.visualColorFingerprint`, 'Object visual color changed after planning.'));
        if (contract.layer !== object.layer) errors.push(issue('TECHNICAL_LAYER_MUTATION', `${path}.source.objectContract.layer`, 'Object layer changed after planning.'));
        if (JSON.stringify(contract.dependencyIds) !== JSON.stringify([...(object.dependencyIds || [])].sort())) errors.push(issue('TECHNICAL_DEPENDENCY_MUTATION', `${path}.source.objectContract.dependencyIds`, 'Object dependencies changed after planning.'));
      }
    }
  });
  objects.forEach(object => { const count = counts.get(object.id) || 0; if (!count) errors.push(issue('FINAL_OBJECT_WITHOUT_TECHNICAL_SPECIFICATION', 'specifications', `Object "${object.id}" has no specification.`)); if (count > 1) errors.push(issue('MULTIPLE_TECHNICAL_SPECIFICATIONS_FOR_OBJECT', 'specifications', `Object "${object.id}" has multiple specifications.`)); });
  if (plan?.summary?.technicalDispositionCoveragePercent !== 100 && objects.length) errors.push(issue('TECHNICAL_DISPOSITION_COVERAGE_BELOW_100', 'summary.technicalDispositionCoveragePercent', 'Technical disposition coverage must be 100%.'));
  if (plan?.summary?.silentFinalObjectDropCount > 0) errors.push(issue('SILENT_FINAL_OBJECT_DROP', 'summary.silentFinalObjectDropCount', 'Final objects were silently dropped.'));
  if (plan?.summary?.dependencyCycleCount > 0) errors.push(issue('TECHNICAL_INPUT_DEPENDENCY_CYCLE', 'summary.dependencyCycleCount', 'Input object dependencies contain a cycle.'));
  if (plan?.metadata?.inputMutationsDetected || plan?.metadata?.objectMutationsDetected) errors.push(issue('TECHNICAL_PLANNING_INPUT_MUTATION', 'metadata', 'Technical planning mutated input objects.'));
  forbiddenFields(plan, 'plan', errors);
  return { valid: errors.length === 0, errors, warnings };
}
