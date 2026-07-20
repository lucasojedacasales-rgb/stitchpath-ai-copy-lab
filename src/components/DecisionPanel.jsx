import { Zap, Settings, AlertTriangle, CheckCircle, Loader2, X } from 'lucide-react';

/**
 * DecisionPanel — Panel visual que muestra la decisión de la IA
 */
export function DecisionPanel({ result, status, progress, error, isLoading, onProceed, onAdjustParams, onCancel }) {

  if (status === 'analyzing') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
        <div className="text-center">
          <p className="text-sm font-medium text-white">🔍 Analizando imagen...</p>
          <p className="text-xs text-slate-500 mt-1">Detectando tipo, colores y complejidad</p>
        </div>
        <div className="w-48 h-1.5 bg-[#1a1d27] rounded-full overflow-hidden">
          <div className="h-full bg-violet-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <AlertTriangle className="w-10 h-10 text-red-500" />
        <p className="text-sm text-red-400 text-center">{error}</p>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-[#1a1d27] border border-[#2a2d3a] text-slate-400 hover:text-white text-xs transition-colors">
          Volver
        </button>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-white">
            IA detectó: <span className="text-violet-400 capitalize">{result.contentType}</span>
          </h3>
          <p className="text-xs text-slate-500">
            Confianza: {Math.round(result.confidence * 100)}% · {result.dimensions.width}×{result.dimensions.height}px
          </p>
        </div>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="bg-amber-900/10 border border-amber-500/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">Avisos</span>
          </div>
          <ul className="space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-300/80 pl-2 border-l-2 border-amber-500/30">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Propiedades */}
      <div className="grid grid-cols-2 gap-2">
        <PropBadge label="Transparencia" active={result.properties.hasTransparency} icon="👻" />
        <PropBadge label="Detalles finos" active={result.properties.hasFineDetails} icon="🔬" />
        <PropBadge label="Alto contraste" active={result.properties.isHighContrast} icon="⚡" />
        <PropBadge label="Degradados" active={result.properties.hasGradients} icon="🌈" />
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a]">
          <span className="text-sm">🎨</span>
          <span className="text-[10px] text-slate-500 uppercase">Colores</span>
          <span className="text-xs font-semibold text-white ml-1">{result.properties.colorCount}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a]">
          <span className="text-sm">📊</span>
          <span className="text-[10px] text-slate-500 uppercase">Complejidad</span>
          <span className="text-xs font-semibold text-white ml-1 capitalize">{result.properties.complexity}</span>
        </div>
      </div>

      {/* Estrategia */}
      <div className="bg-[#161a23] border border-[#2a2d3a] rounded-lg p-3">
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">🎯 Estrategia recomendada</h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <Row label="Modo" value={translateMode(result.strategy.vectorizationMode)} />
          <Row label="Stitch" value={translateStitch(result.strategy.stitchType)} />
          <Row label="Reducción" value={translateReduction(result.strategy.colorReduction)} />
          <Row label="Detalles" value={translateDetail(result.strategy.detailPreservation)} />
        </div>
        <div className="mt-2 pt-2 border-t border-[#2a2d3a] text-xs text-slate-400 flex items-center gap-2">
          <span className="text-violet-400 font-mono">{result.strategy.recommendedParams.maxColors}</span>
          <span>colores máx.</span>
        </div>
      </div>

      {/* Colores dominantes */}
      {result.properties.dominantColors.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {result.properties.dominantColors.slice(0, 6).map((color, i) => (
              <div key={i} className="w-6 h-6 rounded-full border-2 border-[#0d0f14]" style={{ backgroundColor: color }} title={color} />
            ))}
          </div>
          <span className="text-xs text-slate-500">
            ~<strong className="text-violet-400">{result.estimatedThreadColors}</strong> colores de hilo
          </span>
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#1a1d27]">
        <button
          onClick={onProceed}
          disabled={isLoading}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
        >
          <Zap className="w-4 h-4" />
          {isLoading ? 'Procesando...' : '✨ Vectorizar con estos parámetros'}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onAdjustParams}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a] hover:border-violet-500/50 text-slate-400 hover:text-white text-xs transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Ajustar parámetros
          </button>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-3 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a] hover:border-red-500/30 text-slate-500 hover:text-red-400 text-xs transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PropBadge({ label, active, icon }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${active ? 'bg-violet-900/10 border-violet-500/30' : 'bg-[#161a23] border-[#2a2d3a] opacity-50'}`}>
      <span className="text-sm">{icon}</span>
      <span className="text-xs text-slate-400">{label}</span>
      {active && <span className="ml-auto text-[10px] font-bold text-violet-400">SÍ</span>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}

function translateMode(m) {
  return { posterize: 'Posterización', 'edge-trace': 'Bordes', 'color-quantize': 'Cuantización', skip: 'Sin pre-proceso' }[m] || m;
}
function translateStitch(t) {
  return { fill: 'Relleno (Tatami)', satin: 'Satén', running: 'Pespunte', mixed: 'Mixto', auto: 'Automático' }[t] || t;
}
function translateReduction(r) {
  return { none: 'Ninguna', light: 'Leve', aggressive: 'Agresiva' }[r] || r;
}
function translateDetail(d) {
  return { high: 'Alta', medium: 'Media', low: 'Baja' }[d] || d;
}

export default DecisionPanel;