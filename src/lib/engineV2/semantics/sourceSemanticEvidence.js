import { matchControlledSemanticTerms } from './sourceSemanticVocabulary.js';

const ROLE_CONCEPTS = new Set([
  'background', 'primary_shape', 'secondary_shape', 'internal_feature',
  'highlight', 'negative_space', 'dark_mark',
]);
const NEGATIVE_FLAG_KEYS = new Set(['negativespace', 'isnegativespace', 'cutout', 'iscutout', 'void', 'isvoid', 'hole', 'ishole']);

function flattenSourceValues(region) {
  return [
    region?.semanticRole,
    region?.source?.name,
    region?.source?.object,
    region?.source?.objectGroup,
    region?.source?.regionClass,
    region?.source?.originalSource,
  ];
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, output));
  return output;
}

function normalizeKey(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hasExplicitNegativeFlag(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => {
    if (NEGATIVE_FLAG_KEYS.has(normalizeKey(key)) && nested === true) return true;
    return nested && typeof nested === 'object' ? hasExplicitNegativeFlag(nested) : false;
  });
}

function legacyTag(match) {
  return match.normalizedToken.replace(/\s+/g, '');
}

export function analyzeSourceSemanticEvidence(region) {
  const exactSourceValues = flattenSourceValues(region).map(value => value === undefined ? null : value);
  const strings = exactSourceValues.flatMap(value => collectStrings(value));
  const controlledMatches = strings.flatMap(matchControlledSemanticTerms);
  const roleMatches = controlledMatches.filter(match => ROLE_CONCEPTS.has(match.concept));
  const explicitNegative = hasExplicitNegativeFlag(region?.source)
    || ['negative_space', 'hole', 'cutout', 'void'].includes(String(region?.semanticRole || '').toLowerCase());
  if (explicitNegative) {
    roleMatches.push({
      language: 'neutral', originalToken: 'explicit_negative_space', normalizedToken: 'explicit negative space',
      concept: 'negative_space', sourceValue: true,
    });
  }
  const roles = [...new Set(roleMatches.map(item => item.concept))];
  const conflicts = roles.length > 1 ? roles.map(role => ({ code: 'CONFLICTING_SOURCE_ROLE', role })) : [];
  const trustedRoleCandidate = explicitNegative ? 'negative_space' : (roles.length === 1 ? roles[0] : null);
  const semanticTags = [...new Set(roleMatches.map(legacyTag))];
  const evidence = controlledMatches.map(item => ({
    code: item.concept === 'planning_neutral' ? 'PLANNING_NEUTRAL_SOURCE_LABEL'
      : item.concept === 'outline_intent' ? 'CONTROLLED_OUTLINE_INTENT'
        : 'CONTROLLED_SOURCE_LABEL',
    message: `Controlled source evidence "${item.normalizedToken}" supports ${item.concept}.`,
    sourceValue: item.sourceValue,
    role: ROLE_CONCEPTS.has(item.concept) ? item.concept : undefined,
    language: item.language,
    originalToken: item.originalToken,
    normalizedToken: item.normalizedToken,
    concept: item.concept,
  }));
  if (explicitNegative) evidence.push({
    code: 'EXPLICIT_NEGATIVE_SPACE',
    message: 'Explicit source metadata supports negative_space.',
    sourceValue: true,
    role: 'negative_space',
    language: 'neutral',
    originalToken: 'explicit_negative_space',
    normalizedToken: 'explicit negative space',
    concept: 'negative_space',
  });
  return {
    trustedRoleCandidate,
    semanticTags,
    confidence: explicitNegative ? 1 : (trustedRoleCandidate ? 0.9 : (roles.length > 0 ? 0.45 : 0)),
    evidence,
    controlledMatches,
    outlineIntentEvidence: controlledMatches.filter(item => item.concept === 'outline_intent'),
    planningNeutralEvidence: controlledMatches.filter(item => item.concept === 'planning_neutral'),
    conflicts,
    exactSourceValues,
  };
}
