import { Brush, Wand2, FlipHorizontal2, Eye, EyeOff, RotateCcw, Check } from 'lucide-react';

export default function MaskToolbar({
  activeTool, onToolChange,
  brushSize, onBrushSizeChange,
  brushMode, onBrushModeChange,
  wandTolerance, onWandToleranceChange,
  showMaskOverlay, onToggleMaskOverlay,
  showOriginal, onToggleOriginal,
  onInvertMask,
  onClearMask,
  onApplyMask,
  maskedPixelCount,
}) {
  const tools = [
    { id: 'brush', icon: Brush, label: 'Pincel' },
    { id: 'wand', icon: Wand2, label: 'Varita' },
  ];

  return (
    <div className="flex flex-col gap-3 p-3 bg-[#0a0c12] border-b border-[#1e2130]">
      {/* Tool selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold w-14">Herramienta</span>
        <div className="flex gap-1">
          {tools.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => onToolChange(id)}
              title={label}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                activeTool === id
                  ? 'border-violet-500/60 bg-violet-900/30 text-violet-300'
                  : 'border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:text-white hover:border-[#3a3d4a]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Invert + Clear */}
        <div className="flex gap-1 ml-auto">
          <button
            onClick={onInvertMask}
            title="Invertir selección"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:text-amber-300 hover:border-amber-500/50 text-xs transition-colors"
          >
            <FlipHorizontal2 className="w-3.5 h-3.5" />
            Invertir
          </button>
          <button
            onClick={onClearMask}
            title="Limpiar máscara"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:text-red-400 hover:border-red-500/50 text-xs transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Limpiar
          </button>
          {maskedPixelCount > 0 && (
            <button
              onClick={onApplyMask}
              title="Aplicar máscara"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Aplicar
            </button>
          )}
        </div>
      </div>

      {/* Tool-specific controls */}
      <div className="flex items-center gap-4 flex-wrap">
        {activeTool === 'brush' && (
          <>
            {/* Brush mode */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-500">Modo</span>
              {[['erase', 'Borrar', 'text-red-400'], ['restore', 'Restaurar', 'text-emerald-400']].map(([mode, label, color]) => (
                <button
                  key={mode}
                  onClick={() => onBrushModeChange(mode)}
                  className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${
                    brushMode === mode
                      ? `border-current bg-current/10 ${color}`
                      : 'border-[#2a2d3a] text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Brush size */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500">Tamaño</span>
              <input
                type="range" min="5" max="100" value={brushSize}
                onChange={e => onBrushSizeChange(Number(e.target.value))}
                className="w-20 accent-violet-600"
              />
              <span className="text-[10px] font-bold text-violet-400 w-8">{brushSize}px</span>
            </div>
          </>
        )}

        {activeTool === 'wand' && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">Tolerancia</span>
            <input
              type="range" min="0" max="50" value={wandTolerance}
              onChange={e => onWandToleranceChange(Number(e.target.value))}
              className="w-24 accent-violet-600"
            />
            <span className="text-[10px] font-bold text-cyan-400 w-8">{wandTolerance}%</span>
          </div>
        )}

        {/* Preview toggles */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={onToggleMaskOverlay}
            title="Mostrar overlay de máscara"
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors ${
              showMaskOverlay
                ? 'border-red-500/50 bg-red-900/20 text-red-300'
                : 'border-[#2a2d3a] text-slate-500 hover:text-slate-300'
            }`}
          >
            {showMaskOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Máscara
          </button>
          <button
            onClick={onToggleOriginal}
            title="Ver fondo original"
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors ${
              showOriginal
                ? 'border-amber-500/50 bg-amber-900/20 text-amber-300'
                : 'border-[#2a2d3a] text-slate-500 hover:text-slate-300'
            }`}
          >
            {showOriginal ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Original
          </button>
        </div>
      </div>

      {maskedPixelCount > 0 && (
        <div className="text-[10px] text-slate-500">
          <span className="text-red-400 font-semibold">{maskedPixelCount.toLocaleString()}</span> píxeles marcados para eliminar
        </div>
      )}
    </div>
  );
}