/**
 * ProfessionalQualityPanel.jsx — StitchPath AI
 * Panel "Calidad profesional": muestra métricas del modo profesional y
 * compara Final Look vs Export real.
 */
import { useMemo, useState } from 'react';
import { Award, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import {
  professionalEmbroideryQualityGate, compareFinalLookVsExport,
} from '@/lib/professionalDigitizingMode';

export default function ProfessionalQualityPanel({
  commands = [], objects = [], regions = [], exportCommands = [], darkStroke, config = {}, onToggleMode,
  gate: providedGate,
}) {
  const data = useMemo(() => {
    // Si llega el gate pre-calculado por el pipeline profesional (con métricas de
    // reparación), lo usamos; si no, se recalcula para mantener el panel funcional.
    const gate = providedGate || professionalEmbroideryQualityGate(commands, objects, regions, darkStroke, config);
    const cmp = compareFinalLookVsExport(commands, exportCommands || commands);
    return { gate, cmp };
  }, [providedGate, commands, objects, regions, exportCommands, darkStroke, config]);

  const g = data.gate, c = data.cmp;
  const score = g.professionalScore;
  const scoreColor = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stitchCount = commands.filter(c => c.type === 'stitch').length;
  const ce01Status = g.ce01Status || g.ce01StatusAfter || g.ce01StatusBefore;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white">Calidad profesional</h3>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          <input type="checkbox" checked={!!config.professionalMode} onChange={e => onToggleMode?.(e.target.checked)} className="accent-violet-600" />
          Modo profesional
        </label>
      </div>

      {/* Score */}
      <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-3 text-center">
        <div className={`text-4xl font-bold ${scoreColor}`}>{score}</div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">Professional Score</div>
        <div className={`mt-1 text-[11px] font-bold ${g.passed ? 'text-emerald-400' : 'text-red-400'}`}>
          {g.passed ? '✓ APTO' : '✗ NO APTO'}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="visibleDiagonalStitches" value={g.visibleDiagonalStitches ?? 0} ok={(g.visibleDiagonalStitches ?? 0) === 0} />
        <SummaryCard label="satinContourCount" value={g.satinContourCount ?? 0} />
        <SummaryCard label="runningContourCount" value={g.runningContourCount ?? 0} />
        <SummaryCard label="underlayCount" value={g.underlayCount ?? 0} />
        <SummaryCard label="jumps" value={g.jumps ?? 0} ok={(g.jumps ?? 0) <= 250} />
        <SummaryCard label="trims" value={g.trims ?? 0} ok={(g.trims ?? 0) <= 80} />
        <SummaryCard label="finalLookExportMismatch" value={String(c.simulationExportMismatch)} ok={!c.simulationExportMismatch} />
        {ce01Status && <SummaryCard label="CE01 status" value={ce01Status} ok={ce01Status !== 'INVALID'} />}
      </div>

      <button
        onClick={() => setDetailsOpen((v) => !v)}
        className="w-full rounded-lg border border-[#2a2d3a] bg-[#11141c] px-3 py-2 text-xs font-bold text-slate-300 hover:text-white hover:bg-[#1e2130] transition-colors"
      >
        {detailsOpen ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
      </button>

      {detailsOpen && (
        <div className="space-y-3">
          <Section title="7 · Final Look vs Export">
            <KV k="finalLookStitches" v={c.finalLookStitches} />
            <KV k="exportStitches" v={c.exportStitches} />
            <KV k="stitchDelta" v={c.stitchDelta} ok={c.stitchDelta === 0} />
            <KV k="SIMULATION_EXPORT_MISMATCH" v={String(c.simulationExportMismatch)} ok={!c.simulationExportMismatch} />
            {c.objectsInSimNotExport.length > 0 && <div className="text-[10px] text-amber-400 mt-1">En sim no export: {c.objectsInSimNotExport.join(', ')}</div>}
            {c.objectsInExportNotSim.length > 0 && <div className="text-[10px] text-amber-400">En export no sim: {c.objectsInExportNotSim.join(', ')}</div>}
          </Section>

          <Section title="1 · Puntadas visibles">
            <KV k="visibleDiagonalStitchesBefore" v={g.visibleDiagonalStitchesBefore ?? '—'} />
            <KV k="visibleDiagonalStitchesAfter" v={g.visibleDiagonalStitches} ok={g.visibleDiagonalStitches === 0} />
            <KV k="removedVisibleDiagonalStitches" v={g.removedVisibleDiagonalStitches ?? 0} ok={(g.removedVisibleDiagonalStitches ?? 0) > 0 ? true : undefined} />
            <KV k="convertedDiagonalToJump" v={g.convertedDiagonalToJump ?? 0} ok={(g.convertedDiagonalToJump ?? 0) > 0 ? true : undefined} />
            <KV k="longestRemovedDiagonalMm" v={g.longestRemovedDiagonalMm != null ? Number(g.longestRemovedDiagonalMm).toFixed(1) : '—'} />
            <KV k="repairedCommandsUsedForExport" v={String(g.repairedCommandsUsedForExport ?? false)} ok={!!g.repairedCommandsUsedForExport} />
            <KV k="unsupportedTravelStitches" v={g.unsupportedTravelStitches} ok={g.unsupportedTravelStitches === 0} />
            {g.blocks.find(b => b.name === 'unsupportedLongStitches') && <KV k="unsupportedLongStitches" v={g.blocks.find(b => b.name === 'unsupportedLongStitches').value} ok={g.blocks.find(b => b.name === 'unsupportedLongStitches').value === 0} />}
          </Section>

          <Section title="3 · Contornos">
            <KV k="satinContourCount" v={g.satinContourCount} />
            <KV k="runningContourCount" v={g.runningContourCount} />
            <KV k="contourMissingOnOneFoot" v={String(g.contourMissingOnOneFoot)} ok={!g.contourMissingOnOneFoot} />
          </Section>

          <Section title="4 · Rellenos">
            <KV k="fillRegionCount" v={g.fillRegionCount} />
            <KV k="underlayCount" v={g.underlayCount} />
          </Section>

          <Section title="2 · Orden de capas">
            <KV k="fillAfterContour" v={String(g.fillAfterContour)} ok={!g.fillAfterContour} />
          </Section>

          <Section title="5 · Colores">
            <KV k="colorCountBefore" v={g.colorCountBefore} />
            <KV k="colorCountAfter" v={g.colorCountAfter} ok={g.colorCountAfter <= 8} />
          </Section>

          <Section title="6 · Calidad">
            <KV k="stitches" v={stitchCount} />
            <KV k="jumps" v={g.jumps} ok={g.jumps <= 250} />
            <KV k="trims" v={g.trims} ok={g.trims <= 80} />
            <KV k="shortStitches" v={g.shortStitches} ok={g.shortStitches <= 300} />
            <KV k="duplicateStitches" v={g.duplicateStitches} ok={g.duplicateStitches <= 200} />
          </Section>

          {g.failedBlocks.length > 0 && (
            <div className="bg-red-900/20 border border-red-500/40 rounded-lg p-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-300 mb-1"><AlertTriangle className="w-3 h-3" /> Failed blocks</div>
              {g.failedBlocks.map(b => (
                <div key={b} className="text-[10px] text-red-400 flex items-center gap-1"><XCircle className="w-2.5 h-2.5" /> {b}</div>
              ))}
            </div>
          )}
          {g.failedBlocks.length === 0 && (
            <div className="bg-emerald-900/20 border border-emerald-500/40 rounded-lg p-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
              <CheckCircle2 className="w-3 h-3" /> Todos los bloques OK
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, ok }) {
  const color = ok === undefined ? 'text-slate-200' : ok ? 'text-emerald-300' : 'text-red-300';
  return (
    <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-bold ${color}`}>{String(value)}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2.5">
      <h4 className="text-[11px] font-bold text-slate-200 mb-1.5">{title}</h4>
      {children}
    </div>
  );
}
function KV({ k, v, ok }) {
  const color = ok === undefined ? 'text-slate-300' : ok ? 'text-emerald-400' : 'text-red-400';
  return <div className="flex items-center justify-between text-[10px] py-0.5"><span className="text-slate-500">{k}</span><span className={`font-bold ${color}`}>{String(v)}</span></div>;
}