/**
 * exportErrorDetector.js — Pre-export error detection (FASE 1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Detecta los 14 tipos de errores técnicos que bloquean o arriesgan la
 * exportación a máquina doméstica (CE01). No modifica comandos — solo clasifica.
 *
 * Cada error: { type, count, severity, reparable, proposedAction }
 *   severity: 'blocking' | 'warning'
 *   reparable: true si el preExportRepairer puede corregirlo
 */
import { validateEmbroideryCompatibility } from '@/lib/embroideryValidation/validationArchitecture';
import { detectVisibleDiagonalStitches } from './visibleDiagonalDetector';

const HOOP_W = 100, HOOP_H = 100;
// El límite anterior de 12000 era demasiado conservador. Se recalibra porque una muestra Wilcom funcional aceptada por CE01 contiene ~33845 puntadas.
const STITCH_WARNING_THRESHOLD = 35000;
const STITCH_HIGH_RISK_THRESHOLD = 50000;
const MIN_STITCH_MM = 0.6;
const MAX_STITCH_MM = 8.0;
const DUP_TOL_MM = 0.1;
const DENSE_CELL_MM = 10;
const MAX_DENSITY = 250;
const MAX_COLORS = 6;
const LONG_JUMP_NO_TRIM_MM = 3.5;

function isDetailLayer(cmd) {
  const lt = String(cmd.layerType || '').toLowerCase();
  const rc = String(cmd.region_class || '').toLowerCase();
  return lt.includes('mouth') || lt.includes('eye') || lt.includes('facial') ||
    lt.includes('detail') || rc.includes('detail') || rc.includes('mouth') || rc.includes('eye');
}
function isDarkColor(hex) {
  if (!hex) return false;
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 80;
}

/**
 * @returns {{ errors: Array, ce01: object }}
 */
export function detectExportErrors(commands, objects = [], regions = [], config = {}, machineSettings = {}) {
  const cmds = commands || [];
  const errors = [];

  // ── Universal validation architecture (source of blocking truth) ──
  const architecture = validateEmbroideryCompatibility({
    commands: cmds,
    objects,
    regions,
    config: { ...config, validationMode: config.validationMode || 'universal' },
    machineSettings,
    format: config.format || machineSettings.format || 'DST',
  });
  const ce01 = architecture.ce01; // backward compatibility for CE01 reports only
  const validation = architecture.active;

  let stitches = 0, jumps = 0, trims = 0, colorChanges = 0;
  let shortSt = 0, longSt = 0, dups = 0, outOfBounds = 0;
  let longJumpNoTrim = 0;
  let prevX = 0, prevY = 0, prevStitch = null;
  const grid = new Map();
  const regionGroups = new Map();
  let invalidCmds = 0;

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (!c || !c.type) { invalidCmds++; continue; }
    if (c.type === 'stitch') {
      stitches++;
      const d = prevStitch ? Math.hypot(c.x - prevStitch.x, c.y - prevStitch.y) : 0;
      // tie stitches son intencionadamente cortas — no se cuentan como short/dup
      if (d > 0 && d < MIN_STITCH_MM && !c.isTie && !prevStitch?.isTie) shortSt++;
      if (d > MAX_STITCH_MM) longSt++;
      // duplicada consecutiva (ruido real, no repeticiones globales de coordenadas)
      if (prevStitch && !c.isTie && !prevStitch.isTie && d < DUP_TOL_MM) dups++;
      if (Math.abs(c.x ?? 0) > HOOP_W / 2 || Math.abs(c.y ?? 0) > HOOP_H / 2) outOfBounds++;
      const gx = Math.floor(((c.x ?? 0) + HOOP_W / 2) / DENSE_CELL_MM);
      const gy = Math.floor(((c.y ?? 0) + HOOP_H / 2) / DENSE_CELL_MM);
      const gk = `${gx},${gy}`;
      grid.set(gk, (grid.get(gk) || 0) + 1);
      const rid = c.regionId || 'unknown';
      if (!regionGroups.has(rid)) regionGroups.set(rid, { first: i, last: i, count: 1, color: c.color });
      else { regionGroups.get(rid).last = i; regionGroups.get(rid).count++; }
      prevStitch = c;
    }
    if (c.type === 'jump') {
      jumps++;
      const d = Math.hypot((c.x ?? 0) - prevX, (c.y ?? 0) - prevY);
      const prev = i > 0 ? cmds[i - 1] : null;
      if (prev && prev.type === 'stitch' && d > LONG_JUMP_NO_TRIM_MM) longJumpNoTrim++;
      // El jump mueve la aguja: la siguiente puntada se mide desde el aterrizaje
      // del jump, no desde el último stitch. Sin esto, convertir una diagonal
      // visible en trim+jump inflaría artificialmente longSt/shortSt/dups.
      prevStitch = { x: c.x ?? 0, y: c.y ?? 0, isTie: false };
    }
    if (c.type === 'trim') trims++;
    if (c.type === 'colorChange') colorChanges++;
    if (c.x !== undefined && Number.isFinite(c.x)) { prevX = c.x; prevY = c.y; }
  }

  // visible diagonal stitches — detector ÚNICO compartido (mismos offenders que repair+gate)
  const vdDetection = detectVisibleDiagonalStitches(cmds, objects, regions, config?.darkStroke || null, config);
  const visibleDiag = vdDetection.count;

  // empty color blocks
  let emptyBlocks = 0;
  {
    let blockStart = 0, blockSt = 0;
    for (let i = 0; i <= cmds.length; i++) {
      const c = cmds[i];
      if (!c || c.type === 'colorChange' || c.type === 'end' || i === cmds.length) {
        if (blockSt === 0 && i > blockStart) emptyBlocks++;
        blockStart = i; blockSt = 0;
      } else if (c.type === 'stitch') blockSt++;
    }
  }

  // tiny objects
  let tinyObjects = 0;
  for (const [, g] of regionGroups) { if (g.count > 0 && g.count < 3) tinyObjects++; }

  // missing tie-in/off: reconoce marcas hasTieIn/hasTieOff Y stitches isTie
  // (tie stitches insertados por addTieInTieOff) — mismo campo que lee la fase.
  let noTieIn = 0, noTieOff = 0;
  for (const [, g] of regionGroups) {
    if (g.count < 4) continue;
    const firstCmd = cmds[g.first];
    const lastCmd = cmds[g.last];
    // tie-in satisfecho si el primer stitch del bloque tiene hasTieIn o es tie (isTie)
    if (!firstCmd || (!firstCmd.hasTieIn && !firstCmd.isTie)) noTieIn++;
    if (!lastCmd || (!lastCmd.hasTieOff && !lastCmd.isTie)) noTieOff++;
  }

  const totalColors = colorChanges + 1;
  const maxCell = grid.size ? Math.max(...grid.values()) : 0;

  // ── Build error list ──
  const push = (type, count, severity, reparable, proposedAction) => {
    if (count > 0) errors.push({ type, count, severity, reparable, proposedAction });
  };

  push('invalidCommandSequence', invalidCmds, 'blocking', true, 'Eliminar comandos nulos/inválidos');
  for (const issue of validation.errors || []) {
    push(issue.type || 'universalInvalid', 1, 'blocking', false, issue.message || 'Fallo universal de compatibilidad');
  }
  push('regionOutsideBounds', outOfBounds, 'blocking', true, 'Proyectar coordenadas fuera del bastidor al interior');
  push('emptyBlocks', emptyBlocks, 'blocking', true, 'Eliminar bloques de color vacíos');
  push('tooSmallObjects', tinyObjects, 'warning', true, 'Simplificar objetos diminutos a running o eliminar ruido');
  push('tooDenseAreas', maxCell > MAX_DENSITY ? maxCell - MAX_DENSITY : 0, 'warning', true, 'Reducir densidad por zona fusionando micro-puntadas');
  push('shortStitches', shortSt, 'warning', true, 'Fusionar puntadas <0.6mm con vecinas manteniendo forma');
  push('duplicateStitches', dups, 'warning', true, 'Eliminar duplicadas consecutivas (tol 0.1mm)');
  push('excessiveTrims', trims > 80 ? trims - 80 : 0, 'warning', true, 'Agrupar bloques del mismo color cercanos (travel oculto)');
  push('excessiveJumps', jumps > 250 ? jumps - 250 : 0, 'warning', true, 'Agrupar bloques del mismo color + colapsar saltos consecutivos');
  push('missingTieIn', noTieIn, 'warning', true, 'Añadir tie-in (2-3 puntadas cortas) al inicio de cada bloque real');
  push('missingTieOff', noTieOff, 'warning', true, 'Añadir tie-off al final de cada bloque real');
  push('unsupportedLongStitches', longSt, 'warning', true, 'Dividir puntadas >8mm en segmentos ≤7.5mm');
  push('visibleDiagonalStitches', visibleDiag, 'blocking', true, 'Convertir diagonales visibles sin soporte en jump+trim');
  push('colorCountTooHigh', totalColors > MAX_COLORS ? totalColors - MAX_COLORS : 0, 'warning', true, 'Fusionar colores muy similares (preservar negro/ojos/boca/contornos)');

  // stitch count is non-blocking after CE01_VALIDATOR_STITCH_LIMIT_RECALIBRATION_V1.
  // >35k is a warning/risk only; >50k is high risk, still not INVALID without real machine rejection evidence.
  push('stitchCountHighRisk', stitches > STITCH_HIGH_RISK_THRESHOLD ? stitches - STITCH_HIGH_RISK_THRESHOLD : 0, 'warning', false, 'Revisar rendimiento/memoria en máquina; no reducir automáticamente sin evidencia real de rechazo');
  push('stitchCountWarning', stitches > STITCH_WARNING_THRESHOLD && stitches <= STITCH_HIGH_RISK_THRESHOLD ? stitches - STITCH_WARNING_THRESHOLD : 0, 'warning', false, 'Conteo alto pero no bloqueante para CE01');

  return { errors, ce01, validation, architecture, counts: { stitches, jumps, trims, shortSt, longSt, dups, outOfBounds, visibleDiag, totalColors, emptyBlocks, tinyObjects, maxCell, noTieIn, noTieOff, longJumpNoTrim }, visibleDiagDetection: vdDetection };
}

export function summarizeErrors(errors) {
  const blocking = errors.filter(e => e.severity === 'blocking');
  const reparable = errors.filter(e => e.reparable);
  const nonReparable = errors.filter(e => !e.reparable);
  return { blocking, reparable, nonReparable, total: errors.length };
}