/**
 * CE01 Production Export — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Protects the clean finalEmbroideryCommands as a production-grade command set.
 *
 * When config.ce01ProductionMode === true, export uses ONLY:
 *   finalEmbroideryCommands
 *     → ce01FinalCommandRepair  (only if metrics improve)
 *     → ce01CommandSanitizer    (only if metrics don't worsen)
 *     → validateCE01
 *     → encode (backend)
 *
 * Does NOT run:
 *   - stabilityOptimizer (aggressive)
 *   - adaptiveOptimizationEngine
 *   - region regeneration
 *   - automatic geometry simplification
 *   - any mutation of regions / vectorRegions / enrichedRegions
 *
 * Transactional guard: if repair or sanitizer worsens any key metric,
 * the change is discarded and the previous command set is kept.
 */

import { analyzeSimulation } from './simulationMetrics';
import { repairCE01FinalCommands } from './ce01FinalCommandRepair';
import { sanitizeCommandsForCE01 } from './ce01CommandSanitizer';
import { validateCE01 } from './ce01Validator';
import { encodeToFile, DEFAULT_MACHINE } from './exportPipeline';

// ─── Metrics extraction (matches SimulationReportPanel exactly) ─────────────

function extractMetrics(commands, objects, regions, config, ms) {
  const analysis = analyzeSimulation(commands, objects || [], ms, regions, config);
  const ce01 = validateCE01(commands, objects || [], regions, config, { ...ms, maxSpeed: 800 });
  const m = analysis.metrics;
  return {
    outsideRegion: m.stitchesOutsideRegion ?? 0,
    duplicates: m.duplicateStitches ?? 0,
    longStitches: m.longStitches ?? 0,
    shortStitches: m.shortStitches ?? 0,
    jumps: m.totalJumps ?? 0,
    trims: m.totalTrims ?? 0,
    maxDensity: m.maxDensityPerZone ?? 0,
    stitches: m.totalStitches ?? 0,
    ce01Score: ce01.score,
    ce01Status: ce01.status,
    simScore: analysis.qualityScore,
    simStatus: analysis.status,
  };
}

/**
 * Transactional guard — returns true if `after` is not worse than `before`.
 * Rules (per user spec):
 *   - fuera de región must not increase
 *   - largas >8mm must not increase
 *   - duplicadas must not increase
 *   - saltos must not increase by more than 10
 *   - trims must not increase by more than 10
 *   - CE01 score must not decrease
 */
function metricsNotWorse(after, before) {
  return (
    after.outsideRegion <= before.outsideRegion &&
    after.longStitches <= before.longStitches &&
    after.duplicates <= before.duplicates &&
    after.jumps <= before.jumps + 10 &&
    after.trims <= before.trims + 10 &&
    after.ce01Score >= before.ce01Score
  );
}

// ─── Main preparation function ───────────────────────────────────────────────

/**
 * Prepares the CE01 production export from finalEmbroideryCommands.
 *
 * @param {Array}  finalCommands   — finalEmbroideryCommands from Editor (single source of truth)
 * @param {Array}  regions         — visual regions (read-only, for polygon boundaries + validation)
 * @param {Object} config          — project config (width_mm, height_mm, ce01ProductionMode, ...)
 * @param {Object} machineSettings — machine constraints
 * @param {Array}  objects         — stitch objects from buildFinalCommands
 * @param {string} format          — 'DST' | 'PES' | 'JEF' | 'EXP'
 * @returns {{ commands, ce01Report, finalMetrics, repairApplied, sanitizeApplied, exportAllowed, ... }}
 */
export function prepareCE01ProductionExport(finalCommands, regions, config, machineSettings, objects, format = 'DST') {
  const ms = { ...DEFAULT_MACHINE, ...machineSettings };

  console.log('[ce01-production-export] mode enabled: true');
  console.log('[ce01-production-export] adaptive skipped: true');
  console.log('[ce01-production-export] stability gate skipped: true');
  console.log('[ce01-production-export] command source: finalEmbroideryCommands');

  let commands = (finalCommands || []).map(c => ({ ...c }));
  const baseMetrics = extractMetrics(commands, objects, regions, config, ms);
  console.log('[ce01-production-export] base metrics:', baseMetrics);

  // ── Stage 1: ce01FinalCommandRepair (transactional) ─────────────────────
  const repairResult = repairCE01FinalCommands(commands, regions, { config, machineSettings: ms, objects });
  let repairApplied = false;
  let repairReport = repairResult.report;

  if (repairResult.applied) {
    const afterRepair = extractMetrics(repairResult.commands, objects, regions, config, ms);
    if (metricsNotWorse(afterRepair, baseMetrics)) {
      commands = repairResult.commands;
      repairApplied = true;
      console.log('[ce01-production-export] repair applied: true');
    } else {
      console.log('[ce01-production-export] repair applied: false (metrics worsened — discarded)');
      repairReport = { ...repairResult.report, discarded: true, reason: 'metrics worsened' };
    }
  } else {
    console.log('[ce01-production-export] repair applied: false (no improvement)');
  }

  // ── Stage 2: ce01CommandSanitizer (transactional) ───────────────────────
  const preSanitize = extractMetrics(commands, objects, regions, config, ms);
  const { commands: sanitizedCommands, report: sanitizeReport } = sanitizeCommandsForCE01(commands, ms);
  const afterSanitize = extractMetrics(sanitizedCommands, objects, regions, config, ms);
  let sanitizeApplied = false;

  if (metricsNotWorse(afterSanitize, preSanitize)) {
    commands = sanitizedCommands;
    sanitizeApplied = true;
    console.log('[ce01-production-export] sanitizer applied: true');
  } else {
    console.log('[ce01-production-export] sanitizer applied: false (metrics worsened — discarded)');
  }

  // ── Stage 3: CE01 validation ────────────────────────────────────────────
  const ce01Report = validateCE01(commands, objects || [], regions, config, { ...ms, maxSpeed: 800 });

  // ── Final metrics ───────────────────────────────────────────────────────
  const finalMetrics = extractMetrics(commands, objects, regions, config, ms);
  console.log('[ce01-production-export] final metrics:', finalMetrics);

  const exportAllowed = ce01Report.status !== 'INVALID';
  console.log('[ce01-production-export] ce01 status:', ce01Report.status);
  console.log('[ce01-production-export] export allowed:', exportAllowed);
  if (!exportAllowed) {
    console.log('[ce01-production-export] export blocked reason: CE01 INVALID');
  }

  return {
    commands,
    ce01Report,
    finalMetrics,
    baseMetrics,
    repairApplied,
    sanitizeApplied,
    repairReport,
    sanitizeReport,
    exportAllowed,
    format,
  };
}

// ─── Encode (calls backend) ──────────────────────────────────────────────────

/**
 * Full production export: prepare + encode to file Blob.
 * Does NOT run adaptiveOptimizationEngine or stabilityOptimizer.
 */
export async function encodeCE01ProductionToFile(finalCommands, regions, config, machineSettings, objects, format, base44Client) {
  const prepared = prepareCE01ProductionExport(finalCommands, regions, config, machineSettings, objects, format);

  if (!prepared.exportAllowed) {
    console.log('[ce01-production-export] export blocked reason: CE01 INVALID');
    const err = new Error(
      `Exportación bloqueada por validación CE01: ${prepared.ce01Report.blockingIssues.length} problema(s) crítico(s).`
    );
    err.blocked = true;
    err.report = prepared;
    throw err;
  }

  const blob = await encodeToFile(prepared.commands, objects || [], format, machineSettings, base44Client);
  return { blob, ...prepared };
}