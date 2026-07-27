import { validateEmbroideryObjectV2, validateThreadDefinitionV2 } from '../modelValidation.js';
import { planEntryExitCandidates } from './entryExitCandidatePlanner.js';
import { planFillAngle } from './fillAnglePlanner.js';
import { BUILT_IN_MATERIAL_PROFILES } from './materialProfileModel.js';
import { analyzeEmbroideryObjectGeometry } from './objectGeometryMetrics.js';
import { planPullCompensation } from './pullCompensationPlanner.js';
import { evaluateGeneratorReadiness, evaluateStitchTypeCompatibility, planStitchParameters } from './stitchParameterPlanner.js';
import { createObjectTechnicalSpecificationV2 } from './technicalPlanningModel.js';
import { resolveTechnicalPlanningConfig, validateTechnicalPlanningConfig } from './technicalPlanningConfig.js';
import { validateTechnicalEmbroideryPlan } from './technicalPlanningValidation.js';
import { planObjectUnderlay } from './underlayPlanner.js';

const issue = (code, path, message) => ({ code, path, message });
const snapshot = value => { try { return JSON.stringify(value); } catch { return null; } };

function fingerprint(value) {
  const text = snapshot(value) ?? '';
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function contractFor(object) {
  return { geometryFingerprint: fingerprint(object.geometry), holesFingerprint: fingerprint(object.holes), visualColorFingerprint: fingerprint(object.visualColor), threadId: object.threadId, role: object.role, stitchType: object.stitchType, layer: object.layer, dependencyIds: [...(object.dependencyIds || [])].sort() };
}

function count(items, predicate) { return items.filter(predicate).length; }

function dependencyCycleCount(objects) {
  const byId = new Map(objects.map(item => [item.id, item])); const visiting = new Set(); const visited = new Set(); let cycles = 0;
  const visit = id => { if (visiting.has(id)) { cycles += 1; return; } if (visited.has(id)) return; visiting.add(id); (byId.get(id)?.dependencyIds || []).filter(dependencyId => byId.has(dependencyId)).forEach(visit); visiting.delete(id); visited.add(id); };
  objects.forEach(item => visit(item.id)); return cycles;
}

function summaryFor(objects, specifications) {
  const objectIds = new Set(objects.map(item => item.id)); const covered = new Set(specifications.filter(item => objectIds.has(item.objectId)).map(item => item.objectId));
  const duplicateTechnicalSpecificationCount = specifications.length - new Set(specifications.map(item => item.id)).size;
  return {
    sourceFinalObjectCount: objects.length,
    technicalSpecificationCount: specifications.length,
    technicalDispositionCoveragePercent: objects.length ? covered.size / objects.length * 100 : 100,
    silentFinalObjectDropCount: objects.length - covered.size,
    plannedCount: count(specifications, item => item.status === 'planned'), manualRequiredCount: count(specifications, item => item.status === 'manual_required'), blockedCount: count(specifications, item => item.status === 'blocked'),
    tatamiSpecificationCount: count(specifications, item => item.stitchType === 'tatami'), satinSpecificationCount: count(specifications, item => item.stitchType === 'satin'), runningSpecificationCount: count(specifications, item => item.stitchType === 'running'), manualSpecificationCount: count(specifications, item => item.stitchType === 'manual'),
    tatamiReadyCount: count(specifications, item => item.generatorReadiness.generator === 'tatami' && item.generatorReadiness.ready), satinReadyCount: count(specifications, item => item.generatorReadiness.generator === 'satin' && item.generatorReadiness.ready), runningReadyCount: count(specifications, item => item.generatorReadiness.generator === 'running' && item.generatorReadiness.ready), generatorNotReadyCount: count(specifications, item => !item.generatorReadiness.ready),
    underlayPlannedCount: count(specifications, item => item.underlayPlan.enabled), pullCompensationPlannedCount: count(specifications, item => item.pullCompensationPlan.enabled), fillAnglePlannedCount: count(specifications, item => item.fillAnglePlan.applicable),
    entryCandidateCount: specifications.reduce((sum, item) => sum + item.entryCandidates.length, 0), exitCandidateCount: specifications.reduce((sum, item) => sum + item.exitCandidates.length, 0), objectsWithoutEntryCandidates: count(specifications, item => !item.entryCandidates.some(candidate => candidate.valid)), objectsWithoutExitCandidates: count(specifications, item => !item.exitCandidates.some(candidate => candidate.valid)),
    invalidGeometryCount: count(specifications, item => !item.geometryMetrics.geometryValid || !item.geometryMetrics.holeGeometryValid), incompatibleStitchTypeCount: count(specifications, item => item.blockingReasons.some(reason => ['INVALID_GEOMETRY_FOR_STITCH_TYPE', 'TATAMI_AREA_BELOW_MINIMUM', 'SATIN_WIDTH_BELOW_MINIMUM', 'SATIN_WIDTH_ABOVE_MAXIMUM', 'SATIN_WIDTH_VARIATION_EXCESSIVE', 'RUNNING_PATH_INTENT_REQUIRED'].includes(reason.code))), explicitHoleObjectCount: count(specifications, item => item.geometryMetrics.hasHoles),
    duplicateTechnicalSpecificationCount, dependencyCycleCount: dependencyCycleCount(objects),
    objectMutationCount: 0, geometryMutationCount: 0, holeMutationCount: 0, visualColorMutationCount: 0, threadIdMutationCount: 0,
    threadBlockCount: 0, physicalStitchCoordinateCount: 0, physicalUnderlayCoordinateCount: 0, canonicalCommandCount: 0,
  };
}

export function buildTechnicalEmbroideryPlan({ regions = [], threadedObjectMaterialization, config: rawConfig = {} }) {
  const before = snapshot({ regions, threadedObjectMaterialization, rawConfig });
  const configValidation = validateTechnicalPlanningConfig(rawConfig);
  const config = resolveTechnicalPlanningConfig(rawConfig);
  const materialProfile = configValidation.materialProfile ?? BUILT_IN_MATERIAL_PROFILES.generic_medium_woven;
  const objects = [...(threadedObjectMaterialization?.objects || [])]; const threads = threadedObjectMaterialization?.threads || [];
  const threadIds = new Set(threads.map(item => item.id)); const regionIds = new Set(regions.map(item => item.id));
  const errors = [...configValidation.errors]; const warnings = [...configValidation.warnings];
  objects.forEach((object, index) => {
    const validation = validateEmbroideryObjectV2(object); errors.push(...validation.errors.map(item => ({ ...item, path: `objects[${index}].${item.path}` })));
    if (!threadIds.has(object.threadId)) errors.push(issue('TECHNICAL_INPUT_UNKNOWN_THREAD', `objects[${index}].threadId`, `Unknown thread "${object.threadId}".`));
    if (!regionIds.has(object.regionId)) errors.push(issue('TECHNICAL_INPUT_UNKNOWN_REGION', `objects[${index}].regionId`, `Unknown region "${object.regionId}".`));
  });
  threads.forEach((thread, index) => errors.push(...validateThreadDefinitionV2(thread).errors.map(item => ({ ...item, path: `threads[${index}].${item.path}` }))));
  const objectMap = new Map(objects.map(item => [item.id, item])); const specificationMap = new Map();
  const layerOrder = Array.isArray(threadedObjectMaterialization?.executionLayers) && threadedObjectMaterialization.executionLayers.flat().length === objects.length ? threadedObjectMaterialization.executionLayers.map(layer => [...layer].sort()) : [objects.map(item => item.id).sort()];
  layerOrder.flat().forEach(objectId => {
    const object = objectMap.get(objectId); if (!object) return;
    const geometryMetrics = analyzeEmbroideryObjectGeometry(object, config);
    const compatibility = evaluateStitchTypeCompatibility({ object, geometryMetrics, config });
    const stitchParameters = planStitchParameters({ object, geometryMetrics, materialProfile, compatibility, config });
    const parentSpecification = [...(object.dependencyIds || [])].sort().map(id => specificationMap.get(id)).find(item => item?.fillAnglePlan?.applicable) ?? null;
    const fillAnglePlan = planFillAngle({ object, geometryMetrics, parentSpecification, config });
    const underlayPlan = planObjectUnderlay({ object, geometryMetrics, materialProfile, stitchParameters, config });
    const pullCompensationPlan = planPullCompensation({ object, geometryMetrics, materialProfile, config });
    const candidates = planEntryExitCandidates({ object, geometryMetrics, relatedObjects: [], config });
    const generatorReadiness = evaluateGeneratorReadiness({ object, geometryMetrics, compatibility, stitchParameters, fillAnglePlan, entryCandidates: candidates.entryCandidates, exitCandidates: candidates.exitCandidates });
    const manualReason = compatibility.blockingReasons.some(reason => reason.disposition === 'manual_required') || object.stitchType === 'manual';
    const manualApproved = object.stitchType === 'manual' && config.allowManualSpecifications && object?.parameters?.technicalIntent?.manualSpecificationApproved === true && object?.parameters?.technicalIntent?.manualSpecificationSource;
    const blockedByConfig = configValidation.errors.length > 0; const invalidGeometry = !geometryMetrics.geometryValid || !geometryMetrics.holeGeometryValid;
    const automaticConfidence = generatorReadiness.ready ? Math.min(object.confidence ?? 0, compatibility.confidence, generatorReadiness.confidence, fillAnglePlan.confidence, underlayPlan.confidence, pullCompensationPlan.confidence) : 0;
    let status;
    if (blockedByConfig) status = 'blocked';
    else if (manualApproved) status = 'planned';
    else if (manualReason) status = 'manual_required';
    else if (invalidGeometry) status = config.blockInvalidGeometry ? 'blocked' : 'manual_required';
    else if (!compatibility.compatible) status = config.blockIncompatibleStitchType ? 'blocked' : 'manual_required';
    else if (!generatorReadiness.ready) status = 'blocked';
    else status = automaticConfidence >= config.minimumAutomaticConfidence ? 'planned' : 'manual_required';
    const blockingReasons = manualApproved ? compatibility.blockingReasons.filter(reason => reason.code !== 'MANUAL_STITCH_REQUIRES_OPERATOR') : [...compatibility.blockingReasons];
    if (blockedByConfig) blockingReasons.push({ code: 'INVALID_TECHNICAL_PLANNING_CONFIG', message: 'Technical planning configuration is invalid.' });
    if (!generatorReadiness.ready && !blockingReasons.length) blockingReasons.push({ code: 'GENERATOR_REQUIREMENTS_INCOMPLETE', missingRequirements: generatorReadiness.missingRequirements });
    const confidence = manualApproved ? object.confidence ?? 0 : status === 'planned' ? automaticConfidence : 0;
    const specification = createObjectTechnicalSpecificationV2({
      objectId: object.id, regionId: object.regionId, threadId: object.threadId, role: object.role, stitchType: object.stitchType, status,
      materialProfileId: materialProfile.id, planningProfile: config.profile, geometryMetrics, stitchParameters, underlayPlan, fillAnglePlan, pullCompensationPlan,
      entryCandidates: candidates.entryCandidates, exitCandidates: candidates.exitCandidates, generatorReadiness, planningConfidence: confidence,
      needsReview: status !== 'planned' || confidence < config.minimumAutomaticConfidence, blockingReasons, warnings: [...compatibility.warnings, ...geometryMetrics.warnings, ...underlayPlan.warnings, ...pullCompensationPlan.warnings],
      evidence: [...compatibility.evidence, ...fillAnglePlan.evidence],
      source: { planner: 'engineV2', objectContract: contractFor(object), physicalStitchesGenerated: false, finalEntryExitPairSelected: false },
    });
    specificationMap.set(object.id, specification);
  });
  const specifications = [...specificationMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const summary = summaryFor(objects, specifications);
  const plan = {
    version: '2-technical-embroidery-plan', materialProfile, specifications,
    bySpecificationId: Object.fromEntries(specifications.map(item => [item.id, item])), byObjectId: Object.fromEntries(specifications.map(item => [item.objectId, item])),
    executionLayers: layerOrder.map(layer => [...layer]), valid: errors.length === 0, errors, warnings, summary, config,
    metadata: { inputMutationsDetected: before !== snapshot({ regions, threadedObjectMaterialization, rawConfig }), technicalSpecificationsCreated: true, objectMutationsDetected: false, threadBlocksCreated: 0, physicalStitchesGenerated: false, physicalUnderlayGenerated: false, finalEntryExitPairSelected: false, globalSequencingApplied: false, travelOptimizationApplied: false, canonicalCommandsGenerated: false, machineAdaptationApplied: false, encodingApplied: false },
  };
  const validation = validateTechnicalEmbroideryPlan(plan, threadedObjectMaterialization, regions);
  return { ...plan, valid: plan.valid && validation.valid, errors: [...plan.errors, ...validation.errors], warnings: [...plan.warnings, ...validation.warnings] };
}

export const _technicalPlanningPipelineInternals = Object.freeze({ fingerprint, contractFor });
