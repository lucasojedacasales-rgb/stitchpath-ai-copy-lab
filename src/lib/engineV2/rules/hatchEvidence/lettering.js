import { HATCH_MASTER_A_G_EVIDENCE_SOURCE } from './model.js';

const G_LETTERING_ARTIFACT_PATH = '07_LETTERING/06_Reglas/HATCH-G-LETTERING-reglas-candidatas.json';
const G_LETTERING_ARTIFACT_SHA256 = '94e84eeb4756d1274b037911a3daa83e1e6532e2895e409d64752ad4556d635e';
const G_LETTERING_SCHEMA = 'stitchpath-hatch-lettering-candidates-r1';
const G_LETTERING_STATUS = 'closed-digital-pending-physical-validation';
const G_LETTERING_FAMILIES = Object.freeze(['block', 'serif', 'script']);

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
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
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

function containsForbiddenRuleShape(value) {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'id') || Object.hasOwn(value, 'rules')) return true;
  return Object.values(value).some(containsForbiddenRuleShape);
}

/**
 * Builds a detached, deeply immutable lettering evidence record.
 * This constructor is intentionally not re-exported by the package index.
 * @param {object} input
 * @returns {Readonly<object>}
 */
export function defineHatchGLetteringEvidence(input) {
  return deepFreeze(clone(input));
}

const AUTHORITATIVE_G_LETTERING_INPUT = {
  schema: G_LETTERING_SCHEMA,
  phase: 'G_Lettering',
  sourcePhase: 'G',
  source: {
    ...HATCH_MASTER_A_G_EVIDENCE_SOURCE,
    artifactPath: G_LETTERING_ARTIFACT_PATH,
    artifactSha256: G_LETTERING_ARTIFACT_SHA256,
  },
  status: G_LETTERING_STATUS,
  productionIntegration: false,
  activatedInProfiles: [],
  fabric: 'Pure Cotton',
  selectionOrder: [
    'requested_style',
    'target_height_mm',
    'case_and_character_set',
    'compatible_alphabet',
    'construction_strategy',
    'manual_review_if_no_valid_combination',
  ],
  globalRules: [
    'Hatch generation success is not proof that a height is valid.',
    'Hatch does not substitute another alphabet when a lettering object is scaled outside its natural range.',
    'Nominal height is not interchangeable with generated glyph height.',
    'Uppercase, lowercase, descenders and diacritics must be evaluated separately.',
    'Every result below its safe minimum requires manual review until physical validation is complete.',
  ],
  families: {
    block: {
      primaryAlphabet: 'Small Block1',
      alternativeAlphabet: 'Small Block2',
      naturalRangeMm: [4, 6],
      uppercase: {
        conditionalMinimumMm: 4,
        recommendedMinimumMm: 5,
      },
      mixedCase: {
        conditionalMinimumMm: 4,
        recommendedMinimumMm: 5,
      },
      observedTechnique: 'satin',
      observedTechniqueRangeMm: [3, 12],
      automaticAlphabetOrTechniqueSubstitutionObserved: false,
    },
    serif: {
      primaryAlphabet: 'Small Serif1',
      naturalRangeMm: [4, 6],
      uppercase: {
        conditionalMinimumMm: 4,
        recommendedMinimumMm: 5,
        preferredMm: 6,
      },
      mixedCase: {
        conditionalMinimumMm: 5,
        recommendedMinimumMm: 6,
        preferredMm: 8,
      },
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
      word: {
        conditionalMinimumMm: 5,
        recommendedMinimumMm: 6,
        preferredMm: 8,
      },
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
  },
  defaultAutomaticSettingsObserved: {
    stitch: 'satin',
    spacing: 'automatic',
    pullCompensationMm: 0.2,
    connectorJumpMm: 7.0,
    initialTie: 'off',
    finalTie: 'always-method-1-1mm-x2',
    trimWhenNextConnectorAtLeastMm: 2.0,
  },
  blockedActions: [
    'Do not modify Base44.',
    'Do not connect these rules to the production engine.',
    'Do not treat digitally accepted minimums as physically validated.',
  ],
};

export const HATCH_G_LETTERING_EVIDENCE = defineHatchGLetteringEvidence(AUTHORITATIVE_G_LETTERING_INPUT);

export function validateHatchGLetteringEvidence(evidence = HATCH_G_LETTERING_EVIDENCE) {
  const errors = [];
  if (evidence?.schema !== G_LETTERING_SCHEMA) errors.push({ code: 'HATCH_G_EVIDENCE_SCHEMA_INVALID' });
  if (evidence?.phase !== 'G_Lettering' || evidence?.sourcePhase !== 'G') errors.push({ code: 'HATCH_G_EVIDENCE_PHASE_INVALID' });
  if (!deepEqual(evidence?.source && {
    packageName: evidence.source.packageName,
    packageSha256: evidence.source.packageSha256,
    packageByteLength: evidence.source.packageByteLength,
    updated: evidence.source.updated,
    productionIntegration: evidence.source.productionIntegration,
    base44OriginalModified: evidence.source.base44OriginalModified,
  }, HATCH_MASTER_A_G_EVIDENCE_SOURCE)) errors.push({ code: 'HATCH_G_EVIDENCE_SOURCE_INVALID' });
  if (evidence?.source?.artifactPath !== G_LETTERING_ARTIFACT_PATH) errors.push({ code: 'HATCH_G_EVIDENCE_ARTIFACT_PATH_INVALID' });
  if (evidence?.source?.artifactSha256 !== G_LETTERING_ARTIFACT_SHA256) errors.push({ code: 'HATCH_G_EVIDENCE_ARTIFACT_HASH_INVALID' });
  if (evidence?.status !== G_LETTERING_STATUS) errors.push({ code: 'HATCH_G_EVIDENCE_STATUS_INVALID' });
  if (evidence?.productionIntegration !== false) errors.push({ code: 'HATCH_G_EVIDENCE_PRODUCTION_INTEGRATION_FORBIDDEN' });
  if (!Array.isArray(evidence?.activatedInProfiles) || evidence.activatedInProfiles.length !== 0) {
    errors.push({ code: 'HATCH_G_EVIDENCE_PROFILE_ACTIVATION_FORBIDDEN' });
  }
  if (containsForbiddenRuleShape(evidence)) errors.push({ code: 'HATCH_G_EVIDENCE_FLAT_RULE_SHAPE_FORBIDDEN' });
  if (!Array.isArray(evidence?.selectionOrder) || evidence.selectionOrder.length !== 6) {
    errors.push({ code: 'HATCH_G_EVIDENCE_SELECTION_ORDER_INVALID' });
  }
  if (!Array.isArray(evidence?.globalRules) || evidence.globalRules.length !== 5) {
    errors.push({ code: 'HATCH_G_EVIDENCE_GLOBAL_RULES_INVALID' });
  }
  if (!evidence?.families
    || !deepEqual(Object.keys(evidence.families).sort(), [...G_LETTERING_FAMILIES].sort())) {
    errors.push({ code: 'HATCH_G_EVIDENCE_FAMILIES_INVALID' });
  }
  if (!deepEqual(evidence, HATCH_G_LETTERING_EVIDENCE)) errors.push({ code: 'HATCH_G_EVIDENCE_CONTENT_MISMATCH' });
  if (!isDeeplyFrozen(evidence)) errors.push({ code: 'HATCH_G_EVIDENCE_NOT_DEEPLY_FROZEN' });
  return { valid: errors.length === 0, errors, warnings: [] };
}
