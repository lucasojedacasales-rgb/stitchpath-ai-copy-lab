/**
 * missingTieDetectorAuditReport.js — SAFE_TIE_V2_MISSING_TIE_DETECTOR_AUDIT.md
 * ─────────────────────────────────────────────────────────────────────────────
 * Compara la medición antigua de missingTie (por regionId global, la de
 * exportErrorDetector) frente a la nueva (por bloques consecutivos reales,
 * detectMissingTieByRealBlocks) antes y después de safeAddTieInTieOffV2.
 *
 * Incluye:
 *  - missingTie antiguo before/after
 *  - missingTie por bloques reales before/after
 *  - cantidad de bloques reales before/after
 *  - bloques tied detectados / skipped
 *  - ejemplos de 10 bloques con tie reconocido
 *  - ejemplos de 10 bloques donde sigue faltando tie
 *  - verificación de que los 68 tie-in y 68 tie-off son reconocidos
 */
export function generateMissingTieDetectorAudit(ctx) {
  const {
    beforeRealBlocks, afterRealBlocks, safeReport,
    beforeRegionMissing, afterRegionMissing,
    beforeRealMissing, afterRealMissing,
  } = ctx;
  const md = [];
  md.push('# SAFE_TIE_V2_MISSING_TIE_DETECTOR_AUDIT — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Compara detección de missingTie por regionId vs por bloques reales.');
  md.push('> No modifica el flujo V5.1. No sustituye addTieInTieOff.\n');

  md.push('## Resumen\n');
  md.push('| Medición | Before | After | Δ |');
  md.push('|---|---|---|---|');
  md.push(`| missingTieByRegion (antigua, ×regionId) | ${beforeRegionMissing} | ${afterRegionMissing} | ${afterRegionMissing - beforeRegionMissing} |`);
  md.push(`| missingTieByRealBlocks (nueva, ×bloques) | ${beforeRealMissing} | ${afterRealMissing} | ${afterRealMissing - beforeRealMissing} |`);
  md.push('');

  md.push('## Cantidad de bloques reales\n');
  md.push('| Métrica | Before | After |');
  md.push('|---|---|---|');
  md.push(`| realBlockCount (≥4 stitches) | ${beforeRealBlocks.realBlockCount} | ${afterRealBlocks.realBlockCount} |`);
  md.push(`| protectedBlockCount (detalle) | ${beforeRealBlocks.protectedBlockCount} | ${afterRealBlocks.protectedBlockCount} |`);
  md.push(`| evaluatedBlockCount | ${beforeRealBlocks.evaluatedBlockCount} | ${afterRealBlocks.evaluatedBlockCount} |`);
  md.push(`| blocksWithTieIn | ${beforeRealBlocks.blocksWithTieIn} | ${afterRealBlocks.blocksWithTieIn} |`);
  md.push(`| blocksWithTieOff | ${beforeRealBlocks.blocksWithTieOff} | ${afterRealBlocks.blocksWithTieOff} |`);
  md.push('');

  md.push('## Bloques tied / skipped (safeAddTieInTieOffV2)\n');
  md.push(`- safeBlocksTied: **${safeReport.safeBlocksTied || 0}**`);
  md.push(`- safeBlocksSkipped: **${safeReport.safeBlocksSkipped || 0}**`);
  md.push(`- safeTieInAdded: **${safeReport.safeTieInAdded || 0}**`);
  md.push(`- safeTieOffAdded: **${safeReport.safeTieOffAdded || 0}**`);
  md.push('');

  md.push('## Verificación de reconocimiento de ties\n');
  const expectedTieIn = safeReport.safeTieInAdded || 0;
  const expectedTieOff = safeReport.safeTieOffAdded || 0;
  const recognizedTieInBlocks = afterRealBlocks.blocksWithTieIn - beforeRealBlocks.blocksWithTieIn;
  const recognizedTieOffBlocks = afterRealBlocks.blocksWithTieOff - beforeRealBlocks.blocksWithTieOff;
  md.push(`- tie-in añadidos esperados: **${expectedTieIn}**`);
  md.push(`- tie-in reconocidos por bloques (Δ blocksWithTieIn): **${recognizedTieInBlocks}**`);
  md.push(`- tie-off añadidos esperados: **${expectedTieOff}**`);
  md.push(`- tie-off reconocidos por bloques (Δ blocksWithTieOff): **${recognizedTieOffBlocks}**`);
  const tieInRecognizedOk = recognizedTieInBlocks >= (safeReport.safeBlocksTied || 0);
  const tieOffRecognizedOk = recognizedTieOffBlocks >= (safeReport.safeBlocksTied || 0);
  md.push(`- ¿tie-in reconocidos correctamente? ${tieInRecognizedOk ? '✅ SÍ' : '❌ NO'}`);
  md.push(`- ¿tie-off reconocidos correctamente? ${tieOffRecognizedOk ? '✅ SÍ' : '❌ NO'}`);
  md.push('');

  // ── ejemplos: bloques con tie reconocido (after) ──
  md.push('## Ejemplos — 10 bloques con tie reconocido (after)\n');
  const withTie = (afterRealBlocks.blocks || []).filter(b => b.hasTieIn && b.hasTieOff);
  if (withTie.length === 0) {
    md.push('- (ninguno)\n');
  } else {
    md.push('| # | index | stitches | color | regionId | protected | tieInBy | tieOffBy |');
    md.push('|---|---|---|---|---|---|---|---|');
    withTie.slice(0, 10).forEach((b, k) => {
      md.push(`| ${k + 1} | ${b.index} | ${b.stitchCount} | ${b.color || '—'} | ${b.regionId || '—'} | ${b.protected ? 'SÍ' : 'no'} | ${b.tieInBy || '—'} | ${b.tieOffBy || '—'} |`);
    });
    md.push('');
  }

  // ── ejemplos: bloques donde sigue faltando tie (after) ──
  md.push('## Ejemplos — 10 bloques donde sigue faltando tie (after)\n');
  const stillMissing = (afterRealBlocks.blocks || []).filter(b => !b.protected && (!b.hasTieIn || !b.hasTieOff));
  if (stillMissing.length === 0) {
    md.push('- (ninguno — todos los bloques evaluados tienen tie-in y tie-off)\n');
  } else {
    md.push('| # | index | stitches | color | regionId | faltaTieIn | faltaTieOff |');
    md.push('|---|---|---|---|---|---|---|');
    stillMissing.slice(0, 10).forEach((b, k) => {
      md.push(`| ${k + 1} | ${b.index} | ${b.stitchCount} | ${b.color || '—'} | ${b.regionId || '—'} | ${b.hasTieIn ? 'no' : 'SÍ'} | ${b.hasTieOff ? 'no' : 'SÍ'} |`);
    });
    md.push('');
  }

  // ── conclusión ──
  md.push('## Conclusión\n');
  md.push(`- La medición antigua (missingTieByRegion) ${afterRegionMissing < beforeRegionMissing ? 'sí bajó' : 'NO bajó'} (${beforeRegionMissing}→${afterRegionMissing}).`);
  md.push(`- La medición nueva (missingTieByRealBlocks) ${afterRealMissing < beforeRealMissing ? 'sí bajó' : 'NO bajó'} (${beforeRealMissing}→${afterRealMissing}).`);
  md.push(`- Diferencia explicada: la medición antigua agrupa por regionId global; un mismo regionId`);
  md.push('  repartido en N bloques del fichero solo cuenta 1 bloque y 1 tie, por lo que los ties');
  md.push('  añadidos en bloques intermedios no se reflejan. La medición nueva cuenta cada bloque real.');
  md.push(`- safeBlocksTied=${safeReport.safeBlocksTied || 0}, safeTieInAdded=${expectedTieIn}, safeTieOffAdded=${expectedTieOff}.`);
  md.push(`- Reconocimiento tie-in: ${tieInRecognizedOk ? 'correcto' : 'incompleto'} (${recognizedTieInBlocks}/${safeReport.safeBlocksTied || 0} bloques).`);
  md.push(`- Reconocimiento tie-off: ${tieOffRecognizedOk ? 'correcto' : 'incompleto'} (${recognizedTieOffBlocks}/${safeReport.safeBlocksTied || 0} bloques).`);
  md.push('');

  md.push('---');
  md.push('_Auditoría del detector de missingTie — V3. No modifica el flujo V5.1 estable._');
  return md.join('\n');
}