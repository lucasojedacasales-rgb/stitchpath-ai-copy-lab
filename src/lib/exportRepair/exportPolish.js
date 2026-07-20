/**
 * exportPolish.js — Polish V1 (post-V5, solo warnings, transaccional)
 * ─────────────────────────────────────────────────────────────────────────────
 * Se ejecuta SOLO después de que el pipeline V5 acepta `repairedCommands`.
 * Objetivo: reducir warnings (shortStitches, duplicateStitches, missingTieIn/Off)
 * e intentar llevar CE01 de RISKY a SAFE — SIN romper los invariantes V5.
 *
 * INVARIANTES V5 (si cualquiera se rompe, se revierte el polish completo):
 *   - visibleDiagonalStitches === 0
 *   - emptyBlocks === 0
 *   - invalidCommandSequence === 0
 *   - regionOutsideBounds === 0
 *   - ce01Status !== 'INVALID'
 *   - exportAllowed === true
 *
 * NO toca: encoder DST/DSB, detector universal, repairVisibleDiagonalStitches,
 * pipeline V5, Final Look visual, colores principales.
 *
 * Fases polish (cada una transaccional; revertida si empeora su target o rompe
 * invariantes):
 *   1. polishMergeShortStitches   — reduce shortStitches (protege isTie)
 *   2. removeDuplicateStitches    — reduce duplicateStitches residuales
 *   3. addTieInTieOffSmallBlocks   — añade ties a bloques 4-7 sin tie (spacing 1.0mm)
 */
import { detectExportErrors } from './exportErrorDetector';
import { validateCE01 } from '@/lib/ce01Validator';
import { removeDuplicateStitches } from './preExportRepairer';
import { generatePolishReport } from './exportPolishReport';

// Recalibrado: 12000 era demasiado conservador; Wilcom funcional aceptado por CE01 muestra ~33845 puntadas.
const MAX_STITCHES = 35000;
const SHORT_MERGE_MM = 0.6;
const TIE_SPACING_MM = 1.0;   // >= 0.8 (no shortStitch) y < 1.5 (tie detectado por CE01)
const MIN_TIE_BLOCK = 4;      // bloques de 4-7 stitches sin tie
const MAX_TIE_BLOCK = 7;

// ── Métricas (misma fuente que el orquestador V5) ─────────────────────────────
function measureMetrics(commands, objects, regions, config, ms) {
  const det = detectExportErrors(commands, objects, regions, config, ms);
  const c = det.counts;
  return {
    emptyBlocks: c.emptyBlocks,
    visibleDiagonalStitches: c.visibleDiag,
    invalidCommandSequence: det.errors.find(e => e.type === 'invalidCommandSequence')?.count || 0,
    regionOutsideBounds: det.errors.find(e => e.type === 'regionOutsideBounds')?.count || 0,
    shortStitches: c.shortSt,
    duplicateStitches: c.dups,
    unsupportedLongStitches: c.longSt,
    missingTieIn: c.noTieIn,
    missingTieOff: c.noTieOff,
    stitchCount: c.stitches,
    jumpCount: c.jumps,
    trimCount: c.trims,
    colorCount: c.totalColors,
    stitchCountOverLimit: Math.max(0, c.stitches - MAX_STITCHES),
    ce01Score: det.ce01.score,
    ce01Status: det.ce01.status,
    exportAllowed: det.ce01.status !== 'INVALID',
  };
}

// ── Invariantes V5: si cualquiera falla, revertir ────────────────────────────
function invariantsHold(m, base) {
  if (m.visibleDiagonalStitches !== 0) return false;
  if (m.emptyBlocks !== 0) return false;
  if (m.invalidCommandSequence !== 0) return false;
  if (m.regionOutsideBounds !== 0) return false;
  if (m.ce01Status === 'INVALID') return false;
  if (!m.exportAllowed) return false;
  // sin regresión grave
  if (m.duplicateStitches > base.duplicateStitches + 50) return false;
  if (m.shortStitches > base.shortStitches + 100) return false;
  if (m.stitchCountOverLimit > base.stitchCountOverLimit) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Fase 1 — polishMergeShortStitches (protege isTie y detalles/contornos)
// ═══════════════════════════════════════════════════════════════════════════
function isImportantDetail(cmd) {
  if (!cmd) return false;
  if (cmd.isTie) return true; // proteger ties V5 y polish
  const lt = String(cmd.layerType || '').toLowerCase();
  const rc = String(cmd.region_class || '').toLowerCase();
  return lt.includes('mouth') || lt.includes('eye') || lt.includes('facial') ||
    lt.includes('detail') || lt.includes('outline') || lt.includes('contour') ||
    rc.includes('detail') || rc.includes('mouth') || rc.includes('eye');
}
function lastStitch(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].type === 'stitch') return arr[i];
  return null;
}
function nextStitch(commands, from) {
  for (let i = from; i < commands.length; i++) if (commands[i].type === 'stitch') return commands[i];
  return null;
}
function polishMergeShortStitches(commands, _objects, _regions, report = {}) {
  const out = [];
  let merged = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') { out.push(c); continue; }
    const prev = lastStitch(out);
    const next = nextStitch(commands, i + 1);
    if (!prev || !next) { out.push(c); continue; }
    const dPrev = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
    if (dPrev >= SHORT_MERGE_MM) { out.push(c); continue; }
    if (isImportantDetail(c) || isImportantDetail(prev) || isImportantDetail(next)) { out.push(c); continue; }
    const v1 = { x: c.x - prev.x, y: c.y - prev.y };
    const v2 = { x: next.x - c.x, y: next.y - c.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-9 || l2 < 1e-9) { merged++; continue; }
    const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (ang > 30) { out.push(c); continue; } // esquina → conservar
    merged++; // colineal y corto → fusionar (drop c)
  }
  report.mergedShortStitches = merged;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Fase 3 — addTieInTieOffSmallBlocks (bloques 4-7 sin tie, spacing 1.0mm)
// ═══════════════════════════════════════════════════════════════════════════
// spacing 1.0mm: >= 0.8 (no cuenta como shortStitch en CE01) y < 1.5 (detectado
// como tie-in/off por las primeras/últimas 2 distancias intra-región).
function addTieInTieOffSmallBlocks(commands, _objects, _regions, report = {}) {
  const out = [];
  let tieInAdded = 0, tieOffAdded = 0, blocksTied = 0, blocksSkipped = 0;
  let block = [];

  const flush = () => {
    if (block.length === 0) return;
    if (block.length < MIN_TIE_BLOCK || block.length > MAX_TIE_BLOCK) {
      out.push(...block);
      blocksSkipped++;
      block = [];
      return;
    }
    const first = block[0];
    const last = block[block.length - 1];
    // ya atado por V5 → no doble-tie
    if (first.hasTieIn || first.isTie || last.hasTieOff || last.isTie) {
      out.push(...block);
      blocksSkipped++;
      block = [];
      return;
    }
    // dirección de cosido del bloque (first→second)
    let dx = 1, dy = 0;
    if (block.length >= 2) {
      const s = block[1];
      const dd = Math.hypot((s.x ?? 0) - (first.x ?? 0), (s.y ?? 0) - (first.y ?? 0));
      if (dd >= 0.3) { dx = ((s.x ?? 0) - (first.x ?? 0)) / dd; dy = ((s.y ?? 0) - (first.y ?? 0)) / dd; }
    }
    // tie-in: 2 stitches a 2.0mm y 1.0mm antes de first, spacing 1.0mm
    out.push({ type: 'stitch', x: (first.x ?? 0) - dx * 2.0, y: (first.y ?? 0) - dy * 2.0,
      color: first.color, layerType: first.layerType, regionId: first.regionId, stitchType: first.stitchType, isTie: true, tieKind: 'tieIn' });
    out.push({ type: 'stitch', x: (first.x ?? 0) - dx * 1.0, y: (first.y ?? 0) - dy * 1.0,
      color: first.color, layerType: first.layerType, regionId: first.regionId, stitchType: first.stitchType, isTie: true, tieKind: 'tieIn' });
    first.hasTieIn = true;
    out.push(...block);
    // tie-off: 2 stitches a 1.0mm y 2.0mm después de last, spacing 1.0mm
    out.push({ type: 'stitch', x: (last.x ?? 0) + dx * 1.0, y: (last.y ?? 0) + dy * 1.0,
      color: last.color, layerType: last.layerType, regionId: last.regionId, stitchType: last.stitchType, isTie: true, tieKind: 'tieOff' });
    out.push({ type: 'stitch', x: (last.x ?? 0) + dx * 2.0, y: (last.y ?? 0) + dy * 2.0,
      color: last.color, layerType: last.layerType, regionId: last.regionId, stitchType: last.stitchType, isTie: true, tieKind: 'tieOff' });
    last.hasTieOff = true;
    tieInAdded += 2; tieOffAdded += 2; blocksTied++;
    block = [];
  };

  for (const c of commands) {
    if (c.type !== 'stitch') { flush(); out.push(c); continue; }
    block.push(c);
  }
  flush();
  report.tieInAdded = tieInAdded;
  report.tieOffAdded = tieOffAdded;
  report.smallBlocksTied = blocksTied;
  report.smallBlocksSkipped = blocksSkipped;
  return out;
}

// ── Ejecutar una fase polish con gate transaccional ──────────────────────────
function runPolishPhase({ name, commands, fn, seed, objects, regions, config, ms, base, target, phaseLog }) {
  const before = measureMetrics(commands, objects, regions, config, ms);
  let afterCommands;
  const stepReport = { ...(seed || {}) };
  try {
    afterCommands = fn(commands, objects, regions, stepReport);
  } catch (e) {
    phaseLog.push({ name, accepted: false, reason: `EXCEPTION: ${e.message}`, before, after: before, stepReport });
    return { commands, accepted: false };
  }
  const after = measureMetrics(afterCommands, objects, regions, config, ms);
  const improved = target === 'missingTie'
    ? (before.missingTieIn + before.missingTieOff === 0 ? true : (after.missingTieIn + after.missingTieOff) < (before.missingTieIn + before.missingTieOff))
    : (before[target] === 0 ? true : after[target] < before[target]);
  const invariantOK = invariantsHold(after, base);
  const accept = improved && invariantOK;
  phaseLog.push({
    name, accepted: accept,
    reason: !invariantOK ? 'invariante V5 rota — revertida'
      : (!improved ? `target ${target} no mejoró (${before[target]}→${after[target]})` : ''),
    before, after, stepReport,
  });
  return { commands: accept ? afterCommands : commands, accepted: accept };
}

/**
 * @param {object} ctx
 * @param {Array}  ctx.repairedCommands  — salida del pipeline V5 aceptado
 * @param {Array}  ctx.objects
 * @param {Array}  ctx.regions
 * @param {object} ctx.config
 * @param {object} ctx.machineSettings
 * @param {object} ctx.darkStroke (opcional)
 * @returns {{ polishedCommands, polishAccepted, polishReport, polishPhaseLog, polishComparison }}
 */
export function polishRepairedCommands({ repairedCommands, objects = [], regions = [], config = {}, machineSettings = {}, darkStroke = null }) {
  const ms = { maxStitchLength: 12.1, maxJumpLength: 12.1, trimThreshold: 3.5, ...machineSettings };
  const base = (repairedCommands || []).map(c => (c ? { ...c } : c));
  const baseMetrics = measureMetrics(base, objects, regions, config, ms);

  const phaseLog = [];
  let cmds = base;

  const phases = [
    { name: 'polishMergeShortStitches', fn: polishMergeShortStitches, seed: {}, target: 'shortStitches' },
    { name: 'polishRemoveDuplicateStitches', fn: removeDuplicateStitches, seed: {}, target: 'duplicateStitches' },
    { name: 'polishAddTieInTieOffSmallBlocks', fn: addTieInTieOffSmallBlocks, seed: {}, target: 'missingTie' },
  ];

  for (const p of phases) {
    const res = runPolishPhase({
      name: p.name, commands: cmds, fn: p.fn, seed: p.seed,
      objects, regions, config, ms, base: baseMetrics, target: p.target, phaseLog,
    });
    cmds = res.commands;
  }

  const polishedMetrics = measureMetrics(cmds, objects, regions, config, ms);
  // Gate global: el polish solo se acepta si TODOS los invariantes V5 se mantienen.
  const polishAccepted = invariantsHold(polishedMetrics, baseMetrics);
  const polishedCommands = polishAccepted ? cmds : base;
  const returnedMetrics = measureMetrics(polishedCommands, objects, regions, config, ms);

  const polishComparison = {
    shortStitches: { before: baseMetrics.shortStitches, after: returnedMetrics.shortStitches },
    duplicateStitches: { before: baseMetrics.duplicateStitches, after: returnedMetrics.duplicateStitches },
    missingTieIn: { before: baseMetrics.missingTieIn, after: returnedMetrics.missingTieIn },
    missingTieOff: { before: baseMetrics.missingTieOff, after: returnedMetrics.missingTieOff },
    unsupportedLongStitches: { before: baseMetrics.unsupportedLongStitches, after: returnedMetrics.unsupportedLongStitches },
    stitchCount: { before: baseMetrics.stitchCount, after: returnedMetrics.stitchCount },
    jumpCount: { before: baseMetrics.jumpCount, after: returnedMetrics.jumpCount },
    trimCount: { before: baseMetrics.trimCount, after: returnedMetrics.trimCount },
    visibleDiagonalStitches: { before: baseMetrics.visibleDiagonalStitches, after: returnedMetrics.visibleDiagonalStitches },
    emptyBlocks: { before: baseMetrics.emptyBlocks, after: returnedMetrics.emptyBlocks },
    ce01Score: { before: baseMetrics.ce01Score, after: returnedMetrics.ce01Score },
    ce01Status: { before: baseMetrics.ce01Status, after: returnedMetrics.ce01Status },
    exportAllowed: { before: baseMetrics.exportAllowed, after: returnedMetrics.exportAllowed },
  };

  const report = generatePolishReport({
    phaseLog, baseMetrics, polishedMetrics, returnedMetrics,
    polishAccepted, polishComparison,
  });

  return {
    polishedCommands,
    polishAccepted,
    polishReport: { phaseLog, baseMetrics, polishedMetrics, returnedMetrics, polishComparison, polishAccepted, report },
    polishPhaseLog: phaseLog,
    polishComparison,
  };
}