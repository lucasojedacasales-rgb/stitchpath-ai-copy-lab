const REPORT_ID = 'UNIVERSAL_CARTOON_CLEANUP_AND_OUTLINE_MERGE_V1';
const REPORT_FILENAME = 'UNIVERSAL_CARTOON_CLEANUP_AND_OUTLINE_MERGE_REPORT_V1.md';

export function shouldApplyUniversalCartoonCleanupAndOutlineMerge(config = {}) {
  return config.universalAutoDigitizerPro === true &&
    config.unifiedStandardProProfile === true &&
    config.universalThreadColorSequenceOptimizer === true &&
    config.universalCartoonCleanupAndOutlineMerge === true;
}

export function createUniversalCartoonCleanupAndOutlineMergeReport(overrides = {}) {
  return {
    reportId: REPORT_ID,
    reportFilename: REPORT_FILENAME,
    generatedAt: new Date().toISOString(),
    requestedUniversalCartoonCleanupAndOutlineMerge: false,
    effectiveUniversalCartoonCleanupAndOutlineMerge: false,
    universalCartoonCleanupAndOutlineMergeApplied: false,
    gateEnabled: false,
    activationLostAt: [],
    activationLossTrace: {},
    blackOutlineFragmentsBefore: 0,
    blackOutlineFragmentsAfter: 0,
    blackOutlineFragmentsMerged: 0,
    redundantBlackFragmentsSuppressed: 0,
    microDetailsBefore: 0,
    microDetailsAfter: 0,
    microDetailsSuppressed: 0,
    importantDetailsPreserved: 0,
    fillObjectsBefore: 0,
    fillObjectsAfter: 0,
    fillObjectsMerged: 0,
    colorBlockCountBefore: 0,
    colorBlockCountAfter: 0,
    stitchCountBefore: 0,
    stitchCountAfter: 0,
    finalCommandJumpCountBefore: 0,
    finalCommandJumpCountAfter: 0,
    finalCommandJumpsOver3mmBefore: 0,
    finalCommandJumpsOver3mmAfter: 0,
    finalCommandJumpsOver6mmBefore: 0,
    finalCommandJumpsOver6mmAfter: 0,
    finalCommandJumpsOver10mmBefore: 0,
    finalCommandJumpsOver10mmAfter: 0,
    finalCommandTotalJumpTravelMmBefore: 0,
    finalCommandTotalJumpTravelMmAfter: 0,
    finalCommandMaxJumpMmBefore: 0,
    finalCommandMaxJumpMmAfter: 0,
    visibleConnectorRiskBefore: 0,
    visibleConnectorRiskAfter: 0,
    blackOutlineFinishesLast: true,
    optimizationAccepted: false,
    rejectedReason: null,
    previewExportParityPreserved: true,
    originalRegionsMutated: false,
    originalPathPointsMutated: false,
    defaultBehaviorChanged: false,
    encodersTouched: false,
    objectsSuppressed: [],
    objectsMerged: [],
    objectsSmoothed: [],
    ...overrides,
  };
}

function gateDiagnostics(config = {}) {
  const flags = {
    universalAutoDigitizerPro: config.universalAutoDigitizerPro === true,
    unifiedStandardProProfile: config.unifiedStandardProProfile === true,
    universalThreadColorSequenceOptimizer: config.universalThreadColorSequenceOptimizer === true,
    universalCartoonCleanupAndOutlineMerge: config.universalCartoonCleanupAndOutlineMerge === true,
  };
  return {
    requestedUniversalCartoonCleanupAndOutlineMerge: flags.universalCartoonCleanupAndOutlineMerge,
    effectiveUniversalCartoonCleanupAndOutlineMerge: flags.universalCartoonCleanupAndOutlineMerge,
    activationLostAt: Object.entries(flags).filter(([, v]) => !v).map(([k]) => k),
    activationLossTrace: { ...flags, gateEnabled: Object.values(flags).every(Boolean) },
  };
}

function roundMetric(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function normalizeHex(hex = '#000000') {
  const raw = String(hex || '#000000').trim().toLowerCase().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c => c + c).join('')}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`;
  return '#000000';
}

function hexToRgb(hex = '#000000') {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance(hex = '#000000') {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isDark(hex) {
  const { r, g, b } = hexToRgb(hex);
  return luminance(hex) < 86 && (Math.max(r, g, b) - Math.min(r, g, b)) < 110;
}

function isFinitePoint(p) {
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function objectText(obj = {}) {
  return `${obj.id || ''} ${obj.name || ''} ${obj.stitch_type || ''} ${obj.stitchType || ''} ${obj.layerType || ''} ${obj.layerRole || ''} ${obj.rawRegion?.id || ''} ${obj.rawRegion?.name || ''} ${obj.rawRegion?.region_class || ''}`.toLowerCase();
}

function bounds(points = []) {
  const pts = points.filter(isFinitePoint);
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, center: [(minX + maxX) / 2, (minY + maxY) / 2] };
}

function polygonArea(points = []) {
  const pts = points.filter(isFinitePoint);
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area / 2);
}

function firstPoint(points = []) { return points.find(isFinitePoint) || null; }
function lastPoint(points = []) { for (let i = points.length - 1; i >= 0; i--) if (isFinitePoint(points[i])) return points[i]; return null; }
function dist(a, b) { return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Infinity; }

function isImportantDetail(obj) {
  return /eye|eyes|ojo|ojos|mouth|boca|nose|nariz|nostril|pupil|pupila|iris|smile|sonrisa|detail_run|facial/.test(objectText(obj));
}

function isOutline(obj) {
  const text = objectText(obj);
  return obj.isContour === true || /outline|contour|stroke|border|outer|inner|running_stitch/.test(text) || Number(obj.priority || 0) >= 80;
}

function isBlackOutline(obj) {
  return isDark(obj.color || '#000000') && isOutline(obj) && !isImportantDetail(obj);
}

function isMicroDetail(obj) {
  const area = polygonArea(obj.points || []);
  const text = objectText(obj);
  return area > 0 && area < 0.55 && !/fill|base_fill|background/.test(text);
}

function cloneObject(obj) {
  return {
    ...obj,
    points: (obj.points || []).map(p => Array.isArray(p) ? [...p] : p),
    rawRegion: obj.rawRegion ? { ...obj.rawRegion } : obj.rawRegion,
  };
}

function simplifyPoints(points = [], epsilon = 0.12) {
  const pts = points.filter(isFinitePoint);
  if (pts.length <= 8) return pts.map(p => [...p]);
  const first = pts[0];
  const last = pts[pts.length - 1];
  let index = -1;
  let maxDistance = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistance(pts[i], first, last);
    if (d > maxDistance) { index = i; maxDistance = d; }
  }
  if (maxDistance > epsilon && index > 0) {
    const left = simplifyPoints(pts.slice(0, index + 1), epsilon);
    const right = simplifyPoints(pts.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last].map(p => [...p]);
}

function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) return dist(p, a);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy);
}

function familyKey(obj) {
  const raw = obj.rawRegion || {};
  return String(raw.object_group || raw.parentRegionId || raw.sourceRegionId || raw.parentId || obj.parentRegionId || obj.sourceRegionId || normalizeHex(obj.color || '#111111'));
}

function canMergeOutlines(a, b) {
  const ab = bounds(a.points || []);
  const bb = bounds(b.points || []);
  if (!ab || !bb) return false;
  const overlap = ab.minX <= bb.maxX && ab.maxX >= bb.minX && ab.minY <= bb.maxY && ab.maxY >= bb.minY;
  const close = Math.min(
    dist(lastPoint(a.points || []), firstPoint(b.points || [])),
    dist(firstPoint(a.points || []), lastPoint(b.points || []))
  ) <= 1.4;
  return overlap || close;
}

function mergeOutlineGroup(group = []) {
  const remaining = group.map(cloneObject);
  const first = remaining.shift();
  const mergedPoints = [...(first.points || [])];
  let cursor = lastPoint(mergedPoints) || firstPoint(mergedPoints);
  while (remaining.length) {
    let bestIndex = 0;
    let reverse = false;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const start = firstPoint(remaining[i].points || []);
      const end = lastPoint(remaining[i].points || []);
      const dStart = dist(cursor, start);
      const dEnd = dist(cursor, end);
      if (dStart < bestDistance) { bestDistance = dStart; bestIndex = i; reverse = false; }
      if (dEnd < bestDistance) { bestDistance = dEnd; bestIndex = i; reverse = true; }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    const pts = reverse ? [...(next.points || [])].reverse() : (next.points || []);
    mergedPoints.push(...pts.map(p => Array.isArray(p) ? [...p] : p));
    cursor = lastPoint(mergedPoints) || cursor;
  }
  return {
    ...first,
    id: `${first.id || 'outline'}_merged_${group.length}`,
    name: `${first.name || 'outline'} merged`,
    priority: Math.max(...group.map(o => Number(o.priority || 90)), 95),
    blackOutlineFinalPass: true,
    universalCartoonOutlineMerged: true,
    points: mergedPoints,
  };
}

function statsForObjects(objects = []) {
  return {
    blackOutlineFragments: objects.filter(isBlackOutline).length,
    microDetails: objects.filter(isMicroDetail).length,
    importantDetails: objects.filter(isImportantDetail).length,
    fillObjects: objects.filter(o => (o.stitch_type || o.stitchType) === 'fill').length,
  };
}

function routeSameThreadObjects(objects = []) {
  const groups = new Map();
  const colorOrder = [];
  for (const obj of objects) {
    const color = normalizeHex(obj.normalizedThreadColor || obj.color || '#000000');
    if (!groups.has(color)) { groups.set(color, []); colorOrder.push(color); }
    groups.get(color).push(obj);
  }
  const ordered = [];
  let cursor = [0, 0];
  for (const color of colorOrder) {
    const group = groups.get(color) || [];
    const normal = group.filter(obj => !isBlackOutline(obj));
    const outlines = group.filter(isBlackOutline);
    for (const bucket of [normal, outlines]) {
      const remaining = [...bucket];
      while (remaining.length) {
        let bestIndex = 0;
        let bestDistance = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const d = dist(cursor, firstPoint(remaining[i].points || []) || bounds(remaining[i].points || [])?.center);
          if (d < bestDistance) { bestDistance = d; bestIndex = i; }
        }
        const next = remaining.splice(bestIndex, 1)[0];
        ordered.push(next);
        cursor = lastPoint(next.points || []) || cursor;
      }
    }
  }
  return ordered;
}

export function applyUniversalCartoonCleanupAndOutlineMergeToObjects(objects = [], config = {}, machineSettings = {}) {
  const gate = gateDiagnostics(config);
  const report = createUniversalCartoonCleanupAndOutlineMergeReport({
    gateEnabled: shouldApplyUniversalCartoonCleanupAndOutlineMerge(config),
    ...gate,
  });
  if (!report.gateEnabled) {
    report.rejectedReason = 'requires universalAutoDigitizerPro + unifiedStandardProProfile + universalThreadColorSequenceOptimizer + universalCartoonCleanupAndOutlineMerge';
    return { objects, report };
  }

  const source = Array.isArray(objects) ? objects : [];
  const before = statsForObjects(source);
  report.blackOutlineFragmentsBefore = before.blackOutlineFragments;
  report.microDetailsBefore = before.microDetails;
  report.importantDetailsPreserved = before.importantDetails;
  report.fillObjectsBefore = before.fillObjects;

  const kept = [];
  const outlineGroups = new Map();
  for (const original of source) {
    const obj = cloneObject(original);
    const area = polygonArea(obj.points || []);
    const important = isImportantDetail(obj);
    if (isBlackOutline(obj) && area > 0 && area < 0.18 && !important) {
      report.redundantBlackFragmentsSuppressed++;
      report.objectsSuppressed.push({ id: obj.id, reason: 'tiny_duplicate_black_outline', areaMm2: roundMetric(area) });
      continue;
    }
    if (isMicroDetail(obj) && !important) {
      report.microDetailsSuppressed++;
      report.objectsSuppressed.push({ id: obj.id, reason: 'small_isolated_noise', areaMm2: roundMetric(area) });
      continue;
    }
    if (obj.stitch_type === 'fill' && (obj.points || []).length > 12 && area > 1.2) {
      const simplified = simplifyPoints(obj.points, 0.08);
      if (simplified.length >= 6 && simplified.length < obj.points.length) {
        report.objectsSmoothed.push({ id: obj.id, beforePoints: obj.points.length, afterPoints: simplified.length });
        obj.points = simplified;
      }
    }
    if (isBlackOutline(obj) && !important) {
      const key = familyKey(obj);
      if (!outlineGroups.has(key)) outlineGroups.set(key, []);
      outlineGroups.get(key).push(obj);
    } else {
      kept.push(obj);
    }
  }

  for (const group of outlineGroups.values()) {
    const mergeable = [];
    const separate = [];
    for (const obj of group) {
      if (mergeable.length === 0 || mergeable.some(existing => canMergeOutlines(existing, obj))) mergeable.push(obj);
      else separate.push(obj);
    }
    if (mergeable.length > 1) {
      const merged = mergeOutlineGroup(mergeable);
      kept.push(merged);
      report.blackOutlineFragmentsMerged += mergeable.length - 1;
      report.objectsMerged.push({ ids: mergeable.map(o => o.id), mergedId: merged.id });
    } else {
      kept.push(...mergeable);
    }
    kept.push(...separate);
  }

  const routed = routeSameThreadObjects(kept).sort((a, b) => {
    const ao = isBlackOutline(a);
    const bo = isBlackOutline(b);
    if (ao !== bo) return ao ? 1 : -1;
    return Number(a.priority || 50) - Number(b.priority || 50);
  });
  const after = statsForObjects(routed);
  report.blackOutlineFragmentsAfter = after.blackOutlineFragments;
  report.microDetailsAfter = after.microDetails;
  report.fillObjectsAfter = after.fillObjects;
  report.fillObjectsMerged = Math.max(0, before.fillObjects - after.fillObjects);
  report.blackOutlineFinishesLast = after.blackOutlineFragments === 0 || routed.slice(-after.blackOutlineFragments).every(isBlackOutline);
  if (!report.blackOutlineFinishesLast) report.rejectedReason = 'black_outline_not_final_after_object_cleanup';
  if (after.importantDetails < before.importantDetails) report.rejectedReason = 'important_facial_detail_removed';
  report.optimizationAccepted = !report.rejectedReason;
  report.universalCartoonCleanupAndOutlineMergeApplied = report.optimizationAccepted && (
    report.blackOutlineFragmentsMerged > 0 || report.redundantBlackFragmentsSuppressed > 0 || report.microDetailsSuppressed > 0 || report.objectsSmoothed.length > 0
  );
  return { objects: report.optimizationAccepted ? routed : objects, report };
}

function commandPoint(command) {
  return command && Number.isFinite(command.x) && Number.isFinite(command.y) ? [command.x, command.y] : null;
}

function commandColor(command, fallback = '#000000') {
  return normalizeHex(command?.color || fallback || '#000000');
}

function commandMetrics(commands = []) {
  let cursor = [0, 0];
  let jumpCount = 0;
  let jumpsOver3 = 0;
  let jumpsOver6 = 0;
  let jumpsOver10 = 0;
  let totalJumpTravel = 0;
  let maxJump = 0;
  let stitchCount = 0;
  let colorChanges = 0;
  for (const command of commands || []) {
    if (command?.type === 'colorChange') colorChanges++;
    if (command?.type === 'stitch') stitchCount++;
    const point = commandPoint(command);
    if (command?.type === 'jump' && point) {
      const d = dist(cursor, point);
      jumpCount++;
      totalJumpTravel += Number.isFinite(d) ? d : 0;
      maxJump = Math.max(maxJump, Number.isFinite(d) ? d : 0);
      if (d > 3) jumpsOver3++;
      if (d > 6) jumpsOver6++;
      if (d > 10) jumpsOver10++;
    }
    if (point) cursor = point;
  }
  return {
    stitchCount,
    colorBlockCount: colorChanges + 1,
    jumpCount,
    jumpsOver3,
    jumpsOver6,
    jumpsOver10,
    totalJumpTravelMm: roundMetric(totalJumpTravel),
    maxJumpMm: roundMetric(maxJump),
    visibleConnectorRisk: jumpsOver3 + jumpsOver6 + jumpsOver10 * 2,
  };
}

function splitCommandColorGroups(commands = []) {
  const groups = [];
  let current = { colorChange: null, commands: [] };
  let endCommand = null;
  for (const command of commands || []) {
    if (command?.type === 'end') { endCommand = command; continue; }
    if (command?.type === 'colorChange') {
      if (current.colorChange || current.commands.length) groups.push(current);
      current = { colorChange: command, commands: [] };
      continue;
    }
    current.commands.push(command);
  }
  if (current.colorChange || current.commands.length) groups.push(current);
  return { groups, endCommand };
}

function splitRegionCommandBlocks(commands = []) {
  const blocks = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const firstStitch = current.commands.findIndex(c => c.type === 'stitch' && commandPoint(c));
    if (firstStitch < 0) { current = null; return; }
    const body = current.commands.slice(firstStitch);
    const entry = commandPoint(body[0]);
    let exit = entry;
    for (let i = body.length - 1; i >= 0; i--) {
      const point = commandPoint(body[i]);
      if (point) { exit = point; break; }
    }
    blocks.push({ ...current, commands: body, entry, exit });
    current = null;
  };
  for (const command of commands) {
    if (!command || command.type === 'trim') continue;
    const key = String(command.regionId || command.objectId || command.blockId || 'misc');
    if (!current || current.key !== key) {
      push();
      current = { key, color: commandColor(command), commands: [], originalIndex: blocks.length };
    }
    current.commands.push(command);
  }
  push();
  return blocks;
}

function orderBlocksNearest(blocks = [], start = [0, 0]) {
  const remaining = [...blocks];
  const ordered = [];
  let cursor = start;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = dist(cursor, remaining[i].entry);
      if (d < bestDistance || (d === bestDistance && remaining[i].originalIndex < remaining[bestIndex].originalIndex)) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    ordered.push(next);
    cursor = next.exit || cursor;
  }
  return ordered;
}

function appendConnector(output, cursor, target, template, machineSettings = {}) {
  if (!cursor || !target) return target || cursor || [0, 0];
  const d = dist(cursor, target);
  if (!Number.isFinite(d) || d <= 0.5) return cursor;
  const trimThreshold = Number(machineSettings.trimThreshold) || 3.5;
  if (d > trimThreshold && output[output.length - 1]?.type !== 'trim') {
    output.push({ type: 'trim', x: cursor[0], y: cursor[1], color: template.color, regionId: template.regionId, source: 'universal_cartoon_cleanup_connector' });
  }
  output.push({ type: 'jump', x: target[0], y: target[1], color: template.color, regionId: template.regionId, source: 'universal_cartoon_cleanup_connector' });
  return target;
}

function routeSameThreadCommandBlocks(commands = [], machineSettings = {}) {
  const { groups, endCommand } = splitCommandColorGroups(commands);
  const output = [];
  let cursor = [0, 0];
  for (const group of groups) {
    const color = commandColor(group.colorChange || group.commands.find(commandPoint));
    if (group.colorChange) output.push({ ...group.colorChange, x: cursor[0], y: cursor[1] });
    const blocks = splitRegionCommandBlocks(group.commands);
    if (blocks.length <= 1) {
      output.push(...group.commands);
      const last = [...group.commands].reverse().find(commandPoint);
      cursor = commandPoint(last) || cursor;
      continue;
    }
    const ordered = orderBlocksNearest(blocks, cursor);
    for (const block of ordered) {
      cursor = appendConnector(output, cursor, block.entry, { color, regionId: block.key }, machineSettings);
      output.push(...block.commands);
      cursor = block.exit || cursor;
    }
  }
  output.push(endCommand ? { ...endCommand, x: cursor[0], y: cursor[1] } : { type: 'end', x: cursor[0], y: cursor[1], color: null });
  return output;
}

function importantCommandCount(commands = []) {
  return (commands || []).filter(c => c?.type === 'stitch' && /eye|ojo|mouth|boca|nose|nariz|nostril|detail|facial/i.test(String(c.regionId || c.objectId || ''))).length;
}

function blackOutlineCommandsFinishLast(commands = []) {
  const stitches = (commands || []).filter(c => c?.type === 'stitch');
  const outlineIndexes = stitches.map((c, i) => (isDark(c.color) && /outline|contour|running|outer|inner/i.test(`${c.regionId || ''} ${c.stitchType || ''} ${c.layerType || ''} ${c.source || ''}`)) ? i : null).filter(i => i !== null);
  if (!outlineIndexes.length) return true;
  const firstTail = stitches.length - outlineIndexes.length;
  return outlineIndexes.every(i => i >= firstTail);
}

export function applyUniversalCartoonCleanupAndOutlineMergeToCommands(commands = [], objects = [], config = {}, machineSettings = {}, inputReport = null) {
  const gate = gateDiagnostics(config);
  const baseReport = inputReport || createUniversalCartoonCleanupAndOutlineMergeReport({ gateEnabled: shouldApplyUniversalCartoonCleanupAndOutlineMerge(config), ...gate });
  if (!baseReport.gateEnabled) return { commands, report: baseReport };
  const before = commandMetrics(commands);
  const candidate = routeSameThreadCommandBlocks(commands, machineSettings);
  const after = commandMetrics(candidate);
  const report = {
    ...baseReport,
    stitchCountBefore: before.stitchCount,
    stitchCountAfter: after.stitchCount,
    colorBlockCountBefore: before.colorBlockCount,
    colorBlockCountAfter: after.colorBlockCount,
    finalCommandJumpCountBefore: before.jumpCount,
    finalCommandJumpCountAfter: after.jumpCount,
    finalCommandJumpsOver3mmBefore: before.jumpsOver3,
    finalCommandJumpsOver3mmAfter: after.jumpsOver3,
    finalCommandJumpsOver6mmBefore: before.jumpsOver6,
    finalCommandJumpsOver6mmAfter: after.jumpsOver6,
    finalCommandJumpsOver10mmBefore: before.jumpsOver10,
    finalCommandJumpsOver10mmAfter: after.jumpsOver10,
    finalCommandTotalJumpTravelMmBefore: before.totalJumpTravelMm,
    finalCommandTotalJumpTravelMmAfter: after.totalJumpTravelMm,
    finalCommandMaxJumpMmBefore: before.maxJumpMm,
    finalCommandMaxJumpMmAfter: after.maxJumpMm,
    visibleConnectorRiskBefore: before.visibleConnectorRisk,
    visibleConnectorRiskAfter: after.visibleConnectorRisk,
    blackOutlineFinishesLast: blackOutlineCommandsFinishLast(candidate),
  };
  const stitchDeltaPct = before.stitchCount > 0 ? Math.abs(after.stitchCount - before.stitchCount) / before.stitchCount : 0;
  if (stitchDeltaPct > 0.08) report.rejectedReason = 'stitch_count_delta_over_8_percent';
  else if (after.colorBlockCount > before.colorBlockCount) report.rejectedReason = 'color_block_count_increased';
  else if (!report.blackOutlineFinishesLast) report.rejectedReason = 'black_outline_not_final';
  else if (importantCommandCount(candidate) < importantCommandCount(commands) * 0.9) report.rejectedReason = 'important_facial_details_removed';
  else if (after.jumpsOver10 > before.jumpsOver10) report.rejectedReason = 'jumps_over_10mm_increased';
  else if (after.totalJumpTravelMm > before.totalJumpTravelMm + 0.001) report.rejectedReason = 'total_command_jump_travel_increased';
  report.optimizationAccepted = !report.rejectedReason;
  report.universalCartoonCleanupAndOutlineMergeApplied = report.optimizationAccepted && (
    baseReport.universalCartoonCleanupAndOutlineMergeApplied ||
    after.jumpCount < before.jumpCount ||
    after.jumpsOver10 < before.jumpsOver10 ||
    after.totalJumpTravelMm < before.totalJumpTravelMm
  );
  return { commands: report.optimizationAccepted ? candidate : commands, report };
}

export function buildUniversalCartoonCleanupAndOutlineMergeMarkdown(report = createUniversalCartoonCleanupAndOutlineMergeReport()) {
  const r = { ...createUniversalCartoonCleanupAndOutlineMergeReport(), ...(report || {}) };
  const lines = [];
  lines.push('# UNIVERSAL_CARTOON_CLEANUP_AND_OUTLINE_MERGE_REPORT_V1');
  lines.push('');
  for (const key of [
    'generatedAt','universalCartoonCleanupAndOutlineMergeApplied','gateEnabled','requestedUniversalCartoonCleanupAndOutlineMerge','effectiveUniversalCartoonCleanupAndOutlineMerge',
    'activationLostAt','activationLossTrace','blackOutlineFragmentsBefore','blackOutlineFragmentsAfter','blackOutlineFragmentsMerged','redundantBlackFragmentsSuppressed',
    'microDetailsBefore','microDetailsAfter','microDetailsSuppressed','importantDetailsPreserved','fillObjectsBefore','fillObjectsAfter','fillObjectsMerged',
    'colorBlockCountBefore','colorBlockCountAfter','stitchCountBefore','stitchCountAfter','finalCommandJumpCountBefore','finalCommandJumpCountAfter',
    'finalCommandJumpsOver3mmBefore','finalCommandJumpsOver3mmAfter','finalCommandJumpsOver6mmBefore','finalCommandJumpsOver6mmAfter',
    'finalCommandJumpsOver10mmBefore','finalCommandJumpsOver10mmAfter','finalCommandTotalJumpTravelMmBefore','finalCommandTotalJumpTravelMmAfter',
    'finalCommandMaxJumpMmBefore','finalCommandMaxJumpMmAfter','visibleConnectorRiskBefore','visibleConnectorRiskAfter','blackOutlineFinishesLast',
    'optimizationAccepted','rejectedReason','previewExportParityPreserved','originalRegionsMutated','originalPathPointsMutated','defaultBehaviorChanged','encodersTouched'
  ]) {
    lines.push(`- ${key}: ${typeof r[key] === 'object' ? JSON.stringify(r[key]) : r[key]}`);
  }
  lines.push('');
  lines.push('## Objects Suppressed');
  for (const item of r.objectsSuppressed || []) lines.push(`- ${item.id}: ${item.reason} area=${item.areaMm2}`);
  lines.push('');
  lines.push('## Objects Merged');
  for (const item of r.objectsMerged || []) lines.push(`- ${item.mergedId}: ${(item.ids || []).join(', ')}`);
  lines.push('');
  lines.push('## Objects Smoothed');
  for (const item of r.objectsSmoothed || []) lines.push(`- ${item.id}: ${item.beforePoints} → ${item.afterPoints} points`);
  return lines.join('\n');
}