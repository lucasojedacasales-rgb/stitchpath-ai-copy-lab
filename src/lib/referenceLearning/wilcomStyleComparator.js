/**
 * wilcomStyleComparator.js — Reference Embroidery Learning System
 * ─────────────────────────────────────────────────────────────────────────────
 * Compares a StitchPath AI-generated design (its final commands + metrics)
 * against the aggregate of professional reference files.
 *
 * Returns:
 *   - differences            : per-metric deltas
 *   - missingProfessionalFeatures : features present in references, absent in ours
 *   - overusedFeatures        : features we over-use vs references
 *   - recommendations         : plain-language actions to close the gap
 *   - similarityScore         : 0-100, how close we are to the reference profile
 *   - professionalGapScore    : 0-100, how much professional polish we lack
 *
 * Read-only diagnostic. Never modifies the motor or the design.
 */

import { aggregateBatchMetrics } from './referenceMetricsAnalyzer';
import { classifyStitchBlocks } from './stitchPatternClassifier';
import { classifyTechnicalBlocks } from './blockClassifier';
import { summarizeCorpus } from './referenceCorpus';

/**
 * @param {Array} ourCommands — StitchPath AI final commands
 * @param {object} ourMetrics — from calculateUnifiedCommandMetrics or analyzeReferenceMetrics
 * @param {Array<object>} references — from referenceLibrary.listReferences()
 * @returns {object} comparison report
 */
export function compareAgainstReferences(ourCommands, ourMetrics, references) {
  if (!references || references.length === 0) {
    return {
      differences: [],
      missingProfessionalFeatures: [],
      overusedFeatures: [],
      recommendations: ['Importa archivos de referencia buenos para poder comparar.'],
      similarityScore: 0,
      professionalGapScore: 100,
    };
  }

  const refAgg = aggregateBatchMetrics(references.map(r => ({ metrics: r.metrics })));
  const ourBlocks = classifyStitchBlocks(ourCommands || []);
  const ourByType = countByType(ourBlocks);

  const differences = [];
  const missingProfessionalFeatures = [];
  const overusedFeatures = [];
  const recommendations = [];

  const metricsToCompare = [
    'stitchCount', 'colorCount', 'jumpCount', 'trimCount',
    'averageStitchLength', 'maxStitchLength', 'shortStitchCount',
    'longVisibleStitchCount', 'duplicateStitchCount', 'colorBlockCount',
    'estimatedDensity', 'visibleTravelScore', 'professionalScore',
  ];

  for (const k of metricsToCompare) {
    const refAvg = refAgg.avg[k] ?? 0;
    const ours = ourMetrics[k] ?? 0;
    if (!Number.isFinite(refAvg) || !Number.isFinite(ours)) continue;
    const delta = ours - refAvg;
    const rel = refAvg !== 0 ? delta / Math.abs(refAvg) : (ours !== 0 ? 1 : 0);
    if (Math.abs(rel) > 0.25 || (refAvg === 0 && ours > 0)) {
      differences.push({
        metric: k,
        reference: refAvg,
        ours,
        delta,
        relativeDelta: rel,
        severity: Math.abs(rel) > 1 ? 'high' : Math.abs(rel) > 0.5 ? 'medium' : 'low',
      });
    }
  }

  // Block-type presence
  const refBlockAvg = {
    fill_tatami: refAgg.avg.fillLikeBlocks || 0,
    satin_border: refAgg.avg.satinLikeBlocks || 0,
    running_outline: refAgg.avg.contourLikeBlocks || 0,
    underlay: refAgg.avg.possibleUnderlayBlocks || 0,
  };
  for (const [type, refAvg] of Object.entries(refBlockAvg)) {
    const ours = ourByType[type] || 0;
    if (refAvg >= 1 && ours === 0) {
      missingProfessionalFeatures.push({
        feature: type,
        reference: refAvg,
        ours: 0,
        recommendation: `Los archivos buenos usan ${type} (promedio ${refAvg.toFixed(1)} bloques). Nuestro diseño no tiene ninguno.`,
      });
    }
    if (ours > refAvg * 2 && refAvg > 0) {
      overusedFeatures.push({
        feature: type,
        reference: refAvg,
        ours,
        recommendation: `Uso excesivo de ${type}: ${ours} vs ${refAvg.toFixed(1)} en referencias.`,
      });
    }
  }

  // Specific recommendations
  if ((ourMetrics.longVisibleStitchCount || 0) > (refAgg.avg.longVisibleStitchCount || 0) + 2) {
    recommendations.push('Reducir puntadas largas visibles (>7mm): dividirlas en sub-puntadas.');
  }
  if ((ourMetrics.duplicateStitchCount || 0) > (refAgg.avg.duplicateStitchCount || 0) + 3) {
    recommendations.push('Eliminar puntadas duplicadas consecutivas en la sanitización final.');
  }
  if ((ourMetrics.visibleTravelScore || 0) > (refAgg.avg.visibleTravelScore || 0) + 0.02) {
    recommendations.push('Reducir travel visible: convertir saltos largos en jump+trim o enmascarar con rellenos.');
  }
  if ((ourByType.underlay || 0) === 0 && (refAgg.avg.possibleUnderlayBlocks || 0) >= 1) {
    recommendations.push('Añadir underlay antes de rellenos grandes (las referencias lo hacen).');
  }
  if ((ourByType.running_outline || 0) === 0 && (refAgg.avg.contourLikeBlocks || 0) >= 1) {
    recommendations.push('Añadir contornos exteriores (running/satin) después de los rellenos.');
  }
  if ((ourMetrics.colorCount || 0) > (refAgg.avg.colorCount || 0) + 1) {
    recommendations.push('Reducir número de colores: agrupar colores similares como en las referencias.');
  }
  if (recommendations.length === 0) {
    recommendations.push('El diseño está alineado con el perfil profesional de las referencias.');
  }

  // Similarity score: weighted inverse of normalized deltas
  let sim = 100;
  for (const d of differences) {
    sim -= Math.min(15, Math.abs(d.relativeDelta) * 20 * (d.severity === 'high' ? 1.5 : 1));
  }
  sim = Math.max(0, Math.min(100, Math.round(sim)));

  // Professional gap score: how far our professionalScore is from the reference average
  const refProf = refAgg.avg.professionalScore || 0;
  const ourProf = ourMetrics.professionalScore || 0;
  const professionalGapScore = Math.max(0, Math.min(100, Math.round(refProf - ourProf)));

  return {
    differences: differences.sort((a, b) => Math.abs(b.relativeDelta) - Math.abs(a.relativeDelta)),
    missingProfessionalFeatures,
    overusedFeatures,
    recommendations,
    similarityScore: sim,
    professionalGapScore,
    referenceProfile: refAgg,
    ourBlockProfile: ourByType,
  };
}

function countByType(blocks) {
  const c = { fill_tatami: 0, satin_border: 0, running_outline: 0, double_run_detail: 0,
    underlay: 0, travel_jump: 0, noise: 0, unknown: 0 };
  for (const b of blocks) c[b.blockType] = (c[b.blockType] || 0) + 1;
  return c;
}

/**
 * compareAgainstCorpus — Reference Learning Engine v2 (FASE 6)
 * Richer comparison that explains in plain language HOW the design differs
 * from the professional corpus, and which learned rule justifies each problem.
 *
 * @param {object} ourMetrics — unified metrics of the current design
 * @param {Array<object>} corpus — from buildReferenceCorpus
 * @param {object|null} profile — recommended learned profile (optional)
 * @param {Array<object>} rules — mined rules (optional, to justify problems)
 * @returns {object} { similarityScore, professionalGapScore, differences,
 *   problems, missingProfessionalFeatures, overusedFeatures, recommendations,
 *   referenceProfile }
 */
export function compareAgainstCorpus(ourMetrics, corpus, profile, rules) {
  if (!corpus || corpus.length === 0) {
    return {
      differences: [], problems: [], missingProfessionalFeatures: [],
      overusedFeatures: [], recommendations: ['Importa archivos de referencia para comparar.'],
      similarityScore: 0, professionalGapScore: 100, referenceProfile: null,
    };
  }
  const summary = summarizeCorpus(corpus);
  const refAgg = summary ? summary.avg : {};
  const our = ourMetrics || {};
  const ruleMap = rules ? Object.fromEntries(rules.map(r => [r.ruleId, r])) : {};

  const differences = [];
  const metricsToCompare = [
    'stitchCount', 'colorCount', 'jumpCount', 'trimCount',
    'averageStitchLength', 'maxStitchLength', 'shortStitchCount',
    'longVisibleStitchCount', 'duplicateStitchCount', 'estimatedDensity',
    'visibleTravelScore',
  ];
  for (const k of metricsToCompare) {
    const refAvg = refAgg[k] ?? 0;
    const ours = our[k] ?? 0;
    if (!Number.isFinite(refAvg) || !Number.isFinite(ours)) continue;
    const delta = ours - refAvg;
    const rel = refAvg !== 0 ? delta / Math.abs(refAvg) : (ours !== 0 ? 1 : 0);
    if (Math.abs(rel) > 0.25 || (refAvg === 0 && ours > 0)) {
      differences.push({ metric: k, reference: refAvg, ours, delta, relativeDelta: rel,
        severity: Math.abs(rel) > 1 ? 'high' : Math.abs(rel) > 0.5 ? 'medium' : 'low' });
    }
  }

  // ── Problems with justifying rules ──────────────────────────────────────
  const problems = [];
  if ((our.longVisibleStitchCount || 0) > 0) {
    problems.push({ message: 'Demasiadas diagonales/puntadas visibles largas', justifyingRule: 'J003_max_visible_stitch',
      adjustment: `Dividir cualquier stitch > ${ruleMap.J003_max_visible_stitch?.parameterRange?.ceiling || 7}mm en sub-puntadas.` });
  }
  if ((our.satinBlocks ?? our.satinLikeBlocks ?? 0) === 0 && (refAgg.satinBlocks || 0) >= 1) {
    problems.push({ message: 'Pocos satin borders; el corpus profesional los usa', justifyingRule: 'C003_contour_with_fill',
      adjustment: 'Generar satin borders para contornos en diseños tipo cartoon.' });
  }
  if (profile?.contourAfterFill && our.contourAfterFill === false && our.fillAfterContour === true) {
    problems.push({ message: 'Orden de capas incorrecto: contornos antes de rellenos', justifyingRule: 'L001_contour_after_fill',
      adjustment: 'Reordenar: relleno antes, contorno exterior después.' });
  }
  if ((our.underlayBlocks ?? our.possibleUnderlayBlocks ?? 0) === 0 && (refAgg.underlayCandidates || 0) >= 1) {
    problems.push({ message: 'Faltan underlays en rellenos grandes', justifyingRule: 'L003_underlay_before_fill',
      adjustment: 'Añadir underlay (filas paralelas separadas) antes de rellenos >500mm².' });
  }
  if ((our.colorCount || 0) > (refAgg.colorCount || 0) + 1) {
    problems.push({ message: 'Exceso de colores frente al corpus', justifyingRule: 'CO003_color_reduction',
      adjustment: `Reducir colores similares (objetivo: ${Math.round(refAgg.colorCount || 0)}).` });
  }
  if ((our.jumpCount || 0) > (refAgg.jumpCount || 0) * 1.5 && (refAgg.jumpCount || 0) > 0) {
    problems.push({ message: 'Demasiados saltos', justifyingRule: 'J001_long_jumps_not_stitches',
      adjustment: 'Convertir saltos largos en jump+trim o enmascarar con rellenos.' });
  }
  if ((our.trimCount || 0) > (refAgg.trimCount || 0) * 1.5 && (refAgg.trimCount || 0) > 0) {
    problems.push({ message: 'Demasiados trims', justifyingRule: 'J002_trim_before_long_travel',
      adjustment: 'Consolidar trims adyacentes; solo trim antes de saltos largos.' });
  }
  if ((our.shortStitchCount || 0) > (refAgg.shortStitchCount || 0) * 2) {
    problems.push({ message: 'Puntadas cortas excesivas', justifyingRule: null,
      adjustment: 'Eliminar puntadas <0.3mm redundantes en la sanitización.' });
  }
  if ((our.visibleTravelScore || 0) > (refAgg.visibleTravelScore || 0) + 0.02) {
    problems.push({ message: 'Travel visible excesivo', justifyingRule: 'R008_low_visible_travel',
      adjustment: 'Enmascarar travel con rellenos o convertir en jump+trim.' });
  }

  // ── Missing / overused features (block-level) ──────────────────────────
  const missingProfessionalFeatures = [];
  const overusedFeatures = [];
  const refBlockAvg = {
    fill_tatami: refAgg.fillBlocks || 0,
    satin_border: refAgg.satinBlocks || 0,
    running_outline: refAgg.contourCandidates || 0,
    underlay: refAgg.underlayCandidates || 0,
  };
  const ourBlockCounts = {
    fill_tatami: our.fillLikeBlocks ?? 0,
    satin_border: our.satinBlocks ?? our.satinLikeBlocks ?? 0,
    running_outline: our.contourCandidates ?? our.contourLikeBlocks ?? 0,
    underlay: our.underlayBlocks ?? our.possibleUnderlayBlocks ?? 0,
  };
  for (const [type, refAvg] of Object.entries(refBlockAvg)) {
    const ours = ourBlockCounts[type] || 0;
    if (refAvg >= 1 && ours === 0) {
      missingProfessionalFeatures.push({ feature: type, reference: refAvg, ours: 0,
        recommendation: `El corpus usa ${type} (prom. ${refAvg.toFixed(1)}). Nuestro diseño no lo tiene.` });
    }
    if (ours > refAvg * 2 && refAvg > 0) {
      overusedFeatures.push({ feature: type, reference: refAvg, ours,
        recommendation: `Uso excesivo de ${type}: ${ours} vs ${refAvg.toFixed(1)}.` });
    }
  }

  const recommendations = problems.map(p => p.adjustment);
  if (recommendations.length === 0) recommendations.push('El diseño está alineado con el perfil profesional del corpus.');

  // Scores
  let sim = 100;
  for (const d of differences) {
    sim -= Math.min(12, Math.abs(d.relativeDelta) * 18 * (d.severity === 'high' ? 1.5 : 1));
  }
  sim -= problems.length * 4;
  sim = Math.max(0, Math.min(100, Math.round(sim)));

  const refProf = refAgg.professionalScore || 0;
  const ourProf = our.professionalScore || 0;
  const professionalGapScore = Math.max(0, Math.min(100, Math.round(refProf - ourProf + problems.length * 2)));

  return {
    differences: differences.sort((a, b) => Math.abs(b.relativeDelta) - Math.abs(a.relativeDelta)),
    problems,
    missingProfessionalFeatures,
    overusedFeatures,
    recommendations,
    similarityScore: sim,
    professionalGapScore,
    referenceProfile: summary,
  };
}