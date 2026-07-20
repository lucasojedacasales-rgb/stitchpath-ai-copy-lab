/**
 * Stage 6: Stitch Planner
 * Input:  ctx.regions, ctx.config
 * Output: ctx.plan (StitchPlan) + ctx.pathMetrics (needle path optimization)
 *
 * Generates strategic stitch plan (types, angles, layers) and calculates
 * optimal needle path to minimize jumps and color changes.
 */

import { generateStitchPlan } from '../../stitchPlanner.js';
import { optimizeNeedlePath } from '../../needlePath.js';

export async function runStitchPlanner(ctx) {
  if (!ctx.regions || ctx.regions.length === 0) {
    ctx.plan = null;
    ctx.pathMetrics = null;
    return;
  }

  // Filter to regions with valid geometry — prevents getCentroid crashes downstream
  const validRegions = ctx.regions.filter(r => r.path_points && r.path_points.length >= 3);

  // Generate stitch plan using only valid regions (was incorrectly using all regions before)
  ctx.plan = generateStitchPlan(validRegions, ctx.config);

  if (validRegions.length === 0) {
    ctx.pathMetrics = null;
    return;
  }

  // Optimize needle path considering priority and position
  const pathConfig = {
    width_mm: ctx.config.width_mm || 100,
    height_mm: ctx.config.height_mm || 100,
    speed_spm: ctx.config.machine_speed || 800,
  };

  ctx.pathMetrics = optimizeNeedlePath(validRegions, pathConfig);
}