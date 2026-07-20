import React from 'react';
import { FileText, Hash, Ruler, Layers, Flag, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

function Row({ label, value, mono = true }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[#1e2130] py-1.5 last:border-0">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[11px] text-slate-200 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

export default function SummaryPanel({ analysis }) {
  if (!analysis) return null;
  const { meta, header, summary, blocks } = analysis;
  const declaredStitch = header?.declaredStitchCount;
  const interpreted = summary?.stitchCount;
  const stitchMismatch = declaredStitch != null && interpreted != null && declaredStitch !== interpreted;
  const ext = summary?.extents;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-900/30 border border-violet-500/40">
          <FileText className="h-4 w-4 text-violet-300" />
        </div>
        <div className="text-xs font-bold text-white">Resumen del archivo</div>
      </div>

      <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          <Hash className="h-3 w-3" /> Identidad
        </div>
        <Row label="Nombre" value={meta?.name} mono={false} />
        <Row label="Formato" value={meta?.format} />
        <Row label="Tamaño" value={meta?.sizeBytes ? `${meta.sizeBytes} bytes` : '—'} />
        <Row label="SHA-256" value={meta?.sha256 ? `${meta.sha256.slice(0, 12)}…${meta.sha256.slice(-8)}` : '—'} />
      </div>

      <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          <Ruler className="h-3 w-3" /> Dimensiones
        </div>
        {ext ? (
          <>
            <Row label="Extents (mm)" value={`${ext.w.toFixed(2)} × ${ext.h.toFixed(2)}`} />
            <Row label="min X / Y" value={`${ext.minX.toFixed(2)}, ${ext.minY.toFixed(2)}`} />
            <Row label="max X / Y" value={`${ext.maxX.toFixed(2)}, ${ext.maxY.toFixed(2)}`} />
          </>
        ) : (
          <Row label="Extents" value="n/a (JSON)" />
        )}
        {header?.declaredDimensions && (
          <Row label="Declarado (cabecera)" value={`${header.declaredDimensions.w.toFixed(2)} × ${header.declaredDimensions.h.toFixed(2)}`} />
        )}
      </div>

      <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          <Layers className="h-3 w-3" /> Puntadas
        </div>
        <Row label="Declaradas (ST:)" value={declaredStitch} />
        <Row label="Interpretadas" value={interpreted} />
        {stitchMismatch && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Discrepancia: {declaredStitch - interpreted}
          </div>
        )}
        <Row label="Jumps" value={summary?.jumpCount} />
        <Row label="Cambios de color" value={summary?.colorChangeCount} />
        <Row label="Trims" value={summary?.trimCount} />
        <Row label="Bloques" value={blocks?.length} />
        <Row label="Posición final" value={summary?.finalPosition ? `${summary.finalPosition.x.toFixed(2)}, ${summary.finalPosition.y.toFixed(2)}` : '—'} />
      </div>

      <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          <Flag className="h-3 w-3" /> END
        </div>
        <div className="flex items-center gap-2 py-1">
          {summary?.endFound ? (
            <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /><span className="text-[11px] text-emerald-300">END encontrado</span></>
          ) : (
            <><XCircle className="h-3.5 w-3.5 text-red-400" /><span className="text-[11px] text-red-300">END no encontrado</span></>
          )}
        </div>
        <Row label="Registros tras END" value={summary?.recordsAfterEnd} />
      </div>

      {(analysis.errors?.length > 0 || analysis.warnings?.length > 0) && (
        <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Errores y advertencias</div>
          {analysis.errors?.map((e, i) => (
            <div key={`e${i}`} className="flex items-start gap-1.5 py-1 text-[10px] text-red-300">
              <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {e}
            </div>
          ))}
          {analysis.warnings?.map((w, i) => (
            <div key={`w${i}`} className="flex items-start gap-1.5 py-1 text-[10px] text-amber-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}