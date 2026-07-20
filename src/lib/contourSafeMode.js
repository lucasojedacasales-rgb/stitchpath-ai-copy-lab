/**
 * contourSafeMode.js — Contour Safe Mode
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates simple, clean, stable contours using ONLY the boundaries of
 * already-detected fill regions. No edgeMap, no micro-fragments, no
 * decorative_lines, no automatic internal details.
 *
 * Public API:
 *   buildSafeOutlineFromFill(region, options)           → contour object | null
 *   separateFillsAndContoursSafe(regions, config)       → { fills, contours, report }
 *
 * Principles:
 *   1. Every contour MUST come from a fill region's path_points.
 *   2. All contours are stitch_type: "run" by default.
 *   3. No contour without a valid parentRegionId.
 *   4. No contour with < 8 points, open, or too short.
 *   5. Internal details only from a whitelist: eye, mouth.
 *   6. Black border regions → converted to contour (never stay as *_negro_fill).
 *   7. No edgeMap fragments, no noise, no micro-rayas.
 */

const SAFE_RDP_EPSILON = 0.006;
const SAFE_CLOSE_TOL = 0.01;
const SAFE_MIN_PTS = 8;
const SAFE_MIN_PERIMETER = 0.12; // normalized — rejects micro-fragments
const DARK_LUM_THRESHOLD = 60;

// Whitelisted internal detail labels (case-insensitive substring match)
const DETAIL_WHITELIST = ['eye', 'mouth', 'ojo', 'boca', 'eye_detail', 'mouth_detail'];

// ═══════════════════════════════════════════════════════════════════════════
//  BUILD SAFE OUTLINE FROM FILL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Builds a clean contour object from a fill region's path_points.
 *
 * Steps: dedupe → close → RDP simplify → light Chaikin smooth → re-close.
 * Returns null if the result doesn't meet safe-mode quality bars.
 *
 * @returns {Object|null} contour object with source: "safe_fill_boundary"
 */
export function buildSafeOutlineFromFill(region, options = {}) {
  if (!region || !region.path_points) return null;
  const pts = region.path_points;
  if (pts.length < SAFE_MIN_PTS) return null;

  const epsilon = options.epsilon ?? SAFE_RDP_EPSILON;

  // 1. Dedupe (also strips closing duplicate → leaves an OPEN path)
  let contour = dedupePoints(pts);
  if (contour.length < SAFE_MIN_PTS) return null;

  // 2. Simplify on the OPEN path (RDP on a pre-closed polygon deforms contours)
  contour = rdpSimplify(contour, epsilon);
  if (contour.length < SAFE_MIN_PTS) return null;

  // 3. Light smooth (1 Chaikin pass)
  contour = chaikinOnce(contour);

  // 4. Close AFTER simplify + smooth
  contour = ensureClosed(contour);
  if (contour.length < SAFE_MIN_PTS) return null;

  // 6. Validate closed
  const first = contour[0], last = contour[contour.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > SAFE_CLOSE_TOL) return null;

  // 7. Validate minimum perimeter (rejects micro-fragments / loose rays)
  const perim = perimeterNorm(contour);
  if (perim < SAFE_MIN_PERIMETER) return null;

  const color = options.contourColor || region.contourColor || '#1a1a1a';
  const baseName = (region.name || region.object || 'body')
    .replace(/_(fill|sat|run|contour|outline|detail)$/i, '');

  return {
    id: `safe_contour_${region.id}`,
    parentRegionId: region.id,
    type: 'contour',
    stitch_type: 'running_stitch',
    contour_class: 'outer_silhouette',
    region_class: 'outer_outline',
    priority: 7,
    contour_points: contour,
    path_points: contour,
    hex: color,
    color: color,
    contour_color: color,
    contour_width_mm: 1.0,
    confidence: 75,
    source: 'safe_fill_boundary',
    closed: true,
    name: `${baseName}_outline_run`,
    visible: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SEPARATE FILLS AND CONTOURS — SAFE MODE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safe-mode separator.
 *
 * 1. Detects black border-like regions → converts to run contour (never fill).
 * 2. Detects whitelisted internal details (eye, mouth) → converts to run contour.
 * 3. Generates a safe outline from every remaining fill's path_points.
 * 4. Rejects any contour that doesn't meet safe criteria.
 *
 * No edgeMap, no micro-fragments, no decorative_lines.
 *
 * @param {Array}  regions  — enriched regions from enrichAllRegions
 * @param {Object} config   — app config (for future options)
 * @returns {{ fills, contours, report }}
 */
export function separateFillsAndContoursSafe(regions, config = {}) {
  console.log('[contour-safe] enabled: true');
  console.log(`[contour-safe] fill regions input: ${regions.length}`);

  // ── 1. Identify black border-like regions ────────────────────────────────
  // Skip regions already classified by regionClassifier (detail_run, etc.)
  // — they have their own stitch_type and should not be re-processed here.
  const skipClassified = (r) => {
    const cls = r.region_class;
    return cls && cls !== 'fill' && cls !== 'outer_outline' && cls !== 'inner_outline';
  };
  const blackCandidates = regions.filter(r => {
    if (skipClassified(r)) return false;
    const color = r.color || r.hex || '#888888';
    const { r: rr, g, b } = hexToRgb(color);
    return (rr + g + b) / 3 < DARK_LUM_THRESHOLD;
  });

  const borderRegions = blackCandidates.filter(r => isBorderLikeBlackRegion(r, regions));
  const borderIds = new Set(borderRegions.map(r => r.id));

  // ── 2. Whitelisted internal details (eye, mouth only) ────────────────────
  const remainingDark = blackCandidates.filter(r => !borderIds.has(r.id));
  const detailRegions = remainingDark.filter(r => {
    const name = (r.name || r.object || '').toLowerCase();
    const isWhitelisted = DETAIL_WHITELIST.some(w => name.includes(w));
    if (!isWhitelisted) return false;
    return isDetailLikeDarkRegion(r, regions);
  });
  const detailIds = new Set(detailRegions.map(r => r.id));

  // Details rejected = dark regions that are NOT borders and NOT whitelisted
  const detailsRejected = remainingDark.length - detailRegions.length;

  // ── 3. Remaining fills (exclude borders + whitelisted details) ───────────
  // Respect region_class + detailPreserved from the new classifier — don't
  // force everything to 'fill'. Preserved details keep their assigned stitch_type.
  const allContourIds = new Set([...borderIds, ...detailIds]);
  const fills = regions.filter(r => !allContourIds.has(r.id));
  for (const f of fills) {
    // Only force fill type for regions without a specific region_class
    if (!f.region_class || f.region_class === 'fill') {
      f.type = 'fill';
      f.stitch_type = 'fill';
    }
    f.contour = null;
  }

  // ── 4. Generate safe outlines from each fill (optional) ──────────────────
  // Synthetic outlines from fill boundaries are OFF by default — they produce
  // false coloured rays. Only enabled when config.generateSyntheticSafeOutlines === true.
  // When enabled, always uses safe black #1a1a1a — never the fill's own colour.
  const syntheticOutlines = config.generateSyntheticSafeOutlines === true;
  const contours = [];
  let outlinesGenerated = 0;
  if (syntheticOutlines) {
    for (const fill of fills) {
      const outline = buildSafeOutlineFromFill(fill, { contourColor: '#1a1a1a' });
      if (outline) {
        // Standalone contour object — do NOT assign to fill.contour (prevents double render)
        contours.push(outline);
        outlinesGenerated++;
      }
    }
  }

  // ── 5. Convert black border regions to run contours ──────────────────────
  let blackConverted = 0;
  for (const br of borderRegions) {
    const contour = convertDarkRegionToSafeContour(br, fills, 'outline');
    if (contour) {
      contours.push(contour);
      blackConverted++;
    }
  }

  // ── 6. Convert whitelisted details to run contours ───────────────────────
  let detailsAccepted = 0;
  for (const dr of detailRegions) {
    const contour = convertDarkRegionToSafeContour(dr, fills, 'detail');
    if (contour) {
      contours.push(contour);
      detailsAccepted++;
    }
  }

  // ── 7. Validate all contours against safe criteria ───────────────────────
  const safeContours = contours.filter(c => isValidSafeContour(c));
  const rejectedNoise = contours.length - safeContours.length;

  // ── 8. Deduplicate (border contour + fill outline may overlap) ───────────
  const deduped = deduplicateContourObjects(safeContours);
  const dedupRejected = safeContours.length - deduped.length;

  // ── 9. Logs (mandatory) ─────────────────────────────────────────────────
  console.log(`[contour-safe-fix] fills forced as fill: ${fills.length}`);
  console.log(`[contour-safe-fix] standalone contours: ${deduped.length}`);
  console.log(`[contour-safe-fix] synthetic outlines enabled: ${syntheticOutlines}`);
  console.log(`[contour-safe-fix] fill.contour cleared: ${fills.length}`);
  console.log(`[contour-safe-fix] outlines generated from fills: ${outlinesGenerated}`);
  console.log(`[contour-safe-fix] internal details accepted: ${detailsAccepted}`);
  console.log(`[contour-safe-fix] internal details rejected: ${detailsRejected}`);
  console.log(`[contour-safe-fix] black fill regions converted: ${blackConverted}`);
  console.log(`[contour-safe-fix] final contours: ${deduped.length}`);
  console.log(`[contour-safe-fix] contour names: ${deduped.map(c => c.name).join(', ') || 'none'}`);

  return {
    fills,
    contours: deduped,
    report: {
      mode: 'safe',
      fillRegionsInput: regions.length,
      outlinesFromFills: outlinesGenerated,
      blackBordersConverted: blackConverted,
      detailsAccepted,
      detailsRejected,
      rejectedNoise: rejectedNoise + dedupRejected,
      finalFillObjects: fills.length,
      finalContourObjects: deduped.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SAFE CONTOUR VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A contour is safe-valid if ALL hold:
 *   - has parentRegionId
 *   - has ≥ 8 contour_points
 *   - is closed
 *   - perimeter ≥ SAFE_MIN_PERIMETER (normalized)
 *   - source starts with "safe_"
 */
function isValidSafeContour(c) {
  if (!c.parentRegionId) return false;
  if (!c.contour_points || c.contour_points.length < SAFE_MIN_PTS) return false;
  if (!c.closed) return false;
  const perim = perimeterNorm(c.contour_points);
  if (perim < SAFE_MIN_PERIMETER) return false;
  if (!c.source || !c.source.startsWith('safe_')) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONVERT DARK REGION TO SAFE CONTOUR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts a dark fill region into a safe-mode contour object.
 * Always stitch_type: "run" (no satin in safe mode).
 *
 * @param {Object}  region  — dark region (enriched)
 * @param {Array}   fills   — remaining fill regions (for parent lookup)
 * @param {String}  role    — 'outline' | 'detail'
 */
function convertDarkRegionToSafeContour(region, fills, role = 'outline') {
  const pts = region.path_points;
  if (!pts || pts.length < SAFE_MIN_PTS) return null;

  // RDP on OPEN path first (dedupe strips closing point), then close after.
  let contour = dedupePoints(pts);
  contour = rdpSimplify(contour, SAFE_RDP_EPSILON);
  contour = chaikinOnce(contour);
  contour = ensureClosed(contour);

  if (contour.length < SAFE_MIN_PTS) return null;

  // Validate closed + perimeter
  const first = contour[0], last = contour[contour.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > SAFE_CLOSE_TOL) return null;
  if (perimeterNorm(contour) < SAFE_MIN_PERIMETER) return null;

  const parent = findNearestFill(region, fills);

  // Naming: use the region's OWN name for details, parent's name for outlines
  const nameSource = role === 'detail'
    ? (region.name || region.object || 'detail')
    : (parent?.name || parent?.object || 'body');
  const baseName = nameSource.replace(/_(fill|sat|run|contour|outline|detail)$/i, '');

  const color = region.color || '#1a1a1a';

  return {
    id: `safe_contour_${region.id}`,
    parentRegionId: parent?.id || region.id,
    type: 'contour',
    stitch_type: 'running_stitch',
    contour_class: role === 'detail' ? 'inner_detail' : 'outer_silhouette',
    region_class: role === 'detail' ? 'inner_outline' : 'outer_outline',
    priority: role === 'detail' ? 6 : 7,
    contour_points: contour,
    path_points: contour,
    hex: color,
    color: color,
    contour_color: color,
    contour_width_mm: 1.0,
    confidence: role === 'detail' ? 70 : 80,
    source: role === 'detail' ? 'safe_detail_conversion' : 'safe_black_border_conversion',
    closed: true,
    name: `${baseName}_${role}_run`,
    visible: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  BORDER / DETAIL DETECTION (inline — same logic as contourFromFill.js)
// ═══════════════════════════════════════════════════════════════════════════

function isBorderLikeBlackRegion(region, allRegions = []) {
  if (!region) return false;
  const color = region.color || region.hex || '#888888';
  const { r, g, b } = hexToRgb(color);
  const lum = (r + g + b) / 3;
  if (lum >= DARK_LUM_THRESHOLD) return false;

  const area = region.area_mm2 || 0;
  if (area <= 0) return false;

  const bbox = computeBbox(region.path_points || []);
  if (bbox.w <= 0) return false;

  let borderedFillArea = 0;
  let surroundsCount = 0;
  let rimsCount = 0;

  for (const fill of allRegions) {
    if (fill.id === region.id) continue;
    const fillColor = fill.color || fill.hex || '#888888';
    const fc = hexToRgb(fillColor);
    const fillLum = (fc.r + fc.g + fc.b) / 3;
    if (fillLum < DARK_LUM_THRESHOLD) continue;

    const fb = computeBbox(fill.path_points || []);
    if (fb.w <= 0) continue;

    const fillInsideDark =
      fb.minX >= bbox.minX - 0.03 && fb.maxX <= bbox.maxX + 0.03 &&
      fb.minY >= bbox.minY - 0.03 && fb.maxY <= bbox.maxY + 0.03;
    const darkInsideFill =
      bbox.minX >= fb.minX - 0.03 && bbox.maxX <= fb.maxX + 0.03 &&
      bbox.minY >= fb.minY - 0.03 && bbox.maxY <= fb.maxY + 0.03;
    const overlap = bboxIoU(bbox, fb);

    if (fillInsideDark) {
      surroundsCount++;
      borderedFillArea += (fill.area_mm2 || 0);
    } else if (!darkInsideFill && overlap > 0.15) {
      rimsCount++;
      borderedFillArea += (fill.area_mm2 || 0) * 0.5;
    }
  }

  if (surroundsCount === 0 && rimsCount === 0) return false;
  if (area > 2.5 * borderedFillArea) return false;
  return true;
}

function isDetailLikeDarkRegion(region, allRegions = []) {
  if (!region) return false;
  const color = region.color || region.hex || '#888888';
  const { r, g, b } = hexToRgb(color);
  const lum = (r + g + b) / 3;
  if (lum >= DARK_LUM_THRESHOLD) return false;

  const area = region.area_mm2 || 0;
  if (area <= 0 || area > 120) return false;

  const bbox = computeBbox(region.path_points || []);
  if (bbox.w <= 0) return false;

  for (const fill of allRegions) {
    if (fill.id === region.id) continue;
    const fillColor = fill.color || fill.hex || '#888888';
    const fc = hexToRgb(fillColor);
    const fillLum = (fc.r + fc.g + fc.b) / 3;
    if (fillLum < DARK_LUM_THRESHOLD) continue;

    const fb = computeBbox(fill.path_points || []);
    if (fb.w <= 0) continue;

    const contained =
      bbox.minX >= fb.minX - 0.02 && bbox.maxX <= fb.maxX + 0.02 &&
      bbox.minY >= fb.minY - 0.02 && bbox.maxY <= fb.maxY + 0.02;
    const fillArea = fill.area_mm2 || 0;

    if (contained && fillArea > 3 * area) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEOMETRY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function findNearestFill(region, fills) {
  if (!fills.length) return null;
  const [cx, cy] = region.centroid || [0.5, 0.5];
  let best = null, bestDist = Infinity;
  for (const f of fills) {
    if (!f.centroid) continue;
    const d = Math.hypot(f.centroid[0] - cx, f.centroid[1] - cy);
    if (d < bestDist) { bestDist = d; best = f; }
  }
  return best;
}

function dedupePoints(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-5) {
      out.push([p[0], p[1]]);
    }
  }
  if (out.length > 1) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-5) out.pop();
  }
  return out;
}

function ensureClosed(pts) {
  if (pts.length < 3) return pts;
  const f = pts[0], l = pts[pts.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) > SAFE_CLOSE_TOL) {
    return [...pts, [f[0], f[1]]];
  }
  return pts;
}

function rdpSimplify(pts, epsilon) {
  if (pts.length < 4) return pts;
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

function perimeterNorm(pts) {
  if (!pts || pts.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    p += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return p;
}

function computeBbox(pts) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function bboxIoU(a, b) {
  const ix = Math.max(a.minX, b.minX), iy = Math.max(a.minY, b.minY);
  const ix2 = Math.min(a.maxX, b.maxX), iy2 = Math.min(a.maxY, b.maxY);
  const iw = Math.max(0, ix2 - ix), ih = Math.max(0, iy2 - iy);
  const inter = iw * ih;
  const ua = a.w * a.h + b.w * b.h - inter;
  return ua > 0 ? inter / ua : 0;
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

function deduplicateContourObjects(contours) {
  if (contours.length < 2) return contours;
  const keep = [];
  for (const c of contours) {
    const idx = keep.findIndex(k => contoursAreDuplicates(c, k));
    if (idx < 0) {
      keep.push(c);
    } else if ((c.confidence || 0) > (keep[idx].confidence || 0)) {
      keep[idx] = c;
    }
  }
  return keep;
}

function contoursAreDuplicates(a, b) {
  if (a.contour_color !== b.contour_color) return false;
  const ba = computeBbox(a.contour_points);
  const bb = computeBbox(b.contour_points);
  if (bboxIoU(ba, bb) < 0.7) return false;
  const areaA = shoelaceArea(a.contour_points);
  const areaB = shoelaceArea(b.contour_points);
  if (Math.min(areaA, areaB) / Math.max(areaA, areaB) < 0.7) return false;
  return true;
}

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 128,
    g: parseInt(h.slice(2, 4), 16) || 128,
    b: parseInt(h.slice(4, 6), 16) || 128,
  };
}