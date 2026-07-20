/**
 * exportPolishReport.js — EXPORT_POLISH_REPORT_V1.md
 * ─────────────────────────────────────────────────────────────────────────────
 * Informe del polish post-V5 (solo warnings). Before = repairedCommands V5,
 * After = polishedCommands (o base si el polish se revirtió).
 */
export function generatePolishReport(ctx) {
  const {
    phaseLog, baseMetrics, polishedMetrics, returnedMetrics,
    polishAccepted, polishComparison,
  } = ctx;
  const md = [];

  md.push('# EXPORT_POLISH_REPORT_V1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Polish post-V5: reduce warnings (shortSt, dups, missingTie) sin romper invariantes V5.');
  md.push('> Before = repairedCommands V5 · After = polishedCommands (o base si se revirtió).\n');

  // 1. Veredicto
  md.push('## 1. Veredicto\n');
  md.push(`- polishAccepted: **${polishAccepted ? 'SÍ' : 'NO (revertido a base V5)'}**`);
  md.push(`- commandSourceUsedForExport: **repaired** ${polishAccepted ? '(polished)' : '(base V5, sin cambios)'}`);
  md.push(`- CE01 status: **${returnedMetrics.ce01Status}** (base: ${baseMetrics.ce01Status})`);
  md.push(`- CE01 score: **${returnedMetrics.ce01Score}** (base: ${baseMetrics.ce01Score})`);
  md.push(`- exportAllowed: **${returnedMetrics.exportAllowed ? 'SÍ' : 'NO'}**`);
  md.push('');

  // 2. Invariantes V5 (deben mantenerse)
  md.push('## 2. Invariantes V5 (deben mantenerse)\n');
  md.push('| Invariante | base | after | OK |');
  md.push('|---|---|---|---|');
  const inv = [
    ['visibleDiagonalStitches', baseMetrics.visibleDiagonalStitches, returnedMetrics.visibleDiagonalStitches, returnedMetrics.visibleDiagonalStitches === 0],
    ['emptyBlocks', baseMetrics.emptyBlocks, returnedMetrics.emptyBlocks, returnedMetrics.emptyBlocks === 0],
    ['invalidCommandSequence', baseMetrics.invalidCommandSequence, returnedMetrics.invalidCommandSequence, returnedMetrics.invalidCommandSequence === 0],
    ['regionOutsideBounds', baseMetrics.regionOutsideBounds, returnedMetrics.regionOutsideBounds, returnedMetrics.regionOutsideBounds === 0],
    ['ce01Status ≠ INVALID', baseMetrics.ce01Status, returnedMetrics.ce01Status, returnedMetrics.ce01Status !== 'INVALID'],
    ['exportAllowed', baseMetrics.exportAllowed, returnedMetrics.exportAllowed, returnedMetrics.exportAllowed === true],
  ];
  for (const [k, b, a, ok] of inv) md.push(`| ${k} | ${fmt(b)} | ${fmt(a)} | ${ok ? '✅' : '❌'} |`);
  md.push('');

  // 3. Warnings before/after
  md.push('## 3. Warnings before / after\n');
  md.push('| Warning | before | after | Δ | mejoró |');
  md.push('|---|---|---|---|---|');
  const w = [
    ['shortStitches', baseMetrics.shortStitches, returnedMetrics.shortStitches],
    ['duplicateStitches', baseMetrics.duplicateStitches, returnedMetrics.duplicateStitches],
    ['missingTieIn', baseMetrics.missingTieIn, returnedMetrics.missingTieIn],
    ['missingTieOff', baseMetrics.missingTieOff, returnedMetrics.missingTieOff],
    ['unsupportedLongStitches', baseMetrics.unsupportedLongStitches, returnedMetrics.unsupportedLongStitches],
  ];
  for (const [k, b, a] of w) {
    const d = a - b;
    md.push(`| ${k} | ${b} | ${a} | ${d > 0 ? '+' : ''}${d} | ${d < 0 ? '✅' : d === 0 ? '—' : '❌'} |`);
  }
  md.push('');

  // 4. CE01 score delta + status
  md.push('## 4. CE01 score / status\n');
  md.push(`- score: ${baseMetrics.ce01Score} → ${returnedMetrics.ce01Score} (Δ ${returnedMetrics.ce01Score - baseMetrics.ce01Score >= 0 ? '+' : ''}${returnedMetrics.ce01Score - baseMetrics.ce01Score})`);
  md.push(`- status: ${baseMetrics.ce01Status} → ${returnedMetrics.ce01Status}`);
  const reachedSafe = returnedMetrics.ce01Status === 'SAFE';
  md.push(`- ¿Alcanzó SAFE? **${reachedSafe ? 'SÍ ✅' : 'NO (sigue ' + returnedMetrics.ce01Status + ')'}**`);
  if (!reachedSafe) {
    const excessive = returnedMetrics.jumpCount > 250 || returnedMetrics.trimCount > 80;
    md.push(`  - Motivo: ${excessive ? `excessiveTravel (jumps=${returnedMetrics.jumpCount} / trims=${returnedMetrics.trimCount}) fuerza RISKY` : `score ${returnedMetrics.ce01Score} < 80`}`);
  }
  md.push('');

  // 5. Fases polish
  md.push('## 5. Fases polish (transaccional)\n');
  md.push('| Fase | Resultado | target antes | target después | Motivo |');
  md.push('|---|---|---|---|---|');
  for (const p of phaseLog) {
    const target = p.name.includes('Merge') ? 'shortStitches'
      : p.name.includes('Duplicate') ? 'duplicateStitches'
      : 'missingTie';
    let antes = '—', despues = '—';
    if (target === 'missingTie') { antes = p.before.missingTieIn + p.before.missingTieOff; despues = p.after.missingTieIn + p.after.missingTieOff; }
    else { antes = p.before[target]; despues = p.after[target]; }
    md.push(`| ${p.name} | ${p.accepted ? '✅ Aceptada' : '⛔ Revertida'} | ${antes} | ${despues} | ${p.reason || (p.accepted ? 'mejora/mantuvo' : '—')} |`);
  }
  md.push('');

  // 6. Contadores por fase
  md.push('## 6. Contadores por fase\n');
  for (const p of phaseLog) {
    md.push(`### ${p.name} — ${p.accepted ? '✅' : '⛔'}`);
    const s = p.stepReport || {};
    const keys = Object.keys(s);
    if (keys.length) for (const k of keys) md.push(`- ${k} = ${s[k]}`);
    else md.push('- (sin contadores)');
    md.push(`- antes: shortSt=${p.before.shortStitches} dups=${p.before.duplicateStitches} tieIn=${p.before.missingTieIn} tieOff=${p.before.missingTieOff} stitches=${p.before.stitchCount} ce01=${p.before.ce01Score} (${p.before.ce01Status})`);
    md.push(`- después: shortSt=${p.after.shortStitches} dups=${p.after.duplicateStitches} tieIn=${p.after.missingTieIn} tieOff=${p.after.missingTieOff} stitches=${p.after.stitchCount} ce01=${p.after.ce01Score} (${p.after.ce01Status})`);
    md.push('');
  }

  md.push('---');
  md.push('_Polish V1 — solo warnings; invariantes V5 protegidos. Si se rompe cualquiera, se revierte a base V5 (idéntico al checkpoint)._');

  return md.join('\n');
}

function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}