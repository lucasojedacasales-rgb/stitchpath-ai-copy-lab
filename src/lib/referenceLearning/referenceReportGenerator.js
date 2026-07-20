/**
 * referenceReportGenerator.js — Reference Embroidery Learning System
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the REFERENCE_LEARNING_REPORT.md markdown report from:
 *   - analyzed reference files
 *   - aggregated metrics
 *   - extracted professional rules
 *   - comparison against a StitchPath AI design
 *
 * Returns a markdown string. The UI offers it as a downloadable .md file.
 */

import { aggregateBatchMetrics } from './referenceMetricsAnalyzer';

export function generateReferenceLearningReport({ references, rules, comparison, projectName }) {
  const lines = [];
  const date = new Date().toISOString();
  const agg = aggregateBatchMetrics(references.map(r => ({ metrics: r.metrics })));

  lines.push('# REFERENCE_LEARNING_REPORT — StitchPath AI');
  lines.push('');
  lines.push(`> Generado: ${date}`);
  lines.push('> Modo: diagnóstico (solo lectura). No se aplican reglas al motor automáticamente.');
  if (projectName) lines.push(`> Diseño comparado: ${projectName}`);
  lines.push('');

  // 1. Files analyzed
  lines.push('## 1. Archivos analizados');
  lines.push('');
  if (!references.length) {
    lines.push('Ninguno todavía. Importa archivos buenos DST/DSB para empezar.');
  } else {
    lines.push('| Archivo | Formato | Puntadas | Colores | Saltos | Trims | Score Pro | Tags |');
    lines.push('|---------|:------:|:------:|:------:|:------:|:------:|:------:|------|');
    for (const r of references) {
      lines.push(`| ${r.filename} | ${r.format} | ${r.metrics.stitchCount} | ${r.metrics.colorCount} | ${r.metrics.jumpCount} | ${r.metrics.trimCount} | ${r.professionalScore ?? r.metrics.professionalScore} | ${(r.tags || []).join(', ') || '—'} |`);
    }
  }
  lines.push('');

  // 2. Average metrics
  lines.push('## 2. Métricas promedio');
  lines.push('');
  if (agg) {
    lines.push('| Métrica | Promedio | Mín | Máx |');
    lines.push('|---------|:------:|:------:|:------:|');
    for (const k of Object.keys(agg.avg)) {
      lines.push(`| ${k} | ${fmt(agg.avg[k])} | ${fmt(agg.min[k])} | ${fmt(agg.max[k])} |`);
    }
  } else {
    lines.push('Sin datos.');
  }
  lines.push('');

  // 3. Best patterns detected
  lines.push('## 3. Mejores patrones detectados');
  lines.push('');
  if (agg) {
    lines.push(`- Densidad estimada promedio: ${fmt(agg.avg.estimatedDensity)} mm/mm²`);
    lines.push(`- Travel visible promedio: ${fmt(agg.avg.visibleTravelScore)} (ratio)`);
    lines.push(`- Puntadas largas visibles promedio: ${fmt(agg.avg.longVisibleStitchCount)}`);
    lines.push(`- Bloques tipo contorno promedio: ${fmt(agg.avg.contourLikeBlocks)}`);
    lines.push(`- Bloques tipo underlay promedio: ${fmt(agg.avg.possibleUnderlayBlocks)}`);
    lines.push(`- Professional score promedio: ${fmt(agg.avg.professionalScore)}/100`);
  } else {
    lines.push('Sin datos.');
  }
  lines.push('');

  // 4. Learned professional rules
  lines.push('## 4. Reglas profesionales aprendidas');
  lines.push('');
  if (!rules || !rules.length) {
    lines.push('Ninguna regla extraída todavía.');
  } else {
    lines.push('| ID | Regla | Confianza | Ejemplos | Acción recomendada |');
    lines.push('|----|-------|:------:|:------:|------|');
    for (const r of rules) {
      lines.push(`| ${r.ruleId} | ${r.name} | ${(r.confidence * 100).toFixed(0)}% | ${(r.examples || []).slice(0, 3).join(', ') || '—'} | ${r.recommendedAction} |`);
    }
  }
  lines.push('');

  // 5. Differences vs our motor
  lines.push('## 5. Diferencias contra nuestro motor');
  lines.push('');
  if (comparison) {
    lines.push(`- Similarity score: ${comparison.similarityScore}/100`);
    lines.push(`- Professional gap score: ${comparison.professionalGapScore}/100`);
    lines.push('');
    if (comparison.differences.length) {
      lines.push('| Métrica | Referencia | Nuestro | Delta | Severidad |');
      lines.push('|---------|:------:|:------:|:------:|:------:|');
      for (const d of comparison.differences.slice(0, 20)) {
        lines.push(`| ${d.metric} | ${fmt(d.reference)} | ${fmt(d.ours)} | ${fmt(d.delta)} | ${d.severity} |`);
      }
    } else {
      lines.push('Sin diferencias significativas.');
    }
    lines.push('');
    if (comparison.missingProfessionalFeatures.length) {
      lines.push('### Características profesionales faltantes');
      for (const m of comparison.missingProfessionalFeatures) {
        lines.push(`- **${m.feature}**: ${m.recommendation}`);
      }
      lines.push('');
    }
    if (comparison.overusedFeatures.length) {
      lines.push('### Características sobreutilizadas');
      for (const o of comparison.overusedFeatures) {
        lines.push(`- **${o.feature}**: ${o.recommendation}`);
      }
      lines.push('');
    }
  } else {
    lines.push('Sin comparación (no se proporcionó diseño propio).');
  }
  lines.push('');

  // 6. Recommendations for Professional Mode
  lines.push('## 6. Recomendaciones para mejorar Professional Mode');
  lines.push('');
  if (comparison && comparison.recommendations.length) {
    for (const rec of comparison.recommendations) {
      lines.push(`- ${rec}`);
    }
  } else {
    lines.push('Importa referencias y compara un diseño para obtener recomendaciones.');
  }
  lines.push('');

  // 7. Next steps
  lines.push('## 7. Próximos pasos');
  lines.push('');
  lines.push('1. Revisar cada regla aprendida y validar contra más referencias.');
  lines.push('2. Aplicar reglas una por una al Professional Mode con tests de regresión.');
  lines.push('3. No copiar puntadas ni plagiar diseños — solo estructura técnica y métricas.');
  lines.push('');

  return lines.join('\n');
}

function fmt(v) {
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(3);
  }
  return String(v ?? '—');
}