/**
 * outlineGenerator.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates real outline objects as independent embroidery entities — not
 * just canvas borders. Each outline becomes a standalone stitch object with
 * its own color, stitch type, and priority.
 *
 * Generates:
 *   - outer silhouette outline (from the outermost region boundary)
 *   - inner outlines at high-contrast borders between regions
 *
 * Stitch type by width:
 *   < 0.8mm  → run stitch
 *   0.8–2.0mm → satin
 *   > 2.0mm  → satin wide (or fill if very wide)
 *
 * Public API:
 *   generateOutlines(regions, config) → { outlines, report }
 *   stitchTypeForWidth(widthMm)       → 'running_stitch' | 'satin' | 'fill'
 */

import { classifyRegionGroups, sameObjectGroup } from './contourGroupClassifier.js';
import { overlapsDarkStrokeMask } from './darkStrokeDetector.js';

const HIGH_CONTRAST_THRESHOLD = 80;
const DARK_LUM_THRESHOLD = 60;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 128,
    g: parseInt(h.slice(2, 4), 16) || 128,
    b: parseInt(h.slice(4, 6), 16) || 128,
  };
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function colorDistance(c1, c2) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function computeBbox(pts) {
  if (!pts || pts.length === 0) return { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5, w: 0, h: 0 };
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function perimeterNorm(pts) {
  if (!pts || pts.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    p += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return p;
}

function dedupePoints(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-5) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

function ensureClosed(pts) {
  if (pts.length < 3) return pts;
  const f = pts[0], l = pts[pts.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) > 0.01) return [...pts, [f[0], f[1]]];
  return pts;
}

// ── Safe closure: only close if the gap is small enough to avoid artificial
//    straight segments crossing the design interior. Returns { points, closed }.
const MAX_CLOSURE_GAP_NORM = 0.05;

function safeClosePath(pts) {
  if (pts.length < 3) return { points: pts, closed: false };
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  const gap = Math.hypot(fx - lx, fy - ly);
  if (gap > MAX_CLOSURE_GAP_NORM) {
    console.log(`[travel-audit] artificial closure removed: gap ${gap.toFixed(3)} exceeds threshold`);
    return { points: pts, closed: false };
  }
  if (gap > 0.01) return { points: [...pts, [fx, fy]], closed: true };
  return { points: pts, closed: true };
}

// ─── Stitch type selection ─────────────────────────────────────────────────────

export function stitchTypeForWidth(widthMm) {
  if (widthMm < 0.8) return 'running_stitch';
  if (widthMm <= 2.0) return 'satin';
  return 'fill';
}

// ─── Outer silhouette outline (per object_group) ──────────────────────────────

/**
 * Generates outer silhouette outlines per object_group.
 *
 * - body group: unions ALL body fills via convex hull → one outer outline
 * - foot groups: each foot group gets its own outer outline
 * - inner_detail groups (eyes, mouth): skipped (they get inner outlines only)
 *
 * This replaces the old single-fill approach that missed feet and left gaps.
 *
 * @returns {Array} outer outline objects
 */
function generateOuterSilhouettes(regions, config) {
  const fills = regions.filter(r =>
    (r.region_class === 'fill' || (!r.region_class && r.stitch_type === 'fill')) &&
    r.path_points && r.path_points.length >= 8
  );
  if (fills.length === 0) return [];

  // Group fills by object_group
  const groups = {};
  for (const fill of fills) {
    const g = fill.object_group || 'other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(fill);
  }

  const outlines = [];
  const widthMm = config.width_mm || 100;
  const heightMm = config.height_mm || 100;
  const outlineColor = '#1a1a1a';

  for (const [groupName, groupFills] of Object.entries(groups)) {
    const policy = groupFills[0]?.contour_policy;
    // Skip inner_detail groups — they get inner outlines, not outer
    if (policy === 'inner_detail') continue;

    // Skip tiny groups that aren't feet
    const totalArea = groupFills.reduce((s, f) => s + (f.area_mm2 || 0), 0);
    if (totalArea < 80 && groupName !== 'foot_left' && groupName !== 'foot_right') continue;

    // Build outer silhouette — use largest fill's boundary (no convex hull)
    // Convex hull creates artificial straight edges that cross the design.
    let outlinePts;
    let outlineClosed = true;
    if (groupFills.length === 1) {
      const sc = safeClosePath(dedupePoints(groupFills[0].path_points));
      outlinePts = sc.points;
      outlineClosed = sc.closed;
    } else {
      const largest = groupFills.reduce((max, f) =>
        (f.area_mm2 || 0) > (max.area_mm2 || 0) ? f : max, groupFills[0]);
      const sc = safeClosePath(dedupePoints(largest.path_points));
      outlinePts = sc.points;
      outlineClosed = sc.closed;
      console.log(`[travel-audit] disjoint contours kept separate: ${groupName} uses largest fill (${groupFills.length} fills in group)`);
    }

    if (outlinePts.length < 8) continue;

    const perim = perimeterNorm(outlinePts);
    if (perim < 0.12) continue;

    const perimMm = perim * Math.max(widthMm, heightMm);
    const parentFill = groupFills[0];

    outlines.push({
      id: `outline_outer_${groupName}`,
      parentRegionId: parentFill.id,
      parentGroupName: groupName,
      type: 'contour',
      region_class: 'outer_outline',
      stitch_type: 'satin',
      contour_class: groupName === 'body' ? 'outer_silhouette' : 'outer_part',
      contour_points: outlinePts,
      path_points: outlinePts,
      hex: outlineColor,
      color: outlineColor,
      contour_color: outlineColor,
      contour_width_mm: 1.15,
      confidence: 85,
      source: 'outline_generator_outer_group',
      closed: outlineClosed,
      name: `${groupName}_outer_outline`,
      visible: true,
      priority: 90,
      area_mm2: totalArea,
      perimeter_mm: perimMm,
      groupFillCount: groupFills.length,
    });

    console.log(`[outline-generator] outer silhouette for group ${groupName}: fills=${groupFills.length} pts=${outlinePts.length}`);
  }

  return outlines;
}

// ─── Closure validation ───────────────────────────────────────────────────────

/**
 * Validates that an outline path is properly closed.
 * closureRatio = 1 - (gap / perimeter). Must be > 0.98.
 */
function validateClosure(points) {
  if (!points || points.length < 3) return { closed: false, closureRatio: 0 };
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  const gap = Math.hypot(fx - lx, fy - ly);
  let perim = 0;
  for (let i = 0; i < points.length - 1; i++) {
    perim += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  const closureRatio = perim > 0 ? 1 - (gap / perim) : 0;
  return { closed: closureRatio > 0.98, closureRatio };
}

// ─── Inner outlines ────────────────────────────────────────────────────────────

/**
 * Generates inner outlines at high-contrast borders between adjacent regions.
 * Each outline follows the boundary of a fill region where a high-contrast
 * neighbor exists.
 */
function generateInnerOutlines(regions, config) {
  const fills = regions.filter(r =>
    (r.region_class === 'fill' || (!r.region_class && r.stitch_type === 'fill')) &&
    r.path_points && r.path_points.length >= 8
  );

  const outlines = [];
  const widthMm = config.width_mm || 100;
  const heightMm = config.height_mm || 100;

  for (const fill of fills) {
    const bbox = computeBbox(fill.path_points);
    if (bbox.w <= 0) continue;

    // Check for high-contrast neighbors
    let hasHighContrastNeighbor = false;
    for (const other of fills) {
      if (other.id === fill.id) continue;
      // ── Same object_group → skip (internal_fill_boundary, no contour) ──
      if (sameObjectGroup(fill, other)) continue;
      const ob = computeBbox(other.path_points);
      if (ob.w <= 0) continue;
      // Check bbox overlap or adjacency
      const xOverlap = Math.max(0, Math.min(bbox.maxX, ob.maxX) - Math.max(bbox.minX, ob.minX));
      const yOverlap = Math.max(0, Math.min(bbox.maxY, ob.maxY) - Math.max(bbox.minY, ob.minY));
      const isAdjacent = (xOverlap > 0 && yOverlap > -0.05) || (yOverlap > 0 && xOverlap > -0.05);
      if (!isAdjacent) continue;

      const contrast = colorDistance(
        fill.color || fill.hex || '#888888',
        other.color || other.hex || '#888888'
      );
      if (contrast > HIGH_CONTRAST_THRESHOLD) {
        hasHighContrastNeighbor = true;
        break;
      }
    }

    if (!hasHighContrastNeighbor) continue;

    // ── Dark stroke gate: when the mask is available, skip fill boundaries
    //    that have no real dark line. This stops inferring contours from
    //    color changes between fills (e.g. light pink / dark pink junction).
    //    Mouth/eyes are still created downstream by ensureMouthDetailExported.
    const darkStroke = config.darkStroke;
    if (darkStroke) {
      const { ratio } = overlapsDarkStrokeMask(fill.path_points, darkStroke, true);
      if (ratio < 0.6) {
        console.log(`[outline-generator] fill_boundary skipped (no dark stroke, ratio ${(ratio * 100).toFixed(0)}%): ${fill.name || fill.id}`);
        continue;
      }
    }

    // Check if this fill already has an outer outline generated
    // (don't duplicate the outer silhouette as an inner outline)
    if (regions.some(r => r.region_class === 'outer_outline' && r.parentRegionId === fill.id)) continue;

    const scInner = safeClosePath(dedupePoints(fill.path_points));
    const outlinePts = scInner.points;
    const innerClosed = scInner.closed;
    if (outlinePts.length < 8) continue;

    const perim = perimeterNorm(outlinePts);
    if (perim < 0.12) continue;

    const perimMm = perim * Math.max(widthMm, heightMm);
    const outlineColor = '#1a1a1a';
    const stitchType = stitchTypeForWidth(0.6); // inner outlines are typically thin

    outlines.push({
      id: `outline_inner_${fill.id}`,
      parentRegionId: fill.id,
      parentGroupName: fill.object_group || '',
      type: 'contour',
      region_class: 'inner_outline',
      stitch_type: stitchType,
      contour_class: 'inner_border',
      contour_points: outlinePts,
      path_points: outlinePts,
      hex: outlineColor,
      color: outlineColor,
      contour_color: outlineColor,
      contour_width_mm: 0.5,
      confidence: 70,
      source: 'outline_generator_inner',
      closed: innerClosed,
      name: `${(fill.name || 'region').replace(/_(fill|sat|run|contour|outline|detail)$/i, '')}_inner_outline`,
      visible: true,
      priority: 6,
      area_mm2: fill.area_mm2,
      perimeter_mm: perimMm,
    });
  }

  console.log(`[outline-generator] inner outlines generated: ${outlines.length}`);
  return outlines;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates all outline objects (outer silhouette + inner outlines).
 * Outlines are independent embroidery entities — not canvas borders.
 *
 * @param {Array}  regions — classified regions
 * @param {Object} config  — { width_mm, height_mm, generateOutlines }
 * @returns {{ outlines, report }}
 */
export function generateOutlines(regions, config = {}) {
  // Only generate when enabled (default ON for cartoon characters)
  const enabled = config.generateOutlines !== false;
  console.log(`[outline-generator] enabled: ${enabled}`);

  if (!enabled) {
    return { outlines: [], report: { enabled: false, outerCount: 0, innerCount: 0, total: 0 } };
  }

  // ── Classify regions into object_groups ──
  const classifiedRegions = classifyRegionGroups(regions);

  const outerOutlines = generateOuterSilhouettes(classifiedRegions, config);
  const innerOutlines = generateInnerOutlines(classifiedRegions, config);

  let outlines = [...outerOutlines, ...innerOutlines];
  outlines = deduplicateOutlines(outlines);

  // ── Closure validation: ensure outer outlines are properly closed ──
  for (const outline of outlines) {
    if (outline.region_class === 'outer_outline') {
      const pts = outline.contour_points || outline.path_points;
      const closure = validateClosure(pts);
      if (!closure.closed) {
        outline.contour_points = [...pts, pts[0]];
        outline.path_points = outline.contour_points;
        console.log(`[outline-refine] outer contour regenerated (closure: ${closure.closureRatio.toFixed(3)})`);
      }
    }
  }

  console.log(`[outline-generator] total outlines: ${outlines.length} (outer: ${outerOutlines.length}, inner: ${innerOutlines.length})`);
  console.log(`[outline-generator] outline names: ${outlines.map(o => o.name).join(', ') || 'none'}`);

  return {
    outlines,
    report: {
      enabled,
      outerCount: outerOutlines.length,
      innerCount: innerOutlines.length,
      total: outlines.length,
      outlines: outlines.map(o => ({
        id: o.id,
        name: o.name,
        class: o.region_class,
        stitchType: o.stitch_type,
        widthMm: o.contour_width_mm,
        priority: o.priority,
      })),
    },
    _classifiedRegions: classifiedRegions,
  };
}

function deduplicateOutlines(outlines) {
  if (outlines.length < 2) return outlines;
  const keep = [];
  for (const o of outlines) {
    const dup = keep.find(k => {
      if (k.contour_color !== o.contour_color) return false;
      // Never dedup outer outlines across different groups (body vs foot) —
      // that deletes valid foot / lower-body contours.
      if (k.region_class === 'outer_outline' && o.region_class === 'outer_outline' &&
          (k.parentGroupName || '') !== (o.parentGroupName || '')) return false;
      return bboxSimilar(computeBbox(k.contour_points), computeBbox(o.contour_points));
    });
    if (!dup) keep.push(o);
  }
  return keep;
}

function bboxSimilar(a, b) {
  const iou = bboxIoU(a, b);
  return iou > 0.85;
}

function bboxIoU(a, b) {
  const ix = Math.max(a.minX, b.minX), iy = Math.max(a.minY, b.minY);
  const ix2 = Math.min(a.maxX, b.maxX), iy2 = Math.min(a.maxY, b.maxY);
  const iw = Math.max(0, ix2 - ix), ih = Math.max(0, iy2 - iy);
  const inter = iw * ih;
  const ua = a.w * a.h + b.w * b.h - inter;
  return ua > 0 ? inter / ua : 0;
}