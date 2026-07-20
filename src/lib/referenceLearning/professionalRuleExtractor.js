/**
 * professionalRuleExtractor.js — Reference Embroidery Learning System
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts learned professional rules from a set of analyzed reference files.
 *
 * Each rule is a JSON object:
 *   {
 *     ruleId, name, pattern, confidence (0-1),
 *     examples (file names that exhibit the rule),
 *     recommendedAction (what the motor should do)
 *   }
 *
 * Rules are derived from AGGREGATE patterns across many good files — never
 * from a single file, so confidence reflects how consistently the pattern
 * appears across the reference set.
 *
 * Read-only diagnostic: rules are NOT applied to the motor automatically.
 */

import { aggregateBatchMetrics } from './referenceMetricsAnalyzer';

const MIN_FILES_FOR_RULE = 2;
const MIN_CONFIDENCE = 0.5;

/**
 * @param {Array<object>} analyzedFiles — each { filename, metrics, classifiedBlocks }
 * @returns {Array<object>} extracted rules
 */
export function extractProfessionalRules(analyzedFiles) {
  if (!analyzedFiles || analyzedFiles.length < MIN_FILES_FOR_RULE) {
    return [{
      ruleId: 'R001_need_more_references',
      name: 'Insufficient references',
      pattern: 'fewer than 2 reference files',
      confidence: 0,
      examples: [],
      recommendedAction: 'Import at least 2 professional DST/DSB files to begin rule extraction.',
    }];
  }

  const rules = [];
  const agg = aggregateBatchMetrics(analyzedFiles);
  const fileNames = analyzedFiles.map(f => f.filename);

  // R001: Contours after fills
  rules.push(checkContourAfterFill(analyzedFiles, fileNames));

  // R002: Small details at the end
  rules.push(checkDetailsAtEnd(analyzedFiles, fileNames));

  // R003: Large fills use underlay
  rules.push(checkUnderlayBeforeFills(analyzedFiles, fileNames));

  // R004: Similar colors grouped
  rules.push(checkColorGrouping(analyzedFiles, fileNames));

  // R005: Long jumps are jump/trim, not stitches
  rules.push(checkLongJumpsAreNotStitches(analyzedFiles, fileNames, agg));

  // R006: Satin borders have constant width/density
  rules.push(checkSatinConsistency(analyzedFiles, fileNames));

  // R007: Cartoon designs use reinforced final outline
  rules.push(checkReinforcedFinalOutline(analyzedFiles, fileNames));

  // R008: Visible travel is minimal
  rules.push(checkLowVisibleTravel(analyzedFiles, fileNames, agg));

  // R009: Low duplicate stitch count
  rules.push(checkLowDuplicates(analyzedFiles, fileNames, agg));

  // R010: Long visible stitches are split
  rules.push(checkLongStitchesSplit(analyzedFiles, fileNames, agg));

  return rules.filter(r => r.confidence >= MIN_CONFIDENCE || r.ruleId.includes('need_more'));
}

// ─── Individual rule checks ─────────────────────────────────────────────────────

function checkContourAfterFill(files, names) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    const blocks = f.classifiedBlocks || [];
    if (blocks.length < 2) continue;
    let lastFillIdx = -1, firstContourIdx = Infinity;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].blockType === 'fill_tatami') lastFillIdx = i;
      if (blocks[i].blockType === 'running_outline' || blocks[i].blockType === 'satin_border') {
        if (firstContourIdx === Infinity) firstContourIdx = i;
      }
    }
    if (lastFillIdx >= 0 && firstContourIdx > lastFillIdx) {
      matches++; examples.push(f.filename);
    }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R001_contour_after_fill',
    name: 'Contornos exteriores después de rellenos',
    pattern: 'los bloques de contorno (running/satin) aparecen después de los rellenos',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'En Professional Mode, asegurar que el contorno exterior se cosa tras el relleno de su región.',
  };
}

function checkDetailsAtEnd(files, names) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    const blocks = f.classifiedBlocks || [];
    if (blocks.length < 3) continue;
    const lastThird = blocks.slice(Math.floor(blocks.length * 2 / 3));
    const hasDetail = lastThird.some(b => b.blockType === 'double_run_detail' || b.blockType === 'running_outline');
    const early = blocks.slice(0, Math.floor(blocks.length / 3));
    const earlyHasDetail = early.some(b => b.blockType === 'double_run_detail');
    if (hasDetail && !earlyHasDetail) { matches++; examples.push(f.filename); }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R002_details_at_end',
    name: 'Detalles pequeños al final',
    pattern: 'los bloques double_run_detail aparecen en el último tercio del archivo',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Posponer los detalles finos (double-run) al final de la secuencia de costura.',
  };
}

function checkUnderlayBeforeFills(files, names) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    const blocks = f.classifiedBlocks || [];
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].blockType === 'fill_tatami' && blocks[i - 1].blockType === 'underlay') {
        // check same approximate area
        const u = blocks[i - 1].features;
        const fill = blocks[i].features;
        if (u.areaMm2 > 0 && fill.areaMm2 > 0 && Math.abs(u.areaMm2 - fill.areaMm2) / Math.max(u.areaMm2, fill.areaMm2) < 0.5) {
          matches++; examples.push(f.filename); break;
        }
      }
    }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R003_underlay_before_fills',
    name: 'Rellenos grandes usan underlay',
    pattern: 'un bloque underlay precede inmediatamente a un fill_tatami de área similar',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Generar underlay (sparse parallel rows) antes de rellenos grandes (>500mm²).',
  };
}

function checkColorGrouping(files, names) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    const blocks = f.classifiedBlocks || [];
    if (blocks.length < 4) continue;
    // count color alternations
    let alternations = 0;
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].color !== blocks[i - 1].color) alternations++;
    }
    if (alternations <= blocks.length * 0.25) { matches++; examples.push(f.filename); }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R004_color_grouping',
    name: 'Colores similares agrupados',
    pattern: 'pocos cambios de color relativos al número de bloques',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Reordenar bloques para minimizar cambios de color (agrupar bloques del mismo color).',
  };
}

function checkLongJumpsAreNotStitches(files, names, agg) {
  // Professional files use jump+trim for long moves; stitch lengths stay short.
  let matches = 0;
  const examples = [];
  for (const f of files) {
    if (f.metrics.longVisibleStitchCount <= 2 && f.metrics.jumpCount > 0) {
      matches++; examples.push(f.filename);
    }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R005_long_jumps_not_stitches',
    name: 'Saltos largos como jump/trim, no stitch',
    pattern: 'longVisibleStitchCount bajo y jumpCount > 0',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Split o convertir movimientos >7mm en jump+trim; nunca como stitch largo visible.',
  };
}

function checkSatinConsistency(files, names) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    const blocks = f.classifiedBlocks || [];
    const satins = blocks.filter(b => b.blockType === 'satin_border');
    if (satins.length === 0) continue;
    const widths = satins.map(s => s.features.widthMm).filter(w => w > 0);
    if (widths.length < 2) continue;
    const mean = widths.reduce((s, w) => s + w, 0) / widths.length;
    const cv = Math.sqrt(widths.reduce((s, w) => s + (w - mean) ** 2, 0) / widths.length) / mean;
    if (cv < 0.3) { matches++; examples.push(f.filename); }
  }
  const confidence = files.filter(f => (f.classifiedBlocks || []).some(b => b.blockType === 'satin_border')).length > 0
    ? matches / files.filter(f => (f.classifiedBlocks || []).some(b => b.blockType === 'satin_border')).length
    : 0;
  return {
    ruleId: 'R006_satin_consistent_width',
    name: 'Satin borders con ancho/densidad constantes',
    pattern: 'coefficient of variation del ancho de satin borders < 0.3',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Mantener ancho y densidad constante dentro de cada satin_border; evitar variaciones > 30%.',
  };
}

function checkReinforcedFinalOutline(files, names) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    const blocks = f.classifiedBlocks || [];
    if (blocks.length < 3) continue;
    const last = blocks[blocks.length - 1];
    if (last.blockType === 'running_outline' || last.blockType === 'satin_border') {
      matches++; examples.push(f.filename);
    }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R007_reinforced_final_outline',
    name: 'Contorno final reforzado',
    pattern: 'el último bloque del archivo es un contorno (running/satin)',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Para diseños tipo cartoon, añadir un contorno final reforzado al final de la secuencia.',
  };
}

function checkLowVisibleTravel(files, names, agg) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    if (f.metrics.visibleTravelScore < 0.05) { matches++; examples.push(f.filename); }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R008_low_visible_travel',
    name: 'Travel visible mínimo',
    pattern: 'visibleTravelScore < 0.05',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Minimizar saltos visibles; usar jump+trim o enmascarar travel con rellenos.',
  };
}

function checkLowDuplicates(files, names, agg) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    if (f.metrics.duplicateStitchCount <= 5) { matches++; examples.push(f.filename); }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R009_low_duplicates',
    name: 'Pocas puntadas duplicadas',
    pattern: 'duplicateStitchCount <= 5',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Eliminar puntadas duplicadas consecutivas (<0.05mm) en la sanitización final.',
  };
}

function checkLongStitchesSplit(files, names, agg) {
  let matches = 0;
  const examples = [];
  for (const f of files) {
    if (f.metrics.longVisibleStitchCount === 0 && f.metrics.stitchCount > 20) {
      matches++; examples.push(f.filename);
    }
  }
  const confidence = matches / files.length;
  return {
    ruleId: 'R010_long_stitches_split',
    name: 'Puntadas largas visibles divididas',
    pattern: 'longVisibleStitchCount = 0 en archivos con >20 puntadas',
    confidence,
    examples: examples.slice(0, 5),
    recommendedAction: 'Dividir cualquier stitch > 7mm en sub-puntadas de ≤ 7mm en el export.',
  };
}