/**
 * pipeline/runner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the full client-side digitization pipeline.
 * Each stage is isolated; context flows through without mutation of prior stages.
 *
 * Usage:
 *   import { runPipeline, runStages } from '@/lib/pipeline/runner';
 *   const ctx = await runPipeline(imageUrl, config, { onProgress });
 */

import { createContext, logStage } from './types.js';
import { runImageAnalysis }          from './stages/imageAnalysisStage.js';
import { runImageEnhancement }       from './stages/imageEnhancementStage.js';
import { runContourEngine }          from './stages/contourEngineStage.js';
import { runSemanticSegmentation }   from './stages/semanticSegmentationStage.js';
import { runVectorEngine }           from './stages/vectorEngineStage.js';
import { runRegionBuilder }          from './stages/regionBuilderStage.js';
import { cleanCartoonSegmentationRegions } from '../cartoonSegmentationCleanup.js';
import { runStitchPlanner }          from './stages/stitchPlannerStage.js';
import { runStitchOptimizer }        from './stages/stitchOptimizerStage.js';

// ─── Stage registry (order matters) ──────────────────────────────────────────

const CLIENT_STAGES = [
  { id: 'image_analysis',        fn: runImageAnalysis,        weight: 10 },
  { id: 'image_enhancement',     fn: runImageEnhancement,     weight: 20 },
  { id: 'contour_engine',        fn: runContourEngine,        weight: 35 },
  { id: 'semantic_segmentation', fn: runSemanticSegmentation, weight: 50 }, // LLM Vision objects
  { id: 'vector_engine',         fn: runVectorEngine,         weight: 65 }, // backend call
  { id: 'region_builder',        fn: runRegionBuilder,        weight: 82 },
  { id: 'quality_phase_1_input_segmentation_cleanup', fn: runQualityPhase1InputSegmentationCleanup, weight: 87 },
  { id: 'stitch_planner',        fn: runStitchPlanner,        weight: 92 },
  { id: 'stitch_optimizer',      fn: runStitchOptimizer,      weight: 100 },
];

// ─── Main pipeline runner ─────────────────────────────────────────────────────

/**
 * Runs all pipeline stages sequentially.
 *
 * @param {string}   imageUrl
 * @param {Object}   config         - { mode, width_mm, height_mm, color_count, ... }
 * @param {Object}   [opts]
 * @param {Function} [opts.onProgress]  - (pct: number, stageId: string) => void
 * @param {string[]} [opts.skipStages]  - stage ids to skip
 * @param {Object}   [opts.initialCtx] - partial context to inject (e.g. pre-analyzed contours)
 * @returns {Promise<PipelineContext>}
 */
async function runQualityPhase1InputSegmentationCleanup(ctx) {
  if (!ctx.regions || ctx.regions.length === 0) return;
  const { regions, report } = cleanCartoonSegmentationRegions(ctx.regions, {
    ...ctx.config,
    darkStroke: ctx.darkStroke,
    inputAudit: ctx.inputAudit,
  });
  ctx.regions = regions;
  ctx.qualityPhase1Report = report;
}

export async function runPipeline(imageUrl, config, opts = {}) {
  const { onProgress, skipStages = [], initialCtx = {} } = opts;

  const ctx = createContext(imageUrl, config);
  // Merge any pre-computed data (e.g. contours already traced client-side)
  Object.assign(ctx, initialCtx);

  for (const stage of CLIENT_STAGES) {
    if (skipStages.includes(stage.id)) continue;

    const t0 = performance.now();
    onProgress?.(stage.weight, stage.id);

    try {
      await stage.fn(ctx);
      logStage(ctx, stage.id, performance.now() - t0, true);
    } catch (err) {
      logStage(ctx, stage.id, performance.now() - t0, false);
      console.error(`[Pipeline] Stage "${stage.id}" failed:`, err);
      // Non-fatal: downstream stages may still work with partial data
      ctx.stageLog[ctx.stageLog.length - 1].error = err.message;
    }
  }

  return ctx;
}

/**
 * Runs a subset of stages by name (for partial re-processing).
 * @param {PipelineContext} ctx  - existing context to continue from
 * @param {string[]}        stageIds
 * @param {Object}          [opts]
 * @returns {Promise<PipelineContext>}
 */
export async function runStages(ctx, stageIds, opts = {}) {
  const { onProgress } = opts;
  const toRun = CLIENT_STAGES.filter(s => stageIds.includes(s.id));

  for (const stage of toRun) {
    const t0 = performance.now();
    onProgress?.(null, stage.id);
    try {
      await stage.fn(ctx);
      logStage(ctx, stage.id, performance.now() - t0, true);
    } catch (err) {
      logStage(ctx, stage.id, performance.now() - t0, false);
      console.error(`[Pipeline] Stage "${stage.id}" failed:`, err);
      ctx.stageLog[ctx.stageLog.length - 1].error = err.message;
    }
  }

  return ctx;
}