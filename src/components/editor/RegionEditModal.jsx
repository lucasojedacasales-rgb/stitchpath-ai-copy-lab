import { useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import StitchPresetManager from './StitchPresetManager';

function Slider({ label, value, min, max, step, onChange, unit = '' }) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <label className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</label>
        <span className="text-[11px] text-violet-400 font-bold">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-violet-600" />
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      <button onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-violet-600' : 'bg-[#2a2d3a]'}`}>
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#1e2130] last:border-0">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-2.5 text-left">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{title}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-600" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
      </button>
      {open && <div className="pb-3 space-y-3">{children}</div>}
    </div>
  );
}

const PRIORITY_LABELS = ['', 'Detalle final', 'Pequeño', 'Mediano', 'Grande', 'Base (primero)'];

export default function RegionEditModal({ region, onSave, onClose }) {
  const [r, setR] = useState({ ...region });
  const set = (k, v) => setR(prev => ({ ...prev, [k]: v }));
  const setThread = (k, v) => setR(prev => ({ ...prev, thread: { ...(prev.thread || {}), [k]: v } }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#161a23] border border-[#2a2d3a] rounded-xl w-[340px] max-h-[92vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2130]">
          <div>
            <h3 className="text-sm font-bold text-white">Editar Región</h3>
            <p className="text-[11px] text-slate-500 truncate max-w-[220px]">{r.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#2a2d3a] text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 space-y-0">

          {/* ── Identidad ── */}
          <Section title="Identidad">
            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre</label>
              <input value={r.name || ''} onChange={e => set('name', e.target.value)}
                className="w-full bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 block">Color de hilo</label>
              <div className="flex items-center gap-3">
                <input type="color" value={r.color || '#ffffff'} onChange={e => set('color', e.target.value)}
                  className="w-10 h-10 rounded-lg border-2 border-[#2a2d3a] bg-transparent cursor-pointer" />
                <input type="text" value={r.color || ''} onChange={e => set('color', e.target.value)}
                  className="flex-1 bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-violet-500" />
              </div>
            </div>
          </Section>

          {/* ── Puntada ── */}
          <Section title="Puntada">
            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 block">Tipo</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[['fill', 'Fill'], ['satin', 'Satén'], ['running_stitch', 'Running']].map(([val, label]) => (
                  <button key={val} onClick={() => set('stitch_type', val)}
                    className={`py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                      r.stitch_type === val
                        ? val === 'fill' ? 'badge-fill border-violet-500' : val === 'satin' ? 'badge-satin border-cyan-500' : 'badge-run border-slate-500'
                        : 'bg-[#0d0f14] border-[#2a2d3a] text-slate-500 hover:text-slate-300'
                    }`}>{label}</button>
                ))}
              </div>
            </div>
            <Slider label="Densidad" value={r.density || 0.8} min={0.3} max={2.0} step={0.1} onChange={v => set('density', v)} />
            <Slider label="Ángulo" value={r.angle || 0} min={0} max={180} step={1} onChange={v => set('angle', v)} unit="°" />
            <Slider label="Pull Compensation" value={r.pull_compensation || 0.3} min={0} max={2} step={0.1} onChange={v => set('pull_compensation', v)} unit="mm" />
            <Toggle label="Underlay" value={!!r.underlay} onChange={v => set('underlay', v)} />
          </Section>

          {/* ── Planificación ── */}
          <Section title="Planificación" defaultOpen={false}>
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-[11px] text-slate-500 uppercase tracking-wider">Prioridad</label>
                <span className="text-[11px] text-amber-400 font-bold">{PRIORITY_LABELS[r.priority || 1]}</span>
              </div>
              <input type="range" min={1} max={5} step={1} value={r.priority || 1}
                onChange={e => set('priority', Number(e.target.value))}
                className="w-full accent-amber-500" />
              <div className="flex justify-between text-[9px] text-slate-700 mt-0.5">
                <span>1 — Último</span><span>5 — Primero</span>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 block">Orden de capa</label>
              <input type="number" min={1} max={20} value={r.layer_order || 1}
                onChange={e => set('layer_order', Number(e.target.value))}
                className="w-full bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
            </div>
          </Section>

          {/* ── Hilo ── */}
          <Section title="Hilo asignado" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">Marca</label>
                <select value={r.thread?.brand || ''} onChange={e => setThread('brand', e.target.value)}
                  className="w-full bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500">
                  <option value="">—</option>
                  {['Brother', 'Madeira', 'Janome', 'Sulky', 'Robison-Anton', 'Isacord'].map(b => (
                    <option key={b} value={b.toLowerCase()}>{b}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">Código</label>
                <input value={r.thread?.code || ''} onChange={e => setThread('code', e.target.value)} placeholder="e.g. 1800"
                  className="w-full bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-violet-500" />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Nombre del hilo</label>
              <input value={r.thread?.name || ''} onChange={e => setThread('name', e.target.value)} placeholder="e.g. Black"
                className="w-full bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
            </div>
          </Section>

          {/* ── Presets ── */}
          <Section title="Presets" defaultOpen={false}>
            <StitchPresetManager compact onApply={params => setR(prev => ({ ...prev, ...params }))} />
          </Section>
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#2a2d3a] text-slate-400 text-xs hover:text-white transition-colors">Cancelar</button>
          <button onClick={() => onSave(r)} className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors">Guardar</button>
        </div>
      </div>
    </div>
  );
}