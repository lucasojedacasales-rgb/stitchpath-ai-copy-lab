import { createRegionV2 } from '../model.js';
import { canonicalizeHoles, canonicalizePolygon } from './geometryCanonicalization.js';

function issue(code, path, message, sourceIndex = null) {
  return { code, path, message, sourceIndex };
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }
  return value;
}

function stableSnapshot(value) {
  try {
    return JSON.stringify(value, (_, nested) => Number.isNaN(nested) ? '__NaN__' : nested);
  } catch {
    return null;
  }
}

function sourceGeometry(region) {
  if (Array.isArray(region?.path_points) && region.path_points.length > 0) {
    return { points: region.path_points, field: 'path_points' };
  }
  if (Array.isArray(region?.contour_points) && region.contour_points.length > 0) {
    return { points: region.contour_points, field: 'contour_points' };
  }
  return { points: [], field: null };
}

function sourceHoles(region) {
  if (Array.isArray(region?.holes)) return region.holes;
  if (Array.isArray(region?.hole_points)) return region.hole_points;
  return [];
}

function trustworthySemanticRole(region) {
  if (typeof region?.semanticRole === 'string' && region.semanticRole.trim()) return region.semanticRole;
  if (typeof region?.region_class === 'string' && region.region_class.trim()) return region.region_class;
  return 'unknown';
}

export function adaptV1RegionToRegionV2(region, options = {}) {
  const sourceIndex = Number.isInteger(options.sourceIndex) ? options.sourceIndex : null;
  const errors = [];
  const warnings = [];
  if (!region || typeof region !== 'object' || Array.isArray(region)) {
    return { accepted: false, region: null, errors: [issue('INVALID_SOURCE_REGION', 'region', 'Legacy region must be an object.', sourceIndex)], warnings };
  }
  const geometrySource = sourceGeometry(region);
  if (!geometrySource.field) errors.push(issue('MISSING_GEOMETRY', 'path_points', 'Legacy region requires path_points or contour_points.', sourceIndex));

  const id = typeof region.id === 'string' && region.id.trim() ? region.id : options.generatedId ?? null;
  if (!id) errors.push(issue('MISSING_REGION_ID', 'id', 'Legacy region id is required unless generateMissingIds is enabled.', sourceIndex));
  if (geometrySource.field === 'contour_points') warnings.push(issue('CONTOUR_POINTS_FALLBACK', 'contour_points', 'contour_points was used because path_points was unavailable.', sourceIndex));

  const geometryResult = canonicalizePolygon(geometrySource.points, {
    ...options,
    orientation: 'ccw',
  });
  errors.push(...geometryResult.errors.map(item => ({ ...item, sourceIndex, path: `${geometrySource.field || 'geometry'}.${item.path}` })));

  const holesResult = canonicalizeHoles(sourceHoles(region), options);
  errors.push(...holesResult.errors.map(item => ({ ...item, sourceIndex })));
  warnings.push(...holesResult.warnings.map(item => ({ ...item, sourceIndex })));

  if (errors.length > 0) return { accepted: false, region: null, errors, warnings };

  const canonical = createRegionV2({
    id,
    geometry: geometryResult.polygon,
    holes: holesResult.holes,
    visualColor: cloneValue(region.color ?? region.hex ?? null),
    semanticRole: trustworthySemanticRole(region),
    parentId: region.parentRegionId ?? null,
    childIds: [],
    darkStrokeSupport: cloneValue(region.darkStrokeSupport ?? {}),
    confidence: region.confidence,
    source: {
      adapter: 'v1RegionAdapter',
      originalSourceId: region.id ?? null,
      sourceRegionId: region.sourceRegionId ?? null,
      sourceGeometryField: geometrySource.field,
      name: region.name ?? null,
      object: cloneValue(region.object ?? null),
      objectGroup: region.object_group ?? null,
      regionClass: region.region_class ?? null,
      visible: region.visible !== false,
      originalSource: cloneValue(region.source ?? null),
      coordinateSpace: options.coordinateSpace ?? null,
      explicitHoleCount: holesResult.holes.length,
    },
  });
  return { accepted: true, region: canonical, errors, warnings };
}

export function adaptV1RegionsToRegionV2(regions, options = {}) {
  const source = Array.isArray(regions) ? regions : [];
  const before = stableSnapshot(source);
  const acceptedRegions = [];
  const rejected = [];
  const warnings = [];
  const seenIds = new Set();

  source.forEach((region, index) => {
    if (region?.visible === false && options.includeHidden !== true) {
      rejected.push({
        sourceIndex: index,
        sourceId: region.id ?? null,
        errors: [issue('HIDDEN_REGION_SKIPPED', `regions[${index}].visible`, 'Hidden region skipped because includeHidden is false.', index)],
      });
      return;
    }
    const generatedId = options.generateMissingIds === true && !(typeof region?.id === 'string' && region.id.trim())
      ? `region-v2-${String(index + 1).padStart(4, '0')}`
      : null;
    const adapted = adaptV1RegionToRegionV2(region, { ...options, generatedId, sourceIndex: index });
    warnings.push(...adapted.warnings);
    if (!adapted.accepted) {
      rejected.push({ sourceIndex: index, sourceId: region?.id ?? null, errors: adapted.errors.map(item => ({ ...item })) });
      return;
    }
    if (seenIds.has(adapted.region.id)) {
      rejected.push({
        sourceIndex: index,
        sourceId: adapted.region.id,
        errors: [issue('DUPLICATE_REGION_ID', `regions[${index}].id`, `Duplicate region id "${adapted.region.id}".`, index)],
      });
      return;
    }
    seenIds.add(adapted.region.id);
    acceptedRegions.push(adapted.region);
  });

  const after = stableSnapshot(source);
  return {
    regions: acceptedRegions.map(region => createRegionV2(region)),
    rejected,
    warnings: warnings.map(item => ({ ...item })),
    sourceCount: source.length,
    acceptedCount: acceptedRegions.length,
    rejectedCount: rejected.length,
    mutationsDetected: before !== after,
  };
}
