import React, { useMemo, useRef } from 'react';
import { GitCompareArrows, ArrowRightLeft } from 'lucide-react';
import StitchCanvas from './StitchCanvas';
import ComparisonExportButton from './ComparisonExportButton';
import { compareDiagnosticBlocks } from '@/lib/diagnosticComparison';

function DiffRow({ label, a, b }) {
  const va = a ?? '—';
  const vb = b ?? '—';
  const diff = typeof a === 'number' && typeof b === 'number' ? a - b : null;
  return (
    <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr] items-center gap-2 border-b border-[#1e2130] py-1.5 text-[11px] last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-violet-300 text-right">{va}</span>
      <span className="font-mono text-cyan-300 text-right">{vb}</span>
      <span className={`font-mono text-right ${diff === null ? 'text-slate-600' : diff === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
        {diff === null ? '—' : (diff > 0 ? '+' : '') + diff}
      </span>
    </div>
  );
}

export default function ComparePanel({ analysisA, analysisB }) {
  const canvasRef = useRef(null);
  const entries = useMemo(() => {
    const arr = [];
    if (analysisA?.geometry) arr.push({ geom: analysisA.geometry, blocks: analysisA.blocks, stitchColor: '#a78bfa', jumpColor: '#c4b5fd', opacity: 0.9, label: 'A' });
    if (analysisB?.geometry) arr.push({ geom: analysisB.geometry, blocks: analysisB.blocks, stitchColor: '#22d3ee', jumpColor: '#67e8f9', opacity: 0.55, label: 'B' });
    return arr;
  }, [analysisA, analysisB]);

  if (!analysisA || !analysisB) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[#1e2130] bg-[#0d0f14] p-4 text-[11px] text-slate-500">
        <GitCompareArrows className="h-4 w-4" />
        <span className="flex-1">Carga dos archivos (A y B) para compararlos.</span>
        <ComparisonExportButton analysisA={analysisA} analysisB={analysisB} />
      </div>
    );
  }

  const sa = analysisA.summary, sb = analysisB.summary;
  const ea = sa?.extents, eb = sb?.extents;

  const blocksA = analysisA.blocks || [];
  const blocksB = analysisB.blocks || [];
  const { changedBlocks, blocksOnlyInA: onlyA, blocksOnlyInB: onlyB } = compareDiagnosticBlocks(analysisA, analysisB);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-900/30 border border-cyan-500/40">
          <GitCompareArrows className="h-4 w-4 text-cyan-300" />
        </div>
        <div className="text-xs font-bold text-white">Comparación A / B</div>
        <div className="ml-auto flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1 text-violet-300"><span className="inline-block h-0.5 w-4 bg-violet-400" /> A · {analysisA.meta?.name}</span>
          <span className="flex items-center gap-1 text-cyan-300"><span className="inline-block h-0.5 w-4 bg-cyan-400" /> B · {analysisB.meta?.name}</span>
          <ComparisonExportButton analysisA={analysisA} analysisB={analysisB} />
        </div>
      </div>

      <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
        <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr] gap-2 border-b border-[#2a2d3a] pb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          <span>Métrica</span>
          <span className="text-right text-violet-400">A</span>
          <span className="text-right text-cyan-400">B</span>
          <span className="text-right">Δ</span>
        </div>
        <DiffRow label="Puntadas" a={sa?.stitchCount} b={sb?.stitchCount} />
        <DiffRow label="Jumps" a={sa?.jumpCount} b={sb?.jumpCount} />
        <DiffRow label="Cambios de color" a={sa?.colorChangeCount} b={sb?.colorChangeCount} />
        <DiffRow label="Trims" a={sa?.trimCount} b={sb?.trimCount} />
        <DiffRow label="Bloques" a={blocksA.length} b={blocksB.length} />
        <DiffRow label="Ancho (mm)" a={ea?.w?.toFixed?.(2)} b={eb?.w?.toFixed?.(2)} />
        <DiffRow label="Alto (mm)" a={ea?.h?.toFixed?.(2)} b={eb?.h?.toFixed?.(2)} />
        <DiffRow label="Ocupación (mm²)" a={ea ? (ea.w * ea.h).toFixed(2) : null} b={eb ? (eb.w * eb.h).toFixed(2) : null} />
        <DiffRow label="Pos. final X" a={sa?.finalPosition?.x?.toFixed?.(2)} b={sb?.finalPosition?.x?.toFixed?.(2)} />
        <DiffRow label="Pos. final Y" a={sa?.finalPosition?.y?.toFixed?.(2)} b={sb?.finalPosition?.y?.toFixed?.(2)} />
      </div>

      <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-amber-400">Bloques modificados</div>
        {changedBlocks.length === 0 ? <div className="text-[10px] text-slate-600">Sin cambios de métricas.</div> : changedBlocks.map((block) => (
          <div key={block.index} className="grid grid-cols-7 gap-2 border-t border-[#1e2130] py-1.5 text-[10px] font-mono text-slate-300">
            <span>#{block.index}</span><span>color {block.colorA}/{block.colorB}</span><span>pts {block.pointsA}/{block.pointsB}</span>
            <span>st {block.stitchesA}/{block.stitchesB}</span><span>jp {block.jumpsA}/{block.jumpsB}</span>
            <span>occ {block.occupancyA}/{block.occupancyB}</span><span>{block.differencePercentage}%</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-violet-400">
            <ArrowRightLeft className="h-3 w-3" /> Solo en A
          </div>
          {onlyA.length === 0 ? <div className="text-[10px] text-slate-600">Sin bloques exclusivos.</div> : (
            <div className="space-y-1">
              {onlyA.map((b, i) => (
                <div key={i} className="text-[10px] text-slate-300 font-mono">#{b.index} · color {b.colorIndex} · {b.points} pts</div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-cyan-400">
            <ArrowRightLeft className="h-3 w-3" /> Solo en B
          </div>
          {onlyB.length === 0 ? <div className="text-[10px] text-slate-600">Sin bloques exclusivos.</div> : (
            <div className="space-y-1">
              {onlyB.map((b, i) => (
                <div key={i} className="text-[10px] text-slate-300 font-mono">#{b.index} · color {b.colorIndex} · {b.points} pts</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Superposición visual</div>
        <StitchCanvas ref={canvasRef} entries={entries} height={420} options={{ showBlocks: true }} />
      </div>
    </div>
  );
}