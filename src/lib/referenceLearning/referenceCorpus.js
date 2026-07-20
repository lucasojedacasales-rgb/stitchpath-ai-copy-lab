/**
 * referenceCorpus.js — Reference Learning Engine v2 (FASE 1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the internal professional corpus from parsed reference files.
 *
 * Each corpus entry aggregates: file metadata, command sequence, stitch/jump
 * length stats, trim density, ratios, estimated density, layer order profile,
 * and counts of technical blocks (fill / satin / running / underlay / contour /
 * detail candidates) plus detected professional patterns.
 *
 * The corpus is the single data source for the rule miner, the profile
 * generator and the retriever. It is built on top of the existing parser and
 * metrics analyzer (read-only inputs) — it never modifies the original files.
 */

import { analyzeReferenceMetrics } from './referenceMetricsAnalyzer';
import { classifyTechnicalBlocks } from './blockClassifier';

/**
 * @param {Array<object>} parsedFiles — each from referenceFileParser.parseReferenceFile
 * @returns {Array<object>} corpus entries
 */
export function buildReferenceCorpus(parsedFiles) {
  return parsedFiles.map(buildCorpusEntry).filter(Boolean);
}

export function buildCorpusEntry(parsed) {
  if (!parsed || !parsed.commands || parsed.commands.length === 0) return null;
  const { commands, metadata, filename, format } = parsed;
  const metrics = analyzeReferenceMetrics(commands, metadata);
  const technicalBlocks = classifyTechnicalBlocks(commands);
  const stats = computeLengthStats(metadata, commands);

  const byRole = countByRole(technicalBlocks);
  const byBlockType = countByBlockType(technicalBlocks);
  const patterns = detectProfessionalPatterns(technicalBlocks, metrics, stats);

  return {
    filename,
    format,
    stitchCount: metrics.stitchCount,
    colorCount: metrics.colorCount,
    jumpCount: metrics.jumpCount,
    trimCount: metrics.trimCount,
    widthMm: metrics.boundingBoxMm.width,
    heightMm: metrics.boundingBoxMm.height,
    colorBlocks: metadata.colorBlocks,
    commandSequence: commands,
    stitchLengthStats: stats.stitch,
    jumpLengthStats: stats.jump,
    trimDensity: stats.trimDensity,
    shortStitchRatio: safeRatio(metrics.shortStitchCount, metrics.stitchCount),
    longVisibleStitchRatio: safeRatio(metrics.longVisibleStitchCount, metrics.stitchCount),
    duplicateRatio: safeRatio(metrics.duplicateStitchCount, metrics.stitchCount),
    estimatedDensity: metrics.estimatedDensity,
    layerOrderProfile: technicalBlocks.map(b => b.probableRole),
    fillBlocks: byBlockType.fill_tatami,
    satinBlocks: byBlockType.satin_border,
    runningBlocks: byBlockType.running_outline + byBlockType.double_run_detail,
    underlayCandidates: byBlockType.underlay,
    contourCandidates: byRole.outline_outer + byRole.outline_inner,
    detailCandidates: byRole.detail,
    professionalPatterns: patterns,
    technicalBlocks,
    metrics,
  };
}

function countByBlockType(blocks) {
  const c = {};
  for (const b of blocks) c[b.blockType] = (c[b.blockType] || 0) + 1;
  return c;
}

function computeLengthStats(metadata, commands) {
  const stitch = summarizeLengths(metadata.stitchLengths || []);
  const jumpLengths = [];
  let prev = null;
  for (const c of commands) {
    if (c.type === 'jump' && prev) jumpLengths.push(Math.hypot(c.x - prev.x, c.y - prev.y));
    prev = c;
  }
  const jump = summarizeLengths(jumpLengths);
  // trim density: trims per 1000 stitches
  const trimDensity = metadata.stitchCount > 0 ? (metadata.trimCount / metadata.stitchCount) * 1000 : 0;
  return { stitch, jump, trimDensity };
}

function summarizeLengths(arr) {
  if (!arr.length) return { mean: 0, median: 0, max: 0, p95: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    mean: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    count: sorted.length,
  };
}

function countByRole(blocks) {
  const c = {
    fill: 0, underlay: 0, outline_outer: 0, outline_inner: 0,
    detail: 0, travel: 0, artifact: 0, unknown: 0,
  };
  for (const b of blocks) {
    const role = b.probableRole;
    if (c[role] !== undefined) c[role]++;
    else c.unknown++;
  }
  return c;
}

function detectProfessionalPatterns(blocks, metrics, stats) {
  const patterns = [];
  const roles = blocks.map(b => b.probableRole);

  // underlay before fill
  const firstFill = roles.indexOf('fill');
  const firstUnderlay = roles.indexOf('underlay');
  if (firstUnderlay >= 0 && firstFill >= 0 && firstUnderlay < firstFill) patterns.push('underlay_before_fill');

  // contour after fill
  const lastFill = roles.lastIndexOf('fill');
  const firstContour = roles.findIndex(r => r === 'outline_outer' || r === 'outline_inner');
  if (firstContour >= 0 && lastFill >= 0 && firstContour > lastFill) patterns.push('contour_after_fill');

  // details at end
  const lastThirdStart = Math.floor(roles.length * (2 / 3));
  const tail = roles.slice(lastThirdStart);
  if (tail.includes('detail')) patterns.push('details_at_end');

  // low visible travel
  if (metrics.visibleTravelScore < 0.05) patterns.push('low_visible_travel');

  // long stitches split
  if (metrics.longVisibleStitchCount === 0 && metrics.stitchCount > 20) patterns.push('long_stitches_split');

  // has satin
  if (blocks.some(b => b.blockType === 'satin_border')) patterns.push('uses_satin_border');

  return patterns;
}

function safeRatio(a, b) {
  if (!b) return 0;
  return a / b;
}

/**
 * Aggregates the corpus into average professional ranges used by profiles.
 */
export function summarizeCorpus(corpus) {
  if (!corpus.length) return null;
  const keys = [
    'stitchCount', 'colorCount', 'jumpCount', 'trimCount', 'estimatedDensity',
    'shortStitchRatio', 'longVisibleStitchRatio', 'duplicateRatio', 'trimDensity',
  'fillBlocks', 'satinBlocks', 'runningBlocks', 'underlayCandidates',
    'contourCandidates', 'detailCandidates',
  ];
  const avg = {}, min = {}, max = {}, median = {};
  for (const k of keys) {
    const vals = corpus.map(c => c[k]).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) { avg[k] = min[k] = max[k] = median[k] = 0; continue; }
    avg[k] = vals.reduce((s, v) => s + v, 0) / vals.length;
    min[k] = Math.min(...vals);
    max[k] = Math.max(...vals);
    const sorted = [...vals].sort((a, b) => a - b);
    median[k] = sorted[Math.floor(sorted.length / 2)];
  }
  // pattern frequencies
  const patternFreq = {};
  for (const entry of corpus) {
    for (const p of entry.professionalPatterns) patternFreq[p] = (patternFreq[p] || 0) + 1;
  }
  return { count: corpus.length, avg, min, max, median, patternFreq };
}