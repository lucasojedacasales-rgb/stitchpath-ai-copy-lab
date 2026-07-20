/**
 * professionalDigitizingMode.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * "Professional Digitizing Mode": post-procesa la secuencia de bordado para
 * acercarla a la calidad Wilcom:
 *   FASE 1 — elimina puntadas diagonales visibles (travel → jump/trim)
 *   FASE 2 — reordena capas (underlay → rellenos → sombras → contornos → detalles)
 *   FASE 3 — contornos satinados con parámetros profesionales
 *   FASE 4 — rellenos con ángulo coherente + underlay
 *   FASE 5 — reducción inteligente de colores
 *   FASE 6 — quality gate profesional
 *   FASE 7 — comparación Final Look vs Export
 *
 * No toca: DST/DSB encoder, CE01 validator, detector universal, exportación base.
 * Solo post-procesa la lista de comandos/objetos que produce buildFinalCommands.
 */

import { detectVisibleDiagonalStitches } from '@/lib/exportRepair/visibleDiagonalDetector';
import { validateCE01 } from '@/lib/ce01Validator';
import { auditProfessionalColorSequence } from '@/lib/professionalLayerKnockout';

export const PROFESSIONAL_PARAMS = {
  minStitchMm: 0.7,
  maxVisibleStitchMm: 4.0,
  longDiagonalMm: 3.0,
  shortStitchMm: 0.7,
  duplicateMm: 0.3,
  satinWidthMm: 1.2,
  satinDensityMm: 0.4,
  pullCompMm: 0.3,
  fillDensityMm: 0.42,
  fillStitchLenMm: 3.5,
  underlayMinAreaMm2: 80,
  maxColors: 8,
  colorMergeLabDelta: 12,
  travelVisibleMm: 0, // max travel visible = 0 → todo travel debe ocultarse
  // ── Diagonal repair (FASE 1 real) ──
  suspiciousDiagonalMinMm: 2.5,   // longitud mínima para considerar una puntada sospechosa
  longConnectorMm: 6.0,          // > este umbral se considera "conector entre objetos" aunque no sea negro/contorno
  contourDarkSupportMin: 0.5,    // contornos con soporte de línea negra real >= esto se conservan
  diagonalAngleMin: 20,          // ángulo diagonal marcado (desde horizontal)
  diagonalAngleMax: 70,
};

// ── Color helpers ────────────────────────────────────────────────────────────
export function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToLab([r, g, b]) {
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
export function colorDistance(a, b) {
  const la = rgbToLab(hexToRgb(a)), lb = rgbToLab(hexToRgb(b));
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

// ── Point-in-polygon (normalized path_points) ────────────────────────────────
function pointInPolygonMm(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function regionSupportForPoint(x, y, regions) {
  for (const r of regions || []) {
    const pp = r.path_points;
    if (!pp || pp.length < 3) continue;
    const w = 100, h = 100;
    const nx = (x / w + 0.5), ny = (y / h + 0.5);
    if (pointInPolygonMm(nx, ny, pp)) return r;
  }
  return null;
}

// ── Dark-mask segment support ────────────────────────────────────────────────
function segmentDarkSupport(ax, ay, bx, by, darkStroke) {
  if (!darkStroke?.strictMask) return 0;
  const W = darkStroke.width, H = darkStroke.height, mask = darkStroke.strictMask;
  const w = 100, h = 100;
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(2, Math.ceil(len));
  let hits = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
    const px = Math.round((mx / w + 0.5) * W), py = Math.round((my / h + 0.5) * H);
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

function isDarkColor(c) {
  const [r, g, b] = hexToRgb(c || '#000000');
  return (0.299 * r + 0.587 * g + 0.114 * b) < 80;
}

function safeTrimFrom(prev, current = {}) {
  const x = Number.isFinite(prev?.x) ? prev.x : (Number.isFinite(current?.x) ? current.x : 0);
  const y = Number.isFinite(prev?.y) ? prev.y : (Number.isFinite(current?.y) ? current.y : 0);
  return {
    type: 'trim',
    x,
    y,
    color: current?.color ?? prev?.color,
    regionId: current?.regionId ?? prev?.regionId,
    source: 'safe_trim',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 1 — Validar / corregir puntadas visibles antes de exportar
// ═══════════════════════════════════════════════════════════════════════════
export function validateVisibleStitchesBeforeExport(commands, regions = [], darkStroke, config = {}) {
  const p = { ...PROFESSIONAL_PARAMS, ...(config.professionalParams || {}) };
  const report = {
    visibleDiagonalStitches: 0,
    unsupportedTravelStitches: 0,
    longBlackCrossingStitches: 0,
    stitchWithoutRegionSupport: 0,
    stitchWithoutDarkMaskSupport: 0,
    convertedToJump: 0,
    cutsApplied: 0,
  };

  // Need a "previous stitched point" to measure each stitch length
  const out = [];
  let prev = null;
  for (const c of commands) {
    if (c.type !== 'stitch') { out.push(c); if (c.type === 'jump') prev = { x: c.x, y: c.y }; continue; }
    const x = c.x, y = c.y;
    const dist = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;

    const dark = isDarkColor(c.color);
    const regionSup = regionSupportForPoint(x, y, regions);
    const maskSup = dark ? segmentDarkSupport(prev ? prev.x : x, prev ? prev.y : y, x, y, darkStroke) : 0;

    if (dist >= p.longDiagonalMm && dark) {
      report.longBlackCrossingStitches++;
      report.visibleDiagonalStitches++;
    }
    if (dist > p.maxVisibleStitchMm && dark && maskSup < 0.5 && !regionSup) {
      report.visibleDiagonalStitches++;
      report.stitchWithoutDarkMaskSupport += maskSup < 0.5 ? 1 : 0;
      report.stitchWithoutRegionSupport += !regionSup ? 1 : 0;
      // FIX: convert to trim + jump (do not sew the diagonal)
      out.push(safeTrimFrom(prev, c));
      out.push({ type: 'jump', x, y, color: c.color, layerType: c.layerType, regionId: c.regionId });
      report.convertedToJump++;
      report.cutsApplied++;
      prev = { x, y };
      continue;
    }
    // unsupported travel: long stitch of a fill color crossing outside any region
    if (dist > p.maxVisibleStitchMm && !dark && !regionSup) {
      report.unsupportedTravelStitches++;
      out.push(safeTrimFrom(prev, c));
      out.push({ type: 'jump', x, y, color: c.color, layerType: c.layerType, regionId: c.regionId });
      report.convertedToJump++;
      prev = { x, y };
      continue;
    }
    out.push(c);
    prev = { x, y };
  }
  return { commands: out, report };
}

// ── Clasificador de puntada diagonal visible sospechosa ──────────────────────
// Devuelve { dist, suspicious, reason } para una puntada dada su punto anterior.
// Una puntada es sospechosa si:
//  - longitud > suspiciousDiagonalMinMm
//  - ángulo diagonal marcado (20-70° o 110-160°)
//  - cruza regiones (start/end en regiones distintas o sale a exterior)
//  - NO es relleno tatami válido (misma región en ambos extremos)
//  - es negra/contorno O es un conector largo (> longConnectorMm)
//  - si es contorno, NO tiene soporte de línea negra real (máscara)
function classifyVisibleDiagonalStitch(c, prev, regions, darkStroke, p) {
  if (!prev) return { dist: 0, suspicious: false };
  const dx = (c.x || 0) - prev.x, dy = (c.y || 0) - prev.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= p.suspiciousDiagonalMinMm) return { dist, suspicious: false };
  // ángulo normalizado a 0-180°
  let deg = Math.atan2(dy, dx) * 180 / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  const isDiagonal = (deg >= p.diagonalAngleMin && deg <= p.diagonalAngleMax) ||
                     (deg >= 180 - p.diagonalAngleMax && deg <= 180 - p.diagonalAngleMin);
  if (!isDiagonal) return { dist, suspicious: false, reason: 'not-diagonal-angle' };
  const regionPrev = regionSupportForPoint(prev.x, prev.y, regions);
  const regionCur = regionSupportForPoint(c.x || 0, c.y || 0, regions);
  const crosses = !regionPrev || !regionCur || regionPrev.id !== regionCur.id;
  const sameRegionFill = c.stitchType === 'fill' && regionPrev && regionCur && regionPrev.id === regionCur.id;
  if (!crosses || sameRegionFill) return { dist, suspicious: false, reason: 'same-region-fill' };
  const lt = (c.layerType || '').toLowerCase();
  const isContour = lt.includes('outline') || lt.includes('contour') || lt.includes('detail') || lt.includes('facial');
  const isBlack = isDarkColor(c.color);
  const longConnector = dist > p.longConnectorMm;
  if (!(isBlack || isContour || longConnector)) return { dist, suspicious: false, reason: 'not-connector-color' };
  if (isContour) {
    const maskSup = segmentDarkSupport(prev.x, prev.y, c.x || 0, c.y || 0, darkStroke);
    if (maskSup >= p.contourDarkSupportMin) return { dist, suspicious: false, reason: 'contour-has-dark-support' };
  }
  return { dist, suspicious: true, reason: 'crossing-diagonal' };
}

// ── FASE 1 (real): reparar puntadas diagonales visibles ──────────────────────
// Convierte cada puntada diagonal sospechosa en trim + jump al punto destino,
// de modo que la aguja viaja sin coser la diagonal. Las puntadas de relleno
// tatami válidas (misma región) y los contornos con soporte de línea negra real
// se conservan intactos.
export function repairVisibleDiagonalStitches(commands = [], regions = [], darkStroke, config = {}) {
  // Detector ÚNICO compartido — mismos offenders que gate + export repair
  const detection = detectVisibleDiagonalStitches(commands, [], regions, darkStroke, config);
  const offenderByIdx = new Map();
  for (const o of detection.offenders) if (o.repairable) offenderByIdx.set(o.commandIndex, o);
  const out = [];
  let removed = 0, converted = 0, longest = 0;
  const sourceIdx = [];
  let prev = null;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const off = offenderByIdx.get(i);
    if (!off) {
      out.push(c);
      if (c.type === 'stitch' || c.type === 'jump') prev = { x: c.x, y: c.y, color: c.color, regionId: c.regionId };
      continue;
    }
    removed++; converted++;
    longest = Math.max(longest, off.lengthMm);
    sourceIdx.push(i);
    if (off.reason === 'crossesEmptySpace') {
      out.push({ type: 'jump', x: c.x, y: c.y, color: c.color, layerType: c.layerType, regionId: c.regionId, stitchType: c.stitchType, source: c.source });
    } else {
      out.push(safeTrimFrom(prev, c));
      out.push({ type: 'jump', x: c.x, y: c.y, color: c.color, layerType: c.layerType, regionId: c.regionId, stitchType: c.stitchType, source: c.source });
    }
    prev = { x: c.x, y: c.y, color: c.color, regionId: c.regionId };
  }
  const afterDetection = detectVisibleDiagonalStitches(out, [], regions, darkStroke, config);
  return {
    commands: out,
    report: {
      visibleDiagonalStitchesBefore: detection.count,
      visibleDiagonalStitchesAfter: afterDetection.count,
      removedVisibleDiagonalStitches: removed,
      convertedDiagonalToJump: converted,
      longestRemovedDiagonalMm: longest,
      sourceCommandIndex: sourceIdx,
      preservedTatamiDiagonal: detection.preservedTatamiDiagonal,
      preservedContourWithMask: detection.preservedContourWithMask,
    },
  };
}

// Conteo aislado de diagonales visibles — delega al detector ÚNICO compartido
export function countVisibleDiagonalStitches(commands = [], regions = [], darkStroke, config = {}) {
  return detectVisibleDiagonalStitches(commands, [], regions, darkStroke, config).count;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 2 — Reordenar capas profesionalmente (por bloques, no por puntadas)
// ═══════════════════════════════════════════════════════════════════════════
function professionalPriority(cmd, params = {}) {
  const lt = (cmd.layerType || '').toLowerCase();
  const st = (cmd.stitchType || '').toLowerCase();
  const src = (cmd.source || '').toLowerCase();
  const isOutline = lt === 'outer_outline' || lt === 'outer_silhouette' || lt === 'limb_contour' || lt === 'real_outline_lower' || lt === 'inner_outline' || lt === 'dark_stroke_outline' || lt.includes('outline') || lt.includes('contour');
  const isDetail = lt.includes('mouth') || lt.includes('facial') || lt.includes('eye') || lt === 'detail_run' || lt === 'detail_open_curve' || lt.includes('detail');
  if (lt.includes('underlay') || src.includes('underlay')) return 10;
  if (params.contourAfterFill === false && isOutline) return 15;
  if (st === 'fill' && !lt.includes('shadow')) return 20;
  if (lt.includes('shadow') || lt.includes('detail_color')) return 30;
  if (st === 'fill' && lt.includes('small')) return 40;
  if (isOutline) return lt === 'outer_outline' || lt === 'outer_silhouette' || lt === 'limb_contour' || lt === 'real_outline_lower' ? 50 : 60;
  if (isDetail) return params.detailsLast === false ? 45 : 70;
  return 25;
}
function blockTier(commands, pri) {
  const fn = typeof pri === 'function' ? pri : professionalPriority;
  let max = 0;
  for (const c of commands) if (c.type === 'stitch') max = Math.max(max, fn(c));
  return max || 25;
}
function professionalBlockKey(cmd) {
  return [
    String(cmd.color || '').toLowerCase(),
    cmd.regionId || '',
    cmd.objectId || '',
    cmd.layerType || '',
    cmd.stitchType || '',
  ].join('|');
}
function firstStitchInBlock(block) {
  return block.commands.find((c) => c.type === 'stitch' && Number.isFinite(c.x) && Number.isFinite(c.y));
}
function lastPositionIn(commands, fallback) {
  let pos = fallback;
  for (const c of commands) {
    if ((c.type === 'stitch' || c.type === 'jump') && Number.isFinite(c.x) && Number.isFinite(c.y)) {
      pos = { x: c.x, y: c.y, color: c.color, regionId: c.regionId };
    }
  }
  return pos;
}
function appendTravelTo(out, from, to, color, params = {}) {
  if (!from || !to) return;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist <= 0.5) return;
  const trimThreshold = Number(params.trimThreshold) || 3.5;
  const maxJump = Number(params.maxJumpLength) || 12.1;
  if (out.length > 0 && dist > trimThreshold) out.push({ type: 'trim', x: from.x, y: from.y, color, regionId: to.regionId, source: 'professional_block_reorder' });
  const steps = Math.max(1, Math.ceil(dist / maxJump));
  for (let s = 1; s <= steps; s++) {
    out.push({
      type: 'jump',
      x: from.x + (to.x - from.x) * s / steps,
      y: from.y + (to.y - from.y) * s / steps,
      color,
      regionId: to.regionId,
      source: 'professional_block_reorder',
    });
  }
}
export function reorderProfessionalLayers(commands, params = {}) {
  const input = Array.isArray(commands) ? commands : [];
  if (input.length === 0) return input;

  const blocks = [];
  let current = null;
  let pendingTravel = [];
  let endCommand = null;
  const flush = () => {
    if (!current || !current.commands.some((c) => c.type === 'stitch')) return;
    current.tier = blockTier(current.commands, (cmd) => professionalPriority(cmd, params));
    blocks.push(current);
    current = null;
    pendingTravel = [];
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (!c || c.type === 'colorChange') continue;
    if (c.type === 'end') { endCommand = c; continue; }
    if (c.type === 'stitch') {
      const key = professionalBlockKey(c);
      if (current && current.key === key) {
        current.commands.push(...pendingTravel, c);
        pendingTravel = [];
      } else {
        flush();
        current = {
          key,
          order: blocks.length,
          commands: [c],
          color: c.color || '#000000',
        };
      }
      continue;
    }
    if (c.type === 'jump' || c.type === 'trim') {
      if (current) pendingTravel.push(c);
      continue;
    }
    if (current) current.commands.push(c);
  }
  flush();

  if (blocks.length <= 1) return input.map((c) => c?.type === 'colorChange' ? { ...c, type: 'colorChange' } : c);

  const sorted = [...blocks].sort((a, b) => (a.tier - b.tier) || (a.order - b.order));
  const out = [];
  let currentColor = null;
  let lastPos = { x: 0, y: 0 };

  for (const block of sorted) {
    const first = firstStitchInBlock(block);
    if (!first) continue;
    if (currentColor !== null && String(currentColor).toLowerCase() !== String(block.color || '').toLowerCase()) {
      out.push({ type: 'colorChange', x: lastPos.x, y: lastPos.y, color: block.color, regionId: first.regionId });
    }
    appendTravelTo(out, lastPos, first, block.color, params);
    out.push(...block.commands);
    lastPos = lastPositionIn(block.commands, first);
    currentColor = block.color;
  }

  if (endCommand) out.push({ ...endCommand, x: lastPos.x, y: lastPos.y });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 5 — Reducción inteligente de colores
// ═══════════════════════════════════════════════════════════════════════════
export function professionalColorReducer(regions = [], commands = [], config = {}) {
  const p = { ...PROFESSIONAL_PARAMS, ...(config.professionalParams || {}) };
  // Collect colors with area weight
  const colorArea = new Map();
  for (const r of regions) {
    const c = (r.color || '#ffffff').toLowerCase();
    colorArea.set(c, (colorArea.get(c) || 0) + (r.area_mm2 || 100));
  }
  const colors = [...colorArea.keys()].sort((a, b) => (colorArea.get(b) || 0) - (colorArea.get(a) || 0));
  // Preserve dark detail colors (black) and small detail colors
  const preserve = new Set(colors.filter(c => isDarkColor(c)));
  // Small-area detail colors (<= 2% of total) preserved if distinct
  const totalArea = [...colorArea.values()].reduce((s, v) => s + v, 0) || 1;
  for (const c of colors) {
    if ((colorArea.get(c) || 0) / totalArea < 0.02) preserve.add(c);
  }
  // Greedy merge similar (skip preserved)
  const remap = new Map();
  const targets = [];
  for (const c of colors) {
    if (preserve.has(c)) { remap.set(c, c); targets.push(c); continue; }
    let best = null, bestD = Infinity;
    for (const t of targets) {
      if (preserve.has(t) && !isDarkColor(c)) { // don't merge a normal color into a preserved dark
        continue;
      }
      const d = colorDistance(c, t);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best && bestD < p.colorMergeLabDelta && (targets.filter(t => !preserve.has(t)).length + preserve.size) >= 1) {
      remap.set(c, best);
    } else {
      remap.set(c, c);
      targets.push(c);
    }
  }
  // Enforce maxColors: if still too many, force-merge closest non-preserved pairs
  let distinct = new Set(remap.values());
  let guard = 0;
  while (distinct.size > p.maxColors && guard++ < 50) {
    const arr = [...distinct].filter(c => !preserve.has(c));
    if (arr.length < 2) break;
    let a0 = arr[0], b0 = arr[1], d0 = colorDistance(a0, b0);
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const d = colorDistance(arr[i], arr[j]);
      if (d < d0) { d0 = d; a0 = arr[i]; b0 = arr[j]; }
    }
    // merge b0 → a0
    for (const [k, v] of remap) if (v === b0) remap.set(k, a0);
    distinct = new Set(remap.values());
  }
  const reducedRegions = regions.map(r => ({ ...r, color: remap.get((r.color || '#ffffff').toLowerCase()) || r.color }));
  const reducedCommands = commands.map(c => c.color ? { ...c, color: remap.get(c.color.toLowerCase()) || c.color } : c);
  const mergedSimilarColors = colors.filter(c => remap.get(c) !== c).length;
  const preservedDetailColors = [...preserve];
  return {
    reducedRegions, reducedCommands, remap,
    report: {
      originalColorCount: colors.length,
      reducedColorCount: new Set(remap.values()).size,
      mergedSimilarColors,
      preservedDetailColors,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 7 — Comparación Final Look vs Export
// ═══════════════════════════════════════════════════════════════════════════
export function compareFinalLookVsExport(finalLookCommands = [], exportCommands = []) {
  const countStitches = cmds => cmds.filter(c => c.type === 'stitch').length;
  const idsOf = cmds => new Set(cmds.filter(c => c.regionId).map(c => c.regionId));
  const simIds = idsOf(finalLookCommands), expIds = idsOf(exportCommands);
  const inSimNotExport = [...simIds].filter(id => !expIds.has(id));
  const inExportNotSim = [...expIds].filter(id => !simIds.has(id));
  return {
    finalLookStitches: countStitches(finalLookCommands),
    exportStitches: countStitches(exportCommands),
    stitchDelta: countStitches(finalLookCommands) - countStitches(exportCommands),
    simulationExportMismatch: countStitches(finalLookCommands) !== countStitches(exportCommands) || inSimNotExport.length > 0,
    objectsInSimNotExport: inSimNotExport,
    objectsInExportNotSim: inExportNotSim,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 6 — Quality Gate profesional
// ═══════════════════════════════════════════════════════════════════════════
export function professionalEmbroideryQualityGate(commands = [], objects = [], regions = [], darkStroke, config = {}) {
  const p = { ...PROFESSIONAL_PARAMS, ...(config.professionalParams || {}) };
  const vis = validateVisibleStitchesBeforeExport(commands, regions, darkStroke, config);
  // visibleDiagonalStitches: usa el clasificador de reparación (consistente con
  // repairVisibleDiagonalStitches) en lugar del contador legacy que solo medía
  // longitud+color. Esto refleja exactamente lo que el modo profesional repara.
  const visibleDiagonalStitches = countVisibleDiagonalStitches(commands, regions, darkStroke, config);
  const colorCount = new Set(commands.filter(c => c.color).map(c => c.color.toLowerCase())).size;

  let shortStitches = 0, duplicateStitches = 0, jumps = 0, trims = 0, fillAfterContour = false;
  let prev = null, firstContour = -1, lastFill = -1;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'jump') jumps++;
    if (c.type === 'trim') trims++;
    if (c.type === 'stitch') {
      if (prev) {
        const d = Math.hypot((c.x || 0) - prev.x, (c.y || 0) - prev.y);
        if (d < p.shortStitchMm && d > 0) shortStitches++;
        if (d < p.duplicateMm) duplicateStitches++;
      }
      prev = { x: c.x || 0, y: c.y || 0 };
      const lt = (c.layerType || '').toLowerCase();
      const isContour = lt.includes('outline') || lt.includes('contour') || lt.includes('facial') || lt.includes('detail');
      const isFill = c.stitchType === 'fill' || c.source === 'clipped_fill_optimized';
      if (isContour && firstContour < 0) firstContour = i;
      if (isFill) lastFill = i;
    }
  }
  fillAfterContour = firstContour >= 0 && lastFill > firstContour;

  // contour missing on one foot
  const w = 100, h = 100;
  const footZone = (x, y) => { if (y < h * 0.2) return null; if (x < -w * 0.05) return 'left'; if (x > w * 0.05) return 'right'; return null; };
  const footContour = { left: false, right: false };
  for (const o of objects) {
    const pts = o.points || [];
    if (pts.length < 2) continue;
    let cx = 0, cy = 0;
    for (const pt of pts) { cx += pt[0]; cy += pt[1]; }
    cx /= pts.length; cy /= pts.length;
    const z = footZone(cx, cy);
    if (z) footContour[z] = true;
  }
  const contourMissingOnOneFoot = footContour.left !== footContour.right;

  const satinContourCount = objects.filter(o => (o.layerType || '').toLowerCase().includes('outline') && o.stitch_type === 'satin').length;
  const runningContourCount = objects.filter(o => (o.layerType || '').toLowerCase().includes('outline') && o.stitch_type !== 'satin').length + objects.filter(o => (o.layerType || '').toLowerCase().includes('detail')).length;
  const fillRegionCount = (regions || []).filter(r => r.stitch_type === 'fill').length;
  const underlayCount = commands.filter(c => (c.layerType || '').toLowerCase().includes('underlay') || (c.source || '').toLowerCase().includes('underlay')).length;

  const blocks = [
    { name: 'visibleDiagonalStitches', fail: visibleDiagonalStitches > 0, value: visibleDiagonalStitches, limit: 0 },
    { name: 'unsupportedLongStitches', fail: vis.report.stitchWithoutDarkMaskSupport > 0, value: vis.report.stitchWithoutDarkMaskSupport, limit: 0 },
    { name: 'contourMissingOnOneFoot', fail: contourMissingOnOneFoot, value: contourMissingOnOneFoot, limit: 0 },
    { name: 'fillAfterContour', fail: fillAfterContour, value: fillAfterContour, limit: 0 },
    { name: 'colorCountOver8', fail: colorCount > p.maxColors, value: colorCount, limit: p.maxColors },
    { name: 'duplicateStitches', fail: duplicateStitches > 200, value: duplicateStitches, limit: 200 },
    { name: 'shortStitches', fail: shortStitches > 300, value: shortStitches, limit: 300 },
    { name: 'jumps', fail: jumps > 250, value: jumps, limit: 250 },
    { name: 'trims', fail: trims > 80, value: trims, limit: 80 },
  ];
  const failed = blocks.filter(b => b.fail).map(b => b.name);
  let score = 100;
  if (visibleDiagonalStitches > 0) score -= 30;
  if (contourMissingOnOneFoot) score -= 20;
  if (fillAfterContour) score -= 15;
  if (colorCount > p.maxColors) score -= 10;
  if (duplicateStitches > 200) score -= 5;
  if (shortStitches > 300) score -= 5;
  if (jumps > 250) score -= 5;
  score = Math.max(0, score);

  return {
    visibleDiagonalStitches,
    unsupportedTravelStitches: vis.report.unsupportedTravelStitches,
    satinContourCount, runningContourCount, fillRegionCount, underlayCount,
    colorCount, colorCountBefore: colorCount, colorCountAfter: colorCount,
    shortStitches, duplicateStitches, jumps, trims,
    fillAfterContour, contourMissingOnOneFoot,
    professionalScore: score,
    failedBlocks: failed,
    blocks,
    passed: failed.length === 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PIPELINE — aplica todas las fases al output de buildFinalCommands
// ═══════════════════════════════════════════════════════════════════════════
export function applyProfessionalPipeline({ commands, objects, regions, config, darkStroke }) {
  if (!config?.professionalMode) return { commands, objects, report: null };

  // ── Reference Learning Engine v2: apply learned preset (gated) ──────────────
  // When the project config carries learned* keys (from applyLearnedProfileToMotor),
  // project them onto professionalParams so the existing phases use professional
  // values mined from the corpus. Absent keys → default behavior unchanged
  // (regression suite runs without learned config).
  const learnedParams = {};
  if (config.learnedMaxVisibleStitchMm != null) {
    learnedParams.maxVisibleStitchMm = config.learnedMaxVisibleStitchMm;
    learnedParams.suspiciousDiagonalMinMm = Math.min(
      PROFESSIONAL_PARAMS.suspiciousDiagonalMinMm,
      config.learnedMaxVisibleStitchMm,
    );
  }
  if (config.learnedMaxColorCount != null) learnedParams.maxColors = config.learnedMaxColorCount;
  if (config.learnedSatinWidthMm != null) learnedParams.satinWidthMm = config.learnedSatinWidthMm;
  if (config.learnedFillStitchLengthMm != null) learnedParams.fillStitchLenMm = config.learnedFillStitchLengthMm;
  // ── Density / angle / pull-compensation (auto-applied from reference corpus) ──
  if (config.learnedFillDensityMm != null) learnedParams.fillDensityMm = config.learnedFillDensityMm;
  if (config.learnedFillAngleDeg != null) learnedParams.fillAngleDeg = config.learnedFillAngleDeg;
  if (config.learnedSatinColumnSpacingMm != null) learnedParams.satinDensityMm = config.learnedSatinColumnSpacingMm;
  if (config.learnedPullCompensationMm != null) learnedParams.pullCompMm = config.learnedPullCompensationMm;
  // ── Travel rules from learned preset (FASE 6) ──
  // convertTravelAboveMmToJump → cualquier stitch > este umbral sin soporte de
  //   región se convierte en jump+trim (travel oculto). Mapea a longConnectorMm
  //   que usa el clasificador de diagonales.
  if (config.learnedConvertTravelAboveMmToJump != null) {
    learnedParams.longConnectorMm = config.learnedConvertTravelAboveMmToJump;
  }
  // trimBeforeTravelMm → inserta trim antes de cualquier salto > este umbral.
  //   Se aplica como un pase adicional en el pipeline.
  if (config.learnedTrimBeforeTravelMm != null) {
    learnedParams.trimBeforeTravelMm = config.learnedTrimBeforeTravelMm;
  }
  // ── Capa / contorno (CARTOON_OUTLINE_PROFESSIONAL_OVERRIDE + preset) ──
  // Estas keys controlan orden de capas (contourAfterFill, detailsLast) y la
  // conversión satin↔running del contorno exterior. Sin learned* → default
  // (contour tras fill, satin outer, details al final) → regresión intacta.
  if (config.learnedContourAfterFill != null) learnedParams.contourAfterFill = config.learnedContourAfterFill;
  if (config.learnedUseSatinForOuterContours != null) learnedParams.useSatinForOuterContours = config.learnedUseSatinForOuterContours;
  if (config.learnedDetailsLast != null) learnedParams.detailsLast = config.learnedDetailsLast;
  if (config.learnedUnderlayEnabled != null) learnedParams.underlayEnabled = config.learnedUnderlayEnabled;
  const effectiveConfig = Object.keys(learnedParams).length
    ? { ...config, professionalParams: { ...(config.professionalParams || {}), ...learnedParams } }
    : config;

  // FASE 2 — separar color real vs cambio de hilo / bloque de color
  const colorSequenceBefore = auditProfessionalColorSequence(commands);

  // FASE 5 — reducción de colores primero (afecta colores de commands)
  const colorRes = professionalColorReducer(regions, commands, effectiveConfig);
  let procCommands = colorRes.reducedCommands;
  const procRegions = colorRes.reducedRegions;

  // FASE 2 — reordenar capas (respeta contourAfterFill + detailsLast del preset)
  procCommands = reorderProfessionalLayers(procCommands, {
    contourAfterFill: effectiveConfig.professionalParams?.contourAfterFill,
    detailsLast: effectiveConfig.professionalParams?.detailsLast,
  });

  // ── UNDERLAY_GENERATOR_V1 ────────────────────────────────────────────────
  // Fase post-generador, transaccional y reversible. Se ejecuta antes de la
  // reparación de diagonales/travel para que cualquier riesgo introducido quede
  // cubierto por los guards existentes. No toca motor base ni exportación.
  let underlayGenerator = null;
  if (effectiveConfig.professionalMode === true && effectiveConfig.learnedUnderlayEnabled === true) {
    const underlayRes = generateCenterlineUnderlayGuardedV1(procCommands, {
      objects, regions: procRegions, config: effectiveConfig, darkStroke,
    });
    procCommands = underlayRes.commands;
    underlayGenerator = underlayRes.report;
  }

  // ── SATIN_PHASE_ORDER_FIX_V1 ─────────────────────────────────────────────
  // SATIN_OUTER_CONTOUR_CONVERTER_V1 se ejecuta después de Trim Guard +
  // Splitter V1_2 y justo antes del quality gate final.
  let satinOuterContourConverter = null;
  let satinPhaseOrderFix = null;

  // FASE 1 (real) — reparar diagonales visibles ANTES del gate y de exportar.
  // Cuenta las diagonales sospechosas en bruto, repara (trim+jump) y luego el
  // gate se evalúa sobre los comandos ya reparados.
  const diagonalBefore = countVisibleDiagonalStitches(procCommands, procRegions, darkStroke, effectiveConfig);
  const repair = repairVisibleDiagonalStitches(procCommands, procRegions, darkStroke, effectiveConfig);
  procCommands = repair.commands;
  // Mantener el sanitize legacy para travel/long-black restante (no toca diagonales ya reparadas)
  const vis = validateVisibleStitchesBeforeExport(procCommands, procRegions, darkStroke, effectiveConfig);
  procCommands = vis.commands;

  // ── CARTOON_OUTLINE_PROFESSIONAL_OVERRIDE / preset flags — efecto real ──
  // useSatinForOuterContours=false → convierte satin de contorno exterior en
  //   running stitch (centerline). useSatinForOuterContours=true (override
  //   cartoon) → mantiene satin (default). Afecta a objects + commands reales.
  if (effectiveConfig.professionalParams?.useSatinForOuterContours === false) {
    procCommands = convertOuterSatinToRunning(procCommands);
    objects = markOuterObjectsAsRunning(objects);
  }

  // ── FASE 6 — trim antes de saltos largos (regla aprendida J002) ──
  // REFERENCE_TRIM_GUARD_V1: versión protegida — mide, presupuesta, filtra y
  // revierte la fase completa si empeora métricas críticas. No elimina
  // insertTrimBeforeLongJumps (legacy intacto).
  const trimBeforeMm = effectiveConfig.professionalParams?.trimBeforeTravelMm;
  let trimGuard = null;
  if (trimBeforeMm && trimBeforeMm > 0) {
    const guardRes = insertTrimBeforeLongJumpsGuarded(procCommands, trimBeforeMm, {
      objects, regions: procRegions, config: effectiveConfig, darkStroke,
    });
    procCommands = guardRes.commands;
    trimGuard = guardRes.report;
  }

  // ── FASE 6b — REFERENCE_VISIBLE_STITCH_SPLITTER_V1 ─────────────────────────
  // Divide puntadas de relleno largas que superen learnedMaxVisibleStitchMm.
  // Activación gated + guard transaccional. No toca generador base.
  let visibleSplitter = null;
  const learnedMaxVis = effectiveConfig.learnedMaxVisibleStitchMm;
  if (learnedMaxVis != null && learnedMaxVis >= 2.5 && learnedMaxVis <= 8) {
    const splitRes = splitLongVisibleFillStitchesGuardedV1_1(procCommands, learnedMaxVis, {
      objects, regions: procRegions, config: effectiveConfig, darkStroke,
    });
    procCommands = splitRes.commands;
    visibleSplitter = splitRes.report;
  }

  // ── SATIN_OUTER_CONTOUR_CONVERTER_V1 — después de Trim Guard + Splitter ──
  const splitterStatusBeforeSatin = visibleSplitter?.phaseStatus || (visibleSplitter ? (visibleSplitter.phaseAccepted ? 'ACCEPTED' : 'REVERTED') : 'NOT_RUN');
  const commandsSourceBeforeSatin = visibleSplitter?.commandsReturnedSource || (trimGuard ? (trimGuard.phaseAccepted ? 'trimGuard' : 'beforeTrimGuard') : 'postTravelRepair');
  if (effectiveConfig.professionalMode === true && effectiveConfig.learnedUseSatinForOuterContours === true) {
    const satinRes = convertRunningOuterContoursToSatinGuardedV1(procCommands, {
      objects, regions: procRegions, config: effectiveConfig, darkStroke,
    });
    procCommands = satinRes.commands;
    objects = satinRes.objects;
    satinOuterContourConverter = satinRes.report;
  }

  // FASE 6 — quality gate (sobre comandos reparados + SATIN si fue aceptado)
  const colorSequenceAfter = auditProfessionalColorSequence(procCommands);
  const gate = professionalEmbroideryQualityGate(procCommands, objects, procRegions, darkStroke, effectiveConfig);
  gate.colorCountBefore = colorRes.report.originalColorCount;
  gate.colorCountAfter = colorRes.report.reducedColorCount;
  // Métricas de reparación de diagonales (FASE 1 real)
  gate.visibleDiagonalStitchesBefore = diagonalBefore;
  gate.visibleDiagonalStitchesAfter = gate.visibleDiagonalStitches;
  gate.removedVisibleDiagonalStitches = repair.report.removedVisibleDiagonalStitches;
  gate.convertedDiagonalToJump = repair.report.convertedDiagonalToJump;
  gate.longestRemovedDiagonalMm = repair.report.longestRemovedDiagonalMm;
  gate.repairedCommandsUsedForExport = true;

  const satinSafeToKeep = !!satinOuterContourConverter &&
    satinOuterContourConverter.phaseAccepted === true &&
    satinOuterContourConverter.afterSatinContourCount > satinOuterContourConverter.beforeSatinContourCount &&
    satinOuterContourConverter.afterRunningContourCount <= satinOuterContourConverter.beforeRunningContourCount &&
    satinOuterContourConverter.afterVisibleDiagonalStitches <= satinOuterContourConverter.beforeVisibleDiagonalStitches &&
    satinOuterContourConverter.afterJumpCount <= satinOuterContourConverter.beforeJumpCount + 10 &&
    satinOuterContourConverter.afterTrimCount <= satinOuterContourConverter.beforeTrimCount + 10 &&
    satinOuterContourConverter.afterCE01Status !== 'INVALID' &&
    satinOuterContourConverter.afterFinalLookExportMismatch === false &&
    satinOuterContourConverter.afterProfessionalScore >= satinOuterContourConverter.beforeProfessionalScore - 3;

  satinPhaseOrderFix = {
    version: 'SATIN_PHASE_ORDER_FIX_V1',
    oldOrder: ['colorReducer', 'reorderLayers', 'satinOuterContourConverter', 'visibleDiagonalRepair', 'travelSanitize', 'outerSatinToRunning', 'trimGuard', 'visibleSplitter', 'qualityGate'],
    newOrder: ['colorReducer', 'reorderLayers', 'underlayGenerator', 'visibleDiagonalRepair', 'travelSanitize', 'outerSatinToRunning', 'trimGuard', 'visibleSplitter', 'satinOuterContourConverter', 'qualityGate'],
    satinMovedAfterTrimGuard: true,
    satinMovedAfterSplitter: true,
    satinRunsBeforeFinalQualityGate: true,
    satinRunsOnlyOnce: true,
    splitterStatusBeforeSatin,
    commandsSourceBeforeSatin,
    commandsSourceAfterSatin: satinOuterContourConverter ? (satinOuterContourConverter.phaseAccepted ? 'satinAccepted' : 'beforeSatin') : commandsSourceBeforeSatin,
    integratedValidation: true,
    trimGuardApplied: !!trimGuard,
    visibleSplitterStatus: splitterStatusBeforeSatin,
    satinPhaseApplied: !!satinOuterContourConverter,
    qualityGateMeasuredFinalReturnedCommands: true,
    safeToKeepSatin: satinSafeToKeep,
    beforeSatin: satinOuterContourConverter ? {
      stitchCount: satinOuterContourConverter.beforeStitchCount,
      jumpCount: satinOuterContourConverter.beforeJumpCount,
      trimCount: satinOuterContourConverter.beforeTrimCount,
      visibleDiagonalStitches: satinOuterContourConverter.beforeVisibleDiagonalStitches,
      maxVisibleStitchMm: satinOuterContourConverter.beforeMaxVisibleStitchMm,
      satinContourCount: satinOuterContourConverter.beforeSatinContourCount,
      runningContourCount: satinOuterContourConverter.beforeRunningContourCount,
      underlayCount: satinOuterContourConverter.beforeUnderlayCount,
      professionalScore: satinOuterContourConverter.beforeProfessionalScore,
      finalLookExportMismatch: satinOuterContourConverter.beforeFinalLookExportMismatch,
      ce01Status: satinOuterContourConverter.beforeCE01Status,
    } : null,
    afterSatin: satinOuterContourConverter ? {
      stitchCount: satinOuterContourConverter.afterStitchCount,
      jumpCount: satinOuterContourConverter.afterJumpCount,
      trimCount: satinOuterContourConverter.afterTrimCount,
      visibleDiagonalStitches: satinOuterContourConverter.afterVisibleDiagonalStitches,
      maxVisibleStitchMm: satinOuterContourConverter.afterMaxVisibleStitchMm,
      satinContourCount: satinOuterContourConverter.afterSatinContourCount,
      runningContourCount: satinOuterContourConverter.afterRunningContourCount,
      underlayCount: satinOuterContourConverter.afterUnderlayCount,
      professionalScore: satinOuterContourConverter.afterProfessionalScore,
      finalLookExportMismatch: satinOuterContourConverter.afterFinalLookExportMismatch,
      ce01Status: satinOuterContourConverter.afterCE01Status,
    } : null,
    finalQualityGate: {
      stitchCount: procCommands.filter((c) => c.type === 'stitch').length,
      jumpCount: procCommands.filter((c) => c.type === 'jump').length,
      trimCount: procCommands.filter((c) => c.type === 'trim').length,
      visibleDiagonalStitches: gate.visibleDiagonalStitches,
      satinContourCount: gate.satinContourCount,
      runningContourCount: gate.runningContourCount,
      underlayCount: gate.underlayCount,
      professionalScore: gate.professionalScore,
    },
    codeFilesModified: ['src/lib/professionalDigitizingMode.js'],
  };

  const underlaySafeToKeep = !!underlayGenerator &&
    underlayGenerator.phaseAccepted === true &&
    underlayGenerator.underlayCountAfter > underlayGenerator.underlayCountBefore &&
    underlayGenerator.visibleDiagonalStitchesAfter <= underlayGenerator.visibleDiagonalStitchesBefore &&
    underlayGenerator.emptyBlocksAfter <= underlayGenerator.emptyBlocksBefore &&
    underlayGenerator.unsupportedLongStitchesAfter <= underlayGenerator.unsupportedLongStitchesBefore &&
    underlayGenerator.jumpCountAfter <= underlayGenerator.jumpCountBefore + 6 &&
    underlayGenerator.trimCountAfter <= underlayGenerator.trimCountBefore + 6 &&
    underlayGenerator.ce01StatusAfter !== 'INVALID' &&
    underlayGenerator.finalLookExportMismatchAfter === false &&
    underlayGenerator.professionalScoreAfter >= underlayGenerator.professionalScoreBefore - 3 &&
    underlayGenerator.stitchCountAfter <= underlayGenerator.stitchCountBefore + underlayGenerator.maxAddedUnderlayStitches;

  const underlayIntegratedValidation = {
    version: 'REFERENCE_INTEGRATED_PIPELINE_AFTER_UNDERLAY_V1',
    integratedValidation: true,
    order: ['buildFinalCommands', 'applyProfessionalPipeline', 'reorderProfessionalLayers', 'UNDERLAY_GENERATOR_V1', 'visibleDiagonalRepair', 'travelSanitize', 'REFERENCE_TRIM_GUARD_V1', 'REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2', 'SATIN_OUTER_CONTOUR_CONVERTER_V1', 'professionalEmbroideryQualityGate'],
    underlayPhaseApplied: !!underlayGenerator,
    underlayPhaseAccepted: underlayGenerator?.phaseAccepted === true,
    trimGuardApplied: !!trimGuard,
    visibleSplitterStatus: splitterStatusBeforeSatin,
    satinPhaseApplied: !!satinOuterContourConverter,
    qualityGateMeasuredFinalReturnedCommands: true,
    safeToKeepUnderlay: underlaySafeToKeep,
    underlayReport: underlayGenerator,
    finalQualityGate: {
      underlayCount: gate.underlayCount,
      stitchCount: procCommands.filter((c) => c.type === 'stitch').length,
      jumpCount: procCommands.filter((c) => c.type === 'jump').length,
      trimCount: procCommands.filter((c) => c.type === 'trim').length,
      visibleDiagonalStitches: gate.visibleDiagonalStitches,
      emptyBlocks: countEmptyColorBlocks(procCommands),
      professionalScore: gate.professionalScore,
    },
  };
  underlayIntegratedValidation.md = buildUnderlayIntegratedReportMd(underlayIntegratedValidation);

  return {
    commands: procCommands,
    objects,
    regions: procRegions,
    report: {
      color: colorRes.report,
      colorSequence: { before: colorSequenceBefore, after: colorSequenceAfter },
      visible: vis.report,
      repair: repair.report,
      gate,
      underlayGenerator,
      underlayIntegratedValidation,
      trimGuard,
      visibleSplitter,
      satinOuterContourConverter,
      satinPhaseOrderFix,
      integratedSatinValidation: satinPhaseOrderFix,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SATIN_OUTER_CONTOUR_CONVERTER_V1 — running outer contour → satin contour
// ═══════════════════════════════════════════════════════════════════════════
function isContourConverterRunningCandidate(cmd) {
  if (!cmd || cmd.type !== 'stitch') return false;
  const st = String(cmd.stitchType || '').toLowerCase();
  const lt = String(cmd.layerType || '').toLowerCase();
  const src = String(cmd.source || '').toLowerCase();
  const role = String(cmd.role || cmd.region_class || '').toLowerCase();
  const contourLike = st === 'running_stitch' || lt === 'contour' || lt.includes('outline') || src.includes('contour') || role.includes('outline');
  if (!contourLike) return false;
  if (st.includes('fill') || lt.includes('fill') || lt.includes('underlay') || src.includes('underlay')) return false;
  if (lt.includes('tie') || src.includes('tie')) return false;
  return true;
}
function contourConverterSkipReason(cmd) {
  const lt = String(cmd.layerType || '').toLowerCase();
  const src = String(cmd.source || '').toLowerCase();
  const role = String(cmd.role || cmd.region_class || '').toLowerCase();
  const text = `${lt} ${src} ${role}`;
  if (text.includes('eye') || text.includes('mouth') || text.includes('facial') || text.includes('detail') || text.includes('small')) return 'detail';
  if (!(isDarkColor(cmd.color) || text.includes('outer') || text.includes('outline') || text.includes('contour'))) return 'interiorContour';
  if (!cmd.regionId && !cmd.objectId) return 'noStableRegion';
  return null;
}
function stableContourKey(cmd) {
  return [cmd.color || '', cmd.regionId || '', cmd.objectId || '', cmd.layerType || '', cmd.stitchType || ''].join('|');
}
function hasUnsafeContourGeometry(block) {
  if (!block || block.length < 3) return true;
  for (const c of block) {
    if (typeof c.x !== 'number' || typeof c.y !== 'number' || Number.isNaN(c.x) || Number.isNaN(c.y)) return true;
  }
  let length = 0;
  for (let i = 1; i < block.length; i++) length += Math.hypot((block[i].x ?? 0) - (block[i - 1].x ?? 0), (block[i].y ?? 0) - (block[i - 1].y ?? 0));
  return length < 1.5;
}
function countRunningContourCommands(commands) {
  return commands.filter((c) => c.type === 'stitch' && isContourConverterRunningCandidate(c) && !String(c.stitchType || '').toLowerCase().includes('satin')).length;
}
function measureSatinConverterMetrics(commands, objects, regions, config, darkStroke) {
  const gate = professionalEmbroideryQualityGate(commands, objects || [], regions || [], darkStroke, config || {});
  const ce01 = validateCE01(commands, objects || [], regions || [], config || {}, {});
  const cmp = compareFinalLookVsExport(commands, commands);
  return {
    satinContourCount: gate.satinContourCount ?? 0,
    runningContourCount: gate.runningContourCount ?? countRunningContourCommands(commands),
    stitchCount: commands.filter((c) => c.type === 'stitch').length,
    jumpCount: commands.filter((c) => c.type === 'jump').length,
    trimCount: commands.filter((c) => c.type === 'trim').length,
    visibleDiagonalStitches: gate.visibleDiagonalStitches ?? 0,
    maxVisibleStitchMm: maxVisibleStitchMmLocal(commands),
    underlayCount: gate.underlayCount ?? commands.filter((c) => String(c.layerType || '').toLowerCase().includes('underlay') || String(c.source || '').toLowerCase().includes('underlay')).length,
    emptyBlocks: countEmptyColorBlocks(commands),
    unsupportedLongStitches: gate.blocks?.find((b) => b.name === 'unsupportedLongStitches')?.value ?? 0,
    ce01Status: ce01.status,
    professionalScore: gate.professionalScore ?? 0,
    finalLookExportMismatch: cmp.simulationExportMismatch === true,
  };
}
export function convertRunningOuterContoursToSatinGuardedV1(commands = [], options = {}) {
  const { objects, regions, config, darkStroke } = options;
  const beforeCommandCount = commands.length;
  const rawWidth = config?.learnedSatinWidthMm ?? config?.satinWidthMm ?? config?.professionalParams?.satinWidthMm ?? 1.2;
  const rawWidthNum = Number(rawWidth) || 1.2;
  const width = Math.max(0.8, Math.min(3.0, rawWidthNum));
  const before = measureSatinConverterMetrics(commands, objects, regions, config, darkStroke);
  const maxConvertedContourBlocks = 6;
  const maxAddedCommands = Math.min(300, Math.max(40, Math.ceil(beforeCommandCount * 0.05)));
  const skip = { tooThin: 0, detail: 0, interiorContour: 0, unsafeGeometry: 0, noStableRegion: 0 };

  if (config?.professionalMode !== true || config?.learnedUseSatinForOuterContours !== true || before.ce01Status === 'INVALID' || before.runningContourCount <= 0) {
    const report = buildSatinOuterContourConverterReport({
      phaseAccepted: false,
      revertReason: before.ce01Status === 'INVALID' ? 'CE01 INVALID antes de la fase' : 'activation conditions not met',
      candidatesFound: 0,
      candidatesConverted: 0,
      candidatesSkippedTooThin: 0,
      candidatesSkippedDetail: 0,
      candidatesSkippedInteriorContour: 0,
      candidatesSkippedUnsafeGeometry: 0,
      candidatesSkippedNoStableRegion: 0,
      before, after: before,
    });
    return { commands, objects, report };
  }

  const candidates = [];
  let current = [];
  let currentKey = null;
  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const reason = contourConverterSkipReason(first);
    if (rawWidthNum < 0.8) skip.tooThin++;
    else if (reason) skip[reason]++;
    else if (hasUnsafeContourGeometry(current)) skip.unsafeGeometry++;
    else candidates.push({ start: first.__idx, indexes: current.map((c) => c.__idx), block: current });
    current = [];
    currentKey = null;
  };

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (isContourConverterRunningCandidate(c) && !String(c.stitchType || '').toLowerCase().includes('satin')) {
      const key = stableContourKey(c);
      if (current.length && key !== currentKey) flush();
      current.push({ ...c, __idx: i });
      currentKey = key;
    } else {
      flush();
    }
  }
  flush();

  const applied = new Set();
  const appliedRegionIds = new Set();
  const appliedObjectIds = new Set();
  const accepted = candidates.slice(0, maxConvertedContourBlocks);
  for (const cand of accepted) {
    for (const idx of cand.indexes) {
      applied.add(idx);
      const cmd = commands[idx];
      if (cmd?.regionId) appliedRegionIds.add(cmd.regionId);
      if (cmd?.objectId) appliedObjectIds.add(cmd.objectId);
    }
  }

  const out = commands.map((c, i) => {
    if (!applied.has(i)) return c;
    const src = c.source ? `${c.source}:SATIN_OUTER_CONTOUR_CONVERTER_V1` : 'SATIN_OUTER_CONTOUR_CONVERTER_V1';
    return {
      ...c,
      stitchType: 'satin',
      layerType: 'contour',
      source: src,
      generatedBy: 'SATIN_OUTER_CONTOUR_CONVERTER_V1',
      convertedFromRunningContour: true,
      satinWidthMm: width,
      isOuterContour: true,
    };
  });
  const outObjects = Array.isArray(objects) ? objects.map((o) => {
    const txt = `${String(o.layerType || '').toLowerCase()} ${String(o.source || '').toLowerCase()}`;
    const stableMatch = (o.id && (appliedRegionIds.has(o.id) || appliedObjectIds.has(o.id))) ||
      (o.regionId && appliedRegionIds.has(o.regionId)) ||
      (o.objectId && appliedObjectIds.has(o.objectId));
    if (stableMatch && (txt.includes('outer') || txt.includes('outline') || txt.includes('contour')) && o.stitch_type !== 'satin') {
      return { ...o, stitch_type: 'satin', satinWidthMm: width, generatedBy: 'SATIN_OUTER_CONTOUR_CONVERTER_V1' };
    }
    return o;
  }) : objects;

  let badCoords = false;
  for (const c of out) {
    if ((c.type === 'stitch' || c.type === 'jump') && (typeof c.x !== 'number' || typeof c.y !== 'number' || Number.isNaN(c.x) || Number.isNaN(c.y))) { badCoords = true; break; }
  }
  const afterExperimental = measureSatinConverterMetrics(out, outObjects, regions, config, darkStroke);
  let revertReason = null;
  if (afterExperimental.satinContourCount <= before.satinContourCount) revertReason = 'afterSatinContourCount <= beforeSatinContourCount';
  else if (afterExperimental.visibleDiagonalStitches > before.visibleDiagonalStitches) revertReason = 'visibleDiagonalStitches subió';
  else if (afterExperimental.emptyBlocks > before.emptyBlocks) revertReason = 'emptyBlocks subió';
  else if (afterExperimental.unsupportedLongStitches > before.unsupportedLongStitches) revertReason = 'unsupportedLongStitches subió';
  else if (afterExperimental.ce01Status === 'INVALID') revertReason = 'CE01 pasó a INVALID';
  else if (afterExperimental.finalLookExportMismatch === true) revertReason = 'finalLookExportMismatch pasó a true';
  else if (afterExperimental.professionalScore < before.professionalScore - 3) revertReason = 'professionalScore bajó más de 3';
  else if (afterExperimental.jumpCount > before.jumpCount + 10) revertReason = 'jumpCount subió más de 10';
  else if (afterExperimental.trimCount > before.trimCount + 10) revertReason = 'trimCount subió más de 10';
  else if (afterExperimental.stitchCount > before.stitchCount + maxAddedCommands) revertReason = 'stitchCount excede presupuesto';
  else if (badCoords) revertReason = 'comando con x/y no numérico';

  const phaseAccepted = !revertReason;
  const finalCommands = phaseAccepted ? out : commands;
  const finalObjects = phaseAccepted ? outObjects : objects;
  const after = phaseAccepted ? afterExperimental : before;
  const report = buildSatinOuterContourConverterReport({
    phaseAccepted,
    revertReason,
    candidatesFound: candidates.length,
    candidatesConverted: phaseAccepted ? accepted.length : 0,
    candidatesSkippedTooThin: skip.tooThin,
    candidatesSkippedDetail: skip.detail,
    candidatesSkippedInteriorContour: skip.interiorContour,
    candidatesSkippedUnsafeGeometry: skip.unsafeGeometry,
    candidatesSkippedNoStableRegion: skip.noStableRegion,
    before,
    after,
  });
  return { commands: finalCommands, objects: finalObjects, report };
}
function buildSatinOuterContourConverterReport(r) {
  const report = {
    version: 'SATIN_OUTER_CONTOUR_CONVERTER_V1',
    phaseAccepted: r.phaseAccepted,
    revertReason: r.revertReason,
    candidatesFound: r.candidatesFound,
    candidatesConverted: r.candidatesConverted,
    candidatesSkippedTooThin: r.candidatesSkippedTooThin,
    candidatesSkippedDetail: r.candidatesSkippedDetail,
    candidatesSkippedInteriorContour: r.candidatesSkippedInteriorContour,
    candidatesSkippedUnsafeGeometry: r.candidatesSkippedUnsafeGeometry,
    candidatesSkippedNoStableRegion: r.candidatesSkippedNoStableRegion,
    beforeSatinContourCount: r.before.satinContourCount,
    afterSatinContourCount: r.after.satinContourCount,
    beforeRunningContourCount: r.before.runningContourCount,
    afterRunningContourCount: r.after.runningContourCount,
    beforeStitchCount: r.before.stitchCount,
    afterStitchCount: r.after.stitchCount,
    beforeJumpCount: r.before.jumpCount,
    afterJumpCount: r.after.jumpCount,
    beforeTrimCount: r.before.trimCount,
    afterTrimCount: r.after.trimCount,
    beforeVisibleDiagonalStitches: r.before.visibleDiagonalStitches,
    afterVisibleDiagonalStitches: r.after.visibleDiagonalStitches,
    beforeMaxVisibleStitchMm: r.before.maxVisibleStitchMm,
    afterMaxVisibleStitchMm: r.after.maxVisibleStitchMm,
    beforeUnderlayCount: r.before.underlayCount,
    afterUnderlayCount: r.after.underlayCount,
    beforeEmptyBlocks: r.before.emptyBlocks,
    afterEmptyBlocks: r.after.emptyBlocks,
    beforeUnsupportedLongStitches: r.before.unsupportedLongStitches,
    afterUnsupportedLongStitches: r.after.unsupportedLongStitches,
    beforeCE01Status: r.before.ce01Status,
    afterCE01Status: r.after.ce01Status,
    beforeProfessionalScore: r.before.professionalScore,
    afterProfessionalScore: r.after.professionalScore,
    beforeFinalLookExportMismatch: r.before.finalLookExportMismatch,
    afterFinalLookExportMismatch: r.after.finalLookExportMismatch,
  };
  report.md = buildSatinOuterContourConverterReportMd(report);
  report.referenceValidationMd = buildSatinOuterContourReferenceValidationMd(report);
  return report;
}
function buildSatinOuterContourConverterReportMd(r) {
  const md = [];
  md.push('# SATIN_OUTER_CONTOUR_CONVERTER_REPORT_V1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Fase reversible: running outer contour → satin contour. No toca contourExportBuilder, buildFinalCommands, encoders, CE01 validator ni V5.1.\n');
  md.push('## Veredicto');
  md.push(`- **phaseAccepted**: ${r.phaseAccepted}`);
  if (!r.phaseAccepted) md.push(`- **revertReason**: ${r.revertReason}`);
  md.push('\n## Candidatos');
  md.push(`- candidatesFound: ${r.candidatesFound}`);
  md.push(`- candidatesConverted: ${r.candidatesConverted}`);
  md.push(`- candidatesSkippedTooThin: ${r.candidatesSkippedTooThin}`);
  md.push(`- candidatesSkippedDetail: ${r.candidatesSkippedDetail}`);
  md.push(`- candidatesSkippedInteriorContour: ${r.candidatesSkippedInteriorContour}`);
  md.push(`- candidatesSkippedUnsafeGeometry: ${r.candidatesSkippedUnsafeGeometry}`);
  md.push(`- candidatesSkippedNoStableRegion: ${r.candidatesSkippedNoStableRegion}`);
  md.push('\n## Métricas antes/después');
  md.push('| Métrica | Antes | Después |');
  md.push('|---|---:|---:|');
  md.push(`| satinContourCount | ${r.beforeSatinContourCount} | ${r.afterSatinContourCount} |`);
  md.push(`| runningContourCount | ${r.beforeRunningContourCount} | ${r.afterRunningContourCount} |`);
  md.push(`| stitchCount | ${r.beforeStitchCount} | ${r.afterStitchCount} |`);
  md.push(`| jumpCount | ${r.beforeJumpCount} | ${r.afterJumpCount} |`);
  md.push(`| trimCount | ${r.beforeTrimCount} | ${r.afterTrimCount} |`);
  md.push(`| visibleDiagonalStitches | ${r.beforeVisibleDiagonalStitches} | ${r.afterVisibleDiagonalStitches} |`);
  md.push(`| emptyBlocks | ${r.beforeEmptyBlocks} | ${r.afterEmptyBlocks} |`);
  md.push(`| unsupportedLongStitches | ${r.beforeUnsupportedLongStitches} | ${r.afterUnsupportedLongStitches} |`);
  md.push(`| CE01Status | ${r.beforeCE01Status} | ${r.afterCE01Status} |`);
  md.push(`| professionalScore | ${r.beforeProfessionalScore} | ${r.afterProfessionalScore} |`);
  md.push(`| finalLookExportMismatch | ${r.beforeFinalLookExportMismatch} | ${r.afterFinalLookExportMismatch} |`);
  md.push('\n---');
  md.push('_SATIN_OUTER_CONTOUR_CONVERTER_V1 — fase post-generador segura y transaccional._');
  return md.join('\n');
}
function buildSatinOuterContourReferenceValidationMd(r) {
  const verdict = r.afterProfessionalScore > r.beforeProfessionalScore ? 'IMPROVED' : r.afterProfessionalScore < r.beforeProfessionalScore ? 'WORSENED' : 'NEUTRAL';
  const md = [];
  md.push('# REFERENCE_LEARNING_VALIDATED_REPORT_AFTER_SATIN_OUTER_CONTOUR\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push(`> verdict: **${verdict}**\n`);
  md.push('| Métrica | Before | After |');
  md.push('|---|---:|---:|');
  md.push(`| stitchCount | ${r.beforeStitchCount} | ${r.afterStitchCount} |`);
  md.push(`| jumpCount | ${r.beforeJumpCount} | ${r.afterJumpCount} |`);
  md.push(`| trimCount | ${r.beforeTrimCount} | ${r.afterTrimCount} |`);
  md.push(`| visibleDiagonalStitches | ${r.beforeVisibleDiagonalStitches} | ${r.afterVisibleDiagonalStitches} |`);
  md.push(`| maxVisibleStitchMm | ${r.beforeMaxVisibleStitchMm.toFixed(2)} | ${r.afterMaxVisibleStitchMm.toFixed(2)} |`);
  md.push(`| satinContourCount | ${r.beforeSatinContourCount} | ${r.afterSatinContourCount} |`);
  md.push(`| runningContourCount | ${r.beforeRunningContourCount} | ${r.afterRunningContourCount} |`);
  md.push(`| underlayCount | ${r.beforeUnderlayCount} | ${r.afterUnderlayCount} |`);
  md.push(`| professionalScore | ${r.beforeProfessionalScore} | ${r.afterProfessionalScore} |`);
  md.push(`| finalLookExportMismatch | ${r.beforeFinalLookExportMismatch} | ${r.afterFinalLookExportMismatch} |`);
  md.push(`| ce01Status | ${r.beforeCE01Status} | ${r.afterCE01Status} |`);
  md.push('\n## Criterio de éxito');
  md.push(`- satinContourCount > 0: ${r.afterSatinContourCount > 0}`);
  md.push(`- runningContourCount baja: ${r.afterRunningContourCount < r.beforeRunningContourCount}`);
  md.push(`- visibleDiagonalStitches sigue 0: ${r.afterVisibleDiagonalStitches === 0}`);
  md.push(`- finalLookExportMismatch sigue false: ${r.afterFinalLookExportMismatch === false}`);
  md.push(`- CE01 no INVALID: ${r.afterCE01Status !== 'INVALID'}`);
  md.push(`- professionalScore no baja >3: ${r.afterProfessionalScore >= r.beforeProfessionalScore - 3}`);
  return md.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
//  UNDERLAY_GENERATOR_V1 — centerline underlay seguro y reversible
// ═══════════════════════════════════════════════════════════════════════════
function polygonAreaMm2(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const p = points[i], q = points[j];
    const x1 = Array.isArray(p) ? p[0] : p.x, y1 = Array.isArray(p) ? p[1] : p.y;
    const x2 = Array.isArray(q) ? q[0] : q.x, y2 = Array.isArray(q) ? q[1] : q.y;
    if ([x1, y1, x2, y2].every(Number.isFinite)) area += x2 * y1 - x1 * y2;
  }
  return Math.abs(area / 2) * 10000;
}

function bboxFromRegionOrCommands(region, commands) {
  const pts = region?.path_points || region?.points || [];
  const xs = [], ys = [];
  if (Array.isArray(pts) && pts.length) {
    for (const p of pts) {
      const x = Array.isArray(p) ? p[0] * 100 - 50 : p.x;
      const y = Array.isArray(p) ? p[1] * 100 - 50 : p.y;
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
    }
  }
  if (!xs.length) {
    for (const c of commands || []) {
      if (c.type === 'stitch' && Number.isFinite(c.x) && Number.isFinite(c.y)) { xs.push(c.x); ys.push(c.y); }
    }
  }
  if (!xs.length) return null;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX, height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null;
  return { minX, maxX, minY, maxY, width, height };
}

function isUnderlayExcludedText(text) {
  return /contour|outline|detail|mouth|eye|facial|running|satin|tie/.test(String(text || '').toLowerCase());
}

function measureUnderlayHealth(commands, objects, regions, config, darkStroke) {
  const gate = professionalEmbroideryQualityGate(commands, objects || [], regions || [], darkStroke, config || {});
  const ce01 = validateCE01(commands, objects || [], regions || [], config || {}, {});
  const cmp = compareFinalLookVsExport(commands, commands);
  return {
    underlayCount: gate.underlayCount ?? 0,
    stitchCount: commands.filter((c) => c.type === 'stitch').length,
    jumpCount: commands.filter((c) => c.type === 'jump').length,
    trimCount: commands.filter((c) => c.type === 'trim').length,
    visibleDiagonalStitches: gate.visibleDiagonalStitches ?? 0,
    emptyBlocks: countEmptyColorBlocks(commands),
    unsupportedLongStitches: gate.blocks?.find((b) => b.name === 'unsupportedLongStitches')?.value ?? 0,
    ce01Status: ce01.status,
    professionalScore: gate.professionalScore ?? 0,
    finalLookExportMismatch: cmp.simulationExportMismatch === true,
  };
}

function buildCenterlineUnderlayCommands(candidate, params) {
  const { bbox, firstFill, regionId, color } = candidate;
  const pad = Math.max(1.5, Math.min(4, Math.min(bbox.width, bbox.height) * 0.12));
  const safeMinX = bbox.minX + pad, safeMaxX = bbox.maxX - pad;
  const safeMinY = bbox.minY + pad, safeMaxY = bbox.maxY - pad;
  if (safeMaxX <= safeMinX || safeMaxY <= safeMinY) return { commands: [], unsafe: true };
  const firstX = firstFill?.x;
  const firstY = firstFill?.y;
  if (!Number.isFinite(firstX) || !Number.isFinite(firstY)) return { commands: [], unsafe: true };
  const lineStart = Math.max(safeMinX, Math.min(safeMaxX, firstX));
  const y = Math.max(safeMinY, Math.min(safeMaxY, firstY));
  const availableRight = safeMaxX - lineStart;
  const availableLeft = lineStart - safeMinX;
  const direction = availableRight >= availableLeft ? 1 : -1;
  const maxForwardStitches = Math.max(2, Math.floor(params.maxUnderlayStitchesPerRegion / 2));
  const maxLineLength = Math.min(Math.max(availableRight, availableLeft), (maxForwardStitches - 1) * params.underlaySpacingMm);
  if (!Number.isFinite(maxLineLength) || maxLineLength < params.underlaySpacingMm) return { commands: [], unsafe: true };
  const lineEnd = direction > 0 ? lineStart + maxLineLength : lineStart - maxLineLength;
  const steps = Math.min(maxForwardStitches - 1, Math.max(1, Math.ceil(Math.abs(lineEnd - lineStart) / params.underlaySpacingMm)));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    points.push({ x: lineStart + (lineEnd - lineStart) * t, y });
  }
  for (let i = steps - 1; i >= 0; i--) points.push(points[i]);
  const out = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { commands: [], unsafe: true };
    if (p.x < safeMinX || p.x > safeMaxX || p.y < safeMinY || p.y > safeMaxY) return { commands: [], unsafe: true };
    out.push({
      type: 'stitch', x: p.x, y: p.y,
      layerType: 'underlay',
      source: 'UNDERLAY_GENERATOR_V1',
      generatedBy: 'UNDERLAY_GENERATOR_V1',
      underlayType: 'centerline',
      regionId,
      color,
      stitchType: 'underlay',
      isUnderlay: true,
    });
  }
  return { commands: out, unsafe: false };
}

export function generateCenterlineUnderlayGuardedV1(commands = [], options = {}) {
  const { objects, regions = [], config, darkStroke } = options;
  const params = {
    maxUnderlayRegions: 4,
    maxAddedUnderlayStitches: 160,
    minAreaMm2: 120,
    minRegionStitchCount: 80,
    underlaySpacingMm: 3.5,
    maxUnderlaySegmentMm: 4.0,
    maxUnderlayStitchesPerRegion: 40,
    passesPerRegion: 1,
  };
  const before = measureUnderlayHealth(commands, objects, regions, config, darkStroke);
  const skip = { tooSmall: 0, detail: 0, contour: 0, unsafeGeometry: 0, noStableRegion: 0 };
  if (config?.professionalMode !== true || config?.learnedUnderlayEnabled !== true || before.ce01Status === 'INVALID') {
    const report = buildUnderlayGeneratorReport({ params, phaseAccepted: false, revertReason: before.ce01Status === 'INVALID' ? 'CE01 INVALID antes de la fase' : 'activation conditions not met', before, after: before, candidatesFound: 0, candidatesAccepted: 0, skip, addedUnderlayStitches: 0, commandsReturnedSource: 'beforeUnderlay' });
    return { commands, report };
  }

  const regionById = new Map();
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    regionById.set(r.id || r.regionId || `region_${i}`, r);
  }
  const grouped = new Map();
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch' || !c.regionId) continue;
    if (!grouped.has(c.regionId)) grouped.set(c.regionId, { indexes: [], stitches: [], fillCount: 0, sourceSet: new Set(), stitchTypeSet: new Set(), layerTypeSet: new Set() });
    const g = grouped.get(c.regionId);
    g.indexes.push(i); g.stitches.push(c);
    if (String(c.source || '').toLowerCase() === 'ce01_safe_fill' || String(c.stitchType || '').toLowerCase() === 'fill') g.fillCount++;
    if (c.source) g.sourceSet.add(c.source);
    if (c.stitchType) g.stitchTypeSet.add(c.stitchType);
    if (c.layerType) g.layerTypeSet.add(c.layerType);
  }

  const candidates = [];
  for (const [regionId, group] of grouped) {
    const region = regionById.get(regionId);
    if (!region) { skip.noStableRegion++; continue; }
    const text = [...group.sourceSet, ...group.stitchTypeSet, ...group.layerTypeSet, region.stitch_type, region.stitchType, region.layerType, region.source].filter(Boolean).join(' ');
    if (isUnderlayExcludedText(text)) { String(text).toLowerCase().includes('contour') || String(text).toLowerCase().includes('outline') ? skip.contour++ : skip.detail++; continue; }
    const hasFillSource = [...group.sourceSet].some((s) => String(s).toLowerCase() === 'ce01_safe_fill') || [...group.stitchTypeSet].some((s) => String(s).toLowerCase() === 'fill');
    const area = region.area_mm2 || polygonAreaMm2(region.path_points || region.points || []);
    if (!hasFillSource || group.stitches.length < params.minRegionStitchCount || area < params.minAreaMm2) { skip.tooSmall++; continue; }
    const bbox = bboxFromRegionOrCommands(region, group.stitches);
    if (!bbox) { skip.unsafeGeometry++; continue; }
    candidates.push({ regionId, group, region, area, bbox, firstFill: group.stitches[0], color: group.stitches[0]?.color || region.color || '#000000' });
  }
  candidates.sort((a, b) => b.group.stitches.length - a.group.stitches.length);

  const selected = [];
  let addedUnderlayStitches = 0;
  for (const cand of candidates) {
    if (selected.length >= params.maxUnderlayRegions) break;
    const built = buildCenterlineUnderlayCommands(cand, params);
    if (built.unsafe || built.commands.length === 0) { skip.unsafeGeometry++; continue; }
    if (addedUnderlayStitches + built.commands.length > params.maxAddedUnderlayStitches) break;
    selected.push({ ...cand, underlayCommands: built.commands });
    addedUnderlayStitches += built.commands.length;
  }

  const insertByIndex = new Map();
  for (const cand of selected) insertByIndex.set(cand.group.indexes[0], cand.underlayCommands);
  const out = [];
  for (let i = 0; i < commands.length; i++) {
    out.push(commands[i]);
    if (insertByIndex.has(i)) out.push(...insertByIndex.get(i));
  }

  let badCoords = false, underlayOutsideSafeBbox = false;
  const selectedByRegion = new Map(selected.map((c) => [c.regionId, c.bbox]));
  for (const c of out) {
    if ((c.type === 'stitch' || c.type === 'jump') && (!Number.isFinite(c.x) || !Number.isFinite(c.y))) badCoords = true;
    if (c.isUnderlay) {
      const bb = selectedByRegion.get(c.regionId);
      if (!bb || c.x < bb.minX || c.x > bb.maxX || c.y < bb.minY || c.y > bb.maxY) underlayOutsideSafeBbox = true;
    }
  }

  const afterExperimental = measureUnderlayHealth(out, objects, regions, config, darkStroke);
  let revertReason = null;
  if (afterExperimental.underlayCount <= before.underlayCount) revertReason = 'underlayCount no aumenta';
  else if (afterExperimental.visibleDiagonalStitches > before.visibleDiagonalStitches) revertReason = 'visibleDiagonalStitches subió';
  else if (afterExperimental.emptyBlocks > before.emptyBlocks) revertReason = 'emptyBlocks subió';
  else if (afterExperimental.unsupportedLongStitches > before.unsupportedLongStitches) revertReason = 'unsupportedLongStitches subió';
  else if (afterExperimental.ce01Status === 'INVALID') revertReason = 'CE01 pasó a INVALID';
  else if (afterExperimental.finalLookExportMismatch === true) revertReason = 'finalLookExportMismatch pasó a true';
  else if (afterExperimental.professionalScore < before.professionalScore - 3) revertReason = 'professionalScore bajó más de 3';
  else if (afterExperimental.stitchCount > before.stitchCount + params.maxAddedUnderlayStitches) revertReason = 'stitchCount excede presupuesto';
  else if (afterExperimental.jumpCount > before.jumpCount + 6) revertReason = 'jumpCount subió más de 6';
  else if (afterExperimental.trimCount > before.trimCount + 6) revertReason = 'trimCount subió más de 6';
  else if (badCoords) revertReason = 'coordenada x/y no numérica';
  else if (underlayOutsideSafeBbox) revertReason = 'underlay fuera del bbox seguro';

  const phaseAccepted = !revertReason;
  const after = phaseAccepted ? afterExperimental : before;
  const report = buildUnderlayGeneratorReport({
    params,
    phaseAccepted,
    revertReason,
    before,
    after,
    candidatesFound: candidates.length,
    candidatesAccepted: phaseAccepted ? selected.length : 0,
    skip,
    addedUnderlayStitches: phaseAccepted ? addedUnderlayStitches : 0,
    commandsReturnedSource: phaseAccepted ? 'underlayAccepted' : 'beforeUnderlay',
  });
  return { commands: phaseAccepted ? out : commands, report };
}

function buildUnderlayGeneratorReport({ params, phaseAccepted, revertReason, before, after, candidatesFound, candidatesAccepted, skip, addedUnderlayStitches, commandsReturnedSource }) {
  const report = {
    version: 'UNDERLAY_GENERATOR_V1',
    phaseAccepted,
    revertReason,
    underlayCountBefore: before.underlayCount,
    underlayCountAfter: after.underlayCount,
    candidatesFound,
    candidatesAccepted,
    candidatesSkippedTooSmall: skip.tooSmall,
    candidatesSkippedDetail: skip.detail,
    candidatesSkippedContour: skip.contour,
    candidatesSkippedUnsafeGeometry: skip.unsafeGeometry,
    candidatesSkippedNoStableRegion: skip.noStableRegion,
    addedUnderlayStitches,
    stitchCountBefore: before.stitchCount,
    stitchCountAfter: after.stitchCount,
    jumpCountBefore: before.jumpCount,
    jumpCountAfter: after.jumpCount,
    trimCountBefore: before.trimCount,
    trimCountAfter: after.trimCount,
    visibleDiagonalStitchesBefore: before.visibleDiagonalStitches,
    visibleDiagonalStitchesAfter: after.visibleDiagonalStitches,
    emptyBlocksBefore: before.emptyBlocks,
    emptyBlocksAfter: after.emptyBlocks,
    unsupportedLongStitchesBefore: before.unsupportedLongStitches,
    unsupportedLongStitchesAfter: after.unsupportedLongStitches,
    ce01StatusBefore: before.ce01Status,
    ce01StatusAfter: after.ce01Status,
    professionalScoreBefore: before.professionalScore,
    professionalScoreAfter: after.professionalScore,
    finalLookExportMismatchBefore: before.finalLookExportMismatch,
    finalLookExportMismatchAfter: after.finalLookExportMismatch,
    commandsReturnedSource,
    maxAddedUnderlayStitches: params.maxAddedUnderlayStitches,
  };
  report.md = buildUnderlayGeneratorReportMd(report);
  return report;
}

function buildUnderlayGeneratorReportMd(r) {
  const md = [];
  md.push('# UNDERLAY_GENERATOR_REPORT_V1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Fase post-generador, centerline-only, transaccional y reversible.\n');
  md.push('## Veredicto');
  md.push(`- phaseAccepted: ${r.phaseAccepted}`);
  if (!r.phaseAccepted) md.push(`- revertReason: ${r.revertReason}`);
  md.push(`- commandsReturnedSource: ${r.commandsReturnedSource}`);
  md.push('\n## Candidatos');
  md.push(`- candidatesFound: ${r.candidatesFound}`);
  md.push(`- candidatesAccepted: ${r.candidatesAccepted}`);
  md.push(`- candidatesSkippedTooSmall: ${r.candidatesSkippedTooSmall}`);
  md.push(`- candidatesSkippedDetail: ${r.candidatesSkippedDetail}`);
  md.push(`- candidatesSkippedContour: ${r.candidatesSkippedContour}`);
  md.push(`- candidatesSkippedUnsafeGeometry: ${r.candidatesSkippedUnsafeGeometry}`);
  md.push(`- candidatesSkippedNoStableRegion: ${r.candidatesSkippedNoStableRegion}`);
  md.push(`- addedUnderlayStitches: ${r.addedUnderlayStitches}`);
  md.push('\n## Métricas antes/después');
  md.push('| Métrica | Antes | Después |');
  md.push('|---|---:|---:|');
  md.push(`| underlayCount | ${r.underlayCountBefore} | ${r.underlayCountAfter} |`);
  md.push(`| stitchCount | ${r.stitchCountBefore} | ${r.stitchCountAfter} |`);
  md.push(`| jumpCount | ${r.jumpCountBefore} | ${r.jumpCountAfter} |`);
  md.push(`| trimCount | ${r.trimCountBefore} | ${r.trimCountAfter} |`);
  md.push(`| visibleDiagonalStitches | ${r.visibleDiagonalStitchesBefore} | ${r.visibleDiagonalStitchesAfter} |`);
  md.push(`| emptyBlocks | ${r.emptyBlocksBefore} | ${r.emptyBlocksAfter} |`);
  md.push(`| unsupportedLongStitches | ${r.unsupportedLongStitchesBefore} | ${r.unsupportedLongStitchesAfter} |`);
  md.push(`| CE01 status | ${r.ce01StatusBefore} | ${r.ce01StatusAfter} |`);
  md.push(`| professionalScore | ${r.professionalScoreBefore} | ${r.professionalScoreAfter} |`);
  md.push(`| finalLookExportMismatch | ${r.finalLookExportMismatchBefore} | ${r.finalLookExportMismatchAfter} |`);
  return md.join('\n');
}

function buildUnderlayIntegratedReportMd(r) {
  const u = r.underlayReport || {};
  const md = [];
  md.push('# REFERENCE_INTEGRATED_PIPELINE_AFTER_UNDERLAY_V1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Validación integrada del pipeline completo después de UNDERLAY_GENERATOR_V1.\n');
  md.push('## Flags');
  md.push(`- integratedValidation: ${r.integratedValidation}`);
  md.push(`- underlayPhaseApplied: ${r.underlayPhaseApplied}`);
  md.push(`- underlayPhaseAccepted: ${r.underlayPhaseAccepted}`);
  md.push(`- trimGuardApplied: ${r.trimGuardApplied}`);
  md.push(`- visibleSplitterStatus: ${r.visibleSplitterStatus}`);
  md.push(`- satinPhaseApplied: ${r.satinPhaseApplied}`);
  md.push(`- qualityGateMeasuredFinalReturnedCommands: ${r.qualityGateMeasuredFinalReturnedCommands}`);
  md.push(`- safeToKeepUnderlay: ${r.safeToKeepUnderlay}`);
  md.push('\n## Orden medido');
  for (let i = 0; i < r.order.length; i++) md.push(`${i + 1}. ${r.order[i]}`);
  md.push('\n## Métricas underlay');
  md.push('| Métrica | Antes | Después |');
  md.push('|---|---:|---:|');
  md.push(`| underlayCount | ${u.underlayCountBefore ?? 0} | ${u.underlayCountAfter ?? 0} |`);
  md.push(`| stitchCount | ${u.stitchCountBefore ?? 0} | ${u.stitchCountAfter ?? 0} |`);
  md.push(`| jumpCount | ${u.jumpCountBefore ?? 0} | ${u.jumpCountAfter ?? 0} |`);
  md.push(`| trimCount | ${u.trimCountBefore ?? 0} | ${u.trimCountAfter ?? 0} |`);
  md.push(`| visibleDiagonalStitches | ${u.visibleDiagonalStitchesBefore ?? 0} | ${u.visibleDiagonalStitchesAfter ?? 0} |`);
  md.push(`| emptyBlocks | ${u.emptyBlocksBefore ?? 0} | ${u.emptyBlocksAfter ?? 0} |`);
  md.push(`| unsupportedLongStitches | ${u.unsupportedLongStitchesBefore ?? 0} | ${u.unsupportedLongStitchesAfter ?? 0} |`);
  md.push(`| CE01 status | ${u.ce01StatusBefore ?? '—'} | ${u.ce01StatusAfter ?? '—'} |`);
  md.push(`| professionalScore | ${u.professionalScoreBefore ?? 0} | ${u.professionalScoreAfter ?? 0} |`);
  md.push(`| finalLookExportMismatch | ${u.finalLookExportMismatchBefore ?? false} | ${u.finalLookExportMismatchAfter ?? false} |`);
  return md.join('\n');
}

// ── Trim antes de saltos largos (regla aprendida J002) ─────────────────────────
// Inserta un trim antes de cualquier jump > trimBeforeMm si no hay ya un trim
// inmediatamente antes. No duplica trims existentes.
function insertTrimBeforeLongJumps(commands, trimBeforeMm) {
  const out = [];
  let prev = null;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'jump' && prev) {
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      if (d > trimBeforeMm) {
        // solo insertar si el comando anterior no es ya un trim
        const prevCmd = out[out.length - 1];
        if (!prevCmd || prevCmd.type !== 'trim') {
          out.push(safeTrimFrom(prev, c));
        }
      }
    }
    out.push(c);
    if (c.type === 'stitch' || c.type === 'jump') prev = { x: c.x, y: c.y };
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  REFERENCE_TRIM_GUARD_V1 — versión protegida de insertTrimBeforeLongJumps
// ═══════════════════════════════════════════════════════════════════════════
// Evita que learnedTrimBeforeTravelMm dispare trimCount de forma descontrolada.
// 1) mide before, 2) presupuesto maxNewTrims, 3) detecta/filtra candidatos,
// 4) ordena por distancia desc y aplica solo hasta el presupuesto,
// 5) guard transaccional: revierte la fase completa si empeora métricas críticas.
// No elimina insertTrimBeforeLongJumps (legacy intacto).
function countTrimJumpTotal(commands) {
  let trims = 0, jumps = 0, total = 0;
  for (const c of commands) {
    total++;
    if (c.type === 'trim') trims++;
    else if (c.type === 'jump') jumps++;
  }
  return { trims, jumps, total };
}

function countEmptyColorBlocks(commands) {
  let empty = 0, hasStitch = false, hasAny = false;
  for (const c of commands) {
    if (c.type === 'colorChange') {
      if (hasAny && !hasStitch) empty++;
      hasStitch = false; hasAny = false; continue;
    }
    hasAny = true;
    if (c.type === 'stitch') hasStitch = true;
  }
  if (hasAny && !hasStitch) empty++;
  return empty;
}

function measureGuardHealth(commands, objects, regions, config, darkStroke) {
  const ce01 = validateCE01(commands, objects || [], regions || [], config || {}, {});
  const gate = professionalEmbroideryQualityGate(commands, objects || [], regions || [], darkStroke, config || {});
  return {
    ce01Status: ce01.status,
    ce01Score: ce01.score,
    exportAllowed: ce01.ce01Ready,
    emptyBlocks: countEmptyColorBlocks(commands),
    visibleDiagonalStitches: gate.visibleDiagonalStitches ?? 0,
    unsupportedLongStitches: ce01.rawMetrics?.longStitches ?? 0,
    professionalScore: gate.professionalScore ?? 0,
  };
}

export function insertTrimBeforeLongJumpsGuarded(commands, trimBeforeMm, options = {}) {
  const beforeMetrics = countTrimJumpTotal(commands);
  const beforeHealth = measureGuardHealth(commands, options.objects, options.regions, options.config, options.darkStroke);
  const beforeTrimCount = beforeMetrics.trims;

  // Presupuesto máximo de trims nuevos (techo 40, suelo 12, 35% del baseline).
  const maxNewTrims = Math.max(12, Math.min(40, Math.ceil(beforeTrimCount * 0.35)));

  // ── Detectar candidatos: jumps con distancia > trimBeforeMm ──────────────
  const candidates = [];
  let prev = null;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'jump' && prev) {
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      if (d > trimBeforeMm) candidates.push({ index: i, dist: d });
    }
    if (c.type === 'stitch' || c.type === 'jump') prev = { x: c.x ?? 0, y: c.y ?? 0 };
  }
  const candidatesFound = candidates.length;

  // ── Filtrar candidatos inseguros ─────────────────────────────────────────
  const skip = { nearbyTrim: 0, colorChange: 0, microBlock: 0, unsafeCoords: 0, budgetExceeded: 0 };
  const accepted = [];
  for (const cand of candidates) {
    const i = cand.index;
    const jc = commands[i];
    // unsafe coords
    if (!jc || typeof jc.x !== 'number' || typeof jc.y !== 'number' ||
        Number.isNaN(jc.x) || Number.isNaN(jc.y)) { skip.unsafeCoords++; continue; }
    // trim anterior inmediato
    const prevCmd = i > 0 ? commands[i - 1] : null;
    if (prevCmd && prevCmd.type === 'trim') { skip.nearbyTrim++; continue; }
    // trim en los 2 comandos anteriores
    if (i >= 2 && commands[i - 2] && commands[i - 2].type === 'trim') { skip.nearbyTrim++; continue; }
    // trim en los 2 comandos posteriores
    if (commands[i + 1] && commands[i + 1].type === 'trim') { skip.nearbyTrim++; continue; }
    if (commands[i + 2] && commands[i + 2].type === 'trim') { skip.nearbyTrim++; continue; }
    // colorChange cerca (±3) — el cambio de color ya actúa como parada
    let colorNear = false;
    for (let k = Math.max(0, i - 3); k <= Math.min(commands.length - 1, i + 3); k++) {
      const cc = commands[k];
      if (cc && cc.type === 'colorChange') { colorNear = true; break; }
    }
    if (colorNear) { skip.colorChange++; continue; }
    // microbloque protegido: < 4 comandos entre límites (trim/colorChange)
    let bs = i;
    while (bs > 0) { const p = commands[bs - 1]; if (!p || p.type === 'trim' || p.type === 'colorChange') break; bs--; }
    let be = i;
    while (be < commands.length - 1) { const n = commands[be + 1]; if (!n || n.type === 'trim' || n.type === 'colorChange') break; be++; }
    if (be - bs + 1 < 4) { skip.microBlock++; continue; }
    accepted.push(cand);
  }

  // ── Ordenar por distancia desc y aplicar hasta maxNewTrims ────────────────
  accepted.sort((a, b) => b.dist - a.dist);
  const applySet = new Set();
  let applied = 0;
  for (const cand of accepted) {
    if (applied >= maxNewTrims) { skip.budgetExceeded++; continue; }
    applySet.add(cand.index);
    applied++;
  }

  // ── Construir salida insertando trim solo en los seleccionados ───────────
  const out = [];
  let lastPosition = null;
  for (let i = 0; i < commands.length; i++) {
    const current = commands[i];
    if (applySet.has(i)) {
      const pc = out[out.length - 1];
      if (!pc || pc.type !== 'trim') out.push(safeTrimFrom(lastPosition, current));
    }
    out.push(current);
    if (current.type === 'stitch' || current.type === 'jump') lastPosition = { x: current.x, y: current.y, color: current.color, regionId: current.regionId };
  }

  const afterMetrics = countTrimJumpTotal(out);
  const afterHealth = measureGuardHealth(out, options.objects, options.regions, options.config, options.darkStroke);

  // ── Guard transaccional: revertir si empeora métricas críticas ────────────
  let revertReason = null;
  if (afterMetrics.trims > beforeTrimCount + maxNewTrims)
    revertReason = `afterTrimCount (${afterMetrics.trims}) > before+maxNewTrims (${beforeTrimCount}+${maxNewTrims})`;
  else if (afterMetrics.trims > beforeTrimCount * 1.5)
    revertReason = `afterTrimCount (${afterMetrics.trims}) > before*1.5 (${(beforeTrimCount * 1.5).toFixed(0)})`;
  else if (afterHealth.visibleDiagonalStitches > beforeHealth.visibleDiagonalStitches)
    revertReason = `visibleDiagonalStitches subió (${beforeHealth.visibleDiagonalStitches} → ${afterHealth.visibleDiagonalStitches})`;
  else if (afterHealth.emptyBlocks > beforeHealth.emptyBlocks)
    revertReason = `emptyBlocks subió (${beforeHealth.emptyBlocks} → ${afterHealth.emptyBlocks})`;
  else if (afterHealth.unsupportedLongStitches > beforeHealth.unsupportedLongStitches)
    revertReason = `unsupportedLongStitches subió (${beforeHealth.unsupportedLongStitches} → ${afterHealth.unsupportedLongStitches})`;
  else if (afterHealth.ce01Status === 'INVALID' && beforeHealth.ce01Status !== 'INVALID')
    revertReason = `CE01 pasó a INVALID (${beforeHealth.ce01Status} → INVALID)`;
  else if (afterHealth.exportAllowed === false && beforeHealth.exportAllowed === true)
    revertReason = `exportAllowed pasó a false`;
  else if (afterHealth.professionalScore < beforeHealth.professionalScore - 3)
    revertReason = `professionalScore bajó más de 3 (${beforeHealth.professionalScore} → ${afterHealth.professionalScore})`;

  const phaseAccepted = !revertReason;
  const finalCommands = phaseAccepted ? out : commands;

  const report = {
    version: 'REFERENCE_TRIM_GUARD_V1',
    trimBeforeMm,
    beforeTrimCount,
    afterTrimCount: phaseAccepted ? afterMetrics.trims : beforeTrimCount,
    beforeJumpCount: beforeMetrics.jumps,
    afterJumpCount: phaseAccepted ? afterMetrics.jumps : beforeMetrics.jumps,
    beforeCommandCount: beforeMetrics.total,
    afterCommandCount: phaseAccepted ? afterMetrics.total : beforeMetrics.total,
    maxNewTrims,
    candidatesFound,
    candidatesApplied: applied,
    candidatesSkippedBecauseNearbyTrim: skip.nearbyTrim,
    candidatesSkippedBecauseColorChange: skip.colorChange,
    candidatesSkippedBecauseMicroBlock: skip.microBlock,
    candidatesSkippedBecauseUnsafeCoords: skip.unsafeCoords,
    candidatesSkippedBecauseBudgetExceeded: skip.budgetExceeded,
    phaseAccepted,
    revertReason,
    ce01StatusBefore: beforeHealth.ce01Status,
    ce01StatusAfter: phaseAccepted ? afterHealth.ce01Status : beforeHealth.ce01Status,
    ce01ScoreBefore: beforeHealth.ce01Score,
    ce01ScoreAfter: phaseAccepted ? afterHealth.ce01Score : beforeHealth.ce01Score,
    professionalScoreBefore: beforeHealth.professionalScore,
    professionalScoreAfter: phaseAccepted ? afterHealth.professionalScore : beforeHealth.professionalScore,
    visibleDiagonalStitchesBefore: beforeHealth.visibleDiagonalStitches,
    visibleDiagonalStitchesAfter: phaseAccepted ? afterHealth.visibleDiagonalStitches : beforeHealth.visibleDiagonalStitches,
    emptyBlocksBefore: beforeHealth.emptyBlocks,
    emptyBlocksAfter: phaseAccepted ? afterHealth.emptyBlocks : beforeHealth.emptyBlocks,
    unsupportedLongStitchesBefore: beforeHealth.unsupportedLongStitches,
    unsupportedLongStitchesAfter: phaseAccepted ? afterHealth.unsupportedLongStitches : beforeHealth.unsupportedLongStitches,
  };
  report.md = buildTrimGuardReportMd(report);

  return { commands: finalCommands, report };
}

// ── Generador del informe REFERENCE_TRIM_GUARD_REPORT_V1.md ──────────────────
function buildTrimGuardReportMd(r) {
  const md = [];
  md.push('# REFERENCE_TRIM_GUARD_REPORT_V1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> REFERENCE_TRIM_GUARD_V1 — guard transaccional sobre `insertTrimBeforeLongJumps`.');
  md.push('> Evita que `learnedTrimBeforeTravelMm` dispare `trimCount` de forma descontrolada.\n');
  md.push('## Parámetros');
  md.push(`- **trimBeforeMm**: ${r.trimBeforeMm}`);
  md.push(`- **maxNewTrims** (presupuesto): ${r.maxNewTrims} = max(12, min(40, ceil(${r.beforeTrimCount} * 0.35)))`);
  md.push('\n## Conteo antes/después');
  md.push('| Métrica | Antes | Después |');
  md.push('|---|---|---|');
  md.push(`| trimCount | ${r.beforeTrimCount} | ${r.afterTrimCount} |`);
  md.push(`| jumpCount | ${r.beforeJumpCount} | ${r.afterJumpCount} |`);
  md.push(`| commandCount | ${r.beforeCommandCount} | ${r.afterCommandCount} |`);
  md.push('\n## Candidatos');
  md.push(`- **candidatesFound**: ${r.candidatesFound}`);
  md.push(`- **candidatesApplied**: ${r.candidatesApplied}`);
  md.push(`- candidatesSkippedBecauseNearbyTrim: ${r.candidatesSkippedBecauseNearbyTrim}`);
  md.push(`- candidatesSkippedBecauseColorChange: ${r.candidatesSkippedBecauseColorChange}`);
  md.push(`- candidatesSkippedBecauseMicroBlock: ${r.candidatesSkippedBecauseMicroBlock}`);
  md.push(`- candidatesSkippedBecauseUnsafeCoords: ${r.candidatesSkippedBecauseUnsafeCoords}`);
  md.push(`- candidatesSkippedBecauseBudgetExceeded: ${r.candidatesSkippedBecauseBudgetExceeded}`);
  md.push('\n## Veredicto de fase');
  md.push(`- **phaseAccepted**: ${r.phaseAccepted}`);
  if (r.phaseAccepted) {
    md.push('- La fase se aplicó (mejora o neutro en métricas críticas).');
  } else {
    md.push(`- **revertReason**: ${r.revertReason}`);
    md.push('- La fase se revirtió — se conservan los comandos originales.');
  }
  md.push('\n## Salud crítica antes/después');
  md.push('| Métrica | Antes | Después |');
  md.push('|---|---|---|');
  md.push(`| CE01 status | ${r.ce01StatusBefore} | ${r.ce01StatusAfter} |`);
  md.push(`| professionalScore | ${r.professionalScoreBefore} | ${r.professionalScoreAfter} |`);
  md.push(`| visibleDiagonalStitches | ${r.visibleDiagonalStitchesBefore} | ${r.visibleDiagonalStitchesAfter} |`);
  md.push(`| emptyBlocks | ${r.emptyBlocksBefore} | ${r.emptyBlocksAfter} |`);
  md.push(`| unsupportedLongStitches | ${r.unsupportedLongStitchesBefore} | ${r.unsupportedLongStitchesAfter} |`);
  md.push('\n## Criterios de revertido');
  md.push('- afterTrimCount > beforeTrimCount + maxNewTrims');
  md.push('- afterTrimCount > beforeTrimCount * 1.5');
  md.push('- visibleDiagonalStitches sube');
  md.push('- emptyBlocks sube');
  md.push('- unsupportedLongStitches sube');
  md.push('- CE01 pasa a INVALID');
  md.push('- exportAllowed pasa a false');
  md.push('- professionalScore baja más de 3 puntos');
  md.push('\n---');
  md.push('_REFERENCE_TRIM_GUARD_V1 — fix reversible. No toca V5.1, Safe Tie, encoders, ni exportación._');
  return md.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
//  REFERENCE_VISIBLE_STITCH_SPLITTER_V1 — división segura de puntadas visibles
// ═══════════════════════════════════════════════════════════════════════════
// Después de buildFinalCommands, divide puntadas de relleno largas que superen
// learnedMaxVisibleStitchMm insertando stitches intermedios interpolados.
// No toca generador base, encoders, CE01 validator ni V5.1 repair.
// Guard transaccional: revierte toda la fase si empeora métricas críticas.
function maxVisibleStitchMmLocal(commands) {
  let max = 0, prev = null;
  for (const c of commands) {
    if (c.type !== 'stitch') { if (c.type === 'jump') prev = { x: c.x, y: c.y }; continue; }
    if (prev) {
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      if (d > max && d <= 12) max = d;
    }
    prev = { x: c.x, y: c.y };
  }
  return max;
}

function stitchRoleForSplit(cmd) {
  const st = String(cmd.stitchType || '').toLowerCase();
  const lt = String(cmd.layerType || '').toLowerCase();
  const src = String(cmd.source || '').toLowerCase();
  if (st.includes('satin') || src.includes('satin')) return 'satin';
  if (st.includes('running') || st.includes('detail_run')) return 'running';
  if (lt.includes('outline') || lt.includes('contour')) return 'contour';
  if (lt.includes('detail') || lt.includes('mouth') || lt.includes('eye') || lt.includes('facial')) return 'detail';
  if (lt.includes('underlay') || src.includes('underlay')) return 'underlay';
  if (st.includes('fill') || st.includes('tatami') || st.includes('ce01_safe_fill') || lt.includes('fill')) return 'fill';
  return 'other';
}

function classifySplitPair(prev, curr) {
  if (!prev.regionId || !curr.regionId) return 'noRegion';
  if (prev.regionId !== curr.regionId) return 'differentRegion';
  const pc = String(prev.color || '').toLowerCase();
  const cc = String(curr.color || '').toLowerCase();
  if (pc !== cc) return 'differentColor';
  for (const cmd of [prev, curr]) {
    const role = stitchRoleForSplit(cmd);
    if (role === 'satin') return 'satin';
    if (role === 'contour') return 'contour';
    if (role === 'detail' || role === 'running') return 'detail';
    if (role === 'underlay') return 'underlay';
  }
  if (stitchRoleForSplit(prev) === 'fill' && stitchRoleForSplit(curr) === 'fill') return 'fill';
  return 'other';
}

export function splitLongVisibleFillStitchesGuarded(commands, targetMaxMm, options = {}) {
  const toleranceMm = 0.10;
  const effectiveMaxMm = targetMaxMm + toleranceMm;

  const beforeHealth = measureGuardHealth(commands, options.objects, options.regions, options.config, options.darkStroke);
  const beforeStitchCount = commands.filter((c) => c.type === 'stitch').length;
  const beforeCommandCount = commands.length;
  const beforeMaxVisibleStitchMm = maxVisibleStitchMmLocal(commands);
  const maxAddedStitches = Math.min(800, Math.max(80, Math.ceil(beforeStitchCount * 0.12)));

  // ── Detectar candidatos: pares stitch→stitch consecutivos largos ──────────
  const candidates = [];
  const skip = {
    contour: 0, detail: 0, satin: 0, differentRegion: 0, differentColor: 0,
    noRegion: 0, underlay: 0, other: 0, budgetExceeded: 0,
  };
  let prev = null;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') {
      // reset prev en cualquier colorChange/jump/trim/end → solo dividimos
      // segmentos stitch→stitch sin interrupciones
      prev = null;
      continue;
    }
    if (prev) {
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      if (d > effectiveMaxMm) {
        const cls = classifySplitPair(prev, c);
        if (cls === 'fill') {
          const n = Math.max(2, Math.ceil(d / targetMaxMm));
          candidates.push({ index: i, dist: d, n, add: n - 1, prev, curr: c });
        } else {
          skip[cls] = (skip[cls] || 0) + 1;
        }
      }
    }
    prev = c;
  }
  const candidatesFound = candidates.length;

  // ── Ordenar por distancia desc y aplicar hasta maxAddedStitches ───────────
  candidates.sort((a, b) => b.dist - a.dist);
  const applySet = new Map(); // currIndex -> {n, prev, curr}
  let addedStitches = 0;
  let splitCount = 0;
  for (const cand of candidates) {
    if (addedStitches + cand.add > maxAddedStitches) { skip.budgetExceeded++; continue; }
    applySet.set(cand.index, cand);
    addedStitches += cand.add;
    splitCount++;
  }

  // ── Construir salida insertando stitches intermedios interpolados ────────
  const out = [];
  for (let i = 0; i < commands.length; i++) {
    const cand = applySet.get(i);
    if (cand) {
      const { prev: p, curr: cur, n } = cand;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const x = p.x + (cur.x - p.x) * t;
        const y = p.y + (cur.y - p.y) * t;
        if (!Number.isFinite(x) || !Number.isFinite(y)) { continue; }
        out.push({
          type: 'stitch',
          x, y,
          color: cur.color,
          regionId: cur.regionId,
          stitchType: cur.stitchType,
          layerType: cur.layerType,
          objectId: cur.objectId,
          source: cur.source,
          generatedBy: 'REFERENCE_VISIBLE_STITCH_SPLITTER_V1',
          splitFromLongVisibleStitch: true,
        });
      }
    }
    out.push(commands[i]);
  }

  // ── Validación numérica ──────────────────────────────────────────────────
  let badCoords = false;
  for (const c of out) {
    if ((c.type === 'stitch' || c.type === 'jump') &&
      (typeof c.x !== 'number' || typeof c.y !== 'number' || Number.isNaN(c.x) || Number.isNaN(c.y))) {
      badCoords = true; break;
    }
  }

  const afterHealth = measureGuardHealth(out, options.objects, options.regions, options.config, options.darkStroke);
  const afterStitchCount = out.filter((c) => c.type === 'stitch').length;
  const afterCommandCount = out.length;
  const afterMaxVisibleStitchMm = maxVisibleStitchMmLocal(out);
  const cmpMismatch = compareFinalLookVsExport(out, out).simulationExportMismatch === true;

  // ── Guard transaccional ─────────────────────────────────────────────────
  let revertReason = null;
  if (badCoords) revertReason = 'comando con x/y no numérico tras el split';
  else if (afterHealth.visibleDiagonalStitches > beforeHealth.visibleDiagonalStitches)
    revertReason = `visibleDiagonalStitches subió (${beforeHealth.visibleDiagonalStitches} → ${afterHealth.visibleDiagonalStitches})`;
  else if (afterHealth.emptyBlocks > beforeHealth.emptyBlocks)
    revertReason = `emptyBlocks subió (${beforeHealth.emptyBlocks} → ${afterHealth.emptyBlocks})`;
  else if (afterHealth.unsupportedLongStitches > beforeHealth.unsupportedLongStitches)
    revertReason = `unsupportedLongStitches subió (${beforeHealth.unsupportedLongStitches} → ${afterHealth.unsupportedLongStitches})`;
  else if (afterHealth.ce01Status === 'INVALID' && beforeHealth.ce01Status !== 'INVALID')
    revertReason = `CE01 pasó a INVALID (${beforeHealth.ce01Status} → INVALID)`;
  else if (afterHealth.professionalScore < beforeHealth.professionalScore - 3)
    revertReason = `professionalScore bajó más de 3 (${beforeHealth.professionalScore} → ${afterHealth.professionalScore})`;
  else if (afterStitchCount > beforeStitchCount + maxAddedStitches)
    revertReason = `afterStitchCount (${afterStitchCount}) > before+maxAdded (${beforeStitchCount}+${maxAddedStitches})`;
  else if (cmpMismatch)
    revertReason = 'finalLookExportMismatch pasó a true';

  const phaseAccepted = !revertReason;
  const finalCommands = phaseAccepted ? out : commands;

  const report = {
    version: 'REFERENCE_VISIBLE_STITCH_SPLITTER_V1',
    targetMaxMm,
    effectiveMaxMm,
    beforeStitchCount,
    afterStitchCount: phaseAccepted ? afterStitchCount : beforeStitchCount,
    beforeCommandCount,
    afterCommandCount: phaseAccepted ? afterCommandCount : beforeCommandCount,
    beforeMaxVisibleStitchMm,
    afterMaxVisibleStitchMm: phaseAccepted ? afterMaxVisibleStitchMm : beforeMaxVisibleStitchMm,
    maxAddedStitches,
    addedStitches: phaseAccepted ? addedStitches : 0,
    candidatesFound,
    candidatesSplit: phaseAccepted ? splitCount : 0,
    candidatesSkippedBecauseContour: skip.contour,
    candidatesSkippedBecauseDetail: skip.detail,
    candidatesSkippedBecauseSatin: skip.satin,
    candidatesSkippedBecauseDifferentRegion: skip.differentRegion,
    candidatesSkippedBecauseDifferentColor: skip.differentColor,
    candidatesSkippedBecauseNoRegion: skip.noRegion,
    candidatesSkippedBecauseUnderlay: skip.underlay,
    candidatesSkippedBecauseOther: skip.other,
    candidatesSkippedBecauseBudgetExceeded: skip.budgetExceeded,
    phaseAccepted,
    revertReason,
    ce01StatusBefore: beforeHealth.ce01Status,
    ce01StatusAfter: phaseAccepted ? afterHealth.ce01Status : beforeHealth.ce01Status,
    ce01ScoreBefore: beforeHealth.ce01Score,
    ce01ScoreAfter: phaseAccepted ? afterHealth.ce01Score : beforeHealth.ce01Score,
    professionalScoreBefore: beforeHealth.professionalScore,
    professionalScoreAfter: phaseAccepted ? afterHealth.professionalScore : beforeHealth.professionalScore,
    visibleDiagonalStitchesBefore: beforeHealth.visibleDiagonalStitches,
    visibleDiagonalStitchesAfter: phaseAccepted ? afterHealth.visibleDiagonalStitches : beforeHealth.visibleDiagonalStitches,
    emptyBlocksBefore: beforeHealth.emptyBlocks,
    emptyBlocksAfter: phaseAccepted ? afterHealth.emptyBlocks : beforeHealth.emptyBlocks,
    unsupportedLongStitchesBefore: beforeHealth.unsupportedLongStitches,
    unsupportedLongStitchesAfter: phaseAccepted ? afterHealth.unsupportedLongStitches : beforeHealth.unsupportedLongStitches,
    finalLookExportMismatch: cmpMismatch,
  };
  report.md = buildVisibleSplitterReportMd(report);
  return { commands: finalCommands, report };
}

// ═══════════════════════════════════════════════════════════════════════════
//  REFERENCE_VISIBLE_STITCH_SPLITTER_V1_1 — gates por candidato + dry-run local
// ═══════════════════════════════════════════════════════════════════════════
//  Mejora sobre V1: candidate-level geometric gate (regionAt multipunto usando
//  el MISMO regionSupportForPoint que el detector), dry-run local por candidato
//  (detector ÚNICO en ventana ±5) y preservación completa de metadata.
//  No elimina V1. Mismo guard transaccional global.
function isExcludedSplitRole(cmd) {
  const role = stitchRoleForSplit(cmd);
  if (role === 'contour') return 'contour';
  if (role === 'detail' || role === 'running') return 'detail';
  if (role === 'satin') return 'satin';
  if (role === 'underlay') return 'underlay';
  const lt = String(cmd.layerType || '').toLowerCase();
  const src = String(cmd.source || '').toLowerCase();
  if (lt.includes('tie') || src.includes('tie')) return 'tie';
  return null;
}
function isFillSafeSplit(cmd) {
  const st = String(cmd.stitchType || '').toLowerCase();
  const src = String(cmd.source || '').toLowerCase();
  const lt = String(cmd.layerType || '').toLowerCase();
  return st === 'fill' || st === 'ce01_safe_fill' || st === 'tatami' ||
    src === 'ce01_safe_fill' || lt === 'fill' || !cmd.stitchType;
}
function buildSplitWindowBefore(commands, idx, radius) {
  const start = Math.max(0, idx - radius);
  const end = Math.min(commands.length, idx + radius + 1);
  return commands.slice(start, end);
}
function buildSplitWindowAfter(commands, cand, radius, n) {
  const start = Math.max(0, cand.index - radius);
  const end = Math.min(commands.length, cand.index + radius + 1);
  const win = commands.slice(start, end);
  const localIdx = cand.index - start;
  const p = cand.prev, cur = cand.curr;
  const insertPts = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    insertPts.push({
      type: 'stitch',
      x: p.x + (cur.x - p.x) * t, y: p.y + (cur.y - p.y) * t,
      color: cur.color, regionId: cur.regionId, stitchType: cur.stitchType,
      layerType: cur.layerType, source: cur.source, objectId: cur.objectId,
      generatedBy: 'REFERENCE_VISIBLE_STITCH_SPLITTER_V1_1',
      splitFromLongVisibleStitch: true, splitFillPreserved: true,
    });
  }
  return [...win.slice(0, localIdx), ...insertPts, ...win.slice(localIdx)];
}

export function splitLongVisibleFillStitchesGuardedV1_1(commands, targetMaxMm, options = {}) {
  const toleranceMm = 0.10;
  const effectiveMaxMm = targetMaxMm + toleranceMm;
  const { objects, regions: regionsArg, config, darkStroke } = options;
  const regions = regionsArg || [];

  const beforeHealth = measureGuardHealth(commands, objects, regions, config, darkStroke);
  const beforeStitchCount = commands.filter((c) => c.type === 'stitch').length;
  const beforeCommandCount = commands.length;
  const beforeMaxVisibleStitchMm = maxVisibleStitchMmLocal(commands);
  const maxAddedStitches = Math.min(800, Math.max(80, Math.ceil(beforeStitchCount * 0.12)));

  const skip = {
    contour: 0, detail: 0, satin: 0, underlay: 0, tie: 0,
    noRegion: 0, differentRegion: 0, differentColor: 0, notFill: 0,
    interpolatedPointOutsideRegion: 0, localVisibleDiagWouldIncrease: 0, budgetExceeded: 0,
  };

  // ── Detectar pares stitch→stitch largos ────────────────────────────────────
  const rawCandidates = [];
  let prev = null;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') { prev = null; continue; }
    if (prev) {
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      if (d > effectiveMaxMm) rawCandidates.push({ index: i, dist: d, prev, curr: c });
    }
    prev = c;
  }
  const candidatesFound = rawCandidates.length;

  // ── Gates por candidato: metadata → geometría multipunto → dry-run local ──
  let passedMetadata = 0, passedGeometry = 0, passedLocalGate = 0;
  const accepted = [];
  for (const cand of rawCandidates) {
    const { prev: p, curr: cur } = cand;
    if (!p.regionId || !cur.regionId) { skip.noRegion++; continue; }
    if (p.regionId !== cur.regionId) { skip.differentRegion++; continue; }
    if (String(p.color || '').toLowerCase() !== String(cur.color || '').toLowerCase()) { skip.differentColor++; continue; }
    const exP = isExcludedSplitRole(p), exC = isExcludedSplitRole(cur);
    if (exP || exC) { skip[exP || exC]++; continue; }
    if (!isFillSafeSplit(p) || !isFillSafeSplit(cur)) { skip.notFill++; continue; }
    passedMetadata++;
    // validación multipunto regionAt (mismo regionSupportForPoint que el detector)
    const n = Math.max(2, Math.ceil(cand.dist / targetMaxMm));
    const ts = cand.dist > 20
      ? [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
      : [0.25, 0.5, 0.75];
    let geoOk = true;
    for (const t of ts) {
      const mx = p.x + (cur.x - p.x) * t;
      const my = p.y + (cur.y - p.y) * t;
      const r = regionSupportForPoint(mx, my, regions);
      if (!r || r.id !== cur.regionId) { geoOk = false; break; }
    }
    if (!geoOk) { skip.interpolatedPointOutsideRegion++; continue; }
    passedGeometry++;
    // dry-run local: detector ÚNICO en ventana ±5
    const winBefore = buildSplitWindowBefore(commands, cand.index, 5);
    const winAfter = buildSplitWindowAfter(commands, cand, 5, n);
    const localBefore = detectVisibleDiagonalStitches(winBefore, [], regions, darkStroke, config).count;
    const localAfter = detectVisibleDiagonalStitches(winAfter, [], regions, darkStroke, config).count;
    if (localAfter > localBefore) { skip.localVisibleDiagWouldIncrease++; continue; }
    passedLocalGate++;
    accepted.push({ ...cand, n, add: n - 1, localBefore, localAfter });
  }

  // ── Presupuesto: ordenar por distancia desc, aplicar hasta maxAddedStitches ──
  accepted.sort((a, b) => b.dist - a.dist);
  const applyMap = new Map();
  let addedStitches = 0, applied = 0;
  for (const cand of accepted) {
    if (addedStitches + cand.add > maxAddedStitches) { skip.budgetExceeded++; continue; }
    applyMap.set(cand.index, cand);
    addedStitches += cand.add;
    applied++;
  }

  // ── Construir salida insertando stitches intermedios (metadata completa) ──
  const out = [];
  for (let i = 0; i < commands.length; i++) {
    const cand = applyMap.get(i);
    if (cand) {
      const { prev: p, curr: cur, n } = cand;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const x = p.x + (cur.x - p.x) * t;
        const y = p.y + (cur.y - p.y) * t;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const inter = {
          type: 'stitch', x, y,
          color: cur.color, regionId: cur.regionId, stitchType: cur.stitchType,
          layerType: cur.layerType, source: cur.source, objectId: cur.objectId,
          generatedBy: 'REFERENCE_VISIBLE_STITCH_SPLITTER_V1_1',
          splitFromLongVisibleStitch: true, splitFillPreserved: true,
        };
        if (cur.threadColor != null) inter.threadColor = cur.threadColor;
        if (cur.fillAngle != null) inter.fillAngle = cur.fillAngle;
        if (cur.density != null) inter.density = cur.density;
        out.push(inter);
      }
    }
    out.push(commands[i]);
  }

  // ── Validación numérica + guard global ────────────────────────────────────
  let badCoords = false;
  for (const c of out) {
    if ((c.type === 'stitch' || c.type === 'jump') &&
      (typeof c.x !== 'number' || typeof c.y !== 'number' || Number.isNaN(c.x) || Number.isNaN(c.y))) {
      badCoords = true; break;
    }
  }
  const afterHealth = measureGuardHealth(out, objects, regions, config, darkStroke);
  const afterStitchCount = out.filter((c) => c.type === 'stitch').length;
  const afterCommandCount = out.length;
  const afterMaxVisibleStitchMm = maxVisibleStitchMmLocal(out);
  const cmpMismatch = compareFinalLookVsExport(out, out).simulationExportMismatch === true;

  let revertReason = null;
  if (badCoords) revertReason = 'comando con x/y no numérico tras el split';
  else if (afterHealth.visibleDiagonalStitches > beforeHealth.visibleDiagonalStitches)
    revertReason = `visibleDiagonalStitches subió (${beforeHealth.visibleDiagonalStitches} → ${afterHealth.visibleDiagonalStitches})`;
  else if (afterHealth.emptyBlocks > beforeHealth.emptyBlocks)
    revertReason = `emptyBlocks subió (${beforeHealth.emptyBlocks} → ${afterHealth.emptyBlocks})`;
  else if (afterHealth.unsupportedLongStitches > beforeHealth.unsupportedLongStitches)
    revertReason = `unsupportedLongStitches subió (${beforeHealth.unsupportedLongStitches} → ${afterHealth.unsupportedLongStitches})`;
  else if (afterHealth.ce01Status === 'INVALID' && beforeHealth.ce01Status !== 'INVALID')
    revertReason = `CE01 pasó a INVALID (${beforeHealth.ce01Status} → INVALID)`;
  else if (afterHealth.exportAllowed === false && beforeHealth.exportAllowed === true)
    revertReason = `exportAllowed pasó a false`;
  else if (afterHealth.professionalScore < beforeHealth.professionalScore - 3)
    revertReason = `professionalScore bajó más de 3 (${beforeHealth.professionalScore} → ${afterHealth.professionalScore})`;
  else if (cmpMismatch)
    revertReason = 'finalLookExportMismatch pasó a true';
  else if (afterStitchCount > beforeStitchCount + maxAddedStitches)
    revertReason = `afterStitchCount (${afterStitchCount}) > before+maxAdded (${beforeStitchCount}+${maxAddedStitches})`;

  // ── Criterio de aceptación V1_2 ───────────────────────────────────────────
  // 1) regressionRevert: si el split empeora métricas críticas → revertir.
  // 2) splitterEffective: maxImprovement >= 0.25mm O afterMax <= target+tolerancia.
  //    Si NO efectivo → revertir la fase completa (NO_EFFECTIVE_REVERTED).
  // El resultado experimental (out) se mide siempre, pero solo se aplica si
  // splitterEffective=true.
  const maxImprovement = beforeMaxVisibleStitchMm - afterMaxVisibleStitchMm;
  const reachedTarget = afterMaxVisibleStitchMm <= targetMaxMm + 0.10;
  let phaseStatus;
  let phaseAccepted;
  let finalCommands;
  let commandsReturnedSource;
  if (revertReason) {
    phaseStatus = 'REVERTED';
    phaseAccepted = false;
    finalCommands = commands;
    commandsReturnedSource = 'beforeSplitter';
  } else {
    const splitterEffective = maxImprovement >= 0.25 || reachedTarget;
    if (!splitterEffective) {
      phaseStatus = 'NO_EFFECTIVE_REVERTED';
      phaseAccepted = false;
      revertReason = 'splitterEffective=false: maxVisibleStitchMm did not improve';
      finalCommands = commands;
      commandsReturnedSource = 'beforeSplitter';
    } else {
      phaseStatus = 'ACCEPTED';
      phaseAccepted = true;
      finalCommands = out;
      commandsReturnedSource = 'splitter';
    }
  }
  const returnedMaxVisibleStitchMm = maxVisibleStitchMmLocal(finalCommands);
  const returnedStitchCount = finalCommands.filter((c) => c.type === 'stitch').length;
  const returnedCommandCount = finalCommands.length;
  const splitterEffective = phaseAccepted && (maxImprovement >= 0.25 || reachedTarget);

  const report = {
    version: 'REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2',
    targetMaxMm,
    effectiveMaxMm,
    beforeMaxVisibleStitchMm,
    afterMaxVisibleStitchMm,
    returnedMaxVisibleStitchMm,
    maxImprovement,
    reachedTarget,
    beforeStitchCount,
    afterStitchCount,
    returnedStitchCount,
    beforeCommandCount,
    afterCommandCount,
    returnedCommandCount,
    maxAddedStitches,
    addedStitchesExperimental: addedStitches,
    addedStitchesReturned: phaseAccepted ? addedStitches : 0,
    addedStitches: phaseAccepted ? addedStitches : 0,
    candidatesFound,
    candidatesPassedMetadata: passedMetadata,
    candidatesPassedGeometry: passedGeometry,
    candidatesPassedLocalGate: passedLocalGate,
    dryRunCandidatesApplied: applied,
    realCandidatesApplied: phaseAccepted ? applied : 0,
    candidatesApplied: phaseAccepted ? applied : 0,
    candidatesSkippedInterpolatedPointOutsideRegion: skip.interpolatedPointOutsideRegion,
    candidatesSkippedLocalVisibleDiagWouldIncrease: skip.localVisibleDiagWouldIncrease,
    candidatesSkippedContour: skip.contour,
    candidatesSkippedDetail: skip.detail,
    candidatesSkippedSatin: skip.satin,
    candidatesSkippedUnderlay: skip.underlay,
    candidatesSkippedTie: skip.tie,
    candidatesSkippedNotFill: skip.notFill,
    candidatesSkippedDifferentRegion: skip.differentRegion,
    candidatesSkippedDifferentColor: skip.differentColor,
    candidatesSkippedNoRegion: skip.noRegion,
    candidatesSkippedBudgetExceeded: skip.budgetExceeded,
    phaseAccepted,
    phaseStatus,
    splitterEffective,
    commandsReturnedSource,
    revertReason,
    ce01StatusBefore: beforeHealth.ce01Status,
    ce01StatusAfterExperimental: afterHealth.ce01Status,
    ce01StatusAfter: phaseAccepted ? afterHealth.ce01Status : beforeHealth.ce01Status,
    ce01ScoreBefore: beforeHealth.ce01Score,
    ce01ScoreAfter: phaseAccepted ? afterHealth.ce01Score : beforeHealth.ce01Score,
    professionalScoreBefore: beforeHealth.professionalScore,
    professionalScoreAfter: phaseAccepted ? afterHealth.professionalScore : beforeHealth.professionalScore,
    visibleDiagonalStitchesBefore: beforeHealth.visibleDiagonalStitches,
    visibleDiagonalStitchesAfterExperimental: afterHealth.visibleDiagonalStitches,
    visibleDiagonalStitchesAfter: phaseAccepted ? afterHealth.visibleDiagonalStitches : beforeHealth.visibleDiagonalStitches,
    emptyBlocksBefore: beforeHealth.emptyBlocks,
    emptyBlocksAfterExperimental: afterHealth.emptyBlocks,
    emptyBlocksAfter: phaseAccepted ? afterHealth.emptyBlocks : beforeHealth.emptyBlocks,
    unsupportedLongStitchesBefore: beforeHealth.unsupportedLongStitches,
    unsupportedLongStitchesAfterExperimental: afterHealth.unsupportedLongStitches,
    unsupportedLongStitchesAfter: phaseAccepted ? afterHealth.unsupportedLongStitches : beforeHealth.unsupportedLongStitches,
    finalLookExportMismatchBefore: false,
    finalLookExportMismatchAfter: phaseAccepted ? cmpMismatch : false,
  };
  report.md = buildVisibleSplitterReportMdV1_2(report);
  return { commands: finalCommands, report };
}

function buildVisibleSplitterReportMdV1_2(r) {
  const md = [];
  md.push('# REFERENCE_VISIBLE_STITCH_SPLITTER_REPORT_V1_2 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2 — cierra el splitter como NO_EFFECTIVE si maxVisibleStitchMm no mejora.');
  md.push('> No toca buildFinalCommands, encoders, CE01 validator, V5.1 repair, REFERENCE_TRIM_GUARD_V1 ni V1.\n');
  md.push('## Parámetros');
  md.push(`- **targetMaxMm** (learnedMaxVisibleStitchMm): ${r.targetMaxMm}`);
  md.push(`- **effectiveMaxMm** (target + tolerancia 0.10): ${r.effectiveMaxMm}`);
  md.push(`- **maxAddedStitches** (presupuesto): ${r.maxAddedStitches}`);
  md.push(`- **maxImprovement**: ${r.maxImprovement.toFixed(2)} mm`);
  md.push(`- **reachedTarget**: ${r.reachedTarget} (afterMax <= ${r.targetMaxMm + 0.10})`);
  md.push('\n## Métricas: antes / experimental (split) / retornado');
  md.push('| Métrica | Antes | Experimental | Retornado |');
  md.push('|---|---|---|---|');
  md.push(`| maxVisibleStitchMm | ${r.beforeMaxVisibleStitchMm.toFixed(2)} | ${r.afterMaxVisibleStitchMm.toFixed(2)} | ${r.returnedMaxVisibleStitchMm.toFixed(2)} |`);
  md.push(`| stitchCount | ${r.beforeStitchCount} | ${r.afterStitchCount} | ${r.returnedStitchCount} |`);
  md.push(`| commandCount | ${r.beforeCommandCount} | ${r.afterCommandCount} | ${r.returnedCommandCount} |`);
  md.push(`| addedStitches | 0 | ${r.addedStitchesExperimental} | ${r.addedStitchesReturned} |`);
  md.push(`| visibleDiagonalStitches | ${r.visibleDiagonalStitchesBefore} | ${r.visibleDiagonalStitchesAfterExperimental} | ${r.visibleDiagonalStitchesAfter} |`);
  md.push(`| emptyBlocks | ${r.emptyBlocksBefore} | ${r.emptyBlocksAfterExperimental} | ${r.emptyBlocksAfter} |`);
  md.push(`| unsupportedLongStitches | ${r.unsupportedLongStitchesBefore} | ${r.unsupportedLongStitchesAfterExperimental} | ${r.unsupportedLongStitchesAfter} |`);
  md.push(`| CE01 status | ${r.ce01StatusBefore} | ${r.ce01StatusAfterExperimental} | ${r.ce01StatusAfter} |`);
  md.push(`| professionalScore | ${r.professionalScoreBefore} | — | ${r.professionalScoreAfter} |`);
  md.push(`| finalLookExportMismatch | ${r.finalLookExportMismatchBefore} | — | ${r.finalLookExportMismatchAfter} |`);
  md.push('\n## Candidates (gates por candidato)');
  md.push(`- **candidatesFound**: ${r.candidatesFound}`);
  md.push(`- candidatesPassedMetadata: ${r.candidatesPassedMetadata}`);
  md.push(`- candidatesPassedGeometry: ${r.candidatesPassedGeometry}`);
  md.push(`- candidatesPassedLocalGate: ${r.candidatesPassedLocalGate}`);
  md.push(`- **dryRunCandidatesApplied**: ${r.dryRunCandidatesApplied}`);
  md.push(`- **realCandidatesApplied**: ${r.realCandidatesApplied}`);
  md.push('\n## Candidates skipped');
  md.push(`- interpolatedPointOutsideRegion: ${r.candidatesSkippedInterpolatedPointOutsideRegion}`);
  md.push(`- localVisibleDiagWouldIncrease: ${r.candidatesSkippedLocalVisibleDiagWouldIncrease}`);
  md.push(`- contour: ${r.candidatesSkippedContour}`);
  md.push(`- detail: ${r.candidatesSkippedDetail}`);
  md.push(`- satin: ${r.candidatesSkippedSatin}`);
  md.push(`- underlay: ${r.candidatesSkippedUnderlay}`);
  md.push(`- tie: ${r.candidatesSkippedTie}`);
  md.push(`- notFill: ${r.candidatesSkippedNotFill}`);
  md.push(`- differentRegion: ${r.candidatesSkippedDifferentRegion}`);
  md.push(`- differentColor: ${r.candidatesSkippedDifferentColor}`);
  md.push(`- noRegion: ${r.candidatesSkippedNoRegion}`);
  md.push(`- budgetExceeded: ${r.candidatesSkippedBudgetExceeded}`);
  md.push('\n## Veredicto');
  md.push(`- **phaseAccepted**: ${r.phaseAccepted}`);
  md.push(`- **phaseStatus**: ${r.phaseStatus}`);
  md.push(`- **splitterEffective**: ${r.splitterEffective}`);
  md.push(`- **commandsReturnedSource**: ${r.commandsReturnedSource}`);
  md.push(`- **addedStitchesExperimental**: ${r.addedStitchesExperimental}`);
  md.push(`- **addedStitchesReturned**: ${r.addedStitchesReturned}`);
  if (r.phaseAccepted) {
    md.push(`- La fase se aplicó. maxVisibleStitchMm ${r.beforeMaxVisibleStitchMm.toFixed(2)} → ${r.returnedMaxVisibleStitchMm.toFixed(2)} (mejora ${r.maxImprovement.toFixed(2)} mm).`);
  } else {
    md.push(`- **revertReason**: ${r.revertReason}`);
    md.push('- La fase se revirtió — se retornan los comandos previos al splitter (beforeSplitter).');
  }
  if (!r.splitterEffective) {
    md.push('\n## Decisión automática');
    md.push('- splitterEffective=false → NO_EFFECTIVE_REVERTED.');
    md.push('- No añadir puntadas si maxVisibleStitchMm no mejora.');
    md.push('- No insistir más con el splitter.');
    md.push('- **recommendation**: pasar a SATIN_OUTER_CONTOUR_CONVERTER_V1.');
  }
  md.push('\n## Criterios de aceptación V1_2');
  md.push('- maxImprovement >= 0.25mm  OR  afterMaxVisibleStitchMm <= targetMaxMm + 0.10');
  md.push('- sin regresión: visibleDiagonalStitches, emptyBlocks, unsupportedLongStitches, CE01 INVALID, exportAllowed, professionalScore, finalLookExportMismatch, coords numéricos');
  md.push('\n---');
  md.push('_REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2 — fix reversible post-generador. No modifica motor base ni exportación._');
  return md.join('\n');
}

function buildVisibleSplitterReportMd(r) {
  const md = [];
  md.push('# REFERENCE_VISIBLE_STITCH_SPLITTER_REPORT_V1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> REFERENCE_VISIBLE_STITCH_SPLITTER_V1 — división segura de puntadas de relleno largas.');
  md.push('> No toca buildFinalCommands, encoders, CE01 validator, V5.1 repair ni REFERENCE_TRIM_GUARD_V1.\n');
  md.push('## Parámetros');
  md.push(`- **targetMaxMm** (learnedMaxVisibleStitchMm): ${r.targetMaxMm}`);
  md.push(`- **effectiveMaxMm** (target + tolerancia 0.10): ${r.effectiveMaxMm}`);
  md.push(`- **maxAddedStitches** (presupuesto): ${r.maxAddedStitches} = min(800, max(80, ceil(${r.beforeStitchCount} * 0.12)))`);
  md.push('\n## Métricas clave antes/después');
  md.push('| Métrica | Antes | Después |');
  md.push('|---|---|---|');
  md.push(`| maxVisibleStitchMm | ${r.beforeMaxVisibleStitchMm.toFixed(2)} | ${r.afterMaxVisibleStitchMm.toFixed(2)} |`);
  md.push(`| stitchCount | ${r.beforeStitchCount} | ${r.afterStitchCount} |`);
  md.push(`| commandCount | ${r.beforeCommandCount} | ${r.afterCommandCount} |`);
  md.push(`| addedStitches | 0 | ${r.addedStitches} |`);
  md.push(`| visibleDiagonalStitches | ${r.visibleDiagonalStitchesBefore} | ${r.visibleDiagonalStitchesAfter} |`);
  md.push(`| emptyBlocks | ${r.emptyBlocksBefore} | ${r.emptyBlocksAfter} |`);
  md.push(`| unsupportedLongStitches | ${r.unsupportedLongStitchesBefore} | ${r.unsupportedLongStitchesAfter} |`);
  md.push(`| CE01 status | ${r.ce01StatusBefore} | ${r.ce01StatusAfter} |`);
  md.push(`| professionalScore | ${r.professionalScoreBefore} | ${r.professionalScoreAfter} |`);
  md.push(`| finalLookExportMismatch | false | ${r.finalLookExportMismatch} |`);
  md.push('\n## Candidatos');
  md.push(`- **candidatesFound**: ${r.candidatesFound}`);
  md.push(`- **candidatesSplit**: ${r.candidatesSplit}`);
  md.push(`- candidatesSkippedBecauseContour: ${r.candidatesSkippedBecauseContour}`);
  md.push(`- candidatesSkippedBecauseDetail: ${r.candidatesSkippedBecauseDetail}`);
  md.push(`- candidatesSkippedBecauseSatin: ${r.candidatesSkippedBecauseSatin}`);
  md.push(`- candidatesSkippedBecauseDifferentRegion: ${r.candidatesSkippedBecauseDifferentRegion}`);
  md.push(`- candidatesSkippedBecauseDifferentColor: ${r.candidatesSkippedBecauseDifferentColor}`);
  md.push(`- candidatesSkippedBecauseNoRegion: ${r.candidatesSkippedBecauseNoRegion}`);
  md.push(`- candidatesSkippedBecauseUnderlay: ${r.candidatesSkippedBecauseUnderlay}`);
  md.push(`- candidatesSkippedBecauseOther: ${r.candidatesSkippedBecauseOther}`);
  md.push(`- candidatesSkippedBecauseBudgetExceeded: ${r.candidatesSkippedBecauseBudgetExceeded}`);
  md.push('\n## Veredicto de fase');
  md.push(`- **phaseAccepted**: ${r.phaseAccepted}`);
  if (r.phaseAccepted) {
    md.push('- La fase se aplicó (maxVisibleStitchMm reducido sin regressión).');
  } else {
    md.push(`- **revertReason**: ${r.revertReason}`);
    md.push('- La fase se revirtió — se conservan los comandos originales.');
  }
  md.push('\n## Criterios de revertido');
  md.push('- visibleDiagonalStitches sube');
  md.push('- emptyBlocks sube');
  md.push('- unsupportedLongStitches sube');
  md.push('- CE01 pasa a INVALID');
  md.push('- professionalScore baja más de 3 puntos');
  md.push('- afterStitchCount > beforeStitchCount + maxAddedStitches');
  md.push('- finalLookExportMismatch pasa a true');
  md.push('- comando con x/y no numérico');
  md.push('\n---');
  md.push('_REFERENCE_VISIBLE_STITCH_SPLITTER_V1 — fix reversible post-generador. No modifica motor base ni exportación._');
  return md.join('\n');
}

export function getProfessionalPanelMetrics(commands, objects, regions, exportCommands, darkStroke, config) {
  const gate = professionalEmbroideryQualityGate(commands, objects, regions, darkStroke, config);
  const cmp = compareFinalLookVsExport(commands, exportCommands || commands);
  return { gate, cmp };
}

// ── Conversión outer satin → running (useSatinForOuterContours=false) ──────────
// Efecto REAL: el contorno exterior deja de ser zigzag satin y pasa a ser una
// línea running (centerline). Se reconstruye el centerline como el punto medio
// de cada par de puntadas opuestas (left/right rail). Se etiqueta stitchType
// como running_stitch. Es una conversión geométrica, no solo un relabel.
function convertOuterSatinToRunning(commands) {
  const out = [];
  let i = 0;
  while (i < commands.length) {
    const c = commands[i];
    const isOuterSatin = c.type === 'stitch' &&
      (c.layerType || '').toLowerCase().includes('outer_outline') &&
      ((c.stitchType || '').toLowerCase().includes('satin') || (c.source || '').toLowerCase().includes('satin'));
    if (!isOuterSatin) { out.push(c); i++; continue; }
    // recolectar run de satin outer continuo
    const run = [];
    while (i < commands.length) {
      const cc = commands[i];
      if (cc.type === 'stitch' &&
        (cc.layerType || '').toLowerCase().includes('outer_outline') &&
        ((cc.stitchType || '').toLowerCase().includes('satin') || (cc.source || '').toLowerCase().includes('satin'))) {
        run.push(cc); i++;
      } else break;
    }
    // centerline = punto medio de cada par (left/right rail)
    const mid = [];
    for (let k = 0; k + 1 < run.length; k += 2) {
      const a = run[k], b = run[k + 1];
      mid.push({ ...a, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, stitchType: 'running_stitch', source: 'satin_to_running' });
    }
    if (run.length % 2 === 1) {
      // puntada impar residual: proyectar al último punto del run
      const last = run[run.length - 1];
      mid.push({ ...last, stitchType: 'running_stitch', source: 'satin_to_running' });
    }
    if (mid.length) out.push(...mid);
  }
  return out;
}

// Marca los objetos de contorno exterior como running para que el gate cuente
// satinContourCount/runningContourCount de forma coherente con los comandos.
function markOuterObjectsAsRunning(objects) {
  if (!Array.isArray(objects)) return objects;
  return objects.map((o) => {
    if ((o.layerType || '').toLowerCase().includes('outer_outline') && o.stitch_type === 'satin') {
      return { ...o, stitch_type: 'running_stitch' };
    }
    return o;
  });
}