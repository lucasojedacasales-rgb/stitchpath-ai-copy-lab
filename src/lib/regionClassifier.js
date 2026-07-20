/**
 * regionClassifier.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Classifies regions into semantic embroidery classes that drive stitch type
 * selection and sewing order.
 *
 * Classes:
 *   outer_outline     — exterior silhouette of the character
 *   inner_outline     — internal border between high-contrast regions
 *   detail_run        — thin lines: mouth, eyebrow, facial line → run stitch
 *   detail_satin      — narrow but wide enough for satin column
 *   micro_fill        — small closed detail with enough area to fill
 *   decorative_detail — other small preserved detail
 *   fill              — standard large fill region (unchanged)
 *
 * Public API:
 *   classifyRegionNew(region, allRegions)  → { class, stitchType, reason }
 *   classifyAllRegions(regions, config)    → { regions, report }
 */

const DARK_LUM_THRESHOLD = 60;

// ─── Color / geometry helpers (local — avoids circular imports) ───────────────

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

function computeBbox(pts) {
  if (!pts || pts.length === 0) return { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5, w: 0, h: 0 };
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function bboxContains(outer, inner) {
  return inner.minX >= outer.minX - 0.02 && inner.maxX <= outer.maxX + 0.02 &&
         inner.minY >= outer.minY - 0.02 && inner.maxY <= outer.maxY + 0.02;
}

function colorDistance(c1, c2) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// ─── Classification logic ──────────────────────────────────────────────────────

/**
 * Determines if a region is the outer silhouette of the character.
 * Heuristic: largest bounding box, dark color, surrounds other fills.
 */
function isOuterOutline(region, allRegions) {
  const color = region.color || region.hex || '#888888';
  const lum = luminance(color);
  if (lum >= DARK_LUM_THRESHOLD) return false;

  const bbox = computeBbox(region.path_points || []);
  if (bbox.w <= 0) return false;

  // Count fills contained within this region
  let containedFills = 0;
  let containedArea = 0;
  for (const other of allRegions) {
    if (other.id === region.id) continue;
    const ob = computeBbox(other.path_points || []);
    if (ob.w <= 0) continue;
    if (bboxContains(bbox, ob)) {
      containedFills++;
      containedArea += other.area_mm2 || 0;
    }
  }

  const myArea = region.area_mm2 || 0;
  // Outer outline surrounds multiple fills and its area is comparable to contained fills
  if (containedFills >= 2 && containedArea > 0.3 * myArea) return true;
  // Or: it's the largest dark region and surrounds at least 1 fill
  if (containedFills >= 1 && myArea > 100) return true;
  return false;
}

/**
 * Determines if a region is an inner outline (border between high-contrast regions).
 */
function isInnerOutline(region, allRegions) {
  const color = region.color || region.hex || '#888888';
  const lum = luminance(color);
  if (lum >= DARK_LUM_THRESHOLD) return false;

  const bbox = computeBbox(region.path_points || []);
  if (bbox.w <= 0) return false;
  const myArea = region.area_mm2 || 0;
  if (myArea > 150) return false; // inner outlines are small

  // Check if it sits between two high-contrast regions
  let neighborCount = 0;
  for (const other of allRegions) {
    if (other.id === region.id) continue;
    const ob = computeBbox(other.path_points || []);
    if (ob.w <= 0) continue;
    // Check proximity (bbox overlap or adjacency)
    const overlap = Math.max(0, Math.min(bbox.maxX, ob.maxX) - Math.max(bbox.minX, ob.minX)) *
                    Math.max(0, Math.min(bbox.maxY, ob.maxY) - Math.max(bbox.minY, ob.minY));
    if (overlap > 0 || bboxContains(ob, bbox)) {
      const otherColor = other.color || other.hex || '#888888';
      if (colorDistance(color, otherColor) > 80) neighborCount++;
    }
  }
  return neighborCount >= 2;
}

/**
 * Determines if a region is a thin detail line (mouth, eyebrow, facial line).
 */
function isDetailLine(region) {
  const meanWidth = region.mean_width_mm || 0;
  const skeleton = region.skeleton_length_mm || 0;
  const area = region.area_mm2 || 0;

  if (meanWidth <= 0 || skeleton <= 0) return false;

  // Thin: width < 2mm, elongated: skeleton/width > 3
  if (meanWidth < 2.0 && skeleton / meanWidth > 3) return true;

  // Very small curved region
  if (area < 30 && (region.mean_curvature || 0) > 0.25) return true;

  return false;
}

/**
 * Determines if a region is a narrow detail suitable for satin.
 */
function isDetailSatin(region) {
  const meanWidth = region.mean_width_mm || 0;
  const maxWidth = region.max_width_mm || 0;
  const area = region.area_mm2 || 0;

  // Narrow but wide enough for satin column (0.8mm – 4mm)
  if (meanWidth >= 0.8 && meanWidth <= 4.0 && area < 100) return true;
  // Slightly wider but still narrow
  if (maxWidth > 0.8 && maxWidth < 5.0 && area < 80) return true;
  return false;
}

/**
 * Determines if a region is a small closed detail with enough area to fill.
 */
function isMicroFill(region) {
  const area = region.area_mm2 || 0;
  const meanWidth = region.mean_width_mm || 0;
  // Small closed area, wide enough to fill
  return area >= 5 && area <= 50 && meanWidth >= 2.0;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Classifies a single region into a new semantic class.
 * Respects detailPreserved flag from detailPreservation.js.
 */
export function classifyRegionNew(region, allRegions = []) {
  // If already classified as a contour type, respect it
  if (region.type === 'contour' || region.stitch_type === 'running_stitch') {
    if (region.contour_class === 'outer_silhouette') {
      return { class: 'outer_outline', stitchType: 'running_stitch', reason: 'Contorno exterior preservado' };
    }
    return { class: 'inner_outline', stitchType: 'running_stitch', reason: 'Contorno interno preservado' };
  }

  // Preserved detail → classify by geometry
  if (region.detailPreserved) {
    if (isDetailLine(region)) {
      return { class: 'detail_run', stitchType: 'running_stitch', reason: 'Línea fina preservada (boca/cExp/facial) → run stitch' };
    }
    if (isDetailSatin(region)) {
      return { class: 'detail_satin', stitchType: 'satin', reason: 'Detalle estrecho preservado → satin column' };
    }
    if (isMicroFill(region)) {
      return { class: 'micro_fill', stitchType: 'fill', reason: 'Detalle cerrado pequeño preservado → micro fill' };
    }
    return { class: 'decorative_detail', stitchType: 'running_stitch', reason: 'Detalle decorativo preservado → run stitch' };
  }

  // Non-preserved regions: check for outline roles
  if (isOuterOutline(region, allRegions)) {
    return { class: 'outer_outline', stitchType: 'running_stitch', reason: 'Contorno exterior del personaje' };
  }
  if (isInnerOutline(region, allRegions)) {
    return { class: 'inner_outline', stitchType: 'running_stitch', reason: 'Contorno interno entre regiones de alto contraste' };
  }

  // Default: standard fill
  return { class: 'fill', stitchType: region.stitch_type || 'fill', reason: 'Región de relleno estándar' };
}

/**
 * Priority assignment based on class (lower = sewn first):
 *   fill             → 2 (large fills first)
 *   micro_fill       → 4 (after large fills)
 *   detail_run       → 5 (mouth, facial lines — on top of fills)
 *   detail_satin     → 5
 *   decorative_detail→ 5
 *   inner_outline    → 6 (after details)
 *   outer_outline    → 7 (last — maximum definition)
 */
function priorityForClass(cls) {
  switch (cls) {
    case 'fill':              return 2;
    case 'micro_fill':        return 4;
    case 'detail_run':        return 5;
    case 'detail_satin':      return 5;
    case 'decorative_detail': return 5;
    case 'inner_outline':     return 6;
    case 'outer_outline':     return 7;
    default:                  return 3;
  }
}

/**
 * Classifies all regions and assigns region_class, adjusted stitch_type, and priority.
 */
export function classifyAllRegions(regions, config = {}) {
  const classified = regions.map(r => {
    const { class: cls, stitchType, reason } = classifyRegionNew(r, regions);
    const priority = priorityForClass(cls);
    console.log(`[region-classifier] ${r.name || r.id}: class=${cls} stitch=${stitchType} priority=${priority}`);
    return {
      ...r,
      region_class: cls,
      stitch_type: stitchType,
      classification_reason: reason,
      priority,
    };
  });

  const classCounts = {};
  for (const r of classified) {
    classCounts[r.region_class] = (classCounts[r.region_class] || 0) + 1;
  }

  console.log('[region-classifier] class distribution:', classCounts);

  return {
    regions: classified,
    report: {
      total: classified.length,
      classCounts,
      classes: classified.map(r => ({
        id: r.id,
        name: r.name,
        class: r.region_class,
        stitchType: r.stitch_type,
        priority: r.priority,
        reason: r.classification_reason,
      })),
    },
  };
}