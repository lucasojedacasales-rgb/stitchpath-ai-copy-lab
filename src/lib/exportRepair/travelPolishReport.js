/**
 * travelPolishReport.js — EXPORT_TRAVEL_POLISH_REPORT_V1.md (FASE 7)
 * ─────────────────────────────────────────────────────────────────────────────
 * Informe de la capa Travel Polish V1 (post-V5). Compara base (repairedCommands
 * V5, post-Polish) vs travelPolished, muestra invariants V5, fases y métricas.
 */

export function generateTravelPolishReport(ctx) {
  const {
    baseMetrics, returnedMetrics, travelPolishComparison, travelPolishAccepted,
    travelPolishPhaseLog, forensics,
  } = ctx;
  const md = [];

  md.push('# EXPORT_TRAVEL_POLISH_REPORT_V1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Capa post-V5 reduce jumps/trims. Reversible: si rompe un invariante V5, no mejora jumps/trims, o score baja >3, revierte al checkpoint V5.');
  md.push('> Invariantes V5 protegidos: visibleDiag=0, emptyBlocks=0, invalidCmd=0, outOfBounds=0, CE01≠INVALID.\n');

  // 1. Verdict
  md.push('## 1. Veredicto\n');
  md.push(`- travelPolishAccepted: **${travelPolishAccepted ? 'SÍ' : 'NO'}**`);
  md.push(`- base ce01Status: **${baseMetrics.ce01Status}** (score ${baseMetrics.ce01Score})`);
  md.push(`- returned ce01Status: **${returnedMetrics.ce01Status}** (score ${returnedMetrics.ce01Score})`);
  md.push(`- exportAllowed: **${returnedMetrics.exportAllowed ? 'SÍ' : 'NO'}**`);
  md.push('');

  // 2. V5 invariants
  md.push('## 2. Invariants V5 (sobre returned)\n');
  const invariants = [
    ['visibleDiagonalStitches', returnedMetrics.visibleDiagonalStitches, 0],
    ['emptyBlocks', returnedMetrics.emptyBlocks, 0],
    ['invalidCommandSequence', returnedMetrics.invalidCommandSequence, 0],
    ['regionOutsideBounds', returnedMetrics.regionOutsideBounds, 0],
    ['ce01Status !== INVALID', returnedMetrics.ce01Status !== 'INVALID', true],
    ['exportAllowed', returnedMetrics.exportAllowed, true],
  ];
  md.push('| Invariante | valor | esperado | OK |');
  md.push('|---|---|---|---|');
  for (const [k, v, exp] of invariants) {
    md.push(`| ${k} | ${fmt(v)} | ${fmt(exp)} | ${v === exp ? '✅' : '❌'} |`);
  }
  md.push('');

  // 3. Comparativa
  md.push('## 3. Comparativa base / returned\n');
  md.push('| Métrica | base | returned | Δ |');
  md.push('|---|---|---|---|');
  if (travelPolishComparison) {
    for (const [k, pair] of Object.entries(travelPolishComparison)) {
      if (!pair || typeof pair !== 'object' || !('before' in pair)) continue;
      const delta = (typeof pair.before === 'number' && typeof pair.after === 'number') ? pair.after - pair.before : 0;
      md.push(`| ${k} | ${fmt(pair.before)} | ${fmt(pair.after)} | ${fmtDelta(delta)} |`);
    }
  } else {
    md.push('| — | — | — | — |');
  }
  md.push('');

  // 4. Fases
  md.push('## 4. Fases transaccionales\n');
  md.push('| Fase | resultado | antes | después | motivo |');
  md.push('|---|---|---|---|---|');
  if (travelPolishPhaseLog && travelPolishPhaseLog.length) {
    for (const p of travelPolishPhaseLog) {
      const status = p.accepted ? '✅ Aceptada' : '⛔ Revertida';
      md.push(`| ${p.name} | ${status} | ${fmt(p.before?.jumpCount ?? '—')}/${fmt(p.before?.trimCount ?? '—')} | ${fmt(p.after?.jumpCount ?? '—')}/${fmt(p.after?.trimCount ?? '—')} | ${p.reason || (p.accepted ? 'mejora/mantuvo' : '—')} |`);
    }
  } else {
    md.push('| — | — | — | — | sin fases ejecutadas |');
  }
  md.push('');

  // 5. Forensics summary
  md.push('## 5. Forensics (pre-polish)\n');
  md.push(`- total jumps (base): **${baseMetrics.jumpCount}**`);
  md.push(`- total trims (base): **${baseMetrics.trimCount}**`);
  md.push('- Ver TRAVEL_POLISH_FORENSICS.md para detalle por color y top 50 travels.');
  md.push('');

  md.push('---');
  md.push('_Travel Polish V1 — capa post-V5 reversible. Invariants V5 protegidos._');
  return md.join('\n');
}

function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function fmtDelta(d) {
  if (typeof d !== 'number') return '—';
  const s = Number.isInteger(d) ? String(d) : d.toFixed(2);
  return d > 0 ? `+${s}` : s;
}