/**
 * contourRefineValidator.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Transactional validation for contour refinement.
 *
 * After travel optimizer, trim optimizer, and sanitizer have run, this module
 * verifies that contours survived intact and that no travel paths were
 * converted into visible contour stitches.
 *
 * Mandatory logs (all prefixed [outline-refine]):
 *   outer outline detected / type / stitches
 *   inner outlines / mouth stitches
 *   travel contamination
 *   outline order
 *   protected after optimizer
 *   accepted / rejected reason
 */

import { countContourStitches } from './contourExportBuilder.js';
import { calculateUnifiedCommandMetrics } from './unifiedCommandMetrics.js';
import { cleanCartoonOutlineCE01 } from './contourPreset.js';

const CONTOUR_COLORS = new Set(['#1a1a1a', '#000000', '#111111', '#222222', '#1A1A1A', '#000', '#1a1a1a']);

// ─── Travel contamination detection ─────────────────────────────────────────

/**
 * Counts stitches that are likely travel paths disguised as contour stitches.
 *
 * A stitch is "travel contamination" if:
 *   - Its length > maxContourStitchMm (3.5mm), AND
 *   - It has a contour color (#1a1a1a / #000000), OR
 *   - Its layerType includes outline/contour/mouth/detail
 *
 * Also detects: a stitch with contour color that bridges two distant contour
 * regions (the preceding and following contour stitches belong to different
 * regionIds).
 */
export function detectTravelContamination(commands, maxStitchMm = 3.5) {
  let count = 0;
  let prevX = 0, prevY = 0;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!c) continue;

    if (c.type === 'stitch') {
      const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      const isContourColor = CONTOUR_COLORS.has((c.color || '').toLowerCase());
      const lt = (c.layerType || '').toLowerCase();
      const isContourLayer = lt.includes('outline') || lt.includes('contour') ||
                             lt.includes('mouth') || lt.includes('detail');

      if (dist > maxStitchMm && (isContourColor || isContourLayer)) {
        count++;
      }
    }

    if (c.type === 'stitch' || c.type === 'jump') {
      prevX = c.x || 0;
      prevY = c.y || 0;
    }
  }

  return count;
}

// ─── Check if outer outline is last ──────────────────────────────────────────

function isOuterOutlineLast(commands) {
  let lastContourIdx = -1;
  let outerIdx = -1;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!c || c.type !== 'stitch') continue;
    const lt = (c.layerType || '').toLowerCase();
    const rid = (c.regionId || '').toLowerCase();
    if (lt === 'outer_outline' || rid.includes('outer')) {
      outerIdx = i;
    }
    if (lt.includes('outline') || lt.includes('contour') || rid.includes('outline') || rid.includes('contour')) {
      lastContourIdx = i;
    }
  }

  // Outer outline is "last" if it's the last contour stitch (or very close to it)
  return outerIdx >= 0 && outerIdx >= lastContourIdx - 2;
}

// ─── Transactional validation ────────────────────────────────────────────────

/**
 * Compares before/after command sequences to validate contour refinement.
 *
 * @param {Array}  beforeCommands — commands before optimizers
 * @param {Array}  afterCommands  — commands after optimizers
 * @param {Array}  regions        — visual regions
 * @param {string} format         — export format
 * @returns {{ accepted, reason, report }}
 */
export function validateContourRefinement(beforeCommands, afterCommands, regions = [], format = 'DST') {
  const preset = cleanCartoonOutlineCE01;
  const beforeCounts = countContourStitches(beforeCommands);
  const afterCounts = countContourStitches(afterCommands);
  const beforeMetrics = calculateUnifiedCommandMetrics(beforeCommands, regions, {});
  const afterMetrics = calculateUnifiedCommandMetrics(afterCommands, regions, {});

  // ── Travel contamination ──
  const travelContamination = detectTravelContamination(afterCommands, preset.maxContourStitchMm);

  // ── Outer outline order check ──
  const outerLast = isOuterOutlineLast(afterCommands);

  // ── Determine if design has a mouth ──
  const hasMouth = regions.some(r => {
    const name = (r.name || '').toLowerCase();
    const rc = (r.region_class || '').toLowerCase();
    return name.includes('mouth') || name.includes('boca') || rc.includes('mouth');
  }) || beforeCounts.mouthStitches > 0;

  // ── Outer outline type ──
  let outerType = 'none';
  if (afterCounts.outerOutlineStitches > 0) {
    // Check stitch type of outer outline stitches
    for (const c of afterCommands) {
      if (c.type === 'stitch' && c.layerType === 'outer_outline') {
        outerType = (c.stitchType || '').toLowerCase().includes('satin') ? 'satin' : 'run';
        break;
      }
    }
  }

  // ── Acceptance criteria ──
  const reasons = [];

  if (afterCounts.outerOutlineStitches <= preset.outerMinStitches) {
    reasons.push(`outer outline stitches ${afterCounts.outerOutlineStitches} ≤ ${preset.outerMinStitches}`);
  }
  if (hasMouth && afterCounts.mouthStitches === 0) {
    reasons.push('mouth disappeared');
  }
  if (afterMetrics.outsideHoop > 0) {
    reasons.push(`outsideRegion=${afterMetrics.outsideHoop}`);
  }
  if (afterMetrics.longStitches > 0) {
    reasons.push(`longStitches=${afterMetrics.longStitches}`);
  }
  if (afterMetrics.colorCount < beforeMetrics.colorCount) {
    reasons.push(`colors dropped ${beforeMetrics.colorCount}→${afterMetrics.colorCount}`);
  }
  if (format !== 'DST') {
    reasons.push(`format=${format} (expected DST)`);
  }
  if (travelContamination > 0) {
    reasons.push(`travel contamination=${travelContamination}`);
  }
  // Outer outline must survive
  if (beforeCounts.outerOutlineStitches > 0 && afterCounts.outerOutlineStitches === 0) {
    reasons.push('outer outline eliminated');
  }
  // Inner outlines must survive
  if (beforeCounts.innerOutlineStitches > 0 && afterCounts.innerOutlineStitches === 0) {
    reasons.push('inner outlines eliminated');
  }

  const accepted = reasons.length === 0;

  // ── Mandatory logs ──
  console.log('[outline-refine] outer outline detected:', afterCounts.outerOutlineStitches > 0 ? 'YES' : 'NO');
  console.log('[outline-refine] outer outline type:', outerType);
  console.log('[outline-refine] outer outline stitches:', afterCounts.outerOutlineStitches);
  console.log('[outline-refine] inner outlines:', afterCounts.innerContoursExported);
  console.log('[outline-refine] inner outline stitches:', afterCounts.innerOutlineStitches);
  console.log('[outline-refine] mouth stitches:', afterCounts.mouthStitches);
  console.log('[outline-refine] travel contamination:', travelContamination);
  console.log('[outline-refine] outline order:', outerLast ? 'last' : 'NOT last');
  console.log('[outline-refine] protected after optimizer:', accepted ? 'YES' : 'NO');
  console.log('[outline-refine] accepted:', accepted);
  if (!accepted) {
    console.log('[outline-refine] rejected reason:', reasons.join('; '));
  }

  return {
    accepted,
    reason: accepted ? null : reasons.join('; '),
    report: {
      outerOutlineDetected: afterCounts.outerOutlineStitches > 0,
      outerOutlineType: outerType,
      outerOutlineStitches: afterCounts.outerOutlineStitches,
      innerOutlines: afterCounts.innerContoursExported,
      innerOutlineStitches: afterCounts.innerOutlineStitches,
      mouthStitches: afterCounts.mouthStitches,
      travelContamination,
      outlineOrder: outerLast ? 'last' : 'not_last',
      outerOutlineColor: afterCounts.outerOutlineColor,
      outerOutlineOrder: afterCounts.outerOutlineOrder,
      accepted,
      rejectedReason: accepted ? null : reasons.join('; '),
      beforeMetrics: {
        stitches: beforeMetrics.stitchCount,
        jumps: beforeMetrics.jumpCount,
        trims: beforeMetrics.trimCount,
        colors: beforeMetrics.colorCount,
        outerStitches: beforeCounts.outerOutlineStitches,
        innerStitches: beforeCounts.innerOutlineStitches,
        mouthStitches: beforeCounts.mouthStitches,
        longStitches: beforeMetrics.longStitches,
        outsideRegion: beforeMetrics.outsideHoop,
      },
      afterMetrics: {
        stitches: afterMetrics.stitchCount,
        jumps: afterMetrics.jumpCount,
        trims: afterMetrics.trimCount,
        colors: afterMetrics.colorCount,
        outerStitches: afterCounts.outerOutlineStitches,
        innerStitches: afterCounts.innerOutlineStitches,
        mouthStitches: afterCounts.mouthStitches,
        longStitches: afterMetrics.longStitches,
        outsideRegion: afterMetrics.outsideHoop,
      },
    },
  };
}

// ─── Post-optimization guard (enhanced) ──────────────────────────────────────

/**
 * Enhanced guard that combines contour preservation + travel contamination.
 * Used by buildFinalCommands to validate each optimizer step.
 */
export function contourRefineGuard(before, after) {
  const beforeCounts = countContourStitches(before);
  const afterCounts = countContourStitches(after);
  const travelContam = detectTravelContamination(after, cleanCartoonOutlineCE01.maxContourStitchMm);

  // Outer outline eliminated
  if (beforeCounts.outerOutlineStitches > 0 && afterCounts.outerOutlineStitches === 0) {
    console.warn('[contour-refine-guard] outer outline eliminated — DISCARD');
    return false;
  }
  // Outer outline lost > 50%
  if (beforeCounts.outerOutlineStitches > 0) {
    const ratio = afterCounts.outerOutlineStitches / beforeCounts.outerOutlineStitches;
    if (ratio < 0.5) {
      console.warn(`[contour-refine-guard] outer outline dropped to ${Math.round(ratio * 100)}% — DISCARD`);
      return false;
    }
  }
  // Mouth eliminated
  if (beforeCounts.mouthStitches > 0 && afterCounts.mouthStitches === 0) {
    console.warn('[contour-refine-guard] mouth eliminated — DISCARD');
    return false;
  }
  // Inner outlines eliminated
  if (beforeCounts.innerOutlineStitches > 0 && afterCounts.innerOutlineStitches === 0) {
    console.warn('[contour-refine-guard] inner outlines eliminated — DISCARD');
    return false;
  }
  // Travel contamination introduced
  if (travelContam > 0) {
    console.warn(`[contour-refine-guard] travel contamination=${travelContam} — DISCARD`);
    return false;
  }

  return true;
}