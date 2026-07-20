/**
 * exportRepairReport.js — EXPORT_REPAIR_REPORT_V5.md
 * ─────────────────────────────────────────────────────────────────────────────
 * Informe transaccional v5 — prioridad de bloqueos; longSt soft para diagonales.
 *   1. Veredicto (repairAccepted, exportAllowed, commandSource, CE01, DST/DSB)
 *   2. Bloqueos antes/después (visibleDiag, emptyBlocks, invalidCmd, outOfBounds)
 *   3. Fase repairVisibleDiagonalStitches (detected/removed/converted/longSt)
 *   4. Final validation (source / repaired / returned)
 */

export function generateExportRepairReport(ctx) {
  const {
    phaseLog, sourceMetrics, finalMetrics, returnedMetrics, exportDecisionSource,
    comparison, repairAccepted, repairRejected, rejectionReason, exportAllowed, remainingBlockingIssues,
    visibleDiagForensics, visibleDiagDetection,
    emptyBlockForensics, exportBlockedBecauseRemainingEmptyBlocks,
  } = ctx;
  const md = [];

  md.push('# EXPORT_REPAIR_REPORT_V5_1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> v5.1: removeEmptyBlocks robusto (8 casos) + decisión de mejora parcial + addTieInTieOff al final.');
  md.push('> Prioridad: eliminar bloqueos > ce01Score > longSt. RISKY permite export; INVALID bloquea.');
  md.push('> longSt es métrica secundaria: no revierte diagonales visibles reparadas.\n');

  // 1. Veredicto
  md.push('## 1. Veredicto\n');
  md.push(`- repairAccepted: **${repairAccepted ? 'SÍ' : 'NO'}**`);
  md.push(`- repairRejected: **${repairRejected ? 'SÍ (REPAIR_REJECTED)' : 'NO'}**`);
  md.push(`- exportAllowed: **${exportAllowed ? 'SÍ' : 'NO'}**`);
  md.push(`- commandSourceUsedForExport: **${exportDecisionSource}**`);
  md.push(`- CE01 status: **${returnedMetrics.ce01Status}** (source: ${sourceMetrics.ce01Status})`);
  md.push(`- CE01 score: **${returnedMetrics.ce01Score}** (source: ${sourceMetrics.ce01Score})`);
  md.push(`- DST usa repairedCommands: **${exportDecisionSource === 'repaired' ? 'true' : 'false'}**`);
  md.push(`- DSB usa repairedCommands: **${exportDecisionSource === 'repaired' ? 'true' : 'false'}**`);
  if (repairRejected) {
    md.push(`- exportBlockedBecauseRepairRejected: ${rejectionReason || 'REPAIR_REJECTED — export usa sourceCommands.'}`);
  }
  if (exportBlockedBecauseRemainingEmptyBlocks != null) {
    md.push(`- exportBlockedBecauseRemainingEmptyBlocks: ${exportBlockedBecauseRemainingEmptyBlocks} (repaired mantenido como candidato para depuración)`);
  }
  md.push('');

  // 1b. Tracking de emptyBlocks por fase (v5.1)
  md.push('## 1b. Tracking de emptyBlocks por fase (v5.1)\n');
  md.push('| Etapa | emptyBlocks |');
  md.push('|---|---|');
  const ebPhase = (name) => phaseLog.find(p => p.name === name);
  md.push(`| source | ${fmt(sourceMetrics.emptyBlocks)} |`);
  const afterRemoveEmpty = ebPhase('removeEmptyBlocks');
  md.push(`| after removeEmptyBlocks | ${fmt(afterRemoveEmpty?.after?.emptyBlocks)} |`);
  const afterReduceColors = ebPhase('reduceColorChangesIfSafe');
  md.push(`| after reduceColorChangesIfSafe | ${fmt(afterReduceColors?.after?.emptyBlocks)} |`);
  const afterRemoveEmptyFinal = ebPhase('removeEmptyBlocksFinal');
  md.push(`| after removeEmptyBlocksFinal | ${fmt(afterRemoveEmptyFinal?.after?.emptyBlocks)} |`);
  const afterTies = ebPhase('addTieInTieOff');
  md.push(`| after addTieInTieOff | ${fmt(afterTies?.after?.emptyBlocks)} |`);
  md.push(`| returned | ${fmt(returnedMetrics.emptyBlocks)} |`);
  md.push('');

  // 2. Bloqueos antes/después
  md.push('## 2. Bloqueos antes/después\n');
  md.push('| Bloqueo | source | repaired | returned | resuelto |');
  md.push('|---|---|---|---|---|');
  const blockingRows = [
    ['visibleDiagonalStitches', sourceMetrics.visibleDiagonalStitches, finalMetrics.visibleDiagonalStitches, returnedMetrics.visibleDiagonalStitches],
    ['emptyBlocks', sourceMetrics.emptyBlocks, finalMetrics.emptyBlocks, returnedMetrics.emptyBlocks],
    ['invalidCommandSequence', sourceMetrics.invalidCommandSequence, finalMetrics.invalidCommandSequence, returnedMetrics.invalidCommandSequence],
    ['regionOutsideBounds', sourceMetrics.regionOutsideBounds, finalMetrics.regionOutsideBounds, returnedMetrics.regionOutsideBounds],
  ];
  for (const [k, s, f, r] of blockingRows) {
    md.push(`| ${k} | ${fmt(s)} | ${fmt(f)} | ${fmt(r)} | ${r === 0 ? '✅' : '❌'} |`);
  }
  md.push('');

  // 3. Fase repairVisibleDiagonalStitches
  md.push('## 3. Fase repairVisibleDiagonalStitches\n');
  const repairPhase = phaseLog.find(p => p.name === 'repairVisibleDiagonalStitches');
  const sr = repairPhase?.stepReport || {};
  md.push(`- detected: **${sr.visibleDiagonalStitchesDetected ?? '—'}**`);
  md.push(`- removed: **${sr.visibleDiagonalStitchesRemoved ?? '—'}**`);
  md.push(`- convertedToJump: **${sr.convertedDiagonalToJump ?? '—'}**`);
  md.push(`- preservedAsValidFill: **${sr.skippedBecauseValidFill ?? '—'}**`);
  md.push(`- acceptedDespiteLongStIncrease: **${repairPhase?.acceptedDespiteLongStIncrease ? 'SÍ' : 'NO'}**`);
  md.push(`- acceptedDespiteScoreDrop: **${repairPhase?.acceptedDespiteScoreDrop ? 'SÍ' : 'NO'}**`);
  if (repairPhase) {
    md.push(`- longSt before/after: **${repairPhase.before.unsupportedLongStitches} → ${repairPhase.after.unsupportedLongStitches}**`);
    md.push(`- visibleDiag before/after: **${repairPhase.before.visibleDiagonalStitches} → ${repairPhase.after.visibleDiagonalStitches}**`);
    md.push(`- ce01Score before/after: **${repairPhase.before.ce01Score} → ${repairPhase.after.ce01Score}** (${repairPhase.before.ce01Status} → ${repairPhase.after.ce01Status})`);
    md.push(`- reason: ${repairPhase.reason || (repairPhase.accepted ? 'diagonales reducidas, CE01 no INVALID' : '—')}`);
  }
  md.push('');

  // 4. Final validation
  md.push('## 4. Final validation (source / repaired / returned)\n');
  md.push('| Métrica | source | repaired | returned | OK |');
  md.push('|---|---|---|---|---|');
  const rows = [
    ['visibleDiagonalStitches', sourceMetrics.visibleDiagonalStitches, finalMetrics.visibleDiagonalStitches, returnedMetrics.visibleDiagonalStitches, returnedMetrics.visibleDiagonalStitches === 0],
    ['emptyBlocks', sourceMetrics.emptyBlocks, finalMetrics.emptyBlocks, returnedMetrics.emptyBlocks, returnedMetrics.emptyBlocks === 0],
    ['invalidCommandSequence', sourceMetrics.invalidCommandSequence, finalMetrics.invalidCommandSequence, returnedMetrics.invalidCommandSequence, returnedMetrics.invalidCommandSequence === 0],
    ['regionOutsideBounds', sourceMetrics.regionOutsideBounds, finalMetrics.regionOutsideBounds, returnedMetrics.regionOutsideBounds, returnedMetrics.regionOutsideBounds === 0],
    ['stitchCount', sourceMetrics.stitchCount, finalMetrics.stitchCount, returnedMetrics.stitchCount, true],
    ['jumpCount', sourceMetrics.jumpCount, finalMetrics.jumpCount, returnedMetrics.jumpCount, true],
    ['trimCount', sourceMetrics.trimCount, finalMetrics.trimCount, returnedMetrics.trimCount, true],
    ['shortStitches', sourceMetrics.shortStitches, finalMetrics.shortStitches, returnedMetrics.shortStitches, true],
    ['duplicateStitches', sourceMetrics.duplicateStitches, finalMetrics.duplicateStitches, returnedMetrics.duplicateStitches, true],
    ['unsupportedLongStitches', sourceMetrics.unsupportedLongStitches, finalMetrics.unsupportedLongStitches, returnedMetrics.unsupportedLongStitches, true],
    ['missingTieIn', sourceMetrics.missingTieIn, finalMetrics.missingTieIn, returnedMetrics.missingTieIn, true],
    ['missingTieOff', sourceMetrics.missingTieOff, finalMetrics.missingTieOff, returnedMetrics.missingTieOff, true],
    ['colorCount', sourceMetrics.colorCount, finalMetrics.colorCount, returnedMetrics.colorCount, true],
    ['ce01Score', sourceMetrics.ce01Score, finalMetrics.ce01Score, returnedMetrics.ce01Score, true],
    ['ce01Status', sourceMetrics.ce01Status, finalMetrics.ce01Status, returnedMetrics.ce01Status, returnedMetrics.ce01Status !== 'INVALID'],
    ['exportAllowed', sourceMetrics.exportAllowed, finalMetrics.exportAllowed, exportAllowed, exportAllowed],
  ];
  for (const [k, s, f, r, ok] of rows) {
    md.push(`| ${k} | ${fmt(s)} | ${fmt(f)} | ${fmt(r)} | ${ok ? '✅' : '❌'} |`);
  }
  md.push('');

  // 5. Fases transaccionales
  md.push('## 5. Fases (transaccional)\n');
  md.push('| Fase | blockingFix | Resultado | Antes | Después | Motivo |');
  md.push('|---|---|---|---|---|---|');
  for (const p of phaseLog) {
    const status = p.accepted ? '✅ Aceptada' : '⛔ Revertida';
    const target = phaseTarget(p.name);
    let antes = '—', despues = '—';
    if (target) {
      antes = target === 'missingTie' ? (p.before.missingTieIn + p.before.missingTieOff) : p.before[target];
      despues = target === 'missingTie' ? (p.after.missingTieIn + p.after.missingTieOff) : p.after[target];
    }
    const bf = p.blockingFixPriority ? '✓' : '';
    const motivo = p.reason || (p.accepted ? 'mejora/mantuvo' : '—');
    md.push(`| ${p.name} | ${bf} | ${status} | ${fmt(antes)} | ${fmt(despues)} | ${motivo} |`);
  }
  md.push('');

  // 6. Criterios de éxito
  md.push('## 6. Criterios de éxito\n');
  const crit = [
    ['visibleDiagonalStitches returned = 0', returnedMetrics.visibleDiagonalStitches === 0],
    ['emptyBlocks returned = 0', returnedMetrics.emptyBlocks === 0],
    ['commandSourceUsedForExport = repaired', exportDecisionSource === 'repaired'],
    ['exportAllowed = true', exportAllowed],
    ['CE01 status ≠ INVALID (RISKY o SAFE)', returnedMetrics.ce01Status !== 'INVALID'],
    ['DST/DSB exportan repairedCommands', exportDecisionSource === 'repaired'],
    ['invalidCommandSequence = 0', returnedMetrics.invalidCommandSequence === 0],
    ['regionOutsideBounds = 0', returnedMetrics.regionOutsideBounds === 0],
  ];
  for (const [k, ok] of crit) md.push(`- ${ok ? '✅' : '❌'} ${k}`);
  md.push('');

  // 7. Errores bloqueantes restantes
  md.push('## 7. Errores bloqueantes restantes (sobre commandSourceUsedForExport)\n');
  if (!remainingBlockingIssues || remainingBlockingIssues.length === 0) {
    md.push('- Ninguno.\n');
  } else {
    for (const e of remainingBlockingIssues) md.push(`- **${e.type}** ×${e.count}: ${e.proposedAction}`);
    md.push('');
  }

  // 8. Forensics de diagonales visibles
  md.push('## 8. Visible diagonal forensics (detector único)\n');
  const vd = visibleDiagDetection || { count: 0, offenders: [], preservedTatamiDiagonal: 0, preservedContourWithMask: 0 };
  md.push(`- detected (sobre comandos devueltos): **${vd.count}**`);
  md.push(`- preservedTatamiDiagonal: ${vd.preservedTatamiDiagonal || 0}`);
  md.push(`- preservedContourWithMask: ${vd.preservedContourWithMask || 0}\n`);
  if (vd.offenders && vd.offenders.length) {
    md.push('### Primeros 20 offenders\n');
    md.push('| # | cmdIdx | lenMm | angle° | color | stitchType | region | reason | action |');
    md.push('|---|---|---|---|---|---|---|---|---|');
    vd.offenders.slice(0, 20).forEach((o, k) => {
      md.push(`| ${k + 1} | ${o.commandIndex} | ${o.lengthMm.toFixed(2)} | ${o.angleDeg.toFixed(0)} | ${o.color || '—'} | ${o.stitchType || '—'} | ${o.regionName || '—'} | ${o.reason} | ${o.recommendedAction} |`);
    });
    md.push('');
  }

  // 9. Detalle por fase
  md.push('## 9. Detalle por fase\n');
  for (const p of phaseLog) {
    const flags = [];
    if (p.acceptedDespiteScoreDrop) flags.push('aceptada a pesar de bajar ce01Score');
    if (p.acceptedDespiteLongStIncrease) flags.push('aceptada a pesar de subir longSt');
    md.push(`### ${p.name} — ${p.accepted ? '✅ Aceptada' : '⛔ Revertida'}${flags.length ? ' (' + flags.join(', ') + ')' : ''}`);
    if (p.reason) md.push(`- Motivo: ${p.reason}`);
    const s = p.stepReport || {};
    const keys = Object.keys(s).filter(k => !k.startsWith('_'));
    if (keys.length) {
      md.push('- Contadores:');
      for (const k of keys) md.push(`  - ${k} = ${s[k]}`);
    }
    md.push(`- Antes: emptyBlocks=${p.before.emptyBlocks} visibleDiag=${p.before.visibleDiagonalStitches} shortSt=${p.before.shortStitches} dups=${p.before.duplicateStitches} longSt=${p.before.unsupportedLongStitches} tieIn=${p.before.missingTieIn} tieOff=${p.before.missingTieOff} stitches=${p.before.stitchCount} ce01=${p.before.ce01Score} (${p.before.ce01Status})`);
    md.push(`- Después: emptyBlocks=${p.after.emptyBlocks} visibleDiag=${p.after.visibleDiagonalStitches} shortSt=${p.after.shortStitches} dups=${p.after.duplicateStitches} longSt=${p.after.unsupportedLongStitches} tieIn=${p.after.missingTieIn} tieOff=${p.after.missingTieOff} stitches=${p.after.stitchCount} ce01=${p.after.ce01Score} (${p.after.ce01Status})`);
    md.push('');
  }

  // 10. EMPTY_BLOCK_FORENSICS (inline)
  md.push('## 10. Empty block forensics\n');
  if (returnedMetrics.emptyBlocks === 0) {
    md.push('- Sin bloques vacíos restantes.\n');
  } else {
    md.push(`- Bloques vacíos restantes: **${returnedMetrics.emptyBlocks}**`);
    md.push('- Ver EMPTY_BLOCK_FORENSICS.md (descargable) para detalle completo por bloque.\n');
    md.push('```markdown');
    md.push(emptyBlockForensics || '(no generado)');
    md.push('```\n');
  }

  md.push('---');
  md.push('_Pre-export repair v5.1 — removeEmptyBlocks robusto + mejora parcial + addTieInTieOff final. RISKY permite export, INVALID bloquea. DST/DSB usan repairedCommands._');

  return md.join('\n');
}

function phaseTarget(name) {
  const m = {
    removeEmptyBlocks: 'emptyBlocks',
    removeEmptyBlocksFinal: 'emptyBlocks',
    repairVisibleDiagonalStitches: 'visibleDiagonalStitches',
    removeDuplicateStitches: 'duplicateStitches',
    addTieInTieOff: 'missingTie',
  };
  return m[name] || null;
}

function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}