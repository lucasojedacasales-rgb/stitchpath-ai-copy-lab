import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

export default function TechnicalToolStatus({ name, state, onRetry, onClose }) {
  if (!state || state.status === 'idle') return null;
  const loading = state.status === 'loading';
  const error = state.status === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${error ? 'border-red-500/30 bg-red-900/10 text-red-200' : 'border-violet-500/20 bg-violet-900/10 text-violet-200'}`} role={error ? 'alert' : 'status'} aria-live="polite">
      {loading ? <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin" /> : error ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-300" />}
      <div className="min-w-0 flex-1">
        <div className="font-bold">{loading ? `Cargando ${name}…` : error ? `No se pudo cargar ${name}.` : `${name} lista.`}</div>
        {state.slow && <div className="mt-0.5 text-amber-300">La herramienta está tardando más de lo esperado.</div>}
        {error && <div className="mt-0.5 text-red-300/80">Puedes reintentar sin recargar la página.</div>}
      </div>
      {error && <button onClick={onRetry} className="rounded border border-red-400/30 px-2 py-1 font-bold hover:bg-red-900/30">Reintentar</button>}
      <button onClick={onClose} className="rounded p-1 hover:bg-slate-800" aria-label={`Cerrar ${name}`}><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}