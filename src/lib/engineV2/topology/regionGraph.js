import {
  DEFAULT_GEOMETRY_TOLERANCES,
  polygonBounds,
  polygonCentroid,
} from '../ingestion/geometryCanonicalization.js';
import { analyzeAllRegionRelations, regionAreaWithHoles } from './regionRelations.js';

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }
  return value;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

function makeDisjointSet(ids) {
  const parent = new Map(ids.map(id => [id, id]));
  function find(id) {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cursor = id;
    while (parent.get(cursor) !== cursor) {
      const next = parent.get(cursor);
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }
  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const [first, second] = [rootA, rootB].sort((left, right) => String(left).localeCompare(String(right)));
    parent.set(second, first);
  }
  return { find, union };
}

/**
 * Builds immutable spatial topology. It never merges or modifies region geometry.
 */
export function buildRegionGraphV2(regions, options = {}) {
  const sortedRegions = [...(Array.isArray(regions) ? regions : [])]
    .map(cloneValue)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const tolerances = {
    ...DEFAULT_GEOMETRY_TOLERANCES,
    pointToleranceNormalized: options.pointToleranceNormalized ?? DEFAULT_GEOMETRY_TOLERANCES.pointToleranceNormalized,
    boundaryTouchToleranceNormalized: options.boundaryTouchToleranceNormalized ?? DEFAULT_GEOMETRY_TOLERANCES.boundaryTouchToleranceNormalized,
    minimumAreaNormalized: options.minimumAreaNormalized ?? DEFAULT_GEOMETRY_TOLERANCES.minimumAreaNormalized,
  };
  const relations = analyzeAllRegionRelations(sortedRegions, tolerances);
  const areas = new Map(sortedRegions.map(region => [region.id, regionAreaWithHoles(region)]));
  const nodes = Object.fromEntries(sortedRegions.map(region => [region.id, {
    regionId: region.id,
    parentId: null,
    childIds: [],
    containingRegionIds: [],
    containedRegionIds: [],
    overlappingRegionIds: [],
    touchingRegionIds: [],
    disconnectedComponentId: null,
    bounds: polygonBounds(region.geometry),
    centroid: polygonCentroid(region.geometry),
    area: areas.get(region.id),
  }]));
  const edges = [];
  const equalGeometryCandidates = [];
  const explicitHoleExclusions = [];
  const disjointSet = makeDisjointSet(sortedRegions.map(region => region.id));

  relations.forEach(({ regionAId, regionBId, relation, excludedByExplicitHole, explicitHoleIdOrIndex }) => {
    if (excludedByExplicitHole) {
      explicitHoleExclusions.push({ regionAId, regionBId, explicitHoleIdOrIndex });
    }
    if (relation === 'contains') {
      nodes[regionAId].containedRegionIds.push(regionBId);
      nodes[regionBId].containingRegionIds.push(regionAId);
      edges.push({ fromRegionId: regionAId, toRegionId: regionBId, relation: 'contains' });
      disjointSet.union(regionAId, regionBId);
    } else if (relation === 'inside') {
      nodes[regionBId].containedRegionIds.push(regionAId);
      nodes[regionAId].containingRegionIds.push(regionBId);
      edges.push({ fromRegionId: regionBId, toRegionId: regionAId, relation: 'contains' });
      disjointSet.union(regionAId, regionBId);
    } else if (relation === 'overlaps') {
      nodes[regionAId].overlappingRegionIds.push(regionBId);
      nodes[regionBId].overlappingRegionIds.push(regionAId);
      edges.push({ fromRegionId: regionAId, toRegionId: regionBId, relation: 'overlaps' });
      disjointSet.union(regionAId, regionBId);
    } else if (relation === 'touches') {
      nodes[regionAId].touchingRegionIds.push(regionBId);
      nodes[regionBId].touchingRegionIds.push(regionAId);
      edges.push({ fromRegionId: regionAId, toRegionId: regionBId, relation: 'touches' });
      disjointSet.union(regionAId, regionBId);
    } else if (relation === 'equal_geometry') {
      equalGeometryCandidates.push([regionAId, regionBId]);
      disjointSet.union(regionAId, regionBId);
    }
  });

  Object.values(nodes).forEach(node => {
    node.containingRegionIds = sortedUnique(node.containingRegionIds);
    node.containedRegionIds = sortedUnique(node.containedRegionIds);
    node.overlappingRegionIds = sortedUnique(node.overlappingRegionIds);
    node.touchingRegionIds = sortedUnique(node.touchingRegionIds);
    node.parentId = [...node.containingRegionIds].sort((a, b) => {
      const areaDifference = areas.get(a) - areas.get(b);
      return Math.abs(areaDifference) > Number.EPSILON ? areaDifference : String(a).localeCompare(String(b));
    })[0] || null;
  });
  Object.values(nodes).forEach(node => {
    if (node.parentId) nodes[node.parentId].childIds.push(node.regionId);
  });
  Object.values(nodes).forEach(node => {
    node.childIds = sortedUnique(node.childIds);
  });

  const groups = new Map();
  sortedRegions.forEach(region => {
    const root = disjointSet.find(region.id);
    const group = groups.get(root) || [];
    group.push(region.id);
    groups.set(root, group);
  });
  const orderedGroups = [...groups.values()]
    .map(sortedUnique)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const componentIds = orderedGroups.map((_, index) => `component-${String(index + 1).padStart(4, '0')}`);
  orderedGroups.forEach((group, index) => {
    group.forEach(regionId => {
      nodes[regionId].disconnectedComponentId = componentIds[index];
    });
  });

  edges.sort((a, b) => `${a.relation}:${a.fromRegionId}:${a.toRegionId}`.localeCompare(`${b.relation}:${b.fromRegionId}:${b.toRegionId}`));
  return {
    version: '2-region-graph',
    regionIds: sortedRegions.map(region => region.id),
    nodes,
    edges,
    rootIds: Object.values(nodes).filter(node => !node.parentId).map(node => node.regionId).sort(),
    componentIds,
    metadata: {
      tolerances,
      equalGeometryCandidates: equalGeometryCandidates.map(pair => [...pair]),
      explicitHoleExclusions: explicitHoleExclusions.map(item => ({ ...item })),
      regionsInsideExplicitHoles: explicitHoleExclusions.length,
      holeAwareParentCorrections: explicitHoleExclusions.length,
      inferredHoleCount: 0,
    },
  };
}

export function getRegionAncestors(graph, regionId) {
  const ancestors = [];
  const seen = new Set();
  let current = graph?.nodes?.[regionId]?.parentId ?? null;
  while (current && !seen.has(current)) {
    ancestors.push(current);
    seen.add(current);
    current = graph?.nodes?.[current]?.parentId ?? null;
  }
  return ancestors;
}

export function getRegionDescendants(graph, regionId) {
  const descendants = [];
  const queue = [...(graph?.nodes?.[regionId]?.childIds || [])];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    descendants.push(current);
    queue.push(...(graph?.nodes?.[current]?.childIds || []));
  }
  return descendants;
}

export function getConnectedComponent(graph, regionId) {
  const componentId = graph?.nodes?.[regionId]?.disconnectedComponentId;
  if (!componentId) return [];
  return (graph.regionIds || []).filter(id => graph.nodes?.[id]?.disconnectedComponentId === componentId).sort();
}
