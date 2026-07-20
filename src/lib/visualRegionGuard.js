/**
 * visualRegionGuard.js — Protects the canvas visual state.
 * ─────────────────────────────────────────────────────────────────────────────
 * Visual regions (regions / vectorRegions / enrichedRegions) are the ONLY
 * source of canvas geometry. Optimized commands, simulation commands, and
 * export payloads must never replace them.
 *
 * Every update that originates from Optimize / AutoFix / Repair / Simulate
 * must pass through filterValidVisualRegions before reaching setRegions.
 * If the result has zero valid visual regions, the previous state is kept
 * so the canvas never goes blank.
 */

/**
 * A region is visually renderable only if it has a valid polygon (≥3 finite
 * points) and a color. Command arrays, stitch-only objects, or empty shapes
 * are rejected.
 */
export function isValidVisualRegion(region) {
  if (!region || typeof region !== 'object') return false;
  const pts = region.path_points;
  if (!Array.isArray(pts) || pts.length < 3) return false;
  for (const p of pts) {
    if (!Array.isArray(p) || p.length < 2) return false;
    const x = p[0], y = p[1];
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  }
  if (!region.hex && !region.color) return false;
  return true;
}

/**
 * Filters an array down to only visually-valid regions.
 * Returns [] for non-arrays or all-invalid input — callers should check
 * length and keep the previous state when it's 0.
 */
export function filterValidVisualRegions(regions) {
  if (!Array.isArray(regions)) return [];
  return regions.filter(isValidVisualRegion);
}