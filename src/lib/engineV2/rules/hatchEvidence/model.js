/**
 * @typedef {'A_Anchuras'|'B_Huecos'|'C_Solapes'|'D_Técnicas'|'E_Telas'|'F_Escalado'} HatchEvidenceRulePhase
 * @typedef {HatchEvidenceRulePhase|'G_Lettering'} HatchEvidenceRegistryPhase
 * @typedef {number|'high'|'medium'|'low'|null} HatchEvidenceConfidence
 * @typedef {object} HatchEvidenceRule
 * @property {string} id
 * @property {HatchEvidenceRulePhase} phase
 * @property {object} source
 * @property {unknown} condition
 * @property {unknown} candidateAction
 * @property {HatchEvidenceConfidence} confidence
 * @property {readonly string[]} limits
 * @property {'candidate'} state
 * @property {readonly string[]} notes
 * @property {readonly string[]} activatedInProfiles
 */

export const HATCH_MASTER_A_F_EVIDENCE_SOURCE = Object.freeze({
  packageName: 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F.zip',
  packageSha256: 'd2ca1f36db18a6d48fe8d471f66d4cf1f96e2804ca65979d57752e97812bf8e3',
  packageByteLength: 320891578,
  capturedAt: '2026-07-24',
});

export const HATCH_MASTER_A_G_EVIDENCE_SOURCE = Object.freeze({
  packageName: 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_G.zip',
  packageSha256: '9cc0c06372ed371716d50915d26c5625f5e40ba0165ee52c38ecae51dff3b96f',
  packageByteLength: 486734439,
  updated: '2026-07-25',
  productionIntegration: false,
  base44OriginalModified: false,
});

// Backwards-compatible alias for the historical A-F rule provenance.
export const HATCH_MASTER_EVIDENCE_SOURCE = HATCH_MASTER_A_F_EVIDENCE_SOURCE;

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/**
 * Normalizes package records without upgrading their evidentiary status.
 * @param {object} input
 * @returns {readonly HatchEvidenceRule[]}
 */
export function defineHatchEvidenceRules(input) {
  return deepFreeze((input.rules || []).map(rule => ({
    id: rule.id,
    phase: input.phase,
    source: {
      ...HATCH_MASTER_EVIDENCE_SOURCE,
      artifactPath: input.artifactPath,
      artifactSha256: input.artifactSha256,
      phaseStatus: input.phaseStatus,
      sourceRuleStatus: rule.sourceState ?? null,
      evidence: clone(rule.evidence ?? null),
    },
    condition: clone(rule.condition ?? null),
    candidateAction: clone(rule.candidateAction ?? null),
    confidence: rule.confidence ?? null,
    limits: [...(input.limits || []), ...(rule.limits || [])],
    state: 'candidate',
    notes: [...(rule.notes || [])],
    activatedInProfiles: Array.isArray(rule.activatedInProfiles)
      ? [...rule.activatedInProfiles]
      : Array.isArray(input.activatedInProfiles)
        ? [...input.activatedInProfiles]
        : input.implementationActive === true && rule.implementationActive === true
          ? ['hatch-a-f-experimental']
          : [],
  })));
}

export function validateHatchEvidenceRule(rule) {
  const errors = [];
  ['id', 'phase', 'source', 'condition', 'candidateAction', 'confidence', 'limits', 'state', 'notes'].forEach(field => {
    if (!Object.hasOwn(rule || {}, field)) errors.push({ code: 'HATCH_EVIDENCE_FIELD_MISSING', field });
  });
  if (rule?.state !== 'candidate') errors.push({ code: 'HATCH_EVIDENCE_RULE_NOT_CANDIDATE', field: 'state' });
  if (!Array.isArray(rule?.limits) || !Array.isArray(rule?.notes)) errors.push({ code: 'HATCH_EVIDENCE_TRACE_ARRAY_INVALID', field: 'limits' });
  if (rule?.source?.packageSha256 !== HATCH_MASTER_EVIDENCE_SOURCE.packageSha256) errors.push({ code: 'HATCH_EVIDENCE_PACKAGE_HASH_MISMATCH', field: 'source.packageSha256' });
  return { valid: errors.length === 0, errors };
}
