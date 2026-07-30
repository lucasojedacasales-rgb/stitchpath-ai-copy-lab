import { describe, expect, it } from 'vitest';
import {
  HATCH_A_F_CAPABILITY_CLAIMS,
  HATCH_CAPABILITY_CLAIM_STATUSES,
  HATCH_EVIDENCE_CAPABILITY_CLAIMS,
  HATCH_EVIDENCE_RULES,
  HATCH_G_LETTERING_CAPABILITY_CLAIMS,
  getHatchEvidenceCapabilityClaim,
  getHatchEvidenceCapabilityClaimsByPhase,
  summarizeHatchEvidenceCapabilityClaims,
  validateHatchEvidenceCapabilityClaims,
} from '../rules/hatchEvidence/index.js';
import { defineHatchEvidenceCapabilityClaims } from '../rules/hatchEvidence/capabilityClaims.js';

const EXPECTED_A_F = Object.freeze([
  ['SATIN-RANGE-OBSERVED-001', 'OPERATIONAL_FLAGGED_OFF'],
  ['LOCAL-WIDTH-PROFILE-001', 'EXPERIMENTAL_DIAGNOSTIC_ONLY'],
  ['UNDERLAY-GEOMETRY-001', 'PARTIALLY_IMPLEMENTED'],
  ['SPACING-GEOMETRY-001', 'PARTIALLY_IMPLEMENTED'],
  ['PULL-COMP-COTTON-040-001', 'PARTIALLY_IMPLEMENTED'],
  ['HOLE-PRESERVE-001', 'EXPERIMENTAL_DIAGNOSTIC_ONLY'],
  ['HOLE-MIN-SIZE-001', 'OPERATIONAL_FLAGGED_OFF'],
  ['ISLAND-SPLIT-001', 'CONTRACT_ONLY'],
  ['BRIDGE-MIN-001', 'CONTRACT_ONLY'],
  ['DISCONNECTED-ISLANDS-001', 'CONTRACT_ONLY'],
  ['COMPOUND-SPLIT-001', 'CONTRACT_ONLY'],
  ['OVERLAP-CUTOUT-001', 'CONTRACT_ONLY'],
  ['SPLIT-OCCLUDED-001', 'CONTRACT_ONLY'],
  ['SAME-COLOR-UNION-001', 'CONTRACT_ONLY'],
  ['WHITE-FABRIC-001', 'CONTRACT_ONLY'],
  ['CONTOUR-LAST-001', 'PARTIALLY_IMPLEMENTED'],
  ['ADJACENT-UNDERLAP-001', 'CONTRACT_ONLY'],
  ['COLOR-GROUP-HEURISTIC-001', 'PARTIALLY_IMPLEMENTED'],
  ['MULTILAYER-DEPENDENCY-001', 'PARTIALLY_IMPLEMENTED'],
  ['TECHNIQUE-TATAMI-UNDERLAY-CONTROL-001', 'PARTIALLY_IMPLEMENTED'],
  ['TECHNIQUE-SATIN-WIDE-DIVISION-001', 'PARTIALLY_IMPLEMENTED'],
  ['TECHNIQUE-UNDULATING-SEPARATE-001', 'CONTRACT_ONLY'],
  ['TECHNIQUE-RUNNING-PASS-COUNT-001', 'PARTIALLY_IMPLEMENTED'],
  ['TECHNIQUE-ZIGZAG-TOP-STITCH-001', 'CONTRACT_ONLY'],
  ['TECHNIQUE-BOUNDARY-PAIR-001', 'PARTIALLY_IMPLEMENTED'],
  ['E-FAB-001', 'PARTIALLY_IMPLEMENTED'],
  ['E-FAB-002', 'PARTIALLY_IMPLEMENTED'],
  ['E-FAB-003', 'CONTRACT_ONLY'],
  ['E-FAB-004', 'PARTIALLY_IMPLEMENTED'],
  ['E-FAB-005', 'PARTIALLY_IMPLEMENTED'],
  ['E-FAB-006', 'CONTRACT_ONLY'],
  ['F-R01', 'CONTRACT_ONLY'],
  ['F-R02', 'PARTIALLY_IMPLEMENTED'],
  ['F-R03', 'PARTIALLY_IMPLEMENTED'],
  ['F-R04', 'PARTIALLY_IMPLEMENTED'],
  ['F-R05', 'CONTRACT_ONLY'],
  ['F-R06', 'PARTIALLY_IMPLEMENTED'],
]);

const EXPECTED_G = Object.freeze([
  ['G-BLOCK-SELECTION', 'CONTRACT_ONLY'],
  ['G-SERIF-SELECTION', 'CONTRACT_ONLY'],
  ['G-SCRIPT-SELECTION', 'CONTRACT_ONLY'],
  ['G-SELECTION-ORDER', 'CONTRACT_ONLY'],
  ['G-HEIGHT-RANGE-POLICY', 'CONTRACT_ONLY'],
  ['G-SATIN-OBSERVED', 'PARTIALLY_IMPLEMENTED'],
  ['G-UNDERLAY-SCALE-TRANSITION', 'PARTIALLY_IMPLEMENTED'],
  ['G-NO-AUTOMATIC-ALPHABET-SUBSTITUTION', 'CONTRACT_ONLY'],
  ['G-GENERATABLE-VS-VALID-HEIGHT', 'CONTRACT_ONLY'],
  ['G-SPACING-PULL-COMP-OBSERVED', 'NOT_APPLICABLE'],
  ['G-TIE-TRIM-JUMP-OBSERVED', 'NOT_APPLICABLE'],
  ['G-DIACRITICS-MANUAL-REVIEW', 'CONTRACT_ONLY'],
]);

const EXPECTED_A_F_TOTALS = Object.freeze({
  OPERATIONAL_ACTIVE: 0,
  OPERATIONAL_FLAGGED_OFF: 2,
  EXPERIMENTAL_DIAGNOSTIC_ONLY: 2,
  PARTIALLY_IMPLEMENTED: 18,
  CONTRACT_ONLY: 15,
  NOT_IMPLEMENTED: 0,
  NOT_APPLICABLE: 0,
});

const EXPECTED_G_TOTALS = Object.freeze({
  OPERATIONAL_ACTIVE: 0,
  OPERATIONAL_FLAGGED_OFF: 0,
  EXPERIMENTAL_DIAGNOSTIC_ONLY: 0,
  PARTIALLY_IMPLEMENTED: 2,
  CONTRACT_ONLY: 8,
  NOT_IMPLEMENTED: 0,
  NOT_APPLICABLE: 2,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function codes(result) {
  return result.errors.map(error => error.code);
}

function expectDeeplyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(expectDeeplyFrozen);
}

function definedAfter(mutator) {
  const input = clone(HATCH_EVIDENCE_CAPABILITY_CLAIMS);
  mutator(input);
  return defineHatchEvidenceCapabilityClaims(input);
}

describe('Hatch A-F capability claims', () => {
  it('uses the exact closed taxonomy in order', () => {
    expect(HATCH_CAPABILITY_CLAIM_STATUSES).toEqual([
      'OPERATIONAL_ACTIVE',
      'OPERATIONAL_FLAGGED_OFF',
      'EXPERIMENTAL_DIAGNOSTIC_ONLY',
      'PARTIALLY_IMPLEMENTED',
      'CONTRACT_ONLY',
      'NOT_IMPLEMENTED',
      'NOT_APPLICABLE',
    ]);
  });

  it('maps the 37 registry rules one-to-one in historical order', () => {
    expect(HATCH_A_F_CAPABILITY_CLAIMS.map(claim => [claim.ruleId, claim.status]))
      .toEqual(EXPECTED_A_F);
    expect(HATCH_A_F_CAPABILITY_CLAIMS.map(claim => claim.ruleId))
      .toEqual(HATCH_EVIDENCE_RULES.map(rule => rule.id));
    expect(new Set(HATCH_A_F_CAPABILITY_CLAIMS.map(claim => claim.ruleId)).size).toBe(37);
  });

  it('requires the exact A-F totals and zero default or production activation', () => {
    expect(summarizeHatchEvidenceCapabilityClaims('rulesAF')).toEqual(EXPECTED_A_F_TOTALS);
    HATCH_A_F_CAPABILITY_CLAIMS.forEach(claim => {
      expect(claim.productionIntegrated).toBe(false);
      expect(claim.operationalByDefault).toBe(false);
      expect(claim.flag.defaultEnabled).toBe(false);
      expect(claim.status).not.toBe('OPERATIONAL_ACTIVE');
    });
  });

  it('records the two diagnostic-only claims without nominal action', () => {
    expect(HATCH_A_F_CAPABILITY_CLAIMS.filter(claim => claim.diagnosticOnly)
      .map(claim => claim.ruleId)).toEqual([
      'LOCAL-WIDTH-PROFILE-001',
      'HOLE-PRESERVE-001',
    ]);
    expect(getHatchEvidenceCapabilityClaim('LOCAL-WIDTH-PROFILE-001').evidenceBoundary.accredited)
      .toContain('candidateActionApplied_false');
    expect(getHatchEvidenceCapabilityClaim('HOLE-PRESERVE-001').evidenceBoundary.accredited)
      .toContain('nominal_geometry_not_mutated');
  });

  it('preserves the exact C1, C2 and C3 claim boundaries', () => {
    expect(getHatchEvidenceCapabilityClaim('CONTOUR-LAST-001').evidenceBoundary).toEqual({
      maximumScope: 'dependency_validation_fail_closed',
      accredited: ['validates_dependencies', 'may_block_downstream'],
      notAccredited: ['creates_dependencies', 'reorders_nominal_output'],
    });
    expect(getHatchEvidenceCapabilityClaim('COLOR-GROUP-HEURISTIC-001').evidenceBoundary).toEqual({
      maximumScope: 'existing_scheduler_accreditation',
      accredited: ['validates_existing_scheduler', 'may_block_downstream'],
      notAccredited: ['creates_new_nominal_order'],
    });
    expect(getHatchEvidenceCapabilityClaim('MULTILAYER-DEPENDENCY-001').evidenceBoundary).toEqual({
      maximumScope: 'precedence_only',
      accredited: ['validates_multilayer_precedence', 'may_block_downstream'],
      notAccredited: ['cutout', 'underlap', 'boolean_geometry'],
    });
  });
});

describe('Hatch G capability claims', () => {
  it('registers exactly 12 stable claims in the required order', () => {
    expect(HATCH_G_LETTERING_CAPABILITY_CLAIMS.map(claim => [claim.claimId, claim.status]))
      .toEqual(EXPECTED_G);
    expect(new Set(HATCH_G_LETTERING_CAPABILITY_CLAIMS.map(claim => claim.claimId)).size).toBe(12);
  });

  it('requires the exact G totals and keeps every claim inactive', () => {
    expect(summarizeHatchEvidenceCapabilityClaims('letteringG')).toEqual(EXPECTED_G_TOTALS);
    HATCH_G_LETTERING_CAPABILITY_CLAIMS.forEach(claim => {
      expect(claim.phase).toBe('G_Lettering');
      expect(claim.productionIntegrated).toBe(false);
      expect(claim.operationalByDefault).toBe(false);
      expect(claim.activatedInProfiles).toEqual([]);
    });
  });

  it('keeps digital automatic-setting observations non-applicable as product defaults', () => {
    expect(HATCH_G_LETTERING_CAPABILITY_CLAIMS
      .filter(claim => claim.status === 'NOT_APPLICABLE')
      .map(claim => claim.claimId)).toEqual([
      'G-SPACING-PULL-COMP-OBSERVED',
      'G-TIE-TRIM-JUMP-OBSERVED',
    ]);
  });
});

describe('Hatch capability claim API and immutability', () => {
  it('queries deterministically by identity and phase without mutable results', () => {
    const byId = getHatchEvidenceCapabilityClaim('F-R06');
    const byPhase = getHatchEvidenceCapabilityClaimsByPhase('G_Lettering');
    expect(byId).toEqual(HATCH_A_F_CAPABILITY_CLAIMS.at(-1));
    expect(byId).not.toBe(HATCH_A_F_CAPABILITY_CLAIMS.at(-1));
    expect(byPhase).toEqual(HATCH_G_LETTERING_CAPABILITY_CLAIMS);
    expect(byPhase).not.toBe(HATCH_G_LETTERING_CAPABILITY_CLAIMS);
    expect(getHatchEvidenceCapabilityClaim('missing')).toBeNull();
    expect(getHatchEvidenceCapabilityClaimsByPhase('missing')).toEqual([]);
    expectDeeplyFrozen(byId);
    expectDeeplyFrozen(byPhase);
  });

  it('deeply clones construction input and freezes every public descendant', () => {
    const input = clone(HATCH_EVIDENCE_CAPABILITY_CLAIMS);
    const defined = defineHatchEvidenceCapabilityClaims(input);
    expect(defined).toEqual(HATCH_EVIDENCE_CAPABILITY_CLAIMS);
    expect(defined).not.toBe(input);
    expect(defined.rulesAF).not.toBe(input.rulesAF);
    expect(defined.rulesAF[0].evidenceBoundary).not.toBe(input.rulesAF[0].evidenceBoundary);
    input.rulesAF[0].evidenceBoundary.accredited[0] = 'mutated';
    input.letteringG[0].activatedInProfiles.push('future');
    expect(defined.rulesAF[0].evidenceBoundary.accredited[0])
      .toBe('may_select_satin_with_explicit_experimental_configuration');
    expect(defined.letteringG[0].activatedInProfiles).toEqual([]);
    expectDeeplyFrozen(defined);
    expectDeeplyFrozen(HATCH_EVIDENCE_CAPABILITY_CLAIMS);
  });

  it('validates the complete canonical contract', () => {
    expect(validateHatchEvidenceCapabilityClaims(
      HATCH_EVIDENCE_CAPABILITY_CLAIMS,
      {
        rules: HATCH_EVIDENCE_RULES,
        byId: Object.fromEntries(HATCH_EVIDENCE_RULES.map(rule => [rule.id, rule])),
      },
    )).toEqual({ valid: true, errors: [], warnings: [] });
  });
});

describe('Hatch capability claim negative validation', () => {
  it.each([
    ['unknown status', input => { input.rulesAF[0].status = 'FUTURE'; }, 'HATCH_CAPABILITY_CLAIM_STATUS_INVALID'],
    ['missing ruleId', input => { delete input.rulesAF[0].ruleId; }, 'HATCH_CAPABILITY_CLAIM_RULE_ID_REQUIRED'],
    ['unknown ruleId', input => { input.rulesAF[0].ruleId = 'FUTURE-RULE'; }, 'HATCH_CAPABILITY_CLAIM_RULE_ID_UNKNOWN'],
    ['duplicate ruleId', input => { input.rulesAF[1].ruleId = input.rulesAF[0].ruleId; }, 'HATCH_CAPABILITY_CLAIM_RULE_ID_DUPLICATE'],
    ['incorrect phase', input => { input.rulesAF[0].phase = 'B_Huecos'; }, 'HATCH_CAPABILITY_CLAIM_PHASE_INVALID'],
    ['incorrect A-F cardinality', input => { input.rulesAF.pop(); }, 'HATCH_CAPABILITY_CLAIM_A_F_CARDINALITY_INVALID'],
    ['incorrect A-F totals', input => { input.rulesAF[0].status = 'CONTRACT_ONLY'; }, 'HATCH_CAPABILITY_CLAIM_A_F_TOTALS_INVALID'],
    ['operational active', input => { input.rulesAF[0].status = 'OPERATIONAL_ACTIVE'; }, 'HATCH_CAPABILITY_CLAIM_OPERATIONAL_ACTIVE_FORBIDDEN'],
    ['default operation', input => { input.rulesAF[0].operationalByDefault = true; }, 'HATCH_CAPABILITY_CLAIM_DEFAULT_OPERATION_FORBIDDEN'],
    ['production integration', input => { input.rulesAF[0].productionIntegrated = true; }, 'HATCH_CAPABILITY_CLAIM_PRODUCTION_INTEGRATION_FORBIDDEN'],
    ['active flag', input => { input.rulesAF[0].flag.defaultEnabled = true; }, 'HATCH_CAPABILITY_CLAIM_FLAG_ACTIVATION_FORBIDDEN'],
    ['incorrect G cardinality', input => { input.letteringG.pop(); }, 'HATCH_CAPABILITY_CLAIM_G_CARDINALITY_INVALID'],
    ['incorrect G totals', input => { input.letteringG[0].status = 'PARTIALLY_IMPLEMENTED'; }, 'HATCH_CAPABILITY_CLAIM_G_TOTALS_INVALID'],
    ['G profile activation', input => { input.letteringG[0].activatedInProfiles = ['future']; }, 'HATCH_CAPABILITY_CLAIM_G_PROFILE_ACTIVATION_FORBIDDEN'],
  ])('rejects %s deterministically', (_label, mutate, expectedCode) => {
    const result = validateHatchEvidenceCapabilityClaims(definedAfter(mutate));
    expect(codes(result)).toContain(expectedCode);
    expect(result.errors.find(error => error.code === expectedCode).path).toBeTruthy();
  });

  it('rejects a claim without a corresponding registry rule', () => {
    const rules = HATCH_EVIDENCE_RULES.slice(1);
    expect(codes(validateHatchEvidenceCapabilityClaims(
      HATCH_EVIDENCE_CAPABILITY_CLAIMS,
      { rules },
    ))).toContain('HATCH_CAPABILITY_CLAIM_WITHOUT_RULE');
  });

  it('rejects a registry rule without a claim', () => {
    const contract = definedAfter(input => input.rulesAF.shift());
    expect(codes(validateHatchEvidenceCapabilityClaims(
      contract,
      { rules: HATCH_EVIDENCE_RULES },
    ))).toContain('HATCH_CAPABILITY_CLAIM_RULE_WITHOUT_CLAIM');
  });

  it.each([
    'CONTOUR-LAST-001',
    'COLOR-GROUP-HEURISTIC-001',
    'MULTILAYER-DEPENDENCY-001',
  ])('rejects alteration of the %s accredited overlap boundary', ruleId => {
    const contract = definedAfter(input => {
      input.rulesAF.find(claim => claim.ruleId === ruleId)
        .evidenceBoundary.notAccredited.push('future_claim');
    });
    expect(codes(validateHatchEvidenceCapabilityClaims(contract)))
      .toContain('HATCH_CAPABILITY_CLAIM_OVERLAP_BOUNDARY_INVALID');
  });

  it('rejects G claims introduced into registry rules or byId', () => {
    const gRule = { id: 'G-BLOCK-SELECTION', phase: 'G_Lettering' };
    expect(codes(validateHatchEvidenceCapabilityClaims(
      HATCH_EVIDENCE_CAPABILITY_CLAIMS,
      { rules: [...HATCH_EVIDENCE_RULES, gRule] },
    ))).toContain('HATCH_CAPABILITY_CLAIM_G_RULE_INTEGRATION_FORBIDDEN');
    expect(codes(validateHatchEvidenceCapabilityClaims(
      HATCH_EVIDENCE_CAPABILITY_CLAIMS,
      {
        rules: HATCH_EVIDENCE_RULES,
        byId: { 'G-BLOCK-SELECTION': gRule },
      },
    ))).toContain('HATCH_CAPABILITY_CLAIM_G_RULE_INTEGRATION_FORBIDDEN');
  });

  it('rejects a public contract graph that is not deeply frozen', () => {
    const mutable = clone(HATCH_EVIDENCE_CAPABILITY_CLAIMS);
    expect(codes(validateHatchEvidenceCapabilityClaims(mutable)))
      .toContain('HATCH_CAPABILITY_CLAIM_NOT_DEEPLY_FROZEN');
  });
});
