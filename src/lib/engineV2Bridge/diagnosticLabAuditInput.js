import { canonicalizePolygon } from '../engineV2/ingestion/geometryCanonicalization.js';

export const DIAGNOSTIC_LAB_AUDIT_INPUT_SCHEMA_V1 = 'engine-v2-diagnostic-audit-input/v1';

const EXPLICIT_FIXTURE_PROVENANCE = Object.freeze({
  kind: 'explicit-fixture',
  id: 'minimal-internal-pipeline',
});

const DTO_KEYS = Object.freeze([
  'schema',
  'provenance',
  'sourceRegions',
  'ingestionOptions',
  'planningConfig',
]);

const FIXTURE_KEYS = Object.freeze([
  'sourceRegions',
  'ingestionOptions',
  'planningConfig',
]);

const FORBIDDEN_SOURCE_FIELDS = new Set([
  'analysis',
  'diagnosticreport',
  'diagnosticreports',
  'report',
  'reports',
  'geometry',
  'extents',
  'declareddimensions',
  'statistics',
  'stats',
  'metrics',
]);

const INCOMPATIBLE_LINEAGE_FIELDS = new Set([
  'derived',
  'truncated',
  'isderived',
  'istruncated',
  'sourcederived',
  'sourcetruncated',
]);

function contractError(code, path, message) {
  const error = new TypeError(message);
  error.name = 'DiagnosticLabAuditInputError';
  error.code = code;
  error.path = path;
  return error;
}

function cloneValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  Object.entries(value).forEach(([key, nested]) => {
    clone[key] = cloneValue(nested, seen);
  });
  return clone;
}

function requireObject(value, path, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(code, path, `${path} must be an object.`);
  }
}

function requireExactKeys(value, expectedKeys, path, code) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length
    || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    throw contractError(code, path, `${path} must contain only the explicit fixture audit fields.`);
  }
}

function normalizedFieldName(field) {
  return field.replace(/[^a-zA-Z]/g, '').toLowerCase();
}

function rejectForbiddenSources(value, path, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  Object.entries(value).forEach(([field, nested]) => {
    const fieldPath = `${path}.${field}`;
    const normalizedField = normalizedFieldName(field);
    if (INCOMPATIBLE_LINEAGE_FIELDS.has(normalizedField)) {
      throw contractError(
        'DIAGNOSTIC_LAB_AUDIT_INPUT_INCOMPATIBLE_LINEAGE',
        fieldPath,
        `${field} is an incompatible lineage marker for the explicit fixture audit source.`,
      );
    }
    if (FORBIDDEN_SOURCE_FIELDS.has(normalizedField)) {
      throw contractError(
        'DIAGNOSTIC_LAB_AUDIT_INPUT_FORBIDDEN_SOURCE',
        fieldPath,
        `${field} cannot be used as diagnostic audit geometry.`,
      );
    }
    rejectForbiddenSources(nested, fieldPath, seen);
  });
}

function requirePositiveFiniteDimension(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw contractError(
      'DIAGNOSTIC_LAB_AUDIT_INPUT_DIMENSION_INVALID',
      `planningConfig.${field}`,
      `${field} must be a finite number greater than zero.`,
    );
  }
}

function sourceGeometry(region) {
  if (Array.isArray(region.path_points) && region.path_points.length > 0) {
    return { field: 'path_points', points: region.path_points };
  }
  if (Array.isArray(region.contour_points) && region.contour_points.length > 0) {
    return { field: 'contour_points', points: region.contour_points };
  }
  return null;
}

function projectOptionalStringField(region, field, regionPath, projected) {
  if (!Object.prototype.hasOwnProperty.call(region, field)) return;
  if (typeof region[field] !== 'string' || region[field].trim().length === 0) {
    throw contractError(
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_FIELD_INVALID',
      `${regionPath}.${field}`,
      `${field} must be a non-empty string when present.`,
    );
  }
  projected[field] = region[field];
}

function projectValidatedRegion(region, geometry, regionPath) {
  const projected = { id: region.id };
  projectOptionalStringField(region, 'name', regionPath, projected);
  projectOptionalStringField(region, 'region_class', regionPath, projected);
  projectOptionalStringField(region, 'color', regionPath, projected);

  if (Object.prototype.hasOwnProperty.call(region, 'visible')) {
    if (typeof region.visible !== 'boolean') {
      throw contractError(
        'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_FIELD_INVALID',
        `${regionPath}.visible`,
        'visible must be a boolean when present.',
      );
    }
    projected.visible = region.visible;
  }

  projected[geometry.field] = cloneValue(geometry.points);
  return projected;
}

function validateSourceRegions(sourceRegions) {
  if (!Array.isArray(sourceRegions) || sourceRegions.length === 0) {
    throw contractError(
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGIONS_INVALID',
      'sourceRegions',
      'sourceRegions must be a non-empty array.',
    );
  }

  const seenIds = new Set();
  return sourceRegions.map((region, index) => {
    const regionPath = `sourceRegions[${index}]`;
    requireObject(
      region,
      regionPath,
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_INVALID',
    );

    if (typeof region.id !== 'string' || region.id.trim().length === 0) {
      throw contractError(
        'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_ID_INVALID',
        `${regionPath}.id`,
        'Each source region id must be a non-empty string.',
      );
    }

    const normalizedId = region.id.trim();
    if (seenIds.has(normalizedId)) {
      throw contractError(
        'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_ID_DUPLICATE',
        `${regionPath}.id`,
        `Duplicate source region id "${normalizedId}".`,
      );
    }
    seenIds.add(normalizedId);

    const geometry = sourceGeometry(region);
    if (!geometry) {
      throw contractError(
        'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_POINTS_INVALID',
        `${regionPath}.path_points`,
        'Each source region requires non-empty path_points or contour_points.',
      );
    }

    const geometryResult = canonicalizePolygon(geometry.points, {
      coordinateSpace: 'normalized',
      orientation: 'ccw',
    });
    if (!geometryResult.valid) {
      const issue = geometryResult.errors[0];
      const issueSuffix = issue.path === 'geometry'
        ? ''
        : issue.path.slice('geometry'.length);
      throw contractError(
        `DIAGNOSTIC_LAB_AUDIT_INPUT_${issue.code}`,
        `${regionPath}.${geometry.field}${issueSuffix}`,
        issue.message,
      );
    }
    return projectValidatedRegion(region, geometry, regionPath);
  });
}

function requireExplicitFixtureProvenance(provenance) {
  requireObject(
    provenance,
    'provenance',
    'DIAGNOSTIC_LAB_AUDIT_INPUT_PROVENANCE_INVALID',
  );
  requireExactKeys(
    provenance,
    ['kind', 'id'],
    'provenance',
    'DIAGNOSTIC_LAB_AUDIT_INPUT_PROVENANCE_INVALID',
  );
  if (provenance.kind !== EXPLICIT_FIXTURE_PROVENANCE.kind
    || provenance.id !== EXPLICIT_FIXTURE_PROVENANCE.id) {
    throw contractError(
      'DIAGNOSTIC_LAB_AUDIT_INPUT_PROVENANCE_INVALID',
      'provenance',
      'provenance must identify the explicit minimal internal pipeline fixture.',
    );
  }
}

function validateDiagnosticLabAuditInput(input) {
  requireObject(
    input,
    'input',
    'DIAGNOSTIC_LAB_AUDIT_INPUT_REQUIRED',
  );
  rejectForbiddenSources(input, 'input');
  requireExactKeys(
    input,
    DTO_KEYS,
    'input',
    'DIAGNOSTIC_LAB_AUDIT_INPUT_SHAPE_INVALID',
  );

  if (input.schema !== DIAGNOSTIC_LAB_AUDIT_INPUT_SCHEMA_V1) {
    throw contractError(
      'DIAGNOSTIC_LAB_AUDIT_INPUT_SCHEMA_INVALID',
      'schema',
      `schema must be "${DIAGNOSTIC_LAB_AUDIT_INPUT_SCHEMA_V1}".`,
    );
  }

  requireExplicitFixtureProvenance(input.provenance);

  requireObject(
    input.ingestionOptions,
    'ingestionOptions',
    'DIAGNOSTIC_LAB_AUDIT_INPUT_INGESTION_INVALID',
  );
  requireExactKeys(
    input.ingestionOptions,
    ['coordinateSpace'],
    'ingestionOptions',
    'DIAGNOSTIC_LAB_AUDIT_INPUT_INGESTION_INVALID',
  );
  if (input.ingestionOptions.coordinateSpace !== 'normalized') {
    throw contractError(
      'DIAGNOSTIC_LAB_AUDIT_INPUT_COORDINATE_SPACE_INVALID',
      'ingestionOptions.coordinateSpace',
      'coordinateSpace must be exactly "normalized".',
    );
  }

  const projectedSourceRegions = validateSourceRegions(input.sourceRegions);

  requireObject(
    input.planningConfig,
    'planningConfig',
    'DIAGNOSTIC_LAB_AUDIT_INPUT_PLANNING_CONFIG_INVALID',
  );
  requireExactKeys(
    input.planningConfig,
    ['designWidthMm', 'designHeightMm'],
    'planningConfig',
    'DIAGNOSTIC_LAB_AUDIT_INPUT_PLANNING_CONFIG_INVALID',
  );
  requirePositiveFiniteDimension(input.planningConfig.designWidthMm, 'designWidthMm');
  requirePositiveFiniteDimension(input.planningConfig.designHeightMm, 'designHeightMm');
  return { projectedSourceRegions };
}

export function createDiagnosticLabAuditInputFromFixture(fixture, provenance) {
  requireExplicitFixtureProvenance(provenance);
  requireObject(
    fixture,
    'fixture',
    'DIAGNOSTIC_LAB_AUDIT_FIXTURE_REQUIRED',
  );
  rejectForbiddenSources(fixture, 'fixture');
  requireExactKeys(
    fixture,
    FIXTURE_KEYS,
    'fixture',
    'DIAGNOSTIC_LAB_AUDIT_FIXTURE_SHAPE_INVALID',
  );

  const input = {
    schema: DIAGNOSTIC_LAB_AUDIT_INPUT_SCHEMA_V1,
    provenance: cloneValue(provenance),
    sourceRegions: cloneValue(fixture.sourceRegions),
    ingestionOptions: cloneValue(fixture.ingestionOptions),
    planningConfig: cloneValue(fixture.planningConfig),
  };
  const validation = validateDiagnosticLabAuditInput(input);
  return {
    ...input,
    sourceRegions: validation.projectedSourceRegions,
  };
}

export function convertDiagnosticLabAuditInputToBridgeInput(input) {
  const validation = validateDiagnosticLabAuditInput(input);
  return {
    regions: validation.projectedSourceRegions,
    config: {
      width_mm: input.planningConfig.designWidthMm,
      height_mm: input.planningConfig.designHeightMm,
    },
  };
}
