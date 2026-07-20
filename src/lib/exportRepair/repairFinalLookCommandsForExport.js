/**
 * repairFinalLookCommandsForExport.js — ORQUESTRADOR v4 (transaccional, prioridad bloqueos)
 * ─────────────────────────────────────────────────────────────────────────────
 * Flujo: finalLookCommands → technicalRepair (transaccional) → validate → exportCommands
 *
 * REGLA PRINCIPAL (v4): eliminar un error BLOQUEANTE tiene prioridad sobre una
 * bajada moderada de ce01Score, siempre que CE01 no pase a INVALID. Una fase que
 * elimina bloqueos (visibleDiagonalStitches, emptyBlocks, invalidCommandSequence,
 * regionOutsideBounds) se acepta aunque ce01Score baje, si CE01 sigue RISKY.
 *
 * NO toca: detector universal, aprendizaje del corpus, Final Look visual,
 * encoders DST/DSB, CE01 loader, colores/regiones principales.
 *
 * Devuelve:
 *   { repairedCommands, repairAccepted, repairRejected, repairReport,
 *     exportAllowed, remainingBlockingIssues, comparison, phaseLog }
 */
import { detectExportErrors } from './exportErrorDetector';
import {
  removeEmptyBlocks, repairVisibleDiagonalStitches,
  removeDuplicateStitches, addTieInTieOff, reduceColorChangesIfSafe,
} from './preExportRepairer';
import { validateCE01 } from '@/lib/ce01Validator';
import { generateExportRepairReport } from './exportRepairReport';
import { detectVisibleDiagonalStitches, generateVisibleDiagonalForensicsReport } from './visibleDiagonalDetector';
import { polishRepairedCommands } from './exportPolish';
import { polishTravelAfterV5 } from './travelPolish';
import { generateEmptyBlockForensics } from './emptyBlockForensics';

// Recalibrado: 12000 era demasiado conservador; Wilcom funcional aceptado por CE01 muestra ~33845 puntadas.
const MAX_STITCHES = 35000;

// Fases que eliminan errores BLOQUEANTES — prioridad sobre ce01Score.
const BLOCKING_FIX_PHASES = new Set([
  'removeEmptyBlocks',
  'removeEmptyBlocksFinal',
  'repairVisibleDiagonalStitches',
]);

// ── Métricas críticas medidas sobre comandos reales ───────────────────────────
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

// ── Gate transaccional: endurece fallos graves, flexibiliza score si bloquea ──
// blockingFix=true → permite bajada moderada de ce01Score si se elimina un bloqueo
// y CE01 no pasa a INVALID.
function phaseGateAccepts(before, after, opts = {}) {
  const reasons = [];
  const blockingFix = !!opts.blockingFixPriority;

  // ── Fallos duros (siempre revierten) ──
  if (before.ce01Status !== 'INVALID' && after.ce01Status === 'INVALID') {
    reasons.push('CE01 pasó a INVALID');
  }
  if (after.emptyBlocks > before.emptyBlocks) {
    reasons.push(`emptyBlocks ${before.emptyBlocks}→${after.emptyBlocks}`);
  }
  if (after.invalidCommandSequence > before.invalidCommandSequence) {
    reasons.push(`invalidCmd ${before.invalidCommandSequence}→${after.invalidCommandSequence}`);
  }
  if (after.regionOutsideBounds > before.regionOutsideBounds) {
    reasons.push(`outOfBounds ${before.regionOutsideBounds}→${after.regionOutsideBounds}`);
  }
  if (after.duplicateStitches > before.duplicateStitches) {
    reasons.push(`dups ${before.duplicateStitches}→${after.duplicateStitches}`);
  }
  // longSt: para fases que eliminan bloqueos es métrica secundaria (soft) — no
  // revierte la eliminación de diagonales visibles solo porque longSt suba +2.
  if (!blockingFix && after.unsupportedLongStitches > before.unsupportedLongStitches) {
    reasons.push(`longSt ${before.unsupportedLongStitches}→${after.unsupportedLongStitches}`);
  }
  // visibleDiag: para fases no-bloqueantes (ej. addTieInTieOff), un aumento de
  // diagonales visibles revierte la fase. Evita que los ties recreen diagonales.
  if (!blockingFix && after.visibleDiagonalStitches > before.visibleDiagonalStitches) {
    reasons.push(`visibleDiag ${before.visibleDiagonalStitches}→${after.visibleDiagonalStitches}`);
  }
  if (after.stitchCountOverLimit > before.stitchCountOverLimit) {
    reasons.push(`stitchCountOverLimit ${before.stitchCountOverLimit}→${after.stitchCountOverLimit}`);
  }
  // shortStitches: aumento grave (>50) siempre revienta; pequeño permitido si blockingFix
  const shortDelta = after.shortStitches - before.shortStitches;
  if (shortDelta > 50) reasons.push(`shortSt +${shortDelta} (grave)`);

  // ── ce01Score: flexible para fases que eliminan bloqueos ──
  if (!blockingFix) {
    if (after.ce01Score < before.ce01Score - 0.5) {
      reasons.push(`ce01Score ${before.ce01Score}→${after.ce01Score}`);
    }
  } else {
    // permitir bajada hasta 15 puntos si CE01 no pasó a INVALID y se reduce un bloqueo
    const blockingReduced =
      after.visibleDiagonalStitches < before.visibleDiagonalStitches ||
      after.emptyBlocks < before.emptyBlocks ||
      after.invalidCommandSequence < before.invalidCommandSequence ||
      after.regionOutsideBounds < before.regionOutsideBounds;
    if (!blockingReduced && after.ce01Score < before.ce01Score - 0.5) {
      reasons.push(`ce01Score ${before.ce01Score}→${after.ce01Score} (sin reducción de bloqueos)`);
    } else if (after.ce01Score < before.ce01Score - 15) {
      reasons.push(`ce01Score caída excesiva ${before.ce01Score}→${after.ce01Score}`);
    }
  }
  return { accept: reasons.length === 0, reasons };
}

// ── Target de cada fase: debe mejorar si había algo que arreglar ───────────────
const PHASE_TARGETS = {
  removeEmptyBlocks: 'emptyBlocks',
  removeEmptyBlocksFinal: 'emptyBlocks',
  repairVisibleDiagonalStitches: 'visibleDiagonalStitches',
  removeDuplicateStitches: 'duplicateStitches',
  mergeShortStitches: 'shortStitches',
  addTieInTieOff: 'missingTie',
  // optimizeTrimsAndJumps y reduceColorChangesIfSafe: sin target obligatorio
};

function targetImproved(before, after, target) {
  if (target === 'missingTie') {
    const bT = before.missingTieIn + before.missingTieOff;
    const aT = after.missingTieIn + after.missingTieOff;
    if (bT === 0) return true; // nada que arreglar
    return aT < bT;
  }
  if (target === 'emptyBlocks') {
    if (before.emptyBlocks === 0) return true;
    return after.emptyBlocks < before.emptyBlocks;
  }
  if (before[target] === 0) return true; // nada que arreglar
  return after[target] < before[target];
}

// ── runRepairPhase: ejecuta una fase y decide aceptar/revertir ────────────────
function runRepairPhase({ name, commands, repairFn, seed, objects, regions, config, ms, phaseLog }) {
  const before = measureMetrics(commands, objects, regions, config, ms);
  let afterCommands;
  const stepReport = { ...(seed || {}) };
  try {
    afterCommands = repairFn(commands, objects, regions, stepReport);
  } catch (e) {
    phaseLog.push({ name, accepted: false, rejected: true, reason: `EXCEPTION: ${e.message}`, before, after: before, stepReport });
    return { commands, accepted: false };
  }
  const after = measureMetrics(afterCommands, objects, regions, config, ms);
  const blockingFix = BLOCKING_FIX_PHASES.has(name);
  const gate = phaseGateAccepts(before, after, { blockingFixPriority: blockingFix });
  const target = PHASE_TARGETS[name];
  const improved = target ? targetImproved(before, after, target) : true;
  const accept = gate.accept && improved;
  phaseLog.push({
    name,
    accepted: accept,
    rejected: !accept,
    blockingFixPriority: blockingFix,
    acceptedDespiteScoreDrop: blockingFix && accept && after.ce01Score < before.ce01Score - 0.5,
    acceptedDespiteLongStIncrease: blockingFix && accept && after.unsupportedLongStitches > before.unsupportedLongStitches,
    reason: !gate.accept ? gate.reasons.join('; ') : (!improved ? `target ${target} no mejoró (${before[target]}→${after[target]})` : ''),
    before, after, stepReport,
  });
  return { commands: accept ? afterCommands : commands, accepted: accept };
}

// ── Criterio global de aceptación (v5.1: mejora parcial permitida) ──────────
function globalRepairAccepted(sourceMetrics, finalMetrics) {
  // Aceptar repairedCommands si CE01 no es INVALID, sin regresión grave, y los
  // bloqueos totales no empeoraron respecto al source. Mejora parcial permitida:
  // si emptyBlocks baja 2→1 pero no llega a 0, repaired se mantiene como candidato
  // (commandSource='repaired') para depurar el último bloque; exportAllowed
  // sigue false mientras queden bloqueos.
  const ce01NotInvalid = finalMetrics.ce01Status !== 'INVALID';
  const noSevereRegression =
    finalMetrics.duplicateStitches <= sourceMetrics.duplicateStitches + 50 &&
    finalMetrics.shortStitches <= sourceMetrics.shortStitches + 100 &&
    finalMetrics.stitchCountOverLimit <= sourceMetrics.stitchCountOverLimit;
  const sourceBlocking =
    sourceMetrics.emptyBlocks + sourceMetrics.visibleDiagonalStitches +
    sourceMetrics.invalidCommandSequence + sourceMetrics.regionOutsideBounds;
  const finalBlocking =
    finalMetrics.emptyBlocks + finalMetrics.visibleDiagonalStitches +
    finalMetrics.invalidCommandSequence + finalMetrics.regionOutsideBounds;
  const blockingNotWorse = finalBlocking <= sourceBlocking;
  return ce01NotInvalid && noSevereRegression && blockingNotWorse;
}

/**
 * @param {object} ctx
 * @param {Array}  ctx.finalLookCommands
 * @param {Array}  ctx.objects
 * @param {Array}  ctx.regions
 * @param {object} ctx.config
 * @param {object} ctx.machineSettings
 * @param {object} ctx.darkStroke   (opcional, para soporte de contornos)
 */
export function repairFinalLookCommandsForExport({ finalLookCommands, objects = [], regions = [], config = {}, machineSettings = {}, darkStroke = null }) {
  const ms = { maxStitchLength: 12.1, maxJumpLength: 12.1, trimThreshold: 3.5, ...machineSettings };
  const source = (finalLookCommands || []).map(c => (c ? { ...c } : c));
  const sourceMetrics = measureMetrics(source, objects, regions, config, ms);

  const phaseLog = [];
  let cmds = source;

  // ── Pipeline v5.1 (orden: empty → diagonales → dups → colors → emptyFinal → ties) ──
  // addTieInTieOff va al FINAL, después de removeEmptyBlocksFinal, y solo se aplica
  // si no crea visibleDiag ni longSt nuevos (gate transaccional lo revierte si los crea).
  const darkSeed = { ...(darkStroke ? { darkStroke } : {}), config };
  const phases = [
    { name: 'removeEmptyBlocks', fn: removeEmptyBlocks, seed: {} },
    { name: 'repairVisibleDiagonalStitches', fn: repairVisibleDiagonalStitches, seed: darkSeed },
    { name: 'removeDuplicateStitches', fn: removeDuplicateStitches, seed: {} },
    { name: 'reduceColorChangesIfSafe', fn: reduceColorChangesIfSafe, seed: {} },
    { name: 'removeEmptyBlocksFinal', fn: removeEmptyBlocks, seed: {} },
    { name: 'addTieInTieOff', fn: addTieInTieOff, seed: {} },
  ];

  for (const p of phases) {
    const res = runRepairPhase({
      name: p.name, commands: cmds, repairFn: p.fn, seed: p.seed,
      objects, regions, config, ms, phaseLog,
    });
    cmds = res.commands;
  }

  const finalMetrics = measureMetrics(cmds, objects, regions, config, ms);

  // ── Criterio global: si no supera, revertir todo ──
  const repairAccepted = globalRepairAccepted(sourceMetrics, finalMetrics);
  let repairedCommands = cmds;
  let repairRejected = false;
  let rejectionReason = null;
  if (!repairAccepted) {
    repairedCommands = source;
    repairRejected = true;
    rejectionReason = buildRejectionReason(sourceMetrics, finalMetrics);
  }

  // ── Polish V1 (post-V5, solo warnings, transaccional) ──
  // Solo se ejecuta si V5 aceptó. Reversible: si rompe un invariante V5,
  // polishedCommands = repairedCommands (salida idéntica al checkpoint V5).
  // El pipeline V5 (phases) NO se modifica; el polish es una capa post-aceptación.
  let polishResult = null;
  if (repairAccepted) {
    polishResult = polishRepairedCommands({
      repairedCommands, objects, regions, config, machineSettings: ms, darkStroke,
    });
    if (polishResult.polishAccepted) repairedCommands = polishResult.polishedCommands;
  }

  // ── Travel Polish V1 (post-V5 + post-Polish, reduce jumps/trims, transaccional) ──
  // Se ejecuta SOLO sobre los repairedCommands (ya polished si Polish V1 aceptó).
  // Reversible: si rompe un invariante V5, no mejora jumps/trims, o cae score >3,
  // travelPolishedCommands = repairedCommands (idéntico al checkpoint V5).
  let travelPolishResult = null;
  if (repairAccepted) {
    travelPolishResult = polishTravelAfterV5(repairedCommands, objects, regions, config, ms);
    if (travelPolishResult.travelPolishAccepted) repairedCommands = travelPolishResult.travelPolishedCommands;
  }

  // ── returnedMetrics = métricas de los comandos QUE SE DEVUELVEN ──
  const exportDecisionSource = repairAccepted ? 'repaired' : 'source';
  const returnedMetrics = measureMetrics(repairedCommands, objects, regions, config, ms);

  // ── exportAllowed + remainingBlockingIssues sobre los comandos devueltos ──
  const finalDetect = detectExportErrors(repairedCommands, objects, regions, config, ms);
  const remainingBlockingIssues = finalDetect.errors.filter(e => e.severity === 'blocking' && e.count > 0);
  // RISKY permite exportación; solo INVALID bloquea
  const exportAllowed = finalDetect.ce01.status !== 'INVALID' && repairedCommands.length > 0 && remainingBlockingIssues.length === 0;

  // ── Forensics de diagonales visibles (sobre los comandos devueltos) ──
  const vdDetection = detectVisibleDiagonalStitches(repairedCommands, objects, regions, darkStroke, config);
  const vdForensics = generateVisibleDiagonalForensicsReport(vdDetection);

  // ── Forensics de bloques vacíos (sobre los comandos devueltos) ──
  // Si quedan emptyBlocks, detalla cada uno para depuración (sin [object Object]).
  const emptyBlockForensics = generateEmptyBlockForensics(repairedCommands, []);
  const exportBlockedBecauseRemainingEmptyBlocks =
    (repairAccepted && returnedMetrics.emptyBlocks > 0) ? returnedMetrics.emptyBlocks : null;

  // ── comparativa antes/después/retornadas (misma fuente: returnedMetrics) ──
  const comparison = {
    stitchCount: { before: sourceMetrics.stitchCount, after: returnedMetrics.stitchCount },
    jumpCount: { before: sourceMetrics.jumpCount, after: returnedMetrics.jumpCount },
    trimCount: { before: sourceMetrics.trimCount, after: returnedMetrics.trimCount },
    shortStitches: { before: sourceMetrics.shortStitches, after: returnedMetrics.shortStitches },
    duplicateStitches: { before: sourceMetrics.duplicateStitches, after: returnedMetrics.duplicateStitches },
    missingTieIn: { before: sourceMetrics.missingTieIn, after: returnedMetrics.missingTieIn },
    missingTieOff: { before: sourceMetrics.missingTieOff, after: returnedMetrics.missingTieOff },
    visibleDiagonalStitches: { before: sourceMetrics.visibleDiagonalStitches, after: returnedMetrics.visibleDiagonalStitches },
    unsupportedLongStitches: { before: sourceMetrics.unsupportedLongStitches, after: returnedMetrics.unsupportedLongStitches },
    emptyBlocks: { before: sourceMetrics.emptyBlocks, after: returnedMetrics.emptyBlocks },
    invalidCommandSequence: { before: sourceMetrics.invalidCommandSequence, after: returnedMetrics.invalidCommandSequence },
    regionOutsideBounds: { before: sourceMetrics.regionOutsideBounds, after: returnedMetrics.regionOutsideBounds },
    colorCount: { before: sourceMetrics.colorCount, after: returnedMetrics.colorCount },
    ce01Status: { before: sourceMetrics.ce01Status, after: returnedMetrics.ce01Status },
    ce01Score: { before: sourceMetrics.ce01Score, after: returnedMetrics.ce01Score },
    exportAllowed: { before: sourceMetrics.exportAllowed, after: exportAllowed },
  };

  const repairReport = {
    phaseLog,
    sourceMetrics,
    repairedMetrics: finalMetrics,
    returnedMetrics,
    exportDecisionSource,
    comparison,
    repairAccepted,
    repairRejected,
    rejectionReason,
    exportAllowed,
    remainingBlockingIssues,
    exportBlockedBecauseRepairRejected: repairRejected ? `REPAIR_REJECTED — ${rejectionReason}` : null,
    exportBlockedBecauseRemainingEmptyBlocks,
    emptyBlockForensics,
    visibleDiagForensics: vdForensics,
    visibleDiagDetection: vdDetection,
    polish: polishResult ? {
      polishAccepted: polishResult.polishAccepted,
      polishComparison: polishResult.polishComparison,
      polishPhaseLog: polishResult.polishPhaseLog,
      report: polishResult.polishReport.report,
    } : null,
    travelPolish: travelPolishResult ? {
      travelPolishAccepted: travelPolishResult.travelPolishAccepted,
      travelPolishComparison: travelPolishResult.travelPolishComparison,
      travelPolishPhaseLog: travelPolishResult.travelPolishPhaseLog,
      forensics: travelPolishResult.forensics,
      report: travelPolishResult.travelPolishReport.report,
    } : null,
    report: generateExportRepairReport({
      phaseLog, sourceMetrics, finalMetrics, returnedMetrics, exportDecisionSource,
      comparison, repairAccepted, repairRejected, rejectionReason, exportAllowed, remainingBlockingIssues,
      visibleDiagForensics: vdForensics, visibleDiagDetection: vdDetection,
      emptyBlockForensics, exportBlockedBecauseRemainingEmptyBlocks,
    }),
  };

  return {
    repairedCommands,
    repairAccepted,
    repairRejected,
    repairReport,
    exportAllowed,
    remainingBlockingIssues,
    comparison,
    phaseLog,
  };
}

function buildRejectionReason(sourceMetrics, finalMetrics) {
  const reasons = [];
  if (finalMetrics.ce01Status === 'INVALID') reasons.push('CE01 pasó a INVALID');
  if (finalMetrics.emptyBlocks > 0) reasons.push(`emptyBlocks=${finalMetrics.emptyBlocks} restantes`);
  if (finalMetrics.visibleDiagonalStitches > 0 && finalMetrics.visibleDiagonalStitches >= sourceMetrics.visibleDiagonalStitches) {
    reasons.push(`visibleDiag no redujo (${sourceMetrics.visibleDiagonalStitches}→${finalMetrics.visibleDiagonalStitches})`);
  }
  if (finalMetrics.duplicateStitches > sourceMetrics.duplicateStitches + 20) reasons.push(`dups regresión +${finalMetrics.duplicateStitches - sourceMetrics.duplicateStitches}`);
  if (finalMetrics.shortStitches > sourceMetrics.shortStitches + 50) reasons.push(`shortSt regresión +${finalMetrics.shortStitches - sourceMetrics.shortStitches}`);
  if (reasons.length === 0) reasons.push('criterios globales no satisfechos');
  return reasons.join('; ');
}