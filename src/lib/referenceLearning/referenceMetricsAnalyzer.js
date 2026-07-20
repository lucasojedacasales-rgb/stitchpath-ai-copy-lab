/**
 * referenceMetricsAnalyzer.js — Reference Embroidery Learning System
 * ─────────────────────────────────────────────────────────────────────────────
 * Computes professional-grade metrics from a parsed reference file's command
 * list. Pure function of { commands, metadata } — does not touch the motor.
 *
 * Returns the canonical metrics object used by the classifier, the rule
 * extractor, the library and the Wilcom-style comparator.
 */

import { classifyStitchBlocks } from './stitchPatternClassifier';

const SHORT_MM = 1.0;
const LONG_VISIBLE_MM = 7.0;
const HISTOGRAM_BUCKETS = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 30];

function histogram(values, buckets) {
  const h = buckets.map(() => 0);
  for (const v of values) {
    let placed = false;
    for (let i = 0; i < buckets.length - 1; i++) {
      if (v >= buckets[i] && v < buckets[i + 1]) { h[i]++; placed = true; break; }
    }
    if (!placed) h[buckets.length - 1]++;
  }
  return h;
}

/**
 * @param {Array} commands — from referenceFileParser
 * @param {object} metadata — from referenceFileParser
 * @returns {object} canonical metrics
 */
export function analyzeReferenceMetrics(commands, metadata) {
  const stitchLengths = metadata.stitchLengths || [];
  const blocks = classifyStitchBlocks(commands);

  // Histograms
  const stitchLengthHistogram = histogram(stitchLengths, HISTOGRAM_BUCKETS);
  const jumpLengths = [];
  let prevCmd = null;
  for (const c of commands) {
    if (c.type === 'jump' && prevCmd) jumpLengths.push(Math.hypot(c.x - prevCmd.x, c.y - prevCmd.y));
    prevCmd = c;
  }
  const jumpLengthHistogram = histogram(jumpLengths, HISTOGRAM_BUCKETS);

  // Layer order profile: sequence of block types in sewing order
  const layerOrderProfile = blocks.map(b => b.blockType);

  // Block counts by type
  const byType = {
    fill_tatami: 0, satin_border: 0, running_outline: 0,
    double_run_detail: 0, underlay: 0, travel_jump: 0,
    noise: 0, unknown: 0,
  };
  for (const b of blocks) byType[b.blockType] = (byType[b.blockType] || 0) + 1;

  const contourLikeBlocks = byType.running_outline + byType.satin_border;
  const fillLikeBlocks = byType.fill_tatami;
  const satinLikeBlocks = byType.satin_border;
  const runningLikeBlocks = byType.running_outline + byType.double_run_detail;
  const possibleUnderlayBlocks = byType.underlay;

  // Visible travel score: ratio of visible travel distance to total stitch length
  const totalStitchLen = stitchLengths.reduce((s, l) => s + l, 0);
  const visibleTravelScore = totalStitchLen > 0 ? metadata.visibleTravelMm / totalStitchLen : 0;

  // Professional score (0-100) — heuristic from clean professional signals:
  //   + low visible travel, + low long-visible stitches, + low duplicates,
  //   + presence of contour blocks, + presence of underlay, + balanced density.
  let professionalScore = 50;
  professionalScore += clampScore((0.05 - visibleTravelScore) / 0.05) * 15;   // less travel = better
  professionalScore += clampScore((3 - metadata.longStitchCount) / 3) * 10;    // fewer long visible
  professionalScore += clampScore((5 - metadata.duplicateStitchCount) / 5) * 5;
  professionalScore += contourLikeBlocks > 0 ? 10 : 0;
  professionalScore += possibleUnderlayBlocks > 0 ? 10 : 0;
  professionalScore += clampScore((metadata.estimatedDensity - 0.05) / 0.05) * 10; // ~0.05-0.10 density ideal
  professionalScore = Math.max(0, Math.min(100, Math.round(professionalScore)));

  return {
    stitchCount: metadata.stitchCount,
    colorCount: metadata.colorCount,
    jumpCount: metadata.jumpCount,
    trimCount: metadata.trimCount,
    averageStitchLength: metadata.averageStitchLength,
    maxStitchLength: metadata.maxStitchLength,
    shortStitchCount: metadata.shortStitchCount,
    longVisibleStitchCount: metadata.longStitchCount,
    duplicateStitchCount: metadata.duplicateStitchCount,
    colorBlockCount: metadata.colorBlocks?.length || 0,
    estimatedDensity: metadata.estimatedDensity,
    stitchLengthHistogram,
    jumpLengthHistogram,
    layerOrderProfile,
    contourLikeBlocks,
    fillLikeBlocks,
    satinLikeBlocks,
    runningLikeBlocks,
    possibleUnderlayBlocks,
    visibleTravelScore,
    professionalScore,
    boundingBoxMm: metadata.boundingBoxMm,
  };
}

function clampScore(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Aggregates metrics across a batch of analyzed references.
 * @param {Array<object>} analyzedFiles — each has { metrics }
 * @returns {object} averages + ranges
 */
export function aggregateBatchMetrics(analyzedFiles) {
  if (!analyzedFiles.length) return null;
  const keys = ['stitchCount','colorCount','jumpCount','trimCount','averageStitchLength',
    'maxStitchLength','shortStitchCount','longVisibleStitchCount','duplicateStitchCount',
    'colorBlockCount','estimatedDensity','contourLikeBlocks','fillLikeBlocks','satinLikeBlocks',
    'runningLikeBlocks','possibleUnderlayBlocks','visibleTravelScore','professionalScore'];
  const avg = {};
  const min = {};
  const max = {};
  for (const k of keys) {
    const vals = analyzedFiles.map(f => f.metrics[k]).filter(v => typeof v === 'number' && Number.isFinite(v));
    avg[k] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    min[k] = vals.length ? Math.min(...vals) : 0;
    max[k] = vals.length ? Math.max(...vals) : 0;
  }
  return { count: analyzedFiles.length, avg, min, max };
}