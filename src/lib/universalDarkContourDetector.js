/**
 * universalDarkContourDetector.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * UNIVERSAL real-black-line contour detector for ANY design.
 *
 * No character/feet/lower-specific heuristics. Contours come ONLY from the
 * strict dark mask — never from color/fill boundaries, never invented.
 *
 * Pipeline:
 *   1. strict dark mask (already in darkStroke.strictMask)
 *   2. skeleton graph (already in darkStroke.paths / components)
 *   3. assign graph paths to connected components
 *   4. classify each component by GEOMETRY (not names):
 *        outer_outline      — large closed ring enclosing significant area
 *        inner_outline      — smaller closed dark line inside the design
 *        detail_open_curve  — open dark curve (mouth, brows, expressive lines)
 *        rejected_noise     — too small / isolated fragment
 *        fill_boundary_rejected — color boundary without dark pixel (never here)
 *   5. consolidate compatible subpaths within each real component
 *   6. export per-class stitch type; jump/trim between separate components
 *
 * Public API:
 *   buildUniversalDarkContoursFromContext(darkStroke, config) → { contours, report }
 *   consolidateDarkContourGraph(componentPaths, mask, W, H) → chains[]
 *   getLastUniversalReport()
 */

import { cleanCartoonOutlineCE01 } from './contourPreset.js';

let _lastReport = null;
export function getLastUniversalReport() { return _lastReport; }

// ── Classification thresholds (geometry-only, design-agnostic) ────────────────
const NOISE_AREA_REL = 0.0008;     // < 0.08% of image area → noise candidate
const NOISE_LEN_PX = 18;           // < 18px skeleton length → noise candidate
const OUTER_BBOX_COVERAGE_MIN = 0.12;  // closed + bbox ≥ 12% of image → outer
const CLOSURE_GAP_FRAC = 0.15;     // endpoints gap < 15% of path length → closed
const CLOSURE_GAP_PX = 8;
const CHAIN_GAP_PX = 6;
const CHAIN_ANGLE_DEG = 35;
const MIN_CONTOUR_POINTS = 4;
const MAX_SAFE_SEGMENT_PX = 6;

// ── pixel-space geometry helpers ──────────────────────────────────────────────
function distPx(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function pathLengthPx(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += distPx(path[i - 1], path[i]);
  return L;
}
function tangentOkPix(a, b) {
  if (a.length < 2 || b.length < 2) return true;
  const aEnd = a[a.length - 1], aPrev = a[a.length - 2];
  const bStart = b[0], bNext = b[1];
  const v1x = aEnd.x - aPrev.x, v1y = aEnd.y - aPrev.y;
  const v2x = bNext.x - bStart.x, v2y = bNext.y - bStart.y;
  const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-6 || l2 < 1e-6) return true;
  const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI < CHAIN_ANGLE_DEG;
}
function gapHasDarkSupport(a, b, mask, W, H) {
  const len = distPx(a, b);
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

// ── CONSOLIDATE: chain compatible subpaths within one real component ──────────
// Merges micro-segments only when: endpoint distance < 6px, tangent < 35°, and
// the connecting gap has strict-mask dark support. No diagonals, no auto-close,
// no invented geometry. Separate components stay separate.
export function consolidateDarkContourGraph(componentPaths, mask, W, H) {
  const used = new Array(componentPaths.length).fill(false);
  const chains = [];
  const order = componentPaths.map((_, i) => i)
    .sort((a, b) => pathLengthPx(componentPaths[b]) - pathLengthPx(componentPaths[a]));
  for (const seed of order) {
    if (used[seed]) continue;
    used[seed] = true;
    const chain = [...componentPaths[seed]];
    let changed = true;
    while (changed) {
      changed = false;
      const end = chain[chain.length - 1];
      for (let j = 0; j < componentPaths.length; j++) {
        if (used[j]) continue;
        const sp = componentPaths[j];
        if (distPx(end, sp[0]) < CHAIN_GAP_PX && tangentOkPix(chain, sp) && gapHasDarkSupport(end, sp[0], mask, W, H)) {
          chain.push(...sp); used[j] = true; changed = true; break;
        }
        if (distPx(end, sp[sp.length - 1]) < CHAIN_GAP_PX && tangentOkPix(chain, [...sp].reverse()) && gapHasDarkSupport(end, sp[sp.length - 1], mask, W, H)) {
          chain.push(...[...sp].reverse()); used[j] = true; changed = true; break;
        }
      }
    }
    chains.push(chain);
  }
  return chains;
}

// ── bbox w/h helper — components from rawDarkStrokeTest carry minX/minY/maxX/maxY
//    but no w/h; without this bboxCov became NaN and nothing classified as outer.
function getBboxWH(bbox) {
  if (!bbox) return { w: 0, h: 0 };
  const w = bbox.w ?? (bbox.maxX - bbox.minX + 1);
  const h = bbox.h ?? (bbox.maxY - bbox.minY + 1);
  return { w, h };
}

// ── CLASSIFY a component by geometry (no names, no character heuristics) ──────
function classifyComponent(comp, subpaths, W, H) {
  const totalLen = subpaths.reduce((s, p) => s + pathLengthPx(p), 0);
  const { w: bw, h: bh } = getBboxWH(comp.bbox);
  const bboxCov = (bw * bh) / (W * H);
  const area = comp.area || 0;

  if (area < NOISE_AREA_REL * W * H && totalLen < NOISE_LEN_PX) {
    return 'rejected_noise';
  }

  // closure on longest subpath
  const longest = subpaths.reduce((b, p) => pathLengthPx(p) > pathLengthPx(b) ? p : b, subpaths[0] || []);
  let closed = false;
  if (longest.length >= 3) {
    const gap = distPx(longest[0], longest[longest.length - 1]);
    const L = pathLengthPx(longest);
    closed = (gap < CLOSURE_GAP_FRAC * L) || (gap < CLOSURE_GAP_PX);
  }

  // BUG 2: a large closed ring fragmented into many micro-segments never shows
  // a closed longest subpath. Use aggregate geometry: if the component's bbox
  // coverage is large and total skeleton length is high, treat it as closed.
  if (!closed && bboxCov >= OUTER_BBOX_COVERAGE_MIN && totalLen > 80) {
    closed = true;
  }

  if (!closed) {
    if (totalLen < NOISE_LEN_PX) return 'rejected_noise';
    return 'detail_open_curve';
  }
  return bboxCov >= OUTER_BBOX_COVERAGE_MIN ? 'outer_outline' : 'inner_outline';
}

// ── CONSOLIDATE CLOSED OUTER COMPONENT ───────────────────────────────────────
// For components classified as outer_outline, chain ALL subpaths with relaxed
// tolerances (larger gap, tangent optional for tiny gaps) plus a chain-merge
// pass, so a fragmented ring reconstructs as few contours instead of dozens of
// micro-chains. Only connects across gaps with strict-mask dark support — no
// convex hull, bbox, oval, or invented diagonals.
function consolidateClosedOuterComponent(componentPaths, mask, W, H) {
  const used = new Array(componentPaths.length).fill(false);
  const chains = [];
  const order = componentPaths.map((_, i) => i)
    .sort((a, b) => pathLengthPx(componentPaths[b]) - pathLengthPx(componentPaths[a]));
  const GAP = 14;
  for (const seed of order) {
    if (used[seed]) continue;
    used[seed] = true;
    const chain = [...componentPaths[seed]];
    let changed = true;
    while (changed) {
      changed = false;
      const end = chain[chain.length - 1];
      let bestJ = -1, bestRev = false, bestD = Infinity;
      for (let j = 0; j < componentPaths.length; j++) {
        if (used[j]) continue;
        const sp = componentPaths[j];
        for (const rev of [false, true]) {
          const cand = rev ? sp[sp.length - 1] : sp[0];
          const d = distPx(end, cand);
          if (d >= GAP || d >= bestD) continue;
          if (!gapHasDarkSupport(end, cand, mask, W, H)) continue;
          const tangentOk = (d < 3) || tangentOkPix(chain, rev ? [...sp].reverse() : sp);
          if (!tangentOk) continue;
          bestJ = j; bestRev = rev; bestD = d;
        }
      }
      if (bestJ >= 0) {
        const sp = componentPaths[bestJ];
        chain.push(...(bestRev ? [...sp].reverse() : sp));
        used[bestJ] = true; changed = true;
      }
    }
    chains.push(chain);
  }
  // Merge resulting chains among themselves (end-to-start) when close + supported.
  let merged = chains;
  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    const out = [];
    const usedM = new Array(merged.length).fill(false);
    for (let i = 0; i < merged.length; i++) {
      if (usedM[i]) continue;
      usedM[i] = true;
      const ch = [...merged[i]];
      let changed = true;
      while (changed) {
        changed = false;
        const end = ch[ch.length - 1];
        for (let j = 0; j < merged.length; j++) {
          if (usedM[j] || i === j) continue;
          const other = merged[j];
          let mergedJ = false;
          for (const rev of [false, true]) {
            const cand = rev ? other[other.length - 1] : other[0];
            const d = distPx(end, cand);
            if (d < GAP && gapHasDarkSupport(end, cand, mask, W, H) &&
                (d < 3 || tangentOkPix(ch, rev ? [...other].reverse() : other))) {
              ch.push(...(rev ? [...other].reverse() : other));
              usedM[j] = true; mergedJ = true; break;
            }
          }
          if (mergedJ) { changed = true; break; }
        }
      }
      out.push(ch);
    }
    if (out.length < merged.length) { merged = out; didMerge = true; }
  }
  return merged;
}

// ── SPLIT / DENSIFY unsafe long segments ──────────────────────────────────────
// Walks consecutive points of a chain. A segment > MAX_SAFE_SEGMENT_PX is:
//   - DENSIFIED if the straight gap has strict-mask support (insert intermediate
//     points every ~2.5px, each verified against the mask) — this follows the
//     real black line, so it is NOT artificial geometry.
//   - CUT if unsupported — never bridged with a straight line, never closed.
// Returns { chains, split, densified }.
function splitOrDensifyUnsafeSegments(chain, mask, W, H) {
  if (chain.length < 2) return { chains: [chain], split: 0, densified: 0 };
  const out = [];
  let cur = [chain[0]];
  let split = 0, densified = 0;
  const pointSupported = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = Math.round(x) + dx, ny = Math.round(y) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (mask[ny * W + nx]) return true;
    }
    return false;
  };
  for (let i = 1; i < chain.length; i++) {
    const a = cur[cur.length - 1];
    const b = chain[i];
    const d = distPx(a, b);
    if (d <= MAX_SAFE_SEGMENT_PX) { cur.push(b); continue; }
    // long segment: densify only if the whole gap follows the real dark line
    if (gapHasDarkSupport(a, b, mask, W, H)) {
      const steps = Math.max(1, Math.ceil(d / 2.5));
      const inserts = [];
      let denseOk = true;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        if (!pointSupported(x, y)) { denseOk = false; break; }
        inserts.push({ x, y });
      }
      if (denseOk) { cur.push(...inserts, b); densified++; continue; }
    }
    // unsupported long gap → cut the chain, never bridge
    if (cur.length >= MIN_CONTOUR_POINTS) out.push(cur);
    cur = [b];
    split++;
  }
  if (cur.length >= MIN_CONTOUR_POINTS) out.push(cur);
  return { chains: out, split, densified };
}

// ── COVERAGE: dark mask pixels covered by exported contours ───────────────────
function computeCoverage(contours, mask, W, H) {
  const total = mask ? mask.reduce((s, v) => s + v, 0) : 0;
  if (total === 0) return { darkContourCoverage: 0, outerCoverage: 0, innerCoverage: 0, detailCoverage: 0 };
  const covered = new Uint8Array(W * H);
  const byClass = {
    outer_outline: new Uint8Array(W * H),
    inner_outline: new Uint8Array(W * H),
    detail_open_curve: new Uint8Array(W * H),
  };
  const mark = (arr, path) => {
    if (!path) return;
    for (const pt of path) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = Math.round(pt.x) + dx, ny = Math.round(pt.y) + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (mask[ny * W + nx]) arr[ny * W + nx] = 1;
      }
    }
  };
  for (const c of contours) {
    if (byClass[c.universalClass]) mark(byClass[c.universalClass], c._pixelPath);
    mark(covered, c._pixelPath);
  }
  let cov = 0, o = 0, i = 0, d = 0;
  for (let k = 0; k < W * H; k++) {
    if (covered[k]) cov++;
    if (byClass.outer_outline[k]) o++;
    if (byClass.inner_outline[k]) i++;
    if (byClass.detail_open_curve[k]) d++;
  }
  return {
    darkContourCoverage: Math.round((cov / total) * 100),
    outerCoverage: Math.round((o / total) * 100),
    innerCoverage: Math.round((i / total) * 100),
    detailCoverage: Math.round((d / total) * 100),
  };
}

// ── MAIN: build universal contours from a darkStroke context ──────────────────
export function buildUniversalDarkContoursFromContext(darkStroke, config = {}) {
  const W = darkStroke.width, H = darkStroke.height;
  const mask = darkStroke.strictMask || darkStroke.mask;
  const components = darkStroke.components || [];
  const allPaths = darkStroke.paths || [];
  const widthMm = config.width_mm || 100;
  const heightMm = config.height_mm || 100;
  const preset = config.preset || cleanCartoonOutlineCE01;

  // Assign each graph path to its connected component by centroid-in-bbox
  const compPaths = components.map(() => []);
  for (const path of allPaths) {
    if (path.length < 2) continue;
    let cx = 0, cy = 0;
    for (const pt of path) { cx += pt.x; cy += pt.y; }
    cx /= path.length; cy /= path.length;
    let best = -1;
    for (let i = 0; i < components.length; i++) {
      const b = components[i].bbox;
      if (cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY) { best = i; break; }
    }
    if (best < 0) {
      let bd = Infinity;
      for (let i = 0; i < components.length; i++) {
        const b = components[i].bbox;
        const bx = (b.minX + b.maxX) / 2, by = (b.minY + b.maxY) / 2;
        const dd = (bx - cx) ** 2 + (by - cy) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    if (best >= 0) compPaths[best].push(path);
  }

  const contours = [];
  const counts = { outer_outline: 0, inner_outline: 0, detail_open_curve: 0, rejected_noise: 0, fill_boundary_rejected: 0 };
  let rawSkeletonSegments = 0, mergedCount = 0, rejectedShort = 0, unsafeSegmentsSplit = 0, unsafeSegmentsDensified = 0;

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const subs = compPaths[i];
    if (subs.length === 0) continue;
    rawSkeletonSegments += subs.length;

    const cls = classifyComponent(comp, subs, W, H);
    if (cls === 'rejected_noise') { counts.rejected_noise++; continue; }

    // Consolidate within this real component only. Large closed outer components
    // use relaxed chaining so a fragmented ring reconstructs as few contours
    // instead of dozens of micro-chains.
    const rawChains = (cls === 'outer_outline')
      ? consolidateClosedOuterComponent(subs, mask, W, H)
      : consolidateDarkContourGraph(subs, mask, W, H);
    mergedCount += subs.length - rawChains.length;

    // Eliminate long straight segments: densify supported gaps along the real
    // dark line, cut unsupported gaps. Never bridge with an artificial diagonal.
    let chains = [];
    for (const chain of rawChains) {
      const { chains: sc, split, densified } = splitOrDensifyUnsafeSegments(chain, mask, W, H);
      unsafeSegmentsSplit += split;
      unsafeSegmentsDensified += densified;
      chains.push(...sc);
    }
    if (cls === 'outer_outline' && chains.length > 12) {
      const kept = chains.sort((a, b) => pathLengthPx(b) - pathLengthPx(a)).slice(0, 12);
      counts.rejected_noise += chains.length - kept.length;
      chains = kept;
    }

    for (const chain of chains) {
      if (chain.length < MIN_CONTOUR_POINTS) { rejectedShort++; continue; }
      const chainCls = (cls === 'detail_open_curve')
        ? ((pathLengthPx(chain) < NOISE_LEN_PX) ? 'rejected_noise' : 'detail_open_curve')
        : cls;
      if (chainCls === 'rejected_noise') { counts.rejected_noise++; continue; }
      counts[chainCls]++;

      // pixel → mm
      const mm = chain.map(pt => [(pt.x / W - 0.5) * widthMm, (pt.y / H - 0.5) * heightMm]);
      const mmDedup = [];
      for (const p of mm) {
        const last = mmDedup[mmDedup.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.08) mmDedup.push([p[0], p[1]]);
      }
      if (mmDedup.length < 3) continue;

      const closed = chainCls !== 'detail_open_curve';
      const isOuter = chainCls === 'outer_outline';
      contours.push({
        id: `universal_${chainCls}_${contours.length}`,
        color: preset.outlineColor,
        name: chainCls,
        stitch_type: isOuter ? 'satin' : 'running_stitch',
        priority: isOuter ? 90 : (chainCls === 'inner_outline' ? 80 : 70),
        layerType: chainCls,
        universalClass: chainCls,
        isContour: true,
        contourWidthMm: isOuter ? preset.outerSatinWidthMm
          : (chainCls === 'inner_outline' ? preset.innerRunWidthMm : preset.eyeRunWidthMm),
        points: mmDedup,
        rawRegion: { closed, componentId: i, region_class: chainCls },
        ce01SafeFillMode: false,
        _pixelPath: chain,
      });
    }
  }

  const coverage = computeCoverage(contours, mask, W, H);
  const report = {
    rawSkeletonSegments,
    connectedDarkComponents: components.length,
    consolidatedContours: contours.length,
    outerOutlineCount: counts.outer_outline,
    innerOutlineCount: counts.inner_outline,
    detailOpenCurveCount: counts.detail_open_curve,
    rejectedNoiseCount: counts.rejected_noise,
    rejectedFillBoundaryCount: counts.fill_boundary_rejected,
    mergedSegments: mergedCount,
    rejectedShortSegments: rejectedShort,
    longStraightSegmentsFixed: unsafeSegmentsSplit + unsafeSegmentsDensified,
    unsafeSegmentsSplit,
    unsafeSegmentsDensified,
    darkContourCoverage: coverage.darkContourCoverage,
    outerCoverage: coverage.outerCoverage,
    innerCoverage: coverage.innerCoverage,
    detailCoverage: coverage.detailCoverage,
    fillBoundaryExported: false,
    artificialGeometryCount: 0,
    ovalBoundaryUsed: false,
    source: 'universal_dark_contour_graph',
    accepted: coverage.darkContourCoverage >= 85 && counts.outer_outline > 0,
  };
  _lastReport = report;

  console.log(`[universal-dark] rawSkeletonSegments: ${rawSkeletonSegments}`);
  console.log(`[universal-dark] connectedDarkComponents: ${components.length}`);
  console.log(`[universal-dark] consolidatedContours: ${contours.length}`);
  console.log(`[universal-dark] outer: ${counts.outer_outline}, inner: ${counts.inner_outline}, detail: ${counts.detail_open_curve}, noise: ${counts.rejected_noise}`);
  console.log(`[universal-dark] coverage: ${coverage.darkContourCoverage}% (outer ${coverage.outerCoverage}%, inner ${coverage.innerCoverage}%, detail ${coverage.detailCoverage}%)`);
  console.log(`[universal-dark] fill boundary exported: false`);
  console.log(`[universal-dark] oval/bbox invented: false`);
  console.log(`[universal-dark] accepted: ${report.accepted}`);

  return { contours, report };
}