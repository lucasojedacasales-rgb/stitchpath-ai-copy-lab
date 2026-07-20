/**
 * centerlineExtractor.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts centerlines from thin/curved detail regions (mouth, eyebrows,
 * facial lines) and converts them to run stitch paths.
 *
 * For regions too thin to be bordable (< 0.35mm visual width), expands
 * the stitch path to a minimum bordable width WITHOUT changing the
 * original region shape.
 *
 * Public API:
 *   extractCenterline(region)              → [x,y][] centerline points
 *   convertDetailToRunStitch(region, opts) → { path, passes, stitchLength, expandedWidth }
 *   processDetailRegions(regions, config)  → { regions, report }
 */

const MIN_BORDABLE_WIDTH_MM = 0.4;   // minimum visual width for embroidery
const DETAIL_STITCH_LENGTH_MM = 1.4;  // 1.0–1.8mm range, midpoint
const DETAIL_MIN_WIDTH_MM = 0.35;

// ─── Centerline extraction ─────────────────────────────────────────────────────

/**
 * Extracts the centerline of a thin region using PCA projection + binning.
 * For curved shapes, uses a local marching approach that follows the curve.
 *
 * @param {Object} region — enriched region with path_points + geometry metrics
 * @returns {[number,number][]} centerline points in normalized [0–1] coords
 */
export function extractCenterline(region) {
  const pts = region.path_points || [];
  if (pts.length < 3) return pts.length >= 2 ? pts : [];

  const orientation = region.orientation ?? computeOrientation(pts);
  const meanWidth = region.mean_width_mm || 0;

  // For very thin regions (width < 1.5mm), the boundary IS essentially the centerline.
  // Just use the polygon points directly, ordered along the principal axis.
  if (meanWidth > 0 && meanWidth < 1.5) {
    return orderPointsAlongAxis(pts, orientation);
  }

  // For wider thin regions, use PCA-binned centroid extraction
  return binnedCenterline(pts, orientation);
}

function computeOrientation(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return ((angle * 180) / Math.PI + 180) % 180;
}

function orderPointsAlongAxis(pts, orientationDeg) {
  const rad = (orientationDeg * Math.PI) / 180;
  const axisX = Math.cos(rad), axisY = Math.sin(rad);
  return [...pts].sort((a, b) => (a[0] * axisX + a[1] * axisY) - (b[0] * axisX + b[1] * axisY));
}

function binnedCenterline(pts, orientationDeg) {
  const rad = (orientationDeg * Math.PI) / 180;
  const axisX = Math.cos(rad), axisY = Math.sin(rad);
  const perpX = -axisY, perpY = axisX;

  const proj = pts.map(p => p[0] * axisX + p[1] * axisY);
  const perps = pts.map(p => p[0] * perpX + p[1] * perpY);

  const minProj = Math.min(...proj);
  const maxProj = Math.max(...proj);
  const range = maxProj - minProj;
  if (range < 1e-6) return [pts[0]];

  const SLICES = Math.max(8, Math.min(30, Math.round(range * 100)));
  const step = range / SLICES;

  const centerline = [];
  for (let s = 0; s < SLICES; s++) {
    const lo = minProj + s * step;
    const hi = lo + step;
    const inSlice = [];
    for (let i = 0; i < pts.length; i++) {
      if (proj[i] >= lo && proj[i] < hi) inSlice.push(i);
    }
    if (inSlice.length < 1) continue;

    const meanProj = inSlice.reduce((s, i) => s + proj[i], 0) / inSlice.length;
    const meanPerp = inSlice.reduce((s, i) => s + perps[i], 0) / inSlice.length;
    centerline.push([
      meanProj * axisX + meanPerp * perpX,
      meanProj * axisY + meanPerp * perpY,
    ]);
  }

  return centerline;
}

// ─── Detail → run stitch conversion ────────────────────────────────────────────

/**
 * Converts a detail region into a run stitch path.
 * - Extracts centerline
 * - If too thin, notes expansion for embroidery (shape unchanged)
 * - Determines number of passes (1 for very thin, 2 for more presence)
 *
 * @param {Object} region — enriched region
 * @param {Object} opts   — { widthMm, heightMm }
 * @returns {{ path, passes, stitchLength, expandedWidth, originalWidth }}
 */
export function convertDetailToRunStitch(region, opts = {}) {
  const widthMm = opts.widthMm || 100;
  const heightMm = opts.heightMm || 100;

  const centerline = extractCenterline(region);
  if (centerline.length < 2) return null;

  // Convert normalized → mm
  const pathMm = centerline.map(([nx, ny]) => [(nx - 0.5) * widthMm, (ny - 0.5) * heightMm]);

  const originalWidth = region.mean_width_mm || 0;
  const needsExpansion = originalWidth > 0 && originalWidth < MIN_BORDABLE_WIDTH_MM;
  const expandedWidth = needsExpansion ? MIN_BORDABLE_WIDTH_MM : originalWidth;

  // Passes: 1 for very thin lines, 2 if needs more visual presence
  const passes = (originalWidth > 0 && originalWidth < 0.6) ? 1 : 2;

  // Stitch length: 1.0–1.8mm, use 1.4mm as default
  const stitchLength = DETAIL_STITCH_LENGTH_MM;

  console.log(`[stitch-detail] ${region.name || region.id}: centerline pts=${pathMm.length} passes=${passes} width=${originalWidth}→${expandedWidth}mm`);

  return {
    path: pathMm,
    normalizedPath: centerline,
    passes,
    stitchLength,
    originalWidth,
    expandedWidth,
    needsExpansion,
    color: region.color || region.hex || '#1a1a1a',
  };
}

// ─── Batch processing ──────────────────────────────────────────────────────────

/**
 * Processes all detail_run / detail_satin regions, converting them to
 * run stitch paths. Preserves original region geometry; only adds
 * centerline + run stitch metadata.
 *
 * @param {Array}  regions — classified regions
 * @param {Object} config  — { width_mm, height_mm }
 * @returns {{ regions, report }}
 */
export function processDetailRegions(regions, config = {}) {
  const widthMm = config.width_mm || 100;
  const heightMm = config.height_mm || 100;

  const processed = regions.map(r => {
    if (r.region_class !== 'detail_run' && r.region_class !== 'decorative_detail') return r;

    const result = convertDetailToRunStitch(r, { widthMm, heightMm });
    if (!result) return r;

    return {
      ...r,
      // Replace path_points with the centerline so buildStitchObjects + the
      // export pipeline stitch the CENTERLINE (not the polygon boundary).
      // The original polygon is preserved in original_path_points for rendering.
      original_path_points: r.path_points,
      path_points: result.normalizedPath.length >= 3 ? result.normalizedPath : r.path_points,
      centerline: result.normalizedPath,
      centerline_mm: result.path,
      run_passes: result.passes,
      run_stitch_length: result.stitchLength,
      original_width_mm: result.originalWidth,
      bordable_width_mm: result.expandedWidth,
      needs_expansion: result.needsExpansion,
    };
  });

  const detailCount = processed.filter(r => r.centerline).length;
  console.log(`[stitch-detail] detail regions converted to run stitch: ${detailCount}`);

  return {
    regions: processed,
    report: {
      totalDetails: detailCount,
      details: processed
        .filter(r => r.centerline)
        .map(r => ({
          id: r.id,
          name: r.name,
          centerlinePoints: r.centerline.length,
          passes: r.run_passes,
          originalWidth: r.original_width_mm,
          bordableWidth: r.bordable_width_mm,
          expanded: r.needs_expansion,
          color: r.color,
        })),
    },
  };
}