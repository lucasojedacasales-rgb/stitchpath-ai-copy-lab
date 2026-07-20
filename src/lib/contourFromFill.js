/**
 * contourFromFill.js — Contour generation from fill boundaries
 * ─────────────────────────────────────────────────────────────────────────────
 * NEW STRATEGY: contours are generated primarily from the path_points of
 * already-detected fill regions, NOT from loose edgeMap fragments.
 *
 * Public API:
 *   buildImageSampler(imageUrl)              → { sampleColorAt, sampleBorderDarkness }
 *   buildContourFromFillBoundary(region, sampler, options) → contour object | null
 *   isBorderLikeBlackRegion(region, nearbyFills)  → boolean
 *   separateFillsAndContours(regions, sampler)    → { fills, contours, report }
 *
 * CONTOUR OBJECT shape:
 *   {
 *     id, parentRegionId, type: "contour",
 *     stitch_type: "run" | "satin",
 *     contour_points, path_points, color, hex,
 *     contour_width_mm, contour_class, confidence,
 *     source: "fill_boundary"
 *   }
 */

import { snapContourToEdges, measureContourAlignment } from './edgeSnapper.js';

const DARK_LUM_THRESHOLD = 60;
const BORDER_DARK_RATIO = 0.35;   // 35% of border samples must be dark to confirm a real dark border
const SATIN_WIDTH_THRESHOLD = 2.0; // mm — wider than this → satin, thinner → run
const RDP_EPSILON = 0.004;
const CLOSE_TOL = 0.008;
const MIN_CONTOUR_PTS = 3;

// ═══════════════════════════════════════════════════════════════════════════
//  IMAGE SAMPLER — loads original image once, provides color sampling
// ═══════════════════════════════════════════════════════════════════════════

const samplerCache = new Map();

/**
 * Loads the original image and returns sampling helpers.
 * Cached by URL — only loads once per image.
 */
export async function buildImageSampler(imageUrl) {
  if (!imageUrl) return null;
  if (samplerCache.has(imageUrl)) return samplerCache.get(imageUrl);

  try {
    const img = await loadImage(imageUrl);
    const W = Math.min(img.width, 512);
    const H = Math.min(img.height, 512);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const imageData = ctx.getImageData(0, 0, W, H);

    const sampler = {
      width: W,
      height: H,
      imageData,

      /** Samples the average color at normalized (nx, ny) with a small radius. */
      sampleColorAt(nx, ny, radius = 2) {
        const x = Math.round(nx * (W - 1));
        const y = Math.round(ny * (H - 1));
        const px = imageData.data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const sx = x + dx, sy = y + dy;
            if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
            const i = (sy * W + sx) * 4;
            r += px[i]; g += px[i + 1]; b += px[i + 2]; count++;
          }
        }
        if (count === 0) return { r: 128, g: 128, b: 128 };
        return { r: r / count, g: g / count, b: b / count };
      },

      /**
       * Samples darkness along a contour path (normalized points).
       * Returns { darkRatio, avgColor, borderColor }.
       * darkRatio = fraction of samples where luminance < DARK_LUM_THRESHOLD.
       */
      sampleBorderDarkness(pts, searchRadius = 3) {
        if (!pts || pts.length === 0) return { darkRatio: 0, avgColor: { r: 128, g: 128, b: 128 }, borderColor: null };
        let darkCount = 0, totalR = 0, totalG = 0, totalB = 0, sampled = 0;
        const step = Math.max(1, Math.floor(pts.length / 60)); // sample up to 60 points
        for (let i = 0; i < pts.length; i += step) {
          // Sample slightly OUTSIDE the boundary (along outward normal)
          const p = pts[i];
          const next = pts[(i + 1) % pts.length];
          const prev = pts[(i - 1 + pts.length) % pts.length];
          // Outward normal approximation: perpendicular to tangent, pointing away from centroid
          const tx = next[0] - prev[0], ty = next[1] - prev[1];
          const tlen = Math.hypot(tx, ty);
          if (tlen < 1e-6) continue;
          // Normal (pointing outward — we check both sides)
          const nx1 = -ty / tlen, ny1 = tx / tlen;
          // Sample at the boundary point itself and ±searchRadius pixels outside
          for (const [dx, dy] of [[0, 0], [nx1 * 0.01, ny1 * 0.01], [-nx1 * 0.01, -ny1 * 0.01]]) {
            const sx = Math.min(0.999, Math.max(0, p[0] + dx));
            const sy = Math.min(0.999, Math.max(0, p[1] + dy));
            const c = sampler.sampleColorAt(sx, sy, 1);
            const lum = (c.r + c.g + c.b) / 3;
            if (lum < DARK_LUM_THRESHOLD) darkCount++;
            totalR += c.r; totalG += c.g; totalB += c.b; sampled++;
          }
        }
        if (sampled === 0) return { darkRatio: 0, avgColor: { r: 128, g: 128, b: 128 }, borderColor: null };
        const darkRatio = darkCount / sampled;
        const avgColor = { r: totalR / sampled, g: totalG / sampled, b: totalB / sampled };
        // If dark border confirmed, extract the darkest sampled color as border color
        let borderColor = null;
        if (darkRatio >= BORDER_DARK_RATIO) {
          // Find the darkest sample along the path
          let minLum = 255, darkestColor = { r: 20, g: 20, b: 20 };
          for (let i = 0; i < pts.length; i += step) {
            const c = sampler.sampleColorAt(pts[i][0], pts[i][1], 1);
            const lum = (c.r + c.g + c.b) / 3;
            if (lum < minLum) { minLum = lum; darkestColor = c; }
          }
          borderColor = rgbToHex(darkestColor);
        }
        return { darkRatio, avgColor, borderColor };
      },
    };

    samplerCache.set(imageUrl, sampler);
    // Clear cache if it grows too large
    if (samplerCache.size > 3) {
      const firstKey = samplerCache.keys().next().value;
      samplerCache.delete(firstKey);
    }
    return sampler;
  } catch (e) {
    console.warn('[contourFromFill] No se pudo construir image sampler:', e.message);
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

// ═══════════════════════════════════════════════════════════════════════════
//  BUILD CONTOUR FROM FILL BOUNDARY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Builds a clean contour object from a fill region's path_points.
 *
 * The contour follows the fill boundary (cleaned, simplified, smoothed).
 * The edgeMap is used ONLY to confirm the border exists and estimate color/width.
 *
 * @param {Object} region    — fill region with path_points
 * @param {Object} sampler   — image sampler (from buildImageSampler)
 * @param {Object} edgeMap   — optional, from buildEdgeMap (for alignment confirmation)
 * @param {Object} options   — { epsilon, searchRadius }
 * @returns {Object|null}    — contour object with source: "fill_boundary"
 */
export function buildContourFromFillBoundary(region, sampler, edgeMap, options = {}) {
  if (!region || !region.path_points) return null;
  const pts = region.path_points;
  if (pts.length < MIN_CONTOUR_PTS) return null;

  const epsilon = options.epsilon ?? RDP_EPSILON;

  // 1. Clean perimeter
  let contour = dedupePoints(pts);
  if (contour.length < MIN_CONTOUR_PTS) return null;

  // 2. Close the polygon
  contour = ensureClosed(contour);

  // 3. Simplify (RDP)
  contour = rdpSimplify(contour, epsilon);
  if (contour.length < MIN_CONTOUR_PTS) return null;

  // 4. Smooth (1 Chaikin pass)
  contour = chaikinOnce(contour);
  if (contour.length < MIN_CONTOUR_PTS) return null;

  // 5. Re-close
  contour = ensureClosed(contour);

  // 6. EDGE SNAP — only to CONFIRM the border, not as primary source
  //    Light snap: small search radius, only if edgeMap available
  let alignment = null;
  if (edgeMap) {
    contour = snapContourToEdges(contour, edgeMap, {
      searchRadius: options.searchRadius ?? 3,
      threshold: options.snapThreshold,
    });
    alignment = measureContourAlignment(contour, edgeMap);
    contour = ensureClosed(contour);
    if (contour.length < MIN_CONTOUR_PTS) return null;
  }

  // 7. Determine contour color by sampling the original image border
  let contourColor = null;
  let borderDarkRatio = 0;
  if (sampler) {
    const darkness = sampler.sampleBorderDarkness(contour);
    borderDarkRatio = darkness.darkRatio;
    if (darkness.borderColor) {
      contourColor = darkness.borderColor;
    }
  }
  // Fallback color hierarchy
  if (!contourColor) {
    if (region.contourColor) {
      contourColor = region.contourColor;
    } else if (borderDarkRatio > 0.15) {
      // Some darkness detected — use black
      contourColor = '#1a1a1a';
    } else {
      // No evidence of a real dark border — don't generate contour
      return null;
    }
  }

  // 8. Determine stitch type based on border width
  const borderWidthMm = estimateBorderWidthMm(region, sampler, contour);
  const stitchType = borderWidthMm >= SATIN_WIDTH_THRESHOLD ? 'satin' : 'running_stitch';

  // 9. Classify
  const contourClass = classifyBoundaryContour(region, contour);

  // 10. Confidence
  let confidence = 70;
  if (borderDarkRatio >= BORDER_DARK_RATIO) confidence += 20;
  if (alignment) confidence = Math.round(confidence * 0.8 + alignment.alignmentScore * 0.2);
  confidence = Math.max(0, Math.min(100, confidence));

  const baseName = (region.name || region.object || 'body').replace(/_(fill|sat|run|contour|outline|detail)$/i, '');
  const shortType = stitchType === 'satin' ? 'satin' : 'run';
  const contourName = `${baseName}_outline_${shortType}`;

  return {
    id: `contour_${region.id}`,
    parentRegionId: region.id,
    type: 'contour',
    stitch_type: stitchType,
    contour_points: contour,
    path_points: contour,
    color: contourColor,
    hex: contourColor,
    contour_color: contourColor,
    contour_width_mm: borderWidthMm,
    contour_class: contourClass,
    confidence,
    source: 'fill_boundary',
    closed: true,
    edge_alignment: alignment,
    name: contourName,
    visible: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  BORDER-LIKE BLACK REGION DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determines if a dark/black region is actually a BORDER (contour) rather
 * than a fill body.
 *
 * Core principle: "Si el negro funciona como borde visual, no es fill."
 *
 * The PRIMARY test is functional — does the dark region SURROUND or lie
 * along the edge of a lighter fill region? If yes, it's a border regardless
 * of thickness. Geometry (thin vs thick) only determines run vs satin,
 * not whether it's a contour.
 *
 * A dark region is a BORDER if ALL hold:
 *   1. Dark color (lum < DARK_LUM_THRESHOLD)
 *   2. There exists a lighter (non-dark) fill region that it either:
 *      a) SURROUNDS (fill bbox is inside dark bbox), or
 *      b) RIMS (dark bbox tightly overlaps the fill bbox on the outer edge)
 *   3. The dark region is NOT the dominant body — its area is smaller than
 *      the total lighter fill area it borders (prevents converting a big
 *      black body with a small colored eye into a contour).
 *
 * Geometry (perimAreaRatio, meanWidth) is logged for stitch-type selection
 * but does NOT gate the border decision.
 *
 * @param {Object} region          — candidate black region (enriched)
 * @param {Array}  nearbyFills     — all regions (used to find bordered fills)
 * @returns {boolean}
 */
export function isBorderLikeBlackRegion(region, nearbyFills = []) {
  if (!region) return false;

  // 1. Must be dark
  const color = region.color || region.hex || '#888888';
  const { r, g, b } = hexToRgb(color);
  const lum = (r + g + b) / 3;
  if (lum >= DARK_LUM_THRESHOLD) return false;

  const area = region.area_mm2 || 0;
  if (area <= 0) return false;

  const bbox = computeBbox(region.path_points || []);
  if (bbox.w <= 0) return false;

  // 2. Functional test: find lighter fills this dark region borders
  let borderedFillArea = 0;
  let surroundsCount = 0;
  let rimsCount = 0;

  for (const fill of nearbyFills) {
    if (fill.id === region.id) continue;
    const fillColor = fill.color || fill.hex || '#888888';
    const fc = hexToRgb(fillColor);
    const fillLum = (fc.r + fc.g + fc.b) / 3;
    if (fillLum < DARK_LUM_THRESHOLD) continue; // skip other dark regions

    const fb = computeBbox(fill.path_points || []);
    if (fb.w <= 0) continue;

    // (a) SURROUNDS: the lighter fill is entirely (or mostly) inside the dark bbox
    const fillInsideDark =
      fb.minX >= bbox.minX - 0.03 && fb.maxX <= bbox.maxX + 0.03 &&
      fb.minY >= bbox.minY - 0.03 && fb.maxY <= bbox.maxY + 0.03;

    // (b) RIMS: dark bbox tightly overlaps the fill on the outer edge —
    //     the dark region's bbox is NOT inside the fill, but overlaps it
    //     significantly (the dark band sits along the fill boundary).
    const darkInsideFill =
      bbox.minX >= fb.minX - 0.03 && bbox.maxX <= fb.maxX + 0.03 &&
      bbox.minY >= fb.minY - 0.03 && bbox.maxY <= fb.maxY + 0.03;

    const bboxOverlap = bboxIoU(bbox, fb);

    if (fillInsideDark) {
      surroundsCount++;
      borderedFillArea += (fill.area_mm2 || 0);
    } else if (!darkInsideFill && bboxOverlap > 0.15) {
      // Dark band rims the fill edge from outside
      rimsCount++;
      borderedFillArea += (fill.area_mm2 || 0) * 0.5;
    }
  }

  // Must border at least one lighter fill (surround or rim)
  if (surroundsCount === 0 && rimsCount === 0) return false;

  // 3. Dominance guard: if the dark region's area is much larger than all
  //    the lighter fills it borders, it's a body with small details, not a border.
  //    Allow border if dark area < 2.5× the bordered fill area.
  if (area > 2.5 * borderedFillArea) return false;

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DETAIL-LIKE DARK REGION DETECTION (eyes, mouth, nose — inner features)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determines if a dark region is an inner DETAIL (eye, mouth, nose) rather
 * than a fill body or an outer border.
 *
 * A dark region is a DETAIL if:
 *   1. Dark color (lum < DARK_LUM_THRESHOLD)
 *   2. Small area (area < 120mm² — eyes/mouth are small features)
 *   3. Sits INSIDE a larger lighter fill region (its bbox is within the parent)
 *   4. The parent fill is significantly larger (parent area > 3× detail area)
 *
 * Details become running_stitch contours — tatami fill on a 5mm eye is
 * machine-impractical and visually wrong.
 *
 * @param {Object} region      — candidate dark region (enriched)
 * @param {Array}  allRegions  — all regions (to find containing parent)
 * @returns {boolean}
 */
export function isDetailLikeDarkRegion(region, allRegions = []) {
  if (!region) return false;

  const color = region.color || region.hex || '#888888';
  const { r, g, b } = hexToRgb(color);
  const lum = (r + g + b) / 3;
  if (lum >= DARK_LUM_THRESHOLD) return false;

  const area = region.area_mm2 || 0;
  if (area <= 0 || area > 120) return false; // details are small

  const bbox = computeBbox(region.path_points || []);
  if (bbox.w <= 0) return false;

  // Find a lighter fill that CONTAINS this region
  for (const fill of allRegions) {
    if (fill.id === region.id) continue;
    const fillColor = fill.color || fill.hex || '#888888';
    const fc = hexToRgb(fillColor);
    const fillLum = (fc.r + fc.g + fc.b) / 3;
    if (fillLum < DARK_LUM_THRESHOLD) continue; // skip other dark regions

    const fb = computeBbox(fill.path_points || []);
    if (fb.w <= 0) continue;

    // This region's bbox is inside the fill's bbox
    const contained =
      bbox.minX >= fb.minX - 0.02 && bbox.maxX <= fb.maxX + 0.02 &&
      bbox.minY >= fb.minY - 0.02 && bbox.maxY <= fb.maxY + 0.02;

    const fillArea = fill.area_mm2 || 0;

    if (contained && fillArea > 3 * area) {
      return true;
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SEPARATE FILLS AND CONTOURS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Separates enriched regions into fills and contour objects.
 *
 * Black border-like regions are removed from fills and converted to contour
 * objects. Then boundary contours are generated from remaining fill regions.
 *
 * @param {Array}  regions   — enriched regions from enrichAllRegions
 * @param {Object} sampler   — image sampler
 * @param {Object} edgeMap   — optional edge map for confirmation
 * @returns {{ fills, contours, report }}
 */
export function separateFillsAndContours(regions, sampler, edgeMap) {
  console.log(`[contour-fix] fill regions input: ${regions.length}`);

  // ── 1. Identify black border-like regions ───────────────────────────────
  const blackCandidates = regions.filter(r => {
    const color = r.color || r.hex || '#888888';
    const { r: rr, g, b } = hexToRgb(color);
    return (rr + g + b) / 3 < DARK_LUM_THRESHOLD;
  });
  console.log(`[contour-fix] black fill candidates: ${blackCandidates.length}`);

  const borderRegions = blackCandidates.filter(r => isBorderLikeBlackRegion(r, regions));
  const borderIds = new Set(borderRegions.map(r => r.id));
  console.log(`[contour-fix] black fills converted to outline contours: ${borderRegions.length}`);
  for (const br of borderRegions) {
    const w = (br.mean_width_mm || 0).toFixed(1);
    const a = (br.area_mm2 || 0).toFixed(0);
    console.log(`  ↳ "${br.name}" → outline contour (area=${a}mm², width=${w}mm)`);
  }

  // ── 1b. Identify detail-like dark regions (eyes, mouth — inner features) ─
  const remainingAfterBorders = blackCandidates.filter(r => !borderIds.has(r.id));
  const detailRegions = remainingAfterBorders.filter(r => isDetailLikeDarkRegion(r, regions));
  const detailIds = new Set(detailRegions.map(r => r.id));
  console.log(`[contour-fix] dark details converted to detail contours: ${detailRegions.length}`);
  for (const dr of detailRegions) {
    const a = (dr.area_mm2 || 0).toFixed(0);
    console.log(`  ↳ "${dr.name}" → detail contour (area=${a}mm²)`);
  }

  const notConverted = remainingAfterBorders.filter(r => !detailIds.has(r.id));
  for (const nc of notConverted) {
    const a = (nc.area_mm2 || 0).toFixed(0);
    console.log(`  ↳ "${nc.name}" stays fill (area=${a}mm²)`);
  }

  // ── 2. Remaining fills (exclude borders AND details) ────────────────────
  const allContourIds = new Set([...borderIds, ...detailIds]);
  let fills = regions.filter(r => !allContourIds.has(r.id));

  // Mark fills with type: "fill"
  for (const f of fills) {
    f.type = 'fill';
  }

  // ── 3. Convert border regions to outline contours ───────────────────────
  const contours = [];
  for (const br of borderRegions) {
    const contour = convertBlackRegionToContour(br, fills, 'outline');
    if (contour) contours.push(contour);
  }

  // ── 3b. Convert detail regions to detail contours ───────────────────────
  for (const dr of detailRegions) {
    const contour = convertBlackRegionToContour(dr, fills, 'detail');
    if (contour) contours.push(contour);
  }

  // ── 4. Generate boundary contours from fill regions ─────────────────────
  let boundaryGenerated = 0;
  for (const fill of fills) {
    // Only generate boundary contour if the fill has a visible dark border
    const boundary = buildContourFromFillBoundary(fill, sampler, edgeMap);
    if (boundary) {
      // Attach to the fill region (for canvas rendering as contour layer)
      fill.contour = boundary;
      contours.push(boundary);
      boundaryGenerated++;
    }
  }
  console.log(`[contour-fix] boundary contours generated: ${boundaryGenerated}`);

  // ── 5. Deduplicate contours (a black border region + its fill's boundary
  //       contour may overlap — keep the one with higher confidence) ───────
  const dedupedContours = deduplicateContourObjects(contours);
  const edgeMapRejected = contours.length - dedupedContours.length;
  console.log(`[contour-fix] edgeMap fragments rejected: ${edgeMapRejected}`);

  // ── 6. Logs ─────────────────────────────────────────────────────────────
  console.log(`[contour-fix] final fill objects: ${fills.length}`);
  console.log(`[contour-fix] final contour objects: ${dedupedContours.length}`);
  console.log(`[contour-fix] contour names: ${dedupedContours.map(c => c.name).join(', ') || 'none'}`);

  return {
    fills,
    contours: dedupedContours,
    report: {
      fillRegionsInput: regions.length,
      blackFillCandidates: blackCandidates.length,
      blackBordersConverted: borderRegions.length,
      darkDetailsConverted: detailRegions.length,
      boundaryContoursGenerated: boundaryGenerated,
      edgeMapFragmentsRejected: edgeMapRejected,
      finalFillObjects: fills.length,
      finalContourObjects: dedupedContours.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONVERT BLACK REGION TO CONTOUR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts a dark fill region into a contour object.
 * Uses the region's own path_points as the contour path.
 *
 * @param {Object}  region  — dark region (enriched)
 * @param {Array}   fills   — remaining fill regions (for parent lookup)
 * @param {String}  role    — 'outline' (border) | 'detail' (inner feature)
 */
function convertBlackRegionToContour(region, fills, role = 'outline') {
  const pts = region.path_points;
  if (!pts || pts.length < MIN_CONTOUR_PTS) return null;

  // Clean the path
  let contour = dedupePoints(pts);
  contour = ensureClosed(contour);
  contour = rdpSimplify(contour, RDP_EPSILON);
  contour = chaikinOnce(contour);
  contour = ensureClosed(contour);

  if (contour.length < MIN_CONTOUR_PTS) return null;

  // Find the nearest fill region (parent)
  const parent = findNearestFill(region, fills);
  const widthMm = region.mean_width_mm || 1.2;

  // Outline: stitch type from width (satin if thick, run if thin)
  // Detail: always running_stitch — eyes/mouth are tiny features
  const stitchType = role === 'detail'
    ? 'running_stitch'
    : (widthMm >= SATIN_WIDTH_THRESHOLD ? 'satin' : 'running_stitch');

  // Naming: use the region's OWN name for details (eye, mouth),
  //         the parent's name for outlines (body, foot).
  const nameSource = role === 'detail'
    ? (region.name || region.object || 'detail')
    : (parent?.name || parent?.object || 'body');
  const baseName = nameSource.replace(/_(fill|sat|run|contour|outline|detail)$/i, '');
  const shortType = stitchType === 'satin' ? 'satin' : 'run';
  const contourName = `${baseName}_${role}_${shortType}`;

  return {
    id: `contour_${region.id}`,
    parentRegionId: parent?.id || region.id,
    type: 'contour',
    stitch_type: stitchType,
    contour_points: contour,
    path_points: contour,
    color: region.color || '#1a1a1a',
    hex: region.color || '#1a1a1a',
    contour_color: region.color || '#1a1a1a',
    contour_width_mm: Math.max(0.8, Math.min(4.0, widthMm)),
    contour_class: role === 'detail' ? 'inner_detail' : 'outer_silhouette',
    confidence: role === 'detail' ? 80 : 85,
    source: role === 'detail' ? 'dark_detail_conversion' : 'black_border_conversion',
    closed: true,
    name: contourName,
    visible: true,
  };
}

function findNearestFill(region, fills) {
  if (!fills.length) return null;
  const [cx, cy] = region.centroid || [0.5, 0.5];
  let best = null, bestDist = Infinity;
  for (const f of fills) {
    if (!f.centroid) continue;
    const d = Math.hypot(f.centroid[0] - cx, f.centroid[1] - cy);
    if (d < bestDist) { bestDist = d; best = f; }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEDUPLICATE CONTOUR OBJECTS
// ═══════════════════════════════════════════════════════════════════════════

function deduplicateContourObjects(contours) {
  if (contours.length < 2) return contours;
  const keep = [];
  for (const c of contours) {
    const isDup = keep.some(k => contoursAreDuplicates(c, k));
    if (!isDup) keep.push(c);
    // If duplicate, keep the one with higher confidence
    else {
      const idx = keep.findIndex(k => contoursAreDuplicates(c, k));
      if (idx >= 0 && (c.confidence || 0) > (keep[idx].confidence || 0)) {
        keep[idx] = c;
      }
    }
  }
  return keep;
}

function contoursAreDuplicates(a, b) {
  if (a.contour_color !== b.contour_color) return false;
  const ba = computeBbox(a.contour_points);
  const bb = computeBbox(b.contour_points);
  const iou = bboxIoU(ba, bb);
  if (iou < 0.7) return false;
  const areaA = shoelaceArea(a.contour_points);
  const areaB = shoelaceArea(b.contour_points);
  if (Math.min(areaA, areaB) / Math.max(areaA, areaB) < 0.7) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function estimateBorderWidthMm(region, sampler, contour) {
  // If the region has mean_width_mm (it's a border region being converted), use it
  if (region.mean_width_mm && region.mean_width_mm > 0.5 && region.mean_width_mm < 8) {
    return Math.max(0.8, Math.min(4.0, region.mean_width_mm));
  }
  // Estimate from the image: sample the darkness band width along the border
  // For fill regions with a dark border, estimate by checking how far the
  // darkness extends outward. Simplified: use a default based on dark ratio.
  if (sampler) {
    const { darkRatio } = sampler.sampleBorderDarkness(contour);
    // High dark ratio = thick border → satin; low = thin → run
    if (darkRatio > 0.6) return 2.5;
    if (darkRatio > 0.4) return 1.8;
  }
  return 1.2; // default thin run
}

function classifyBoundaryContour(region, contour) {
  const area = shoelaceArea(contour);
  const bbox = computeBbox(contour);
  // Large area, not contained = outer silhouette
  if (area > 0.05) return 'outer_silhouette';
  // Small area, could be inner detail
  if (area < 0.01) return 'inner_detail';
  return 'decorative_line';
}

function dedupePoints(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-5) {
      out.push([p[0], p[1]]);
    }
  }
  if (out.length > 1) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-5) out.pop();
  }
  return out;
}

function ensureClosed(pts) {
  if (pts.length < 3) return pts;
  const f = pts[0], l = pts[pts.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) > CLOSE_TOL) {
    return [...pts, [f[0], f[1]]];
  }
  return pts;
}

function rdpSimplify(pts, epsilon) {
  if (pts.length < 4) return pts;
  const [first, last] = [pts[0], pts[pts.length - 1]];
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDistance(pts[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function pointLineDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const projX = a[0] + t * dx, projY = a[1] + t * dy;
  return Math.hypot(p[0] - projX, p[1] - projY);
}

function chaikinOnce(pts) {
  if (pts.length < 4) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    out.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
    out.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function computeBbox(pts) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function shoelaceArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

function bboxIoU(a, b) {
  const ix = Math.max(a.minX, b.minX), iy = Math.max(a.minY, b.minY);
  const ix2 = Math.min(a.maxX, b.maxX), iy2 = Math.min(a.maxY, b.maxY);
  const iw = Math.max(0, ix2 - ix), ih = Math.max(0, iy2 - iy);
  const inter = iw * ih;
  const ua = a.w * a.h + b.w * b.h - inter;
  return ua > 0 ? inter / ua : 0;
}

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 128,
    g: parseInt(h.slice(2, 4), 16) || 128,
    b: parseInt(h.slice(4, 6), 16) || 128,
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}