import { useState } from 'react';
import { Sliders, ChevronDown, ChevronRight, Zap } from 'lucide-react';

export const DEFAULT_PREPROCESS = {
  enabled: true,
  gaussianRadius: 1,
  contrastBoost: 1.5,
  saturationBoost: 1.8,
  sharpenEdges: true,
  sharpenStrength: 0.9,
  outputSize: 1024,
  posterizeColors: true,
  posterizeLevels: 6,
  morphologyCleanup: true,
};

function SliderRow({ label, value, min, max, step, onChange, format }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-slate-400">{label}</span>
        <span className="text-[11px] font-bold text-violet-300">{format ? format(value) : value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-violet-600"
      />
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[11px] text-slate-400">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-violet-600' : 'bg-[#2a2d3a]'}`}
      >
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  );
}

export default function PreprocessingPanel({ settings, onChange }) {
  const [open, setOpen] = useState(true);
  const s = settings || DEFAULT_PREPROCESS;
  const set = (key, val) => onChange({ ...s, [key]: val });

  return (
    <div className="border-b border-[#1e2130]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1e2130]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Pre-procesado</span>
          {s.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-600/20 text-cyan-300 border border-cyan-500/30">ON</span>
          )}
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-0.5">
          <Toggle label="Activar pre-procesado" value={s.enabled} onChange={v => set('enabled', v)} />

          {s.enabled && (
            <>
              <div className="pt-1 pb-0.5">
                <span className="text-[10px] text-slate-600 uppercase tracking-widest">Ruido</span>
              </div>
              <SliderRow
                label="Suavizado (radio blur)"
                value={s.gaussianRadius} min={0} max={3} step={0.5}
                onChange={v => set('gaussianRadius', v)}
                format={v => v === 0 ? 'off' : `r=${v}`}
              />

              <div className="pt-1 pb-0.5">
                <span className="text-[10px] text-slate-600 uppercase tracking-widest">Color</span>
              </div>
              <SliderRow
                label="Contraste"
                value={s.contrastBoost} min={1.0} max={2.5} step={0.1}
                onChange={v => set('contrastBoost', v)}
                format={v => `×${v.toFixed(1)}`}
              />
              <SliderRow
                label="Saturación"
                value={s.saturationBoost} min={1.0} max={3.0} step={0.1}
                onChange={v => set('saturationBoost', v)}
                format={v => `×${v.toFixed(1)}`}
              />

              <div className="pt-1 pb-0.5">
                <span className="text-[10px] text-slate-600 uppercase tracking-widest">Vectorización</span>
              </div>
              <Toggle label="Posterizar colores (límites nítidos)" value={s.posterizeColors !== false} onChange={v => set('posterizeColors', v)} />
              {s.posterizeColors !== false && (
                <SliderRow
                  label="Niveles de color"
                  value={s.posterizeLevels || 6} min={3} max={12} step={1}
                  onChange={v => set('posterizeLevels', v)}
                  format={v => `${v} niveles`}
                />
              )}
              <Toggle label="Limpieza morfológica (filtro mediana)" value={s.morphologyCleanup !== false} onChange={v => set('morphologyCleanup', v)} />

              <div className="pt-1 pb-0.5">
                <span className="text-[10px] text-slate-600 uppercase tracking-widest">Bordes</span>
              </div>
              <Toggle label="Sharpen bordes (unsharp mask)" value={s.sharpenEdges} onChange={v => set('sharpenEdges', v)} />
              {s.sharpenEdges && (
                <SliderRow
                  label="Intensidad sharpen"
                  value={s.sharpenStrength} min={0.1} max={2.0} step={0.1}
                  onChange={v => set('sharpenStrength', v)}
                  format={v => v.toFixed(1)}
                />
              )}

              <div className="pt-1 pb-0.5">
                <span className="text-[10px] text-slate-600 uppercase tracking-widest">Resolución</span>
              </div>
              <div className="py-1.5">
                <label className="text-[11px] text-slate-400 mb-1 block">Tamaño máximo (px)</label>
                <div className="flex gap-1">
                  {[512, 1024, 2048].map(size => (
                    <button
                      key={size}
                      onClick={() => set('outputSize', size)}
                      className={`flex-1 py-1 rounded text-[10px] font-semibold border transition-colors ${
                        s.outputSize === size
                          ? 'border-violet-500/60 bg-violet-900/20 text-violet-300'
                          : 'border-[#2a2d3a] text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-2 p-2 rounded-lg bg-cyan-900/10 border border-cyan-500/20 text-[10px] text-cyan-400 leading-relaxed">
                <Zap className="w-3 h-3 inline mr-1" />
                El pre-procesado mejora la detección de bordes y clustering de colores antes de enviar al motor IA.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}