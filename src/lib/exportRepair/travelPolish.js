/**
 * travelPolish.js — Travel Polish V1 (post-V5, reduce jumps/trims, transaccional)
 * ─────────────────────────────────────────────────────────────────────────────
 * Se ejecuta SOLO sobre repairedCommands V5 (después del Polish V1 de warnings).
 * Objetivo: reducir jumps/trims (excessiveTravel) intentando llevar CE01 de
 * RISKY a SAFE — SIN romper los invariantes V5.
 *
 * INVARIANTES V5 (si cualquiera se rompe, se revierte el travel polish completo):
 *   - visibleDiagonalStitches === 0
 *   - emptyBlocks === 0
 *   - invalidCommandSequence === 0
 *   - regionOutsideBounds === 0
 *   - ce01Status !== 'INVALID'
 *   - exportAllowed === true
 *   - ce01Score no baja más de 3 puntos
 *
 * NO toca: encoder DST/DSB, detector universal, repairVisibleDiagonalStitches,
 * removeEmptyBlocks, pipeline V5, Final Look visual, colores principales,
 * boca/ojos/pies/contornos, aprendizaje del corpus.
 *
 * Fases (cada una transaccional; revertida si empeora su target o rompe
 * invariantes):
 *   2. removeRedundantTrims       — trims consecutivos / antes de end / vacíos
 *   3. collapseConsecutiveJumps  — jump→jump→jump → jump único al último destino
 *   4. groupNearbySameColorBlocks— une bloques mismos color cercanos (<2.0mm)
 *   5. safeLocalReorder          — swap adyacente de bloques mismos color/prioridad
 */
import { detectExportErrors } from './exportErrorDetector';
import { validateCE01 } from '@/lib/ce01Validator';
import { generateTravelPolishForensics } from './travelPolishForensics';
import { generateTravelPolishReport } from './travelPolishReport';

// Recalibrado: 12000 era demasiado conservador; Wilcom funcional aceptado por CE01 muestra ~33845 puntadas.
const MAX_STITCHES = 35000;
const TRIM_THRESHOLD = 3.5;   // mm — no eliminar trim antes de jump largo
const NEARBY_MM = 2.0;        // mm — umbral para agrupar bloques del mismo color
const MAX_SCORE_DROP = 3;     // puntos — tope de caída de ce01Score
const SMALL_BLOCK = 24;       // stitches — bloques elegibles para reorder

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

// ── Invariantes V5 duros (si cualquiera falla, revertir) ─────────────────────
function v5InvariantsHold(m) {
  return m.visibleDiagonalStitches === 0 &&
    m.emptyBlocks === 0 &&
    m.invalidCommandSequence === 0 &&
    m.regionOutsideBounds === 0 &&
    m.ce01Status !== 'INVALID' &&
    m.exportAllowed === true;
}

// ── Helpers de criticidad (boca/ojos/pies/contornos/detalles/satin) ───────────
function isCritical(cmd) {
  if (!cmd) return false;
  if (cmd.isTie) return true; // proteger ties V5/polish
  const lt = String(cmd.layerType || '').toLowerCase();
  const rc = String(cmd.region_class || '').toLowerCase();
  const st = String(cmd.stitchType || '').toLowerCase();
  return lt.includes('mouth') || lt.includes('eye') || lt.includes('facial') ||
    lt.includes('detail') || lt.includes('outline') || lt.includes('contour') ||
    lt.includes('foot') || lt.includes('feet') ||
    rc.includes('detail') || rc.includes('mouth') || rc.includes('eye') ||
    rc.includes('outline') || rc.includes('contour') ||
    st === 'satin';
}
function priorityOf(cmd) {
  if (!cmd) return 0;
  const lt = String(cmd.layerType || '').toLowerCase();
  const rc = String(cmd.region_class || '').toLowerCase();
  if (lt.includes('outline') || lt.includes('contour') || rc.includes('outline') || rc.includes('contour')) return 100;
  if (lt.includes('mouth') || lt.includes('eye') || lt.includes('facial') || rc.includes('mouth') || rc.includes('eye')) return 90;
  if (lt.includes('foot') || lt.includes('feet')) return 80;
  if (lt.includes('detail') || rc.includes('detail')) return 50;
  return 10; // fill / default
}
function lastStitch(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].type === 'stitch') return arr[i];
  return null;
}
function nextStitch(commands, from) {
  for (let i = from; i < commands.length; i++) if (commands[i].type === 'stitch') return commands[i];
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 2 — removeRedundantTrims
// ═══════════════════════════════════════════════════════════════════════════
function removeRedundantTrims(commands, _objects, _regions, report = {}) {
  const out = [];
  let removed = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'trim') { out.push(c); continue; }
    const prev = out[out.length - 1];
    const next = commands[i + 1];
    // trims consecutivos → conservar solo el primero
    if (prev && prev.type === 'trim') { removed++; continue; }
    // trim antes de end → innecesario
    if (next && next.type === 'end') { removed++; continue; }
    // trim en microbloque sin puntadas reales desde el último marcador
    let hasStitchSinceMarker = false;
    for (let j = out.length - 1; j >= 0; j--) {
      if (out[j].type === 'stitch') { hasStitchSinceMarker = true; break; }
      if (out[j].type === 'trim' || out[j].type === 'colorChange') break;
    }
    if (!hasStitchSinceMarker) { removed++; continue; }
    // NO eliminar trim necesario antes de un jump largo (> 3.5mm)
    if (next && next.type === 'jump') {
      const ps = lastStitch(out);
      if (ps) {
        const d = Math.hypot((next.x ?? 0) - ps.x, (next.y ?? 0) - ps.y);
        if (d > TRIM_THRESHOLD) { out.push(c); continue; }
      }
    }
    out.push(c);
  }
  report.trimsRemoved = removed;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 3 — collapseConsecutiveJumps
// ═══════════════════════════════════════════════════════════════════════════
function collapseConsecutiveJumps(commands, _objects, _regions, report = {}) {
  const out = [];
  let collapsed = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'jump') { out.push(c); continue; }
    let last = c, count = 1;
    while (i + 1 < commands.length && commands[i + 1].type === 'jump') { i++; last = commands[i]; count++; }
    if (count > 1) { collapsed += count - 1; out.push({ ...last }); }
    else out.push(c);
  }
  report.jumpsCollapsed = collapsed;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 4 — groupNearbySameColorBlocks
// ═══════════════════════════════════════════════════════════════════════════
// Une dos bloques del mismo color separados por trim(+jump) si están a <2.0mm,
// misma región, no críticos. Elimina SOLO el trim; mantiene el jump (no crea
// stitch visible). No une si no hay jump entre medias (evita connector visible).
function groupNearbySameColorBlocks(commands, _objects, _regions, report = {}) {
  const out = [];
  let merges = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    out.push(c);
    if (c.type !== 'trim') continue;
    const stitchA = out[out.length - 2];
    if (!stitchA || stitchA.type !== 'stitch' || isCritical(stitchA)) continue;
    const jumpCmd = commands[i + 1];
    if (!jumpCmd || jumpCmd.type !== 'jump') continue;
    const stitchB = commands[i + 2];
    if (!stitchB || stitchB.type !== 'stitch' || isCritical(stitchB)) continue;
    if ((stitchA.color ?? null) !== (stitchB.color ?? null)) continue;
    if ((stitchA.regionId ?? null) !== (stitchB.regionId ?? null)) continue;
    const d = Math.hypot((stitchB.x ?? 0) - stitchA.x, (stitchB.y ?? 0) - stitchA.y);
    if (d >= NEARBY_MM) continue;
    // seguro: eliminar el trim (mantener jump). No crea stitch visible.
    out.pop();
    merges++;
  }
  report.trimsMergedNearby = merges;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 5 — safeLocalReorder (swap adyacente conservador)
// ═══════════════════════════════════════════════════════════════════════════
// Solo intercambia dos bloques adyacentes A,B si: mismo color, misma prioridad,
// ambos no críticos, ambos pequeños (<= SMALL_BLOCK), y el swap reduce estrictamente
// el travel total (prev→B + B→A + A→next  <  prev→A + A→B + B→next).
// Respeta fill→details→outline (prioridad igual → mismo nivel).
function safeLocalReorder(commands, _objects, _regions, report = {}) {
  // parsear bloques: runs de stitches separados por trim/colorChange/end
  const blocks = [];
  let cur = [];
  const flush = (endCmd) => {
    if (cur.length) {
      const first = cur[0], last = cur[cur.length - 1];
      blocks.push({
        cmds: cur, color: first?.color ?? null,
        priority: priorityOf(first),
        critical: cur.some(isCritical),
        start: { x: first?.x ?? 0, y: first?.y ?? 0 },
        end: { x: last?.x ?? 0, y: last?.y ?? 0 },
        size: cur.length,
      });
      cur = [];
    }
    if (endCmd) blocks.push({ sep: endCmd });
  };
  for (const c of commands) {
    if (c.type === 'stitch') cur.push(c);
    else flush(c);
  }
  flush(null);

  // intentar swap adyacente entre dos bloques stitch con un separador trim entre ellos
  let swaps = 0;
  for (let i = 0; i + 2 < blocks.length; i++) {
    const A = blocks[i], sep = blocks[i + 1], B = blocks[i + 2];
    if (A.sep || B.sep || !sep || !sep.sep) continue;
    if (sep.sep.type !== 'trim') continue;
    if (A.critical || B.critical) continue;
    if (A.size > SMALL_BLOCK || B.size > SMALL_BLOCK) continue;
    if ((A.color ?? null) !== (B.color ?? null)) continue;
    if (A.priority !== B.priority) continue;
    // contexto: bloque previo (antes de A) y siguiente (después de B)
    const prev = i > 0 ? blocks[i - 1] : null;
    const next = i + 3 < blocks.length ? blocks[i + 3] : null;
    const prevEnd = prev && !prev.sep ? prev.end : null;
    const nextStart = next && !next.sep ? next.start : null;
    const dist = (p, q) => (p && q) ? Math.hypot(q.x - p.x, q.y - p.y) : 0;
    const beforeCost = dist(prevEnd, A.start) + dist(A.end, B.start) + dist(B.end, nextStart);
    const afterCost = dist(prevEnd, B.start) + dist(B.end, A.start) + dist(A.end, nextStart);
    if (afterCost + 0.01 >= beforeCost) continue;
    // swap A y B
    blocks[i] = B; blocks[i + 2] = A;
    swaps++;
  }
  report.localSwaps = swaps;
  if (swaps === 0) return commands;
  // reconstruir secuencia
  const out = [];
  for (const b of blocks) {
    if (b.sep) out.push(b.sep);
    else for (const s of b.cmds) out.push(s);
  }
  return out;
}

// ── Ejecutar una fase travel con gate transaccional ──────────────────────────
function runTravelPhase({ name, commands, fn, seed, objects, regions, config, ms, base, target, phaseLog }) {
  const before = measureMetrics(commands, objects, regions, config, ms);
  let afterCommands;
  const stepReport = { ...(seed || {}) };
  try {
    afterCommands = fn(commands, objects, regions, stepReport);
  } catch (e) {
    phaseLog.push({ name, target, accepted: false, reason: `EXCEPTION: ${e.message}`, before, after: before, stepReport });
    return { commands, accepted: false };
  }
  const after = measureMetrics(afterCommands, objects, regions, config, ms);
  // target no debe aumentar (bajar o mantener)
  const targetOK = after[target] <= before[target];
  const invariantOK = v5InvariantsHold(after);
  const scoreOK = after.ce01Score >= base.ce01Score - MAX_SCORE_DROP;
  const noSevereRegression =
    after.duplicateStitches <= base.duplicateStitches + 20 &&
    after.shortStitches <= base.shortStitches + 50 &&
    after.stitchCountOverLimit <= base.stitchCountOverLimit;
  const accept = targetOK && invariantOK && scoreOK && noSevereRegression;
  phaseLog.push({
    name, target, accepted: accept,
    reason: !invariantOK ? 'invariante V5 rota — revertida'
      : !scoreOK ? `ce01Score bajó > ${MAX_SCORE_DROP} (${before.ce01Score}→${after.ce01Score}) — revertida`
      : !noSevereRegression ? 'regresión grave (dups/shortSt/overLimit) — revertida'
      : !targetOK ? `target ${target} aumentó (${before[target]}→${after[target]}) — revertida`
      : '',
    before, after, stepReport,
  });
  return { commands: accept ? afterCommands : commands, accepted: accept };
}

/**
 * Travel Polish V1 — reduce jumps/trims sobre repairedCommands V5.
 * @param {Array} repairedCommands
 * @param {Array} objects
 * @param {Array} regions
 * @param {object} config
 * @param {object} machineSettings
 * @returns {{ travelPolishedCommands, travelPolishAccepted, travelPolishReport, travelPolishPhaseLog, travelPolishComparison, forensics }}
 */
export function polishTravelAfterV5(repairedCommands, objects = [], regions = [], config = {}, machineSettings = {}) {
  const ms = { maxStitchLength: 12.1, maxJumpLength: 12.1, trimThreshold: 3.5, ...machineSettings };
  const base = (repairedCommands || []).map(c => (c ? { ...c } : c));
  const baseMetrics = measureMetrics(base, objects, regions, config, ms);

  // FASE 1 — forensics (solo lectura) sobre la base V5
  const forensics = generateTravelPolishForensics(base, objects, regions, config);

  const phaseLog = [];
  let cmds = base;

  const phases = [
    { name: 'travelRemoveRedundantTrims', fn: removeRedundantTrims, seed: {}, target: 'trimCount' },
    { name: 'travelCollapseConsecutiveJumps', fn: collapseConsecutiveJumps, seed: {}, target: 'jumpCount' },
    { name: 'travelGroupNearbySameColorBlocks', fn: groupNearbySameColorBlocks, seed: {}, target: 'trimCount' },
    { name: 'travelSafeLocalReorder', fn: safeLocalReorder, seed: {}, target: 'jumpCount' },
  ];

  for (const p of phases) {
    const res = runTravelPhase({
      name: p.name, commands: cmds, fn: p.fn, seed: p.seed,
      objects, regions, config, ms, base: baseMetrics, target: p.target, phaseLog,
    });
    cmds = res.commands;
  }

  const finalMetrics = measureMetrics(cmds, objects, regions, config, ms);
  // Gate global: aceptar solo si invariantes se mantienen, score no cae >3 y
  // se reduce jumps O trims. Si no mejora, dejar V5 intacto.
  const improved = finalMetrics.jumpCount < baseMetrics.jumpCount || finalMetrics.trimCount < baseMetrics.trimCount;
  const travelPolishAccepted = v5InvariantsHold(finalMetrics) &&
    finalMetrics.ce01Score >= baseMetrics.ce01Score - MAX_SCORE_DROP &&
    improved &&
    finalMetrics.duplicateStitches <= baseMetrics.duplicateStitches + 20 &&
    finalMetrics.shortStitches <= baseMetrics.shortStitches + 50 &&
    finalMetrics.stitchCountOverLimit <= baseMetrics.stitchCountOverLimit;
  const travelPolishedCommands = travelPolishAccepted ? cmds : base;
  const returnedMetrics = measureMetrics(travelPolishedCommands, objects, regions, config, ms);

  const travelPolishComparison = {
    jumpCount: { before: baseMetrics.jumpCount, after: returnedMetrics.jumpCount },
    trimCount: { before: baseMetrics.trimCount, after: returnedMetrics.trimCount },
    stitchCount: { before: baseMetrics.stitchCount, after: returnedMetrics.stitchCount },
    duplicateStitches: { before: baseMetrics.duplicateStitches, after: returnedMetrics.duplicateStitches },
    shortStitches: { before: baseMetrics.shortStitches, after: returnedMetrics.shortStitches },
    visibleDiagonalStitches: { before: baseMetrics.visibleDiagonalStitches, after: returnedMetrics.visibleDiagonalStitches },
    emptyBlocks: { before: baseMetrics.emptyBlocks, after: returnedMetrics.emptyBlocks },
    invalidCommandSequence: { before: baseMetrics.invalidCommandSequence, after: returnedMetrics.invalidCommandSequence },
    regionOutsideBounds: { before: baseMetrics.regionOutsideBounds, after: returnedMetrics.regionOutsideBounds },
    ce01Score: { before: baseMetrics.ce01Score, after: returnedMetrics.ce01Score },
    ce01Status: { before: baseMetrics.ce01Status, after: returnedMetrics.ce01Status },
    exportAllowed: { before: baseMetrics.exportAllowed, after: returnedMetrics.exportAllowed },
  };

  const report = generateTravelPolishReport({
    phaseLog, baseMetrics, returnedMetrics, travelPolishAccepted, comparison: travelPolishComparison,
  });

  return {
    travelPolishedCommands,
    travelPolishAccepted,
    travelPolishReport: { phaseLog, baseMetrics, returnedMetrics, travelPolishComparison, travelPolishAccepted, report },
    travelPolishPhaseLog: phaseLog,
    travelPolishComparison,
    forensics,
  };
}