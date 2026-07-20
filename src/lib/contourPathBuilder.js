/**
 * contourPathBuilder.js — Clean contour extraction separated from fill
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds a dedicated contour path for each region, independent of the fill
 * path_points. The contour is derived from the region's real boundary,
 * cleaned, simplified, validated, and enriched with width/color/type.
 *
 * Public API:
 *   buildContourPath(region, allRegions, options)
 *   buildContoursForRegions(regions, options)
 *
 * Each contour: {
 *   contour_points,     — normalized 0–1, closed polygon
 *   closed,             — true (always closed except for explicit 'run' type)
 *   contour_width_mm,   — estimated or default stroke width
 *   contour_color,      — from border detection > region.contourColor > black
 *   contour_type,       — 'outer' | 'inner' | 'run'
 *   confidence,         — 0–100 geometric quality
 * }
 */

import { snapContourToEdges, measureContourAlignment } from './edgeSnapper.js';
import { scoreAndClassifyContour, mergeFragments } from './contourScorer.js';

const DEFAULT_WIDTH_MM = 1.2;
const INNER_WIDTH_MM   = 0.8;
const MIN_CONTOUR_PTS  = 3;
const RDP_EPSILON      = 0.003; // normalized — removes redundant points
const CLOSE_TOL        = 0.008; // normalized — gap closing threshold
const MIN_PERIM_NORM   = 0.02;  // reject contours shorter than this (normalized)

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Builds a clean contour path for a single region.
 *
 * @param {Object} region      — { path_points, color, area_mm2, perimeter_mm, ... }
 * @param {Array}  allRegions  — sibling regions (for outer/inner + cartoon detection)
 * @param {Object} options     — { epsilon, forceRun }
 * @returns {Object|null}      — contour object or null if invalid
 */
export function buildContourPath(region, allRegions = [], options = {}) {
  if (!region || !region.path_points) return null;
  const pts = region.path_points;
  if (pts.length < MIN_CONTOUR_PTS) return null;

  const epsilon = options.epsilon ?? RDP_EPSILON;

  // 1. Clean perimeter — dedupe + remove collinear points
  let contour = dedupePoints(pts);
  if (contour.length < MIN_CONTOUR_PTS) return null;

  // 2. Close gaps — if first/last are far apart, close the polygon
  contour = ensureClosed(contour);

  // 3. Simplify — RDP to remove redundant points while preserving shape
  contour = rdpSimplify(contour, epsilon);
  if (contour.length < MIN_CONTOUR_PTS) return null;

  // 4. Smooth minor noise — light Chaikin pass (1 iteration)
  contour = chaikinOnce(contour);
  if (contour.length < MIN_CONTOUR_PTS) return null;

  // 5. Re-close after smoothing (Chaikin can drift endpoints)
  contour = ensureClosed(contour);

  // 5b. EDGE SNAP — align to the REAL visible border in the original image.
  //    The fill mask boundary drifts from the true edge due to color
  //    quantization and anti-aliasing. This searches ±4px along the local
  //    normal for the strongest Sobel gradient and snaps to it.
  let alignment = null;
  if (options.edgeMap) {
    contour = snapContourToEdges(contour, options.edgeMap, {
      searchRadius: options.searchRadius,
      threshold: options.snapThreshold,
    });
    alignment = measureContourAlignment(contour, options.edgeMap);
    contour = ensureClosed(contour);
    if (contour.length < MIN_CONTOUR_PTS) return null;
  }

  // 6. Validate
  const validation = validateContour(contour);
  if (!validation.valid) {
    console.log(`[contour] rejected noisy contour for ${region.id || region.name}: ${validation.reason}`);
    return null;
  }

  // 7. Classify outer vs inner
  const contourType = options.forceRun ? 'run' : classifyContourType(region, allRegions);

  // 8. Cartoon border detection
  const cartoon = detectCartoonBorder(region, allRegions);

  // 9. Width estimation
  const contour_width_mm = cartoon ? cartoon.borderWidth : estimateWidth(region, contourType);

  // 10. Color resolution
  const contour_color = resolveContourColor(region, cartoon);

  // 11. Confidence — geometric + edge alignment
  let confidence = validation.confidence;
  if (alignment) {
    // Blend: 70% geometric, 30% edge alignment
    confidence = Math.round(confidence * 0.7 + alignment.alignmentScore * 0.3);
  }

  return {
    contour_points: contour,
    closed: contourType !== 'run',
    contour_width_mm,
    contour_color,
    contour_type: contourType,
    confidence,
    edge_alignment: alignment,
  };
}

/**
 * Builds contours for all regions in a batch.
 *
 * Pipeline:
 *   1. Build raw contour per region (clean + snap + validate)
 *   2. Deduplicate near-identical contours
 *   3. Merge nearby aligned fragments
 *   4. Score + classify each candidate (outer_silhouette | inner_detail | decorative_line | noise)
 *   5. Accept/reject based on thresholds (75+ general, 55+ outer/important detail)
 *   6. Suppress clusters of micro-fragments
 *
 * Returns { contours (accepted only), noiseRejectedContours, report }
 */
export function buildContoursForRegions(regions, options = {}) {
  const input = regions.length;
  const rawContours = new Map();
  let preRejected = 0;

  // ── 1. Build raw candidates ─────────────────────────────────────────────
  for (const region of regions) {
    const contour = buildContourPath(region, regions, options);
    if (contour) {
      rawContours.set(region.id, contour);
    } else {
      preRejected++;
    }
  }

  // ── 2. Deduplicate ──────────────────────────────────────────────────────
  const deduped = deduplicateContours(rawContours, regions);
  const duplicatesRemoved = rawContours.size - deduped.size;

  // ── 3. Merge nearby fragments ───────────────────────────────────────────
  const candidates = [...deduped.entries()].map(([id, contour]) => ({
    id, contour, region: regions.find(r => r.id === id) || {},
  }));
  const merged = mergeFragments(candidates);

  // ── 4+5+6. Score, classify, accept/reject ───────────────────────────────
  const allContours = merged.map(c => c.contour);
  const accepted = new Map();
  const noiseRejectedContours = [];

  let outerAccepted = 0, innerAccepted = 0, decorativeAccepted = 0, noiseRejected = 0;

  for (const { id, contour, region } of merged) {
    const result = scoreAndClassifyContour(contour, region, regions, options.edgeMap, allContours);

    if (result.accepted) {
      // Use a stable id: original region id, or generated for merged
      const finalId = id || `merged_${Math.random().toString(36).slice(2, 7)}`;
      accepted.set(finalId, result.contour);
      if (result.contourClass === 'outer_silhouette') outerAccepted++;
      else if (result.contourClass === 'inner_detail') innerAccepted++;
      else if (result.contourClass === 'decorative_line') decorativeAccepted++;
    } else {
      noiseRejectedContours.push({
        id,
        score: result.score,
        contourClass: result.contourClass,
        reason: result.reason,
        contourColor: contour.contour_color,
        pointCount: contour.contour_points.length,
      });
      noiseRejected++;
    }
  }

  // ── Required logs ───────────────────────────────────────────────────────
  console.log(`[contour] candidates total: ${input}`);
  console.log(`[contour] outer silhouette accepted: ${outerAccepted}`);
  console.log(`[contour] inner detail accepted: ${innerAccepted}`);
  console.log(`[contour] decorative lines accepted: ${decorativeAccepted}`);
  console.log(`[contour] noise rejected: ${noiseRejected} (pre-validation: ${preRejected}, duplicates: ${duplicatesRemoved})`);
  console.log(`[contour] contour scores: ${[...accepted.values()].map(c => c.contour_class + ':' + c.score).join(', ') || 'none'}`);
  console.log(`[contour] final visible contours: ${accepted.size}`);

  const alignments = [...accepted.values()].filter(c => c.edge_alignment);
  if (alignments.length > 0) {
    const avgAlign = (alignments.reduce((s, c) => s + c.edge_alignment.alignmentScore, 0) / alignments.length).toFixed(0);
    console.log(`[contour] edge alignment: avg ${avgAlign}/100 across ${alignments.length} contours`);
  }

  return {
    contours: accepted,
    noiseRejectedContours,
    duplicatesRemoved,
    report: {
      candidatesTotal: input,
      outerSilhouetteAccepted: outerAccepted,
      innerDetailAccepted: innerAccepted,
      decorativeAccepted,
      noiseRejected,
      preRejected,
      finalVisible: accepted.size,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PERIMETER CLEANING
// ═══════════════════════════════════════════════════════════════════════════

function dedupePoints(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-5) {
      out.push([p[0], p[1]]);
    }
  }
  // Remove last if identical to first (will re-close later)
  if (out.length > 1) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-5) out.pop();
  }
  return out;
}

function ensureClosed(pts) {
  if (pts.length < 3) return pts;
  const f = pts[0], l = pts[pts.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) > CLOSE_TOL) {
    return [...pts, [f[0], f[1]]];
  }
  return pts;
}

// ─── RDP simplification (Douglas-Peucker) ────────────────────────────────────

function rdpSimplify(pts, epsilon) {
  if (pts.length < 4) return pts;
  // Find point with max distance from line (first, last)
  const [first, last] = [pts[0], pts[pts.length - 1]];
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDistance(pts[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function pointLineDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const projX = a[0] + t * dx, projY = a[1] + t * dy;
  return Math.hypot(p[0] - projX, p[1] - projY);
}

// ─── Chaikin smoothing (1 pass) ──────────────────────────────────────────────

function chaikinOnce(pts) {
  if (pts.length < 4) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    out.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
    out.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateContour(pts) {
  if (pts.length < MIN_CONTOUR_PTS) return { valid: false, reason: 'puntos insuficientes' };

  // Closed check
  const f = pts[0], l = pts[pts.length - 1];
  const isClosed = Math.hypot(f[0] - l[0], f[1] - l[1]) < CLOSE_TOL;
  if (!isClosed) return { valid: false, reason: 'contorno no cerrado' };

  // Bbox valid
  const bbox = computeBbox(pts);
  if (bbox.w < 0.005 || bbox.h < 0.005) return { valid: false, reason: 'bbox degenerado' };

  // Min perimeter
  const perim = perimeter(pts);
  if (perim < MIN_PERIM_NORM) return { valid: false, reason: 'perímetro demasiado corto' };

  // Self-intersections (capped)
  if (hasSelfIntersections(pts, 50)) return { valid: false, reason: 'auto-intersección' };

  // Confidence: based on point count, closure, clean geometry
  let conf = 100;
  if (pts.length < 5) conf -= 15;
  if (pts.length > 400) conf -= 10;
  if (!isClosed) conf -= 20;
  const aspect = bbox.w / Math.max(bbox.h, 0.001);
  if (aspect > 20 || aspect < 0.05) conf -= 10;

  return { valid: true, confidence: Math.max(0, Math.min(100, Math.round(conf))) };
}

// ═══════════════════════════════════════════════════════════════════════════
//  OUTER / INNER CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A region is 'inner' if its bbox is fully contained within another region's
 * bbox AND that region is significantly larger. Otherwise 'outer'.
 */
function classifyContourType(region, allRegions) {
  const bbox = computeBbox(region.path_points);
  for (const other of allRegions) {
    if (other.id === region.id) continue;
    const ob = computeBbox(other.path_points);
    const otherArea = (other.area_norm || shoelaceArea(other.path_points)) || 0;
    const myArea = region.area_norm || shoelaceArea(region.path_points) || 0;
    // Contained?
    if (bbox.minX >= ob.minX && bbox.maxX <= ob.maxX &&
        bbox.minY >= ob.minY && bbox.maxY <= ob.maxY &&
        otherArea > myArea * 1.5) {
      return 'inner';
    }
  }
  return 'outer';
}

// ═══════════════════════════════════════════════════════════════════════════
//  CARTOON BLACK-BORDER DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detects cartoon-style black borders: a dark region surrounds a
 * light/saturated compact region. Returns { isCartoon, borderColor, borderWidth }.
 *
 * Heuristic:
 *   - This region's fill is light or saturated (not dark itself)
 *   - A dark sibling region (lum < 60) exists whose bbox contains this region
 *   - This region is compact (not a thin line)
 */
function detectCartoonBorder(region, allRegions) {
  const { r, g, b } = hexToRgb(region.color || region.hex || '#888888');
  const lum = (r + g + b) / 3;
  const delta = Math.max(r, g, b) - Math.min(r, g, b);
  const isDarkFill = lum < 60;

  // If the fill itself is dark, it's likely the border, not a bordered shape
  if (isDarkFill) return null;

  const bbox = computeBbox(region.path_points);
  const area = region.area_norm || shoelaceArea(region.path_points) || 0;
  const perim = perimeter(region.path_points);
  const compactness = perim > 0 ? (4 * Math.PI * area) / (perim * perim) : 0;
  if (compactness < 0.15) return null; // too thin/elongated

  // Find a dark sibling region that surrounds this one
  for (const other of allRegions) {
    if (other.id === region.id) continue;
    const oc = hexToRgb(other.color || other.hex || '#888888');
    const oLum = (oc.r + oc.g + oc.b) / 3;
    if (oLum > 60) continue; // not dark

    const ob = computeBbox(other.path_points);
    // Dark region must surround this region's bbox
    const surrounds =
      ob.minX <= bbox.minX + 0.01 && ob.maxX >= bbox.maxX - 0.01 &&
      ob.minY <= bbox.minY + 0.01 && ob.maxY >= bbox.maxY - 0.01;
    if (!surrounds) continue;

    // Estimate border width: half the gap between bboxes
    const gapX = Math.min(ob.maxX - bbox.maxX, bbox.minX - ob.minX);
    const gapY = Math.min(ob.maxY - bbox.maxY, bbox.minY - ob.minY);
    const gapNorm = Math.max(0, Math.min(gapX, gapY));
    // Convert normalized gap to mm (assume 100mm design width if unknown)
    const widthMm = Math.max(0.8, Math.min(4.0, gapNorm * 100));

    return {
      isCartoon: true,
      borderColor: other.color || other.hex || '#1a1a1a',
      borderWidth: widthMm,
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WIDTH + COLOR
// ═══════════════════════════════════════════════════════════════════════════

function estimateWidth(region, contourType) {
  // Use region's mean_width if available (from regionBuilder enrichment)
  if (region.mean_width_mm && region.mean_width_mm > 0.5 && region.mean_width_mm < 8) {
    return Math.max(0.8, Math.min(3.0, region.mean_width_mm * 0.3));
  }
  return contourType === 'inner' ? INNER_WIDTH_MM : DEFAULT_WIDTH_MM;
}

function resolveContourColor(region, cartoon) {
  // Priority: cartoon border color > region.contourColor > dark fill > black
  if (cartoon) return cartoon.borderColor;
  if (region.contourColor) return region.contourColor;

  const { r, g, b } = hexToRgb(region.color || region.hex || '#888888');
  const lum = (r + g + b) / 3;
  // If fill is very dark, use the fill color as contour (it's already dark)
  if (lum < 60) return region.color || '#1a1a1a';

  // Default: black contour for light fills
  return '#1a1a1a';
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════

function deduplicateContours(contours, regions) {
  const entries = [...contours.entries()];
  const keep = new Map();

  for (const [id, contour] of entries) {
    const region = regions.find(r => r.id === id);
    if (!region) { keep.set(id, contour); continue; }

    const isDup = [...keep.entries()].some(([otherId, otherContour]) => {
      const otherRegion = regions.find(r => r.id === otherId);
      if (!otherRegion) return false;
      return contoursAreDuplicates(contour, otherContour, region, otherRegion);
    });

    if (!isDup) keep.set(id, contour);
  }
  return keep;
}

function contoursAreDuplicates(a, b, regionA, regionB) {
  // Same color + similar bbox + similar area
  if (a.contour_color !== b.contour_color) return false;
  const ba = computeBbox(a.contour_points);
  const bb = computeBbox(b.contour_points);
  const iou = bboxIoU(ba, bb);
  if (iou < 0.85) return false;
  const areaA = shoelaceArea(a.contour_points);
  const areaB = shoelaceArea(b.contour_points);
  if (Math.min(areaA, areaB) / Math.max(areaA, areaB) < 0.8) return false;
  return true;
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

function perimeter(pts) {
  let p = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    p += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return p;
}

function shoelaceArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

function bboxIoU(a, b) {
  const ix = Math.max(a.minX, b.minX), iy = Math.max(a.minY, b.minY);
  const ix2 = Math.min(a.maxX, b.maxX), iy2 = Math.min(a.maxY, b.maxY);
  const iw = Math.max(0, ix2 - ix), ih = Math.max(0, iy2 - iy);
  const inter = iw * ih;
  const ua = a.w * a.h + b.w * b.h - inter;
  return ua > 0 ? inter / ua : 0;
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