const CLASS_NAMES = [
  'large_fill',
  'medium_fill',
  'satin_outline',
  'running_outline',
  'small_detail',
  'dark_detail',
  'noise_fragment',
  'highlight_detail',
  'hole/internal_cutout',
  'border_contour',
];

export function createUniversalAutoDigitizerProReport(overrides = {}) {
  return {
    universalAutoDigitizerProApplied: false,
    auditOnly: true,
    originalRegionsMutated: false,
    originalPathPointsMutated: false,
    encodersTouched: false,
    totalRegionsInput: 0,
    totalObjectsClassified: 0,
    largeFillCount: 0,
    mediumFillCount: 0,
    satinOutlineCount: 0,
    runningOutlineCount: 0,
    darkDetailCount: 0,
    smallDetailCount: 0,
    noiseFragmentCount: 0,
    noiseFragmentsSuppressed: 0,
    noiseFragmentsMerged: 0,
    blackOutlineObjectsDetected: 0,
    blackOutlineObjectsMovedToTop: 0,
    fillObjectsGenerated: 0,
    satinObjectsGenerated: 0,
    runningObjectsGenerated: 0,
    tatamiObjectsGenerated: 0,
    objectClassificationConfidenceAverage: 0,
    visualStructureScoreEstimate: 0,
    objectClassTable: [],
    classNames: CLASS_NAMES,
    ...overrides,
  };
}

function roundMetric(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function polygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area / 2);
}

function bounds(points = []) {
  const valid = points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (valid.length === 0) return { width: 0, height: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of valid) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { width: maxX - minX, height: maxY - minY, minX, minY, maxX, maxY };
}

function rgb(hex = '') {
  const h = String(hex || '').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function colorStats(hex) {
  const { r, g, b } = rgb(hex);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const darkness = 1 - luminance / 255;
  return {
    luminance,
    spread,
    darkness,
    isDark: luminance < 82,
    isBlackLike: luminance < 70 && spread < 95,
    isHighlight: luminance > 188,
  };
}

function isOutlineLike(obj = {}) {
  const text = `${obj.name || ''} ${obj.layerType || ''} ${obj.stitch_type || ''} ${obj.id || ''}`.toLowerCase();
  return obj.isContour === true || text.includes('outline') || text.includes('contour') || text.includes('border') || text.includes('running');
}

function isBorderLike(obj = {}) {
  const text = `${obj.name || ''} ${obj.layerType || ''} ${obj.id || ''}`.toLowerCase();
  return text.includes('outer') || text.includes('border') || text.includes('silhouette') || text.includes('contour');
}

function clonePoints(points = []) {
  return points.map(p => Array.isArray(p) ? [...p] : p);
}

function cloneObject(obj) {
  return {
    ...obj,
    points: clonePoints(obj.points || []),
    rawRegion: obj.rawRegion ? { ...obj.rawRegion, path_points: clonePoints(obj.rawRegion.path_points || []) } : obj.rawRegion,
  };
}

function classifyObject(obj, config = {}) {
  const designArea = Math.max(1, (config.width_mm || 100) * (config.height_mm || 100));
  const b = bounds(obj.points || []);
  const area = polygonArea(obj.points || []);
  const maxDim = Math.max(b.width, b.height);
  const minDim = Math.max(0.01, Math.min(b.width, b.height));
  const aspectRatio = maxDim / minDim;
  const strokeThicknessEstimate = minDim;
  const color = colorStats(obj.color || '#000000');
  const outlineLike = isOutlineLike(obj);
  const borderLike = isBorderLike(obj);
  const areaRatio = area / designArea;
  const longNarrow = aspectRatio > 3.2 && minDim <= 5.5;
  const tiny = areaRatio < 0.00008 || (area < 0.45 && maxDim < 2.2);
  const small = areaRatio < 0.004 || maxDim < 9;
  const medium = areaRatio < 0.035 || maxDim < 26;
  const visuallyImportantTiny = (color.isDark || color.isHighlight) && area > 0.14 && maxDim > 0.8;
  const blackOutline = color.isBlackLike && (outlineLike || borderLike || longNarrow || small);
  const internalCutout = /hole|cutout|negative|void|internal_cutout/i.test(`${obj.name || ''} ${obj.layerType || ''}`);
  let objectClass = 'large_fill';
  let stitchType = 'fill';
  let layerOrder = 10;
  let confidence = 0.72;
  const reasons = [];

  if (tiny && !visuallyImportantTiny) {
    objectClass = 'noise_fragment';
    stitchType = 'suppressed';
    layerOrder = 0;
    confidence = 0.84;
    reasons.push('tiny low-importance region');
  } else if (internalCutout) {
    objectClass = 'hole/internal_cutout';
    stitchType = 'suppressed';
    layerOrder = 0;
    confidence = 0.72;
    reasons.push('internal cutout marker');
  } else if (blackOutline && borderLike) {
    objectClass = 'border_contour';
    stitchType = strokeThicknessEstimate >= 1.2 ? 'satin' : 'running_stitch';
    layerOrder = 95;
    confidence = 0.9;
    reasons.push('black/dark border contour detected');
  } else if (outlineLike || longNarrow) {
    objectClass = strokeThicknessEstimate >= 1.4 || (blackOutline && strokeThicknessEstimate >= 0.9) ? 'satin_outline' : 'running_outline';
    stitchType = objectClass === 'satin_outline' ? 'satin' : 'running_stitch';
    layerOrder = blackOutline ? 92 : 82;
    confidence = outlineLike ? 0.86 : 0.75;
    reasons.push(outlineLike ? 'outline metadata' : 'long narrow geometry');
  } else if (color.isDark && small) {
    objectClass = 'dark_detail';
    stitchType = strokeThicknessEstimate >= 1.5 && area > 1.2 ? 'satin' : 'running_stitch';
    layerOrder = 90;
    confidence = 0.85;
    reasons.push('dark detail preserved');
  } else if (color.isHighlight && small) {
    objectClass = 'highlight_detail';
    stitchType = area > 2.4 && strokeThicknessEstimate >= 1.4 ? 'satin' : 'running_stitch';
    layerOrder = 62;
    confidence = 0.78;
    reasons.push('bright small detail preserved');
  } else if (small) {
    objectClass = 'small_detail';
    stitchType = area > 3.5 && strokeThicknessEstimate >= 1.6 ? 'satin' : 'running_stitch';
    layerOrder = 55;
    confidence = 0.73;
    reasons.push('small visible object');
  } else if (medium) {
    objectClass = 'medium_fill';
    stitchType = 'fill';
    layerOrder = 20;
    confidence = 0.78;
    reasons.push('medium fill object');
  } else {
    objectClass = 'large_fill';
    stitchType = 'fill';
    layerOrder = 10;
    confidence = 0.82;
    reasons.push('large filled object');
  }

  if (color.isBlackLike) reasons.push('black-like color');
  if (longNarrow) reasons.push('long narrow shape');

  return {
    regionId: obj.id || obj.rawRegion?.id || 'unknown',
    color: obj.color || '#000000',
    area: roundMetric(area),
    width: roundMetric(b.width),
    height: roundMetric(b.height),
    aspectRatio: roundMetric(aspectRatio),
    strokeThicknessEstimate: roundMetric(strokeThicknessEstimate),
    class: objectClass,
    stitchType,
    layerOrder,
    confidence: roundMetric(confidence, 4),
    isBlackOutline: blackOutline,
    reason: reasons.join('; '),
  };
}

function countClass(rows, className) {
  return rows.filter(row => row.class === className).length;
}

function applyClassificationToObject(obj, classification, config = {}) {
  const next = cloneObject(obj);
  next.universalAutoDigitizerPro = true;
  next.universalClass = classification.class;
  next.universalClassificationConfidence = classification.confidence;
  next.priority = classification.layerOrder;
  next.layerType = classification.class;
  next.stitch_type = classification.stitchType === 'suppressed' ? next.stitch_type : classification.stitchType;
  next.isContour = ['satin_outline', 'running_outline', 'dark_detail', 'small_detail', 'highlight_detail', 'border_contour'].includes(classification.class) || next.isContour === true;
  next.rawRegion = {
    ...(next.rawRegion || {}),
    universalClass: classification.class,
    universalStitchType: classification.stitchType,
    universalLayerOrder: classification.layerOrder,
    path_points: clonePoints(next.rawRegion?.path_points || []),
  };

  if (classification.class === 'medium_fill') {
    next.density = Math.max(Number(next.density) || 0, Number(config.universalMediumFillDensityMm) || 0.5);
  }
  if (classification.class === 'large_fill') {
    next.density = Number(next.density) || Number(config.tatami_density) || 0.4;
  }
  if (classification.stitchType === 'satin') {
    next.contourWidthMm = Math.max(Number(next.contourWidthMm) || 0, Math.min(2.2, Math.max(0.9, classification.strokeThicknessEstimate || 1.2)));
  }
  if (classification.stitchType === 'running_stitch') {
    next.contourWidthMm = Number(next.contourWidthMm) || 0.8;
  }

  return next;
}

function visualScore(report) {
  const total = Math.max(1, report.totalObjectsClassified);
  const structured = report.largeFillCount + report.mediumFillCount + report.satinOutlineCount + report.runningOutlineCount + report.darkDetailCount + report.smallDetailCount + report.blackOutlineObjectsDetected;
  const penalty = report.noiseFragmentCount * 3;
  return Math.max(0, Math.min(100, Math.round((structured / total) * 92 + Math.min(8, report.blackOutlineObjectsDetected * 2) - penalty)));
}

export function applyUniversalAutoDigitizerPro(objects = [], sourceRegions = [], config = {}) {
  if (config.universalAutoDigitizerPro !== true) {
    return { objects, report: createUniversalAutoDigitizerProReport({ totalRegionsInput: sourceRegions.length }) };
  }

  const originalRegionSnapshot = JSON.stringify(sourceRegions || []);
  const originalPathSnapshot = JSON.stringify((sourceRegions || []).map(r => r?.path_points || []));
  const classifiedRows = [];
  const output = [];
  let noiseFragmentsSuppressed = 0;
  let blackOutlineObjectsMovedToTop = 0;

  for (const obj of objects || []) {
    const classification = classifyObject(obj, config);
    classifiedRows.push(classification);
    if (classification.class === 'noise_fragment') {
      noiseFragmentsSuppressed++;
      continue;
    }
    if (classification.isBlackOutline && classification.layerOrder >= 90) {
      blackOutlineObjectsMovedToTop++;
    }
    output.push(applyClassificationToObject(obj, classification, config));
  }

  const confidenceAverage = classifiedRows.length > 0
    ? classifiedRows.reduce((sum, row) => sum + row.confidence, 0) / classifiedRows.length
    : 0;
  const report = createUniversalAutoDigitizerProReport({
    universalAutoDigitizerProApplied: true,
    auditOnly: false,
    originalRegionsMutated: JSON.stringify(sourceRegions || []) !== originalRegionSnapshot,
    originalPathPointsMutated: JSON.stringify((sourceRegions || []).map(r => r?.path_points || [])) !== originalPathSnapshot,
    totalRegionsInput: sourceRegions.length,
    totalObjectsClassified: classifiedRows.length,
    largeFillCount: countClass(classifiedRows, 'large_fill'),
    mediumFillCount: countClass(classifiedRows, 'medium_fill'),
    satinOutlineCount: countClass(classifiedRows, 'satin_outline') + countClass(classifiedRows, 'border_contour'),
    runningOutlineCount: countClass(classifiedRows, 'running_outline'),
    darkDetailCount: countClass(classifiedRows, 'dark_detail'),
    smallDetailCount: countClass(classifiedRows, 'small_detail') + countClass(classifiedRows, 'highlight_detail'),
    noiseFragmentCount: countClass(classifiedRows, 'noise_fragment'),
    noiseFragmentsSuppressed,
    noiseFragmentsMerged: 0,
    blackOutlineObjectsDetected: classifiedRows.filter(row => row.isBlackOutline).length,
    blackOutlineObjectsMovedToTop,
    fillObjectsGenerated: output.filter(obj => obj.stitch_type === 'fill').length,
    satinObjectsGenerated: output.filter(obj => obj.stitch_type === 'satin').length,
    runningObjectsGenerated: output.filter(obj => obj.stitch_type === 'running_stitch').length,
    tatamiObjectsGenerated: output.filter(obj => obj.stitch_type === 'fill').length,
    objectClassificationConfidenceAverage: roundMetric(confidenceAverage, 4),
    objectClassTable: classifiedRows,
  });
  report.visualStructureScoreEstimate = visualScore(report);

  return { objects: output, report };
}

function markdownValue(value) {
  if (value == null) return 'unavailable';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function buildUniversalAutoDigitizerProMarkdown(reportInput = null) {
  const report = reportInput || createUniversalAutoDigitizerProReport();
  const lines = [];
  lines.push('# UNIVERSAL_AUTO_DIGITIZER_PRO_REPORT_V1');
  lines.push('');
  lines.push(`Fecha: ${new Date().toISOString()}`);
  lines.push('Tipo: clasificación profesional universal de objetos de bordado antes de generar puntadas.');
  lines.push('');
  lines.push('## Guardrails');
  for (const key of ['universalAutoDigitizerProApplied', 'auditOnly', 'originalRegionsMutated', 'originalPathPointsMutated', 'encodersTouched']) {
    lines.push(`- ${key}=${markdownValue(report[key])}`);
  }
  lines.push('');
  lines.push('## Metadata');
  for (const key of [
    'totalRegionsInput', 'totalObjectsClassified', 'largeFillCount', 'mediumFillCount', 'satinOutlineCount', 'runningOutlineCount',
    'darkDetailCount', 'smallDetailCount', 'noiseFragmentCount', 'noiseFragmentsSuppressed', 'noiseFragmentsMerged',
    'blackOutlineObjectsDetected', 'blackOutlineObjectsMovedToTop', 'fillObjectsGenerated', 'satinObjectsGenerated',
    'runningObjectsGenerated', 'tatamiObjectsGenerated', 'objectClassificationConfidenceAverage', 'visualStructureScoreEstimate',
  ]) lines.push(`- ${key}: ${markdownValue(report[key])}`);
  lines.push('');
  lines.push('## Object class table');
  lines.push('| regionId | color | area | class | stitchType | layerOrder | reason |');
  lines.push('|---|---|---:|---|---|---:|---|');
  for (const row of report.objectClassTable || []) {
    lines.push(`| ${row.regionId} | ${row.color} | ${row.area} | ${row.class} | ${row.stitchType} | ${row.layerOrder} | ${String(row.reason || '').replace(/\|/g, '/')} |`);
  }
  return lines.join('\n');
}