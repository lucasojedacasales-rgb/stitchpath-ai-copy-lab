import {
  HATCH_EVIDENCE_RULE_IDS,
  validateHatchEvidenceIntegrationConfig,
} from './profiles.js';

const CONTOUR_LAST_RULE_ID = 'CONTOUR-LAST-001';
const COLOR_GROUP_HEURISTIC_RULE_ID = 'COLOR-GROUP-HEURISTIC-001';
const MULTILAYER_DEPENDENCY_RULE_ID = 'MULTILAYER-DEPENDENCY-001';

export const HATCH_OVERLAP_PROFILES = Object.freeze(['legacy', 'hatch-c-experimental']);
export const DEFAULT_HATCH_OVERLAP_PROFILE = 'legacy';
export const HATCH_OVERLAP_RULE_IDS = Object.freeze([
  CONTOUR_LAST_RULE_ID,
  COLOR_GROUP_HEURISTIC_RULE_ID,
  MULTILAYER_DEPENDENCY_RULE_ID,
]);
export const DEFAULT_HATCH_OVERLAP_RULE_FLAGS = Object.freeze({
  [CONTOUR_LAST_RULE_ID]: false,
  [COLOR_GROUP_HEURISTIC_RULE_ID]: false,
  [MULTILAYER_DEPENDENCY_RULE_ID]: false,
});
export const HATCH_OVERLAP_CONTROLLED_OPT_IN_MODE = 'controlled-opt-in';
export const HATCH_OVERLAP_ACTIVATION_MODES = Object.freeze([
  HATCH_OVERLAP_CONTROLLED_OPT_IN_MODE,
]);
export const HATCH_OVERLAP_CONFIG_FIELDS = Object.freeze([
  'hatchOverlapProfile',
  'hatchOverlapRuleFlags',
  'hatchOverlapActivationMode',
]);

const CONTROLLED_OPERATIONAL_RULE_IDS = Object.freeze([CONTOUR_LAST_RULE_ID]);
const CONTROLLED_DIAGNOSTIC_RULE_IDS = Object.freeze([]);
const CONTROLLED_UNAUTHORIZED_RULE_IDS = Object.freeze([
  COLOR_GROUP_HEURISTIC_RULE_ID,
  MULTILAYER_DEPENDENCY_RULE_ID,
]);

export const HATCH_OVERLAP_CONTROLLED_OPT_IN_POLICY = Object.freeze({
  activationMode: HATCH_OVERLAP_CONTROLLED_OPT_IN_MODE,
  internal: true,
  experimental: true,
  operationalRuleIds: CONTROLLED_OPERATIONAL_RULE_IDS,
  diagnosticRuleIds: CONTROLLED_DIAGNOSTIC_RULE_IDS,
  unauthorizedRuleIds: CONTROLLED_UNAUTHORIZED_RULE_IDS,
  defaultEnabled: false,
  allOnAllowed: false,
  crossPhaseCombinationsAllowed: false,
  productionIntegration: false,
});

const CONTROLLED_FALLBACK_REASON_CODE_PRECEDENCE = Object.freeze([
  'INVALID_HATCH_OVERLAP_ACTIVATION_MODE',
  'HATCH_OVERLAP_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE',
  'HATCH_OVERLAP_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN',
  'HATCH_OVERLAP_CONTROLLED_OPT_IN_MULTIPLE_RULES_FORBIDDEN',
  'HATCH_OVERLAP_CONTROLLED_OPT_IN_RULE_NOT_AUTHORIZED',
  'UNKNOWN_HATCH_OVERLAP_CONFIG_FIELD',
  'INVALID_HATCH_OVERLAP_PROFILE',
  'INVALID_HATCH_OVERLAP_RULE_FLAGS',
  'UNKNOWN_HATCH_OVERLAP_RULE_FLAG',
  'INVALID_HATCH_OVERLAP_RULE_FLAG_VALUE',
  'HATCH_OVERLAP_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE',
  'HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_SOURCE_INVALID',
  'HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_COMBINATION_FORBIDDEN',
  'HATCH_OVERLAP_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES',
]);

function classifyExternalRecord(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'other';
    return 'record';
  } catch {
    return 'hostile';
  }
}

const IGNORED_HATCH_EVIDENCE_TECHNICAL_ERROR_CODES = Object.freeze([
  'MISSING_HATCH_EFFECTIVE_TECHNICAL_CONFIG',
  'INVALID_HATCH_EFFECTIVE_TECHNICAL_CONFIG',
  'INVALID_HATCH_EFFECTIVE_SATIN_MAXIMUM',
]);

function inspectExternalRecord(value, { requirePlainPrototype = false } = {}) {
  try {
    const kind = classifyExternalRecord(value);
    if (kind !== 'record') {
      return {
        valid: false,
        hostile: kind === 'hostile',
        plainPrototype: false,
        descriptors: Object.create(null),
        keys: [],
      };
    }
    const prototype = Object.getPrototypeOf(value);
    const plainPrototype = prototype === Object.prototype || prototype === null;
    if (requirePlainPrototype && !plainPrototype) {
      return {
        valid: false,
        hostile: false,
        plainPrototype,
        descriptors: Object.create(null),
        keys: [],
      };
    }
    const keys = Reflect.ownKeys(value);
    const descriptors = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) {
        return {
          valid: false,
          hostile: true,
          plainPrototype,
          descriptors: Object.create(null),
          keys: [],
        };
      }
      descriptors[key] = descriptor;
    }
    return { valid: true, hostile: false, plainPrototype, descriptors, keys };
  } catch {
    return {
      valid: false,
      hostile: true,
      plainPrototype: false,
      descriptors: Object.create(null),
      keys: [],
    };
  }
}

function controlledRecordShapeIsSafe(inspection) {
  return inspection.valid
    && inspection.plainPrototype
    && inspection.keys.every(key => {
      if (typeof key !== 'string') return false;
      const descriptor = inspection.descriptors[key];
      return Boolean(descriptor)
        && Object.hasOwn(descriptor, 'value')
        && descriptor.enumerable === true;
    });
}

function dataField(inspection, field) {
  if (!inspection.valid || !Object.hasOwn(inspection.descriptors, field)) {
    return { present: false, valid: inspection.valid, value: undefined };
  }
  const descriptor = inspection.descriptors[field];
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    return { present: true, valid: false, value: undefined };
  }
  return { present: true, valid: true, value: descriptor.value };
}

function inspectConfig(config = {}) {
  const sourceKind = classifyExternalRecord(config);
  if (sourceKind === 'hostile') {
    return { valid: false, source: {}, root: { valid: false }, extras: { valid: false } };
  }
  const source = sourceKind === 'record' ? config : {};
  const root = inspectExternalRecord(source);
  if (!root.valid) return { valid: false, source, root, extras: { valid: false } };
  const extrasField = dataField(root, 'extras');
  if (!extrasField.valid) return { valid: false, source, root, extras: { valid: false } };
  const extrasKind = classifyExternalRecord(extrasField.value);
  if (extrasKind === 'hostile') {
    return { valid: false, source, root, extras: { valid: false } };
  }
  const extrasValue = extrasField.present && extrasKind === 'record' ? extrasField.value : {};
  const extras = inspectExternalRecord(extrasValue);
  return {
    valid: extras.valid,
    controlledShapeValid: controlledRecordShapeIsSafe(root)
      && controlledRecordShapeIsSafe(extras),
    source,
    root,
    extras,
  };
}

function configField(view, field) {
  const explicit = dataField(view.root, field);
  if (explicit.present || !explicit.valid) return explicit;
  return dataField(view.extras, field);
}

function copyExternalRecord(value) {
  if (value === undefined) return { valid: true, value };
  const kind = classifyExternalRecord(value);
  if (kind === 'hostile') return { valid: false, value: undefined };
  if (kind !== 'record') return { valid: true, value };
  const inspection = inspectExternalRecord(value, { requirePlainPrototype: true });
  if (!inspection.valid || inspection.keys.some(key => typeof key !== 'string')) {
    return { valid: false, value: undefined };
  }
  const result = Object.create(null);
  for (const key of inspection.keys) {
    const descriptor = inspection.descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      return { valid: false, value: undefined };
    }
    result[key] = descriptor.value;
  }
  return { valid: true, value: result };
}

function sourceFor(config = {}) {
  const view = inspectConfig(config);
  const profile = configField(view, 'hatchOverlapProfile');
  const ruleFlags = configField(view, 'hatchOverlapRuleFlags');
  const activationMode = configField(view, 'hatchOverlapActivationMode');
  const ruleFlagsKind = classifyExternalRecord(ruleFlags.value);
  const ruleFlagsInspection = ruleFlags.valid && ruleFlagsKind === 'record'
    ? inspectExternalRecord(ruleFlags.value, { requirePlainPrototype: true })
    : {
      valid: false,
      hostile: ruleFlagsKind === 'hostile',
      descriptors: Object.create(null),
      keys: [],
    };
  const hatchEvidenceSource = hatchEvidenceCrossPhaseSource(view);
  const rootKeys = view.root.keys || [];
  const extrasKeys = view.extras.keys || [];
  return {
    config: view.source,
    configView: view,
    structureInspectionFailed: !view.valid,
    controlledShapeInvalid: view.valid && view.controlledShapeValid === false,
    profile: profile.value,
    profilePresent: profile.present,
    profileInspectionValid: profile.valid,
    ruleFlags: ruleFlags.value,
    ruleFlagsPresent: ruleFlags.present,
    ruleFlagsFieldInspectionValid: ruleFlags.valid,
    ruleFlagsKind,
    ruleFlagsInspection,
    ruleFlagsInspectionHostile: ruleFlagsKind === 'hostile'
      || ruleFlagsInspection.hostile === true,
    activationMode: activationMode.value,
    activationModePresent: activationMode.present,
    activationModeInspectionValid: activationMode.valid,
    hatchEvidenceSource,
    unknownFields: [...new Set([
      ...rootKeys,
      ...extrasKeys,
    ].filter(field => typeof field === 'string'
      && field.startsWith('hatchOverlap')
      && !HATCH_OVERLAP_CONFIG_FIELDS.includes(field)))].sort(),
  };
}

function ruleFlagValue(inspection, ruleId) {
  const field = dataField(inspection, ruleId);
  return field.valid && field.present ? field.value : undefined;
}

function resolveRuleFlags(profile, inspection) {
  return Object.freeze(Object.fromEntries(HATCH_OVERLAP_RULE_IDS.map(ruleId => [
    ruleId,
    profile === 'hatch-c-experimental' && ruleFlagValue(inspection, ruleId) === true,
  ])));
}

function integrationResult(profile, ruleFlagsInspection) {
  const ruleFlags = resolveRuleFlags(profile, ruleFlagsInspection);
  return Object.freeze({
    profile,
    ruleFlags,
    enabledRuleIds: Object.freeze(HATCH_OVERLAP_RULE_IDS.filter(ruleId => ruleFlags[ruleId])),
  });
}

function resolveHistoricalIntegration(source) {
  const profile = HATCH_OVERLAP_PROFILES.includes(source.profile)
    ? source.profile
    : DEFAULT_HATCH_OVERLAP_PROFILE;
  return integrationResult(profile, source.ruleFlagsInspection);
}

function legacyIntegrationResult() {
  return integrationResult(
    DEFAULT_HATCH_OVERLAP_PROFILE,
    inspectExternalRecord(DEFAULT_HATCH_OVERLAP_RULE_FLAGS),
  );
}

function flagsAreObject(source) {
  return source.ruleFlagsInspection.valid;
}

function enabledKnownRuleIds(source) {
  if (!flagsAreObject(source)) return [];
  return HATCH_OVERLAP_RULE_IDS.filter(ruleId => (
    ruleFlagValue(source.ruleFlagsInspection, ruleId) === true
  ));
}

function hatchEvidenceCrossPhaseSource(configView) {
  if (!configView.valid) return { valid: false, requestedRuleIds: [] };
  const fields = Object.fromEntries([
    'hatchEvidenceProfile',
    'hatchEvidenceContext',
    'hatchEvidenceRuleFlags',
    'hatchEvidenceActivationMode',
  ].map(field => [field, configField(configView, field)]));
  if (Object.values(fields).some(field => !field.valid)) {
    return { valid: false, requestedRuleIds: [] };
  }
  const context = copyExternalRecord(fields.hatchEvidenceContext.value);
  const ruleFlags = copyExternalRecord(fields.hatchEvidenceRuleFlags.value);
  if (!context.valid || !ruleFlags.valid) return { valid: false, requestedRuleIds: [] };
  const sanitized = {};
  Object.keys(fields).forEach(field => {
    if (!fields[field].present) return;
    sanitized[field] = field === 'hatchEvidenceContext'
      ? context.value
      : field === 'hatchEvidenceRuleFlags'
        ? ruleFlags.value
        : fields[field].value;
  });
  try {
    const validation = validateHatchEvidenceIntegrationConfig(sanitized);
    const sourceErrors = validation.errors.filter(error => (
      !IGNORED_HATCH_EVIDENCE_TECHNICAL_ERROR_CODES.includes(error.code)
    ));
    if (sourceErrors.length) return { valid: false, requestedRuleIds: [] };
    const requestedRuleIds = HATCH_EVIDENCE_RULE_IDS.filter(ruleId => (
      ruleFlags.value?.[ruleId] === true
    ));
    return { valid: true, requestedRuleIds };
  } catch {
    return { valid: false, requestedRuleIds: [] };
  }
}

function controlledPolicyPrecedenceError(source) {
  if (source.activationModeInspectionValid
    && source.activationMode !== undefined
    && !HATCH_OVERLAP_ACTIVATION_MODES.includes(source.activationMode)) {
    return {
      code: 'INVALID_HATCH_OVERLAP_ACTIVATION_MODE',
      path: 'hatchOverlapActivationMode',
      message: 'Hatch overlap activation mode must be controlled-opt-in when explicitly provided.',
    };
  }
  const controlledModeConfirmed = source.activationModeInspectionValid
    && source.activationMode === HATCH_OVERLAP_CONTROLLED_OPT_IN_MODE;
  if (controlledModeConfirmed
    && source.profileInspectionValid
    && source.profile !== 'hatch-c-experimental') {
    return {
      code: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE',
      path: 'hatchOverlapProfile',
      message: 'Controlled Hatch overlap opt-in requires the explicit hatch-c-experimental profile.',
    };
  }
  if (!controlledModeConfirmed) return null;
  const enabledRuleIds = enabledKnownRuleIds(source);
  if (enabledRuleIds.length === HATCH_OVERLAP_RULE_IDS.length) {
    return {
      code: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN',
      path: 'hatchOverlapRuleFlags',
      message: 'ALL-ON is forbidden in controlled Hatch overlap opt-in.',
    };
  }
  if (enabledRuleIds.length > 1) {
    return {
      code: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_MULTIPLE_RULES_FORBIDDEN',
      path: 'hatchOverlapRuleFlags',
      message: 'Only one Hatch overlap rule can be enabled in controlled opt-in.',
    };
  }
  if (enabledRuleIds.some(ruleId => CONTROLLED_UNAUTHORIZED_RULE_IDS.includes(ruleId))) {
    return {
      code: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_RULE_NOT_AUTHORIZED',
      path: 'hatchOverlapRuleFlags',
      message: 'Only CONTOUR-LAST-001 is authorized in controlled Hatch overlap opt-in.',
    };
  }
  return null;
}

function controlledSourceInspectionError(source) {
  const sourceInvalid = source.structureInspectionFailed
    || !source.activationModeInspectionValid
    || !source.profileInspectionValid
    || !source.ruleFlagsFieldInspectionValid
    || source.ruleFlagsInspectionHostile
    || source.controlledShapeInvalid;
  if (sourceInvalid) {
    return {
      code: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_SOURCE_INVALID',
      path: 'config',
      message: 'Controlled Hatch overlap opt-in requires safely inspectable plain enumerable string-keyed configuration records.',
    };
  }
  return null;
}

function controlledCrossPhaseError(source) {
  const enabledRuleIds = enabledKnownRuleIds(source);
  if (enabledRuleIds.includes(CONTOUR_LAST_RULE_ID)) {
    const hatchEvidenceSource = source.hatchEvidenceSource;
    if (!hatchEvidenceSource.valid) {
      return {
        code: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_SOURCE_INVALID',
        path: 'hatchEvidence',
        message: 'Invalid or hostile Hatch A/B input cannot be combined with controlled Hatch overlap opt-in.',
      };
    }
    if (hatchEvidenceSource.requestedRuleIds.length > 0) {
      return {
        code: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_COMBINATION_FORBIDDEN',
        path: 'hatchOverlapRuleFlags',
        message: 'Requested Hatch A/B rules cannot be combined with controlled Hatch overlap opt-in.',
      };
    }
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

export function canonicalizeHatchOverlapControlledFallbackReasonCodes(reasonCodes = []) {
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
    fallbackReasonCodes: canonicalizeHatchOverlapControlledFallbackReasonCodes(fallbackReasonCodes),
  });
}

function historicalValidationErrors(source) {
  const errors = [];
  const flagsAreValidObject = flagsAreObject(source);
  source.unknownFields.forEach(field => errors.push({
    code: 'UNKNOWN_HATCH_OVERLAP_CONFIG_FIELD',
    path: field,
    message: `Unknown Hatch overlap configuration field: ${field}.`,
  }));
  if (source.profilePresent
    && source.profileInspectionValid
    && !HATCH_OVERLAP_PROFILES.includes(source.profile)) {
    errors.push({
      code: 'INVALID_HATCH_OVERLAP_PROFILE',
      path: 'hatchOverlapProfile',
      message: 'Hatch overlap profile must be legacy or hatch-c-experimental.',
    });
  }
  if (source.ruleFlagsPresent
    && source.ruleFlagsFieldInspectionValid
    && !flagsAreValidObject
    && !source.ruleFlagsInspectionHostile) {
    errors.push({
      code: 'INVALID_HATCH_OVERLAP_RULE_FLAGS',
      path: 'hatchOverlapRuleFlags',
      message: 'Hatch overlap rule flags must be an object.',
    });
  } else if (flagsAreValidObject) {
    const stringRuleIds = source.ruleFlagsInspection.keys
      .filter(ruleId => typeof ruleId === 'string');
    const orderedRuleIds = [
      ...HATCH_OVERLAP_RULE_IDS.filter(ruleId => stringRuleIds.includes(ruleId)),
      ...stringRuleIds
        .filter(ruleId => !HATCH_OVERLAP_RULE_IDS.includes(ruleId))
        .sort(ordinalCodeCompare),
    ];
    source.ruleFlagsInspection.keys
      .filter(ruleId => typeof ruleId !== 'string')
      .forEach(() => errors.push({
        code: 'UNKNOWN_HATCH_OVERLAP_RULE_FLAG',
        path: 'hatchOverlapRuleFlags',
        message: 'Hatch overlap rule flags cannot contain Symbol keys.',
      }));
    orderedRuleIds.forEach(ruleId => {
      const descriptor = source.ruleFlagsInspection.descriptors[ruleId];
      const enabled = descriptor && Object.hasOwn(descriptor, 'value')
        ? descriptor.value
        : undefined;
      if (!HATCH_OVERLAP_RULE_IDS.includes(ruleId)) {
        errors.push({
          code: 'UNKNOWN_HATCH_OVERLAP_RULE_FLAG',
          path: `hatchOverlapRuleFlags.${ruleId}`,
          message: `Unknown Hatch overlap rule flag: ${ruleId}.`,
        });
      } else if (!descriptor
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true
        || typeof enabled !== 'boolean') {
        errors.push({
          code: 'INVALID_HATCH_OVERLAP_RULE_FLAG_VALUE',
          path: `hatchOverlapRuleFlags.${ruleId}`,
          message: 'Hatch overlap rule flags must be boolean.',
        });
      } else if (enabled
        && source.profileInspectionValid
        && source.profile !== 'hatch-c-experimental') {
        errors.push({
          code: 'HATCH_OVERLAP_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE',
          path: `hatchOverlapRuleFlags.${ruleId}`,
          message: 'Hatch overlap rule flags can only be enabled in hatch-c-experimental.',
        });
      }
    });
  }
  return errors;
}

export function resolveHatchOverlapControlledOptInPolicy(config = {}) {
  const source = sourceFor(config);
  if (source.activationModeInspectionValid && source.activationMode === undefined) {
    return controlledPolicyResult();
  }

  const precedenceError = controlledPolicyPrecedenceError(source);
  if (precedenceError) {
    return controlledPolicyResult({
      fallbackToLegacy: true,
      fallbackReasonCodes: [precedenceError.code],
    });
  }

  const errors = historicalValidationErrors(source);
  if (errors.length) {
    return controlledPolicyResult({
      fallbackToLegacy: true,
      fallbackReasonCodes: errors.map(error => error.code),
    });
  }

  const sourceInspectionError = controlledSourceInspectionError(source);
  if (sourceInspectionError) {
    return controlledPolicyResult({
      fallbackToLegacy: true,
      fallbackReasonCodes: [sourceInspectionError.code],
    });
  }

  const crossPhaseError = controlledCrossPhaseError(source);
  if (crossPhaseError) {
    return controlledPolicyResult({
      fallbackToLegacy: true,
      fallbackReasonCodes: [crossPhaseError.code],
    });
  }

  const enabledRuleIds = enabledKnownRuleIds(source);
  if (!enabledRuleIds.length) {
    return controlledPolicyResult({
      fallbackToLegacy: true,
      fallbackReasonCodes: ['HATCH_OVERLAP_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES'],
    });
  }
  return controlledPolicyResult({
    operationalRuleIds: CONTROLLED_OPERATIONAL_RULE_IDS,
    diagnosticRuleIds: CONTROLLED_DIAGNOSTIC_RULE_IDS,
    effectiveRuleIds: CONTROLLED_OPERATIONAL_RULE_IDS,
  });
}

export function resolveHatchOverlapIntegrationConfig(config = {}) {
  const source = sourceFor(config);
  const historical = resolveHistoricalIntegration(source);
  if (source.activationModeInspectionValid && source.activationMode === undefined) return historical;
  const controlled = resolveHatchOverlapControlledOptInPolicy(config);
  if (controlled.fallbackToLegacy) return legacyIntegrationResult();
  return integrationResult(
    'hatch-c-experimental',
    inspectExternalRecord(Object.fromEntries(
      HATCH_OVERLAP_RULE_IDS.map(ruleId => [
        ruleId,
        controlled.effectiveRuleIds.includes(ruleId),
      ]),
    )),
  );
}

export function validateHatchOverlapIntegrationConfig(config = {}) {
  const source = sourceFor(config);
  const errors = [];
  const controlledPolicyError = controlledPolicyPrecedenceError(source);
  if (controlledPolicyError) errors.push(controlledPolicyError);
  const structuralErrors = historicalValidationErrors(source);
  errors.push(...structuralErrors);
  if (!controlledPolicyError && structuralErrors.length === 0) {
    const sourceInspectionError = controlledSourceInspectionError(source);
    if (sourceInspectionError) errors.push(sourceInspectionError);
    else {
      const crossPhaseError = controlledCrossPhaseError(source);
      if (crossPhaseError) errors.push(crossPhaseError);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    config: resolveHatchOverlapIntegrationConfig(config),
  };
}

export function hatchOverlapRuleEnabled(config = {}, ruleId) {
  return resolveHatchOverlapIntegrationConfig(config).ruleFlags[ruleId] === true;
}
