/**
 * tatamiFill.js — Production-grade scanline fill for embroidery canvas preview.
 *
 * Generates dense parallel stitch rows (tatami/fill pattern) clipped to a polygon.
 *
 * ALGORITHM:
 *  1. Rotate polygon so fill rows are horizontal (angle-agnostic)
 *  2. Scanline from top to bottom at rowSpacing intervals
 *  3. For each row: compute polygon edge intersections → inside spans
 *  4. Place needle points across each span at stitchPitch intervals
 *  5. Alternate direction (boustrophedon) + tatami 4-phase brick offset
 *  6. Rotate needle points back to world space
 *  7. Output: ordered [x0,y0,x1,y1] segments forming a continuous polyline
 *
 * VISUAL RESULT: Dense parallel lines covering the entire polygon area,
 * rendering as solid hatching with clear thread-like rows.
 */

const TATAMI_PHASES = [0, 0.25, 0.5, 0.75];

/**
 * @param {Array<[number,number]>} polygon   - canvas px coords [[x,y],...] (centered at 0,0)
 * @param {number} densityMm   - row spacing in mm (0.35–0.6)
 * @param {number} stitchLenMm - stitch length in mm (2.0–4.0)
 * @param {number} angleDeg    - fill angle in degrees
 * @param {number} pxPerMm     - canvas pixels per mm
 * @returns {{ stitches: number[][], totalStitches: number }}
 */
export function generateTatamiFill(polygon, densityMm = 0.4, stitchLenMm = 3.0, angleDeg = 0, pxPerMm = 5) {
  if (!polygon || polygon.length < 3) return { stitches: [], totalStitches: 0 };

  const safePx = Math.max(1.0, pxPerMm);

  // Row spacing in px: physical density → pixels.
  // Minimum 2px — below this, sub-pixel aliasing creates moiré at zoom=1.
  // At pxPerMm=5.25, densityMm=0.4 → 2.1px → clamped to 2.0px.
  const rowSpacingPx = Math.max(2.0, densityMm * safePx);

  // Stitch pitch: physical length → pixels.
  // Cap at 8× row spacing to prevent visual moiré from long stitches crossing many rows.
  const rawPitchPx = Math.max(2.0, stitchLenMm * safePx);
  const pitchPx    = Math.min(rawPitchPx, rowSpacingPx * 8);

  // ── Rotation to fill-space (rows become horizontal) ───────────────────────────
  const rad  = (angleDeg * Math.PI) / 180;
  const cF   = Math.cos(-rad), sF = Math.sin(-rad);
  const cB   = Math.cos( rad), sB = Math.sin( rad);
  const toF  = (x, y) => [ x*cF - y*sF,  x*sF + y*cF ];
  const toW  = (x, y) => [ x*cB - y*sB,  x*sB + y*cB ];

  // Rotate polygon
  const rp = polygon.map(([x, y]) => toF(x, y));
  const minY = Math.min(...rp.map(p => p[1]));
  const maxY = Math.max(...rp.map(p => p[1]));
  const minX = Math.min(...rp.map(p => p[0]));
  const maxX = Math.max(...rp.map(p => p[0]));

  // Guard: needs at least one scanline row and one stitch
  if (maxY - minY < 0.5 || maxX - minX < 0.5) {
    return { stitches: [], totalStitches: 0 };
  }

  const stitches = [];
  let rowIdx = 0;

  // ── Scanline loop ─────────────────────────────────────────────────────────────
  for (let ry = minY + rowSpacingPx * 0.5; ry < maxY; ry += rowSpacingPx) {

    // Intersections of horizontal line Y=ry with polygon edges
    const xs = edgeIntersections(rp, ry);
    if (xs.length < 2) { rowIdx++; continue; }
    xs.sort((a, b) => a - b);

    // Build inside spans (even-odd: pair 0-1 inside, 2-3 inside, ...)
    const spans = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xL = xs[i], xR = xs[i + 1];
      if (xR - xL < 1.0) continue; // skip degenerate spans
      spans.push([xL, xR]);
    }
    if (spans.length === 0) { rowIdx++; continue; }

    // Boustrophedon: alternate direction each row
    const forward  = (rowIdx % 2) === 0;
    const brickOff = TATAMI_PHASES[rowIdx % 4] * pitchPx;

    if (!forward) spans.reverse();

    let lastX = null, lastY = null;

    for (const [xL, xR] of spans) {
      const needles = placeNeedles(xL, xR, pitchPx, brickOff, forward);
      if (needles.length < 2) continue;

      // Travel stitch connecting end of previous span to start of this span
      if (lastX !== null) {
        const [nx, ny] = toW(needles[0], ry);
        stitches.push([lastX, lastY, nx, ny]);
      }

      // Emit all stitches across this span
      for (let i = 0; i < needles.length - 1; i++) {
        const [ax, ay] = toW(needles[i],     ry);
        const [bx, by] = toW(needles[i + 1], ry);
        stitches.push([ax, ay, bx, by]);
      }

      const last = needles[needles.length - 1];
      [lastX, lastY] = toW(last, ry);
    }

    rowIdx++;
  }

  return { stitches, totalStitches: stitches.length };
}

// ── Needle placer ─────────────────────────────────────────────────────────────
// Places needles at [xL, xR] boundary + interior points at `pitch` intervals.
// `brickOff` shifts the interior grid (tatami pattern).
// Returns array of X values in traversal order.

function placeNeedles(xL, xR, pitch, brickOff, forward) {
  const phase = ((brickOff % pitch) + pitch) % pitch;

  const needles = [xL];

  // First interior needle after xL, offset by tatami phase
  let nx = xL + phase;
  if (nx <= xL + 0.5) nx += pitch;

  while (nx < xR - 0.5) {
    needles.push(nx);
    nx += pitch;
  }

  needles.push(xR);

  // Deduplicate points closer than 0.5px
  const out = [needles[0]];
  for (let i = 1; i < needles.length; i++) {
    if (needles[i] - out[out.length - 1] > 0.5) out.push(needles[i]);
  }

  return forward ? out : out.reverse();
}

// ── Edge intersection (even-odd scanline) ────────────────────────────────────
// Returns all X coordinates where Y=ry crosses a polygon edge.
// Top-inclusive rule prevents double-counting shared vertices.

function edgeIntersections(poly, ry) {
  const xs = [];
  const n  = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    if ((ay <= ry && by > ry) || (by <= ry && ay > ry)) {
      const t = (ry - ay) / (by - ay);
      xs.push(ax + t * (bx - ax));
    }
  }
  return xs;
}