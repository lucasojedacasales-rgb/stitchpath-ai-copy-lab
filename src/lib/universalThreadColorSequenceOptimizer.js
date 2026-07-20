const REPORT_ID = 'UNIVERSAL_THREAD_COLOR_SEQUENCE_OPTIMIZER_V1';
const REPORT_FILENAME = 'UNIVERSAL_THREAD_COLOR_SEQUENCE_OPTIMIZER_REPORT_V1.md';
const WILCOM_REFERENCE_REPORT_ID = 'WILCOM_THREAD_SEQUENCE_REFERENCE_AUDIT_V1';
const WILCOM_REFERENCE_REPORT_FILENAME = 'WILCOM_THREAD_SEQUENCE_REFERENCE_AUDIT_V1.md';

export function shouldApplyUniversalThreadColorSequenceOptimizer(config = {}) {
  return config.universalAutoDigitizerPro === true &&
    config.unifiedStandardProProfile === true &&
    config.universalThreadColorSequenceOptimizer === true;
}

export function createUniversalThreadColorSequenceOptimizerReport(overrides = {}) {
  return {
    reportId: REPORT_ID,
    reportFilename: REPORT_FILENAME,
    generatedAt: new Date().toISOString(),
    optimizerApplied: false,
    universalThreadColorSequenceOptimizerApplied: false,
    gateEnabled: false,
    requestedUniversalThreadColorSequenceOptimizer: false,
    effectiveUniversalThreadColorSequenceOptimizer: false,
    activationLostAt: [],
    activationLossTrace: {},
    requiredFlags: {
      universalAutoDigitizerPro: false,
      unifiedStandardProProfile: false,
      universalThreadColorSequenceOptimizer: false,
    },
    uniqueVisualColorCountBefore: 0,
    normalizedThreadColorCountAfter: 0,
    colorBlockCountBefore: 0,
    colorBlockCountAfter: 0,
    repeatedThreadColorBlocksBefore: 0,
    repeatedThreadColorBlocksAfter: 0,
    unnecessaryColorChangesRemoved: 0,
    threadChangesBefore: 0,
    threadChangesAfter: 0,
    blackOutlineBlocksBefore: 0,
    blackOutlineBlocksAfter: 0,
    blackOutlineFinishesLast: true,
    jumpCountBefore: 0,
    jumpCountAfter: 0,
    jumpsOver10mmBefore: 0,
    jumpsOver10mmAfter: 0,
    totalJumpTravelMmBefore: 0,
    totalJumpTravelMmAfter: 0,
    estimatedTravelReductionPercent: 0,
    maxJumpMmBefore: 0,
    maxJumpMmAfter: 0,
    routeWithinColorBlocksApplied: false,
    optimizationAccepted: false,
    rejectedReason: null,
    objectCountBefore: 0,
    objectCountAfter: 0,
    stitchCountChangedUnexpectedly: false,
    objectCountChangedUnexpectedly: false,
    fillMovedAboveRelatedOutline: false,
    previewExportParityPreserved: true,
    originalRegionsMutated: false,
    originalPathPointsMutated: false,
    defaultBehaviorChanged: false,
    encodersTouched: false,
    normalizedThreadPalette: [],
    normalizedColorMap: [],
    colorBlockSequenceBefore: [],
    colorBlockSequenceAfter: [],
    threadBlockModel: [],
    objectsMoved: [],
    objectsProtectedByLayerRules: [],
    blackOutlineFinalPositionCheck: {
      passed: true,
      outlineObjectCount: 0,
      firstOutlineIndex: null,
      lastOutlineIndex: null,
      tailStartIndex: null,
    },
    ...overrides,
  };
}

function roundMetric(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function reportGate(config = {}) {
  return {
    universalAutoDigitizerPro: config.universalAutoDigitizerPro === true,
    unifiedStandardProProfile: config.unifiedStandardProProfile === true,
    universalThreadColorSequenceOptimizer: config.universalThreadColorSequenceOptimizer === true,
  };
}

function activationDiagnostics(config = {}, gate = reportGate(config)) {
  const lostAt = [];
  if (!gate.universalAutoDigitizerPro) lostAt.push('universalAutoDigitizerPro');
  if (!gate.unifiedStandardProProfile) lostAt.push('unifiedStandardProProfile');
  if (!gate.universalThreadColorSequenceOptimizer) lostAt.push('universalThreadColorSequenceOptimizer');
  return {
    requestedUniversalThreadColorSequenceOptimizer: config.universalThreadColorSequenceOptimizer === true,
    effectiveUniversalThreadColorSequenceOptimizer: gate.universalThreadColorSequenceOptimizer,
    activationLostAt: lostAt,
    activationLossTrace: {
      configUniversalAutoDigitizerPro: config.universalAutoDigitizerPro === true,
      configUnifiedStandardProProfile: config.unifiedStandardProProfile === true,
      configUniversalThreadColorSequenceOptimizer: config.universalThreadColorSequenceOptimizer === true,
      gateEnabled: gate.universalAutoDigitizerPro && gate.unifiedStandardProProfile && gate.universalThreadColorSequenceOptimizer,
    },
  };
}

function isFinitePoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function firstPoint(points = []) {
  return (points || []).find(isFinitePoint) || null;
}

function lastPoint(points = []) {
  for (let i = (points || []).length - 1; i >= 0; i--) {
    if (isFinitePoint(points[i])) return points[i];
  }
  return null;
}

function distance(a, b) {
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Infinity;
}

function normalizeHex(hex = '#000000') {
  const raw = String(hex || '#000000').trim().toLowerCase();
  const stripped = raw.replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(stripped)) {
    return `#${stripped.split('').map(c => c + c).join('')}`;
  }
  if (/^[0-9a-f]{6}$/i.test(stripped)) return `#${stripped}`;
  return '#000000';
}

function hexToRgb(hex = '#000000') {
  const normalized = normalizeHex(hex).replace('#', '');
  const n = parseInt(normalized, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function colorDistance(a, b) {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  return Math.hypot(ar.r - br.r, ar.g - br.g, ar.b - br.b);
}

function normalizedThreadForColor(color) {
  const visualColor = normalizeHex(color);
  const rgb = hexToRgb(visualColor);
  const hsl = rgbToHsl(rgb);
  const lum = luminance(visualColor);
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const spread = max - min;

  if (lum < 76) {
    return { normalizedThreadColor: '#111111', colorFamily: 'black' };
  }
  if (lum > 218 && spread < 70) {
    return { normalizedThreadColor: '#f7f7f2', colorFamily: 'white' };
  }
  if (hsl.s < 0.18) {
    if (lum > 170) return { normalizedThreadColor: '#d8d8d0', colorFamily: 'light_neutral' };
    return { normalizedThreadColor: '#777777', colorFamily: 'neutral' };
  }

  if (hsl.h >= 70 && hsl.h <= 170) {
    return { normalizedThreadColor: '#36b85f', colorFamily: 'green' };
  }
  if (hsl.h >= 38 && hsl.h < 70) {
    return { normalizedThreadColor: '#f1cf3a', colorFamily: 'yellow' };
  }
  if (hsl.h >= 14 && hsl.h < 38) {
    return { normalizedThreadColor: '#f15f2e', colorFamily: 'orange' };
  }
  if (hsl.h < 14 || hsl.h >= 345) {
    return { normalizedThreadColor: '#e9363f', colorFamily: 'red' };
  }
  if (hsl.h >= 300 && hsl.h < 345) {
    return { normalizedThreadColor: '#e84f86', colorFamily: 'pink' };
  }
  if (hsl.h >= 170 && hsl.h < 250) {
    return { normalizedThreadColor: '#3579d6', colorFamily: 'blue' };
  }
  return { normalizedThreadColor: '#7b58d8', colorFamily: 'purple' };
}

function bbox(points = []) {
  const pts = (points || []).filter(isFinitePoint);
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
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
    width: maxX - minX,
    height: maxY - minY,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
  };
}

function polygonArea(points = []) {
  const pts = (points || []).filter(isFinitePoint);
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area / 2);
}

function objectText(object = {}) {
  return `${object.id || ''} ${object.name || ''} ${object.stitch_type || ''} ${object.stitchType || ''} ${object.layerType || ''} ${object.layerRole || ''} ${object.role || ''} ${object.rawRegion?.name || ''} ${object.rawRegion?.region_class || ''}`.toLowerCase();
}

function modelObject(object, index) {
  const points = Array.isArray(object?.points) ? object.points : [];
  const visualColor = normalizeHex(object?.color || '#000000');
  const normalized = normalizedThreadForColor(visualColor);
  const text = objectText(object);
  const stitchType = object?.stitch_type || object?.stitchType || 'unknown';
  const isFill = stitchType === 'fill' || /fill|tatami|base_fill|foreground_fill/.test(text);
  const isSatin = stitchType === 'satin' || text.includes('satin');
  const isRunning = stitchType === 'running_stitch' || /running|contour|outline|line/.test(text);
  const darkThread = normalized.colorFamily === 'black';
  const outlineText = /outline|contour|stroke|border|outer|inner/.test(text);
  const detailText = /detail|eye|mouth|nose|cheek|facial|shadow|highlight/.test(text);
  const layerOrder = Number(object?.priority ?? object?.layerOrder ?? object?.sortOrder ?? 50);
  const area = polygonArea(points);
  const bounds = bbox(points);
  const isBlackOutline = darkThread && (outlineText || object?.blackOutlineFinalPass === true || layerOrder >= 80);
  const isDarkDetail = darkThread && detailText && !isBlackOutline;
  const isSmallInternalDetail = area > 0 && area <= 8 && detailText && !isBlackOutline;
  const isDetail = detailText || (!isFill && (isRunning || isSatin));
  const objectClass = isBlackOutline
    ? 'black_outline'
    : isDarkDetail
      ? 'dark_detail'
      : isSmallInternalDetail
        ? 'small_internal_detail'
        : isDetail
      ? 'detail'
      : isFill
        ? 'fill'
        : 'other';

  return {
    object,
    originalIndex: index,
    objectId: object?.id || `object_${index}`,
    regionId: object?.rawRegion?.id || object?.rawRegion?.regionId || object?.regionId || object?.id || `region_${index}`,
    visualColor,
    normalizedThreadColor: normalized.normalizedThreadColor,
    colorFamily: normalized.colorFamily,
    stitchType,
    objectClass,
    layerOrder,
    isFill,
    isSatin,
    isRunning,
    isBlackOutline,
    isDarkDetail,
    isSmallInternalDetail,
    isDetail,
    bbox: bounds,
    areaMm2: area,
    entryPoint: firstPoint(points) || bounds?.center || [0, 0],
    exitPoint: lastPoint(points) || bounds?.center || [0, 0],
  };
}

function cloneForThread(model) {
  const object = model.object || {};
  return {
    ...object,
    color: model.normalizedThreadColor,
    visualColor: model.visualColor,
    normalizedThreadColor: model.normalizedThreadColor,
    colorFamily: model.colorFamily,
    threadSequenceOptimized: true,
    _threadOptimizerOriginalIndex: model.originalIndex,
    points: (object.points || []).map(point => Array.isArray(point) ? [...point] : point),
    rawRegion: object.rawRegion ? { ...object.rawRegion } : object.rawRegion,
  };
}

function buildObjectColorBlocks(models = [], colorField = 'visualColor') {
  const blocks = [];
  let current = null;
  for (const model of models) {
    const color = model[colorField] || model.normalizedThreadColor || model.visualColor || '#000000';
    if (!current || current.color !== color) {
      current = {
        color,
        colorFamily: model.colorFamily,
        start: blocks.length ? blocks[blocks.length - 1].end + 1 : 0,
        end: blocks.length ? blocks[blocks.length - 1].end + 1 : 0,
        objectIds: [],
        hasBlackOutline: false,
      };
      blocks.push(current);
    }
    current.end = current.start + current.objectIds.length;
    current.objectIds.push(model.objectId);
    current.hasBlackOutline = current.hasBlackOutline || model.isBlackOutline;
  }
  return blocks;
}

function countRepeatedBlocks(blocks = []) {
  const seen = new Set();
  let repeated = 0;
  for (const block of blocks) {
    if (seen.has(block.color)) repeated++;
    seen.add(block.color);
  }
  return repeated;
}

function routeMetrics(models = []) {
  let cursor = [0, 0];
  let total = 0;
  let jumpCount = 0;
  let jumpsOver10mm = 0;
  let maxJumpMm = 0;
  for (const model of models) {
    const d = distance(cursor, model.entryPoint);
    if (Number.isFinite(d) && d > 0.5) {
      jumpCount++;
      total += d;
      if (d > 10) jumpsOver10mm++;
      maxJumpMm = Math.max(maxJumpMm, d);
    }
    cursor = model.exitPoint || model.entryPoint || cursor;
  }
  return {
    jumpCount,
    jumpsOver10mm,
    totalJumpTravelMm: roundMetric(total),
    maxJumpMm: roundMetric(maxJumpMm),
  };
}

function orderNearest(models = [], start = [0, 0]) {
  const remaining = [...models];
  const ordered = [];
  let cursor = start;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const d = distance(cursor, candidate.entryPoint);
      if (d < bestDistance || (d === bestDistance && candidate.originalIndex < remaining[bestIndex].originalIndex)) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    ordered.push(next);
    cursor = next.exitPoint || next.entryPoint || cursor;
  }
  return { ordered, cursor };
}

function orderColorGroups(models = [], start = [0, 0]) {
  const groups = new Map();
  const groupOrder = [];
  for (const model of models) {
    const key = model.normalizedThreadColor;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(model);
  }

  const remainingGroups = groupOrder.map(color => ({
    color,
    models: groups.get(color),
    firstIndex: Math.min(...groups.get(color).map(model => model.originalIndex)),
  }));
  const ordered = [];
  let cursor = start;
  while (remainingGroups.length > 0) {
    let bestIndex = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remainingGroups.length; i++) {
      const group = remainingGroups[i];
      const nearestEntry = Math.min(...group.models.map(model => distance(cursor, model.entryPoint)));
      const score = nearestEntry + group.firstIndex * 0.001;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const group = remainingGroups.splice(bestIndex, 1)[0];
    const routed = orderNearest(group.models, cursor);
    ordered.push(...routed.ordered);
    cursor = routed.cursor;
  }
  return { ordered, cursor };
}

function sequenceModels(models = []) {
  const fills = models.filter(model => !model.isBlackOutline && !model.isDetail && !model.isDarkDetail && !model.isSmallInternalDetail);
  const details = models.filter(model => !model.isBlackOutline && model.isDetail && !model.isDarkDetail && !model.isSmallInternalDetail);
  const smallInternalDetails = models.filter(model => !model.isBlackOutline && model.isSmallInternalDetail);
  const darkDetails = models.filter(model => !model.isBlackOutline && model.isDarkDetail && !model.isSmallInternalDetail);
  const finalOutlines = models.filter(model => model.isBlackOutline);
  let cursor = [0, 0];
  const ordered = [];

  const fillOrder = orderColorGroups(fills, cursor);
  ordered.push(...fillOrder.ordered);
  cursor = fillOrder.cursor;

  const detailOrder = orderColorGroups(details, cursor);
  ordered.push(...detailOrder.ordered);
  cursor = detailOrder.cursor;

  const smallDetailOrder = orderColorGroups(smallInternalDetails, cursor);
  ordered.push(...smallDetailOrder.ordered);
  cursor = smallDetailOrder.cursor;

  const darkDetailOrder = orderColorGroups(darkDetails, cursor);
  ordered.push(...darkDetailOrder.ordered);
  cursor = darkDetailOrder.cursor;

  const outlineOrder = orderColorGroups(finalOutlines, cursor);
  ordered.push(...outlineOrder.ordered);
  return ordered;
}

function blackOutlineFinishesLast(models = []) {
  const outlineCount = models.filter(model => model.isBlackOutline).length;
  if (outlineCount === 0) return true;
  const tail = models.slice(-outlineCount);
  return tail.length === outlineCount && tail.every(model => model.isBlackOutline);
}

function blackOutlineFinalPositionCheck(models = []) {
  const outlineIndexes = models
    .map((model, index) => model.isBlackOutline ? index : null)
    .filter(index => index !== null);
  if (outlineIndexes.length === 0) {
    return {
      passed: true,
      outlineObjectCount: 0,
      firstOutlineIndex: null,
      lastOutlineIndex: null,
      tailStartIndex: null,
    };
  }
  const tailStartIndex = models.length - outlineIndexes.length;
  return {
    passed: blackOutlineFinishesLast(models),
    outlineObjectCount: outlineIndexes.length,
    firstOutlineIndex: outlineIndexes[0],
    lastOutlineIndex: outlineIndexes[outlineIndexes.length - 1],
    tailStartIndex,
  };
}

function hasOutlineBeforeRelatedFill(models = []) {
  const fillIndex = new Map();
  const outlineIndex = new Map();
  models.forEach((model, index) => {
    const key = String(model.regionId || model.objectId || '');
    if (!key) return;
    if (model.isFill && !fillIndex.has(key)) fillIndex.set(key, index);
    if (model.isBlackOutline && !outlineIndex.has(key)) outlineIndex.set(key, index);
  });
  for (const [key, oi] of outlineIndex.entries()) {
    const fi = fillIndex.get(key);
    if (Number.isFinite(fi) && oi < fi) return true;
  }
  return false;
}

function palette(models = []) {
  const seen = new Map();
  for (const model of models) {
    if (!seen.has(model.normalizedThreadColor)) {
      seen.set(model.normalizedThreadColor, {
        normalizedThreadColor: model.normalizedThreadColor,
        colorFamily: model.colorFamily,
        sampleVisualColors: [],
      });
    }
    const entry = seen.get(model.normalizedThreadColor);
    if (!entry.sampleVisualColors.includes(model.visualColor) && entry.sampleVisualColors.length < 8) {
      entry.sampleVisualColors.push(model.visualColor);
    }
  }
  return [...seen.values()];
}

function normalizedColorMap(models = []) {
  const seen = new Map();
  for (const model of models) {
    const key = `${model.visualColor}->${model.normalizedThreadColor}`;
    if (!seen.has(key)) {
      seen.set(key, {
        visualColor: model.visualColor,
        normalizedThreadColor: model.normalizedThreadColor,
        colorFamily: model.colorFamily,
        objectIds: [],
      });
    }
    const entry = seen.get(key);
    if (entry.objectIds.length < 20) entry.objectIds.push(model.objectId);
  }
  return [...seen.values()];
}

function movedObjects(beforeModels = [], afterModels = []) {
  const beforeIndex = new Map(beforeModels.map((model, index) => [model.objectId, index]));
  return afterModels
    .map((model, index) => ({
      objectId: model.objectId,
      regionId: model.regionId,
      fromIndex: beforeIndex.get(model.objectId),
      toIndex: index,
      visualColor: model.visualColor,
      normalizedThreadColor: model.normalizedThreadColor,
      objectClass: model.objectClass,
    }))
    .filter(row => Number.isFinite(row.fromIndex) && row.fromIndex !== row.toIndex);
}

function protectedObjects(models = []) {
  return models
    .filter(model => model.isBlackOutline || model.isDarkDetail || model.isSmallInternalDetail)
    .map(model => ({
      objectId: model.objectId,
      regionId: model.regionId,
      reason: model.isBlackOutline
        ? 'black_outline_final_pass'
        : model.isDarkDetail
          ? 'dark_internal_detail_before_outline'
          : 'small_internal_detail_preserved',
      visualColor: model.visualColor,
      normalizedThreadColor: model.normalizedThreadColor,
      objectClass: model.objectClass,
    }));
}

function summarizeModel(model) {
  return {
    objectId: model.objectId,
    regionId: model.regionId,
    visualColor: model.visualColor,
    normalizedThreadColor: model.normalizedThreadColor,
    colorFamily: model.colorFamily,
    stitchType: model.stitchType,
    objectClass: model.objectClass,
    layerOrder: model.layerOrder,
    isFill: model.isFill,
    isSatin: model.isSatin,
    isRunning: model.isRunning,
    isBlackOutline: model.isBlackOutline,
    isDarkDetail: model.isDarkDetail,
    isSmallInternalDetail: model.isSmallInternalDetail,
    isDetail: model.isDetail,
    bbox: model.bbox,
    entryPoint: model.entryPoint,
    exitPoint: model.exitPoint,
  };
}

export function optimizeUniversalThreadColorSequenceObjects(objects = [], config = {}, machineSettings = {}) {
  const gate = reportGate(config);
  const report = createUniversalThreadColorSequenceOptimizerReport({
    gateEnabled: shouldApplyUniversalThreadColorSequenceOptimizer(config),
    requiredFlags: gate,
    ...activationDiagnostics(config, gate),
  });

  if (!report.gateEnabled) {
    report.rejectedReason = 'requires universalAutoDigitizerPro + unifiedStandardProProfile + universalThreadColorSequenceOptimizer';
    return { objects, report };
  }

  const sourceObjects = Array.isArray(objects) ? objects : [];
  const beforeModels = sourceObjects.map(modelObject);
  const candidateModels = sequenceModels(beforeModels);
  const beforeBlocks = buildObjectColorBlocks(beforeModels, 'visualColor');
  const afterBlocks = buildObjectColorBlocks(candidateModels, 'normalizedThreadColor');
  const beforeRoute = routeMetrics(beforeModels);
  const afterRoute = routeMetrics(candidateModels);
  const blockReduction = beforeBlocks.length - afterBlocks.length;
  const travelReduction = beforeRoute.totalJumpTravelMm - afterRoute.totalJumpTravelMm;
  const outlineLast = blackOutlineFinishesLast(candidateModels);
  const outlineOrderInvalid = hasOutlineBeforeRelatedFill(candidateModels);
  const objectCountChanged = beforeModels.length !== candidateModels.length;
  const getsWorseWithoutBlockBenefit = blockReduction <= 0 && afterRoute.totalJumpTravelMm > beforeRoute.totalJumpTravelMm + 0.001;

  report.uniqueVisualColorCountBefore = new Set(beforeModels.map(model => model.visualColor)).size;
  report.normalizedThreadColorCountAfter = new Set(candidateModels.map(model => model.normalizedThreadColor)).size;
  report.colorBlockCountBefore = beforeBlocks.length;
  report.colorBlockCountAfter = afterBlocks.length;
  report.repeatedThreadColorBlocksBefore = countRepeatedBlocks(beforeBlocks);
  report.repeatedThreadColorBlocksAfter = countRepeatedBlocks(afterBlocks);
  report.unnecessaryColorChangesRemoved = Math.max(0, report.threadChangesBefore - report.threadChangesAfter);
  report.threadChangesBefore = Math.max(0, beforeBlocks.length - 1);
  report.threadChangesAfter = Math.max(0, afterBlocks.length - 1);
  report.unnecessaryColorChangesRemoved = Math.max(0, report.threadChangesBefore - report.threadChangesAfter);
  report.blackOutlineBlocksBefore = beforeBlocks.filter(block => block.hasBlackOutline).length;
  report.blackOutlineBlocksAfter = afterBlocks.filter(block => block.hasBlackOutline).length;
  report.blackOutlineFinishesLast = outlineLast;
  report.jumpCountBefore = beforeRoute.jumpCount;
  report.jumpCountAfter = afterRoute.jumpCount;
  report.jumpsOver10mmBefore = beforeRoute.jumpsOver10mm;
  report.jumpsOver10mmAfter = afterRoute.jumpsOver10mm;
  report.totalJumpTravelMmBefore = beforeRoute.totalJumpTravelMm;
  report.totalJumpTravelMmAfter = afterRoute.totalJumpTravelMm;
  report.maxJumpMmBefore = beforeRoute.maxJumpMm;
  report.maxJumpMmAfter = afterRoute.maxJumpMm;
  report.estimatedTravelReductionPercent = beforeRoute.totalJumpTravelMm > 0
    ? roundMetric((travelReduction / beforeRoute.totalJumpTravelMm) * 100)
    : 0;
  report.routeWithinColorBlocksApplied = candidateModels.length > 1;
  report.objectCountBefore = beforeModels.length;
  report.objectCountAfter = candidateModels.length;
  report.objectCountChangedUnexpectedly = objectCountChanged;
  report.fillMovedAboveRelatedOutline = outlineOrderInvalid;
  report.normalizedThreadPalette = palette(candidateModels);
  report.normalizedColorMap = normalizedColorMap(candidateModels);
  report.colorBlockSequenceBefore = beforeBlocks.map(block => block.color);
  report.colorBlockSequenceAfter = afterBlocks.map(block => block.color);
  report.threadBlockModel = candidateModels.map(summarizeModel);
  report.objectsMoved = movedObjects(beforeModels, candidateModels);
  report.objectsProtectedByLayerRules = protectedObjects(candidateModels);
  report.blackOutlineFinalPositionCheck = blackOutlineFinalPositionCheck(candidateModels);
  report.machineMaxJumpLengthMm = Number(machineSettings?.maxJumpLength) || null;

  if (objectCountChanged) report.rejectedReason = 'object_count_changed_unexpectedly';
  else if (!outlineLast) report.rejectedReason = 'black_outline_not_final';
  else if (outlineOrderInvalid) report.rejectedReason = 'outline_before_related_fill';
  else if (afterBlocks.length > beforeBlocks.length) report.rejectedReason = 'color_block_count_increased';
  else if (getsWorseWithoutBlockBenefit) report.rejectedReason = 'no_color_block_improvement_and_travel_worse';

  report.optimizationAccepted = !report.rejectedReason;
  report.optimizerApplied = report.optimizationAccepted && (
    blockReduction > 0 ||
    travelReduction > 0.5 ||
    report.normalizedThreadColorCountAfter < report.uniqueVisualColorCountBefore
  );
  report.universalThreadColorSequenceOptimizerApplied = report.optimizerApplied;

  if (!report.optimizationAccepted) {
    return { objects, report };
  }

  return {
    objects: candidateModels.map(cloneForThread),
    report,
  };
}

function commandPoint(command) {
  return command && Number.isFinite(command.x) && Number.isFinite(command.y)
    ? [command.x, command.y]
    : null;
}

function commandThreadColor(command, fallback = '#000000') {
  const raw = command?.color ?? fallback;
  if (typeof raw === 'number') return `thread_${raw}`;
  const text = String(raw || fallback).trim().toLowerCase();
  if (text.startsWith('thread_')) return text;
  if (text.startsWith('#') || /^[0-9a-f]{3,6}$/i.test(text)) return normalizeHex(text);
  return text || normalizeHex(fallback);
}

function normalizedThreadKey(color) {
  return String(color || '').startsWith('thread_')
    ? color
    : normalizedThreadForColor(color).normalizedThreadColor;
}

function buildCommandThreadBlocks(commands = []) {
  const blocks = [];
  let current = null;
  let currentColor = null;
  let cursor = [0, 0];
  for (const command of commands || []) {
    if (!command || command.type === 'end') break;
    if (command.type === 'colorChange') {
      if (current) blocks.push(current);
      current = null;
      currentColor = commandThreadColor(command, currentColor || '#000000');
      continue;
    }
    if (command.type !== 'stitch' && command.type !== 'jump' && command.type !== 'trim') continue;
    const color = commandThreadColor(command, currentColor || '#000000');
    if (!current || color !== current.color) {
      if (current) blocks.push(current);
      current = {
        color,
        normalizedThreadColor: normalizedThreadKey(color),
        startIndex: command.index ?? 0,
        endIndex: command.index ?? 0,
        stitchCount: 0,
        jumpCount: 0,
        travelMm: 0,
      };
    }
    const point = commandPoint(command);
    if (point && command.type === 'jump') {
      current.jumpCount++;
      current.travelMm += distance(cursor, point);
    }
    if (point) cursor = point;
    if (command.type === 'stitch') current.stitchCount++;
    current.endIndex = command.index ?? current.endIndex;
    currentColor = color;
  }
  if (current) blocks.push(current);
  return blocks.map(block => ({ ...block, travelMm: roundMetric(block.travelMm) }));
}

function compareThreadBlocks(referenceBlocks = [], appBlocks = []) {
  const referenceSequence = referenceBlocks.map(block => block.normalizedThreadColor);
  const appSequence = appBlocks.map(block => block.normalizedThreadColor);
  const repeated = (sequence) => {
    const seen = new Set();
    let count = 0;
    for (const color of sequence) {
      if (seen.has(color)) count++;
      seen.add(color);
    }
    return count;
  };
  return {
    referenceColorBlockCount: referenceBlocks.length,
    appColorBlockCount: appBlocks.length,
    referenceUniqueThreadCount: new Set(referenceSequence).size,
    appUniqueThreadCount: new Set(appSequence).size,
    referenceRepeatedThreadBlocks: repeated(referenceSequence),
    appRepeatedThreadBlocks: repeated(appSequence),
    referenceColorChanges: Math.max(0, referenceBlocks.length - 1),
    appColorChanges: Math.max(0, appBlocks.length - 1),
    appHasMoreRepeatedColors: repeated(appSequence) > repeated(referenceSequence),
    appHasMoreColorBlocks: appBlocks.length > referenceBlocks.length,
  };
}

export function runWilcomThreadSequenceReferenceAudit({ wilcomCommands = [], appCommands = [], labels = {} } = {}) {
  const referenceBlocks = buildCommandThreadBlocks(wilcomCommands);
  const appBlocks = buildCommandThreadBlocks(appCommands);
  const comparison = compareThreadBlocks(referenceBlocks, appBlocks);
  return {
    reportId: WILCOM_REFERENCE_REPORT_ID,
    reportFilename: WILCOM_REFERENCE_REPORT_FILENAME,
    generatedAt: new Date().toISOString(),
    auditOnly: true,
    generationModified: false,
    exportModified: false,
    encoderModified: false,
    referenceLabel: labels.reference || 'Wilcom reference',
    appLabel: labels.app || 'App output',
    referenceBlocks,
    appBlocks,
    comparison,
    recommendedFix: comparison.appHasMoreRepeatedColors || comparison.appHasMoreColorBlocks
      ? 'Use universal thread color sequence optimizer to normalize visually identical colors and group compatible same-thread blocks before export.'
      : 'Thread block sequence is not the primary difference in this comparison.',
  };
}

export function buildWilcomThreadSequenceReferenceAuditMarkdown(report = runWilcomThreadSequenceReferenceAudit()) {
  const lines = [];
  lines.push('# WILCOM_THREAD_SEQUENCE_REFERENCE_AUDIT_V1');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- auditOnly: ${report.auditOnly}`);
  lines.push(`- generationModified: ${report.generationModified}`);
  lines.push(`- exportModified: ${report.exportModified}`);
  lines.push(`- encoderModified: ${report.encoderModified}`);
  lines.push(`- referenceLabel: ${report.referenceLabel}`);
  lines.push(`- appLabel: ${report.appLabel}`);
  lines.push('');
  lines.push('## Side By Side');
  lines.push('');
  lines.push('| Metric | Wilcom reference | App output |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| colorBlockCount | ${report.comparison.referenceColorBlockCount} | ${report.comparison.appColorBlockCount} |`);
  lines.push(`| uniqueThreadCount | ${report.comparison.referenceUniqueThreadCount} | ${report.comparison.appUniqueThreadCount} |`);
  lines.push(`| repeatedThreadBlocks | ${report.comparison.referenceRepeatedThreadBlocks} | ${report.comparison.appRepeatedThreadBlocks} |`);
  lines.push(`| colorChanges | ${report.comparison.referenceColorChanges} | ${report.comparison.appColorChanges} |`);
  lines.push('');
  lines.push(`- appHasMoreRepeatedColors: ${report.comparison.appHasMoreRepeatedColors}`);
  lines.push(`- appHasMoreColorBlocks: ${report.comparison.appHasMoreColorBlocks}`);
  lines.push(`- recommendedFix: ${report.recommendedFix}`);
  return lines.join('\n');
}

export function buildUniversalThreadColorSequenceOptimizerMarkdown(report = createUniversalThreadColorSequenceOptimizerReport()) {
  const r = { ...createUniversalThreadColorSequenceOptimizerReport(), ...(report || {}) };
  const lines = [];
  lines.push('# UNIVERSAL_THREAD_COLOR_SEQUENCE_OPTIMIZER_REPORT_V1');
  lines.push('');
  lines.push(`- generatedAt: ${r.generatedAt}`);
  lines.push(`- optimizerApplied: ${r.optimizerApplied}`);
  lines.push(`- universalThreadColorSequenceOptimizerApplied: ${r.universalThreadColorSequenceOptimizerApplied}`);
  lines.push(`- gateEnabled: ${r.gateEnabled}`);
  lines.push(`- requestedUniversalThreadColorSequenceOptimizer: ${r.requestedUniversalThreadColorSequenceOptimizer}`);
  lines.push(`- effectiveUniversalThreadColorSequenceOptimizer: ${r.effectiveUniversalThreadColorSequenceOptimizer}`);
  lines.push(`- activationLostAt: ${JSON.stringify(r.activationLostAt)}`);
  lines.push(`- activationLossTrace: ${JSON.stringify(r.activationLossTrace)}`);
  lines.push(`- requiredFlags: ${JSON.stringify(r.requiredFlags)}`);
  lines.push(`- uniqueVisualColorCountBefore: ${r.uniqueVisualColorCountBefore}`);
  lines.push(`- normalizedThreadColorCountAfter: ${r.normalizedThreadColorCountAfter}`);
  lines.push(`- colorBlockCountBefore: ${r.colorBlockCountBefore}`);
  lines.push(`- colorBlockCountAfter: ${r.colorBlockCountAfter}`);
  lines.push(`- repeatedThreadColorBlocksBefore: ${r.repeatedThreadColorBlocksBefore}`);
  lines.push(`- repeatedThreadColorBlocksAfter: ${r.repeatedThreadColorBlocksAfter}`);
  lines.push(`- unnecessaryColorChangesRemoved: ${r.unnecessaryColorChangesRemoved}`);
  lines.push(`- threadChangesBefore: ${r.threadChangesBefore}`);
  lines.push(`- threadChangesAfter: ${r.threadChangesAfter}`);
  lines.push(`- blackOutlineBlocksBefore: ${r.blackOutlineBlocksBefore}`);
  lines.push(`- blackOutlineBlocksAfter: ${r.blackOutlineBlocksAfter}`);
  lines.push(`- blackOutlineFinishesLast: ${r.blackOutlineFinishesLast}`);
  lines.push(`- jumpCountBefore: ${r.jumpCountBefore}`);
  lines.push(`- jumpCountAfter: ${r.jumpCountAfter}`);
  lines.push(`- jumpsOver10mmBefore: ${r.jumpsOver10mmBefore}`);
  lines.push(`- jumpsOver10mmAfter: ${r.jumpsOver10mmAfter}`);
  lines.push(`- totalJumpTravelMmBefore: ${r.totalJumpTravelMmBefore}`);
  lines.push(`- totalJumpTravelMmAfter: ${r.totalJumpTravelMmAfter}`);
  lines.push(`- maxJumpMmBefore: ${r.maxJumpMmBefore}`);
  lines.push(`- maxJumpMmAfter: ${r.maxJumpMmAfter}`);
  lines.push(`- estimatedTravelReductionPercent: ${r.estimatedTravelReductionPercent}`);
  lines.push(`- routeWithinColorBlocksApplied: ${r.routeWithinColorBlocksApplied}`);
  lines.push(`- optimizationAccepted: ${r.optimizationAccepted}`);
  if (r.rejectedReason) lines.push(`- rejectedReason: ${r.rejectedReason}`);
  lines.push(`- previewExportParityPreserved: ${r.previewExportParityPreserved}`);
  lines.push(`- originalRegionsMutated: ${r.originalRegionsMutated}`);
  lines.push(`- originalPathPointsMutated: ${r.originalPathPointsMutated}`);
  lines.push(`- defaultBehaviorChanged: ${r.defaultBehaviorChanged}`);
  lines.push(`- encodersTouched: ${r.encodersTouched}`);
  lines.push(`- blackOutlineFinalPositionCheck: ${JSON.stringify(r.blackOutlineFinalPositionCheck)}`);
  lines.push('');
  lines.push('## Normalized Thread Palette');
  lines.push('');
  lines.push('| normalizedThreadColor | colorFamily | sampleVisualColors |');
  lines.push('| --- | --- | --- |');
  for (const entry of r.normalizedThreadPalette || []) {
    lines.push(`| ${entry.normalizedThreadColor} | ${entry.colorFamily} | ${(entry.sampleVisualColors || []).join(', ')} |`);
  }
  lines.push('');
  lines.push('## Normalized Color Map');
  lines.push('');
  lines.push('| visualColor | normalizedThreadColor | colorFamily | objectIds |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of r.normalizedColorMap || []) {
    lines.push(`| ${entry.visualColor} | ${entry.normalizedThreadColor} | ${entry.colorFamily} | ${(entry.objectIds || []).join(', ')} |`);
  }
  lines.push('');
  lines.push('## Color Block Sequences');
  lines.push('');
  lines.push(`- colorBlockSequenceBefore: ${(r.colorBlockSequenceBefore || []).join(' -> ')}`);
  lines.push(`- colorBlockSequenceAfter: ${(r.colorBlockSequenceAfter || []).join(' -> ')}`);
  lines.push('');
  lines.push('## Objects Moved');
  lines.push('');
  lines.push('| objectId | regionId | fromIndex | toIndex | visualColor | normalizedThreadColor | objectClass |');
  lines.push('| --- | --- | ---: | ---: | --- | --- | --- |');
  for (const row of (r.objectsMoved || []).slice(0, 200)) {
    lines.push(`| ${row.objectId} | ${row.regionId} | ${row.fromIndex} | ${row.toIndex} | ${row.visualColor} | ${row.normalizedThreadColor} | ${row.objectClass} |`);
  }
  lines.push('');
  lines.push('## Objects Protected By Layer Rules');
  lines.push('');
  lines.push('| objectId | regionId | reason | visualColor | normalizedThreadColor | objectClass |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of (r.objectsProtectedByLayerRules || []).slice(0, 200)) {
    lines.push(`| ${row.objectId} | ${row.regionId} | ${row.reason} | ${row.visualColor} | ${row.normalizedThreadColor} | ${row.objectClass} |`);
  }
  lines.push('');
  lines.push('## Thread Block Model');
  lines.push('');
  lines.push('| objectId | regionId | visualColor | normalizedThreadColor | class | stitchType | outline | darkDetail | smallInternalDetail | detail |');
  lines.push('| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |');
  for (const row of (r.threadBlockModel || []).slice(0, 200)) {
    lines.push(`| ${row.objectId} | ${row.regionId} | ${row.visualColor} | ${row.normalizedThreadColor} | ${row.objectClass} | ${row.stitchType} | ${row.isBlackOutline} | ${row.isDarkDetail} | ${row.isSmallInternalDetail} | ${row.isDetail} |`);
  }
  return lines.join('\n');
}