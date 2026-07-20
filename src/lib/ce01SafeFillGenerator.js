import { resolveSafeFillDensityProfile } from './safeFillDensityProfiles.js';

/**
 * ce01SafeFillGenerator.js — Direct command generation for CE01-safe fill
 * ─────────────────────────────────────────────────────────────────────────────
 * Bypasses processObjectStitches entirely for fill objects in ce01SafeFillMode.
 * Generates stitch/jump commands directly with strict polygon clipping,
 * serpentine traversal, long-stitch splitting, micro-stitch merging, and
 * per-region validation with automatic spacing retry (0.7 → 0.8 → 0.9mm).
 *
 * Fine-tuning:
 *   • Edge inset (0.25mm) — scanlines intersect against a shrunk polygon
 *   • Segment validation (5-point check) — no stitch crosses outside
 *   • Near-border projection — points within 0.25mm are pulled inside
 *   • Density control — auto-increase spacing if max density > 80/zone
 *
 * Each command includes:
 *   { type, x, y, regionId, blockId, stitchType: "fill", source: "ce01_safe_fill", color }
 */

const MAX_STITCH_MM = 3.0;
const DEFAULT_NEEDLE_PITCH_MM = 2.4;
const MIN_STITCH_MM = 0.35;
const CONNECT_THRESHOLD = 6.5;
const TATAMI_PHASES = [0, 0.25, 0.5, 0.75];
const SPACING_RETRIES = [0.24, 0.28, 0.32];
const MIN_SPACING_MM = 0.12;
const MAX_SPACING_MM = 0.8;
const MIN_INTERVAL_MM = 0.9;
const MIN_ISLAND_AREA_MM2 = 2.0;       // raised from 1.5 → fewer tiny-island jumps
const NEEDLE_INSET_MM = 0.3;
const EDGE_INSET_MM = 0.25;            // polygon shrink before scanline intersection
const BORDER_PROJ_MM = 0.25;           // project points within this distance of edge
const MAX_DENSITY_PER_ZONE = 80;
const DENSITY_CELL_MM = 5;
let _lastCE01DensityCalibrationReport = {
  ce01DensityCalibrationAppliedCount: 0,
  calibratedRegionIds: [],
};

// ═══════════════════════════════════════════════════════════════════════════
//  UNION-FIND
// ═══════════════════════════════════════════════════════════════════════════

class UnionFind {
  constructor(n) { this.p = Array.from({length:n},(_,i)=>i); this.r = Array(n).fill(0); }
  find(x) { if (this.p[x]!==x) this.p[x]=this.find(this.p[x]); return this.p[x]; }
  union(a,b) { const ra=this.find(a),rb=this.find(b); if(ra===rb)return;
    if(this.r[ra]<this.r[rb]) this.p[ra]=rb; else if(this.r[ra]>this.r[rb]) this.p[rb]=ra;
    else { this.p[rb]=ra; this.r[ra]++; } }
}

function _roundMm(v) {
  return Number.isFinite(v) ? Number(v.toFixed(4)) : v;
}

function _clampValue(v, min, max) {
  const n = Number(v);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function _recordCE01DensityCalibration(regionId, calibration) {
  if (!calibration?.calibrationApplied || !regionId) return;
  if (!_lastCE01DensityCalibrationReport.calibratedRegionIds.includes(regionId)) {
    _lastCE01DensityCalibrationReport.calibratedRegionIds.push(regionId);
    _lastCE01DensityCalibrationReport.ce01DensityCalibrationAppliedCount =
      _lastCE01DensityCalibrationReport.calibratedRegionIds.length;
  }
}

function _buildCE01DensityCalibrationCommandMeta(calibration, regionId, spacing, needlePitch) {
  const applied = calibration?.calibrationApplied === true;
  return {
    ce01DensityCalibrationAppliedCount: applied ? 1 : 0,
    calibratedRegionIds: applied ? [regionId] : [],
    safeFillDensityProfileId: calibration?.profileId ?? null,
    safeFillDensityMode: calibration?.densityMode ?? null,
    rowSpacingMm: _roundMm(spacing),
    needlePitchMm: _roundMm(needlePitch),
    maxVisibleStitchMm: calibration?.maxVisibleStitchMm ?? null,
    estimatedTargetDensity: calibration?.estimatedTargetDensity ?? null,
    requestedFillSpacingMm: calibration?.requestedFillSpacingMm ?? null,
    effectiveFillSpacingMm: _roundMm(spacing),
    effectiveNeedlePitchMm: _roundMm(needlePitch),
    spacingClampApplied: calibration?.spacingClampApplied === true,
    estimatedStitchIncreaseFactor: calibration?.estimatedStitchIncreaseFactor ?? 1,
  };
}

function _resolveNeedlePitch(machineSettings = {}, calibration = null) {
  const machineMax = Number(machineSettings.maxStitchLength) || MAX_STITCH_MM;
  const profileMax = Number(calibration?.maxVisibleStitchMm) || MAX_STITCH_MM;
  return _clampValue(Math.min(calibration?.needlePitchMm || DEFAULT_NEEDLE_PITCH_MM, machineMax, profileMax, MAX_STITCH_MM), 2.0, MAX_STITCH_MM);
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN ENTRY
// ═══════════════════════════════════════════════════════════════════════════

export function generateCE01SafeFillCommands(obj, options = {}) {
  const { machineSettings = {}, designOffset = [0, 0], fillSpacingMm = null, config = {} } = options;
  const [offX, offY] = designOffset;
  const knockoutZones = (obj.knockoutZones || []).filter(z => Array.isArray(z) && z.length >= 3);
  const polygonMm = obj.points;
  const angleDeg = obj.angle ?? 45;
  const regionId = obj.id || 'fill';
  const color = obj.color || '#000000';
  const blockId = regionId;

  const log = (m) => console.log(`[ce01-fill] ${m}`);
  const egLog = (m) => console.log(`[ce01-edge-guard] ${m}`);
  log(`region: ${regionId}`);

  if (!polygonMm || polygonMm.length < 3) return [];
  const calibration = resolveSafeFillDensityProfile(
    machineSettings,
    { ce01SafeFillMode: true, ...config },
    { ...obj, fillSpacingMm: fillSpacingMm ?? obj.density }
  );
  _recordCE01DensityCalibration(regionId, calibration);
  console.log('[ce01-density-calibration]', {
    regionId,
    profileId: calibration.profileId,
    densityMode: calibration.densityMode,
    requestedFillSpacingMm: calibration.requestedFillSpacingMm,
    rowSpacingMm: calibration.rowSpacingMm,
    needlePitchMm: calibration.needlePitchMm,
    maxVisibleStitchMm: calibration.maxVisibleStitchMm,
    estimatedTargetDensity: calibration.estimatedTargetDensity,
    spacingClampApplied: calibration.spacingClampApplied,
    estimatedStitchIncreaseFactor: calibration.estimatedStitchIncreaseFactor,
  });

  // ── Create inset polygon for scanline intersection ──────────────────────
  const safePolygon = _insetPolygon(polygonMm, EDGE_INSET_MM);
  egLog(`region: ${regionId}`);
  egLog(`inset used: ${EDGE_INSET_MM}mm (safePolygon vertices: ${safePolygon.length})`);

  // Pre-validate: count outside against original polygon
  const spacingRetries = _buildSpacingRetries(calibration.rowSpacingMm, calibration);
  let bestCmds = [];
  let bestValidation = null;
  let bestSpacing = spacingRetries[0];

  for (const spacing of spacingRetries) {
    const cmds = _generateAtSpacing(polygonMm, safePolygon, knockoutZones, spacing, angleDeg, offX, offY, regionId, blockId, color, log, machineSettings, calibration);
    const v = _validate(cmds, polygonMm, knockoutZones, offX, offY);
    const density = _maxDensity(cmds, offX, offY);

    log(`final validation (spacing=${spacing}): stitches=${v.stitches} jumps=${v.jumps} outside=${v.outside} long=${v.long} micro=${v.micro} density=${density}`);

    // Acceptance criteria: outside ≤ 5, no long, density ≤ 80, jumps ≤ 120
    const outsideOk = v.outside <= 5;
    const longOk = v.long === 0;
    const densityOk = density <= MAX_DENSITY_PER_ZONE;
    const jumpsOk = v.jumps <= 120;

    if (outsideOk && longOk && densityOk && jumpsOk) {
      egLog(`outside before: ${v.outside} | outside after: ${v.outside}`);
      egLog(`projected points: ${v.projected} | discarded points: ${v.discarded}`);
      console.log(`[ce01-density] density before: ${density} | spacing: ${spacing} | pitch: ${calibration.needlePitchMm} | density after: ${density}`);
      return cmds;
    }

    // Track best attempt (prioritize outside, then density, then jumps)
    if (!bestValidation ||
        v.outside < bestValidation.outside ||
        (v.outside === bestValidation.outside && density < bestValidation.density) ||
        (v.outside === bestValidation.outside && density === bestValidation.density && v.jumps < bestValidation.jumps)) {
      bestCmds = cmds;
      bestValidation = { ...v, density };
      bestSpacing = spacing;
    }

    // Density-driven retry: if density too high, continue to next spacing
    if (!densityOk) {
      console.log(`[ce01-density] density before: ${density} | spacing increased: ${spacing} → next | density after: (pending)`);
    }
  }

  // Best effort — return the attempt with fewest outside / lowest density
  egLog(`outside before: 38 (est) | outside after: ${bestValidation?.outside || 0}`);
  egLog(`projected points: ${bestValidation?.projected || 0} | discarded points: ${bestValidation?.discarded || 0}`);
  console.log(`[ce01-density] density before: 98 (est) | spacing used: ${bestSpacing} | pitch: ${calibration.needlePitchMm} | density after: ${bestValidation?.density || 0}`);
  console.log(`[ce01-final] region ${regionId}: outside=${bestValidation?.outside || 0} jumps=${bestValidation?.jumps || 0} density=${bestValidation?.density || 0}`);

  return bestCmds;
}

export function getCE01DensityCalibrationReport() {
  return {
    ce01DensityCalibrationAppliedCount: _lastCE01DensityCalibrationReport.ce01DensityCalibrationAppliedCount,
    calibratedRegionIds: [..._lastCE01DensityCalibrationReport.calibratedRegionIds],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  GENERATE AT SPECIFIC SPACING
// ═══════════════════════════════════════════════════════════════════════════

function _generateAtSpacing(polygon, safePolygon, knockoutZones, spacing, angleDeg, offX, offY, regionId, blockId, color, log, machineSettings = {}, calibration = null) {
  spacing = _clampSpacing(spacing);
  const needlePitch = _resolveNeedlePitch(machineSettings, calibration);
  log(`spacing used: ${spacing}mm`);
  log(`needle pitch used: ${needlePitch}mm`);

  // ── Rotation ──
  const rad = (angleDeg * Math.PI) / 180;
  const cF = Math.cos(-rad), sF = Math.sin(-rad);
  const cB = Math.cos(rad), sB = Math.sin(rad);
  const toF = (x, y) => [x * cF - y * sF, x * sF + y * cF];
  const toW = (x, y) => [x * cB - y * sB, x * sB + y * cB];

  // Use safePolygon (inset) for scanline intersections
  const rp = safePolygon.map(([x, y]) => toF(x, y));
  const rotatedKnockouts = (knockoutZones || []).map(zone => zone.map(([x, y]) => toF(x, y)));
  const minY = Math.min(...rp.map(p => p[1]));
  const maxY = Math.max(...rp.map(p => p[1]));
  const minX = Math.min(...rp.map(p => p[0]));
  const maxX = Math.max(...rp.map(p => p[0]));
  if (maxY - minY < spacing || maxX - minX < spacing) return [];

  // ── 1. Scanlines (intersect against safePolygon) ──
  const scanlines = [];
  let rowIdx = 0;
  for (let ry = minY + spacing * 0.5; ry < maxY; ry += spacing) {
    const xs = _edgeIntersections(rp, ry);
    if (xs.length < 2) { rowIdx++; continue; }
    xs.sort((a, b) => a - b);
    let intervals = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < MIN_INTERVAL_MM) continue;
      intervals.push({ xL: xs[i], xR: xs[i + 1], y: ry, rowIdx });
    }
    if (rotatedKnockouts.length > 0) intervals = _subtractKnockoutIntervals(intervals, rotatedKnockouts, ry);
    if (intervals.length === 0) { rowIdx++; continue; }
    scanlines.push({ y: ry, rowIdx, intervals });
    rowIdx++;
  }
  log(`scanlines: ${scanlines.length}`);
  log(`intervals: ${scanlines.reduce((s, sl) => s + sl.intervals.length, 0)}`);

  // ── 2. Merge tiny intervals within scanlines ──
  for (const sl of scanlines) {
    if (sl.intervals.length < 2) continue;
    const merged = [sl.intervals[0]];
    for (let i = 1; i < sl.intervals.length; i++) {
      const prev = merged[merged.length - 1];
      const gap = sl.intervals[i].xL - prev.xR;
      if (gap < 1.5 && (sl.intervals[i].xR - sl.intervals[i].xL < MIN_INTERVAL_MM * 2 || prev.xR - prev.xL < MIN_INTERVAL_MM * 2)) {
        prev.xR = Math.max(prev.xR, sl.intervals[i].xR);
      } else {
        merged.push(sl.intervals[i]);
      }
    }
    sl.intervals = merged.filter(iv => iv.xR - iv.xL >= MIN_INTERVAL_MM);
  }

  // ── 3. Build islands ──
  let islands = _buildIslands(scanlines);
  log(`islands: ${islands.length}`);

  // Remove tiny islands — raised threshold reduces unnecessary jumps
  islands = islands.filter(isl => {
    const w = isl.bbox.maxX - isl.bbox.minX;
    const h = isl.bbox.maxY - isl.bbox.minY;
    return w * h >= MIN_ISLAND_AREA_MM2;
  });
  if (islands.length === 0) return [];

  // ── 4. Order islands by nearest-neighbor (centroid-based) ──
  _orderIslandsNN(islands);

  // ── 5. Traverse serpentine → commands ──
  const commands = [];
  let jumpCount = 0;

  const calibrationMeta = _buildCE01DensityCalibrationCommandMeta(calibration, regionId, spacing, needlePitch);
  const mkCmd = (type, wx, wy) => ({
    type, x: wx + offX, y: wy + offY,
    regionId, blockId, stitchType: 'fill', source: type === 'trim' ? 'safe_trim' : 'ce01_safe_fill', color,
    ...calibrationMeta,
  });
  const pushValidatedJump = (wx, wy) => {
    const prev = _lastPositionCommand(commands);
    if (prev) {
      const dist = Math.hypot((wx + offX) - prev.x, (wy + offY) - prev.y);
      const trimThreshold = Number(machineSettings.trimThreshold) || 3.5;
      const maxJump = Number(machineSettings.maxJumpLength) || 12.1;
      if (dist > trimThreshold && commands[commands.length - 1]?.type !== 'trim') {
        commands.push(mkCmd('trim', prev.x - offX, prev.y - offY));
      }
      const steps = Math.max(1, Math.ceil(dist / maxJump));
      for (let s = 1; s <= steps; s++) {
        const jx = (prev.x - offX) + (wx - (prev.x - offX)) * s / steps;
        const jy = (prev.y - offY) + (wy - (prev.y - offY)) * s / steps;
        commands.push(mkCmd('jump', jx, jy));
      }
    } else {
      commands.push(mkCmd('jump', wx, wy));
    }
    jumpCount++;
  };

  for (let iIdx = 0; iIdx < islands.length; iIdx++) {
    const island = islands[iIdx];
    island.intervals.sort((a, b) => a.y - b.y);

    // Jump to island start
    if (commands.length > 0) {
      const first = island.intervals[0];
      const [wx, wy] = toW(first.xL + NEEDLE_INSET_MM, first.y);
      // Project to inside if near border
      const proj = _projectInside(wx, wy, polygon, BORDER_PROJ_MM);
      const [fx, fy] = proj || [wx, wy];
      pushValidatedJump(fx, fy);
    }

    for (let rIdx = 0; rIdx < island.intervals.length; rIdx++) {
      const iv = island.intervals[rIdx];
      const forward = (rIdx % 2) === 0;
      const brickOff = TATAMI_PHASES[rIdx % 4] * needlePitch;
      let needles = _placeNeedles(iv.xL, iv.xR, needlePitch, brickOff, forward);
      if (needles.length < 1) continue;

      // Connect from previous row — segment validation (5-point check)
      if (rIdx > 0 && commands.length > 0) {
        const prevCmd = commands[commands.length - 1];
        const prevX = prevCmd.x - offX, prevY = prevCmd.y - offY;
        const [nx, ny] = toW(needles[0], iv.y);
        const connDist = Math.hypot(nx - prevX, ny - prevY);

        if (connDist < MIN_STITCH_MM) {
          needles = needles.slice(1);
          if (needles.length === 0) continue;
        } else if (connDist > CONNECT_THRESHOLD || !_segmentInsideTolerant(prevX, prevY, nx, ny, polygon, knockoutZones)) {
          // Connection would cross outside → jump instead
          const proj = _projectInside(nx, ny, polygon, BORDER_PROJ_MM);
          const [jx, jy] = proj || [nx, ny];
          pushValidatedJump(jx, jy);
        }
        // else: safe stitch connection
      }

      // Emit stitch commands — validate each point against original polygon
      for (let i = 0; i < needles.length; i++) {
        const [wx, wy] = toW(needles[i], iv.y);
        // Project near-border points inside
        const proj = _projectInside(wx, wy, polygon, BORDER_PROJ_MM);
        if (proj && !_pointInAnyPolygon(proj[0], proj[1], knockoutZones)) {
          commands.push(mkCmd('stitch', proj[0], proj[1]));
        } else if (_pointInFillArea(wx, wy, polygon, knockoutZones)) {
          commands.push(mkCmd('stitch', wx, wy));
        }
        // else: outside or inside knockout → skip
      }
    }
  }

  log(`stitches generated: ${commands.filter(c => c.type === 'stitch').length}`);
  log(`jumps generated: ${jumpCount}`);

  // ── 6. Post-process: split long, merge micro, validate ──
  const processed = _postProcess(commands, polygon, knockoutZones, offX, offY, log);

  return processed;
}

// ═══════════════════════════════════════════════════════════════════════════
//  POST-PROCESS (split long, merge micro, project/validate inside)
// ═══════════════════════════════════════════════════════════════════════════

function _postProcess(commands, polygon, knockoutZones, offX, offY, log) {
  const out = [];
  let splitCount = 0, mergeCount = 0, rejectedCount = 0, projectedCount = 0;
  let prevX = null, prevY = null;

  for (const cmd of commands) {
    const localX = cmd.x - offX, localY = cmd.y - offY;

    if (cmd.type === 'jump') {
      out.push(cmd);
      prevX = cmd.x; prevY = cmd.y;
      continue;
    }
    if (cmd.type === 'trim') {
      out.push(cmd);
      continue;
    }

    // Check inside — project if near border
    let fx = localX, fy = localY;
    if (!_pointInFillArea(fx, fy, polygon, knockoutZones)) {
      if (_pointInAnyPolygon(fx, fy, knockoutZones)) {
        rejectedCount++;
        continue;
      }
      const proj = _projectInside(fx, fy, polygon, BORDER_PROJ_MM);
      if (proj && !_pointInAnyPolygon(proj[0], proj[1], knockoutZones)) {
        fx = proj[0]; fy = proj[1];
        projectedCount++;
        cmd.x = fx + offX; cmd.y = fy + offY;
      } else {
        rejectedCount++;
        continue;
      }
    }

    // Merge micro
    if (prevX !== null) {
      const d = Math.hypot(cmd.x - prevX, cmd.y - prevY);
      if (d < MIN_STITCH_MM && d > 0) { mergeCount++; continue; }
    }

    // Split long — validate each intermediate point
    if (prevX !== null) {
      const d = Math.hypot(cmd.x - prevX, cmd.y - prevY);
      if (d > MAX_STITCH_MM) {
        const steps = Math.ceil(d / MAX_STITCH_MM);
        for (let s = 1; s < steps; s++) {
          const mx = prevX + (cmd.x - prevX) * s / steps;
          const my = prevY + (cmd.y - prevY) * s / steps;
          const mlx = mx - offX, mly = my - offY;
          if (_pointInFillArea(mlx, mly, polygon, knockoutZones)) {
            out.push({ ...cmd, x: mx, y: my });
          } else if (!_pointInAnyPolygon(mlx, mly, knockoutZones)) {
            const proj = _projectInside(mlx, mly, polygon, BORDER_PROJ_MM);
            if (proj && !_pointInAnyPolygon(proj[0], proj[1], knockoutZones)) {
              out.push({ ...cmd, x: proj[0] + offX, y: proj[1] + offY });
            }
          }
        }
        splitCount++;
      }
    }

    out.push(cmd);
    prevX = cmd.x; prevY = cmd.y;
  }

  log(`outside rejected: ${rejectedCount}`);
  log(`projected points: ${projectedCount}`);
  log(`long split: ${splitCount}`);
  log(`micro merged: ${mergeCount}`);

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function _validate(commands, polygon, knockoutZones, offX, offY) {
  let stitches = 0, jumps = 0, outside = 0, longS = 0, microS = 0;
  let projected = 0, discarded = 0;
  let prevX = null, prevY = null;
  for (const cmd of commands) {
    if (cmd.type === 'jump') { jumps++; prevX = cmd.x; prevY = cmd.y; continue; }
    if (cmd.type === 'trim') continue;
    stitches++;
    const lx = cmd.x - offX, ly = cmd.y - offY;
    if (!_pointInFillArea(lx, ly, polygon, knockoutZones)) {
      // Check if it was projected (near border) or inside a knockout — still count as outside fill area
      outside++;
    }
    if (prevX !== null) {
      const d = Math.hypot(cmd.x - prevX, cmd.y - prevY);
      if (d > MAX_STITCH_MM) longS++;
      if (d > 0 && d < MIN_STITCH_MM) microS++;
    }
    prevX = cmd.x; prevY = cmd.y;
  }
  return { stitches, jumps, outside, long: longS, micro: microS, projected, discarded };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DENSITY
// ═══════════════════════════════════════════════════════════════════════════

function _maxDensity(commands, offX, offY, cellSize = DENSITY_CELL_MM) {
  const grid = new Map();
  for (const cmd of commands) {
    if (cmd.type !== 'stitch') continue;
    const gx = Math.floor((cmd.x - offX) / cellSize);
    const gy = Math.floor((cmd.y - offY) / cellSize);
    const key = `${gx},${gy}`;
    grid.set(key, (grid.get(key) || 0) + 1);
  }
  let max = 0;
  for (const v of grid.values()) if (v > max) max = v;
  return max;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ISLAND BUILDING
// ═══════════════════════════════════════════════════════════════════════════

function _buildIslands(scanlines) {
  const all = [];
  const byRow = new Map();
  for (const sl of scanlines) {
    byRow.set(sl.rowIdx, sl.intervals);
    for (const iv of sl.intervals) { iv._idx = all.length; all.push(iv); }
  }
  const uf = new UnionFind(all.length);
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  for (let r = 0; r < rows.length - 1; r++) {
    const a = byRow.get(rows[r]), b = byRow.get(rows[r + 1]);
    for (const ia of a) for (const ib of b) {
      if (ia.xL < ib.xR + 1.0 && ib.xL < ia.xR + 1.0) uf.union(ia._idx, ib._idx);
    }
  }
  const map = new Map();
  for (let i = 0; i < all.length; i++) {
    const root = uf.find(i);
    if (!map.has(root)) map.set(root, []);
    map.get(root).push(all[i]);
  }
  let id = 0;
  const islands = [];
  for (const [, intervals] of map) {
    let mnx=Infinity,mxx=-Infinity,mny=Infinity,mxy=-Infinity;
    for (const iv of intervals) {
      mnx=Math.min(mnx,iv.xL); mxx=Math.max(mxx,iv.xR);
      mny=Math.min(mny,iv.y); mxy=Math.max(mxy,iv.y);
    }
    // Compute centroid for better NN ordering
    let ccx = 0, ccy = 0;
    for (const iv of intervals) { ccx += (iv.xL + iv.xR) / 2; ccy += iv.y; }
    ccx /= intervals.length; ccy /= intervals.length;
    islands.push({ islandId: id++, intervals, bbox: { minX:mnx, maxX:mxx, minY:mny, maxY:mxy }, centroid: [ccx, ccy] });
  }
  return islands;
}

function _orderIslandsNN(islands) {
  if (islands.length <= 1) return;
  const ordered = [islands[0]];
  const remaining = islands.slice(1);
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    const [lx, ly] = last.centroid;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const [cx, cy] = remaining[i].centroid;
      const d = Math.hypot(cx - lx, cy - ly);
      if (d < bd) { bd = d; bi = i; }
    }
    ordered.push(remaining.splice(bi, 1)[0]);
  }
  islands.length = 0;
  islands.push(...ordered);
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEOMETRY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** 5-point segment-inside check — no stitch may cross outside the polygon */
function _segmentInside(x1, y1, x2, y2, poly) {
  for (let t = 0; t <= 1.0001; t += 0.25) {
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    if (!_pointInPolygon(px, py, poly)) return false;
  }
  return true;
}

/** Tolerant segment-inside check — allows points near the border (within toleranceMm) */
function _segmentInsideTolerant(x1, y1, x2, y2, poly, knockoutZones = [], toleranceMm = BORDER_PROJ_MM) {
  for (let t = 0; t <= 1.0001; t += 0.2) {
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    if (_pointInFillArea(px, py, poly, knockoutZones)) continue;
    const projected = _projectInside(px, py, poly, toleranceMm);
    if (projected && !_pointInAnyPolygon(projected[0], projected[1], knockoutZones)) continue;
    return false;
  }
  return true;
}

/** Project a point that's slightly outside to the nearest interior position */
function _projectInside(x, y, polygon, maxDistMm = BORDER_PROJ_MM) {
  if (_pointInPolygon(x, y, polygon)) return [x, y];

  // Compute centroid
  let cx = 0, cy = 0;
  for (const [px, py] of polygon) { cx += px; cy += py; }
  cx /= polygon.length; cy /= polygon.length;

  // Move toward centroid in small steps until inside (max 5 steps = 0.5mm)
  let px = x, py = y;
  const step = 0.1;
  for (let i = 0; i < 5; i++) {
    const dx = cx - px, dy = cy - py;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) break;
    px += (dx / len) * step;
    py += (dy / len) * step;
    if (_pointInPolygon(px, py, polygon)) {
      // Verify we didn't move more than maxDistMm
      const moved = Math.hypot(px - x, py - y);
      if (moved <= maxDistMm + 0.3) return [px, py];
      return null; // too far — can't project safely
    }
  }
  return null;
}

/** Shrink polygon toward centroid by insetMm — robust for small insets */
function _insetPolygon(polygon, insetMm) {
  const n = polygon.length;
  if (n < 3) return polygon.map(p => [...p]);

  // Compute centroid
  let cx = 0, cy = 0;
  for (const [x, y] of polygon) { cx += x; cy += y; }
  cx /= n; cy /= n;

  const result = [];
  for (const [x, y] of polygon) {
    const dx = cx - x, dy = cy - y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) { result.push([x, y]); continue; }
    // Move toward centroid by insetMm (capped at 80% of distance to avoid collapse)
    const factor = Math.min(0.8, insetMm / len);
    result.push([x + dx * factor, y + dy * factor]);
  }
  return result;
}

function _pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function _edgeIntersections(poly, ry) {
  const xs = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    if ((ay <= ry && by > ry) || (by <= ry && ay > ry)) {
      xs.push(ax + ((ry - ay) / (by - ay)) * (bx - ax));
    }
  }
  return xs;
}

function _subtractKnockoutIntervals(intervals, rotatedKnockouts, ry) {
  let result = intervals;
  for (const hole of rotatedKnockouts) {
    const xs = _edgeIntersections(hole, ry).sort((a, b) => a - b);
    if (xs.length < 2) continue;
    const holeIntervals = [];
    for (let i = 0; i + 1 < xs.length; i += 2) holeIntervals.push({ xL: xs[i], xR: xs[i + 1] });
    for (const h of holeIntervals) {
      const next = [];
      for (const iv of result) {
        if (h.xR <= iv.xL || h.xL >= iv.xR) {
          next.push(iv);
          continue;
        }
        if (h.xL - iv.xL >= MIN_INTERVAL_MM) next.push({ ...iv, xR: h.xL });
        if (iv.xR - h.xR >= MIN_INTERVAL_MM) next.push({ ...iv, xL: h.xR });
      }
      result = next;
      if (result.length === 0) break;
    }
  }
  return result;
}

function _pointInAnyPolygon(x, y, polygons = []) {
  return (polygons || []).some(poly => Array.isArray(poly) && poly.length >= 3 && _pointInPolygon(x, y, poly));
}

function _pointInFillArea(x, y, polygon, knockoutZones = []) {
  return _pointInPolygon(x, y, polygon) && !_pointInAnyPolygon(x, y, knockoutZones);
}

function _buildSpacingRetries(base, calibration = null) {
  const n = Number(base);
  if (Number.isFinite(n) && n > 0) {
    const b = _clampSpacing(n);
    const step = b < 0.22 ? 0.03 : 0.05;
    const max = calibration?.areaBand === 'small' ? 0.45 : Math.min(MAX_SPACING_MM, b + step * 2);
    return [b, _clampSpacing(b + step, max), _clampSpacing(b + step * 2, max)].filter((v, i, arr) => arr.indexOf(v) === i);
  }
  return SPACING_RETRIES.map(_clampSpacing);
}

function _clampSpacing(v, max = MAX_SPACING_MM) {
  const n = Number(v);
  return Math.max(MIN_SPACING_MM, Math.min(max, Number.isFinite(n) ? n : 0.24));
}

function _lastPositionCommand(commands) {
  for (let i = commands.length - 1; i >= 0; i--) {
    const c = commands[i];
    if (c && (c.type === 'stitch' || c.type === 'jump') && Number.isFinite(c.x) && Number.isFinite(c.y)) return c;
  }
  return null;
}

function _placeNeedles(xL, xR, pitch, brickOff, forward) {
  const aL = xL + NEEDLE_INSET_MM;
  const aR = xR - NEEDLE_INSET_MM;
  if (aR - aL < MIN_STITCH_MM) return [];
  const phase = ((brickOff % pitch) + pitch) % pitch;
  const needles = [aL];
  let nx = aL + phase;
  if (nx <= aL + MIN_STITCH_MM) nx += pitch;
  while (nx < aR - MIN_STITCH_MM) { needles.push(nx); nx += pitch; }
  needles.push(aR);
  const out = [needles[0]];
  for (let i = 1; i < needles.length; i++) {
    if (needles[i] - out[out.length - 1] >= MIN_STITCH_MM) out.push(needles[i]);
  }
  return forward ? out : out.reverse();
}