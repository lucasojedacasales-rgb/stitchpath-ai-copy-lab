import { describe, expect, it } from 'vitest';
import { compileCanonicalCommandStream } from '../commandCompilation/canonicalCommandCompiler.js';
import { propagateFlatErrors } from '../errorPropagation.js';
import {
  HATCH_C_REFERENCE_DESIGN_MM,
  createHatchCReferenceRegions,
  createHatchCReferenceSemanticResult,
} from './fixtures/hatchCReferenceFixtures.js';
import { ingestV1RegionsToRegionGraphV2 } from '../ingestion/regionIngestion.js';
import { materializeEmbroideryObjectDrafts } from '../materialization/objectDraftMaterializer.js';
import { resolveProposalReviewDecisions } from '../materialization/proposalReviewResolver.js';
import { createEmbroideryObjectProposalV2 } from '../planning/embroideryPlanningModel.js';
import {
  buildEmbroideryProposalDependencies,
  normalizeCanonicalSemanticResult,
  validateProposalDependencyIntegrity,
} from '../planning/dependencyPlanner.js';
import { buildEmbroideryObjectProposalPlan } from '../planning/objectPlanningPipeline.js';
import { validateEmbroideryObjectProposalPlan } from '../planning/objectPlanningValidation.js';
import {
  CONTOUR_LAST_RULE_ID,
  evaluateContourLastProposalGuard,
} from '../rules/hatchEvidence/contourLast.js';
import { resolveHatchOverlapIntegrationConfig } from '../rules/hatchEvidence/overlapProfiles.js';
import { buildGlobalSequencePlan } from '../sequencing/globalSequencePlanner.js';
import { buildMachineIndependentPhysicalStitchPlan } from '../stitchGeneration/physicalStitchPipeline.js';
import { buildTechnicalEmbroideryPlan } from '../technical/technicalPlanningPipeline.js';
import { materializeThreadedEmbroideryObjects } from '../threads/finalObjectMaterializer.js';

const C_CONFIG = Object.freeze({
  hatchOverlapProfile: 'hatch-c-experimental',
  hatchOverlapRuleFlags: Object.freeze({ [CONTOUR_LAST_RULE_ID]: true }),
});
const C_INTEGRATION = resolveHatchOverlapIntegrationConfig(C_CONFIG);
const GEOMETRY = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 10, y: 0 }),
  Object.freeze({ x: 10, y: 10 }),
  Object.freeze({ x: 0, y: 10 }),
]);
const INVALID_SEMANTIC_ENTRY_CASES = Object.freeze([
  {
    name: 'regionId missing',
    mutate: entry => { delete entry.regionId; return entry; },
    expectedCode: 'INVALID_SEMANTIC_RESULT_REGION_ID',
  },
  {
    name: 'regionId empty',
    mutate: entry => ({ ...entry, regionId: '' }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_REGION_ID',
  },
  {
    name: 'regionId whitespace',
    mutate: entry => ({ ...entry, regionId: '   ' }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_REGION_ID',
  },
  {
    name: 'regionId number',
    mutate: entry => ({ ...entry, regionId: 7 }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_REGION_ID',
  },
  {
    name: 'regionId null',
    mutate: entry => ({ ...entry, regionId: null }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_REGION_ID',
  },
  {
    name: 'regionId object',
    mutate: entry => ({ ...entry, regionId: { value: entry.regionId } }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_REGION_ID',
  },
  {
    name: 'regionId array',
    mutate: entry => ({ ...entry, regionId: [] }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_REGION_ID',
  },
  {
    name: 'regionId differs from identity',
    mutate: (entry, regionId) => ({ ...entry, regionId: `${regionId}:different` }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_REGION_ID',
    assessmentExpectedCode: 'INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS',
  },
  {
    name: 'entry is not a plain object',
    mutate: () => [],
    byRegionExpectedCode: 'INVALID_SEMANTIC_RESULT_BY_REGION_ENTRY',
    assessmentExpectedCode: 'INVALID_SEMANTIC_RESULT_ASSESSMENT',
  },
  {
    name: 'semanticRole missing',
    mutate: entry => { delete entry.semanticRole; return entry; },
    expectedCode: 'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
  },
  {
    name: 'semanticRole empty',
    mutate: entry => ({ ...entry, semanticRole: '' }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
  },
  {
    name: 'semanticRole whitespace',
    mutate: entry => ({ ...entry, semanticRole: '   ' }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
  },
  {
    name: 'semanticRole number',
    mutate: entry => ({ ...entry, semanticRole: 7 }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
  },
  {
    name: 'semanticRole null',
    mutate: entry => ({ ...entry, semanticRole: null }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
  },
  {
    name: 'semanticRole array',
    mutate: entry => ({ ...entry, semanticRole: ['dark_mark'] }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
  },
  {
    name: 'semanticRole object',
    mutate: entry => ({
      ...entry,
      semanticRole: { value: 'dark_mark' },
    }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
  },
  {
    name: 'semanticRole outside admitted domain',
    mutate: entry => ({ ...entry, semanticRole: 'contour_candidate' }),
    expectedCode: 'INVALID_SEMANTIC_RESULT_SEMANTIC_ROLE',
  },
]);
const INVALID_SEMANTIC_MATRIX = Object.freeze(
  ['byRegionId', 'assessments'].flatMap(representation =>
    ['single', 'other-valid'].flatMap(availability =>
      INVALID_SEMANTIC_ENTRY_CASES.map(invalidCase => ({
        representation,
        availability,
        invalidCase,
      })))),
);

function recomputeReceivedContractFingerprint(contract) {
  const { fingerprint: _receivedFingerprint, ...body } = contract;
  const text = JSON.stringify(body);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function planningContext(referenceId = 'C8') {
  const regions = createHatchCReferenceRegions(referenceId);
  const ingestion = ingestV1RegionsToRegionGraphV2(regions, {
    coordinateSpace: 'millimeter',
    designWidthMm: HATCH_C_REFERENCE_DESIGN_MM.width,
    designHeightMm: HATCH_C_REFERENCE_DESIGN_MM.height,
  });
  const semanticResult = createHatchCReferenceSemanticResult(ingestion.regions, referenceId);
  const plan = buildEmbroideryObjectProposalPlan({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    config: {
      designWidthMm: HATCH_C_REFERENCE_DESIGN_MM.width,
      designHeightMm: HATCH_C_REFERENCE_DESIGN_MM.height,
      minimumTatamiAreaMm2: 5,
      ...C_CONFIG,
    },
    technicalConfig: referenceId === 'C12' ? { tatami: { minimumAreaMm2: 5 } } : {},
  });
  return { ingestion, semanticResult, plan };
}

function buildPlanWithSemanticResult(context, semanticResult) {
  return buildEmbroideryObjectProposalPlan({
    regions: context.ingestion.regions,
    graph: context.ingestion.graph,
    semanticResult,
    config: context.plan.config,
    technicalConfig: {},
  });
}

function outlineSemanticId(semanticResult) {
  return semanticResult.assessments
    .find(assessment => assessment.semanticRole === 'dark_mark').regionId;
}

function corruptSemanticEntry(semanticResult, representation, invalidCase) {
  const outlineId = outlineSemanticId(semanticResult);
  if (representation === 'byRegionId') {
    semanticResult.byRegionId[outlineId] = invalidCase.mutate(
      structuredClone(semanticResult.byRegionId[outlineId]),
      outlineId,
    );
  } else {
    const index = semanticResult.assessments
      .findIndex(assessment => assessment.regionId === outlineId);
    semanticResult.assessments[index] = invalidCase.mutate(
      structuredClone(semanticResult.assessments[index]),
      outlineId,
    );
  }
  return outlineId;
}

function expectedSemanticErrorCode(representation, invalidCase) {
  if (representation === 'byRegionId' && invalidCase.byRegionExpectedCode) {
    return invalidCase.byRegionExpectedCode;
  }
  if (representation === 'assessments' && invalidCase.assessmentExpectedCode) {
    return invalidCase.assessmentExpectedCode;
  }
  return invalidCase.expectedCode;
}

function proposal({
  id,
  regionId = `${id}-region`,
  role,
  dependencyIds = [],
  componentId = 'component-0001',
  explicitDependencyIds = null,
}) {
  const outline = role === 'outer_outline' || role === 'inner_outline';
  return {
    componentId,
    proposal: createEmbroideryObjectProposalV2({
      id,
      regionId,
      semanticRole: outline ? 'dark_mark' : role === 'internal_detail' ? 'internal_feature' : 'primary_shape',
      proposedEmbroideryRole: role,
      proposedStitchType: outline ? 'running' : role === 'internal_detail' ? 'satin' : 'tatami',
      geometryMm: GEOMETRY,
      holesMm: [],
      visualColor: outline ? '#111111' : '#f57c00',
      layer: outline ? 5 : 1,
      dependencyIds,
      planningConfidence: 1,
      evidence: [{ code: 'C1_R1_STRUCTURAL_FIXTURE', message: 'Closed structural fixture.' }],
      outlineEligibility: outline ? {
        eligible: true,
        explicitOutlineEvidence: true,
        regionBackedGeometry: true,
      } : null,
      source: explicitDependencyIds ? {
        contourDependencyAssociation: {
          method: 'explicit_proposal_ids',
          evidenceId: `evidence:${id}`,
          requiredProposalIds: explicitDependencyIds,
        },
      } : {},
    }),
  };
}

function graphFor(items) {
  const sorted = [...items].sort((left, right) => left.proposal.regionId.localeCompare(right.proposal.regionId));
  return {
    version: '2-region-graph',
    regionIds: sorted.map(item => item.proposal.regionId),
    nodes: Object.fromEntries(sorted.map(item => [item.proposal.regionId, {
      regionId: item.proposal.regionId,
      parentId: null,
      childIds: [],
      containingRegionIds: [],
      containedRegionIds: [],
      overlappingRegionIds: [],
      touchingRegionIds: [],
      disconnectedComponentId: item.componentId,
    }])),
  };
}

function structuralCase(items) {
  const graph = graphFor(items);
  const regions = items.map(item => ({
    id: item.proposal.regionId,
    role: item.proposal.semanticRole,
    regionClass: item.proposal.proposedEmbroideryRole,
    explicitOutline: ['outer_outline', 'inner_outline']
      .includes(item.proposal.proposedEmbroideryRole),
  }));
  const semanticResult = {
    assessments: items.map(item => ({
      regionId: item.proposal.regionId,
      semanticRole: item.proposal.semanticRole,
      sourceRole: item.proposal.semanticRole,
      sourceRoleTrusted: true,
    })),
  };
  const result = buildEmbroideryProposalDependencies(
    items.map(item => item.proposal),
    regions,
    graph,
    semanticResult,
    C_CONFIG,
  );
  const guarded = evaluateContourLastProposalGuard({
    proposals: result.proposals,
    regions,
    graph,
    semanticResult,
    config: C_CONFIG,
    executionLayers: result.executionLayers,
    contourDependencyContract: result.contourDependencyContract,
    integration: C_INTEGRATION,
  });
  return {
    graph,
    regions,
    semanticResult,
    dependencyResult: result,
    guarded,
  };
}

function currentPlanValidation(context, mutate) {
  const plan = structuredClone(context.plan);
  mutate(plan);
  plan.valid = true;
  return validateEmbroideryObjectProposalPlan(
    plan,
    context.ingestion.regions,
    context.ingestion.graph,
    context.semanticResult,
  );
}

function invalidDirectChain(context, mutate) {
  const proposalPlan = structuredClone(context.plan);
  mutate(proposalPlan);
  proposalPlan.valid = true;
  const review = resolveProposalReviewDecisions({
    plan: proposalPlan,
    regions: context.ingestion.regions,
    graph: context.ingestion.graph,
    semanticResult: context.semanticResult,
  });
  const drafts = materializeEmbroideryObjectDrafts({
    regions: context.ingestion.regions,
    graph: context.ingestion.graph,
    semanticResult: context.semanticResult,
    proposalPlan,
  });
  const objects = materializeThreadedEmbroideryObjects({
    regions: context.ingestion.regions,
    objectDraftMaterialization: drafts,
  });
  const technical = buildTechnicalEmbroideryPlan({
    regions: context.ingestion.regions,
    threadedObjectMaterialization: objects,
  });
  const sequence = buildGlobalSequencePlan({
    regions: context.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
  });
  const physical = buildMachineIndependentPhysicalStitchPlan({
    regions: context.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
    sequencePlan: sequence,
  });
  const canonical = compileCanonicalCommandStream({
    regions: context.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
    sequencePlan: sequence,
    physicalPlan: physical,
    config: { allowPartialCanonicalStream: true },
  });
  return { proposalPlan, review, drafts, objects, technical, sequence, physical, canonical };
}

function invalidSemanticChain(context, semanticResult) {
  const proposalPlan = buildPlanWithSemanticResult(context, semanticResult);
  const review = resolveProposalReviewDecisions({
    plan: proposalPlan,
    regions: context.ingestion.regions,
    graph: context.ingestion.graph,
    semanticResult,
  });
  const drafts = materializeEmbroideryObjectDrafts({
    regions: context.ingestion.regions,
    graph: context.ingestion.graph,
    semanticResult,
    proposalPlan,
  });
  const objects = materializeThreadedEmbroideryObjects({
    regions: context.ingestion.regions,
    objectDraftMaterialization: drafts,
  });
  const technical = buildTechnicalEmbroideryPlan({
    regions: context.ingestion.regions,
    threadedObjectMaterialization: objects,
  });
  const sequence = buildGlobalSequencePlan({
    regions: context.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
  });
  const physical = buildMachineIndependentPhysicalStitchPlan({
    regions: context.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
    sequencePlan: sequence,
  });
  const canonical = compileCanonicalCommandStream({
    regions: context.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
    sequencePlan: sequence,
    physicalPlan: physical,
    config: { allowPartialCanonicalStream: true },
  });
  return { proposalPlan, review, drafts, objects, technical, sequence, physical, canonical };
}

function validateWithSemanticMutation(context, mutate) {
  const semanticResult = structuredClone(context.semanticResult);
  mutate(semanticResult);
  return validateEmbroideryObjectProposalPlan(
    context.plan,
    context.ingestion.regions,
    context.ingestion.graph,
    semanticResult,
  );
}

function countOccurrences(text, token) {
  return text.split(token).length - 1;
}

function acceptedOutputCount(name, result) {
  if (name === 'review') return result.summary.acceptedDecisionCount;
  if (name === 'drafts') return result.drafts.length;
  if (name === 'objects') return result.objects.length;
  if (name === 'technical') return result.specifications.length;
  if (name === 'sequence') return result.executionSteps.length;
  if (name === 'physical') return result.objectPaths.length + result.summary.physicalPointCount;
  return result.commands.length;
}

function containsUpstreamErrorTree(value) {
  if (Array.isArray(value)) {
    return value.some(item =>
      item && typeof item === 'object' && typeof item.code === 'string'
      && (typeof item.path === 'string' || typeof item.message === 'string'))
      || value.some(containsUpstreamErrorTree);
  }
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value.errors)) return true;
  return Object.values(value).some(containsUpstreamErrorTree);
}

describe('Hatch C1-R1 canonical dependency contract', () => {
  it.each([
    ['a-outline', 'z-fill'],
    ['zz-outline', 'aa-fill'],
    ['m7-outline', 'q2-fill'],
  ])('uses DAG topology rather than lexical order for %s -> %s', (outlineId, fillId) => {
    const items = [
      proposal({ id: outlineId, role: 'outer_outline' }),
      proposal({ id: fillId, role: 'base_fill' }),
    ];
    const first = structuralCase(items);
    const reversed = structuralCase([...items].reverse());
    const dependencySnapshot = result => result.proposals.map(item => ({
      id: item.id,
      dependencyIds: item.dependencyIds,
    }));

    expect(first.dependencyResult.proposals.map(item => item.id))
      .toEqual([outlineId, fillId].sort());
    expect(first.dependencyResult.executionLayers).toEqual([[fillId], [outlineId]]);
    expect(first.guarded.trace).toMatchObject({
      applied: true,
      status: 'validated',
      blockedReasonCodes: [],
    });
    expect(first.guarded.trace).not.toHaveProperty('fallbackUsed');
    expect(dependencySnapshot(first.guarded)).toEqual(dependencySnapshot(first.dependencyResult));
    expect(first.dependencyResult.executionLayers).toEqual(reversed.dependencyResult.executionLayers);
    expect(first.dependencyResult.contourDependencyContract)
      .toEqual(reversed.dependencyResult.contourDependencyContract);
  });

  it('validates complete, unique and dependency-coherent topological layers', () => {
    const fixture = structuralCase([
      proposal({ id: 'a-outline', role: 'outer_outline' }),
      proposal({ id: 'z-fill', role: 'base_fill' }),
    ]);
    const validate = executionLayers => validateProposalDependencyIntegrity({
      proposals: fixture.dependencyResult.proposals,
      regions: fixture.regions,
      graph: fixture.graph,
      semanticResult: fixture.semanticResult,
      config: C_CONFIG,
      executionLayers,
      contourDependencyContract: fixture.dependencyResult.contourDependencyContract,
    });

    expect(validate([['z-fill'], ['a-outline']]).valid).toBe(true);
    expect(validate([['z-fill', 'ghost'], ['a-outline']]).errors.map(error => error.code))
      .toContain('UNKNOWN_PROPOSAL_IN_EXECUTION_LAYER');
    expect(validate([['z-fill'], ['z-fill'], ['a-outline']]).errors.map(error => error.code))
      .toContain('DUPLICATE_PROPOSAL_IN_EXECUTION_LAYERS');
    expect(validate([['a-outline']]).errors.map(error => error.code))
      .toContain('MISSING_PROPOSAL_IN_EXECUTION_LAYERS');
    expect(validate([['a-outline', 'z-fill']]).errors.map(error => error.code))
      .toContain('PROPOSAL_EXECUTION_LAYER_DEPENDENCY_ORDER');
    expect(validate([['a-outline'], ['z-fill']]).errors.map(error => error.code))
      .toContain('PROPOSAL_EXECUTION_LAYER_DEPENDENCY_ORDER');
  });

  it.each([
    ['required edge removed', plan => {
      plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline').dependencyIds = [];
    }, 'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING'],
    ['unknown dependency', plan => {
      plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline').dependencyIds.push('proposal:unknown');
    }, 'CONTOUR_LAST_UNKNOWN_DEPENDENCY'],
    ['self dependency', plan => {
      const outline = plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline');
      outline.dependencyIds.push(outline.id);
    }, 'CONTOUR_LAST_SELF_DEPENDENCY'],
    ['relevant role changed', plan => {
      plan.proposals.find(item => item.proposedEmbroideryRole === 'foreground_fill').proposedEmbroideryRole = 'internal_detail';
    }, 'CONTOUR_LAST_CONTRACT_STALE'],
    ['relevant identity changed', plan => {
      plan.proposals.find(item => item.proposedEmbroideryRole === 'foreground_fill').id = 'proposal:changed:foreground_fill';
    }, 'CONTOUR_LAST_CONTRACT_STALE'],
    ['topological layers stale', plan => {
      plan.executionLayers = [...plan.executionLayers].reverse();
    }, 'PROPOSAL_EXECUTION_LAYER_DEPENDENCY_ORDER'],
    ['historical trace changed', plan => {
      plan.hatchOverlapTrace.evaluations[0].actualDependencyIds = [];
    }, 'CONTOUR_LAST_TRACE_STALE'],
    ['canonical contract removed', plan => {
      delete plan.hatchOverlapDependencyContract;
    }, 'CONTOUR_LAST_CONTRACT_MISSING'],
    ['current trace removed', plan => {
      delete plan.hatchOverlapTrace;
    }, 'CONTOUR_LAST_TRACE_MISSING'],
  ])('revalidates a previously applied plan after %s', (_name, mutate, expectedCode) => {
    const validation = currentPlanValidation(planningContext('C8'), mutate);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map(error => error.code)).toContain(expectedCode);
  });

  it('detects both two-node and three-node cycles after the guard', () => {
    const two = planningContext('C8');
    const twoValidation = currentPlanValidation(two, plan => {
      const outline = plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline');
      const fill = plan.proposals.find(item => item.proposedEmbroideryRole === 'foreground_fill');
      fill.dependencyIds = [outline.id];
    });
    expect(twoValidation.errors.map(error => error.code)).toContain('CONTOUR_LAST_DEPENDENCY_CYCLE');

    const three = planningContext('C12');
    const threeValidation = currentPlanValidation(three, plan => {
      const outline = plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline');
      const fills = plan.proposals.filter(item => item.proposedEmbroideryRole === 'foreground_fill');
      fills[0].dependencyIds = [fills[1].id];
      fills[1].dependencyIds = [outline.id];
    });
    expect(threeValidation.errors.map(error => error.code)).toContain('CONTOUR_LAST_DEPENDENCY_CYCLE');
  });
});

describe('Hatch C1-R2 authoritative canonical rederivation', () => {
  it('rejects a coherently self-recertified contract after removing the required C8 edge', () => {
    const validation = currentPlanValidation(planningContext('C8'), plan => {
      const outline = plan.proposals
        .find(item => item.proposedEmbroideryRole === 'outer_outline');
      outline.dependencyIds = [];
      delete outline.source.hatchOverlap;
      const contract = plan.hatchOverlapDependencyContract;
      contract.claims = [];
      contract.requiredEdges = [];
      contract.explicitAssociations = [];
      contract.proposalSignatures
        .find(item => item.proposalId === outline.id).dependencyIds = [];
      contract.fingerprint = recomputeReceivedContractFingerprint(contract);
      plan.hatchOverlapIntegrationMarker.contractFingerprint = contract.fingerprint;
      plan.hatchOverlapTrace = {
        ...plan.hatchOverlapTrace,
        contractFingerprint: contract.fingerprint,
        eligibleOutlineCount: 0,
        evaluationCount: 0,
        evaluations: [],
        applied: false,
        status: 'not_applicable',
        blockedReasonCodes: [],
        transaction: {
          valid: true,
          physicalOutputAllowed: true,
          canonicalOutputAllowed: true,
          partialOutputAllowed: false,
        },
      };
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.map(error => error.code))
      .toContain('CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING');
    expect(validation.errors.map(error => error.code))
      .toContain('CONTOUR_LAST_CONTRACT_STALE');
  });

  it('rejects a graph component change made after canonical contract creation', () => {
    const context = planningContext('C8');
    const graph = structuredClone(context.ingestion.graph);
    const outline = context.plan.proposals
      .find(item => item.proposedEmbroideryRole === 'outer_outline');
    graph.nodes[outline.regionId].disconnectedComponentId = 'component:tampered';
    const validation = validateEmbroideryObjectProposalPlan(
      context.plan,
      context.ingestion.regions,
      graph,
      context.semanticResult,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors.map(error => error.code))
      .toContain('CONTOUR_LAST_CONTRACT_STALE');
  });

  it('rejects silent C deactivation when historical metadata and evaluations remain', () => {
    const validation = currentPlanValidation(planningContext('C8'), plan => {
      const extras = { ...(plan.config.extras || {}) };
      delete extras.hatchOverlapProfile;
      delete extras.hatchOverlapRuleFlags;
      plan.config = { ...plan.config, extras };
      delete plan.hatchOverlapDependencyContract;
      delete plan.hatchOverlapIntegrationMarker;
      delete plan.hatchOverlapTrace;
    });

    const codes = validation.errors.map(error => error.code);
    expect(codes).toContain('CONTOUR_LAST_INTEGRATION_STATE_MISMATCH');
    expect(codes).toContain('CONTOUR_LAST_CONTRACT_MISSING');
    expect(codes).toContain('CONTOUR_LAST_INTEGRATION_MARKER_MISSING');
    expect(codes).toContain('CONTOUR_LAST_TRACE_MISSING');
  });

  it('rejects removal of currently authoritative explicit association evidence', () => {
    const fixture = structuralCase([
      proposal({ id: 'fill-outer', role: 'base_fill' }),
      proposal({ id: 'fill-inner', role: 'foreground_fill' }),
      proposal({
        id: 'outline-outer',
        role: 'outer_outline',
        explicitDependencyIds: ['fill-outer'],
      }),
      proposal({
        id: 'outline-inner',
        role: 'inner_outline',
        explicitDependencyIds: ['fill-inner'],
      }),
    ]);
    const proposals = structuredClone(fixture.guarded.proposals);
    delete proposals.find(item => item.id === 'outline-inner')
      .source.contourDependencyAssociation;
    const validation = validateProposalDependencyIntegrity({
      proposals,
      regions: fixture.regions,
      graph: fixture.graph,
      semanticResult: fixture.semanticResult,
      config: C_CONFIG,
      executionLayers: fixture.dependencyResult.executionLayers,
      contourDependencyContract: fixture.dependencyResult.contourDependencyContract,
      hatchOverlapTrace: fixture.guarded.trace,
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.map(error => error.code))
      .toContain('CONTOUR_LAST_CONTRACT_STALE');
  });

  it.each([
    ['leading empty layer', [[], ['z-fill'], ['a-outline']]],
    ['trailing empty layer', [['z-fill'], ['a-outline'], []]],
    ['displaced layer', [['z-fill'], [], ['a-outline']]],
    ['redundant proposal layer', [['z-fill'], ['a-outline'], ['a-outline']]],
    ['alternative grouping', [['z-fill', 'a-outline']]],
  ])('rejects noncanonical execution layers: %s', (_name, executionLayers) => {
    const fixture = structuralCase([
      proposal({ id: 'a-outline', role: 'outer_outline' }),
      proposal({ id: 'z-fill', role: 'base_fill' }),
    ]);
    const validation = validateProposalDependencyIntegrity({
      proposals: fixture.dependencyResult.proposals,
      regions: fixture.regions,
      graph: fixture.graph,
      semanticResult: fixture.semanticResult,
      config: C_CONFIG,
      executionLayers,
      contourDependencyContract: fixture.dependencyResult.contourDependencyContract,
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.map(error => error.code))
      .toContain('PROPOSAL_EXECUTION_LAYERS_NOT_CANONICAL');
  });

  it('blocks two explicit exclusive contour associations to the same fill', () => {
    const result = structuralCase([
      proposal({ id: 'fill', role: 'base_fill' }),
      proposal({
        id: 'outline-a',
        role: 'outer_outline',
        explicitDependencyIds: ['fill'],
      }),
      proposal({
        id: 'outline-b',
        role: 'inner_outline',
        explicitDependencyIds: ['fill'],
      }),
    ]);

    expect(result.guarded.errors.map(error => error.code))
      .toContain('CONTOUR_LAST_MULTIPLE_CONTOUR_ASSOCIATION_AMBIGUOUS');
    expect(result.guarded.trace.applied).toBe(false);
    expect(result.guarded.trace.evaluations.every(evaluation =>
      evaluation.applied === false)).toBe(true);
  });
});

describe('Hatch C1-R3 canonical semantic authority', () => {
  it.each([
    ['byRegionId only', semanticResult => {
      const outline = semanticResult.assessments
        .find(assessment => assessment.semanticRole === 'dark_mark');
      semanticResult.byRegionId[outline.regionId] = {
        ...structuredClone(semanticResult.byRegionId[outline.regionId]),
        semanticRole: 'internal_feature',
      };
    }],
    ['assessments only', semanticResult => {
      const index = semanticResult.assessments
        .findIndex(assessment => assessment.semanticRole === 'dark_mark');
      semanticResult.assessments[index] = {
        ...structuredClone(semanticResult.assessments[index]),
        semanticRole: 'internal_feature',
      };
    }],
    ['region missing from byRegionId', semanticResult => {
      const outline = semanticResult.assessments
        .find(assessment => assessment.semanticRole === 'dark_mark');
      delete semanticResult.byRegionId[outline.regionId];
    }],
    ['duplicate contradictory assessment', semanticResult => {
      const outline = semanticResult.assessments
        .find(assessment => assessment.semanticRole === 'dark_mark');
      semanticResult.assessments.push({
        ...structuredClone(outline),
        semanticRole: 'internal_feature',
      });
    }],
  ])('rejects semantic divergence mutated in %s', (_name, mutate) => {
    const validation = validateWithSemanticMutation(planningContext('C8'), mutate);
    const codes = validation.errors.map(error => error.code);

    expect(validation.valid).toBe(false);
    expect(codes.some(code => [
      'INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS',
      'DUPLICATE_SEMANTIC_ASSESSMENT_REGION_ID',
      'CONTOUR_LAST_CONTRACT_STALE',
    ].includes(code))).toBe(true);
  });

  it('accepts equivalent representations and rebuilds every participant role identically', () => {
    const context = planningContext('C8');
    const normalized = normalizeCanonicalSemanticResult(context.semanticResult, {
      strict: true,
      expectedRegionIds: context.ingestion.regions.map(region => region.id),
    });
    const validation = validateEmbroideryObjectProposalPlan(
      context.plan,
      context.ingestion.regions,
      context.ingestion.graph,
      context.semanticResult,
    );
    const integrity = validateProposalDependencyIntegrity({
      proposals: context.plan.proposals,
      regions: context.ingestion.regions,
      graph: context.ingestion.graph,
      semanticResult: context.semanticResult,
      config: context.plan.config,
      executionLayers: context.plan.executionLayers,
      contourDependencyContract: context.plan.hatchOverlapDependencyContract,
      hatchOverlapTrace: context.plan.hatchOverlapTrace,
      contourIntegrationMarker: context.plan.hatchOverlapIntegrationMarker,
      metadata: context.plan.metadata,
      requireContourContract: true,
      requireContourTrace: true,
      requireContourMarker: true,
    });

    expect(normalized.valid).toBe(true);
    expect(validation.valid).toBe(true);
    expect(integrity.valid).toBe(true);
    expect(context.plan.hatchOverlapDependencyContract.semanticAuthority)
      .toEqual(normalized.signature);
    expect(integrity.canonicalContract)
      .toEqual(context.plan.hatchOverlapDependencyContract);

    const freshParticipants = new Map(integrity.canonicalContract.claims
      .flatMap(claim => claim.participants)
      .map(participant => [participant.proposalId, participant]));
    context.plan.hatchOverlapDependencyContract.claims
      .flatMap(claim => claim.participants)
      .forEach(stored => {
        const freshlyRebuilt = freshParticipants.get(stored.proposalId);
        expect(stored.semanticRole).toBe(freshlyRebuilt.semanticRole);
        expect(stored.semanticAssessment.semanticRole)
          .toBe(freshlyRebuilt.semanticAssessment.semanticRole);
      });
  });

  it.each(['byRegionId', 'assessments'])(
    'accepts the single %s representation through the same normalizer',
    representation => {
      const context = planningContext('C8');
      const semanticResult = structuredClone(context.semanticResult);
      if (representation === 'byRegionId') delete semanticResult.assessments;
      else delete semanticResult.byRegionId;

      const normalized = normalizeCanonicalSemanticResult(semanticResult, {
        strict: true,
        expectedRegionIds: context.ingestion.regions.map(region => region.id),
      });

      expect(normalized.valid).toBe(true);
      expect(Object.keys(normalized.byRegionId).sort())
        .toEqual(context.ingestion.regions.map(region => region.id).sort());
    },
  );

  it('rejects malformed representations and invalid assessment IDs deterministically', () => {
    const normalized = normalizeCanonicalSemanticResult({
      byRegionId: [],
      assessments: [{ regionId: '', semanticRole: 'primary_shape' }],
    }, {
      strict: true,
      expectedRegionIds: ['region-a'],
    });

    expect(normalized.valid).toBe(false);
    expect(normalized.errors.map(error => error.code))
      .toContain('INVALID_SEMANTIC_RESULT_REPRESENTATION');
    expect(normalized.errors.map(error => error.code))
      .toContain('INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS');
  });
});

describe('Hatch C1-R4 strict semantic entry validation', () => {
  it.each(INVALID_SEMANTIC_MATRIX)(
    'rejects $representation $availability: $invalidCase.name',
    ({ representation, availability, invalidCase }) => {
      const context = planningContext('C8');
      const semanticResult = structuredClone(context.semanticResult);
      corruptSemanticEntry(semanticResult, representation, invalidCase);
      if (availability === 'single') {
        if (representation === 'byRegionId') delete semanticResult.assessments;
        else delete semanticResult.byRegionId;
      }
      const expectedCode = expectedSemanticErrorCode(representation, invalidCase);
      const expectedRegionIds = context.ingestion.regions.map(region => region.id);
      const normalized = normalizeCanonicalSemanticResult(semanticResult, {
        strict: true,
        expectedRegionIds,
      });
      const validation = validateEmbroideryObjectProposalPlan(
        context.plan,
        context.ingestion.regions,
        context.ingestion.graph,
        semanticResult,
      );
      const rebuilt = buildPlanWithSemanticResult(context, semanticResult);

      expect(normalized.valid).toBe(false);
      expect(normalized.errors.map(error => error.code)).toContain(expectedCode);
      expect(validation.valid).toBe(false);
      expect(validation.errors.map(error => error.code)).toContain(expectedCode);
      expect(rebuilt.valid).toBe(false);
      expect(rebuilt.errors.map(error => error.code)).toContain(expectedCode);
      expect(rebuilt.hatchOverlapDependencyContract).toBeNull();
      expect(rebuilt.hatchOverlapIntegrationMarker).toMatchObject({
        active: true,
        contractFingerprint: null,
      });
      expect(rebuilt.hatchOverlapTrace).toMatchObject({
        evaluatorInvoked: true,
        applied: false,
        status: 'blocked',
      });
      expect(rebuilt.metadata.hatchOverlapEvaluatorInvoked).toBe(true);
    },
  );

  it('closes the exact missing own byRegionId.regionId reproduction', () => {
    const context = planningContext('C8');
    const semanticResult = structuredClone(context.semanticResult);
    const outlineId = outlineSemanticId(semanticResult);
    delete semanticResult.byRegionId[outlineId].regionId;

    const normalized = normalizeCanonicalSemanticResult(semanticResult, {
      strict: true,
      expectedRegionIds: context.ingestion.regions.map(region => region.id),
    });
    const validation = validateEmbroideryObjectProposalPlan(
      context.plan,
      context.ingestion.regions,
      context.ingestion.graph,
      semanticResult,
    );

    expect(normalized.valid).toBe(false);
    expect(normalized.errors.map(error => error.code))
      .toContain('INVALID_SEMANTIC_RESULT_REGION_ID');
    expect(validation.valid).toBe(false);
    expect(validation.errors.map(error => error.code))
      .toContain('INVALID_SEMANTIC_RESULT_REGION_ID');
  });

  it('rejects an empty byRegionId key without reconstructing its identity', () => {
    const context = planningContext('C8');
    const semanticResult = structuredClone(context.semanticResult);
    const outlineId = outlineSemanticId(semanticResult);
    const entry = semanticResult.byRegionId[outlineId];
    delete semanticResult.byRegionId[outlineId];
    semanticResult.byRegionId[''] = { ...entry, regionId: '' };

    const normalized = normalizeCanonicalSemanticResult(semanticResult, {
      strict: true,
      expectedRegionIds: context.ingestion.regions.map(region => region.id),
    });
    const rebuilt = buildPlanWithSemanticResult(context, semanticResult);

    expect(normalized.valid).toBe(false);
    expect(normalized.errors.map(error => error.code))
      .toContain('INVALID_SEMANTIC_RESULT_REGION_ID');
    expect(rebuilt.valid).toBe(false);
    expect(rebuilt.hatchOverlapDependencyContract).toBeNull();
  });

  it.each([
    ['byRegionId', 'confidence', 0.123456],
    ['assessments', 'confidence', 0.123456],
    ['byRegionId', 'sourceRole', 'primary_shape'],
    ['assessments', 'sourceRole', 'primary_shape'],
  ])('retains unilateral %s %s divergence detection', (representation, field, value) => {
    const context = planningContext('C8');
    const semanticResult = structuredClone(context.semanticResult);
    const outlineId = outlineSemanticId(semanticResult);
    if (representation === 'byRegionId') {
      semanticResult.byRegionId[outlineId] = {
        ...structuredClone(semanticResult.byRegionId[outlineId]),
        [field]: value,
      };
    } else {
      const index = semanticResult.assessments
        .findIndex(assessment => assessment.regionId === outlineId);
      semanticResult.assessments[index] = {
        ...structuredClone(semanticResult.assessments[index]),
        [field]: value,
      };
    }

    const normalized = normalizeCanonicalSemanticResult(semanticResult, {
      strict: true,
      expectedRegionIds: context.ingestion.regions.map(region => region.id),
    });
    const validation = validateEmbroideryObjectProposalPlan(
      context.plan,
      context.ingestion.regions,
      context.ingestion.graph,
      semanticResult,
    );

    expect(normalized.valid).toBe(false);
    expect(normalized.errors.map(error => error.code))
      .toContain('INCONSISTENT_SEMANTIC_RESULT_REPRESENTATIONS');
    expect(validation.valid).toBe(false);
  });

  it.each([
    ['both', () => {}],
    ['byRegionId only', semanticResult => { delete semanticResult.assessments; }],
    ['assessments only', semanticResult => { delete semanticResult.byRegionId; }],
  ])('accepts valid %s semantics with reused resolved configuration', (_name, select) => {
    const context = planningContext('C8');
    const semanticResult = structuredClone(context.semanticResult);
    select(semanticResult);

    const normalized = normalizeCanonicalSemanticResult(semanticResult, {
      strict: true,
      expectedRegionIds: context.ingestion.regions.map(region => region.id),
    });
    const rebuilt = buildPlanWithSemanticResult(context, semanticResult);

    expect(normalized.valid).toBe(true);
    expect(rebuilt.valid).toBe(true);
    expect(rebuilt.hatchOverlapDependencyContract).toMatchObject({
      version: expect.any(String),
      fingerprint: expect.any(String),
    });
    expect(rebuilt.hatchOverlapIntegrationMarker.active).toBe(true);
  });
});

describe('Hatch C1-R5 semantic evidence closure', () => {
  it.each([
    ['assessments as the only semantic source', true],
    ['duplicated assessments with valid byRegionId', false],
  ])('blocks duplicated regionId with %s', (_name, assessmentsOnly) => {
    const context = planningContext('C8');
    const semanticResult = structuredClone(context.semanticResult);
    const outlineId = outlineSemanticId(semanticResult);
    const outlineAssessment = semanticResult.assessments
      .find(assessment => assessment.regionId === outlineId);
    semanticResult.assessments.push(structuredClone(outlineAssessment));
    if (assessmentsOnly) delete semanticResult.byRegionId;

    const normalized = normalizeCanonicalSemanticResult(semanticResult, {
      strict: true,
      expectedRegionIds: context.ingestion.regions.map(region => region.id),
    });
    const validation = validateEmbroideryObjectProposalPlan(
      context.plan,
      context.ingestion.regions,
      context.ingestion.graph,
      semanticResult,
    );
    const chain = invalidSemanticChain(context, semanticResult);
    const duplicateCode = 'DUPLICATE_SEMANTIC_ASSESSMENT_REGION_ID';

    expect(normalized.valid).toBe(false);
    expect(normalized.errors.map(error => error.code)).toContain(duplicateCode);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map(error => error.code)).toContain(duplicateCode);
    expect(chain.proposalPlan.valid).toBe(false);
    expect(chain.proposalPlan.errors.map(error => error.code)).toContain(duplicateCode);
    expect(chain.proposalPlan.hatchOverlapDependencyContract).toBeNull();
    expect(chain.proposalPlan.hatchOverlapIntegrationMarker.active).toBe(true);
    expect(chain.proposalPlan.hatchOverlapTrace).toMatchObject({
      status: 'blocked',
      applied: false,
      evaluatorInvoked: true,
    });
    expect(chain.review.summary.acceptedDecisionCount).toBe(0);
    expect(chain.drafts.drafts).toHaveLength(0);
    expect(chain.objects.objects).toHaveLength(0);
    expect(chain.technical.specifications).toHaveLength(0);
    expect(chain.sequence.executionSteps).toHaveLength(0);
    expect(chain.physical.objectPaths).toHaveLength(0);
    expect(chain.physical.summary.physicalPointCount).toBe(0);
    expect(chain.canonical.commands).toHaveLength(0);
  });
});

describe('Hatch C1-R1 atomic direct consumers', () => {
  it.each([
    ['required dependency absent', plan => {
      plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline').dependencyIds = [];
    }, 'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING'],
    ['unknown dependency', plan => {
      plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline').dependencyIds.push('proposal:unknown');
    }, 'CONTOUR_LAST_UNKNOWN_DEPENDENCY'],
  ])('produces no partial output for %s', (_name, mutate, expectedCode) => {
    const result = invalidDirectChain(planningContext('C8'), mutate);

    expect(result.review.errors.map(error => error.code)).toContain(expectedCode);
    expect(result.review.summary.acceptedDecisionCount).toBe(0);
    expect(result.review.decisions).toHaveLength(0);
    expect(result.drafts.valid).toBe(false);
    expect(result.drafts.drafts).toHaveLength(0);
    expect(result.objects.valid).toBe(false);
    expect(result.objects.objects).toHaveLength(0);
    expect(result.technical.valid).toBe(false);
    expect(result.technical.specifications).toHaveLength(0);
    expect(result.sequence.valid).toBe(false);
    expect(result.sequence.executionSteps).toHaveLength(0);
    expect(result.physical.valid).toBe(false);
    expect(result.physical.objectPaths).toHaveLength(0);
    expect(result.physical.summary.physicalPointCount).toBe(0);
    expect(result.canonical.valid).toBe(false);
    expect(result.canonical.commands).toHaveLength(0);
    if (expectedCode === 'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING') {
      [
        result.review,
        result.drafts,
        result.objects,
        result.technical,
        result.sequence,
        result.physical,
        result.canonical,
      ].forEach(stage => {
        const rootCause = stage.errors.find(error => error.code === expectedCode);
        expect(rootCause?.evidence).toMatchObject({
          contourProposalId: expect.any(String),
          requiredDependencyId: expect.any(String),
          contractFingerprint: expect.any(String),
        });
      });
    }
  });
});

describe('Hatch C1-R3 flat causal error propagation', () => {
  it('keeps the missing dependency cause singular, flat, deterministic and linearly bounded', () => {
    const mutate = plan => {
      plan.proposals
        .find(item => item.proposedEmbroideryRole === 'outer_outline')
        .dependencyIds = [];
    };
    const first = invalidDirectChain(planningContext('C8'), mutate);
    const second = invalidDirectChain(planningContext('C8'), mutate);
    const names = ['review', 'drafts', 'objects', 'technical', 'sequence', 'physical', 'canonical'];
    const probe = names.map(name => {
      const result = first[name];
      const serialized = JSON.stringify(result);
      const root = result.errors
        .find(error => error.code === 'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING');
      return {
        name,
        result,
        root,
        errorCount: result.errors.length,
        causalOccurrences: countOccurrences(
          serialized,
          'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING',
        ),
        serializedErrorSize: JSON.stringify(result.errors).length,
        acceptedOutputCount: acceptedOutputCount(name, result),
      };
    });
    probe.forEach((stage, index) => {
      expect(stage.causalOccurrences).toBe(1);
      expect(stage.root).toBeDefined();
      expect(countOccurrences(
        JSON.stringify(stage.result),
        JSON.stringify(stage.root.evidence),
      )).toBe(1);
      expect(stage.result.errors.some(error =>
        containsUpstreamErrorTree(error.evidence))).toBe(false);
      expect(stage.acceptedOutputCount).toBe(0);
      expect(second[stage.name].errors).toEqual(stage.result.errors);
      expect(JSON.stringify(second[stage.name].errors))
        .toBe(JSON.stringify(stage.result.errors));

      const wrappers = stage.result.errors.filter(error =>
        error.code.startsWith('INVALID_') && error.code.endsWith('_UPSTREAM'));
      expect(wrappers).toHaveLength(index + 1);
      expect(new Set(wrappers.map(error => error.evidence.stage)).size)
        .toBe(wrappers.length);
      wrappers.forEach(error => {
        expect(error.evidence).toMatchObject({
          kind: 'engine_v2_error_reference',
          stage: expect.any(String),
        });
        expect(Array.isArray(error.evidence)).toBe(false);
      });
    });

    expect(first.review.decisions).toHaveLength(0);
    expect(first.drafts.decisions).toHaveLength(0);
    expect(first.drafts.drafts).toHaveLength(0);
    expect(first.objects.objects).toHaveLength(0);
    expect(first.technical.specifications).toHaveLength(0);
    expect(first.sequence.executionSteps).toHaveLength(0);
    expect(first.physical.objectPaths).toHaveLength(0);
    expect(first.physical.summary.physicalPointCount).toBe(0);
    expect(first.canonical.commands).toHaveLength(0);

    const baseErrorCount = probe[0].errorCount;
    probe.forEach((stage, index) => {
      expect(stage.errorCount).toBe(baseErrorCount + index);
      if (!index) return;
      expect(stage.serializedErrorSize)
        .toBeGreaterThan(probe[index - 1].serializedErrorSize);
      expect(stage.serializedErrorSize - probe[index - 1].serializedErrorSize)
        .toBeLessThanOrEqual(600);
    });
  });

  it('is idempotent when the same transition propagates the same failure twice', () => {
    const root = {
      code: 'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING',
      path: 'proposals.outline.dependencyIds',
      message: 'Required contour dependency is missing.',
      evidence: { contourProposalId: 'outline', requiredDependencyId: 'fill' },
    };
    const wrapper = {
      code: 'INVALID_PROPOSAL_PLAN_UPSTREAM',
      path: 'plan.valid',
      message: 'Proposal review requires a valid proposal plan.',
    };
    const once = propagateFlatErrors({
      upstreamErrors: [root],
      stage: 'proposal_review',
      wrapper,
    });
    const twice = propagateFlatErrors({
      upstreamErrors: once,
      stage: 'proposal_review',
      wrapper,
    });

    expect(twice).toEqual(once);
    expect(countOccurrences(
      JSON.stringify(twice),
      'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING',
    )).toBe(1);
  });
});

describe('Hatch C1-R1 conservative multi-contour policy', () => {
  it('blocks two contours claiming the same fill and clears applied on every evaluation', () => {
    const result = structuralCase([
      proposal({ id: 'fill', role: 'base_fill' }),
      proposal({ id: 'outline-a', role: 'outer_outline' }),
      proposal({ id: 'outline-b', role: 'outer_outline' }),
    ]);

    expect(result.guarded.errors.map(error => error.code))
      .toContain('CONTOUR_LAST_MULTIPLE_CONTOUR_ASSOCIATION_AMBIGUOUS');
    expect(result.guarded.trace.applied).toBe(false);
    expect(result.guarded.trace.evaluations.every(evaluation => evaluation.applied === false)).toBe(true);
    expect(result.guarded.trace.evaluations.every(evaluation => evaluation.individuallySatisfied === true)).toBe(true);
    expect(result.guarded.trace.transaction.partialOutputAllowed).toBe(false);
  });

  it('does not leave applied=true in a valid component when another component is ambiguous', () => {
    const result = structuralCase([
      proposal({ id: 'fill-valid', role: 'base_fill', componentId: 'component-valid' }),
      proposal({ id: 'outline-valid', role: 'outer_outline', componentId: 'component-valid' }),
      proposal({ id: 'fill-ambiguous', role: 'base_fill', componentId: 'component-ambiguous' }),
      proposal({ id: 'outline-ambiguous-a', role: 'outer_outline', componentId: 'component-ambiguous' }),
      proposal({ id: 'outline-ambiguous-b', role: 'outer_outline', componentId: 'component-ambiguous' }),
    ]);

    const validEvaluation = result.guarded.trace.evaluations
      .find(evaluation => evaluation.proposalId === 'outline-valid');
    expect(validEvaluation).toMatchObject({
      individuallySatisfied: true,
      associationAmbiguous: false,
      applied: false,
    });
    expect(result.guarded.trace.evaluations.every(evaluation => evaluation.applied === false)).toBe(true);
  });

  it('accepts accredited inner and outer associations without claiming exact general geometry', () => {
    const result = structuralCase([
      proposal({ id: 'fill-outer', role: 'base_fill' }),
      proposal({ id: 'fill-inner', role: 'foreground_fill' }),
      proposal({
        id: 'outline-outer',
        role: 'outer_outline',
        explicitDependencyIds: ['fill-outer'],
      }),
      proposal({
        id: 'outline-inner',
        role: 'inner_outline',
        explicitDependencyIds: ['fill-inner'],
      }),
    ]);

    expect(result.guarded.trace).toMatchObject({
      status: 'validated',
      applied: true,
      exactGeometricAssociation: false,
    });
    expect(result.guarded.trace.evaluations.every(evaluation =>
      evaluation.associationDisambiguated
      && evaluation.exactGeometricAssociation === false
      && evaluation.applied)).toBe(true);
  });

  it('keeps contours in disconnected components independent', () => {
    const result = structuralCase([
      proposal({ id: 'fill-a', role: 'base_fill', componentId: 'component-a' }),
      proposal({ id: 'outline-a', role: 'outer_outline', componentId: 'component-a' }),
      proposal({ id: 'fill-b', role: 'base_fill', componentId: 'component-b' }),
      proposal({ id: 'outline-b', role: 'outer_outline', componentId: 'component-b' }),
    ]);

    expect(result.guarded.trace).toMatchObject({
      status: 'validated',
      applied: true,
      evaluationCount: 2,
    });
    expect(result.guarded.trace.evaluations.every(evaluation => evaluation.applied)).toBe(true);
  });
});
