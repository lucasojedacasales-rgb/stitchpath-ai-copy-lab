import { useState, useCallback } from 'react';
import { Download, FileText, FlaskConical, ShieldCheck, ShieldAlert } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { runUniversalExportAcceptanceTest } from '@/lib/universalExportAcceptanceTest';

export default function UniversalExportAcceptanceTestPanel({ commands, objects, regions, config, machineSettings, projectName }) {
  const [running, setRunning] = useState(false);
  const [test, setTest] = useState(null);
  const [error, setError] = useState(null);

  const runTest = useCallback(async () => {
    if (!commands?.length) {
      setError('No hay comandos finales para validar.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const result = await runUniversalExportAcceptanceTest({
        commands, objects, regions, config, machineSettings, projectName, base44,
      });
      setTest(result);
    } catch (e) {
      setError(e.message || 'No se pudo ejecutar la prueba universal.');
    } finally {
      setRunning(false);
    }
  }, [commands, objects, regions, config, machineSettings, projectName]);

  const downloadReport = useCallback(() => {
    if (!test?.report) return;
    downloadBytes(new TextEncoder().encode(test.report), 'UNIVERSAL_EXPORT_ACCEPTANCE_TEST_REPORT_V1.md', 'text/markdown');
  }, [test]);

  const downloadFile = useCallback((kind) => {
    const file = test?.files?.[kind];
    if (!file?.bytes) return;
    downloadBytes(file.bytes, file.filename, 'application/octet-stream');
  }, [test]);

  const ready = test?.result?.universalExportReady;

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-900/10 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-cyan-300" />
            <h3 className="text-sm font-bold text-white">UNIVERSAL_EXPORT_ACCEPTANCE_TEST_V1</h3>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Prueba solo lectura: universal → formato DST/DSB → archivo generado.</p>
        </div>
        <button onClick={runTest} disabled={running || !commands?.length} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors disabled:opacity-40">
          <FlaskConical className="w-3.5 h-3.5" />
          {running ? 'Probando...' : 'Ejecutar prueba'}
        </button>
      </div>

      {error && <div className="text-[11px] text-red-300 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      {test && (
        <div className="space-y-3">
          <div className={`rounded-lg border px-3 py-2 ${ready ? 'border-emerald-500/30 bg-emerald-900/15' : 'border-red-500/30 bg-red-900/15'}`}>
            <div className="flex items-center gap-2">
              {ready ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldAlert className="w-4 h-4 text-red-400" />}
              <span className={`text-xs font-bold ${ready ? 'text-emerald-300' : 'text-red-300'}`}>{ready ? 'Listo para prueba física' : 'Bloqueado por causa real'}</span>
              <span className="ml-auto text-[10px] text-slate-400">Formato recomendado: <b className="text-cyan-300">{test.result.recommendedMachineTestFormat}</b></span>
            </div>
            <div className="mt-1 text-[10px] text-slate-400">{test.result.nextAction}</div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <Metric label="Universal" value={test.result.universalStatus} />
            <Metric label="DST" value={test.result.dstStatus} />
            <Metric label="DSB" value={test.result.dsbStatus} />
            <Metric label="Puntadas" value={test.result.totalStitches} />
            <Metric label="Bloqueo 12000" value={String(test.result.old12000LimitBlocking)} />
            <Metric label="CE01 estricto" value={String(test.result.ce01StrictMode)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={downloadReport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-900/20 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-900/30 transition-colors">
              <FileText className="w-3.5 h-3.5" /> Informe MD
            </button>
            {test.files.dst && test.result.dstStatus !== 'INVALID' && (
              <button onClick={() => downloadFile('dst')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-900/30 transition-colors">
                <Download className="w-3.5 h-3.5" /> DST prueba
              </button>
            )}
            {test.files.dsb && test.result.dsbStatus !== 'INVALID' && (
              <button onClick={() => downloadFile('dsb')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-900/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-900/30 transition-colors">
                <Download className="w-3.5 h-3.5" /> DSB prueba
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] px-2 py-1.5">
      <div className="text-slate-500">{label}</div>
      <div className="font-bold text-slate-200 truncate">{value}</div>
    </div>
  );
}

function downloadBytes(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}