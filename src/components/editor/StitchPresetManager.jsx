import { useState } from 'react';
import { Plus, Trash2, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useEmbroideryPresets } from '@/hooks/useEmbroideryPresets';

export default function StitchPresetManager({ onApply, compact = false }) {
  const { allPresets, loading, createPreset, deletePreset } = useEmbroideryPresets();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', icon: '⚙', notes: '', stitch_type: 'fill', density: 0.8, angle: 45, pull_compensation: 0.3, underlay: true });

  const handleSave = async () => {
    if (!form.name.trim()) return;
    await createPreset(form);
    setShowForm(false);
    setForm({ name: '', icon: '⚙', notes: '', stitch_type: 'fill', density: 0.8, angle: 45, pull_compensation: 0.3, underlay: true });
  };

  if (loading) return <div className="text-[11px] text-slate-600 py-2">Cargando...</div>;

  return (
    <div className="space-y-2">
      {allPresets.map(preset => (
        <div key={preset.id} className="flex items-center gap-2 p-2 rounded-lg bg-[#0d0f14] border border-[#1e2130] hover:border-[#2a2d3a] transition-colors">
          <span className="text-base flex-shrink-0">{preset.icon || '⚙'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white font-medium truncate">{preset.name}</span>
              {preset.is_system && <span className="text-[9px] px-1 py-0.5 rounded bg-violet-900/40 text-violet-400 border border-violet-500/20">Sistema</span>}
            </div>
            {!compact && preset.notes && <p className="text-[10px] text-slate-600 truncate">{preset.notes}</p>}
            <p className="text-[10px] text-slate-500">{preset.stitch_type} • {preset.density}d/{preset.angle}°</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onApply && (
              <button
                onClick={() => onApply({ stitch_type: preset.stitch_type, density: preset.density, angle: preset.angle, pull_compensation: preset.pull_compensation, underlay: preset.underlay })}
                className="p-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/40 text-violet-400 hover:text-violet-300 transition-colors"
                title="Aplicar preset"
              >
                <Check className="w-3 h-3" />
              </button>
            )}
            {!preset.is_system && (
              <button
                onClick={() => deletePreset(preset.id)}
                className="p-1.5 rounded-lg hover:bg-red-900/20 text-slate-600 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      ))}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-[#2a2d3a] text-slate-500 hover:text-violet-400 hover:border-violet-500/40 transition-colors text-xs"
        >
          <Plus className="w-3 h-3" /> Guardar estado actual
        </button>
      ) : (
        <div className="p-3 rounded-lg bg-[#0d0f14] border border-violet-500/30 space-y-2">
          <div className="flex gap-2">
            <input
              type="text" placeholder="Emoji" value={form.icon}
              onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
              className="w-12 bg-[#161a23] border border-[#2a2d3a] rounded px-2 py-1.5 text-xs text-center focus:outline-none focus:border-violet-500"
            />
            <input
              type="text" placeholder="Nombre del preset" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="flex-1 bg-[#161a23] border border-[#2a2d3a] rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
            />
          </div>
          <input
            type="text" placeholder="Notas (opcional)" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full bg-[#161a23] border border-[#2a2d3a] rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
          />
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex-1 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors">Guardar</button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 rounded border border-[#2a2d3a] text-slate-500 text-xs hover:text-white transition-colors">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}