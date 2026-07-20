/**
 * needlePath.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de cálculo del recorrido óptimo de la aguja entre regiones.
 * Minimiza saltos y cambios de hilo basándose en:
 *  - Proximidad euclidiana entre centroides
 *  - Prioridad de regiones (capas base primero)
 *  - Agrupación por color (evita cambios innecesarios)
 *  - Ponderaciones configurables
 */

// ─── Constantes de optimización ──────────────────────────────────────────────

const OPTIMIZATION_WEIGHTS = {
  distanceFactor:  0.4,   // peso de la proximidad en TSP
  colorChangePenalty: 100, // penalización por cambio de hilo (en mm equivalentes)
  priorityBonus:   0.3,   // bonus para regiones prioritarias
};

// ─── Helpers geométricos ──────────────────────────────────────────────────────

function getCentroid(region) {
  if (region.centroid) return region.centroid;
  // Guard: undefined/empty path_points must NOT fall through to .reduce()
  if (!region.path_points || region.path_points.length === 0) return [0.5, 0.5];
  const pts = region.path_points;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [cx, cy];
}

function distance(p1, p2) {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}

// ─── Costo de transición (penaliza cambios de hilo y distancia) ─────────────

function transitionCost(fromRegion, toRegion, config = {}) {
  const { distanceFactor = 0.4, colorChangePenalty = 100 } = config;

  const c1 = getCentroid(fromRegion);
  const c2 = getCentroid(toRegion);
  const dist = distance(c1, c2);

  // Penalización por cambio de color
  const colorPenalty = fromRegion.color !== toRegion.color ? colorChangePenalty : 0;

  // Costo total: distancia + penalización por color (normalizado a [0,1])
  return dist * distanceFactor + (colorPenalty / 100) * (1 - distanceFactor);
}

// ─── TSP Greedy + 2-opt local optimization ─────────────────────────────────

function greedyTSPWithPriority(regions, startPos = [0.5, 0.5], config = {}) {
  if (regions.length === 0) return [];

  const remaining = [...regions];
  const ordered = [];
  let cursor = startPos;
  let lastColor = null;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestCost = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const c = getCentroid(candidate);
      let cost = distance(cursor, c);

      // Bonus: mismo color = 30% descuento (no requiere corte/cambio)
      if (lastColor && candidate.color === lastColor) {
        cost *= 0.7;
      }

      // Bonus: prioridad (regiones base primero)
      if (candidate.priority) {
        cost *= Math.max(0.5, 1 - candidate.priority / 5 * 0.3);
      }

      // Penalidad: cambio de color si hay alternativas del mismo color
      if (lastColor && candidate.color !== lastColor) {
        const sameColorAlternative = remaining.some(
          r => r.color === lastColor && r.id !== candidate.id
        );
        if (sameColorAlternative) cost *= 1.5;
      }

      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }

    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cursor = getCentroid(next);
    lastColor = next.color;
  }

  // Aplicar 2-opt local para mejorar tour
  return twoOptImprove(ordered);
}

/**
 * 2-opt local optimization with color-change penalty.
 * A swap is only accepted when the combined cost (distance + color change penalty)
 * improves. This prevents 2-opt from reducing 1mm of travel at the cost of
 * introducing extra thread changes (each = ~30s machine time = ~150mm equivalent).
 *
 * COLOR_CHANGE_MM_EQUIV: treat each color change as equivalent to this many mm of
 * travel for cost comparison purposes. At 300mm/s jump speed, 30s = 9000mm — we
 * use a conservative 50mm to avoid over-constraining proximity optimization.
 */
const COLOR_CHANGE_MM_EQUIV = 50;

function colorChangeCost(a, b) {
  return (a && b && a.color !== b.color) ? COLOR_CHANGE_MM_EQUIV : 0;
}

function twoOptImprove(tour, maxIterations = 100) {
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < tour.length - 2; i++) {
      for (let j = i + 2; j < tour.length; j++) {
        const c1 = getCentroid(tour[i]);
        const c2 = getCentroid(tour[i + 1]);
        const c3 = getCentroid(tour[j]);
        const c4 = getCentroid(tour[(j + 1) % tour.length]);

        // Current cost: distance i→i+1 + distance j→j+1 + color penalties
        const dCurrent = distance(c1, c2) + distance(c3, c4)
          + colorChangeCost(tour[i], tour[i + 1])
          + colorChangeCost(tour[j], tour[(j + 1) % tour.length]);

        // New cost after 2-opt reversal: i→j + i+1→j+1
        const dNew = distance(c1, c3) + distance(c2, c4)
          + colorChangeCost(tour[i], tour[j])
          + colorChangeCost(tour[i + 1], tour[(j + 1) % tour.length]);

        if (dNew < dCurrent - 1e-6) {
          const newTour = [...tour];
          let left = i + 1, right = j;
          while (left < right) {
            [newTour[left], newTour[right]] = [newTour[right], newTour[left]];
            left++; right--;
          }
          tour = newTour;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return tour;
}

// ─── Agrupación por color con optimización intra-grupo ─────────────────────

function optimizeByColorGroup(regions, config = {}) {
  // Agrupar por color
  const colorGroups = {};
  for (const r of regions) {
    const color = r.color || '#000000';
    if (!colorGroups[color]) colorGroups[color] = [];
    colorGroups[color].push(r);
  }

  // Convertir a array y ordenar grupos por área total (grandes primero)
  const groups = Object.entries(colorGroups)
    .map(([color, regs]) => ({
      color,
      regions: regs,
      totalArea: regs.reduce((s, r) => s + (r.area_mm2 || 0), 0),
      avgPriority: regs.reduce((s, r) => s + (r.priority || 1), 0) / regs.length,
    }))
    .sort((a, b) => b.avgPriority - a.avgPriority || b.totalArea - a.totalArea);

  // Dentro de cada grupo: TSP local
  for (const group of groups) {
    group.optimizedRegions = greedyTSPWithPriority(group.regions, [0.5, 0.5], config);
  }

  // Ordenar grupos por proximidad global (TSP de grupos)
  const groupCentroids = groups.map(g => {
    const cs = g.optimizedRegions.map(getCentroid);
    return [
      cs.reduce((s, c) => s + c[0], 0) / cs.length,
      cs.reduce((s, c) => s + c[1], 0) / cs.length,
    ];
  });

  const groupsWithCentroid = groups.map((g, i) => ({
    ...g,
    groupCentroid: groupCentroids[i],
  }));

  const orderedGroups = greedyTSPWithPriority(groupsWithCentroid, [0.5, 0.5], config);

  return {
    sequence: orderedGroups.flatMap(g => g.optimizedRegions),
    groups: orderedGroups.map(g => ({
      color: g.color,
      count: g.regions.length,
      totalArea: g.totalArea,
      regionIds: g.optimizedRegions.map(r => r.id),
    })),
  };
}

// ─── Cálculo de métricas de recorrido ──────────────────────────────────────

export function calculateNeedlePathMetrics(sequence, designWidthMm = 100, designHeightMm = 100) {
  if (!sequence || sequence.length === 0) {
    return {
      totalDistance: 0,
      totalJumps: 0,
      colorChanges: 0,
      sameColorJumps: 0,
      differentColorJumps: 0,
      averageJumpDistance: 0,
      metrics: {},
    };
  }

  let totalDistance = 0;
  let totalJumps = 0;
  let colorChanges = 0;
  let sameColorJumps = 0;
  let differentColorJumps = 0;
  const jumps = [];
  const colorChangeJumps = [];
  let prevColor = null;
  let prevPos = [0, 0];

  for (const region of sequence) {
    const c = getCentroid(region);
    const jumpDist = distance(prevPos, c) * designWidthMm;

    if (jumpDist > 0.5) {
      totalJumps++;
      jumps.push(jumpDist);
      totalDistance += jumpDist;

      if (prevColor && region.color === prevColor) {
        sameColorJumps++;
      } else if (prevColor && region.color !== prevColor) {
        differentColorJumps++;
        colorChangeJumps.push(jumpDist);
        colorChanges++;
      } else {
        sameColorJumps++;
      }
    }

    prevColor = region.color;
    prevPos = c;
  }

  const averageJumpDistance = jumps.length > 0
    ? jumps.reduce((s, j) => s + j, 0) / jumps.length
    : 0;

  const averageColorChangeJump = colorChangeJumps.length > 0
    ? colorChangeJumps.reduce((s, j) => s + j, 0) / colorChangeJumps.length
    : 0;

  const maxJumpDistance = jumps.length > 0 ? Math.max(...jumps) : 0;
  const minJumpDistance = jumps.length > 0 ? Math.min(...jumps) : 0;

  return {
    totalDistance: Math.round(totalDistance),
    totalJumps,
    colorChanges,
    sameColorJumps,
    differentColorJumps,
    averageJumpDistance: Math.round(averageJumpDistance * 10) / 10,
    averageColorChangeJump: Math.round(averageColorChangeJump * 10) / 10,
    maxJumpDistance: Math.round(maxJumpDistance * 10) / 10,
    minJumpDistance: Math.round(minJumpDistance * 10) / 10,
    regionCount: sequence.length,
    uniqueColors: new Set(sequence.map(r => r.color)).size,
  };
}

// ─── Estimación de tiempo de máquina ──────────────────────────────────────

export function estimateMachineTime(sequence, metrics, speedSpm = 800) {
  const totalStitches = sequence.reduce((s, r) => s + (r.stitch_count || 0), 0);

  const stitchSeconds = (totalStitches / speedSpm) * 60;

  const sameColorDistance = metrics.sameColorJumps > 0
    ? (metrics.totalDistance * (metrics.sameColorJumps / metrics.totalJumps))
    : 0;
  const differentColorDistance = metrics.totalDistance - sameColorDistance;

  const jumpSecondsSameColor = sameColorDistance / 400;
  const jumpSecondsDifferent = differentColorDistance / 200;
  const jumpSeconds = jumpSecondsSameColor + jumpSecondsDifferent;

  const colorSeconds = (metrics.colorChanges || 0) * 20;

  const totalSeconds = stitchSeconds + jumpSeconds + colorSeconds;

  return {
    stitchSeconds: Math.round(stitchSeconds),
    jumpSecondsSameColor: Math.round(jumpSecondsSameColor),
    jumpSecondsDifferent: Math.round(jumpSecondsDifferent),
    jumpSeconds: Math.round(jumpSeconds),
    colorSeconds,
    totalSeconds: Math.round(totalSeconds),
    formatted: formatTime(Math.round(totalSeconds)),
  };
}

// ─── Generador de reporte de recorrido ────────────────────────────────────

export function generatePathReport(sequence, metrics, machineTime) {
  const parts = [];

  parts.push(`Recorrido optimizado (TSP + 2-opt):`);
  parts.push(`  • ${sequence.length} regiones en ${metrics.uniqueColors} color(es)`);
  parts.push(`  • Distancia: ${metrics.totalDistance} mm (${metrics.sameColorJumps} saltos internos + ${metrics.differentColorJumps} cambios)`);
  parts.push(`  • Salto promedio: ${metrics.averageJumpDistance} mm`);
  parts.push(`  • Cambios de hilo: ${metrics.colorChanges} (promedio: ${metrics.averageColorChangeJump} mm)`);
  parts.push(`Tiempo máquina: ${machineTime.formatted}`);
  parts.push(`  • Puntadas: ${machineTime.stitchSeconds}s`);
  parts.push(`  • Saltos (color): ${machineTime.jumpSecondsSameColor}s`);
  parts.push(`  • Saltos (cambio): ${machineTime.jumpSecondsDifferent}s`);
  parts.push(`  • Cambios hilo: ${machineTime.colorSeconds}s`);

  return parts.join('\n');
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Calcula el recorrido óptimo de la aguja entre regiones.
 * @param {Array}  regions - regiones enriquecidas
 * @param {Object} config  - { width_mm, height_mm, speed_spm }
 * @returns {Object} { sequence, metrics, machineTime, report, groups }
 */
export function optimizeNeedlePath(regions, config = {}) {
  const {
    width_mm = 100,
    height_mm = 100,
    speed_spm = 800,
  } = config;

  if (!regions || regions.length === 0) {
    return {
      sequence: [],
      metrics: null,
      machineTime: null,
      report: 'Sin regiones para procesar',
      groups: [],
    };
  }

  // 1. Optimizar secuencia considerando color y prioridad
  const { sequence, groups } = optimizeByColorGroup(regions, OPTIMIZATION_WEIGHTS);

  // 2. Calcular métricas del recorrido
  const metrics = calculateNeedlePathMetrics(sequence, width_mm, height_mm);

  // 3. Estimar tiempo de máquina
  const machineTime = estimateMachineTime(sequence, metrics, speed_spm);

  // 4. Generar reporte
  const report = generatePathReport(sequence, metrics, machineTime);

  return {
    sequence,        // orden optimizado de regiones
    metrics,         // distancias, saltos, cambios de color
    machineTime,     // desglose de tiempo
    report,          // reporte legible
    groups,          // agrupaciones por color
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}