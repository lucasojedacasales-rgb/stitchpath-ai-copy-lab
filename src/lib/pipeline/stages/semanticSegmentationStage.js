/**
 * Stage 3.5: Semantic Segmentation
 * Input:  ctx.contours, ctx.analysis, ctx.imageUrl, ctx.config
 * Output: ctx.semanticMap    — raw LLM object list
 *         ctx.contours       — contour regions enriched with .semantic field
 *
 * Skipped in 'fast' mode (too expensive). In all other modes, the LLM
 * identifies real objects (face, hair, clothing, outlines, etc.) and maps
 * each geometric contour to the most spatially overlapping semantic object.
 */

import { analyzeSemantics, mapContoursToSemantics, detectContentType } from '../../semanticSegmenter.js';
import { getModeStrategy } from '../../digitizeModes.js';

export async function runSemanticSegmentation(ctx) {
  const strategy = getModeStrategy(ctx.config.mode || 'hybrid');

  // Skip in fast mode — not worth the LLM latency
  if (strategy.id === 'fast') {
    ctx.semanticMap = null;
    return;
  }

  // Skip if no contours (vector engine hasn't run yet, nothing to enrich)
  if (!ctx.contours?.regions?.length) {
    ctx.semanticMap = null;
    return;
  }

  const imageUrl    = ctx.enhanced?.enhancedUrl || ctx.imageUrl;
  const contentType = detectContentType(ctx.analysis);

  // Store detected content type back into analysis for downstream stages
  if (ctx.analysis) ctx.analysis.contentType = contentType;

  // LLM Vision semantic analysis
  ctx.semanticMap = await analyzeSemantics(imageUrl, ctx.analysis, contentType);

  // Enrich contour regions with semantic metadata
  if (ctx.semanticMap?.objects?.length) {
    ctx.contours = {
      ...ctx.contours,
      regions: mapContoursToSemantics(ctx.contours.regions, ctx.semanticMap),
    };
  }
}