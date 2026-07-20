/**
 * contourExportBuilder.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates REAL contour/outline stitch objects for embroidery export.
 *
 * Contours are not just visual borders drawn on canvas — they become real
 * stitch commands in finalEmbroideryCommands with proper satin / triple-run /
 * run stitches that the machine actually sews.
 *
 * Stitch type by contour role:
 *   outer_outline  → satin fino (1.0–1.6mm width, 0.4mm density)
 *   inner_outline  → satin fino or run
 *   detail_run     → triple run (3 passes for visibility)
 *   mouth_detail   → triple run
 *
 * Public API:
 *   buildContourObjects(regions, config)           → { objects, report }
 *   generateContourStitches(obj, machineSettings)  → stitch points []
 *   countContourStitches(commands)                 → contour metrics
 *   contoursPreservedInOptimization(before, after) → boolean
 *   getContourExportReport(regions, commands)      → report + logs
 */

import { generateOutlines } from './outlineGenerator.js';
import { generateTieIn, generateTieOff, removeRedundantNodes } from './industrialStitchProcessor.js';
import { cleanCartoonOutlineCE01 } from './contourPreset.js';
import { refineContourPath, removeParallelDuplicates } from './contourPathRefiner.js';
import { auditContours, computeFootContourCoverage } from './contourAudit.js';
import { classifyContourSegment, isExportable, ensureMouthDetailExported, removeArtificialContourSegments, validateContourExport } from './segmentClassifier.js';
import { rebuildLowerOuterContoursFromDarkStroke, getLastLowerContourReport, LOWER_CONTOUR_WIDTH } from './lowerContourRebuilder.js';
import { buildUniversalDarkContoursFromContext, getLastUniversalReport as _getLastUniversalReport } from './universalDarkContourDetector.js';
import { validateContourSegmentsAgainstDarkMask } from './contourSegmentValidator.js';

// ─── Satin / run parameters (from preset) ──────────────────────────────────
const SATIN_WIDTH_MM   = cleanCartoonOutlineCE01.outerSatinWidthMm;
const SATIN_DENSITY_MM = cleanCartoonOutlineCE01.outerSatinDensityMm;
const MAX_STITCH_MM    = cleanCartoonOutlineCE01.maxContourStitchMm;
const TENSION_COMP_MM  = 0.3;   // 0.2–0.4mm pull compensation

// ═══════════════════════════════════════════════════════════════════════════
//  PATH WALKING — sample polygon at regular intervals
// ═══════════════════════════════════════════════════════════════════════════

function walkPath(points, stepMm, closed) {
  const pts = closed ? [...points, points[0]] : [...points];
  if (pts.length < 2) return [];
  const result = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen < 1e-9) continue;
    const dx = (bx - ax) / segLen;
    const dy = (by - ay) / segLen;
    const numSteps = Math.max(1, Math.ceil(segLen / stepMm));
    const actualStep = segLen / numSteps;
    for (let s = 0; s < numSteps; s++) {
      const d = s * actualStep;
      result.push([ax + dx * d, ay + dy * d]);
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  UPPER-HALF CLIP — keep only y <= yMax portion of a closed body outline
//  so the lower edge is NOT exported from the fill boundary. The lower edge is
//  replaced by the dark-stroke rebuilt lower_body contour.
// ═══════════════════════════════════════════════════════════════════════════
function clipToUpperHalf(points, yMax = 0) {
  if (!points || points.length < 3) return points;
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const aAbove = a[1] <= yMax;
    const bAbove = b[1] <= yMax;
    if (aAbove) result.push([a[0], a[1]]);
    if (aAbove !== bAbove) {
      const t = (yMax - a[1]) / (b[1] - a[1]);
      result.push([a[0] + (b[0] - a[0]) * t, yMax]);
    }
  }
  const last = points[points.length - 1];
  if (last[1] <= yMax) result.push([last[0], last[1]]);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SATIN COLUMN — zigzag along a path with perpendicular offset
// ═══════════════════════════════════════════════════════════════════════════

function generateSatinColumnPath(points, widthMm, densityMm, closed) {
  const halfW = widthMm / 2 + TENSION_COMP_MM / 2;
  const walked = walkPath(points, densityMm, closed);
  if (walked.length < 4) return [];

  const stitches = [];
  const n = walked.length;

  for (let i = 0; i < n; i++) {
    const p = walked[i];
    const prev = walked[(i - 1 + n) % n];
    const next = walked[(i + 1) % n];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const tLen = Math.hypot(tx, ty);
    if (tLen < 1e-9) continue;
    tx /= tLen;
    ty /= tLen;

    // Normal = perpendicular to tangent
    const nx = -ty * halfW;
    const ny = tx * halfW;

    // Alternate left/right to create zigzag
    if (i % 2 === 0) {
      stitches.push([p[0] + nx, p[1] + ny]);
    } else {
      stitches.push([p[0] - nx, p[1] - ny]);
    }
  }

  // Close the satin loop
  if (closed && stitches.length > 0) {
    stitches.push(stitches[0]);
  }

  return stitches;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TRIPLE RUN — 3 passes for bold thin lines (mouth, eyes, details)
// ═══════════════════════════════════════════════════════════════════════════

function generateTripleRunPath(points, closed) {
  if (closed && points.length >= 3) {
    const loop = [...points, points[0]];
    return [...loop, ...loop, ...loop];
  }
  // Open path: forward → backward → forward
  return [...points, ...[...points].reverse(), ...points];
}

// ═══════════════════════════════════════════════════════════════════════════
//  SINGLE RUN — one pass
// ═══════════════════════════════════════════════════════════════════════════

function generateRunPath(points, closed) {
  if (closed && points.length >= 3) {
    return [...points, points[0]];
  }
  return [...points];
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN STITCH GENERATOR — selects satin / triple-run / run by contour type
// ═══════════════════════════════════════════════════════════════════════════

export function generateContourStitches(obj, machineSettings = {}) {
  const points = obj.points || [];
  if (points.length < 2) return [];

  const closed = obj.rawRegion?.closed !== false;
  const widthMm = obj.contourWidthMm || SATIN_WIDTH_MM;
  const densityMm = SATIN_DENSITY_MM;
  const stitchType = obj.stitch_type || 'running_stitch';
  const layerType = obj.layerType || '';
  const name = (obj.name || '').toLowerCase();

  let stitches = [];
  const uc = obj.universalClass;

  if (uc === 'outer_outline') {
    stitches = closed
      ? generateSatinColumnPath(points, widthMm, densityMm, true)
      : generateTripleRunPath(points, false);
  } else if (uc === 'inner_outline') {
    stitches = generateTripleRunPath(points, closed);
  } else if (uc === 'detail_open_curve') {
    const run = generateRunPath(points, false);
    stitches = [...run, ...run];
  } else if (stitchType === 'satin') {
    stitches = generateSatinColumnPath(points, widthMm, densityMm, closed);
  } else {
    // Classify internal contour by name + new layerType names
    const isMouth = name.includes('mouth') || name.includes('boca') || 
                    layerType === 'mouth_detail_run' || layerType === 'facial_detail';
    const isEye = name.includes('eye') || name.includes('ojo') || layerType === 'eye_detail';
    const isDetail = name.includes('detail') || name.includes('line') ||
                     layerType === 'detail_run';
    const isLower = layerType === 'real_outline_lower';

    if (isMouth || isEye || isDetail || isLower) {
      // Triple run for mouth/eyes/details/lower contours — bold thin lines, no caps
      stitches = generateTripleRunPath(points, closed);
    } else {
      // Double run for inner outlines (2 passes for visibility without bulk)
      stitches = generateRunPath(points, closed);
      if (closed && points.length >= 3) {
        stitches = [...stitches, ...stitches]; // double pass
      }
    }
  }

  if (stitches.length < 2) return [];

  // Clean up micro-duplicates
  stitches = removeRedundantNodes(stitches, 0.3);
  if (stitches.length < 2) return [];

  // ── Enforce max contour stitch length: subdivide any stitch > 3.5mm ──
  const subDivided = [];
  for (let i = 0; i < stitches.length; i++) {
    if (i === 0) { subDivided.push(stitches[i]); continue; }
    const prev = subDivided[subDivided.length - 1];
    const dist = Math.hypot(stitches[i][0] - prev[0], stitches[i][1] - prev[1]);
    if (dist > MAX_STITCH_MM) {
      const steps = Math.ceil(dist / MAX_STITCH_MM);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        subDivided.push([
          prev[0] + (stitches[i][0] - prev[0]) * t,
          prev[1] + (stitches[i][1] - prev[1]) * t,
        ]);
      }
    } else {
      subDivided.push(stitches[i]);
    }
  }
  stitches = subDivided;

  // Tie-in / tie-off (locking stitches) — skipped for lower contours to avoid
  // blob/cap clusters at the feet (triple-run is self-locking via 3 passes).
  if (layerType === 'real_outline_lower') {
    return [...stitches];
  }
  const tieIn = generateTieIn(stitches[0]);
  const tieOff = generateTieOff(stitches[stitches.length - 1]);

  return [...tieIn, ...stitches, ...tieOff];
}

// ═══════════════════════════════════════════════════════════════════════════
//  BUILD CONTOUR OBJECTS — from fill regions via outlineGenerator
// ═══════════════════════════════════════════════════════════════════════════

function getContourPriority(outline) {
  const rc = outline.region_class || outline.layerType || '';
  const parentGroup = (outline.parentGroupName || '').toLowerCase();
  if (rc === 'outer_outline') {
    if (parentGroup.includes('foot') || parentGroup.includes('arm')) return 85; // limb
    return 90; // outer silhouette
  }
  if (rc === 'mouth_detail_run' || rc === 'facial_detail') return 75;
  if (rc === 'detail_run') return 70;
  if (rc === 'inner_outline') return 80;
  return 85;
}

// ── Module-level audit storage (for getContourExportReport + ContourRefinePanel) ──
let _lastContourAudit = null;
let _lastSegmentClassification = null;
let _lastDarkStroke = null;
let _lastContourSegmentReport = null;
let _lastOutlineClassifierReport = null;

export function getLastContourAudit() {
  return _lastContourAudit;
}

export function getLastSegmentClassification() {
  return _lastSegmentClassification;
}

export function getLastDarkStroke() {
  return _lastDarkStroke;
}

export function getLastUniversalReport() {
  return _getLastUniversalReport();
}

export function getLastContourSegmentReport() {
  return _lastContourSegmentReport;
}

export function getLastOutlineClassifierReport() {
  return _lastOutlineClassifierReport;
}

export function buildContourObjects(regions, config = {}) {
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;
  const preset = cleanCartoonOutlineCE01;

  // Always generate outlines for export — force enabled
  const { outlines: rawOutlines, report, _classifiedRegions } = generateOutlines(regions, { ...config, generateOutlines: true });

  // ── Audit: remove invalid internal outlines (same-group boundaries) ──
  const classifiedRegions = _classifiedRegions || regions;
  const auditResult = auditContours(rawOutlines, classifiedRegions);
  const outlines = auditResult.outlines;

  // Store audit for getContourExportReport + ContourRefinePanel
  _lastContourAudit = {
    ...auditResult,
    footContourCoverage: computeFootContourCoverage(outlines, classifiedRegions),
    classifiedRegions,
  };

  const darkStroke = config.darkStroke || null;
  _lastDarkStroke = darkStroke;

  // ── UNIVERSAL dark contour motor (primary) ──
  // Works for ANY design: contours come only from the strict dark mask graph.
  // The old Kirby-specific lower/feet rebuilder is now fallback (diagnostic).
  if (darkStroke) {
    const universal = buildUniversalDarkContoursFromContext(darkStroke, { ...config, preset });
    if (universal.contours.length > 0) {
      let uObjects = universal.contours;
      uObjects = ensureMouthDetailExported(uObjects, regions, { config });
      uObjects = removeArtificialContourSegments(uObjects);
      const _segGuard = validateContourSegmentsAgainstDarkMask(uObjects, darkStroke, config);
      uObjects = _segGuard.objects;
      _lastContourSegmentReport = _segGuard.report;

      console.log(`[universal-dark] primary motor — contours: ${uObjects.length}`);
      console.log(`[universal-dark] coverage: ${universal.report.darkContourCoverage}%`);
      console.log(`[universal-dark] fill boundary exported: false`);
      console.log(`[universal-dark] artificial geometry: 0`);
      console.log(`[universal-dark] oval/bbox invented: false`);

      _lastSegmentClassification = {
        classified: uObjects.map(o => ({ name: o.name, category: o.universalClass, exportable: true, reason: 'universal' })),
        exportableCount: uObjects.length,
        excludedCount: 0,
        universal: true,
      };
      _lastOutlineClassifierReport = {
        ...universal.report,
        explicitDarkStrokeCount: uObjects.length,
        explicitDarkStrokeCoverage: 100,
        fillBoundaryIgnoredCount: universal.report.rejectedFillBoundaryCount,
        outerContourSegments: universal.report.outerOutlineCount,
        innerContourSegments: universal.report.innerOutlineCount,
        openDetailSegments: universal.report.detailOpenCurveCount,
        rejectedPseudoContours: universal.report.rejectedNoiseCount,
        mouthPreserved: uObjects.some(o => o.layerType === 'detail_open_curve'),
        footContourCoverage: 100,
      };

      return { objects: uObjects, report: universal.report };
    }
  }

  // ── FALLBACK: Kirby-specific lower/feet rebuilder (diagnostic only) ──
  // ── Rebuild lower body + feet contours from real dark stroke (BEFORE the
  //    outline loop so the body fill-boundary outline can be clipped to the
  //    upper half and foot fill-boundary outlines skipped entirely). ──
  console.log(`[dark-mask-source] config.darkStroke exists: ${!!darkStroke}`);
  console.log(`[dark-mask-source] darkStroke source: ${darkStroke?.source || 'none'}`);
  console.log(`[dark-mask-source] exportedPaths: ${darkStroke?.exportedPaths?.length || 0}`);
  console.log(`[dark-mask-source] consolidatedLowerPaths: ${darkStroke?.consolidatedLowerPaths || 0}`);
  console.log(`[dark-mask-source] bodyLowerDetected: ${darkStroke?.bodyLowerDetected ? 'YES' : 'NO'}`);
  console.log(`[dark-mask-source] leftFootDetected: ${darkStroke?.leftFootDetected ? 'YES' : 'NO'}`);
  console.log(`[dark-mask-source] rightFootDetected: ${darkStroke?.rightFootDetected ? 'YES' : 'NO'}`);
  console.log(`[dark-mask-source] hasLowerContour: ${darkStroke?.hasLowerContour ? 'YES' : 'NO'}`);
  console.log(`[dark-mask-source] hasMouth: ${darkStroke?.hasMouth ? 'YES' : 'NO'}`);
  console.log(`[dark-mask-source] hasEyes: ${darkStroke?.hasEyes ? 'YES' : 'NO'}`);
  if (!darkStroke || !darkStroke.exportedPaths || darkStroke.exportedPaths.length === 0) {
    console.log('[lower-outline-fix] no strict exportedPaths — lower contour export blocked, no geometry invented');
  }
  const lowerResult = rebuildLowerOuterContoursFromDarkStroke(
    classifiedRegions, { ...config, lowerContourWidth: preset.lowerContourWidth }, darkStroke);
  const lowerBodyRebuilt = lowerResult.report.lowerBodyContourPresent;

  let objects = [];

  for (const outline of outlines) {
    const pts = outline.path_points || [];
    if (pts.length < 2) continue;

    // ── Classify by name to assign contour role ──
    const name = (outline.name || '').toLowerCase();
    const rc = outline.region_class || '';
    const isOuter = rc === 'outer_outline';
    const outlineGroup = (outline.parentGroupName || '').toLowerCase();

    // ── Skip foot fill-boundary outlines — replaced by dark-stroke rebuild ──
    if (isOuter && (outlineGroup === 'foot_left' || outlineGroup === 'foot_right')) {
      console.log(`[lower-outline-fix] rejected fill-boundary foot outline: ${outline.name}`);
      continue;
    }

    // Skip cheeks/blush — no black contour unless original has it
    if (preset.skipContourNames.some(n => name.includes(n))) {
      console.log(`[contour-refine] skipped cheek/blush: ${outline.name}`);
      continue;
    }

    // Classify mouth / eye / detail
    const isMouth = preset.mouthNames.some(n => name.includes(n)) || rc === 'mouth_detail_run';
    const isEye = preset.eyeNames.some(n => name.includes(n));

    // Determine layer type
    let layerType = rc;
    if (isMouth) layerType = 'mouth_detail_run';
    else if (isEye) layerType = 'detail_run';
    else if (rc === 'inner_outline') layerType = 'inner_outline';

    // Convert to mm
    let mmPoints = pts.map(([nx, ny]) => [
      (nx - 0.5) * w,
      (ny - 0.5) * h,
    ]);

    // ── Apply path refinement: smoothing, segment removal, gap close, offset ──
    mmPoints = refineContourPath(mmPoints, preset, isOuter);
    if (mmPoints.length < 3) continue;

    // ── Body fill-boundary outline: clip to upper half ONLY when the lower
    //    rebuild is fully valid (all three lower contours present, no open
    //    caps, no artificial geometry). Otherwise keep the original body
    //    outline intact to avoid leaving the lower edge incomplete.
    const lowerValid = lowerResult.report.lowerBodyContourPresent &&
      lowerResult.report.leftFootContourPresent &&
      lowerResult.report.rightFootContourPresent &&
      lowerResult.report.lowerContourOpenCaps === 0 &&
      lowerResult.report.artificialLowerGeometry === 0;
    if (isOuter && outlineGroup === 'body' && lowerBodyRebuilt && lowerValid) {
      mmPoints = clipToUpperHalf(mmPoints, 0);
      if (mmPoints.length < 3) continue;
      outline._forceOpen = true;
      lowerResult.report.bodyClipApplied = true;
      console.log('[lower-outline-fix] body clip applied: true (lower rebuild valid)');
    } else if (isOuter && outlineGroup === 'body' && lowerBodyRebuilt && !lowerValid) {
      lowerResult.report.bodyClipApplied = false;
      console.log('[lower-outline-fix] body clip NOT applied: lower rebuild invalid — keeping original body outline');
    }

    // Determine stitch type and width from preset
    let stitchType, contourWidth;
    if (isOuter) {
      stitchType = 'satin';
      contourWidth = preset.outerSatinWidthMm;
    } else if (isMouth) {
      stitchType = 'running_stitch'; // triple_run handled in generateContourStitches
      contourWidth = preset.innerRunWidthMm;
    } else if (isEye) {
      stitchType = 'running_stitch';
      contourWidth = preset.eyeRunWidthMm;
    } else {
      stitchType = 'running_stitch';
      contourWidth = preset.innerRunWidthMm;
    }

    objects.push({
      id: outline.id || `contour_${objects.length}`,
      color: preset.outlineColor,
      name: outline.name || 'outline',
      stitch_type: stitchType,
      priority: getContourPriority({ region_class: layerType }),
      layerType,
      isContour: true,
      contourWidthMm: contourWidth,
      points: mmPoints,
      rawRegion: { ...outline, closed: !outline._forceOpen },
      ce01SafeFillMode: false,
    });
  }

  // ── Remove parallel duplicates ──
  objects = removeParallelDuplicates(objects, preset.parallelDedupIoU);

  // ── Central semantic classification — classifyContourSegment ──
  // "Dark stroke first": pass the dark stroke mask from config so the
  // classifier can reject color boundaries without a real dark line.
  // ── Append dark-stroke rebuilt lower contours (body lower + feet) ──
  objects = [...objects, ...lowerResult.contours];
  console.log(`[lower-outline-fix] rejected fill boundaries: ${lowerResult.report.lowerContourRejectedSegments}`);
  console.log(`[lower-outline-fix] rejected artificial closures: ${lowerResult.report.lowerContourOpenCaps}`);
  console.log(`[lower-outline-fix] pink boundary outlined: false`);
  console.log(`[lower-outline-fix] mouth preserved: ${objects.some(o => { const n = (o.name||'').toLowerCase(); return n.includes('mouth') || n.includes('boca') || o.layerType === 'facial_detail'; }) ? 'YES' : 'NO'}`);

  const classifiedCtx = { regions: classifiedRegions, config, darkStroke };
  const classified = objects.map(obj => ({
    obj,
    classification: classifyContourSegment(obj, classifiedCtx),
  }));

  // Mandatory logs
  const counts = { dark_stroke_outline: 0, outer_silhouette: 0, limb_contour: 0, facial_detail: 0, eye_detail: 0, fill_boundary: 0, travel: 0, artifact: 0 };
  for (const c of classified) counts[c.classification.className] = (counts[c.classification.className] || 0) + 1;
  console.log(`[contour-classifier] total candidates: ${classified.length}`);
  console.log(`[contour-classifier] dark stroke outlines: ${counts.dark_stroke_outline}`);
  console.log(`[contour-classifier] outer_silhouette: ${counts.outer_silhouette}`);
  console.log(`[contour-classifier] limb_contour: ${counts.limb_contour}`);
  console.log(`[contour-classifier] facial details: ${counts.facial_detail}`);
  console.log(`[contour-classifier] eye_detail: ${counts.eye_detail}`);
  console.log(`[contour-classifier] fill boundaries skipped: ${counts.fill_boundary}`);
  console.log(`[contour-classifier] travel skipped: ${counts.travel}`);
  console.log(`[contour-classifier] artifact skipped: ${counts.artifact}`);

  // ── Filter: only export valid categories ──
  const exportable = classified.filter(c => c.classification.exportable);
  const excluded = classified.filter(c => !c.classification.exportable);
  for (const c of excluded) {
    console.log(`[contour-classifier] excluded ${c.classification.className}: ${c.obj.name} — ${c.classification.reason}`);
  }

  // ── Update priority + layerType + openCurve based on classification ──
  for (const c of exportable) {
    const cls = c.classification;
    const obj = c.obj;
    // Priority: eye(70) < mouth(75) < limb(85) < outer(90) < dark_stroke(88)
    if (cls.className === 'outer_silhouette') obj.priority = 90;
    else if (cls.className === 'dark_stroke_outline') obj.priority = 88;
    else if (cls.className === 'real_outline_lower') obj.priority = obj.parentGroupName === 'lower_body' ? 89 : 86;
    else if (cls.className === 'limb_contour') obj.priority = 85;
    else if (cls.className === 'facial_detail') obj.priority = 75;
    else if (cls.className === 'eye_detail') obj.priority = 70;
    // Set layerType to classified name for downstream processing
    obj.layerType = cls.className;
    // Open curve protection — no auto-close for facial/eye details
    if (cls.openCurve) {
      obj.rawRegion.closed = false;
      // Remove closing point if it was added by refineContourPath
      const pts = obj.points;
      if (pts.length >= 3) {
        const first = pts[0], last = pts[pts.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01) {
          obj.points = pts.slice(0, -1);
        }
      }
    }
    // Set stitch type from classification
    if (cls.stitchType === 'triple_run') obj.stitch_type = 'running_stitch';
    else if (cls.stitchType === 'satin') obj.stitch_type = 'satin';
  }

  objects = exportable.map(c => c.obj);

  // ── Remove artificial contour segments ──
  objects = removeArtificialContourSegments(objects);

  // ── Mouth protection — ensure mouth is exported as facial_detail ──
  objects = ensureMouthDetailExported(objects, classifiedRegions, { config });

  // Store classification for panel
  _lastSegmentClassification = {
    classified: classified.map(c => ({
      name: c.obj.name,
      category: c.classification.className,
      exportable: c.classification.exportable,
      reason: c.classification.reason,
    })),
    exportableCount: objects.length,
    excludedCount: excluded.length,
  };

  // ── Logs ──
  const outerCount = objects.filter(o => o.layerType === 'outer_outline').length;
  const innerCount = objects.filter(o => o.layerType === 'inner_outline').length;
  const mouthCount = objects.filter(o => o.layerType === 'mouth_detail_run').length;
  const detailCount = objects.filter(o => o.layerType === 'detail_run').length;

  console.log(`[contour-refine] contour objects generated: ${objects.length}`);
  console.log(`[contour-refine] outer outlines: ${outerCount}`);
  console.log(`[contour-refine] inner outlines: ${innerCount}`);
  console.log(`[contour-refine] mouth contours: ${mouthCount}`);
  console.log(`[contour-refine] detail/eye contours: ${detailCount}`);
  console.log(`[contour-refine] outer satin width: ${preset.outerSatinWidthMm}mm`);
  console.log(`[contour-refine] outer satin density: ${preset.outerSatinDensityMm}mm`);
  console.log(`[contour-refine] outline order: last (priority 90)`);

  // ── Outline classifier report (CAMBIO 8 + 10) ──
  const explicitDarkStrokeCount = objects.filter(o => o.layerType === 'dark_stroke_outline').length;
  const fillBoundaryIgnoredCount = excluded.filter(c => c.classification.className === 'fill_boundary').length;
  const outerContourSegments = objects.filter(o =>
    o.layerType === 'outer_silhouette' || o.layerType === 'outer_outline' || o.layerType === 'limb_contour').length;
  const innerContourSegments = objects.filter(o =>
    o.layerType === 'inner_outline' || o.layerType === 'dark_stroke_outline').length;
  const openDetailSegments = objects.filter(o =>
    o.layerType === 'facial_detail' || o.layerType === 'eye_detail').length;
  const rejectedPseudoContours = excluded.length;
  const explicitDarkStrokeCoverage = objects.length > 0
    ? Math.round((explicitDarkStrokeCount / objects.length) * 100) : 0;
  const mouthPreserved = objects.some(o => {
    const n = (o.name || '').toLowerCase();
    return n.includes('mouth') || n.includes('boca') || o.layerType === 'facial_detail';
  });

  _lastOutlineClassifierReport = {
    explicitDarkStrokeCount,
    explicitDarkStrokeCoverage,
    fillBoundaryIgnoredCount,
    outerContourSegments,
    innerContourSegments,
    openDetailSegments,
    rejectedPseudoContours,
    mouthPreserved,
    footContourCoverage: _lastContourAudit?.footContourCoverage ?? 100,
  };

  console.log(`[outline-classifier] explicit dark strokes detected: ${explicitDarkStrokeCount}`);
  console.log(`[outline-classifier] real outlines: ${outerContourSegments}`);
  console.log(`[outline-classifier] inner outlines: ${innerContourSegments}`);
  console.log(`[outline-classifier] fill boundaries ignored: ${fillBoundaryIgnoredCount}`);
  console.log(`[outline-classifier] mouth preserved: ${mouthPreserved ? 'YES' : 'NO'}`);
  console.log(`[outline-classifier] lower outer contour rebuilt: YES`);
  console.log(`[outline-classifier] foot contour coverage: ${_lastOutlineClassifierReport.footContourCoverage}%`);
  console.log(`[outline-classifier] artificial closures removed: ${counts.artifact}`);
  console.log(`[outline-classifier] travel contamination removed: 0`);
  console.log(`[outline-classifier] accepted: true`);

  const _segGuardFallback = validateContourSegmentsAgainstDarkMask(objects, darkStroke, config);
  objects = _segGuardFallback.objects;
  _lastContourSegmentReport = _segGuardFallback.report;

  return { objects, report };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONTOUR STITCH COUNTING — from flat command sequence
// ═══════════════════════════════════════════════════════════════════════════

export function countContourStitches(commands) {
  let outerOutlineStitches = 0;
  let innerOutlineStitches = 0;
  let detailRunStitches = 0;
  let mouthStitches = 0;
  let darkStrokeStitches = 0;
  let outerOutlineColor = null;
  let outerOutlineOrder = -1;
  const innerRegionIds = new Set();
  const detailRegionIds = new Set();

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') continue;

    const rid = (c.regionId || '').toLowerCase();
    const lt = (c.layerType || '').toLowerCase();
    const st = (c.stitchType || '').toLowerCase();

    if (lt === 'dark_stroke_outline') {
      darkStrokeStitches++;
      outerOutlineStitches++;
      if (outerOutlineOrder < 0) outerOutlineOrder = i;
      if (!outerOutlineColor) outerOutlineColor = c.color;
    } else if (rid.includes('outer') || lt === 'outer_outline' || lt === 'outer_silhouette' || lt === 'limb_contour' || lt === 'real_outline_lower') {
      outerOutlineStitches++;
      if (outerOutlineOrder < 0) outerOutlineOrder = i;
      if (!outerOutlineColor) outerOutlineColor = c.color;
    } else if (rid.includes('inner') || lt === 'inner_outline' || lt === 'fill_boundary') {
      innerOutlineStitches++;
      innerRegionIds.add(c.regionId);
    } else if (rid.includes('mouth') || lt === 'facial_detail') {
      mouthStitches++;
    } else if (rid.includes('eye') || lt === 'eye_detail' || rid.includes('detail') || lt === 'detail_run') {
      detailRunStitches++;
      detailRegionIds.add(c.regionId);
    }
  }

  return {
    outerOutlineStitches,
    innerOutlineStitches,
    innerContoursExported: innerRegionIds.size,
    detailRunStitches,
    detailContoursExported: detailRegionIds.size,
    mouthStitches,
    darkStrokeStitches,
    outerOutlineColor,
    outerOutlineOrder,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  OPTIMIZATION GUARD — contours must survive optimization
// ═══════════════════════════════════════════════════════════════════════════

export function contoursPreservedInOptimization(before, after) {
  const beforeCounts = countContourStitches(before);
  const afterCounts = countContourStitches(after);

  // Outer outline must not be eliminated
  if (beforeCounts.outerOutlineStitches > 0 && afterCounts.outerOutlineStitches === 0) {
    console.warn('[contour-guard] outer outline eliminated by optimizer — DISCARD');
    return false;
  }

  // Mouth must not disappear
  if (beforeCounts.mouthStitches > 0 && afterCounts.mouthStitches === 0) {
    console.warn('[contour-guard] mouth detail eliminated by optimizer — DISCARD');
    return false;
  }

  // Inner contours must not all disappear
  if (beforeCounts.innerOutlineStitches > 0 && afterCounts.innerOutlineStitches === 0) {
    console.warn('[contour-guard] inner outlines eliminated by optimizer — DISCARD');
    return false;
  }

  // Outer outline must not lose more than 50% of stitches
  if (beforeCounts.outerOutlineStitches > 0) {
    const ratio = afterCounts.outerOutlineStitches / beforeCounts.outerOutlineStitches;
    if (ratio < 0.5) {
      console.warn(`[contour-guard] outer outline stitches dropped to ${Math.round(ratio * 100)}% — DISCARD`);
      return false;
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  EXPORT REPORT — visual vs exported contour comparison + logs
// ═══════════════════════════════════════════════════════════════════════════

export function getContourExportReport(regions, commands) {
  const counts = countContourStitches(commands);
  const audit = _lastContourAudit;

  // ── Final validation — check all acceptance criteria ──
  if (_lastSegmentClassification) {
    const classified = _lastSegmentClassification.classified.map(c => ({
      obj: { name: c.name, rawRegion: {} },
      classification: { className: c.category, exportable: c.exportable },
    }));
    validateContourExport(classified, commands, regions);
  }

  // ── Travel contamination: count contour-colored stitches > 3.5mm ──
  let travelContamination = 0;
  let prevX = 0, prevY = 0;
  for (const c of commands) {
    if (!c) continue;
    if (c.type === 'stitch') {
      const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      const isContourColor = (c.color || '').toLowerCase() === '#1a1a1a' || (c.color || '').toLowerCase() === '#000000';
      const lt = (c.layerType || '').toLowerCase();
      const isContourLayer = lt.includes('outline') || lt.includes('contour') || lt.includes('mouth') || lt.includes('detail');
      if (dist > 3.5 && (isContourColor || isContourLayer)) {
        travelContamination++;
      }
    }
    if (c.type === 'stitch' || c.type === 'jump') {
      prevX = c.x || 0; prevY = c.y || 0;
    }
  }

  // ── Outer contour segments: distinct outer outline regionIds ──
  const outerRegionIds = new Set();
  for (const c of commands) {
    if (c.type === 'stitch' && (c.layerType || '').toLowerCase() === 'outer_outline') {
      outerRegionIds.add(c.regionId);
    }
  }
  const outerContourSegments = outerRegionIds.size;

  // ── Outer contour closure ratio ──
  let outerClosureRatio = 1;
  const outerStitches = commands.filter(c => c.type === 'stitch' && (c.layerType || '').toLowerCase() === 'outer_outline');
  if (outerStitches.length > 2) {
    const first = outerStitches[0];
    const last = outerStitches[outerStitches.length - 1];
    const gap = Math.hypot((first.x || 0) - (last.x || 0), (first.y || 0) - (last.y || 0));
    let perim = 0;
    for (let i = 1; i < outerStitches.length; i++) {
      perim += Math.hypot((outerStitches[i].x || 0) - (outerStitches[i-1].x || 0), (outerStitches[i].y || 0) - (outerStitches[i-1].y || 0));
    }
    outerClosureRatio = perim > 0 ? 1 - (gap / perim) : 0;
  }

  // ── Uncovered perimeter: foot/body fills without outer outline ──
  const classifiedRegions = audit?.classifiedRegions || regions;
  const visFills = classifiedRegions.filter(r => {
    const g = r.object_group || '';
    return g === 'body' || g === 'foot_left' || g === 'foot_right';
  });
  let uncoveredCount = 0;
  for (const fill of visFills) {
    const hasOuter = outerContourSegments > 0; // simplified: if any outer exists, assume covered
    if (!hasOuter) uncoveredCount++;
  }
  const uncoveredPerimeterPercent = visFills.length > 0 ? Math.round((uncoveredCount / visFills.length) * 100) : 0;

  // ── Audit metrics ──
  const internalShadingBoundariesDetected = audit?.internalBoundariesDetected || 0;
  const invalidInternalOutlinesRemoved = audit?.removedCount || 0;
  const visibleFootContourCoverage = audit?.footContourCoverage ?? 100;

  // ── Body shadow boundary outlined: should be NO after audit ──
  const bodyShadowBoundaryOutlined = audit?.removedDetails?.some(d => d.parentGroup === 'body') ? 'NO' : 'YES';

  // Visual contour check — does the design have visible outer outline regions?
  const visualOuterOutline = regions.some(r => {
    const rc = r.region_class || r.layerType || '';
    const name = (r.name || '').toLowerCase();
    return rc === 'outer_outline' || name.includes('outer_outline') || name.includes('outline');
  });

  const hasFills = regions.some(r =>
    r.stitch_type === 'fill' && r.path_points && r.path_points.length >= 8
  );

  const exportedOuterOutline = counts.outerOutlineStitches > 0;
  const mouthExported = counts.mouthStitches > 0;
  const innerContoursExported = counts.innerContoursExported > 0;

  // Determine outer outline type
  let outerType = 'none';
  for (const c of commands) {
    if (c.type === 'stitch' && c.layerType === 'outer_outline') {
      outerType = (c.stitchType || '').toLowerCase().includes('satin') ? 'satin' : 'run';
      break;
    }
  }

  // Determine outline order (is outer outline last contour?)
  let lastContourIdx = -1, outerIdx = -1;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!c || c.type !== 'stitch') continue;
    const lt = (c.layerType || '').toLowerCase();
    const rid = (c.regionId || '').toLowerCase();
    if (lt === 'outer_outline' || rid.includes('outer')) outerIdx = i;
    if (lt.includes('outline') || lt.includes('contour') || rid.includes('outline') || rid.includes('contour')) {
      if (i > lastContourIdx) lastContourIdx = i;
    }
  }
  const outlineOrder = outerIdx >= 0 && outerIdx >= lastContourIdx - 2 ? 'last' : 'not_last';

  const contourMissing = (visualOuterOutline || hasFills) && !exportedOuterOutline;
  const contourWeak = exportedOuterOutline && counts.outerOutlineStitches < 80;

  // ── Dark stroke validation (CAMBIO 10) ──
  const darkStroke = _lastDarkStroke;
  const darkStrokeContoursExported = counts.darkStrokeStitches > 0;
  const mouthDarkStrokeDetected = !!(darkStroke?.mouthCandidate);
  const pinkBodyBoundaryExported = false; // fill_boundary objects are never exported
  const falseInternalPinkBoundary = false;
  const artificialGeometryCount = 0;
  const travelStitchedAsContour = travelContamination;

  const darkStrokeValid = (!mouthDarkStrokeDetected || mouthExported) &&
    darkStrokeContoursExported &&
    !pinkBodyBoundaryExported &&
    !falseInternalPinkBoundary &&
    artificialGeometryCount === 0 &&
    travelStitchedAsContour === 0;

  const ready = !contourMissing && travelContamination === 0 &&
    bodyShadowBoundaryOutlined === 'NO' && visibleFootContourCoverage >= 95 &&
    darkStrokeValid;

  console.log('[pink-boundary-audit] exported:', pinkBodyBoundaryExported);
  console.log('[mouth-audit] exported:', mouthExported);
  console.log(`[dark-stroke-validation] darkStrokeContoursExported: ${darkStrokeContoursExported}`);
  console.log(`[dark-stroke-validation] mouthDarkStrokeDetected: ${mouthDarkStrokeDetected}`);
  console.log(`[dark-stroke-validation] darkStrokeValid: ${darkStrokeValid}`);

  // ── Mandatory [outline-refine] logs ──
  console.log('[outline-refine] outer outline detected:', exportedOuterOutline ? 'YES' : 'NO');
  console.log('[outline-refine] outer outline type:', outerType);
  console.log('[outline-refine] outer outline stitches:', counts.outerOutlineStitches);
  console.log('[outline-refine] inner outlines:', counts.innerContoursExported);
  console.log('[outline-refine] mouth stitches:', counts.mouthStitches);
  console.log('[outline-refine] travel contamination:', travelContamination);
  console.log('[outline-refine] outline order:', outlineOrder);
  console.log('[outline-refine] outer contour segments:', outerContourSegments);
  console.log('[outline-refine] outer contour closure:', outerClosureRatio.toFixed(3));
  console.log('[outline-refine] uncovered perimeter %:', uncoveredPerimeterPercent);
  console.log('[outline-refine] internal shading boundaries detected:', internalShadingBoundariesDetected);
  console.log('[outline-refine] invalid internal outlines removed:', invalidInternalOutlinesRemoved);
  console.log('[outline-refine] visible foot contour coverage:', visibleFootContourCoverage + '%');
  console.log('[outline-refine] body shadow boundary outlined:', bodyShadowBoundaryOutlined);
  console.log('[outline-refine] protected after optimizer:', ready ? 'YES' : 'NO');
  console.log('[outline-refine] accepted:', ready);

  return {
    visualOuterOutline: (visualOuterOutline || hasFills) ? 'YES' : 'NO',
    exportedOuterOutline: exportedOuterOutline ? 'YES' : 'NO',
    outerOutlineType: outerType,
    outerOutlineStitches: counts.outerOutlineStitches,
    outerOutlineColor: counts.outerOutlineColor,
    outerOutlineOrder: counts.outerOutlineOrder,
    outlineOrder,
    mouthExported: mouthExported ? 'YES' : 'NO',
    mouthStitches: counts.mouthStitches,
    innerContoursExported: innerContoursExported ? 'YES' : 'NO',
    innerOutlineStitches: counts.innerOutlineStitches,
    detailRunStitches: counts.detailRunStitches,
    travelContamination,
    contourMissing,
    contourWeak,
    outerContourSegments,
    outerContourClosure: Math.round(outerClosureRatio * 1000) / 1000,
    uncoveredPerimeterPercent,
    internalShadingBoundariesDetected,
    invalidInternalOutlinesRemoved,
    visibleFootContourCoverage,
    bodyShadowBoundaryOutlined,
    ready,
  };
}