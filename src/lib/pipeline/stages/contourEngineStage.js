/**
 * Stage 3: Contour Engine
 * Input:  ctx.enhanced (or ctx.imageUrl), ctx.config, ctx.analysis
 * Output: ctx.contours (ContourSet)
 *
 * Uses the professional contour engine (contourEngine.js) which delivers
 * Wilcom-equivalent quality: sub-pixel detection, Bézier smoothing, adaptive
 * Douglas-Peucker, Chaikin subdivision, corner preservation, gap closing, and
 * noise/short-segment removal.
 */

import { traceContoursProf } from '../../contourEngine.js';
import { getModeStrategy }   from '../../digitizeModes.js';
import { buildContoursForRegions } from '../../contourPathBuilder.js';
import { buildEdgeMap } from '../../edgeSnapper.js';

// Per-mode quality presets — map strategy knobs to contourEngine options.
// RDP epsilons raised across all modes to prevent sub-pixel micro-segmentation
// while preserving real geometric detail. minSegmentPx raised to filter noise.
// minAreaPx scales with analysisSize² to keep the physical minimum consistent.
// At 512px: 60*(512/1024)² ≈ 15px. At 1600px: 60*(1600/1024)² ≈ 146px.
// This ensures eyes and small details are always captured regardless of resolution.
const MODE_OPTIONS = {
  fast:      { analysisSize: 512,  chaikinPasses: 1, rdpBaseEpsilon: 2.2, minSegmentPx: 7,  cornerAngleDeg: 125, gapCloseThreshold: 14, minAreaPx: 25  },
  standard:  { analysisSize: 800,  chaikinPasses: 2, rdpBaseEpsilon: 1.5, minSegmentPx: 5,  cornerAngleDeg: 130, gapCloseThreshold: 12, minAreaPx: 40  },
  precision: { analysisSize: 1200, chaikinPasses: 3, rdpBaseEpsilon: 0.8, minSegmentPx: 3,  cornerAngleDeg: 120, gapCloseThreshold: 10, minAreaPx: 80  },
  hybrid:    { analysisSize: 1024, chaikinPasses: 3, rdpBaseEpsilon: 1.1, minSegmentPx: 4,  cornerAngleDeg: 128, gapCloseThreshold: 12, minAreaPx: 60  },
  ultra:     { analysisSize: 1600, chaikinPasses: 4, rdpBaseEpsilon: 0.6, minSegmentPx: 2,  cornerAngleDeg: 115, gapCloseThreshold: 8,  minAreaPx: 100 },
};

export async function runContourEngine(ctx) {
  const effectiveProfile = ctx.effectiveProfile || ctx.config?.effectiveProfile || null;
  const strategy   = getModeStrategy(effectiveProfile?.effectiveBaseEngine || ctx.config.mode || 'hybrid');
  const sourceUrl  = ctx.enhanced?.enhancedUrl || ctx.imageUrl;
  // color_count from the effective profile, then config/user slider, then strategy default.
  // Minimum 6 — optimal for character/mascot designs (body, eyes, mouth, cheeks, feet, contours).
  // More colors = over-segmentation + unnecessary thread changes on simple designs.
  const colorCount = Math.max(6, effectiveProfile?.effectiveColorCount || strategy.vectorizer?.color_count || ctx.config.color_count || 8);

  const modeOpts = { ...(MODE_OPTIONS[strategy.id] || MODE_OPTIONS.hybrid) };

  // Adaptive RDP epsilon: denser edges → tighter epsilon to preserve detail.
  // edgeDensityMap is a 2D grid of Sobel density [0,1]. Compute the mean.
  if (ctx.analysis?.edgeDensityMap) {
    const grid = ctx.analysis.edgeDensityMap;
    const flatMean = grid.flat().reduce((s, v) => s + v, 0) / (grid.length * grid[0].length);
    // Conservative adaptation: max tightening 15%, max loosening 15%.
    // High edge density often correlates with JPEG noise, not real detail —
    // over-tightening there causes micro-segmentation of smooth contours.
    const edgeFactor = 1.0 - (flatMean - 0.3) * 0.3;
    modeOpts.rdpBaseEpsilon = +(modeOpts.rdpBaseEpsilon * Math.max(0.85, Math.min(1.15, edgeFactor))).toFixed(3);
  }

  ctx.contours = await traceContoursProf(sourceUrl, colorCount, modeOpts);
  const contourRegions = ctx.contours?.regions || [];
  console.log(`[ContourEngine] Contornos detectados: ${contourRegions.length}`);

  // ── Edge map (skipped in safe mode — not needed) ────────────────────────
  // Safe mode generates contours purely from fill boundaries; edgeMap is
  // never used as a source or for confirmation.
  const safeMode = ctx.config?.contourSafeMode === true;
  if (safeMode) {
    ctx.edgeMap = null;
    console.log('[ContourEngine] Safe mode → edgeMap skipped');
  } else {
    ctx.edgeMap = await buildEdgeMap(sourceUrl);
    console.log(`[ContourEngine] Edge map construido (confirmación solo): ${ctx.edgeMap ? ctx.edgeMap.width + '×' + ctx.edgeMap.height : 'falló'}`);
  }

  // ── Build contour paths for FALLBACK regions only ───────────────────────
  // These contour regions are only used when vectorRegions is empty (fallback).
  // In safe mode, skip edge snapping entirely.
  if (contourRegions.length > 0 && !safeMode) {
    for (const r of contourRegions) {
      if (!r.id) r.id = `contour_${Math.random().toString(36).slice(2, 9)}`;
    }
    const { contours } = buildContoursForRegions(contourRegions, { edgeMap: ctx.edgeMap });
    for (const region of contourRegions) {
      const contour = contours.get(region.id);
      if (contour) region.contour = contour;
    }
  }
}