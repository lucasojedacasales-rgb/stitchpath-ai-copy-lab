export const DEFAULT_PROPOSAL_REVIEW_POLICY_CONFIG = Object.freeze({
  requireValidProposalPlan: true,
  autoAcceptActiveProposals: true,
  autoAcceptExplicitOutlines: true,
  minimumAutoAcceptConfidence: 0.72,
  manualReviewAction: 'defer',
  excludedProposalAction: 'exclude',
  allowExplicitOverrides: false,
  allowRoleOverride: false,
  allowStitchTypeOverride: false,
  rejectInvalidExplicitOverrides: true,
  blockOnMissingDependency: true,
  requireCompleteDispositionCoverage: true,
  conservativeMode: true,
});

const issue = (code, path, message) => ({ code, path, message });

export function resolveProposalReviewPolicyConfig(config = {}) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const known = new Set(Object.keys(DEFAULT_PROPOSAL_REVIEW_POLICY_CONFIG));
  const resolved = { ...DEFAULT_PROPOSAL_REVIEW_POLICY_CONFIG };
  known.forEach(key => { if (Object.hasOwn(source, key)) resolved[key] = source[key]; });
  resolved.extras = Object.fromEntries(Object.entries(source).filter(([key]) => !known.has(key)));
  return resolved;
}

export function validateProposalReviewPolicyConfig(config = {}) {
  const resolved = resolveProposalReviewPolicyConfig(config);
  const errors = [];
  if (!Number.isFinite(resolved.minimumAutoAcceptConfidence) || resolved.minimumAutoAcceptConfidence < 0 || resolved.minimumAutoAcceptConfidence > 1) errors.push(issue('INVALID_REVIEW_CONFIDENCE', 'minimumAutoAcceptConfidence', 'minimumAutoAcceptConfidence must be between 0 and 1.'));
  if (!['defer', 'reject'].includes(resolved.manualReviewAction)) errors.push(issue('INVALID_MANUAL_REVIEW_ACTION', 'manualReviewAction', 'manualReviewAction must be defer or reject.'));
  if (resolved.excludedProposalAction !== 'exclude') errors.push(issue('INVALID_EXCLUDED_PROPOSAL_ACTION', 'excludedProposalAction', 'excludedProposalAction must be exclude.'));
  Object.keys(DEFAULT_PROPOSAL_REVIEW_POLICY_CONFIG).filter(key => typeof DEFAULT_PROPOSAL_REVIEW_POLICY_CONFIG[key] === 'boolean').forEach(key => {
    if (typeof resolved[key] !== 'boolean') errors.push(issue('INVALID_REVIEW_POLICY_BOOLEAN', key, `${key} must be boolean.`));
  });
  return { valid: errors.length === 0, errors, warnings: [], config: resolved };
}
