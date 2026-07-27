const STATUSES = Object.freeze(['assigned', 'blocked']);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export function threadAssignmentIdForDraft(draftId) {
  return `thread-assignment:${draftId}`;
}

export function createDraftThreadAssignmentV2(input = {}) {
  const status = input.status ?? 'blocked';
  return freeze({
    id: input.id ?? threadAssignmentIdForDraft(input.draftId),
    draftId: input.draftId ?? null,
    regionId: input.regionId ?? null,
    status,
    threadId: status === 'assigned' ? (input.threadId ?? null) : null,
    visualColor: clone(input.visualColor ?? null),
    normalizedVisualColor: input.normalizedVisualColor ?? null,
    paletteEntryId: input.paletteEntryId ?? null,
    machineColor: clone(input.machineColor ?? null),
    colorFamily: input.colorFamily ?? 'unknown',
    deltaE: Number.isFinite(input.deltaE) ? input.deltaE : null,
    exactMatch: input.exactMatch === true,
    confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 0,
    policy: input.policy ?? null,
    reasonCode: input.reasonCode ?? null,
    reason: input.reason ?? null,
    evidence: clone(Array.isArray(input.evidence) ? input.evidence : []),
    warnings: clone(Array.isArray(input.warnings) ? input.warnings : []),
    source: clone(input.source ?? null),
  });
}

export function validateDraftThreadAssignmentV2(assignment) {
  const errors = [];
  const add = (code, path, message) => errors.push({ code, path, message });
  if (!assignment || typeof assignment !== 'object') return { valid: false, errors: [{ code: 'INVALID_THREAD_ASSIGNMENT', path: 'assignment', message: 'Assignment must be an object.' }], warnings: [] };
  if (!assignment.id) add('MISSING_THREAD_ASSIGNMENT_ID', 'id', 'Assignment ID is required.');
  if (!assignment.draftId) add('MISSING_ASSIGNMENT_DRAFT_ID', 'draftId', 'draftId is required.');
  if (assignment.id && assignment.draftId && assignment.id !== threadAssignmentIdForDraft(assignment.draftId)) add('NON_DETERMINISTIC_THREAD_ASSIGNMENT_ID', 'id', 'Assignment ID is not deterministic.');
  if (!STATUSES.includes(assignment.status)) add('INVALID_THREAD_ASSIGNMENT_STATUS', 'status', 'Status must be assigned or blocked.');
  if (assignment.status === 'assigned' && !assignment.threadId) add('ASSIGNED_THREAD_ID_REQUIRED', 'threadId', 'Assigned disposition requires threadId.');
  if (assignment.status === 'blocked' && assignment.threadId !== null) add('BLOCKED_THREAD_ID_FORBIDDEN', 'threadId', 'Blocked disposition must have null threadId.');
  if (assignment.deltaE !== null && (!Number.isFinite(assignment.deltaE) || assignment.deltaE < 0)) add('INVALID_ASSIGNMENT_DELTA_E', 'deltaE', 'Delta E must be null or a non-negative finite number.');
  return { valid: errors.length === 0, errors, warnings: [] };
}

export const DRAFT_THREAD_ASSIGNMENT_STATUSES = STATUSES;
