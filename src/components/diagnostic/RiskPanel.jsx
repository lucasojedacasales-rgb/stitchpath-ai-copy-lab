import React from 'react';
import { ShieldAlert, AlertTriangle, AlertOctagon, CheckCircle2 } from 'lucide-react';

const LEVEL_META = {
  high: { icon: AlertOctagon, color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-500/40' },
  medium: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-900/20', border: 'border-amber-500/40' },
  low: { icon: AlertTriangle, color: 'text-sky-400', bg: 'bg-sky-900/20', border: 'border-sky-500/40' },
};

export default function RiskPanel({ risks }) {
  const list = risks || [];
  const high = list.filter((r) => r.level === 'high').length;
  const med = list.filter((r) => r.level === 'medium').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-900/30 border border-red-500/40">
          <ShieldAlert className="h-4 w-4 text-red-300" />
        </div>
        <div className="text-xs font-bold text-white">Riesgos detectados</div>
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          {high > 0 && <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-red-300">{high} alto</span>}
          {med > 0 && <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-amber-300">{med} medio</span>}
          {list.length === 0 && <span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-emerald-300">sin riesgos</span>}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-900/10 p-3 text-[11px] text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> No se detectaron riesgos diagnósticos.
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((r, i) => {
            const m = LEVEL_META[r.level] || LEVEL_META.medium;
            const Icon = m.icon;
            return (
              <div key={i} className={`rounded-lg border ${m.border} ${m.bg} p-2.5`}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 ${m.color}`} />
                  <span className="font-mono text-[10px] text-slate-400">{r.code}</span>
                  <span className="ml-auto rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-bold text-slate-200">{r.count}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-200">{r.message}</div>
                {r.sample && (
                  <div className="mt-1 text-[10px] text-slate-500 font-mono">
                    {r.sample.from ? `@${r.sample.idx}: (${r.sample.from.x.toFixed(2)},${r.sample.from.y.toFixed(2)}) → (${r.sample.to?.x?.toFixed?.(2)},${r.sample.to?.y?.toFixed?.(2)})` : `(${r.sample.x?.toFixed?.(2)}, ${r.sample.y?.toFixed?.(2)})`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[10px] text-slate-600">
        Detección diagnóstica de solo lectura. Ningún archivo es modificado.
      </div>
    </div>
  );
}