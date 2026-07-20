/**
 * referenceLearningEngineReport.js — Reference Learning Engine v2 (FASE 9)
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the REFERENCE_LEARNING_ENGINE_REPORT.md from the corpus, mined
 * rules, learned profiles, a comparison of the current design (e.g. Kirby) and
 * the preset applied.
 *
 * Read-only: produces a markdown string the UI can offer as a download.
 */

import { summarizeCorpus } from './referenceCorpus';
import { rulesByCategory } from './professionalRuleMiner';

/**
 * @param {object} ctx
 * @param {Array} ctx.corpus
 * @param {Array} ctx.rules
 * @param {Array} ctx.profiles
 * @param {object} ctx.comparison — compareAgainstCorpus result for current design
 * @param {object|null} ctx.appliedProfile
 * @param {object|null} ctx.appliedPatch
 * @param {string} ctx.designName
 * @returns {string} markdown
 */
export function generateReferenceLearningEngineReport(ctx) {
  const { corpus, rules, profiles, comparison, appliedProfile, appliedPatch, designName } = ctx;
  const summary = summarizeCorpus(corpus);
  const md = [];

  md.push('# Reference Learning Engine — Informe técnico\n');
  md.push(`> Generado: ${new Date().toISOString()}\n`);

  // ── Corpus overview
  md.push('## 1. Corpus profesional\n');
  md.push(`- Archivos analizados: **${corpus.length}**`);
  if (summary) {
    md.push(`- Puntadas promedio: ${fmt(summary.avg.stitchCount)} (rango ${fmt(summary.min.stitchCount)}–${fmt(summary.max.stitchCount)})`);
    md.push(`- Colores promedio: ${summary.avg.colorCount.toFixed(1)}`);
    md.push(`- Densidad estimada promedio: ${summary.avg.estimatedDensity.toFixed(3)}`);
    md.push(`- Saltos promedio: ${fmt(summary.avg.jumpCount)} · Trims promedio: ${fmt(summary.avg.trimCount)}`);
    md.push(`- Bloques fill promedio: ${summary.avg.fillBlocks.toFixed(1)} · satin: ${summary.avg.satinBlocks.toFixed(1)} · running: ${summary.avg.runningBlocks.toFixed(1)}`);
  }
  md.push('');

  // ── Patterns frequency
  if (summary && summary.patternFreq) {
    md.push('### Patrones profesionales detectados (frecuencia)');
    md.push('| Patrón | Archivos | % |');
    md.push('|---|---|---|');
    for (const [p, count] of Object.entries(summary.patternFreq).sort((a, b) => b[1] - a[1])) {
      md.push(`| \`${p}\` | ${count} | ${Math.round((count / corpus.length) * 100)}% |`);
    }
    md.push('');
  }

  // ── Profiles detected
  md.push('## 2. Perfiles detectados\n');
  if (!profiles || profiles.length === 0) {
    md.push('_No se generaron perfiles (corpus insuficiente)._\n');
  } else {
    for (const p of profiles) {
      md.push(`### ${p.label} (\`${p.name}\`) — ${p.matchedFiles?.length || 0} archivos`);
      md.push(`- Densidad relleno: ${p.recommendedFillDensity?.toFixed(3)}`);
      md.push(`- Densidad satin: ${p.recommendedSatinDensity?.toFixed(3)}`);
      md.push(`- Max stitch visible: ${p.maxVisibleStitchMm}mm`);
      md.push(`- Max colores: ${p.maxColorCount}`);
      md.push(`- Contorno tras relleno: ${p.contourAfterFill ? 'sí' : 'no'} · Underlay grandes: ${p.useUnderlayRules?.largeFills ? 'sí' : 'no'}`);
      md.push(`- Orden de capas: ${(p.layerOrderRules || []).join(' → ')}`);
      if (p.matchedFiles?.length) md.push(`- Ejemplos: ${p.matchedFiles.slice(0, 5).join(', ')}`);
      md.push('');
    }
  }

  // ── Learned rules
  md.push('## 3. Reglas aprendidas\n');
  const byCat = rulesByCategory(rules || []);
  for (const [cat, catRules] of Object.entries(byCat)) {
    md.push(`### ${cat}`);
    for (const r of catRules) {
      md.push(`- **${r.ruleId}** ${r.name} — confianza ${(r.confidence * 100).toFixed(0)}% (${r.learnedFromFiles} archivos)`);
      md.push(`  - Condición: ${r.condition}`);
      md.push(`  - Acción: ${r.recommendedAction}`);
      if (r.parameterRange) md.push(`  - Rango: \`${JSON.stringify(r.parameterRange)}\``);
    }
    md.push('');
  }

  // ── Recommended ranges
  md.push('## 4. Rangos recomendados (promedio profesional)\n');
  if (summary) {
    md.push('| Parámetro | Mín | Promedio | Máx |');
    md.push('|---|---|---|---|');
    for (const k of ['estimatedDensity', 'shortStitchRatio', 'longVisibleStitchRatio', 'duplicateRatio', 'trimDensity']) {
      md.push(`| ${k} | ${summary.min[k]?.toFixed(3)} | ${summary.avg[k]?.toFixed(3)} | ${summary.max[k]?.toFixed(3)} |`);
    }
    md.push('');
  }

  // ── Current design comparison
  md.push(`## 5. Análisis del diseño actual (${designName || '—'})\n`);
  if (!comparison) {
    md.push('_Sin comparación disponible._\n');
  } else {
    md.push(`- Perfil seleccionado: **${comparison.selectedProfile?.label || '—'}** (\`${comparison.selectedProfile?.name || '—'}\`)`);
    md.push(`- Confianza: ${comparison.selectedProfile ? Math.round((comparison.confidence || 0) * 100) : 0}%`);
    md.push(`- Similarity score: ${comparison.similarityScore}/100`);
    md.push(`- Professional gap score: ${comparison.professionalGapScore}/100 (menor = mejor)`);
    if (comparison.violatedRules?.length) {
      md.push('\n### Reglas incumplidas por el diseño actual\n');
      md.push('| Regla | Confianza | Valor corpus | Valor actual | Acción | Severidad |');
      md.push('|---|---|---|---|---|---|');
      for (const v of comparison.violatedRules) {
        md.push(`| ${v.ruleId} | ${(v.confidence * 100).toFixed(0)}% | ${v.corpusValue} | ${v.currentValue} | ${v.action} | ${v.severity} |`);
      }
      md.push('');
    }
    if (comparison.differences?.length) {
      md.push('### Diferencias frente al corpus\n');
      md.push('| Métrica | Referencia | Nuestro | Δ | Severidad |');
      md.push('|---|---|---|---|---|');
      for (const d of comparison.differences.slice(0, 12)) {
        md.push(`| ${d.metric} | ${fmt(d.reference)} | ${fmt(d.ours)} | ${d.delta.toFixed(1)} | ${d.severity} |`);
      }
      md.push('');
    }
    if (comparison.missingFeatures?.length) {
      md.push('### Características profesionales faltantes');
      for (const m of comparison.missingFeatures) md.push(`- **${m.feature}**: ${m.recommendation}`);
      md.push('');
    }
    if (comparison.overusedFeatures?.length) {
      md.push('### Características sobreutilizadas');
      for (const o of comparison.overusedFeatures) md.push(`- **${o.feature}**: ${o.recommendation}`);
      md.push('');
    }
    if (comparison.recommendedFixes?.length) {
      md.push('### Correcciones recomendadas');
      for (const f of comparison.recommendedFixes) md.push(`- ${f}`);
      md.push('');
    }
  }

  // ── Applied preset
  md.push('## 6. Preset aprendido aplicado\n');
  if (!appliedProfile) {
    md.push('_No se aplicó ningún preset (Professional Mode desactivado o sin perfil)._');
    md.push('');
    md.push('Para aplicar: usa el botón "Aplicar perfil aprendido al modo profesional" en el panel de Aprendizaje.');
  } else {
    md.push(`Perfil: **${appliedProfile.label}** (\`${appliedProfile.name}\`)\n`);
    if (appliedPatch) {
      md.push('| Parámetro | Valor |');
      md.push('|---|---|');
      for (const [k, v] of Object.entries(appliedPatch)) {
        if (Array.isArray(v)) md.push(`| ${k} | ${v.join(' → ')} |`);
        else if (typeof v === 'object') md.push(`| ${k} | ${JSON.stringify(v)} |`);
        else md.push(`| ${k} | ${v} |`);
      }
      md.push('');
    }
  }

  // ── What the engine learned (plain language summary)
  md.push('## 7. Resumen en lenguaje natural\n');
  if (rules && rules.length) {
    const top = [...rules].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
    for (const r of top) {
      md.push(`- ${r.name} en el ${(r.confidence * 100).toFixed(0)}% de los archivos → ${r.recommendedAction}`);
    }
  }
  if (appliedProfile && appliedPatch) {
    md.push('');
    md.push(`Para **${designName || 'este diseño'}** aplicaré:`);
    md.push(`- Perfil: ${appliedProfile.label}`);
    md.push(`- contourAfterFill=${appliedPatch.contourAfterFill}`);
    md.push(`- satinOuterContour=${appliedPatch.useSatinForOuterContours}`);
    md.push(`- maxVisibleStitchMm=${appliedPatch.maxVisibleStitchMm}`);
    md.push(`- underlayLargeFills=${appliedPatch.underlayEnabled}`);
    md.push(`- reduceColorsTo=${appliedPatch.maxColorCount}`);
    md.push(`- trimLongTravels=${appliedPatch.trimLongTravels}`);
  }

  md.push('\n---');
  md.push('_Reference Learning Engine v2 — diagnóstico de solo lectura. No copia coordenadas exactas ni genera diseños derivados._');

  return md.join('\n');
}

function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}