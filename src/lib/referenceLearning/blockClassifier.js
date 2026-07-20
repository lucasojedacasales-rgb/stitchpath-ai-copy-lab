/**
 * blockClassifier.js — Reference Learning Engine v2 (FASE 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Divides a reference file's command sequence into technical blocks, each
 * carrying the full metadata required by the rule miner and the profile
 * generator:
 *
 *   { startCommandIndex, endCommandIndex, colorIndex, stitchCount, bbox,
 *     density, averageAngle, angleVariance, averageStitchLength,
 *     maxStitchLength, shapeType, probableRole, blockType, blockIndex }
 *
 * Read-only: it never modifies the command list. It reuses the geometry
 * classification from stitchPatternClassifier and enriches each block with
 * role/shape semantics.
 */

import { classifyStitchBlocks } from './stitchPatternClassifier';

function rad2deg(r) { return (r * 180) / Math.PI; }

/**
 * @param {Array} commands — from referenceFileParser
 * @returns {Array<object>} enriched technical blocks
 */
export function classifyTechnicalBlocks(commands) {
  const baseBlocks = classifyStitchBlocks(commands);
  return baseBlocks.map((b, idx) => enrichBlock(b, idx, commands, baseBlocks));
}

function enrichBlock(b, idx, commands, allBlocks) {
  const f = b.features || {};
  const stitches = [];
  for (let i = b.start; i <= b.end && i < commands.length; i++) {
    if (commands[i].type === 'stitch') stitches.push(commands[i]);
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of stitches) {
    if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
  }
  if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = 0; }

  const lengths = [];
  let totalLen = 0, maxLen = 0;
  for (let i = 1; i < stitches.length; i++) {
    const l = Math.hypot(stitches[i].x - stitches[i - 1].x, stitches[i].y - stitches[i - 1].y);
    lengths.push(l); totalLen += l; if (l > maxLen) maxLen = l;
  }
  const avgLen = lengths.length ? totalLen / lengths.length : 0;

  const shapeType = inferShape(b.blockType, f);
  const probableRole = inferRole(b.blockType, f, idx, allBlocks);

  return {
    startCommandIndex: b.start,
    endCommandIndex: b.end,
    colorIndex: b.color,
    stitchCount: f.stitchCount || stitches.length,
    bbox: {
      minX, maxX, minY, maxY,
      widthMm: f.widthMm || 0,
      heightMm: f.heightMm || 0,
      areaMm2: f.areaMm2 || 0,
    },
    density: f.density || 0,
    averageAngle: rad2deg(f.meanAngle || 0),
    angleVariance: rad2deg(f.stddevAngle || 0),
    averageStitchLength: avgLen,
    maxStitchLength: maxLen,
    shapeType,
    probableRole,
    blockType: b.blockType,
    blockIndex: idx,
  };
}

function inferShape(blockType, f) {
  if (blockType === 'travel_jump' || (f.density > 0 && f.density < 0.002)) return 'travel';
  if (blockType === 'fill_tatami') return 'area';
  if (blockType === 'satin_border') return 'column';
  if (blockType === 'underlay') return 'area_sparse';
  if (blockType === 'running_outline' || blockType === 'double_run_detail') return 'linear';
  if (blockType === 'noise') return 'scatter';
  return 'unknown';
}

function inferRole(blockType, f, idx, allBlocks) {
  switch (blockType) {
    case 'fill_tatami': return 'fill';
    case 'underlay': return 'underlay';
    case 'travel_jump': return 'travel';
    case 'noise': return 'artifact';
    case 'satin_border':
      // satin at the end of a color block = outer outline; else border
      return isLastBlockOfColor(idx, allBlocks) ? 'outline_outer' : 'outline_inner';
    case 'running_outline':
      return isLastBlockOfFile(idx, allBlocks) ? 'outline_outer' : 'outline_inner';
    case 'double_run_detail':
      return (f.areaMm2 || 0) < 200 ? 'detail' : 'outline_inner';
    default:
      return 'unknown';
  }
}

function isLastBlockOfColor(idx, allBlocks) {
  if (idx + 1 >= allBlocks.length) return true;
  return allBlocks[idx + 1].color !== allBlocks[idx].color;
}
function isLastBlockOfFile(idx, allBlocks) {
  return idx + 1 >= allBlocks.length;
}

export const BLOCK_ROLES = [
  'fill', 'underlay', 'outline_outer', 'outline_inner',
  'detail', 'travel', 'color_separator', 'artifact', 'unknown',
];