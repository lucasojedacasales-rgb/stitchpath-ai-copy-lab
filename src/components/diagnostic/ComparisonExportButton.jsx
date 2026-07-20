import React from 'react';
import { Download } from 'lucide-react';
import { buildDiagnosticComparison } from '@/lib/diagnosticComparison';

const safeName = (name) => (name || 'archivo').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-');

export default function ComparisonExportButton({ analysisA, analysisB }) {
  const enabled = Boolean(analysisA && analysisB);
  const download = () => {
    if (!enabled) return;
    const report = buildDiagnosticComparison(analysisA, analysisB);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comparison-${safeName(analysisA.meta?.name)}-vs-${safeName(analysisB.meta?.name)}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <button onClick={download} disabled={!enabled} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
      <Download className="h-3.5 w-3.5" /> Exportar comparación JSON
    </button>
  );
}