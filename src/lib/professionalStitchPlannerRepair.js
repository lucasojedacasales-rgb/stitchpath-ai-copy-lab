const REPAIR_ID = 'PROFESSIONAL_STITCH_PLANNER_REPAIR_V1';
const IDEAL_VISIBLE_MAX_MM = 6.5;
const ABSOLUTE_VISIBLE_MAX_MM = 8.0;
const MACRO_CRITICAL_MM = 12.1;
const MAX_FILL_STITCH_MM = 4.0;
const MAX_CONTOUR_STITCH_MM = 3.0;
const MIN_STITCH_MM = 0.35;

let lastReport = null;

export function applyProfessionalStitchPlannerRepair({ commands = [], regions = [], config = {}, machineSettings = {} }) {
  const regionIndex = buildRegionIndex(regions, config);
  const before = measureProfessionalStitchMetrics(commands, regions, config, regionIndex);
  const { commands: candidate, rebuiltRegions, contoursCleaned } = repairCommands(commands, regionIndex);
  const after = measureProfessionalStitchMetrics(candidate, regions, config, regionIndex);
  const validation = validateRepair({ before, after, beforeCommands: commands, afterCommands: candidate, regionIndex });

  const phaseAccepted = validation.accepted;
  lastReport = {
    repairId: REPAIR_ID,
    generatedAt: new Date().toISOString(),
    phaseAccepted,
    revertReason: validation.revertReason,
    rootCause: 'Visible stitch commands were being used to bridge fill scanlines, contour gaps, or travel between separated zones instead of using clipped short fill stitches or trim+jump travel.',
    before,
    after,
    regionsRebuiltWithSafeFill: phaseAccepted ? rebuiltRegions : [],
    contoursCleaned: phaseAccepted ? contoursCleaned : [],
    motorFilesChanged: ['src/lib/ce01SafeFillGenerator.js', 'src/lib/exportPipeline.js', 'src/lib/professionalStitchPlannerRepair.js'],
    encodersUnchanged: true,
    exportLogicUnchanged: true,
    referenceLearningUnchanged: true,
  };

  console.log(`[${REPAIR_ID}] accepted=${phaseAccepted} beforeMax=${fmt(before.maxVisibleStitchMm)} afterMax=${fmt(after.maxVisibleStitchMm)} macro ${before.macroCriticalLongStitches}→${after.macroCriticalLongStitches}`);
  if (!phaseAccepted) console.warn(`[${REPAIR_ID}] reverted: ${validation.revertReason}`);

  return {
    commands: phaseAccepted ? candidate : commands,
    report: lastReport,
  };
}

export function getLastProfessionalStitchPlannerRepairReport() {
  return lastReport;
}

export function measureProfessionalStitchMetrics(commands = [], regions = [], config = {}, regionIndex = null) {
  const index = regionIndex || buildRegionIndex(regions, config);
  let prev = null;
  let maxVisibleStitchMm = 0;
  let visibleLongStitchCount = 0;
  let severeVisibleLongStitchCount = 0;
  let macroCriticalLongStitches = 0;
  let fillOutsideRegionCount = 0;
  let crossRegionStitchCount = 0;
  let invalidCommandCount = 0;
  const offenders = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd || !cmd.type) { invalidCommandCount++; continue; }
    if (hasPoint(cmd) && !Number.isFinite(cmd.x + cmd.y)) invalidCommandCount++;
    if (cmd.type === 'stitch' && hasPoint(cmd) && prev) {
      const dist = Math.hypot(cmd.x - prev.x, cmd.y - prev.y);
      const regionId = cmd.regionId || findContainingRegionId(cmd.x, cmd.y, index);
      const prevRegionId = prev.regionId || findContainingRegionId(prev.x, prev.y, index);
      const region = findIndexedRegion(index, regionId);
      const isFill = isFillCommand(cmd);
      const inside = region ? segmentInside(cmd.x, cmd.y, prev.x, prev.y, region.poly) : false;
      const crossesOther = samplesCrossOtherRegion(prev.x, prev.y, cmd.x, cmd.y, index, regionId, prevRegionId);

      if (dist > maxVisibleStitchMm) maxVisibleStitchMm = dist;
      if (dist > IDEAL_VISIBLE_MAX_MM) visibleLongStitchCount++;
      if (dist > ABSOLUTE_VISIBLE_MAX_MM) severeVisibleLongStitchCount++;
      if (dist > MACRO_CRITICAL_MM) macroCriticalLongStitches++;
      if (isFill && region && !inside) fillOutsideRegionCount++;
      if ((regionId && prevRegionId && regionId !== prevRegionId) || crossesOther) crossRegionStitchCount++;
      if (dist > IDEAL_VISIBLE_MAX_MM || (isFill && !inside)) {
        offenders.push({ index: i, distanceMm: dist, regionId, prevRegionId, isFill, inside, crossesOther, source: cmd.source, stitchType: cmd.stitchType, layerType: cmd.layerType });
      }
    }
    if (hasPoint(cmd)) prev = cmd;
  }

  return {
    totalStitches: commands.filter(c => c.type === 'stitch').length,
    totalJumps: commands.filter(c => c.type === 'jump').length,
    totalTrims: commands.filter(c => c.type === 'trim').length,
    totalColors: Math.max(1, new Set(commands.filter(c => c.color && (c.type === 'stitch' || c.type === 'jump')).map(c => c.color)).size),
    maxVisibleStitchMm: round(maxVisibleStitchMm),
    visibleLongStitchCount,
    severeVisibleLongStitchCount,
    macroCriticalLongStitches,
    fillOutsideRegionCount,
    crossRegionStitchCount,
    invalidCommandCount,
    exportBlocked: macroCriticalLongStitches > 0 || invalidCommandCount > 0,
    blockingReason: macroCriticalLongStitches > 0 ? 'excessive_visible_stitch' : invalidCommandCount > 0 ? 'invalid_command' : 'none',
    visualQualityScore: Math.max(0, 100 - severeVisibleLongStitchCount * 8 - visibleLongStitchCount * 2 - fillOutsideRegionCount * 5),
    offenders,
  };
}

function repairCommands(commands, regionIndex) {
  const out = [];
  const rebuiltRegions = new Set();
  const contoursCleaned = new Set();
  let prev = null;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd || !cmd.type) continue;
    if (cmd.type !== 'stitch' || !hasPoint(cmd) || !prev || !hasPoint(prev)) {
      out.push(cmd);
      if (hasPoint(cmd)) prev = cmd;
      continue;
    }

    const dist = Math.hypot(cmd.x - prev.x, cmd.y - prev.y);
    if (dist <= IDEAL_VISIBLE_MAX_MM) {
      out.push(cmd);
      prev = cmd;
      continue;
    }

    const regionId = cmd.regionId || findContainingRegionId(cmd.x, cmd.y, regionIndex);
    const region = findIndexedRegion(regionIndex, regionId);
    const isFill = isFillCommand(cmd);
    const isContour = isContourCommand(cmd);
    const segmentSafe = region ? segmentInside(prev.x, prev.y, cmd.x, cmd.y, region.poly) : false;
    const crossesOther = samplesCrossOtherRegion(prev.x, prev.y, cmd.x, cmd.y, regionIndex, regionId, prev.regionId);

    if ((isFill || isContour) && region && segmentSafe && !crossesOther) {
      const maxLen = isContour ? MAX_CONTOUR_STITCH_MM : MAX_FILL_STITCH_MM;
      const pieces = splitVisibleStitch(prev, cmd, maxLen, region.poly);
      if (pieces.length > 0) {
        for (const p of pieces) out.push({ ...cmd, x: p.x, y: p.y, source: `${cmd.source || 'planner'}+${REPAIR_ID}`, generatedBy: REPAIR_ID });
        if (isFill) rebuiltRegions.add(regionId || cmd.regionId || 'fill');
        if (isContour) contoursCleaned.add(regionId || cmd.regionId || 'contour');
        prev = { ...cmd };
        continue;
      }
    }

    if (dist > ABSOLUTE_VISIBLE_MAX_MM) {
      const last = out[out.length - 1];
      if (last?.type !== 'trim') out.push({ type: 'trim', x: prev.x, y: prev.y, color: cmd.color, regionId: cmd.regionId, source: REPAIR_ID, generatedBy: REPAIR_ID });
      out.push({ ...cmd, type: 'jump', source: REPAIR_ID, generatedBy: REPAIR_ID, repairedFrom: 'visible_long_stitch' });
      if (isFill) rebuiltRegions.add(regionId || cmd.regionId || 'fill');
      if (isContour) contoursCleaned.add(regionId || cmd.regionId || 'contour');
      prev = { ...cmd, type: 'jump' };
      continue;
    }

    out.push(cmd);
    prev = cmd;
  }

  return { commands: dedupeTrims(out), rebuiltRegions: [...rebuiltRegions], contoursCleaned: [...contoursCleaned] };
}

function validateRepair({ before, after, beforeCommands, afterCommands, regionIndex }) {
  const checks = [
    [after.macroCriticalLongStitches === 0, 'macroCriticalLongStitches remain'],
    [after.maxVisibleStitchMm <= ABSOLUTE_VISIBLE_MAX_MM || before.maxVisibleStitchMm <= ABSOLUTE_VISIBLE_MAX_MM, 'maxVisibleStitchMm still above 8mm'],
    [after.severeVisibleLongStitchCount === 0 || after.severeVisibleLongStitchCount < before.severeVisibleLongStitchCount, 'severeVisibleLongStitchCount did not improve'],
    [after.visibleLongStitchCount <= before.visibleLongStitchCount, 'visibleLongStitchCount increased'],
    [after.fillOutsideRegionCount <= before.fillOutsideRegionCount, 'fillOutsideRegionCount increased'],
    [after.invalidCommandCount === 0, 'invalid commands detected'],
    [after.totalStitches > 0, 'no stitches remain'],
    [after.totalColors >= Math.max(1, before.totalColors), 'colors were lost'],
    [afterCommands.length <= beforeCommands.length + 5000, 'command growth too large'],
    [mainRegionsPreserved(afterCommands, regionIndex), 'main regions lost'],
  ];
  const failed = checks.find(([ok]) => !ok);
  return { accepted: !failed, revertReason: failed ? failed[1] : null };
}

function splitVisibleStitch(prev, cmd, maxLen, poly) {
  const dist = Math.hypot(cmd.x - prev.x, cmd.y - prev.y);
  const steps = Math.ceil(dist / maxLen);
  const pts = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = prev.x + (cmd.x - prev.x) * t;
    const y = prev.y + (cmd.y - prev.y) * t;
    if (!pointInPolygon(x, y, poly)) return [];
    pts.push({ x, y });
  }
  return pts;
}

function mainRegionsPreserved(commands, regionIndex) {
  const required = regionIndex.items.filter(r => r.area > 8).map(r => r.id).filter(Boolean);
  if (required.length === 0) return true;
  const present = new Set(commands.filter(c => c.type === 'stitch' && c.regionId).map(c => c.regionId));
  const kept = required.filter(id => present.has(id)).length;
  return kept >= Math.max(1, Math.floor(required.length * 0.85));
}

function buildRegionIndex(regions = [], config = {}) {
  const items = [];
  for (const r of regions || []) {
    const poly = toPolygonMm(r.path_points || [], config);
    if (poly.length < 3) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    items.push({ id: r.id, poly, bounds: { minX, minY, maxX, maxY }, area: polygonArea(poly), raw: r });
  }
  return { items };
}

function toPolygonMm(points, config) {
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;
  const normalized = (points || []).every(([x, y]) => Math.abs(x) <= 1.5 && Math.abs(y) <= 1.5);
  return (points || []).map(([x, y]) => normalized ? [(x - 0.5) * w, (y - 0.5) * h] : [x, y]);
}

function findIndexedRegion(index, id) { return index.items.find(r => r.id === id) || null; }
function findContainingRegionId(x, y, index) { const r = index.items.find(item => x >= item.bounds.minX && x <= item.bounds.maxX && y >= item.bounds.minY && y <= item.bounds.maxY && pointInPolygon(x, y, item.poly)); return r?.id || null; }
function samplesCrossOtherRegion(x1, y1, x2, y2, index, regionId, prevRegionId) { return sampleSegment(x1, y1, x2, y2, 8).some(p => { const rid = findContainingRegionId(p.x, p.y, index); return rid && rid !== regionId && rid !== prevRegionId; }); }
function segmentInside(x1, y1, x2, y2, poly) { return sampleSegment(x1, y1, x2, y2, 8).every(p => pointInPolygon(p.x, p.y, poly)); }
function sampleSegment(x1, y1, x2, y2, steps) { return Array.from({ length: steps + 1 }, (_, i) => ({ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps })); }
function pointInPolygon(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside; } return inside; }
function polygonArea(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] * poly[i][1]) - (poly[i][0] * poly[j][1]); return Math.abs(a / 2); }
function hasPoint(c) { return c && Number.isFinite(c.x) && Number.isFinite(c.y); }
function isFillCommand(c) { return /fill|tatami|ce01_safe_fill/i.test(`${c.stitchType || ''} ${c.layerType || ''} ${c.source || ''}`); }
function isContourCommand(c) { return /contour|outline|running|detail|satin/i.test(`${c.stitchType || ''} ${c.layerType || ''} ${c.source || ''}`); }
function dedupeTrims(commands) { const out = []; for (const c of commands) { if (c?.type === 'trim' && out[out.length - 1]?.type === 'trim') continue; out.push(c); } return out; }
function round(n) { return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0; }
function fmt(n) { return Number.isFinite(n) ? n.toFixed(3) : String(n); }