/**
 * stitchCount.js — Canonical physical stitch count estimation.
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for region stitch counts. All panels/planners/cleanup
 * must import this so counts never diverge between canvas, planner and export.
 *
 * Physical model (matches backend calcularStitchCount + regionBuilder):
 *   Fill (tatami):   rows = area / (rowSpacing × stitchLength); stitchLength = 2.4mm
 *   Satin:           columns = (perimeter/2) / density — one needle pass per column
 *   Running:         one stitch per 1.8mm of perimeter
 *
 * @param {Object} region                  — { stitch_type, area_mm2, perimeter_mm, density, coverage }
 * @param {number} [densityOverride]       — explicit density (used by regionBuilder's adaptive path)
 * @param {Object} [dims]                  — { w, h } in mm, used only for coverage→area fallback
 * @returns {number}
 */
export function computeStitchCount(region, densityOverride, dims = {}) {
  if (!region) return 0;
  const w = dims.w || 100;
  const h = dims.h || 100;
  const area  = region.area_mm2 || ((region.coverage || 0.01) * w * h);
  const perim = region.perimeter_mm || (Math.sqrt(Math.max(area, 0.1)) * 3.8);
  const dens  = Math.max(0.2, densityOverride ?? region.density ?? 0.4);
  const type  = region.stitch_type || 'fill';

  if (type === 'fill')    return Math.round(area / (dens * 2.4));
  if (type === 'satin')   return Math.round(Math.max(1, (perim / 2) / dens));
  return Math.round(perim / 1.8);
}