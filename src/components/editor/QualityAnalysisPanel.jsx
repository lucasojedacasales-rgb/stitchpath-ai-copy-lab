import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Zap, BarChart3, Sparkles, ChevronDown, Wand2 } from 'lucide-react';

export default function QualityAnalysisPanel({ projectId, onAnalysisComplete }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [training, setTraining] = useState(false);
  const [autoRules, setAutoRules] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [autoAdjusting, setAutoAdjusting] = useState(false);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const result = await base44.functions.invoke('analyzeDigitizationQuality', {
        project_id: projectId,
      });
      setAnalysis(result.data);
      onAnalysisComplete?.(result.data);
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleTrainAutoAdjustment = async () => {
    setTraining(true);
    try {
      const result = await base44.functions.invoke('trainAutoAdjustment', {});
      setAutoRules(result);
    } catch (err) {
      console.error('Training failed:', err);
    } finally {
      setTraining(false);
    }
  };

  const handleAutoAdjustTo10 = async () => {
    if (!analysis || analysis.quality_assessment?.overall_rating >= 10) return;
    setAutoAdjusting(true);
    try {
      // Step 1: Auto-adjust parameters
      const adjustResult = await base44.functions.invoke('autoAdjustAndRedigitize', {
        project_id: projectId,
      });
      
      // Show adjustment summary
      if (adjustResult.adjustments_applied && adjustResult.adjustments_applied.length > 0) {
        console.log('Adjustments applied:', adjustResult.adjustments_applied);
        // In production, might show a toast or notification here
      }
      
      // Step 2: Small delay for backend to persist and re-process
      await new Promise(r => setTimeout(r, 1200));
      
      // Step 3: Re-analyze to get new rating
      const newAnalysis = await base44.functions.invoke('analyzeDigitizationQuality', {
        project_id: projectId,
      });
      setAnalysis(newAnalysis.data);
      onAnalysisComplete?.(newAnalysis.data);
    } catch (err) {
      console.error('Auto-adjust failed:', err);
      // Could show error toast here
    } finally {
      setAutoAdjusting(false);
    }
  };

  const getRatingColor = (rating) => {
    if (!rating) return 'bg-slate-600';
    if (rating >= 8) return 'bg-green-600';
    if (rating >= 6) return 'bg-yellow-600';
    return 'bg-red-600';
  };

  const getMetricColor = (value) => {
    const colorMap = {
      HIGH: 'bg-green-600',
      EXCELLENT: 'bg-green-600',
      PERFECT: 'bg-green-600',
      BALANCED: 'bg-green-600',
      MEDIUM: 'bg-yellow-600',
      GOOD: 'bg-yellow-600',
      ACCEPTABLE: 'bg-orange-600',
      UNEVEN: 'bg-orange-600',
      ISSUES: 'bg-red-600',
      POOR: 'bg-red-600',
      LOW: 'bg-red-600',
    };
    return colorMap[value] || 'bg-slate-600';
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Análisis de Calidad
          </h3>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded hover:bg-[#1e2130] transition-colors"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <Button
          onClick={handleAnalyze}
          disabled={analyzing || !projectId}
          size="sm"
          className="flex-1 text-xs h-8 bg-violet-600 hover:bg-violet-700"
        >
          {analyzing ? 'Analizando...' : 'Analizar'}
        </Button>
        {analysis && analysis.quality_assessment?.overall_rating < 10 && (
          <Button
            onClick={handleAutoAdjustTo10}
            disabled={autoAdjusting || !projectId}
            size="sm"
            className="flex-1 text-xs h-8 bg-green-600 hover:bg-green-700 flex items-center gap-1"
          >
            <Wand2 className="w-3 h-3" />
            {autoAdjusting ? 'Ajustando...' : 'A 10/10'}
          </Button>
        )}
        <Button
          onClick={handleTrainAutoAdjustment}
          disabled={training}
          size="sm"
          variant="outline"
          className="flex-1 text-xs h-8"
        >
          {training ? 'Entrenando...' : 'Entrenar IA'}
        </Button>
      </div>

      {/* Quality Metrics Display */}
      {analysis && expanded && (
        <Card className="bg-[#161a23] border-[#2a2d3a] p-3 space-y-3">
          {/* Overall Rating */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">Rating General</span>
            <div className="flex items-center gap-2">
              <div className={`w-12 h-6 rounded ${getRatingColor(analysis.quality_assessment?.overall_rating)} flex items-center justify-center text-xs font-bold text-white`}>
                {analysis.quality_assessment?.overall_rating}/10
              </div>
            </div>
          </div>

          {/* Metric Cards */}
          <div className="space-y-2">
            {[
              { label: 'Detalles', value: analysis.quality_assessment?.detail_visibility },
              { label: 'Colores', value: analysis.quality_assessment?.color_separation },
              { label: 'Capas', value: analysis.quality_assessment?.layer_integrity },
              { label: 'Distribución', value: analysis.quality_assessment?.stitch_distribution },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{label}</span>
                <Badge className={`text-[10px] font-semibold ${getMetricColor(value)}`}>
                  {value || 'N/A'}
                </Badge>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="text-[11px] text-slate-400 border-t border-[#2a2d3a] pt-2">
            <p className="line-clamp-2">{analysis.quality_assessment?.notes}</p>
          </div>

          {/* Recommendations */}
          {analysis.summary?.recommendations && analysis.summary.recommendations.length > 0 && (
            <div className="mt-3 p-2 bg-blue-900/20 border border-blue-500/30 rounded">
              <p className="text-[10px] text-blue-300 font-semibold mb-1">Recomendaciones:</p>
              <ul className="space-y-1">
                {analysis.summary.recommendations.slice(0, 2).map((rec, i) => (
                  <li key={i} className="text-[10px] text-blue-200 flex gap-1">
                    <span>•</span> {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Auto-Adjustment Rules */}
      {autoRules && expanded && (
        <Card className="bg-[#1a1f2e] border-[#2a3f4f] p-3 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs font-semibold text-yellow-300">Reglas de Auto-Ajuste</span>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {autoRules.recommendations && autoRules.recommendations.slice(0, 3).map((rec, i) => (
              <div key={i} className="text-[10px] bg-[#0d0f14] p-2 rounded border border-yellow-500/20">
                <p className="font-mono text-yellow-200">{rec.condition}</p>
                <p className="text-yellow-100 mt-1">→ {rec.action}</p>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-slate-400 border-t border-[#2a2d3a] pt-2 mt-2">
            <p>Próximos pasos:</p>
            <ol className="list-decimal list-inside space-y-0.5 mt-1">
              {autoRules.next_steps?.slice(0, 2).map((step, i) => (
                <li key={i} className="text-[9px]">{step}</li>
              ))}
            </ol>
          </div>
        </Card>
      )}

      {/* Status Indicator */}
      <div className="text-[10px] text-slate-500 px-2">
        {analysis ? (
          <p>✓ Análisis completado — {analysis.summary?.total_regions || 0} regiones evaluadas</p>
        ) : (
          <p>Haz clic en "Analizar" para evaluar la calidad del diseño</p>
        )}
      </div>
    </div>
  );
}