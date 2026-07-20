const DEFAULT_TINY_AREA_RATIO = 0.00045;
const DEFAULT_MERGE_AREA_RATIO = 0.0014;
const DEFAULT_MICRO_AREA_RATIO = 0.0011;
const DEFAULT_SIMPLIFY_EPSILON = 0.0025;

function roundMetric(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function hexToRgb(hex = '#888888') {
  const raw = String(hex || '#888888').replace('#', '').trim();
  const h = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw.padEnd(6, '8');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [136, 136, 136];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb = [136, 136, 136]) {
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function saturation(hex) {
  const [r, g, b] = hexToRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function hueDegrees(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta <= 1e-6) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function colorFamily(hex) {
  const lum = luminance(hex);
  const sat = saturation(hex);
  if (lum < 82) return 'dark';
  if (lum > 212 && sat < 44) return 'light';
  if (sat < 32) return 'neutral';
  const hue = hueDegrees(hex);
  if (hue >= 65 && hue <= 170) return 'green';
  if (hue <= 55 || hue >= 345) return 'red_orange';
  if (hue > 25 && hue <= 75) return 'yellow_orange';
  return 'other';
}

function colorDistance(a, b) {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  return Math.hypot(ar[0] - br[0], ar[1] - br[1], ar[2] - br[2]);
}

function isFinitePoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function clonePoints(points = []) {
  return (points || []).filter(isFinitePoint).map(([x, y]) => [Number(x), Number(y)]);
}

function polygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    if (!isFinitePoint(a) || !isFinitePoint(b)) continue;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

function bbox(points = []) {
  const finite = (points || []).filter(isFinitePoint);
  if (finite.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of finite) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
  };
}

function centroid(points = []) {
  const finite = (points || []).filter(isFinitePoint);
  if (finite.length === 0) return [0.5, 0.5];
  let x = 0;
  let y = 0;
  for (const p of finite) {
    x += p[0];
    y += p[1];
  }
  return [x / finite.length, y / finite.length];
}

function compactness(points = []) {
  const area = polygonArea(points);
  const b = bbox(points);
  const bboxArea = b ? Math.max(0.000001, b.width * b.height) : Math.max(0.000001, area);
  return area / bboxArea;
}

function aspectRatio(points = []) {
  const b = bbox(points);
  if (!b) return 1;
  const shortSide = Math.max(0.000001, Math.min(b.width, b.height));
  return Math.max(b.width, b.height) / shortSide;
}

function textOf(item = {}) {
  return `${item.id || ''} ${item.name || ''} ${item.object || ''} ${item.semantic?.object || ''} ${item.layerType || ''} ${item.region_class || ''} ${item.layerRole || ''} ${item.stitch_type || ''}`.toLowerCase();
}

function isContourLike(item = {}) {
  const text = textOf(item);
  return item.isContour === true ||
    item.type === 'contour' ||
    item.stitch_type === 'running_stitch' ||
    item.stitch_type === 'satin' ||
    /outline|contour|stroke|line|detail|mouth|eye|facial|black/.test(text);
}

function isImportantDetail(item = {}) {
  return /eye|ojo|mouth|boca|nose|nariz|face|facial|detail|foot|feet|pie|outline|contour|silhouette|silueta/.test(textOf(item));
}

function isMicroTriangle(points = [], areaRatio = 0) {
  const b = bbox(points);
  if (!b) return false;
  return areaRatio <= DEFAULT_MICRO_AREA_RATIO &&
    (points.length <= 5 || compactness(points) < 0.28 || aspectRatio(points) > 5.5 || Math.min(b.width, b.height) < 0.012);
}

function pointLineDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy);
  const px = start[0] + t * dx;
  const py = start[1] + t * dy;
  return Math.hypot(point[0] - px, point[1] - py);
}

function rdp(points = [], epsilon = DEFAULT_SIMPLIFY_EPSILON) {
  if (!Array.isArray(points) || points.length < 4) return points || [];
  let maxDistance = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointLineDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  if (maxDistance <= epsilon) return [first, last];
  const left = rdp(points.slice(0, maxIndex + 1), epsilon);
  const right = rdp(points.slice(maxIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function simplifyPolygon(points = [], epsilon = DEFAULT_SIMPLIFY_EPSILON) {
  const finite = clonePoints(points);
  if (finite.length < 4) return finite;
  const first = finite[0];
  const last = finite[finite.length - 1];
  const wasClosed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.00001;
  const open = wasClosed ? finite.slice(0, -1) : finite;
  const simplified = rdp(wasClosed ? [...open, open[0]] : open, epsilon);
  const body = simplified.length >= 4 ? simplified : finite;
  if (wasClosed && body.length > 0) {
    const a = body[0];
    const b = body[body.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.00001) return [...body, [a[0], a[1]]];
  }
  return body;
}

function weightedPalette(annotated = []) {
  const groups = new Map();
  for (const item of annotated) {
    const family = item.family === 'yellow_orange' ? 'red_orange' : item.family;
    if (!['green', 'red_orange', 'dark', 'light', 'neutral'].includes(family)) continue;
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(item);
  }

  const palette = {};
  for (const [family, items] of groups.entries()) {
    const sorted = [...items].sort((a, b) => b.areaRatio - a.areaRatio);
    const seed = sorted[0]?.color;
    if (!seed) continue;
    if (family === 'dark') {
      palette[family] = seed;
      continue;
    }
    const close = sorted.filter((item) => colorDistance(seed, item.color) <= (family === 'green' ? 58 : 64));
    const total = close.reduce((sum, item) => sum + Math.max(item.areaRatio, 0.000001), 0);
    const rgb = [0, 0, 0];
    for (const item of close) {
      const weight = Math.max(item.areaRatio, 0.000001) / total;
      const c = hexToRgb(item.color);
      rgb[0] += c[0] * weight;
      rgb[1] += c[1] * weight;
      rgb[2] += c[2] * weight;
    }
    palette[family] = rgbToHex(rgb);
  }
  return palette;
}

function snapCartoonColor(color, family, palette) {
  const canonicalFamily = family === 'yellow_orange' ? 'red_orange' : family;
  if (canonicalFamily === 'green' && palette.green) return palette.green;
  if (canonicalFamily === 'red_orange' && palette.red_orange) return palette.red_orange;
  if (canonicalFamily === 'dark' && palette.dark) return palette.dark;
  if (canonicalFamily === 'light' && palette.light && colorDistance(color, palette.light) < 46) return palette.light;
  if (canonicalFamily === 'neutral' && palette.neutral && colorDistance(color, palette.neutral) < 42) return palette.neutral;
  return color;
}

function findNearbyLargeRegion(fragment, candidates = []) {
  let best = null;
  for (const candidate of candidates) {
    if (candidate.id === fragment.id) continue;
    if (candidate.family !== fragment.family && !(candidate.family === 'red_orange' && fragment.family === 'yellow_orange')) continue;
    if (candidate.areaRatio < DEFAULT_MERGE_AREA_RATIO * 1.6) continue;
    const distance = Math.hypot(candidate.center[0] - fragment.center[0], candidate.center[1] - fragment.center[1]);
    const maxDistance = Math.max(0.08, Math.min(0.22, Math.sqrt(candidate.areaRatio) * 4.5));
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) best = { item: candidate, distance };
  }
  return best?.item || null;
}

function countRegionsByKind(regions = [], kind = 'fill') {
  return (regions || []).filter((region) => {
    const contour = isContourLike(region);
    return kind === 'contour' ? contour : !contour && (region.stitch_type || 'fill') === 'fill';
  }).length;
}

function createBaseReport(applied = false) {
  return {
    cartoonStructureModeApplied: applied,
    tinyRegionsMerged: 0,
    tinyRegionsSuppressed: 0,
    darkOutlineRegionsDetected: 0,
    outlineObjectsMovedToTop: 0,
    fillRegionCountBefore: 0,
    fillRegionCountAfter: 0,
    contourRegionCountBefore: 0,
    contourRegionCountAfter: 0,
    largestRegionCoveragePercent: 0,
    microFragmentCountBefore: 0,
    microFragmentCountAfter: 0,
    visualStructureScoreEstimate: applied ? 50 : 0,
  };
}

export function createCartoonEmbroideryStructureReport() {
  return createBaseReport(false);
}

export function isCartoonEmbroideryStructureModeEnabled(config = {}) {
  return config?.cartoonEmbroideryStructureMode === true;
}

function visualScore(report) {
  if (!report.cartoonStructureModeApplied) return 0;
  const microReduction = Math.max(0, report.microFragmentCountBefore - report.microFragmentCountAfter);
  const fillReduction = Math.max(0, report.fillRegionCountBefore - report.fillRegionCountAfter);
  const outlineBonus = Math.min(24, report.darkOutlineRegionsDetected * 4 + report.outlineObjectsMovedToTop * 2);
  const noiseBonus = Math.min(22, microReduction * 3 + report.tinyRegionsMerged * 2 + report.tinyRegionsSuppressed);
  const coverageBonus = Math.min(16, report.largestRegionCoveragePercent / 4);
  const fragmentationPenalty = Math.min(24, report.microFragmentCountAfter * 2);
  const colorPenalty = Math.max(0, report.fillRegionCountAfter - 18);
  return Math.max(0, Math.min(100, Math.round(38 + outlineBonus + noiseBonus + coverageBonus + fillReduction - fragmentationPenalty - colorPenalty)));
}

export function prepareCartoonEmbroideryStructureRegions(regions = [], config = {}) {
  if (!isCartoonEmbroideryStructureModeEnabled(config)) {
    return { regions, report: createBaseReport(false) };
  }

  const report = createBaseReport(true);
  report.fillRegionCountBefore = countRegionsByKind(regions, 'fill');
  report.contourRegionCountBefore = countRegionsByKind(regions, 'contour');

  const tinyAreaRatio = Number(config.cartoonStructureTinyAreaRatio) || DEFAULT_TINY_AREA_RATIO;
  const mergeAreaRatio = Number(config.cartoonStructureMergeAreaRatio) || DEFAULT_MERGE_AREA_RATIO;
  const simplifyEpsilon = Number(config.cartoonStructureSimplifyEpsilon) || DEFAULT_SIMPLIFY_EPSILON;

  const annotated = (regions || []).map((region, index) => {
    const pathPoints = clonePoints(region.path_points || region.contour_points || []);
    const color = String(region.color || region.hex || '#888888').toLowerCase();
    const areaRatio = Number(region.area_norm) || polygonArea(pathPoints);
    const b = bbox(pathPoints);
    const family = colorFamily(color);
    const darkOutline = family === 'dark' && (isContourLike(region) || compactness(pathPoints) < 0.48 || aspectRatio(pathPoints) > 2.8 || isImportantDetail(region));
    const microFragment = isMicroTriangle(pathPoints, areaRatio);
    return {
      region,
      index,
      id: region.id || `region_${index}`,
      pathPoints,
      color,
      family,
      areaRatio,
      center: b?.center || centroid(pathPoints),
      important: isImportantDetail(region),
      contour: isContourLike(region),
      darkOutline,
      microFragment,
    };
  });

  report.microFragmentCountBefore = annotated.filter((item) => item.microFragment && !item.important).length;
  report.darkOutlineRegionsDetected = annotated.filter((item) => item.darkOutline).length;

  const totalArea = annotated.reduce((sum, item) => sum + item.areaRatio, 0);
  const largestArea = annotated.reduce((max, item) => Math.max(max, item.areaRatio), 0);
  report.largestRegionCoveragePercent = totalArea > 0 ? roundMetric((largestArea / totalArea) * 100) : 0;

  const palette = weightedPalette(annotated);
  const kept = [];

  for (const item of annotated) {
    const preserveDark = item.family === 'dark' && (item.darkOutline || item.important);
    const tooTiny = item.areaRatio < tinyAreaRatio || item.microFragment;
    const mergeCandidate = !preserveDark && !item.important && item.areaRatio < mergeAreaRatio;
    const nearbyLarge = mergeCandidate ? findNearbyLargeRegion(item, annotated) : null;

    if (nearbyLarge) {
      report.tinyRegionsMerged++;
      continue;
    }

    if (!preserveDark && !item.important && tooTiny) {
      report.tinyRegionsSuppressed++;
      continue;
    }

    const snappedColor = snapCartoonColor(item.color, item.family, palette);
    const simplifiedPoints = simplifyPolygon(item.pathPoints, item.darkOutline ? simplifyEpsilon * 0.6 : simplifyEpsilon);
    if (simplifiedPoints.length < 3 && !item.contour) {
      report.tinyRegionsSuppressed++;
      continue;
    }

    const next = {
      ...item.region,
      path_points: simplifiedPoints,
      color: snappedColor,
      hex: snappedColor,
      cartoonEmbroideryStructureMode: true,
      cartoonColorFamily: item.family,
      cartoonStructureOriginalRegionId: item.region.id || item.id,
      cartoonStructureAreaRatio: roundMetric(item.areaRatio, 6),
    };

    if (item.darkOutline) {
      next.stitch_type = item.region.stitch_type === 'satin' ? 'satin' : 'running_stitch';
      next.region_class = item.region.region_class || 'black_outline';
      next.layerType = item.region.layerType || 'black_outline';
      next.priority = Math.max(Number(item.region.priority) || 0, 98);
      next.blackOutlineFinalPass = true;
      next.cartoonDarkOutline = true;
    } else if ((item.family === 'green' || item.family === 'red_orange' || item.family === 'yellow_orange') && (next.stitch_type || 'fill') === 'fill') {
      next.angle = item.family === 'green' ? 20 : 35;
    }

    kept.push(next);
  }

  report.fillRegionCountAfter = countRegionsByKind(kept, 'fill');
  report.contourRegionCountAfter = countRegionsByKind(kept, 'contour');
  report.microFragmentCountAfter = kept.filter((region) => {
    const pts = region.path_points || [];
    return !isImportantDetail(region) && isMicroTriangle(pts, Number(region.cartoonStructureAreaRatio) || polygonArea(pts));
  }).length;
  report.visualStructureScoreEstimate = visualScore(report);

  return { regions: kept, report };
}

function objectAreaRatio(obj = {}) {
  const area = polygonArea(obj.points || []);
  const explicit = Number(obj.rawRegion?.cartoonStructureAreaRatio || obj.rawRegion?.area_norm);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return area / 10000;
}

function isDarkOutlineObject(obj = {}) {
  const color = obj.color || obj.hex || '#000000';
  if (luminance(color) >= 88) return false;
  if (obj.blackOutlineFinalPass || obj.layerRole === 'black_outline' || obj.rawRegion?.cartoonDarkOutline) return true;
  const pts = obj.points || [];
  return isContourLike(obj) || compactness(pts) < 0.5 || aspectRatio(pts) > 2.7 || isImportantDetail(obj);
}

export function applyCartoonEmbroideryStructureToObjects(objects = [], config = {}, baseReport = null) {
  if (!isCartoonEmbroideryStructureModeEnabled(config)) {
    return { objects, report: createBaseReport(false) };
  }

  const report = {
    ...createBaseReport(true),
    ...(baseReport || {}),
    cartoonStructureModeApplied: true,
  };

  const beforeFillObjects = objects.filter((obj) => (obj.stitch_type || 'fill') === 'fill' && !obj.isContour).length;
  const beforeContourObjects = objects.filter((obj) => obj.isContour || isContourLike(obj)).length;
  let outlineObjectsMovedToTop = 0;
  let darkObjectsDetected = 0;

  const structured = (objects || []).map((obj, index) => {
    const darkOutline = isDarkOutlineObject(obj);
    const areaRatio = objectAreaRatio(obj);
    const micro = areaRatio < DEFAULT_MICRO_AREA_RATIO && !darkOutline && !isImportantDetail(obj);
    const next = {
      ...obj,
      points: clonePoints(obj.points || []),
      rawRegion: obj.rawRegion ? { ...obj.rawRegion } : obj.rawRegion,
      cartoonEmbroideryStructureMode: true,
      _cartoonStructureOrder: index,
    };

    if (micro) {
      next.cartoonMicroFragment = true;
      return next;
    }

    if (darkOutline) {
      darkObjectsDetected++;
      const oldPriority = Number(next.priority) || 0;
      next.priority = Math.max(oldPriority, 98);
      next.layerRole = 'black_outline';
      next.layerType = next.layerType || 'black_outline';
      next.blackOutlineFinalPass = true;
      next.cartoonDarkOutline = true;
      next.ce01SafeFillMode = false;
      next.isContour = true;
      next.stitch_type = next.stitch_type === 'satin' ? 'satin' : 'running_stitch';
      next.stitchType = next.stitch_type;
      if (oldPriority < next.priority) outlineObjectsMovedToTop++;
    }

    return next;
  }).filter((obj) => !obj.cartoonMicroFragment);

  report.darkOutlineRegionsDetected = Math.max(report.darkOutlineRegionsDetected, darkObjectsDetected);
  report.outlineObjectsMovedToTop = outlineObjectsMovedToTop;
  report.fillRegionCountBefore = report.fillRegionCountBefore || beforeFillObjects;
  report.contourRegionCountBefore = Math.max(report.contourRegionCountBefore || 0, beforeContourObjects);
  report.fillRegionCountAfter = structured.filter((obj) => (obj.stitch_type || 'fill') === 'fill' && !obj.isContour).length;
  report.contourRegionCountAfter = structured.filter((obj) => obj.isContour || isContourLike(obj)).length;
  report.microFragmentCountAfter = Math.min(
    report.microFragmentCountAfter,
    structured.filter((obj) => objectAreaRatio(obj) < DEFAULT_MICRO_AREA_RATIO && !isDarkOutlineObject(obj)).length
  );
  report.visualStructureScoreEstimate = visualScore(report);

  structured.sort((a, b) =>
    (a.priority || 10) - (b.priority || 10) ||
    String(a.color || '').localeCompare(String(b.color || '')) ||
    ((a._cartoonStructureOrder ?? 0) - (b._cartoonStructureOrder ?? 0))
  );

  return { objects: structured, report };
}