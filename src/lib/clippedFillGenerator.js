/**
 * clippedFillGenerator.js — Polygon-clipped scanline fill with island optimization
 * ─────────────────────────────────────────────────────────────────────────────
 * Supports ce01SafeFillMode: conservative parameters for Caydo CE01 stability.
 *
 * Safe mode differences:
 *   - Wider spacing (0.65mm, up to 0.8mm adaptive)
 *   - Longer stitch (3.5mm)
 *   - Fewer rows (max 100)
 *   - Needle inset from boundaries (0.3mm) → guaranteed inside polygon
 *   - Min interval 1.5mm, min island area 1.5mm²
 *   - Aggressive merging of tiny intervals
 *   - Tiny island removal
 *
 * Returns: Array<[x_mm, y_mm, 'J'|'S']>  ('J'=jump, 'S'=stitch, default 'S')
 */

const MAX_STITCH_MM = 7.5;
const MIN_STITCH_MM = 0.8;
const TATAMI_PHASES = [0, 0.25, 0.5, 0.75];

// Safe mode parameters
const SAFE = {
  fillSpacingMm: 0.65,
  maxSpacingMm: 0.8,
  stitchLenMm: 3.5,
  maxRows: 100,
  minIntervalMm: 1.5,
  minIslandAreaMm2: 1.5,
  needleInsetMm: 0.3,
  connectThresholdMm: 8.0,
};

// Normal mode parameters
const NORMAL = {
  maxRows: 150,
  minIntervalMm: 0.5,
  minIslandAreaMm2: 0,
  needleInsetMm: 0,
  connectThresholdMm: 6.0,
};

// ═══════════════════════════════════════════════════════════════════════════
//  UNION-FIND
// ═══════════════════════════════════════════════════════════════════════════

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array(n).fill(0);
  }
  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) { this.parent[ra] = rb; }
    else if (this.rank[ra] > this.rank[rb]) { this.parent[rb] = ra; }
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN ENTRY
// ═══════════════════════════════════════════════════════════════════════════

export function generateClippedFillStitches(polygonMm, options = {}) {
  const {
    densityMm = 0.4,
    stitchLenMm = 3.0,
    angleDeg = 0,
    regionId = 'unknown',
    ce01SafeFillMode = false,
  } = options;

  const P = ce01SafeFillMode ? SAFE : NORMAL;
  const logTag = ce01SafeFillMode ? 'ce01-safe-fill' : 'fill-opt';
  const log = (msg) => console.log(`[${logTag}] ${msg}`);

  if (ce01SafeFillMode) log(`enabled: region=${regionId}`);
  log(`region: ${regionId}`);

  if (!polygonMm || polygonMm.length < 3) return [];

  // ── Rotation ──
  const rad = (angleDeg * Math.PI) / 180;
  const cF = Math.cos(-rad), sF = Math.sin(-rad);
  const cB = Math.cos(rad), sB = Math.sin(rad);
  const toF = (x, y) => [x * cF - y * sF, x * sF + y * cF];
  const toW = (x, y) => [x * cB - y * sB, x * sB + y * cB];

  const rp = polygonMm.map(([x, y]) => toF(x, y));
  const minY = Math.min(...rp.map(p => p[1]));
  const maxY = Math.max(...rp.map(p => p[1]));
  const minX = Math.min(...rp.map(p => p[0]));
  const maxX = Math.max(...rp.map(p => p[0]));
  if (maxY - minY < densityMm || maxX - minX < densityMm) return [];

  // ── Adaptive density ──
  let effDensity = ce01SafeFillMode ? Math.max(P.fillSpacingMm, densityMm) : densityMm;
  let estRows = (maxY - minY) / effDensity;
  if (estRows > P.maxRows) {
    effDensity = (maxY - minY) / P.maxRows;
    if (ce01SafeFillMode && effDensity > P.maxSpacingMm) effDensity = P.maxSpacingMm;
  }
  const effStitchLen = ce01SafeFillMode ? P.stitchLenMm : stitchLenMm;
  log(`spacing used: ${effDensity.toFixed(2)}mm (stitchLen=${effStitchLen}mm)`);

  // ── 1. Generate scanlines ──
  const scanlines = [];
  let rowIdx = 0;
  for (let ry = minY + effDensity * 0.5; ry < maxY; ry += effDensity) {
    const xs = _edgeIntersections(rp, ry);
    if (xs.length < 2) { rowIdx++; continue; }
    xs.sort((a, b) => a - b);
    const intervals = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w < P.minIntervalMm) continue; // filter tiny intervals at source
      intervals.push({ xL: xs[i], xR: xs[i + 1], y: ry, rowIdx });
    }
    if (intervals.length === 0) { rowIdx++; continue; }
    scanlines.push({ y: ry, rowIdx, intervals });
    rowIdx++;
  }
  const totalRawIntervals = scanlines.reduce((s, sl) => s + sl.intervals.length, 0);
  log(`original intervals: ${totalRawIntervals}`);

  // ── 2. Merge tiny intervals within scanlines ──
  let mergedTiny = 0;
  for (const sl of scanlines) {
    const ivs = sl.intervals;
    if (ivs.length < 2) continue;
    const merged = [ivs[0]];
    for (let i = 1; i < ivs.length; i++) {
      const prev = merged[merged.length - 1];
      const gap = ivs[i].xL - prev.xR;
      if (gap < 1.5 && (ivs[i].xR - ivs[i].xL < P.minIntervalMm * 2 || prev.xR - prev.xL < P.minIntervalMm * 2)) {
        prev.xR = Math.max(prev.xR, ivs[i].xR);
        mergedTiny++;
      } else {
        merged.push(ivs[i]);
      }
    }
    sl.intervals = merged.filter(iv => iv.xR - iv.xL >= P.minIntervalMm);
  }
  const afterMerge = scanlines.reduce((s, sl) => s + sl.intervals.length, 0);
  log(`intervals removed: ${totalRawIntervals - afterMerge}`);

  // ── 3. Build islands ──
  let islands = _buildIslands(scanlines);
  const islandsBefore = islands.length;

  // Remove tiny islands in safe mode
  if (ce01SafeFillMode && P.minIslandAreaMm2 > 0) {
    islands = islands.filter(isl => {
      const w = isl.bbox.maxX - isl.bbox.minX;
      const h = isl.bbox.maxY - isl.bbox.minY;
      return w * h >= P.minIslandAreaMm2;
    });
  }
  log(`islands removed: ${islandsBefore - islands.length} (of ${islandsBefore})`);

  if (islands.length === 0) return [];

  // ── 4. Order islands by nearest-neighbor ──
  _orderIslandsNN(islands);

  // ── 5. Traverse islands serpentine ──
  const rawPoints = [];
  let jumpCount = 0;
  const inset = P.needleInsetMm;

  for (let iIdx = 0; iIdx < islands.length; iIdx++) {
    const island = islands[iIdx];
    island.intervals.sort((a, b) => a.y - b.y);

    // Jump to island start (if not first island)
    if (rawPoints.length > 0) {
      const first = island.intervals[0];
      const [wx, wy] = toW(first.xL + inset, first.y);
      rawPoints.push([wx, wy, 'J']);
      jumpCount++;
    }

    for (let rIdx = 0; rIdx < island.intervals.length; rIdx++) {
      const iv = island.intervals[rIdx];
      const forward = (rIdx % 2) === 0;
      const brickOff = TATAMI_PHASES[rIdx % 4] * effStitchLen;
      let needles = _placeNeedles(iv.xL, iv.xR, effStitchLen, brickOff, forward, inset);
      if (needles.length < 1) continue;

      // Connect from previous row
      if (rIdx > 0 && rawPoints.length > 0) {
        const prevPt = rawPoints[rawPoints.length - 1];
        const [nx, ny] = toW(needles[0], iv.y);
        const connDist = Math.hypot(nx - prevPt[0], ny - prevPt[1]);

        if (connDist < MIN_STITCH_MM) {
          // Merge micro connection: skip first needle
          needles = needles.slice(1);
          if (needles.length === 0) continue;
        } else if (connDist > P.connectThresholdMm || !_midpointInside(prevPt[0], prevPt[1], nx, ny, polygonMm)) {
          rawPoints.push([nx, ny, 'J']);
          jumpCount++;
        }
        // else: safe stitch connection
      }

      for (let i = 0; i < needles.length; i++) {
        const [wx, wy] = toW(needles[i], iv.y);
        rawPoints.push([wx, wy, 'S']);
      }
    }
  }

  const jumpsBefore = jumpCount;
  const outsideBefore = rawPoints.filter(p => p[2] !== 'J' && !_pointInPolygon(p[0], p[1], polygonMm)).length;
  const longBefore = _countLong(rawPoints, MAX_STITCH_MM);
  const microBefore = _countMicro(rawPoints, MIN_STITCH_MM);

  // ── 6. Post-process ──
  const result = _postProcess(rawPoints, polygonMm, log);

  const jumpsAfter = result.filter(p => p[2] === 'J').length;
  const outsideAfter = result.filter(p => p[2] !== 'J' && !_pointInPolygon(p[0], p[1], polygonMm)).length;
  const longAfter = _countLong(result, MAX_STITCH_MM);
  const microAfter = _countMicro(result, MIN_STITCH_MM);
  const stitchTotal = result.filter(p => p[2] !== 'J').length;

  log(`jumps before/after: ${jumpsBefore}/${jumpsAfter}`);
  log(`outside before/after: ${outsideBefore}/${outsideAfter}`);
  log(`long stitches before/after: ${longBefore}/${longAfter}`);
  log(`short stitches before/after: ${microBefore}/${microAfter}`);

  const status = (outsideAfter <= 5 && longAfter === 0 && jumpsAfter <= 120) ? 'SAFE' :
                 (outsideAfter <= 20 && longAfter <= 5) ? 'RISKY' : 'INVALID';
  log(`final region status: ${status} (stitches=${stitchTotal})`);

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  VALIDATION HELPERS (also used by auto-fallback)
// ═══════════════════════════════════════════════════════════════════════════

export function validateFillPoints(points, polygonMm) {
  let jumps = 0, outside = 0, longS = 0, microS = 0, stitches = 0;
  let prevX = null, prevY = null;
  for (const pt of points) {
    if (pt[2] === 'J') { jumps++; prevX = pt[0]; prevY = pt[1]; continue; }
    stitches++;
    if (!_pointInPolygon(pt[0], pt[1], polygonMm)) outside++;
    if (prevX !== null) {
      const d = Math.hypot(pt[0] - prevX, pt[1] - prevY);
      if (d > 7.5) longS++;
      if (d > 0 && d < 0.8) microS++;
    }
    prevX = pt[0]; prevY = pt[1];
  }
  return { stitches, jumps, outsideRegion: outside, longStitches: longS, shortStitches: microS };
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
    const rowA = byRow.get(rows[r]);
    const rowB = byRow.get(rows[r + 1]);
    for (const a of rowA) {
      for (const b of rowB) {
        const tol = 1.0;
        if (a.xL < b.xR + tol && b.xL < a.xR + tol) uf.union(a._idx, b._idx);
      }
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
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const iv of intervals) {
      if (iv.xL < mnx) mnx = iv.xL;
      if (iv.xR > mxx) mxx = iv.xR;
      if (iv.y < mny) mny = iv.y;
      if (iv.y > mxy) mxy = iv.y;
    }
    islands.push({ islandId: id++, intervals, bbox: { minX: mnx, maxX: mxx, minY: mny, maxY: mxy } });
  }
  return islands;
}

function _orderIslandsNN(islands) {
  if (islands.length <= 1) return;
  const ordered = [islands[0]];
  const remaining = islands.slice(1);
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const isl = remaining[i];
      const d = Math.hypot(isl.bbox.minX - last.bbox.maxX, isl.bbox.minY - last.bbox.maxY);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  islands.length = 0;
  islands.push(...ordered);
}

// ═══════════════════════════════════════════════════════════════════════════
//  POST-PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

function _postProcess(points, polygon, log) {
  const out = [];
  let splitCount = 0, mergeCount = 0, rejectedCount = 0;
  let prevX = null, prevY = null;

  for (const pt of points) {
    const [x, y, flag] = pt;
    const isJump = flag === 'J';

    if (isJump) {
      out.push([x, y, 'J']);
      prevX = x; prevY = y;
      continue;
    }

    // Strict inside check — reject outside points
    if (!_pointInPolygon(x, y, polygon)) {
      rejectedCount++;
      // Drop the point entirely (don't convert to jump — avoids phantom jumps)
      continue;
    }

    // Merge micro
    if (prevX !== null) {
      const d = Math.hypot(x - prevX, y - prevY);
      if (d < MIN_STITCH_MM && d > 0) { mergeCount++; continue; }
    }

    // Split long
    if (prevX !== null) {
      const d = Math.hypot(x - prevX, y - prevY);
      if (d > MAX_STITCH_MM) {
        const steps = Math.ceil(d / MAX_STITCH_MM);
        for (let s = 1; s < steps; s++) {
          const mx = prevX + (x - prevX) * s / steps;
          const my = prevY + (y - prevY) * s / steps;
          // Validate intermediate points too
          if (_pointInPolygon(mx, my, polygon)) {
            out.push([mx, my, 'S']);
          }
        }
        splitCount++;
      }
    }

    out.push([x, y, 'S']);
    prevX = x; prevY = y;
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEOMETRY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function _countLong(points, maxMm) {
  let count = 0, prevX = null, prevY = null;
  for (const pt of points) {
    if (pt[2] === 'J') { prevX = pt[0]; prevY = pt[1]; continue; }
    if (prevX !== null) {
      if (Math.hypot(pt[0] - prevX, pt[1] - prevY) > maxMm) count++;
    }
    prevX = pt[0]; prevY = pt[1];
  }
  return count;
}

function _countMicro(points, minMm) {
  let count = 0, prevX = null, prevY = null;
  for (const pt of points) {
    if (pt[2] === 'J') { prevX = pt[0]; prevY = pt[1]; continue; }
    if (prevX !== null) {
      const d = Math.hypot(pt[0] - prevX, pt[1] - prevY);
      if (d > 0 && d < minMm) count++;
    }
    prevX = pt[0]; prevY = pt[1];
  }
  return count;
}

function _midpointInside(x1, y1, x2, y2, polygon) {
  return _pointInPolygon((x1 + x2) / 2, (y1 + y2) / 2, polygon);
}

function _pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
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
      const t = (ry - ay) / (by - ay);
      xs.push(ax + t * (bx - ax));
    }
  }
  return xs;
}

function _placeNeedles(xL, xR, pitch, brickOff, forward, inset = 0) {
  const aL = xL + inset;
  const aR = xR - inset;
  if (aR - aL < MIN_STITCH_MM) return [];
  const phase = ((brickOff % pitch) + pitch) % pitch;
  const needles = [aL];
  let nx = aL + phase;
  if (nx <= aL + MIN_STITCH_MM) nx += pitch;
  while (nx < aR - MIN_STITCH_MM) {
    needles.push(nx);
    nx += pitch;
  }
  needles.push(aR);
  const out = [needles[0]];
  for (let i = 1; i < needles.length; i++) {
    if (needles[i] - out[out.length - 1] >= MIN_STITCH_MM) out.push(needles[i]);
  }
  return forward ? out : out.reverse();
}