const issue = (code, path, message) => ({ code, path, message });

function convert(points, width, height, path) {
  const errors = [];
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return { geometry: [], errors: [issue('INVALID_DESIGN_DIMENSION', path, 'Design dimensions must be finite and greater than zero.')] };
  if (!Array.isArray(points)) return { geometry: [], errors: [issue('INVALID_NORMALIZED_POLYGON', path, 'Polygon must be an array.')] };
  const geometry = points.map((point, index) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      errors.push(issue('INVALID_NORMALIZED_POINT', `${path}[${index}]`, 'Point coordinates must be finite.'));
      return null;
    }
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      errors.push(issue('NORMALIZED_COORDINATE_OUT_OF_RANGE', `${path}[${index}]`, 'Normalized coordinates must be between 0 and 1.'));
      return null;
    }
    return { x: point.x * width, y: point.y * height };
  }).filter(Boolean);
  return { geometry: errors.length ? [] : geometry, errors };
}

export function normalizedPolygonToMillimeters(points, designWidthMm, designHeightMm) {
  const result = convert(points, designWidthMm, designHeightMm, 'geometry');
  return { points: result.geometry, errors: result.errors, valid: result.errors.length === 0 };
}

export function normalizedHolesToMillimeters(holes, designWidthMm, designHeightMm) {
  if (!Array.isArray(holes)) return { holes: [], errors: [issue('INVALID_NORMALIZED_HOLES', 'holes', 'Holes must be an array.')], valid: false };
  const errors = [];
  const converted = holes.map((hole, index) => {
    const result = convert(hole, designWidthMm, designHeightMm, `holes[${index}]`);
    errors.push(...result.errors);
    return result.geometry;
  });
  return { holes: errors.length ? [] : converted, errors, valid: errors.length === 0 };
}

export function regionGeometryToMillimeters(region, config) {
  const polygon = normalizedPolygonToMillimeters(region?.geometry, config?.designWidthMm, config?.designHeightMm);
  const holes = normalizedHolesToMillimeters(region?.holes ?? [], config?.designWidthMm, config?.designHeightMm);
  return { geometryMm: polygon.points, holesMm: holes.holes, valid: polygon.valid && holes.valid, errors: [...polygon.errors, ...holes.errors] };
}
