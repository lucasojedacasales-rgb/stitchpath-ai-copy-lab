/**
 * vectorizationFusionEngine.js — Vectorization Orchestrator
 * ─────────────────────────────────────────────────────────────────────────────
 * Combines candidates from multiple vectorization sources, scores them
 * per-region and per-engine, fuses the best parts, and returns a clean
 * region set. Does NOT replace any existing engine — it orchestrates them.
 *
 * Sources tried (if available):
 *   • contourEngine      — ctx.contours.regions (geometric contours)
 *   • color segmentation — contours grouped/cleaned by color
 *   • semantic           — ctx.semanticMap.objects (LLM bboxes → polygons)
 *   • hybridDigitize     — backend (optional, may fail)
 *   • fallback           — ctx.contours.regions raw
 *
 * Output:
 *   { regions, candidates, selectedEngine, confidence, report }
 */

import { base44 } from '@/api/base44Client';
import {
  normalizeRegionForPipeline,
  filterBackgroundRegions,
  clampColorToPalette,
  hexToRgb,
} from './pipeline/regionNormalize.js';

// ═══════════════════════════════════════════════════════════════════════════
//  NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Guarantees a fusion candidate has valid path_points (≥3, normalized 0–1),
 * correct color/hex, computed area_norm, bbox, centroid, stitch_type.
 *
 * @param {Object} region       — raw region from any engine
 * @param {string} sourceEngine — 'contour' | 'color' | 'semantic' | 'hybrid' | 'fallback'
 * @param {Object} ctx          — pipeline context
 * @param {Object} config       — { width_mm, height_mm }
 * @returns {Object|null}       — normalized candidate or null if invalid
 */
export function normalizeFusionRegion(region, sourceEngine, ctx, config) {
  if (!region) return null;

  // Semantic objects have bbox but no path_points → synthesize a rectangle polygon
  if (sourceEngine === 'semantic' && region.bbox && !region.path_points) {
    const { x, y, w, h } = region.bbox;
    if (x == null || w == null || w <= 0 || h <= 0) return null;
    region = {
      ...region,
      path_points: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      color: region.color_hex || region.color || '#888888',
    };
  }

  // Use the shared normalizer for coordinate detection + color resolution
  const normalized = normalizeRegionForPipeline(region, ctx, config);
  if (!normalized) return null;

  // Re-validate path_points after normalization
  const pts = normalized.path_points;
  if (!pts || pts.length < 3) return null;

  // Double-scaling guard: if all points are in a tiny sub-range, they were
  // likely normalized twice (e.g. 0–0.1 instead of 0–1)
  const range = pointRange(pts);
  if (range.maxX - range.minX < 0.02 && range.maxY - range.minY < 0.02) return null;

  // Color: clamp to real contour palette if available
  const palette = (ctx.contours?.regions || [])
    .map(r => r.hex || r.color)
    .filter(Boolean);
  const color = palette.length > 0
    ? clampColorToPalette(normalized.color, palette)
    : normalized.color;

  return {
    id: normalized.id || `fusion_${sourceEngine}_${Math.random().toString(36).slice(2, 8)}`,
    sourceEngine,
    path_points: pts,
    color,
    hex: color,
    area_norm: normalized.area_norm,
    area_mm2: normalized.area_mm2,
    bbox: computeBbox(pts),
    centroid: normalized.centroid,
    confidence: 0, // set by scoreRegion
    stitch_type: normalized.stitch_type || 'fill',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  REGION SCORING (0–100)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scores a candidate 0–100 based on geometric + color + background quality.
 */
function scoreRegion(candidate, ctx) {
  let score = 100;
  const pts = candidate.path_points;
  const palette = (ctx.contours?.regions || []).map(r => r.hex || r.color).filter(Boolean);

  // 1. Closed contour — first and last point close together
  const closed = isClosed(pts);
  if (!closed) score -= 10;

  // 2. Right point count — too few = degenerate, too many = noise
  const n = pts.length;
  if (n < 4) score -= 15;
  else if (n > 500) score -= 8;

  // 3. Color coherent with original image
  if (palette.length > 0) {
    const { r, g, b } = hexToRgb(candidate.color);
    let minD = Infinity;
    for (const p of palette) {
      const { r: pr, g: pg, b: pb } = hexToRgb(p);
      minD = Math.min(minD, (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2);
    }
    if (minD > 8000) score -= 20; // invented color
    else if (minD > 3000) score -= 8;
  }

  // 4. Edge-touching + light color → likely background
  const edges = countEdgesTouched(pts);
  const { r, g, b } = hexToRgb(candidate.color);
  const lum = (r + g + b) / 3;
  const delta = Math.max(r, g, b) - Math.min(r, g, b);
  const isLight = lum > 175 && delta < 40;
  if (isLight && edges >= 2) score -= 25;
  if (isLight && edges >= 4) score -= 30;

  // 5. Reasonable area — not too tiny, not covering everything
  const area = candidate.area_norm || 0;
  if (area < 0.002) score -= 15;
  if (area > 0.85) score -= 20;

  // 6. Not a giant white/gray region
  if (isLight && area > 0.5) score -= 25;

  // 7. Not deformed — aspect ratio check
  const bbox = candidate.bbox;
  const aspect = bbox.w / Math.max(bbox.h, 0.001);
  if (aspect > 15 || aspect < 0.067) score -= 12;

  // 8. Self-intersections (capped scan for performance)
  if (hasSelfIntersections(pts, 60)) score -= 18;

  // 9. Double-scaling guard (already filtered in normalize, but penalize if borderline)
  const range = pointRange(pts);
  if (range.maxX > 1.2 || range.maxY > 1.2) score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ═══════════════════════════════════════════════════════════════════════════
//  ENGINE SCORING
// ═══════════════════════════════════════════════════════════════════════════

function scoreEngine(engineName, candidates, ctx) {
  if (candidates.length === 0) return 0;

  const valid = candidates.filter(c => c.confidence >= 50);
  const validRatio = valid.length / candidates.length;

  // Background removed percentage
  const bgRemoved = candidates.filter(c => isBackgroundCandidate(c)).length;
  const bgPct = candidates.length > 0 ? bgRemoved / candidates.length : 0;

  // Color coherence: average distance to palette
  const palette = (ctx.contours?.regions || []).map(r => r.hex || r.color).filter(Boolean);
  let colorCoherence = 1;
  if (palette.length > 0) {
    let totalD = 0;
    for (const c of valid) {
      const { r, g, b } = hexToRgb(c.color);
      let minD = Infinity;
      for (const p of palette) {
        const { r: pr, g: pg, b: pb } = hexToRgb(p);
        minD = Math.min(minD, (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2);
      }
      totalD += minD;
    }
    colorCoherence = Math.max(0, 1 - totalD / (valid.length * 8000));
  }

  // Contour quality: average closed + no self-intersections
  const closedRatio = valid.filter(c => isClosed(c.path_points)).length / Math.max(valid.length, 1);
  const cleanRatio = valid.filter(c => !hasSelfIntersections(c.path_points, 40)).length / Math.max(valid.length, 1);

  // Reasonable complexity
  const avgPoints = valid.reduce((s, c) => s + c.path_points.length, 0) / Math.max(valid.length, 1);
  const complexityOk = avgPoints >= 4 && avgPoints <= 300 ? 1 : 0.5;

  // Embroidery compatibility: not too many tiny regions, not too many colors
  const tinyCount = valid.filter(c => (c.area_norm || 0) < 0.003).length;
  const embroideryOk = Math.max(0, 1 - tinyCount / Math.max(valid.length, 1));

  const score = Math.round(
    validRatio * 25 +
    (1 - bgPct) * 15 +
    colorCoherence * 20 +
    closedRatio * 10 +
    cleanRatio * 10 +
    complexityOk * 10 +
    embroideryOk * 10
  );

  return Math.max(0, Math.min(100, score));
}

// ═══════════════════════════════════════════════════════════════════════════
//  FUSION — merge + deduplicate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detects duplicates: similar bbox + centroid + area + color.
 * Keeps the highest-scored version of each.
 */
function deduplicate(candidates) {
  const kept = [];
  let removed = 0;

  // Sort by confidence descending so we keep the best version
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);

  for (const c of sorted) {
    const isDup = kept.some(k => isDuplicatePair(k, c));
    if (isDup) {
      removed++;
      continue;
    }
    kept.push(c);
  }

  return { regions: kept, duplicatesRemoved: removed };
}

function isDuplicatePair(a, b) {
  // Centroid distance
  const cDist = Math.hypot(a.centroid[0] - b.centroid[0], a.centroid[1] - b.centroid[1]);
  if (cDist > 0.08) return false;

  // Bbox overlap
  const iou = bboxIoU(a.bbox, b.bbox);
  if (iou < 0.5) return false;

  // Area similarity
  const aArea = a.area_norm || 0;
  const bArea = b.area_norm || 0;
  if (aArea === 0 || bArea === 0) return false;
  const areaRatio = Math.min(aArea, bArea) / Math.max(aArea, bArea);
  if (areaRatio < 0.6) return false;

  // Color similarity
  const { r: ar, g: ag, b: ab } = hexToRgb(a.color);
  const { r: br, g: bg, b: bb } = hexToRgb(b.color);
  const colorD = (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
  if (colorD > 5000) return false;

  return true;
}

/**
 * Cross-engine color fusion: for each kept region, if another engine produced
 * a region at the same location with a more coherent color, adopt that color.
 * This lets us take contour from contourEngine + color from color segmentation.
 */
function fuseColors(regions, allCandidates) {
  return regions.map(r => {
    // Find candidates at the same location from other engines
    const nearby = allCandidates.filter(c =>
      c.id !== r.id &&
      c.sourceEngine !== r.sourceEngine &&
      isDuplicatePair(r, c) &&
      c.confidence >= r.confidence - 5
    );
    if (nearby.length === 0) return r;

    // Pick the one with the best color coherence (highest confidence)
    const best = nearby.reduce((a, b) => a.confidence > b.confidence ? a : b);
    return { ...r, color: best.color, hex: best.hex, _fusedColorFrom: best.sourceEngine };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  BACKGROUND FILTERING
// ═══════════════════════════════════════════════════════════════════════════

function isBackgroundCandidate(c) {
  const edges = countEdgesTouched(c.path_points);
  const { r, g, b } = hexToRgb(c.color);
  const lum = (r + g + b) / 3;
  const delta = Math.max(r, g, b) - Math.min(r, g, b);
  const isLight = lum > 175 && delta < 40;
  const area = c.area_norm || 0;

  if (isLight && area > 0.35 && edges >= 2) return true;
  if (isLight && edges >= 4) return true;
  if (area > 0.85 && isLight) return true;
  return false;
}

function filterBackground(candidates) {
  const before = candidates.length;
  const filtered = candidates.filter(c => !isBackgroundCandidate(c));
  return { regions: filtered, backgroundRemoved: before - filtered.length };
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs the fusion engine.
 *
 * @param {Object} params — { imageData, ctx, config }
 * @returns {{
 *   regions: Array,
 *   candidates: Array,
 *   selectedEngine: string,
 *   confidence: number,
 *   report: Object,
 * }}
 */
export async function runVectorizationFusion({ imageData, ctx, config }) {
  const warnings = [];
  const engineCandidates = new Map(); // engineName → candidates[]
  const engineScores = {};

  // ── Source 1: contourEngine (ctx.contours.regions) ──────────────────
  const contourRaw = ctx.contours?.regions || [];
  if (contourRaw.length > 0) {
    const candidates = contourRaw
      .map(r => normalizeFusionRegion(r, 'contour', ctx, config))
      .filter(Boolean)
      .map(c => ({ ...c, confidence: scoreRegion(c, ctx) }));
    engineCandidates.set('contour', candidates);
  }

  // ── Source 2: color segmentation (group contours by color) ──────────
  if (contourRaw.length > 0) {
    const colorGroups = groupByColor(contourRaw);
    const candidates = colorGroups
      .map(group => normalizeFusionRegion(
        { ...mergeGroup(group), color: group[0].hex || group[0].color },
        'color', ctx, config
      ))
      .filter(Boolean)
      .map(c => ({ ...c, confidence: scoreRegion(c, ctx) }));
    engineCandidates.set('color', candidates);
  }

  // ── Source 3: semantic segmentation (ctx.semanticMap.objects) ───────
  const semanticObjects = ctx.semanticMap?.objects || [];
  if (semanticObjects.length > 0) {
    const candidates = semanticObjects
      .map(o => normalizeFusionRegion(o, 'semantic', ctx, config))
      .filter(Boolean)
      .map(c => ({ ...c, confidence: scoreRegion(c, ctx) }));
    engineCandidates.set('semantic', candidates);
  }

  // ── Source 4: hybridDigitize backend (optional, best-effort) ────────
  try {
    const hybridRegions = await tryHybridDigitize(ctx, config);
    if (hybridRegions.length > 0) {
      const candidates = hybridRegions
        .map(r => normalizeFusionRegion(r, 'hybrid', ctx, config))
        .filter(Boolean)
        .map(c => ({ ...c, confidence: scoreRegion(c, ctx) }));
      engineCandidates.set('hybrid', candidates);
    }
  } catch (e) {
    warnings.push(`hybridDigitize falló: ${e.message}`);
  }

  // ── Source 5: fallback raw contours (always available if contours exist)
  if (contourRaw.length > 0 && !engineCandidates.has('fallback')) {
    const candidates = contourRaw
      .map(r => normalizeFusionRegion(r, 'fallback', ctx, config))
      .filter(Boolean)
      .map(c => ({ ...c, confidence: scoreRegion(c, ctx) }));
    // Only add fallback if other engines produced few candidates
    const totalSoFar = [...engineCandidates.values()].reduce((s, arr) => s + arr.length, 0);
    if (totalSoFar < 3) engineCandidates.set('fallback', candidates);
  }

  // ── Score engines ────────────────────────────────────────────────────
  for (const [name, candidates] of engineCandidates) {
    engineScores[name] = scoreEngine(name, candidates, ctx);
  }

  const enginesTested = [...engineCandidates.keys()];
  const allCandidates = [...engineCandidates.values()].flat();

  console.log(`[fusion] engines tested: ${enginesTested.join(', ')}`);
  console.log(`[fusion] candidates total: ${allCandidates.length}`);
  console.log(`[fusion] engine scores:`, engineScores);

  if (allCandidates.length === 0) {
    warnings.push('Ningún motor produjo candidatos válidos');
    return {
      regions: [],
      candidates: [],
      selectedEngine: 'none',
      confidence: 0,
      report: {
        enginesTested,
        engineScores,
        regionsBeforeFilter: 0,
        regionsAfterFilter: 0,
        duplicatesRemoved: 0,
        backgroundRemoved: 0,
        warnings,
      },
    };
  }

  // ── Background filtering ─────────────────────────────────────────────
  const bgResult = filterBackground(allCandidates);
  console.log(`[fusion] background removed: ${bgResult.backgroundRemoved}`);

  // ── Deduplication ────────────────────────────────────────────────────
  const dedupResult = deduplicate(bgResult.regions);
  console.log(`[fusion] duplicates removed: ${dedupResult.duplicatesRemoved}`);

  // ── Cross-engine color fusion ────────────────────────────────────────
  const fused = fuseColors(dedupResult.regions, allCandidates);

  // ── Select best engine (highest score with most valid regions) ──────
  const selectedEngine = Object.entries(engineScores)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'contour';
  const confidence = engineScores[selectedEngine] || 0;

  // Strip internal fields, keep clean region shape for downstream pipeline
  const finalRegions = fused.map(c => ({
    id: c.id,
    path_points: c.path_points,
    color: c.color,
    hex: c.hex,
    area_norm: c.area_norm,
    area_mm2: c.area_mm2,
    bbox: c.bbox,
    centroid: c.centroid,
    stitch_type: c.stitch_type,
    sourceEngine: c.sourceEngine,
  }));

  console.log(`[fusion] final regions: ${finalRegions.length}`);
  console.log(`[fusion] final colors: ${finalRegions.map(r => r.color).join(', ')}`);
  console.log(`[fusion] selected strategy: ${selectedEngine} (score ${confidence})`);

  return {
    regions: finalRegions,
    candidates: allCandidates,
    selectedEngine,
    confidence,
    report: {
      enginesTested,
      engineScores,
      regionsBeforeFilter: allCandidates.length,
      regionsAfterFilter: finalRegions.length,
      duplicatesRemoved: dedupResult.duplicatesRemoved,
      backgroundRemoved: bgResult.backgroundRemoved,
      warnings,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOURCE COLLECTORS
// ═══════════════════════════════════════════════════════════════════════════

async function tryHybridDigitize(ctx, config) {
  const imageUrl = ctx.enhanced?.enhancedUrl || ctx.imageUrl;
  if (!imageUrl) return [];

  const payload = {
    image_url: imageUrl,
    mode: 'hybrid',
    width_mm: config.width_mm || 100,
    height_mm: config.height_mm || 100,
    color_count: config.color_count || 8,
    remove_bg: config.remove_bg || false,
    traced_contours: ctx.contours || null,
  };

  const res = await base44.functions.invoke('hybridDigitize', payload);
  if (!res.data?.success) return [];
  const raw = res.data.data?.response || res.data.data;
  return raw.regions || [];
}

function groupByColor(regions) {
  const groups = new Map();
  for (const r of regions) {
    const hex = (r.hex || r.color || '#888888').toLowerCase();
    if (!groups.has(hex)) groups.set(hex, []);
    groups.get(hex).push(r);
  }
  return [...groups.values()];
}

function mergeGroup(group) {
  // Merge all path_points from same-color regions into one polygon (convex-ish hull)
  const allPts = group.flatMap(r => r.path_points || []);
  if (allPts.length < 3) return group[0];
  return {
    ...group[0],
    path_points: convexHull(allPts),
    area_norm: group.reduce((s, r) => s + (r.area_norm || 0), 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEOMETRY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function computeBbox(pts) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function pointRange(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function isClosed(pts, tol = 0.01) {
  if (pts.length < 3) return false;
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  return Math.hypot(fx - lx, fy - ly) < tol;
}

function countEdgesTouched(pts, margin = 0.012) {
  const bbox = computeBbox(pts);
  let count = 0;
  if (bbox.minX <= margin) count++;
  if (bbox.maxX >= 1 - margin) count++;
  if (bbox.minY <= margin) count++;
  if (bbox.maxY >= 1 - margin) count++;
  return count;
}

function bboxIoU(a, b) {
  const ix = Math.max(a.minX, b.minX);
  const iy = Math.max(a.minY, b.minY);
  const ix2 = Math.min(a.maxX, b.maxX);
  const iy2 = Math.min(a.maxY, b.maxY);
  const iw = Math.max(0, ix2 - ix);
  const ih = Math.max(0, iy2 - iy);
  const inter = iw * ih;
  const ua = (a.w * a.h) + (b.w * b.h) - inter;
  return ua > 0 ? inter / ua : 0;
}

/**
 * Self-intersection check — capped at maxCheck segments for performance.
 * Tests consecutive edge pairs (non-adjacent) for intersection.
 */
function hasSelfIntersections(pts, maxCheck = 60) {
  const n = pts.length;
  if (n < 4) return false;
  const limit = Math.min(n, maxCheck);
  for (let i = 0; i < limit; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < limit; j++) {
      if (j === (i - 1 + n) % n) continue; // adjacent
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Convex hull (Andrew's monotone chain) — for merging same-color regions.
 */
function convexHull(pts) {
  const points = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = points.length;
  if (n < 3) return points;

  const lower = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  return lower.slice(0, -1).concat(upper.slice(0, -1));
}