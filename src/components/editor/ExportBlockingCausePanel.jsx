import { ShieldAlert, CheckCircle2 } from 'lucide-react';

export default function ExportBlockingCausePanel({ audit }) {
  if (!audit) return null;
  const ok = audit.exportAllowed;
  const Icon = ok ? CheckCircle2 : ShieldAlert;
  return (
    <div className={`rounded-lg border p-3 ${ok ? 'border-emerald-500/30 bg-emerald-900/15' : 'border-red-500/40 bg-red-900/20'}`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${ok ? 'text-emerald-400' : 'text-red-400'}`} />
        <span className={`text-xs font-bold ${ok ? 'text-emerald-300' : 'text-red-300'}`}>{ok ? 'Exportación desbloqueada' : 'Causa real del bloqueo'}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <Cell label="blockingReason" value={audit.blockingReason} ok={ok} />
        <Cell label="blockingModule" value={audit.blockingModule} ok={ok} />
        <Cell label="blockingCheck" value={audit.blockingCheck} ok={ok} />
        <Cell label="firstInvalidCommandIndex" value={audit.firstInvalidCommandIndex ?? '—'} ok={ok} />
      </div>
      <div className={`mt-2 text-[10px] ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>{audit.unlockHint}</div>
    </div>
  );
}

function Cell({ label, value, ok }) {
  return (
    <div className="rounded border border-[#1e2130] bg-[#0d0f14] px-2 py-1">
      <div className="text-slate-500">{label}</div>
      <div className={`font-bold ${ok ? 'text-emerald-300' : 'text-red-300'}`}>{String(value)}</div>
    </div>
  );
}