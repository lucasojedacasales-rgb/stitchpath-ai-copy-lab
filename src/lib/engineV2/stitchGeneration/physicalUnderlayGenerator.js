import { analyzeSatinCrossSections } from './satinStitchGenerator.js';
import { calculatePathBounds, resampleClosedPolyline, resampleOpenPolyline } from './stitchGeometry.js';
import { generateTatamiRows } from './tatamiStitchGenerator.js';

function polygonCentroid(points) { return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length }; }
function insetPolygon(points, amount) {
  const center = polygonCentroid(points);
  return points.map(point => { const dx = center.x - point.x; const dy = center.y - point.y; const length = Math.hypot(dx, dy); const scale = length ? Math.min(amount, length * 0.45) / length : 0; return { x: point.x + dx * scale, y: point.y + dy * scale, sourceType: 'underlay_plan' }; });
}

function centerRun({ object, technicalSpecification, component, config }) {
  if (object.stitchType !== 'satin') return { valid: false, subpaths: [], errors: [{ code: 'CENTER_RUN_REQUIRES_SATIN' }] };
  const analysis = analyzeSatinCrossSections({ object, technicalSpecification, config, spacingOverride: technicalSpecification.stitchParameters.spacingMm });
  if (!analysis.valid) return { valid: false, subpaths: [], errors: analysis.errors };
  const centers = analysis.sections.map(section => ({ x: (section.start.x + section.end.x) / 2, y: (section.start.y + section.end.y) / 2, sourceType: 'underlay_plan' }));
  const sampled = resampleOpenPolyline(centers, { targetStitchLengthMm: component.targetStitchLengthMm, minimumStitchLengthMm: Math.min(0.5, component.targetStitchLengthMm), maximumStitchLengthMm: component.targetStitchLengthMm * 1.5, tolerance: config.comparisonToleranceMm });
  return { valid: sampled.valid, subpaths: sampled.valid ? [{ phase: 'underlay', technique: 'center_run', points: sampled.points, closed: false, continuous: true, sourceTechnicalComponent: component }] : [], errors: sampled.errors, warnings: sampled.warnings };
}

function edgeRun({ object, technicalSpecification, component, config }) {
  const inset = insetPolygon(object.geometry, component.insetMm ?? 0); const target = component.targetStitchLengthMm;
  const paths = [inset];
  if (component.source?.preserveHoles) (object.holes || []).forEach(hole => paths.push(insetPolygon(hole, -(component.insetMm ?? 0))));
  const subpaths = []; const errors = []; const warnings = [];
  paths.forEach(path => { const sampled = resampleClosedPolyline(path, { targetStitchLengthMm: target, minimumStitchLengthMm: Math.min(0.5, target), maximumStitchLengthMm: target * 1.5, tolerance: config.comparisonToleranceMm }); errors.push(...sampled.errors); warnings.push(...sampled.warnings); if (sampled.valid) subpaths.push({ phase: 'underlay', technique: 'edge_run', points: sampled.points, closed: true, continuous: true, sourceTechnicalComponent: component }); });
  return { valid: errors.length === 0, subpaths, errors, warnings };
}

function zigzag({ object, technicalSpecification, component, config }) {
  if (object.stitchType !== 'satin') return { valid: false, subpaths: [], errors: [{ code: 'ZIGZAG_REQUIRES_SATIN' }] };
  const analysis = analyzeSatinCrossSections({ object, technicalSpecification, config, spacingOverride: component.spacingMm });
  if (!analysis.valid) return { valid: false, subpaths: [], errors: analysis.errors };
  const points = analysis.sections.map((section, index) => index % 2 ? section.end : section.start).map(point => ({ ...point, sourceType: 'underlay_plan' }));
  return { valid: true, subpaths: [{ phase: 'underlay', technique: 'zigzag', points, closed: false, continuous: true, sourceTechnicalComponent: component }], errors: [], warnings: [] };
}

function lattice({ object, technicalSpecification, component, config }) {
  return generateTatamiRows({ object, technicalSpecification, config, technique: 'tatami_lattice', spacingOverride: component.spacingMm, angleOverride: component.angleDegrees, targetOverride: Math.min(component.spacingMm, technicalSpecification.stitchParameters.targetStitchLengthMm), phase: 'underlay' });
}

export function generatePhysicalUnderlay({ object, technicalSpecification, selectedEntryExit, config }) {
  void selectedEntryExit;
  if (!config.includePhysicalUnderlay || !technicalSpecification?.underlayPlan?.enabled) return { valid: true, subpaths: [], errors: [], warnings: [], coverageMetrics: { underlayDistribution: {} } };
  const generators = { center_run: centerRun, edge_run: edgeRun, zigzag, tatami_lattice: lattice }; const subpaths = []; const errors = []; const warnings = []; const distribution = {};
  for (const component of technicalSpecification.underlayPlan.sequence) {
    const generator = generators[component.type];
    if (!generator) { errors.push({ code: 'UNSUPPORTED_UNDERLAY_COMPONENT', type: component.type }); continue; }
    const generated = generator({ object, technicalSpecification, component, config }); errors.push(...(generated.errors || [])); warnings.push(...(generated.warnings || []));
    if (generated.valid) { subpaths.push(...generated.subpaths); distribution[component.type] = (distribution[component.type] || 0) + generated.subpaths.length; }
  }
  const pointCount = subpaths.reduce((sum, item) => sum + item.points.length, 0);
  if (pointCount > config.maximumPointsPerObject) return { valid: false, subpaths: [], errors: [{ code: 'PHYSICAL_GENERATION_LIMIT_EXCEEDED', requested: pointCount, limit: config.maximumPointsPerObject }], warnings, coverageMetrics: { underlayDistribution: distribution }, pointLimitExceeded: true };
  return { valid: errors.length === 0, subpaths, errors, warnings, coverageMetrics: { underlayDistribution: distribution, underlayBounds: calculatePathBounds(subpaths.flatMap(item => item.points)) } };
}
