/**
 * edgeSnapper.js — Aligns inferred contours to real visible edges
 * ─────────────────────────────────────────────────────────────────────────────
 * The fill mask boundary can drift from the true visual edge due to color
 * quantization, anti-aliasing, or background bleeding. This module:
 *
 *   1. buildEdgeMap(imageUrl)      — loads image, computes Sobel gradient map
 *   2. snapContourToEdges(pts, map) — for each contour point, searches along
 *      the local normal for the strongest gradient and snaps to it
 *
 * This guarantees the contour follows the REAL border visible in the image,
 * not just the fill mask boundary.
 */

const GRADIENT_THRESHOLD = 25;   // min Sobel magnitude to consider a real edge
const DEFAULT_SEARCH_RADIUS = 4; // pixels to search ± along normal
const SNAP_COOLDOWN = 2;         // min points between snaps (avoid jitter)

// ═══════════════════════════════════════════════════════════════════════════
//  EDGE MAP — Sobel gradient magnitude
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Loads an image and computes a Sobel gradient magnitude map.
 * @param {string} imageUrl
 * @returns {Promise<{width, height, data: Float32Array, maxGrad: number}|null>}
 */
export async function buildEdgeMap(imageUrl) {
  if (!imageUrl) return null;
  try {
    const img = await loadImage(imageUrl);
    const W = Math.min(img.width, 512);   // cap for performance
    const H = Math.min(img.height, 512);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const imageData = ctx.getImageData(0, 0, W, H);
    const gray = toGrayscale(imageData, W, H);
    const { data, maxGrad } = sobelMagnitude(gray, W, H);
    return { width: W, height: H, data, maxGrad };
  } catch (e) {
    console.warn('[edgeSnapper] No se pudo construir edge map:', e.message);
    return null;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function toGrayscale(imageData, W, H) {
  const gray = new Float32Array(W * H);
  const px = imageData.data;
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

function sobelMagnitude(gray, W, H) {
  const data = new Float32Array(W * H);
  let maxGrad = 0;
  // Sobel kernels:
  // Gx = [-1 0 1; -2 0 2; -1 0 1]
  // Gy = [-1 -2 -1; 0 0 0; 1 2 1]
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const tl = gray[i - W - 1], tc = gray[i - W], tr = gray[i - W + 1];
      const ml = gray[i - 1],                        mr = gray[i + 1];
      const bl = gray[i + W - 1], bc = gray[i + W], br = gray[i + W + 1];
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const mag = Math.sqrt(gx * gx + gy * gy);
      data[i] = mag;
      if (mag > maxGrad) maxGrad = mag;
    }
  }
  return { data, maxGrad };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONTOUR SNAPPING — align to real edges
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Snaps each contour point to the strongest nearby edge along the local normal.
 *
 * @param {Array}  points       — normalized 0–1 [[x,y], ...]
 * @param {Object} edgeMap      — from buildEdgeMap
 * @param {Object} options      — { searchRadius, threshold, adaptive }
 * @returns {Array}             — adjusted normalized points
 */
export function snapContourToEdges(points, edgeMap, options = {}) {
  if (!edgeMap || points.length < 4) return points;

  const { width: W, height: H, data, maxGrad } = edgeMap;
  const searchRadius = options.searchRadius ?? DEFAULT_SEARCH_RADIUS;
  // Adaptive threshold: use 15% of max gradient, with a floor
  const threshold = options.threshold ?? Math.max(GRADIENT_THRESHOLD, maxGrad * 0.12);

  const result = points.map(p => [p[0], p[1]]);
  let lastSnapIdx = -SNAP_COOLDOWN;

  for (let i = 0; i < points.length; i++) {
    if (i - lastSnapIdx < SNAP_COOLDOWN) continue;

    const px = points[i][0] * W;
    const py = points[i][1] * H;

    // Local tangent from neighbors (±2 points for stability)
    const prev = points[Math.max(0, i - 2)];
    const next = points[Math.min(points.length - 1, i + 2)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const tLen = Math.hypot(tx, ty);
    if (tLen < 1e-6) continue;
    tx /= tLen; ty /= tLen;

    // Normal (perpendicular, pointing outward)
    const nx = -ty, ny = tx;

    // Search along normal for max gradient
    let bestOffset = 0, bestGrad = 0;
    for (let d = -searchRadius; d <= searchRadius; d++) {
      const sx = Math.round(px + d * nx);
      const sy = Math.round(py + d * ny);
      if (sx < 1 || sx >= W - 1 || sy < 1 || sy >= H - 1) continue;
      const grad = data[sy * W + sx];
      if (grad > bestGrad) { bestGrad = grad; bestOffset = d; }
    }

    // Snap only if we found a real edge stronger than threshold
    if (bestGrad >= threshold && bestOffset !== 0) {
      const snappedX = (px + bestOffset * nx) / W;
      const snappedY = (py + bestOffset * ny) / H;
      // Clamp to valid range
      result[i][0] = Math.max(0, Math.min(1, snappedX));
      result[i][1] = Math.max(0, Math.min(1, snappedY));
      lastSnapIdx = i;
    }
  }

  const snapped = result.filter((p, i) =>
    i === 0 || Math.hypot(p[0] - result[i - 1][0], p[1] - result[i - 1][1]) > 1e-5
  );

  // Log snap stats for debugging
  const totalSnapped = result.reduce((count, p, i) => {
    return count + (Math.hypot(p[0] - points[i][0], p[1] - points[i][1]) > 0.002 ? 1 : 0);
  }, 0);

  return snapped;
}

/**
 * Measures alignment quality between a contour and the edge map.
 * Returns { meanGradient, alignmentScore (0-100), weakPoints }
 */
export function measureContourAlignment(points, edgeMap) {
  if (!edgeMap || points.length < 3) return { meanGradient: 0, alignmentScore: 0, weakPoints: 0 };

  const { width: W, height: H, data, maxGrad } = edgeMap;
  let totalGrad = 0, weakCount = 0;
  const threshold = Math.max(GRADIENT_THRESHOLD, maxGrad * 0.12);

  for (const [nx, ny] of points) {
    const px = Math.round(nx * W);
    const py = Math.round(ny * H);
    if (px < 1 || px >= W - 1 || py < 1 || py >= H - 1) { weakCount++; continue; }
    const g = data[py * W + px];
    totalGrad += g;
    if (g < threshold) weakCount++;
  }

  const meanGradient = totalGrad / points.length;
  const alignmentScore = maxGrad > 0
    ? Math.round(Math.min(100, (meanGradient / (maxGrad * 0.3)) * 100))
    : 0;

  return { meanGradient, alignmentScore, weakPoints: weakCount };
}