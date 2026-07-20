/**
 * contourScorer.js — Classification + scoring + noise rejection
 * ─────────────────────────────────────────────────────────────────────────────
 * Scores each contour candidate 0–100 across 8 dimensions, classifies it
 * (outer_silhouette | inner_detail | decorative_line | noise), and applies
 * acceptance thresholds + cluster suppression.
 *
 * Scoring weights:
 *   closure           15  — is the path closed or nearly closed?
 *   continuity        15  — low direction variance (no jagged teeth)
 *   edge contrast     20  — does a real edge exist in the original image?
 *   geometry smooth   10  — smoothness / curvature stability
 *   length            10  — longer = more likely a real contour
 *   darkness          10  — contrast against surrounding fill
 *   border alignment  10  — how close to the visible border
 *   noise penalty    -20  — racimo / fill-texture overlap / micro-fragment
 *   overlap penalty  -10  — overlaps fill stitch texture
 */

import { measureContourAlignment } from './edgeSnapper.js';

const ACCEPT_THRESHOLD = 75;
const DETAIL_THRESHOLD = 55;
const MIN_LENGTH_NORM = 0.04;   // reject contours shorter than this (normalized)
const CLUSTER_RADIUS = 0.03;    // normalized — fragments within this distance = cluster
const CLUSTER_MIN_COUNT = 4;    // 4+ small fragments in a cluster = noise

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scores and classifies a single contour candidate.
 *
 * @param {Object} contour  — { contour_points, contour_type, contour_color, ... }
 * @param {Object} region   — source region (for color/area context)
 * @param {Array}  allRegions
 * @param {Object} edgeMap  — optional, from edgeSnapper
 * @param {Array}  allContours — for cluster detection
 * @returns {{ contour, score, contourClass, accepted, reason }}
 */
export function scoreAndClassifyContour(contour, region, allRegions, edgeMap, allContours = []) {
  const pts = contour.contour_points;
  if (!pts || pts.length < 3) {
    return { contour, score: 0, contourClass: 'noise', accepted: false, reason: 'puntos insuficientes' };
  }

  // ── Sub-scores ──────────────────────────────────────────────────────────
  const closureScore    = scoreClosure(pts);
  const continuityScore = scoreContinuity(pts);
  const smoothScore     = scoreSmoothness(pts);
  const lengthScore     = scoreLength(pts);
  const darknessScore   = scoreDarkness(contour, region, allRegions);
  const contrastScore   = scoreEdgeContrast(pts, edgeMap);
  const alignScore      = edgeMap ? measureContourAlignment(pts, edgeMap).alignmentScore : 50;
  const clusterPenalty  = computeClusterPenalty(contour, allContours);
  const overlapPenalty  = computeFillOverlapPenalty(contour, region, allRegions);

  // ── Weighted total ──────────────────────────────────────────────────────
  let score =
    closureScore    * 0.15 +
    continuityScore * 0.15 +
    contrastScore   * 0.20 +
    smoothScore     * 0.10 +
    lengthScore     * 0.10 +
    darknessScore   * 0.10 +
    alignScore      * 0.10 +
    clusterPenalty  +      // already negative
    overlapPenalty;        // already negative

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ── Classification ──────────────────────────────────────────────────────
  const contourClass = classifyClass(contour, region, allRegions, score, {
    closureScore, continuityScore, contrastScore, lengthScore,
  });

  // ── Acceptance ──────────────────────────────────────────────────────────
  let accepted = false;
  let reason = '';

  if (contourClass === 'outer_silhouette') {
    // Outer silhouette: accept at 55+ (it's the priority contour)
    accepted = score >= DETAIL_THRESHOLD;
    reason = accepted ? 'outer silhouette aceptado' : `score ${score} < ${DETAIL_THRESHOLD}`;
  } else if (contourClass === 'inner_detail') {
    // Inner detail: strict, need 75+ unless very high contrast
    accepted = score >= ACCEPT_THRESHOLD || (score >= DETAIL_THRESHOLD && contrastScore >= 80);
    reason = accepted ? 'inner detail aceptado' : `score ${score} < ${ACCEPT_THRESHOLD}`;
  } else if (contourClass === 'decorative_line') {
    accepted = score >= ACCEPT_THRESHOLD;
    reason = accepted ? 'decorative line aceptada' : `score ${score} < ${ACCEPT_THRESHOLD}`;
  } else {
    accepted = false;
    reason = 'noise';
  }

  // Hard reject: micro-fragment in a cluster
  if (clusterPenalty <= -15) {
    accepted = false;
    reason = 'racimo de micro-fragmentos';
  }

  // Hard reject: too short
  if (lengthScore < 15) {
    accepted = false;
    reason = 'longitud insuficiente';
  }

  // Hard reject: jagged teeth
  if (continuityScore < 30) {
    accepted = false;
    reason = 'continuidad baja (dientes de sierra)';
  }

  // Attach score + class to the contour object
  contour.score = score;
  contour.contour_class = contourClass;
  contour.score_breakdown = {
    closure: closureScore,
    continuity: continuityScore,
    contrast: contrastScore,
    smoothness: smoothScore,
    length: lengthScore,
    darkness: darknessScore,
    alignment: alignScore,
    clusterPenalty,
    overlapPenalty,
  };

  return { contour, score, contourClass, accepted, reason };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function scoreClosure(pts) {
  if (pts.length < 3) return 0;
  const f = pts[0], l = pts[pts.length - 1];
  const gap = Math.hypot(f[0] - l[0], f[1] - l[1]);
  // gap < 0.005 = fully closed → 100; gap > 0.1 = open → 0
  if (gap < 0.005) return 100;
  if (gap > 0.1) return 0;
  return Math.round(100 * (1 - gap / 0.1));
}

function scoreContinuity(pts) {
  if (pts.length < 5) return 50;
  // Measure direction changes between consecutive segments
  let totalChange = 0, segments = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1 = [b[0] - a[0], b[1] - a[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    totalChange += angle;
    segments++;
  }
  if (segments === 0) return 50;
  const avgChange = totalChange / segments; // radians
  // avgChange < 0.1 rad = smooth → 100; > 1.0 rad = jagged → 0
  if (avgChange < 0.1) return 100;
  if (avgChange > 1.0) return 0;
  return Math.round(100 * (1 - (avgChange - 0.1) / 0.9));
}

function scoreSmoothness(pts) {
  if (pts.length < 6) return 50;
  // Curvature variance — low variance = smooth
  const curvatures = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1 = [b[0] - a[0], b[1] - a[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    curvatures.push(Math.acos(Math.max(-1, Math.min(1, dot))));
  }
  if (curvatures.length < 3) return 50;
  const mean = curvatures.reduce((s, c) => s + c, 0) / curvatures.length;
  const variance = curvatures.reduce((s, c) => s + (c - mean) ** 2, 0) / curvatures.length;
  const std = Math.sqrt(variance);
  // std < 0.1 = smooth → 100; > 0.6 = rough → 0
  if (std < 0.1) return 100;
  if (std > 0.6) return 0;
  return Math.round(100 * (1 - (std - 0.1) / 0.5));
}

function scoreLength(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  // len > 0.5 (normalized) = long → 100; < 0.04 = micro → 0
  if (len > 0.5) return 100;
  if (len < MIN_LENGTH_NORM) return 0;
  return Math.round(100 * (len - MIN_LENGTH_NORM) / (0.5 - MIN_LENGTH_NORM));
}

function scoreDarkness(contour, region, allRegions) {
  // Darker contour color = higher contrast against light fills = more likely real
  const color = contour.contour_color || region.color || '#888888';
  const { r, g, b } = hexToRgb(color);
  const lum = (r + g + b) / 3;
  // lum < 30 = very dark → 100; > 200 = very light → 10
  if (lum < 30) return 100;
  if (lum > 200) return 10;
  return Math.round(100 * (1 - (lum - 30) / 170));
}

function scoreEdgeContrast(pts, edgeMap) {
  if (!edgeMap) return 50;
  const { meanGradient, alignmentScore } = measureContourAlignment(pts, edgeMap);
  // Use alignment score directly — it already measures edge strength along the path
  return alignmentScore;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLUSTER + OVERLAP PENALTIES
// ═══════════════════════════════════════════════════════════════════════════

function computeClusterPenalty(contour, allContours) {
  if (allContours.length < CLUSTER_MIN_COUNT) return 0;
  const bbox = computeBbox(contour.contour_points);
  const center = [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2];
  const area = shoelaceArea(contour.contour_points);

  // Small contour check — only penalize small ones in clusters
  if (area > 0.01) return 0;

  let nearby = 0;
  for (const other of allContours) {
    if (other === contour) continue;
    const ob = computeBbox(other.contour_points);
    const oc = [(ob.minX + ob.maxX) / 2, (ob.minY + ob.maxY) / 2];
    const dist = Math.hypot(oc[0] - center[0], oc[1] - center[1]);
    if (dist < CLUSTER_RADIUS) nearby++;
  }

  if (nearby >= CLUSTER_MIN_COUNT) {
    // Heavy penalty: this is a cluster of micro-fragments
    return -20;
  }
  if (nearby >= 2) return -5;
  return 0;
}

function computeFillOverlapPenalty(contour, region, allRegions) {
  // Penalize contours that sit inside a large fill region's interior
  // (not on its border) — these are likely fill texture noise
  const pts = contour.contour_points;
  const bbox = computeBbox(pts);
  const center = [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2];

  for (const other of allRegions) {
    if (other.id === region.id) continue;
    const ob = computeBbox(other.path_points);
    const otherArea = shoelaceArea(other.path_points);
    if (otherArea < 0.02) continue; // skip small regions

    // Is center inside this region's bbox, far from its border?
    const inside = center[0] > ob.minX + 0.02 && center[0] < ob.maxX - 0.02 &&
                   center[1] > ob.minY + 0.02 && center[1] < ob.maxY - 0.02;
    if (!inside) continue;

    // Distance from center to nearest bbox edge
    const distToEdge = Math.min(
      center[0] - ob.minX, ob.maxX - center[0],
      center[1] - ob.minY, ob.maxY - center[1]
    );
    // If contour is deep inside a fill region (not near border), penalize
    if (distToEdge > 0.05) return -10;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

function classifyClass(contour, region, allRegions, score, sub) {
  const pts = contour.contour_points;
  const bbox = computeBbox(pts);
  const area = shoelaceArea(pts);

  // Check if this region is contained within another (inner) or is the largest (outer)
  const isInner = isContainedIn(region, allRegions);
  const isLargest = isLargestRegion(region, allRegions);

  // ── Outer silhouette ────────────────────────────────────────────────────
  // Largest region, good closure, good length, follows the main shape
  if (isLargest && sub.closureScore >= 50 && sub.lengthScore >= 40) {
    return 'outer_silhouette';
  }

  // Also outer if it's NOT contained in anything and has decent size
  if (!isInner && area > 0.01 && sub.closureScore >= 40 && sub.lengthScore >= 30) {
    return 'outer_silhouette';
  }

  // ── Inner detail ────────────────────────────────────────────────────────
  // Contained within another region, compact, high contrast
  if (isInner) {
    // If very small + low score → noise
    if (area < 0.002 && score < 60) return 'noise';
    // If good contrast and closure → inner detail
    if (sub.contrastScore >= 50 && sub.closureScore >= 40) return 'inner_detail';
    return 'noise';
  }

  // ── Decorative line ─────────────────────────────────────────────────────
  // Not contained, not largest, but has good continuity + contrast
  if (sub.continuityScore >= 50 && sub.contrastScore >= 50) {
    return 'decorative_line';
  }

  return 'noise';
}

function isContainedIn(region, allRegions) {
  const bbox = computeBbox(region.path_points || region.contour_points);
  for (const other of allRegions) {
    if (other.id === region.id) continue;
    const ob = computeBbox(other.path_points);
    const otherArea = shoelaceArea(other.path_points) || 0;
    const myArea = shoelaceArea(region.path_points) || 0;
    if (bbox.minX >= ob.minX && bbox.maxX <= ob.maxX &&
        bbox.minY >= ob.minY && bbox.maxY <= ob.maxY &&
        otherArea > myArea * 1.5) {
      return true;
    }
  }
  return false;
}

function isLargestRegion(region, allRegions) {
  const myArea = shoelaceArea(region.path_points) || 0;
  for (const other of allRegions) {
    if (other.id === region.id) continue;
    const otherArea = shoelaceArea(other.path_points) || 0;
    if (otherArea > myArea) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FRAGMENT MERGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Attempts to merge nearby aligned fragments into single contours.
 * Only merges if: endpoints are close, directions align, no self-intersection.
 *
 * @param {Array} candidates — [{ contour, region, ... }]
 * @returns {Array} — merged candidates
 */
export function mergeFragments(candidates) {
  if (candidates.length < 2) return candidates;

  const MERGE_DIST = 0.02; // normalized — endpoints within this distance
  const MERGE_ANGLE_TOL = 0.4; // radians — direction alignment tolerance

  const merged = [...candidates];
  let changed = true;
  let mergeCount = 0;

  while (changed && merged.length > 1) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i].contour.contour_points;
        const b = merged[j].contour.contour_points;
        if (!a || !b) continue;

        // Check all endpoint pairs
        const pairs = [
          [a[0], b[0], 'a0-b0'],
          [a[0], b[b.length - 1], 'a0-bN'],
          [a[a.length - 1], b[0], 'aN-b0'],
          [a[a.length - 1], b[b.length - 1], 'aN-bN'],
        ];

        for (const [p1, p2, label] of pairs) {
          const dist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
          if (dist > MERGE_DIST) continue;

          // Check direction alignment at the join
          if (!directionsAlign(a, b, label, MERGE_ANGLE_TOL)) continue;

          // Merge
          const combined = mergePaths(a, b, label);
          if (!combined || hasSelfIntersections(combined, 30)) continue;

          // Replace the two fragments with the merged one
          merged[i] = {
            ...merged[i],
            contour: { ...merged[i].contour, contour_points: combined },
            merged: true,
          };
          merged.splice(j, 1);
          mergeCount++;
          changed = true;
          break;
        }
        if (changed) break;
      }
      if (changed) break;
    }
  }

  if (mergeCount > 0) {
    console.log(`[contour] merged fragments: ${mergeCount}`);
  }

  return merged;
}

function directionsAlign(a, b, label, tol) {
  // Get tangent at the join endpoints
  const aTan = getTangent(a, label.startsWith('a0') ? 'start' : 'end');
  const bTan = getTangent(b, label.includes('b0') ? 'start' : 'end');
  if (!aTan || !bTan) return true; // can't check, allow
  // For a join, tangents should be roughly parallel (dot > 0) or anti-parallel
  const dot = aTan[0] * bTan[0] + aTan[1] * bTan[1];
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  // Parallel (angle ~0) or anti-parallel (angle ~π) are both valid for merging
  return angle < tol || angle > Math.PI - tol;
}

function getTangent(pts, end) {
  if (pts.length < 2) return null;
  if (end === 'start') {
    return normalize([pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]]);
  }
  const n = pts.length;
  return normalize([pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]]);
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-6 ? null : [v[0] / l, v[1] / l];
}

function mergePaths(a, b, label) {
  // Merge based on which endpoints are joined
  const aRev = [...a].reverse();
  const bRev = [...b].reverse();
  switch (label) {
    case 'a0-b0':  return [...bRev, ...a];
    case 'a0-bN':  return [...b, ...a];
    case 'aN-b0':  return [...a, ...b];
    case 'aN-bN':  return [...a, ...bRev];
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEOMETRY UTILS
// ═══════════════════════════════════════════════════════════════════════════

function computeBbox(pts) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function shoelaceArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

function hasSelfIntersections(pts, maxCheck = 50) {
  const n = pts.length;
  if (n < 4) return false;
  const limit = Math.min(n, maxCheck);
  for (let i = 0; i < limit; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < limit; j++) {
      if (j === (i - 1 + n) % n) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 128,
    g: parseInt(h.slice(2, 4), 16) || 128,
    b: parseInt(h.slice(4, 6), 16) || 128,
  };
}