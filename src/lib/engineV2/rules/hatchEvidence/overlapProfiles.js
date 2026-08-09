export const HATCH_OVERLAP_PROFILES = Object.freeze(['legacy', 'hatch-c-experimental']);
export const DEFAULT_HATCH_OVERLAP_PROFILE = 'legacy';
export const HATCH_OVERLAP_RULE_IDS = Object.freeze([
  'CONTOUR-LAST-001',
  'COLOR-GROUP-HEURISTIC-001',
  'MULTILAYER-DEPENDENCY-001',
]);
export const DEFAULT_HATCH_OVERLAP_RULE_FLAGS = Object.freeze({
  'CONTOUR-LAST-001': false,
  'COLOR-GROUP-HEURISTIC-001': false,
  'MULTILAYER-DEPENDENCY-001': false,
});
export const HATCH_OVERLAP_CONFIG_FIELDS = Object.freeze([
  'hatchOverlapProfile',
  'hatchOverlapRuleFlags',
]);

const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function sourceFor(config = {}) {
  const source = plainObject(config) ? config : {};
  const extras = plainObject(source.extras) ? source.extras : {};
  const explicit = field => Object.hasOwn(source, field) ? source[field] : extras[field];
  const present = field => Object.hasOwn(source, field) || Object.hasOwn(extras, field);
  return {
    profile: explicit('hatchOverlapProfile'),
    profilePresent: present('hatchOverlapProfile'),
    ruleFlags: explicit('hatchOverlapRuleFlags'),
    ruleFlagsPresent: present('hatchOverlapRuleFlags'),
    unknownFields: [...new Set([
      ...Object.keys(source),
      ...Object.keys(extras),
    ].filter(field => field.startsWith('hatchOverlap') && !HATCH_OVERLAP_CONFIG_FIELDS.includes(field)))].sort(),
  };
}

function resolveRuleFlags(profile, sourceFlags) {
  const requested = plainObject(sourceFlags) ? sourceFlags : {};
  return Object.freeze(Object.fromEntries(HATCH_OVERLAP_RULE_IDS.map(ruleId => [
    ruleId,
    profile === 'hatch-c-experimental' && requested[ruleId] === true,
  ])));
}

export function resolveHatchOverlapIntegrationConfig(config = {}) {
  const source = sourceFor(config);
  const profile = HATCH_OVERLAP_PROFILES.includes(source.profile)
    ? source.profile
    : DEFAULT_HATCH_OVERLAP_PROFILE;
  const ruleFlags = resolveRuleFlags(profile, source.ruleFlags);
  return Object.freeze({
    profile,
    ruleFlags,
    enabledRuleIds: Object.freeze(HATCH_OVERLAP_RULE_IDS.filter(ruleId => ruleFlags[ruleId])),
  });
}

export function validateHatchOverlapIntegrationConfig(config = {}) {
  const source = sourceFor(config);
  const errors = [];
  const flagsAreObject = plainObject(source.ruleFlags);
  source.unknownFields.forEach(field => errors.push({
    code: 'UNKNOWN_HATCH_OVERLAP_CONFIG_FIELD',
    path: field,
    message: `Unknown Hatch overlap configuration field: ${field}.`,
  }));
  if (source.profilePresent && !HATCH_OVERLAP_PROFILES.includes(source.profile)) {
    errors.push({
      code: 'INVALID_HATCH_OVERLAP_PROFILE',
      path: 'hatchOverlapProfile',
      message: 'Hatch overlap profile must be legacy or hatch-c-experimental.',
    });
  }
  if (source.ruleFlagsPresent && !flagsAreObject) {
    errors.push({
      code: 'INVALID_HATCH_OVERLAP_RULE_FLAGS',
      path: 'hatchOverlapRuleFlags',
      message: 'Hatch overlap rule flags must be an object.',
    });
  } else if (flagsAreObject) {
    Object.entries(source.ruleFlags).forEach(([ruleId, enabled]) => {
      if (!HATCH_OVERLAP_RULE_IDS.includes(ruleId)) {
        errors.push({
          code: 'UNKNOWN_HATCH_OVERLAP_RULE_FLAG',
          path: `hatchOverlapRuleFlags.${ruleId}`,
          message: `Unknown Hatch overlap rule flag: ${ruleId}.`,
        });
      } else if (typeof enabled !== 'boolean') {
        errors.push({
          code: 'INVALID_HATCH_OVERLAP_RULE_FLAG_VALUE',
          path: `hatchOverlapRuleFlags.${ruleId}`,
          message: 'Hatch overlap rule flags must be boolean.',
        });
      } else if (enabled && source.profile !== 'hatch-c-experimental') {
        errors.push({
          code: 'HATCH_OVERLAP_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE',
          path: `hatchOverlapRuleFlags.${ruleId}`,
          message: 'Hatch overlap rule flags can only be enabled in hatch-c-experimental.',
        });
      }
    });
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
