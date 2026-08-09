export const HATCH_CAPABILITY_CLAIM_STATUSES = Object.freeze([
  'OPERATIONAL_ACTIVE',
  'OPERATIONAL_FLAGGED_OFF',
  'EXPERIMENTAL_DIAGNOSTIC_ONLY',
  'PARTIALLY_IMPLEMENTED',
  'CONTRACT_ONLY',
  'NOT_IMPLEMENTED',
  'NOT_APPLICABLE',
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

const flag = exists => ({ exists, defaultEnabled: false });

const boundary = (maximumScope, accredited, notAccredited) => ({
  maximumScope,
  accredited,
  notAccredited,
});

const ruleClaim = ({
  ruleId,
  phase,
  status,
  evidenceBoundary,
  flagExists = false,
  diagnosticOnly = false,
}) => ({
  ruleId,
  phase,
  status,
  productionIntegrated: false,
  operationalByDefault: false,
  flag: flag(flagExists),
  diagnosticOnly,
  evidenceBoundary,
});

const gClaim = ({ claimId, status, evidenceBoundary }) => ({
  claimId,
  phase: 'G_Lettering',
  status,
  productionIntegrated: false,
  operationalByDefault: false,
  activatedInProfiles: [],
  evidenceBoundary,
});

const A_F_CLAIM_INPUT = [
  ruleClaim({
    ruleId: 'SATIN-RANGE-OBSERVED-001',
    phase: 'A_Anchuras',
    status: 'OPERATIONAL_FLAGGED_OFF',
    flagExists: true,
    evidenceBoundary: boundary(
      'explicit_experimental_tatami_satin_selection',
      ['may_select_satin_with_explicit_experimental_configuration'],
      ['default_activation', 'unconditional_satin_selection', 'production_integration'],
    ),
  }),
  ruleClaim({
    ruleId: 'LOCAL-WIDTH-PROFILE-001',
    phase: 'A_Anchuras',
    status: 'EXPERIMENTAL_DIAGNOSTIC_ONLY',
    flagExists: true,
    diagnosticOnly: true,
    evidenceBoundary: boundary(
      'available_local_width_metrics',
      ['reports_available_local_width_metrics', 'candidateActionApplied_false'],
      ['technique_change', 'missing_width_metrics_claim'],
    ),
  }),
  ruleClaim({
    ruleId: 'UNDERLAY-GEOMETRY-001',
    phase: 'A_Anchuras',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'generic_underlay_primitives',
      ['generic_center_edge_and_zigzag_underlay_exists'],
      ['complete_hatch_geometry_decision'],
    ),
  }),
  ruleClaim({
    ruleId: 'SPACING-GEOMETRY-001',
    phase: 'A_Anchuras',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'generic_physical_spacing',
      ['generic_spacing_in_mm_exists'],
      ['hatch_sustained_width_spacing_decision'],
    ),
  }),
  ruleClaim({
    ruleId: 'PULL-COMP-COTTON-040-001',
    phase: 'A_Anchuras',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'generic_material_scaled_pull_compensation',
      ['generic_pull_compensation_planner_exists'],
      ['accredited_pure_cotton_0_40mm_decision'],
    ),
  }),
  ruleClaim({
    ruleId: 'HOLE-PRESERVE-001',
    phase: 'B_Huecos',
    status: 'EXPERIMENTAL_DIAGNOSTIC_ONLY',
    flagExists: true,
    diagnosticOnly: true,
    evidenceBoundary: boundary(
      'hole_preservation_diagnostic',
      ['preservation_accredited', 'nominal_geometry_not_mutated'],
      ['new_nominal_geometry_transformation'],
    ),
  }),
  ruleClaim({
    ruleId: 'HOLE-MIN-SIZE-001',
    phase: 'B_Huecos',
    status: 'OPERATIONAL_FLAGGED_OFF',
    flagExists: true,
    evidenceBoundary: boundary(
      'explicit_opt_in_automation_guard',
      ['may_block_automation', 'may_require_manual_review'],
      ['default_activation', 'universal_hole_threshold', 'production_integration'],
    ),
  }),
  ...[
    ['ISLAND-SPLIT-001', 'independent_island_contract'],
    ['BRIDGE-MIN-001', 'critical_bridge_contract'],
    ['DISCONNECTED-ISLANDS-001', 'disconnected_components_contract'],
    ['COMPOUND-SPLIT-001', 'compound_split_contract'],
  ].map(([ruleId, maximumScope]) => ruleClaim({
    ruleId,
    phase: 'B_Huecos',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      maximumScope,
      ['evidence_registered'],
      ['operational_geometry_transformation'],
    ),
  })),
  ...[
    ['OVERLAP-CUTOUT-001', 'overlap_cutout_contract'],
    ['SPLIT-OCCLUDED-001', 'occluded_split_contract'],
    ['SAME-COLOR-UNION-001', 'same_color_union_contract'],
    ['WHITE-FABRIC-001', 'white_fabric_classification_contract'],
  ].map(([ruleId, maximumScope]) => ruleClaim({
    ruleId,
    phase: 'C_Solapes',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      maximumScope,
      ['evidence_registered'],
      ['operational_geometry_transformation'],
    ),
  })),
  ruleClaim({
    ruleId: 'CONTOUR-LAST-001',
    phase: 'C_Solapes',
    status: 'PARTIALLY_IMPLEMENTED',
    flagExists: true,
    evidenceBoundary: boundary(
      'dependency_validation_fail_closed',
      ['validates_dependencies', 'may_block_downstream'],
      ['creates_dependencies', 'reorders_nominal_output'],
    ),
  }),
  ruleClaim({
    ruleId: 'ADJACENT-UNDERLAP-001',
    phase: 'C_Solapes',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      'adjacent_underlap_contract',
      ['evidence_registered'],
      ['operational_underlap_or_boolean_geometry'],
    ),
  }),
  ruleClaim({
    ruleId: 'COLOR-GROUP-HEURISTIC-001',
    phase: 'C_Solapes',
    status: 'PARTIALLY_IMPLEMENTED',
    flagExists: true,
    evidenceBoundary: boundary(
      'existing_scheduler_accreditation',
      ['validates_existing_scheduler', 'may_block_downstream'],
      ['creates_new_nominal_order'],
    ),
  }),
  ruleClaim({
    ruleId: 'MULTILAYER-DEPENDENCY-001',
    phase: 'C_Solapes',
    status: 'PARTIALLY_IMPLEMENTED',
    flagExists: true,
    evidenceBoundary: boundary(
      'precedence_only',
      ['validates_multilayer_precedence', 'may_block_downstream'],
      ['cutout', 'underlap', 'boolean_geometry'],
    ),
  }),
  ruleClaim({
    ruleId: 'TECHNIQUE-TATAMI-UNDERLAY-CONTROL-001',
    phase: 'D_Técnicas',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'generic_tatami_underlay_primitives',
      ['generic_tatami_underlay_exists'],
      ['complete_hatch_underlay_control'],
    ),
  }),
  ruleClaim({
    ruleId: 'TECHNIQUE-SATIN-WIDE-DIVISION-001',
    phase: 'D_Técnicas',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'satin_width_detection_and_rejection',
      ['maximum_satin_width_is_validated'],
      ['automatic_satin_division'],
    ),
  }),
  ruleClaim({
    ruleId: 'TECHNIQUE-UNDULATING-SEPARATE-001',
    phase: 'D_Técnicas',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      'undulating_technique_contract',
      ['evidence_registered'],
      ['undulating_model_planner_or_generator'],
    ),
  }),
  ruleClaim({
    ruleId: 'TECHNIQUE-RUNNING-PASS-COUNT-001',
    phase: 'D_Técnicas',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'generic_running_pass_count',
      ['running_generator_supports_pass_count'],
      ['accredited_single_and_triple_running_techniques'],
    ),
  }),
  ruleClaim({
    ruleId: 'TECHNIQUE-ZIGZAG-TOP-STITCH-001',
    phase: 'D_Técnicas',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      'zigzag_top_stitch_contract',
      ['evidence_registered'],
      ['zigzag_top_stitch_generator'],
    ),
  }),
  ruleClaim({
    ruleId: 'TECHNIQUE-BOUNDARY-PAIR-001',
    phase: 'D_Técnicas',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'generic_inner_outer_roles_and_running',
      ['generic_boundary_roles_exist', 'running_generator_exists'],
      ['hatch_boundary_pair_creation'],
    ),
  }),
  ...[
    ['E-FAB-001', 'generic_knit_stretch_profile'],
    ['E-FAB-002', 'generic_high_loft_profile'],
  ].map(([ruleId, maximumScope]) => ruleClaim({
    ruleId,
    phase: 'E_Telas',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      maximumScope,
      ['generic_material_profile_exists'],
      ['accredited_hatch_fabric_profile_and_parameters'],
    ),
  })),
  ruleClaim({
    ruleId: 'E-FAB-003',
    phase: 'E_Telas',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      'terry_ring_and_hole_contract',
      ['evidence_registered'],
      ['terry_double_zigzag_behavior'],
    ),
  }),
  ruleClaim({
    ruleId: 'E-FAB-004',
    phase: 'E_Telas',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'generic_lightweight_woven_profile',
      ['generic_material_profile_exists'],
      ['accredited_chiffon_profile_and_parameters'],
    ),
  }),
  ruleClaim({
    ruleId: 'E-FAB-005',
    phase: 'E_Telas',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'material_and_geometry_stages_are_separate',
      ['architecture_separates_material_from_geometry_classification'],
      ['explicit_hatch_non_reclassification_invariant'],
    ),
  }),
  ruleClaim({
    ruleId: 'E-FAB-006',
    phase: 'E_Telas',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      'micro_detail_preservation_contract',
      ['evidence_registered'],
      ['pre_simplification_micro_detail_preservation'],
    ),
  }),
  ruleClaim({
    ruleId: 'F-R01',
    phase: 'F_Escalado',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      'cumulative_scale_contract',
      ['evidence_registered'],
      ['scale_operation_history'],
    ),
  }),
  ...[
    ['F-R02', 'generic_regeneration_from_current_geometry', ['scale_workflow_and_mandatory_regeneration']],
    ['F-R03', 'generic_physical_unit_configuration', ['accredited_scale_invariants']],
    ['F-R04', 'generic_physical_and_connector_validation', ['post_scale_orchestrated_revalidation']],
  ].map(([ruleId, maximumScope, notAccredited]) => ruleClaim({
    ruleId,
    phase: 'F_Escalado',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      maximumScope,
      ['generic_engine_primitive_exists'],
      notAccredited,
    ),
  })),
  ruleClaim({
    ruleId: 'F-R05',
    phase: 'F_Escalado',
    status: 'CONTRACT_ONLY',
    evidenceBoundary: boundary(
      'pristine_baseline_contract',
      ['evidence_registered'],
      ['mandatory_100_percent_baseline_provenance'],
    ),
  }),
  ruleClaim({
    ruleId: 'F-R06',
    phase: 'F_Escalado',
    status: 'PARTIALLY_IMPLEMENTED',
    evidenceBoundary: boundary(
      'generic_sewability_validation',
      ['generic_limits_exist'],
      ['post_scale_sewability_recalculation'],
    ),
  }),
];

const G_CLAIM_INPUT = [
  ['G-BLOCK-SELECTION', 'CONTRACT_ONLY', 'block_family_selection_contract'],
  ['G-SERIF-SELECTION', 'CONTRACT_ONLY', 'serif_family_selection_contract'],
  ['G-SCRIPT-SELECTION', 'CONTRACT_ONLY', 'script_family_selection_contract'],
  ['G-SELECTION-ORDER', 'CONTRACT_ONLY', 'six_criterion_selection_order_contract'],
  ['G-HEIGHT-RANGE-POLICY', 'CONTRACT_ONLY', 'conditional_safe_and_recommended_height_contract'],
  ['G-SATIN-OBSERVED', 'PARTIALLY_IMPLEMENTED', 'generic_satin_infrastructure_only'],
  ['G-UNDERLAY-SCALE-TRANSITION', 'PARTIALLY_IMPLEMENTED', 'generic_underlay_infrastructure_only'],
  ['G-NO-AUTOMATIC-ALPHABET-SUBSTITUTION', 'CONTRACT_ONLY', 'alphabet_substitution_prohibition_contract'],
  ['G-GENERATABLE-VS-VALID-HEIGHT', 'CONTRACT_ONLY', 'generatable_and_valid_height_separation_contract'],
  ['G-SPACING-PULL-COMP-OBSERVED', 'NOT_APPLICABLE', 'digital_observation_not_a_product_default'],
  ['G-TIE-TRIM-JUMP-OBSERVED', 'NOT_APPLICABLE', 'digital_observation_not_a_product_default'],
  ['G-DIACRITICS-MANUAL-REVIEW', 'CONTRACT_ONLY', 'disconnected_diacritic_review_contract'],
].map(([claimId, status, maximumScope]) => gClaim({
  claimId,
  status,
  evidenceBoundary: boundary(
    maximumScope,
    ['structured_lettering_evidence_registered'],
    ['lettering_pipeline_activation', 'physical_validation_claim', 'production_default'],
  ),
}));

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

function isDeeplyFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}

function countsFor(claims = []) {
  return Object.freeze(Object.fromEntries(HATCH_CAPABILITY_CLAIM_STATUSES.map(status => [
    status,
    claims.filter(claim => claim?.status === status).length,
  ])));
}

function issue(code, path, message) {
  return { code, path, message };
}

/**
 * Builds a detached, deeply immutable capability-claim contract.
 * This constructor is intentionally not re-exported by the package index.
 * @param {object} input
 * @returns {Readonly<object>}
 */
export function defineHatchEvidenceCapabilityClaims(input) {
  return deepFreeze(clone(input));
}

export const HATCH_A_F_CAPABILITY_CLAIMS = defineHatchEvidenceCapabilityClaims(A_F_CLAIM_INPUT);
export const HATCH_G_LETTERING_CAPABILITY_CLAIMS = defineHatchEvidenceCapabilityClaims(G_CLAIM_INPUT);

export const HATCH_EVIDENCE_CAPABILITY_CLAIMS = defineHatchEvidenceCapabilityClaims({
  version: 'engine-v2-hatch-capability-claims-r1',
  rulesAF: HATCH_A_F_CAPABILITY_CLAIMS,
  letteringG: HATCH_G_LETTERING_CAPABILITY_CLAIMS,
  productionIntegration: false,
});

const EXPECTED_RULES = HATCH_A_F_CAPABILITY_CLAIMS.map(({ ruleId, phase }) => ({ id: ruleId, phase }));
const EXPECTED_RULE_BY_ID = Object.fromEntries(EXPECTED_RULES.map(rule => [rule.id, rule]));
const EXPECTED_G_IDS = HATCH_G_LETTERING_CAPABILITY_CLAIMS.map(claim => claim.claimId);
const OVERLAP_BOUNDARY_IDS = new Set([
  'CONTOUR-LAST-001',
  'COLOR-GROUP-HEURISTIC-001',
  'MULTILAYER-DEPENDENCY-001',
]);

function validateCommonClaim(claim, path, errors) {
  if (!HATCH_CAPABILITY_CLAIM_STATUSES.includes(claim?.status)) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_STATUS_INVALID',
      `${path}.status`,
      'Capability claim status must belong to the closed taxonomy.',
    ));
  }
  if (claim?.status === 'OPERATIONAL_ACTIVE') {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_OPERATIONAL_ACTIVE_FORBIDDEN',
      `${path}.status`,
      'No Hatch capability claim may be operationally active.',
    ));
  }
  if (claim?.productionIntegrated !== false) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_PRODUCTION_INTEGRATION_FORBIDDEN',
      `${path}.productionIntegrated`,
      'Capability claims cannot declare production integration.',
    ));
  }
  if (claim?.operationalByDefault !== false) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_DEFAULT_OPERATION_FORBIDDEN',
      `${path}.operationalByDefault`,
      'Capability claims cannot be operational by default.',
    ));
  }
  if (!claim?.evidenceBoundary
    || !Array.isArray(claim.evidenceBoundary.accredited)
    || !Array.isArray(claim.evidenceBoundary.notAccredited)
    || typeof claim.evidenceBoundary.maximumScope !== 'string') {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_EVIDENCE_BOUNDARY_INVALID',
      `${path}.evidenceBoundary`,
      'Capability claims require a structured evidence boundary.',
    ));
  }
}

function validateRuleClaims(rulesAF, referenceRules, errors) {
  if (!Array.isArray(rulesAF) || rulesAF.length !== 37) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_A_F_CARDINALITY_INVALID',
      'rulesAF',
      'The A-F capability contract must contain exactly 37 claims.',
    ));
  }
  const claims = Array.isArray(rulesAF) ? rulesAF : [];
  const seen = new Set();
  const referenceById = Object.fromEntries(referenceRules.map(rule => [rule.id, rule]));
  claims.forEach((claim, index) => {
    const path = `rulesAF[${index}]`;
    validateCommonClaim(claim, path, errors);
    if (typeof claim?.ruleId !== 'string' || !claim.ruleId) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_RULE_ID_REQUIRED',
        `${path}.ruleId`,
        'Every A-F capability claim requires a ruleId.',
      ));
      return;
    }
    if (seen.has(claim.ruleId)) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_RULE_ID_DUPLICATE',
        `${path}.ruleId`,
        `Duplicate A-F capability claim ruleId: ${claim.ruleId}.`,
      ));
    }
    seen.add(claim.ruleId);
    if (!Object.hasOwn(EXPECTED_RULE_BY_ID, claim.ruleId)) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_RULE_ID_UNKNOWN',
        `${path}.ruleId`,
        `Unknown A-F capability claim ruleId: ${claim.ruleId}.`,
      ));
    }
    if (!Object.hasOwn(referenceById, claim.ruleId)) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_WITHOUT_RULE',
        `${path}.ruleId`,
        `Capability claim ${claim.ruleId} has no corresponding registry rule.`,
      ));
    }
    const expectedPhase = EXPECTED_RULE_BY_ID[claim.ruleId]?.phase;
    if (expectedPhase && claim.phase !== expectedPhase) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_PHASE_INVALID',
        `${path}.phase`,
        `Capability claim ${claim.ruleId} must use phase ${expectedPhase}.`,
      ));
    }
    if (!claim?.flag || typeof claim.flag.exists !== 'boolean' || claim.flag.defaultEnabled !== false) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_FLAG_ACTIVATION_FORBIDDEN',
        `${path}.flag`,
        'Capability claim flags must be explicit and remain OFF.',
      ));
    }
    const expected = HATCH_A_F_CAPABILITY_CLAIMS.find(item => item.ruleId === claim.ruleId);
    if (expected && !deepEqual(claim, expected)) {
      errors.push(issue(
        OVERLAP_BOUNDARY_IDS.has(claim.ruleId)
          ? 'HATCH_CAPABILITY_CLAIM_OVERLAP_BOUNDARY_INVALID'
          : 'HATCH_CAPABILITY_CLAIM_CONTENT_MISMATCH',
        OVERLAP_BOUNDARY_IDS.has(claim.ruleId)
          ? `${path}.evidenceBoundary`
          : path,
        `Capability claim ${claim.ruleId} differs from its accredited contract.`,
      ));
    }
  });
  referenceRules.forEach((rule, index) => {
    if (!claims.some(claim => claim?.ruleId === rule?.id)) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_RULE_WITHOUT_CLAIM',
        `rules[${index}].id`,
        `Registry rule ${rule?.id ?? '<missing>'} has no capability claim.`,
      ));
    }
  });
  const totals = countsFor(claims);
  if (!deepEqual(totals, EXPECTED_A_F_TOTALS)) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_A_F_TOTALS_INVALID',
      'rulesAF',
      'A-F capability claim totals do not match the accredited distribution.',
    ));
  }
}

function validateLetteringClaims(letteringG, errors) {
  if (!Array.isArray(letteringG) || letteringG.length !== 12) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_G_CARDINALITY_INVALID',
      'letteringG',
      'The G capability contract must contain exactly 12 claims.',
    ));
  }
  const claims = Array.isArray(letteringG) ? letteringG : [];
  const seen = new Set();
  claims.forEach((claim, index) => {
    const path = `letteringG[${index}]`;
    validateCommonClaim(claim, path, errors);
    if (typeof claim?.claimId !== 'string' || !claim.claimId) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_G_ID_REQUIRED',
        `${path}.claimId`,
        'Every G capability claim requires a claimId.',
      ));
      return;
    }
    if (seen.has(claim.claimId)) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_G_ID_DUPLICATE',
        `${path}.claimId`,
        `Duplicate G capability claimId: ${claim.claimId}.`,
      ));
    }
    seen.add(claim.claimId);
    if (!EXPECTED_G_IDS.includes(claim.claimId)) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_G_ID_UNKNOWN',
        `${path}.claimId`,
        `Unknown G capability claimId: ${claim.claimId}.`,
      ));
    }
    if (claim.phase !== 'G_Lettering') {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_G_PHASE_INVALID',
        `${path}.phase`,
        'Every G capability claim must use phase G_Lettering.',
      ));
    }
    if (!Array.isArray(claim.activatedInProfiles) || claim.activatedInProfiles.length !== 0) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_G_PROFILE_ACTIVATION_FORBIDDEN',
        `${path}.activatedInProfiles`,
        'G capability claims cannot be activated in profiles.',
      ));
    }
    const expected = HATCH_G_LETTERING_CAPABILITY_CLAIMS.find(item => item.claimId === claim.claimId);
    if (expected && !deepEqual(claim, expected)) {
      errors.push(issue(
        'HATCH_CAPABILITY_CLAIM_G_CONTENT_MISMATCH',
        path,
        `G capability claim ${claim.claimId} differs from its accredited contract.`,
      ));
    }
  });
  const totals = countsFor(claims);
  if (!deepEqual(totals, EXPECTED_G_TOTALS)) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_G_TOTALS_INVALID',
      'letteringG',
      'G capability claim totals do not match the accredited distribution.',
    ));
  }
}

export function validateHatchEvidenceCapabilityClaims(
  contract = HATCH_EVIDENCE_CAPABILITY_CLAIMS,
  { rules = EXPECTED_RULES, byId = null } = {},
) {
  const errors = [];
  if (contract?.version !== 'engine-v2-hatch-capability-claims-r1') {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_VERSION_INVALID',
      'version',
      'Capability claim contract version is invalid.',
    ));
  }
  if (contract?.productionIntegration !== false) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_REGISTRY_INTEGRATION_FORBIDDEN',
      'productionIntegration',
      'The capability claim contract cannot declare production integration.',
    ));
  }
  const referenceRules = Array.isArray(rules) ? rules : [];
  validateRuleClaims(contract?.rulesAF, referenceRules, errors);
  validateLetteringClaims(contract?.letteringG, errors);
  const gIds = new Set(EXPECTED_G_IDS);
  const gInRules = referenceRules.some(rule => rule?.phase === 'G_Lettering' || gIds.has(rule?.id));
  const byIdKeys = byId && typeof byId === 'object' ? Object.keys(byId) : [];
  if (gInRules || byIdKeys.some(id => id === 'G_Lettering' || gIds.has(id))) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_G_RULE_INTEGRATION_FORBIDDEN',
      gInRules ? 'rules' : 'byId',
      'G capability claims must remain outside registry rules and byId.',
    ));
  }
  if (!deepEqual(contract, HATCH_EVIDENCE_CAPABILITY_CLAIMS)) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_CONTRACT_MISMATCH',
      'capabilityClaims',
      'Capability claim contract differs from the accredited immutable contract.',
    ));
  }
  if (!isDeeplyFrozen(contract)) {
    errors.push(issue(
      'HATCH_CAPABILITY_CLAIM_NOT_DEEPLY_FROZEN',
      'capabilityClaims',
      'The complete capability claim graph must be deeply frozen.',
    ));
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function getHatchEvidenceCapabilityClaim(identity) {
  const claim = HATCH_A_F_CAPABILITY_CLAIMS.find(item => item.ruleId === identity)
    ?? HATCH_G_LETTERING_CAPABILITY_CLAIMS.find(item => item.claimId === identity)
    ?? null;
  return claim === null ? null : deepFreeze(clone(claim));
}

export function getHatchEvidenceCapabilityClaimsByPhase(phase) {
  return deepFreeze(clone([
    ...HATCH_A_F_CAPABILITY_CLAIMS.filter(claim => claim.phase === phase),
    ...HATCH_G_LETTERING_CAPABILITY_CLAIMS.filter(claim => claim.phase === phase),
  ]));
}

export function summarizeHatchEvidenceCapabilityClaims(scope = 'rulesAF') {
  const claims = scope === 'letteringG'
    ? HATCH_G_LETTERING_CAPABILITY_CLAIMS
    : scope === 'all'
      ? [...HATCH_A_F_CAPABILITY_CLAIMS, ...HATCH_G_LETTERING_CAPABILITY_CLAIMS]
      : HATCH_A_F_CAPABILITY_CLAIMS;
  return deepFreeze(clone(countsFor(claims)));
}
