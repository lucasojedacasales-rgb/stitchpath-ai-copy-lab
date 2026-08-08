import { polygonArea, polygonBounds } from '../ingestion/geometryCanonicalization.js';
import { getConnectedComponent, getRegionAncestors } from '../topology/regionGraph.js';
import { regionAreaWithHoles } from '../topology/regionRelations.js';

function polygonPerimeter(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return perimeter;
}

export function analyzeRegionGeometryFeatures(region, graph, options = {}) {
  const outerArea = polygonArea(region?.geometry || []);
  const holeArea = (region?.holes || []).reduce((sum, hole) => sum + polygonArea(hole), 0);
  const effectiveArea = regionAreaWithHoles(region);
  const bounds = polygonBounds(region?.geometry || []);
  const width = bounds?.width || 0;
  const height = bounds?.height || 0;
  const perimeter = polygonPerimeter(region?.geometry || [])
    + (region?.holes || []).reduce((sum, hole) => sum + polygonPerimeter(hole), 0);
  const compactness = perimeter > 0 ? Math.min(1, (4 * Math.PI * effectiveArea) / (perimeter * perimeter)) : 0;
  const boundaryTolerance = options.designBoundaryToleranceNormalized ?? 1e-6;
  const touchesDesignBoundaryCount = bounds ? [
    bounds.minX <= boundaryTolerance,
    bounds.minY <= boundaryTolerance,
    bounds.maxX >= 1 - boundaryTolerance,
    bounds.maxY >= 1 - boundaryTolerance,
  ].filter(Boolean).length : 0;
  const node = graph?.nodes?.[region?.id];
  const aspectRatio = Math.min(width, height) > 0 ? Math.max(width, height) / Math.min(width, height) : 0;
  const smallArea = options.smallAreaNormalized ?? 0.012;
  const largeArea = options.largeAreaNormalized ?? 0.25;
  const thinAspectRatio = options.thinAspectRatio ?? 4;
  const thinCompactness = options.thinCompactness ?? 0.12;
  return {
    regionId: region?.id ?? null,
    effectiveArea,
    outerArea,
    holeArea,
    areaRatioToDesign: effectiveArea,
    perimeter,
    bounds,
    width,
    height,
    aspectRatio,
    compactness,
    nestingDepth: graph && region?.id ? getRegionAncestors(graph, region.id).length : 0,
    childCount: node?.childIds?.length || 0,
    containsCount: node?.containedRegionIds?.length || 0,
    overlapCount: node?.overlappingRegionIds?.length || 0,
    touchingCount: node?.touchingRegionIds?.length || 0,
    componentSize: graph && region?.id ? getConnectedComponent(graph, region.id).length : 0,
    touchesDesignBoundaryCount,
    isThin: aspectRatio >= thinAspectRatio || (compactness > 0 && compactness <= thinCompactness),
    isSmall: effectiveArea > 0 && effectiveArea <= smallArea,
    isLarge: effectiveArea >= largeArea,
    isRoot: node ? node.parentId === null : false,
    isNested: node ? node.parentId !== null : false,
    hasExplicitHoles: (region?.holes?.length || 0) > 0,
  };
}
