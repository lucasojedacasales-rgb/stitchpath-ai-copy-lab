/**
 * preExportRepairer.js — Reparaciones técnicas reales (v2 transaccional)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cada función opera SOBRE la lista de comandos plana. No toca regiones,
 * formas, colores principales, el detector de contornos, el Final Look visual,
 * los encoders ni el CE01 loader. Preserva boca/ojos/pies/contornos y detalles.
 *
 * Cada fase devuelve comandos nuevos + rellena `report` con contadores reales.
 * El orquestador mide métricas antes/después y revierte la fase si empeora.
 *
 * Orden (orquestador transaccional):
 *   1. removeEmptyBlocks
 *   2. repairVisibleDiagonalStitches
 *   3. splitUnsafeLongStitches
 *   4. removeDuplicateStitches
 *   5. mergeShortStitches
 *   6. optimizeTrimsAndJumps
 *   7. addTieInTieOff            (siempre al final, sobre bloques consolidados)
 *   8. reduceColorChangesIfSafe
 */

import { detectVisibleDiagonalStitches } from './visibleDiagonalDetector';

const DUP_TOL_MM = 0.1;          // duplicada consecutiva si dist < esto
const SHORT_MERGE_MM = 0.6;      // fusionar si el segmento es menor a esto
const MAX_STITCH_MM = 8.0;       // puntada larga insegura
const SPLIT_SEG_MM = 7.5;        // dividir en segmentos de este tamaño
const MAX_JUMP_MM = 12.1;        // salto máximo CE01
const TRIM_JUMP_MM = 3.5;        // trim antes de saltos > esto
const TIE_LEN_MM = 0.4;          // longitud de puntada de anclaje (tie)
const TIE_COUNT = 2;             // 2 tie-in + 2 tie-off por bloque
const MIN_BLOCK_FOR_TIE = 8;     // no añadir ties a micro-bloques
const TINY_OBJECT_STITCHES = 3;

// ── helpers ──────────────────────────────────────────────────────────────────
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
function isContourLayer(cmd) {
  const lt = String(cmd.layerType || '').toLowerCase();
  return lt.includes('outline') || lt.includes('contour');
}
function isImportantDetail(cmd) {
  return isDetailLayer(cmd) || isContourLayer(cmd);
}
function lastStitch(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].type === 'stitch') return arr[i];
  return null;
}
function nextStitch(commands, from) {
  for (let i = from; i < commands.length; i++) if (commands[i].type === 'stitch') return commands[i];
  return null;
}

// ── point-in-polygon (coordenadas normalizadas path_points) ──────────────────
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
const NORM_W = 100, NORM_H = 100;
function regionAt(x, y, regions) {
  if (!regions || !regions.length) return null;
  const nx = (x / NORM_W + 0.5), ny = (y / NORM_H + 0.5);
  for (const r of regions) {
    const pp = r.path_points;
    if (!pp || pp.length < 3) continue;
    if (pointInPolygon(nx, ny, pp)) return r;
  }
  return null;
}

// ── soporte de máscara dark stroke para un segmento ───────────────────────────
function segmentDarkSupport(ax, ay, bx, by, darkStroke) {
  if (!darkStroke?.strictMask) return 0;
  const W = darkStroke.width, H = darkStroke.height, mask = darkStroke.strictMask;
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(2, Math.ceil(len));
  let hits = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
    const px = Math.round((mx / NORM_W + 0.5) * W), py = Math.round((my / NORM_H + 0.5) * H);
    let on = false;
    for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (mask[ny * W + nx]) { on = true; break; }
    }
    if (on) hits++;
  }
  return hits / (steps + 1);
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 1 — removeEmptyBlocks (robusto, multi-pasada)
// ═══════════════════════════════════════════════════════════════════════════
// Elimina bloques de color sin stitches reales:
//   - colorChange sin stitches antes del siguiente colorChange/EOF
//   - bloques con solo jump/trim y 0 stitches
//   - bloque inicial (antes del primer colorChange) sin stitches
//   - jumps/trims finales tras el último stitch
//   - colorChanges redundantes creados por reducción de color
// Recalcula bloques después de cada pasada (hasta 3 pasadas) porque eliminar
// un colorChange puede dejar al descubierto un nuevo bloque vacío.
// Si un bloque no se puede eliminar, registra forense (whyNotRemoved).
export function removeEmptyBlocks(commands, _objects, _regions, report = {}) {
  let cmds = (commands || []).slice();
  let totalRemoved = 0;
  let colorChangesRemoved = 0;
  let trailingJumpsTrimsRemoved = 0;
  let leadingEmptiesRemoved = 0;
  let midBlockJumpsTrimsRemoved = 0;
  let endMarkersDropped = 0;
  const allRemovedIdx = [];
  const removalLog = [];

  // Multi-pasada: cada pasada recalcula bloques desde cero (hasta 8 pasadas).
  // Un bloque = run entre colorChange/end/EOF. Si tiene 0 stitches, se eliminan
  // todos sus colorChange/jump/trim (y el end final, que el encoder DST reañade).
  for (let pass = 0; pass < 8; pass++) {
    const dropIdx = new Set();

    // Construir segmentos: cada segmento empieza en colorChange/end (o inicio)
    // y termina antes del siguiente colorChange/end/EOF.
    const segments = [];
    let segStart = 0;
    for (let i = 0; i < cmds.length; i++) {
      const t = cmds[i].type;
      if ((t === 'colorChange' || t === 'end') && i > segStart) {
        segments.push([segStart, i]);
        segStart = i;
      }
    }
    segments.push([segStart, cmds.length]);

    for (const [s, e] of segments) {
      let hasStitch = false;
      for (let i = s; i < e; i++) if (cmds[i].type === 'stitch') { hasStitch = true; break; }
      if (hasStitch) continue;

      // bloque vacío [s, e)
      const isLeading = s === 0;
      const isTrailing = e === cmds.length;
      for (let i = s; i < e; i++) {
        const c = cmds[i];
        if (c.type === 'end') {
          // dropear end solo en bloque final vacío — el encoder DST reañade END
          if (isTrailing) { dropIdx.add(i); endMarkersDropped++; }
          continue;
        }
        dropIdx.add(i);
        if (c.type === 'colorChange') colorChangesRemoved++;
        else if (c.type === 'jump' || c.type === 'trim') {
          if (isLeading) leadingEmptiesRemoved++;
          else if (isTrailing) trailingJumpsTrimsRemoved++;
          else midBlockJumpsTrimsRemoved++;
        }
      }
      removalLog.push({ pass, blockStart: s, blockEnd: e, isLeading, isTrailing, dropped: e - s });
    }

    if (dropIdx.size === 0) break;
    for (const i of dropIdx) allRemovedIdx.push(i);
    cmds = cmds.filter((_, i) => !dropIdx.has(i));
    totalRemoved += dropIdx.size;
  }

  // ── Forense de bloques vacíos restantes (serializado, no [object Object]) ──
  const unremovableBlocks = [];
  let emptyBlocksAfter = 0;
  let blockIndex = 0;
  let blockStart = 0, blockSt = 0;
  for (let i = 0; i <= cmds.length; i++) {
    const c = cmds[i];
    if (!c || c.type === 'colorChange' || c.type === 'end' || i === cmds.length) {
      if (blockSt === 0 && i > blockStart) {
        emptyBlocksAfter++;
        unremovableBlocks.push(buildBlockForensic(blockIndex, blockStart, i, cmds.slice(blockStart, i), cmds));
      }
      blockIndex++;
      blockStart = i; blockSt = 0;
    } else if (c.type === 'stitch') blockSt++;
  }

  report.emptyBlocksRemoved = totalRemoved;
  report.colorChangesRemoved = colorChangesRemoved;
  report.trailingJumpsTrimsRemoved = trailingJumpsTrimsRemoved;
  report.leadingEmptiesRemoved = leadingEmptiesRemoved;
  report.midBlockJumpsTrimsRemoved = midBlockJumpsTrimsRemoved;
  report.endMarkersDropped = endMarkersDropped;
  report.commandIndexesRemoved = allRemovedIdx;
  report.removalLog = removalLog;
  report.remainingEmptyBlocks = emptyBlocksAfter;
  report.unremovableBlocks = unremovableBlocks;
  return cmds;
}

function describeCmdForForensic(c) {
  if (!c) return 'none';
  return JSON.stringify({
    type: c.type, x: c.x, y: c.y, color: c.color || null,
    regionId: c.regionId || null, layerType: c.layerType || null, stitchType: c.stitchType || null,
  });
}
function buildBlockForensic(blockIndex, startIdx, endIdx, seg, cmds) {
  const hasStitches = seg.some(c => c.type === 'stitch');
  const hasColorChange = seg.some(c => c.type === 'colorChange');
  const hasJumpTrim = seg.some(c => c.type === 'jump' || c.type === 'trim');
  const hasEnd = seg.some(c => c.type === 'end');
  const hasOnlyColorChange = hasColorChange && !hasJumpTrim && !hasEnd && !hasStitches;
  const hasOnlyJumpTrim = !hasStitches && !hasColorChange && hasJumpTrim;
  const isLeadingBlock = startIdx === 0;
  const isTrailingBlock = endIdx === cmds.length;
  const prevCmd = startIdx > 0 ? cmds[startIdx - 1] : null;
  const nextCmd = endIdx < cmds.length ? cmds[endIdx] : null;
  const isBetweenColorChanges =
    (prevCmd?.type === 'colorChange' || isLeadingBlock) &&
    (nextCmd?.type === 'colorChange' || isTrailingBlock);

  let whyEmpty, proposedFix, removable = true, whyNotRemovable = null;
  if (hasOnlyColorChange) {
    whyEmpty = 'colorChange sin stitches antes del siguiente colorChange/EOF';
    proposedFix = 'eliminar colorChange redundante (no produce stitches)';
  } else if (hasEnd && !hasJumpTrim && !hasColorChange) {
    whyEmpty = 'bloque final con solo marcador end';
    proposedFix = 'dropear end — el encoder DST reañade END automáticamente';
  } else if (hasOnlyJumpTrim && isBetweenColorChanges) {
    whyEmpty = 'jump/trim sueltos entre colorChanges sin stitches';
    proposedFix = 'eliminar jumps/trims del bloque vacío + colorChange del bloque adyacente';
  } else if (isLeadingBlock) {
    whyEmpty = 'bloque inicial sin stitches reales';
    proposedFix = 'eliminar todos los jumps/trims iniciales';
  } else if (isTrailingBlock) {
    whyEmpty = 'bloque final sin stitches reales';
    proposedFix = 'eliminar jumps/trims finales + colorChange del bloque final';
  } else {
    whyEmpty = 'bloque vacío residual no clasificado';
    proposedFix = 'revisar removeEmptyBlocks — caso no cubierto';
    removable = false;
    whyNotRemovable = 'caso no cubierto por removeEmptyBlocks';
  }

  return {
    blockIndex,
    startCommandIndex: startIdx,
    endCommandIndex: endIdx,
    color: seg[0]?.color || '—',
    previousCommand: describeCmdForForensic(prevCmd),
    nextCommand: nextCmd ? describeCmdForForensic(nextCmd) : 'EOF',
    commandsInsideBlock: seg.map(describeCmdForForensic),
    hasStitches,
    hasOnlyColorChange,
    hasOnlyJumpTrim,
    hasEnd,
    isTrailingBlock,
    isLeadingBlock,
    isBetweenColorChanges,
    createdByColorReduction: false,
    whyEmpty,
    proposedFix,
    removable,
    whyNotRemovable,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 2 — repairVisibleDiagonalStitches (usa el detector ÚNICO compartido)
// ═══════════════════════════════════════════════════════════════════════════
// Llama a detectVisibleDiagonalStitches (mismos offenders que gate/detector)
// y repara EXACTAMENTE esos commandIndex. Para cada offender reparable:
//   - contourNoDarkMask → cortar cadena + jump
//   - crossesEmptySpace → jump (sin coser el vacío)
//   - travelBetweenObjects / crossesMultipleRegions / sameRegionNonFill → trim + jump
// Los validFillTatami y contourWithDarkMask se conservan (preservedTatamiDiagonal).
export function repairVisibleDiagonalStitches(commands, objects, regions, report = {}) {
  const darkStroke = report?.darkStroke || null;
  const detection = detectVisibleDiagonalStitches(commands, objects, regions, darkStroke, report?.config || {});
  const offenderByIdx = new Map();
  for (const o of detection.offenders) {
    if (o.repairable) offenderByIdx.set(o.commandIndex, o);
  }
  const out = [];
  let removed = 0, converted = 0;
  let preservedTatami = 0, skippedValidFill = 0, skippedNoSafe = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const off = offenderByIdx.get(i);
    if (!off) { out.push(c); continue; }
    // reparar este offender exacto
    removed++;
    converted++;
    if (off.reason === 'crossesEmptySpace') {
      // sin coser el vacío → solo jump (no trim necesario)
      out.push({
        type: 'jump', x: c.x, y: c.y, color: c.color, layerType: c.layerType,
        regionId: c.regionId, stitchType: c.stitchType, source: c.source,
      });
    } else if (off.reason === 'contourNoDarkMask') {
      // cortar cadena: trim + jump al destino
      out.push({ type: 'trim' });
      out.push({
        type: 'jump', x: c.x, y: c.y, color: c.color, layerType: c.layerType,
        regionId: c.regionId, stitchType: c.stitchType, source: c.source,
      });
    } else {
      // travel / crossesMultiple / sameRegionNonFill → trim + jump
      out.push({ type: 'trim' });
      out.push({
        type: 'jump', x: c.x, y: c.y, color: c.color, layerType: c.layerType,
        regionId: c.regionId, stitchType: c.stitchType, source: c.source,
      });
    }
  }
  preservedTatami = detection.preservedTatamiDiagonal;
  skippedValidFill = detection.preservedTatamiDiagonal + detection.preservedContourWithMask;
  report.visibleDiagonalStitchesDetected = detection.count;
  report.visibleDiagonalStitchesRemoved = removed;
  report.convertedDiagonalToJump = converted;
  report.preservedTatamiDiagonal = preservedTatami;
  report.skippedBecauseValidFill = skippedValidFill;
  report.skippedBecauseNoSafeRepair = skippedNoSafe;
  report._detection = detection;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 3 — splitUnsafeLongStitches (NO divide diagonales visibles)
// ═══════════════════════════════════════════════════════════════════════════
// Puntada > 8mm:
//   - fill dentro de región válida → dividir en segmentos seguros
//   - contorno CON soporte darkMask → dividir (sigue la línea negra)
//   - diagonal visible sin soporte (contorno sin máscara / cruza regiones / vacío)
//     → NO dividir (crearía más diagonales visibles) → trim + jump
export function splitUnsafeLongStitches(commands, _objects, regions, report = {}) {
  const darkStroke = report?.darkStroke || null;
  const out = [];
  let split = 0, converted = 0;
  let prev = null;
  for (const c of commands) {
    if (c.type !== 'stitch') {
      out.push(c);
      if (c.type === 'jump') prev = { x: c.x, y: c.y };
      continue;
    }
    const d = prev ? Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y) : 0;
    if (d > MAX_STITCH_MM) {
      const rPrev = regionAt(prev.x, prev.y, regions);
      const rCur = regionAt(c.x ?? 0, c.y ?? 0, regions);
      const sameRegion = rPrev && rCur && rPrev.id === rCur.id;
      const contour = isContourLayer(c);
      const detail = isDetailLayer(c);
      const isFill = !contour && !detail && (c.stitchType === 'fill' || !c.stitchType);
      const darkSup = (contour || isDarkColor(c.color))
        ? segmentDarkSupport(prev.x, prev.y, c.x ?? 0, c.y ?? 0, darkStroke)
        : 0;
      const sameRegionFill = sameRegion && isFill;
      const contourWithMask = contour && darkSup >= 0.5;
      if (sameRegionFill || contourWithMask) {
        // soporte → dividir en segmentos seguros (no crea diagonales visibles)
        const steps = Math.ceil(d / SPLIT_SEG_MM);
        for (let s = 1; s <= steps; s++) {
          out.push({ ...c, x: prev.x + (c.x - prev.x) * s / steps, y: prev.y + (c.y - prev.y) * s / steps });
        }
        split++;
      } else {
        // diagonal visible sin soporte → NO dividir → trim + jump
        out.push({ type: 'trim' });
        out.push({ type: 'jump', x: c.x, y: c.y, color: c.color, layerType: c.layerType, regionId: c.regionId, stitchType: c.stitchType, source: c.source });
        converted++;
      }
    } else {
      out.push(c);
    }
    prev = { x: c.x, y: c.y };
  }
  report.longStitchesSplit = split;
  report.longStitchesConvertedToJump = converted;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 4 — removeDuplicateStitches
// ═══════════════════════════════════════════════════════════════════════════
// Compara stitches consecutivos dentro del mismo bloque. tol 0.1mm.
// Distingue duplicate_noise (mismo punto repetido) de intentional_double_run
// (a→b≈a reverso). Elimina ruido, preserva double-run.
export function removeDuplicateStitches(commands, _objects, _regions, report = {}) {
  const out = [];
  let detected = 0, removed = 0, doubleRunPreserved = 0;
  let prevStitch = null;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') { out.push(c); prevStitch = null; continue; }
    if (prevStitch) {
      const d = Math.hypot((c.x ?? 0) - prevStitch.x, (c.y ?? 0) - prevStitch.y);
      if (d < DUP_TOL_MM) {
        detected++;
        // ¿double-run? next stitch ≈ prevStitch (reverso a→b≈a)
        const next = nextStitch(commands, i + 1);
        if (next) {
          const dRev = Math.hypot(next.x - prevStitch.x, next.y - prevStitch.y);
          if (dRev < DUP_TOL_MM) {
            doubleRunPreserved++;
            out.push(c);
            prevStitch = c;
            continue;
          }
        }
        // duplicate noise → drop c
        removed++;
        continue;
      }
    }
    out.push(c);
    prevStitch = c;
  }
  report.duplicatesDetected = detected;
  report.duplicatesRemoved = removed;
  report.intentionalDoubleRunPreserved = doubleRunPreserved;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 5 — mergeShortStitches
// ═══════════════════════════════════════════════════════════════════════════
// Fusiona puntadas <0.6mm dentro del mismo bloque manteniendo forma.
// Conserva esquinas marcadas y detalles importantes (boca/ojos/contornos).
export function mergeShortStitches(commands, _objects, _regions, report = {}) {
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
    if (isImportantDetail(c)) { out.push(c); continue; }
    const v1 = { x: c.x - prev.x, y: c.y - prev.y };
    const v2 = { x: next.x - c.x, y: next.y - c.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-9 || l2 < 1e-9) { merged++; continue; } // punto duplicado
    const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (ang > 30) { out.push(c); continue; } // giro/esquina marcada → conservar
    merged++;
    // drop c (fusionar prev→next, colineal)
  }
  report.mergedShortStitches = merged;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 6 — optimizeTrimsAndJumps
// ═══════════════════════════════════════════════════════════════════════════
// Colapsa saltos consecutivos, inserta trim antes de saltos >3.5mm, elimina
// trims redundantes y trims finales sin stitch posterior.
export function optimizeTrimsAndJumps(commands, _objects, _regions, report = {}) {
  const out = [];
  let prevX = 0, prevY = 0;
  let jumpsCollapsed = 0, trimsInserted = 0, redundantTrimsRemoved = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'jump') {
      let endX = c.x ?? 0, endY = c.y ?? 0, endIdx = i;
      while (endIdx + 1 < commands.length && commands[endIdx + 1].type === 'jump') {
        endIdx++; endX = commands[endIdx].x ?? 0; endY = commands[endIdx].y ?? 0;
      }
      const nJumps = endIdx - i + 1;
      const total = Math.hypot(endX - prevX, endY - prevY);
      const prevOut = out[out.length - 1];
      if (total > TRIM_JUMP_MM && prevOut && prevOut.type === 'stitch') {
        out.push({ type: 'trim', x: prevX, y: prevY, color: prevOut.color, regionId: prevOut.regionId });
        trimsInserted++;
      }
      if (total > MAX_JUMP_MM) {
        const steps = Math.ceil(total / MAX_JUMP_MM);
        for (let s = 1; s <= steps; s++) {
          out.push({ type: 'jump', x: prevX + (endX - prevX) * s / steps, y: prevY + (endY - prevY) * s / steps, color: c.color, regionId: c.regionId });
        }
        jumpsCollapsed += nJumps - steps;
      } else {
        out.push({ type: 'jump', x: endX, y: endY, color: c.color, regionId: c.regionId });
        jumpsCollapsed += nJumps - 1;
      }
      prevX = endX; prevY = endY;
      i = endIdx;
    } else if (c.type === 'trim') {
      const prevOut = out[out.length - 1];
      if (prevOut && prevOut.type === 'trim') { redundantTrimsRemoved++; continue; }
      out.push(c);
    } else {
      out.push(c);
      if (c.type === 'stitch') { prevX = c.x ?? 0; prevY = c.y ?? 0; }
    }
  }
  // trims finales sin stitch posterior → redundantes
  while (out.length && out[out.length - 1].type === 'trim') {
    out.pop();
    redundantTrimsRemoved++;
  }
  report.jumpsCollapsed = jumpsCollapsed;
  report.trimsInserted = trimsInserted;
  report.redundantTrimsRemoved = redundantTrimsRemoved;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 7 — addTieInTieOff (siempre al final)
// ═══════════════════════════════════════════════════════════════════════════
// Añade tie-in/tie-off SOLO a bloques reales consolidados (>=8 stitches).
// Marca hasTieIn/hasTieOff/tieApplied en los comandos para que el detector
// los reconozca. Las tie stitches llevan isTie=true (no se cuentan como short).
export function addTieInTieOff(commands, _objects, _regions, report = {}) {
  const out = [];
  let tieInAdded = 0, tieOffAdded = 0, blocksTied = 0, blocksSkipped = 0;
  let block = [];

  const flush = () => {
    if (block.length === 0) return;
    if (block.length < MIN_BLOCK_FOR_TIE) {
      out.push(...block);
      blocksSkipped++;
      block = [];
      return;
    }
    const first = block[0];
    const last = block[block.length - 1];
    // tie-in: 2 stitches cortas hacia first (retrocediendo desde un punto previo)
    const prevNon = out[out.length - 1];
    const originX = prevNon && Number.isFinite(prevNon.x) ? prevNon.x : first.x;
    const originY = prevNon && Number.isFinite(prevNon.y) ? prevNon.y : first.y;
    for (let k = 1; k <= TIE_COUNT; k++) {
      const t = k / (TIE_COUNT + 1);
      out.push({
        type: 'stitch',
        x: first.x + (originX - first.x) * t * 0.3,
        y: first.y + (originY - first.y) * t * 0.3,
        color: first.color, layerType: first.layerType, regionId: first.regionId,
        stitchType: first.stitchType, isTie: true, tieKind: 'tieIn',
      });
      tieInAdded++;
    }
    // marcar primer stitch del bloque
    first.hasTieIn = true;
    out.push(...block);
    // tie-off: 2 stitches cortas tras last
    for (let k = 1; k <= TIE_COUNT; k++) {
      const t = k / (TIE_COUNT + 1);
      out.push({
        type: 'stitch',
        x: last.x + (last.x - (block[block.length - 2]?.x ?? last.x)) * t * 0.3,
        y: last.y + (last.y - (block[block.length - 2]?.y ?? last.y)) * t * 0.3,
        color: last.color, layerType: last.layerType, regionId: last.regionId,
        stitchType: last.stitchType, isTie: true, tieKind: 'tieOff',
      });
      tieOffAdded++;
    }
    last.hasTieOff = true;
    blocksTied++;
    block = [];
  };

  for (const c of commands) {
    if (c.type !== 'stitch') { flush(); out.push(c); continue; }
    block.push(c);
  }
  flush();
  report.tieInAdded = tieInAdded;
  report.tieOffAdded = tieOffAdded;
  report.blocksTied = blocksTied;
  report.blocksSkipped = blocksSkipped;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 8 — reduceColorChangesIfSafe
// ═══════════════════════════════════════════════════════════════════════════
function hexToLab(hex) {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const f = v => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
  let R = f(r), G = f(g), B = f(b);
  let X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  X /= 0.95047; Y /= 1.0; Z /= 1.08883;
  const fx = X > 0.008856 ? Math.cbrt(X) : 7.787 * X + 16 / 116;
  const fy = Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116;
  const fz = Z > 0.008856 ? Math.cbrt(Z) : 7.787 * Z + 16 / 116;
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labDist(a, b) {
  const la = hexToLab(a), lb = hexToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export function reduceColorChangesIfSafe(commands, _objects, _regions, report = {}) {
  const colors = [];
  for (const c of commands) if (c.color && !colors.includes(c.color.toLowerCase())) colors.push(c.color.toLowerCase());
  if (colors.length <= 6) { report.colorsMerged = 0; report.redundantColorChangesRemoved = 0; return commands; }
  const preserve = new Set(colors.filter(c => isDarkColor(c)));
  const remap = new Map();
  const targets = [];
  for (const c of colors) {
    if (preserve.has(c)) { remap.set(c, c); targets.push(c); continue; }
    let best = null, bestD = Infinity;
    for (const t of targets) {
      if (preserve.has(t)) continue;
      const d = labDist(c, t);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best && bestD < 12) remap.set(c, best);
    else { remap.set(c, c); targets.push(c); }
  }
  let merged = 0;
  const out = commands.map(c => {
    if (!c.color) return c;
    const nc = remap.get(c.color.toLowerCase());
    if (nc && nc !== c.color.toLowerCase()) { merged++; return { ...c, color: nc }; }
    return c;
  });
  // eliminar colorChanges redundantes (mismo color que el anterior)
  const cleaned = [];
  let lastColor = null;
  let redundantCC = 0;
  for (const c of out) {
    if (c.type === 'colorChange') {
      if (c.color && c.color.toLowerCase() === lastColor) { redundantCC++; continue; }
    }
    if (c.color) lastColor = c.color.toLowerCase();
    cleaned.push(c);
  }
  report.colorsMerged = merged;
  report.redundantColorChangesRemoved = redundantCC;
  return cleaned;
}

// ── simplifyTinyObjects (auxiliar, no en orden principal v2) ──────────────────
export function simplifyTinyObjects(commands, _regions, report = {}) {
  const byRegion = new Map();
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') continue;
    const rid = c.regionId || '_none';
    if (!byRegion.has(rid)) byRegion.set(rid, []);
    byRegion.get(rid).push(i);
  }
  const dropIdx = new Set();
  let removedNoise = 0, convertedToRun = 0;
  for (const [rid, idxs] of byRegion) {
    if (idxs.length >= TINY_OBJECT_STITCHES) continue;
    const sample = commands[idxs[0]];
    if (isImportantDetail(sample)) {
      convertedToRun++;
    } else {
      for (const i of idxs) dropIdx.add(i);
      removedNoise++;
    }
  }
  if (dropIdx.size === 0) { report.tinyNoiseRemoved = 0; report.tinyConvertedToRun = convertedToRun; return commands; }
  const out = commands.filter((_, i) => !dropIdx.has(i));
  report.tinyNoiseRemoved = removedNoise;
  report.tinyConvertedToRun = convertedToRun;
  return out;
}