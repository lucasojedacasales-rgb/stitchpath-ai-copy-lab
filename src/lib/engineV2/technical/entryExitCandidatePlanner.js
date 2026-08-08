import { isPointInEffectiveObjectArea, isPointOnObjectBoundary } from './objectGeometryMetrics.js';
import { createEntryExitCandidateV2 } from './technicalPlanningModel.js';

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (left, right) => Math.hypot(right.x - left.x, right.y - left.y);
const sourceOrder = Object.freeze({ boundary_vertex: 0, cardinal_boundary: 1, outline_start_candidate: 2, dependency_facing_boundary: 3, interior_point: 4, manual: 5 });

function uniqueSortedProposals(proposals, separation) {
  const sorted = proposals.filter(item => finitePoint(item.point)).sort((left, right) => sourceOrder[left.sourceType] - sourceOrder[right.sourceType] || left.point.x - right.point.x || left.point.y - right.point.y || (left.boundaryIndex ?? 0) - (right.boundaryIndex ?? 0));
  const kept = [];
  sorted.forEach(proposal => { if (!kept.some(existing => distance(existing.point, proposal.point) < separation)) kept.push(proposal); });
  return kept;
}

function proposalsFor(object, geometryMetrics, config) {
  const geometry = (object.geometry || []).filter(finitePoint);
  const intent = object?.parameters?.technicalIntent?.geometryType ?? object?.source?.technicalGeometryIntent;
  if (object.stitchType === 'running' && intent === 'open_path') {
    const endpoints = [geometry[0], geometry.at(-1)].filter(Boolean).sort((left, right) => left.x - right.x || left.y - right.y);
    return endpoints.map((point, index) => ({ point, sourceType: 'boundary_vertex', boundaryIndex: index }));
  }
  const proposals = [];
  if (config.entryExit.includeBoundaryVertices) geometry.forEach((point, boundaryIndex) => proposals.push({ point, sourceType: ['outer_outline', 'inner_outline'].includes(object.role) ? 'outline_start_candidate' : 'boundary_vertex', boundaryIndex }));
  if (config.entryExit.includeCardinalBoundaryPoints && geometry.length) {
    const cardinals = [
      [...geometry].sort((a, b) => a.x - b.x || a.y - b.y)[0],
      [...geometry].sort((a, b) => b.x - a.x || a.y - b.y)[0],
      [...geometry].sort((a, b) => a.y - b.y || a.x - b.x)[0],
      [...geometry].sort((a, b) => b.y - a.y || a.x - b.x)[0],
    ];
    cardinals.forEach(point => proposals.push({ point, sourceType: 'cardinal_boundary', boundaryIndex: geometry.findIndex(candidate => candidate.x === point.x && candidate.y === point.y) }));
  }
  if (config.entryExit.includeValidInteriorCandidate && geometryMetrics.validInteriorPoint && !['outer_outline', 'inner_outline'].includes(object.role)) proposals.push({ point: geometryMetrics.validInteriorPoint, sourceType: 'interior_point', boundaryIndex: null });
  return proposals;
}

function buildCandidates(object, kind, geometryMetrics, config) {
  const proposals = uniqueSortedProposals(proposalsFor(object, geometryMetrics, config), config.entryExit.minimumCandidateSeparationMm).slice(0, config.entryExit.maximumCandidatesPerObject);
  return proposals.map((proposal, index) => {
    const onBoundary = proposal.sourceType !== 'interior_point' && isPointOnObjectBoundary(proposal.point, object);
    const inArea = proposal.sourceType === 'interior_point' && isPointInEffectiveObjectArea(proposal.point, object, { boundaryInside: false });
    const valid = onBoundary || inArea;
    return createEntryExitCandidateV2({
      id: `candidate:${object.id}:${kind}:${proposal.sourceType}:${index}`,
      objectId: object.id,
      kind,
      point: proposal.point,
      sourceType: proposal.sourceType,
      boundaryIndex: proposal.boundaryIndex,
      scoreHints: { boundary: onBoundary, interior: inArea },
      valid,
      rejectionReasons: valid ? [] : [proposal.sourceType === 'interior_point' ? 'INTERIOR_CANDIDATE_OUTSIDE_EFFECTIVE_AREA_OR_INSIDE_HOLE' : 'BOUNDARY_CANDIDATE_NOT_ON_SOURCE_GEOMETRY'],
      source: { planner: 'engineV2', finalPairSelected: false },
    });
  });
}

export function planEntryExitCandidates({ object, geometryMetrics, relatedObjects = [], config }) {
  void relatedObjects;
  return { entryCandidates: buildCandidates(object, 'entry', geometryMetrics, config), exitCandidates: buildCandidates(object, 'exit', geometryMetrics, config), finalPairSelected: false };
}
