/**
 * professionalRuleMiner.js — Reference Learning Engine v2 (FASE 3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mines statistical professional rules from the corpus. Each rule describes a
 * pattern observed across many reference files, with the confidence (fraction
 * of files where it holds), the condition that triggers it, the recommended
 * motor action and the parameter range observed in professionals.
 *
 * Rule shape:
 *   { ruleId, name, category, learnedFromFiles, confidence, condition,
 *     recommendedAction, parameterRange, examples }
 *
 * Categories: layer_order, contour, fill, jumps_trims, colors.
 *
 * Read-only: produces rules, never applies them.
 */

import { summarizeCorpus } from './referenceCorpus';
import { mineDensityAngleCompensationRules } from './densityAngleCompensationMiner';

const MIN_CONFIDENCE = 0.5;

/**
 * @param {Array<object>} corpus — from referenceCorpus.buildReferenceCorpus
 * @returns {Array<object>} mined rules
 */
export function mineProfessionalRules(corpus) {
  if (!corpus || corpus.length < 2) {
    return [{
      ruleId: 'R000_need_corpus',
      name: 'Corpus insuficiente',
      category: 'meta',
      learnedFromFiles: corpus ? corpus.length : 0,
      confidence: 0,
      condition: 'corpus.length >= 2',
      recommendedAction: 'Importa al menos 2 archivos profesionales para iniciar la minería.',
      parameterRange: null,
      examples: [],
    }];
  }

  const rules = [];
  rules.push(mineContourAfterFill(corpus));
  rules.push(mineDetailsAtEnd(corpus));
  rules.push(mineUnderlayBeforeFill(corpus));
  rules.push(mineSatinBorderDensity(corpus));
  rules.push(mineSatinBorderWidth(corpus));
  rules.push(mineContourVsFillRelation(corpus));
  rules.push(mineFillDensityBySize(corpus));
  rules.push(mineFillStitchLength(corpus));
  rules.push(mineAngleVarianceNeighbors(corpus));
  rules.push(mineLongJumpsAreJumpTrim(corpus));
  rules.push(mineTrimTiming(corpus));
  rules.push(mineMaxVisibleStitch(corpus));
  rules.push(mineColorCountByComplexity(corpus));
  rules.push(mineColorGrouping(corpus));
  rules.push(mineColorReduction(corpus));

  // Density / angle / pull-compensation rules (from densityAngleCompensationMiner)
  const dac = mineDensityAngleCompensationRules(corpus);
  for (const r of dac.rules) rules.push(r);

  return rules.filter(r => r.confidence >= MIN_CONFIDENCE || r.ruleId === 'R000_need_corpus');
}

// ─── Layer order ────────────────────────────────────────────────────────────

function mineContourAfterFill(corpus) {
  let matches = 0; const examples = [];
  for (const e of corpus) {
    const roles = e.layerOrderProfile;
    const lastFill = roles.lastIndexOf('fill');
    const firstContour = roles.findIndex(r => r === 'outline_outer' || r === 'outline_inner');
    if (lastFill >= 0 && firstContour >= 0 && firstContour > lastFill) { matches++; examples.push(e.filename); }
  }
  return {
    ruleId: 'L001_contour_after_fill',
    name: 'Contornos exteriores después de rellenos',
    category: 'layer_order',
    learnedFromFiles: corpus.length,
    confidence: matches / corpus.length,
    condition: 'existe bloque fill y el primer bloque de contorno aparece tras el último fill',
    recommendedAction: 'En Professional Mode, coser el contorno exterior tras el relleno de su región.',
    parameterRange: null,
    examples: examples.slice(0, 5),
  };
}

function mineDetailsAtEnd(corpus) {
  let matches = 0; const examples = [];
  for (const e of corpus) {
    const roles = e.layerOrderProfile;
    if (roles.length < 3) continue;
    const tail = roles.slice(Math.floor(roles.length * (2 / 3)));
    const head = roles.slice(0, Math.floor(roles.length / 3));
    if (tail.includes('detail') && !head.includes('detail')) { matches++; examples.push(e.filename); }
  }
  return {
    ruleId: 'L002_details_at_end',
    name: 'Detalles pequeños al final',
    category: 'layer_order',
    learnedFromFiles: corpus.length,
    confidence: matches / corpus.length,
    condition: 'bloques detail aparecen en el último tercio y no en el primero',
    recommendedAction: 'Posponer detalles finos (double-run) al final de la secuencia.',
    parameterRange: null,
    examples: examples.slice(0, 5),
  };
}

function mineUnderlayBeforeFill(corpus) {
  let matches = 0; const examples = [];
  for (const e of corpus) {
    const roles = e.layerOrderProfile;
    const firstFill = roles.indexOf('fill');
    const firstUnderlay = roles.indexOf('underlay');
    if (firstUnderlay >= 0 && firstFill >= 0 && firstUnderlay < firstFill) { matches++; examples.push(e.filename); }
  }
  return {
    ruleId: 'L003_underlay_before_fill',
    name: 'Rellenos grandes usan underlay',
    category: 'layer_order',
    learnedFromFiles: corpus.length,
    confidence: matches / corpus.length,
    condition: 'bloque underlay precede a un bloque fill',
    recommendedAction: 'Generar underlay antes de rellenos grandes (>500mm²).',
    parameterRange: null,
    examples: examples.slice(0, 5),
  };
}

// ─── Contours ───────────────────────────────────────────────────────────────

function mineSatinBorderDensity(corpus) {
  const densities = [];
  const examples = [];
  for (const e of corpus) {
    const satins = e.technicalBlocks.filter(b => b.blockType === 'satin_border');
    for (const s of satins) { densities.push(s.density); examples.push(e.filename); }
  }
  if (!densities.length) return lowConfidence('C001_satin_density', 'Densidad media de satin border');
  const mean = avg(densities);
  return {
    ruleId: 'C001_satin_density',
    name: 'Densidad media de satin border',
    category: 'contour',
    learnedFromFiles: corpus.length,
    confidence: densities.length >= 3 ? 0.8 : 0.55,
    condition: 'bloque satin_border detectado',
    recommendedAction: 'Usar densidad de satin coherente con el corpus profesional.',
    parameterRange: { min: Math.min(...densities).toFixed(3), max: Math.max(...densities).toFixed(3), mean: mean.toFixed(3) },
    examples: examples.slice(0, 5),
  };
}

function mineSatinBorderWidth(corpus) {
  const widths = [];
  const examples = [];
  for (const e of corpus) {
    for (const b of e.technicalBlocks) {
      if (b.blockType === 'satin_border') { widths.push(b.bbox.widthMm); examples.push(e.filename); }
    }
  }
  if (!widths.length) return lowConfidence('C002_satin_width', 'Ancho estimado de satin');
  return {
    ruleId: 'C002_satin_width',
    name: 'Ancho estimado de satin',
    category: 'contour',
    learnedFromFiles: corpus.length,
    confidence: widths.length >= 3 ? 0.75 : 0.5,
    condition: 'bloque satin_border detectado',
    recommendedAction: 'Mantener el ancho de satin dentro del rango profesional.',
    parameterRange: { min: Math.min(...widths).toFixed(2), max: Math.max(...widths).toFixed(2), mean: avg(widths).toFixed(2) },
    examples: examples.slice(0, 5),
  };
}

function mineContourVsFillRelation(corpus) {
  let matches = 0; const examples = [];
  for (const e of corpus) {
    if (e.contourCandidates > 0 && e.fillBlocks > 0) { matches++; examples.push(e.filename); }
  }
  return {
    ruleId: 'C003_contour_with_fill',
    name: 'Contornos acompañan a rellenos',
    category: 'contour',
    learnedFromFiles: corpus.length,
    confidence: matches / corpus.length,
    condition: 'el diseño tiene tanto bloques fill como bloques de contorno',
    recommendedAction: 'Generar contornos para regiones con relleno, no solo relleno aislado.',
    parameterRange: null,
    examples: examples.slice(0, 5),
  };
}

// ─── Fills ──────────────────────────────────────────────────────────────────

function mineFillDensityBySize(corpus) {
  const buckets = { small: [], medium: [], large: [] };
  for (const e of corpus) {
    for (const b of e.technicalBlocks) {
      if (b.blockType !== 'fill_tatami') continue;
      const area = b.bbox.areaMm2;
      const key = area < 500 ? 'small' : area < 3000 ? 'medium' : 'large';
      buckets[key].push({ density: b.density, len: b.averageStitchLength });
    }
  }
  const ranges = {};
  for (const [k, vals] of Object.entries(buckets)) {
    if (!vals.length) continue;
    ranges[k] = {
      density: { mean: avg(vals.map(v => v.density)).toFixed(3) },
      stitchLength: { mean: avg(vals.map(v => v.len)).toFixed(2) },
    };
  }
  return {
    ruleId: 'F001_fill_density_by_size',
    name: 'Densidad de relleno por tamaño de región',
    category: 'fill',
    learnedFromFiles: corpus.length,
    confidence: Object.keys(ranges).length >= 1 ? 0.7 : 0.3,
    condition: 'bloques fill_tatami presentes',
    recommendedAction: 'Ajustar densidad de relleno según el tamaño de la región.',
    parameterRange: ranges,
    examples: corpus.slice(0, 5).map(e => e.filename),
  };
}

function mineFillStitchLength(corpus) {
  const lens = [];
  for (const e of corpus) {
    for (const b of e.technicalBlocks) {
      if (b.blockType === 'fill_tatami') lens.push(b.averageStitchLength);
    }
  }
  if (!lens.length) return lowConfidence('F002_fill_stitch_length', 'Longitud media de puntada en rellenos');
  return {
    ruleId: 'F002_fill_stitch_length',
    name: 'Longitud media de puntada en rellenos',
    category: 'fill',
    learnedFromFiles: corpus.length,
    confidence: 0.7,
    condition: 'bloques fill_tatami presentes',
    recommendedAction: 'Usar longitud de puntada de relleno dentro del rango profesional.',
    parameterRange: { min: Math.min(...lens).toFixed(2), max: Math.max(...lens).toFixed(2), mean: avg(lens).toFixed(2) },
    examples: corpus.slice(0, 5).map(e => e.filename),
  };
}

function mineAngleVarianceNeighbors(corpus) {
  const diffs = [];
  for (const e of corpus) {
    const fills = e.technicalBlocks.filter(b => b.blockType === 'fill_tatami');
    for (let i = 1; i < fills.length; i++) {
      let d = Math.abs(fills[i].averageAngle - fills[i - 1].averageAngle) % 180;
      if (d > 90) d = 180 - d;
      diffs.push(d);
    }
  }
  if (!diffs.length) return lowConfidence('F003_angle_variance', 'Variación de ángulo entre bloques vecinos');
  return {
    ruleId: 'F003_angle_variance_neighbors',
    name: 'Variación de ángulo entre rellenos vecinos',
    category: 'fill',
    learnedFromFiles: corpus.length,
    confidence: 0.6,
    condition: 'al menos dos bloques fill_tatami consecutivos',
    recommendedAction: 'Rotar el ángulo de relleno entre bloques vecinos para evitar costuras paralelas acumuladas.',
    parameterRange: { mean: avg(diffs).toFixed(1) },
    examples: corpus.slice(0, 5).map(e => e.filename),
  };
}

// ─── Jumps / trims ──────────────────────────────────────────────────────────

function mineLongJumpsAreJumpTrim(corpus) {
  let matches = 0; const examples = [];
  for (const e of corpus) {
    if (e.longVisibleStitchRatio <= 0.01 && e.jumpCount > 0) { matches++; examples.push(e.filename); }
  }
  return {
    ruleId: 'J001_long_jumps_not_stitches',
    name: 'Saltos largos como jump/trim, no stitch',
    category: 'jumps_trims',
    learnedFromFiles: corpus.length,
    confidence: matches / corpus.length,
    condition: 'longVisibleStitchRatio <= 0.01 y jumpCount > 0',
    recommendedAction: 'Convertir movimientos >6mm en jump+trim, nunca como stitch visible.',
    parameterRange: null,
    examples: examples.slice(0, 5),
  };
}

function mineTrimTiming(corpus) {
  let matches = 0; const examples = [];
  for (const e of corpus) {
    // professional files trim before long jumps: trimDensity > 0 implies real trims
    if (e.trimDensity > 0) { matches++; examples.push(e.filename); }
  }
  return {
    ruleId: 'J002_trim_before_long_travel',
    name: 'Trim antes de desplazamientos largos',
    category: 'jumps_trims',
    learnedFromFiles: corpus.length,
    confidence: matches / corpus.length,
    condition: 'trimDensity > 0 (al menos un trim inferido por cada 1000 puntadas)',
    recommendedAction: 'Insertar trim antes de saltos largos (>3.5mm) en Professional Mode.',
    parameterRange: { meanTrimDensity: avg(corpus.map(e => e.trimDensity)).toFixed(2) },
    examples: examples.slice(0, 5),
  };
}

function mineMaxVisibleStitch(corpus) {
  // FASE 1 — limpia outliers: usa SOLO stitches visibles reales (excluye jumps,
  // trims, movimientos entre bloques y outliers > 12mm que son travel encubierto).
  // Para cada archivo calcula el percentil 95 de sus longitudes de stitch real,
  // luego toma la mediana de esos P95 y la clampea a [2.5, 6.0]. Fallback 3.5mm.
  const perFileP95 = [];
  for (const e of corpus) {
    const cmds = e.commandSequence || [];
    if (!cmds.length) continue;
    const lens = [];
    let prev = null;
    for (const c of cmds) {
      if (c.type !== 'stitch') { if (c.type === 'jump') prev = { x: c.x, y: c.y }; continue; }
      if (!prev) { prev = { x: c.x, y: c.y }; continue; }
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      // excluir outliers: 0 (duplicado puro) y > 12mm (travel encubierto / jump mal codificado)
      if (d > 0.1 && d <= 12) lens.push(d);
      prev = { x: c.x, y: c.y };
    }
    if (lens.length >= 5) perFileP95.push(percentile(lens, 0.95));
  }
  let ceiling;
  if (perFileP95.length >= 2) {
    ceiling = median(perFileP95);
  } else {
    ceiling = 3.5; // fallback profesional
  }
  // clamp al rango profesional válido
  ceiling = Math.max(2.5, Math.min(6.0, ceiling));
  return {
    ruleId: 'J003_max_visible_stitch',
    name: 'Longitud máxima aceptable de stitch visible',
    category: 'jumps_trims',
    learnedFromFiles: corpus.length,
    confidence: 0.85,
    condition: 'mediana del P95 por archivo de stitches reales (excluye jumps/trims/outliers>12mm), clamp [2.5,6.0]',
    recommendedAction: 'No permitir stitch visible > techo profesional salvo relleno tatami soportado dentro de región; travel largo debe ser jump/trim.',
    parameterRange: { ceiling: ceiling.toFixed(2), method: 'p95_visible_real_median', clamp: '2.5-6.0' },
    examples: corpus.slice(0, 5).map(e => e.filename),
  };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Colors ─────────────────────────────────────────────────────────────────

function mineColorCountByComplexity(corpus) {
  const byComplexity = { simple: [], medium: [], complex: [] };
  for (const e of corpus) {
    const blocks = e.technicalBlocks.length;
    const key = blocks < 5 ? 'simple' : blocks < 15 ? 'medium' : 'complex';
    byComplexity[key].push(e.colorCount);
  }
  const ranges = {};
  for (const [k, vals] of Object.entries(byComplexity)) {
    if (vals.length) ranges[k] = { min: Math.min(...vals), max: Math.max(...vals), mean: avg(vals).toFixed(1) };
  }
  return {
    ruleId: 'CO001_color_count_by_complexity',
    name: 'Número típico de colores por complejidad',
    category: 'colors',
    learnedFromFiles: corpus.length,
    confidence: 0.7,
    condition: 'complejidad estimada por número de bloques técnicos',
    recommendedAction: 'Limitar el número de colores según la complejidad del diseño.',
    parameterRange: ranges,
    examples: corpus.slice(0, 5).map(e => e.filename),
  };
}

function mineColorGrouping(corpus) {
  let matches = 0; const examples = [];
  for (const e of corpus) {
    const blocks = e.technicalBlocks;
    if (blocks.length < 4) continue;
    let alternations = 0;
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].colorIndex !== blocks[i - 1].colorIndex) alternations++;
    }
    if (alternations <= blocks.length * 0.25) { matches++; examples.push(e.filename); }
  }
  return {
    ruleId: 'CO002_color_grouping',
    name: 'Colores agrupados por bloques',
    category: 'colors',
    learnedFromFiles: corpus.length,
    confidence: matches / corpus.length,
    condition: 'pocas alternancias de color relativas al total de bloques',
    recommendedAction: 'Reordenar bloques para minimizar cambios de color.',
    parameterRange: null,
    examples: examples.slice(0, 5),
  };
}

function mineColorReduction(corpus) {
  // Detect if files with many color blocks still keep colorCount low (reduction)
  let matches = 0; const examples = [];
  for (const e of corpus) {
    if (e.colorBlocks.length > 6 && e.colorCount <= 6) { matches++; examples.push(e.filename); }
  }
  return {
    ruleId: 'CO003_color_reduction',
    name: 'Reducción de colores similares',
    category: 'colors',
    learnedFromFiles: corpus.length,
    confidence: matches / Math.max(1, corpus.filter(e => e.colorBlocks.length > 6).length),
    condition: 'diseño con muchos bloques pero pocos colores finales',
    recommendedAction: 'Fusionar colores visualmente similares para reducir paradas de color.',
    parameterRange: null,
    examples: examples.slice(0, 5),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

function lowConfidence(ruleId, name) {
  return { ruleId, name, category: 'contour', learnedFromFiles: 0, confidence: 0,
    condition: 'no hay bloques suficientes', recommendedAction: '—', parameterRange: null, examples: [] };
}

export function rulesByCategory(rules) {
  const map = {};
  for (const r of rules) (map[r.category] ||= []).push(r);
  return map;
}