import React, { useMemo } from 'react';
import { Download, FileJson } from 'lucide-react';

/**
 * DiagnosticExportPanel — builds a read-only JSON diagnostic report and
 * offers a local download. Never uploads or modifies the source file.
 *
 * Report fields: schema, analysisDate, sha256, file, header, metrics,
 * risks, longJumps, suspectBlocks, coverageBlocks, structuralErrors, warnings.
 */
export default function DiagnosticExportPanel({ analysis }) {
  const report = useMemo(() => {
    if (!analysis) return null;
    return {
      schema: 'engineV2-diagnostic-report',
      version: 1,
      analysisDate: analysis.analysisDate || new Date().toISOString(),
      sha256: analysis.meta?.sha256 || null,
      file: {
        name: analysis.meta?.name ?? null,
        format: analysis.meta?.format ?? null,
        sizeBytes: analysis.meta?.sizeBytes ?? null,
      },
      header: analysis.header || null,
      metrics: {
        declaredStitchCount: analysis.header?.declaredStitchCount ?? null,
        declaredColorCount: analysis.header?.declaredColorCount ?? null,
        stitchCount: analysis.summary?.stitchCount ?? null,
        jumpCount: analysis.summary?.jumpCount ?? null,
        colorChangeCount: analysis.summary?.colorChangeCount ?? null,
        trimCount: analysis.summary?.trimCount ?? null,
        blocks: analysis.blocks?.length ?? 0,
        extents: analysis.summary?.extents ?? null,
        finalPosition: analysis.summary?.finalPosition ?? null,
        endFound: analysis.summary?.endFound ?? null,
        recordsAfterEnd: analysis.summary?.recordsAfterEnd ?? null,
        recordsTotal: analysis.summary?.recordsTotal ?? null,
      },
      risks: analysis.risks || [],
      longJumps: analysis.longJumps || [],
      suspectBlocks: analysis.suspectBlocks || [],
      coverageBlocks: analysis.coverageBlocks || [],
      structuralErrors: analysis.errors || [],
      warnings: analysis.warnings || [],
    };
  }, [analysis]);

  const download = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (analysis.meta?.name || 'report').replace(/\.[^.]+$/, '');
    a.href = url;
    a.download = `diagnostic-${base}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!analysis) return null;

  const suspectCount = report.suspectBlocks.length;
  const longJumpCount = report.longJumps.length;

  return (
    <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-900/30 border border-amber-500/40">
          <FileJson className="h-4 w-4 text-amber-300" />
        </div>
        <div className="text-xs font-bold text-white">Diagnóstico exportable (JSON)</div>
        <div className="ml-auto flex items-center gap-2 text-[10px] text-slate-500">
          <span className="rounded bg-[#161a23] px-1.5 py-0.5">{report.risks.length} riesgos</span>
          <span className="rounded bg-[#161a23] px-1.5 py-0.5">{longJumpCount} jumps largos</span>
          <span className="rounded bg-[#161a23] px-1.5 py-0.5">{suspectCount} bloques sospechosos</span>
          <span className="rounded bg-[#161a23] px-1.5 py-0.5">{report.structuralErrors.length} errores</span>
        </div>
        <button
          onClick={download}
          className="flex items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-500 px-2.5 py-1.5 text-[11px] font-bold text-white"
        >
          <Download className="h-3.5 w-3.5" /> Exportar JSON
        </button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-[#0b0d12] border border-[#1e2130] p-2 text-[10px] text-slate-300 font-mono">
        {JSON.stringify(report, null, 2)}
      </pre>
    </div>
  );
}