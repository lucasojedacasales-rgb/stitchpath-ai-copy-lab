/**
 * Export Reality Check — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Compares what the user SEES (visual regions) with what will actually be
 * EXPORTED (finalEmbroideryCommands). Detects mismatches that would cause
 * the machine to sew a different design than the preview shows.
 */

import { buildThreadColorBlocks } from './threadColorBlocks';
import { getContourExportReport } from './contourExportBuilder';

/**
 * @param {Array} regions  — visual regions from the editor
 * @param {Array} commands — finalEmbroideryCommands
 * @returns {Object} reality check metrics + status
 */
export function computeExportReality(regions = [], commands = []) {
  // ── Visual colors (from regions) ────────────────────────────────────────
  const visualColorSet = new Set();
  for (const r of regions) {
    if (r.visible !== false && r.color) visualColorSet.add(r.color);
  }
  const visualColors = visualColorSet.size;

  // ── Command colors (from stitch/jump commands) ──────────────────────────
  const commandColorSet = new Set();
  for (const c of commands) {
    if (c.color && (c.type === 'stitch' || c.type === 'jump')) {
      commandColorSet.add(c.color);
    }
  }
  const commandColors = commandColorSet.size;

  // ── Color changes ───────────────────────────────────────────────────────
  const colorChanges = commands.filter(c => c.type === 'colorChange').length;

  // ── Thread blocks (from real commands, not visual regions) ──────────────
  const threadBlocks = buildThreadColorBlocks(commands);
  const expectedMachineColors = colorChanges + 1;

  // ── Fill objects (visual) ───────────────────────────────────────────────
  const fillObjects = regions.filter(r => r.visible !== false && r.stitch_type === 'fill').length;

  // ── Detail objects (visual) ─────────────────────────────────────────────
  const detailObjects = regions.filter(r => {
    if (r.visible === false) return false;
    const name = (r.name || '').toLowerCase();
    return r.stitch_type === 'running_stitch' &&
      (name.includes('detail') || name.includes('mouth') || r.region_class === 'detail_run');
  }).length;

  // ── Contour objects (visual) ────────────────────────────────────────────
  const contourVisualRegions = regions.filter(r => {
    if (r.visible === false) return false;
    const name = (r.name || '').toLowerCase();
    const rc = r.region_class || r.layerType || '';
    return r.stitch_type === 'running_stitch' &&
      (name.includes('outline') || name.includes('contour') ||
       rc === 'outer_outline' || rc === 'inner_outline');
  });
  const contourVisual = contourVisualRegions.length;

  // ── Contour objects exported (from commands) ────────────────────────────
  const contourExportedIds = new Set();
  for (const c of commands) {
    if (c.type === 'stitch' && c.stitchType === 'running_stitch' && c.regionId) {
      contourExportedIds.add(c.regionId);
    }
  }
  const contourExported = contourExportedIds.size;

  // ── Mouth visual ────────────────────────────────────────────────────────
  const mouthVisual = regions.some(r => {
    const name = (r.name || '').toLowerCase();
    const rc = r.region_class || '';
    return name.includes('mouth') || rc === 'mouth_detail_run';
  });

  // ── Mouth exported ──────────────────────────────────────────────────────
  const mouthExported = commands.some(c => {
    if (c.type !== 'stitch') return false;
    const rid = (c.regionId || '').toLowerCase();
    const name = (c.regionName || '').toLowerCase();
    return rid.includes('mouth') || name.includes('mouth');
  });

  // ── Outer outline exported ──────────────────────────────────────────────
  const outerOutlineExported = commands.some(c => {
    if (c.type !== 'stitch') return false;
    const rid = (c.regionId || '').toLowerCase();
    const name = (c.regionName || '').toLowerCase();
    return rid.includes('outer') || rid.includes('outline') ||
           name.includes('outer') || name.includes('outline');
  });

  // ── Color changes preserved ─────────────────────────────────────────────
  const colorChangesPreserved = colorChanges > 0 || visualColors <= 1;

  // ── Mismatch detection ──────────────────────────────────────────────────
  const colorMismatch = visualColors > 1 && colorChanges === 0;
  const contourMismatch = contourVisual > contourExported;
  const mouthMismatch = mouthVisual && !mouthExported;
  const colorChangeMismatch = threadBlocks.length > 1 && colorChanges !== threadBlocks.length - 1;

  // ── Contour-specific reality check (report only — blocking is in ExportModal) ──
  const contourReport = getContourExportReport(regions, commands);

  const ready = !colorMismatch && !contourMismatch && !mouthMismatch && !colorChangeMismatch;
  const status = ready && contourReport.ready ? 'OK' : 'RISKY';

  // ── Logs ────────────────────────────────────────────────────────────────
  console.log('[export-reality] visual colors:', visualColors);
  console.log('[export-reality] command colors:', commandColors);
  console.log('[export-reality] color changes:', colorChanges);
  console.log('[export-reality] thread blocks:', threadBlocks.length);
  console.log('[export-reality] expected machine colors:', expectedMachineColors);
  console.log('[export-reality] visual contours:', contourVisual);
  console.log('[export-reality] exported contours:', contourExported);
  console.log('[export-reality] mouth visual:', mouthVisual ? 'YES' : 'NO');
  console.log('[export-reality] mouth exported:', mouthExported ? 'YES' : 'NO');
  console.log('[export-reality] outer outline exported:', outerOutlineExported ? 'YES' : 'NO');
  console.log('[export-reality] color changes preserved:', colorChangesPreserved ? 'YES' : 'NO');
  console.log('[export-reality] ready:', ready);

  return {
    visualColors,
    commandColors,
    colorChanges,
    threadBlocks: threadBlocks.length,
    expectedMachineColors,
    fillObjects,
    detailObjects,
    contourVisual,
    contourExported,
    mouthVisual: mouthVisual ? 'YES' : 'NO',
    mouthExported: mouthExported ? 'YES' : 'NO',
    outerOutlineExported: outerOutlineExported ? 'YES' : 'NO',
    colorChangesPreserved: colorChangesPreserved ? 'YES' : 'NO',
    colorMismatch,
    contourMismatch,
    mouthMismatch,
    colorChangeMismatch,
    // ── Contour fields ──
    visualOuterOutline: contourReport.visualOuterOutline,
    exportedOuterOutline: contourReport.exportedOuterOutline,
    outerOutlineStitches: contourReport.outerOutlineStitches,
    outerOutlineColor: contourReport.outerOutlineColor,
    outerOutlineOrder: contourReport.outerOutlineOrder,
    mouthStitches: contourReport.mouthStitches,
    innerContoursExported: contourReport.innerContoursExported,
    innerOutlineStitches: contourReport.innerOutlineStitches,
    detailRunStitches: contourReport.detailRunStitches,
    contourMissing: contourReport.contourMissing,
    contourWeak: contourReport.contourWeak,
    status,
    ready,
  };
}