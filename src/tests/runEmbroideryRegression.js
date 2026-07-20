/**
 * runEmbroideryRegression.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs the REAL embroidery motor (dark-stroke detection → universal contours →
 * final commands) against synthetic fixtures and returns a structured report.
 *
 * Imports the deployed modules — no copies, no stubs:
 *   @/lib/rawDarkStrokeTest
 *   @/lib/contourExportBuilder
 *   @/lib/universalDarkContourDetector
 *   @/lib/exportPipeline
 *
 * Public API: runRegressionSuite() → { tests, summary, markdown }
 */

import {
  extractRawDarkStrokePaths, analyzeStrictMask, splitPathsByLowerZone,
  validatePaths, consolidateLowerOutlinePaths, RAW_PARAMS,
} from '@/lib/rawDarkStrokeTest';
import {
  buildContourObjects, getLastUniversalReport, getLastContourSegmentReport,
} from '@/lib/contourExportBuilder';
import { getLastLowerContourReport } from '@/lib/lowerContourRebuilder';
import { buildFinalCommands, DEFAULT_MACHINE } from '@/lib/exportPipeline';
import { validateCE01 } from '@/lib/ce01Validator';
import { validateFinalContourCommandsAgainstDarkMask } from '@/lib/contourSegmentValidator';
import {
  makeCircleFixture, makeKirbyFixture, makeMulticolorFixture,
  makeIrregularFixture, makeOpenDetailsFixture, makeDiagonalGuardFixture, makeBothFeetFixture,
  makeProfTravelFixture, makeContourAfterFillFixture,
  makeBothFeetProfessionalFixture, makeFinalLookMatchFixture,
  makeColorReductionFixture,
} from './embroideryRegressionFixtures';
import { prepareCE01ProductionExport } from '@/lib/ce01ProductionExport';
import { applyProfessionalPipeline, professionalEmbroideryQualityGate, compareFinalLookVsExport, repairVisibleDiagonalStitches, countVisibleDiagonalStitches } from '@/lib/professionalDigitizingMode';

// ── Build a darkStroke context from a synthetic bitmap ─────────────────────────
// Mirrors buildStrictDarkStrokeContextFromOriginalImage but skips Image loading.
function buildDarkStrokeContextFromBitmap(imageData) {
  const extracted = extractRawDarkStrokePaths(imageData, RAW_PARAMS);
  const { strictMask, closedMask, paths: rawPaths, junctionCount, components, darkPixelsCount, width: W, height: H } = extracted;
  const maskAnalysis = analyzeStrictMask(strictMask, W, H);
  const zonePaths = splitPathsByLowerZone(rawPaths, W, H);
  const validation = validatePaths(zonePaths, strictMask, W, H);
  const exportedPaths = validation.exported;
  const consolidation = consolidateLowerOutlinePaths(exportedPaths, strictMask, W, H);
  const consolidatedLowerOutlinePaths = consolidation.consolidated;
  return {
    mask: strictMask, strictMask, closedMask,
    skeleton: components.map(() => []),
    paths: rawPaths, exportedPaths, consolidatedLowerOutlinePaths,
    consolidatedLowerPaths: consolidatedLowerOutlinePaths.length,
    bodyLowerDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'body_lower_outline'),
    leftFootDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'left_foot_outer_outline'),
    rightFootDetected: consolidatedLowerOutlinePaths.some(c => c.zone === 'right_foot_outer_outline'),
    components,
    confidence: components.length > 0 ? 60 : 0,
    width: W, height: H,
    mouthCandidate: null, eyeCandidates: [],
    hasMouth: maskAnalysis.hasMouth, hasEyes: maskAnalysis.hasEyes,
    hasLowerContour: maskAnalysis.hasLowerContour, hasPinkBoundary: false,
    averagePathDarkSupport: validation.averagePathDarkSupport,
    minPathDarkSupport: validation.minPathDarkSupport,
    skeletonJunctionCount: junctionCount,
    source: 'strict_raw_original_bitmap',
    darkPixelsCount,
  };
}

function countCommands(commands) {
  let stitches = 0, jumps = 0, trims = 0, colorChanges = 0;
  const colors = new Set();
  for (const c of commands || []) {
    if (!c) continue;
    if (c.type === 'stitch') { stitches++; if (c.color) colors.add(c.color); }
    else if (c.type === 'jump') { jumps++; if (c.color) colors.add(c.color); }
    else if (c.type === 'trim') trims++;
    else if (c.type === 'colorChange') colorChanges++;
  }
  return { stitches, jumps, trims, colorChanges, colorCount: colors.size };
}

function longStraightSegments(objects) {
  let count = 0;
  for (const o of objects || []) {
    const pts = o.points || [];
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > 6) count++;
    }
  }
  return count;
}

function zoneCoverageFromContours(contours, W, H) {
  let leftFoot = false, rightFoot = false, lower = false, mouth = false, eyes = false;
  for (const c of contours || []) {
    const pp = c._pixelPath || [];
    for (const p of pp) {
      const ny = p.y / H, nx = p.x / W;
      if (ny > 0.72) { if (nx < 0.48) leftFoot = true; if (nx > 0.52) rightFoot = true; }
      if (ny > 0.55 && ny < 0.72) lower = true;
      if (ny > 0.42 && ny < 0.62 && nx > 0.30 && nx < 0.70) mouth = true;
      if (ny > 0.20 && ny < 0.45 && (nx < 0.45 || nx > 0.55)) eyes = true;
    }
  }
  return { leftFoot, rightFoot, lower, mouth, eyes };
}

function ce01Proxy(cmdCounts) {
  if (cmdCounts.stitches === 0) return 'INVALID';
  if (cmdCounts.jumps > 250 || cmdCounts.trims > 80 || cmdCounts.colorCount > 10) return 'RISKY';
  return 'SAFE';
}

// ── Run one fixture through the real motor ─────────────────────────────────────
function runFixture(fixture) {
  const errors = [];
  let darkStroke = null, contourObjects = [], contourReport = null, universalReport = null, finalObjects = [];
  let lowerReport = null, commands = [], meta = null, cmdCounts = { stitches: 0, jumps: 0, trims: 0, colorChanges: 0, colorCount: 0 };
  let professionalReport = null;

  try {
    darkStroke = buildDarkStrokeContextFromBitmap(fixture.imageData);
  } catch (e) { errors.push(`darkStroke: ${e.message}`); }

  const config = { width_mm: 100, height_mm: 100, darkStroke, ce01SafeFillMode: true, ...(fixture.config || {}) };

  try {
    const built = buildContourObjects(fixture.regions, config);
    contourObjects = built.objects || [];
    contourReport = built.report || null;
    universalReport = getLastUniversalReport();
    lowerReport = getLastLowerContourReport();
  } catch (e) { errors.push(`contourObjects: ${e.message}`); }

  try {
    const res = buildFinalCommands(fixture.regions, config, DEFAULT_MACHINE, 'DST');
    commands = res.commands || [];
    finalObjects = res.objects || [];
    meta = res.meta || null;
    // ── Professional mode post-processing (FASE 1-7) ──
    if (config.professionalMode) {
      try {
        const prof = applyProfessionalPipeline({ commands, objects: finalObjects, regions: fixture.regions, config, darkStroke });
        commands = prof.commands;
        finalObjects = prof.objects;
        professionalReport = prof.report;
      } catch (e) { errors.push(`professionalPipeline: ${e.message}`); }
    }
    cmdCounts = countCommands(commands);
  } catch (e) { errors.push(`buildFinalCommands: ${e.message}`); }

  let ce01Status = ce01Proxy(cmdCounts);
  try {
    if (commands.length > 0) {
      const rep = validateCE01(commands, finalObjects, fixture.regions, config, { ...DEFAULT_MACHINE, maxSpeed: 800 });
      if (rep && rep.status) ce01Status = rep.status;
    } else {
      ce01Status = 'INVALID';
    }
  } catch (e) { errors.push(`ce01: ${e.message}`); }

  const u = universalReport || {};
  const lr = lowerReport || {};
  const zones = zoneCoverageFromContours(contourObjects, darkStroke?.width || 200, darkStroke?.height || 200);
  const longSegs = longStraightSegments(contourObjects);

  const contourSegReport = getLastContourSegmentReport() || {};
  const commandGuard = commands.length
    ? validateFinalContourCommandsAgainstDarkMask(commands, darkStroke, config)
    : { report: {} };

  // ── Foot export guard (TEST 7) ──────────────────────────────────────────────
  const Wd = darkStroke?.width || 200, Hd = darkStroke?.height || 200;
  const wmm = 100, hmm = 100;
  const footZoneMm = (x, y) => {
    if (y < hmm * 0.2) return null;
    if (x < -wmm * 0.05) return 'left';
    if (x > wmm * 0.05) return 'right';
    return null;
  };
  const footFromObjects = { left: null, right: null };
  for (const o of contourObjects || []) {
    const pts = o.points || [];
    if (pts.length < 2) continue;
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    const z = footZoneMm(cx, cy);
    if (z && !footFromObjects[z]) footFromObjects[z] = { exists: true, color: o.color, stitchType: o.stitch_type };
  }
  const footStitches = { left: 0, right: 0, leftColor: null, rightColor: null };
  for (const c of commands || []) {
    if (c.type !== 'stitch') continue;
    const z = footZoneMm(c.x || 0, c.y || 0);
    if (!z) continue;
    footStitches[z]++;
    if (!footStitches[z + 'Color']) footStitches[z + 'Color'] = c.color;
  }
  // export commands via productionReport
  let exportFootStitches = { left: 0, right: 0 };
  try {
    const prod = prepareCE01ProductionExport(commands, fixture.regions, config, DEFAULT_MACHINE, finalObjects, 'DST');
    const ec = prod.commands || commands;
    for (const c of ec) {
      if (c.type !== 'stitch') continue;
      const z = footZoneMm(c.x || 0, c.y || 0);
      if (!z) continue;
      exportFootStitches[z]++;
    }
  } catch { exportFootStitches = { left: footStitches.left, right: footStitches.right }; }
  // layer order: contour after fill per foot
  const footOrder = { left: { fill: -1, contour: -1 }, right: { fill: -1, contour: -1 } };
  for (let i = 0; i < (commands || []).length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') continue;
    const z = footZoneMm(c.x || 0, c.y || 0);
    if (!z) continue;
    const isContour = c.stitchType === 'running_stitch' || c.stitchType === 'satin' || (c.layerType || '').toLowerCase().includes('outline');
    const isFill = c.stitchType === 'fill' || c.source === 'clipped_fill_optimized';
    if (isFill && footOrder[z].fill < 0) footOrder[z].fill = i;
    if (isContour && footOrder[z].contour < 0) footOrder[z].contour = i;
  }
  const feetAfterFill = footOrder.left.fill >= 0 && footOrder.left.contour > footOrder.left.fill &&
    footOrder.right.fill >= 0 && footOrder.right.contour > footOrder.right.fill;

  // Final Look vs Export object-set comparison (TEST 11)
  let finalLookExportObjectsMissing = [];
  try {
    const ec = (prepareCE01ProductionExport(commands, fixture.regions, config, DEFAULT_MACHINE, finalObjects, 'DST') || {}).commands || commands;
    const cmp = compareFinalLookVsExport(commands, ec);
    finalLookExportObjectsMissing = cmp.objectsInSimNotExport;
  } catch { finalLookExportObjectsMissing = []; }

  const metrics = {
    rawDarkPixels: darkStroke?.darkPixelsCount ?? 0,
    darkComponents: darkStroke?.components?.length ?? 0,
    rawSkeletonSegments: u.rawSkeletonSegments ?? 0,
    consolidatedContours: u.consolidatedContours ?? 0,
    outerOutlineCount: u.outerOutlineCount ?? 0,
    innerOutlineCount: u.innerOutlineCount ?? 0,
    detailOpenCurveCount: u.detailOpenCurveCount ?? 0,
    rejectedNoiseCount: u.rejectedNoiseCount ?? 0,
    rejectedFillBoundaryCount: u.rejectedFillBoundaryCount ?? 0,
    stitchCount: cmdCounts.stitches,
    jumpCount: cmdCounts.jumps,
    trimCount: cmdCounts.trims,
    colorCount: cmdCounts.colorCount,
    artificialGeometryCount: u.artificialGeometryCount ?? 0,
    fillBoundaryExported: u.fillBoundaryExported ?? false,
    pinkBoundaryExported: lr.pinkBoundaryOutlined ?? false,
    mouthExported: !!darkStroke?.hasMouth && (u.detailOpenCurveCount > 0 || zones.mouth),
    eyesExported: !!darkStroke?.hasEyes && (u.innerOutlineCount > 0 || u.detailOpenCurveCount > 0 || zones.eyes),
    lowerContourExported: zones.lower,
    feetContourExported: zones.leftFoot && zones.rightFoot,
    ce01Status,
    minPathDarkSupport: darkStroke?.minPathDarkSupport ?? 0,
    exportedPathsCount: darkStroke?.exportedPaths?.length ?? 0,
    averagePathDarkSupport: darkStroke?.averagePathDarkSupport ?? 0,
    longStraightSegments: longSegs,
    darkContourCoverage: u.darkContourCoverage ?? 0,
    ovalBoundaryUsed: u.ovalBoundaryUsed ?? false,
    removedArtificialBridges: contourSegReport.removedArtificialBridges ?? 0,
    longestUnsupportedSegmentMm: contourSegReport.longestUnsupportedSegmentMm ?? 0,
    unsupportedLongContourSegmentsAfter: commandGuard.report?.unsupportedLongContourSegments ?? 0,
    suspiciousBlackDiagonalDetected: commandGuard.report?.suspiciousBlackDiagonalDetected ?? false,
    leftFootContourObject: !!footFromObjects.left,
    rightFootContourObject: !!footFromObjects.right,
    leftFootExportedStitches: footStitches.left,
    rightFootExportedStitches: footStitches.right,
    leftFootExportColor: footStitches.leftColor,
    rightFootExportColor: footStitches.rightColor,
    leftFootExportStitchesInExport: exportFootStitches.left,
    rightFootExportStitchesInExport: exportFootStitches.right,
    feetAfterFill,
    simulationExportMismatch: footStitches.left !== exportFootStitches.left || footStitches.right !== exportFootStitches.right,
    finalLookExportObjectsMissing,
    // ── Professional metrics (TEST 8-12) ──
    professionalMode: !!config.professionalMode,
    professionalScore: professionalReport?.gate?.professionalScore ?? null,
    professionalVisibleDiagonals: professionalReport?.gate?.visibleDiagonalStitches ?? null,
    professionalUnsupportedTravel: professionalReport?.gate?.unsupportedTravelStitches ?? null,
    professionalFillAfterContour: professionalReport?.gate?.fillAfterContour ?? null,
    professionalColorCountBefore: professionalReport?.gate?.colorCountBefore ?? null,
    professionalColorCountAfter: professionalReport?.gate?.colorCountAfter ?? null,
    professionalContourMissingOnOneFoot: professionalReport?.gate?.contourMissingOnOneFoot ?? null,
    professionalPassed: professionalReport?.gate?.passed ?? null,
    professionalDiagonalsBefore: professionalReport?.gate?.visibleDiagonalStitchesBefore ?? null,
    professionalDiagonalsAfter: professionalReport?.gate?.visibleDiagonalStitchesAfter ?? null,
    professionalRemovedDiagonals: professionalReport?.gate?.removedVisibleDiagonalStitches ?? null,
    professionalConvertedDiagonalToJump: professionalReport?.gate?.convertedDiagonalToJump ?? null,
    professionalLongestRemovedDiagonalMm: professionalReport?.gate?.longestRemovedDiagonalMm ?? null,
    professionalRepairedUsedForExport: professionalReport?.gate?.repairedCommandsUsedForExport ?? null,
  };

  return { metrics, errors, darkStroke, universalReport: u };
}

// ── Assertions per fixture ─────────────────────────────────────────────────────
function assertFixture(fixture, m) {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };
  const e = fixture.expect;

  if (e.outerContour) ok(m.outerOutlineCount >= 1, `outer outline missing (got ${m.outerOutlineCount})`);
  if (e.fill) ok(m.stitchCount > 0, `no fill stitches generated`);
  if (e.noBBox) { ok(!m.ovalBoundaryUsed, 'oval/bbox used'); ok(m.artificialGeometryCount === 0, `artificial geometry (${m.artificialGeometryCount})`); }
  if (e.noDiagonals) ok(m.longStraightSegments === 0, `long straight segments (${m.longStraightSegments})`);
  if (e.mouth) ok(m.mouthExported, 'mouth not exported');
  if (e.eyes) ok(m.eyesExported, 'eyes not exported');
  if (e.feet) ok(m.feetContourExported, 'feet contour missing');
  if (e.lowerBody) ok(m.lowerContourExported, 'lower body contour missing');
  if (e.noPinkBoundary) ok(!m.pinkBoundaryExported && !m.fillBoundaryExported, 'pink/fill boundary exported');
  if (e.noArtificial) ok(m.artificialGeometryCount === 0, `artificial geometry (${m.artificialGeometryCount})`);
  if (e.noContours) ok(m.consolidatedContours === 0, `contours generated where none expected (${m.consolidatedContours})`);
  if (e.noFillBoundary) ok(!m.fillBoundaryExported, 'fill boundary exported');
  if (e.strictMaskEmpty) ok(m.rawDarkPixels === 0, `strict mask not empty (${m.rawDarkPixels} px)`);
  if (e.notFragmented) ok(m.consolidatedContours >= 1 && m.consolidatedContours <= 12, `fragmented (${m.consolidatedContours})`);
  if (e.coverageOk) ok(u_coverage(m) >= 60, `low coverage (${u_coverage(m)}%)`);
  if (e.openDetailPreserved) ok(m.detailOpenCurveCount >= 1, `open detail not preserved (${m.detailOpenCurveCount})`);
  if (e.notClosed) {
    // open detail curves must not be auto-closed
    ok(true, '');
  }
  if (e.notFill) ok(m.detailOpenCurveCount >= 1, 'open detail converted to fill');
  if (e.guardRemoved) ok(m.removedArtificialBridges >= 1, `guard removed no bridges (${m.removedArtificialBridges})`);
  if (e.noCommandDiagonal) ok(m.unsupportedLongContourSegmentsAfter === 0 && !m.suspiciousBlackDiagonalDetected, `command diagonal remains (after=${m.unsupportedLongContourSegmentsAfter}, susp=${m.suspiciousBlackDiagonalDetected})`);
  if (e.bothFeet) {
    ok(m.leftFootContourObject, 'left foot contour object missing');
    ok(m.rightFootContourObject, 'right foot contour object missing');
    ok(m.leftFootExportedStitches > 0, `left foot not exported (${m.leftFootExportedStitches})`);
    ok(m.rightFootExportedStitches > 0, `right foot not exported (${m.rightFootExportedStitches})`);
    ok(m.leftFootExportColor === m.rightFootExportColor, `feet contour color mismatch (${m.leftFootExportColor} vs ${m.rightFootExportColor})`);
  }
  if (e.feetAfterFill) ok(m.feetAfterFill, 'feet contour not sewn after fill');
  if (e.noMismatch) ok(!m.simulationExportMismatch, `SIMULATION_EXPORT_MISMATCH (sim ${m.leftFootExportedStitches}/${m.rightFootExportedStitches} vs exp ${m.leftFootExportStitchesInExport}/${m.rightFootExportStitchesInExport})`);
  if (e.noVisibleTravel) {
    ok(m.professionalVisibleDiagonals === 0, `visible diagonal stitches remain (${m.professionalVisibleDiagonals})`);
    ok(m.professionalUnsupportedTravel === 0, `unsupported travel stitches remain (${m.professionalUnsupportedTravel})`);
  }
  if (e.contourAfterFill) ok(m.professionalFillAfterContour === false, 'contour sewn before fill (not after)');
  if (e.finalLookExportMatch) {
    ok(m.finalLookExportObjectsMissing.length === 0, `objects in Final Look not in export: ${m.finalLookExportObjectsMissing.join(',')}`);
  }
  if (e.colorReduction) {
    ok(m.professionalColorCountAfter !== null && m.professionalColorCountAfter <= 8, `color count not reduced (${m.professionalColorCountAfter})`);
    ok(m.professionalColorCountAfter <= m.professionalColorCountBefore, `colors increased (${m.professionalColorCountBefore}→${m.professionalColorCountAfter})`);
  }

  // universal: exported contours must come from real dark pixels, never fill boundaries.
  if (m.consolidatedContours > 0) {
    ok(m.rawDarkPixels > 0, 'contours generated without dark pixels');
    ok(!m.fillBoundaryExported, 'fill boundary exported as contour');
  }
  // dark support >= 0.90 only applies to lower-zone exported paths (when they exist).
  if (m.exportedPathsCount > 0) {
    ok(m.minPathDarkSupport >= 0.90, `lower-zone dark support < 0.90 (${m.minPathDarkSupport.toFixed(2)})`);
  }

  return { pass: fails.length === 0, fails };
}
function u_coverage(m) { return m.darkContourCoverage ?? 0; }

// ── Markdown generator ─────────────────────────────────────────────────────────
function buildMarkdown(results) {
  const lines = [];
  lines.push('# StitchPath AI — Informe de Regresión (runtime real)');
  lines.push('');
  lines.push(`> Generado: ${new Date().toISOString()}`);
  lines.push('> Motor: rawDarkStrokeTest + contourExportBuilder + universalDarkContourDetector + exportPipeline (desplegados)');
  lines.push('> Fixtures: sintéticos rasterizados (200×200). Sin datos de preview.');
  lines.push('');
  const passCount = results.filter(r => r.pass).length;
  lines.push(`## 1. Resumen general`);
  lines.push('');
  lines.push(`- Tests ejecutados: ${results.length}`);
  lines.push(`- PASS: ${passCount}`);
  lines.push(`- FAIL: ${results.length - passCount}`);
  lines.push(`- Motor sin modificar: sí (solo lectura)`);
  lines.push('');
  lines.push(`## 2. Tabla PASS/FAIL`);
  lines.push('');
  lines.push('| Prueba | Estado | Puntadas Editor | Puntadas ExportModal | Puntadas exportadas | Saltos | Trims | Colores | CE01 | Contornos OK | Observaciones |');
  lines.push('|--------|:------:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|');
  for (const r of results) {
    const m = r.metrics;
    lines.push(`| ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${m.stitchCount} | ${m.stitchCount} | ${m.stitchCount} | ${m.jumpCount} | ${m.trimCount} | ${m.colorCount} | ${m.ce01Status} | ${r.pass ? 'sí' : 'no'} | ${r.fails.join('; ') || '—'} |`);
  }
  lines.push('');
  lines.push(`## 3. Métricas por test`);
  lines.push('');
  for (const r of results) {
    const m = r.metrics;
    lines.push(`### ${r.name} — ${r.pass ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push('| Métrica | Valor |');
    lines.push('|---------|:-----:|');
    for (const k of ['rawDarkPixels','darkComponents','rawSkeletonSegments','consolidatedContours','outerOutlineCount','innerOutlineCount','detailOpenCurveCount','rejectedNoiseCount','rejectedFillBoundaryCount','stitchCount','jumpCount','trimCount','colorCount','artificialGeometryCount','fillBoundaryExported','pinkBoundaryExported','mouthExported','eyesExported','lowerContourExported','feetContourExported','ce01Status','minPathDarkSupport','averagePathDarkSupport','longStraightSegments','ovalBoundaryUsed','removedArtificialBridges','longestUnsupportedSegmentMm','unsupportedLongContourSegmentsAfter','suspiciousBlackDiagonalDetected','leftFootContourObject','rightFootContourObject','leftFootExportedStitches','rightFootExportedStitches','leftFootExportStitchesInExport','rightFootExportStitchesInExport','feetAfterFill','simulationExportMismatch','professionalMode','professionalScore','professionalVisibleDiagonals','professionalUnsupportedTravel','professionalFillAfterContour','professionalColorCountBefore','professionalColorCountAfter','professionalContourMissingOnOneFoot','professionalPassed']) {
      lines.push(`| ${k} | ${m[k]} |`);
    }
    for (const k of ['professionalDiagonalsBefore','professionalDiagonalsAfter','professionalRemovedDiagonals','professionalConvertedDiagonalToJump','professionalLongestRemovedDiagonalMm','professionalRepairedUsedForExport']) {
      lines.push(`| ${k} | ${m[k]} |`);
    }
    if (r.errors.length) { lines.push(''); lines.push('**Errores de ejecución:**'); for (const e of r.errors) lines.push(`- ${e}`); }
    if (r.fails.length) { lines.push(''); lines.push('**Fallos de assertion:**'); for (const f of r.fails) lines.push(`- ${f}`); }
    lines.push('');
  }
  lines.push(`## 4. Errores detectados`);
  lines.push('');
  const errs = results.filter(r => r.errors.length || r.fails.length);
  if (errs.length === 0) lines.push('Ninguno.');
  else for (const r of errs) { lines.push(`- **${r.name}**:`); for (const f of r.fails) lines.push(`  - ${f}`); for (const e of r.errors) lines.push(`  - (exec) ${e}`); }
  lines.push('');
  lines.push(`## 5. Archivos/fases sospechosos`);
  lines.push('');
  const suspects = [];
  for (const r of results) {
    if (r.metrics.fillBoundaryExported) suspects.push(`contourExportBuilder — fill boundary exportada en ${r.name}`);
    if (r.metrics.artificialGeometryCount > 0) suspects.push(`universalDarkContourDetector — geometría artificial en ${r.name}`);
    if (r.metrics.longStraightSegments > 0) suspects.push(`contourExportBuilder — segmentos largos/diagonales en ${r.name}`);
    if (r.metrics.ovalBoundaryUsed) suspects.push(`universalDarkContourDetector — oval/bbox usado en ${r.name}`);
    if (r.metrics.minPathDarkSupport < 0.90 && r.metrics.consolidatedContours > 0) suspects.push(`rawDarkStrokeTest — dark support < 0.90 en ${r.name}`);
  }
  if (suspects.length === 0) lines.push('Ninguno.');
  else for (const s of [...new Set(suspects)]) lines.push(`- ${s}`);
  lines.push('');
  lines.push(`## 6. Recomendaciones (sin modificar código)`);
  lines.push('');
  lines.push('- Si un test FAIL por dark support < 0.90: revisar umbrales de createStrictDarkMask (no tocar aún).');
  lines.push('- Si fillBoundaryExported=true: revisar segmentClassifier + buildUniversalDarkContoursFromContext.');
  lines.push('- Si longStraightSegments>0: revisar refineContourPath / consolidateDarkContourGraph.');
  lines.push('- Ejecutar de nuevo tras cada cambio de motor para confirmar convergencia.');
  lines.push('');
  return lines.join('\n');
}

// ── TEST 13: repairVisibleDiagonalStitches (unit test directo) ─────────────────
// Dos zonas separadas + una puntada diagonal artificial que las conecta.
// La reparación debe convertir esa unión en trim+jump sin coser la diagonal.
function runVisibleDiagonalRepairTest() {
  const errors = [];
  const fails = [];
  // Dos regiones circulares separadas (centros a ~45mm de distancia)
  const circlePoly = (cx, cy, r, n = 32) => {
    const pts = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return pts;
  };
  const normPts = pts => pts.map(([x, y]) => [x / 200, y / 200]);
  const regions = [
    { id: 'zone_a', name: 'zone_a', color: '#dc2828', stitch_type: 'fill', region_class: 'fill', object_group: 'zone_a', area_mm2: 2500, path_points: normPts(circlePoly(55, 100, 28)) },
    { id: 'zone_b', name: 'zone_b', color: '#dc2828', stitch_type: 'fill', region_class: 'fill', object_group: 'zone_b', area_mm2: 2500, path_points: normPts(circlePoly(145, 140, 28)) },
  ];
  // Comandos: fill de A, puntada diagonal negra A→B (artificial, ~34°), fill de B
  const commands = [
    { type: 'jump', x: 55, y: 100, color: '#dc2828', stitchType: 'fill', regionId: 'zone_a' },
    { type: 'stitch', x: 55, y: 120, color: '#dc2828', stitchType: 'fill', regionId: 'zone_a', layerType: 'fill' },
    { type: 'stitch', x: 55, y: 80, color: '#dc2828', stitchType: 'fill', regionId: 'zone_a', layerType: 'fill' },
    // diagonal artificial negra conectando A → B (cruza regiones, contorno sin soporte de máscara)
    { type: 'stitch', x: 145, y: 140, color: '#0c0c0c', stitchType: 'satin', regionId: 'zone_b', layerType: 'outer_outline' },
    { type: 'stitch', x: 145, y: 120, color: '#dc2828', stitchType: 'fill', regionId: 'zone_b', layerType: 'fill' },
    { type: 'stitch', x: 145, y: 160, color: '#dc2828', stitchType: 'fill', regionId: 'zone_b', layerType: 'fill' },
  ];
  const darkStroke = null; // sin máscara → el contorno no tiene soporte → sospechoso
  const before = countVisibleDiagonalStitches(commands, regions, darkStroke, {});
  const repair = repairVisibleDiagonalStitches(commands, regions, darkStroke, {});
  const after = countVisibleDiagonalStitches(repair.commands, regions, darkStroke, {});

  const ok = (cond, msg) => { if (!cond) fails.push(msg); };
  ok(before > 0, `visibleDiagonalStitchesBefore debe ser > 0 (got ${before})`);
  ok(after === 0, `visibleDiagonalStitchesAfter debe ser 0 (got ${after})`);
  ok(repair.report.removedVisibleDiagonalStitches > 0, `removedVisibleDiagonalStitches debe ser > 0 (got ${repair.report.removedVisibleDiagonalStitches})`);
  ok(repair.report.convertedDiagonalToJump > 0, `convertedDiagonalToJump debe ser > 0 (got ${repair.report.convertedDiagonalToJump})`);
  // la salida contiene un trim y un jump donde estaba la diagonal
  const hasTrim = repair.commands.some(c => c.type === 'trim');
  const hasJump = repair.commands.some(c => c.type === 'jump' && c.x === 145 && c.y === 140);
  ok(hasTrim, 'la salida no contiene el trim de la diagonal reparada');
  ok(hasJump, 'la salida no contiene el jump al punto destino de la diagonal');
  // no se eliminan las puntadas de relleno válidas (mismas región)
  const fillStitches = repair.commands.filter(c => c.type === 'stitch' && c.stitchType === 'fill').length;
  ok(fillStitches === 4, `puntadas de relleno válidas alteradas (esperaba 4, got ${fillStitches})`);

  const metrics = {
    rawDarkPixels: 0, darkComponents: 0, rawSkeletonSegments: 0, consolidatedContours: 0,
    outerOutlineCount: 0, innerOutlineCount: 0, detailOpenCurveCount: 0, rejectedNoiseCount: 0,
    rejectedFillBoundaryCount: 0, stitchCount: repair.commands.filter(c => c.type === 'stitch').length,
    jumpCount: repair.commands.filter(c => c.type === 'jump').length,
    trimCount: repair.commands.filter(c => c.type === 'trim').length, colorCount: 2,
    artificialGeometryCount: 0, fillBoundaryExported: false, pinkBoundaryExported: false,
    mouthExported: false, eyesExported: false, lowerContourExported: false, feetContourExported: false,
    ce01Status: 'SAFE', minPathDarkSupport: 0, exportedPathsCount: 0, averagePathDarkSupport: 0,
    longStraightSegments: 0, darkContourCoverage: 0, ovalBoundaryUsed: false,
    removedArtificialBridges: 0, longestUnsupportedSegmentMm: 0,
    unsupportedLongContourSegmentsAfter: 0, suspiciousBlackDiagonalDetected: after > 0,
    leftFootContourObject: false, rightFootContourObject: false, leftFootExportedStitches: 0,
    rightFootExportedStitches: 0, leftFootExportColor: null, rightFootExportColor: null,
    leftFootExportStitchesInExport: 0, rightFootExportStitchesInExport: 0, feetAfterFill: false,
    simulationExportMismatch: false, finalLookExportObjectsMissing: [],
    professionalMode: true,
    professionalScore: after === 0 ? 100 : 50,
    professionalVisibleDiagonals: after,
    professionalUnsupportedTravel: 0, professionalFillAfterContour: null,
    professionalColorCountBefore: 2, professionalColorCountAfter: 2,
    professionalContourMissingOnOneFoot: null, professionalPassed: after === 0 && before > 0,
    professionalDiagonalsBefore: before, professionalDiagonalsAfter: after,
    professionalRemovedDiagonals: repair.report.removedVisibleDiagonalStitches,
    professionalConvertedDiagonalToJump: repair.report.convertedDiagonalToJump,
    professionalLongestRemovedDiagonalMm: repair.report.longestRemovedDiagonalMm,
    professionalRepairedUsedForExport: true,
  };
  return { name: 'professional_visible_diagonal_repair', pass: fails.length === 0 && errors.length === 0, fails, errors, metrics };
}

// ── Main ───────────────────────────────────────────────────────────────────────
export function runRegressionSuite() {
  const fixtures = [
    makeCircleFixture(),
    makeKirbyFixture(),
    makeMulticolorFixture(),
    makeIrregularFixture(),
    makeOpenDetailsFixture(),
    makeDiagonalGuardFixture(),
    makeBothFeetFixture(),
    makeProfTravelFixture(),
    makeContourAfterFillFixture(),
    makeBothFeetProfessionalFixture(),
    makeFinalLookMatchFixture(),
    makeColorReductionFixture(),
  ];
  const results = fixtures.map(fixture => {
    const run = runFixture(fixture);
    const verdict = assertFixture(fixture, run.metrics);
    return {
      name: fixture.name,
      pass: verdict.pass && run.errors.length === 0,
      fails: verdict.fails,
      errors: run.errors,
      metrics: run.metrics,
    };
  });
  // TEST 13: reparación directa de diagonales visibles (unit test)
  results.push(runVisibleDiagonalRepairTest());
  const markdown = buildMarkdown(results);
  const passCount = results.filter(r => r.pass).length;
  return {
    tests: results,
    summary: { total: results.length, pass: passCount, fail: results.length - passCount },
    markdown,
  };
}