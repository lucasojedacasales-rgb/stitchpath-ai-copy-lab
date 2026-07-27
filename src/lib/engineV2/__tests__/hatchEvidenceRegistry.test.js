import { describe, expect, it } from 'vitest';
import {
  COLOR_GROUP_HEURISTIC_RULE_ID,
  CONTOUR_LAST_RULE_ID,
  DEFAULT_HATCH_EVIDENCE_PROFILE,
  DEFAULT_HATCH_EVIDENCE_RULE_FLAGS,
  HATCH_EVIDENCE_CONTEXT_FIELDS,
  HATCH_EVIDENCE_REGISTRY,
  HATCH_EVIDENCE_RULE_IDS,
  HATCH_EVIDENCE_RULES,
  HATCH_MASTER_EVIDENCE_SOURCE,
  HATCH_OVERLAP_RULE_IDS,
  getHatchEvidenceRules,
  resolveHatchEvidenceIntegrationConfig,
  validateHatchEvidenceIntegrationConfig,
  validateHatchEvidenceRegistry,
} from '../rules/hatchEvidence/index.js';
import {
  resolveObjectPlanningConfig,
  validateObjectPlanningConfig,
} from '../planning/planningConfig.js';

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

function activeConfig(ruleId, context) {
  return {
    hatchEvidenceProfile: 'hatch-a-f-experimental',
    hatchEvidenceRuleFlags: { [ruleId]: true },
    ...(context === undefined ? {} : { hatchEvidenceContext: context }),
  };
}

describe('Hatch A-F evidence registry', () => {
  it('binds the immutable master package identity', () => {
    expect(HATCH_MASTER_EVIDENCE_SOURCE).toMatchObject({
      packageName: 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F.zip',
      packageSha256: 'd2ca1f36db18a6d48fe8d471f66d4cf1f96e2804ca65979d57752e97812bf8e3',
      packageByteLength: 320891578,
    });
  });

  it('registers all 37 A-F rules once', () => {
    expect(HATCH_EVIDENCE_RULES).toHaveLength(37);
    expect(new Set(HATCH_EVIDENCE_RULES.map(rule => rule.id)).size).toBe(37);
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

  it('keeps only C1 and C2 partially integrated in C while D-F and lettering remain inactive', () => {
    const cRules = HATCH_EVIDENCE_RULES.filter(rule => rule.phase === 'C_Solapes');
    expect(HATCH_OVERLAP_RULE_IDS).toEqual([
      CONTOUR_LAST_RULE_ID,
      COLOR_GROUP_HEURISTIC_RULE_ID,
    ]);
    HATCH_OVERLAP_RULE_IDS.forEach(ruleId => expect(
      cRules.find(rule => rule.id === ruleId).activatedInProfiles,
    ).toEqual(['hatch-c-experimental']));
    expect(cRules.filter(rule => !HATCH_OVERLAP_RULE_IDS.includes(rule.id))
      .every(rule => rule.activatedInProfiles.length === 0)).toBe(true);
    expect(HATCH_EVIDENCE_RULES.filter(rule => ['D_Técnicas', 'E_Telas', 'F_Escalado'].includes(rule.phase))
      .every(rule => rule.activatedInProfiles.length === 0)).toBe(true);
    expect(HATCH_EVIDENCE_REGISTRY.letteringIncluded).toBe(false);
    expect(HATCH_EVIDENCE_REGISTRY.reviewedClosedOverlapAudit).toMatchObject({ phaseRemainsClosed: true, technicalDataModified: false });
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
