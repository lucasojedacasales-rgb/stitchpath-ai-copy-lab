/**
 * autoCleanup.js — Pre-export automatic cleanup for home machines (Caydo CE01).
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs two guarantees before export:
 *
 *   1. STITCH WARNING CAP (< 35,000)
 *      Recalibrated for CE01: 12,000 was too conservative; a Wilcom file accepted
 *      by the CE01 shows ~33,845 stitches. No density reduction is triggered below 35,000.
 *
 *   2. JUMP ELIMINATION (> 3.5mm → trim)
 *      Delegates to the export pipeline's R13 rule + industrial object ordering
 *      (nearest-neighbor color grouping). This guarantees every jump > 3.5mm gets
 *      a preceding trim command, so no thread drags across the design on a CE01.
 *
 * Usage:
 *   const { regions, stitchCount, applied } = autoCleanupRegions(regions, config);
 *   // then pass `regions` to runExportPipeline(...)
 */

// El límite anterior de 12000 era demasiado conservador. Se recalibra porque una muestra Wilcom funcional aceptada por CE01 contiene ~33845 puntadas.
const STITCH_CAP = 35000;

import { computeStitchCount } from './stitchCount.js';

/**
 * Canonical stitch count for a region — delegates to the shared module so
 * counts never diverge from regionBuilder / stitchPlanner / export.
 */
function regionStitchCount(r, w, h) {
  return computeStitchCount(r, undefined, { w, h });
}

/**
 * Scales fill density so total stitches < STITCH_CAP.
 * Returns { regions, stitchCount, applied }.
 */
export function autoCleanupRegions(regions, config = {}) {
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;
  const applied = [];

  // Ensure every region has a stitch_count
  let cleaned = regions.map(r => ({
    ...r,
    stitch_count: r.stitch_count > 0 ? r.stitch_count : regionStitchCount(r, w, h),
  }));

  let total = cleaned.reduce((s, r) => s + (r.stitch_count || 0), 0);

  if (total > STITCH_CAP) {
    const fillStitches    = cleaned.reduce((s, r) => s + (r.stitch_type === 'fill' ? (r.stitch_count || 0) : 0), 0);
    const nonFillStitches = total - fillStitches;

    if (fillStitches > 0) {
      // Target: leave room for non-fill stitches, distribute the cap across fills
      const targetFill = Math.max(100, STITCH_CAP - nonFillStitches);
      const scale = Math.min(1, targetFill / fillStitches); // <1 = reduce fill stitches

      cleaned = cleaned.map(r => {
        if (r.stitch_type !== 'fill') return r;
        // Wider spacing (higher density mm) → fewer stitches
        const newDens  = Math.min(0.65, (r.density || 0.4) / scale);
        const newCount = Math.round((r.stitch_count || 0) * scale);
        return { ...r, density: +newDens.toFixed(3), stitch_count: newCount };
      });

      total = nonFillStitches + cleaned.reduce((s, r) => s + (r.stitch_type === 'fill' ? (r.stitch_count || 0) : 0), 0);
      applied.push({
        action: 'stitch_cap',
        scale: +scale.toFixed(3),
        message: `Puntadas reducidas de ${fillStitches + nonFillStitches} → ${total} (densidad fill ×${(1 / scale).toFixed(2)}).`,
      });
    }
  }

  return { regions: cleaned, stitchCount: total, applied };
}