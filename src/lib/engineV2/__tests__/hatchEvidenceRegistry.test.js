import { describe, expect, it } from 'vitest';
import {
  COLOR_GROUP_HEURISTIC_RULE_ID,
  CONTOUR_LAST_RULE_ID,
  MULTILAYER_DEPENDENCY_RULE_ID,
  DEFAULT_HATCH_EVIDENCE_PROFILE,
  DEFAULT_HATCH_EVIDENCE_RULE_FLAGS,
  HATCH_EVIDENCE_CONTEXT_FIELDS,
  HATCH_EVIDENCE_CAPABILITY_CLAIMS,
  HATCH_EVIDENCE_PHASE_ALIASES,
  HATCH_EVIDENCE_PHASES,
  HATCH_EVIDENCE_REGISTRY,
  HATCH_EVIDENCE_RULE_IDS,
  HATCH_EVIDENCE_RULES,
  HATCH_G_LETTERING_EVIDENCE,
  HATCH_MASTER_A_F_EVIDENCE_SOURCE,
  HATCH_MASTER_A_G_EVIDENCE_SOURCE,
  HATCH_MASTER_EVIDENCE_SOURCE,
  HATCH_OVERLAP_RULE_IDS,
  getHatchEvidenceRules,
  resolveHatchEvidencePhaseAlias,
  resolveHatchEvidenceIntegrationConfig,
  validateHatchGLetteringEvidence,
  validateHatchEvidenceIntegrationConfig,
  validateHatchEvidenceRegistry,
} from '../rules/hatchEvidence/index.js';
import { defineHatchGLetteringEvidence } from '../rules/hatchEvidence/lettering.js';
import {
  resolveObjectPlanningConfig,
  validateObjectPlanningConfig,
} from '../planning/planningConfig.js';
import {
  HATCH_EVIDENCE_ACTIVATION_MODES,
  HATCH_EVIDENCE_CONTROLLED_OPT_IN_MODE,
  HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY,
  canonicalizeHatchEvidenceControlledFallbackReasonCodes,
  resolveHatchEvidenceControlledOptInPolicy,
} from '../rules/hatchEvidence/profiles.js';

const phaseCounts = Object.freeze({
  A_Anchuras: 5,
  B_Huecos: 6,
  C_Solapes: 8,
  'D_Técnicas': 6,
  E_Telas: 6,
  F_Escalado: 6,
});

const SATIN_RANGE = 'SATIN-RANGE-OBSERVED-001';
const LOCAL_WIDTH = 'LOCAL-WIDTH-PROFILE-001';
const HOLE_PRESERVE = 'HOLE-PRESERVE-001';
const HOLE_MIN_SIZE = 'HOLE-MIN-SIZE-001';

const expectedRuleIds = Object.freeze([
  'SATIN-RANGE-OBSERVED-001',
  'LOCAL-WIDTH-PROFILE-001',
  'UNDERLAY-GEOMETRY-001',
  'SPACING-GEOMETRY-001',
  'PULL-COMP-COTTON-040-001',
  'HOLE-PRESERVE-001',
  'HOLE-MIN-SIZE-001',
  'ISLAND-SPLIT-001',
  'BRIDGE-MIN-001',
  'DISCONNECTED-ISLANDS-001',
  'COMPOUND-SPLIT-001',
  'OVERLAP-CUTOUT-001',
  'SPLIT-OCCLUDED-001',
  'SAME-COLOR-UNION-001',
  'WHITE-FABRIC-001',
  'CONTOUR-LAST-001',
  'ADJACENT-UNDERLAP-001',
  'COLOR-GROUP-HEURISTIC-001',
  'MULTILAYER-DEPENDENCY-001',
  'TECHNIQUE-TATAMI-UNDERLAY-CONTROL-001',
  'TECHNIQUE-SATIN-WIDE-DIVISION-001',
  'TECHNIQUE-UNDULATING-SEPARATE-001',
  'TECHNIQUE-RUNNING-PASS-COUNT-001',
  'TECHNIQUE-ZIGZAG-TOP-STITCH-001',
  'TECHNIQUE-BOUNDARY-PAIR-001',
  'E-FAB-001',
  'E-FAB-002',
  'E-FAB-003',
  'E-FAB-004',
  'E-FAB-005',
  'E-FAB-006',
  'F-R01',
  'F-R02',
  'F-R03',
  'F-R04',
  'F-R05',
  'F-R06',
]);

const expectedPhaseArtifactHashes = Object.freeze({
  A_Anchuras: 'af0f84318ed59b5979827ca0ed8f188472b511c1408fc25f1a8c7d6d5833d698',
  B_Huecos: 'a0fa1078e833852e6a7a5f6a67114f40da3ac4c9c7bc35491deceb6a3d2fc669',
  C_Solapes: '38255ab102e38cb66612d745da8e8a8073187466abbbf887cf313e5333d6e377',
  'D_Técnicas': 'a33c4b46d35250b2bae1d4b501abe40b631fd1cd5b89c8926a794df7e4664aef',
  E_Telas: 'f9784669e394a8767974c5c2e50a97a04a5f49fb9641a1582efb62b254f159cc',
  F_Escalado: '3d5c6cc7fd3f8f3aeb251736fe0c0e6cf86b25ca3d17a65637ccc6a6c6194e0f',
});

const expectedSelectionOrder = Object.freeze([
  'requested_style',
  'target_height_mm',
  'case_and_character_set',
  'compatible_alphabet',
  'construction_strategy',
  'manual_review_if_no_valid_combination',
]);

const expectedGlobalRules = Object.freeze([
  'Hatch generation success is not proof that a height is valid.',
  'Hatch does not substitute another alphabet when a lettering object is scaled outside its natural range.',
  'Nominal height is not interchangeable with generated glyph height.',
  'Uppercase, lowercase, descenders and diacritics must be evaluated separately.',
  'Every result below its safe minimum requires manual review until physical validation is complete.',
]);

const expectedFamilies = Object.freeze({
  block: {
    primaryAlphabet: 'Small Block1',
    alternativeAlphabet: 'Small Block2',
    naturalRangeMm: [4, 6],
    uppercase: { conditionalMinimumMm: 4, recommendedMinimumMm: 5 },
    mixedCase: { conditionalMinimumMm: 4, recommendedMinimumMm: 5 },
    observedTechnique: 'satin',
    observedTechniqueRangeMm: [3, 12],
    automaticAlphabetOrTechniqueSubstitutionObserved: false,
  },
  serif: {
    primaryAlphabet: 'Small Serif1',
    naturalRangeMm: [4, 6],
    uppercase: { conditionalMinimumMm: 4, recommendedMinimumMm: 5, preferredMm: 6 },
    mixedCase: { conditionalMinimumMm: 5, recommendedMinimumMm: 6, preferredMm: 8 },
    observedTechnique: 'satin',
    underlayTransition: {
      fromMm: 8,
      lowerRange: 'center run',
      upperRange: 'edge run plus zigzag',
    },
  },
  script: {
    primaryAlphabet: 'Sm Script',
    naturalRangeMm: [4, 6],
    word: { conditionalMinimumMm: 5, recommendedMinimumMm: 6, preferredMm: 8 },
    lowercaseAccents: {
      conditionalMinimumMm: 5,
      recommendedMinimumMm: 6,
      preferredMm: 8,
      testedCharacters: 'áéíóúüñ',
    },
    observedTechnique: 'satin',
    observedTechniqueRangeMm: [5, 12],
    diacriticCost: {
      comparison: 'R02-SCRIPT-ACCENTS versus R02-SCRIPT-WORD',
      stitchIncreasePercent: 67.9,
      trimIncreasePercent: 100.0,
      manualReviewForDisconnectedMarks: true,
    },
  },
});

const expectedAutomaticSettings = Object.freeze({
  stitch: 'satin',
  spacing: 'automatic',
  pullCompensationMm: 0.2,
  connectorJumpMm: 7.0,
  initialTie: 'off',
  finalTie: 'always-method-1-1mm-x2',
  trimWhenNextConnectorAtLeastMm: 2.0,
});

const expectedBlockedActions = Object.freeze([
  'Do not modify Base44.',
  'Do not connect these rules to the production engine.',
  'Do not treat digitally accepted minimums as physically validated.',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function expectDeeplyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(expectDeeplyFrozen);
}

function activeConfig(ruleId, context) {
  return {
    hatchEvidenceProfile: 'hatch-a-f-experimental',
    hatchEvidenceRuleFlags: { [ruleId]: true },
    ...(context === undefined ? {} : { hatchEvidenceContext: context }),
  };
}

function controlledConfig(ruleIds = [], overrides = {}) {
  return {
    hatchEvidenceProfile: 'hatch-a-f-experimental',
    hatchEvidenceActivationMode: 'controlled-opt-in',
    hatchEvidenceRuleFlags: Object.fromEntries(ruleIds.map(ruleId => [ruleId, true])),
    hatchEvidenceContext: {
      fabricProfile: 'Pure Cotton',
      referenceScaleCompatible: true,
    },
    ...overrides,
  };
}

function registryWithControlledPolicy(controlledOptInPolicy) {
  return Object.freeze({
    ...HATCH_EVIDENCE_REGISTRY,
    activeIntegration: Object.freeze({
      ...HATCH_EVIDENCE_REGISTRY.activeIntegration,
      controlledOptInPolicy,
    }),
  });
}

function controlledPolicyCopy(overrides = {}) {
  return freezeDeep({
    ...clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY),
    ...overrides,
  });
}

const CONTROLLED_POLICY_ARRAY_FIELDS = Object.freeze([
  'operationalRuleIds',
  'diagnosticRuleIds',
  'mutuallyExclusiveOperationalRuleIds',
]);

function freezePolicyArrays(policy, mutableField = null) {
  CONTROLLED_POLICY_ARRAY_FIELDS.forEach(field => {
    if (field !== mutableField && Array.isArray(policy[field])) Object.freeze(policy[field]);
  });
  return policy;
}

function policyWithArray(field, value) {
  const policy = clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
  policy[field] = value;
  freezePolicyArrays(policy);
  return Object.freeze(policy);
}

function policyWithAccessor(field, descriptor) {
  const policy = clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
  delete policy[field];
  freezePolicyArrays(policy);
  Object.defineProperty(policy, field, {
    enumerable: true,
    configurable: true,
    ...descriptor,
  });
  return Object.freeze(policy);
}

function expectControlledPolicyInvalid(policy) {
  let result;
  expect(() => {
    result = validateHatchEvidenceRegistry(registryWithControlledPolicy(policy));
  }).not.toThrow();
  expect(result).toEqual({
    valid: false,
    errors: [{ code: 'HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY_INVALID' }],
    warnings: [],
  });
}

describe('Hatch A-G evidence registry', () => {
  it('preserves A-F provenance and binds the current A-G master authority', () => {
    expect(HATCH_MASTER_EVIDENCE_SOURCE).toBe(HATCH_MASTER_A_F_EVIDENCE_SOURCE);
    expect(HATCH_MASTER_A_F_EVIDENCE_SOURCE).toEqual({
      packageName: 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F.zip',
      packageSha256: 'd2ca1f36db18a6d48fe8d471f66d4cf1f96e2804ca65979d57752e97812bf8e3',
      packageByteLength: 320891578,
      capturedAt: '2026-07-24',
    });
    expect(HATCH_MASTER_A_G_EVIDENCE_SOURCE).toEqual({
      packageName: 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_G.zip',
      packageSha256: '9cc0c06372ed371716d50915d26c5625f5e40ba0165ee52c38ecae51dff3b96f',
      packageByteLength: 486734439,
      updated: '2026-07-25',
      productionIntegration: false,
      base44OriginalModified: false,
    });
    expect(HATCH_MASTER_A_G_EVIDENCE_SOURCE.packageName).not.toContain('(1)');
    expect(HATCH_EVIDENCE_REGISTRY.source).toBe(HATCH_MASTER_A_G_EVIDENCE_SOURCE);
    expect(HATCH_EVIDENCE_REGISTRY.historicalSources).toEqual([HATCH_MASTER_A_F_EVIDENCE_SOURCE]);
  });

  it('keeps all 37 A-F rules unique and in their historical order', () => {
    expect(HATCH_EVIDENCE_RULES).toHaveLength(37);
    expect(new Set(HATCH_EVIDENCE_RULES.map(rule => rule.id)).size).toBe(37);
    expect(HATCH_EVIDENCE_RULES.map(rule => rule.id)).toEqual(expectedRuleIds);
    expect(Object.keys(HATCH_EVIDENCE_REGISTRY.byId)).toEqual(expectedRuleIds);
    expect(Object.values(HATCH_EVIDENCE_REGISTRY.byId)).toEqual(HATCH_EVIDENCE_RULES);
    expect(Object.hasOwn(HATCH_EVIDENCE_REGISTRY.byId, 'G_Lettering')).toBe(false);
  });

  it('preserves every A-F phase artifact hash exactly', () => {
    Object.entries(expectedPhaseArtifactHashes).forEach(([phase, artifactSha256]) => {
      expect(new Set(getHatchEvidenceRules({ phase }).map(rule => rule.source.artifactSha256)))
        .toEqual(new Set([artifactSha256]));
    });
  });

  it.each(Object.entries(phaseCounts))('registers the closed %s package without loss', (phase, count) => {
    expect(getHatchEvidenceRules({ phase })).toHaveLength(count);
  });

  it('records every required traceability field', () => {
    HATCH_EVIDENCE_RULES.forEach(rule => {
      expect(rule).toHaveProperty('id');
      expect(rule).toHaveProperty('phase');
      expect(rule).toHaveProperty('source');
      expect(rule).toHaveProperty('condition');
      expect(rule).toHaveProperty('candidateAction');
      expect(rule).toHaveProperty('confidence');
      expect(rule).toHaveProperty('limits');
      expect(rule).toHaveProperty('state', 'candidate');
      expect(rule).toHaveProperty('notes');
      expect(rule.source.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  it('activates only the four implemented A/B candidate rules', () => {
    expect(getHatchEvidenceRules({ profile: 'hatch-a-f-experimental' }).map(rule => rule.id)).toEqual([
      'SATIN-RANGE-OBSERVED-001',
      'LOCAL-WIDTH-PROFILE-001',
      'HOLE-PRESERVE-001',
      'HOLE-MIN-SIZE-001',
    ]);
    expect(HATCH_EVIDENCE_RULE_IDS).toEqual([
      'SATIN-RANGE-OBSERVED-001',
      'LOCAL-WIDTH-PROFILE-001',
      'HOLE-PRESERVE-001',
      'HOLE-MIN-SIZE-001',
    ]);
    expect(DEFAULT_HATCH_EVIDENCE_RULE_FLAGS).toEqual(Object.fromEntries(HATCH_EVIDENCE_RULE_IDS.map(ruleId => [ruleId, false])));
    expect(HATCH_EVIDENCE_REGISTRY.activeIntegration).toMatchObject({
      independentlyConfigurable: true,
      defaultEnabled: false,
    });
  });

  it('keeps only C1, C2 and C3 partially integrated in C while D-G remain inactive', () => {
    const cRules = HATCH_EVIDENCE_RULES.filter(rule => rule.phase === 'C_Solapes');
    expect(HATCH_OVERLAP_RULE_IDS).toEqual([
      CONTOUR_LAST_RULE_ID,
      COLOR_GROUP_HEURISTIC_RULE_ID,
      MULTILAYER_DEPENDENCY_RULE_ID,
    ]);
    HATCH_OVERLAP_RULE_IDS.forEach(ruleId => expect(
      cRules.find(rule => rule.id === ruleId).activatedInProfiles,
    ).toEqual(['hatch-c-experimental']));
    expect(cRules.filter(rule => !HATCH_OVERLAP_RULE_IDS.includes(rule.id))
      .every(rule => rule.activatedInProfiles.length === 0)).toBe(true);
    expect(HATCH_EVIDENCE_RULES.filter(rule => ['D_Técnicas', 'E_Telas', 'F_Escalado'].includes(rule.phase))
      .every(rule => rule.activatedInProfiles.length === 0)).toBe(true);
    expect(HATCH_EVIDENCE_REGISTRY.inactivePhases).toEqual([
      'D_Técnicas',
      'E_Telas',
      'F_Escalado',
      'G_Lettering',
    ]);
    expect(HATCH_EVIDENCE_REGISTRY.letteringIncluded).toBe(true);
    expect(HATCH_EVIDENCE_REGISTRY.productionIntegration).toBe(false);
    expect(HATCH_EVIDENCE_REGISTRY.reviewedClosedOverlapAudit).toMatchObject({ phaseRemainsClosed: true, technicalDataModified: false });
  });

  it('registers G as separate structured evidence without flat rules or IDs', () => {
    expect(HATCH_EVIDENCE_PHASES).toEqual([
      'A_Anchuras',
      'B_Huecos',
      'C_Solapes',
      'D_Técnicas',
      'E_Telas',
      'F_Escalado',
      'G_Lettering',
    ]);
    expect(HATCH_EVIDENCE_REGISTRY.letteringEvidence).toBe(HATCH_G_LETTERING_EVIDENCE);
    expect(getHatchEvidenceRules({ phase: 'G_Lettering' })).toEqual([]);
    expect(HATCH_EVIDENCE_RULES).toHaveLength(37);
    expect(HATCH_G_LETTERING_EVIDENCE).not.toHaveProperty('id');
    expect(HATCH_G_LETTERING_EVIDENCE).not.toHaveProperty('rules');
    expect(JSON.stringify(HATCH_G_LETTERING_EVIDENCE)).not.toContain('"id":');
    expect(JSON.stringify(HATCH_G_LETTERING_EVIDENCE)).not.toContain('"rules":');
  });

  it('preserves the exact G source, status and structured lettering content', () => {
    expect(HATCH_G_LETTERING_EVIDENCE).toMatchObject({
      schema: 'stitchpath-hatch-lettering-candidates-r1',
      phase: 'G_Lettering',
      sourcePhase: 'G',
      source: {
        ...HATCH_MASTER_A_G_EVIDENCE_SOURCE,
        artifactPath: '07_LETTERING/06_Reglas/HATCH-G-LETTERING-reglas-candidatas.json',
        artifactSha256: '94e84eeb4756d1274b037911a3daa83e1e6532e2895e409d64752ad4556d635e',
      },
      status: 'closed-digital-pending-physical-validation',
      productionIntegration: false,
      activatedInProfiles: [],
      fabric: 'Pure Cotton',
    });
    expect(HATCH_G_LETTERING_EVIDENCE.selectionOrder).toEqual(expectedSelectionOrder);
    expect(HATCH_G_LETTERING_EVIDENCE.globalRules).toEqual(expectedGlobalRules);
    expect(HATCH_G_LETTERING_EVIDENCE.families).toEqual(expectedFamilies);
    expect(HATCH_G_LETTERING_EVIDENCE.defaultAutomaticSettingsObserved).toEqual(expectedAutomaticSettings);
    expect(HATCH_G_LETTERING_EVIDENCE.blockedActions).toEqual(expectedBlockedActions);
  });

  it('deeply clones and freezes the complete G evidence graph', () => {
    const input = clone(HATCH_G_LETTERING_EVIDENCE);
    const defined = defineHatchGLetteringEvidence(input);
    expect(defined).toEqual(HATCH_G_LETTERING_EVIDENCE);
    expect(defined).not.toBe(input);
    expect(defined.source).not.toBe(input.source);
    expect(defined.selectionOrder).not.toBe(input.selectionOrder);
    expect(defined.families).not.toBe(input.families);
    expect(defined.families.script.diacriticCost).not.toBe(input.families.script.diacriticCost);
    input.selectionOrder[0] = 'mutated';
    input.families.block.naturalRangeMm[0] = -1;
    expect(defined.selectionOrder[0]).toBe('requested_style');
    expect(defined.families.block.naturalRangeMm).toEqual([4, 6]);
    expectDeeplyFrozen(defined);
    expectDeeplyFrozen(HATCH_G_LETTERING_EVIDENCE);
  });

  it('uses only the four exact query aliases without duplicating phases or rules', () => {
    expect(HATCH_EVIDENCE_PHASE_ALIASES).toEqual({
      D_Tecnicas: 'D_Técnicas',
      'D_Técnicas': 'D_Técnicas',
      E_Tejidos: 'E_Telas',
      E_Telas: 'E_Telas',
    });
    expect(resolveHatchEvidencePhaseAlias('D_Tecnicas')).toBe('D_Técnicas');
    expect(resolveHatchEvidencePhaseAlias('D_Técnicas')).toBe('D_Técnicas');
    expect(resolveHatchEvidencePhaseAlias('E_Tejidos')).toBe('E_Telas');
    expect(resolveHatchEvidencePhaseAlias('E_Telas')).toBe('E_Telas');
    expect(getHatchEvidenceRules({ phase: 'D_Tecnicas' })).toEqual(getHatchEvidenceRules({ phase: 'D_Técnicas' }));
    expect(getHatchEvidenceRules({ phase: 'E_Tejidos' })).toEqual(getHatchEvidenceRules({ phase: 'E_Telas' }));
    expect(resolveHatchEvidencePhaseAlias('d_tecnicas')).toBe('d_tecnicas');
    expect(resolveHatchEvidencePhaseAlias('E-Tejidos')).toBe('E-Tejidos');
    expect(getHatchEvidenceRules({ phase: 'd_tecnicas' })).toEqual([]);
    expect(new Set(HATCH_EVIDENCE_PHASES).size).toBe(HATCH_EVIDENCE_PHASES.length);
    expect(HATCH_EVIDENCE_RULES).toHaveLength(37);
  });

  it('keeps every current A/B/C rule flag exactly OFF', () => {
    expect(DEFAULT_HATCH_EVIDENCE_RULE_FLAGS)
      .toEqual(Object.fromEntries(HATCH_EVIDENCE_RULE_IDS.map(ruleId => [ruleId, false])));
    expect(HATCH_EVIDENCE_REGISTRY.partialIntegrations[0].defaultRuleFlags)
      .toEqual(Object.fromEntries(HATCH_OVERLAP_RULE_IDS.map(ruleId => [ruleId, false])));
    expect(HATCH_G_LETTERING_EVIDENCE.activatedInProfiles).toEqual([]);
  });

  it('integrates the immutable capability claims without changing rules or G separation', () => {
    expect(HATCH_EVIDENCE_REGISTRY.capabilityClaims).toBe(HATCH_EVIDENCE_CAPABILITY_CLAIMS);
    expect(HATCH_EVIDENCE_REGISTRY.capabilityClaims).toMatchObject({
      version: 'engine-v2-hatch-capability-claims-r1',
      productionIntegration: false,
    });
    expect(HATCH_EVIDENCE_REGISTRY.capabilityClaims.rulesAF.map(claim => claim.ruleId))
      .toEqual(HATCH_EVIDENCE_RULES.map(rule => rule.id));
    expect(HATCH_EVIDENCE_REGISTRY.capabilityClaims.letteringG).toHaveLength(12);
    expect(HATCH_EVIDENCE_REGISTRY.capabilityClaims.letteringG
      .every(claim => claim.phase === 'G_Lettering'
        && claim.activatedInProfiles.length === 0)).toBe(true);
    expect(Object.keys(HATCH_EVIDENCE_REGISTRY.byId))
      .not.toContain(HATCH_EVIDENCE_REGISTRY.capabilityClaims.letteringG[0].claimId);
  });

  it.each([
    ['schema', value => { value.schema = 'future'; }, 'HATCH_G_EVIDENCE_SCHEMA_INVALID'],
    ['phase', value => { value.phase = 'G'; }, 'HATCH_G_EVIDENCE_PHASE_INVALID'],
    ['master source', value => { value.source.packageSha256 = '0'.repeat(64); }, 'HATCH_G_EVIDENCE_SOURCE_INVALID'],
    ['artifact path', value => { value.source.artifactPath = 'future.json'; }, 'HATCH_G_EVIDENCE_ARTIFACT_PATH_INVALID'],
    ['artifact hash', value => { value.source.artifactSha256 = '0'.repeat(64); }, 'HATCH_G_EVIDENCE_ARTIFACT_HASH_INVALID'],
    ['status', value => { value.status = 'closed'; }, 'HATCH_G_EVIDENCE_STATUS_INVALID'],
    ['production integration', value => { value.productionIntegration = true; }, 'HATCH_G_EVIDENCE_PRODUCTION_INTEGRATION_FORBIDDEN'],
    ['profile activation', value => { value.activatedInProfiles = ['future']; }, 'HATCH_G_EVIDENCE_PROFILE_ACTIVATION_FORBIDDEN'],
    ['flat id', value => { value.id = 'G-001'; }, 'HATCH_G_EVIDENCE_FLAT_RULE_SHAPE_FORBIDDEN'],
    ['flat rules', value => { value.rules = []; }, 'HATCH_G_EVIDENCE_FLAT_RULE_SHAPE_FORBIDDEN'],
    ['selection cardinality', value => { value.selectionOrder.pop(); }, 'HATCH_G_EVIDENCE_SELECTION_ORDER_INVALID'],
    ['global rule cardinality', value => { value.globalRules.pop(); }, 'HATCH_G_EVIDENCE_GLOBAL_RULES_INVALID'],
    ['family set', value => { value.families.future = {}; }, 'HATCH_G_EVIDENCE_FAMILIES_INVALID'],
    ['nested range', value => { value.families.block.naturalRangeMm = [3, 6]; }, 'HATCH_G_EVIDENCE_CONTENT_MISMATCH'],
  ])('rejects invalid G %s', (_label, mutate, expectedCode) => {
    const input = clone(HATCH_G_LETTERING_EVIDENCE);
    mutate(input);
    const invalid = defineHatchGLetteringEvidence(input);
    expect(validateHatchGLetteringEvidence(invalid).errors.map(error => error.code)).toContain(expectedCode);
  });

  it('validates the exact immutable G evidence', () => {
    expect(validateHatchGLetteringEvidence()).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('validates the complete registry', () => expect(validateHatchEvidenceRegistry()).toEqual({ valid: true, errors: [], warnings: [] }));
});

describe('Hatch evidence feature profile', () => {
  it('defaults exactly to legacy', () => {
    expect(DEFAULT_HATCH_EVIDENCE_PROFILE).toBe('legacy');
    expect(resolveHatchEvidenceIntegrationConfig()).toMatchObject({
      profile: 'legacy',
      ruleFlags: DEFAULT_HATCH_EVIDENCE_RULE_FLAGS,
      enabledRuleIds: [],
    });
  });

  it('resolves the opt-in experimental context', () => {
    expect(resolveHatchEvidenceIntegrationConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: { 'SATIN-RANGE-OBSERVED-001': true },
      hatchEvidenceContext: {
        fabricProfile: 'Pure Cotton',
        referenceScaleCompatible: true,
      },
    })).toEqual({
      profile: 'hatch-a-f-experimental',
      ruleFlags: {
        'SATIN-RANGE-OBSERVED-001': true,
        'LOCAL-WIDTH-PROFILE-001': false,
        'HOLE-PRESERVE-001': false,
        'HOLE-MIN-SIZE-001': false,
      },
      enabledRuleIds: ['SATIN-RANGE-OBSERVED-001'],
      context: {
        fabricProfile: 'Pure Cotton',
        referenceScaleCompatible: true,
      },
    });
  });

  it('keeps the Hatch context allowlist limited to fields consumed by evaluators', () => {
    expect(HATCH_EVIDENCE_CONTEXT_FIELDS).toEqual([
      'fabricProfile',
      'referenceScaleCompatible',
    ]);
  });

  it('rejects unknown profiles through both validators', () => {
    expect(validateHatchEvidenceIntegrationConfig({ hatchEvidenceProfile: 'future' }).valid).toBe(false);
    expect(validateObjectPlanningConfig({ hatchEvidenceProfile: 'future' }).errors.some(error => error.code === 'INVALID_HATCH_EVIDENCE_PROFILE')).toBe(true);
  });

  it('rejects unknown flags, non-boolean values and legacy enablement', () => {
    expect(validateHatchEvidenceIntegrationConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: { future: true },
    }).errors.map(error => error.code)).toContain('UNKNOWN_HATCH_EVIDENCE_RULE_FLAG');
    expect(validateHatchEvidenceIntegrationConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: { 'SATIN-RANGE-OBSERVED-001': 'yes' },
    }).errors.map(error => error.code)).toContain('INVALID_HATCH_EVIDENCE_RULE_FLAG_VALUE');
    expect(validateHatchEvidenceIntegrationConfig({
      hatchEvidenceProfile: 'legacy',
      hatchEvidenceRuleFlags: { 'SATIN-RANGE-OBSERVED-001': true },
    }).errors.map(error => error.code)).toContain('HATCH_EVIDENCE_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE');
  });

  it('keeps legacy and the experimental profile with every flag OFF free of context requirements', () => {
    expect(validateHatchEvidenceIntegrationConfig({ hatchEvidenceProfile: 'legacy' }).valid).toBe(true);
    expect(validateHatchEvidenceIntegrationConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: {},
    }).valid).toBe(true);
    expect(validateObjectPlanningConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: {},
    }).valid).toBe(true);
  });

  it('resolves raw and repeatedly reused planning configurations idempotently', () => {
    const raw = {
      extras: {
        hatchEvidenceProfile: 'legacy',
        hatchEvidenceRuleFlags: { [HOLE_MIN_SIZE]: true },
        hatchEvidenceContext: {
          fabricProfile: 'Pure Cotton',
          referenceScaleCompatible: true,
        },
        precedenceProbe: 'nested',
        nestedOnly: 1,
      },
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      precedenceProbe: 'top-level',
      topLevelOnly: 2,
    };
    const first = resolveObjectPlanningConfig(raw);
    const second = resolveObjectPlanningConfig(first);
    const third = resolveObjectPlanningConfig(second);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.extras).toMatchObject({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: { [HOLE_MIN_SIZE]: true },
      precedenceProbe: 'top-level',
      nestedOnly: 1,
      topLevelOnly: 2,
    });
    expect(first.extras).not.toHaveProperty('extras');
    expect(second.extras).not.toHaveProperty('extras');
    expect(third.extras).not.toHaveProperty('extras');
  });

  it('lets explicit invalid Hatch fields override nested values and remain validation errors', () => {
    const config = {
      hatchEvidenceProfile: 'future',
      extras: { hatchEvidenceProfile: 'hatch-a-f-experimental' },
    };
    expect(resolveObjectPlanningConfig(config).extras.hatchEvidenceProfile).toBe('future');
    expect(validateObjectPlanningConfig(config).errors.map(error => error.code))
      .toContain('INVALID_HATCH_EVIDENCE_PROFILE');
    expect(validateObjectPlanningConfig({ extras: null }).errors.map(error => error.code))
      .toContain('INVALID_OBJECT_PLANNING_EXTRAS');
  });

  it.each([
    [SATIN_RANGE, ['MISSING_HATCH_EVIDENCE_FABRIC', 'MISSING_HATCH_EVIDENCE_SCALE_COMPATIBILITY']],
    [LOCAL_WIDTH, ['MISSING_HATCH_EVIDENCE_FABRIC', 'MISSING_HATCH_EVIDENCE_SCALE_COMPATIBILITY']],
    [HOLE_PRESERVE, ['MISSING_HATCH_EVIDENCE_FABRIC']],
    [HOLE_MIN_SIZE, ['MISSING_HATCH_EVIDENCE_FABRIC', 'MISSING_HATCH_EVIDENCE_SCALE_COMPATIBILITY']],
  ])('rejects absent context for active %s with only its required fields', (ruleId, expectedCodes) => {
    const options = ruleId === SATIN_RANGE ? { technicalConfig: {} } : {};
    const codes = validateHatchEvidenceIntegrationConfig(activeConfig(ruleId), options).errors.map(error => error.code);
    expectedCodes.forEach(code => expect(codes).toContain(code));
  });

  it('requires only the context fields actually consumed by each active rule', () => {
    expect(validateHatchEvidenceIntegrationConfig(
      activeConfig(HOLE_PRESERVE, { fabricProfile: 'Pure Cotton' }),
    ).valid).toBe(true);
    expect(validateHatchEvidenceIntegrationConfig(
      activeConfig(HOLE_MIN_SIZE, { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true }),
    ).valid).toBe(true);
    expect(validateHatchEvidenceIntegrationConfig(
      activeConfig(LOCAL_WIDTH, { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true }),
    ).valid).toBe(true);
    expect(validateHatchEvidenceIntegrationConfig(
      activeConfig(SATIN_RANGE, { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true }),
      { technicalConfig: {} },
    ).valid).toBe(true);
  });

  it('rejects incomplete, unknown and invalidly typed Hatch context', () => {
    expect(validateHatchEvidenceIntegrationConfig(
      activeConfig(LOCAL_WIDTH, { fabricProfile: 'Pure Cotton' }),
    ).errors.map(error => error.code)).toContain('MISSING_HATCH_EVIDENCE_SCALE_COMPATIBILITY');
    expect(validateHatchEvidenceIntegrationConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: {},
      hatchEvidenceContext: { futureField: true },
    }).errors.map(error => error.code)).toContain('UNKNOWN_HATCH_EVIDENCE_CONTEXT_FIELD');
    expect(validateObjectPlanningConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: {},
      hatchEvidenceContext: { futureField: true },
    }).errors.map(error => error.code)).toContain('UNKNOWN_HATCH_EVIDENCE_CONTEXT_FIELD');
    expect(validateHatchEvidenceIntegrationConfig(
      activeConfig(HOLE_PRESERVE, { fabricProfile: 42 }),
    ).errors.map(error => error.code)).toContain('INVALID_HATCH_EVIDENCE_FABRIC');
    expect(validateHatchEvidenceIntegrationConfig(
      activeConfig(HOLE_MIN_SIZE, { fabricProfile: 'Pure Cotton', referenceScaleCompatible: 'yes' }),
    ).errors.map(error => error.code)).toContain('INVALID_HATCH_EVIDENCE_SCALE_COMPATIBILITY');
    expect(validateHatchEvidenceIntegrationConfig({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: {},
      hatchEvidenceContext: [],
    }).errors.map(error => error.code)).toContain('INVALID_HATCH_EVIDENCE_CONTEXT');
  });

  it('rejects disconnected technical claims and requires a valid effective SATIN configuration', () => {
    const config = activeConfig(SATIN_RANGE, {
      fabricProfile: 'Pure Cotton',
      referenceScaleCompatible: true,
    });
    expect(validateHatchEvidenceIntegrationConfig(config).errors.map(error => error.code))
      .toContain('MISSING_HATCH_EFFECTIVE_TECHNICAL_CONFIG');
    expect(validateObjectPlanningConfig(config).errors.map(error => error.code))
      .toContain('MISSING_HATCH_EFFECTIVE_TECHNICAL_CONFIG');
    expect(validateHatchEvidenceIntegrationConfig(config, {
      technicalConfig: { satin: { maximumWidthMm: Number.NaN } },
    }).errors.map(error => error.code)).toContain('INVALID_HATCH_EFFECTIVE_TECHNICAL_CONFIG');
    expect(validateObjectPlanningConfig(config, { technicalConfig: {} }).valid).toBe(true);

    const disconnected = activeConfig(SATIN_RANGE, {
      fabricProfile: 'Pure Cotton',
      referenceScaleCompatible: true,
      technicalSatinMaximumWidthMm: 9.18,
      technicalSatinValidationPassed: true,
    });
    const codes = validateHatchEvidenceIntegrationConfig(disconnected, { technicalConfig: {} }).errors.map(error => error.code);
    expect(codes.filter(code => code === 'UNKNOWN_HATCH_EVIDENCE_CONTEXT_FIELD')).toHaveLength(2);
  });
});

describe('R03 controlled Hatch A/B policy', () => {
  const emptyPolicy = {
    operationalRuleIds: [],
    diagnosticRuleIds: [],
    effectiveRuleIds: [],
    fallbackToLegacy: false,
    fallbackReasonCodes: [],
  };

  it('publishes one canonical deeply frozen internal policy without production integration', () => {
    expect(HATCH_EVIDENCE_ACTIVATION_MODES).toEqual(['controlled-opt-in']);
    expect(HATCH_EVIDENCE_CONTROLLED_OPT_IN_MODE).toBe('controlled-opt-in');
    expect(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY).toEqual({
      activationMode: 'controlled-opt-in',
      operationalRuleIds: [SATIN_RANGE, HOLE_MIN_SIZE],
      diagnosticRuleIds: [LOCAL_WIDTH, HOLE_PRESERVE],
      mutuallyExclusiveOperationalRuleIds: [SATIN_RANGE, HOLE_MIN_SIZE],
      defaultEnabled: false,
      allOnAllowed: false,
      productionIntegration: false,
    });
    expect(HATCH_EVIDENCE_REGISTRY.activeIntegration.controlledOptInPolicy)
      .toBe(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
    expect(HATCH_EVIDENCE_REGISTRY.productionIntegration).toBe(false);
    expectDeeplyFrozen(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
    expect(validateHatchEvidenceRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('validates external registry arguments structurally while retaining official singleton identity', () => {
    const structuralPolicyCopy = controlledPolicyCopy();
    expect(structuralPolicyCopy).not.toBe(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
    expect(Object.getPrototypeOf(structuralPolicyCopy)).toBe(Object.prototype);
    CONTROLLED_POLICY_ARRAY_FIELDS.forEach(field => {
      expect(structuralPolicyCopy[field]).not.toBe(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY[field]);
      expect(Object.getPrototypeOf(structuralPolicyCopy[field])).toBe(Array.prototype);
    });
    expectDeeplyFrozen(structuralPolicyCopy);
    expect(validateHatchEvidenceRegistry(registryWithControlledPolicy(structuralPolicyCopy)))
      .toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('rejects a mutable outer policy with every internal array frozen', () => {
    const policy = freezePolicyArrays(clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY));
    const before = clone(policy);
    expect(Object.isFrozen(policy)).toBe(false);
    CONTROLLED_POLICY_ARRAY_FIELDS.forEach(field => expect(Object.isFrozen(policy[field])).toBe(true));
    expectControlledPolicyInvalid(policy);
    expect(policy).toEqual(before);
  });

  it.each(CONTROLLED_POLICY_ARRAY_FIELDS)(
    'rejects isolated mutable internal array %s',
    mutableField => {
      const policy = freezePolicyArrays(clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY), mutableField);
      Object.freeze(policy);
      const before = clone(policy);
      CONTROLLED_POLICY_ARRAY_FIELDS.forEach(field => {
        expect(Object.isFrozen(policy[field])).toBe(field !== mutableField);
      });
      expectControlledPolicyInvalid(policy);
      expect(policy).toEqual(before);
    },
  );

  it('rejects a policy with a required property absent', () => {
    const policy = clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
    delete policy.defaultEnabled;
    expectControlledPolicyInvalid(freezeDeep(policy));
  });

  it('rejects a policy with an additional enumerable property', () => {
    expectControlledPolicyInvalid(controlledPolicyCopy({ future: true }));
  });

  it('rejects a policy with an additional non-enumerable property', () => {
    const policy = clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
    Object.defineProperty(policy, 'hidden', { value: true, enumerable: false, configurable: true });
    expectControlledPolicyInvalid(freezeDeep(policy));
  });

  it('rejects a policy with an additional Symbol key', () => {
    const policy = clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
    policy[Symbol('hidden')] = true;
    expectControlledPolicyInvalid(freezeDeep(policy));
  });

  it('rejects a policy with a custom outer prototype', () => {
    const policy = clone(HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY);
    Object.setPrototypeOf(policy, { customPolicyPrototype: true });
    expectControlledPolicyInvalid(freezeDeep(policy));
  });

  it('rejects an activationMode getter without executing it', () => {
    let getterCalls = 0;
    const policy = policyWithAccessor('activationMode', {
      get() {
        getterCalls += 1;
        return HATCH_EVIDENCE_CONTROLLED_OPT_IN_MODE;
      },
    });
    expectControlledPolicyInvalid(policy);
    expect(getterCalls).toBe(0);
  });

  it('rejects a throwing getter without throwing or executing it', () => {
    let getterCalls = 0;
    const policy = policyWithAccessor('activationMode', {
      get() {
        getterCalls += 1;
        throw new Error('getter must not execute');
      },
    });
    expectControlledPolicyInvalid(policy);
    expect(getterCalls).toBe(0);
  });

  it('rejects a setter on an expected property without executing it', () => {
    let setterCalls = 0;
    const policy = policyWithAccessor('productionIntegration', {
      set() {
        setterCalls += 1;
      },
    });
    expectControlledPolicyInvalid(policy);
    expect(setterCalls).toBe(0);
  });

  it('rejects string false for productionIntegration', () => {
    expectControlledPolicyInvalid(controlledPolicyCopy({ productionIntegration: 'false' }));
  });

  it.each([
    ['activationMode', 'future'],
    ['defaultEnabled', true],
    ['allOnAllowed', true],
    ['productionIntegration', true],
  ])('rejects divergent scalar policy field %s', (field, value) => {
    expectControlledPolicyInvalid(controlledPolicyCopy({ [field]: value }));
  });

  it.each(CONTROLLED_POLICY_ARRAY_FIELDS)(
    'rejects incorrect type for array field %s',
    field => expectControlledPolicyInvalid(controlledPolicyCopy({ [field]: {} })),
  );

  it('rejects interchanged operational and diagnostic classifications', () => {
    expectControlledPolicyInvalid(controlledPolicyCopy({
      operationalRuleIds: [...HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY.diagnosticRuleIds],
      diagnosticRuleIds: [...HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY.operationalRuleIds],
    }));
  });

  it('rejects an internal array with incorrect order', () => {
    expectControlledPolicyInvalid(controlledPolicyCopy({
      operationalRuleIds: [HOLE_MIN_SIZE, SATIN_RANGE],
    }));
  });

  it('rejects an internal array with a duplicate ID', () => {
    expectControlledPolicyInvalid(controlledPolicyCopy({
      operationalRuleIds: [SATIN_RANGE, SATIN_RANGE, HOLE_MIN_SIZE],
    }));
  });

  it('rejects an internal array with an unknown ID', () => {
    expectControlledPolicyInvalid(controlledPolicyCopy({
      operationalRuleIds: [SATIN_RANGE, 'FUTURE-RULE'],
    }));
  });

  it.each([
    ['operationalRuleIds', [SATIN_RANGE]],
    ['diagnosticRuleIds', [HOLE_PRESERVE]],
    ['mutuallyExclusiveOperationalRuleIds', [HOLE_MIN_SIZE]],
  ])('rejects incorrect classification or length for array field %s', (field, value) => {
    expectControlledPolicyInvalid(controlledPolicyCopy({ [field]: value }));
  });

  it('rejects an internal array with an additional enumerable property', () => {
    const value = [...HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY.operationalRuleIds];
    value.future = true;
    expectControlledPolicyInvalid(policyWithArray('operationalRuleIds', value));
  });

  it('rejects an internal array with an additional non-enumerable property', () => {
    const value = [...HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY.operationalRuleIds];
    Object.defineProperty(value, 'hidden', { value: true, enumerable: false, configurable: true });
    expectControlledPolicyInvalid(policyWithArray('operationalRuleIds', value));
  });

  it('rejects an internal array with an additional Symbol key', () => {
    const value = [...HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY.operationalRuleIds];
    value[Symbol('hidden')] = true;
    expectControlledPolicyInvalid(policyWithArray('operationalRuleIds', value));
  });

  it('rejects an internal array with a custom prototype', () => {
    const value = [...HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY.operationalRuleIds];
    Object.setPrototypeOf(value, Object.create(Array.prototype));
    expectControlledPolicyInvalid(policyWithArray('operationalRuleIds', value));
  });

  it('rejects an internal array getter without executing it', () => {
    let getterCalls = 0;
    const value = [...HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY.operationalRuleIds];
    Object.defineProperty(value, '0', {
      get() {
        getterCalls += 1;
        return SATIN_RANGE;
      },
      enumerable: true,
      configurable: true,
    });
    expectControlledPolicyInvalid(policyWithArray('operationalRuleIds', value));
    expect(getterCalls).toBe(0);
  });

  it.each([
    ['getPrototypeOf', { getPrototypeOf() { throw new Error('hostile getPrototypeOf'); } }],
    ['ownKeys', { ownKeys() { throw new Error('hostile ownKeys'); } }],
    ['getOwnPropertyDescriptor', {
      getOwnPropertyDescriptor() { throw new Error('hostile getOwnPropertyDescriptor'); },
    }],
  ])('rejects a hostile outer Proxy whose %s introspection throws', (_trapName, handler) => {
    const target = controlledPolicyCopy();
    const policy = new Proxy(target, handler);
    expectControlledPolicyInvalid(policy);
    expectDeeplyFrozen(target);
  });

  it('does not intervene when activationMode is absent or undefined', () => {
    const allOnExperimental = {
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: Object.fromEntries(HATCH_EVIDENCE_RULE_IDS.map(ruleId => [ruleId, true])),
    };
    const results = [
      resolveHatchEvidenceControlledOptInPolicy(),
      resolveHatchEvidenceControlledOptInPolicy(allOnExperimental),
      resolveHatchEvidenceControlledOptInPolicy({
        ...allOnExperimental,
        hatchEvidenceActivationMode: undefined,
      }),
    ];
    results.forEach(result => {
      expect(result).toEqual(emptyPolicy);
      expectDeeplyFrozen(result);
    });
    expect(resolveHatchEvidenceIntegrationConfig(allOnExperimental).enabledRuleIds)
      .toEqual(HATCH_EVIDENCE_RULE_IDS);
  });

  it.each([
    [0, null],
    [1, ''],
    [2, 'experimental-evidence'],
    [3, 0],
    [4, 1],
    [5, true],
    [6, false],
    [7, []],
    [8, {}],
  ])('rejects invalid activationMode type/value case %# with highest precedence', (_caseId, value) => {
    const config = controlledConfig([SATIN_RANGE], { hatchEvidenceActivationMode: value });
    const validation = validateHatchEvidenceIntegrationConfig(config, {
      technicalConfig: { satin: { maximumWidthMm: 9.18 } },
    });
    expect(validation.errors[0]).toMatchObject({
      code: 'INVALID_HATCH_EVIDENCE_ACTIVATION_MODE',
      path: 'hatchEvidenceActivationMode',
    });
    expect(validateObjectPlanningConfig(config, {
      technicalConfig: { satin: { maximumWidthMm: 9.18 } },
    }).errors[0].code).toBe('INVALID_HATCH_EVIDENCE_ACTIVATION_MODE');
    const policy = resolveHatchEvidenceControlledOptInPolicy(config, {
      technicalConfig: { satin: { maximumWidthMm: 9.18 } },
    });
    expect(policy).toEqual({
      ...emptyPolicy,
      fallbackToLegacy: true,
      fallbackReasonCodes: ['INVALID_HATCH_EVIDENCE_ACTIVATION_MODE'],
    });
    expectDeeplyFrozen(policy);
  });

  it('requires the explicit experimental profile and treats controlled all-OFF as valid fallback', () => {
    const incompatible = controlledConfig([], { hatchEvidenceProfile: 'legacy' });
    expect(validateHatchEvidenceIntegrationConfig(incompatible).errors[0].code)
      .toBe('HATCH_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE');
    expect(resolveHatchEvidenceControlledOptInPolicy(incompatible)).toEqual({
      ...emptyPolicy,
      fallbackToLegacy: true,
      fallbackReasonCodes: ['HATCH_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE'],
    });

    const allOff = controlledConfig([]);
    expect(validateHatchEvidenceIntegrationConfig(allOff)).toEqual(expect.objectContaining({
      valid: true,
      errors: [],
      warnings: [],
    }));
    expect(resolveHatchEvidenceControlledOptInPolicy(allOff)).toEqual({
      ...emptyPolicy,
      fallbackToLegacy: true,
      fallbackReasonCodes: ['HATCH_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES'],
    });
  });

  it.each([
    [SATIN_RANGE, [SATIN_RANGE], []],
    [LOCAL_WIDTH, [], [LOCAL_WIDTH]],
    [HOLE_PRESERVE, [], [HOLE_PRESERVE]],
    [HOLE_MIN_SIZE, [HOLE_MIN_SIZE], []],
  ])('classifies individual controlled rule %s without upgrading diagnostics', (ruleId, operationalRuleIds, diagnosticRuleIds) => {
    const options = ruleId === SATIN_RANGE
      ? { technicalConfig: { satin: { maximumWidthMm: 9.18 } } }
      : {};
    const policy = resolveHatchEvidenceControlledOptInPolicy(controlledConfig([ruleId]), options);
    expect(policy).toEqual({
      operationalRuleIds,
      diagnosticRuleIds,
      effectiveRuleIds: [ruleId],
      fallbackToLegacy: false,
      fallbackReasonCodes: [],
    });
    expectDeeplyFrozen(policy);
  });

  it('preserves canonical ID order for one operational rule plus both diagnostics', () => {
    const policy = resolveHatchEvidenceControlledOptInPolicy(
      controlledConfig([HOLE_PRESERVE, SATIN_RANGE, LOCAL_WIDTH]),
      { technicalConfig: { satin: { maximumWidthMm: 9.18 } } },
    );
    expect(policy).toEqual({
      operationalRuleIds: [SATIN_RANGE],
      diagnosticRuleIds: [LOCAL_WIDTH, HOLE_PRESERVE],
      effectiveRuleIds: [SATIN_RANGE, LOCAL_WIDTH, HOLE_PRESERVE],
      fallbackToLegacy: false,
      fallbackReasonCodes: [],
    });
  });

  it.each([
    [LOCAL_WIDTH, [LOCAL_WIDTH, HOLE_MIN_SIZE]],
    [HOLE_PRESERVE, [HOLE_PRESERVE, HOLE_MIN_SIZE]],
  ])('combines controlled HOLE-MIN with diagnostic %s without requiring SATIN technical config', (diagnosticRuleId, effectiveRuleIds) => {
    expect(resolveHatchEvidenceControlledOptInPolicy(
      controlledConfig([HOLE_MIN_SIZE, diagnosticRuleId]),
    )).toEqual({
      operationalRuleIds: [HOLE_MIN_SIZE],
      diagnosticRuleIds: [diagnosticRuleId],
      effectiveRuleIds,
      fallbackToLegacy: false,
      fallbackReasonCodes: [],
    });
  });

  it('rejects ALL-ON before the operational conflict and rejects the conflict otherwise', () => {
    const options = { technicalConfig: { satin: { maximumWidthMm: 9.18 } } };
    const allOn = controlledConfig(HATCH_EVIDENCE_RULE_IDS);
    expect(validateHatchEvidenceIntegrationConfig(allOn, options).errors[0].code)
      .toBe('HATCH_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN');
    expect(resolveHatchEvidenceControlledOptInPolicy(allOn, options)).toEqual({
      ...emptyPolicy,
      fallbackToLegacy: true,
      fallbackReasonCodes: ['HATCH_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN'],
    });

    const conflict = controlledConfig([SATIN_RANGE, HOLE_MIN_SIZE]);
    expect(validateHatchEvidenceIntegrationConfig(conflict, options).errors[0].code)
      .toBe('HATCH_CONTROLLED_OPT_IN_OPERATIONAL_CONFLICT');
    expect(resolveHatchEvidenceControlledOptInPolicy(conflict, options)).toEqual({
      ...emptyPolicy,
      fallbackToLegacy: true,
      fallbackReasonCodes: ['HATCH_CONTROLLED_OPT_IN_OPERATIONAL_CONFLICT'],
    });
  });

  it('reuses existing context and technical validation codes and fails closed', () => {
    const missingContext = controlledConfig([LOCAL_WIDTH], { hatchEvidenceContext: undefined });
    expect(resolveHatchEvidenceControlledOptInPolicy(missingContext).fallbackReasonCodes).toEqual([
      'MISSING_HATCH_EVIDENCE_FABRIC',
      'MISSING_HATCH_EVIDENCE_SCALE_COMPATIBILITY',
    ]);

    const invalidContext = controlledConfig([LOCAL_WIDTH], {
      hatchEvidenceContext: { fabricProfile: 42, referenceScaleCompatible: 'yes' },
    });
    expect(resolveHatchEvidenceControlledOptInPolicy(invalidContext).fallbackReasonCodes).toEqual([
      'INVALID_HATCH_EVIDENCE_FABRIC',
      'INVALID_HATCH_EVIDENCE_SCALE_COMPATIBILITY',
    ]);

    const satin = controlledConfig([SATIN_RANGE]);
    expect(resolveHatchEvidenceControlledOptInPolicy(satin).fallbackReasonCodes)
      .toEqual(['MISSING_HATCH_EFFECTIVE_TECHNICAL_CONFIG']);
    expect(resolveHatchEvidenceControlledOptInPolicy(satin, {
      technicalConfig: { satin: { maximumWidthMm: Number.NaN } },
    })).toEqual({
      ...emptyPolicy,
      fallbackToLegacy: true,
      fallbackReasonCodes: [
        'INVALID_HATCH_EFFECTIVE_TECHNICAL_CONFIG',
        'INVALID_HATCH_EFFECTIVE_SATIN_MAXIMUM',
      ],
    });

    const unknownFlag = controlledConfig([], { hatchEvidenceRuleFlags: { future: true } });
    expect(resolveHatchEvidenceControlledOptInPolicy(unknownFlag).fallbackReasonCodes)
      .toEqual(['UNKNOWN_HATCH_EVIDENCE_RULE_FLAG']);
  });

  it('orders future fallback codes ordinally without deriving the expectation from production sorting', () => {
    const input = [
      'FUTURE_Á',
      'INVALID_HATCH_EVIDENCE_RULE_FLAG_VALUE',
      'FUTURE_a',
      'UNKNOWN_HATCH_EVIDENCE_RULE_FLAG',
      'FUTURE_Z',
      'FUTURE_a',
    ];
    const before = [...input];
    const result = canonicalizeHatchEvidenceControlledFallbackReasonCodes(input);
    expect(result).toEqual([
      'UNKNOWN_HATCH_EVIDENCE_RULE_FLAG',
      'INVALID_HATCH_EVIDENCE_RULE_FLAG_VALUE',
      'FUTURE_Z',
      'FUTURE_a',
      'FUTURE_Á',
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(input).toEqual(before);
  });

  it('canonicalizes fallback codes independently from flag insertion order without mutating inputs', () => {
    const unknownFirst = controlledConfig([], {
      hatchEvidenceRuleFlags: { future: true, [SATIN_RANGE]: 'yes' },
    });
    const canonicalFirst = controlledConfig([], {
      hatchEvidenceRuleFlags: { [SATIN_RANGE]: 'yes', future: true },
    });
    const unknownFirstBefore = structuredClone(unknownFirst);
    const canonicalFirstBefore = structuredClone(canonicalFirst);
    const expected = {
      operationalRuleIds: [],
      diagnosticRuleIds: [],
      effectiveRuleIds: [],
      fallbackToLegacy: true,
      fallbackReasonCodes: [
        'UNKNOWN_HATCH_EVIDENCE_RULE_FLAG',
        'INVALID_HATCH_EVIDENCE_RULE_FLAG_VALUE',
      ],
    };

    const unknownFirstResult = resolveHatchEvidenceControlledOptInPolicy(unknownFirst);
    const canonicalFirstResult = resolveHatchEvidenceControlledOptInPolicy(canonicalFirst);
    expect(unknownFirstResult).toEqual(expected);
    expect(canonicalFirstResult).toEqual(expected);
    expect(canonicalFirstResult).toEqual(unknownFirstResult);
    expectDeeplyFrozen(unknownFirstResult);
    expectDeeplyFrozen(canonicalFirstResult);
    expect(unknownFirst).toEqual(unknownFirstBefore);
    expect(canonicalFirst).toEqual(canonicalFirstBefore);
  });

  it('fails closed on a canonical non-boolean flag without adding NO-EFFECTIVE', () => {
    const config = controlledConfig([], {
      hatchEvidenceRuleFlags: { [HOLE_MIN_SIZE]: 'yes' },
    });
    const before = structuredClone(config);
    expect(resolveHatchEvidenceControlledOptInPolicy(config)).toEqual({
      operationalRuleIds: [],
      diagnosticRuleIds: [],
      effectiveRuleIds: [],
      fallbackToLegacy: true,
      fallbackReasonCodes: ['INVALID_HATCH_EVIDENCE_RULE_FLAG_VALUE'],
    });
    expect(config).toEqual(before);
  });
});
