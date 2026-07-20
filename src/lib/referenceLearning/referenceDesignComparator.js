/**
 * referenceDesignComparator.js — Reference Learning Engine v2 (FASE 3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Compara el diseño actual contra el corpus aprendido y las reglas minadas.
 * Genera: professionalGapScore, violatedRules (con evidencia del corpus,
 * valor actual y acción concreta), missingFeatures, overusedFeatures,
 * recommendedFixes.
 *
 * Read-only: solo diagnostica, no aplica nada.
 */

import { computeCurrentDesignProfile } from './referenceDesignMetrics';

/**
 * @param {Array} currentCommands
 * @param {Array} currentRegions
 * @param {object} selectedProfile — from selectBestLearnedProfileForCurrentDesign
 * @param {Array<object>} learnedRules — from mineProfessionalRules
 * @param {object} corpusSummary — from summarizeCorpus (avg stats)
 * @returns {object} comparison
 */
export function compareCurrentDesignToLearnedCorpus(currentCommands, currentRegions, selectedProfile, learnedRules, corpusSummary) {
  const dp = computeCurrentDesignProfile(currentRegions, currentRegions);
  const rules = Array.isArray(learnedRules) ? learnedRules : [];
  const ruleMap = Object.fromEntries(rules.map(r => [r.ruleId, r]));
  const corpusAvg = corpusSummary?.avg || {};

  const violated = [];
  const missing = [];
  const overused = [];
  const fixes = [];

  // ── J003 — max visible stitch ──────────────────────────────────────────
  const j003 = ruleMap['J003_max_visible_stitch'];
  const corpusCeiling = j003?.parameterRange?.ceiling ? parseFloat(j003.parameterRange.ceiling) : 3.5;
  const currentMaxVisible = maxVisibleStitchMm(currentCommands);
  if (currentMaxVisible > corpusCeiling + 0.5) {
    violated.push({
      ruleId: 'J003_max_visible_stitch',
      confidence: j003?.confidence ?? 0.85,
      corpusValue: `${corpusCeiling.toFixed(2)}mm`,
      currentValue: `${currentMaxVisible.toFixed(2)}mm`,
      action: `Convertir stitches visibles >${corpusCeiling.toFixed(1)}mm (no soportados en región) en jump/trim.`,
      severity: 'high',
    });
    fixes.push(`Reducir stitch visible máximo de ${currentMaxVisible.toFixed(1)}mm a ${corpusCeiling.toFixed(1)}mm`);
  }

  // ── J001 — long jumps as jump/trim ─────────────────────────────────────
  const j001 = ruleMap['J001_long_jumps_not_stitches'];
  if (dp.longVisibleRatio > 0.01 && j001) {
    violated.push({
      ruleId: 'J001_long_jumps_not_stitches',
      confidence: j001.confidence,
      corpusValue: `longVisibleRatio ≤ 0.01`,
      currentValue: `longVisibleRatio ${dp.longVisibleRatio.toFixed(3)}`,
      action: 'Convertir movimientos >6mm en jump+trim, nunca como stitch visible.',
      severity: 'high',
    });
    fixes.push(`Eliminar ${dp.longVisibleRatio > 0.05 ? 'puntadas largas visibles' : 'puntadas largas residuales'} (ratio ${dp.longVisibleRatio.toFixed(3)})`);
  }

  // ── J002 — trim before long travel ─────────────────────────────────────
  const j002 = ruleMap['J002_trim_before_long_travel'];
  if (dp.jumpCount > 0 && dp.trimCount === 0 && j002) {
    violated.push({
      ruleId: 'J002_trim_before_long_travel',
      confidence: j002.confidence,
      corpusValue: 'trimDensity > 0',
      currentValue: `0 trims / ${dp.jumpCount} jumps`,
      action: 'Insertar trim antes de saltos largos (>3.5mm).',
      severity: 'medium',
    });
    fixes.push('Añadir trims antes de saltos largos');
  }

  // ── Visible diagonals ──────────────────────────────────────────────────
  if (dp.visibleDiagonals > 0) {
    violated.push({
      ruleId: 'VISIBLE_DIAGONALS',
      confidence: 1,
      corpusValue: '0 diagonales visibles',
      currentValue: `${dp.visibleDiagonals} diagonales`,
      action: 'Convertir diagonales visibles en jump/trim (travel oculto).',
      severity: 'high',
    });
    fixes.push(`Eliminar ${dp.visibleDiagonals} diagonales visibles (convertir a jump/trim)`);
  }

  // ── D001 — fill row spacing (density) ──────────────────────────────────
  const d001 = ruleMap['D001_fill_row_spacing'];
  if (d001?.parameterRange?.median) {
    const corpusDensity = parseFloat(d001.parameterRange.median);
    const currentDensity = currentRegions.length
      ? currentRegions.reduce((s, r) => s + (r.density ?? 0.4), 0) / currentRegions.length
      : 0;
    if (Math.abs(currentDensity - corpusDensity) > 0.15) {
      violated.push({
        ruleId: 'D001_fill_row_spacing',
        confidence: d001.confidence,
        corpusValue: `${corpusDensity.toFixed(3)}mm`,
        currentValue: `${currentDensity.toFixed(3)}mm`,
        action: `Ajustar fill row spacing a ${corpusDensity.toFixed(2)}mm (mediana del corpus).`,
        severity: 'medium',
      });
      fixes.push(`Ajustar densidad de relleno a ${corpusDensity.toFixed(2)}mm`);
    }
  }

  // ── D003 — satin column spacing ─────────────────────────────────────────
  const d003 = ruleMap['D003_satin_column_spacing'];
  if (d003?.parameterRange?.median && dp.satinCount > 0) {
    const corpusSatin = parseFloat(d003.parameterRange.median);
    violated.push({
      ruleId: 'D003_satin_column_spacing',
      confidence: d003.confidence,
      corpusValue: `${corpusSatin.toFixed(3)}mm`,
      currentValue: 'valor por defecto del motor',
      action: `Usar satin column spacing de ${corpusSatin.toFixed(2)}mm.`,
      severity: 'medium',
    });
    fixes.push(`Ajustar espaciado de satin a ${corpusSatin.toFixed(2)}mm`);
  }

  // ── D004 — pull compensation ───────────────────────────────────────────
  const d004 = ruleMap['D004_pull_compensation'];
  if (d004?.parameterRange?.mean) {
    const corpusPull = parseFloat(d004.parameterRange.mean);
    violated.push({
      ruleId: 'D004_pull_compensation',
      confidence: d004.confidence,
      corpusValue: `${corpusPull.toFixed(3)}mm`,
      currentValue: 'sin compensación aplicada',
      action: `Aplicar pull compensation de ${corpusPull.toFixed(2)}mm.`,
      severity: 'low',
    });
    fixes.push(`Aplicar pull compensation ${corpusPull.toFixed(2)}mm`);
  }

  // ── D002 — fill angle ──────────────────────────────────────────────────
  const d002 = ruleMap['D002_fill_angle'];
  if (d002?.parameterRange?.median) {
    const corpusAngle = parseFloat(d002.parameterRange.median);
    fixes.push(`Usar ángulo de relleno ${corpusAngle.toFixed(0)}° (mediana del corpus)`);
  }

  // ── Layer order checks ─────────────────────────────────────────────────
  if (selectedProfile?.contourAfterFill) {
    const hasContourAfterFill = checkContourAfterFill(currentCommands);
    if (!hasContourAfterFill) {
      missing.push({
        feature: 'Contorno tras relleno',
        recommendation: `El perfil "${selectedProfile.label}" exige coser el contorno exterior después del relleno.`,
      });
      fixes.push('Reordenar capas: contorno exterior después del relleno');
    }
  }
  if (selectedProfile?.useUnderlayRules?.largeFills && dp.underlayBlocks === 0) {
    missing.push({
      feature: 'Underlay en rellenos grandes',
      recommendation: 'Generar underlay antes de rellenos grandes (>500mm²).',
    });
    fixes.push('Añadir underlay antes de rellenos grandes');
  }

  // ── Color count ────────────────────────────────────────────────────────
  if (selectedProfile?.maxColorCount && dp.colorCount > selectedProfile.maxColorCount) {
    overused.push({
      feature: 'Colores',
      recommendation: `El diseño usa ${dp.colorCount} colores; el perfil recomienda ≤${selectedProfile.maxColorCount}. Fusionar colores similares.`,
    });
    violated.push({
      ruleId: 'CO001_color_count_by_complexity',
      confidence: 0.7,
      corpusValue: `≤${selectedProfile.maxColorCount}`,
      currentValue: `${dp.colorCount}`,
      action: `Reducir colores a ≤${selectedProfile.maxColorCount} fusionando similares.`,
      severity: 'medium',
    });
    fixes.push(`Reducir colores de ${dp.colorCount} a ≤${selectedProfile.maxColorCount}`);
  }

  // ── Short / duplicate stitch ratios vs corpus ─────────────────────────
  if (corpusAvg.shortStitchRatio != null && dp.shortRatio > corpusAvg.shortStitchRatio * 2) {
    overused.push({
      feature: 'Puntadas cortas',
      recommendation: `shortRatio ${dp.shortRatio.toFixed(3)} es el doble del corpus (${corpusAvg.shortStitchRatio.toFixed(3)}). Simplificar geometría.`,
    });
  }
  if (corpusAvg.duplicateRatio != null && dp.dupRatio > corpusAvg.duplicateRatio * 2) {
    overused.push({
      feature: 'Puntadas duplicadas',
      recommendation: `dupRatio ${dp.dupRatio.toFixed(3)} es el doble del corpus (${corpusAvg.duplicateRatio.toFixed(3)}). Eliminar duplicados.`,
    });
  }

  // ── Professional gap score (0-100, lower = better) ──────────────────────
  let gap = 0;
  for (const v of violated) gap += v.severity === 'high' ? 25 : v.severity === 'medium' ? 12 : 5;
  for (const m of missing) gap += 8;
  for (const o of overused) gap += 5;
  const professionalGapScore = Math.min(100, gap);
  const similarityScore = Math.max(0, 100 - professionalGapScore);

  return {
    designProfile: dp,
    selectedProfile,
    similarityScore,
    professionalGapScore,
    violatedRules: violated,
    missingFeatures: missing,
    overusedFeatures: overused,
    recommendedFixes: fixes,
    differences: buildDifferences(dp, corpusAvg, selectedProfile),
    problems: violated.map(v => ({ message: `${v.ruleId}: ${v.action}`, justifyingRule: v.ruleId })),
  };
}

function maxVisibleStitchMm(commands) {
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

function checkContourAfterFill(commands) {
  let lastFill = -1, firstContour = -1;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') continue;
    const lt = (c.layerType || '').toLowerCase();
    const st = (c.stitchType || '').toLowerCase();
    if (st === 'fill') lastFill = i;
    if (lt.includes('outline') || lt.includes('contour')) { if (firstContour < 0) firstContour = i; }
  }
  return lastFill >= 0 && firstContour >= 0 && firstContour > lastFill;
}

function buildDifferences(dp, corpusAvg, profile) {
  const diffs = [];
  const push = (metric, reference, ours) => {
    const delta = (typeof ours === 'number' && typeof reference === 'number') ? ours - reference : 0;
    diffs.push({ metric, reference, ours, delta, severity: Math.abs(delta) > 50 ? 'high' : Math.abs(delta) > 20 ? 'medium' : 'low' });
  };
  if (corpusAvg.stitchCount) push('stitchCount', corpusAvg.stitchCount, dp.stitchCount);
  if (corpusAvg.jumpCount) push('jumpCount', corpusAvg.jumpCount, dp.jumpCount);
  if (corpusAvg.trimCount) push('trimCount', corpusAvg.trimCount, dp.trimCount);
  if (corpusAvg.shortStitchRatio != null) push('shortStitchRatio', corpusAvg.shortStitchRatio, dp.shortRatio);
  if (corpusAvg.duplicateRatio != null) push('duplicateRatio', corpusAvg.duplicateRatio, dp.dupRatio);
  if (corpusAvg.longVisibleStitchRatio != null) push('longVisibleStitchRatio', corpusAvg.longVisibleStitchRatio, dp.longVisibleRatio);
  if (profile?.maxColorCount) push('colorCount', profile.maxColorCount, dp.colorCount);
  return diffs;
}