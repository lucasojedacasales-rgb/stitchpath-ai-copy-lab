import { resolveHatchOverlapIntegrationConfig } from '../rules/hatchEvidence/overlapProfiles.js';
import { ARTWORK_SEMANTIC_ROLES } from '../semantics/semanticRoleModel.js';
import { getConnectedComponent, getRegionAncestors } from '../topology/regionGraph.js';
import { cloneProposalWithDependencies } from './embroideryPlanningModel.js';

const FILL_ROLES = new Set(['base_fill', 'foreground_fill']);
const DETAIL_ROLES = new Set(['internal_detail', 'dark_detail', 'highlight']);
const OUTLINE_ROLES = new Set(['inner_outline', 'outer_outline']);
const CONTOUR_RELATED_ROLES = new Set([...FILL_ROLES, ...DETAIL_ROLES]);
export const CONTOUR_DEPENDENCY_RULE_ID = 'CONTOUR-LAST-001';
export const CONTOUR_DEPENDENCY_CONTRACT_VERSION = 'engine-v2-contour-dependency-contract-r3';
export const CONTOUR_INTEGRATION_MARKER_VERSION = 'engine-v2-contour-integration-marker-r3';
export const CONTOUR_DEPENDENCY_ASSOCIATION_METHOD = 'region_graph_connected_component';
export const CONTOUR_DEPENDENCY_ASSOCIATION_LIMIT = 'Connected-component association is conservative and is not an exact geometric contour-to-fill relationship.';

const isAutomatic = proposal => proposal
  && !proposal.excluded
  && proposal.proposedEmbroideryRole !== 'manual_review'
  && proposal.proposedStitchType !== 'none';

const issue = (code, path, message, details = {}) => ({ code, path, message, ...details });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sortedUnique = values => [...new Set(values)].sort();
const uniqueIssues = errors => [...new Map(errors.map(error => [JSON.stringify(error), error])).values()];
const plainObject = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableProjectionValue(value) {
  if (Array.isArray(value)) return value.map(stableProjectionValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, stableProjectionValue(value[key])]));
  }
  if (Number.isNaN(value)) return null;
  return value ?? null;
}

function semanticProjection(regionId, assessment) {
  return {
    regionId,
    present: plainObject(assessment),
    semanticRole: typeof assessment?.semanticRole === 'string'
      ? assessment.semanticRole
      : null,
    confidence: Number.isFinite(assessment?.confidence) ? assessment.confidence : null,
    needsReview: assessment?.needsReview === true,
    sourceRole: assessment?.sourceRole ?? null,
    sourceRoleTrusted: assessment?.sourceRoleTrusted === true,
    semanticTags: sortedUnique(Array.isArray(assessment?.semanticTags)
      ? assessment.semanticTags.filter(value => typeof value === 'string')
      : []),
    outlineIntent: stableProjectionValue(assessment?.outlineIntent),
    contourIntent: stableProjectionValue(assessment?.contourIntent),
    outlineEligibility: stableProjectionValue(assessment?.outlineEligibility),
    colorFeatures: stableProjectionValue(assessment?.colorFeatures || {}),
    geometryFeatures: stableProjectionValue(assessment?.geometryFeatures || {}),
    topologyFeatures: stableProjectionValue(assessment?.topologyFeatures || {}),
  };
}

function validateSemanticEntry(assessment, path, byRegionKey = null) {
  const errors = [];
  const entryCode = byRegionKey === null
    ? 'INVALID_SEMANTIC_RESULT_ASSESSMENT'
    : 'INVALID_SEMANTIC_RESULT_BY_REGION_ENTRY';
  if (!plainObject(assessment)) {
    errors.push(issue(
      entryCode,
      path,
      byRegionKey === null
        ? 'Semantic assessment must be a plain object.'
        : 'Semantic byRegionId entry must be a plain object.',
    ));
    return { valid: false, errors, regionId: null, assessment: null };
  }

  const ownsRegionId = Object.hasOwn(assessment, 'regionId');
  const regionId = ownsRegionId ? assessment.regionId : null;
  if (!ownsRegionId
    || typeof regionId !== 'string'
    || regionId.trim().length === 0) {
    errors.push(issue(
      'INVALID_SEMANTIC_RESULT_REGION_ID',
      `${path}.regionId`,
      'Semantic entry requires its own non-empty string regionId.',
      { reason: !ownsRegionId ? 'missing_own_property' : 'invalid_type_or_empty' },
    ));
  }
  if (byRegionKey !== null
    && (typeof byRegionKey !== 'string' || byRegionKey.trim().length === 0)) {
    errors.push(issue(
      'INVALID_SEMANTIC_RESULT_REGION_ID',
      path,
      'Semantic byRegionId key must be a non-empty string.',
      { reason: 'invalid_map_key' },
    ));
  } else if (byRegionKey !== null
    && typeof regionId === 'string'
    && regionId.trim().length > 0
    && regionId !== byRegionKey) {
    errors.push(issue(
      'INVALID_SEMANTIC_RESULT_REGION_ID',
      `${path}.regionId`,
      'Semantic entry regionId must exactly match its byRegionId key.',
      { reason: 'map_key_mismatch', expectedRegionId: byRegionKey, actualRegionId: regionId },
    ));
  }

  const ownsSemanticRole = Object.hasOwn(assessment, 'semanticRole');
  const semanticRole = ownsSemanticRole ? assessment.semanticRole : null;
  if (!ownsSemanticRole
    || typeof semanticRole !== 'string'
    || semanticRole.trim().length === 0) {
    errors.push(issue(
      'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
      `${path}.semanticRole`,
      'Semantic entry requires its own non-empty string semanticRole.',
      { reason: !ownsSemanticRole ? 'missing_own_property' : 'invalid_type_or_empty' },
    ));
  } else if (!ARTWORK_SEMANTIC_ROLES.includes(semanticRole)) {
    errors.push(issue(
      'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
      `${path}.semanticRole`,
      `Semantic role "${semanticRole}" is outside the admitted engine domain.`,
      { reason: 'unsupported_semantic_role', semanticRole },
    ));
  }

  return {
    valid: errors.length === 0,
    errors,
    regionId: errors.some(error => error.code === 'INVALID_SEMANTIC_RESULT_REGION_ID')
      ? null
      : regionId,
    assessment: errors.length === 0 ? assessment : null,
  };
}

export function normalizeCanonicalSemanticResult(
  semanticResult,
  { strict = false, expectedRegionIds = [] } = {},
) {
  const source = plainObject(semanticResult) ? semanticResult : {};
  const byRegionIdPresent = Object.hasOwn(source, 'byRegionId');
  const assessmentsPresent = Object.hasOwn(source, 'assessments');
  const byRegionIdContainerValid = plainObject(source.byRegionId);
  const assessmentsContainerValid = Array.isArray(source.assessments);
  const errors = [];
  if (strict && byRegionIdPresent && !byRegionIdContainerValid) errors.push(issue(
    'INVALID_SEMANTIC_RESULT_REPRESENTATION',
    'semanticResult.byRegionId',
    'Semantic byRegionId representation must be a plain object.',
  ));
  if (strict && assessmentsPresent && !assessmentsContainerValid) errors.push(issue(
    'INVALID_SEMANTIC_RESULT_REPRESENTATION',
    'semanticResult.assessments',
    'Semantic assessments representation must be an array.',
  ));

  const rawByEntries = byRegionIdContainerValid
    ? Object.entries(source.byRegionId).sort(([left], [right]) => left.localeCompare(right))
    : [];
  const byEntries = [];
  let byEntryInvalid = false;
  rawByEntries.forEach(([regionKey, assessment]) => {
    if (!strict) {
      byEntries.push([regionKey, assessment]);
      return;
    }
    const validation = validateSemanticEntry(
      assessment,
      `semanticResult.byRegionId.${regionKey}`,
      regionKey,
    );
    errors.push(...validation.errors);
    if (!validation.valid) {
      byEntryInvalid = true;
      return;
    }
    byEntries.push([validation.regionId, validation.assessment]);
  });

  const assessmentEntries = [];
  const assessmentIdCounts = new Map();
  let assessmentEntryInvalid = false;
  if (assessmentsContainerValid) source.assessments.forEach((assessment, index) => {
    if (!strict) {
      const regionId = typeof assessment?.regionId === 'string' && assessment.regionId
        ? assessment.regionId
        : null;
      if (regionId && !assessmentEntries.some(([existingId]) => existingId === regionId)) {
        assessmentEntries.push([regionId, assessment]);
      }
      return;
    }
    const validation = validateSemanticEntry(
      assessment,
      `semanticResult.assessments[${index}]`,
    );
    errors.push(...validation.errors);
    if (!validation.valid) {
      assessmentEntryInvalid = true;
      const duplicateCandidate = validation.regionId;
      if (duplicateCandidate) {
        assessmentIdCounts.set(
          duplicateCandidate,
          (assessmentIdCounts.get(duplicateCandidate) || 0) + 1,
        );
      }
      return;
    }
    const regionId = validation.regionId;
    assessmentIdCounts.set(regionId, (assessmentIdCounts.get(regionId) || 0) + 1);
    if (!assessmentEntries.some(([existingId]) => existingId === regionId)) {
      assessmentEntries.push([regionId, validation.assessment]);
    }
  });
  const duplicateAssessmentIds = [...assessmentIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort(([left], [right]) => left.localeCompare(right));
  if (strict) duplicateAssessmentIds.forEach(([regionId, count]) => errors.push(issue(
      'DUPLICATE_SEMANTIC_ASSESSMENT_REGION_ID',
      'semanticResult.assessments',
      `Semantic assessments contain ${count} records for region "${regionId}".`,
      { regionId, count },
    )));
  if (duplicateAssessmentIds.length) assessmentEntryInvalid = true;

  const byRegionIdValid = byRegionIdContainerValid && !byEntryInvalid;
  const assessmentsValid = assessmentsContainerValid && !assessmentEntryInvalid;
  if (strict && !byRegionIdValid && !assessmentsValid) errors.push(issue(
    'CONTOUR_LAST_AUTHORITATIVE_INPUTS_MISSING',
    'semanticResult',
    'At least one fully valid current semantic representation is required for enabled CONTOUR-LAST.',
  ));

  const byProjection = byEntries.map(([regionId, assessment]) =>
    semanticProjection(regionId, assessment));
  const assessmentProjection = assessmentEntries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([regionId, assessment]) => semanticProjection(regionId, assessment));
  const byIds = byProjection.map(item => item.regionId);
  const assessmentIds = assessmentProjection.map(item => item.regionId);
  const expectedIds = sortedUnique(expectedRegionIds.filter(value => typeof value === 'string'));
  if (strict && byRegionIdPresent && !same(byIds, expectedIds)) errors.push(issue(
    'INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS',
    'semanticResult.byRegionId',
    'Semantic byRegionId region identities do not match current planning regions.',
    { evidence: { expectedRegionIds: expectedIds, actualRegionIds: byIds } },
  ));
  if (strict && assessmentsPresent && !same(assessmentIds, expectedIds)) errors.push(issue(
    'INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS',
    'semanticResult.assessments',
    'Semantic assessment region identities do not match current planning regions.',
    { evidence: { expectedRegionIds: expectedIds, actualRegionIds: assessmentIds } },
  ));
  if (strict && byRegionIdPresent && assessmentsPresent
    && byRegionIdContainerValid && assessmentsContainerValid
    && (!same(byIds, assessmentIds) || !same(byProjection, assessmentProjection))) {
    errors.push(issue(
      'INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS',
      'semanticResult',
      'Semantic byRegionId and assessments representations must have identical relevant projections.',
      { evidence: { byRegionIdRegionIds: byIds, assessmentRegionIds: assessmentIds } },
    ));
  }

  const byAssessmentMap = new Map(byEntries);
  const assessmentMap = new Map(assessmentEntries);
  const canonicalIds = sortedUnique([
    ...byAssessmentMap.keys(),
    ...assessmentMap.keys(),
    ...expectedIds,
  ]);
  const canonicalByRegionId = Object.fromEntries(canonicalIds.map(regionId => [
    regionId,
    byAssessmentMap.get(regionId) ?? assessmentMap.get(regionId),
  ]).filter(([, assessment]) => plainObject(assessment)));
  const canonicalProjection = canonicalIds.map(regionId => semanticProjection(
    regionId,
    canonicalByRegionId[regionId],
  ));
  return {
    valid: errors.length === 0,
    errors: uniqueIssues(errors),
    byRegionId: canonicalByRegionId,
    projection: canonicalProjection,
    projectionByRegionId: Object.fromEntries(
      canonicalProjection.map(projected => [projected.regionId, projected]),
    ),
    signature: {
      byRegionId: {
        present: byRegionIdPresent,
        valid: byRegionIdValid,
        regionIds: byIds,
        projection: byProjection,
      },
      assessments: {
        present: assessmentsPresent,
        valid: assessmentsValid,
        regionIds: assessmentIds,
        projection: assessmentProjection,
      },
      canonicalProjection,
    },
  };
}

function normalizedIntegration(config, integration) {
  const resolved = integration || resolveHatchOverlapIntegrationConfig(config);
  const enabledRuleIds = sortedUnique(Array.isArray(resolved?.enabledRuleIds)
    ? resolved.enabledRuleIds
    : []);
  return {
    profile: resolved?.profile ?? 'legacy',
    enabledRuleIds,
    contourLastEnabled: enabledRuleIds.includes(CONTOUR_DEPENDENCY_RULE_ID)
      || resolved?.ruleFlags?.[CONTOUR_DEPENDENCY_RULE_ID] === true,
  };
}

function normalizedOutlineEligibility(proposal) {
  const source = proposal?.outlineEligibility;
  if (!source) return null;
  return {
    eligible: source.eligible === true,
    explicitOutlineEvidence: source.explicitOutlineEvidence === true,
    regionBackedGeometry: source.regionBackedGeometry === true,
  };
}

function normalizedAssociationEvidence(proposal) {
  if (!Object.hasOwn(proposal?.source || {}, 'contourDependencyAssociation')) return null;
  const evidence = proposal.source.contourDependencyAssociation;
  return {
    method: typeof evidence?.method === 'string' ? evidence.method : null,
    evidenceId: typeof evidence?.evidenceId === 'string' ? evidence.evidenceId : null,
    requiredProposalIds: Array.isArray(evidence?.requiredProposalIds)
      ? sortedUnique(evidence.requiredProposalIds.filter(value => typeof value === 'string'))
      : null,
  };
}

function regionSignature(regionId, regionById) {
  const region = regionById.get(regionId);
  return {
    regionId,
    present: Boolean(region),
    sourceRole: region?.role ?? region?.sourceRole ?? region?.source?.role ?? null,
    regionClass: region?.regionClass ?? region?.source?.regionClass ?? null,
    explicitOutline: region?.explicitOutline === true
      || region?.source?.explicitOutline === true,
  };
}

function semanticSignature(regionId, semanticByRegionId) {
  return semanticByRegionId.get(regionId) || semanticProjection(regionId, null);
}

function graphComponentSignature(regionId, graph) {
  return {
    regionId,
    componentId: graph?.nodes?.[regionId]?.disconnectedComponentId ?? null,
    componentRegionIds: getConnectedComponent(graph, regionId),
  };
}

function proposalSignature(proposal, regionById, semanticByRegionId, graph) {
  return {
    proposalId: proposal.id,
    regionId: proposal.regionId,
    semanticRole: proposal.semanticRole,
    role: proposal.proposedEmbroideryRole,
    stitchType: proposal.proposedStitchType,
    dependencyIds: sortedUnique(Array.isArray(proposal.dependencyIds) ? proposal.dependencyIds : []),
    outlineEligibility: normalizedOutlineEligibility(proposal),
    associationEvidence: normalizedAssociationEvidence(proposal),
    region: regionSignature(proposal.regionId, regionById),
    semanticAssessment: semanticSignature(proposal.regionId, semanticByRegionId),
    graphComponent: graphComponentSignature(proposal.regionId, graph),
  };
}

function eligibleExplicitContour(proposal, graph) {
  return isAutomatic(proposal)
    && OUTLINE_ROLES.has(proposal.proposedEmbroideryRole)
    && proposal.outlineEligibility?.eligible === true
    && proposal.outlineEligibility?.explicitOutlineEvidence === true
    && proposal.outlineEligibility?.regionBackedGeometry === true
    && Boolean(graph?.nodes?.[proposal.regionId]);
}

function contourAssociationFor(proposal, proposals, graph) {
  const componentRegionIds = getConnectedComponent(graph, proposal.regionId);
  const component = new Set(componentRegionIds);
  const related = proposals.filter(candidate => isAutomatic(candidate)
    && candidate.id !== proposal.id
    && component.has(candidate.regionId)
    && CONTOUR_RELATED_ROLES.has(candidate.proposedEmbroideryRole));
  const relatedIds = related.map(candidate => candidate.id).sort();
  const evidence = normalizedAssociationEvidence(proposal);
  const evidenceIds = evidence?.requiredProposalIds;
  const invalidReferenceIds = Array.isArray(evidenceIds)
    ? evidenceIds.filter(proposalId => !relatedIds.includes(proposalId))
    : [];
  const evidenceValid = evidence !== null
    && evidence.method === 'explicit_proposal_ids'
    && Array.isArray(evidenceIds)
    && evidenceIds.length > 0
    && invalidReferenceIds.length === 0;
  const requiredProposalIds = evidenceValid ? evidenceIds : relatedIds;
  return {
    contourProposalId: proposal.id,
    contourRegionId: proposal.regionId,
    componentId: graph?.nodes?.[proposal.regionId]?.disconnectedComponentId ?? null,
    componentRegionIds,
    associationMethod: evidenceValid ? 'explicit_proposal_ids' : CONTOUR_DEPENDENCY_ASSOCIATION_METHOD,
    associationDisambiguated: evidenceValid,
    exactGeometricAssociation: false,
    associationEvidence: evidence,
    associationEvidenceValid: evidence === null || evidenceValid,
    invalidAssociationReferenceIds: invalidReferenceIds,
    requiredProposalIds,
  };
}

function nearestStitchableFill(proposal, byRegionId, graph) {
  return getRegionAncestors(graph, proposal.regionId)
    .map(regionId => byRegionId.get(regionId))
    .find(candidate => isAutomatic(candidate) && FILL_ROLES.has(candidate.proposedEmbroideryRole));
}

export function deriveProposalExecutionLayers(proposals) {
  const active = proposals.filter(isAutomatic);
  const ids = new Set(active.map(item => item.id));
  const dependencies = new Map(active.map(item => [
    item.id,
    new Set((Array.isArray(item.dependencyIds) ? item.dependencyIds : []).filter(id => ids.has(id))),
  ]));
  const layers = [];
  const emitted = new Set();
  while (emitted.size < active.length) {
    const ready = active
      .filter(item => !emitted.has(item.id)
        && [...dependencies.get(item.id)].every(id => emitted.has(id)))
      .map(item => item.id)
      .sort();
    if (!ready.length) return { layers, cycleCount: active.length - emitted.size };
    layers.push(ready);
    ready.forEach(id => emitted.add(id));
  }
  return { layers, cycleCount: 0 };
}

export function deriveCanonicalContourDependencyContract({
  proposals = [],
  regions,
  graph,
  semanticResult,
  semanticNormalization,
  config = {},
  integration,
} = {}) {
  const resolvedIntegration = normalizedIntegration(config, integration);
  const errors = [];
  const expectedRegionIds = (Array.isArray(regions) ? regions : [])
    .map(region => region?.id)
    .filter(regionId => typeof regionId === 'string');
  const normalizedSemantics = semanticNormalization || normalizeCanonicalSemanticResult(
    semanticResult,
    {
      strict: resolvedIntegration.contourLastEnabled,
      expectedRegionIds,
    },
  );
  if (resolvedIntegration.contourLastEnabled) {
    if (!Array.isArray(regions)) errors.push(issue(
      'CONTOUR_LAST_AUTHORITATIVE_INPUTS_MISSING',
      'regions',
      'Current regions are required to rederive the enabled CONTOUR-LAST contract.',
    ));
    if (!graph || typeof graph !== 'object' || !graph.nodes) errors.push(issue(
      'CONTOUR_LAST_AUTHORITATIVE_INPUTS_MISSING',
      'graph',
      'The current region graph is required to rederive the enabled CONTOUR-LAST contract.',
    ));
    errors.push(...normalizedSemantics.errors);
  }

  const sorted = [...(Array.isArray(proposals) ? proposals : [])]
    .sort((left, right) => String(left?.id).localeCompare(String(right?.id)));
  const regionById = new Map((Array.isArray(regions) ? regions : []).map(region => [region.id, region]));
  const semanticByRegionId = new Map(
    Object.entries(normalizedSemantics.projectionByRegionId),
  );
  const associations = sorted.filter(proposal =>
    isAutomatic(proposal) && OUTLINE_ROLES.has(proposal.proposedEmbroideryRole))
    .map(proposal => contourAssociationFor(proposal, sorted, graph));

  if (resolvedIntegration.contourLastEnabled) {
    sorted.filter(isAutomatic).forEach(proposal => {
      if (!regionById.has(proposal.regionId)) errors.push(issue(
        'CONTOUR_LAST_AUTHORITATIVE_REGION_MISSING',
        `proposals.${proposal.id}.regionId`,
        `Current region "${proposal.regionId}" is unavailable for canonical contract derivation.`,
        { proposalId: proposal.id, regionId: proposal.regionId },
      ));
      if (!semanticByRegionId.has(proposal.regionId)) errors.push(issue(
        'CONTOUR_LAST_AUTHORITATIVE_ROLE_MISSING',
        `semanticResult.${proposal.regionId}`,
        `Current semantic role for region "${proposal.regionId}" is unavailable.`,
        { proposalId: proposal.id, regionId: proposal.regionId },
      ));
    });
    associations.filter(association => !association.associationEvidenceValid)
      .forEach(association => errors.push(issue(
        'CONTOUR_LAST_EXPLICIT_ASSOCIATION_INVALID',
        `proposals.${association.contourProposalId}.source.contourDependencyAssociation`,
        'Explicit contour association must reference existing stitchable participants in the same component.',
        {
          proposalId: association.contourProposalId,
          evidence: {
            associationEvidence: association.associationEvidence,
            invalidReferenceIds: association.invalidAssociationReferenceIds,
          },
        },
      )));
  }

  const requiredByContourId = new Map(associations.map(association => [
    association.contourProposalId,
    association.requiredProposalIds,
  ]));
  const canonicalProposals = sorted.map(proposal => {
    if (!isAutomatic(proposal)) return cloneProposalWithDependencies(proposal, []);
    const requiredIds = requiredByContourId.get(proposal.id) || [];
    return cloneProposalWithDependencies(proposal, sortedUnique([
      ...(Array.isArray(proposal.dependencyIds) ? proposal.dependencyIds : []),
      ...requiredIds,
    ]));
  });
  const canonicalById = new Map(canonicalProposals.map(proposal => [proposal.id, proposal]));

  if (!resolvedIntegration.contourLastEnabled) {
    return {
      valid: true,
      errors: [],
      proposals: canonicalProposals,
      requiredEdges: associations.flatMap(association => association.requiredProposalIds.map(dependencyId => ({
        contourProposalId: association.contourProposalId,
        dependencyId,
      }))),
      contract: null,
      integration: resolvedIntegration,
    };
  }
  if (!normalizedSemantics.valid) {
    return {
      valid: false,
      errors: uniqueIssues(errors),
      proposals: canonicalProposals,
      requiredEdges: associations.flatMap(association =>
        association.requiredProposalIds.map(dependencyId => ({
          contourProposalId: association.contourProposalId,
          dependencyId,
        }))),
      contract: null,
      integration: resolvedIntegration,
    };
  }

  const claims = associations
    .filter(association => eligibleExplicitContour(canonicalById.get(association.contourProposalId), graph))
    .map(association => {
      const contour = canonicalById.get(association.contourProposalId);
      const participants = [contour, ...association.requiredProposalIds.map(id => canonicalById.get(id))]
        .filter(Boolean)
        .map(proposal => proposalSignature(proposal, regionById, semanticByRegionId, graph))
        .sort((left, right) => left.proposalId.localeCompare(right.proposalId));
      return {
        contourProposalId: association.contourProposalId,
        contourRegionId: association.contourRegionId,
        componentId: association.componentId,
        componentRegionIds: association.componentRegionIds,
        associationMethod: association.associationMethod,
        associationDisambiguated: association.associationDisambiguated,
        exactGeometricAssociation: false,
        associationEvidence: association.associationEvidence,
        associationEvidenceValid: association.associationEvidenceValid,
        requiredDependencyIds: association.requiredProposalIds,
        participants,
      };
    })
    .sort((left, right) => left.contourProposalId.localeCompare(right.contourProposalId));
  const activeProposals = canonicalProposals.filter(isAutomatic);
  const contractBody = {
    version: CONTOUR_DEPENDENCY_CONTRACT_VERSION,
    integration: {
      profile: resolvedIntegration.profile,
      ruleId: CONTOUR_DEPENDENCY_RULE_ID,
      enabled: true,
      enabledRuleIds: resolvedIntegration.enabledRuleIds,
    },
    associationMethod: CONTOUR_DEPENDENCY_ASSOCIATION_METHOD,
    exactGeometricAssociation: false,
    associationLimit: CONTOUR_DEPENDENCY_ASSOCIATION_LIMIT,
    semanticAuthority: normalizedSemantics.signature,
    activeProposalIds: activeProposals.map(item => item.id).sort(),
    proposalSignatures: activeProposals
      .map(proposal => proposalSignature(proposal, regionById, semanticByRegionId, graph))
      .sort((left, right) => left.proposalId.localeCompare(right.proposalId)),
    requiredEdges: claims.flatMap(claim => claim.requiredDependencyIds.map(dependencyId => ({
      contourProposalId: claim.contourProposalId,
      dependencyId,
      associationMethod: claim.associationMethod,
      associationEvidenceId: claim.associationEvidence?.evidenceId ?? null,
    }))).sort((left, right) =>
      `${left.contourProposalId}:${left.dependencyId}`.localeCompare(`${right.contourProposalId}:${right.dependencyId}`)),
    explicitAssociations: claims.filter(claim => claim.associationEvidence !== null).map(claim => ({
      contourProposalId: claim.contourProposalId,
      associationEvidence: claim.associationEvidence,
      associationDisambiguated: claim.associationDisambiguated,
    })),
    claims,
  };
  const contract = deepFreeze({
    ...contractBody,
    fingerprint: fingerprint(contractBody),
  });
  return {
    valid: errors.length === 0,
    errors: uniqueIssues(errors),
    proposals: canonicalProposals,
    requiredEdges: contract.requiredEdges.map(edge => ({
      contourProposalId: edge.contourProposalId,
      dependencyId: edge.dependencyId,
    })),
    contract,
    integration: resolvedIntegration,
  };
}

export function createContourIntegrationMarker({ integration, contract } = {}) {
  const resolved = normalizedIntegration({}, integration);
  return deepFreeze({
    version: CONTOUR_INTEGRATION_MARKER_VERSION,
    ruleId: CONTOUR_DEPENDENCY_RULE_ID,
    active: resolved.contourLastEnabled,
    profile: resolved.profile,
    enabledRuleIds: resolved.enabledRuleIds,
    contractVersion: contract?.version ?? null,
    contractFingerprint: contract?.fingerprint ?? null,
  });
}

export function buildEmbroideryProposalDependencies(
  proposals,
  regions,
  graph,
  semanticResult,
  config,
  semanticNormalization,
) {
  const sorted = [...(Array.isArray(proposals) ? proposals : [])].sort((a, b) => a.id.localeCompare(b.id));
  const byRegionId = new Map(sorted.map(item => [item.regionId, item]));
  const warnings = [];
  const baseProposals = sorted.map(proposal => {
    if (!isAutomatic(proposal)) return cloneProposalWithDependencies(proposal, []);
    const dependencies = new Set();
    if (FILL_ROLES.has(proposal.proposedEmbroideryRole) && proposal.semanticRole !== 'background') {
      const parent = nearestStitchableFill(proposal, byRegionId, graph);
      if (parent) dependencies.add(parent.id);
    }
    if (DETAIL_ROLES.has(proposal.proposedEmbroideryRole)) {
      const parent = nearestStitchableFill(proposal, byRegionId, graph);
      if (parent) dependencies.add(parent.id);
      else warnings.push({
        code: 'MISSING_STITCHABLE_PARENT',
        proposalId: proposal.id,
        message: 'Detail has no stitchable containing fill.',
      });
    }
    return cloneProposalWithDependencies(proposal, [...dependencies].sort());
  });
  const canonical = deriveCanonicalContourDependencyContract({
    proposals: baseProposals,
    regions,
    graph,
    semanticResult,
    semanticNormalization,
    config,
  });
  const withDependencies = canonical.proposals;
  const topology = deriveProposalExecutionLayers(withDependencies);
  return {
    proposals: withDependencies,
    warnings: warnings.sort((a, b) =>
      `${a.code}:${a.proposalId}`.localeCompare(`${b.code}:${b.proposalId}`)),
    dependencyCount: withDependencies.reduce((sum, item) => sum + item.dependencyIds.length, 0),
    dependencyCycleCount: topology.cycleCount,
    executionLayers: topology.layers,
    contourDependencyContract: canonical.contract,
    contourDependencyDerivationErrors: canonical.errors,
    config,
    semanticResult,
    sourceRegionCount: Array.isArray(regions) ? regions.length : 0,
  };
}

function dependencyCycleIds(proposals) {
  const byId = new Map(proposals.map(item => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  const cycleIds = new Set();
  const visit = (id, stack = []) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      stack.slice(start).forEach(cycleId => cycleIds.add(cycleId));
      cycleIds.add(id);
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    const nextStack = [...stack, id];
    (Array.isArray(byId.get(id).dependencyIds) ? byId.get(id).dependencyIds : [])
      .forEach(dependencyId => visit(dependencyId, nextStack));
    visiting.delete(id);
    visited.add(id);
  };
  proposals.forEach(proposal => visit(proposal.id));
  return [...cycleIds].sort();
}

function validateExecutionLayers(proposals, executionLayers, requireCanonicalLayers) {
  const errors = [];
  const active = proposals.filter(isAutomatic);
  const activeIds = new Set(active.map(item => item.id));
  if (!requireCanonicalLayers
    && (!Array.isArray(executionLayers) || executionLayers.length === 0)) {
    return { errors, positionByProposalId: {} };
  }
  if (!Array.isArray(executionLayers)) {
    if (requireCanonicalLayers) errors.push(issue(
      'PROPOSAL_EXECUTION_LAYERS_REQUIRED',
      'executionLayers',
      'Execution layers are required for the contour dependency contract.',
    ));
    return { errors, positionByProposalId: {} };
  }
  const positionByProposalId = {};
  const seen = new Set();
  executionLayers.forEach((layer, layerIndex) => {
    if (!Array.isArray(layer)) {
      errors.push(issue(
        'INVALID_PROPOSAL_EXECUTION_LAYER',
        `executionLayers[${layerIndex}]`,
        'Execution layer must be an array.',
      ));
      return;
    }
    layer.forEach((proposalId, itemIndex) => {
      if (!activeIds.has(proposalId)) errors.push(issue(
        'UNKNOWN_PROPOSAL_IN_EXECUTION_LAYER',
        `executionLayers[${layerIndex}][${itemIndex}]`,
        `Execution layer contains unknown or inactive proposal "${proposalId}".`,
        { proposalId },
      ));
      if (seen.has(proposalId)) errors.push(issue(
        'DUPLICATE_PROPOSAL_IN_EXECUTION_LAYERS',
        `executionLayers[${layerIndex}][${itemIndex}]`,
        `Proposal "${proposalId}" occurs more than once in execution layers.`,
        { proposalId },
      ));
      seen.add(proposalId);
      positionByProposalId[proposalId] = layerIndex;
    });
  });
  active.forEach(proposal => {
    if (!seen.has(proposal.id)) errors.push(issue(
      'MISSING_PROPOSAL_IN_EXECUTION_LAYERS',
      'executionLayers',
      `Active proposal "${proposal.id}" is missing from execution layers.`,
      { proposalId: proposal.id },
    ));
    (Array.isArray(proposal.dependencyIds) ? proposal.dependencyIds : [])
      .filter(dependencyId => activeIds.has(dependencyId))
      .forEach(dependencyId => {
        const dependencyLayer = positionByProposalId[dependencyId];
        const proposalLayer = positionByProposalId[proposal.id];
        if (!Number.isInteger(dependencyLayer)
          || !Number.isInteger(proposalLayer)
          || dependencyLayer >= proposalLayer) {
          errors.push(issue(
            'PROPOSAL_EXECUTION_LAYER_DEPENDENCY_ORDER',
            'executionLayers',
            `Dependency "${dependencyId}" must occur in an earlier topological layer than "${proposal.id}".`,
            { proposalId: proposal.id, dependencyId, dependencyLayer, proposalLayer },
          ));
        }
      });
  });
  if (requireCanonicalLayers) {
    const canonical = deriveProposalExecutionLayers(proposals).layers;
    if (!same(executionLayers, canonical)) errors.push(issue(
      'PROPOSAL_EXECUTION_LAYERS_NOT_CANONICAL',
      'executionLayers',
      'Execution layers must exactly equal the deterministic layers derived from the current DAG.',
      { evidence: { expectedExecutionLayers: canonical, actualExecutionLayers: executionLayers } },
    ));
  }
  return { errors, positionByProposalId };
}

function ambiguousContourClaims(claims) {
  const ambiguous = new Set();
  claims.forEach((claim, index) => {
    claims.slice(index + 1).forEach(other => {
      if (claim.componentId !== other.componentId) return;
      const sharedDependencyIds = claim.requiredDependencyIds
        .filter(dependencyId => other.requiredDependencyIds.includes(dependencyId));
      if (!sharedDependencyIds.length) return;
      ambiguous.add(claim.contourProposalId);
      ambiguous.add(other.contourProposalId);
    });
  });
  return ambiguous;
}

function hasHistoricalContourState({
  proposals,
  contourDependencyContract,
  hatchOverlapTrace,
  contourIntegrationMarker,
  metadata,
}) {
  return Boolean(
    contourDependencyContract
    || hatchOverlapTrace
    || contourIntegrationMarker
    || metadata?.hatchOverlapEvaluatorInvoked === true
    || proposals.some(proposal => Object.hasOwn(proposal?.source || {}, 'hatchOverlap')),
  );
}

export function validateProposalDependencyIntegrity({
  proposals = [],
  regions,
  graph,
  semanticResult,
  semanticNormalization,
  config = {},
  integration,
  executionLayers,
  contourDependencyContract = null,
  hatchOverlapTrace = null,
  contourIntegrationMarker = null,
  metadata = null,
  requireContourContract = false,
  requireContourTrace = false,
  requireContourMarker = false,
} = {}) {
  const sorted = [...(Array.isArray(proposals) ? proposals : [])]
    .sort((left, right) => String(left?.id).localeCompare(String(right?.id)));
  const byId = new Map(sorted.map(proposal => [proposal.id, proposal]));
  const resolvedIntegration = normalizedIntegration(config, integration);
  const historicalState = hasHistoricalContourState({
    proposals: sorted,
    contourDependencyContract,
    hatchOverlapTrace,
    contourIntegrationMarker,
    metadata,
  });
  const contourExpected = resolvedIntegration.contourLastEnabled;
  const errors = [];
  const ids = sorted.map(proposal => proposal.id);
  const duplicateIds = sortedUnique(ids.filter((id, index) => ids.indexOf(id) !== index));
  duplicateIds.forEach(proposalId => errors.push(issue(
    'DUPLICATE_PROPOSAL_ID',
    'proposals',
    `Proposal "${proposalId}" occurs more than once.`,
    { proposalId },
  )));
  sorted.forEach(proposal => {
    (Array.isArray(proposal.dependencyIds) ? proposal.dependencyIds : [])
      .forEach(dependencyId => {
        if (!byId.has(dependencyId)) errors.push(issue(
          contourExpected || contourDependencyContract
            ? 'CONTOUR_LAST_UNKNOWN_DEPENDENCY'
            : 'UNKNOWN_PROPOSAL_DEPENDENCY',
          `proposals.${proposal.id}.dependencyIds`,
          `Unknown dependency "${dependencyId}".`,
          { proposalId: proposal.id, dependencyId },
        ));
        if (dependencyId === proposal.id) errors.push(issue(
          contourExpected || contourDependencyContract
            ? 'CONTOUR_LAST_SELF_DEPENDENCY'
            : 'SELF_PROPOSAL_DEPENDENCY',
          `proposals.${proposal.id}.dependencyIds`,
          'Proposal cannot depend on itself.',
          { proposalId: proposal.id, dependencyId },
        ));
      });
  });
  const cycleProposalIds = dependencyCycleIds(sorted);
  if (cycleProposalIds.length) errors.push(issue(
    contourExpected || contourDependencyContract
      ? 'CONTOUR_LAST_DEPENDENCY_CYCLE'
      : 'PROPOSAL_DEPENDENCY_CYCLE',
    'proposals',
    'Proposal dependency graph contains a cycle.',
    { proposalIds: cycleProposalIds },
  ));

  if (historicalState !== contourExpected) errors.push(issue(
    'CONTOUR_LAST_INTEGRATION_STATE_MISMATCH',
    'config',
    'Current CONTOUR-LAST configuration disagrees with historical contract, marker, evaluation, or trace state.',
    {
      evidence: {
        contourLastEnabled: contourExpected,
        historicalStatePresent: historicalState,
      },
    },
  ));
  if (contourExpected && metadata && metadata.hatchOverlapEvaluatorInvoked !== true) errors.push(issue(
    'CONTOUR_LAST_INTEGRATION_STATE_MISMATCH',
    'metadata.hatchOverlapEvaluatorInvoked',
    'Enabled CONTOUR-LAST plans must retain their deterministic evaluator marker.',
  ));

  const layers = validateExecutionLayers(
    sorted,
    executionLayers,
    contourExpected || Boolean(contourDependencyContract),
  );
  errors.push(...layers.errors);

  const canonical = contourExpected
    ? deriveCanonicalContourDependencyContract({
      proposals: sorted,
      regions,
      graph,
      semanticResult,
      semanticNormalization,
      config,
      integration: resolvedIntegration,
    })
    : null;
  if (canonical) errors.push(...canonical.errors);

  if (contourExpected || requireContourContract || historicalState) {
    if (!contourDependencyContract) {
      errors.push(issue(
        'CONTOUR_LAST_CONTRACT_MISSING',
        'hatchOverlapDependencyContract',
        'Enabled or historically applied CONTOUR-LAST plans require their canonical dependency contract.',
      ));
    } else if (canonical?.contract && !same(contourDependencyContract, canonical.contract)) {
      errors.push(issue(
        'CONTOUR_LAST_CONTRACT_STALE',
        'hatchOverlapDependencyContract',
        'Stored contour dependency contract does not exactly match canonical rederivation from current authoritative inputs.',
        {
          evidence: {
            expectedFingerprint: canonical.contract.fingerprint,
            actualFingerprint: contourDependencyContract.fingerprint ?? null,
          },
        },
      ));
    } else if (canonical?.contract
      && contourDependencyContract.fingerprint !== canonical.contract.fingerprint) {
      errors.push(issue(
        'CONTOUR_LAST_CONTRACT_STALE',
        'hatchOverlapDependencyContract.fingerprint',
        'Stored contour dependency fingerprint differs from canonical rederivation.',
      ));
    }
  }

  const expectedMarker = canonical?.contract
    ? createContourIntegrationMarker({
      integration: resolvedIntegration,
      contract: canonical.contract,
    })
    : null;
  if (contourIntegrationMarker || requireContourMarker || (historicalState && !contourExpected)) {
    if (!contourIntegrationMarker) {
      errors.push(issue(
        'CONTOUR_LAST_INTEGRATION_MARKER_MISSING',
        'hatchOverlapIntegrationMarker',
        'Enabled or historically applied CONTOUR-LAST plans require their integration marker.',
      ));
    } else if (expectedMarker && !same(contourIntegrationMarker, expectedMarker)) {
      errors.push(issue(
        'CONTOUR_LAST_INTEGRATION_MARKER_STALE',
        'hatchOverlapIntegrationMarker',
        'Stored CONTOUR-LAST integration marker disagrees with current configuration and canonical contract.',
        { evidence: { expectedMarker, actualMarker: contourIntegrationMarker } },
      ));
    }
  }

  const claims = canonical?.contract?.claims || [];
  const ambiguousClaims = ambiguousContourClaims(claims);
  if (ambiguousClaims.size) errors.push(issue(
    'CONTOUR_LAST_MULTIPLE_CONTOUR_ASSOCIATION_AMBIGUOUS',
    'hatchOverlapDependencyContract.claims',
    'Multiple contours claim the same exclusive dependents in one component.',
    {
      contourProposalIds: [...ambiguousClaims].sort(),
      evidence: { contourProposalIds: [...ambiguousClaims].sort() },
    },
  ));

  const claimResults = [];
  claims.forEach(claim => {
    const associationIncomplete = !claim.componentId
      || !Array.isArray(claim.componentRegionIds)
      || claim.componentRegionIds.length === 0
      || claim.requiredDependencyIds.length === 0;
    if (associationIncomplete) errors.push(issue(
      'CONTOUR_LAST_ASSOCIATION_AMBIGUOUS',
      `hatchOverlapDependencyContract.claims.${claim.contourProposalId}`,
      'Connected-component evidence does not identify any required stitchable dependent.',
      {
        proposalId: claim.contourProposalId,
        evidence: { claim },
      },
    ));
    const contour = byId.get(claim.contourProposalId);
    const actualDependencyIds = sortedUnique(Array.isArray(contour?.dependencyIds)
      ? contour.dependencyIds
      : []);
    const missingDependencyIds = claim.requiredDependencyIds
      .filter(dependencyId => !actualDependencyIds.includes(dependencyId));
    const unknownDependencyIds = actualDependencyIds.filter(dependencyId => !byId.has(dependencyId));
    const selfDependency = actualDependencyIds.includes(claim.contourProposalId);
    missingDependencyIds.forEach(dependencyId => errors.push(issue(
      'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING',
      `proposals.${claim.contourProposalId}.dependencyIds`,
      `Required contour dependency "${dependencyId}" is missing.`,
      {
        proposalId: claim.contourProposalId,
        dependencyId,
        evidence: {
          contractVersion: canonical.contract.version,
          contractFingerprint: canonical.contract.fingerprint,
          contourProposalId: claim.contourProposalId,
          requiredDependencyId: dependencyId,
          associationMethod: claim.associationMethod,
          associationEvidence: claim.associationEvidence,
        },
      },
    )));
    const dependencyLayerViolations = claim.requiredDependencyIds.filter(dependencyId => {
      const dependencyLayer = layers.positionByProposalId[dependencyId];
      const contourLayer = layers.positionByProposalId[claim.contourProposalId];
      return !Number.isInteger(dependencyLayer)
        || !Number.isInteger(contourLayer)
        || dependencyLayer >= contourLayer;
    });
    claimResults.push({
      contourProposalId: claim.contourProposalId,
      contourRegionId: claim.contourRegionId,
      componentId: claim.componentId,
      componentRegionIds: [...claim.componentRegionIds],
      associationMethod: claim.associationMethod,
      associationDisambiguated: claim.associationDisambiguated === true,
      exactGeometricAssociation: false,
      associationEvidence: claim.associationEvidence,
      requiredDependencyIds: [...claim.requiredDependencyIds],
      actualDependencyIds,
      missingDependencyIds,
      unknownDependencyIds,
      selfDependency,
      dependencyLayerViolations,
      topologicalLayer: layers.positionByProposalId[claim.contourProposalId] ?? null,
      individuallySatisfied: missingDependencyIds.length === 0
        && unknownDependencyIds.length === 0
        && !selfDependency
        && dependencyLayerViolations.length === 0
        && !cycleProposalIds.length,
      associationAmbiguous: associationIncomplete
        || ambiguousClaims.has(claim.contourProposalId),
    });
  });

  if (hatchOverlapTrace) {
    const traceEvaluations = Array.isArray(hatchOverlapTrace.evaluations)
      ? hatchOverlapTrace.evaluations
      : [];
    const errorsBeforeTrace = uniqueIssues(errors);
    const expectedApplied = claims.length > 0 && errorsBeforeTrace.length === 0;
    const expectedStatus = errorsBeforeTrace.length
      ? 'blocked'
      : expectedApplied ? 'validated' : 'not_applicable';
    const expectedReasonCodes = sortedUnique(errorsBeforeTrace.map(error => error.code));
    const traceCoherent = hatchOverlapTrace.version === 'engine-v2-hatch-c1-r3-contour-last'
      && hatchOverlapTrace.ruleId === CONTOUR_DEPENDENCY_RULE_ID
      && hatchOverlapTrace.profile === resolvedIntegration.profile
      && same(hatchOverlapTrace.enabledRuleIds, resolvedIntegration.enabledRuleIds)
      && hatchOverlapTrace.integrationMarkerVersion === CONTOUR_INTEGRATION_MARKER_VERSION
      && hatchOverlapTrace.contractFingerprint === canonical?.contract?.fingerprint
      && hatchOverlapTrace.evaluatorInvoked === true
      && hatchOverlapTrace.applied === expectedApplied
      && hatchOverlapTrace.status === expectedStatus
      && same(hatchOverlapTrace.blockedReasonCodes, expectedReasonCodes)
      && traceEvaluations.length === claimResults.length
      && claimResults.every(result => {
        const traced = traceEvaluations.find(item => item.proposalId === result.contourProposalId);
        const proposalEvaluation = byId.get(result.contourProposalId)?.source?.hatchOverlap;
        return traced
          && traced.applied === (expectedApplied && result.individuallySatisfied)
          && same(traced.requiredDependencyIds, result.requiredDependencyIds)
          && same(traced.actualDependencyIds, result.actualDependencyIds)
          && same(traced.missingDependencyIds, result.missingDependencyIds)
          && same(traced.dependencyLayerViolations, result.dependencyLayerViolations)
          && same(proposalEvaluation, traced);
      });
    if (!traceCoherent) errors.push(issue(
      'CONTOUR_LAST_TRACE_STALE',
      'hatchOverlapTrace',
      'Historical CONTOUR-LAST trace is inconsistent with current authoritative inputs, DAG, contract, marker, or evaluations.',
    ));
  } else if (requireContourTrace || (historicalState && !contourExpected)) {
    errors.push(issue(
      'CONTOUR_LAST_TRACE_MISSING',
      'hatchOverlapTrace',
      'Enabled or historically applied CONTOUR-LAST plans require a current integrity trace.',
    ));
  }

  return {
    valid: uniqueIssues(errors).length === 0,
    errors: uniqueIssues(errors),
    warnings: [],
    cycleProposalIds,
    positionByProposalId: layers.positionByProposalId,
    claimResults,
    contractFingerprint: canonical?.contract?.fingerprint ?? null,
    canonicalContract: canonical?.contract ?? null,
    integration: resolvedIntegration,
  };
}

function proposalMap(plan) {
  return new Map((plan?.proposals || []).map(item => [item.id, item]));
}

export function getProposalAncestors(plan, proposalId) {
  const byId = proposalMap(plan);
  const result = [];
  const seen = new Set();
  const visit = id => {
    const proposal = byId.get(id);
    (proposal?.dependencyIds || []).sort().forEach(dependencyId => {
      if (seen.has(dependencyId)) return;
      seen.add(dependencyId);
      result.push(dependencyId);
      visit(dependencyId);
    });
  };
  visit(proposalId);
  return result;
}

export function getProposalDescendants(plan, proposalId) {
  const proposals = [...(plan?.proposals || [])].sort((a, b) => a.id.localeCompare(b.id));
  const result = [];
  const seen = new Set();
  const visit = id => proposals.filter(item => item.dependencyIds.includes(id)).forEach(item => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    result.push(item.id);
    visit(item.id);
  });
  visit(proposalId);
  return result;
}

export function getProposalExecutionLayers(plan) {
  if (Array.isArray(plan?.executionLayers)) return plan.executionLayers.map(layer => [...layer]);
  return deriveProposalExecutionLayers(plan?.proposals || []).layers;
}
