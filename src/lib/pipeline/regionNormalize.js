/**
 * regionNormalize.js — Vectorization stability helpers
 * ─────────────────────────────────────────────────────────────────────────────
 * Guarantees every region entering the pipeline has a consistent shape,
 * correct color (from real pixel/contour, never invented by IA), normalized
 * 0–1 coordinates, and proper background filtering.
 *
 * Public API:
 *   normalizeRegionForPipeline(region, ctx, config)
 *   filterBackgroundRegions(regions, ctx)
 *   clampColorToPalette(hex, paletteHexes)
 *   diagnosticValidate(regions, ctx)
 */

// ─── Color resolution ────────────────────────────────────────────────────────

export function resolveColor(region) {
  const hexRe = /^#[0-9a-f]{6}$/i;
  if (region.hex && hexRe.test(region.hex)) return region.hex.toLowerCase();
  if (region.color && hexRe.test(region.color)) return region.color.toLowerCase();
  if (region.hex) return region.hex;
  if (region.color) return region.color;
  if (region.rgb) return rgbToHex(region.rgb);
  return '#888888';
}

function rgbToHex(rgb) {
  let r, g, b;
  if (Array.isArray(rgb)) [r, g, b] = rgb;
  else if (rgb && typeof rgb === 'object') ({ r, g, b } = rgb);
  else return '#888888';
  const to = (v) => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 128,
    g: parseInt(h.slice(2, 4), 16) || 128,
    b: parseInt(h.slice(4, 6), 16) || 128,
  };
}

/**
 * Snaps a color to the nearest palette color when it's too far from ALL
 * palette entries. Prevents IA-invented colors (e.g. yellow on a blue image).
 * Threshold: if nearest palette distance² > 8000 (~90 RGB units), snap.
 */
export function clampColorToPalette(hex, paletteHexes) {
  if (!paletteHexes || paletteHexes.length === 0) return hex;
  const { r, g, b } = hexToRgb(hex);
  let best = hex, bestD = Infinity;
  for (const p of paletteHexes) {
    const { r: pr, g: pg, b: pb } = hexToRgb(p);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return bestD > 8000 ? best : hex;
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function polygonArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

function polygonPerimeter(pts) {
  let p = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p += Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
  }
  return p;
}

function computeCentroid(pts) {
  const n = pts.length;
  if (n === 0) return [0.5, 0.5];
  return [
    pts.reduce((s, p) => s + p[0], 0) / n,
    pts.reduce((s, p) => s + p[1], 0) / n,
  ];
}

// ─── Coordinate detection ────────────────────────────────────────────────────

function detectCoordMode(pts, config, ctx) {
  if (!pts || pts.length === 0) return 'normalized';
  let maxAbs = 0;
  for (const [x, y] of pts) {
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
  }
  if (maxAbs <= 1.5) return 'normalized';
  // Unnormalized → distinguish mm vs pixels.
  const wMm = config.width_mm || 100;
  const aW  = ctx?.contours?.analysisW || ctx?.contours?.imageWidth || 1024;
  // If values clearly exceed design mm range → pixels
  if (maxAbs > wMm * 3 && maxAbs > 200) return 'pixels';
  return 'mm';
}

function toNormalized(pts, mode, config, ctx) {
  if (mode === 'normalized') return pts;
  const wMm = config.width_mm || 100;
  const hMm = config.height_mm || 100;
  const aW  = ctx?.contours?.analysisW || ctx?.contours?.imageWidth || 1024;
  const aH  = ctx?.contours?.analysisH || ctx?.contours?.imageHeight || 1024;
  if (mode === 'pixels') {
    return pts.map(([x, y]) => [x / aW, y / aH]);
  }
  // mm
  return pts.map(([x, y]) => [x / wMm, y / hMm]);
}

// ─── Main normalizer ─────────────────────────────────────────────────────────

/**
 * Guarantees a region has: id, color, hex, path_points (normalized 0–1),
 * area_norm, area_mm2, perimeter_mm, centroid, stitch_type.
 * Never re-scales already-normalized coordinates.
 */
export function normalizeRegionForPipeline(region, ctx = {}, config = {}) {
  if (!region || !region.path_points || region.path_points.length < 3) return null;

  const wMm = config.width_mm || 100;
  const hMm = config.height_mm || 100;

  // Coordinates
  const mode = detectCoordMode(region.path_points, config, ctx);
  const normalizedPts = toNormalized(region.path_points, mode, config, ctx);

  // Color — from real pixel/contour, priority hex > color > rgb > fallback
  const color = resolveColor(region);

  // Area
  let area_norm = region.area_norm;
  if (area_norm == null || area_norm <= 0) {
    area_norm = region.area_mm2 != null
      ? region.area_mm2 / (wMm * hMm)
      : polygonArea(normalizedPts);
  }
  const area_mm2 = region.area_mm2 != null && region.area_mm2 > 0
    ? region.area_mm2
    : area_norm * wMm * hMm;

  // Perimeter (mm)
  let perimeter_mm = region.perimeter_mm;
  if (perimeter_mm == null || perimeter_mm <= 0) {
    const mmPts = normalizedPts.map(([x, y]) => [x * wMm, y * hMm]);
    perimeter_mm = polygonPerimeter(mmPts);
  }

  // Centroid — recompute from normalized pts if missing or unnormalized
  let centroid = region.centroid;
  if (!Array.isArray(centroid) || centroid.length < 2 ||
      Math.abs(centroid[0]) > 1.5 || Math.abs(centroid[1]) > 1.5) {
    centroid = computeCentroid(normalizedPts);
  }

  const id = region.id || `r_${Math.random().toString(36).slice(2, 9)}`;

  return {
    ...region,
    id,
    color,
    hex: color,
    path_points: normalizedPts,
    area_norm,
    area_mm2,
    perimeter_mm,
    centroid,
    stitch_type: region.stitch_type || 'fill',
  };
}

// ─── Background filtering ────────────────────────────────────────────────────

function countEdgesTouched(region, margin = 0.012) {
  const pts = region.path_points || [];
  if (pts.length === 0) return 0;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  let count = 0;
  if (minX <= margin) count++;
  if (maxX >= 1 - margin) count++;
  if (minY <= margin) count++;
  if (maxY >= 1 - margin) count++;
  return count;
}

function isLightOrBackgroundColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lum = (r + g + b) / 3;
  const delta = Math.max(r, g, b) - Math.min(r, g, b);
  if (lum > 200 && delta < 40) return true; // white / near-white
  if (lum > 175 && delta < 25) return true; // light gray
  return false;
}

/**
 * Removes background (fabric) regions. A region is background ONLY if it is
 * light/white/gray AND edge-touching AND large — i.e. clearly fabric, not the
 * embroidered object. Saturated-color regions are NEVER removed, even when
 * they fill the frame (common for full-bleed logos / mascots).
 */
export function filterBackgroundRegions(regions, ctx = {}) {
  if (!regions || regions.length === 0) return [];

  const result = [];
  for (const r of regions) {
    const edges = countEdgesTouched(r);
    const area  = r.area_norm || 0;
    const cov   = r.coverage || area;
    const light = isLightOrBackgroundColor(r.color);

    // Light/white fabric that covers most of the frame and touches edges
    if (light && cov > 0.35 && edges >= 2) continue;
    // Light/white region touching all 4 edges = full-bleed fabric
    if (light && edges >= 4) continue;

    result.push(r);
  }
  return result;
}

// ─── Diagnostic validation (temporal, logs only) ─────────────────────────────

export function diagnosticValidate(regions, ctx = {}) {
  if (!regions || regions.length === 0) {
    console.warn('[vector][diagnostic] Sin regiones — revisar pipeline');
    return;
  }

  const contourPalette = (ctx.contours?.regions || [])
    .map(r => r.hex || r.color)
    .filter(Boolean);

  const finalColors = regions.map(r => r.color);
  const finalAreaRatios = regions.map(r => +(r.area_norm || 0).toFixed(3));

  console.log('[vector] final colors:', finalColors);
  console.log('[vector] final area ratios:', finalAreaRatios);

  // Check: no invented colors (every final color should be close to a contour color)
  let invented = 0;
  for (const c of finalColors) {
    if (contourPalette.length === 0) break;
    const { r, g, b } = hexToRgb(c);
    let minD = Infinity;
    for (const p of contourPalette) {
      const { r: pr, g: pg, b: pb } = hexToRgb(p);
      minD = Math.min(minD, (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2);
    }
    if (minD > 8000) invented++;
  }
  if (invented > 0) {
    console.warn(`[vector][diagnostic] ${invented} color(es) no presentes en la imagen original — posible invento de IA`);
  }

  // Check: main region shouldn't touch all 4 edges
  const main = regions.reduce((a, b) => (a.area_norm || 0) > (b.area_norm || 0) ? a : b);
  if (countEdgesTouched(main) >= 4) {
    console.warn('[vector][diagnostic] La región principal toca los 4 bordes — posible fondo no filtrado');
  }

  // Check: simple image → expect ≤2 regions
  if (regions.length > 2 && contourPalette.length <= 2) {
    console.warn(`[vector][diagnostic] ${regions.length} regiones para imagen simple (esperado ≤2)`);
  }

  // Check: no yellow if image has no yellow
  const hasYellowInImage = contourPalette.some(h => {
    const { r, g, b } = hexToRgb(h);
    return g > 180 && r > 180 && b < 120;
  });
  const hasYellowInResult = finalColors.some(h => {
    const { r, g, b } = hexToRgb(h);
    return g > 180 && r > 180 && b < 120;
  });
  if (hasYellowInResult && !hasYellowInImage) {
    console.warn('[vector][diagnostic] Amarillo detectado en resultado pero no en imagen original');
  }
}