/**
 * referenceAppliedReportGenerator.js — Reference Learning Engine v2 (FASE 7-8)
 * ─────────────────────────────────────────────────────────────────────────────
 * Genera el REFERENCE_LEARNING_APPLIED_REPORT.md que documenta:
 *   - corpus usado
 *   - perfil seleccionado
 *   - preset aplicado
 *   - comparación antes/después
 *   - reglas que justifican cada parámetro
 *   - mejoras reales y problemas restantes
 */

/**
 * @param {object} ctx
 * @returns {string} markdown report
 */
export function generateReferenceLearningAppliedReport(ctx) {
  const { designName, selection, preset, configPatch, beforeComparison, corpusSummary, learnedRules } = ctx;
  const md = [];

  md.push('# REFERENCE_LEARNING_APPLIED_REPORT — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}\n`);
  md.push('> Modo: aplicación real al Professional Mode (no solo diagnóstico).\n');

  // 1. Corpus usado
  md.push('## 1. Corpus usado\n');
  if (corpusSummary) {
    md.push(`- Archivos en corpus: **${corpusSummary.count || 0}**`);
    md.push(`- Puntadas promedio: ${fmt(corpusSummary.avg?.stitchCount)}`);
    md.push(`- Colores promedio: ${(corpusSummary.avg?.colorCount || 0).toFixed(1)}`);
    md.push(`- Densidad estimada promedio: ${(corpusSummary.avg?.estimatedDensity || 0).toFixed(3)}`);
  }
  md.push('');

  // 2. Perfil seleccionado
  md.push(`## 2. Perfil seleccionado para "${designName}"\n`);
  if (selection?.selectedProfile) {
    const p = selection.selectedProfile;
    md.push(`- **Perfil: ${p.label}** (\`${p.name}\`)`);
    md.push(`- Confianza: ${(selection.confidence * 100).toFixed(0)}%`);
    md.push(`- Razón: ${selection.reason}`);
    md.push(`- Archivos de referencia coincidentes: ${(p.matchedFiles || []).length}`);
    if (p.matchedFiles?.length) md.push(`  - ${p.matchedFiles.slice(0, 8).join(', ')}`);
  } else {
    md.push('_No se seleccionó ningún perfil._');
  }
  md.push('');

  // 3. Preset aplicado
  md.push('## 3. Preset aprendido aplicado\n');
  if (preset) {
    md.push('| Parámetro | Valor | Regla justificante |');
    md.push('|---|---|---|');
    const ruleMap = Object.fromEntries((learnedRules || []).map(r => [r.ruleId, r]));
    md.push(`| fillRowSpacingMm | ${preset.fillRowSpacingMm}mm | ${justifyingRule(ruleMap, 'D001_fill_row_spacing')} |`);
    md.push(`| satinColumnSpacingMm | ${preset.satinColumnSpacingMm}mm | ${justifyingRule(ruleMap, 'D003_satin_column_spacing')} |`);
    md.push(`| satinWidthMm | ${preset.satinWidthMm}mm | ${justifyingRule(ruleMap, 'C002_satin_width')} |`);
    md.push(`| pullCompensationMm | ${preset.pullCompensationMm}mm | ${justifyingRule(ruleMap, 'D004_pull_compensation')} |`);
    md.push(`| fillAngleDeg | ${preset.fillAngleDeg}° | ${justifyingRule(ruleMap, 'D002_fill_angle')} |`);
    md.push(`| neighborAngleVariationDeg | ${preset.neighborAngleVariationDeg}° | ${justifyingRule(ruleMap, 'F003_angle_variance_neighbors')} |`);
    md.push(`| maxVisibleStitchMm | ${preset.maxVisibleStitchMm}mm | ${justifyingRule(ruleMap, 'J003_max_visible_stitch')} |`);
    md.push(`| trimBeforeTravelMm | ${preset.trimBeforeTravelMm}mm | ${justifyingRule(ruleMap, 'J002_trim_before_long_travel')} |`);
    md.push(`| convertTravelAboveMmToJump | ${preset.convertTravelAboveMmToJump}mm | ${justifyingRule(ruleMap, 'J001_long_jumps_not_stitches')} |`);
    md.push(`| underlayEnabled | ${preset.underlayEnabled} | ${justifyingRule(ruleMap, 'L003_underlay_before_fill')} |`);
    md.push(`| contourAfterFill | ${preset.contourAfterFill} | ${justifyingRule(ruleMap, 'L001_contour_after_fill')} |`);
    md.push(`| detailsLast | ${preset.detailsLast} | ${justifyingRule(ruleMap, 'L002_details_at_end')} |`);
    md.push(`| maxColorCount | ${preset.maxColorCount} | ${justifyingRule(ruleMap, 'CO001_color_count_by_complexity')} |`);
    md.push(`| useSatinForOuterContours | ${preset.useSatinForOuterContours} | perfil ${selection?.selectedProfile?.name} |`);
    md.push(`| reduceSimilarColors | ${preset.reduceSimilarColors} | ${justifyingRule(ruleMap, 'CO003_color_reduction')} |`);
  } else {
    md.push('_No se construyó ningún preset._');
  }
  md.push('');

  // 4. Comparación del diseño actual (ANTES)
  md.push('## 4. Análisis del diseño actual (antes de aplicar)\n');
  if (beforeComparison) {
    md.push(`- Professional gap score: **${beforeComparison.professionalGapScore}/100** (menor = mejor)`);
    md.push(`- Similarity score: ${beforeComparison.similarityScore}/100`);
    md.push('');
    if (beforeComparison.violatedRules?.length) {
      md.push('### Reglas incumplidas por el diseño actual\n');
      md.push('| Regla | Confianza | Valor corpus | Valor actual | Acción | Severidad |');
      md.push('|---|---|---|---|---|---|');
      for (const v of beforeComparison.violatedRules) {
        md.push(`| ${v.ruleId} | ${(v.confidence * 100).toFixed(0)}% | ${v.corpusValue} | ${v.currentValue} | ${v.action} | ${v.severity} |`);
      }
      md.push('');
    }
    if (beforeComparison.recommendedFixes?.length) {
      md.push('### Correcciones recomendadas\n');
      for (const f of beforeComparison.recommendedFixes) md.push(`- ${f}`);
      md.push('');
    }
  } else {
    md.push('_Sin comparación disponible._');
  }
  md.push('');

  // 5. Config patch aplicado
  md.push('## 5. Config patch aplicado al Professional Mode\n');
  if (configPatch) {
    md.push('| Key | Valor |');
    md.push('|---|---|');
    for (const [k, v] of Object.entries(configPatch)) {
      md.push(`| ${k} | ${typeof v === 'object' ? JSON.stringify(v) : v} |`);
    }
  }
  md.push('');

  // 6. Próximos pasos
  md.push('## 6. Validación\n');
  md.push('1. Activar Professional Mode en el Editor con este preset.');
  md.push('2. Ejecutar Professional Quality Gate — esperar visibleDiagonalStitches ↓.');
  md.push('3. Verificar que boca/ojos/pies/contorno exterior no desaparecen.');
  md.push('4. Ejecutar /regression — no romper tests existentes.');
  md.push('5. CE01 no debe empeorar.\n');

  md.push('---');
  md.push('_Reference Learning Engine v2 — aplicación real de reglas técnicas aprendidas. No copia coordenadas ni genera diseños derivados._');

  return md.join('\n');
}

function justifyingRule(ruleMap, ruleId) {
  const r = ruleMap[ruleId];
  if (!r) return 'valor por defecto profesional';
  return `${r.ruleId} (${(r.confidence * 100).toFixed(0)}%)`;
}

function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}