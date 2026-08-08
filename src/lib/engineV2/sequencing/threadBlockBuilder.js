import { createThreadBlockV2 } from '../model.js';
import { REPEATED_THREAD_REASONS } from './sequencePlanningModel.js';

const issue = (code, path, message) => ({ code, path, message });

export function sanitizeThreadIdForBlock(threadId) {
  return String(threadId ?? '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'thread';
}
export function buildThreadBlocksFromExecution({ executionSteps = [], objects = [], searchMetadata = {} }) {
  const objectMap = new Map(objects.map(object => [object.id, object]));
  const drafts = [];
  executionSteps.forEach(step => {
    const current = drafts.at(-1);
    if (current?.threadId === step.threadId) current.objectIds.push(step.objectId);
    else drafts.push({
      threadId: step.threadId,
      objectIds: [step.objectId],
      repeatedThreadReason: step.source?.repeatedThreadReason ?? null,
    });
  });
  const errors = [];
  const sanitizedOwners = new Map();
  const seenThreads = new Set();
  const threadBlocks = drafts.map((draft, index) => {
    const sanitized = sanitizeThreadIdForBlock(draft.threadId);
    const owner = sanitizedOwners.get(sanitized);
    if (owner && owner !== draft.threadId) errors.push(issue('THREAD_BLOCK_SANITIZATION_COLLISION', `threadBlocks[${index}].id`, `Thread IDs "${owner}" and "${draft.threadId}" sanitize to the same value.`));
    else sanitizedOwners.set(sanitized, draft.threadId);
    const repeated = seenThreads.has(draft.threadId);
    seenThreads.add(draft.threadId);
    const reason = repeated ? draft.repeatedThreadReason : null;
    if (repeated && !REPEATED_THREAD_REASONS.includes(reason)) errors.push(issue('REPEATED_THREAD_REASON_REQUIRED', `threadBlocks[${index}].repeatedThreadReason`, 'A repeated thread block requires an allowed reason.'));
    return createThreadBlockV2({
      id: `thread-block:${String(index).padStart(4, '0')}:${sanitized}`,
      threadId: draft.threadId,
      objectIds: draft.objectIds,
      layer: Math.min(...draft.objectIds.map(id => objectMap.get(id)?.layer ?? 0)),
      repeatedThreadReason: reason,
    });
  });
  void searchMetadata;
  return { threadBlocks, errors, warnings: [] };
}
