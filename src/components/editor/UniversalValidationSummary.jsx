export default function UniversalValidationSummary({ architecture }) {
  const active = architecture?.active;
  if (!active) return null;
  const color = active.status === 'INVALID' ? 'text-red-300 border-red-500/30 bg-red-900/15' : active.status === 'RISKY' ? 'text-amber-300 border-amber-500/30 bg-amber-900/15' : active.status === 'WARNING' ? 'text-cyan-300 border-cyan-500/30 bg-cyan-900/15' : 'text-emerald-300 border-emerald-500/30 bg-emerald-900/15';
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold">Validación {architecture.validationMode}: {active.status}</div>
          <div className="text-[10px] opacity-80">{active.validator}</div>
        </div>
        <div className="text-[10px] font-bold">Export {active.exportAllowed ? 'permitido' : 'bloqueado'}</div>
      </div>
      {active.errors?.length > 0 && <div className="mt-2 text-[10px]">Invalid: {active.errors.slice(0, 2).map(e => e.message).join(' · ')}</div>}
      {active.warnings?.length > 0 && <div className="mt-2 text-[10px] opacity-80">Warnings: {active.warnings.length}</div>}
    </div>
  );
}