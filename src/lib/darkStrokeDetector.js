/**
 * darkStrokeDetector.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * "Dark stroke first" system.
 *
 * Detects REAL dark lines/strokes in the original image so that contour
 * generation is driven by actual drawn lines — NOT by color region boundaries.
 *
 * This prevents false black contours between same-object fills (e.g. the two
 * pinks of a body) and guarantees the mouth/eyes are preserved as independent
 * dark-stroke details.
 *
 * Public API:
 *   detectDarkStrokeMask(imageData, options)  → { mask, components, skeleton, ... }
 *   overlapsDarkStrokeMask(points, darkCtx, closed) → { overlap, total, ratio }
 *   buildDarkStrokeContextFromUrl(imageUrl, options) → Promise<darkCtx>
 *
 * The darkCtx is meant to be attached to config.darkStroke and flows through
 * the contour pipeline (contourExportBuilder → segmentClassifier).
 */

const DEFAULT_OPTIONS = {
  darkLumaThreshold: 80,
  darkSaturationMax: 90,
  localContrastMin: 25,
  minStrokeArea: 6,
  maxNoiseArea: 3,
  contrastWindow: 3,     // radius for local contrast (3 → 7x7 window)
  strokeTolerancePx: 2,  // neighborhood radius when sampling mask along a path
};

// ─── Color conversion ────────────────────────────────────────────────────────

function pixelLuma(r, g, b) {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function pixelSaturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : ((max - min) / max) * 100;
}

// ─── Main detection ──────────────────────────────────────────────────────────

/**
 * Detects dark stroke pixels, groups them into connected components, removes
 * noise, and extracts a simplified skeleton path per component.
 *
 * @param {ImageData} imageData — from canvas.getContext('2d').getImageData()
 * @param {Object} options
 * @returns {{ mask, components, skeleton, confidence, width, height, mouthCandidate, eyeCandidates, outerOverlap }}
 */
export function detectDarkStrokeMask(imageData, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { width, height, data } = imageData;

  // ── Pass 1: dark pixel candidates (low luminance + low saturation) ──
  const dark = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = pixelLuma(r, g, b);
      const sat = pixelSaturation(r, g, b);
      if (lum <= opts.darkLumaThreshold && sat <= opts.darkSaturationMax) {
        dark[y * width + x] = 1;
      }
    }
  }

  // ── Pass 2: local contrast filter ──
  // A real stroke pixel has bright neighbors nearby (the line sits on a
  // lighter background). Isolated dark pixels in flat dark areas are fills,
  // not strokes — but we keep them anyway because fills can be legitimate
  // dark regions (eyes). The contrast filter only REMOVES pixels that have
  // no contrast at all (flat noise in dark fills is kept; true noise removed
  // by the area filter in pass 3).
  const w = opts.contrastWindow;
  const contrastMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!dark[y * width + x]) continue;
      const ci = (y * width + x) * 4;
      const centerLum = pixelLuma(data[ci], data[ci + 1], data[ci + 2]);
      let minLum = 255, maxLum = 0;
      for (let dy = -w; dy <= w; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -w; dx <= w; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const ni = (ny * width + nx) * 4;
          const l = pixelLuma(data[ni], data[ni + 1], data[ni + 2]);
          if (l < minLum) minLum = l;
          if (l > maxLum) maxLum = l;
        }
      }
      // Keep if there is meaningful contrast in the neighborhood OR the pixel
      // is part of a genuinely dark region (maxLum also dark → likely eye/fill).
      if (maxLum - minLum >= opts.localContrastMin || maxLum <= opts.darkLumaThreshold) {
        contrastMask[y * width + x] = 1;
      }
    }
  }

  // ── Pass 3: connected components (4-connectivity BFS) + noise removal ──
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  const queue = [];

  for (let start = 0; start < width * height; start++) {
    if (!contrastMask[start] || labels[start] !== -1) continue;
    const label = components.length;
    labels[start] = label;
    queue.length = 0;
    queue.push(start);
    const pixels = [];
    let minX = width, maxX = 0, minY = height, maxY = 0;
    let sumX = 0, sumY = 0;

    while (queue.length > 0) {
      const idx = queue.shift();
      pixels.push(idx);
      const px = idx % width;
      const py = Math.floor(idx / width);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      sumX += px; sumY += py;

      const neighbors = [
        px > 0 ? idx - 1 : -1,
        px < width - 1 ? idx + 1 : -1,
        py > 0 ? idx - width : -1,
        py < height - 1 ? idx + width : -1,
      ];
      for (const nIdx of neighbors) {
        if (nIdx < 0) continue;
        if (contrastMask[nIdx] && labels[nIdx] === -1) {
          labels[nIdx] = label;
          queue.push(nIdx);
        }
      }
    }

    const area = pixels.length;
    if (area < opts.maxNoiseArea) continue; // remove noise

    components.push({
      label,
      pixels,
      area,
      bbox: { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
      centroid: { x: sumX / area, y: sumY / area },
    });
  }

  // ── Rebuild mask without noise components ──
  const mask = new Uint8Array(width * height);
  const keptComponents = components.filter(c => c.area >= opts.minStrokeArea);
  for (const comp of keptComponents) {
    for (const idx of comp.pixels) mask[idx] = 1;
  }

  // ── Pass 4: skeleton — simplified nearest-neighbor walk per component ──
  const skeleton = keptComponents.map(comp => extractSkeletonPath(comp, width));

  // ── Mouth candidate: small dark curve in lower-center face ──
  const mouthCandidate = detectMouthCandidate(keptComponents, width, height);
  // ── Eye candidates: small dark components in upper-center face ──
  const eyeCandidates = detectEyeCandidates(keptComponents, width, height);

  // ── Outer overlap: how much of the image border region has dark strokes ──
  const outerOverlap = computeOuterOverlap(keptComponents, width, height);

  const confidence = Math.min(100, Math.round(
    (keptComponents.length > 0 ? 40 : 0) +
    (mouthCandidate ? 25 : 0) +
    (eyeCandidates.length > 0 ? 20 : 0) +
    Math.min(15, outerOverlap * 15)
  ));

  console.log(`[dark-stroke] components detected: ${keptComponents.length}`);
  console.log(`[dark-stroke] skeleton paths: ${skeleton.filter(s => s.length > 0).length}`);
  console.log(`[dark-stroke] mouth candidate: ${mouthCandidate ? 'YES' : 'NO'}`);
  console.log(`[dark-stroke] eye candidates: ${eyeCandidates.length}`);
  console.log(`[dark-stroke] outer outline overlap: ${outerOverlap.toFixed(2)}`);

  return {
    mask,
    components: keptComponents,
    skeleton,
    confidence,
    width,
    height,
    mouthCandidate,
    eyeCandidates,
    outerOverlap,
    options: opts,
  };
}

// ─── Skeleton extraction (nearest-neighbor walk) ─────────────────────────────

function extractSkeletonPath(comp, width) {
  const pixels = comp.pixels;
  if (pixels.length === 0) return [];

  // Start from the pixel closest to bbox top-left
  const { minX, minY } = comp.bbox;
  let startIdx = pixels[0];
  let bestDist = Infinity;
  for (const idx of pixels) {
    const px = idx % width;
    const py = Math.floor(idx / width);
    const d = (px - minX) ** 2 + (py - minY) ** 2;
    if (d < bestDist) { bestDist = d; startIdx = idx; }
  }

  // Greedy nearest-neighbor walk (works well for thin strokes)
  const visited = new Set([startIdx]);
  const path = [{ x: startIdx % width, y: Math.floor(startIdx / width) }];
  const pixelSet = new Set(pixels);
  let current = startIdx;

  for (let step = 0; step < pixels.length; step++) {
    const cx = current % width;
    const cy = Math.floor(current / width);
    let next = -1;
    let nextDist = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0) continue;
        const nIdx = ny * width + nx;
        if (!pixelSet.has(nIdx) || visited.has(nIdx)) continue;
        const d = dx * dx + dy * dy;
        if (d < nextDist) { nextDist = d; next = nIdx; }
      }
    }
    if (next < 0) break;
    visited.add(next);
    path.push({ x: next % width, y: Math.floor(next / width) });
    current = next;
  }

  return path;
}

// ─── Mouth / eye candidate detection ─────────────────────────────────────────

function detectMouthCandidate(components, width, height) {
  // Mouth: small-to-medium dark component in lower-center face area
  const candidates = components.filter(c => {
    const cx = c.centroid.x / width;
    const cy = c.centroid.y / height;
    const isLowerCenter = cy > 0.40 && cy < 0.78 && cx > 0.25 && cx < 0.75;
    const isSmallCurve = c.area >= 6 && c.area <= width * height * 0.02;
    const isWide = c.bbox.w > c.bbox.h * 1.2; // mouths are wider than tall
    return isLowerCenter && isSmallCurve && isWide;
  });
  if (candidates.length === 0) return null;
  // Pick the one closest to (0.5, 0.6)
  const best = candidates.reduce((b, c) => {
    const cx = c.centroid.x / width, cy = c.centroid.y / height;
    const d = Math.hypot(cx - 0.5, cy - 0.6);
    const bb = b;
    const bcx = bb.centroid.x / width, bcy = bb.centroid.y / height;
    return d < Math.hypot(bcx - 0.5, bcy - 0.6) ? c : b;
  });
  return {
    component: best,
    centroid: { x: best.centroid.x / width, y: best.centroid.y / height },
    area: best.area,
    bbox: {
      minX: best.bbox.minX / width, maxX: best.bbox.maxX / width,
      minY: best.bbox.minY / height, maxY: best.bbox.maxY / height,
    },
  };
}

function detectEyeCandidates(components, width, height) {
  // Eyes: small dark components in upper-center face area, in pairs (left/right)
  const candidates = components.filter(c => {
    const cx = c.centroid.x / width;
    const cy = c.centroid.y / height;
    const isUpperCenter = cy > 0.20 && cy < 0.45 && cx > 0.20 && cx < 0.80;
    const isSmall = c.area >= 4 && c.area <= width * height * 0.01;
    return isUpperCenter && isSmall;
  });
  return candidates.map(c => ({
    component: c,
    centroid: { x: c.centroid.x / width, y: c.centroid.y / height },
    area: c.area,
    bbox: {
      minX: c.bbox.minX / width, maxX: c.bbox.maxX / width,
      minY: c.bbox.minY / height, maxY: c.bbox.maxY / height,
    },
  }));
}

function computeOuterOverlap(components, width, height) {
  // Fraction of components that touch the outer ring of the image
  if (components.length === 0) return 0;
  const outer = components.filter(c => {
    return c.bbox.minX <= 2 || c.bbox.maxX >= width - 3 ||
           c.bbox.minY <= 2 || c.bbox.maxY >= height - 3;
  });
  return outer.length / components.length;
}

// ─── Mask sampling along a normalized path ───────────────────────────────────

/**
 * Samples the dark stroke mask along a normalized [0-1] path and reports the
 * overlap ratio. Used by the classifier to decide if a contour is backed by a
 * real dark stroke.
 *
 * @param {Array<[x,y]>} points — normalized [0-1]
 * @param {Object} darkCtx — { mask, width, height }
 * @param {boolean} closed
 * @returns {{ overlap, total, ratio }}
 */
export function overlapsDarkStrokeMask(points, darkCtx, closed = true) {
  if (!darkCtx || !darkCtx.mask || points.length < 2) {
    return { overlap: 0, total: 0, ratio: 0 };
  }
  const { mask, width, height } = darkCtx;
  const tol = (darkCtx.options?.strokeTolerancePx) ?? 2;
  const pts = closed ? [...points, points[0]] : points;
  let total = 0, hit = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(segLen * Math.max(width, height) / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const nx = ax + (bx - ax) * t;
      const ny = ay + (by - ay) * t;
      const px = Math.floor(nx * width);
      const py = Math.floor(ny * height);
      let found = false;
      for (let dy = -tol; dy <= tol && !found; dy++) {
        for (let dx = -tol; dx <= tol && !found; dx++) {
          const tx = px + dx, ty = py + dy;
          if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
            if (mask[ty * width + tx]) found = true;
          }
        }
      }
      total++;
      if (found) hit++;
    }
  }

  const ratio = total > 0 ? hit / total : 0;
  return { overlap: hit, total, ratio };
}

// ─── Build dark stroke context from an image URL (browser) ───────────────────

/**
 * Loads an image from a URL, draws it to an offscreen canvas, extracts
 * ImageData, and runs detectDarkStrokeMask. Intended for use in the Editor.
 *
 * @param {string} imageUrl
 * @param {Object} options
 * @returns {Promise<darkCtx>}
 */
export async function buildDarkStrokeContextFromUrl(imageUrl, options = {}) {
  if (!imageUrl) return null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = imageUrl;
  });

  // Downscale large images for performance (mask resolution doesn't need to be huge)
  const maxDim = 320;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  return detectDarkStrokeMask(imageData, options);
}