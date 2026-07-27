const clone = value => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
};

export function deepFreezeCanonicalValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreezeCanonicalValue);
  return Object.freeze(value);
}

export const CANONICAL_COMPILATION_STATUSES = Object.freeze(['compiled', 'manual_required', 'blocked']);
export const CANONICAL_DISCONTINUITY_CLASSIFICATIONS = Object.freeze(['safe_connector_stitch', 'jump_with_trim', 'jump_without_trim', 'zero_distance_continuation']);
export const canonicalDispositionId = objectId => `canonical-disposition:${objectId}`;
export const canonicalSpanId = objectId => `canonical-span:${objectId}`;
export const canonicalGapId = transitionId => `canonical-gap:${transitionId}`;

export function createCanonicalCompilationDispositionV2(input = {}) {
  return deepFreezeCanonicalValue({
    id: input.id ?? canonicalDispositionId(input.objectId), objectId: input.objectId ?? null,
    executionStepId: input.executionStepId ?? null, physicalPathId: input.physicalPathId ?? null,
    status: input.status ?? 'blocked', reasonCode: input.reasonCode ?? null, reason: input.reason ?? null,
    automatic: input.automatic !== false, evidence: clone(input.evidence ?? []), source: clone(input.source ?? null),
  });
}

export function createCanonicalObjectCommandSpanV2(input = {}) {
  return deepFreezeCanonicalValue({
    id: input.id ?? canonicalSpanId(input.objectId), objectId: input.objectId ?? null,
    executionStepId: input.executionStepId ?? null, threadBlockId: input.threadBlockId ?? null,
    firstCommandIndex: input.firstCommandIndex ?? null, lastCommandIndex: input.lastCommandIndex ?? null,
    commandCount: input.commandCount ?? 0, stitchCommandCount: input.stitchCommandCount ?? 0,
    connectorStitchCommandCount: input.connectorStitchCommandCount ?? 0, jumpCommandCount: input.jumpCommandCount ?? 0,
    trimCommandCount: input.trimCommandCount ?? 0, colorChangeCommandCount: input.colorChangeCommandCount ?? 0,
    source: clone(input.source ?? null),
  });
}

export function createCanonicalDiscontinuityClassificationV2(input = {}) {
  return deepFreezeCanonicalValue({
    id: input.id ?? canonicalGapId(input.transitionId), objectId: input.objectId ?? null,
    transitionId: input.transitionId ?? null, fromSubpathId: input.fromSubpathId ?? null,
    toSubpathId: input.toSubpathId ?? null, classification: input.classification ?? null,
    reasonCode: input.reasonCode ?? null, distanceMm: input.distanceMm ?? null,
    safeConnectorAllowed: input.safeConnectorAllowed === true, trimRequired: input.trimRequired === true,
    source: clone(input.source ?? null),
  });
}

export function createCanonicalCommandCompilationV2(input = {}) {
  const dispositions = (input.dispositions || []).map(createCanonicalCompilationDispositionV2);
  const spans = (input.objectCommandSpans || []).map(createCanonicalObjectCommandSpanV2);
  const classifications = (input.discontinuityClassifications || []).map(createCanonicalDiscontinuityClassificationV2);
  const commands = clone(input.commands ?? []);
  return deepFreezeCanonicalValue({
    version: input.version ?? '2-canonical-command-compilation', initialThreadId: input.initialThreadId ?? null,
    dispositions, commands, objectCommandSpans: spans, discontinuityClassifications: classifications,
    executionOrder: clone(input.executionOrder ?? []), threadBlockOrder: clone(input.threadBlockOrder ?? []),
    byDispositionId: clone(input.byDispositionId ?? Object.fromEntries(dispositions.map(item => [item.id, item]))),
    byObjectId: clone(input.byObjectId ?? Object.fromEntries(spans.map(item => [item.objectId, item]))),
    byCommandId: clone(input.byCommandId ?? Object.fromEntries(commands.map(item => [item.id, item]))),
    byDiscontinuityId: clone(input.byDiscontinuityId ?? Object.fromEntries(classifications.map(item => [item.id, item]))),
    valid: input.valid === true, errors: clone(input.errors ?? []), warnings: clone(input.warnings ?? []),
    summary: clone(input.summary ?? {}), config: clone(input.config ?? {}), metadata: clone(input.metadata ?? {}),
  });
}
