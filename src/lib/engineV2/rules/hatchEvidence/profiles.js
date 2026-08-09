import { validateTechnicalPlanningConfig } from '../../technical/technicalPlanningConfig.js';

const SATIN_RANGE_RULE_ID = 'SATIN-RANGE-OBSERVED-001';
const LOCAL_WIDTH_RULE_ID = 'LOCAL-WIDTH-PROFILE-001';
const HOLE_PRESERVE_RULE_ID = 'HOLE-PRESERVE-001';
const HOLE_MIN_SIZE_RULE_ID = 'HOLE-MIN-SIZE-001';

export const HATCH_EVIDENCE_PROFILES = Object.freeze(['legacy', 'hatch-a-f-experimental']);
export const DEFAULT_HATCH_EVIDENCE_PROFILE = 'legacy';
export const HATCH_EVIDENCE_RULE_IDS = Object.freeze([
  SATIN_RANGE_RULE_ID,
  LOCAL_WIDTH_RULE_ID,
  HOLE_PRESERVE_RULE_ID,
  HOLE_MIN_SIZE_RULE_ID,
]);
export const DEFAULT_HATCH_EVIDENCE_RULE_FLAGS = Object.freeze(
  Object.fromEntries(HATCH_EVIDENCE_RULE_IDS.map(ruleId => [ruleId, false])),
);
export const HATCH_EVIDENCE_CONTEXT_FIELDS = Object.freeze([
  'fabricProfile',
  'referenceScaleCompatible',
]);
export const HATCH_EVIDENCE_CONTROLLED_OPT_IN_MODE = 'controlled-opt-in';
export const HATCH_EVIDENCE_ACTIVATION_MODES = Object.freeze([
  HATCH_EVIDENCE_CONTROLLED_OPT_IN_MODE,
]);

const CONTROLLED_OPERATIONAL_RULE_IDS = Object.freeze(
  HATCH_EVIDENCE_RULE_IDS.filter(ruleId => [SATIN_RANGE_RULE_ID, HOLE_MIN_SIZE_RULE_ID].includes(ruleId)),
);
const CONTROLLED_DIAGNOSTIC_RULE_IDS = Object.freeze(
  HATCH_EVIDENCE_RULE_IDS.filter(ruleId => [LOCAL_WIDTH_RULE_ID, HOLE_PRESERVE_RULE_ID].includes(ruleId)),
);

export const HATCH_EVIDENCE_CONTROLLED_OPT_IN_POLICY = Object.freeze({
  activationMode: HATCH_EVIDENCE_CONTROLLED_OPT_IN_MODE,
  operationalRuleIds: CONTROLLED_OPERATIONAL_RULE_IDS,
  diagnosticRuleIds: CONTROLLED_DIAGNOSTIC_RULE_IDS,
  mutuallyExclusiveOperationalRuleIds: CONTROLLED_OPERATIONAL_RULE_IDS,
  defaultEnabled: false,
  allOnAllowed: false,
  productionIntegration: false,
});

const CONTROLLED_FALLBACK_REASON_CODE_PRECEDENCE = Object.freeze([
  'INVALID_HATCH_EVIDENCE_ACTIVATION_MODE',
  'HATCH_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE',
  'HATCH_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN',
  'HATCH_CONTROLLED_OPT_IN_OPERATIONAL_CONFLICT',
  'INVALID_HATCH_EVIDENCE_PROFILE',
  'INVALID_HATCH_EVIDENCE_RULE_FLAGS',
  'UNKNOWN_HATCH_EVIDENCE_RULE_FLAG',
  'INVALID_HATCH_EVIDENCE_RULE_FLAG_VALUE',
  'HATCH_EVIDENCE_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE',
  'INVALID_HATCH_EVIDENCE_CONTEXT',
  'UNKNOWN_HATCH_EVIDENCE_CONTEXT_FIELD',
  'MISSING_HATCH_EVIDENCE_FABRIC',
  'MISSING_HATCH_EVIDENCE_SCALE_COMPATIBILITY',
  'INVALID_HATCH_EVIDENCE_FABRIC',
  'INVALID_HATCH_EVIDENCE_SCALE_COMPATIBILITY',
  'MISSING_HATCH_EFFECTIVE_TECHNICAL_CONFIG',
  'INVALID_HATCH_EFFECTIVE_TECHNICAL_CONFIG',
  'INVALID_HATCH_EFFECTIVE_SATIN_MAXIMUM',
  'HATCH_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES',
]);

function sourceFor(config = {}) {
  const extras = config?.extras && typeof config.extras === 'object' ? config.extras : {};
  const explicit = field => Object.hasOwn(config || {}, field) ? config[field] : extras[field];
  return {
    profile: explicit('hatchEvidenceProfile'),
    context: explicit('hatchEvidenceContext'),
    ruleFlags: explicit('hatchEvidenceRuleFlags'),
    activationMode: explicit('hatchEvidenceActivationMode'),
  };
}

function flagsAreObject(source) {
  return Boolean(source.ruleFlags)
    && typeof source.ruleFlags === 'object'
    && !Array.isArray(source.ruleFlags);
}

function controlledPolicyPrecedenceError(source) {
  if (source.activationMode === undefined) return null;
  if (!HATCH_EVIDENCE_ACTIVATION_MODES.includes(source.activationMode)) {
    return {
      code: 'INVALID_HATCH_EVIDENCE_ACTIVATION_MODE',
      path: 'hatchEvidenceActivationMode',
      message: 'Hatch evidence activation mode must be controlled-opt-in when explicitly provided.',
    };
  }
  if (source.profile !== 'hatch-a-f-experimental') {
    return {
      code: 'HATCH_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE',
      path: 'hatchEvidenceProfile',
      message: 'Controlled Hatch opt-in requires the explicit hatch-a-f-experimental profile.',
    };
  }
  if (!flagsAreObject(source)) return null;
  const allOn = HATCH_EVIDENCE_RULE_IDS.every(ruleId => source.ruleFlags[ruleId] === true);
  if (allOn) {
    return {
      code: 'HATCH_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN',
      path: 'hatchEvidenceRuleFlags',
      message: 'ALL-ON is forbidden in controlled Hatch opt-in.',
    };
  }
  if (source.ruleFlags[SATIN_RANGE_RULE_ID] === true
    && source.ruleFlags[HOLE_MIN_SIZE_RULE_ID] === true) {
    return {
      code: 'HATCH_CONTROLLED_OPT_IN_OPERATIONAL_CONFLICT',
      path: 'hatchEvidenceRuleFlags',
      message: 'SATIN-RANGE and HOLE-MIN-SIZE cannot be enabled together in controlled Hatch opt-in.',
    };
  }
  return null;
}

function ordinalCodeCompare(left, right) {
  const leftCode = String(left);
  const rightCode = String(right);
  if (leftCode < rightCode) return -1;
  if (leftCode > rightCode) return 1;
  return 0;
}

export function canonicalizeHatchEvidenceControlledFallbackReasonCodes(reasonCodes = []) {
  const uniqueCodes = [...new Set(reasonCodes)];
  const knownCodes = CONTROLLED_FALLBACK_REASON_CODE_PRECEDENCE
    .filter(code => uniqueCodes.includes(code));
  const futureCodes = uniqueCodes
    .filter(code => !CONTROLLED_FALLBACK_REASON_CODE_PRECEDENCE.includes(code))
    .sort(ordinalCodeCompare);
  return Object.freeze([...knownCodes, ...futureCodes]);
}

function controlledPolicyResult({
  operationalRuleIds = [],
  diagnosticRuleIds = [],
  effectiveRuleIds = [],
  fallbackToLegacy = false,
  fallbackReasonCodes = [],
} = {}) {
  return Object.freeze({
    operationalRuleIds: Object.freeze([...operationalRuleIds]),
    diagnosticRuleIds: Object.freeze([...diagnosticRuleIds]),
    effectiveRuleIds: Object.freeze([...effectiveRuleIds]),
    fallbackToLegacy,
    fallbackReasonCodes: canonicalizeHatchEvidenceControlledFallbackReasonCodes(fallbackReasonCodes),
  });
}

function resolveRuleFlags(profile, sourceFlags) {
  const requested = sourceFlags && typeof sourceFlags === 'object' && !Array.isArray(sourceFlags) ? sourceFlags : {};
  return Object.freeze(Object.fromEntries(HATCH_EVIDENCE_RULE_IDS.map(ruleId => [
    ruleId,
    profile === 'hatch-a-f-experimental' && requested[ruleId] === true,
  ])));
}

export function resolveHatchEvidenceIntegrationConfig(config = {}) {
  const source = sourceFor(config);
  const profile = HATCH_EVIDENCE_PROFILES.includes(source.profile) ? source.profile : DEFAULT_HATCH_EVIDENCE_PROFILE;
  const rawContext = source.context && typeof source.context === 'object' && !Array.isArray(source.context) ? source.context : {};
  const ruleFlags = resolveRuleFlags(profile, source.ruleFlags);
  return Object.freeze({
    profile,
    ruleFlags,
    enabledRuleIds: Object.freeze(HATCH_EVIDENCE_RULE_IDS.filter(ruleId => ruleFlags[ruleId])),
    context: Object.freeze({
      fabricProfile: typeof rawContext.fabricProfile === 'string' ? rawContext.fabricProfile : null,
      referenceScaleCompatible: typeof rawContext.referenceScaleCompatible === 'boolean'
        ? rawContext.referenceScaleCompatible
        : null,
    }),
  });
}

export function validateHatchEvidenceIntegrationConfig(config = {}, options = {}) {
  const source = sourceFor(config); const errors = [];
  const contextIsObject = Boolean(source.context)
    && typeof source.context === 'object'
    && !Array.isArray(source.context);
  const ruleFlagsAreObject = flagsAreObject(source);
  const enabledRuleIds = source.profile === 'hatch-a-f-experimental' && ruleFlagsAreObject
    ? HATCH_EVIDENCE_RULE_IDS.filter(ruleId => source.ruleFlags[ruleId] === true)
    : [];
  const controlledPolicyError = controlledPolicyPrecedenceError(source);
  if (controlledPolicyError) errors.push(controlledPolicyError);
  if (source.profile !== undefined && !HATCH_EVIDENCE_PROFILES.includes(source.profile)) errors.push({ code: 'INVALID_HATCH_EVIDENCE_PROFILE', path: 'hatchEvidenceProfile', message: 'Hatch evidence profile must be legacy or hatch-a-f-experimental.' });
  if (source.context !== undefined && !contextIsObject) errors.push({ code: 'INVALID_HATCH_EVIDENCE_CONTEXT', path: 'hatchEvidenceContext', message: 'Hatch evidence context must be an object.' });
  if (contextIsObject) {
    Object.keys(source.context)
      .filter(field => !HATCH_EVIDENCE_CONTEXT_FIELDS.includes(field))
      .forEach(field => errors.push({
        code: 'UNKNOWN_HATCH_EVIDENCE_CONTEXT_FIELD',
        path: `hatchEvidenceContext.${field}`,
        message: `Unknown Hatch evidence context field: ${field}.`,
      }));
  }
  if (source.context?.fabricProfile !== undefined
    && (typeof source.context.fabricProfile !== 'string' || !source.context.fabricProfile.trim())) {
    errors.push({ code: 'INVALID_HATCH_EVIDENCE_FABRIC', path: 'hatchEvidenceContext.fabricProfile', message: 'Hatch evidence fabric profile must be a non-empty string.' });
  }
  if (source.context?.referenceScaleCompatible !== undefined && typeof source.context.referenceScaleCompatible !== 'boolean') errors.push({ code: 'INVALID_HATCH_EVIDENCE_SCALE_COMPATIBILITY', path: 'hatchEvidenceContext.referenceScaleCompatible', message: 'Hatch evidence scale compatibility must be boolean.' });
  if (source.ruleFlags !== undefined && !ruleFlagsAreObject) {
    errors.push({ code: 'INVALID_HATCH_EVIDENCE_RULE_FLAGS', path: 'hatchEvidenceRuleFlags', message: 'Hatch evidence rule flags must be an object.' });
  } else if (ruleFlagsAreObject) {
    Object.entries(source.ruleFlags).forEach(([ruleId, enabled]) => {
      if (!HATCH_EVIDENCE_RULE_IDS.includes(ruleId)) errors.push({ code: 'UNKNOWN_HATCH_EVIDENCE_RULE_FLAG', path: `hatchEvidenceRuleFlags.${ruleId}`, message: `Unknown Hatch evidence rule flag: ${ruleId}.` });
      else if (typeof enabled !== 'boolean') errors.push({ code: 'INVALID_HATCH_EVIDENCE_RULE_FLAG_VALUE', path: `hatchEvidenceRuleFlags.${ruleId}`, message: 'Hatch evidence rule flags must be boolean.' });
      else if (enabled && source.profile !== 'hatch-a-f-experimental') errors.push({ code: 'HATCH_EVIDENCE_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE', path: `hatchEvidenceRuleFlags.${ruleId}`, message: 'Hatch evidence rule flags can only be enabled in the experimental profile.' });
    });
  }
  const fabricRequired = enabledRuleIds.some(ruleId => [
    SATIN_RANGE_RULE_ID,
    LOCAL_WIDTH_RULE_ID,
    HOLE_PRESERVE_RULE_ID,
    HOLE_MIN_SIZE_RULE_ID,
  ].includes(ruleId));
  const scaleRequired = enabledRuleIds.some(ruleId => [
    SATIN_RANGE_RULE_ID,
    LOCAL_WIDTH_RULE_ID,
    HOLE_MIN_SIZE_RULE_ID,
  ].includes(ruleId));
  if (fabricRequired && !Object.hasOwn(source.context || {}, 'fabricProfile')) {
    errors.push({ code: 'MISSING_HATCH_EVIDENCE_FABRIC', path: 'hatchEvidenceContext.fabricProfile', message: 'The active Hatch evidence rules require an explicit fabric profile.' });
  }
  if (scaleRequired && !Object.hasOwn(source.context || {}, 'referenceScaleCompatible')) {
    errors.push({ code: 'MISSING_HATCH_EVIDENCE_SCALE_COMPATIBILITY', path: 'hatchEvidenceContext.referenceScaleCompatible', message: 'The active Hatch evidence rules require explicit reference-scale compatibility.' });
  }
  if (enabledRuleIds.includes(SATIN_RANGE_RULE_ID)) {
    const technicalConfig = options.technicalConfig;
    const technicalConfigProvided = Object.hasOwn(options, 'technicalConfig')
      && technicalConfig !== null
      && typeof technicalConfig === 'object'
      && !Array.isArray(technicalConfig);
    if (!technicalConfigProvided) {
      errors.push({
        code: 'MISSING_HATCH_EFFECTIVE_TECHNICAL_CONFIG',
        path: 'technicalConfig',
        message: 'SATIN-RANGE requires the effective technical configuration that will be consumed by technical planning.',
      });
    } else {
      const technicalValidation = validateTechnicalPlanningConfig(technicalConfig);
      if (!technicalValidation.valid) {
        errors.push({
          code: 'INVALID_HATCH_EFFECTIVE_TECHNICAL_CONFIG',
          path: 'technicalConfig',
          message: 'SATIN-RANGE requires a valid effective technical configuration.',
        });
      }
      if (!Number.isFinite(technicalValidation.config?.satin?.maximumWidthMm)
        || technicalValidation.config.satin.maximumWidthMm <= 0) {
        errors.push({
          code: 'INVALID_HATCH_EFFECTIVE_SATIN_MAXIMUM',
          path: 'technicalConfig.satin.maximumWidthMm',
          message: 'The effective technical satin maximum must be finite and greater than zero.',
        });
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: [], config: resolveHatchEvidenceIntegrationConfig(config) };
}

export function resolveHatchEvidenceControlledOptInPolicy(config = {}, options = {}) {
  const source = sourceFor(config);
  if (source.activationMode === undefined) return controlledPolicyResult();

  const precedenceError = controlledPolicyPrecedenceError(source);
  if (precedenceError) {
    return controlledPolicyResult({
      fallbackToLegacy: true,
      fallbackReasonCodes: [precedenceError.code],
    });
  }

  const validation = validateHatchEvidenceIntegrationConfig(config, options);
  if (!validation.valid) {
    return controlledPolicyResult({
      fallbackToLegacy: true,
      fallbackReasonCodes: [...new Set(validation.errors.map(error => error.code))],
    });
  }

  const enabledRuleIds = validation.config.enabledRuleIds;
  const operationalRuleIds = HATCH_EVIDENCE_RULE_IDS.filter(ruleId => (
    enabledRuleIds.includes(ruleId) && CONTROLLED_OPERATIONAL_RULE_IDS.includes(ruleId)
  ));
  const diagnosticRuleIds = HATCH_EVIDENCE_RULE_IDS.filter(ruleId => (
    enabledRuleIds.includes(ruleId) && CONTROLLED_DIAGNOSTIC_RULE_IDS.includes(ruleId)
  ));
  const effectiveRuleIds = HATCH_EVIDENCE_RULE_IDS.filter(ruleId => (
    operationalRuleIds.includes(ruleId) || diagnosticRuleIds.includes(ruleId)
  ));
  if (!effectiveRuleIds.length) {
    return controlledPolicyResult({
      fallbackToLegacy: true,
      fallbackReasonCodes: ['HATCH_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES'],
    });
  }
  return controlledPolicyResult({ operationalRuleIds, diagnosticRuleIds, effectiveRuleIds });
}

export function hatchEvidenceExperimentalEnabled(config = {}) {
  return resolveHatchEvidenceIntegrationConfig(config).profile === 'hatch-a-f-experimental';
}

export function hatchEvidenceRuleEnabled(config = {}, ruleId) {
  return resolveHatchEvidenceIntegrationConfig(config).ruleFlags[ruleId] === true;
}

export function hatchEvidenceContextMatchesPureCotton(context = {}) {
  return String(context.fabricProfile || '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'pure_cotton';
}
