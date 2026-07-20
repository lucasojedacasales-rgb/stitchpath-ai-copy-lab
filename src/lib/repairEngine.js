/**
 * repairEngine.js — Professional Embroidery Repair Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Acts as a surgical repair tool: NEVER regenerates the whole design.
 * Iteratively fixes only the elements that have errors, re-validates, and
 * repeats until the design is SAFE (score ≥95, no critical errors) or the
 * iteration cap (10) is reached.
 *
 * Principles:
 *   • Only touch regions/commands that have errors.
 *   • Never worsen a zone that already validated SAFE.
 *   • Preserve original colors, size, and position whenever possible.
 *   • Stop when: status=SAFE AND score≥95 AND 0 critical errors, OR 10 iterations.
 *
 * Repair categories (applied per-rule, per-iteration):
 *   GEOMETRY  — R5 (close open paths), R4/R10 (remove empty/corrupt objects)
 *   STITCHES  — R1 (split excessive stitches), R7 (redundant color changes)
 *   JUMPS     — R2 (split long jumps), R13 (insert trim before >3.5mm jumps)
 *   TRIMS     — R6 (remove redundant/consecutive trims)
 *   SEQUENCE  — R8 (illegal commands at index 0), R9 (ensure END terminator)
 *   EXPORT    — R3 (clip to hoop), R12 (remove NaN/Inf coordinates)
 */

import {
  DEFAULT_MACHINE,
  runExportPipelineRaw,
  validatePipeline,
  applyFixForRule,
} from './exportPipeline';
import { validateForMachine } from './machineValidator';

const MAX_ITERATIONS = 10;
const SCORE_SAFE = 95;

// Rules that applyFixForRule can handle, in repair priority order.
// Geometry first (cheapest, prevents cascading errors), then stitches,
// then jumps, then trims, then sequence, then export cleanup.
const REPAIR_RULES = [
  'R5', 'R4', 'R10',   // Geometry: close paths, remove empty/corrupt
  'R1', 'R2',          // Stitches: split excessive
  'R7',                // Stitches: redundant color changes
  'R13',               // Jumps: insert trim before >3.5mm
  'R6',                // Trims: remove redundant
  'R8', 'R9',          // Sequence: illegal commands, END
  'R12', 'R3',         // Export: NaN/Inf, clip to hoop
];

/**
 * Runs the iterative repair engine.
 *
 * @param {Array}  regions         — design regions
 * @param {Object} config          — { width_mm, height_mm }
 * @param {Object} machineSettings — machine constraints
 * @param {string} format          — 'DST' | 'PES' | 'JEF' | 'EXP'
 * @returns {{
 *   status: 'SAFE'|'RISKY'|'INVALID',
 *   score: number,
 *   iterations: number,
 *   history: Array<{ iteration, score, status, errors, fixesApplied }>,
 *   regions: Array,      — final repaired regions
 *   commands: Array,     — final repaired commands
 *   objects: Array,      — final stitch objects
 *   report: string,      — human-readable summary
 *   stoppedReason: string,
 * }}
 */
export function runRepairEngine(regions, config = {}, machineSettings = {}, format = 'DST') {
  const ms = { ...DEFAULT_MACHINE, ...machineSettings };

  // Deep-clone regions so repair never mutates the caller's objects
  // (the Editor's live regions may be shared references).
  let currentRegions = regions.map(r => ({
    ...r,
    path_points: r.path_points ? r.path_points.map(p => [...p]) : r.path_points,
  }));
  // Initial raw pipeline (no auto-fix) — we repair surgically
  let state = runExportPipelineRaw(currentRegions, config, ms, format);
  let currentObjects = state.objects;
  let currentCommands = state.commands;

  const history = [];
  let machineResult = validateForMachine(currentRegions, currentCommands, config, ms);
  let stoppedReason = '';

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    // ── Step 1: Identify errors ──────────────────────────────────────────
    const errors = state.errors;
    const errorRules = [...new Set(errors.map(e => e.rule))];

    // ── Step 2: Check stop conditions ────────────────────────────────────
    const noCritical = machineResult.stats.criticalCount === 0;
    const isSafe = machineResult.status === 'SAFE' && machineResult.score >= SCORE_SAFE && noCritical && errors.length === 0;

    history.push({
      iteration: iter,
      score: machineResult.score,
      status: machineResult.status,
      errors: errors.length,
      criticalCount: machineResult.stats.criticalCount,
      errorRules,
      fixesApplied: [],
    });

    if (isSafe) {
      stoppedReason = `SAFE alcanzado en iteración ${iter} (score ${machineResult.score}, 0 errores).`;
      break;
    }

    // ── Step 3: Apply targeted fixes — only rules that have errors ───────
    const fixesThisIter = [];
    let commandsChanged = false;
    let objectsChanged = false;

    for (const rule of REPAIR_RULES) {
      if (!errorRules.includes(rule)) continue;

      // Normalize R1/R2 — applyFixForRule treats them together as 'R1R2'
      const fixKey = (rule === 'R1' || rule === 'R2') ? 'R1' : rule;
      const hasThisRule = errors.some(e =>
        e.rule === rule || (fixKey === 'R1' && (e.rule === 'R1' || e.rule === 'R2'))
      );
      if (!hasThisRule) continue;

      const result = applyFixForRule(currentCommands, currentObjects, fixKey, ms, format);
      if (result.applied.length > 0) {
        currentCommands = result.fixedCommands;
        currentObjects = result.fixedObjects;
        commandsChanged = true;
        if (fixKey === 'R5' || fixKey === 'R4' || fixKey === 'R10') objectsChanged = true;
        fixesThisIter.push(...result.applied);
      }
    }

    // ── Step 4: If objects changed, rebuild regions from objects ─────────
    if (objectsChanged) {
      // Rebuild regions preserving original color/name/position metadata
      const objIds = new Set(currentObjects.map(o => o.id));
      const survivingRegions = currentRegions.filter(r => objIds.has(r.id || `obj_${currentRegions.indexOf(r) + 1}`));
      // Update path_points from closed/cleaned objects (R5 closes polygons)
      currentRegions = currentRegions.map(r => {
        const obj = currentObjects.find(o => o.id === r.id);
        if (!obj) return r;
        const w = config.width_mm || 100;
        const h = config.height_mm || 100;
        // Convert mm points back to normalized [0-1] for region storage
        const normPts = obj.points.map(([x, y]) => [
          (x / w) + 0.5,
          (y / h) + 0.5,
        ]);
        return { ...r, path_points: normPts };
      }).filter(r => {
        // Remove regions whose objects were deleted by R4/R10
        const obj = currentObjects.find(o => o.id === r.id);
        return obj !== undefined || r.path_points?.length >= 2;
      });
    }

    history[history.length - 1].fixesApplied = fixesThisIter.map(f => `${f.rule}: ${f.message}`);

    // ── Step 5: Re-validate ──────────────────────────────────────────────
    state = validatePipeline(currentCommands, currentObjects, ms, format);
    machineResult = validateForMachine(currentRegions, currentCommands, config, ms);

    // If nothing changed this iteration, we're stuck — stop to avoid infinite loop
    if (!commandsChanged && !objectsChanged) {
      stoppedReason = `Sin progreso en iteración ${iter} — errores restantes no reparables automáticamente.`;
      break;
    }

    if (iter === MAX_ITERATIONS) {
      stoppedReason = `Máximo de ${MAX_ITERATIONS} iteraciones alcanzado (score ${machineResult.score}, ${state.errors.length} errores).`;
    }
  }

  // Final status
  const finalErrors = state.errors;
  const finalScore = machineResult.score;
  const finalStatus = machineResult.status;
  const finalCritical = machineResult.stats.criticalCount;

  const report = buildReport(history, finalStatus, finalScore, finalErrors, finalCritical, stoppedReason);

  return {
    status: finalStatus,
    score: finalScore,
    iterations: history.length,
    history,
    regions: currentRegions,
    commands: currentCommands,
    objects: currentObjects,
    report,
    stoppedReason,
    remainingErrors: finalErrors,
  };
}

function buildReport(history, status, score, errors, critical, stoppedReason) {
  const totalFixes = history.reduce((s, h) => s + h.fixesApplied.length, 0);
  const scoreStart = history[0]?.score ?? 0;
  const scoreEnd = score;
  const delta = scoreEnd - scoreStart;

  return [
    `Motor de reparación: ${history.length} iteración(es), ${totalFixes} corrección(es) aplicada(s).`,
    `Puntuación: ${scoreStart} → ${scoreEnd} (${delta >= 0 ? '+' : ''}${delta}).`,
    `Estado final: ${status} (${critical} crítico(s), ${errors.length} error(es) restante(s)).`,
    stoppedReason,
  ].join('\n');
}