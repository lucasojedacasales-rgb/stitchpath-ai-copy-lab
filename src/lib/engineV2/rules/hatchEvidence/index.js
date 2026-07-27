export {
  HATCH_MASTER_EVIDENCE_SOURCE,
  defineHatchEvidenceRules,
  validateHatchEvidenceRule,
} from './model.js';
export {
  DEFAULT_HATCH_EVIDENCE_PROFILE,
  DEFAULT_HATCH_EVIDENCE_RULE_FLAGS,
  HATCH_EVIDENCE_CONTEXT_FIELDS,
  HATCH_EVIDENCE_PROFILES,
  HATCH_EVIDENCE_RULE_IDS,
  hatchEvidenceExperimentalEnabled,
  hatchEvidenceRuleEnabled,
  resolveHatchEvidenceIntegrationConfig,
  validateHatchEvidenceIntegrationConfig,
} from './profiles.js';
export {
  HATCH_WIDTH_EVIDENCE_LIMITS,
  HATCH_WIDTH_EVIDENCE_RULES,
  analyzeHatchLocalWidthProfile,
  evaluateHatchWidthTechniqueCandidate,
} from './widths.js';
export {
  HATCH_HOLE_EVIDENCE_LIMITS,
  HATCH_HOLE_MEASUREMENT_TOLERANCES,
  HATCH_HOLE_EVIDENCE_RULES,
  evaluateHatchHoleProtection,
  measureHoleMinimumSpanMm,
} from './holes.js';
export { HATCH_OVERLAP_EVIDENCE_RULES, HATCH_OVERLAP_REVIEW_AUDIT } from './overlaps.js';
export {
  CONTOUR_LAST_ASSOCIATION_LIMIT,
  CONTOUR_LAST_ASSOCIATION_METHOD,
  CONTOUR_LAST_RULE_ID,
  evaluateContourLastProposalGuard,
} from './contourLast.js';
export {
  DEFAULT_HATCH_OVERLAP_PROFILE,
  DEFAULT_HATCH_OVERLAP_RULE_FLAGS,
  HATCH_OVERLAP_CONFIG_FIELDS,
  HATCH_OVERLAP_PROFILES,
  HATCH_OVERLAP_RULE_IDS,
  hatchOverlapRuleEnabled,
  resolveHatchOverlapIntegrationConfig,
  validateHatchOverlapIntegrationConfig,
} from './overlapProfiles.js';
export { HATCH_TECHNIQUE_EVIDENCE_RULES } from './techniques.js';
export { HATCH_FABRIC_EVIDENCE_RULES } from './fabrics.js';
export { HATCH_SCALING_EVIDENCE_RULES } from './scaling.js';
export {
  HATCH_EVIDENCE_PHASES,
  HATCH_EVIDENCE_REGISTRY,
  HATCH_EVIDENCE_RULES,
  getHatchEvidenceRules,
  validateHatchEvidenceRegistry,
} from './registry.js';
