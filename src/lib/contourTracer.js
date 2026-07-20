/**
 * Client-side contour tracer.
 * 1. K-means color quantization
 * 2. Connected-component blob detection per color
 * 3. Moore-neighbor contour tracing
 * 4. RDP simplification
 * Returns regions with real path_points normalized 0–1
 */

const ANALYSIS_SIZE = 800; // Mayor resolución = más detalles finos capturados (ojos, nariz, etc.)

export async function traceImageContours(imageUrl, maxColors = 8) {
  const img = await loadImage(imageUrl);

  const scale = Math.min(ANALYSIS_SIZE / img.width, ANALYSIS_SIZE / img.height);
  const W = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  const imageData = ctx.getImageData(0, 0, W, H);
  const pixels = imageData.data; // RGBA flat array, length = W*H*4

  // 1. Build opaque pixel list for k-means sampling
  const samples = [];
  for (let i = 0; i < W * H; i++) {
    if (pixels[i * 4 + 3] < 128) continue;
    samples.push([pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]]);
  }

  const k = Math.min(maxColors, samples.length);
  const palette = kMeans(samples, k, 20);

  // 2. Build label map (each pixel → palette index, -1 = transparent)
  const labels = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (pixels[i * 4 + 3] < 128) { labels[i] = -1; continue; }
    labels[i] = nearestColor([pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]], palette);
  }

  // 3. For each color, find connected blobs
  // Minimum blob size: raised to 0.08% of image area (was 0.05%) — stronger noise filter.
  // At 800px: 640000 * 0.0008 = 512px minimum — filters JPEG artifacts while keeping real details.
  const minPixels = Math.max(120, Math.floor(W * H * 0.0008));
  const regions = [];

  for (let ci = 0; ci < palette.length; ci++) {
    const blobs = findBlobs(labels, W, H, ci, minPixels);
    for (const blob of blobs) {
      // RDP tolerance: raised floor to 1.0px (was 0.5px — sub-pixel epsilon caused over-detailed contours)
      const rdpEps = Math.max(1.0, Math.min(W, H) * 0.004);
      let contour = traceContour(blob.mask, W, H);
      if (contour.length < 4) continue;

      // Laplacian smoothing before RDP — reduces jagged/staircase artifacts
      // More passes for larger blobs (more noise), fewer for small details
      const smoothPasses = blob.pixelCount > 500 ? 3 : 1;
      contour = laplacianSmooth(contour, smoothPasses, 0.5);

      const simplified = rdpSimplify(contour, rdpEps);
      if (simplified.length < 3) continue;

      // Normalize to 0–1
      const pts = simplified.map(([x, y]) => [
        parseFloat((x / W).toFixed(4)),
        parseFloat((y / H).toFixed(4))
      ]);
      // Ensure closed polygon
      if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
        pts.push([...pts[0]]);
      }

      // ── Geometric metrics ────────────────────────────────────────────────
      const coverage = blob.pixelCount / (W * H);

      // Perimeter in normalized units (same space as path_points)
      let perimNorm = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        perimNorm += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
      }

      // Compactness = 4π·area / perimeter²  (circle = 1, thin line → 0)
      const areaNorm = Math.abs(shoelaceArea(pts));
      const compacidad = perimNorm > 0 ? (4 * Math.PI * areaNorm) / (perimNorm * perimNorm) : 0;

      // Inertia ratio (PCA): ratio of eigenvalues — elongation measure
      const inertia_ratio = computeInertiaRatio(pts);

      // Bounding-box aspect ratio
      const bw = (blob.bbox.maxX - blob.bbox.minX) / W;
      const bh = (blob.bbox.maxY - blob.bbox.minY) / H;
      const bbox_aspect = bh > 0 ? bw / bh : 1;

      // Dominant fill angle via PCA (degrees, 0–180)
      const fill_angle = computePCAAngle(pts);

      // Centroid (normalized)
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;

      regions.push({
        hex: rgbToHex(palette[ci]),
        rgb: palette[ci],
        coverage,
        pixelCount: blob.pixelCount,
        area_px: blob.pixelCount,
        area_norm: areaNorm,        // area in normalized [0,1]² space
        perimeter_norm: perimNorm,  // perimeter in normalized space
        compacidad,
        inertia_ratio,
        bbox_aspect,
        fill_angle,
        centroid: [cx, cy],
        path_points: pts,
        bbox: blob.bbox,
      });
    }
  }

  // Sort largest first (fills before contours/details)
  regions.sort((a, b) => b.pixelCount - a.pixelCount);

  return { regions, imageWidth: img.width, imageHeight: img.height, analysisW: W, analysisH: H };
}

// ─── K-Means ──────────────────────────────────────────────────────────────────

function kMeans(samples, k, iterations) {
  if (samples.length === 0) return [];

  // k-means++ initialization
  const centroids = [samples[Math.floor(Math.random() * samples.length)]];
  while (centroids.length < k) {
    const dists = samples.map(s => Math.min(...centroids.map(c => distSq(s, c))));
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { centroids.push([...samples[i]]); break; }
    }
    if (centroids.length < k) centroids.push([...samples[samples.length - 1]]);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const sums = centroids.map(() => [0, 0, 0, 0]); // r,g,b,count
    for (const s of samples) {
      const ci = nearestColor(s, centroids);
      sums[ci][0] += s[0]; sums[ci][1] += s[1]; sums[ci][2] += s[2]; sums[ci][3]++;
    }
    for (let ci = 0; ci < centroids.length; ci++) {
      const cnt = sums[ci][3];
      if (cnt > 0) centroids[ci] = [sums[ci][0] / cnt, sums[ci][1] / cnt, sums[ci][2] / cnt];
    }
  }
  return centroids;
}

function nearestColor(rgb, palette) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = distSq(rgb, palette[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ─── Blob Detection ───────────────────────────────────────────────────────────

function findBlobs(labels, W, H, colorIdx, minPixels) {
  // 8-connectivity: merges same-color regions connected diagonally.
  // JPEG quantization inserts single-pixel color gaps that split coherent
  // shapes under 4-connectivity. 8-connectivity preserves geometric coherence.
  const visited = new Uint8Array(W * H);
  const blobs = [];

  for (let start = 0; start < W * H; start++) {
    if (labels[start] !== colorIdx || visited[start]) continue;

    const stack = [start];
    const mask = new Uint8Array(W * H);
    let count = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;

    while (stack.length > 0) {
      const idx = stack.pop();
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (labels[idx] !== colorIdx) continue;
      mask[idx] = 1;
      count++;
      const x = idx % W, y = Math.floor(idx / W);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      // 8-neighbour scan (includes diagonals)
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          stack.push(ny * W + nx);
        }
      }
    }

    if (count >= minPixels) {
      blobs.push({ mask, pixelCount: count, bbox: { minX, maxX, minY, maxY } });
    }
  }

  return blobs;
}

// ─── Contour Tracing (Moore neighborhood) ─────────────────────────────────────

function traceContour(mask, W, H) {
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) { start = i; break; }
  }
  if (start === -1) return [];

  const dirs = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  const contour = [];
  let cx = start % W, cy = Math.floor(start / W);
  const sx = cx, sy = cy;
  let dir = 0;
  const maxSteps = W * H;

  for (let step = 0; step < maxSteps; step++) {
    contour.push([cx, cy]);
    // Search clockwise from back-left of current direction
    let moved = false;
    for (let d = 0; d < 8; d++) {
      const nd = (dir + 6 + d) % 8;
      const nx = cx + dirs[nd][0], ny = cy + dirs[nd][1];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (mask[ny * W + nx]) {
        dir = nd;
        cx = nx; cy = ny;
        moved = true;
        break;
      }
    }
    if (!moved) break;
    if (step > 3 && cx === sx && cy === sy) break;
  }

  return contour;
}

// ─── Ramer-Douglas-Peucker (iterativo, sin riesgo de stack overflow) ──────────

function rdpSimplify(points, epsilon) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let maxDist = 0, maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const d = pointToSegDist(points[i], points[start], points[end]);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function pointToSegDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function distSq(a, b) { return (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2; }

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
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

// ─── Geometric helpers for region metrics ─────────────────────────────────────

/** Shoelace formula — area in the same coordinate space as pts */
function shoelaceArea(pts) {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1];
    area -= pts[j][0] * pts[i][1];
  }
  return Math.abs(area) / 2;
}

/** PCA dominant angle of a polygon's point cloud — returns degrees [0,180) */
function computePCAAngle(pts) {
  const n = pts.length;
  if (n < 3) return 45;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return Math.round(((angle * 180) / Math.PI + 180) % 180);
}

/** Inertia ratio: ratio of PCA eigenvalues → elongation (1=circle, >3=elongated) */
function computeInertiaRatio(pts) {
  const n = pts.length;
  if (n < 3) return 1;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (trace / 2) ** 2 - det));
  const lam1 = trace / 2 + disc;
  const lam2 = trace / 2 - disc;
  return lam2 > 1e-9 ? lam1 / lam2 : 10; // high ratio = very elongated
}

/**
 * Laplacian smoothing for polygon contours.
 * Each vertex moves toward the average of its neighbors by factor lambda.
 * Preserves shape better than simple averaging — no shrinkage.
 */
function laplacianSmooth(pts, passes = 2, lambda = 0.5) {
  if (pts.length < 4) return pts;
  let current = pts.slice();
  const n = current.length;
  for (let p = 0; p < passes; p++) {
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = current[(i - 1 + n) % n];
      const curr = current[i];
      const nxt  = current[(i + 1) % n];
      const avgX = (prev[0] + nxt[0]) / 2;
      const avgY = (prev[1] + nxt[1]) / 2;
      next[i] = [
        curr[0] + lambda * (avgX - curr[0]),
        curr[1] + lambda * (avgY - curr[1]),
      ];
    }
    current = next;
  }
  return current;
}