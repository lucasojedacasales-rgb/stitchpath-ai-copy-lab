export const SEQUENCE_TRAVEL_COMPARISON_TOLERANCE = 1e-9;

export function formatSequenceStableSignature(state = {}) {
  const steps = state.executionSteps ?? state.steps ?? [];
  return steps.map(step => `${step.objectId ?? ''}[${step.entryCandidateId ?? step.pair?.entryCandidate?.id ?? ''}>${step.exitCandidateId ?? step.pair?.exitCandidate?.id ?? ''}]`).join('|');
}
export function createSequenceCost(state = {}) {
  return Object.freeze({
    dependencyViolationCount: state.dependencyViolationCount ?? 0,
    unscheduledSchedulableObjectCount: state.unscheduledSchedulableObjectCount ?? 0,
    threadChangeCount: state.threadChangeCount ?? 0,
    threadRevisitCount: state.threadRevisitCount ?? 0,
    estimatedTravelMm: state.estimatedTravelMm ?? 0,
    stableSignature: state.stableSignature ?? formatSequenceStableSignature(state),
  });
}

export function compareSequenceCosts(left, right) {
  for (const field of ['dependencyViolationCount', 'unscheduledSchedulableObjectCount', 'threadChangeCount', 'threadRevisitCount']) {
    const difference = (left?.[field] ?? 0) - (right?.[field] ?? 0);
    if (difference) return difference < 0 ? -1 : 1;
  }
  const travelDifference = (left?.estimatedTravelMm ?? 0) - (right?.estimatedTravelMm ?? 0);
  if (Math.abs(travelDifference) > SEQUENCE_TRAVEL_COMPARISON_TOLERANCE) return travelDifference < 0 ? -1 : 1;
  return String(left?.stableSignature ?? '').localeCompare(String(right?.stableSignature ?? ''));
}
