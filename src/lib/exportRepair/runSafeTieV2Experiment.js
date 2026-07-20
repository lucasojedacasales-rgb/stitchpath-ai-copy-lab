/**
 * runSafeTieV2Experiment.js — Runner experimental (post-V5.1, solo informe) — V4
 * ─────────────────────────────────────────────────────────────────────────────
 * Ejecuta safeAddTieInTieOffV2 sobre los repairedCommands V5.1 y mide todas las
 * invariantes. NO modifica el flujo V5.1. NO sustituye addTieInTieOff.
 *
 * V4 — Criterio corregido (NOT_NEEDED):
 *  - Antes de ejecutar safeAddTieInTieOffV2 se calcula missingTieByRealBlocks.
 *  - Si beforeRealMissing === 0 → NO se ejecuta safeAddTieInTieOffV2:
 *      experimentStatus = "NOT_NEEDED"
 *      experimentAccepted = false
 *      safeCommands = repairedCommands (idénticos)
 *      safeBlocksTied = 0, safeTieInAdded = 0, safeTieOffAdded = 0
 *      reason = "No missing tie by real blocks"
 *  - Si beforeRealMissing > 0 → se ejecuta y se acepta solo si baja y mantiene
 *    invariantes (experimentStatus = "ACCEPTED" | "REJECTED").
 *  - NOT_NEEDED no es error. REJECTED solo si había missingTie>0 y no mejoró.
 *
 * V3 (heredado): medición de missingTie doble (region vs bloques reales).
 *
 * Devuelve { experimentStatus, experimentAccepted, report, auditReport,
 *  safeCommands, beforeMetrics, afterMetrics, beforeRealBlocks, afterRealBlocks,
 *  safeReport, notNeeded }.
 */
import { detectExportErrors } from './exportErrorDetector';
import { safeAddTieInTieOffV2 } from './safeAddTieInTieOffV2';
import { detectMissingTieByRealBlocks } from './detectMissingTieByRealBlocks';
import { generateMissingTieDetectorAudit } from './missingTieDetectorAuditReport';

// Recalibrado: 12000 era demasiado conservador; Wilcom funcional aceptado por CE01 muestra ~33845 puntadas.
const MAX_STITCHES = 35000;

function measureMetrics(commands, objects, regions, config, ms) {
  const det = detectExportErrors(commands, objects, regions, config, ms);
  const c = det.counts;
  return {
    missingTieIn: c.noTieIn,
    missingTieOff: c.noTieOff,
    visibleDiagonalStitches: c.visibleDiag,
    emptyBlocks: c.emptyBlocks,
    invalidCommandSequence: det.errors.find(e => e.type === 'invalidCommandSequence')?.count || 0,
    regionOutsideBounds: det.errors.find(e => e.type === 'regionOutsideBounds')?.count || 0,
    unsupportedLongStitches: c.longSt,
    shortStitches: c.shortSt,
    duplicateStitches: c.dups,
    stitchCount: c.stitches,
    jumpCount: c.jumps,
    trimCount: c.trims,
    colorCount: c.totalColors,
    stitchCountOverLimit: Math.max(0, c.stitches - MAX_STITCHES),
    ce01Score: det.ce01.score,
    ce01Status: det.ce01.status,
    exportAllowed: det.ce01.status !== 'INVALID' && c.emptyBlocks === 0 &&
      (det.errors.find(e => e.type === 'invalidCommandSequence')?.count || 0) === 0 &&
      (det.errors.find(e => e.type === 'regionOutsideBounds')?.count || 0) === 0,
  };
}

// ── Report V4 vacío para el caso NOT_NEEDED (no se ejecutó V2) ─────────────────
function emptySafeReport(originalStitchCount) {
  return {
    safeBlocksTied: 0,
    safeBlocksSkipped: 0,
    safeTieInAdded: 0,
    safeTieOffAdded: 0,
    skippedBecauseTooSmall: 0,
    skippedBecauseZeroDirection: 0,
    skippedBecauseCreatesVisibleDiagonal: 0,
    skippedBecauseCreatesLongStitch: 0,
    skippedBecauseRegionMismatch: 0,
    skippedBecauseImportantDetail: 0,
    originalStitchCount,
    outputStitchCount: originalStitchCount,
    fatalPreservationError: false,
    preservationErrorReason: null,
  };
}

export function runSafeTieV2Experiment(repairedCommands, objects = [], regions = [], config = {}, machineSettings = {}, darkStroke = null) {
  const ms = { maxStitchLength: 12.1, maxJumpLength: 12.1, trimThreshold: 3.5, ...machineSettings };
  const src = repairedCommands || [];
  const beforeMetrics = measureMetrics(src, objects, regions, config, ms);
  const beforeRealBlocks = detectMissingTieByRealBlocks(src);
  const beforeRealMissing = beforeRealBlocks.missingTieIn + beforeRealBlocks.missingTieOff;
  const beforeRegionMissing = beforeMetrics.missingTieIn + beforeMetrics.missingTieOff;
  const commandCountBefore = src.length;

  // ── SHORT-CIRCUIT V4: si no hay missing tie por bloques reales, no ejecutar V2 ──
  if (beforeRealMissing === 0) {
    const safeCommands = src.slice();
    const afterMetrics = beforeMetrics; // idéntico — no se tocó nada
    const afterRealBlocks = beforeRealBlocks;
    const safeReport = emptySafeReport(beforeMetrics.stitchCount);
    const commandCountAfter = safeCommands.length;

    const experimentStatus = 'NOT_NEEDED';
    const experimentAccepted = false;
    const reasons = ['No missing tie by real blocks'];
    const notNeeded = true;

    const auditReport = generateMissingTieDetectorAudit({
      beforeMetrics, afterMetrics: beforeMetrics,
      beforeRealBlocks, afterRealBlocks: beforeRealBlocks,
      safeReport,
      beforeRegionMissing, afterRegionMissing: beforeRegionMissing,
      beforeRealMissing, afterRealMissing: 0,
    });

    const report = generateReport({
      beforeMetrics, afterMetrics: beforeMetrics, safeReport,
      experimentStatus, experimentAccepted, reasons,
      commandCountBefore, commandCountAfter,
      beforeRealBlocks, afterRealBlocks: beforeRealBlocks,
      beforeRegionMissing, afterRegionMissing: beforeRegionMissing,
      beforeRealMissing, afterRealMissing: 0,
      tieReducedByRegion: false, tieReducedByRealBlocks: false,
      notNeeded,
    });

    return {
      experimentStatus,
      experimentAccepted,
      notNeeded,
      report,
      auditReport,
      safeCommands,
      beforeMetrics,
      afterMetrics,
      beforeRealBlocks,
      afterRealBlocks,
      safeReport,
    };
  }

  // ── Hay missing tie por bloques reales → ejecutar Safe Tie V2 ──
  const tieReport = {};
  const { commands: safeCommands, report: safeReport } = safeAddTieInTieOffV2(
    src, objects, regions, config, darkStroke, tieReport
  );

  const afterMetrics = measureMetrics(safeCommands, objects, regions, config, ms);
  const afterRealBlocks = detectMissingTieByRealBlocks(safeCommands);
  const commandCountAfter = safeCommands.length;

  // ── invariantes ──
  const visibleDiagStillZero = afterMetrics.visibleDiagonalStitches === 0;
  const emptyBlocksStillZero = afterMetrics.emptyBlocks === 0;
  const longStNotWorse = afterMetrics.unsupportedLongStitches <= beforeMetrics.unsupportedLongStitches;
  const ce01NotInvalid = afterMetrics.ce01Status !== 'INVALID';
  const exportAllowedStill = afterMetrics.exportAllowed === true;
  const invalidCmdStillZero = afterMetrics.invalidCommandSequence === 0;
  const outOfBoundsStillZero = afterMetrics.regionOutsideBounds === 0;
  const noStitchesLost = (safeReport?.outputStitchCount ?? afterMetrics.stitchCount) >= (safeReport?.originalStitchCount ?? beforeMetrics.stitchCount);

  // ── medición de missingTie (NUEVA: por bloques reales) ──
  const afterRealMissing = afterRealBlocks.missingTieIn + afterRealBlocks.missingTieOff;
  const tieReducedByRealBlocks = afterRealMissing < beforeRealMissing;
  // medición antigua (solo informativa)
  const afterRegionMissing = afterMetrics.missingTieIn + afterMetrics.missingTieOff;
  const tieReducedByRegion = afterRegionMissing < beforeRegionMissing;

  const reasons = [];
  if (!tieReducedByRealBlocks) reasons.push(`missingTieByRealBlocks no bajó (${beforeRealMissing}→${afterRealMissing})`);
  if (!visibleDiagStillZero) reasons.push(`visibleDiagonalStitches=${afterMetrics.visibleDiagonalStitches} (>0)`);
  if (!emptyBlocksStillZero) reasons.push(`emptyBlocks=${afterMetrics.emptyBlocks} (>0)`);
  if (!longStNotWorse) reasons.push(`unsupportedLongStitches subió ${beforeMetrics.unsupportedLongStitches}→${afterMetrics.unsupportedLongStitches}`);
  if (!ce01NotInvalid) reasons.push('CE01 pasó a INVALID');
  if (!exportAllowedStill) reasons.push('exportAllowed=false');
  if (!invalidCmdStillZero) reasons.push(`invalidCommandSequence=${afterMetrics.invalidCommandSequence} (>0)`);
  if (!outOfBoundsStillZero) reasons.push(`regionOutsideBounds=${afterMetrics.regionOutsideBounds} (>0)`);
  if (!noStitchesLost) reasons.push('stitchCount bajó (preservación rota)');

  let experimentAccepted = reasons.length === 0;

  if (safeReport?.fatalPreservationError && !reasons.includes('fatalPreservationError: ' + safeReport.preservationErrorReason)) {
    reasons.push('fatalPreservationError: ' + (safeReport.preservationErrorReason || 'stitchCountDropped'));
    experimentAccepted = false;
  }

  const experimentStatus = experimentAccepted ? 'ACCEPTED' : 'REJECTED';
  const notNeeded = false;

  const auditReport = generateMissingTieDetectorAudit({
    beforeMetrics, afterMetrics,
    beforeRealBlocks, afterRealBlocks,
    safeReport,
    beforeRegionMissing, afterRegionMissing,
    beforeRealMissing, afterRealMissing,
  });

  const report = generateReport({
    beforeMetrics, afterMetrics, safeReport, experimentStatus, experimentAccepted, reasons,
    commandCountBefore, commandCountAfter,
    beforeRealBlocks, afterRealBlocks,
    beforeRegionMissing, afterRegionMissing,
    beforeRealMissing, afterRealMissing,
    tieReducedByRegion, tieReducedByRealBlocks,
    notNeeded,
  });

  return {
    experimentStatus,
    experimentAccepted,
    notNeeded,
    report,
    auditReport,
    safeCommands,
    beforeMetrics,
    afterMetrics,
    beforeRealBlocks,
    afterRealBlocks,
    safeReport,
  };
}

function generateReport(ctx) {
  const {
    beforeMetrics, afterMetrics, safeReport, experimentStatus, experimentAccepted, reasons,
    commandCountBefore, commandCountAfter,
    beforeRealBlocks, afterRealBlocks,
    beforeRegionMissing, afterRegionMissing,
    beforeRealMissing, afterRealMissing,
    tieReducedByRegion, tieReducedByRealBlocks,
    notNeeded,
  } = ctx;
  const md = [];
  md.push('# SAFE_TIE_V2_EXPERIMENT_REPORT_V4 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> V4 — Criterio corregido: NOT_NEEDED cuando missingTieByRealBlocks before = 0.');
  md.push('> Modo experimental. NO modifica el flujo V5.1. NO sustituye addTieInTieOff.');
  if (notNeeded) {
    md.push('> safeAddTieInTieOffV2 **NO se ejecutó** (no había missing tie por bloques reales).\n');
  } else {
    md.push('> safeAddTieInTieOffV2 se ejecuta sobre los repairedCommands V5.1 solo para informe.\n');
  }

  md.push('## Veredicto\n');
  md.push(`- **experimentStatus: ${experimentStatus}**`);
  md.push(`- **experimentAccepted: ${experimentAccepted ? 'SÍ' : 'NO'}**`);
  if (!experimentAccepted) {
    md.push(`- razones: ${reasons.join('; ')}`);
  }
  md.push('');
  md.push('### Semántica del estado\n');
  md.push('- `NOT_NEEDED`: beforeRealMissing = 0 → no se ejecuta V2. No es error.');
  md.push('- `ACCEPTED`: beforeRealMissing > 0 y V2 bajó missingTie sin romper invariantes.');
  md.push('- `REJECTED`: beforeRealMissing > 0 y V2 no pudo mejorar sin romper invariantes.');
  md.push('');

  md.push('## missingTie — doble medición\n');
  md.push('| Medición | Before | After | Δ | bajó |');
  md.push('|---|---|---|---|---|');
  md.push(`| missingTieByRegion (antigua, ×regionId) | ${beforeRegionMissing} | ${afterRegionMissing} | ${afterRegionMissing - beforeRegionMissing} | ${tieReducedByRegion ? '✅' : '❌'} |`);
  md.push(`| missingTieByRealBlocks (nueva, ×bloques) | ${beforeRealMissing} | ${afterRealMissing} | ${afterRealMissing - beforeRealMissing} | ${tieReducedByRealBlocks ? '✅' : '❌'} |`);
  md.push('');
  md.push('> Nota: la medición antigua agrupa por regionId global; si una región aparece en varios');
  md.push('> bloques del fichero, solo cuenta un bloque. Por eso no reconoce los ties añadidos.');
  md.push('> La medición nueva cuenta bloques consecutivos reales y sí los reconoce.');
  md.push('');

  if (notNeeded) {
    md.push('## NOT_NEEDED — Safe Tie V2 no ejecutado\n');
    md.push(`- missingTieByRealBlocks (before) = **0** → no hay nada que atar.`);
    md.push(`- safeAddTieInTieOffV2: **NO invocado**.`);
    md.push(`- safeCommands = repairedCommands V5.1 (idénticos, sin cambios).`);
    md.push('');
    md.push('## Confirmación de no-modificación\n');
    md.push('| Métrica | Valor |');
    md.push('|---|---|');
    md.push(`| commandCount | ${commandCountBefore} (unchanged) |`);
    md.push(`| stitchCount | ${beforeMetrics.stitchCount} (unchanged) |`);
    md.push(`| exportAllowed | ${beforeMetrics.exportAllowed} |`);
    md.push(`| visibleDiagonalStitches | ${beforeMetrics.visibleDiagonalStitches} |`);
    md.push(`| emptyBlocks | ${beforeMetrics.emptyBlocks} |`);
    md.push(`| missingTieByRealBlocks (before=after) | ${beforeRealMissing} |`);
    md.push('');
    md.push('---');
    md.push('_V4 — NOT_NEEDED. No se ejecutó Safe Tie V2. Flujo V5.1 estable intacto._');
    return md.join('\n');
  }

  md.push('## Detalle bloques reales (before / after)\n');
  md.push('| Métrica | Before | After |');
  md.push('|---|---|---|');
  md.push(`| realBlockCount (≥4 stitches) | ${beforeRealBlocks.realBlockCount} | ${afterRealBlocks.realBlockCount} |`);
  md.push(`| protectedBlockCount (detalle) | ${beforeRealBlocks.protectedBlockCount} | ${afterRealBlocks.protectedBlockCount} |`);
  md.push(`| evaluatedBlockCount | ${beforeRealBlocks.evaluatedBlockCount} | ${afterRealBlocks.evaluatedBlockCount} |`);
  md.push(`| blocksWithTieIn | ${beforeRealBlocks.blocksWithTieIn} | ${afterRealBlocks.blocksWithTieIn} |`);
  md.push(`| blocksWithTieOff | ${beforeRealBlocks.blocksWithTieOff} | ${afterRealBlocks.blocksWithTieOff} |`);
  md.push(`| missingTieIn (real) | ${beforeRealBlocks.missingTieIn} | ${afterRealBlocks.missingTieIn} |`);
  md.push(`| missingTieOff (real) | ${beforeRealBlocks.missingTieOff} | ${afterRealBlocks.missingTieOff} |`);
  md.push('');

  md.push('## Métricas before / after\n');
  md.push('| Métrica | Before (V5.1 repaired) | After (V2 safe tie) | Δ |');
  md.push('|---|---|---|---|');
  const row = (label, key, fmt = 'n') => {
    const b = beforeMetrics[key], a = afterMetrics[key];
    const f = (v) => fmt === 'str' ? String(v) : (Number.isInteger(v) ? String(v) : (v?.toFixed?.(2) ?? '—'));
    const delta = (typeof b === 'number' && typeof a === 'number') ? a - b : 0;
    const ds = delta > 0 ? `+${delta}` : `${delta}`;
    md.push(`| ${label} | ${f(b)} | ${f(a)} | ${fmt === 'str' ? '—' : ds} |`);
  };
  row('missingTieIn (region, antigua)', 'missingTieIn');
  row('missingTieOff (region, antigua)', 'missingTieOff');
  row('visibleDiagonalStitches', 'visibleDiagonalStitches');
  row('unsupportedLongStitches', 'unsupportedLongStitches');
  row('emptyBlocks', 'emptyBlocks');
  row('invalidCommandSequence', 'invalidCommandSequence');
  row('regionOutsideBounds', 'regionOutsideBounds');
  row('shortStitches', 'shortStitches');
  row('duplicateStitches', 'duplicateStitches');
  row('stitchCount', 'stitchCount');
  row('jumpCount', 'jumpCount');
  row('trimCount', 'trimCount');
  row('colorCount', 'colorCount');
  row('ce01Score', 'ce01Score');
  row('ce01Status', 'ce01Status', 'str');
  row('exportAllowed', 'exportAllowed', 'str');
  md.push('');
  md.push('## Conteo de comandos / preservación\n');
  md.push('| Métrica | Before | After |');
  md.push('|---|---|---|');
  md.push(`| commandCount | ${commandCountBefore} | ${commandCountAfter} |`);
  md.push(`| stitchCount (preservación) | ${safeReport?.originalStitchCount ?? '—'} | ${safeReport?.outputStitchCount ?? '—'} |`);
  md.push(`| fatalPreservationError | ${safeReport?.fatalPreservationError ? 'SÍ' : 'NO'} | — |`);
  if (safeReport?.fatalPreservationError) md.push(`| preservationErrorReason | ${safeReport.preservationErrorReason} | — |`);
  md.push('');

  md.push('## Bloques tied / skipped\n');
  md.push(`- safeBlocksTied: **${safeReport.safeBlocksTied || 0}**`);
  md.push(`- safeBlocksSkipped: **${safeReport.safeBlocksSkipped || 0}**`);
  md.push(`- safeTieInAdded: **${safeReport.safeTieInAdded || 0}**`);
  md.push(`- safeTieOffAdded: **${safeReport.safeTieOffAdded || 0}**`);
  md.push('');

  md.push('## Razones de skipped\n');
  md.push('| razón | count |');
  md.push('|---|---|');
  md.push(`| tooSmall | ${safeReport.skippedBecauseTooSmall || 0} |`);
  md.push(`| zeroDirection / tieTooFar | ${safeReport.skippedBecauseZeroDirection || 0} |`);
  md.push(`| createsVisibleDiagonal | ${safeReport.skippedBecauseCreatesVisibleDiagonal || 0} |`);
  md.push(`| createsLongStitch | ${safeReport.skippedBecauseCreatesLongStitch || 0} |`);
  md.push(`| regionMismatch | ${safeReport.skippedBecauseRegionMismatch || 0} |`);
  md.push(`| importantDetail | ${safeReport.skippedBecauseImportantDetail || 0} |`);
  md.push('');

  md.push('## Criterio de éxito experimental\n');
  md.push(`| criterio | resultado |`);
  md.push(`|---|---|`);
  md.push(`| NO perder stitches | ${noStitchesLostFlag(safeReport) ? '✅' : '❌'} (${safeReport?.originalStitchCount}→${safeReport?.outputStitchCount}) |`);
  md.push(`| emptyBlocks === 0 | ${afterMetrics.emptyBlocks === 0 ? '✅' : '❌'} (${afterMetrics.emptyBlocks}) |`);
  md.push(`| visibleDiagonalStitches === 0 | ${afterMetrics.visibleDiagonalStitches === 0 ? '✅' : '❌'} (${afterMetrics.visibleDiagonalStitches}) |`);
  md.push(`| unsupportedLongStitches no sube | ${afterMetrics.unsupportedLongStitches <= beforeMetrics.unsupportedLongStitches ? '✅' : '❌'} (${beforeMetrics.unsupportedLongStitches}→${afterMetrics.unsupportedLongStitches}) |`);
  md.push(`| exportAllowed true | ${afterMetrics.exportAllowed === true ? '✅' : '❌'} (${afterMetrics.exportAllowed}) |`);
  md.push(`| missingTieByRealBlocks baja si safeBlocksTied>0 | ${realBlocksTieCriterion(safeReport, beforeRealMissing, afterRealMissing) ? '✅' : '❌'} (${beforeRealMissing}→${afterRealMissing}) |`);
  md.push('');

  md.push('## Decisión\n');
  if (experimentAccepted) {
    md.push('**experimentStatus = ACCEPTED**. safeAddTieInTieOffV2 reduce missingTieByRealBlocks sin romper invariantes.');
    md.push('Puede considerarse para sustituir addTieInTieOff en una próxima iteración (previa validación en más diseños).');
    md.push('El flujo V5.1 **no se modifica**; safeCommands queda disponible como candidato pero export sigue usando repairedCommands V5.1.');
  } else {
    md.push('**experimentStatus = REJECTED**. No se toca V5.1 ni se sustituye addTieInTieOff.');
    md.push(`Razones: ${reasons.join('; ')}.`);
    md.push('Revisar los bloques skipped y las regresiones antes de reintentar.');
  }
  md.push('');

  md.push('---');
  md.push('_V4 — criterio corregido (NOT_NEEDED/ACCEPTED/REJECTED). Modo experimental. No modifica el flujo V5.1 estable._');
  return md.join('\n');
}

function noStitchesLostFlag(safeReport) {
  if (!safeReport) return false;
  const o = safeReport.originalStitchCount, a = safeReport.outputStitchCount;
  return typeof o === 'number' && typeof a === 'number' && a >= o;
}

function realBlocksTieCriterion(safeReport, beforeRealMissing, afterRealMissing) {
  if ((safeReport?.safeBlocksTied || 0) > 0) return afterRealMissing < beforeRealMissing;
  return true; // sin bloques atados, no se exige reducción
}