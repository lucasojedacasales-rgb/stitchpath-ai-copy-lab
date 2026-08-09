function contractError(code, path, message) {
  const error = new TypeError(message);
  error.name = 'Base44ProjectToEngineV2InputError';
  error.code = code;
  error.path = path;
  return error;
}

function cloneRegionValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  Object.entries(value).forEach(([key, nested]) => {
    clone[key] = cloneRegionValue(nested, seen);
  });
  return clone;
}

function requirePositiveFiniteDimension(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw contractError(
      `BASE44_ENGINE_V2_${field.toUpperCase()}_INVALID`,
      `config.${field}`,
      `${field} must be a finite number greater than zero.`,
    );
  }
}

export function adaptBase44ProjectToEngineV2Input(input = {}) {
  const regions = input?.regions;
  const config = input?.config;

  if (!Array.isArray(regions) || regions.length === 0) {
    throw contractError(
      'BASE44_ENGINE_V2_REGIONS_INVALID',
      'regions',
      'regions must be a non-empty array.',
    );
  }

  requirePositiveFiniteDimension(config?.width_mm, 'width_mm');
  requirePositiveFiniteDimension(config?.height_mm, 'height_mm');

  return {
    sourceRegions: cloneRegionValue(regions),
    ingestionOptions: {
      coordinateSpace: 'normalized',
    },
    planningConfig: {
      designWidthMm: config.width_mm,
      designHeightMm: config.height_mm,
    },
  };
}
