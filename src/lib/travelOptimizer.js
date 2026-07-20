/**
 * travelOptimizer.js
 *
 * Motor exclusivo de optimización de recorrido de bordado.
 * Reduce: saltos, cortes, cambios de hilo y tiempo de máquina.
 *
 * Pipeline:
 *  1. Agrupar regiones por color
 *  2. TSP greedy nearest-neighbor dentro de cada grupo de color
 *  3. Ordenar grupos por cercanía del punto de salida
 *  4. Calcular métricas de ahorro vs. secuencia original
 */

// ─── Helpers geométricos ──────────────────────────────────────────────────────

function centroid(region) {
  if (region.centroid) return region.centroid;
  const pts = region.path_points;
  if (!pts || pts.length === 0) return [0.5, 0.5];
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [cx, cy];
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// ─── TSP Nearest-Neighbor greedy ─────────────────────────────────────────────

function greedyTSP(regions, startPos = [0, 0]) {
  if (regions.length === 0) return [];
  const remaining = [...regions];
  const ordered = [];
  let cursor = startPos;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = centroid(remaining[i]);
      const d = dist(cursor, c);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cursor = centroid(next);
  }

  return ordered;
}

// ─── Métricas de una secuencia ────────────────────────────────────────────────

function computeMetrics(sequence, speedSpm = 800, jumpSpeedMmS = 300, designWidthMm = 100, designHeightMm = 100) {
  let totalJumps = 0;
  let totalJumpDistanceMm = 0;
  let colorChanges = 0;
  let threadCutsMm = 0;
  let prevColor = null;
  let prevPos = [0, 0];

  // Scale: normalized [0,1] coords → mm using actual design diagonal
  const SCALE = Math.sqrt(designWidthMm ** 2 + designHeightMm ** 2) / Math.SQRT2;

  for (const region of sequence) {
    const c = centroid(region);
    const jumpMm = dist(prevPos, c) * SCALE;

    if (jumpMm > 1.5) {        // saltos > 1.5mm cuentan
      totalJumps++;
      totalJumpDistanceMm += jumpMm;
      if (jumpMm > 10) threadCutsMm++;  // cortes para saltos > 10mm
    }

    if (prevColor && region.color !== prevColor) colorChanges++;
    prevColor = region.color;
    prevPos = c;
  }

  const totalStitches = sequence.reduce((s, r) => s + (r.stitch_count || r.estimatedStitches || 0), 0);
  const stitchTimeSec = (totalStitches / speedSpm) * 60;
  const jumpTimeSec   = totalJumpDistanceMm / jumpSpeedMmS;
  const colorTimeSec  = colorChanges * 30;
  const totalTimeSec  = stitchTimeSec + jumpTimeSec + colorTimeSec;

  // Thread usage: stitches × avg stitch length (2.5mm) + jump thread waste
  const threadMm = totalStitches * 2.5 + totalJumpDistanceMm * 0.6;

  return {
    jumps: totalJumps,
    jumpDistanceMm: Math.round(totalJumpDistanceMm),
    cuts: Math.round(threadCutsMm),
    colorChanges,
    totalTimeSec: Math.round(totalTimeSec),
    threadMm: Math.round(threadMm),
    totalStitches,
  };
}

// ─── Optimizador principal ────────────────────────────────────────────────────

export function optimizeTravelPath(regions, config = {}) {
  const { speedSpm = 800, width_mm = 100, height_mm = 100 } = config;

  // Layer-priority guard: travelOptimizer must not reorder fills below satins.
  // Sort by priority ascending (fills=1-3, satins=5-6, runs=8-10) before proximity
  // optimization so that the TSP only reorders within priority-cohesive groups.
  const prioritySorted = [...regions]
    .filter(r => r.path_points?.length >= 3 && r.visible !== false)
    .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));

  const valid = prioritySorted;
  if (valid.length === 0) return null;

  // ── Métricas ANTES ─────────────────────────────────────────────────────────
  const metricsBefore = computeMetrics(valid, speedSpm, 300, width_mm, height_mm);

  // ── Paso 1: Agrupar por (priority_band × color) ───────────────────────────
  // Priority bands: fill=0 (p≤4), satin=1 (p5-7), run=2 (p≥8).
  // Grouping by band+color ensures color proximity optimization never swaps
  // a fill region after a satin (which would cause thread coverage errors).
  const bandOf = (r) => {
    const p = r.priority ?? 5;
    if (p <= 4) return 0;
    if (p <= 7) return 1;
    return 2;
  };

  const colorMap = {};
  for (const r of valid) {
    const key = `${bandOf(r)}__${r.color || '#000000'}`;
    if (!colorMap[key]) colorMap[key] = { color: r.color || '#000000', band: bandOf(r), regs: [] };
    colorMap[key].regs.push(r);
  }

  // ── Paso 2: TSP dentro de cada grupo, ordenar grupos por band↑ luego área↓ ──
  const colorGroups = Object.values(colorMap)
    .sort((a, b) => a.band - b.band || b.regs.reduce((s, r) => s + (r.area_mm2 || 0), 0) - a.regs.reduce((s, r) => s + (r.area_mm2 || 0), 0))
    .map(({ color, regs }) => {
      const totalArea = regs.reduce((s, r) => s + (r.area_mm2 || 0), 0);
      const optimizedRegs = greedyTSP(regs);
      return { color, regs: optimizedRegs, totalArea };
    });

  // ── Paso 3: Ordenar grupos por cercanía (TSP de grupos) ───────────────────
  // Attach pre-computed centroid to each group so greedyTSP can use it directly
  // (group objects have no path_points, so centroid() would return [0.5, 0.5]).
  const groupsWithCentroid = colorGroups.map(g => {
    const cs = g.regs.map(r => centroid(r));
    const gc = [
      cs.reduce((s, c) => s + c[0], 0) / cs.length,
      cs.reduce((s, c) => s + c[1], 0) / cs.length,
    ];
    return { ...g, centroid: gc };
  });

  const groupOrder = greedyTSP(groupsWithCentroid);

  const optimizedSequence = groupOrder.flatMap(g => g.regs);

  // ── Métricas DESPUÉS ───────────────────────────────────────────────────────
  const metricsAfter = computeMetrics(optimizedSequence, speedSpm, 300, width_mm, height_mm);

  // ── Cálculo de ahorro ──────────────────────────────────────────────────────
  const savings = {
    jumps:       pct(metricsBefore.jumps,       metricsAfter.jumps),
    cuts:        pct(metricsBefore.cuts,        metricsAfter.cuts),
    colorChanges:pct(metricsBefore.colorChanges,metricsAfter.colorChanges),
    time:        pct(metricsBefore.totalTimeSec, metricsAfter.totalTimeSec),
    thread:      pct(metricsBefore.threadMm,    metricsAfter.threadMm),
    jumpDistMm:  metricsBefore.jumpDistanceMm - metricsAfter.jumpDistanceMm,
  };

  // Ahorro global: promedio ponderado
  const overallSaving = Math.round(
    savings.time * 0.35 +
    savings.cuts * 0.30 +
    savings.colorChanges * 0.20 +
    savings.jumps * 0.15
  );

  return {
    optimizedSequence,   // regions in optimized order (fills → satins → runs, then proximity)
    before: metricsBefore,
    after:  metricsAfter,
    savings,
    overallSaving,       // % de ahorro global
    colorGroups: groupOrder.map(g => ({
      color: g.color,
      count: g.regs.length,
      totalArea: g.totalArea,
    })),
  };
}

function pct(before, after) {
  if (before === 0) return 0;
  return Math.max(0, Math.round(((before - after) / before) * 100));
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatThread(mm) {
  if (mm < 1000) return `${mm} mm`;
  return `${(mm / 1000).toFixed(1)} m`;
}