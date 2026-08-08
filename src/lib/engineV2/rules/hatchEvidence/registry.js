import { HATCH_FABRIC_EVIDENCE_RULES } from './fabrics.js';
import { HATCH_HOLE_EVIDENCE_RULES } from './holes.js';
import { HATCH_G_LETTERING_EVIDENCE, validateHatchGLetteringEvidence } from './lettering.js';
import {
  HATCH_EVIDENCE_CAPABILITY_CLAIMS,
  validateHatchEvidenceCapabilityClaims,
} from './capabilityClaims.js';
import {
  HATCH_MASTER_A_F_EVIDENCE_SOURCE,
  HATCH_MASTER_A_G_EVIDENCE_SOURCE,
  validateHatchEvidenceRule,
} from './model.js';
import { HATCH_OVERLAP_EVIDENCE_RULES, HATCH_OVERLAP_REVIEW_AUDIT } from './overlaps.js';
import { DEFAULT_HATCH_OVERLAP_RULE_FLAGS, HATCH_OVERLAP_RULE_IDS } from './overlapProfiles.js';
import { DEFAULT_HATCH_EVIDENCE_RULE_FLAGS, HATCH_EVIDENCE_RULE_IDS } from './profiles.js';
import { HATCH_SCALING_EVIDENCE_RULES } from './scaling.js';
import { HATCH_TECHNIQUE_EVIDENCE_RULES } from './techniques.js';
import { HATCH_WIDTH_EVIDENCE_RULES } from './widths.js';

export const HATCH_EVIDENCE_PHASES = Object.freeze([
  'A_Anchuras',
  'B_Huecos',
  'C_Solapes',
  'D_Técnicas',
  'E_Telas',
  'F_Escalado',
  'G_Lettering',
]);

export const HATCH_EVIDENCE_PHASE_ALIASES = Object.freeze({
  D_Tecnicas: 'D_Técnicas',
  'D_Técnicas': 'D_Técnicas',
  E_Tejidos: 'E_Telas',
  E_Telas: 'E_Telas',
});

const HATCH_INACTIVE_EVIDENCE_PHASES = Object.freeze([
  'D_Técnicas',
  'E_Telas',
  'F_Escalado',
  'G_Lettering',
]);

export function resolveHatchEvidencePhaseAlias(phase) {
  return Object.hasOwn(HATCH_EVIDENCE_PHASE_ALIASES, phase)
    ? HATCH_EVIDENCE_PHASE_ALIASES[phase]
    : phase;
}

export const HATCH_EVIDENCE_RULES = Object.freeze([
  ...HATCH_WIDTH_EVIDENCE_RULES,
  ...HATCH_HOLE_EVIDENCE_RULES,
  ...HATCH_OVERLAP_EVIDENCE_RULES,
  ...HATCH_TECHNIQUE_EVIDENCE_RULES,
  ...HATCH_FABRIC_EVIDENCE_RULES,
  ...HATCH_SCALING_EVIDENCE_RULES,
]);

export const HATCH_EVIDENCE_REGISTRY = Object.freeze({
  version: 'engine-v2-hatch-evidence-a-g-r1',
  source: HATCH_MASTER_A_G_EVIDENCE_SOURCE,
  historicalSources: Object.freeze([HATCH_MASTER_A_F_EVIDENCE_SOURCE]),
  phases: HATCH_EVIDENCE_PHASES,
  rules: HATCH_EVIDENCE_RULES,
  byId: Object.freeze(Object.fromEntries(HATCH_EVIDENCE_RULES.map(rule => [rule.id, rule]))),
  activeIntegration: Object.freeze({
    profile: 'hatch-a-f-experimental',
    phases: Object.freeze(['A_Anchuras', 'B_Huecos']),
    ruleIds: HATCH_EVIDENCE_RULE_IDS,
    defaultRuleFlags: DEFAULT_HATCH_EVIDENCE_RULE_FLAGS,
    independentlyConfigurable: true,
    defaultEnabled: false,
  }),
  partialIntegrations: Object.freeze([Object.freeze({
    profile: 'hatch-c-experimental',
    phase: 'C_Solapes',
    ruleIds: HATCH_OVERLAP_RULE_IDS,
    defaultRuleFlags: DEFAULT_HATCH_OVERLAP_RULE_FLAGS,
    independentlyConfigurable: true,
    defaultEnabled: false,
    integrationStatus: 'partial',
  })]),
  inactivePhases: HATCH_INACTIVE_EVIDENCE_PHASES,
  reviewedClosedOverlapAudit: HATCH_OVERLAP_REVIEW_AUDIT,
  letteringEvidence: HATCH_G_LETTERING_EVIDENCE,
  letteringIncluded: true,
  capabilityClaims: HATCH_EVIDENCE_CAPABILITY_CLAIMS,
  productionIntegration: false,
});

export function getHatchEvidenceRules({ phase = null, profile = null } = {}) {
  const resolvedPhase = phase === null ? null : resolveHatchEvidencePhaseAlias(phase);
  return HATCH_EVIDENCE_RULES.filter(rule => (!resolvedPhase || rule.phase === resolvedPhase)
    && (!profile || rule.activatedInProfiles.includes(profile)));
}

export function validateHatchEvidenceRegistry(registry = HATCH_EVIDENCE_REGISTRY) {
  const errors = [];
  const rules = Array.isArray(registry?.rules) ? registry.rules : [];
  const ids = rules.map(rule => rule.id);
  if (registry?.version !== 'engine-v2-hatch-evidence-a-g-r1') errors.push({ code: 'HATCH_EVIDENCE_REGISTRY_VERSION_INVALID' });
  if (JSON.stringify(registry?.source) !== JSON.stringify(HATCH_MASTER_A_G_EVIDENCE_SOURCE)) errors.push({ code: 'HATCH_EVIDENCE_CURRENT_SOURCE_INVALID' });
  if (JSON.stringify(registry?.historicalSources) !== JSON.stringify([HATCH_MASTER_A_F_EVIDENCE_SOURCE])) {
    errors.push({ code: 'HATCH_EVIDENCE_HISTORICAL_SOURCE_INVALID' });
  }
  if (JSON.stringify(registry?.phases) !== JSON.stringify(HATCH_EVIDENCE_PHASES)) {
    errors.push({ code: 'HATCH_EVIDENCE_PHASES_INVALID' });
  }
  if (JSON.stringify(registry?.inactivePhases) !== JSON.stringify(HATCH_INACTIVE_EVIDENCE_PHASES)) {
    errors.push({ code: 'HATCH_EVIDENCE_INACTIVE_PHASES_INVALID' });
  }
  if (rules.length !== 37) errors.push({ code: 'HATCH_EVIDENCE_A_F_RULE_COUNT_INVALID' });
  if (JSON.stringify(rules) !== JSON.stringify(HATCH_EVIDENCE_RULES)) {
    errors.push({ code: 'HATCH_EVIDENCE_A_F_RULESET_INVALID' });
  }
  if (new Set(ids).size !== ids.length) errors.push({ code: 'HATCH_EVIDENCE_DUPLICATE_RULE_ID' });
  rules.forEach((rule, index) => errors.push(...validateHatchEvidenceRule(rule).errors.map(error => ({ ...error, path: `rules[${index}].${error.field}` }))));
  if (rules.some(rule => !HATCH_EVIDENCE_PHASES.includes(rule.phase))) errors.push({ code: 'HATCH_EVIDENCE_UNKNOWN_PHASE' });
  if (rules.some(rule => rule.phase === 'G_Lettering')) errors.push({ code: 'HATCH_EVIDENCE_G_MUST_REMAIN_SEPARATE' });
  const byIdEntries = Object.entries(registry?.byId || {});
  if (byIdEntries.length !== 37
    || byIdEntries.some(([id, rule]) => id !== rule?.id || !ids.includes(id))) {
    errors.push({ code: 'HATCH_EVIDENCE_BY_ID_INVALID' });
  }
  const integratedC = HATCH_OVERLAP_RULE_IDS.map(ruleId => rules.find(rule => rule.id === ruleId));
  const unauthorizedC = rules.filter(rule => rule.phase === 'C_Solapes' && !HATCH_OVERLAP_RULE_IDS.includes(rule.id))
    .some(rule => rule.activatedInProfiles.length > 0);
  if (unauthorizedC
    || integratedC.some(rule => !rule
      || JSON.stringify(rule.activatedInProfiles) !== JSON.stringify(['hatch-c-experimental']))) {
    errors.push({ code: 'HATCH_EVIDENCE_UNAUTHORIZED_C_ACTIVATION' });
  }
  if (rules.some(rule => ['D_Técnicas', 'E_Telas', 'F_Escalado', 'G_Lettering'].includes(rule.phase) && rule.activatedInProfiles.length)) errors.push({ code: 'HATCH_EVIDENCE_UNAUTHORIZED_PHASE_ACTIVATION' });
  if (registry?.activeIntegration?.ruleIds?.some(ruleId => !HATCH_EVIDENCE_RULE_IDS.includes(ruleId))) errors.push({ code: 'HATCH_EVIDENCE_UNAUTHORIZED_RULE_FLAG' });
  if (registry?.activeIntegration?.independentlyConfigurable !== true) errors.push({ code: 'HATCH_EVIDENCE_RULE_FLAGS_NOT_INDEPENDENT' });
  const cIntegration = registry?.partialIntegrations?.find(item => item?.phase === 'C_Solapes');
  if (!cIntegration
    || cIntegration.profile !== 'hatch-c-experimental'
    || JSON.stringify(cIntegration.ruleIds) !== JSON.stringify(HATCH_OVERLAP_RULE_IDS)
    || cIntegration.integrationStatus !== 'partial') {
    errors.push({ code: 'HATCH_EVIDENCE_C_PARTIAL_INTEGRATION_INVALID' });
  }
  const integrations = [registry?.activeIntegration, ...(registry?.partialIntegrations || [])];
  if (integrations.some(integration => integration?.phase === 'G_Lettering'
    || integration?.phases?.includes('G_Lettering'))) {
    errors.push({ code: 'HATCH_EVIDENCE_G_INTEGRATION_FORBIDDEN' });
  }
  errors.push(...validateHatchGLetteringEvidence(registry?.letteringEvidence).errors);
  errors.push(...validateHatchEvidenceCapabilityClaims(registry?.capabilityClaims, {
    rules,
    byId: registry?.byId,
  }).errors);
  if (registry?.letteringIncluded !== true) errors.push({ code: 'HATCH_EVIDENCE_G_MUST_BE_INCLUDED' });
  if (registry?.productionIntegration !== false) errors.push({ code: 'HATCH_EVIDENCE_PRODUCTION_INTEGRATION_FORBIDDEN' });
  return { valid: errors.length === 0, errors, warnings: [] };
}
