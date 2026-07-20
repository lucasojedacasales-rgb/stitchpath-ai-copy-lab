/**
 * stitchSequenceOptimizer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Algoritmo de optimización de secuencia de puntadas para bordado industrial.
 *
 * Objetivo: minimizar saltos de hilo + cortes + cambios de color + tiempo total
 * manteniendo el orden de capas estético (fills → satins → running stitches).
 *
 * Pipeline:
 *  1. Pre-sort por banda de prioridad (garantiza integridad visual)
 *  2. Agrupación inteligente por color dentro de cada banda
 *  3. TSP Greedy Nearest-Neighbor como solución inicial
 *  4. 2-opt local (reversión de subsecuencias)
 *  5. Or-opt (reubicación de segmentos 1-3 regiones)
 *  6. Fusión de grupos de color adyacentes para eliminar cortes redundantes
 *  7. Métricas comparativas before/after
 */

// ─── Constantes físicas de bordado ────────────────────────────────────────────

const PHYSICS = {
  jumpSpeedMmS:      300,   // velocidad de salto (mm/s)
  colorChangeSec:    30,    // tiempo de cambio de hilo (s)
  threadCutThreshMm: 10,    // salto > 10mm → corte de hilo
  stitchLengthMm:    2.5,   // longitud promedio de puntada
  jumpThreadWaste:   0.6,   // factor de desperdicio de hilo en saltos
  // Equivalencia en mm de distancia para penalizaciones en optimización
  colorChangeMmEquiv: 120,  // cambio de hilo ≈ 120mm de viaje
  threadCutMmEquiv:   60,   // corte de hilo ≈ 60mm de viaje
};

// Bandas de prioridad — determina el orden de capas en el diseño final
const PRIORITY_BAND = {
  fill:   0,  // prioridad ≤ 4 (rellenos base)
  satin:  1,  // prioridad 5-7 (contornos satín)
  run:    2,  // prioridad ≥ 8 (detalles, corridas)
};

// ─── Utilidades geométricas ───────────────────────────────────────────────────

function getCentroid(region) {
  if (Array.isArray(region.centroid) && region.centroid.length === 2) return region.centroid;
  const pts = region.path_points;
  if (!pts || pts.length === 0) return [0.5, 0.5];
  return [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
}

function euclidean(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function getScale(widthMm, heightMm) {
  // Normalized [0,1] → mm using actual design diagonal
  return Math.sqrt(widthMm ** 2 + heightMm ** 2) / Math.SQRT2;
}

function bandOf(region) {
  const p = region.priority ?? 5;
  if (p <= 4) return PRIORITY_BAND.fill;
  if (p <= 7) return PRIORITY_BAND.satin;
  return PRIORITY_BAND.run;
}

// ─── Función de costo de transición ──────────────────────────────────────────
// Coste físico real de ir de la región A a la región B.

function transitionCostMm(from, to, scaleMm) {
  const c1 = getCentroid(from);
  const c2 = getCentroid(to);
  const distMm = euclidean(c1, c2) * scaleMm;

  let cost = distMm;

  // Penalización por cambio de hilo (cambio de color)
  if (from.color !== to.color) {
    cost += PHYSICS.colorChangeMmEquiv;
  }

  // Penalización adicional por corte (salto largo del mismo color)
  if (distMm > PHYSICS.threadCutThreshMm && from.color === to.color) {
    cost += PHYSICS.threadCutMmEquiv;
  }

  return cost;
}

// ─── 1. TSP Greedy Nearest-Neighbor ──────────────────────────────────────────

function greedyNN(regions, startPos, scaleMm) {
  if (regions.length === 0) return [];
  const remaining = [...regions];
  const ordered = [];
  let cursor = startPos;
  let lastRegion = null;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestCost = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const c = getCentroid(remaining[i]);
      let cost = euclidean(cursor, c) * scaleMm;

      // Favorece mismo color (sin penalización de cambio)
      if (lastRegion && remaining[i].color !== lastRegion.color) {
        // ¿Hay alguna región del mismo color disponible?
        const hasSameColor = remaining.some((r, idx) => idx !== i && r.color === (lastRegion?.color));
        if (hasSameColor) cost += PHYSICS.colorChangeMmEquiv * 0.5;
      }

      if (cost < bestCost) { bestCost = cost; bestIdx = i; }
    }

    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cursor = getCentroid(next);
    lastRegion = next;
  }

  return ordered;
}

// ─── 2. 2-opt con penalización de cambio de color ────────────────────────────

function twoOpt(tour, scaleMm, maxIter = 150) {
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIter) {
    improved = false;
    iterations++;

    for (let i = 0; i < tour.length - 2; i++) {
      for (let j = i + 2; j < tour.length; j++) {
        const a = tour[i], b = tour[i + 1];
        const c = tour[j], d = tour[(j + 1) % tour.length];

        const currentCost = transitionCostMm(a, b, scaleMm) + transitionCostMm(c, d, scaleMm);
        const newCost     = transitionCostMm(a, c, scaleMm) + transitionCostMm(b, d, scaleMm);

        if (newCost < currentCost - 1e-6) {
          // Revertir subsecuencia [i+1 … j]
          const newTour = [...tour];
          let l = i + 1, r = j;
          while (l < r) { [newTour[l], newTour[r]] = [newTour[r], newTour[l]]; l++; r--; }
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

// ─── 3. Or-opt: reubicar segmentos de k=1,2,3 regiones ───────────────────────
// Más potente que 2-opt para secuencias embroidery porque los patrones de acceso
// suelen ser localidades pequeñas (p.ej. letras adyacentes, flores del mismo color).

function orOpt(tour, scaleMm, maxIter = 100) {
  const n = tour.length;
  if (n < 5) return tour;

  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIter) {
    improved = false;
    iterations++;

    for (let segLen = 1; segLen <= 3; segLen++) {
      for (let i = 0; i < n - segLen; i++) {
        // Segmento: tour[i..i+segLen-1]
        const segStart = i;
        const segEnd   = i + segLen - 1;

        // Costo actual de extraer el segmento
        const prevI = (i === 0) ? null : tour[i - 1];
        const nextSeg = (segEnd + 1 < n) ? tour[segEnd + 1] : null;

        // Costo de "cerrar el hueco" al extraer el segmento
        const removeCost = (prevI && nextSeg)
          ? transitionCostMm(prevI, nextSeg, scaleMm)
          : 0;
        const removeSaved = (prevI ? transitionCostMm(prevI, tour[i], scaleMm) : 0)
                          + (nextSeg ? transitionCostMm(tour[segEnd], nextSeg, scaleMm) : 0);

        // Intentar insertar el segmento en cada otra posición
        for (let j = 0; j < n - segLen; j++) {
          // No insertar en la posición original ni adyacente
          if (j >= segStart - 1 && j <= segEnd) continue;

          const insertAfter = tour[j];
          const insertBefore = (j + 1 < n) ? tour[j + 1] : null;

          // Costo de insertar el segmento entre j y j+1
          const insertionCost =
            transitionCostMm(insertAfter, tour[segStart], scaleMm) +
            (insertBefore ? transitionCostMm(tour[segEnd], insertBefore, scaleMm) : 0) -
            (insertBefore ? transitionCostMm(insertAfter, insertBefore, scaleMm) : 0);

          const delta = removeCost - removeSaved + insertionCost;

          if (delta < -1e-6) {
            // Aplicar movimiento
            const seg = tour.splice(segStart, segLen);
            const insertPos = j < segStart ? j + 1 : j - segLen + 1;
            tour.splice(Math.max(0, Math.min(insertPos, tour.length)), 0, ...seg);
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return tour;
}

// ─── 4. Fusión de grupos de color adyacentes ─────────────────────────────────
// Si dos grupos adyacentes tienen el mismo color pero están separados (ocurre cuando
// un color aparece en múltiples zonas del diseño), intenta unirlos para eliminar
// el corte de hilo que los separa. Solo se fusionan si el salto es < threshold.

function mergeAdjacentColorGroups(sequence, scaleMm, maxJumpMm = 25) {
  if (sequence.length < 2) return sequence;

  const result = [...sequence];
  let i = 0;

  while (i < result.length - 1) {
    const curr = result[i];
    const next = result[i + 1];

    // Si mismo color y salto pequeño: no hay nada que fusionar (ya están juntos)
    // Si distinto color: buscar siguiente ocurrencia del mismo color
    if (curr.color !== next.color) {
      const jumpMm = euclidean(getCentroid(curr), getCentroid(next)) * scaleMm;

      // Buscar la primera región del mismo color que curr más adelante
      let sameColorIdx = -1;
      for (let k = i + 2; k < result.length; k++) {
        if (result[k].color === curr.color) {
          const altJumpMm = euclidean(getCentroid(curr), getCentroid(result[k])) * scaleMm;
          if (altJumpMm < maxJumpMm) { sameColorIdx = k; break; }
        }
      }

      // Si hay una región del mismo color más cercana que la siguiente: moverla
      if (sameColorIdx > i + 1) {
        const sameColorJumpMm = euclidean(getCentroid(curr), getCentroid(result[sameColorIdx])) * scaleMm;
        if (sameColorJumpMm < jumpMm - 2) {
          // Mover la región sameColorIdx al i+1
          const [moved] = result.splice(sameColorIdx, 1);
          result.splice(i + 1, 0, moved);
        }
      }
    }
    i++;
  }

  return result;
}

// ─── 5. Métricas físicas reales ───────────────────────────────────────────────

function computeMetrics(sequence, widthMm, heightMm, speedSpm = 800) {
  if (!sequence || sequence.length === 0) {
    return {
      jumps: 0, jumpDistMm: 0, cuts: 0, colorChanges: 0,
      totalTimeSec: 0, threadMm: 0, totalStitches: 0,
    };
  }

  const scaleMm = getScale(widthMm, heightMm);
  let prevPos = [0, 0];
  let prevColor = null;
  let jumps = 0, jumpDistMm = 0, cuts = 0, colorChanges = 0;

  for (const region of sequence) {
    const c = getCentroid(region);
    const d = euclidean(prevPos, c) * scaleMm;

    if (d > 1.5) {
      jumps++;
      jumpDistMm += d;
      if (d > PHYSICS.threadCutThreshMm) cuts++;
    }

    if (prevColor !== null && region.color !== prevColor) colorChanges++;

    prevPos = c;
    prevColor = region.color;
  }

  const totalStitches = sequence.reduce((s, r) => s + (r.stitch_count || 0), 0);
  const stitchTimeSec = (totalStitches / speedSpm) * 60;
  const jumpTimeSec   = jumpDistMm / PHYSICS.jumpSpeedMmS;
  const colorTimeSec  = colorChanges * PHYSICS.colorChangeSec;
  const totalTimeSec  = stitchTimeSec + jumpTimeSec + colorTimeSec;
  const threadMm      = totalStitches * PHYSICS.stitchLengthMm + jumpDistMm * PHYSICS.jumpThreadWaste;

  return {
    jumps,
    jumpDistMm:    Math.round(jumpDistMm),
    cuts,
    colorChanges,
    stitchTimeSec: Math.round(stitchTimeSec),
    jumpTimeSec:   Math.round(jumpTimeSec),
    colorTimeSec:  Math.round(colorTimeSec),
    totalTimeSec:  Math.round(totalTimeSec),
    threadMm:      Math.round(threadMm),
    totalStitches,
  };
}

function pctSaving(before, after) {
  if (before === 0) return 0;
  return Math.max(0, Math.round(((before - after) / before) * 100));
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Optimiza la secuencia de puntadas para minimizar saltos y tiempo de bordado.
 *
 * @param {Array}  regions   - Regiones enriquecidas con stitch_type, priority, color, centroid
 * @param {Object} config    - { width_mm, height_mm, speed_spm, start_position }
 * @returns {Object} { optimizedSequence, before, after, savings, bandGroups }
 */
export function optimizeStitchSequence(regions, config = {}) {
  const {
    width_mm   = 100,
    height_mm  = 100,
    speed_spm  = 800,
    start_position = [0, 0],
  } = config;

  if (!regions || regions.length === 0) {
    return { optimizedSequence: [], before: null, after: null, savings: null, bandGroups: [] };
  }

  const scaleMm = getScale(width_mm, height_mm);

  // ── Paso 1: Filtrar regiones válidas y separar por banda de prioridad ────────
  const valid = regions.filter(r =>
    r.visible !== false &&
    (r.path_points?.length >= 3 || r.centroid)
  );

  if (valid.length === 0) return { optimizedSequence: [], before: null, after: null, savings: null, bandGroups: [] };

  // Métricas de la secuencia original (antes de cualquier optimización)
  const before = computeMetrics(valid, width_mm, height_mm, speed_spm);

  // ── Paso 2: Agrupar por (banda × color) ──────────────────────────────────────
  const groupMap = new Map();

  for (const r of valid) {
    const band = bandOf(r);
    const key  = `${band}__${r.color || '#000000'}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { band, color: r.color || '#000000', regions: [] });
    }
    groupMap.get(key).regions.push(r);
  }

  // Ordenar grupos: banda ascendente (fill→satin→run), luego área descendente
  const groups = [...groupMap.values()].sort((a, b) => {
    if (a.band !== b.band) return a.band - b.band;
    const aArea = a.regions.reduce((s, r) => s + (r.area_mm2 || 0), 0);
    const bArea = b.regions.reduce((s, r) => s + (r.area_mm2 || 0), 0);
    return bArea - aArea;
  });

  // ── Paso 3: TSP Greedy dentro de cada grupo ────────────────────────────────
  for (const group of groups) {
    group.regions = greedyNN(group.regions, start_position, scaleMm);
  }

  // ── Paso 4: TSP Greedy para ordenar grupos entre sí (dentro de cada banda) ──
  // Solo reordena grupos de la misma banda para no romper el orden fill→satin→run
  const bandIds = [PRIORITY_BAND.fill, PRIORITY_BAND.satin, PRIORITY_BAND.run];
  const reorderedGroups = [];

  for (const bandId of bandIds) {
    const bandGroups = groups.filter(g => g.band === bandId);
    if (bandGroups.length === 0) continue;
    if (bandGroups.length === 1) { reorderedGroups.push(bandGroups[0]); continue; }

    // Calcular centroide de cada grupo
    for (const g of bandGroups) {
      const cs = g.regions.map(getCentroid);
      g._centroid = [
        cs.reduce((s, c) => s + c[0], 0) / cs.length,
        cs.reduce((s, c) => s + c[1], 0) / cs.length,
      ];
    }

    // Greedy nearest-neighbor sobre grupos
    const remaining = [...bandGroups];
    let cursor = start_position;

    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestCost = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        let cost = euclidean(cursor, remaining[i]._centroid) * scaleMm;
        // Bonus si el grupo anterior tiene el mismo color
        const lastGroup = reorderedGroups[reorderedGroups.length - 1];
        if (lastGroup && remaining[i].color === lastGroup.color) cost *= 0.6;
        if (cost < bestCost) { bestCost = cost; bestIdx = i; }
      }

      const next = remaining.splice(bestIdx, 1)[0];
      reorderedGroups.push(next);
      const lastReg = next.regions[next.regions.length - 1];
      cursor = getCentroid(lastReg);
    }
  }

  // ── Paso 5: Aplanar secuencia ──────────────────────────────────────────────
  let sequence = reorderedGroups.flatMap(g => g.regions);

  // ── Paso 6: 2-opt local (no cruza bandas — solo mejora dentro de cada banda)
  // Aplicar por banda para preservar orden fill→satin→run
  const bandedSequence = [];
  for (const bandId of bandIds) {
    const bandRegs = sequence.filter(r => bandOf(r) === bandId);
    if (bandRegs.length === 0) continue;
    const optimized = twoOpt(bandRegs, scaleMm, 150);
    bandedSequence.push(...optimized);
  }
  sequence = bandedSequence;

  // ── Paso 7: Or-opt por banda ───────────────────────────────────────────────
  const orOptSequence = [];
  for (const bandId of bandIds) {
    const bandRegs = sequence.filter(r => bandOf(r) === bandId);
    if (bandRegs.length === 0) continue;
    const optimized = orOpt(bandRegs, scaleMm, 80);
    orOptSequence.push(...optimized);
  }
  sequence = orOptSequence;

  // ── Paso 8: Fusión de colores adyacentes ──────────────────────────────────
  sequence = mergeAdjacentColorGroups(sequence, scaleMm, 20);

  // ── Métricas finales y cálculo de ahorros ─────────────────────────────────
  const after = computeMetrics(sequence, width_mm, height_mm, speed_spm);

  const savings = {
    jumps:        pctSaving(before.jumps,        after.jumps),
    jumpDistMm:   before.jumpDistMm - after.jumpDistMm,
    cuts:         pctSaving(before.cuts,         after.cuts),
    colorChanges: pctSaving(before.colorChanges, after.colorChanges),
    timeSec:      before.totalTimeSec - after.totalTimeSec,
    timePct:      pctSaving(before.totalTimeSec, after.totalTimeSec),
    threadMm:     before.threadMm - after.threadMm,
    threadPct:    pctSaving(before.threadMm,     after.threadMm),
  };

  const overallPct = Math.round(
    savings.timePct    * 0.40 +
    savings.cuts       * 0.25 +
    savings.colorChanges * 0.20 +
    savings.jumps      * 0.15
  );

  // Asignar travelOrder final a cada región
  sequence.forEach((r, i) => { r.travelOrder = i; });

  return {
    optimizedSequence: sequence,
    before,
    after,
    savings,
    overallPct,
    bandGroups: reorderedGroups.map(g => ({
      band:      g.band,
      color:     g.color,
      count:     g.regions.length,
      totalArea: g.regions.reduce((s, r) => s + (r.area_mm2 || 0), 0),
    })),
    algorithm: 'NN-Greedy + 2-opt + Or-opt(1-3) + ColorMerge',
  };
}

// ─── Exportar utilidades para UI ──────────────────────────────────────────────

export function formatTimeSec(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatThreadMm(mm) {
  if (mm < 1000) return `${mm} mm`;
  return `${(mm / 1000).toFixed(1)} m`;
}

export { computeMetrics as computeSequenceMetrics };