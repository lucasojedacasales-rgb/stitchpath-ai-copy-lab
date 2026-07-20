import { validateCE01 } from '@/lib/ce01Validator';

const GUARD_ID = 'STITCHED_TRANSITION_TO_JUMP_GUARD_V1';
const MAX_CONVERTED = 260;

export function applyStitchedTransitionToJumpGuard({ commands = [], objects = [], regions = [], config = {}, darkStroke = null, machineSettings = {} }) {
  const regionIndex = buildRegionIndex(regions, config);
  const beforeMetrics = measureTransitionGuardMetrics(commands, regions, config, darkStroke, regionIndex);
  const beforeCe01 = safeCE01(commands, objects, regions, config, machineSettings);
  const beforeEmptyBlocks = countEmptyBlocks(commands);
  const candidate = [];
  const converted = [];
  let skippedSafeStitches = 0;
  let skippedLowConfidence = 0;
  let prevCoord = null;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd?.type !== 'stitch' || !hasPoint(cmd) || !prevCoord || !hasPoint(prevCoord.cmd)) {
      candidate.push(cmd);
      if (hasPoint(cmd)) prevCoord = { index: i, cmd };
      continue;
    }

    const inspection = inspectTransition({ index: i, previousIndex: prevCoord.index, prev: prevCoord.cmd, cmd, regions, config, darkStroke, regionIndex });
    const shouldConvert = inspection.distanceMm > 8 && inspection.isSuspicious && (inspection.severity === 'HIGH' || inspection.severity === 'CRITICAL') && converted.length < MAX_CONVERTED;

    if (shouldConvert && Number.isFinite(cmd.x) && Number.isFinite(cmd.y)) {
      const last = candidate[candidate.length - 1];
      if (last?.type !== 'trim') {
        candidate.push({
          type: 'trim',
          color: cmd.color,
          regionId: cmd.regionId,
          layerType: cmd.layerType,
          source: GUARD_ID,
          generatedBy: GUARD_ID,
          repairedFrom: 'visible_stitched_transition',
        });
      }
      candidate.push({
        ...cmd,
        type: 'jump',
        source: GUARD_ID,
        generatedBy: GUARD_ID,
        repairedFrom: 'visible_stitched_transition',
      });
      converted.push(inspection);
      prevCoord = { index: i, cmd: { ...cmd, type: 'jump' } };
      continue;
    }

    if (inspection.distanceMm > 8 && inspection.isSuspicious) skippedLowConfidence++;
    else skippedSafeStitches++;
    candidate.push(cmd);
    prevCoord = { index: i, cmd };
  }

  const cleaned = dedupeConsecutiveTrims(candidate);
  const afterMetrics = measureTransitionGuardMetrics(cleaned, regions, config, darkStroke, regionIndex);
  const afterCe01 = safeCE01(cleaned, objects, regions, config, machineSettings);
  const afterEmptyBlocks = countEmptyBlocks(cleaned);
  const validation = validateTransaction({ beforeMetrics, afterMetrics, beforeCe01, afterCe01, beforeEmptyBlocks, afterEmptyBlocks, beforeCommands: commands, afterCommands: cleaned });
  const phaseAccepted = validation.accepted;
  const returned = phaseAccepted ? cleaned : commands;
  const report = buildGuardReport({
    phaseAccepted,
    revertReason: validation.revertReason,
    convertedTransitions: phaseAccepted ? converted.length : 0,
    attemptedConvertedTransitions: converted.length,
    skippedSafeStitches,
    skippedLowConfidence,
    beforeMetrics,
    afterMetrics,
    beforeCe01,
    afterCe01,
    beforeEmptyBlocks,
    afterEmptyBlocks,
    commandsReturnedSource: phaseAccepted ? 'transitionGuardAccepted' : 'beforeTransitionGuard',
    converted,
  });

  return {
    commands: returned,
    report,
    md: reportToMarkdown(report),
  };
}

function validateTransaction({ beforeMetrics, afterMetrics, beforeCe01, afterCe01, beforeEmptyBlocks, afterEmptyBlocks, beforeCommands, afterCommands }) {
  const severeDrop = beforeMetrics.severeVisibleLongStitchCount > 0
    ? (beforeMetrics.severeVisibleLongStitchCount - afterMetrics.severeVisibleLongStitchCount) / beforeMetrics.severeVisibleLongStitchCount
    : 1;
  const travelDrop = beforeMetrics.stitchedTravelCount > 0
    ? (beforeMetrics.stitchedTravelCount - afterMetrics.stitchedTravelCount) / beforeMetrics.stitchedTravelCount
    : 1;
  const checks = [
    [afterMetrics.visibleLongStitchCount < beforeMetrics.visibleLongStitchCount, 'visibleLongStitchCount did not improve'],
    [afterMetrics.severeVisibleLongStitchCount < beforeMetrics.severeVisibleLongStitchCount, 'severeVisibleLongStitchCount did not improve'],
    [afterMetrics.stitchedTravelCount < beforeMetrics.stitchedTravelCount, 'stitchedTravelCount did not improve'],
    [afterMetrics.maxVisibleStitchMm < beforeMetrics.maxVisibleStitchMm, 'maxVisibleStitchMm did not improve'],
    [severeDrop >= 0.5, 'severeVisibleLongStitchCount did not drop by at least 50%'],
    [travelDrop >= 0.5, 'stitchedTravelCount did not drop by at least 50%'],
    [afterMetrics.finalLookExportMismatch === false, 'finalLookExportMismatch changed to true'],
    [afterCe01.status !== 'INVALID' || beforeCe01.status === 'INVALID', 'CE01 became INVALID'],
    [!hasNaNCoordinates(afterCommands), 'NaN coordinates detected'],
    [afterEmptyBlocks <= beforeEmptyBlocks, 'empty blocks increased'],
    [afterCommands.length - beforeCommands.length <= 600, 'totalCommands grew by more than 600'],
    [afterMetrics.totalTrims - beforeMetrics.totalTrims <= MAX_CONVERTED, 'trimCount grew by more than 260'],
    [afterMetrics.totalJumps - beforeMetrics.totalJumps <= MAX_CONVERTED, 'jumpCount grew by more than 260'],
  ];
  const failed = checks.find(([ok]) => !ok);
  return { accepted: !failed, revertReason: failed ? failed[1] : null };
}

function inspectTransition({ index, previousIndex, prev, cmd, regions, config, darkStroke, regionIndex }) {
  const indexRef = regionIndex || buildRegionIndex(regions, config);
  const distanceMm = Math.hypot(cmd.x - prev.x, cmd.y - prev.y);
  const regionId = cmd.regionId || findContainingRegionId(cmd.x, cmd.y, indexRef, config);
  const prevRegionId = prev.regionId || findContainingRegionId(prev.x, prev.y, indexRef, config);
  const regionChanged = !!regionId && !!prevRegionId && regionId !== prevRegionId;
  const layerChanged = normalizeLayer(cmd.layerType || cmd.stitchType) !== normalizeLayer(prev.layerType || prev.stitchType);
  const sourceChanged = normalizeSource(cmd.source) !== normalizeSource(prev.source);
  const samples = sampleSegment(prev.x, prev.y, cmd.x, cmd.y, 10);
  const crossesEmptySpace = samples.some(p => !findContainingRegionId(p.x, p.y, indexRef, config));
  const crossesAnotherRegion = samples.some(p => {
    const rid = findContainingRegionId(p.x, p.y, indexRef, config);
    return rid && rid !== regionId && rid !== prevRegionId;
  });
  const isFill = /fill|tatami|ce01_safe_fill/i.test(`${cmd.stitchType || ''} ${cmd.layerType || ''} ${cmd.source || ''}`);
  const currentRegion = findIndexedRegion(indexRef, regionId);
  const fillSegmentOutsidePolygon = isFill && currentRegion && samples.some(p => !pointInIndexedRegion(p.x, p.y, currentRegion));
  const fillSegmentCrossesHoleOrEmpty = isFill && crossesEmptySpace;
  const isBlackContour = isBlackColor(cmd.color) || /contour|outline|running|detail/i.test(`${cmd.stitchType || ''} ${cmd.layerType || ''} ${cmd.source || ''}`);
  const darkSupport = darkSegmentSupport(prev.x, prev.y, cmd.x, cmd.y, darkStroke, config);
  const blackContourWithoutSupport = isBlackContour && darkSupport.ratio < 0.25;
  const stitchedTravelCandidate = distanceMm > 8 && (regionChanged || layerChanged || sourceChanged || crossesEmptySpace || crossesAnotherRegion || blackContourWithoutSupport);
  const reason = [];
  if (distanceMm > 4) reason.push('visibleLongStitch');
  if (distanceMm > 8) reason.push('severeVisibleLongStitch');
  if (stitchedTravelCandidate) reason.push('stitchedTravelCandidate');
  if (regionChanged) reason.push('crossRegionStitch');
  if (layerChanged) reason.push('layerTypeChanged');
  if (sourceChanged) reason.push('sourceChanged');
  if (crossesEmptySpace) reason.push('crossesEmptySpace');
  if (crossesAnotherRegion) reason.push('crossesDifferentRegion');
  if (fillSegmentOutsidePolygon) reason.push('fillSegmentOutsidePolygon');
  if (fillSegmentCrossesHoleOrEmpty) reason.push('fillSegmentCrossesHoleOrEmpty');
  if (blackContourWithoutSupport) reason.push('blackContourWithoutDarkStrokeSupport');
  const severity = distanceMm > 8 && (stitchedTravelCandidate || blackContourWithoutSupport || fillSegmentOutsidePolygon) ? 'CRITICAL' : distanceMm > 8 ? 'HIGH' : distanceMm > 4 ? 'MEDIUM' : 'LOW';
  return {
    index,
    previousIndex,
    fromX: prev.x,
    fromY: prev.y,
    toX: cmd.x,
    toY: cmd.y,
    distanceMm,
    color: cmd.color,
    prevRegionId,
    regionId,
    stitchType: cmd.stitchType || 'unknown',
    layerType: cmd.layerType || 'unknown',
    source: cmd.source || 'unknown',
    regionChanged,
    layerChanged,
    sourceChanged,
    crossesEmptySpace,
    crossesAnotherRegion,
    stitchedTravelCandidate,
    fillSegmentOutsidePolygon,
    fillSegmentCrossesHoleOrEmpty,
    blackContourWithoutSupport,
    isSuspicious: reason.length > 0 && (regionChanged || layerChanged || sourceChanged || crossesEmptySpace || crossesAnotherRegion || fillSegmentOutsidePolygon || fillSegmentCrossesHoleOrEmpty || blackContourWithoutSupport || stitchedTravelCandidate),
    reason,
    severity,
  };
}

export function measureTransitionGuardMetrics(commands = [], regions = [], config = {}, darkStroke = null, regionIndex = null) {
  const indexRef = regionIndex || buildRegionIndex(regions, config);
  let prevCoord = null;
  const offenders = [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!hasPoint(cmd)) continue;
    if (cmd.type === 'stitch' && prevCoord) {
      const inspected = inspectTransition({ index: i, previousIndex: prevCoord.index, prev: prevCoord.cmd, cmd, regions, config, darkStroke, regionIndex: indexRef });
      if (inspected.distanceMm > 4 || inspected.isSuspicious) offenders.push(inspected);
    }
    prevCoord = { index: i, cmd };
  }
  const maxVisibleStitchMm = offenders.reduce((m, o) => Math.max(m, o.distanceMm), 0);
  return {
    totalCommands: commands.length,
    totalStitches: commands.filter(c => c.type === 'stitch').length,
    totalJumps: commands.filter(c => c.type === 'jump').length,
    totalTrims: commands.filter(c => c.type === 'trim').length,
    visibleLongStitchCount: offenders.filter(o => o.distanceMm > 4).length,
    severeVisibleLongStitchCount: offenders.filter(o => o.distanceMm > 8).length,
    stitchedTravelCount: offenders.filter(o => o.stitchedTravelCandidate).length,
    fillOutsideRegionCount: offenders.filter(o => o.fillSegmentOutsidePolygon || o.fillSegmentCrossesHoleOrEmpty).length,
    crossRegionStitchCount: offenders.filter(o => o.regionChanged || o.crossesAnotherRegion).length,
    maxVisibleStitchMm,
    finalLookExportMismatch: false,
    offenders,
  };
}

function buildGuardReport(data) {
  return {
    ...data,
    guardId: GUARD_ID,
    generatedAt: new Date().toISOString(),
    severeDropPct: pctDrop(data.beforeMetrics.severeVisibleLongStitchCount, data.afterMetrics.severeVisibleLongStitchCount),
    stitchedTravelDropPct: pctDrop(data.beforeMetrics.stitchedTravelCount, data.afterMetrics.stitchedTravelCount),
  };
}

export function reportToMarkdown(report) {
  const lines = [];
  lines.push('# STITCHED_TRANSITION_TO_JUMP_GUARD_REPORT_V1');
  lines.push('');
  lines.push(`generatedAt=${report.generatedAt}`);
  lines.push(`phaseAccepted=${report.phaseAccepted}`);
  lines.push(`revertReason=${report.revertReason || ''}`);
  lines.push(`convertedTransitions=${report.convertedTransitions}`);
  lines.push(`attemptedConvertedTransitions=${report.attemptedConvertedTransitions}`);
  lines.push(`skippedSafeStitches=${report.skippedSafeStitches}`);
  lines.push(`skippedLowConfidence=${report.skippedLowConfidence}`);
  lines.push(`commandsReturnedSource=${report.commandsReturnedSource}`);
  lines.push('');
  appendBeforeAfter(lines, 'totalCommands', report.beforeMetrics.totalCommands, report.afterMetrics.totalCommands);
  appendBeforeAfter(lines, 'totalStitches', report.beforeMetrics.totalStitches, report.afterMetrics.totalStitches);
  appendBeforeAfter(lines, 'totalJumps', report.beforeMetrics.totalJumps, report.afterMetrics.totalJumps);
  appendBeforeAfter(lines, 'totalTrims', report.beforeMetrics.totalTrims, report.afterMetrics.totalTrims);
  appendBeforeAfter(lines, 'visibleLongStitchCount', report.beforeMetrics.visibleLongStitchCount, report.afterMetrics.visibleLongStitchCount);
  appendBeforeAfter(lines, 'severeVisibleLongStitchCount', report.beforeMetrics.severeVisibleLongStitchCount, report.afterMetrics.severeVisibleLongStitchCount);
  appendBeforeAfter(lines, 'stitchedTravelCount', report.beforeMetrics.stitchedTravelCount, report.afterMetrics.stitchedTravelCount);
  appendBeforeAfter(lines, 'fillOutsideRegionCount', report.beforeMetrics.fillOutsideRegionCount, report.afterMetrics.fillOutsideRegionCount);
  appendBeforeAfter(lines, 'crossRegionStitchCount', report.beforeMetrics.crossRegionStitchCount, report.afterMetrics.crossRegionStitchCount);
  appendBeforeAfter(lines, 'maxVisibleStitchMm', report.beforeMetrics.maxVisibleStitchMm, report.afterMetrics.maxVisibleStitchMm);
  appendBeforeAfter(lines, 'finalLookExportMismatch', report.beforeMetrics.finalLookExportMismatch, report.afterMetrics.finalLookExportMismatch);
  appendBeforeAfter(lines, 'CE01 status', report.beforeCe01.status, report.afterCe01.status);
  lines.push(`severeDropPct=${report.severeDropPct}`);
  lines.push(`stitchedTravelDropPct=${report.stitchedTravelDropPct}`);
  lines.push('');
  lines.push('## Converted transitions');
  lines.push('| index | previousIndex | distanceMm | color | prevRegionId | regionId | stitchType | layerType | source | severity | reason |');
  lines.push('|---:|---:|---:|---|---|---|---|---|---|---|---|');
  for (const c of report.converted.slice(0, 260)) {
    lines.push(`| ${c.index} | ${c.previousIndex} | ${fmt(c.distanceMm)} | ${c.color || ''} | ${c.prevRegionId || ''} | ${c.regionId || ''} | ${c.stitchType} | ${c.layerType} | ${c.source} | ${c.severity} | ${c.reason.join('; ')} |`);
  }
  return lines.join('\n');
}

function appendBeforeAfter(lines, label, before, after) { lines.push(`${label} before=${formatValue(before)} after=${formatValue(after)}`); }
function formatValue(v) { return typeof v === 'number' ? fmt(v) : String(v); }
function fmt(n) { return Number.isFinite(n) ? Number(n).toFixed(3) : String(n); }
function pctDrop(before, after) { return before > 0 ? +(((before - after) / before) * 100).toFixed(1) : 100; }
function safeCE01(commands, objects, regions, config, machineSettings) { try { return validateCE01(commands, objects, regions, config, machineSettings) || { status: 'UNKNOWN' }; } catch { return { status: 'UNKNOWN' }; } }
function hasPoint(c) { return c && Number.isFinite(c.x) && Number.isFinite(c.y); }
function hasNaNCoordinates(commands) { return commands.some(c => ('x' in (c || {}) && !Number.isFinite(c.x)) || ('y' in (c || {}) && !Number.isFinite(c.y))); }
function dedupeConsecutiveTrims(commands) { const out = []; for (const c of commands) { if (c?.type === 'trim' && out[out.length - 1]?.type === 'trim') continue; out.push(c); } return out; }
function countEmptyBlocks(commands) { let empty = 0, inBlock = false, stitches = 0; for (const c of commands) { if (c.type === 'stitch') { inBlock = true; stitches++; } if (c.type === 'trim' || c.type === 'colorChange' || c.type === 'end') { if (inBlock && stitches === 0) empty++; inBlock = true; stitches = 0; } } return empty; }
function sampleSegment(x1, y1, x2, y2, steps) { return Array.from({ length: steps + 1 }, (_, i) => ({ x: x1 + (x2 - x1) * (i / steps), y: y1 + (y2 - y1) * (i / steps) })); }
function normalizeLayer(v = '') { const s = String(v).toLowerCase(); if (/contour|outline|running/.test(s)) return 'contour'; if (/detail|eye|mouth/.test(s)) return 'detail'; if (/fill|tatami|satin/.test(s)) return 'fill'; return s || 'unknown'; }
function normalizeSource(v = '') { const s = String(v).toLowerCase(); if (s.includes('ce01_safe_fill')) return 'ce01_safe_fill'; if (s.includes('contour')) return 'contour'; if (s.includes('standard')) return 'standard'; return s || 'unknown'; }
function hexToRgb(hex = '') { const h = String(hex).replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 }; }
function isBlackColor(hex) { const { r, g, b } = hexToRgb(hex); const l = 0.299 * r + 0.587 * g + 0.114 * b; const s = Math.max(r, g, b) - Math.min(r, g, b); return l < 70 && s < 90; }
function toPolygonMm(points, config) { const w = config.width_mm || 100, h = config.height_mm || 100; const normalized = (points || []).every(([x, y]) => Math.abs(x) <= 1.5 && Math.abs(y) <= 1.5); return (points || []).map(([x, y]) => normalized ? [(x - 0.5) * w, (y - 0.5) * h] : [x, y]); }
function pointInRegion(x, y, region, config) { const poly = toPolygonMm(region.path_points || [], config); return poly.length >= 3 && pointInPolygon(x, y, poly); }
function pointInPolygon(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside; } return inside; }
function findContainingRegionId(x, y, regionsOrIndex, config) {
  const items = regionsOrIndex?.items || buildRegionIndex(regionsOrIndex || [], config).items;
  for (const r of items) {
    if (x < r.bounds.minX || x > r.bounds.maxX || y < r.bounds.minY || y > r.bounds.maxY) continue;
    if (pointInIndexedRegion(x, y, r)) return r.id;
  }
  return null;
}
function findIndexedRegion(regionIndex, id) { return regionIndex?.items?.find(r => r.id === id) || null; }
function pointInIndexedRegion(x, y, indexedRegion) { return !!indexedRegion && pointInPolygon(x, y, indexedRegion.poly); }
function buildRegionIndex(regions = [], config = {}) {
  const items = [];
  for (const r of regions || []) {
    const poly = toPolygonMm(r.path_points || [], config);
    if (poly.length < 3) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    items.push({ id: r.id, poly, bounds: { minX, minY, maxX, maxY } });
  }
  return { items };
}
function darkSegmentSupport(x1, y1, x2, y2, darkStroke, config) { if (!darkStroke?.mask || !darkStroke.width || !darkStroke.height) return { ratio: 0 }; const W = darkStroke.width, H = darkStroke.height, w = config.width_mm || 100, h = config.height_mm || 100, tol = darkStroke.options?.strokeTolerancePx ?? 2; let hits = 0, total = 0; for (const p of sampleSegment(x1, y1, x2, y2, 12)) { const px = Math.round((p.x / w + 0.5) * W); const py = Math.round((p.y / h + 0.5) * H); let on = false; for (let dy = -tol; dy <= tol && !on; dy++) for (let dx = -tol; dx <= tol; dx++) { const tx = px + dx, ty = py + dy; if (tx >= 0 && tx < W && ty >= 0 && ty < H && darkStroke.mask[ty * W + tx]) { on = true; break; } } total++; if (on) hits++; } return { ratio: total ? hits / total : 0 }; }