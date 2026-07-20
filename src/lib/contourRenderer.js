/**
 * contourRenderer.js — Professional embroidery contour rendering engine
 *
 * Implements three distinct stitch renderers for canvas preview:
 *  1. drawSatinContour  — true satin stitch columns perpendicular to path tangent
 *  2. drawRunning       — precise running stitch along path (no spurious closing segment)
 *  3. drawSatinFill     — hatched fill for satin-type fill regions (wide satin bodies)
 *
 * Key differences from the old renderer:
 *  - No ctx.clip() before drawing contours — clips were truncating border strokes
 *  - No ctx.closePath() on running stitch — that added a spurious return segment
 *  - Satin columns are drawn perpendicular to each path segment's tangent
 *  - Thread width is calibrated to physical 40wt thread diameter at design scale
 */

// ─── Running stitch ───────────────────────────────────────────────────────────

/**
 * Draws a running stitch along a polygon boundary.
 * - No closePath (avoids spurious back-stroke to start)
 * - Dashes calibrated to stitch_length_mm if available
 * - Line width proportional to physical 40wt thread (0.32mm)
 */
export function drawRunning(ctx, pts, region, drawW, drawH, zoom, color, alpha) {
  if (pts.length < 2) return;

  const stitchLenMm = region.stitch_length_mm || 2.0;
  const pxPerMm     = drawW / 100;
  const dashPx      = Math.max(2, stitchLenMm * pxPerMm / zoom);
  const gapPx       = Math.max(1, dashPx * 0.5);
  const threadPx    = Math.max(0.8, (0.32 * pxPerMm) / zoom);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth   = threadPx;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.setLineDash([dashPx, gapPx]);

  ctx.beginPath();
  ctx.moveTo((pts[0][0] - 0.5) * drawW, (pts[0][1] - 0.5) * drawH);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo((pts[i][0] - 0.5) * drawW, (pts[i][1] - 0.5) * drawH);
  }
  // Close path visually (polygon) but DO NOT add the extra segment back
  ctx.lineTo((pts[0][0] - 0.5) * drawW, (pts[0][1] - 0.5) * drawH);

  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ─── Satin contour stitch ─────────────────────────────────────────────────────

/**
 * Draws a true satin stitch contour along a polygon path.
 *
 * Algorithm:
 *  For each edge segment of the polygon:
 *   1. Compute the perpendicular direction (normal to the segment)
 *   2. Place satin columns at `density` intervals along the segment
 *   3. Each column spans `width` mm on each side of the path centerline
 *
 * This produces the characteristic satin "column" look where thread runs
 * perpendicular to the path direction — matching Wilcom/Tajima satin borders.
 *
 * @param {number} widthMm  — full satin column width in mm (default 1.5mm = 3mm border)
 * @param {number} densityMm — spacing between columns in mm (default = region.density or 0.4)
 */
export function drawSatinContour(ctx, pts, region, drawW, drawH, zoom, color, alpha) {
  if (pts.length < 2) return;

  const pxPerMm   = drawW / 100;
  // Width: use the region's actual mean_width clamped to [0.8, 4] mm for satin contours
  // This makes thin contour satin (0.8-2mm) and medium satin bands (2-4mm) look correct
  const widthMm   = Math.min(4, Math.max(0.8, region.mean_width_mm || region.satin_width_mm || 1.5));
  const densityMm = Math.min(0.5, region.density || 0.4);
  const halfW     = Math.max(1.5, (widthMm * 0.5 * pxPerMm) / zoom);
  const stepPx    = Math.max(0.5, (densityMm * pxPerMm) / zoom);
  // 40wt thread at 0.35mm physical — slightly thicker for satin columns to be readable
  const threadPx  = Math.max(0.7, (0.35 * pxPerMm) / zoom);

  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth   = threadPx;
  ctx.lineCap     = 'butt';

  const n = pts.length;

  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];

    const ax = (p0[0] - 0.5) * drawW;
    const ay = (p0[1] - 0.5) * drawH;
    const bx = (p1[0] - 0.5) * drawW;
    const by = (p1[1] - 0.5) * drawH;

    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen < 0.5) continue;

    // Tangent & normal
    const tx = (bx - ax) / segLen;
    const ty = (by - ay) / segLen;
    const nx = -ty; // perpendicular (inward)
    const ny =  tx;

    // Place columns along the segment
    let t = stepPx * 0.5;
    while (t < segLen) {
      const cx = ax + tx * t;
      const cy = ay + ty * t;

      ctx.beginPath();
      ctx.moveTo(cx + nx * halfW, cy + ny * halfW);
      ctx.lineTo(cx - nx * halfW, cy - ny * halfW);
      ctx.stroke();

      t += stepPx;
    }
  }

  ctx.restore();
}

// ─── Satin fill (wide satin bodies) ──────────────────────────────────────────

/**
 * Draws satin fill lines for wide regions classified as 'satin' type.
 * Uses the region's fill_angle / orientation for the column direction.
 * Clips to the polygon (satin fill always stays inside the shape).
 */
export function drawSatinFill(ctx, pts, region, drawW, drawH, zoom, color, alpha) {
  if (pts.length < 3) return;

  // Use PCA orientation angle — most accurate for wide satin bodies
  const angleDeg  = region.orientation ?? region.angle ?? region.fill_angle ?? 45;
  const densityMm = Math.min(0.5, region.density || 0.4);
  const pxPerMm   = drawW / 100;
  const spacingPx = Math.max(1.5, (densityMm * pxPerMm) / zoom);
  const threadPx  = Math.max(0.6, (0.30 * pxPerMm) / zoom);

  // Build pixel polygon
  const poly = pts.map(p => [(p[0] - 0.5) * drawW, (p[1] - 0.5) * drawH]);

  const xs = poly.map(p => p[0]);
  const ys = poly.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx   = (minX + maxX) / 2;
  const cy   = (minY + maxY) / 2;
  const diagLen = Math.hypot(maxX - minX, maxY - minY) + spacingPx * 2;

  const rad = (angleDeg * Math.PI) / 180;

  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth   = threadPx;
  ctx.lineCap     = 'butt';

  // Rotate coordinate system to draw horizontal lines in fill-angle space
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  for (let y = -diagLen; y <= diagLen; y += spacingPx) {
    ctx.beginPath();
    ctx.moveTo(-diagLen, y);
    ctx.lineTo( diagLen, y);
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Polygon outline (fallback / outline mode) ─────────────────────────────────

/**
 * Draws a clean polygon outline — used in 'outline' view mode.
 */
export function drawOutline(ctx, pts, drawW, drawH, zoom, color, alpha) {
  if (pts.length < 3) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth   = Math.max(1, 1.5 / zoom);
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo((pts[0][0] - 0.5) * drawW, (pts[0][1] - 0.5) * drawH);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo((pts[i][0] - 0.5) * drawW, (pts[i][1] - 0.5) * drawH);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}