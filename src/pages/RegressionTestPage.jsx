import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Activity, CheckCircle, XCircle, Download, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * RegressionTestPage — runs the real embroidery motor against synthetic
 * fixtures and renders the PASS/FAIL report. Offers the full Markdown report
 * as a download (REGRESSION_RUNTIME_REPORT.md).
 */
export default function RegressionTestPage() {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const workerRef = useRef(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const run = () => {
    workerRef.current?.terminate();
    setRunning(true);
    setError(null);
    const startedAt = performance.now();
    requestAnimationFrame(() => {
      const worker = new Worker(new URL('../workers/regression.worker.js', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event) => {
        if (event.data?.type === 'complete') {
          setResult(event.data.result);
          console.log('[PERF] regressionWorkerRunMs', Math.round(performance.now() - startedAt));
          setRunning(false);
          worker.terminate();
          workerRef.current = null;
        } else if (event.data?.type === 'error') {
          setError(`${event.data.message}\n${event.data.stack || ''}`);
          setRunning(false);
          worker.terminate();
          workerRef.current = null;
        }
      };
      worker.onerror = (event) => {
        setError(event.message || 'No se pudo ejecutar la suite de regresión');
        setRunning(false);
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage({ type: 'run' });
    });
  };

  const downloadMd = () => {
    if (!result) return;
    const blob = new Blob([result.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'REGRESSION_RUNTIME_REPORT.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0d0f14] text-slate-200 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-900/30 border border-violet-500/40 flex items-center justify-center">
            <Activity className="w-5 h-5 text-violet-400" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Suite de Regresión — StitchPath AI</h1>
            <p className="text-xs text-slate-500">Ejecuta el motor real contra fixtures sintéticos. Sin datos de preview.</p>
          </div>
          <button onClick={() => { workerRef.current?.terminate(); navigate('/'); }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a] hover:border-violet-500 text-slate-300 text-xs font-bold">
            <ArrowLeft className="w-3.5 h-3.5" /> Volver
          </button>
          <button onClick={run} disabled={running}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold">
            <Play className="w-3.5 h-3.5" /> {running ? 'Ejecutando...' : 'Re-ejecutar'}
          </button>
          <button onClick={downloadMd} disabled={!result}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161a23] border border-[#2a2d3a] hover:border-violet-500 disabled:opacity-40 text-slate-300 text-xs font-bold">
            <Download className="w-3.5 h-3.5" /> Descargar MD
          </button>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-500/40 rounded-lg p-3 text-xs text-red-300 whitespace-pre-wrap font-mono">
            {error}
          </div>
        )}

        {!result && !running && !error && (
          <div className="rounded-lg border border-[#1e2130] bg-[#161a23] p-8 text-center">
            <p className="text-sm font-semibold text-slate-300">La suite está lista</p>
            <p className="mt-1 text-xs text-slate-500">El motor se cargará únicamente cuando pulses “Re-ejecutar”.</p>
          </div>
        )}

        {running && !result && (
          <div className="flex items-center justify-center gap-3 rounded-lg border border-violet-500/20 bg-violet-950/10 p-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            <span className="text-xs text-violet-200">Cargando módulos y ejecutando pruebas…</span>
          </div>
        )}

        {result && (
          <>
            <div className="flex items-center gap-4 bg-[#161a23] border border-[#1e2130] rounded-lg p-3">
              <div className="text-sm">
                <span className="text-slate-500">Total: </span>
                <span className="font-bold text-white">{result.summary.total}</span>
              </div>
              <div className="text-sm flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-emerald-400">{result.summary.pass}</span>
              </div>
              <div className="text-sm flex items-center gap-1">
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="font-bold text-red-400">{result.summary.fail}</span>
              </div>
            </div>

            <div className="bg-[#161a23] border border-[#1e2130] rounded-lg overflow-hidden">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-[#1e2130] text-slate-500">
                    <th className="text-left px-3 py-2">Prueba</th>
                    <th className="text-center px-2 py-2">Estado</th>
                    <th className="text-right px-2 py-2">Puntadas</th>
                    <th className="text-right px-2 py-2">Saltos</th>
                    <th className="text-right px-2 py-2">Trims</th>
                    <th className="text-right px-2 py-2">Colores</th>
                    <th className="text-center px-2 py-2">CE01</th>
                    <th className="text-center px-2 py-2">Outer</th>
                    <th className="text-center px-2 py-2">Detail</th>
                    <th className="text-left px-3 py-2">Observaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tests.map(t => (
                    <tr key={t.name} className="border-b border-[#1e2130] last:border-0">
                      <td className="px-3 py-2 text-slate-300 font-medium">{t.name}</td>
                      <td className="px-2 py-2 text-center font-bold">
                        {t.pass ? <span className="text-emerald-400">PASS</span> : <span className="text-red-400">FAIL</span>}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-300 font-mono">{t.metrics.stitchCount}</td>
                      <td className="px-2 py-2 text-right text-slate-300 font-mono">{t.metrics.jumpCount}</td>
                      <td className="px-2 py-2 text-right text-slate-300 font-mono">{t.metrics.trimCount}</td>
                      <td className="px-2 py-2 text-right text-slate-300 font-mono">{t.metrics.colorCount}</td>
                      <td className="px-2 py-2 text-center">
                        <span className={t.metrics.ce01Status === 'SAFE' ? 'text-emerald-400' : t.metrics.ce01Status === 'RISKY' ? 'text-amber-400' : 'text-red-400'}>
                          {t.metrics.ce01Status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center text-slate-300 font-mono">{t.metrics.outerOutlineCount}</td>
                      <td className="px-2 py-2 text-center text-slate-300 font-mono">{t.metrics.detailOpenCurveCount}</td>
                      <td className="px-3 py-2 text-red-300 text-[10px]">{t.fails.join('; ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {result.tests.map(t => (
                <div key={t.name} className="bg-[#161a23] border border-[#1e2130] rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    {t.pass ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                    <span className="text-sm font-bold text-white">{t.name}</span>
                    <span className={`text-xs font-bold ml-auto ${t.pass ? 'text-emerald-400' : 'text-red-400'}`}>{t.pass ? 'PASS' : 'FAIL'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                    <Metric label="darkPixels" value={t.metrics.rawDarkPixels} />
                    <Metric label="components" value={t.metrics.darkComponents} />
                    <Metric label="rawSegs" value={t.metrics.rawSkeletonSegments} />
                    <Metric label="consolidated" value={t.metrics.consolidatedContours} />
                    <Metric label="outer" value={t.metrics.outerOutlineCount} />
                    <Metric label="inner" value={t.metrics.innerOutlineCount} />
                    <Metric label="detail" value={t.metrics.detailOpenCurveCount} />
                    <Metric label="noise" value={t.metrics.rejectedNoiseCount} />
                    <Metric label="fillBnd" value={t.metrics.rejectedFillBoundaryCount} />
                    <Metric label="stitches" value={t.metrics.stitchCount} />
                    <Metric label="jumps" value={t.metrics.jumpCount} />
                    <Metric label="trims" value={t.metrics.trimCount} />
                    <Metric label="colors" value={t.metrics.colorCount} />
                    <Metric label="artificial" value={t.metrics.artificialGeometryCount} />
                    <Metric label="fillExport" value={t.metrics.fillBoundaryExported ? 'YES' : 'no'} />
                    <Metric label="mouth" value={t.metrics.mouthExported ? 'YES' : 'no'} />
                    <Metric label="eyes" value={t.metrics.eyesExported ? 'YES' : 'no'} />
                    <Metric label="lower" value={t.metrics.lowerContourExported ? 'YES' : 'no'} />
                    <Metric label="feet" value={t.metrics.feetContourExported ? 'YES' : 'no'} />
                    <Metric label="darkSupp" value={(t.metrics.minPathDarkSupport ?? 0).toFixed(2)} />
                    <Metric label="longSegs" value={t.metrics.longStraightSegments} />
                    <Metric label="coverage" value={t.metrics.darkContourCoverage + '%'} />
                  </div>
                  {(t.errors.length > 0) && (
                    <div className="mt-2 text-[10px] text-red-300">
                      {t.errors.map((e, i) => <div key={i}>exec: {e}</div>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
      <div className="text-[8px] text-slate-600 uppercase">{label}</div>
      <div className="text-slate-300 font-mono font-bold">{value}</div>
    </div>
  );
}