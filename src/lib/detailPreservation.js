/**
 * detailPreservation.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Scores every region for visual importance (detailScore 0–100) and prevents
 * destruction of small but visually critical details (mouth, eyes, facial
 * lines, outlines).
 *
 * A region is PRESERVED if detailScore >= 55 AND it meets at least 2 of:
 *   - high contrast with surrounding fill
 *   - elongated / curved shape (mouth, eyebrow, facial line)
 *   - contained within a large principal region
 *   - dark or very distinct from local background
 *   - near visual center of character
 *
 * Public API:
 *   computeDetailScore(region, allRegions)  → { score, reasons, containingFill }
 *   preserveDetails(regions, config)        → { regions, report }
 */

const DETAIL_PRESERVE_THRESHOLD = 55;
const MIN_CONDITIONS_MET = 2;

// ─── Color helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 128,
    g: parseInt(h.slice(2, 4), 16) || 128,
    b: parseInt(h.slice(4, 6), 16) || 128,
  };
}

function colorDistance(c1, c2) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

// ─── Geometry helpers ──────────────────────────────────────────────────────────

function computeBbox(pts) {
  if (!pts || pts.length === 0) return { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5, w: 0, h: 0 };
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function computeOverallBbox(regions) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const r of regions) {
    const b = computeBbox(r.path_points || []);
    if (b.w <= 0) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Finds the smallest fill region that contains the given region's bbox.
 */
function findContainingFill(region, allRegions) {
  const bbox = computeBbox(region.path_points || []);
  if (bbox.w <= 0) return null;
  const myArea = region.area_mm2 || 0;
  let best = null, bestArea = Infinity;

  for (const other of allRegions) {
    if (other.id === region.id) continue;
    const ob = computeBbox(other.path_points || []);
    if (ob.w <= 0) continue;
    // Check containment (with small tolerance)
    const contained =
      bbox.minX >= ob.minX - 0.02 && bbox.maxX <= ob.maxX + 0.02 &&
      bbox.minY >= ob.minY - 0.02 && bbox.maxY <= ob.maxY + 0.02;
    if (!contained) continue;
    const otherArea = other.area_mm2 || 0;
    if (otherArea > myArea * 2 && otherArea < bestArea) {
      best = other;
      bestArea = otherArea;
    }
  }
  return best;
}

// ─── Shape analysis ────────────────────────────────────────────────────────────

function isElongatedOrCurved(region) {
  const skeleton = region.skeleton_length_mm || 0;
  const meanWidth = region.mean_width_mm || 0;
  if (skeleton > 0 && meanWidth > 0) {
    const ratio = skeleton / meanWidth;
    if (ratio > 3) return true; // elongated line shape
  }
  // Curved shapes (mouth, smile) have high curvature
  if ((region.mean_curvature || 0) > 0.25) return true;
  // Low convexity + small area → curved detail
  if ((region.convexity || 1) < 0.6 && (region.area_mm2 || 0) < 50) return true;
  return false;
}

// ─── Detail score computation ──────────────────────────────────────────────────

/**
 * Computes a detailScore (0–100) for a region.
 * Evaluates 5 conditions; each contributes points.
 * A region is a candidate for preservation if it meets >= 2 conditions.
 *
 * @returns {{ score, reasons, conditionsMet, containingFill }}
 */
export function computeDetailScore(region, allRegions = []) {
  let score = 0;
  let conditionsMet = 0;
  const reasons = [];

  const color = region.color || region.hex || '#888888';
  const area = region.area_mm2 || 0;
  const bbox = computeBbox(region.path_points || []);
  const containingFill = findContainingFill(region, allRegions);

  // Condition 1: High contrast with containing fill
  if (containingFill) {
    const contrast = colorDistance(color, containingFill.color || containingFill.hex || '#888888');
    if (contrast > 100) { score += 25; conditionsMet++; reasons.push('Alto contraste con relleno contenedor'); }
    else if (contrast > 50) { score += 15; conditionsMet++; reasons.push('Contraste medio con relleno contenedor'); }
  }

  // Condition 2: Elongated or curved shape (mouth, eyebrow, facial line)
  if (isElongatedOrCurved(region)) {
    score += 25; conditionsMet++; reasons.push('Forma alargada o curva (línea facial)');
  }

  // Condition 3: Contained within a large principal region
  if (containingFill && (containingFill.area_mm2 || 0) > 3 * area && area > 0) {
    score += 20; conditionsMet++; reasons.push('Contenido en región principal grande');
  }

  // Condition 4: Dark or very distinct from local background
  const lum = luminance(color);
  if (lum < 80) {
    score += 20; conditionsMet++; reasons.push('Color oscuro/distinto del fondo local');
  } else if (containingFill) {
    const fillLum = luminance(containingFill.color || containingFill.hex || '#888888');
    if (Math.abs(lum - fillLum) > 80) {
      score += 15; conditionsMet++; reasons.push('Color muy distinto del fondo local');
    }
  }

  // Condition 5: Near visual center of character
  const allBbox = computeOverallBbox(allRegions);
  if (allBbox.w > 0) {
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const centerDist = Math.hypot(
      cx - (allBbox.minX + allBbox.w / 2),
      cy - (allBbox.minY + allBbox.h / 2)
    );
    const diag = Math.hypot(allBbox.w, allBbox.h);
    if (diag > 0 && centerDist < diag * 0.3) {
      score += 15; conditionsMet++; reasons.push('Cerca del centro visual del personaje');
    }
  }

  score = Math.min(100, Math.round(score));

  const preserved = score >= DETAIL_PRESERVE_THRESHOLD && conditionsMet >= MIN_CONDITIONS_MET;

  console.log(`[detail-preservation] ${region.name || region.id}: score=${score} conditions=${conditionsMet} preserved=${preserved}`);

  return { score, reasons, conditionsMet, containingFill, preserved };
}

// ─── Batch processing ──────────────────────────────────────────────────────────

/**
 * Scores all regions and marks them with detailScore + preserved flag.
 * Preserved regions are NEVER removed, merged, or absorbed by fills.
 *
 * @param {Array}  regions — enriched regions
 * @param {Object} config  — { preserveAestheticDetails: boolean }
 * @returns {{ regions, report }}
 */
export function preserveDetails(regions, config = {}) {
  const enabled = config.preserveAestheticDetails !== false; // ON by default
  const threshold = enabled ? DETAIL_PRESERVE_THRESHOLD : 100; // OFF → nothing preserved by score

  const scored = regions.map(r => {
    const { score, reasons, conditionsMet, containingFill, preserved } = computeDetailScore(r, regions);
    return {
      ...r,
      detailScore: score,
      detailReasons: reasons,
      detailConditionsMet: conditionsMet,
      detailPreserved: score >= threshold && conditionsMet >= MIN_CONDITIONS_MET,
      containingFillId: containingFill?.id || null,
    };
  });

  const preservedCount = scored.filter(r => r.detailPreserved).length;
  const discardedCount = scored.length - preservedCount;

  console.log(`[detail-preservation] enabled: ${enabled}`);
  console.log(`[detail-preservation] total regions: ${scored.length}`);
  console.log(`[detail-preservation] preserved: ${preservedCount}`);
  console.log(`[detail-preservation] discarded: ${discardedCount}`);

  return {
    regions: scored,
    report: {
      enabled,
      threshold,
      total: scored.length,
      preserved: preservedCount,
      discarded: discardedCount,
      details: scored.map(r => ({
        id: r.id,
        name: r.name,
        score: r.detailScore,
        reasons: r.detailReasons,
        conditionsMet: r.detailConditionsMet,
        preserved: r.detailPreserved,
        area_mm2: r.area_mm2,
        mean_width_mm: r.mean_width_mm,
        color: r.color,
      })),
    },
  };
}