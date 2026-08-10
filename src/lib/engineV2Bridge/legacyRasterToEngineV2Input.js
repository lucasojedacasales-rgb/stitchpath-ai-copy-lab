import { canonicalizeHoles, canonicalizePolygon } from '../engineV2/ingestion/geometryCanonicalization.js';
import { ARTWORK_SEMANTIC_ROLES } from '../engineV2/semantics/semanticRoleModel.js';

export const T1_REQUIRED_LEGACY_STAGES = Object.freeze([
  'image_analysis',
  'image_enhancement',
  'contour_engine',
  'semantic_segmentation',
  'vector_engine',
  'region_builder',
  'quality_phase_1_input_segmentation_cleanup',
  'stitch_planner',
  'stitch_optimizer',
]);

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function contractError(code, path, message) {
  const error = new TypeError(message);
  error.name = 'LegacyRasterToEngineV2InputError';
  error.code = code;
  error.path = path;
  return error;
}

function throwContract(code, path, message) {
  throw contractError(code, path, message);
}

function hostile(path) {
  return contractError(
    'T1_RASTER_SOURCE_HOSTILE',
    path,
    'The legacy raster source could not be inspected safely.',
  );
}

function isContractError(caught) {
  if (caught === null || typeof caught !== 'object') return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(caught, 'name');
    return descriptor && 'value' in descriptor
      && descriptor.value === 'LegacyRasterToEngineV2InputError';
  } catch {
    return false;
  }
}

function safelyIsArray(value, path) {
  try {
    return Array.isArray(value);
  } catch {
    throw hostile(path);
  }
}

function inspectRecord(value, path) {
  if (value === null || typeof value !== 'object' || safelyIsArray(value, path)) {
    throwContract('T1_RASTER_STRUCTURE_INVALID', path, `${path} must be a plain object.`);
  }

  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throwContract('T1_RASTER_STRUCTURE_INVALID', path, `${path} must use Object.prototype.`);
    }
    const descriptors = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        throwContract('T1_RASTER_SYMBOL_PROPERTY_FORBIDDEN', path, `${path} must not contain symbol properties.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) throw hostile(`${path}.${key}`);
      if ('get' in descriptor || 'set' in descriptor) {
        throwContract(
          'T1_RASTER_ACCESSOR_PROPERTY_FORBIDDEN',
          `${path}.${key}`,
          `${path}.${key} must be an enumerable data property.`,
        );
      }
      if (descriptor.enumerable !== true) {
        throwContract(
          'T1_RASTER_HIDDEN_PROPERTY_FORBIDDEN',
          `${path}.${key}`,
          `${path}.${key} must not be hidden.`,
        );
      }
      descriptors[key] = descriptor;
    }
    return descriptors;
  } catch (caught) {
    if (isContractError(caught)) throw caught;
    throw hostile(path);
  }
}

function inspectArray(value, path) {
  const isArray = safelyIsArray(value, path);
  if (!isArray) throwContract('T1_RASTER_STRUCTURE_INVALID', path, `${path} must be an array.`);

  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throwContract('T1_RASTER_STRUCTURE_INVALID', path, `${path} must use Array.prototype.`);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (!Number.isSafeInteger(length) || length < 0) throw hostile(path);
    const values = new Array(length);
    const seen = new Set();
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key === 'symbol' || !/^(0|[1-9]\d*)$/.test(key)) {
        throwContract('T1_RASTER_ARRAY_PROPERTY_FORBIDDEN', path, `${path} must contain only indexed values.`);
      }
      const index = Number(key);
      if (index >= length) throw hostile(`${path}[${index}]`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) throw hostile(`${path}[${index}]`);
      if ('get' in descriptor || 'set' in descriptor || descriptor.enumerable !== true) {
        throwContract(
          'T1_RASTER_ACCESSOR_PROPERTY_FORBIDDEN',
          `${path}[${index}]`,
          `${path}[${index}] must be an enumerable data property.`,
        );
      }
      values[index] = descriptor.value;
      seen.add(index);
    }
    if (seen.size !== length) {
      throwContract('T1_RASTER_SPARSE_ARRAY_FORBIDDEN', path, `${path} must not be sparse.`);
    }
    return values;
  } catch (caught) {
    if (isContractError(caught)) throw caught;
    throw hostile(path);
  }
}

function valueOf(descriptors, key) {
  return descriptors[key]?.value;
}

function owns(descriptors, key) {
  return Object.hasOwn(descriptors, key);
}

function requirePositiveFinite(value, path, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throwContract(code, path, `${path} must be a finite number greater than zero.`);
  }
  return value;
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function canonicalPointTuples(polygon) {
  return polygon.map(point => [normalizeZero(point.x), normalizeZero(point.y)]);
}

function comparePointTuples(left, right) {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
  if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
  return 0;
}

function compareRingRotations(points, leftOffset, rightOffset) {
  for (let index = 0; index < points.length; index += 1) {
    const comparison = comparePointTuples(
      points[(leftOffset + index) % points.length],
      points[(rightOffset + index) % points.length],
    );
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function rotateRingToCanonicalStart(points) {
  if (points.length < 2) return points;
  let canonicalOffset = 0;
  for (let offset = 1; offset < points.length; offset += 1) {
    if (compareRingRotations(points, offset, canonicalOffset) < 0) canonicalOffset = offset;
  }
  return points.slice(canonicalOffset).concat(points.slice(0, canonicalOffset));
}

function compareCanonicalRings(left, right) {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    const comparison = comparePointTuples(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

function clonePolygon(value, path) {
  const points = inspectArray(value, path).map((point, index) => {
    const tuple = inspectArray(point, `${path}[${index}]`);
    if (tuple.length !== 2 || tuple.some(coordinate => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) {
      throwContract(
        'T1_RASTER_POINT_INVALID',
        `${path}[${index}]`,
        `${path}[${index}] must contain exactly two finite numeric coordinates.`,
      );
    }
    return [tuple[0], tuple[1]];
  });

  const canonical = canonicalizePolygon(points, {
    coordinateSpace: 'normalized',
    orientation: 'ccw',
  });
  if (!canonical.valid) {
    const first = canonical.errors[0];
    throwContract(
      `T1_RASTER_${first.code}`,
      `${path}.${first.path}`,
      first.message,
    );
  }
  return rotateRingToCanonicalStart(canonicalPointTuples(canonical.polygon));
}

function cloneHoles(value, path) {
  const holes = inspectArray(value, path).map((hole, index) => clonePolygon(hole, `${path}[${index}]`));
  const canonical = canonicalizeHoles(holes, { coordinateSpace: 'normalized' });
  if (!canonical.valid) {
    const first = canonical.errors[0];
    throwContract(`T1_RASTER_${first.code}`, `${path}.${first.path}`, first.message);
  }
  return canonical.holes
    .map(hole => rotateRingToCanonicalStart(canonicalPointTuples(hole)))
    .sort(compareCanonicalRings);
}

function canonicalRingFingerprint(points) {
  const encoded = points.map(point => `${normalizeZero(point[0])},${normalizeZero(point[1])}`);
  if (encoded.length === 0) return '';
  let canonical = null;
  for (let offset = 0; offset < encoded.length; offset += 1) {
    const rotated = encoded.slice(offset).concat(encoded.slice(0, offset)).join(';');
    if (canonical === null || rotated < canonical) canonical = rotated;
  }
  return canonical;
}

function canonicalColor(color) {
  const normalized = color.toLowerCase();
  if (normalized.length === 7) return normalized;
  return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
}

function stableFingerprint(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function deterministicRegionIdentity(index, color, geometry, holes) {
  const stableInput = [
    `position:${index}`,
    `color:${color}`,
    `geometry:${canonicalRingFingerprint(geometry)}`,
    ...holes.map(canonicalRingFingerprint).sort().map(hole => `hole:${hole}`),
  ].join('|');
  const fingerprint = stableFingerprint(stableInput);
  return {
    id: `t1-raster-region-${String(index + 1).padStart(4, '0')}-${fingerprint}`,
    fingerprint,
    stableInput,
  };
}

function registerFingerprintIdentity(registry, identity, path) {
  const registeredInput = registry.get(identity.fingerprint);
  if (registeredInput !== undefined && registeredInput !== identity.stableInput) {
    throwContract(
      'T1_RASTER_REGION_ID_COLLISION',
      path,
      'Two canonically different raster regions produced the same deterministic fingerprint.',
    );
  }
  registry.set(identity.fingerprint, identity.stableInput);
}

export const _t1RasterIdCollisionGuard = Object.freeze({ registerFingerprintIdentity });

function optionalString(descriptors, key, path) {
  if (!owns(descriptors, key)) return null;
  const value = valueOf(descriptors, key);
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throwContract('T1_RASTER_SEMANTIC_EVIDENCE_INVALID', `${path}.${key}`, `${path}.${key} must be a non-empty string when present.`);
  }
  return value;
}

function geometryOf(descriptors, path) {
  const pathPoints = valueOf(descriptors, 'path_points');
  if (pathPoints !== undefined && pathPoints !== null) {
    return { field: 'path_points', points: clonePolygon(pathPoints, `${path}.path_points`) };
  }
  const contourPoints = valueOf(descriptors, 'contour_points');
  if (contourPoints !== undefined && contourPoints !== null) {
    return { field: 'contour_points', points: clonePolygon(contourPoints, `${path}.contour_points`) };
  }
  throwContract(
    'T1_RASTER_GEOMETRY_MISSING',
    path,
    `${path} requires path_points or contour_points.`,
  );
}

function holesOf(descriptors, path) {
  const hasHoles = owns(descriptors, 'holes');
  const hasHolePoints = owns(descriptors, 'hole_points')
    && valueOf(descriptors, 'hole_points') !== null
    && valueOf(descriptors, 'hole_points') !== undefined;
  const legacyHoles = valueOf(descriptors, 'holes');

  const legacyHolesIsArray = safelyIsArray(legacyHoles, `${path}.holes`);
  if (legacyHolesIsArray && hasHolePoints) {
    throwContract(
      'T1_RASTER_HOLE_GEOMETRY_AMBIGUOUS',
      path,
      `${path} must not provide both holes and hole_points polygon arrays.`,
    );
  }
  if (legacyHolesIsArray) {
    const holes = cloneHoles(legacyHoles, `${path}.holes`);
    return { holes, reportedHoleCount: holes.length, sourceField: 'holes' };
  }
  if (hasHolePoints) {
    const holes = cloneHoles(valueOf(descriptors, 'hole_points'), `${path}.hole_points`);
    const reportedHoleCount = typeof legacyHoles === 'number' ? legacyHoles : holes.length;
    if (!Number.isInteger(reportedHoleCount) || reportedHoleCount < 0 || !Number.isFinite(reportedHoleCount)) {
      throwContract('T1_RASTER_HOLE_COUNT_INVALID', `${path}.holes`, `${path}.holes must be a non-negative integer when present as a count.`);
    }
    if (typeof legacyHoles === 'number' && reportedHoleCount !== holes.length) {
      throwContract(
        'T1_RASTER_HOLE_COUNT_MISMATCH',
        `${path}.holes`,
        `${path}.holes must match the number of explicit hole_points polygons.`,
      );
    }
    return { holes, reportedHoleCount, sourceField: 'hole_points' };
  }
  if (hasHoles && legacyHoles !== undefined && legacyHoles !== null
    && (!Number.isInteger(legacyHoles) || legacyHoles < 0 || !Number.isFinite(legacyHoles))) {
    throwContract('T1_RASTER_HOLE_COUNT_INVALID', `${path}.holes`, `${path}.holes must be a non-negative integer or polygon array.`);
  }
  return {
    holes: [],
    reportedHoleCount: typeof legacyHoles === 'number' ? legacyHoles : 0,
    sourceField: null,
  };
}

function verifyLegacyStages(stageLog) {
  const entries = inspectArray(stageLog, 'legacyResult.stageLog');
  const byStage = new Map();
  entries.forEach((entry, index) => {
    const descriptors = inspectRecord(entry, `legacyResult.stageLog[${index}]`);
    const stage = valueOf(descriptors, 'stage');
    const ok = valueOf(descriptors, 'ok');
    if (typeof stage !== 'string' || stage.length === 0 || typeof ok !== 'boolean') {
      throwContract(
        'T1_RASTER_STAGE_LOG_INVALID',
        `legacyResult.stageLog[${index}]`,
        'Every legacy stage log entry requires string stage and boolean ok data properties.',
      );
    }
    if (byStage.has(stage)) {
      throwContract('T1_RASTER_STAGE_DUPLICATED', `legacyResult.stageLog[${index}].stage`, `Legacy stage "${stage}" was logged more than once.`);
    }
    byStage.set(stage, ok);
    if (ok !== true) {
      throwContract('T1_RASTER_STAGE_FAILED', `legacyResult.stageLog[${index}]`, `Legacy stage "${stage}" did not complete successfully.`);
    }
  });
  T1_REQUIRED_LEGACY_STAGES.forEach(stage => {
    if (!byStage.has(stage)) {
      throwContract('T1_RASTER_STAGE_MISSING', 'legacyResult.stageLog', `Required legacy stage "${stage}" is missing.`);
    }
  });
}

function adaptedRegion(region, index, dimensions, identityRegistry) {
  const path = `legacyResult.regions[${index}]`;
  const descriptors = inspectRecord(region, path);
  const legacyId = valueOf(descriptors, 'id');
  if (legacyId !== undefined && legacyId !== null
    && (typeof legacyId !== 'string' || legacyId.length === 0 || legacyId !== legacyId.trim())) {
    throwContract('T1_RASTER_REGION_ID_INVALID', `${path}.id`, `${path}.id must be a non-empty string without surrounding whitespace when present.`);
  }

  const visible = owns(descriptors, 'visible') ? valueOf(descriptors, 'visible') : true;
  if (typeof visible !== 'boolean') {
    throwContract('T1_RASTER_VISIBILITY_INVALID', `${path}.visible`, `${path}.visible must be boolean when present.`);
  }
  if (visible === false) {
    throwContract('T1_RASTER_HIDDEN_REGION_UNSUPPORTED', `${path}.visible`, 'T1 does not silently omit hidden legacy regions.');
  }

  const colorCandidate = valueOf(descriptors, 'color') ?? valueOf(descriptors, 'hex');
  if (typeof colorCandidate !== 'string' || !HEX_COLOR.test(colorCandidate.trim())) {
    throwContract('T1_RASTER_COLOR_INVALID', `${path}.color`, `${path} requires a valid #RGB or #RRGGBB color.`);
  }

  const color = canonicalColor(colorCandidate.trim());
  const geometry = geometryOf(descriptors, path);
  const holeGeometry = holesOf(descriptors, path);
  const identity = deterministicRegionIdentity(index, color, geometry.points, holeGeometry.holes);
  registerFingerprintIdentity(identityRegistry, identity, `${path}.id`);
  const id = identity.id;
  const semanticRole = optionalString(descriptors, 'semanticRole', path);
  if (semanticRole !== null && !ARTWORK_SEMANTIC_ROLES.includes(semanticRole)) {
    throwContract(
      'T1_RASTER_SEMANTIC_ROLE_INVALID',
      `${path}.semanticRole`,
      `${path}.semanticRole is outside the admitted Engine V2 domain.`,
    );
  }

  const sourceRegion = {
    id,
    color,
    visible: true,
    path_points: geometry.points,
    holes: holeGeometry.holes,
    source: {
      adapter: 't1-legacy-raster-observation',
      coordinateSpace: 'normalized',
      sourceWidthPx: dimensions.sourceWidthPx,
      sourceHeightPx: dimensions.sourceHeightPx,
      sourceGeometryField: geometry.field,
      sourceHoleGeometryField: holeGeometry.sourceField,
      reportedLegacyHoleCount: holeGeometry.reportedHoleCount,
    },
  };

  const evidenceFields = ['name', 'object', 'object_group', 'region_class'];
  evidenceFields.forEach(key => {
    const value = optionalString(descriptors, key, path);
    if (value !== null) sourceRegion[key] = value;
  });
  if (semanticRole !== null) sourceRegion.semanticRole = semanticRole;
  return { sourceRegion, legacyId: legacyId ?? null };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach(key => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

export function adaptLegacyRasterPipelineResultToEngineV2Input(legacyResult) {
  const root = inspectRecord(legacyResult, 'legacyResult');
  verifyLegacyStages(valueOf(root, 'stageLog'));

  const config = inspectRecord(valueOf(root, 'config'), 'legacyResult.config');
  const analysis = inspectRecord(valueOf(root, 'analysis'), 'legacyResult.analysis');
  const dimensions = {
    sourceWidthPx: requirePositiveFinite(
      valueOf(analysis, 'imageWidth'),
      'legacyResult.analysis.imageWidth',
      'T1_RASTER_SOURCE_WIDTH_INVALID',
    ),
    sourceHeightPx: requirePositiveFinite(
      valueOf(analysis, 'imageHeight'),
      'legacyResult.analysis.imageHeight',
      'T1_RASTER_SOURCE_HEIGHT_INVALID',
    ),
    designWidthMm: requirePositiveFinite(
      valueOf(config, 'width_mm'),
      'legacyResult.config.width_mm',
      'T1_RASTER_DESIGN_WIDTH_INVALID',
    ),
    designHeightMm: requirePositiveFinite(
      valueOf(config, 'height_mm'),
      'legacyResult.config.height_mm',
      'T1_RASTER_DESIGN_HEIGHT_INVALID',
    ),
  };

  const regions = inspectArray(valueOf(root, 'regions'), 'legacyResult.regions');
  if (regions.length === 0) {
    throwContract('T1_RASTER_REGIONS_EMPTY', 'legacyResult.regions', 'The completed legacy raster pipeline must produce at least one region.');
  }
  const identityRegistry = new Map();
  const adaptedRegions = regions.map((region, index) => adaptedRegion(
    region,
    index,
    dimensions,
    identityRegistry,
  ));
  const sourceRegions = adaptedRegions.map(item => item.sourceRegion);

  return deepFreeze({
    sourceRegions,
    bridgeConfig: {
      width_mm: dimensions.designWidthMm,
      height_mm: dimensions.designHeightMm,
    },
    coordinateContract: {
      coordinateSpace: 'normalized',
      sourceWidthPx: dimensions.sourceWidthPx,
      sourceHeightPx: dimensions.sourceHeightPx,
      designWidthMm: dimensions.designWidthMm,
      designHeightMm: dimensions.designHeightMm,
    },
    metadata: {
      sourceBoundary: 'completed-legacy-raster-pipeline',
      sourceRegionCount: regions.length,
      adaptedRegionCount: sourceRegions.length,
      partialAdaptationApplied: false,
      techniquesImported: false,
      legacyRelationshipsImported: false,
      deterministicIdsApplied: true,
      legacyIdsImportedAsIdentity: false,
    },
    nonContractualProvenance: {
      purpose: 'diagnostic-only',
      legacyRegionProvenance: adaptedRegions.map((item, index) => ({
        sourceRegionId: item.sourceRegion.id,
        legacyRegionId: item.legacyId,
        sourceIndex: index,
      })),
    },
  });
}
