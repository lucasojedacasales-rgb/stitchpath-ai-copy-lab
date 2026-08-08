import { ALLOWED_EMBROIDERY_ROLES, ALLOWED_STITCH_TYPES } from '../../model.js';
import { validateRegionV2 } from '../../modelValidation.js';
import { buildEmbroideryProposalDependencies } from '../../planning/dependencyPlanner.js';
import { ARTWORK_SEMANTIC_ROLES } from '../../semantics/semanticRoleModel.js';
import { buildRegionGraphV2 } from '../../topology/regionGraph.js';
import { resolveHatchOverlapIntegrationConfig } from './overlapProfiles.js';

export const MULTILAYER_DEPENDENCY_RULE_ID = 'MULTILAYER-DEPENDENCY-001';
export const MULTILAYER_DEPENDENCY_CONTRACT_VERSION = 'engine-v2-hatch-c3-multilayer-contract-r1';
export const MULTILAYER_DEPENDENCY_EVALUATION_VERSION = 'engine-v2-hatch-c3-multilayer-evaluation-r1';
export const MULTILAYER_DEPENDENCY_MARKER_VERSION = 'engine-v2-hatch-c3-multilayer-marker-r1';
export const MULTILAYER_DEPENDENCY_TRACE_VERSION = 'engine-v2-hatch-c3-multilayer-trace-r1';

const CORE_ROLES = Object.freeze(ALLOWED_EMBROIDERY_ROLES.filter(role => [
  'base_fill',
  'foreground_fill',
  'internal_detail',
  'dark_detail',
  'highlight',
].includes(role)));
const OUTLINE_ROLES = Object.freeze(ALLOWED_EMBROIDERY_ROLES.filter(role => [
  'inner_outline',
  'outer_outline',
].includes(role)));
const ROLE_SEMANTIC_AUTHORITY = Object.freeze({
  base_fill: Object.freeze(['background', 'primary_shape']),
  foreground_fill: Object.freeze(['secondary_shape']),
  internal_detail: Object.freeze(['internal_feature']),
  dark_detail: Object.freeze(['dark_mark']),
  highlight: Object.freeze(['highlight']),
  inner_outline: Object.freeze(['dark_mark']),
  outer_outline: Object.freeze(['dark_mark']),
});
const CLAIM_BOUNDARY = Object.freeze({
  scope: 'precedence_only',
  cutoutEvaluated: false,
  cutoutCorrectnessClaimed: false,
  orderModified: false,
  dependenciesModified: false,
  geometryModified: false,
  physicalImprovementClaimed: false,
});

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const own = (value, field) => Boolean(value)
  && typeof value === 'object'
  && Object.hasOwn(value, field);
const nonEmptyString = value => typeof value === 'string' && value.trim().length > 0;
const plainObject = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function structuralType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value !== 'object') return typeof value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return 'null_prototype_object';
  if (prototype === Object.prototype) return 'plain_object';
  return prototype?.constructor?.name
    ? `prototype:${prototype.constructor.name}`
    : 'custom_prototype_object';
}

function readableRegionId(region) {
  return own(region, 'id') && typeof region.id === 'string'
    ? region.id
    : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function fingerprint(value) {
  let text = '';
  try { text = JSON.stringify(value); } catch { text = ''; }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function issue(code, path, message, evidence = null) {
  return {
    code,
    path,
    message,
    ...(evidence ? { evidence } : {}),
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function uniqueIssues(errors) {
  return errors.filter((error, index, all) => all.findIndex(candidate =>
    candidate.code === error.code
    && candidate.path === error.path
    && same(candidate.evidence ?? null, error.evidence ?? null)) === index);
}

function integrationFor(config) {
  const integration = resolveHatchOverlapIntegrationConfig(config);
  return deepFreeze({
    profile: integration.profile,
    ruleEnabled: integration.ruleFlags[MULTILAYER_DEPENDENCY_RULE_ID] === true,
    enabledRuleIds: [...integration.enabledRuleIds],
    ruleFlags: { ...integration.ruleFlags },
  });
}

function validPoint(point) {
  return Boolean(point)
    && typeof point === 'object'
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function validatePolygon(polygon) {
  return Array.isArray(polygon)
    && polygon.length >= 3
    && polygon.every(validPoint);
}

function validateGeometryOwner(owner) {
  return validatePolygon(owner?.geometry)
    && Array.isArray(owner?.holes)
    && owner.holes.every(validatePolygon);
}

function lineageFor(object, path, errors) {
  const source = object?.source;
  const fields = ['proposalId', 'draftId', 'reviewDecisionId', 'threadAssignmentId'];
  if (!source || typeof source !== 'object') {
    errors.push(issue(
      'MULTILAYER_AUTHORITATIVE_INPUTS_MISSING',
      `${path}.source`,
      'C3 requires explicit proposal-to-draft-to-object lineage on every participant.',
      { objectId: object?.id ?? null },
    ));
    return null;
  }
  fields.forEach(field => {
    if (!own(source, field) || !nonEmptyString(source[field])) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_INPUTS_MISSING',
        `${path}.source.${field}`,
        `C3 requires the own non-empty lineage field "${field}".`,
        { objectId: object?.id ?? null, received: source?.[field] ?? null },
      ));
    }
  });
  if (fields.some(field => !nonEmptyString(source[field]))) return null;
  const expected = {
    objectId: `object:${source.proposalId}`,
    draftId: `draft:${source.proposalId}`,
    reviewDecisionId: `review:${source.proposalId}`,
    threadAssignmentId: `thread-assignment:${source.draftId}`,
  };
  const received = {
    objectId: object.id,
    draftId: source.draftId,
    reviewDecisionId: source.reviewDecisionId,
    threadAssignmentId: source.threadAssignmentId,
  };
  if (!same(expected, received)) {
    errors.push(issue(
      'MULTILAYER_PARTICIPANT_ID_INVALID',
      `${path}.source`,
      'Participant identity contradicts its deterministic proposal-to-draft-to-object lineage.',
      { objectId: object.id, expected, received },
    ));
  }
  if (!own(source, 'sourceRegion')
    || !source.sourceRegion
    || source.sourceRegion.reviewDecisionId !== source.reviewDecisionId) {
    errors.push(issue(
      'MULTILAYER_PARTICIPANT_ID_INVALID',
      `${path}.source.sourceRegion`,
      'The preserved draft source must agree with the final-object review-decision lineage.',
      {
        objectId: object.id,
        expectedReviewDecisionId: source.reviewDecisionId,
        receivedReviewDecisionId: source.sourceRegion?.reviewDecisionId ?? null,
      },
    ));
  }
  return deepFreeze({
    proposalId: source.proposalId,
    draftId: source.draftId,
    objectId: object.id,
    reviewDecisionId: source.reviewDecisionId,
    threadAssignmentId: source.threadAssignmentId,
  });
}

function semanticRoleFor(object, path, errors) {
  const planning = object?.parameters?.planning;
  if (!own(object, 'parameters')
    || !own(object.parameters, 'planning')
    || !own(planning, 'semanticRole')) {
    errors.push(issue(
      'MULTILAYER_SEMANTIC_ROLE_INVALID',
      `${path}.parameters.planning.semanticRole`,
      'C3 requires an own explicit semantic role preserved by object planning.',
      { objectId: object?.id ?? null, received: null },
    ));
    return null;
  }
  const semanticRole = planning.semanticRole;
  if (!nonEmptyString(semanticRole) || !ARTWORK_SEMANTIC_ROLES.includes(semanticRole)) {
    errors.push(issue(
      'MULTILAYER_SEMANTIC_ROLE_INVALID',
      `${path}.parameters.planning.semanticRole`,
      'The preserved semantic role must be a non-empty member of the existing semantic-role catalog.',
      {
        objectId: object?.id ?? null,
        received: semanticRole,
        allowed: [...ARTWORK_SEMANTIC_ROLES],
      },
    ));
    return null;
  }
  const allowed = ROLE_SEMANTIC_AUTHORITY[object.role] || [];
  if (!allowed.includes(semanticRole)) {
    errors.push(issue(
      'MULTILAYER_ROLE_CONTRADICTION',
      `${path}.parameters.planning.semanticRole`,
      'The preserved semantic role contradicts the current embroidery role.',
      {
        objectId: object.id,
        embroideryRole: object.role,
        expectedSemanticRoles: allowed,
        receivedSemanticRole: semanticRole,
      },
    ));
  }
  return semanticRole;
}

function canonicalParticipants(objects, errors) {
  const sourceObjects = Array.isArray(objects) ? objects : [];
  if (!Array.isArray(objects)) {
    errors.push(issue(
      'MULTILAYER_AUTHORITATIVE_INPUTS_MISSING',
      'objects',
      'Current final objects are required for C3 derivation.',
      { receivedType: typeof objects },
    ));
  }
  const seenIds = new Map();
  const seenRegionIds = new Map();
  const records = [];
  sourceObjects.forEach((object, index) => {
    const path = `objects[${index}]`;
    if (!own(object, 'id') || !nonEmptyString(object?.id)) {
      errors.push(issue(
        'MULTILAYER_PARTICIPANT_ID_INVALID',
        `${path}.id`,
        'Every C3 participant must expose an own non-empty object ID.',
        { received: object?.id ?? null },
      ));
      return;
    }
    if (seenIds.has(object.id)) {
      errors.push(issue(
        'MULTILAYER_DUPLICATE_PARTICIPANT_ID',
        `${path}.id`,
        `Participant ID "${object.id}" is duplicated.`,
        { objectId: object.id, firstIndex: seenIds.get(object.id), duplicateIndex: index },
      ));
    } else {
      seenIds.set(object.id, index);
    }
    if (!own(object, 'regionId') || !nonEmptyString(object.regionId)) {
      errors.push(issue(
        'MULTILAYER_REGION_MISSING',
        `${path}.regionId`,
        'Every C3 participant must expose an own non-empty regionId.',
        { objectId: object.id, received: object.regionId ?? null },
      ));
      return;
    }
    if (seenRegionIds.has(object.regionId)) {
      errors.push(issue(
        'MULTILAYER_PARTICIPANT_ID_INVALID',
        `${path}.regionId`,
        `Region "${object.regionId}" is represented by more than one final object.`,
        {
          regionId: object.regionId,
          firstObjectId: seenRegionIds.get(object.regionId),
          duplicateObjectId: object.id,
        },
      ));
    } else {
      seenRegionIds.set(object.regionId, object.id);
    }
    if (!own(object, 'role') || !ALLOWED_EMBROIDERY_ROLES.includes(object.role)) {
      errors.push(issue(
        'MULTILAYER_ROLE_CONTRADICTION',
        `${path}.role`,
        'Participant embroidery role must be an own member of the existing role catalog.',
        { objectId: object.id, received: object.role ?? null, allowed: [...ALLOWED_EMBROIDERY_ROLES] },
      ));
      return;
    }
    const isCore = CORE_ROLES.includes(object.role);
    const isAuxiliary = OUTLINE_ROLES.includes(object.role);
    if (!isCore && !isAuxiliary) return;
    if (!own(object, 'stitchType')
      || !ALLOWED_STITCH_TYPES.includes(object.stitchType)
      || object.stitchType === 'manual') {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_INPUTS_MISSING',
        `${path}.stitchType`,
        'C3 participants must be automatic and stitchable under the existing stitch-type catalog.',
        { objectId: object.id, received: object.stitchType ?? null },
      ));
    }
    if (!own(object, 'geometry')
      || !own(object, 'holes')
      || !validateGeometryOwner(object)) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_INPUTS_MISSING',
        `${path}.geometry`,
        'C3 participants require current valid polygon geometry and explicit valid holes.',
        { objectId: object.id, regionId: object.regionId },
      ));
    }
    if (!own(object, 'dependencyIds') || !Array.isArray(object.dependencyIds)) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_INPUTS_MISSING',
        `${path}.dependencyIds`,
        'C3 requires own direct dependencyIds on every participant.',
        { objectId: object.id, received: object.dependencyIds ?? null },
      ));
    }
    const lineage = lineageFor(object, path, errors);
    const semanticRole = semanticRoleFor(object, path, errors);
    records.push(deepFreeze({
      id: object.id,
      regionId: object.regionId,
      role: object.role,
      stitchType: object.stitchType,
      semanticRole,
      participantType: isCore ? 'core' : 'auxiliary_outline',
      lineage,
      geometryFingerprint: fingerprint(object.geometry),
      holesFingerprint: fingerprint(object.holes),
    }));
  });
  return deepFreeze(records.sort((left, right) => left.id.localeCompare(right.id)));
}

function authoritativeRegions(regions, participants, errors) {
  if (!Array.isArray(regions)) {
    errors.push(issue(
      'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
      'regions',
      'Enabled C3 requires the explicit current RegionV2 array.',
      {
        reason: 'invalid_regions_container',
        receivedType: regions === null ? 'null' : typeof regions,
      },
    ));
    return [];
  }
  const sourceRegions = regions;
  if (sourceRegions.length === 0 && participants.length > 0) {
    errors.push(issue(
      'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
      'regions',
      'Enabled C3 requires a non-empty current RegionV2 array.',
      {
        reason: 'empty_regions_container',
        receivedCount: 0,
      },
    ));
    return sourceRegions;
  }
  const seen = new Map();
  sourceRegions.forEach((region, index) => {
    const path = `regions[${index}]`;
    const regionId = readableRegionId(region);
    if (!plainObject(region)) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
        path,
        'Every current authoritative region must be a plain object.',
        {
          index,
          regionId,
          reason: 'region_not_plain_object',
          receivedType: structuralType(region),
        },
      ));
      return;
    }
    if (!own(region, 'id')) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
        `${path}.id`,
        'Every current authoritative region requires its own ID.',
        {
          index,
          regionId: null,
          reason: 'missing_own_region_id',
          receivedType: 'missing',
        },
      ));
      return;
    }
    if (typeof region.id !== 'string' || region.id.trim().length === 0) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
        `${path}.id`,
        'Every current authoritative region ID must be a non-empty string.',
        {
          index,
          regionId,
          reason: typeof region.id === 'string'
            ? 'empty_region_id'
            : 'invalid_region_id_type',
          receivedType: typeof region.id,
        },
      ));
      return;
    }
    if (!own(region, 'geometry')
      || !own(region, 'holes')
      || !validateGeometryOwner(region)) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
        path,
        'Every current authoritative region requires its own ID, polygon geometry, and holes.',
        {
          index,
          regionId: region.id,
          reason: 'invalid_region_geometry_or_holes',
          receivedType: 'plain_object',
        },
      ));
      return;
    }
    const validation = validateRegionV2(region);
    if (!validation.valid) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
        path,
        'C3 requires every current region to be a valid RegionV2.',
        {
          index,
          regionId: region.id,
          reason: 'invalid_region_v2',
          validationErrorCodes: validation.errors.map(error => error.code),
          validationErrorPaths: validation.errors.map(error => error.path),
        },
      ));
    }
    if (seen.has(region.id)) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
        `regions[${index}].id`,
        `Authoritative region ID "${region.id}" is duplicated.`,
        {
          index,
          regionId: region.id,
          reason: 'duplicate_region_id',
          firstIndex: seen.get(region.id),
        },
      ));
    } else {
      seen.set(region.id, index);
    }
  });
  if (errors.length) return sourceRegions;
  const regionById = new Map(sourceRegions.map(region => [region?.id, region]));
  participants.forEach(participant => {
    const region = regionById.get(participant.regionId);
    if (!region) {
      errors.push(issue(
        'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
        `objects.${participant.id}.regionId`,
        `Current authoritative region "${participant.regionId}" is unavailable.`,
        { objectId: participant.id, regionId: participant.regionId },
      ));
      return;
    }
    if (participant.holesFingerprint !== fingerprint(region.holes)) {
      errors.push(issue(
        'MULTILAYER_COMPONENT_MISMATCH',
        `objects.${participant.id}.regionId`,
        'Current RegionV2 holes disagree with the current final object.',
        {
          objectId: participant.id,
          regionId: participant.regionId,
          objectHolesFingerprint: participant.holesFingerprint,
          regionHolesFingerprint: fingerprint(region.holes),
        },
      ));
    }
  });
  return sourceRegions;
}

function createDisjointSet(ids) {
  const parent = new Map(ids.map(id => [id, id]));
  const find = id => {
    let cursor = id;
    while (parent.has(cursor) && parent.get(cursor) !== cursor) cursor = parent.get(cursor);
    return cursor;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (!leftRoot || !rightRoot || leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort();
    parent.set(second, first);
  };
  return { find, union };
}

function containsComponents(graph, participants, errors) {
  const regionIds = Array.isArray(graph?.regionIds) ? graph.regionIds : [];
  const set = createDisjointSet(regionIds);
  const participantRegionIds = new Set(participants.map(item => item.regionId));
  const containsEdges = (graph?.edges || []).filter(edge =>
    edge?.relation === 'contains'
    && participantRegionIds.has(edge.fromRegionId)
    && participantRegionIds.has(edge.toRegionId));
  containsEdges.forEach(edge => set.union(edge.fromRegionId, edge.toRegionId));
  const grouped = new Map();
  participants.filter(item => item.participantType === 'core').forEach(participant => {
    const root = set.find(participant.regionId);
    const values = grouped.get(root) || [];
    values.push(participant);
    grouped.set(root, values);
  });
  const auxiliary = participants.filter(item => item.participantType === 'auxiliary_outline');
  const ordered = [...grouped.entries()]
    .map(([root, core]) => ({ root, core: core.sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((left, right) => left.core[0].regionId.localeCompare(right.core[0].regionId));
  const components = ordered.map(({ root, core }, index) => {
    const componentRegionIds = regionIds.filter(regionId => set.find(regionId) === root).sort();
    const componentRegionSet = new Set(componentRegionIds);
    return deepFreeze({
      id: `contains-component:${String(index + 1).padStart(4, '0')}`,
      coreObjectIds: core.map(item => item.id),
      coreRegionIds: core.map(item => item.regionId).sort(),
      containsEdges: containsEdges.filter(edge =>
        componentRegionSet.has(edge.fromRegionId)
        && componentRegionSet.has(edge.toRegionId)).map(edge => ({
        fromRegionId: edge.fromRegionId,
        toRegionId: edge.toRegionId,
      })).sort((left, right) =>
        `${left.fromRegionId}:${left.toRegionId}`
          .localeCompare(`${right.fromRegionId}:${right.toRegionId}`)),
      auxiliaryObjectIds: auxiliary.filter(item => set.find(item.regionId) === root)
        .map(item => item.id).sort(),
    });
  });
  const componentByObjectId = new Map(components.flatMap(component =>
    component.coreObjectIds.map(objectId => [objectId, component])));
  return { components: deepFreeze(components), componentByObjectId };
}

function proposalProjection(object, participant) {
  return {
    id: object.id,
    regionId: object.regionId,
    semanticRole: participant.semanticRole,
    proposedEmbroideryRole: object.role,
    proposedStitchType: object.stitchType,
    // Stored dependencies are deliberately excluded: applicability and expected
    // direct edges are rederived from current semantic and geometric authority.
    dependencyIds: [],
  };
}

function canonicalDependencyEdges(objects, participants, regions, graph) {
  const participantById = new Map(participants.map(item => [item.id, item]));
  const projected = objects
    .filter(object => participantById.has(object.id))
    .map(object => proposalProjection(object, participantById.get(object.id)));
  const assessments = participants.map(participant => ({
    regionId: participant.regionId,
    semanticRole: participant.semanticRole,
  }));
  const dependencyResult = buildEmbroideryProposalDependencies(
    projected,
    regions,
    graph,
    {
      assessments,
      byRegionId: Object.fromEntries(assessments.map(assessment => [
        assessment.regionId,
        assessment,
      ])),
      valid: true,
      errors: [],
      warnings: [],
    },
    {
      hatchOverlapProfile: 'legacy',
      hatchOverlapRuleFlags: {
        'CONTOUR-LAST-001': false,
        'COLOR-GROUP-HEURISTIC-001': false,
        [MULTILAYER_DEPENDENCY_RULE_ID]: false,
      },
    },
  );
  const coreIds = new Set(
    participants.filter(item => item.participantType === 'core').map(item => item.id),
  );
  return deepFreeze(dependencyResult.proposals
    .filter(proposal => coreIds.has(proposal.id))
    .flatMap(proposal => proposal.dependencyIds
      .filter(dependencyId => coreIds.has(dependencyId))
      .map(dependencyId => ({
        fromObjectId: dependencyId,
        toObjectId: proposal.id,
      })))
    .sort((left, right) =>
      `${left.fromObjectId}:${left.toObjectId}`
        .localeCompare(`${right.fromObjectId}:${right.toObjectId}`)));
}

function topologicalProjection(objectIds, edges) {
  const ids = uniqueSorted(objectIds);
  const idSet = new Set(ids);
  const dependencies = new Map(ids.map(id => [id, new Set()]));
  edges.filter(edge => idSet.has(edge.fromObjectId) && idSet.has(edge.toObjectId))
    .forEach(edge => dependencies.get(edge.toObjectId).add(edge.fromObjectId));
  const layers = [];
  const emitted = new Set();
  while (emitted.size < ids.length) {
    const ready = ids.filter(id => !emitted.has(id)
      && [...dependencies.get(id)].every(dependencyId => emitted.has(dependencyId)));
    if (!ready.length) {
      return {
        layers: deepFreeze(layers),
        cycleObjectIds: deepFreeze(ids.filter(id => !emitted.has(id))),
      };
    }
    layers.push(ready);
    ready.forEach(id => emitted.add(id));
  }
  return { layers: deepFreeze(layers), cycleObjectIds: deepFreeze([]) };
}

function transitiveClosure(objectIds, edges) {
  const ids = uniqueSorted(objectIds);
  const outgoing = new Map(ids.map(id => [id, []]));
  edges.forEach(edge => {
    if (outgoing.has(edge.fromObjectId) && outgoing.has(edge.toObjectId)) {
      outgoing.get(edge.fromObjectId).push(edge.toObjectId);
    }
  });
  const closure = [];
  ids.forEach(fromObjectId => {
    const queue = outgoing.get(fromObjectId).map(id => ({ id, distance: 1 }));
    const distances = new Map();
    while (queue.length) {
      const current = queue.shift();
      const prior = distances.get(current.id);
      if (prior !== undefined && prior <= current.distance) continue;
      distances.set(current.id, current.distance);
      (outgoing.get(current.id) || []).forEach(id => queue.push({
        id,
        distance: current.distance + 1,
      }));
    }
    [...distances.entries()].sort(([left], [right]) => left.localeCompare(right))
      .forEach(([toObjectId, distance]) => closure.push({
        fromObjectId,
        toObjectId,
        distance,
      }));
  });
  return deepFreeze(closure);
}

function dependencyCycleIds(objectIds, edges) {
  const idSet = new Set(objectIds);
  const dependenciesById = new Map([...idSet].map(id => [id, []]));
  edges.forEach(edge => {
    if (idSet.has(edge.fromObjectId) && idSet.has(edge.toObjectId)) {
      dependenciesById.get(edge.toObjectId).push(edge.fromObjectId);
    }
  });
  const visiting = new Set();
  const visited = new Set();
  const cycles = new Set();
  const visit = (id, stack = []) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      stack.slice(Math.max(0, start)).forEach(cycleId => cycles.add(cycleId));
      cycles.add(id);
      return;
    }
    if (visited.has(id) || !idSet.has(id)) return;
    visiting.add(id);
    dependenciesById.get(id).forEach(dependencyId =>
      visit(dependencyId, [...stack, id]));
    visiting.delete(id);
    visited.add(id);
  };
  [...idSet].forEach(id => visit(id));
  return [...cycles].sort();
}

function receivedDependencyEdges(
  objects,
  claims,
  componentByObjectId,
  errors,
) {
  const objectById = new Map(objects.map(object => [object.id, object]));
  const claimedIds = new Set(claims.flatMap(claim => claim.participantObjectIds));
  const edges = [];
  objects.filter(object => claimedIds.has(object.id)).forEach(object => {
    const dependencyIds = Array.isArray(object.dependencyIds) ? object.dependencyIds : [];
    const claimedDependencyIds = dependencyIds.filter(dependencyId =>
      claimedIds.has(dependencyId));
    const duplicates = claimedDependencyIds.filter((id, index) =>
      claimedDependencyIds.indexOf(id) !== index);
    uniqueSorted(duplicates).forEach(dependencyId => errors.push(issue(
      'MULTILAYER_UNEXPECTED_DEPENDENCY',
      `objects.${object.id}.dependencyIds`,
      `Direct dependency "${dependencyId}" is duplicated.`,
      { objectId: object.id, dependencyId, receivedDependencyIds: [...dependencyIds] },
    )));
    dependencyIds.forEach((dependencyId, dependencyIndex) => {
      const path = `objects.${object.id}.dependencyIds[${dependencyIndex}]`;
      if (!nonEmptyString(dependencyId) || !objectById.has(dependencyId)) {
        errors.push(issue(
          'MULTILAYER_UNKNOWN_DEPENDENCY',
          path,
          'C3 direct dependency references an unknown or invalid current object ID.',
          { objectId: object.id, receivedDependencyId: dependencyId ?? null },
        ));
        return;
      }
      if (dependencyId === object.id) {
        errors.push(issue(
          'MULTILAYER_SELF_DEPENDENCY',
          path,
          'A C3 participant cannot depend on itself.',
          { objectId: object.id, dependencyId },
        ));
        return;
      }
      if (!claimedIds.has(dependencyId)) return;
      const fromComponent = componentByObjectId.get(dependencyId);
      const toComponent = componentByObjectId.get(object.id);
      if (!fromComponent || !toComponent || fromComponent.id !== toComponent.id) {
        errors.push(issue(
          'MULTILAYER_COMPONENT_MISMATCH',
          path,
          'A core dependency crosses structures that are disconnected under contains-only authority.',
          {
            fromObjectId: dependencyId,
            toObjectId: object.id,
            fromComponentId: fromComponent?.id ?? null,
            toComponentId: toComponent?.id ?? null,
          },
        ));
      }
      edges.push({ fromObjectId: dependencyId, toObjectId: object.id });
    });
  });
  const cycles = dependencyCycleIds(claimedIds, edges);
  if (cycles.length) {
    errors.push(issue(
      'MULTILAYER_DEPENDENCY_CYCLE',
      'objects',
      'Current direct dependencies contain a cycle.',
      { cycleObjectIds: cycles },
    ));
  }
  return deepFreeze(edges.sort((left, right) =>
    `${left.fromObjectId}:${left.toObjectId}`
      .localeCompare(`${right.fromObjectId}:${right.toObjectId}`)));
}

function claimsForComponents(components, canonicalEdges) {
  return deepFreeze(components.map(component => {
    const ids = component.coreObjectIds;
    const idSet = new Set(ids);
    const directEdges = canonicalEdges.filter(edge =>
      idSet.has(edge.fromObjectId) && idSet.has(edge.toObjectId));
    const topology = topologicalProjection(ids, directEdges);
    const closure = transitiveClosure(ids, directEdges);
    return {
      component,
      directEdges,
      transitiveClosure: closure,
      canonicalLayers: topology.layers,
      applicable: ids.length >= 3 && closure.some(edge => edge.distance >= 2),
    };
  }).filter(claim => claim.applicable).map(claim => ({
    componentId: claim.component.id,
    participantObjectIds: [...claim.component.coreObjectIds],
    participantRegionIds: [...claim.component.coreRegionIds],
    canonicalDirectEdges: [...claim.directEdges],
    transitiveClosure: [...claim.transitiveClosure],
    canonicalLayers: claim.canonicalLayers.map(layer => [...layer]),
  })));
}

function compareDirectDependencies({
  canonicalEdges,
  receivedEdges,
  claims,
  errors,
}) {
  const claimedIds = new Set(claims.flatMap(claim => claim.participantObjectIds));
  const expected = canonicalEdges.filter(edge =>
    claimedIds.has(edge.fromObjectId) && claimedIds.has(edge.toObjectId));
  const received = receivedEdges.filter(edge =>
    claimedIds.has(edge.fromObjectId) && claimedIds.has(edge.toObjectId));
  const expectedKeys = new Set(expected.map(edge =>
    `${edge.fromObjectId}\u0000${edge.toObjectId}`));
  const receivedKeys = new Set(received.map(edge =>
    `${edge.fromObjectId}\u0000${edge.toObjectId}`));
  const closure = claims.flatMap(claim => claim.transitiveClosure);
  const closureByKey = new Map(closure.map(edge => [
    `${edge.fromObjectId}\u0000${edge.toObjectId}`,
    edge,
  ]));
  expected.filter(edge => !receivedKeys.has(`${edge.fromObjectId}\u0000${edge.toObjectId}`))
    .forEach(edge => {
      const reversedKey = `${edge.toObjectId}\u0000${edge.fromObjectId}`;
      if (receivedKeys.has(reversedKey)) {
        errors.push(issue(
          'MULTILAYER_DEPENDENCY_DIRECTION_MISMATCH',
          `objects.${edge.fromObjectId}.dependencyIds`,
          'A required direct dependency is stored in the opposite direction.',
          { expected: edge, received: { fromObjectId: edge.toObjectId, toObjectId: edge.fromObjectId } },
        ));
      }
      errors.push(issue(
        'MULTILAYER_REQUIRED_DEPENDENCY_MISSING',
        `objects.${edge.toObjectId}.dependencyIds`,
        `Required direct dependency "${edge.fromObjectId}" is missing.`,
        {
          dependentObjectId: edge.toObjectId,
          expectedDependencyId: edge.fromObjectId,
          expectedEdge: edge,
        },
      ));
    });
  received.filter(edge => !expectedKeys.has(`${edge.fromObjectId}\u0000${edge.toObjectId}`))
    .forEach(edge => {
      const closureEdge = closureByKey.get(`${edge.fromObjectId}\u0000${edge.toObjectId}`);
      errors.push(issue(
        'MULTILAYER_UNEXPECTED_DEPENDENCY',
        `objects.${edge.toObjectId}.dependencyIds`,
        closureEdge?.distance > 1
          ? 'A transitive dependency was stored as a direct edge even though it is not nominal.'
          : 'A core direct dependency is not present in the nominal dependency authority.',
        {
          receivedEdge: edge,
          expectedDirectEdges: expected,
          transitiveDistance: closureEdge?.distance ?? null,
        },
      ));
    });
  return { expected, received, claimedIds };
}

function compareExecution({
  executionSteps,
  executionLayers,
  claims,
  expectedEdges,
  claimedIds,
  errors,
}) {
  if (!claims.length) return {
    executionOrder: [],
    sequencePositions: {},
    receivedLayers: [],
    canonicalLayers: [],
  };
  const steps = Array.isArray(executionSteps) ? executionSteps : [];
  const receivedOrder = steps.map(step => step?.objectId).filter(id => claimedIds.has(id));
  const duplicateIds = receivedOrder.filter((id, index) => receivedOrder.indexOf(id) !== index);
  const missingIds = [...claimedIds].filter(id => !receivedOrder.includes(id)).sort();
  if (duplicateIds.length || missingIds.length || receivedOrder.length !== claimedIds.size) {
    errors.push(issue(
      'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      'executionSteps',
      'C3 execution must cover each claimed core participant exactly once.',
      {
        expectedObjectIds: [...claimedIds].sort(),
        receivedObjectIds: receivedOrder,
        duplicateObjectIds: uniqueSorted(duplicateIds),
        missingObjectIds: missingIds,
      },
    ));
  }
  const positions = Object.fromEntries(receivedOrder.map((id, index) => [id, index]));
  expectedEdges.forEach(edge => {
    const prerequisitePosition = positions[edge.fromObjectId];
    const dependentPosition = positions[edge.toObjectId];
    if (!Number.isInteger(prerequisitePosition)
      || !Number.isInteger(dependentPosition)
      || prerequisitePosition >= dependentPosition) {
      errors.push(issue(
        'MULTILAYER_SEQUENCE_DEPENDENCY_VIOLATION',
        'executionSteps',
        'A C3 dependent executes before its required direct prerequisite.',
        {
          edge,
          prerequisitePosition: prerequisitePosition ?? null,
          dependentPosition: dependentPosition ?? null,
          receivedOrder,
        },
      ));
    }
  });
  const canonicalTopology = topologicalProjection([...claimedIds], expectedEdges);
  const sourceLayers = Array.isArray(executionLayers) ? executionLayers : [];
  const rawLayerObjectIds = [];
  sourceLayers.forEach((layer, index) => {
    if (!Array.isArray(layer) || layer.length === 0) {
      errors.push(issue(
        'MULTILAYER_EXECUTION_LAYERS_NOT_CANONICAL',
        `executionLayers[${index}]`,
        'Execution layers must be non-empty arrays.',
        { received: layer ?? null },
      ));
      return;
    }
    const claimedMembers = layer.filter(id => claimedIds.has(id));
    const duplicateMembers = claimedMembers.filter((id, memberIndex) =>
      claimedMembers.indexOf(id) !== memberIndex);
    if (duplicateMembers.length) {
      errors.push(issue(
        'MULTILAYER_EXECUTION_LAYERS_NOT_CANONICAL',
        `executionLayers[${index}]`,
        'A claimed C3 participant appears more than once in an execution layer.',
        { duplicateObjectIds: uniqueSorted(duplicateMembers), received: layer },
      ));
    }
    rawLayerObjectIds.push(...claimedMembers);
  });
  const crossLayerDuplicates = rawLayerObjectIds.filter((id, index) =>
    rawLayerObjectIds.indexOf(id) !== index);
  if (crossLayerDuplicates.length) {
    errors.push(issue(
      'MULTILAYER_EXECUTION_LAYERS_NOT_CANONICAL',
      'executionLayers',
      'A claimed C3 participant appears in more than one execution layer.',
      { duplicateObjectIds: uniqueSorted(crossLayerDuplicates) },
    ));
  }
  const receivedLayers = sourceLayers
    .map(layer => Array.isArray(layer)
      ? uniqueSorted(layer.filter(id => claimedIds.has(id)))
      : [])
    .filter(layer => layer.length);
  if (!same(receivedLayers, canonicalTopology.layers)) {
    errors.push(issue(
      'MULTILAYER_EXECUTION_LAYERS_NOT_CANONICAL',
      'executionLayers',
      'Received C3 execution layers differ from layers rederived from nominal direct dependencies.',
      { expected: canonicalTopology.layers, received: receivedLayers },
    ));
  }
  const receivedRawLayerById = new Map(sourceLayers.flatMap((layer, index) =>
    (Array.isArray(layer) ? layer : [])
      .filter(id => claimedIds.has(id))
      .map(id => [id, index])));
  steps.forEach((step, index) => {
    if (!claimedIds.has(step?.objectId)) return;
    const expectedLayer = receivedRawLayerById.get(step.objectId);
    if (step.executionLayer !== expectedLayer) {
      errors.push(issue(
        'MULTILAYER_EXECUTION_LAYERS_NOT_CANONICAL',
        `executionSteps[${index}].executionLayer`,
        'Execution-step layer differs from the canonical C3 layer.',
        {
          objectId: step.objectId,
          expectedLayer,
          receivedLayer: step.executionLayer ?? null,
        },
      ));
    }
    if (step.sequenceIndex !== index) {
      errors.push(issue(
        'MULTILAYER_INTEGRATION_STATE_MISMATCH',
        `executionSteps[${index}].sequenceIndex`,
        'Execution-step position and sequenceIndex disagree.',
        {
          objectId: step.objectId,
          expectedPosition: index,
          receivedPosition: step.sequenceIndex ?? null,
        },
      ));
    }
  });
  return {
    executionOrder: receivedOrder,
    sequencePositions: positions,
    receivedLayers,
    canonicalLayers: canonicalTopology.layers,
  };
}

export function deriveCanonicalMultilayerDependencyContract({
  regions,
  objects = [],
  executionSteps = [],
  executionLayers = [],
  config = {},
} = {}) {
  const integration = integrationFor(config);
  const errors = [];
  const participants = canonicalParticipants(objects, errors);
  const sourceRegions = authoritativeRegions(regions, participants, errors);
  let graph = null;
  let componentState = { components: [], componentByObjectId: new Map() };
  let canonicalEdges = [];
  if (!errors.length) {
    graph = buildRegionGraphV2(sourceRegions);
    componentState = containsComponents(graph, participants, errors);
  }
  if (!errors.length) {
    canonicalEdges = canonicalDependencyEdges(
      objects,
      participants,
      sourceRegions,
      graph,
    );
  }
  let claims = [];
  let comparison = { expected: [], received: [], claimedIds: new Set() };
  if (!errors.length) {
    claims = claimsForComponents(componentState.components, canonicalEdges);
    const receivedEdges = receivedDependencyEdges(
      Array.isArray(objects) ? objects : [],
      claims,
      componentState.componentByObjectId,
      errors,
    );
    comparison = compareDirectDependencies({
      canonicalEdges,
      receivedEdges,
      claims,
      errors,
    });
  }
  let execution = {
    executionOrder: [],
    sequencePositions: {},
    receivedLayers: [],
    canonicalLayers: [],
  };
  if (!errors.length) {
    execution = compareExecution({
      executionSteps,
      executionLayers,
      claims,
      expectedEdges: comparison.expected,
      claimedIds: comparison.claimedIds,
      errors,
    });
  }
  const auxiliaryParticipants = participants
    .filter(participant => participant.participantType === 'auxiliary_outline')
    .map(participant => ({
      objectId: participant.id,
      regionId: participant.regionId,
      role: participant.role,
      delegatedRuleId: 'CONTOUR-LAST-001',
      dependencyAccreditedByC3: false,
      c1RuleEnabled: integration.ruleFlags['CONTOUR-LAST-001'] === true,
    }));
  const status = errors.length ? 'blocked' : claims.length ? 'validated' : 'not_applicable';
  const body = deepFreeze({
    version: MULTILAYER_DEPENDENCY_CONTRACT_VERSION,
    phase: 'C_Solapes',
    ruleId: MULTILAYER_DEPENDENCY_RULE_ID,
    integration,
    ...CLAIM_BOUNDARY,
    status,
    participantSignatures: participants,
    containsComponents: componentState.components,
    canonicalDirectEdges: comparison.expected,
    receivedDirectEdges: comparison.received,
    transitiveClosure: claims.flatMap(claim => claim.transitiveClosure),
    canonicalExecutionLayers: execution.canonicalLayers,
    receivedExecutionLayers: execution.receivedLayers,
    executionOrder: execution.executionOrder,
    sequencePositions: execution.sequencePositions,
    claims,
    auxiliaryParticipants,
  });
  return {
    integration,
    status,
    applicable: claims.length > 0,
    contract: errors.length
      ? null
      : deepFreeze({ ...body, fingerprint: fingerprint(body) }),
    candidate: body,
    errors: deepFreeze(uniqueIssues(errors)),
    warnings: deepFreeze([]),
  };
}

function artifactState(result, version) {
  const errors = uniqueIssues(result.errors || []);
  return deepFreeze({
    version,
    phase: 'C_Solapes',
    ruleId: MULTILAYER_DEPENDENCY_RULE_ID,
    profile: result.integration.profile,
    enabledRuleIds: [...result.integration.enabledRuleIds],
    active: result.integration.ruleEnabled,
    evaluatorInvoked: true,
    applied: result.status === 'validated' && errors.length === 0,
    status: errors.length ? 'blocked' : result.status,
    applicable: result.status === 'validated' && errors.length === 0,
    contractVersion: result.contract?.version ?? null,
    contractFingerprint: result.contract?.fingerprint ?? null,
    claimCount: result.contract?.claims?.length ?? 0,
    errorCount: errors.length,
    errorCodes: uniqueSorted(errors.map(error => error.code)),
    ...CLAIM_BOUNDARY,
  });
}

export function createMultilayerDependencyIntegrationMarker(result = {}) {
  return artifactState(result, MULTILAYER_DEPENDENCY_MARKER_VERSION);
}

export function evaluateMultilayerDependencyGuard(input = {}) {
  const derived = deriveCanonicalMultilayerDependencyContract(input);
  const blockingErrors = Array.isArray(input.blockingErrors) ? input.blockingErrors : [];
  const errors = uniqueIssues([...derived.errors, ...blockingErrors]);
  const result = {
    ...derived,
    status: errors.length ? 'blocked' : derived.status,
    contract: errors.length ? null : derived.contract,
    errors: deepFreeze(errors),
  };
  return {
    ...result,
    marker: createMultilayerDependencyIntegrationMarker(result),
    evaluation: artifactState(result, MULTILAYER_DEPENDENCY_EVALUATION_VERSION),
    trace: artifactState(result, MULTILAYER_DEPENDENCY_TRACE_VERSION),
  };
}

export function validateMultilayerDependencyPlanState({
  plan,
  regions,
  objects = [],
  config = plan?.config || {},
} = {}) {
  const integration = integrationFor(config);
  const errors = [];
  const fields = [
    'multilayerDependencyContract',
    'multilayerDependencyIntegrationMarker',
    'multilayerDependencyEvaluation',
    'multilayerDependencyTrace',
  ];
  const hasMetadata = own(
    plan?.metadata,
    'multilayerDependencyEvaluatorInvoked',
  );
  const hasAnyState = fields.some(field => own(plan, field)) || hasMetadata;
  if (!integration.ruleEnabled) {
    if (hasAnyState) {
      errors.push(issue(
        'MULTILAYER_INTEGRATION_STATE_MISMATCH',
        'multilayerDependency',
        'C3 state is forbidden while MULTILAYER-DEPENDENCY-001 is OFF.',
      ));
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  }
  fields.forEach(field => {
    const absent = !own(plan, field);
    const nullRequiredArtifact = field === 'multilayerDependencyContract'
      ? plan?.valid === true && !plan?.[field]
      : !plan?.[field];
    if (absent || nullRequiredArtifact) {
      errors.push(issue(
        field === 'multilayerDependencyContract'
          ? 'MULTILAYER_CONTRACT_MISSING'
          : field === 'multilayerDependencyTrace'
            ? 'MULTILAYER_TRACE_MISSING'
            : 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
        field,
        `Enabled C3 requires the explicit ${field} artifact.`,
      ));
    }
  });
  if (plan?.metadata?.multilayerDependencyEvaluatorInvoked !== true) {
    errors.push(issue(
      'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      'metadata.multilayerDependencyEvaluatorInvoked',
      'Enabled C3 requires explicit evaluator-invocation metadata.',
    ));
  }
  const canonical = evaluateMultilayerDependencyGuard({
    regions,
    objects,
    executionSteps: plan?.executionSteps || [],
    executionLayers: plan?.executionLayers || [],
    config,
    blockingErrors: plan?.valid === true ? [] : (plan?.errors || []),
  });
  errors.push(...canonical.errors);
  if (own(plan, 'multilayerDependencyContract')
    && !same(plan.multilayerDependencyContract, canonical.contract)) {
    errors.push(issue(
      'MULTILAYER_CONTRACT_STALE',
      'multilayerDependencyContract',
      'Stored C3 contract differs from the full contract rederived from current authority.',
      {
        expectedFingerprint: canonical.contract?.fingerprint ?? null,
        receivedFingerprint: plan?.multilayerDependencyContract?.fingerprint ?? null,
      },
    ));
  }
  if (own(plan, 'multilayerDependencyIntegrationMarker')
    && !same(plan.multilayerDependencyIntegrationMarker, canonical.marker)) {
    errors.push(issue(
      'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      'multilayerDependencyIntegrationMarker',
      'Stored C3 marker disagrees with current configuration and derivation.',
    ));
  }
  if (own(plan, 'multilayerDependencyEvaluation')
    && !same(plan.multilayerDependencyEvaluation, canonical.evaluation)) {
    errors.push(issue(
      'MULTILAYER_EVALUATION_STALE',
      'multilayerDependencyEvaluation',
      'Stored C3 evaluation differs from current canonical evaluation.',
    ));
  }
  if (own(plan, 'multilayerDependencyTrace')
    && !same(plan.multilayerDependencyTrace, canonical.trace)) {
    errors.push(issue(
      'MULTILAYER_TRACE_STALE',
      'multilayerDependencyTrace',
      'Stored C3 trace differs from current canonical evaluation.',
    ));
  }
  if (plan?.valid === true && canonical.status === 'blocked') {
    errors.push(issue(
      'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      'valid',
      'A plan cannot remain valid when current C3 derivation is blocked.',
    ));
  }
  const deduplicated = uniqueIssues(errors);
  return {
    valid: deduplicated.length === 0,
    errors: deduplicated,
    warnings: [],
    canonical,
  };
}

export const MULTILAYER_DEPENDENCY_CORE_ROLES = CORE_ROLES;
export const MULTILAYER_DEPENDENCY_CLAIM_BOUNDARY = CLAIM_BOUNDARY;
