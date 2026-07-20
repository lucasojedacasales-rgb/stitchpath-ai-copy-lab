export function InlineTechnicalLoading({ label = 'Cargando análisis…' }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-900/10 px-3 py-2 text-[11px] text-violet-200" role="status" aria-live="polite">
      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
      {label}
    </div>
  );
}

export default function TechnicalToolLoading({ label = 'Cargando herramienta…', overlay = false }) {
  const content = (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 bg-[#0d0f14] text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      <div>
        <p className="text-sm font-semibold text-slate-200">{label}</p>
        <p className="mt-1 text-[11px] text-slate-500">Preparando controles y visualización</p>
      </div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-[#1e2130]">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-violet-600" />
      </div>
    </div>
  );

  if (!overlay) return content;
  return <div className="fixed inset-0 z-50 bg-[#0d0f14]">{content}</div>;
}