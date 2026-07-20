/**
 * visibleDiagonalDetector.js — ÚNICO detector de diagonales visibles
 * ─────────────────────────────────────────────────────────────────────────────
 * Fuente única de verdad para:
 *   - exportErrorDetector (visibleDiag count)
 *   - preExportRepairer.repairVisibleDiagonalStitches
 *   - professionalDigitizingMode.countVisibleDiagonalStitches / Quality Gate
 *   - exportRepairReport V3 (forensics)
 *
 * Una puntada es "diagonal visible" si:
 *   - longitud en (VISIBLE_DIAG_MIN_MM, VISIBLE_DIAG_MAX_MM]
 *   - NO es fill tatami válido dentro de su propia región
 *   - NO es contorno con soporte real de línea negra (darkMask)
 *
 * Devuelve offenders con clasificación forense completa + reason + repairable.
 * count = offenders reparables (excluye validFillTatami y contourWithDarkMask).
 */

const VISIBLE_DIAG_MIN_MM = 3.0;
const VISIBLE_DIAG_MAX_MM = 8.0;
const CONTOUR_DARK_SUPPORT_MIN = 0.5;

const NORM_W = 100, NORM_H = 100;

// ── helpers (inline para evitar dependencias circulares) ──────────────────────
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
function isDetailLayer(cmd) {
  const lt = String(cmd.layerType || '').toLowerCase();
  const rc = String(cmd.region_class || '').toLowerCase();
  return lt.includes('mouth') || lt.includes('eye') || lt.includes('facial') ||
    lt.includes('detail') || rc.includes('detail') || rc.includes('mouth') || rc.includes('eye');
}
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
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

function angleDeg(dx, dy) {
  let deg = Math.atan2(dy, dx) * 180 / Math.PI;
  return ((deg % 180) + 180) % 180;
}

/**
 * @returns {{ count, offenders, repairableCount, preservedTatami, preservedContourWithMask }}
 */
export function detectVisibleDiagonalStitches(commands = [], objects = [], regions = [], darkStroke = null, config = {}) {
  const contourMin = (config?.professionalParams?.contourDarkSupportMin) ?? CONTOUR_DARK_SUPPORT_MIN;
  const offenders = [];
  let prev = null, prevIdx = -1;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!c) continue;
    if (c.type !== 'stitch') {
      if (c.type === 'jump') { prev = { x: c.x, y: c.y }; prevIdx = i; }
      continue;
    }
    if (prev) {
      const cx = c.x ?? 0, cy = c.y ?? 0;
      const dx = cx - prev.x, dy = cy - prev.y;
      const len = Math.hypot(dx, dy);
      if (len > VISIBLE_DIAG_MIN_MM && len <= VISIBLE_DIAG_MAX_MM) {
        const rPrev = regionAt(prev.x, prev.y, regions);
        const rCur = regionAt(cx, cy, regions);
        const sameRegion = rPrev && rCur && rPrev.id === rCur.id;
        const contour = isContourLayer(c);
        const detail = isDetailLayer(c);
        const isFill = !contour && !detail && (c.stitchType === 'fill' || !c.stitchType);
        const isFillTatami = sameRegion && isFill;
        const darkSup = (contour || isDarkColor(c.color))
          ? segmentDarkSupport(prev.x, prev.y, cx, cy, darkStroke)
          : 0;
        const crossesEmpty = !rPrev && !rCur;
        const crossesMultiple = rPrev && rCur && rPrev.id !== rCur.id;

        let reason = null, repairable = false;
        if (isFillTatami) { reason = 'validFillTatami'; repairable = false; }
        else if (contour && darkSup >= contourMin) { reason = 'contourWithDarkMask'; repairable = false; }
        else if (contour && darkSup < contourMin) { reason = 'contourNoDarkMask'; repairable = true; }
        else if (crossesEmpty) { reason = 'crossesEmptySpace'; repairable = true; }
        else if (crossesMultiple) { reason = 'crossesMultipleRegions'; repairable = true; }
        else if (!rPrev || !rCur) { reason = 'travelBetweenObjects'; repairable = true; }
        else { reason = 'sameRegionNonFill'; repairable = true; }

        offenders.push({
          commandIndex: i,
          prevCommandIndex: prevIdx,
          from: { x: prev.x, y: prev.y },
          to: { x: cx, y: cy },
          lengthMm: len,
          angleDeg: angleDeg(dx, dy),
          color: c.color,
          stitchType: c.stitchType,
          objectId: c.regionId,
          regionId: c.regionId,
          regionName: (rCur && (rCur.name || rCur.id)) || (rPrev && (rPrev.name || rPrev.id)) || null,
          isFillTatami,
          isContour: contour,
          sameRegionSupport: sameRegion,
          darkMaskSupport: darkSup,
          crossesEmptySpace: crossesEmpty,
          crossesMultipleRegions: crossesMultiple,
          reason,
          repairable,
          recommendedAction: repairable
            ? (reason === 'crossesEmptySpace' ? 'convert_to_jump'
              : reason === 'contourNoDarkMask' ? 'cut_chain_and_jump'
              : 'convert_to_trim_and_jump')
            : 'preserve',
        });
      }
    }
    prev = { x: c.x ?? 0, y: c.y ?? 0 }; prevIdx = i;
  }

  const repairableOffenders = offenders.filter(o => o.repairable);
  const preservedTatami = offenders.filter(o => o.reason === 'validFillTatami').length;
  const preservedContour = offenders.filter(o => o.reason === 'contourWithDarkMask').length;

  return {
    count: repairableOffenders.length,
    offenders,
    repairableCount: repairableOffenders.length,
    preservedTatamiDiagonal: preservedTatami,
    preservedContourWithMask: preservedContour,
  };
}

// ── Informe forense VISIBLE_DIAGONAL_FORENSICS.md ─────────────────────────────
export function generateVisibleDiagonalForensicsReport(detection, { limit = 30 } = {}) {
  const { count, offenders, preservedTatamiDiagonal, preservedContourWithMask } = detection;
  const md = [];
  md.push('# VISIBLE_DIAGONAL_FORENSICS — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push(`> Detector único: detectVisibleDiagonalStitches (visibleDiagonalDetector.js)\n`);

  md.push('## Resumen');
  md.push(`- Offenders totales analizados: **${offenders.length}**`);
  md.push(`- Reparables (count): **${count}**`);
  md.push(`- PreservedTatamiDiagonal (fill válido en región): **${preservedTatamiDiagonal}**`);
  md.push(`- PreservedContourWithDarkMask (contorno con línea negra real): **${preservedContourWithMask}**\n`);

  // Distribución por reason
  const byReason = {};
  for (const o of offenders) byReason[o.reason] = (byReason[o.reason] || 0) + 1;
  md.push('## Distribución por reason');
  md.push('| reason | count | repairable |');
  md.push('|---|---|---|');
  for (const [r, n] of Object.entries(byReason)) {
    const rep = offenders.find(o => o.reason === r)?.repairable;
    md.push(`| ${r} | ${n} | ${rep ? 'SÍ' : 'NO'} |`);
  }
  md.push('');

  md.push(`## Primeros ${Math.min(limit, offenders.length)} offenders\n`);
  md.push('| # | cmdIdx | lengthMm | angle° | color | stitchType | region | reason | fillTatami | regionSup | darkMask | action |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  offenders.slice(0, limit).forEach((o, k) => {
    md.push(`| ${k + 1} | ${o.commandIndex} | ${o.lengthMm.toFixed(2)} | ${o.angleDeg.toFixed(0)} | ${o.color || '—'} | ${o.stitchType || '—'} | ${o.regionName || '—'} | ${o.reason} | ${o.isFillTatami ? 'SÍ' : 'no'} | ${o.sameRegionSupport ? 'SÍ' : 'no'} | ${o.darkMaskSupport.toFixed(2)} | ${o.recommendedAction} |`);
  });
  md.push('');

  md.push('## Criterio de reparación');
  md.push('- validFillTatami → NO reparar (preservedTatamiDiagonal)');
  md.push('- contourWithDarkMask → NO reparar (contorno con soporte de línea negra real)');
  md.push('- contourNoDarkMask → cortar cadena + jump');
  md.push('- crossesEmptySpace → jump (sin coser el vacío)');
  md.push('- crossesMultipleRegions → trim + jump');
  md.push('- travelBetweenObjects → trim + jump');
  md.push('- sameRegionNonFill → trim + jump');
  md.push('');

  md.push('---');
  md.push('_Detector unificado — la misma lista que usa el Quality Gate, el repair y el report._');
  return md.join('\n');
}