/**
 * Stage 7: Stitch Optimizer (Travel Path)
 * Input:  ctx.regions, ctx.config
 * Output: ctx.optimized (OptimizedPlan)
 *
 * Only runs when the mode strategy enables travelOptimize.
 */

import { optimizeStitchSequence } from '../../stitchSequenceOptimizer.js';
import { getModeStrategy } from '../../digitizeModes.js';

export async function runStitchOptimizer(ctx) {
  const strategy = getModeStrategy(ctx.config.mode || 'hybrid');

  if (!strategy.stitchStrategy?.travelOptimize) {
    ctx.optimized = null;
    return;
  }

  if (!ctx.regions || ctx.regions.length === 0) {
    ctx.optimized = null;
    return;
  }

  const result = optimizeStitchSequence(ctx.regions, {
    width_mm:  ctx.config.width_mm  || 100,
    height_mm: ctx.config.height_mm || 100,
    speed_spm: ctx.config.machine_speed || 800,
  });

  // Store full result for downstream consumers (NeedlePathPanel, metrics bar)
  ctx.optimized = result;

  if (Array.isArray(result.optimizedSequence) && result.optimizedSequence.length > 0) {
    ctx.regions = result.optimizedSequence;
  }
}