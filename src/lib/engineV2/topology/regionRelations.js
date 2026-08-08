import {
  DEFAULT_GEOMETRY_TOLERANCES,
  _geometryInternals,
  isPointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonContainsPolygon,
  polygonsOverlap,
  polygonsTouch,
} from '../ingestion/geometryCanonicalization.js';

export const REGION_RELATIONS = Object.freeze(['disjoint', 'touches', 'overlaps', 'contains', 'inside', 'equal_geometry']);

function asRegion(value) {
  if (value?.geometry) return value;
  return { geometry: Array.isArray(value) ? value : [], holes: [] };
}

function regionBoundaries(region) {
  return [region.geometry, ...(Array.isArray(region.holes) ? region.holes : [])];
}

function boundariesProperlyIntersect(a, b, tolerance) {
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (_geometryInternals.segmentsProperlyIntersect(
        a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length], tolerance,
      )) return true;
    }
  }
  return false;
}

function boundariesTouch(a, b, tolerance) {
  return polygonsTouch(a, b, tolerance);
}

function boundsNear(a, b, tolerance) {
  if (!a || !b) return false;
  return Math.abs(a.minX - b.minX) <= tolerance
    && Math.abs(a.minY - b.minY) <= tolerance
    && Math.abs(a.maxX - b.maxX) <= tolerance
    && Math.abs(a.maxY - b.maxY) <= tolerance;
}

function sameCyclicPoints(a, b, tolerance) {
  if (a.length !== b.length) return false;
  for (let offset = 0; offset < b.length; offset += 1) {
    if (!_geometryInternals.pointsNear(a[0], b[offset], tolerance)) continue;
    let equal = true;
    for (let i = 0; i < a.length; i += 1) {
      if (!_geometryInternals.pointsNear(a[i], b[(offset + i) % b.length], tolerance)) {
        equal = false;
        break;
      }
    }
    if (equal) return true;
  }
  return false;
}

export function polygonsHaveEqualGeometry(a, b, tolerance = DEFAULT_GEOMETRY_TOLERANCES.pointToleranceNormalized) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  if (!boundsNear(polygonBounds(a), polygonBounds(b), tolerance)) return false;
  if (Math.abs(polygonArea(a) - polygonArea(b)) > tolerance) return false;
  return sameCyclicPoints(a, b, tolerance) || sameCyclicPoints(a, [...b].reverse(), tolerance);
}

function regionsHaveEqualGeometry(a, b, tolerance) {
  if (!polygonsHaveEqualGeometry(a.geometry, b.geometry, tolerance)) return false;
  const holesA = Array.isArray(a.holes) ? a.holes : [];
  const holesB = Array.isArray(b.holes) ? b.holes : [];
  if (holesA.length !== holesB.length) return false;
  const unmatched = [...holesB];
  for (const holeA of holesA) {
    const matchIndex = unmatched.findIndex(holeB => polygonsHaveEqualGeometry(holeA, holeB, tolerance));
    if (matchIndex < 0) return false;
    unmatched.splice(matchIndex, 1);
  }
  return unmatched.length === 0;
}

export function isPointInRegionArea(point, region) {
  const normalized = asRegion(region);
  if (!isPointInPolygon(point, normalized.geometry)) return false;
  return !(normalized.holes || []).some(hole => isPointInPolygon(point, hole));
}

function isPointStrictlyInRegionArea(point, region, tolerance) {
  const normalized = asRegion(region);
  if (!isPointInRegionArea(point, normalized)) return false;
  return !regionBoundaries(normalized).some(boundary =>
    boundary.some((start, index) =>
      _geometryInternals.pointOnSegment(point, start, boundary[(index + 1) % boundary.length], tolerance)));
}

export function regionAreaWithHoles(region) {
  const normalized = asRegion(region);
  const holeArea = (normalized.holes || []).reduce((sum, hole) => sum + polygonArea(hole), 0);
  return Math.max(0, polygonArea(normalized.geometry) - holeArea);
}

function containingHoleIndex(region, possibleContainer, options = {}) {
  const child = asRegion(region);
  const container = asRegion(possibleContainer);
  const tolerance = options.pointToleranceNormalized ?? DEFAULT_GEOMETRY_TOLERANCES.pointToleranceNormalized;
  return (container.holes || []).findIndex(hole =>
    polygonContainsPolygon(hole, child.geometry)
    && !boundariesProperlyIntersect(hole, child.geometry, tolerance));
}

export function regionInsideExplicitHole(region, possibleContainer, options = {}) {
  return containingHoleIndex(region, possibleContainer, options) >= 0;
}

export function regionContainsRegionArea(parent, child, options = {}) {
  const container = asRegion(parent);
  const candidate = asRegion(child);
  const tolerance = options.pointToleranceNormalized ?? DEFAULT_GEOMETRY_TOLERANCES.pointToleranceNormalized;
  if (!polygonContainsPolygon(container.geometry, candidate.geometry)) return false;
  if (candidate.geometry.some(point => !isPointInRegionArea(point, container))) return false;
  if ((container.holes || []).some(hole => boundariesProperlyIntersect(hole, candidate.geometry, tolerance))) return false;
  return !(container.holes || []).some(hole => {
    const sample = polygonCentroid(hole);
    return sample && isPointInRegionArea(sample, candidate);
  });
}

export function regionsOverlapArea(regionA, regionB, options = {}) {
  const a = asRegion(regionA);
  const b = asRegion(regionB);
  const tolerance = options.pointToleranceNormalized ?? DEFAULT_GEOMETRY_TOLERANCES.pointToleranceNormalized;
  if (regionInsideExplicitHole(a, b, options) || regionInsideExplicitHole(b, a, options)) return false;
  if (regionContainsRegionArea(a, b, options) || regionContainsRegionArea(b, a, options)) return true;
  if (a.geometry.some(point => isPointStrictlyInRegionArea(point, a, tolerance) && isPointStrictlyInRegionArea(point, b, tolerance))) return true;
  if (b.geometry.some(point => isPointStrictlyInRegionArea(point, a, tolerance) && isPointStrictlyInRegionArea(point, b, tolerance))) return true;
  for (const boundaryA of regionBoundaries(a)) {
    for (const boundaryB of regionBoundaries(b)) {
      if (boundariesProperlyIntersect(boundaryA, boundaryB, tolerance)) return true;
    }
  }
  return polygonsOverlap(a.geometry, b.geometry)
    && !regionInsideExplicitHole(a, b, options)
    && !regionInsideExplicitHole(b, a, options);
}

export function regionsTouchArea(regionA, regionB, options = {}) {
  const a = asRegion(regionA);
  const b = asRegion(regionB);
  const tolerance = options.boundaryTouchToleranceNormalized ?? DEFAULT_GEOMETRY_TOLERANCES.boundaryTouchToleranceNormalized;
  if (regionsOverlapArea(a, b, options)) return false;
  return regionBoundaries(a).some(boundaryA =>
    regionBoundaries(b).some(boundaryB => boundariesTouch(boundaryA, boundaryB, tolerance)));
}

export function analyzeRegionRelationDetailed(aValue, bValue, options = {}) {
  const a = asRegion(aValue);
  const b = asRegion(bValue);
  const pointTolerance = options.pointToleranceNormalized ?? DEFAULT_GEOMETRY_TOLERANCES.pointToleranceNormalized;
  if (regionsHaveEqualGeometry(a, b, pointTolerance)) {
    return { relation: 'equal_geometry', excludedByExplicitHole: false, explicitHoleIdOrIndex: null };
  }
  if (regionContainsRegionArea(a, b, options)) {
    return { relation: 'contains', excludedByExplicitHole: false, explicitHoleIdOrIndex: null };
  }
  if (regionContainsRegionArea(b, a, options)) {
    return { relation: 'inside', excludedByExplicitHole: false, explicitHoleIdOrIndex: null };
  }
  if (regionsOverlapArea(a, b, options)) {
    return { relation: 'overlaps', excludedByExplicitHole: false, explicitHoleIdOrIndex: null };
  }
  if (regionsTouchArea(a, b, options)) {
    return { relation: 'touches', excludedByExplicitHole: false, explicitHoleIdOrIndex: null };
  }
  const bHoleIndex = containingHoleIndex(b, a, options);
  const aHoleIndex = containingHoleIndex(a, b, options);
  return {
    relation: 'disjoint',
    excludedByExplicitHole: bHoleIndex >= 0 || aHoleIndex >= 0,
    explicitHoleIdOrIndex: bHoleIndex >= 0 ? bHoleIndex : (aHoleIndex >= 0 ? aHoleIndex : null),
  };
}

export function analyzeRegionRelation(a, b, options = {}) {
  return analyzeRegionRelationDetailed(a, b, options).relation;
}

export function analyzeAllRegionRelations(regions, options = {}) {
  const sorted = [...(Array.isArray(regions) ? regions : [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const relations = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const diagnostic = analyzeRegionRelationDetailed(sorted[i], sorted[j], options);
      relations.push({ regionAId: sorted[i].id, regionBId: sorted[j].id, ...diagnostic });
    }
  }
  return relations;
}
