import { isPointInEffectiveObjectArea, isPointOnObjectBoundary } from '../technical/objectGeometryMetrics.js';

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (left, right) => Math.hypot(right.x - left.x, right.y - left.y);

function validCandidates(candidates, object, kind, limit, preferEndpoints) {
  const seen = new Set();
  return [...(candidates || [])]
    .filter(candidate => {
      if (!candidate?.id || seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      if (candidate.valid !== true || candidate.objectId !== object.id || candidate.kind !== kind || !finitePoint(candidate.point)) return false;
      return candidate.sourceType === 'interior_point'
        ? isPointInEffectiveObjectArea(candidate.point, object, { boundaryInside: false })
        : isPointOnObjectBoundary(candidate.point, object);
    })
    .sort((left, right) => {
      if (preferEndpoints) {
        const leftEndpoint = left.sourceType === 'boundary_vertex' ? 0 : 1;
        const rightEndpoint = right.sourceType === 'boundary_vertex' ? 0 : 1;
        if (leftEndpoint !== rightEndpoint) return leftEndpoint - rightEndpoint;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, limit);
}

export function enumerateValidEntryExitPairs({ object, specification, config }) {
  if (!object || !specification) return [];
  const openRunning = object.stitchType === 'running' && (
    object?.parameters?.technicalIntent?.geometryType === 'open_path'
    || object?.source?.technicalGeometryIntent === 'open_path'
  );
  const entries = validCandidates(specification.entryCandidates, object, 'entry', config.maximumEntryCandidatesPerObject, openRunning);
  const exits = validCandidates(specification.exitCandidates, object, 'exit', config.maximumExitCandidatesPerObject, openRunning);
  const hasDistinctEndpoints = openRunning && entries.length > 1 && exits.length > 1;
  return entries.flatMap(entryCandidate => exits
    .filter(exitCandidate => !hasDistinctEndpoints || entryCandidate.point.x !== exitCandidate.point.x || entryCandidate.point.y !== exitCandidate.point.y)
    .map(exitCandidate => Object.freeze({
      id: `candidate-pair:${object.id}:${entryCandidate.id}:${exitCandidate.id}`,
      objectId: object.id,
      entryCandidate,
      exitCandidate,
    })))
    .sort((left, right) => left.entryCandidate.id.localeCompare(right.entryCandidate.id) || left.exitCandidate.id.localeCompare(right.exitCandidate.id));
}

export function selectEntryExitPairForTransition({ previousExitPoint = null, object, specification, nextObjectHints = [], config }) {
  void nextObjectHints;
  const pairs = enumerateValidEntryExitPairs({ object, specification, config });
  return pairs.sort((left, right) => {
    const leftDistance = previousExitPoint ? distance(previousExitPoint, left.entryCandidate.point) : 0;
    const rightDistance = previousExitPoint ? distance(previousExitPoint, right.entryCandidate.point) : 0;
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0] ?? null;
}

export function sequencePointDistance(left, right) {
  return finitePoint(left) && finitePoint(right) ? distance(left, right) : null;
}
