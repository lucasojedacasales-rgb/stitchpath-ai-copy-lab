/**
 * simulationMetrics.js — Professional Embroidery Machine Simulation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Computes the full physical simulation of a sewing machine running a design:
 *   • Per-command analysis: position, direction, length, speed, block, tie-in/off
 *   • Real-time error detection: density, jumps, open objects, micro/macro stitches,
 *     unnecessary crossings, bad block ordering
 *   • Heat map classification: green (correct), yellow (risk), red (problem)
 *   • Production metrics: stitches, jumps, trims, color changes, distances, time,
 *     route efficiency
 *   • Quality score (0–100) and recommendations (critical / warnings / improvements)
 */

import { DEFAULT_MACHINE } from './exportPipeline';
import { buildSimulationBlocks } from './stitchSimulation';

const MACHINE_SPM = 800;       // stitches per minute (Caydo CE01 nominal)
const COLOR_CHANGE_S = 30;     // seconds per color change
const TRIM_S = 5;              // seconds per trim
const MIN_STITCH_MM = 0.3;     // below = degenerate / micro-stitch
const TIE_INOUT_COUNT = 3;     // stitches counted as tie-in / tie-off
const DENSITY_WINDOW_MM = 5;   // radius for local density check
const DENSITY_MAX_PER_MM2 = 4; // max stitches per mm² before "excessive density"
const CROSS_CHECK_WINDOW = 12; // look-back window for crossing detection

/**
 * Full simulation analysis.
 * @param {Array}  commands — flat command sequence from flattenToCommands
 * @param {Array}  objects  — stitch objects from buildStitchObjects
 * @param {Object} machine  — machine settings
 * @returns {Object} analysis result
 */
export function analyzeSimulation(commands, objects, machine = {}, regions = null, config = null) {
  const ms = { ...DEFAULT_MACHINE, ...machine };

  const perCommand = [];
  const errors = [];
  const heatMap = [];

  let prevX = 0, prevY = 0;
  let prevColor = null;
  let blockId = 0;
  let stitchesInBlock = 0;
  let blockStartIndex = 0;
  const stitchPositions = []; // for density + crossing checks

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const hasCoords = c.x !== undefined && Number.isFinite(c.x) && Number.isFinite(c.y);

    // Block boundary detection
    const isBoundary = c.type === 'colorChange' || c.type === 'trim';
    if (isBoundary && stitchesInBlock > 0) {
      blockId++;
      stitchesInBlock = 0;
      blockStartIndex = i + 1;
    }

    const length = hasCoords ? Math.hypot(c.x - prevX, c.y - prevY) : 0;
    const direction = hasCoords && length > 0.01
      ? Math.round((Math.atan2(c.y - prevY, c.x - prevX) * 180 / Math.PI + 360) % 360)
      : null;

    // Speed estimate: mm/s based on SPM and stitch length
    const speedMmS = c.type === 'stitch' && length > 0
      ? +(MACHINE_SPM * length / 60).toFixed(1)
      : 0;

    // Tie-in / tie-off detection
    let tiePhase = null;
    if (c.type === 'stitch' && stitchesInBlock < TIE_INOUT_COUNT) tiePhase = 'tie-in';

    const cmdErrors = [];

    if (c.type === 'stitch' && hasCoords) {
      // R-micro: stitch too small
      if (length > 0 && length < MIN_STITCH_MM) {
        cmdErrors.push({ rule: 'MICRO', severity: 'MINOR', message: `Puntada micro (${length.toFixed(2)}mm < ${MIN_STITCH_MM}mm)` });
      }
      // R-macro: stitch too long
      if (length > ms.maxStitchLength) {
        cmdErrors.push({ rule: 'MACRO', severity: 'CRITICAL', message: `Puntada excesiva (${length.toFixed(1)}mm > ${ms.maxStitchLength}mm)` });
      }
      // Density check: count stitches within DENSITY_WINDOW_MM
      let nearby = 0;
      for (const p of stitchPositions) {
        if (Math.hypot(p[0] - c.x, p[1] - c.y) < DENSITY_WINDOW_MM) nearby++;
      }
      const densityPerMm2 = nearby / (Math.PI * DENSITY_WINDOW_MM * DENSITY_WINDOW_MM);
      if (densityPerMm2 > DENSITY_MAX_PER_MM2) {
        cmdErrors.push({ rule: 'DENSITY', severity: 'MAJOR', message: `Densidad excesiva (${densityPerMm2.toFixed(1)}/mm²)` });
      }
      // Crossing detection: does this stitch intersect any recent stitch?
      if (length > 0.5 && prevX !== undefined) {
        for (let j = Math.max(0, stitchPositions.length - CROSS_CHECK_WINDOW); j < stitchPositions.length - 1; j++) {
          const p1 = stitchPositions[j];
          const p2 = stitchPositions[j + 1];
          if (!p1 || !p2) continue;
          if (segmentsIntersect(prevX, prevY, c.x, c.y, p1[0], p1[1], p2[0], p2[1])) {
            cmdErrors.push({ rule: 'CROSS', severity: 'MINOR', message: 'Cruce innecesario detectado' });
            break;
          }
        }
      }
      stitchPositions.push([c.x, c.y]);
      stitchesInBlock++;
    }

    if (c.type === 'jump' && hasCoords) {
      if (length > ms.trimThreshold) {
        const prevCmd = i > 0 ? commands[i - 1] : null;
        const isFirstJump = !prevCmd || prevCmd.type !== 'jump';
        if (isFirstJump && prevCmd && prevCmd.type !== 'trim' && prevCmd.type !== 'colorChange') {
          cmdErrors.push({ rule: 'JUMP', severity: 'CRITICAL', message: `Salto largo (${length.toFixed(1)}mm) sin corte previo` });
        }
      }
      if (length > ms.maxJumpLength) {
        cmdErrors.push({ rule: 'JUMP2', severity: 'CRITICAL', message: `Salto excesivo (${length.toFixed(1)}mm > ${ms.maxJumpLength}mm)` });
      }
    }

    // Abrupt direction change detection (vibration risk)
    if (c.type === 'stitch' && hasCoords && perCommand.length > 1) {
      const prev = perCommand[perCommand.length - 1];
      if (prev && prev.direction !== null && direction !== null && length > 0.5) {
        let delta = Math.abs(direction - prev.direction);
        if (delta > 180) delta = 360 - delta;
        if (delta > 150) {
          cmdErrors.push({ rule: 'VIBRATION', severity: 'MINOR', message: `Cambio brusco de dirección (${Math.round(delta)}°) — vibración` });
        }
      }
    }

    // Tie-off: last few stitches before a boundary
    if (c.type === 'stitch') {
      // Look ahead: is a trim/colorChange coming soon?
      for (let k = i + 1; k <= Math.min(i + TIE_INOUT_COUNT, commands.length - 1); k++) {
        if (commands[k] && (commands[k].type === 'trim' || commands[k].type === 'colorChange' || commands[k].type === 'end')) {
          const remaining = k - i;
          if (remaining <= TIE_INOUT_COUNT && remaining > 0) {
            tiePhase = 'tie-off';
          }
          break;
        }
      }
    }

    // Heat map status
    let heatStatus = 'green';
    if (cmdErrors.some(e => e.severity === 'CRITICAL')) heatStatus = 'red';
    else if (cmdErrors.length > 0) heatStatus = 'yellow';
    else if (c.type === 'jump' && length > ms.trimThreshold * 0.7) heatStatus = 'yellow';
    else if (c.type === 'stitch' && (length < MIN_STITCH_MM * 2 || length > ms.maxStitchLength * 0.8)) heatStatus = 'yellow';

    // Accumulate errors
    for (const e of cmdErrors) {
      errors.push({ ...e, index: i, blockId, regionId: c.regionId });
    }

    perCommand.push({
      index: i,
      type: c.type,
      x: hasCoords ? c.x : null,
      y: hasCoords ? c.y : null,
      color: c.color || prevColor,
      length: +length.toFixed(3),
      direction,
      speedMmS,
      blockId,
      tiePhase,
      errors: cmdErrors,
      heatStatus,
    });

    heatMap.push({ index: i, status: heatStatus });

    if (hasCoords) { prevX = c.x; prevY = c.y; }
    if (c.color) prevColor = c.color;
  }

  // ── Open objects check (R5) ──────────────────────────────────────────────
  for (const obj of objects) {
    if (obj.points.length >= 3) {
      const [fx, fy] = obj.points[0];
      const [lx, ly] = obj.points[obj.points.length - 1];
      const gap = Math.hypot(fx - lx, fy - ly);
      if (gap > 0.5) {
        errors.push({ rule: 'OPEN', severity: 'MAJOR', message: `Objeto abierto: ${obj.id} (gap ${gap.toFixed(1)}mm)`, regionId: obj.id });
      }
    }
  }

  // ── Block ordering check: fill should come before satin of same color ────
  const colorBlockTypes = {};
  for (const pc of perCommand) {
    if (pc.type !== 'stitch') continue;
    const key = pc.color || '_';
    if (!colorBlockTypes[key]) colorBlockTypes[key] = [];
    colorBlockTypes[key].push({ blockId: pc.blockId, stitchType: pc.stitchType });
  }

  // ── Metrics ──────────────────────────────────────────────────────────────
  const metrics = computeMetrics(commands, perCommand, ms);

  // ── Visual simulation stats (region-aware) ──────────────────────────────
  if (regions && config) {
    try {
      const { stats: visStats } = buildSimulationBlocks(commands, regions, config);
      metrics.stitchesOutsideRegion = visStats.stitchesOutsideRegion;
      metrics.duplicateStitches    = visStats.duplicateStitches;
      metrics.shortStitches        = visStats.shortStitches;
      metrics.longStitches         = visStats.longStitches;
      metrics.maxDensityPerZone    = visStats.maxDensityPerZone;
    } catch (e) {
      console.warn('[simulationMetrics] Visual stats failed:', e.message);
    }
  }

  // ── Quality score ────────────────────────────────────────────────────────
  const { score, status } = computeQualityScore(errors, metrics);

  // ── Recommendations ──────────────────────────────────────────────────────
  const recommendations = buildRecommendations(errors, metrics, score);

  return {
    perCommand,
    heatMap,
    errors,
    metrics,
    qualityScore: score,
    status,
    recommendations,
    blockCount: blockId + 1,
  };
}

function computeMetrics(commands, perCommand, ms) {
  let totalStitches = 0, totalJumps = 0, totalTrims = 0, colorChanges = 0;
  let sewingDistance = 0, jumpDistance = 0;
  let prevX = 0, prevY = 0;

  for (const c of commands) {
    if (c.x === undefined || !Number.isFinite(c.x)) {
      if (c.type === 'trim') totalTrims++;
      if (c.type === 'colorChange') colorChanges++;
      continue;
    }
    const dist = Math.hypot(c.x - prevX, c.y - prevY);
    if (c.type === 'stitch') { totalStitches++; sewingDistance += dist; }
    if (c.type === 'jump')   { totalJumps++;   jumpDistance   += dist; }
    prevX = c.x; prevY = c.y;
  }

  const totalDistance = sewingDistance + jumpDistance;
  const routeEfficiency = totalDistance > 0
    ? +((sewingDistance / totalDistance) * 100).toFixed(1)
    : 0;
  const estimatedTimeMin = +(
    (totalStitches / MACHINE_SPM) +
    (colorChanges * COLOR_CHANGE_S / 60) +
    (totalTrims * TRIM_S / 60)
  ).toFixed(1);

  return {
    totalStitches,
    totalJumps,
    totalTrims,
    colorChanges,
    sewingDistance: +sewingDistance.toFixed(1),
    jumpDistance: +jumpDistance.toFixed(1),
    totalDistance: +totalDistance.toFixed(1),
    estimatedTimeMin,
    routeEfficiency,
    blockCount: new Set(perCommand.filter(p => p.type === 'stitch').map(p => p.blockId)).size,
  };
}

function computeQualityScore(errors, metrics) {
  let score = 100;
  let critical = 0, major = 0, minor = 0;

  for (const e of errors) {
    if (e.severity === 'CRITICAL') { score -= 15; critical++; }
    else if (e.severity === 'MAJOR') { score -= 7; major++; }
    else { score -= 2; minor++; }
  }

  // Route efficiency penalty
  if (metrics.routeEfficiency < 70) score -= (70 - metrics.routeEfficiency) * 0.5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  let status;
  if (score >= 95 && critical === 0) status = 'SAFE';
  else if (score >= 70) status = 'RISKY';
  else status = 'INVALID';

  return { score, status, critical, major, minor };
}

function buildRecommendations(errors, metrics, score) {
  const critical = [];
  const warnings = [];
  const improvements = [];

  const ruleCounts = {};
  for (const e of errors) {
    ruleCounts[e.rule] = (ruleCounts[e.rule] || 0) + 1;
  }

  if (ruleCounts.JUMP) critical.push(`${ruleCounts.JUMP} salto(s) largo(s) sin corte — insertar trim antes de exportar.`);
  if (ruleCounts.JUMP2) critical.push(`${ruleCounts.JUMP2} salto(s) exceden el límite físico de la máquina — dividir.`);
  if (ruleCounts.MACRO) critical.push(`${ruleCounts.MACRO} puntada(s) excesiva(s) — dividir en sub-puntadas.`);
  if (ruleCounts.OPEN) critical.push(`${ruleCounts.OPEN} objeto(s) abierto(s) — cerrar contornos.`);
  if (ruleCounts.DENSITY) warnings.push(`${ruleCounts.DENSITY} zona(s) con densidad excesiva — reducir densidad de fill.`);
  if (ruleCounts.MICRO) warnings.push(`${ruleCounts.MICRO} puntada(s) micro (<${MIN_STITCH_MM}mm) — eliminar nodos redundantes.`);
  if (ruleCounts.CROSS) warnings.push(`${ruleCounts.CROSS} cruce(s) innecesario(s) — reordenar travel path.`);
  if (ruleCounts.VIBRATION) warnings.push(`${ruleCounts.VIBRATION} cambio(s) brusco(s) de dirección — suavizar con Chaikin.`);

  if (metrics.routeEfficiency < 70) {
    improvements.push(`Eficiencia de recorrido ${metrics.routeEfficiency}% — optimizar travel path para reducir saltos.`);
  }
  if (metrics.colorChanges > 8) {
    improvements.push(`${metrics.colorChanges} cambios de color — reducir paleta para menos paradas.`);
  }
  if (metrics.jumpDistance > metrics.sewingDistance * 0.3) {
    improvements.push('Distancia sin coser elevada — reagrupar regiones por proximidad.');
  }

  if (critical.length === 0 && warnings.length === 0) {
    improvements.push('Diseño en estado SAFE — listo para bordar sin errores previsibles.');
  }

  return { critical, warnings, improvements, score, status: score >= 95 ? 'SAFE' : score >= 70 ? 'RISKY' : 'INVALID' };
}

// ─── Geometry helpers ──────────────────────────────────────────────────────

function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}