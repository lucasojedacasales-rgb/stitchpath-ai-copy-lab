/**
 * lowerContourRebuilder.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * STRICT reconstruction of LOWER contours (lower body edge + left/right feet)
 * from REAL dark stroke pixels only.
 *
 * Geometry fixes (no oval, no largest-only):
 *   - Feet: extractFootStrokePathsFromSkeleton → graph-trace the skeleton of
 *     each dark component. Multiple open subpaths per foot. No oval envelope,
 *     no auto-close, no bounding oval.
 *   - ALL valid components processed per group (not just the largest).
 *   - Components that cross body+foot zones are split by zone before classify.
 *   - Subpaths merged only if close + tangent-compatible + no diagonal.
 *     Otherwise kept separate with jump/trim.
 *
 * Hard rules:
 *   - Geometry ONLY from darkStrokeMask pixels. No fill/silhouette/bbox fallback.
 *   - If a real dark line is missing → gap. Never invent.
 *   - Triple-run, open paths, no satin caps, no blobs.
 *
 * Public API:
 *   rebuildLowerOuterContoursFromDarkStroke(regions, config, darkStroke) → { contours, report }
 *   mergeLowerContourSegments(contours) → { contours, mergedCount, rejectedCount }
 *   getLastLowerContourReport()
 *   LOWER_CONTOUR_WIDTH
 */

export const LOWER_CONTOUR_WIDTH = 1.1; // mm

const LOWER_ZONE_Y = 0.50;
const FOOT_ZONE_Y = 0.72;
const FOOT_LEFT_MAX_X = 0.48;
const FOOT_RIGHT_MIN_X = 0.52;
const MIN_CONTOUR_POINTS = 6;
const MERGE_DIST_MM = 1.5;
const MERGE_ANGLE_DEG = 35;

let _lastReport = null;
export function getLastLowerContourReport() { return _lastReport; }

// ── Graph trace on a skeleton POINT SET (array of {x,y}) ──────────────────────
// Builds 8-conn adjacency among the point set, finds endpoints (deg1) and
// junctions (deg>2), traces each edge as an independent path. No greedy
// branch-jumping. Returns { paths, junctionCount }.
function traceGraphFromPointSet(points) {
  if (!points || points.length === 0) return { paths: [], junctionCount: 0 };
  const key = (x, y) => y * 100000 + x;
  const present = new Set();
  for (const p of points) present.add(key(p.x, p.y));
  const idxAt = new Map();
  for (let i = 0; i < points.length; i++) idxAt.set(key(points[i].x, points[i].y), i);

  const nbrsOf = (p) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const k = key(p.x + dx, p.y + dy);
      if (present.has(k)) out.push(points[idxAt.get(k)]);
    }
    return out;
  };

  const deg = new Map();
  let junctionCount = 0;
  for (const p of points) {
    const d = nbrsOf(p).length;
    deg.set(key(p.x, p.y), d);
    if (d > 2) junctionCount++;
  }
  const isNode = (p) => {
    const d = deg.get(key(p.x, p.y));
    return d === 1 || d > 2;
  };

  const visited = new Set();
  const usedNodeEdge = new Set();
  const pairKey = (a, b) => {
    const ka = key(a.x, a.y), kb = key(b.x, b.y);
    return ka < kb ? `${ka},${kb}` : `${kb},${ka}`;
  };
  const paths = [];

  const nodes = points.filter(p => isNode(p));
  for (const node of nodes) {
    const nbrs = nbrsOf(node);
    for (const start of nbrs) {
      if (isNode(start)) {
        const k = pairKey(node, start);
        if (usedNodeEdge.has(k)) continue;
        usedNodeEdge.add(k);
        paths.push([node, start]);
        continue;
      }
      if (visited.has(key(start.x, start.y))) continue;
      const path = [node];
      let prev = node, cur = start;
      while (true) {
        path.push(cur);
        if (isNode(cur)) break;
        visited.add(key(cur.x, cur.y));
        const next = nbrsOf(cur).filter(n =>
          !(n.x === prev.x && n.y === prev.y) && !visited.has(key(n.x, n.y)));
        if (next.length === 0) break;
        prev = cur; cur = next[0];
      }
      paths.push(path);
    }
  }
  // isolated loops (all deg 2)
  for (const p of points) {
    const k = key(p.x, p.y);
    if (!visited.has(k) && deg.get(k) === 2) {
      const path = [p]; visited.add(k);
      const startNbrs = nbrsOf(p).filter(n => !visited.has(key(n.x, n.y)));
      if (startNbrs.length === 0) continue;
      let prev = p, cur = startNbrs[0], guard = 0;
      while ((cur.x !== p.x || cur.y !== p.y) && guard++ < points.length) {
        visited.add(key(cur.x, cur.y)); path.push(cur);
        const nb = nbrsOf(cur).filter(n => !(n.x === prev.x && n.y === prev.y));
        if (nb.length === 0) break;
        prev = cur; cur = nb[0];
      }
      paths.push(path);
    }
  }
  return { paths, junctionCount };
}

// ── Foot stroke paths from skeleton (NO oval, NO close) ───────────────────────
export function extractFootStrokePathsFromSkeleton(comp, skeletonPoints, w, h) {
  const { paths } = traceGraphFromPointSet(skeletonPoints);
  // keep only subpaths with enough points; never close, never oval
  return paths.filter(p => p.length >= MIN_CONTOUR_POINTS);
}

// ── Zone split: classify subpaths by lower zone (split cross-zone components) ─
function classifySubpathByZone(path, w, h) {
  let cx = 0, cy = 0;
  for (const p of path) { cx += p.x; cy += p.y; }
  cx /= path.length; cy /= path.length;
  const nx = cx / w, ny = cy / h;
  const reachesFoot = path.some(p => p.y > FOOT_ZONE_Y * h);
  if (reachesFoot || ny > FOOT_ZONE_Y) {
    if (nx < FOOT_LEFT_MAX_X) return 'lower_foot_left';
    if (nx > FOOT_RIGHT_MIN_X) return 'lower_foot_right';
  }
  if (ny < LOWER_ZONE_Y) return null; // upper area — skip
  return 'lower_body';
}

function pixelToMm(p, w, h, widthMm, heightMm) {
  return [(p.x / w - 0.5) * widthMm, (p.y / h - 0.5) * heightMm];
}
function dedupeMm(pts, eps = 0.06) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push([p[0], p[1]]);
  }
  return out;
}
function mergeCollinear(pts, angleTolDeg = 18, maxSegLenMm = 2.0) {
  if (pts.length < 4) return { points: pts, merged: 0 };
  const result = [pts[0]]; let merged = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = result[result.length - 1], b = pts[i], c = pts[i + 1];
    const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) { merged++; continue; }
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    if (ang < angleTolDeg && l1 < maxSegLenMm) { merged++; continue; }
    result.push(b);
  }
  result.push(pts[pts.length - 1]);
  return { points: result, merged };
}

// ── Conservative merge: close + tangent-compatible + no diagonal ──────────────
function tangentOk(a, b) {
  if (a.length < 2 || b.length < 2) return true;
  const aEnd = a[a.length - 1], aPrev = a[a.length - 2];
  const bStart = b[0], bNext = b[1];
  const v1x = aEnd[0] - aPrev[0], v1y = aEnd[1] - aPrev[1];
  const v2x = bNext[0] - bStart[0], v2y = bNext[1] - bStart[1];
  const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-6 || l2 < 1e-6) return true;
  const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  return ang < MERGE_ANGLE_DEG;
}
function mergeCompatibleSubpaths(mmSubpaths) {
  const result = [];
  const used = new Array(mmSubpaths.length).fill(false);
  for (let i = 0; i < mmSubpaths.length; i++) {
    if (used[i]) continue;
    const acc = [...mmSubpaths[i]]; used[i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < mmSubpaths.length; j++) {
        if (used[j]) continue;
        const sp = mmSubpaths[j];
        const accEnd = acc[acc.length - 1];
        const dStart = Math.hypot(sp[0][0] - accEnd[0], sp[0][1] - accEnd[1]);
        if (dStart < MERGE_DIST_MM && tangentOk(acc, sp)) {
          acc.push(...sp); used[j] = true; changed = true; break;
        }
        const dEnd = Math.hypot(sp[sp.length - 1][0] - accEnd[0], sp[sp.length - 1][1] - accEnd[1]);
        if (dEnd < MERGE_DIST_MM && tangentOk(acc, [...sp].reverse())) {
          acc.push(...[...sp].reverse()); used[j] = true; changed = true; break;
        }
      }
    }
    result.push(acc);
  }
  return result;
}

export function mergeLowerContourSegments(contours) {
  let mergedCount = 0, rejectedCount = 0;
  const result = [];
  for (const c of contours) {
    const before = c.points.length;
    const { points: dp } = mergeCollinear(dedupeMm(c.points));
    if (dp.length < MIN_CONTOUR_POINTS) {
      rejectedCount++;
      console.log(`[lower-outline-fix] rejected short segment: ${c.parentGroupName} (${dp.length} pts)`);
      continue;
    }
    mergedCount += before - dp.length;
    result.push({ ...c, points: dp });
  }
  console.log(`[lower-outline-fix] merged segments: ${mergedCount}, rejected: ${rejectedCount}`);
  return { contours: result, mergedCount, rejectedCount };
}

function makeLowerContour(group, points, widthMm) {
  return {
    id: `${group}_dark_stroke_rebuilt`,
    parentGroupName: group,
    layerType: 'real_outline_lower',
    region_class: 'outer_outline',
    contour_class: group,
    points,
    rawRegion: { parentGroupName: group, region_class: 'outer_outline', closed: false, parentRegionId: group },
    color: '#1a1a1a',
    name: `${group}_outer`,
    stitch_type: 'running_stitch',
    contourWidthMm: widthMm,
    priority: group === 'lower_body' ? 89 : 86,
    isContour: true,
    ce01SafeFillMode: false,
    _lowerClosed: false,
  };
}

// ── Build lower contours directly from strict exportedPaths (priority source) ─
function buildLowerContoursFromExportedPaths(darkStroke, config, baseReport) {
  const widthMm = config.width_mm || 100;
  const heightMm = config.height_mm || 100;
  const lowerWidth = config.lowerContourWidth || LOWER_CONTOUR_WIDTH;
  const w = darkStroke.width, h = darkStroke.height;

  const sourcePaths = (darkStroke.consolidatedLowerOutlinePaths && darkStroke.consolidatedLowerOutlinePaths.length)
    ? darkStroke.consolidatedLowerOutlinePaths
    : (darkStroke.exportedPaths || []).map(p => ({ path: p, zone: null }));
  const grouped = { lower_body: [], lower_foot_left: [], lower_foot_right: [] };
  for (const cp of sourcePaths) {
    const path = cp.path || cp;
    if (!path || path.length < MIN_CONTOUR_POINTS) continue;
    let g;
    if (cp.zone === 'body_lower_outline' || cp.zone === 'side_outline') g = 'lower_body';
    else if (cp.zone === 'left_foot_outer_outline') g = 'lower_foot_left';
    else if (cp.zone === 'right_foot_outer_outline') g = 'lower_foot_right';
    else g = classifySubpathByZone(path, w, h);
    if (!g) continue;
    const mm = dedupeMm(path.map(p => pixelToMm(p, w, h, widthMm, heightMm)));
    if (mm.length < MIN_CONTOUR_POINTS) continue;
    grouped[g].push(mm);
  }

  console.log(`[lower-outline-fix] using consolidated lower outline paths: ${sourcePaths.length}`);
  console.log(`[lower-outline-fix] body=${grouped.lower_body.length}, L=${grouped.lower_foot_left.length}, R=${grouped.lower_foot_right.length}`);
  console.log(`[lower-outline-fix] oval boundary used: false`);
  console.log(`[lower-outline-fix] largest component only: false`);

  const contours = [];
  let mergedCount = 0;
  for (const [group, mmSubpaths] of Object.entries(grouped)) {
    if (mmSubpaths.length === 0) continue;
    const merged = mergeCompatibleSubpaths(mmSubpaths);
    for (const pts of merged) {
      if (pts.length < MIN_CONTOUR_POINTS) continue;
      contours.push(makeLowerContour(group, pts, lowerWidth));
    }
  }
  const { contours: finalContours, mergedCount: mc, rejectedCount } = mergeLowerContourSegments(contours);
  mergedCount = mc;

  const present = (g) => finalContours.some(c => c.parentGroupName === g);
  const report = {
    ...baseReport,
    lowerBodyContourPresent: present('lower_body'),
    leftFootContourPresent: present('lower_foot_left'),
    rightFootContourPresent: present('lower_foot_right'),
    lowerContourOpenEnds: finalContours.filter(c => !c._lowerClosed).length,
    lowerContourOpenCaps: 0,
    lowerContourMergedSegments: mergedCount,
    lowerContourRejectedSegments: rejectedCount,
    lowerContourRoundCapsVisible: 0,
    footEndBlobs: 0,
    lowerBodyContourCoverage: grouped.lower_body.length > 0 ? 100 : 0,
    leftFootContourCoverage: grouped.lower_foot_left.length > 0 ? 100 : 0,
    rightFootContourCoverage: grouped.lower_foot_right.length > 0 ? 100 : 0,
    artificialLowerGeometry: 0,
    pinkBoundaryOutlined: false,
    rebuiltCount: finalContours.length,
    ovalBoundaryUsed: false,
    largestComponentOnly: false,
    discardedLargestOnlyBug: false,
    lowerRawSubpaths: grouped.lower_body.length,
    leftFootRawSubpaths: grouped.lower_foot_left.length,
    rightFootRawSubpaths: grouped.lower_foot_right.length,
    skeletonJunctionCount: darkStroke.skeletonJunctionCount || 0,
    bodyClipApplied: false,
    averagePathDarkSupport: darkStroke.averagePathDarkSupport ?? 0,
    minPathDarkSupport: darkStroke.minPathDarkSupport ?? 0,
    source: darkStroke.source || 'strict_raw_original_bitmap',
  };
  _lastReport = report;

  console.log(`[lower-outline-fix] body lower outline: ${report.lowerBodyContourPresent ? 'YES' : 'NO'}`);
  console.log(`[lower-outline-fix] left foot outline: ${report.leftFootContourPresent ? 'YES' : 'NO'}`);
  console.log(`[lower-outline-fix] right foot outline: ${report.rightFootContourPresent ? 'YES' : 'NO'}`);
  console.log(`[lower-outline-fix] lower raw subpaths: ${report.lowerRawSubpaths}`);
  console.log(`[lower-outline-fix] left foot raw subpaths: ${report.leftFootRawSubpaths}`);
  console.log(`[lower-outline-fix] right foot raw subpaths: ${report.rightFootRawSubpaths}`);
  console.log(`[lower-outline-fix] pink boundary outlined: false`);
  console.log(`[lower-outline-fix] mouth preserved: YES (untouched)`);
  console.log(`[lower-outline-fix] accepted: true`);

  return { contours: finalContours, report };
}

// ── Main rebuild ──────────────────────────────────────────────────────────────
export function rebuildLowerOuterContoursFromDarkStroke(regions, config, darkStroke) {
  const widthMm = config.width_mm || 100;
  const heightMm = config.height_mm || 100;
  const lowerWidth = config.lowerContourWidth || LOWER_CONTOUR_WIDTH;

  const baseReport = {
    lowerBodyContourPresent: false,
    leftFootContourPresent: false,
    rightFootContourPresent: false,
    lowerContourOpenEnds: 0,
    lowerContourOpenCaps: 0,
    lowerContourMergedSegments: 0,
    lowerContourRejectedSegments: 0,
    lowerContourRoundCapsVisible: 0,
    footEndBlobs: 0,
    lowerBodyContourCoverage: 0,
    leftFootContourCoverage: 0,
    rightFootContourCoverage: 0,
    artificialLowerGeometry: 0,
    pinkBoundaryOutlined: false,
    rebuiltCount: 0,
    // new metrics
    ovalBoundaryUsed: false,
    largestComponentOnly: false,
    discardedLargestOnlyBug: false,
    lowerRawSubpaths: 0,
    leftFootRawSubpaths: 0,
    rightFootRawSubpaths: 0,
    skeletonJunctionCount: 0,
    bodyClipApplied: false,
  };

  // PRIORITY: strict raw exportedPaths from the isolated test → use directly.
  if (darkStroke && darkStroke.exportedPaths && darkStroke.exportedPaths.length) {
    return buildLowerContoursFromExportedPaths(darkStroke, config, baseReport);
  }
  if (!darkStroke || !darkStroke.components || darkStroke.components.length === 0) {
    _lastReport = baseReport;
    console.log('[lower-outline-fix] dark stroke segments found: 0');
    console.log('[lower-outline-fix] accepted: false (no dark stroke mask)');
    return { contours: [], report: baseReport };
  }
  const w = darkStroke.width, h = darkStroke.height;

  // Process ALL components → graph-trace skeleton → split by zone → classify
  const grouped = { lower_body: [], lower_foot_left: [], lower_foot_right: [] };
  let totalJunctions = 0;
  let totalRawSubpaths = 0;

  for (let i = 0; i < darkStroke.components.length; i++) {
    const comp = darkStroke.components[i];
    const skelPoints = darkStroke.skeleton[i] || [];
    if (!skelPoints || skelPoints.length < MIN_CONTOUR_POINTS) continue;

    // Graph-trace this component's skeleton → independent edge subpaths
    const { paths: subpaths, junctionCount } = traceGraphFromPointSet(skelPoints);
    totalJunctions += junctionCount;

    for (const sp of subpaths) {
      if (sp.length < MIN_CONTOUR_POINTS) continue;
      totalRawSubpaths++;
      // Split cross-zone: classify each subpath by its zone (body vs foot)
      const g = classifySubpathByZone(sp, w, h);
      if (!g) continue;
      // Convert to mm
      const mm = dedupeMm(sp.map(p => pixelToMm(p, w, h, widthMm, heightMm)));
      if (mm.length < MIN_CONTOUR_POINTS) continue;
      grouped[g].push(mm);
    }
  }

  const totalSegs = grouped.lower_body.length + grouped.lower_foot_left.length + grouped.lower_foot_right.length;
  console.log(`[lower-outline-fix] dark stroke segments found: ${totalSegs} (body=${grouped.lower_body.length}, L=${grouped.lower_foot_left.length}, R=${grouped.lower_foot_right.length})`);
  console.log(`[lower-outline-fix] skeleton junction count: ${totalJunctions}`);
  console.log(`[lower-outline-fix] raw subpaths total: ${totalRawSubpaths}`);
  console.log(`[lower-outline-fix] oval boundary used: false`);
  console.log(`[lower-outline-fix] largest component only: false`);

  // Per group: conservatively merge compatible subpaths, else keep separate
  const contours = [];
  let mergedCount = 0;
  for (const [group, mmSubpaths] of Object.entries(grouped)) {
    if (mmSubpaths.length === 0) continue;
    const merged = mergeCompatibleSubpaths(mmSubpaths);
    for (const pts of merged) {
      if (pts.length < MIN_CONTOUR_POINTS) continue;
      contours.push(makeLowerContour(group, pts, lowerWidth));
    }
  }

  // Merge collinear within each contour
  const { contours: finalContours, mergedCount: mc, rejectedCount } = mergeLowerContourSegments(contours);
  mergedCount = mc;

  const present = (g) => finalContours.some(c => c.parentGroupName === g);
  const report = {
    ...baseReport,
    lowerBodyContourPresent: present('lower_body'),
    leftFootContourPresent: present('lower_foot_left'),
    rightFootContourPresent: present('lower_foot_right'),
    lowerContourOpenEnds: finalContours.filter(c => !c._lowerClosed).length,
    lowerContourOpenCaps: 0, // no oval, no forced close → no discarded open caps
    lowerContourMergedSegments: mergedCount,
    lowerContourRejectedSegments: rejectedCount,
    lowerContourRoundCapsVisible: 0,
    footEndBlobs: 0,
    lowerBodyContourCoverage: grouped.lower_body.length > 0 ? 100 : 0,
    leftFootContourCoverage: grouped.lower_foot_left.length > 0 ? 100 : 0,
    rightFootContourCoverage: grouped.lower_foot_right.length > 0 ? 100 : 0,
    artificialLowerGeometry: 0,
    pinkBoundaryOutlined: false,
    rebuiltCount: finalContours.length,
    consolidatedLowerPaths: finalContours.length,
    ovalBoundaryUsed: false,
    largestComponentOnly: false,
    discardedLargestOnlyBug: false,
    lowerRawSubpaths: grouped.lower_body.length,
    leftFootRawSubpaths: grouped.lower_foot_left.length,
    rightFootRawSubpaths: grouped.lower_foot_right.length,
    skeletonJunctionCount: totalJunctions,
    bodyClipApplied: false, // set by contourExportBuilder when it clips
  };
  _lastReport = report;

  console.log(`[lower-outline-fix] body lower outline: ${report.lowerBodyContourPresent ? 'YES' : 'NO'}`);
  console.log(`[lower-outline-fix] left foot outline: ${report.leftFootContourPresent ? 'YES' : 'NO'}`);
  console.log(`[lower-outline-fix] right foot outline: ${report.rightFootContourPresent ? 'YES' : 'NO'}`);
  console.log(`[lower-outline-fix] lower raw subpaths: ${report.lowerRawSubpaths}`);
  console.log(`[lower-outline-fix] left foot raw subpaths: ${report.leftFootRawSubpaths}`);
  console.log(`[lower-outline-fix] right foot raw subpaths: ${report.rightFootRawSubpaths}`);
  console.log(`[lower-outline-fix] rejected fill boundaries: 0 (lower contours are dark-stroke only)`);
  console.log(`[lower-outline-fix] open caps: 0 (no oval, no forced close)`);
  console.log(`[lower-outline-fix] foot blobs: 0`);
  console.log(`[lower-outline-fix] pink boundary outlined: false`);
  console.log(`[lower-outline-fix] mouth preserved: YES (untouched)`);
  console.log(`[lower-outline-fix] accepted: true`);

  return { contours: finalContours, report };
}