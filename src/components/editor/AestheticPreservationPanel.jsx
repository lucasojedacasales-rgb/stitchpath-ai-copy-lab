import { Sparkles, Eye, Palette, Check } from 'lucide-react';

/**
 * AestheticPreservationPanel — Toggle for "Preserve aesthetic details" mode
 * and the "Cartoon Clean Outline" preset for Kirby/Yoshi-style characters.
 */
const CARTOON_PRESET = {
  preserveAestheticDetails: true,
  generateOutlines: true,
  contourSafeMode: true,
  color_count: 7,
  mode: 'hybrid',
  tatami_density: 0.4,
};

export default function AestheticPreservationPanel({ config, onChange }) {
  // ── Rollback safety: panel is disabled when experimentalAestheticPreservation is OFF ──
  // When disabled, toggles/presets are inert — they cannot modify regions or config.
  const experimentalEnabled = config.experimentalAestheticPreservation === true;
  const preserveOn = experimentalEnabled && config.preserveAestheticDetails !== false;
  const outlinesOn = experimentalEnabled && config.generateOutlines !== false;

  const togglePreserve = () => {
    if (!experimentalEnabled) return;
    onChange({ ...config, preserveAestheticDetails: !preserveOn });
  };
  const toggleOutlines = () => {
    if (!experimentalEnabled) return;
    onChange({ ...config, generateOutlines: !outlinesOn });
  };

  const applyCartoonPreset = () => {
    if (!experimentalEnabled) return;
    onChange({ ...config, ...CARTOON_PRESET });
    console.log('[detail-preservation] Cartoon Clean Outline preset applied');
  };

  const isCartoonActive =
    preserveOn && outlinesOn &&
    config.color_count === 7 && config.mode === 'hybrid';

  if (!experimentalEnabled) {
    console.log('[rollback-safe] experimentalAestheticPreservation OFF');
  }

  return (
    <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-[11px] font-bold text-violet-300">Preservación Estética</span>
        {!experimentalEnabled && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 ml-auto">DESACTIVADO</span>
        )}
      </div>

      {!experimentalEnabled && (
        <p className="text-[9px] text-slate-600 leading-relaxed">
          Módulos experimentales desactivados (rollback seguro). El pipeline estable está activo.
        </p>
      )}

      {/* Preserve details toggle */}
      <button
        onClick={togglePreserve}
        disabled={!experimentalEnabled}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          preserveOn
            ? 'bg-emerald-900/20 border-emerald-500/40 text-emerald-300'
            : 'bg-[#161a23] border-[#2a2d3a] text-slate-500 hover:text-slate-300'
        }`}
      >
        <Eye className={`w-3.5 h-3.5 ${preserveOn ? 'text-emerald-400' : 'text-slate-600'}`} />
        <span className="flex-1 text-left">Preservar detalles estéticos</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${preserveOn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
          {preserveOn ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* Generate outlines toggle */}
      <button
        onClick={toggleOutlines}
        disabled={!experimentalEnabled}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          outlinesOn
            ? 'bg-cyan-900/20 border-cyan-500/40 text-cyan-300'
            : 'bg-[#161a23] border-[#2a2d3a] text-slate-500 hover:text-slate-300'
        }`}
      >
        <Palette className={`w-3.5 h-3.5 ${outlinesOn ? 'text-cyan-400' : 'text-slate-600'}`} />
        <span className="flex-1 text-left">Generar contornos reales</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${outlinesOn ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-700 text-slate-500'}`}>
          {outlinesOn ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* Cartoon Clean Outline preset */}
      <button
        onClick={applyCartoonPreset}
        disabled={!experimentalEnabled}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          isCartoonActive
            ? 'bg-violet-900/30 border-violet-500/50 text-violet-300'
            : 'bg-[#161a23] border-[#2a2d3a] text-slate-400 hover:text-slate-300 hover:border-violet-500/30'
        }`}
      >
        <Sparkles className={`w-3.5 h-3.5 ${isCartoonActive ? 'text-violet-400' : 'text-slate-500'}`} />
        <span className="flex-1 text-left">Cartoon Clean Outline</span>
        {isCartoonActive && <Check className="w-3 h-3 text-violet-400" />}
      </button>

      {preserveOn && (
        <p className="text-[9px] text-slate-600 leading-relaxed">
          Boca, ojos y contornos se preservan. La simplificación agresiva se reduce para mantener fidelidad visual del personaje.
        </p>
      )}
    </div>
  );
}