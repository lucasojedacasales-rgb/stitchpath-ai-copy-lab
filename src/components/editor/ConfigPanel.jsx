import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Zap, Cpu, Settings, BookMarked, Brain, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import WorkflowPresetPanel from './WorkflowPresetPanel';
import { DIGITIZE_MODES, MODE_COLORS } from '@/lib/digitizeModes';
import { generateProcessingPlan } from '@/lib/intelligentEngine';

const FABRIC_TYPES = ['Algodón', 'Poliéster', 'Mezcla', 'Denim', 'Lino', 'Seda', 'Lycra', 'Otro'];

const MODE_ORDER = ['fast', 'standard', 'precision', 'hybrid', 'ultra', 'ai', 'intelligent'];

// ── Simulated AI segment response ─────────────────────────────────────────────
function simulateAiAnalysis() {
  return new Promise(resolve => setTimeout(() => resolve({
    segments: [
      { id: 'seg1', label: 'Contorno principal', confidence: 0.96, type: 'outline', stitchType: 'satin',          color: '#7c3aed' },
      { id: 'seg2', label: 'Relleno central',    confidence: 0.91, type: 'fill',    stitchType: 'fill',           color: '#06b6d4' },
      { id: 'seg3', label: 'Detalle decorativo', confidence: 0.84, type: 'detail',  stitchType: 'running_stitch', color: '#f59e0b' },
      { id: 'seg4', label: 'Fondo base',         confidence: 0.88, type: 'fill',    stitchType: 'fill',           color: '#1e293b' },
      { id: 'seg5', label: 'Texto / lettering',  confidence: 0.79, type: 'text',    stitchType: 'satin',          color: '#ffffff' },
    ],
    recommendations: [
      'Usar underlay de zigzag para el relleno central por su área >80mm²',
      'El contorno principal tiene curvatura alta — satin con compensación +0.3mm',
      'Reducir a 5 colores elimina 3 cambios de hilo innecesarios',
    ],
    optimizedColors: 5,
    estimatedStitches: 5247,
    quality: 'Alta',
    processingTime: '2.3s',
  }), 2500));
}

function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#1e2130]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1e2130]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{title}</span>
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-violet-600' : 'bg-[#2a2d3a]'}`}
      >
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  );
}



export default function ConfigPanel({ config, onChange, regions, selectedRegionIds, onRegionsUpdate }) {
  const cfg = config || {};
  const set = (key, val) => onChange({ ...cfg, [key]: val });
  const setUnifiedStandardProProfile = (enabled) => {
    const { profile_id, profileId, engineProfileId, ...rest } = cfg;
    onChange(enabled
      ? { ...cfg, unifiedStandardProProfile: true, profile_id: 'unified_standard_pro' }
      : { ...rest, unifiedStandardProProfile: false }
    );
  };

  const [isAnalyzing,     setIsAnalyzing]     = useState(false);
  const [aiResults,       setAiResults]       = useState(null);
  const [aiError,         setAiError]         = useState(null);
  const [intelligentPlan, setIntelligentPlan] = useState(null);
  const [isPlanning,      setIsPlanning]      = useState(false);
  const [planExpanded,    setPlanExpanded]    = useState(false);

  const handleModeChange = useCallback((modeId) => {
    set('mode', modeId);
    if (modeId !== 'ai')          { setAiResults(null); setAiError(null); }
    if (modeId !== 'intelligent') { setIntelligentPlan(null); }
  }, [cfg, onChange]);

  const analyzeIntelligent = useCallback(async () => {
    setIsPlanning(true);
    setIntelligentPlan(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const mockRegions = [
        { id: 'r1', area: 12000, vertices: 45,  colors: ['#000'] },
        { id: 'r2', area: 800,   vertices: 320, colors: ['#E91E63', '#9C27B0'] },
        { id: 'r3', area: 450,   vertices: 580, colors: ['#2196F3', '#03A9F4', '#00BCD4'] },
        { id: 'r4', area: 2500,  vertices: 120, colors: ['#FF5722'] },
        { id: 'r5', area: 6000,  vertices: 80,  colors: ['#4CAF50', '#8BC34A'] },
      ];
      const { plan, stats } = generateProcessingPlan(mockRegions);
      setIntelligentPlan({ plan, stats });
      onChange({ ...cfg, mode: 'intelligent', intelligent_plan: plan, intelligentPlanConsumed: false, use_ia_vision: true, ai_optimized: true });
    } finally {
      setIsPlanning(false);
    }
  }, [cfg, onChange]);

  const analyzeWithAI = async () => {
    setIsAnalyzing(true);
    setAiError(null);
    try {
      const results = await simulateAiAnalysis();
      setAiResults(results);
      // Auto-apply optimized color count
      set('color_count', results.optimizedColors);
    } catch (e) {
      setAiError('Error al conectar con el servicio de IA. Inténtalo de nuevo.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#0d0f14]">

      {/* GENERAL */}
      <Section title="Configuración General" icon={Settings}>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 block">Tipo de tela</label>
            <select
              value={cfg.fabric_type || 'Algodón'}
              onChange={e => set('fabric_type', e.target.value)}
              className="w-full bg-[#161a23] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
            >
              {FABRIC_TYPES.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 block">Ancho (mm)</label>
              <input
                type="number" min="10" max="500"
                value={cfg.width_mm || 100}
                onChange={e => set('width_mm', Number(e.target.value))}
                className="w-full bg-[#161a23] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 block">Alto (mm)</label>
              <input
                type="number" min="10" max="500"
                value={cfg.height_mm || 100}
                onChange={e => set('height_mm', Number(e.target.value))}
                className="w-full bg-[#161a23] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider">Optimizador de colores</label>
              <span className="text-xs font-bold text-violet-400">{cfg.color_count || 6}</span>
            </div>
            <input
              type="range" min="2" max="12" step="1"
              value={cfg.color_count || 6}
              onChange={e => set('color_count', Number(e.target.value))}
              className="w-full accent-violet-600"
            />
            <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
              <span>2</span><span>12</span>
            </div>
          </div>
        </div>
      </Section>

      {/* MODOS */}
      <Section title="Motor de Digitalización" icon={Zap}>
        <div className="space-y-2">
          {MODE_ORDER.map(modeId => {
            const mode = DIGITIZE_MODES[modeId];
            const active = (cfg.mode || 'hybrid') === modeId;
            const colors = MODE_COLORS[mode.color];
            return (
              <button
                key={modeId}
                onClick={() => handleModeChange(modeId)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                  active
                    ? `${colors.border} ${colors.bg} text-white`
                    : 'border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:border-[#3a3d4a] hover:text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm leading-none">{mode.icon}</span>
                    <span className={`text-xs font-bold ${active ? colors.text : ''}`}>{mode.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {mode.badge && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${active ? colors.badge : 'bg-[#1a1d27] text-slate-500 border-[#2a2d3a]'}`}>
                        {mode.badge}
                      </span>
                    )}
                    {active && <div className={`w-1.5 h-1.5 rounded-full ${colors.text.replace('text-', 'bg-')}`} />}
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 leading-tight">{mode.description}</p>
                {active && mode.recommended_for?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {mode.recommended_for.slice(0, 3).map(tag => (
                      <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded-full border ${colors.badge} opacity-70`}>{tag}</span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* AI Segmentation Panel — only when ai mode active */}
        {(cfg.mode || 'hybrid') === 'ai' && (
          <div className="mt-3 rounded-xl border border-violet-500/25 bg-[#0d0f1a] overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#1e2130]">
              <Brain className="w-4 h-4 text-violet-400" />
              <span className="text-xs font-bold text-violet-300 flex-1">AI Segmentation</span>
              {aiResults && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            </div>

            <div className="p-3 space-y-3">
              {/* Analyze button */}
              <button
                onClick={analyzeWithAI}
                disabled={isAnalyzing}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 text-xs font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isAnalyzing
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analizando…</>
                  : <><Sparkles className="w-3.5 h-3.5" />{aiResults ? 'Análisis completado · Re-analizar' : 'Analizar con IA'}</>}
              </button>

              {/* Error */}
              {aiError && (
                <p className="text-[10px] text-red-400 bg-red-950/20 border border-red-500/20 rounded-lg px-3 py-2">{aiError}</p>
              )}

              {/* Results */}
              {aiResults && !isAnalyzing && (
                <div className="space-y-3">
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: 'Colores', value: aiResults.optimizedColors },
                      { label: 'Puntadas', value: aiResults.estimatedStitches.toLocaleString() },
                      { label: 'Calidad', value: aiResults.quality },
                    ].map(s => (
                      <div key={s.label} className="bg-[#161a23] border border-[#2a2d3a] rounded-lg px-2 py-2 text-center">
                        <div className="text-sm font-bold text-violet-300">{s.value}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Detected regions */}
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Regiones detectadas</p>
                    <div className="space-y-1.5">
                      {aiResults.segments.map(seg => (
                        <div key={seg.id} className="bg-[#161a23] border border-[#2a2d3a] rounded-lg px-2.5 py-2">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: seg.color }} />
                            <span className="text-[11px] text-slate-300 flex-1 font-medium truncate">{seg.label}</span>
                            <span className="text-[9px] text-slate-500 font-mono">{Math.round(seg.confidence * 100)}%</span>
                          </div>
                          {/* Confidence bar */}
                          <div className="h-1 bg-[#1e2130] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-violet-500/70 transition-all"
                              style={{ width: `${seg.confidence * 100}%` }}
                            />
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-[9px] text-slate-600">{seg.type}</span>
                            <span className="text-[9px] text-cyan-500">{seg.stitchType}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recommendations */}
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Recomendaciones</p>
                    <div className="space-y-1">
                      {aiResults.recommendations.map((rec, i) => (
                        <div key={i} className="flex gap-2 text-[10px] text-slate-400 leading-tight">
                          <span className="text-violet-500 flex-shrink-0 mt-0.5">•</span>
                          <span>{rec}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <p className="text-[9px] text-slate-600 text-center">Procesado en {aiResults.processingTime}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Intelligent Mode Panel */}
        {cfg.mode === 'intelligent' && (
          <div className="mt-3 rounded-xl border border-violet-500/30 bg-[#0d0f1a] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 bg-violet-900/20 border-b border-violet-500/20">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span className="text-xs font-bold text-violet-300 flex-1">Motor Inteligente Adaptativo</span>
              {intelligentPlan && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            </div>

            <div className="p-3 space-y-3">
              <button
                onClick={analyzeIntelligent}
                disabled={isPlanning}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  isPlanning
                    ? 'bg-violet-800/50 text-violet-300 cursor-not-allowed'
                    : intelligentPlan
                      ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-600/30'
                      : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}
              >
                {isPlanning ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analizando diseño...</>
                ) : intelligentPlan ? (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> Plan generado · Reanalizar</>
                ) : (
                  <><Sparkles className="w-3.5 h-3.5" /> Analizar y generar plan óptimo</>
                )}
              </button>

              {isPlanning && (
                <div className="space-y-2">
                  <div className="h-1.5 bg-[#1a1d27] rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full animate-pulse w-3/4" />
                  </div>
                  <p className="text-[10px] text-slate-500 text-center">
                    Analizando regiones · Calculando complejidad · Seleccionando motores óptimos
                  </p>
                </div>
              )}

              {intelligentPlan && !isPlanning && (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-1.5">
                    {['fast', 'precision', 'hybrid', 'ai'].map(engine => (
                      <div key={engine} className="bg-[#161a23] rounded-lg p-2 text-center border border-[#2a2d3a]">
                        <div className="text-base font-bold text-violet-400">{intelligentPlan.stats[engine]}</div>
                        <div className="text-[9px] text-slate-500 capitalize">{engine}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
                    <span>{intelligentPlan.stats.totalRegions} regiones totales</span>
                    <span>~{intelligentPlan.stats.estimatedTotalTime.toFixed(1)}s</span>
                  </div>

                  <button
                    onClick={() => setPlanExpanded(v => !v)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-[#1a1d27] text-[11px] text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    <span>Ver plan detallado por región</span>
                    {planExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>

                  {planExpanded && (
                    <div className="space-y-1.5">
                      {intelligentPlan.plan.map((item, i) => (
                        <div key={item.regionId} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a]">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            item.engine === 'fast'      ? 'bg-amber-400'   :
                            item.engine === 'precision' ? 'bg-emerald-400' :
                            item.engine === 'ai'        ? 'bg-violet-400'  : 'bg-cyan-400'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-medium text-slate-300">Región {i + 1}</span>
                              <span className={`text-[9px] px-1 rounded border ${
                                item.engine === 'fast'      ? 'bg-amber-900/20 text-amber-300 border-amber-500/30'     :
                                item.engine === 'precision' ? 'bg-emerald-900/20 text-emerald-300 border-emerald-500/30' :
                                item.engine === 'ai'        ? 'bg-violet-900/20 text-violet-300 border-violet-500/30'  :
                                'bg-cyan-900/20 text-cyan-300 border-cyan-500/30'
                              }`}>{item.engine}</span>
                            </div>
                            <p className="text-[9px] text-slate-500 truncate">{item.reason}</p>
                          </div>
                          <span className="text-[9px] text-slate-600 flex-shrink-0">{item.estimatedTime}s</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => onChange({ ...cfg, mode: 'intelligent', intelligent_applied: true, intelligentPlanConsumed: false, vector_engine: 'hybrid', use_ia_vision: true })}
                    className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors"
                  >
                    Aplicar plan inteligente
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* TATAMI FILL */}
      <Section title="Relleno Tatami" icon={Cpu}>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 block">Densidad</label>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'low',   label: 'Baja',  sub: '0.6mm · rápido',         value: 0.6 },
                { id: 'mid',   label: 'Media', sub: '0.4mm · balance',         value: 0.4, badge: 'Rec.' },
                { id: 'high',  label: 'Alta',  sub: '0.3mm · detalle',         value: 0.3 },
                { id: 'ultra', label: 'Ultra', sub: '0.25mm · <50mm',          value: 0.25 },
              ].map(opt => {
                const active = (cfg.tatami_density || 0.4) === opt.value;
                return (
                  <button
                    key={opt.id}
                    onClick={() => set('tatami_density', opt.value)}
                    className={`text-left px-2.5 py-2 rounded-lg border transition-all ${
                      active
                        ? 'border-violet-500/60 bg-violet-900/20 text-white'
                        : 'border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:border-[#3a3d4a] hover:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold">{opt.label}</span>
                      {opt.badge && <span className="text-[9px] px-1 rounded bg-violet-600/30 text-violet-300 border border-violet-500/30">{opt.badge}</span>}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">{opt.sub}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 block">Ángulo de relleno</label>
            <div className="flex gap-1 flex-wrap">
              {[
                { label: 'Auto', value: null },
                { label: '0°',   value: 0 },
                { label: '45°',  value: 45 },
                { label: '90°',  value: 90 },
                { label: '135°', value: 135 },
              ].map(opt => {
                const current = cfg.fill_angle === undefined ? null : cfg.fill_angle;
                const active = current === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    onClick={() => set('fill_angle', opt.value)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                      active
                        ? 'border-cyan-500/60 bg-cyan-900/20 text-cyan-300'
                        : 'border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:text-slate-300 hover:border-[#3a3d4a]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      {/* VECTOR ENGINE */}
      <Section title="Vector Engine" icon={Cpu}>
        <div className="space-y-2">
          <label className="text-[11px] text-slate-500 uppercase tracking-wider block">Motor de vectorización</label>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { id: 'hybrid',  name: 'Híbrido',  desc: 'Canny + VTracer + Potrace', badge: 'Rec.' },
              { id: 'opencv',  name: 'OpenCV',   desc: 'Canny multi-umbral + morfología' },
              { id: 'vtracer', name: 'VTracer',  desc: 'Segmentación jerárquica por color' },
              { id: 'potrace', name: 'Potrace',  desc: 'Trazado de bordes + curvas' },
            ].map(eng => {
              const active = (cfg.vector_engine || 'hybrid') === eng.id;
              return (
                <button
                  key={eng.id}
                  onClick={() => set('vector_engine', eng.id)}
                  className={`text-left px-2.5 py-2 rounded-lg border transition-all ${
                    active
                      ? 'border-cyan-500/60 bg-cyan-900/20 text-white'
                      : 'border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:border-[#3a3d4a] hover:text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] font-bold">{eng.name}</span>
                    {eng.badge && <span className="text-[9px] px-1 rounded bg-cyan-600/30 text-cyan-300 border border-cyan-500/30">{eng.badge}</span>}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight">{eng.desc}</p>
                </button>
              );
            })}
          </div>
          <div className="space-y-1 pt-1">
            <Toggle label="IA Vision (análisis visual)" value={cfg.use_ia_vision || false} onChange={v => set('use_ia_vision', v)} />
            <Toggle label="Fondos completos (Claude Sonnet)" value={cfg.use_full_bg || false} onChange={v => set('use_full_bg', v)} />
          </div>
        </div>
      </Section>

      {/* AVANZADAS */}
      <Section title="Opciones Avanzadas" icon={Settings} defaultOpen={false}>
        <div className="space-y-1">
          <Toggle label="Remover fondo (auto-limpieza)" value={cfg.remove_bg || false} onChange={v => set('remove_bg', v)} />
          <Toggle label="Secuenciación AI-aware" value={cfg.ai_sequence || false} onChange={v => set('ai_sequence', v)} />
          <Toggle label="Perfil Standard Pro unificado" value={cfg.unifiedStandardProProfile === true || cfg.profile_id === 'unified_standard_pro'} onChange={setUnifiedStandardProProfile} />
          <Toggle label="Universal Auto Digitizer Pro" value={cfg.universalAutoDigitizerPro || false} onChange={v => set('universalAutoDigitizerPro', v)} />
          <Toggle label="Travel + micro-detail cleanup" value={cfg.travelAndMicroDetailCleanup || false} onChange={v => set('travelAndMicroDetailCleanup', v)} />
          <Toggle label="Thread color sequence optimizer" value={cfg.universalThreadColorSequenceOptimizer || false} onChange={v => set('universalThreadColorSequenceOptimizer', v)} />
          <Toggle label="Cartoon cleanup + outline merge" value={cfg.universalCartoonCleanupAndOutlineMerge || false} onChange={v => set('universalCartoonCleanupAndOutlineMerge', v)} />
          <Toggle label="Thread stop compaction V1" value={cfg.threadStopCompactionV1 || false} onChange={v => set('threadStopCompactionV1', v)} />
          <Toggle label="Contour cleanup V1" value={cfg.contourCleanupV1 || false} onChange={v => set('contourCleanupV1', v)} />
          <div className="py-1.5">
            <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 block">Compensación de tensión</label>
            <input
              type="number" min="0" max="2" step="0.1"
              value={cfg.tension_comp || 0.5}
              onChange={e => set('tension_comp', Number(e.target.value))}
              className="w-full bg-[#161a23] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>
      </Section>

      {/* PRESETS */}
      <Section title="Presets de workflow" icon={BookMarked} defaultOpen={false}>
        <WorkflowPresetPanel
          regions={regions || []}
          selectedRegionIds={selectedRegionIds || []}
          onRegionsUpdate={onRegionsUpdate}
        />
      </Section>
    </div>
  );
}