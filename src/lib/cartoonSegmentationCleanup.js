function hexToRgb(hex = '#888888') {
  const h = String(hex || '#888888').replace('#', '').padEnd(6, '8');
  return [parseInt(h.slice(0, 2), 16) || 136, parseInt(h.slice(2, 4), 16) || 136, parseInt(h.slice(4, 6), 16) || 136];
}

function rgbToHex([r, g, b]) {
  const to = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function luma(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function sat(hex) {
  const [r, g, b] = hexToRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function colorDistance(a, b) {
  const ar = hexToRgb(a), br = hexToRgb(b);
  return Math.hypot(ar[0] - br[0], ar[1] - br[1], ar[2] - br[2]);
}

function polygonAreaNorm(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

function bbox(points = []) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of points || []) {
    if (!Array.isArray(p)) continue;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  return { minX, minY, maxX, maxY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function centroid(points = []) {
  if (!points.length) return [0.5, 0.5];
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

function touchesCanvasEdge(points = [], margin = 0.012) {
  const b = bbox(points);
  return b.minX <= margin || b.minY <= margin || b.maxX >= 1 - margin || b.maxY >= 1 - margin;
}

function textOf(region) {
  return `${region.id || ''} ${region.name || ''} ${region.object || ''} ${region.semantic?.object || ''} ${region.layerType || ''} ${region.region_class || ''} ${region.universalClass || ''}`.toLowerCase();
}

function isImportantRegion(region) {
  const text = textOf(region);
  return ['eye', 'ojo', 'mouth', 'boca', 'foot', 'feet', 'pie', 'belly', 'barriga', 'silueta', 'silhouette', 'outline', 'contour', 'contorno'].some(k => text.includes(k));
}

function isContourRegion(region) {
  const text = textOf(region);
  return region.type === 'contour' || region.isContour || text.includes('contour') || text.includes('outline') || text.includes('contorno') || region.stitch_type === 'running_stitch';
}

function colorFamily(hex) {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const L = luma(hex), S = max - min;
  if (L < 70 && S < 95) return 'black';
  if (L > 220 && S < 45) return 'white';
  if (S < 35) return 'gray';
  let hue = 0;
  if (max === r) hue = ((g - b) / S) % 6;
  else if (max === g) hue = (b - r) / S + 2;
  else hue = (r - g) / S + 4;
  hue = hue * 60; if (hue < 0) hue += 360;
  if (hue >= 65 && hue <= 165) return 'green';
  if (hue < 65 || hue >= 345) return 'orange_red';
  return 'gray';
}

function classifyBlackRegion(region, areaRatio, edgeTouch) {
  const [cx, cy] = region.centroid || centroid(region.path_points || []);
  const text = textOf(region);
  if (edgeTouch && areaRatio > 0.01 && !isImportantRegion(region)) return 'background_noise';
  if (text.includes('eye') || text.includes('ojo') || text.includes('mouth') || text.includes('boca')) return 'black_eye_mouth';
  if (cy > 0.20 && cy < 0.62 && cx > 0.18 && cx < 0.82 && areaRatio < 0.035) return 'black_eye_mouth';
  if (isContourRegion(region) || text.includes('outline') || text.includes('contour')) return 'black_outline';
  if (areaRatio < 0.012) return 'black_detail';
  return 'background_noise';
}

function buildPalette(regions, maxColors = 6) {
  const byFamily = new Map();
  for (const r of regions) {
    const color = (r.color || r.hex || '#888888').toLowerCase();
    const family = colorFamily(color);
    const area = r._q1?.areaRatio || polygonAreaNorm(r.path_points || []);
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family).push({ color, area });
  }
  const keep = [];
  for (const family of ['green', 'white', 'orange_red', 'black', 'gray']) {
    const items = byFamily.get(family) || [];
    if (!items.length) continue;
    const clusters = [];
    for (const item of items.sort((a, b) => b.area - a.area)) {
      const threshold = family === 'green' ? 38 : family === 'orange_red' ? 42 : family === 'black' ? 55 : 30;
      let c = clusters.find(x => colorDistance(x.color, item.color) <= threshold);
      if (!c) { c = { color: item.color, area: 0, rgb: [0, 0, 0] }; clusters.push(c); }
      const rgb = hexToRgb(item.color);
      c.rgb[0] += rgb[0] * item.area; c.rgb[1] += rgb[1] * item.area; c.rgb[2] += rgb[2] * item.area; c.area += item.area;
    }
    for (const c of clusters) {
      c.color = c.area > 0 ? rgbToHex(c.rgb.map(v => v / c.area)) : c.color;
    }
    keep.push(...clusters.sort((a, b) => b.area - a.area).slice(0, family === 'green' ? 2 : 1));
  }
  return keep.sort((a, b) => b.area - a.area).slice(0, maxColors).map(c => ({ hex: c.color, family: colorFamily(c.color) }));
}

function snapToPalette(color, palette) {
  const family = colorFamily(color);
  const candidates = palette.filter(p => p.family === family);
  let best = null;
  for (const p of candidates.length ? candidates : palette) {
    const d = colorDistance(color, p.hex);
    if (!best || d < best.d) best = { ...p, d };
  }
  if (!best) return color;
  const threshold = family === 'green' ? 46 : family === 'orange_red' ? 52 : family === 'black' ? 70 : 36;
  return best.d <= threshold || candidates.length > 0 ? best.hex : color;
}

function summarizeRegions(regions = []) {
  const colors = new Set(regions.map(r => (r.color || r.hex || '').toLowerCase()).filter(Boolean));
  const black = regions.filter(r => colorFamily(r.color || r.hex) === 'black');
  return {
    totalRegions: regions.length,
    supportedRegions: regions.filter(r => r.supported !== false && r.darkSupport !== 0).length,
    unsupportedRegions: regions.filter(r => r.supported === false || r.darkSupport === 0).length,
    regionColorCount: colors.size,
    blackRegions: black.length,
    blackFills: black.filter(r => (r.stitch_type || 'fill') === 'fill' && !isContourRegion(r)).length,
    outerOutlineCount: regions.filter(r => isContourRegion(r) && (textOf(r).includes('outer') || textOf(r).includes('outline') || textOf(r).includes('contour'))).length,
    detailOpenCurveCount: regions.filter(r => isContourRegion(r) && (r.stitch_type === 'running_stitch' || textOf(r).includes('detail'))).length,
  };
}

export function cleanCartoonSegmentationRegions(regions = [], config = {}) {
  const alreadyClean = regions.some(r => r.qualityPhase1?.applied);
  if (alreadyClean) {
    const summary = summarizeRegions(regions);
    return { regions, report: { phase: 'QUALITY_PHASE_1_INPUT_SEGMENTATION_CLEANUP_V1', alreadyClean: true, before: summary, after: summary } };
  }

  const before = summarizeRegions(regions);
  const darkStroke = config.darkStroke || null;
  const darkPixelsPercentBefore = darkStroke?.rawDarkPixelsBefore && darkStroke?.width && darkStroke?.height
    ? +(darkStroke.rawDarkPixelsBefore / (darkStroke.width * darkStroke.height) * 100).toFixed(2)
    : null;
  const darkPixelsPercentAfter = darkStroke?.rawDarkPixelsAfter && darkStroke?.width && darkStroke?.height
    ? +(darkStroke.rawDarkPixelsAfter / (darkStroke.width * darkStroke.height) * 100).toFixed(2)
    : darkPixelsPercentBefore;
  const darkComponentsBefore = darkStroke?.darkComponentsBefore ?? darkStroke?.darkBackground?.componentsBefore ?? null;
  const darkComponentsAfter = darkStroke?.darkComponentsAfter ?? darkStroke?.darkBackground?.componentsAfter ?? darkComponentsBefore;
  const edgeConnectedDarkComponentsRemoved = darkStroke?.edgeConnectedDarkComponentsRemoved ?? darkStroke?.darkBackground?.edgeConnectedDarkComponentsRemoved ?? 0;

  const annotated = regions.map(r => {
    const pts = r.path_points || r.contour_points || [];
    const areaRatio = r.area_norm ?? polygonAreaNorm(pts);
    const edgeTouch = touchesCanvasEdge(pts);
    const color = (r.color || r.hex || '#888888').toLowerCase();
    return { ...r, path_points: r.path_points || r.contour_points || pts, _q1: { areaRatio, edgeTouch, family: colorFamily(color), important: isImportantRegion(r), contour: isContourRegion(r) } };
  });

  let backgroundNoiseRemoved = 0;
  let rejectedNoiseCount = 0;
  const survivors = [];
  for (const r of annotated) {
    const color = (r.color || r.hex || '#888888').toLowerCase();
    const family = r._q1.family;
    const areaRatio = r._q1.areaRatio;
    const pointCount = r.path_points?.length || 0;
    const unsupported = r.supported === false || r.darkSupport === 0;
    const important = r._q1.important;
    const edgeTouch = r._q1.edgeTouch;
    const blackClass = family === 'black' ? classifyBlackRegion(r, areaRatio, edgeTouch) : null;

    const removeAsBackground = blackClass === 'background_noise' || (edgeTouch && family === 'black' && areaRatio > 0.006 && !important);
    const removeAsMicroNoise = !important && (areaRatio < 0.00025 || (areaRatio < 0.0008 && unsupported) || (areaRatio < 0.0012 && pointCount > 90));
    const removeUnsupportedGray = !important && unsupported && (family === 'gray' || family === 'black') && areaRatio < 0.004;

    if (removeAsBackground || removeAsMicroNoise || removeUnsupportedGray) {
      if (removeAsBackground) backgroundNoiseRemoved++;
      rejectedNoiseCount++;
      continue;
    }

    let next = { ...r };
    if (blackClass) {
      next.blackClassification = blackClass;
      if (blackClass === 'black_outline') {
        next.stitch_type = 'running_stitch';
        next.priority = Math.max(next.priority || 0, 90);
      } else if (blackClass === 'black_detail') {
        next.stitch_type = 'running_stitch';
        next.priority = Math.max(next.priority || 0, 85);
      } else if (blackClass === 'black_eye_mouth') {
        next.stitch_type = areaRatio < 0.008 ? 'fill' : 'running_stitch';
        next.priority = Math.max(next.priority || 0, 86);
      }
    }
    survivors.push(next);
  }

  let contours = survivors.filter(isContourRegion);
  const nonContours = survivors.filter(r => !isContourRegion(r));
  if (contours.length > 15) {
    const sorted = contours
      .map(r => ({ r, score: (r._q1.important ? 100 : 0) + (r._q1.areaRatio * 10000) + ((r.perimeter_mm || 0) * 0.05) }))
      .sort((a, b) => b.score - a.score);
    rejectedNoiseCount += Math.max(0, sorted.length - 15);
    contours = sorted.slice(0, 15).map(x => x.r);
  }

  const palette = buildPalette([...nonContours, ...contours], Math.min(6, config.color_count || 6));
  let mergedSimilarColors = 0;
  const cleaned = [...nonContours, ...contours].map(r => {
    const originalColor = (r.color || r.hex || '#888888').toLowerCase();
    const nextColor = snapToPalette(originalColor, palette);
    if (nextColor !== originalColor) mergedSimilarColors++;
    const areaRatio = r._q1?.areaRatio ?? polygonAreaNorm(r.path_points || []);
    const { _q1, ...plain } = r;
    return {
      ...plain,
      color: nextColor,
      hex: nextColor,
      density: areaRatio < 0.0008 ? Math.max(Number(r.density) || 0.4, 0.55) : r.density,
      qualityPhase1: {
        applied: true,
        areaRatio: +areaRatio.toFixed(6),
        family: colorFamily(nextColor),
        blackClassification: r.blackClassification || null,
        preservedImportant: !!_q1?.important,
      },
    };
  });

  const after = summarizeRegions(cleaned);
  const inputAudit = config.inputAudit || {};
  const report = {
    phase: 'QUALITY_PHASE_1_INPUT_SEGMENTATION_CLEANUP_V1',
    before,
    after,
    input: {
      originalUploadUrl: inputAudit.originalUploadUrl || config.originalUploadUrl || null,
      imageUrl: inputAudit.imageUrl || null,
      processedImageUrl: inputAudit.processedImageUrl || null,
      maskedImageUrl: inputAudit.maskedImageUrl || null,
      darkStrokeSourceUrl: darkStroke?.sourceUrl || inputAudit.darkStrokeSourceUrl || null,
      isUsingMaskedForDarkStroke: !!(darkStroke?.isUsingMaskedForDarkStroke || inputAudit.isUsingMaskedForDarkStroke),
    },
    darkPixelsPercentBefore,
    darkPixelsPercentAfter,
    dominantDarkColorPercentBefore: darkPixelsPercentBefore,
    dominantDarkColorPercentAfter: darkPixelsPercentAfter,
    darkComponentsBefore,
    darkComponentsAfter,
    edgeConnectedDarkComponentsRemoved,
    rejectedNoiseCountBefore: 0,
    rejectedNoiseCountAfter: rejectedNoiseCount,
    backgroundNoiseRemoved,
    mergedSimilarColors,
    palette: palette.map(p => p.hex),
    darkContourCoverageBefore: darkStroke?.darkContourCoverageBefore ?? null,
    darkContourCoverageAfter: darkStroke?.darkContourCoverageAfter ?? null,
  };

  console.log('[quality-phase-1]', report);
  return { regions: cleaned, report };
}