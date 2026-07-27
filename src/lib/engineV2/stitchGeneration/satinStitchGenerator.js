import { clipScanlineToRegion, generateParallelScanlineOrigins } from './polygonScanlineClipper.js';
import { calculatePathBounds, distanceBetweenPoints } from './stitchGeometry.js';

export function analyzeSatinCrossSections({ object, technicalSpecification, config, spacingOverride = null }) {
  if ((object.holes || []).length) return { valid: false, sections: [], errors: [{ code: 'SATIN_HOLE_INTERSECTION' }] };
  const principalAngle = technicalSpecification.fillAnglePlan?.normalizedAngleDegrees;
  if (!Number.isFinite(principalAngle)) return { valid: false, sections: [], errors: [{ code: 'SATIN_DIRECTION_MISSING' }] };
  const angle = (principalAngle + 90) % 180;
  const spacing = spacingOverride ?? technicalSpecification.stitchParameters.spacingMm; const bounds = calculatePathBounds(object.geometry);
  const scanlines = generateParallelScanlineOrigins({ bounds, angleDegrees: angle, spacingMm: spacing, maximumScanlines: config.maximumScanlinesPerObject });
  if (!scanlines.valid) return { valid: false, sections: [], errors: scanlines.errors };
  const sections = []; const errors = [];
  scanlines.origins.forEach((origin, sectionIndex) => {
    const clipped = clipScanlineToRegion({ outerPolygon: object.geometry, holes: [], lineOrigin: origin, lineDirection: scanlines.direction, tolerance: config.comparisonToleranceMm });
    if (clipped.intervals.length > 1) errors.push({ code: 'SATIN_MULTIPLE_INTERVALS', sectionIndex });
    else if (clipped.intervals.length === 1) sections.push({ ...clipped.intervals[0], sectionIndex });
  });
  if (sections.length < 2) errors.push({ code: 'SATIN_INSUFFICIENT_CROSS_SECTIONS' });
  const minimum = technicalSpecification.stitchParameters.minimumAllowedWidthMm; const maximum = technicalSpecification.stitchParameters.maximumAllowedWidthMm;
  if (sections.some(section => section.lengthMm < minimum - config.boundaryToleranceMm)) errors.push({ code: 'SATIN_WIDTH_BELOW_MINIMUM' });
  if (sections.some(section => section.lengthMm > maximum + config.boundaryToleranceMm)) errors.push({ code: 'SATIN_WIDTH_ABOVE_MAXIMUM' });
  const widths = sections.map(section => section.lengthMm); const ratio = widths.length && Math.min(...widths) > 0 ? Math.max(...widths) / Math.min(...widths) : Infinity;
  if (ratio > Math.max(technicalSpecification.stitchParameters.widthVariationRatio * 1.05, 2)) errors.push({ code: 'SATIN_WIDTH_VARIATION_EXCEEDED' });
  return { valid: errors.length === 0, sections, errors, direction: scanlines.direction, spacingMm: spacing, widthVariationRatio: ratio };
}

function compensated(point, direction, amount, sign) { return { x: point.x + direction.x * amount * sign, y: point.y + direction.y * amount * sign, sourceType: 'compensation_adjusted_endpoint' }; }

export function generateSatinPhysicalPath({ object, technicalSpecification, selectedEntryExit, config }) {
  const analysis = analyzeSatinCrossSections({ object, technicalSpecification, config });
  if (!analysis.valid) return { valid: false, subpaths: [], errors: analysis.errors, warnings: [], coverageMetrics: { sectionCount: analysis.sections.length } };
  const amount = technicalSpecification.pullCompensationPlan?.enabled ? Math.min(technicalSpecification.pullCompensationPlan.amountMm, technicalSpecification.pullCompensationPlan.maximumAllowedMm, config.maximumCompensationEnvelopeMm) : 0;
  const variants = [];
  for (const reverse of [false, true]) for (const parity of [0, 1]) {
    const sections = reverse ? [...analysis.sections].reverse() : analysis.sections; const points = [];
    sections.forEach((section, index) => {
      let left = section.start; let right = section.end;
      if (amount) { left = compensated(left, analysis.direction, amount, -1); right = compensated(right, analysis.direction, amount, 1); }
      points.push((index + parity) % 2 ? right : left);
    });
    variants.push({ points, entryDistance: distanceBetweenPoints(selectedEntryExit.entryPoint, points[0]), exitDistance: distanceBetweenPoints(selectedEntryExit.exitPoint, points.at(-1)), signature: `${reverse ? 1 : 0}:${parity}` });
  }
  variants.sort((a, b) => a.entryDistance - b.entryDistance || a.exitDistance - b.exitDistance || a.signature.localeCompare(b.signature)); const selected = variants[0];
  return { valid: true, subpaths: [{ phase: 'top', technique: 'satin', points: selected.points.map(point => ({ ...point, sourceType: point.sourceType ?? 'satin_cross_section' })), closed: false, continuous: true, sourceTechnicalComponent: { spacingMm: analysis.spacingMm, sectionCount: analysis.sections.length, orientationSignature: selected.signature } }], errors: [], warnings: [], coverageMetrics: { sectionCount: analysis.sections.length, widthVariationRatio: analysis.widthVariationRatio, compensationAdjustedPointCount: amount ? selected.points.length : 0, railFlipCount: 0, branchingCount: 0 } };
}
