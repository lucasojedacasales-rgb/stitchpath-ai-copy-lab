import { useState, useRef } from 'react';
import { FlaskConical, Download, Upload, Loader2, CheckCircle, AlertTriangle, XCircle, GitCompare } from 'lucide-react';
import { downloadTestFile, generateTestFile, compareToWilcomDSB, compareDSBToWilcom, listTests } from '@/lib/ce01FormatTestSuite';

/**
 * CE01FormatTestPanel — generates minimal test files in DST/DSB formats
 * to diagnose whether the Caydo CE01 accepts DST, DSB, or only Wilcom-style DSB.
 *
 * Each test file is generated directly from simple coordinates — no pipeline,
 * no planner, no optimizer, no autofix, no sanitizer.
 */
export default function CE01FormatTestPanel() {
  const [generating, setGenerating] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [referenceBuffer, setReferenceBuffer] = useState(null);
  const [referenceName, setReferenceName] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const fileInputRef = useRef(null);

  const tests = listTests();

  const handleDownload = (testId) => {
    setGenerating(testId);
    setLastResult(null);
    try {
      const meta = downloadTestFile(testId);
      setLastResult({ testId, meta, ok: true });
    } catch (e) {
      setLastResult({ testId, error: e.message, ok: false });
    } finally {
      setGenerating(null);
    }
  };

  const handleCompare = async () => {
    if (!referenceBuffer || !lastResult?.meta) return;
    setComparing(true);
    try {
      const { bytes } = generateTestFile(lastResult.testId);
      // Use DSB-specific comparison for DSB files, DST comparison otherwise
      const isDSB = lastResult.meta.format === 'DSB';
      const result = isDSB
        ? compareDSBToWilcom(referenceBuffer, bytes.buffer)
        : compareToWilcomDSB(referenceBuffer, bytes.buffer);
      setComparison(result);
    } catch (e) {
      console.error('[ce01-format-test] comparison error:', e);
    } finally {
      setComparing(false);
    }
  };

  const handleReferenceUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReferenceName(file.name);
    const buffer = await file.arrayBuffer();
    setReferenceBuffer(buffer);
    setComparison(null);
  };

  return (
    <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs font-bold text-amber-300">CE01 Format Tests</span>
        <span className="text-[10px] text-slate-600 ml-auto">Diagnóstico de formato</span>
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Archivos mínimos independientes del diseño. Generados directamente desde coordenadas simples —
        sin planner, optimizer, autofix, ni sanitizer. Sirven para aislar si la CE01 rechaza el encoder DST,
        el formato DST, o si necesita DSB/Barudan.
      </p>

      {/* Reference file upload */}
      <div>
        <label className="text-[10px] text-slate-600 mb-1 block">Referencia Wilcom .DSB (opcional)</label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161a23] border border-[#2a2d3a] text-slate-400 text-[10px] hover:text-white hover:border-[#3a3d4a] transition-colors"
          >
            <Upload className="w-3 h-3" />
            {referenceName || 'Subir .dsb'}
          </button>
          <input ref={fileInputRef} type="file" accept=".dsb,.dst" className="hidden" onChange={handleReferenceUpload} />
          {referenceName && (
            <button onClick={() => { setReferenceBuffer(null); setReferenceName(null); setComparison(null); }} className="text-[10px] text-red-400 hover:text-red-300">✕</button>
          )}
        </div>
      </div>

      {/* Test buttons */}
      <div className="space-y-1.5">
        {tests.map(({ id, format, label }) => {
          const isDst = format === 'DST';
          const color = isDst ? 'violet' : 'cyan';
          return (
            <button
              key={id}
              onClick={() => handleDownload(id)}
              disabled={generating !== null}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-bold transition-colors disabled:opacity-50 ${
                color === 'violet'
                  ? 'bg-violet-900/15 border-violet-500/30 text-violet-300 hover:bg-violet-900/25'
                  : 'bg-cyan-900/15 border-cyan-500/30 text-cyan-300 hover:bg-cyan-900/25'
              }`}
            >
              {generating === id
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Download className="w-3 h-3" />}
              <span className="flex-1 text-left">{id}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${isDst ? 'bg-violet-500/20 text-violet-400' : 'bg-cyan-500/20 text-cyan-400'}`}>
                {format}
              </span>
            </button>
          );
        })}
      </div>

      {/* Last result */}
      {lastResult && (
        <div className={`rounded-lg p-2.5 border ${lastResult.ok ? 'bg-emerald-900/15 border-emerald-500/30' : 'bg-red-900/15 border-red-500/30'}`}>
          <div className="flex items-center gap-1.5 mb-1">
            {lastResult.ok
              ? <CheckCircle className="w-3 h-3 text-emerald-400" />
              : <XCircle className="w-3 h-3 text-red-400" />}
            <span className={`text-[10px] font-bold ${lastResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {lastResult.testId}
            </span>
          </div>
          {lastResult.ok ? (
            <div className="space-y-0.5">
              <MiniRow label="Formato" value={lastResult.meta.format} />
              <MiniRow label="Puntadas" value={lastResult.meta.stitchCount} />
              <MiniRow label="Records" value={lastResult.meta.recordCount} />
              <MiniRow label="Tamaño" value={`${lastResult.meta.fileSize} B`} />
              <MiniRow label="Bounds" value={`${lastResult.meta.bounds.plusX}/${lastResult.meta.bounds.minusX}/${lastResult.meta.bounds.plusY}/${lastResult.meta.bounds.minusY}`} />
              <MiniRow label="Decoded" value={`${lastResult.meta.decodedBounds.plusX}/${lastResult.meta.decodedBounds.minusX}/${lastResult.meta.decodedBounds.plusY}/${lastResult.meta.decodedBounds.minusY}`} />
              <MiniRow label="AX/AY" value={`${lastResult.meta.finalX}/${lastResult.meta.finalY}`} />
            </div>
          ) : (
            <p className="text-[10px] text-red-300">{lastResult.error}</p>
          )}

          {/* Compare with reference button */}
          {lastResult.ok && referenceBuffer && (
            <button
              onClick={handleCompare}
              disabled={comparing}
              className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 text-amber-300 text-[10px] font-bold hover:bg-amber-600/30 transition-colors disabled:opacity-50"
            >
              {comparing
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Comparando...</>
                : <><GitCompare className="w-3 h-3" /> Comparar con referencia Wilcom</>}
            </button>
          )}
        </div>
      )}

      {/* Comparison result */}
      {comparison && (
        <ComparisonResult data={comparison} />
      )}
    </div>
  );
}

// ─── Comparison result ──────────────────────────────────────────────────

function ComparisonResult({ data }) {
  const { reference, generated, differences, rejectReasons, encodingMatch } = data;

  return (
    <div className="space-y-2.5">
      {/* Side-by-side */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-emerald-900/10 border border-emerald-500/30 rounded-lg p-2">
          <div className="text-[10px] font-bold text-emerald-400 mb-1">Referencia Wilcom</div>
          <MiniRow label="Tamaño" value={`${reference.fileSize}B`} />
          <MiniRow label="Records" value={reference.recordCount} />
          <MiniRow label="0x1A" value={reference.hasEof ? '✓' : '✗'} />
          <MiniRow label="Encoding" value={reference.encoding} />
          <MiniRow label="ST" value={reference.header?.ST ?? '—'} />
          <MiniRow label="Jumps" value={reference.analysis.jumps} />
          <MiniRow label="Stitches" value={reference.analysis.stitches} />
        </div>
        <div className="bg-cyan-900/10 border border-cyan-500/30 rounded-lg p-2">
          <div className="text-[10px] font-bold text-cyan-400 mb-1">Generado</div>
          <MiniRow label="Tamaño" value={`${generated.fileSize}B`} />
          <MiniRow label="Records" value={generated.recordCount} />
          <MiniRow label="0x1A" value={generated.hasEof ? '✓' : '✗'} />
          <MiniRow label="Encoding" value="—" />
          <MiniRow label="ST" value={generated.header?.ST ?? '—'} />
          <MiniRow label="Jumps" value={generated.analysis.jumps} />
          <MiniRow label="Stitches" value={generated.analysis.stitches} />
        </div>
      </div>

      {/* Reject reasons */}
      {rejectReasons.length > 0 ? (
        <div className="bg-red-900/15 border border-red-500/30 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span className="text-[10px] font-bold text-red-400">Causas probables de rechazo</span>
          </div>
          <div className="space-y-0.5">
            {rejectReasons.map((r, i) => (
              <div key={i} className="text-[10px] text-red-300 flex items-start gap-1">
                <XCircle className="w-2.5 h-2.5 text-red-400 shrink-0 mt-0.5" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-emerald-900/15 border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-[10px] font-bold text-emerald-400">Sin causas de rechazo detectadas</span>
        </div>
      )}

      {/* Differences */}
      {differences.length > 0 && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5">
          <div className="text-[10px] font-bold text-slate-400 mb-1.5">Diferencias</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {differences.map((d, i) => (
              <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1">
                <span className="text-amber-500 shrink-0">→</span>
                <span>{d.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-[9px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-bold truncate ml-2">{value}</span>
    </div>
  );
}