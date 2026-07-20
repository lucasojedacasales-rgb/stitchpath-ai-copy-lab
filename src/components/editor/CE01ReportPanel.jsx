import { ShieldCheck, ShieldAlert, AlertTriangle, Cpu } from 'lucide-react';

/**
 * CE01ReportPanel — Displays the Caydo CE01 pre-export validation report.
 * Shows status, score, export summary, blocking issues, and warnings.
 */
export default function CE01ReportPanel({ report, beforeReport, sanitizeReport }) {
  if (!report) return null;

  const { status, score, blockingIssues, warnings, exportSummary } = report;

  const statusConfig = {
    SAFE:   { icon: ShieldCheck,   color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-500/40', label: 'SEGURO' },
    RISKY:  { icon: AlertTriangle, color: 'text-amber-400',   bg: 'bg-amber-900/20',   border: 'border-amber-500/40',   label: 'RIESGO' },
    INVALID:{ icon: ShieldAlert,   color: 'text-red-400',     bg: 'bg-red-900/20',     border: 'border-red-500/40',     label: 'INVÁLIDO' },
  };
  const cfg = statusConfig[status] || statusConfig.INVALID;
  const StatusIcon = cfg.icon;

  const summaryItems = [
    { label: 'Puntadas', value: exportSummary.stitches?.toLocaleString() || 0 },
    { label: 'Saltos',   value: exportSummary.jumps || 0 },
    { label: 'Trims',    value: exportSummary.trims || 0 },
    { label: 'Colores',  value: exportSummary.colors || 0 },
    { label: 'Tamaño',   value: `${exportSummary.widthMm || 0}×${exportSummary.heightMm || 0}mm` },
    { label: 'Tiempo',   value: `${exportSummary.estimatedTime || 0} min` },
  ];

  return (
    <div className={`rounded-lg border ${cfg.border} ${cfg.bg} p-3 space-y-3`}>
      {/* Header: status + score */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Caydo CE01</span>
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${cfg.bg} border ${cfg.border}`}>
            <StatusIcon className={`w-3 h-3 ${cfg.color}`} />
            <span className={`text-[10px] font-bold ${cfg.color}`}>{cfg.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">Score</span>
          <span className={`text-sm font-bold ${cfg.color}`}>{score}</span>
          <span className="text-[10px] text-slate-600">/100</span>
        </div>
      </div>

      {/* Before/after comparison */}
      {beforeReport && report && (
        <div className="bg-[#0d0f14] rounded-lg p-2 border border-[#1e2130]">
          <div className="text-[9px] font-bold text-slate-500 uppercase mb-1.5">Antes / Después</div>
          <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-[9px]">
            <div className="text-slate-600 uppercase font-bold">Métrica</div>
            <div className="text-slate-600 uppercase font-bold text-center">Antes</div>
            <div className="text-slate-600 uppercase font-bold text-center">Después</div>

            {_compareRow('Score', beforeReport.score, report.score, true)}
            {_compareRow('Cortas <0.8', beforeReport.rawMetrics?.shortStitches, report.rawMetrics?.shortStitches)}
            {_compareRow('Largas >8mm', beforeReport.rawMetrics?.longStitches, report.rawMetrics?.longStitches)}
            {_compareRow('Duplicados', beforeReport.rawMetrics?.duplicates, report.rawMetrics?.duplicates)}
            {_compareRow('Saltos', beforeReport.rawMetrics?.jumps, report.rawMetrics?.jumps)}
          </div>
        </div>
      )}

      {/* Sanitizer report */}
      {sanitizeReport && (
        <div className="bg-[#0d0f14] rounded-lg p-2 border border-[#1e2130]">
          <div className="text-[9px] font-bold text-cyan-400 uppercase mb-1.5">Saneamiento CE01</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
            <div className="text-slate-500">Duplicados eliminados</div>
            <div className="text-slate-300 text-right">{sanitizeReport.removedDuplicates}</div>
            <div className="text-slate-500">Micro-puntadas fusionadas</div>
            <div className="text-slate-300 text-right">{sanitizeReport.mergedMicroStitches}</div>
            <div className="text-slate-500">Puntadas largas divididas</div>
            <div className="text-slate-300 text-right">{sanitizeReport.splitLongStitches}</div>
            <div className="text-slate-500">Saltos reducidos</div>
            <div className="text-slate-300 text-right">{sanitizeReport.jumpsReduced}</div>
            <div className="text-slate-500">Trims insertados</div>
            <div className="text-slate-300 text-right">{sanitizeReport.trimsInserted}</div>
            <div className="text-slate-500">Comandos</div>
            <div className="text-slate-300 text-right">{sanitizeReport.before} → {sanitizeReport.after}</div>
          </div>
        </div>
      )}

      {/* Export summary */}
      <div className="grid grid-cols-6 gap-1.5">
        {summaryItems.map(({ label, value }) => (
          <div key={label} className="bg-[#0d0f14] rounded px-1.5 py-1 text-center border border-[#1e2130]">
            <div className="text-[11px] font-bold text-slate-200 leading-tight">{value}</div>
            <div className="text-[8px] text-slate-600 uppercase">{label}</div>
          </div>
        ))}
      </div>

      {/* Blocking issues */}
      {blockingIssues.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-bold text-red-400 uppercase tracking-wide flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" />
            Bloqueantes ({blockingIssues.length})
          </div>
          {blockingIssues.slice(0, 6).map((issue, i) => (
            <div key={i} className="text-[10px] text-red-300 flex items-start gap-1">
              <span className="font-bold text-red-400 shrink-0">[{issue.check}]</span>
              <span>{issue.message}</span>
            </div>
          ))}
          {blockingIssues.length > 6 && (
            <div className="text-[9px] text-red-400 italic">+{blockingIssues.length - 6} más...</div>
          )}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Advertencias ({warnings.length})
          </div>
          {warnings.slice(0, 5).map((w, i) => (
            <div key={i} className="text-[10px] text-amber-300 flex items-start gap-1">
              <span className="font-bold text-amber-400 shrink-0">[{w.check}]</span>
              <span>{w.message}</span>
            </div>
          ))}
          {warnings.length > 5 && (
            <div className="text-[9px] text-amber-400 italic">+{warnings.length - 5} más...</div>
          )}
        </div>
      )}

      {/* Status message */}
      {status === 'INVALID' && (
        <div className="text-[10px] text-red-300 bg-red-900/15 rounded px-2 py-1.5 border border-red-500/20">
          ⛔ Exportación bloqueada — el diseño no es seguro para la Caydo CE01.
        </div>
      )}
      {status === 'RISKY' && (
        <div className="text-[10px] text-amber-300 bg-amber-900/15 rounded px-2 py-1.5 border border-amber-500/20">
          ⚠ Exportación permitida con advertencia — revisa los riesgos antes de continuar.
        </div>
      )}
      {status === 'SAFE' && (
        <div className="text-[10px] text-emerald-300 bg-emerald-900/15 rounded px-2 py-1.5 border border-emerald-500/20">
          ✓ Diseño seguro para la Caydo CE01 — exportación permitida.
        </div>
      )}
    </div>
  );

  // ── Helper: before/after comparison row ──────────────────────────────────
  function _compareRow(label, beforeVal, afterVal, higherIsBetter = false) {
    const b = beforeVal ?? '—';
    const a = afterVal ?? '—';
    const improved = higherIsBetter
      ? (typeof a === 'number' && typeof b === 'number' && a > b)
      : (typeof a === 'number' && typeof b === 'number' && a < b);
    return (
      <>
        <div className="text-slate-400">{label}</div>
        <div className="text-slate-500 text-center">{b}</div>
        <div className={`text-center font-bold ${improved ? 'text-emerald-400' : 'text-slate-300'}`}>{a}</div>
      </>
    );
  }
}