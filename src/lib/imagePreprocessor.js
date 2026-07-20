/**
 * Image pre-processor for embroidery digitization.
 * Applies noise reduction, contrast enhancement, and edge sharpening
 * before sending the image to the AI motor.
 */

/**
 * Main entry point. Returns a blob URL of the processed image.
 * @param {string} imageUrl - Original image URL
 * @param {object} options
 * @param {number} options.gaussianRadius - Blur radius for noise reduction (1-3, default 1)
 * @param {number} options.contrastBoost - Contrast multiplier (1.0-2.0, default 1.4)
 * @param {number} options.saturationBoost - Saturation boost (1.0-2.5, default 1.6)
 * @param {boolean} options.sharpenEdges - Apply unsharp mask (default true)
 * @param {number} options.sharpenStrength - Unsharp mask strength (0.3-1.5, default 0.8)
 * @param {number} options.outputSize - Max dimension in pixels (512-2048, default 1024)
 * @returns {Promise<{url: string, blob: Blob, width: number, height: number}>}
 */
export async function preprocessImage(imageUrl, options = {}) {
  const {
    gaussianRadius = 1,
    contrastBoost = 1.4,
    saturationBoost = 1.6,
    sharpenEdges = true,
    sharpenStrength = 0.9,
    outputSize = 1024,
    // NEW: color quantization to clean up color boundaries
    posterizeColors = true,
    posterizeLevels = 6,
    // NEW: morphological cleanup
    morphologyCleanup = true,
  } = options;

  const img = await loadImage(imageUrl);

  const scale = Math.min(outputSize / img.width, outputSize / img.height, 1);
  const W = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  // Step 1: Light blur to reduce JPEG artifacts / noise BEFORE color analysis
  if (gaussianRadius > 0) {
    applyGaussianBlur(ctx, W, H, gaussianRadius);
  }

  // Step 2: Contrast + saturation — make color zones more distinct
  applyContrastSaturation(ctx, W, H, contrastBoost, saturationBoost);

  // Step 3: Posterize — quantize colors to clean up boundaries between regions
  // This is the key step that makes vectorization much cleaner
  if (posterizeColors) {
    applyPosterize(ctx, W, H, posterizeLevels);
  }

  // Step 4: Morphological cleanup — remove salt-and-pepper noise between regions
  if (morphologyCleanup) {
    applyMedianFilter(ctx, W, H);
  }

  // Step 5: Unsharp mask — re-sharpen edges after posterization
  if (sharpenEdges) {
    applyUnsharpMask(ctx, W, H, sharpenStrength);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('canvas.toBlob devolvió null — posible canvas tainted por CORS'));
        return;
      }
      const url = URL.createObjectURL(blob);
      resolve({ url, blob, width: W, height: H });
    }, 'image/png', 0.95);
  });
}

/**
 * Posterize: quantize each channel to N levels.
 * Dramatically cleans up color region boundaries for vectorization.
 */
function applyPosterize(ctx, W, H, levels) {
  const imageData = ctx.getImageData(0, 0, W, H);
  const d = imageData.data;
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    d[i]     = Math.round(Math.round(d[i]     / step) * step);
    d[i + 1] = Math.round(Math.round(d[i + 1] / step) * step);
    d[i + 2] = Math.round(Math.round(d[i + 2] / step) * step);
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * 3x3 Median filter — removes isolated noise pixels between color regions.
 * Much better than blur for preserving sharp edges while killing outliers.
 */
function applyMedianFilter(ctx, W, H) {
  const imageData = ctx.getImageData(0, 0, W, H);
  const src = new Uint8ClampedArray(imageData.data);
  const dst = imageData.data;
  const samples = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = (y * W + x) * 4;
      if (src[idx + 3] < 128) continue;
      for (let ch = 0; ch < 3; ch++) {
        samples.length = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            samples.push(src[((y + dy) * W + (x + dx)) * 4 + ch]);
          }
        }
        samples.sort((a, b) => a - b);
        dst[idx + ch] = samples[4]; // median of 9
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
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

/**
 * Box blur approximation of Gaussian (fast, 3 passes)
 */
function applyGaussianBlur(ctx, W, H, radius) {
  const passes = 2;
  for (let p = 0; p < passes; p++) {
    const imageData = ctx.getImageData(0, 0, W, H);
    const src = new Uint8ClampedArray(imageData.data);
    const dst = imageData.data;
    const r = Math.max(1, Math.round(radius));
    boxBlurH(src, dst, W, H, r);
    const tmp = new Uint8ClampedArray(dst);
    boxBlurV(tmp, dst, W, H, r);
    ctx.putImageData(imageData, 0, 0);
  }
}

function boxBlurH(src, dst, W, H, r) {
  const iarr = 1 / (r + r + 1);
  for (let i = 0; i < H; i++) {
    for (let ch = 0; ch < 3; ch++) {
      let val = src[i * W * 4 + ch] * (r + 1);
      for (let j = 0; j < r; j++) val += src[(i * W + j) * 4 + ch];
      for (let j = 0; j <= r; j++) {
        val += src[(i * W + Math.min(j + r, W - 1)) * 4 + ch] - src[(i * W) * 4 + ch];
        dst[(i * W + j) * 4 + ch] = Math.round(val * iarr);
      }
      for (let j = r + 1; j < W - r; j++) {
        val += src[(i * W + j + r) * 4 + ch] - src[(i * W + j - r - 1) * 4 + ch];
        dst[(i * W + j) * 4 + ch] = Math.round(val * iarr);
      }
      for (let j = W - r; j < W; j++) {
        val += src[(i * W + W - 1) * 4 + ch] - src[(i * W + j - r - 1) * 4 + ch];
        dst[(i * W + j) * 4 + ch] = Math.round(val * iarr);
      }
    }
    // copy alpha unchanged
    for (let j = 0; j < W; j++) dst[(i * W + j) * 4 + 3] = src[(i * W + j) * 4 + 3];
  }
}

function boxBlurV(src, dst, W, H, r) {
  const iarr = 1 / (r + r + 1);
  for (let j = 0; j < W; j++) {
    for (let ch = 0; ch < 3; ch++) {
      let val = src[j * 4 + ch] * (r + 1);
      for (let i = 0; i < r; i++) val += src[(i * W + j) * 4 + ch];
      for (let i = 0; i <= r; i++) {
        val += src[(Math.min(i + r, H - 1) * W + j) * 4 + ch] - src[j * 4 + ch];
        dst[(i * W + j) * 4 + ch] = Math.round(val * iarr);
      }
      for (let i = r + 1; i < H - r; i++) {
        val += src[((i + r) * W + j) * 4 + ch] - src[((i - r - 1) * W + j) * 4 + ch];
        dst[(i * W + j) * 4 + ch] = Math.round(val * iarr);
      }
      for (let i = H - r; i < H; i++) {
        val += src[((H - 1) * W + j) * 4 + ch] - src[((i - r - 1) * W + j) * 4 + ch];
        dst[(i * W + j) * 4 + ch] = Math.round(val * iarr);
      }
    }
    for (let i = 0; i < H; i++) dst[(i * W + j) * 4 + 3] = src[(i * W + j) * 4 + 3];
  }
}

/**
 * Contrast boost (S-curve) + saturation via HSL
 */
function applyContrastSaturation(ctx, W, H, contrast, saturation) {
  const imageData = ctx.getImageData(0, 0, W, H);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;

    // Contrast via midpoint stretch
    r = clamp((r - 0.5) * contrast + 0.5);
    g = clamp((g - 0.5) * contrast + 0.5);
    b = clamp((b - 0.5) * contrast + 0.5);

    // Saturation via luminance mix
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = clamp(lum + (r - lum) * saturation);
    g = clamp(lum + (g - lum) * saturation);
    b = clamp(lum + (b - lum) * saturation);

    d[i] = r * 255;
    d[i + 1] = g * 255;
    d[i + 2] = b * 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Unsharp mask: original - blurred * strength + original
 * Amplifies high-frequency edges.
 */
function applyUnsharpMask(ctx, W, H, strength) {
  // Save original
  const original = ctx.getImageData(0, 0, W, H);
  const origData = new Uint8ClampedArray(original.data);

  // Blur a copy
  const blurred = ctx.getImageData(0, 0, W, H);
  const blurData = new Uint8ClampedArray(blurred.data);
  boxBlurH(blurData, blurred.data, W, H, 2);
  const tmp = new Uint8ClampedArray(blurred.data);
  boxBlurV(tmp, blurred.data, W, H, 2);

  // Unsharp mask: sharpened = original + (original - blurred) * strength
  const result = ctx.getImageData(0, 0, W, H);
  const rd = result.data;
  for (let i = 0; i < rd.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const diff = origData[i + ch] - blurred.data[i + ch];
      rd[i + ch] = clamp255(origData[i + ch] + diff * strength);
    }
    rd[i + 3] = origData[i + 3];
  }
  ctx.putImageData(result, 0, 0);
}

function clamp(v) { return Math.max(0, Math.min(1, v)); }
function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }