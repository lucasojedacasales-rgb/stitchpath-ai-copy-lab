/**
 * rawDarkStrokeTest.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * FULLY ISOLATED diagnostic test for the lower contour + feet.
 *
 * STRICT dark mask: luma<55, sat<80, localContrast>20 → only real black strokes.
 *
 * Geometry fixes:
 *   - traceSkeletonGraph: degree-based graph trace (endpoints + junctions),
 *     each edge = independent path. No greedy first-neighbor branch-jumping.
 *   - splitPathsByLowerZone: clips paths point-by-point into lower subsegments.
 *     Never decides by centroid, never creates/closes paths.
 *
 * Hard rules:
 *   - Input = original upload bitmap. No bbox/crop/silhouette/fill fallback.
 *   - pathDarkSupportRatio >= 0.90 against the PURE strict mask.
 *   - If no real black strokes → 0 paths.
 */

export const RAW_PARAMS = {
  strictLumaMax: 55,
  strictSatMax: 80,
  localContrastMin: 20,
  minComponentArea: 5,
  closeGapPx: 1,
  minPathLengthPx: 6,
  maxProcessWidth: 320,
  darkSupportMin: 0.90,
  borderMarginPx: 3,
  frameLineMinFrac: 0.5,
  frameLineThicknessPx: 6,
  lowerZoneY: 0.55,
  footZoneY: 0.72,
  minSubpathLen: 6,
};

function luma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
function sat(r, g, b) { return Math.max(r, g, b) - Math.min(r, g, b); }

// ── STRICT DARK MASK ─────────────────────────────────────────────────────────
export function createStrictDarkMask(imageData, params = {}) {
  const p = { ...RAW_PARAMS, ...params };
  const { width: W, height: H, data } = imageData;
  const lumaArr = new Float32Array(W * H);
  const rawDark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const L = luma(r, g, b);
    lumaArr[i] = L;
    if (L < p.strictLumaMax && sat(r, g, b) < p.strictSatMax) rawDark[i] = 1;
  }

  // DARK_STROKE_SOURCE_AND_CARTOON_SEGMENTATION_CLEANUP_V1
  // If the image contains a large black background, remove only the large
  // edge-connected dark component before local-contrast stroke extraction.
  const rawDarkPixels = rawDark.reduce((s, v) => s + v, 0);
  const bg = rawDarkPixels / (W * H) > 0.35
    ? detectAndRemoveDarkBackgroundFromMask(rawDark, W, H)
    : { cleanedMask: rawDark, darkBackgroundDetected: false, darkBackgroundPixelsRemoved: 0, edgeConnectedDarkComponentsRemoved: 0 };
  const cleanedDark = bg.cleanedMask;

  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    if (!cleanedDark[idx]) continue;
    let mx = -1, mn = 999;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ll = lumaArr[ny * W + nx];
      if (ll > mx) mx = ll; if (ll < mn) mn = ll;
    }
    if (mx - mn < p.localContrastMin) continue;
    mask[idx] = 1;
  }
  mask._darkBackground = bg;
  mask._rawDarkPixelsBefore = rawDarkPixels;
  mask._rawDarkPixelsAfter = cleanedDark.reduce((s, v) => s + v, 0);
  return mask;
}

// ── Morphology ────────────────────────────────────────────────────────────────
function dilate(m, W, H) {
  const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (m[p]) { o[p] = 1; continue; }
    let on = false;
    for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (m[ny * W + nx]) { on = true; break; }
    }
    o[p] = on ? 1 : 0;
  }
  return o;
}
function erode(m, W, H) {
  const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (!m[p]) { o[p] = 0; continue; }
    let all = true;
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) { all = false; break; }
      if (!m[ny * W + nx]) { all = false; break; }
    }
    o[p] = all ? 1 : 0;
  }
  return o;
}

// ── Connected components ───────────────────────────────────────────────────────
function connectedComponents(mask, W, H, minArea) {
  const labels = new Int32Array(W * H);
  const comps = [];
  let cur = 0; const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (mask[i] && !labels[i]) {
      cur++; const comp = { label: cur, area: 0, bbox: null };
      let minX = W, minY = H, maxX = 0, maxY = 0;
      labels[i] = cur; stack.push(i);
      while (stack.length) {
        const q = stack.pop(); const x = q % W, y = (q / W) | 0;
        comp.area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nq = ny * W + nx;
          if (mask[nq] && !labels[nq]) { labels[nq] = cur; stack.push(nq); }
        }
      }
      comp.bbox = { minX, minY, maxX, maxY };
      if (comp.area >= minArea) comps.push(comp);
    }
  }
  return comps;
}

// ── Zhang-Suen thinning ────────────────────────────────────────────────────────
function transitions(P) { let c = 0; for (let i = 0; i < 8; i++) if (P[i] === 0 && P[(i + 1) % 8] === 1) c++; return c; }
function thinZhangSuen(mask, W, H) {
  const img = new Uint8Array(mask);
  let changed = true, guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    const rm1 = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x; if (!img[p]) continue;
      const P = [img[p - W], img[p - W + 1], img[p + 1], img[p + W + 1], img[p + W], img[p + W - 1], img[p - 1], img[p - W - 1]];
      const A = transitions(P), B = P[0] + P[1] + P[2] + P[3] + P[4] + P[5] + P[6] + P[7];
      if (A === 1 && B >= 2 && B <= 6 && P[0] * P[2] * P[4] === 0 && P[2] * P[4] * P[6] === 0) rm1.push(p);
    }
    if (rm1.length) { for (const p of rm1) img[p] = 0; changed = true; }
    const rm2 = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x; if (!img[p]) continue;
      const P = [img[p - W], img[p - W + 1], img[p + 1], img[p + W + 1], img[p + W], img[p + W - 1], img[p - 1], img[p - W - 1]];
      const A = transitions(P), B = P[0] + P[1] + P[2] + P[3] + P[4] + P[5] + P[6] + P[7];
      if (A === 1 && B >= 2 && B <= 6 && P[0] * P[2] * P[6] === 0 && P[0] * P[4] * P[6] === 0) rm2.push(p);
    }
    if (rm2.length) { for (const p of rm2) img[p] = 0; changed = true; }
  }
  return img;
}

// ── Neighbor helper ────────────────────────────────────────────────────────────
function neighborsOf(p, W, H, arr) {
  const x = p % W, y = (p / W) | 0;
  const res = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const np = ny * W + nx;
    if (arr[np]) res.push(np);
  }
  return res;
}

// ── GRAPH-BASED skeleton trace (endpoints + junctions → edges) ───────────────
// Replaces greedy first-neighbor walk. Each edge between nodes is an independent
// path. No branch-jumping, no diagonals across junctions.
function traceSkeletonGraph(skel, W, H, minLen) {
  const deg = new Int32Array(W * H);
  let junctionCount = 0;
  for (let i = 0; i < W * H; i++) {
    if (!skel[i]) continue;
    const d = neighborsOf(i, W, H, skel).length;
    deg[i] = d;
    if (d > 2) junctionCount++;
  }
  const isNode = (p) => skel[p] && (deg[p] === 1 || deg[p] > 2);
  const visited = new Uint8Array(W * H);
  const usedNodeEdge = new Set();
  const pairKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
  const paths = [];

  const nodes = [];
  for (let i = 0; i < W * H; i++) if (isNode(i)) nodes.push(i);

  for (const node of nodes) {
    const nbrs = neighborsOf(node, W, H, skel);
    for (const start of nbrs) {
      if (isNode(start)) {
        const k = pairKey(node, start);
        if (usedNodeEdge.has(k)) continue;
        usedNodeEdge.add(k);
        paths.push([node, start].map(p => ({ x: p % W, y: (p / W) | 0 })));
        continue;
      }
      if (visited[start]) continue;
      const path = [node];
      let prev = node, cur = start;
      while (true) {
        path.push(cur);
        if (isNode(cur)) break;
        visited[cur] = 1;
        const next = neighborsOf(cur, W, H, skel).filter(n => n !== prev && !visited[n]);
        if (next.length === 0) break;
        prev = cur; cur = next[0];
      }
      if (path.length >= minLen) paths.push(path.map(p => ({ x: p % W, y: (p / W) | 0 })));
    }
  }

  // Isolated loops (all degree-2, no nodes)
  for (let i = 0; i < W * H; i++) {
    if (skel[i] && !visited[i] && deg[i] === 2) {
      const path = [i]; visited[i] = 1;
      const startNbrs = neighborsOf(i, W, H, skel).filter(n => !visited[n]);
      if (startNbrs.length === 0) continue;
      let prev = i, cur = startNbrs[0], guard = 0;
      while (cur !== i && guard++ < W * H) {
        visited[cur] = 1; path.push(cur);
        const nb = neighborsOf(cur, W, H, skel).filter(n => n !== prev);
        if (nb.length === 0) break;
        prev = cur; cur = nb[0];
      }
      if (path.length >= minLen) paths.push(path.map(p => ({ x: p % W, y: (p / W) | 0 })));
    }
  }

  return { paths, junctionCount };
}

// ── Remove artificial dark backgrounds (mask residue / black frame) ──────────
// Eliminates strict-mask components that touch the canvas border AND cover a
// large area (background or erase-mask residue). Thin strokes (outlines) and
// small internal details (eyes/mouth) are always preserved.
export function detectAndRemoveDarkBackgroundFromMask(mask, W, H) {
  const total = W * H;
  const labels = new Int32Array(total).fill(0);
  const cleaned = new Uint8Array(mask);
  const stack = [];
  let label = 0;
  let darkBackgroundDetected = false;
  let darkBackgroundPixelsRemoved = 0;
  let edgeConnectedDarkComponentsRemoved = 0;
  let componentsBefore = 0;
  const BG_AREA_RATIO = 0.05;
  for (let i = 0; i < total; i++) {
    if (!mask[i] || labels[i]) continue;
    label++;
    componentsBefore++;
    let area = 0, minX = W, maxX = -1, minY = H, maxY = -1;
    labels[i] = label; stack.push(i);
    const pixels = [];
    while (stack.length) {
      const q = stack.pop(); const x = q % W, y = (q / W) | 0;
      area++; pixels.push(q);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nq = ny * W + nx;
        if (mask[nq] && !labels[nq]) { labels[nq] = label; stack.push(nq); }
      }
    }
    const touchesEdge = minX <= 0 || maxX >= W - 1 || minY <= 0 || maxY >= H - 1;
    const areaRatio = area / total;
    if (touchesEdge && areaRatio > BG_AREA_RATIO) {
      darkBackgroundDetected = true;
      for (const q of pixels) { cleaned[q] = 0; darkBackgroundPixelsRemoved++; }
      edgeConnectedDarkComponentsRemoved++;
    }
  }
  const componentsAfter = connectedComponents(cleaned, W, H, 1).length;
  return { cleanedMask: cleaned, darkBackgroundDetected, darkBackgroundPixelsRemoved, edgeConnectedDarkComponentsRemoved, componentsBefore, componentsAfter };
}

// ── MAIN: extract raw dark stroke paths from the STRICT mask ──────────────────
export function extractRawDarkStrokePaths(imageData, params = {}) {
  const p = { ...RAW_PARAMS, ...params };
  const { width: W, height: H } = imageData;
  const strictMask = createStrictDarkMask(imageData, p);
  const bg = strictMask._darkBackground || { darkBackgroundDetected: false, darkBackgroundPixelsRemoved: 0, edgeConnectedDarkComponentsRemoved: 0, componentsBefore: 0, componentsAfter: 0 };
  const darkPixelsCount = strictMask.reduce((s, v) => s + v, 0);
  const rawDarkPixelsBefore = strictMask._rawDarkPixelsBefore ?? darkPixelsCount;
  const rawDarkPixelsAfter = strictMask._rawDarkPixelsAfter ?? darkPixelsCount;
  const components = connectedComponents(strictMask, W, H, p.minComponentArea);
  let closedMask = strictMask;
  for (let it = 0; it < p.closeGapPx; it++) closedMask = dilate(closedMask, W, H);
  for (let it = 0; it < p.closeGapPx; it++) closedMask = erode(closedMask, W, H);
  const skeleton = thinZhangSuen(closedMask, W, H);
  const { paths, junctionCount } = traceSkeletonGraph(skeleton, W, H, p.minPathLengthPx);
  return { strictMask, closedMask, skeleton, paths, junctionCount, components, darkPixelsCount, rawDarkPixelsBefore, rawDarkPixelsAfter, darkBackground: bg, width: W, height: H };
}

// ── Dark support against the PURE strict mask ─────────────────────────────────
export function pathDarkSupportRatio(path, strictMask, W, H) {
  if (path.length === 0) return 0;
  let supported = 0;
  for (const pt of path) {
    let on = false;
    for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = pt.x + dx, ny = pt.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (strictMask[ny * W + nx]) { on = true; break; }
    }
    if (on) supported++;
  }
  return supported / path.length;
}

// ── ROI border / frame-line detection ─────────────────────────────────────────
function isBorderPath(path, W, H, margin) {
  return path.some(p => p.x < margin || p.y < margin || p.x > W - margin || p.y > H - margin);
}
function pathBbox(path) {
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const pt of path) {
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  return { w: maxX - minX, h: maxY - minY };
}
function isFrameLine(path, W, H, minFrac, thickPx) {
  const b = pathBbox(path);
  if (b.w >= minFrac * W && b.h <= thickPx) return true;
  if (b.h >= minFrac * H && b.w <= thickPx) return true;
  return false;
}

// ── Validate paths against the strict mask (support >= 0.90) ──────────────────
export function validatePaths(paths, strictMask, W, H, params = {}) {
  const p = { ...RAW_PARAMS, ...params };
  const exported = [], rejectedCropBorder = [], rejectedLowSupport = [];
  let supportSum = 0, minSupport = 1;
  for (const path of paths) {
    if (isBorderPath(path, W, H, p.borderMarginPx) || isFrameLine(path, W, H, p.frameLineMinFrac, p.frameLineThicknessPx)) {
      rejectedCropBorder.push(path);
      console.log('[raw-dark-test] rejected ROI border path');
      continue;
    }
    const support = pathDarkSupportRatio(path, strictMask, W, H);
    if (support < p.darkSupportMin) {
      rejectedLowSupport.push(path);
      console.log(`[raw-dark-test] path rejected low strict dark support: ${support.toFixed(2)}`);
      continue;
    }
    console.log(`[raw-dark-test] path accepted strict dark support: ${support.toFixed(2)}`);
    exported.push(path);
    supportSum += support;
    if (support < minSupport) minSupport = support;
  }
  return {
    exported, rejectedCropBorder, rejectedLowSupport,
    rejected: [
      ...rejectedCropBorder.map(path => ({ path, reason: 'crop_border' })),
      ...rejectedLowSupport.map(path => ({ path, reason: 'low_strict_dark_support' })),
    ],
    averagePathDarkSupport: exported.length ? supportSum / exported.length : 0,
    minPathDarkSupport: exported.length ? minSupport : 0,
  };
}

// ── Lower zone split: clip paths into lower subsegments ──────────────────────
// Walks each path point-by-point, keeps only subsegments in the lower/foot zone,
// cuts when leaving the zone. Never decides by centroid, never creates/closes.
function isInLowerZone(pt, W, H, p) {
  const ny = pt.y / H, nx = pt.x / W;
  if (ny <= p.lowerZoneY) return false;
  if (ny > 0.45 && ny < 0.62 && nx > 0.30 && nx < 0.70) return false; // exclude mouth
  return true;
}

export function splitPathsByLowerZone(paths, W, H, params = {}) {
  const p = { ...RAW_PARAMS, ...params };
  const out = [];
  for (const path of paths) {
    let seg = [];
    for (const pt of path) {
      if (isInLowerZone(pt, W, H, p)) {
        seg.push(pt);
      } else {
        if (seg.length >= p.minSubpathLen) out.push(seg);
        seg = [];
      }
    }
    if (seg.length >= p.minSubpathLen) out.push(seg);
  }
  return out;
}

export function classifyLowerSubpath(path, W, H, params = {}) {
  const p = { ...RAW_PARAMS, ...params };
  let cx = 0, cy = 0;
  for (const pt of path) { cx += pt.x; cy += pt.y; }
  cx /= path.length; cy /= path.length;
  const nx = cx / W, ny = cy / H;
  const reachesFoot = path.some(pt => pt.y > p.footZoneY * H);
  if (reachesFoot || ny > p.footZoneY) {
    if (nx < 0.48) return 'left_foot';
    if (nx > 0.52) return 'right_foot';
  }
  return 'lower_body';
}

// ── Analyze strict mask ────────────────────────────────────────────────────────
export function analyzeStrictMask(mask, W, H) {
  let mouthPixels = 0, eyePixels = 0, lowerPixels = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    const nx = x / W, ny = y / H;
    if (ny > 0.45 && ny < 0.62 && nx > 0.30 && nx < 0.70) mouthPixels++;
    if (ny > 0.28 && ny < 0.45 && (nx < 0.45 || nx > 0.55)) eyePixels++;
    if (ny > 0.55) lowerPixels++;
  }
  return {
    hasMouth: mouthPixels > 3,
    hasEyes: eyePixels > 3,
    hasLowerContour: lowerPixels > 5,
    hasPinkBoundary: false,
    mouthPixels, eyePixels, lowerPixels,
  };
}

// ── Build simple triple-run commands ──────────────────────────────────────────
export function buildRawLowerCommands(paths, W, H, widthMm, heightMm) {
  const cmds = [];
  let pathIdx = 0;
  for (const path of paths) {
    const mm = path.map(pt => [(pt.x / W - 0.5) * widthMm, (pt.y / H - 0.5) * heightMm]);
    const triple = [...mm, ...[...mm].reverse(), ...mm];
    if (triple.length < 2) continue;
    if (cmds.length > 0) cmds.push({ type: 'trim' });
    const rid = `raw_lower_${pathIdx++}`;
    cmds.push({ type: 'jump', x: triple[0][0], y: triple[0][1], color: '#1a1a1a', layerType: 'raw_dark_test', regionId: rid });
    for (let i = 1; i < triple.length; i++) {
      cmds.push({ type: 'stitch', x: triple[i][0], y: triple[i][1], color: '#1a1a1a', layerType: 'raw_dark_test', stitchType: 'running_stitch', regionId: rid });
    }
  }
  return cmds;
}

// ── CONSOLIDATION: merge micro-paths into few semantic contours ───────────────
// Converts the many raw exported micro-paths into a few consolidated contours:
//   body_lower_outline, left_foot_outer_outline, right_foot_outer_outline,
//   optional side_outline.
// Chains micro-segments within each zone only when: endpoint distance < 6px,
// tangent < 35deg, and the connecting gap has strict-mask dark support (no
// inventing lines across pink fills). Never auto-closes, never invents.
const CONSOLIDATE_GAP_PX = 6;
const CONSOLIDATE_ANGLE_DEG = 35;

function distPix(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function tangentOkPix(a, b) {
  if (a.length < 2 || b.length < 2) return true;
  const aEnd = a[a.length - 1], aPrev = a[a.length - 2];
  const bStart = b[0], bNext = b[1];
  const v1x = aEnd.x - aPrev.x, v1y = aEnd.y - aPrev.y;
  const v2x = bNext.x - bStart.x, v2y = bNext.y - bStart.y;
  const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-6 || l2 < 1e-6) return true;
  const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  return ang < CONSOLIDATE_ANGLE_DEG;
}
function gapHasDarkSupport(a, b, mask, W, H) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return true;
  const steps = Math.max(2, Math.ceil(len));
  let hits = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    let on = false;
    for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = Math.round(x) + dx, ny = Math.round(y) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (mask[ny * W + nx]) { on = true; break; }
    }
    if (on) hits++;
  }
  return hits / steps >= 0.5;
}
function splitPathBySubZone(path, W, H) {
  const footY = 0.72 * H;
  const segs = []; let cur = []; let lastAbove = null;
  for (const pt of path) {
    const above = pt.y <= footY;
    if (cur.length === 0 || above === lastAbove) cur.push(pt);
    else { if (cur.length >= 3) segs.push(cur); cur = [pt]; }
    lastAbove = above;
  }
  if (cur.length >= 3) segs.push(cur);
  return segs.length > 0 ? segs : [path];
}
function classifySubZone(path, W, H) {
  let cx = 0, cy = 0;
  for (const pt of path) { cx += pt.x; cy += pt.y; }
  cx /= path.length; cy /= path.length;
  const nx = cx / W, ny = cy / H;
  const reachesFoot = path.some(pt => pt.y > 0.72 * H);
  if (reachesFoot || ny > 0.72) return nx < 0.5 ? 'left_foot_outer_outline' : 'right_foot_outer_outline';
  if (ny > 0.50 && ny < 0.78) return (nx < 0.20 || nx > 0.80) ? 'side_outline' : 'body_lower_outline';
  return null;
}
function chainSegments(segments, mask, W, H) {
  const used = new Array(segments.length).fill(false);
  const chains = [];
  const order = segments.map((_, i) => i).sort((a, b) => segments[b].length - segments[a].length);
  for (const seedIdx of order) {
    if (used[seedIdx]) continue;
    used[seedIdx] = true;
    const chain = [...segments[seedIdx]];
    let changed = true;
    while (changed) {
      changed = false;
      const end = chain[chain.length - 1];
      let bestJ = -1, bestRev = false;
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue;
        const sp = segments[j];
        if (distPix(end, sp[0]) < CONSOLIDATE_GAP_PX && tangentOkPix(chain, sp) && gapHasDarkSupport(end, sp[0], mask, W, H)) { bestJ = j; bestRev = false; break; }
        if (distPix(end, sp[sp.length - 1]) < CONSOLIDATE_GAP_PX && tangentOkPix(chain, [...sp].reverse()) && gapHasDarkSupport(end, sp[sp.length - 1], mask, W, H)) { bestJ = j; bestRev = true; break; }
      }
      if (bestJ >= 0) {
        chain.push(...(bestRev ? [...segments[bestJ]].reverse() : segments[bestJ]));
        used[bestJ] = true; changed = true;
      }
    }
    chains.push(chain);
  }
  return chains;
}

export function consolidateLowerOutlinePaths(exportedPaths, strictMask, W, H, params = {}) {
  const p = { ...RAW_PARAMS, ...params };
  const ZONES = ['body_lower_outline', 'left_foot_outer_outline', 'right_foot_outer_outline', 'side_outline'];
  const buckets = { body_lower_outline: [], left_foot_outer_outline: [], right_foot_outer_outline: [], side_outline: [] };
  for (const path of exportedPaths) {
    if (!path || path.length < 3) continue;
    for (const sp of splitPathBySubZone(path, W, H)) {
      if (sp.length < 3) continue;
      const zone = classifySubZone(sp, W, H);
      if (zone) buckets[zone].push(sp);
    }
  }
  const consolidated = [], rejected = [];
  for (const zone of ZONES) {
    if (buckets[zone].length === 0) continue;
    const chains = chainSegments(buckets[zone], strictMask, W, H);
    for (const ch of chains) {
      if (ch.length < p.minSubpathLen) { rejected.push({ path: ch, zone, reason: 'too_short' }); continue; }
      consolidated.push({ path: ch, zone });
    }
  }
  const failReason = consolidated.length > 12 ? 'too many fragmented lower outline paths' : null;
  console.log(`[raw-dark-test] consolidated lower outline paths: ${consolidated.length}`);
  console.log(`[raw-dark-test] body_lower_outline: ${consolidated.filter(c => c.zone === 'body_lower_outline').length}`);
  console.log(`[raw-dark-test] left_foot_outer_outline: ${consolidated.filter(c => c.zone === 'left_foot_outer_outline').length}`);
  console.log(`[raw-dark-test] right_foot_outer_outline: ${consolidated.filter(c => c.zone === 'right_foot_outer_outline').length}`);
  if (failReason) console.log(`[raw-dark-test] FAIL: ${failReason}`);
  return { consolidated, rejected, failReason };
}

// ── Load original upload bitmap ────────────────────────────────────────────────
function loadOriginalBitmap(imageUrl, maxW) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const W = Math.max(1, Math.round(img.naturalWidth * scale));
      const H = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      resolve({ imageData: ctx.getImageData(0, 0, W, H), naturalW: img.naturalWidth, naturalH: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('No se pudo cargar el bitmap original'));
    img.src = imageUrl;
  });
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
export async function runRawDarkStrokeTest(imageUrl, config = {}) {
  if (!imageUrl) {
    const err = 'RAW DARK TEST INVALID: original bitmap missing';
    console.log(`[raw-dark-test] ${err}`);
    throw new Error(err);
  }
  const widthMm = config.width_mm || 100;
  const heightMm = config.height_mm || 100;

  console.log('[dark-mask-source] usingOriginalUploadBitmap: true');
  console.log('[dark-mask-source] usingProcessedPreview: false');
  console.log('[dark-mask-source] usingVectorizedRegions: false');

  const { imageData, naturalW, naturalH } = await loadOriginalBitmap(imageUrl, RAW_PARAMS.maxProcessWidth);
  const { strictMask, closedMask, skeleton, paths: rawPaths, junctionCount, components, darkPixelsCount, rawDarkPixelsBefore, rawDarkPixelsAfter, darkBackground, width: W, height: H } =
    extractRawDarkStrokePaths(imageData, RAW_PARAMS);

  const maskAnalysis = analyzeStrictMask(strictMask, W, H);

  const rawPathsBeforeFilter = rawPaths.length;
  const zonePaths = splitPathsByLowerZone(rawPaths, W, H);
  const rawPathsAfterFilter = zonePaths.length;
  const subpathClasses = zonePaths.map(p => classifyLowerSubpath(p, W, H));
  const lowerRawSubpaths = subpathClasses.filter(c => c === 'lower_body').length;
  const leftFootRawSubpaths = subpathClasses.filter(c => c === 'left_foot').length;
  const rightFootRawSubpaths = subpathClasses.filter(c => c === 'right_foot').length;

  const validation = validatePaths(zonePaths, strictMask, W, H, RAW_PARAMS);
  const exportedPaths = validation.exported;
  const consolidation = consolidateLowerOutlinePaths(exportedPaths, strictMask, W, H, RAW_PARAMS);
  const consolidatedLowerOutlinePaths = consolidation.consolidated;
  const commands = buildRawLowerCommands(consolidatedLowerOutlinePaths.map(c => c.path), W, H, widthMm, heightMm);

  const longestPath = rawPaths.reduce((m, p) => p.length > m ? p.length : m, 0);
  const lowerComponents = components.filter(c => (c.bbox.minY + c.bbox.maxY) / 2 > 0.55 * H).length;

  const diagnostics = {
    darkPixelsCount,
    rawDarkPixelsBefore,
    rawDarkPixelsAfter,
    darkBackgroundDetected: darkBackground?.darkBackgroundDetected ?? false,
    darkBackgroundPixelsRemoved: darkBackground?.darkBackgroundPixelsRemoved ?? 0,
    edgeConnectedDarkComponentsRemoved: darkBackground?.edgeConnectedDarkComponentsRemoved ?? 0,
    darkComponentsBefore: darkBackground?.componentsBefore ?? components.length,
    darkComponentsAfter: darkBackground?.componentsAfter ?? components.length,
    componentsCount: components.length,
    lowerComponentsCount: consolidatedLowerOutlinePaths.length,
    consolidatedLowerPaths: consolidatedLowerOutlinePaths.length,
    bodyLowerDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'body_lower_outline'),
    leftFootDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'left_foot_outer_outline'),
    rightFootDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'right_foot_outer_outline'),
    footCoverageLeft: consolidatedLowerOutlinePaths.some(c => c.zone === 'left_foot_outer_outline') ? 100 : 0,
    footCoverageRight: consolidatedLowerOutlinePaths.some(c => c.zone === 'right_foot_outer_outline') ? 100 : 0,
    bodyLowerCoverage: consolidatedLowerOutlinePaths.some(c => c.zone === 'body_lower_outline') ? 100 : 0,
    consolidationFailReason: consolidation.failReason,
    rawPathsBeforeFilter,
    rawPathsAfterFilter,
    splitPathCount: rawPathsAfterFilter,
    skeletonJunctionCount: junctionCount,
    lowerRawSubpaths,
    leftFootRawSubpaths,
    rightFootRawSubpaths,
    exportedPaths: exportedPaths.length,
    rejectedCropBorderPaths: validation.rejectedCropBorder.length,
    rejectedLowDarkSupportPaths: validation.rejectedLowSupport.length,
    averagePathDarkSupport: validation.averagePathDarkSupport,
    minPathDarkSupport: validation.minPathDarkSupport,
    hasMouth: maskAnalysis.hasMouth,
    hasEyes: maskAnalysis.hasEyes,
    hasLowerContour: maskAnalysis.hasLowerContour,
    hasPinkBoundary: maskAnalysis.hasPinkBoundary,
    mouthPixels: maskAnalysis.mouthPixels,
    eyePixels: maskAnalysis.eyePixels,
    lowerPixels: maskAnalysis.lowerPixels,
    lowerOutlineMissing: !maskAnalysis.hasLowerContour,
    ovalBoundaryUsed: false,
    largestComponentOnly: false,
    discardedLargestOnlyBug: false,
    bodyClipApplied: false,
    usedFinalEmbroideryCommands: false,
    usedRegionBoundaries: false,
    usedCachedContours: false,
    coordinateTransform: `mm = (px/${W} - 0.5) * ${widthMm}`,
    scale: `${(widthMm / W).toFixed(3)} mm/px`,
    processDims: `${W}x${H}`,
    naturalDims: `${naturalW}x${naturalH}`,
    longestPath,
  };

  console.log('[raw-dark-test] source originalImage=true');
  console.log('[raw-dark-test] source darkStrokeMask=true');
  console.log('[raw-dark-test] source finalEmbroideryCommands=false');
  console.log('[raw-dark-test] source regionBoundaries=false');
  console.log('[raw-dark-test] source cachedContours=false');
  console.log(`[raw-dark-test] dark pixels count: ${darkPixelsCount}`);
  console.log(`[raw-dark-test] components count: ${components.length}`);
  console.log(`[raw-dark-test] lower components count: ${lowerComponents}`);
  console.log(`[raw-dark-test] skeleton junction count: ${junctionCount}`);
  console.log(`[raw-dark-test] raw paths before filter: ${rawPathsBeforeFilter}`);
  console.log(`[raw-dark-test] split path count (after zone split): ${rawPathsAfterFilter}`);
  console.log(`[raw-dark-test] lower body raw subpaths: ${lowerRawSubpaths}`);
  console.log(`[raw-dark-test] left foot raw subpaths: ${leftFootRawSubpaths}`);
  console.log(`[raw-dark-test] right foot raw subpaths: ${rightFootRawSubpaths}`);
  console.log(`[raw-dark-test] rejected ROI border paths: ${validation.rejectedCropBorder.length}`);
  console.log(`[raw-dark-test] rejected low strict dark support paths: ${validation.rejectedLowSupport.length}`);
  console.log(`[raw-dark-test] exported paths with dark support: ${exportedPaths.length}`);
  console.log(`[raw-dark-test] average path dark support: ${validation.averagePathDarkSupport.toFixed(3)}`);
  console.log(`[raw-dark-test] min path dark support: ${validation.minPathDarkSupport.toFixed(3)}`);
  console.log(`[raw-dark-test] oval boundary used: false`);
  console.log(`[raw-dark-test] largest component only: false`);
  console.log(`[raw-dark-test] strict mask has mouth: ${maskAnalysis.hasMouth}`);
  console.log(`[raw-dark-test] strict mask has eyes: ${maskAnalysis.hasEyes}`);
  console.log(`[raw-dark-test] strict mask has lower contour: ${maskAnalysis.hasLowerContour}`);
  console.log(`[raw-dark-test] strict mask has pink boundary: ${maskAnalysis.hasPinkBoundary}`);
  if (!maskAnalysis.hasLowerContour) console.log('[raw-dark-test] lower outline missing in strict dark mask');

  return {
    originalData: imageData,
    strictMask, closedMask, skeleton,
    rawPaths, zonePaths,
    exportedPaths,
    consolidatedLowerOutlinePaths,
    consolidationRejected: consolidation.rejected,
    rejected: validation.rejected,
    commands,
    diagnostics,
    width: W, height: H,
  };
}

// ── Zone candidates (mouth/eye bboxes) from the strict mask ───────────────────
function computeZoneCandidates(mask, W, H) {
  let mMinX = W, mMinY = H, mMaxX = 0, mMaxY = 0, mCount = 0, mSumX = 0, mSumY = 0;
  const eyeSides = {
    left: { minX: W, minY: H, maxX: 0, maxY: 0, count: 0, sumX: 0, sumY: 0 },
    right: { minX: W, minY: H, maxX: 0, maxY: 0, count: 0, sumX: 0, sumY: 0 },
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    const nx = x / W, ny = y / H;
    if (ny > 0.42 && ny < 0.62 && nx > 0.30 && nx < 0.70) {
      mCount++; mSumX += x; mSumY += y;
      if (x < mMinX) mMinX = x; if (x > mMaxX) mMaxX = x;
      if (y < mMinY) mMinY = y; if (y > mMaxY) mMaxY = y;
    }
    if (ny > 0.20 && ny < 0.45) {
      const side = nx < 0.5 ? eyeSides.left : eyeSides.right;
      side.count++; side.sumX += x; side.sumY += y;
      if (x < side.minX) side.minX = x; if (x > side.maxX) side.maxX = x;
      if (y < side.minY) side.minY = y; if (y > side.maxY) side.maxY = y;
    }
  }
  const mouthCandidate = mCount > 0 ? {
    centroid: { x: (mSumX / mCount) / W, y: (mSumY / mCount) / H },
    area: mCount,
    bbox: { minX: mMinX / W, maxX: mMaxX / W, minY: mMinY / H, maxY: mMaxY / H },
  } : null;
  const eyeCandidates = [];
  for (const c of [eyeSides.left, eyeSides.right]) {
    if (c.count > 0) {
      eyeCandidates.push({
        centroid: { x: (c.sumX / c.count) / W, y: (c.sumY / c.count) / H },
        area: c.count,
        bbox: { minX: c.minX / W, maxX: c.maxX / W, minY: c.minY / H, maxY: c.maxY / H },
      });
    }
  }
  return { mouthCandidate, eyeCandidates };
}

// ── PRODUCTION ADAPTER ─────────────────────────────────────────────────────────
// Reuses the SAME logic as the isolated RAW test (createStrictDarkMask +
// extractRawDarkStrokePaths + splitPathsByLowerZone + validatePaths) and returns
// an object compatible with config.darkStroke so the production contour pipeline
// (contourExportBuilder → segmentClassifier → lowerContourRebuilder) consumes
// the strict mask + exportedPaths directly.
export async function buildStrictDarkStrokeContextFromOriginalImage(imageUrl, config = {}) {
  if (!imageUrl) return null;

  console.log('[dark-mask-source] production using strict raw original bitmap: true');

  const { imageData, naturalW, naturalH } = await loadOriginalBitmap(imageUrl, RAW_PARAMS.maxProcessWidth);
  const { strictMask, closedMask, skeleton, paths: rawPaths, junctionCount, components, darkPixelsCount, rawDarkPixelsBefore, rawDarkPixelsAfter, darkBackground, width: W, height: H } =
    extractRawDarkStrokePaths(imageData, RAW_PARAMS);

  const maskAnalysis = analyzeStrictMask(strictMask, W, H);
  const zonePaths = splitPathsByLowerZone(rawPaths, W, H);
  const validation = validatePaths(zonePaths, strictMask, W, H, RAW_PARAMS);
  const exportedPaths = validation.exported;
  const consolidation = consolidateLowerOutlinePaths(exportedPaths, strictMask, W, H, RAW_PARAMS);
  const consolidatedLowerOutlinePaths = consolidation.consolidated;
  const { mouthCandidate, eyeCandidates } = computeZoneCandidates(strictMask, W, H);

  const outerOverlap = components.length > 0
    ? components.filter(c => c.bbox.minX <= 2 || c.bbox.maxX >= W - 3 || c.bbox.minY <= 2 || c.bbox.maxY >= H - 3).length / components.length
    : 0;
  const confidence = Math.min(100, Math.round(
    (components.length > 0 ? 40 : 0) +
    (mouthCandidate ? 25 : 0) +
    (eyeCandidates.length > 0 ? 20 : 0) +
    Math.min(15, outerOverlap * 15)
  ));

  console.log('[dark-mask-source] config.darkStroke exists: true');
  console.log(`[dark-mask-source] exportedPaths: ${exportedPaths.length}`);
  console.log(`[dark-mask-source] hasLowerContour: ${maskAnalysis.hasLowerContour ? 'YES' : 'NO'}`);
  console.log(`[dark-mask-source] hasMouth: ${maskAnalysis.hasMouth ? 'YES' : 'NO'}`);
  console.log(`[dark-mask-source] hasEyes: ${maskAnalysis.hasEyes ? 'YES' : 'NO'}`);

  return {
    mask: strictMask,
    strictMask,
    closedMask,
    skeleton: components.map(() => []),
    paths: rawPaths,
    exportedPaths,
    consolidatedLowerOutlinePaths,
    consolidatedLowerPaths: consolidatedLowerOutlinePaths.length,
    bodyLowerDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'body_lower_outline'),
    leftFootDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'left_foot_outer_outline'),
    rightFootDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'right_foot_outer_outline'),
    footCoverageLeft: consolidatedLowerOutlinePaths.some(c => c.zone === 'left_foot_outer_outline') ? 100 : 0,
    footCoverageRight: consolidatedLowerOutlinePaths.some(c => c.zone === 'right_foot_outer_outline') ? 100 : 0,
    bodyLowerCoverage: consolidatedLowerOutlinePaths.some(c => c.zone === 'body_lower_outline') ? 100 : 0,
    consolidationFailReason: consolidation.failReason,
    components,
    confidence,
    width: W,
    height: H,
    mouthCandidate,
    eyeCandidates,
    outerOverlap,
    hasMouth: maskAnalysis.hasMouth,
    hasEyes: maskAnalysis.hasEyes,
    hasLowerContour: maskAnalysis.hasLowerContour,
    hasPinkBoundary: false,
    averagePathDarkSupport: validation.averagePathDarkSupport,
    minPathDarkSupport: validation.minPathDarkSupport,
    skeletonJunctionCount: junctionCount,
    source: 'strict_raw_original_bitmap',
    options: { strokeTolerancePx: 2 },
    darkPixelsCount,
    rawDarkPixelsBefore,
    rawDarkPixelsAfter,
    darkComponentsBefore: darkBackground?.componentsBefore ?? components.length,
    darkComponentsAfter: darkBackground?.componentsAfter ?? components.length,
    naturalDims: `${naturalW}x${naturalH}`,
    sourceUrl: imageUrl,
    darkStrokeSource: 'original_upload_bitmap',
    isUsingMaskedForDarkStroke: false,
    usingMaskedImageForDarkStroke: false,
    darkBackground,
    darkBackgroundDetected: darkBackground?.darkBackgroundDetected ?? false,
    darkBackgroundPixelsRemoved: darkBackground?.darkBackgroundPixelsRemoved ?? 0,
    edgeConnectedDarkComponentsRemoved: darkBackground?.edgeConnectedDarkComponentsRemoved ?? 0,
  };
}