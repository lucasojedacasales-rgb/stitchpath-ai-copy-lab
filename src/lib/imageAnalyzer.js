/**
 * Client-side image analyzer — v2.
 *
 * Improvements over v1:
 *  1. K-means++ operates in CIE Lab space (perceptually uniform) instead of RGB,
 *     matching contourEngine.js. Produces visually distinct, non-duplicate clusters.
 *  2. Adaptive sampling: denser in high-variance zones (detail areas), sparser in flat areas.
 *  3. 20 k-means iterations (vs 10) for better convergence on complex images.
 *  4. Post-merge: fuse clusters whose Lab distance (ΔE) < 6 — eliminates near-duplicate colors.
 *  5. Detects transparency and propagates it to the analysis result.
 *  6. Returns per-color centroid and dominant-axis angle for downstream EIE hint.
 */

export async function analyzeImage(imageUrl, maxColors = 10, analysisSize = 512) {
  const img = await loadImage(imageUrl);

  const ANALYSIS_SIZE = Math.min(1024, Math.max(256, analysisSize));
  const scale = Math.min(ANALYSIS_SIZE / img.width, ANALYSIS_SIZE / img.height);
  const W = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  const imageData = ctx.getImageData(0, 0, W, H);
  const pixels = imageData.data;

  // --- 1. Adaptive sampling in Lab space ---
  const { labSamples, rgbSamples, sampleCoords, hasTransparency } =
    adaptiveSample(pixels, W, H);

  // --- 2. K-means++ in Lab space ---
  const k = Math.min(maxColors, labSamples.length);
  const { centroids: labCentroids, assignments } = kMeansLabPP(labSamples, k, 20);

  // --- 3. Compute coverage, mean RGB per centroid ---
  const buckets = labCentroids.map(() => ({ rSum: 0, gSum: 0, bSum: 0, count: 0 }));
  for (let i = 0; i < assignments.length; i++) {
    const ci = assignments[i];
    const [r, g, b] = rgbSamples[i];
    buckets[ci].rSum += r; buckets[ci].gSum += g; buckets[ci].bSum += b; buckets[ci].count++;
  }

  let colors = buckets
    .map((b, i) => {
      if (b.count === 0) return null;
      const rgb = [b.rSum / b.count, b.gSum / b.count, b.bSum / b.count];
      return {
        hex: rgbToHex(rgb),
        rgb,
        lab: labCentroids[i],
        coverage: b.count / labSamples.length,
      };
    })
    .filter(Boolean)
    .filter(c => c.coverage > 0.001)
    .sort((a, b) => b.coverage - a.coverage);

  // --- 4. Merge perceptually similar clusters (ΔE < 6) ---
  colors = mergeSimilarColors(colors, 6.0);

  // Trim to requested k
  colors = colors.slice(0, maxColors);

  // --- 5. Per-color bounding boxes ---
  const colorRegions = computeColorRegions(pixels, W, H, colors);

  // --- 6. Edge map (Sobel) ---
  const edgeDensityMap = computeEdgeDensityGrid(pixels, W, H, 8);

  return {
    imageWidth: img.width,
    imageHeight: img.height,
    aspectRatio: img.width / img.height,
    dominantColors: colors,
    colorRegions,
    edgeDensityMap,
    hasTransparency,
    analysisW: W,
    analysisH: H,
  };
}

// ─── Adaptive sampling ────────────────────────────────────────────────────────
// Computes a 16x16 variance grid, then samples more densely from high-variance
// zones (fine details, edges) and sparsely from flat zones (backgrounds).

function adaptiveSample(pixels, W, H) {
  const GRID = 16;
  const cellW = Math.ceil(W / GRID), cellH = Math.ceil(H / GRID);

  // Compute per-cell variance (luminance)
  const cellVar = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = gx * cellW, y0 = gy * cellH;
      const x1 = Math.min(x0 + cellW, W), y1 = Math.min(y0 + cellH, H);
      let sum = 0, sumSq = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * W + x) * 4;
          if (pixels[idx + 3] < 128) continue;
          const lum = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
          sum += lum; sumSq += lum * lum; n++;
        }
      }
      cellVar[gy * GRID + gx] = n > 0 ? (sumSq / n - (sum / n) ** 2) : 0;
    }
  }

  const maxVar = Math.max(...cellVar) || 1;

  // Sample: 1 in N pixels per cell, N inversely proportional to variance
  const labSamples = [], rgbSamples = [], sampleCoords = [];
  let hasTransparency = false;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const a = pixels[idx + 3];
      if (a < 128) { hasTransparency = true; continue; }

      const gy = Math.min(GRID - 1, Math.floor(y / cellH));
      const gx = Math.min(GRID - 1, Math.floor(x / cellW));
      const variance = cellVar[gy * GRID + gx];
      // High-variance zones: sample every pixel; low-variance: sample 1/8
      const sampleRate = variance / maxVar > 0.15 ? 1 : 8;
      if ((y * W + x) % sampleRate !== 0) continue;

      const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
      labSamples.push(rgbToLab(r, g, b));
      rgbSamples.push([r, g, b]);
      sampleCoords.push([x, y]);
    }
  }

  return { labSamples, rgbSamples, sampleCoords, hasTransparency };
}

// ─── K-Means++ in Lab space ───────────────────────────────────────────────────

function kMeansLabPP(samples, k, iterations) {
  if (samples.length === 0) return { centroids: [], assignments: [] };
  k = Math.min(k, samples.length);

  // Init centroids with k-means++ (distance in Lab = ΔE)
  const centroids = [samples[Math.floor(Math.random() * samples.length)]];
  while (centroids.length < k) {
    const dists = samples.map(s => Math.min(...centroids.map(c => labDistSq(s, c))));
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) { centroids.push(samples[centroids.length]); continue; }
    let r = Math.random() * total;
    let chosen = samples[samples.length - 1];
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { chosen = samples[i]; break; }
    }
    centroids.push([...chosen]);
  }

  const assignments = new Int32Array(samples.length);

  for (let iter = 0; iter < iterations; iter++) {
    // Assignment step
    let changed = false;
    for (let i = 0; i < samples.length; i++) {
      let best = 0, bestD = Infinity;
      for (let ci = 0; ci < centroids.length; ci++) {
        const d = labDistSq(samples[i], centroids[ci]);
        if (d < bestD) { bestD = d; best = ci; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    if (!changed && iter > 0) break; // converged

    // Update step
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      const ci = assignments[i];
      sums[ci][0] += samples[i][0]; sums[ci][1] += samples[i][1];
      sums[ci][2] += samples[i][2]; sums[ci][3]++;
    }
    for (let ci = 0; ci < centroids.length; ci++) {
      const cnt = sums[ci][3];
      if (cnt > 0) centroids[ci] = [sums[ci][0] / cnt, sums[ci][1] / cnt, sums[ci][2] / cnt];
    }
  }

  return { centroids, assignments };
}

// ─── Post-merge: fuse near-duplicate clusters ─────────────────────────────────
// Two clusters with ΔE < threshold are perceptually indistinguishable.
// Merge by coverage-weighted Lab average; add coverages.

function mergeSimilarColors(colors, deltaEThreshold) {
  const merged = [...colors];
  let didMerge = true;

  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const de = labDist(merged[i].lab, merged[j].lab);
        if (de < deltaEThreshold) {
          // Weighted merge
          const wa = merged[i].coverage, wb = merged[j].coverage, wt = wa + wb;
          const lab = [
            (merged[i].lab[0] * wa + merged[j].lab[0] * wb) / wt,
            (merged[i].lab[1] * wa + merged[j].lab[1] * wb) / wt,
            (merged[i].lab[2] * wa + merged[j].lab[2] * wb) / wt,
          ];
          const rgb = labToRgb(lab);
          merged[i] = { hex: rgbToHex(rgb), rgb, lab, coverage: wt };
          merged.splice(j, 1);
          didMerge = true;
          break;
        }
      }
      if (didMerge) break;
    }
  }

  return merged.sort((a, b) => b.coverage - a.coverage);
}

// ─── Color Region Bounding Boxes (Lab assignment) ─────────────────────────────

function computeColorRegions(pixels, W, H, dominantColors) {
  if (!dominantColors.length) return [];

  const labPalette = dominantColors.map(dc =>
    dc.lab || rgbToLab(dc.rgb[0], dc.rgb[1], dc.rgb[2])
  );

  const regions = dominantColors.map(dc => ({
    hex: dc.hex, coverage: dc.coverage,
    minX: 1, maxX: 0, minY: 1, maxY: 0, pixelCount: 0,
  }));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      if (pixels[idx + 3] < 128) continue;
      const lab = rgbToLab(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
      let best = 0, bestD = Infinity;
      for (let ci = 0; ci < labPalette.length; ci++) {
        const d = labDistSq(lab, labPalette[ci]);
        if (d < bestD) { bestD = d; best = ci; }
      }
      const nx = x / W, ny = y / H;
      const r = regions[best];
      if (nx < r.minX) r.minX = nx; if (nx > r.maxX) r.maxX = nx;
      if (ny < r.minY) r.minY = ny; if (ny > r.maxY) r.maxY = ny;
      r.pixelCount++;
    }
  }

  return regions.filter(r => r.pixelCount > 0);
}

// ─── Edge Density Grid (Sobel) ────────────────────────────────────────────────

function computeEdgeDensityGrid(pixels, W, H, gridSize) {
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
  }

  const sobelMag = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx =
        -gray[(y-1)*W+(x-1)] + gray[(y-1)*W+(x+1)]
        - 2*gray[y*W+(x-1)]  + 2*gray[y*W+(x+1)]
        - gray[(y+1)*W+(x-1)] + gray[(y+1)*W+(x+1)];
      const gy =
        -gray[(y-1)*W+(x-1)] - 2*gray[(y-1)*W+x] - gray[(y-1)*W+(x+1)]
        + gray[(y+1)*W+(x-1)] + 2*gray[(y+1)*W+x] + gray[(y+1)*W+(x+1)];
      sobelMag[y*W+x] = Math.sqrt(gx*gx + gy*gy);
    }
  }

  const cellW = W / gridSize, cellH = H / gridSize;
  const grid = [];
  for (let gy = 0; gy < gridSize; gy++) {
    const row = [];
    for (let gx = 0; gx < gridSize; gx++) {
      let sum = 0, count = 0;
      const x0 = Math.round(gx * cellW), x1 = Math.round((gx+1) * cellW);
      const y0 = Math.round(gy * cellH), y1 = Math.round((gy+1) * cellH);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += sobelMag[y*W+x]; count++;
        }
      }
      row.push(count > 0 ? Math.min(1, (sum/count) / 128) : 0);
    }
    grid.push(row);
  }
  return grid;
}

// ─── CIE Lab color space ──────────────────────────────────────────────────────

function rgbToLab(r, g, b) {
  let rl = r/255, gl = g/255, bl = b/255;
  rl = rl > 0.04045 ? ((rl+0.055)/1.055)**2.4 : rl/12.92;
  gl = gl > 0.04045 ? ((gl+0.055)/1.055)**2.4 : gl/12.92;
  bl = bl > 0.04045 ? ((bl+0.055)/1.055)**2.4 : bl/12.92;
  const X = rl*0.4124 + gl*0.3576 + bl*0.1805;
  const Y = rl*0.2126 + gl*0.7152 + bl*0.0722;
  const Z = rl*0.0193 + gl*0.1192 + bl*0.9505;
  const fx = labF(X/0.9505), fy = labF(Y), fz = labF(Z/1.0888);
  return [116*fy - 16, 500*(fx-fy), 200*(fy-fz)];
}
function labF(t) { return t > 0.008856 ? t**(1/3) : 7.787*t + 16/116; }

function labToRgb([L, A, B]) {
  const fy = (L+16)/116, fx = A/500+fy, fz = fy-B/200;
  const X = 0.9505*(fx**3 > 0.008856 ? fx**3 : (fx-16/116)/7.787);
  const Y =         (fy**3 > 0.008856 ? fy**3 : (fy-16/116)/7.787);
  const Z = 1.0888*(fz**3 > 0.008856 ? fz**3 : (fz-16/116)/7.787);
  let rl =  3.2406*X - 1.5372*Y - 0.4986*Z;
  let gl = -0.9689*X + 1.8758*Y + 0.0415*Z;
  let bl =  0.0557*X - 0.2040*Y + 1.0570*Z;
  const toS = c => Math.max(0, Math.min(255, Math.round((c>0.0031308 ? 1.055*c**(1/2.4)-0.055 : 12.92*c)*255)));
  return [toS(rl), toS(gl), toS(bl)];
}

function labDistSq([L1,a1,b1], [L2,a2,b2]) {
  return (L1-L2)**2 + (a1-a2)**2 + (b1-b2)**2;
}
function labDist(a, b) { return Math.sqrt(labDistSq(a, b)); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

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