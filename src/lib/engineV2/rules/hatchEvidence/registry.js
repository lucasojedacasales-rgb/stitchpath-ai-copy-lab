import { HATCH_FABRIC_EVIDENCE_RULES } from './fabrics.js';
import { HATCH_HOLE_EVIDENCE_RULES } from './holes.js';
import { HATCH_MASTER_EVIDENCE_SOURCE, validateHatchEvidenceRule } from './model.js';
import { HATCH_OVERLAP_EVIDENCE_RULES, HATCH_OVERLAP_REVIEW_AUDIT } from './overlaps.js';
import { DEFAULT_HATCH_EVIDENCE_RULE_FLAGS, HATCH_EVIDENCE_RULE_IDS } from './profiles.js';
import { HATCH_SCALING_EVIDENCE_RULES } from './scaling.js';
import { HATCH_TECHNIQUE_EVIDENCE_RULES } from './techniques.js';
import { HATCH_WIDTH_EVIDENCE_RULES } from './widths.js';

export const HATCH_EVIDENCE_PHASES = Object.freeze(['A_Anchuras', 'B_Huecos', 'C_Solapes', 'D_Técnicas', 'E_Telas', 'F_Escalado']);

export const HATCH_EVIDENCE_RULES = Object.freeze([
  ...HATCH_WIDTH_EVIDENCE_RULES,
  ...HATCH_HOLE_EVIDENCE_RULES,
  ...HATCH_OVERLAP_EVIDENCE_RULES,
  ...HATCH_TECHNIQUE_EVIDENCE_RULES,
  ...HATCH_FABRIC_EVIDENCE_RULES,
  ...HATCH_SCALING_EVIDENCE_RULES,
]);

export const HATCH_EVIDENCE_REGISTRY = Object.freeze({
  version: 'engine-v2-hatch-evidence-a-f-r1',
  source: HATCH_MASTER_EVIDENCE_SOURCE,
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
  inactivePhases: Object.freeze(['C_Solapes', 'D_Técnicas', 'E_Telas', 'F_Escalado']),
  reviewedClosedOverlapAudit: HATCH_OVERLAP_REVIEW_AUDIT,
  letteringIncluded: false,
});

export function getHatchEvidenceRules({ phase = null, profile = null } = {}) {
  return HATCH_EVIDENCE_RULES.filter(rule => (!phase || rule.phase === phase) && (!profile || rule.activatedInProfiles.includes(profile)));
}

export function validateHatchEvidenceRegistry(registry = HATCH_EVIDENCE_REGISTRY) {
  const errors = [];
  const rules = Array.isArray(registry?.rules) ? registry.rules : [];
  const ids = rules.map(rule => rule.id);
  if (new Set(ids).size !== ids.length) errors.push({ code: 'HATCH_EVIDENCE_DUPLICATE_RULE_ID' });
  rules.forEach((rule, index) => errors.push(...validateHatchEvidenceRule(rule).errors.map(error => ({ ...error, path: `rules[${index}].${error.field}` }))));
  if (rules.some(rule => !HATCH_EVIDENCE_PHASES.includes(rule.phase))) errors.push({ code: 'HATCH_EVIDENCE_UNKNOWN_PHASE' });
  if (rules.some(rule => ['C_Solapes', 'D_Técnicas', 'E_Telas', 'F_Escalado'].includes(rule.phase) && rule.activatedInProfiles.length)) errors.push({ code: 'HATCH_EVIDENCE_UNAUTHORIZED_PHASE_ACTIVATION' });
  if (registry?.activeIntegration?.ruleIds?.some(ruleId => !HATCH_EVIDENCE_RULE_IDS.includes(ruleId))) errors.push({ code: 'HATCH_EVIDENCE_UNAUTHORIZED_RULE_FLAG' });
  if (registry?.activeIntegration?.independentlyConfigurable !== true) errors.push({ code: 'HATCH_EVIDENCE_RULE_FLAGS_NOT_INDEPENDENT' });
  if (registry?.letteringIncluded !== false) errors.push({ code: 'HATCH_EVIDENCE_LETTERING_MUST_REMAIN_EXCLUDED' });
  return { valid: errors.length === 0, errors, warnings: [] };
}
