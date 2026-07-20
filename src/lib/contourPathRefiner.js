/**
 * contourPathRefiner.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Path-level refinement for contour stitch objects.
 *
 * Operations (all in mm coordinates):
 *   smoothPath          — Chaikin corner-cutting smoothing
 *   removeShortSegments — drop segments < minLenMm
 *   closeSmallGaps      — close gaps < thresholdMm
 *   offsetPath          — shift polygon outward/inward by offsetMm
 *   removeParallelDups  — remove contour objects with near-identical paths
 *
 * No file/encoder/DST logic here — pure geometry.
 */

// ─── Chaikin smoothing ────────────────────────────────────────────────────

export function smoothPath(points, passes = 2) {
  if (!points || points.length < 3) return points || [];
  let pts = [...points];
  const isClosed = pts.length >= 3;

  for (let p = 0; p < passes; p++) {
    const next = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (!isClosed && i === n - 1) { next.push(a); break; }
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  return pts;
}

// ─── Remove short segments ─────────────────────────────────────────────────

export function removeShortSegments(points, minLenMm = 0.8) {
  if (!points || points.length < 3) return points || [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = result[result.length - 1];
    const dist = Math.hypot(points[i][0] - last[0], points[i][1] - last[1]);
    // Always keep the last point (closure)
    if (dist >= minLenMm || i === points.length - 1) {
      result.push(points[i]);
    }
  }
  return result;
}

// ─── Close small gaps ───────────────────────────────────────────────────────

export function closeSmallGaps(points, thresholdMm = 1.2) {
  if (!points || points.length < 3) return points || [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = result[result.length - 1];
    const gap = Math.hypot(points[i][0] - last[0], points[i][1] - last[1]);
    // If gap is small but not zero, interpolate to ensure continuous path
    if (gap > 0.01 && gap < thresholdMm) {
      const steps = Math.max(1, Math.ceil(gap / 0.4));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        result.push([
          last[0] + (points[i][0] - last[0]) * t,
          last[1] + (points[i][1] - last[1]) * t,
        ]);
      }
    }
    result.push(points[i]);
  }
  // Ensure closed: if first and last are close, snap
  const first = result[0];
  const lastIdx = result.length - 1;
  const closeGap = Math.hypot(result[lastIdx][0] - first[0], result[lastIdx][1] - first[1]);
  if (closeGap > 0.01 && closeGap < thresholdMm) {
    result[lastIdx] = [first[0], first[1]];
  }
  return result;
}

// ─── Polygon offset (naive — outward/inward via centroid normal) ────────────

export function offsetPath(points, offsetMm = 0.15, outward = true) {
  if (!points || points.length < 3 || Math.abs(offsetMm) < 0.001) return points || [];

  // Compute centroid
  let cx = 0, cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= points.length;
  cy /= points.length;

  const n = points.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    // Average edge direction
    const dx = ((curr[0] - prev[0]) + (next[0] - curr[0])) / 2;
    const dy = ((curr[1] - prev[1]) + (next[1] - curr[1])) / 2;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) { result.push([curr[0], curr[1]]); continue; }

    // Normal (perpendicular)
    let nx = -dy / len;
    let ny = dx / len;

    // Ensure normal points away from centroid (outward)
    const toCentroidX = cx - curr[0];
    const toCentroidY = cy - curr[1];
    const dot = nx * toCentroidX + ny * toCentroidY;
    if (dot > 0) { nx = -nx; ny = -ny; }

    const sign = outward ? 1 : -1;
    result.push([curr[0] + nx * offsetMm * sign, curr[1] + ny * offsetMm * sign]);
  }
  return result;
}

// ─── Remove parallel duplicate contours ──────────────────────────────────────

function bboxIoU(a, b) {
  const ix = Math.max(a.minX, b.minX), iy = Math.max(a.minY, b.minY);
  const ix2 = Math.min(a.maxX, b.maxX), iy2 = Math.min(a.maxY, b.maxY);
  const iw = Math.max(0, ix2 - ix), ih = Math.max(0, iy2 - iy);
  const inter = iw * ih;
  const ua = (a.maxX - a.minX) * (a.maxY - a.minY) + (b.maxX - b.minX) * (b.maxY - b.minY) - inter;
  return ua > 0 ? inter / ua : 0;
}

function computeBbox(pts) {
  if (!pts || pts.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

export function removeParallelDuplicates(objects, iouThreshold = 0.90) {
  if (!objects || objects.length < 2) return objects || [];
  const keep = [];
  for (const obj of objects) {
    const objBbox = computeBbox(obj.points);
    const isDup = keep.some(k => {
      if (k.color !== obj.color) return false;
      if (k.layerType !== obj.layerType) return false;
      const kBbox = computeBbox(k.points);
      return bboxIoU(kBbox, objBbox) > iouThreshold;
    });
    if (!isDup) keep.push(obj);
  }
  if (keep.length < objects.length) {
    console.log(`[contour-refine] parallel duplicates removed: ${objects.length - keep.length}`);
  }
  return keep;
}

// ─── Full refinement pipeline ────────────────────────────────────────────────

export function refineContourPath(points, preset, isOuter) {
  let refined = [...points];

  // 1. Smoothing
  refined = smoothPath(refined, preset.smoothingPasses || 2);

  // 2. Remove short segments — skipped for OUTER outlines so the lower-body
  //    arc and foot edges aren't dropped (short arc segments are valid borders).
  if (!isOuter) {
    refined = removeShortSegments(refined, preset.minSegmentMm || 0.8);
  }

  // 3. Close small gaps
  refined = closeSmallGaps(refined, preset.gapCloseThresholdMm || 1.2);

  // 4. Offset
  if (isOuter && preset.outerOffsetOutwardMm > 0) {
    refined = offsetPath(refined, preset.outerOffsetOutwardMm, true);
  } else if (!isOuter && preset.innerOffsetInwardMm > 0) {
    refined = offsetPath(refined, preset.innerOffsetInwardMm, false);
  }

  return refined;
}