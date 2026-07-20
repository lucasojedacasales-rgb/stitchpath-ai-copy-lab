/**
 * LearnedConfigDiffPanel.jsx — StitchPath AI
 * Muestra en pantalla cómo cambia la configuración del motor según lo que el
 * sistema aprendió del corpus de referencias profesionales. Cada parámetro se
 * muestra "antes → después" con resaltado en los que cambiaron.
 */
import { Sparkles, ArrowRight, Info } from 'lucide-react';

export default function LearnedConfigDiffPanel({ diff, profileName, confidence, onDismiss }) {
  if (!diff || diff.length === 0) return null;
  const changed = diff.filter(d => d.changed);
  const unchanged = diff.filter(d => !d.changed);

  return (
    <div className="bg-[#161a23] border border-violet-500/30 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white">Config aplicada del aprendizaje</h3>
        </div>
        {profileName && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">Perfil:</span>
            <span className="text-[11px] font-bold text-violet-300">{profileName}</span>
            {confidence != null && (
              <span className="text-[10px] text-cyan-400">{(confidence * 100).toFixed(0)}%</span>
            )}
          </div>
        )}
      </div>

      {changed.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-emerald-400 flex items-center gap-1">
            <Info className="w-3 h-3" /> {changed.length} parámetros ajustados por el corpus
          </div>
          <div className="space-y-1">
            {changed.map(d => (
              <div key={d.key} className="flex items-center gap-2 bg-[#0d0f14] border border-emerald-500/20 rounded px-2 py-1.5">
                <span className="text-[11px] text-slate-300 flex-1 truncate">{d.label}</span>
                <span className="text-[11px] text-slate-500 font-mono">{d.isBool ? (d.before ? 'sí' : 'no') : fmtVal(d.before, d)}</span>
                <ArrowRight className="w-3 h-3 text-emerald-400" />
                <span className="text-[11px] text-emerald-400 font-mono font-bold">{d.isBool ? (d.after ? 'sí' : 'no') : fmtVal(d.after, d)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {unchanged.length > 0 && (
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer hover:text-slate-300">{unchanged.length} parámetros sin cambios</summary>
          <div className="space-y-1 mt-1">
            {unchanged.map(d => (
              <div key={d.key} className="flex items-center gap-2 px-2 py-1">
                <span className="text-[11px] text-slate-400 flex-1 truncate">{d.label}</span>
                <span className="text-[11px] text-slate-600 font-mono">{d.isBool ? (d.after ? 'sí' : 'no') : fmtVal(d.after, d)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {onDismiss && (
        <button onClick={onDismiss} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
          ✕ Cerrar
        </button>
      )}
    </div>
  );
}

function fmtVal(v, d) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(d.precision)}${d.unit}` : String(v);
}