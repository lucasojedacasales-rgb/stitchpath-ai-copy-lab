import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { runMinimalBinaryExportTest } from '@/lib/minimalBinaryExportTest';

export default function BinaryMinimalTestPanel({ machineSettings }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const runTest = async () => {
    setRunning(true);
    try {
      const res = await runMinimalBinaryExportTest({ base44Client: base44, machineSettings });
      setResult(res);
      downloadBlob(res.dst.blob, 'MINIMAL_TEST.dst');
      if (res.dsb.blob) downloadBlob(res.dsb.blob, 'MINIMAL_TEST.dsb');
    } catch (error) {
      setResult({ error: error.message || String(error) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={runTest}
        disabled={running}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#0d0f14] border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-900/20 transition-colors disabled:opacity-40"
      >
        <Download className="w-3.5 h-3.5" />
        {running ? 'Probando binario mínimo...' : 'Test binario mínimo'}
      </button>
      {result && (
        <div className="text-[10px] text-slate-300 bg-[#0d0f14] border border-[#2a2d3a] rounded-lg p-2 space-y-1">
          <div className="flex items-center gap-1 text-emerald-300 font-bold"><FileText className="w-3 h-3" /> Resultado mínimo</div>
          {result.error ? <div className="text-red-300">{result.error}</div> : <>
            <div>DST: size={result.dst.blobSizeBytes} parseable={String(result.dst.parseable)} end={String(result.dst.endPresent)}</div>
            <div>DSB: size={result.dsb.blobSizeBytes} parseable={String(result.dsb.parseable)} end={String(result.dsb.endPresent)}</div>
            {result.dsb.error && <div className="text-red-300">DSB error: {result.dsb.error}</div>}
          </>}
        </div>
      )}
    </div>
  );
}

function downloadBlob(blob, fileName) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}