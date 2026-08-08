function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, stableValue(value[key])]));
  }
  if (Number.isNaN(value)) return null;
  return value ?? null;
}

function fingerprint(value) {
  const text = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}-${text.length}`;
}

function legacyStage(error) {
  return typeof error?.path === 'string' && error.path
    ? error.path
    : 'legacy_upstream';
}

function normalizedError(error) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  if (typeof error.code !== 'string') return error;
  if (!error.code.endsWith('_UPSTREAM') || !Array.isArray(error.evidence)) return error;
  return {
    ...error,
    evidence: createFlatErrorReference(error.evidence, legacyStage(error)),
  };
}

export function stableErrorIdentity(error) {
  return `engine-v2-error:${fingerprint(normalizedError(error))}`;
}

export function mergeFlatErrors(...collections) {
  const merged = [];
  const identities = new Set();
  collections.flatMap(collection => (Array.isArray(collection) ? collection : []))
    .forEach(candidate => {
      const error = normalizedError(candidate);
      if (!error) return;
      const identity = stableErrorIdentity(error);
      if (identities.has(identity)) return;
      identities.add(identity);
      merged.push(error);
    });
  return merged;
}

export function createFlatErrorReference(errors, stage) {
  const flattened = mergeFlatErrors(errors);
  return {
    kind: 'engine_v2_error_reference',
    stage,
    upstreamErrorCount: flattened.length,
    upstreamErrorIds: flattened.map(stableErrorIdentity),
  };
}

export function propagateFlatErrors({
  upstreamErrors = [],
  localErrors = [],
  stage,
  wrapper,
} = {}) {
  const upstream = mergeFlatErrors(upstreamErrors);
  const merged = mergeFlatErrors(upstream, localErrors);
  if (!wrapper) return merged;
  const existing = merged.some(error =>
    error?.code === wrapper.code
    && error?.evidence?.kind === 'engine_v2_error_reference'
    && error.evidence.stage === stage);
  if (existing) return merged;
  const previous = upstream.at(-1) || merged.at(-1) || null;
  return mergeFlatErrors(merged, [{
    ...wrapper,
    evidence: {
      kind: 'engine_v2_error_reference',
      stage,
      upstreamErrorId: previous ? stableErrorIdentity(previous) : null,
    },
  }]);
}
