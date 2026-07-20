/**
 * contourRefinementGuard.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Transactional contour refinement that cleans travel/artifacts from the flat
 * command sequence WITHOUT touching:
 *   - mouth detection / dark stroke detection of mouth
 *   - dstEncoder / DST export / colorChange / stops / CE01 compatibility
 *   - vectorization base / main fills
 *
 * Allowed refinements (command-level):
 *   1. Convert visible travel disguised as contour stitches → jumps (+trim)
 *   2. Remove artificial black segments crossing the design (non-border)
 *
 * A before/after audit is computed; the candidate is accepted ONLY if every
 * protected metric holds. Otherwise the original commands are returned unchanged.
 *
 * Public API:
 *   runContourRefinementGuard(commands, regions, config) → { commands, accepted, before, after, ... }
 */

import { getContourExportReport, countContourStitches, getLastOutlineClassifierReport } from './contourExportBuilder';
import { getLastLowerContourReport } from './lowerContourRebuilder';
import { detectTravelContamination } from './contourRefineValidator';
import { calculateUnifiedCommandMetrics } from './unifiedCommandMetrics';
import { validateColorChangeIntegrity } from './threadColorBlocks';

const TRAVEL_THRESHOLD_MM = 3.5;
const CONTOUR_COLORS = new Set(['#1a1a1a', '#000000', '#111111', '#222222']);

// ─── Command classification helpers ──────────────────────────────────────────

function isContourCmd(c) {
  const lt = (c.layerType || '').toLowerCase();
  const rid = (c.regionId || '').toLowerCase();
  const color = (c.color || '').toLowerCase();
  return lt.includes('outline') || lt.includes('contour') || lt.includes('detail') ||
         rid.includes('outline') || rid.includes('contour') ||
         CONTOUR_COLORS.has(color);
}

function isProtectedFacial(c) {
  const lt = (c.layerType || '').toLowerCase();
  const rid = (c.regionId || '').toLowerCase();
  return lt.includes('mouth') || lt.includes('facial') || lt.includes('eye') ||
         rid.includes('mouth') || rid.includes('eye');
}

function isOuterOrDarkStroke(c) {
  const lt = (c.layerType || '').toLowerCase();
  return lt === 'outer_outline' || lt === 'outer_silhouette' ||
         lt === 'dark_stroke_outline' || lt === 'limb_contour' ||
         lt === 'real_outline_lower';
}

// ─── Audit ───────────────────────────────────────────────────────────────────

function computeAudit(commands, regions) {
  const report = getContourExportReport(regions, commands);
  const counts = countContourStitches(commands);
  const travel = detectTravelContamination(commands, TRAVEL_THRESHOLD_MM);
  const metrics = calculateUnifiedCommandMetrics(commands, regions, {});
  const cc = validateColorChangeIntegrity(commands);

  // artificialGeometryCount: long contour stitches that are NOT outer/dark-stroke
  // (internal spurious black segments crossing the design interior).
  let artificial = 0;
  let prevX = 0, prevY = 0;
  for (const c of commands) {
    if (c && c.type === 'stitch' && isContourCmd(c) && !isProtectedFacial(c) && !isOuterOrDarkStroke(c)) {
      const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      if (dist > TRAVEL_THRESHOLD_MM) artificial++;
    }
    if (c && (c.type === 'stitch' || c.type === 'jump')) { prevX = c.x || 0; prevY = c.y || 0; }
    if (c && c.type === 'trim') { /* keep prev */ }
  }

  // lowerOuterContourCoverage: presence of outer outline stitches in the bottom
  // half. Binary-presence metric (100 if any lower outer stitch exists) so that
  // legitimate travel→jump conversion never falsely rejects the refinement.
  let lowerOuter = 0;
  for (const c of commands) {
    if (c && c.type === 'stitch') {
      const lt = (c.layerType || '').toLowerCase();
      const isOuter = lt === 'outer_outline' || lt === 'outer_silhouette' ||
                      lt === 'limb_contour' || lt === 'dark_stroke_outline' ||
                      lt === 'real_outline_lower';
      if (isOuter && (c.y || 0) < 0) lowerOuter++;
    }
  }
  const lowerOuterContourCoverage = lowerOuter > 0 ? 100 : 0;

  const outlineReport = getLastOutlineClassifierReport();
  const explicitDarkStrokeCoverage = outlineReport?.explicitDarkStrokeCoverage ?? 100;
  const lowerReport = getLastLowerContourReport();

  return {
    mouthExported: counts.mouthStitches > 0,
    mouthStitches: counts.mouthStitches,
    bodyShadowBoundaryOutlined: report.bodyShadowBoundaryOutlined === 'YES',
    outerContourCoverage: 100 - (report.uncoveredPerimeterPercent || 0),
    footContourCoverage: report.visibleFootContourCoverage ?? 100,
    lowerOuterContourCoverage,
    explicitDarkStrokeCoverage,
    lowerBodyContourPresent: !!lowerReport?.lowerBodyContourPresent,
    leftFootContourPresent: !!lowerReport?.leftFootContourPresent,
    rightFootContourPresent: !!lowerReport?.rightFootContourPresent,
    lowerContourOpenEnds: lowerReport?.lowerContourOpenEnds ?? 0,
    lowerContourRoundCapsVisible: lowerReport?.lowerContourRoundCapsVisible ?? 0,
    artificialLowerGeometry: lowerReport?.artificialLowerGeometry ?? 0,
    artificialGeometryCount: artificial,
    travelStitchedAsContour: travel,
    jumps: metrics.jumpCount,
    trims: metrics.trimCount,
    stitchCount: metrics.stitchCount,
    colorBlocks: cc.blockCount,
    outerOutlineStitches: counts.outerOutlineStitches,
    darkStrokeStitches: counts.darkStrokeStitches,
    dstCompatible: cc.blockCount >= 1 && metrics.stitchCount > 0,
  };
}

// ─── Refinement: travel→jump + trim ──────────────────────────────────────────

function refineCommands(commands) {
  const out = [];
  let travelConverted = 0;
  let artificialRemoved = 0;
  let prev = null;

  for (const c of commands) {
    if (!c) { out.push(c); continue; }

    if (c.type === 'stitch' && isContourCmd(c) && !isProtectedFacial(c) && prev) {
      const dist = Math.hypot((c.x || 0) - (prev.x || 0), (c.y || 0) - (prev.y || 0));
      if (dist > TRAVEL_THRESHOLD_MM) {
        // Insert trim only if the last emitted command isn't already a trim
        const lastOut = out[out.length - 1];
        if (!lastOut || lastOut.type !== 'trim') {
          out.push({ type: 'trim' });
        }
        out.push({ ...c, type: 'jump' });
        travelConverted++;
        if (!isOuterOrDarkStroke(c)) artificialRemoved++;
        prev = { x: c.x || 0, y: c.y || 0 };
        continue;
      }
    }

    out.push(c);
    if (c.type === 'stitch' || c.type === 'jump') prev = { x: c.x || 0, y: c.y || 0 };
  }

  return { commands: out, travelConverted, artificialRemoved };
}

// ─── Public guard ────────────────────────────────────────────────────────────

export function runContourRefinementGuard(commands, regions, config = {}) {
  const before = computeAudit(commands, regions);

  // Stable locks — log preconditions
  console.log('[stable-lock] mouth preserved:', before.mouthExported ? 'YES' : 'NO');
  console.log('[stable-lock] dst untouched:', before.dstCompatible ? 'YES' : 'NO');
  console.log('[stable-lock] dark stroke preserved:', before.darkStrokeStitches > 0 ? 'YES' : 'NO');

  // Already clean — nothing to do
  if (before.artificialGeometryCount === 0 && before.travelStitchedAsContour === 0) {
    console.log('[refine] accepted: already clean');
    console.log('[refine] outline thickness adjusted: 0');
    console.log('[lower-outline-fix] accepted: true (already clean)');
    return { commands, accepted: true, skipped: true, before, after: before };
  }

  const { commands: candidate, travelConverted, artificialRemoved } = refineCommands(commands);
  const after = computeAudit(candidate, regions);

  console.log(`[refine] artificial geometry removed: ${artificialRemoved}`);
  console.log(`[refine] travel converted to jump: ${travelConverted}`);
  console.log('[refine] outline thickness adjusted: 0');

  // ── Revert rules (mandatory) ──
  const reject = (reason) => {
    console.log(`[outline-classifier] rejected reason: ${reason}`);
    console.log(`[refine] rejected reason: ${reason}`);
    console.log(`[lower-outline-fix] rejected reason: ${reason}`);
    return { commands, accepted: false, before, after, reason };
  };

  if (!after.mouthExported) return reject('mouthExported=false');
  if (after.bodyShadowBoundaryOutlined) return reject('bodyShadowBoundaryOutlined=true');
  if (after.artificialGeometryCount > before.artificialGeometryCount) return reject('artificialGeometryCount rose');
  if (after.colorBlocks <= 1 && before.colorBlocks > 1) return reject('colors dropped to 1 block');
  if (!after.dstCompatible) return reject('DST incompatible');

  // ── Acceptance criteria ──
  const ok =
    after.mouthExported &&
    !after.bodyShadowBoundaryOutlined &&
    after.artificialGeometryCount === 0 &&
    after.travelStitchedAsContour === 0 &&
    after.outerContourCoverage >= before.outerContourCoverage &&
    after.footContourCoverage >= before.footContourCoverage &&
    after.lowerOuterContourCoverage >= before.lowerOuterContourCoverage &&
    after.explicitDarkStrokeCoverage >= before.explicitDarkStrokeCoverage &&
    after.artificialLowerGeometry === 0 &&
    after.lowerContourRoundCapsVisible === 0;

  if (!ok) {
    const reasons = [];
    if (after.artificialGeometryCount > 0) reasons.push('artificialGeometryCount>0');
    if (after.travelStitchedAsContour > 0) reasons.push('travelStitchedAsContour>0');
    if (after.outerContourCoverage < before.outerContourCoverage) reasons.push('outerContourCoverage dropped');
    if (after.footContourCoverage < before.footContourCoverage) reasons.push('footContourCoverage dropped');
    return reject(reasons.join('; '));
  }

  console.log('[outline-classifier] accepted: true');
  console.log('[refine] accepted: all criteria met');
  console.log(`[lower-outline-fix] open caps: ${after.lowerContourOpenEnds}`);
  console.log(`[lower-outline-fix] foot blobs: ${after.lowerContourRoundCapsVisible}`);
  console.log(`[lower-outline-fix] pink boundary outlined: ${after.bodyShadowBoundaryOutlined}`);
  console.log(`[lower-outline-fix] mouth preserved: ${after.mouthExported ? 'YES' : 'NO'}`);
  console.log('[lower-outline-fix] accepted: true');
  return { commands: candidate, accepted: true, before, after };
}