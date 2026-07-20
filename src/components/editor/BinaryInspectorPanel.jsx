import { useState, useRef } from 'react';
import { FileSearch, Upload, ShieldCheck, ShieldAlert, ShieldX, Loader2, FileText, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { encodeToFile } from '@/lib/exportPipeline';
import {
  validateForCaydoCE01Binary,
  compareWithWilcomReference,
  parseEmbroideryHeader,
  validateRecordStructure,
} from '@/lib/embroideryBinaryInspector';

/**
 * BinaryInspectorPanel — diagnostic tool that encodes the current design to a
 * binary embroidery file and inspects its structure against Wilcom-style
 * references and Caydo CE01 requirements.
 *
 * Shows: structure validity, Wilcom-style match, CE01 rejection risk, and
 * the likely reject reason.
 */
export default function BinaryInspectorPanel({ commands, objects, format, machineSettings, ce01ProductionMode, editorFinalCommands, editorFinalObjects }) {
  const [inspecting, setInspecting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [referenceBuffer, setReferenceBuffer] = useState(null);
  const [referenceName, setReferenceName] = useState(null);
  const fileInputRef = useRef(null);

  const sourceCommands = ce01ProductionMode ? (editorFinalCommands || commands) : commands;
  const sourceObjects = ce01ProductionMode ? (editorFinalObjects || objects) : objects;

  const handleInspect = async () => {
    if (!sourceCommands || sourceCommands.length === 0) {
      setError('No hay comandos para inspeccionar');
      return;
    }
    setInspecting(true);
    setError(null);
    setResult(null);
    try {
      const blob = await encodeToFile(sourceCommands, sourceObjects, format, machineSettings, base44);
      const buffer = await blob.arrayBuffer();

      if (referenceBuffer) {
        const comparison = compareWithWilcomReference(referenceBuffer, buffer, format);
        setResult({ type: 'comparison', data: comparison });
      } else {
        const ce01Report = validateForCaydoCE01Binary(buffer, format);
        const structure = validateRecordStructure(buffer, format);
        const header = parseEmbroideryHeader(buffer);
        setResult({ type: 'single', data: { ce01Report, structure, header } });
      }
    } catch (e) {
      console.error('[binary-inspector]', e);
      setError(e.message || 'Error al inspeccionar el archivo');
    } finally {
      setInspecting(false);
    }
  };

  const handleReferenceUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReferenceName(file.name);
    const buffer = await file.arrayBuffer();
    setReferenceBuffer(buffer);
  };

  return (
    <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileSearch className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-xs font-bold text-cyan-300">Inspector binario</span>
        <span className="text-[10px] text-slate-600 ml-auto">DST / DSB</span>
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Codifica el diseño actual a archivo binario y verifica estructura, cabecera, END, byte 0x1A,
        y compatibilidad con Caydo CE01. Detecta por qué la máquina hace doble pitido y rechaza.
      </p>

      {/* Reference file upload */}
      <div>
        <label className="text-[10px] text-slate-600 mb-1 block">Archivo de referencia Wilcom (opcional)</label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161a23] border border-[#2a2d3a] text-slate-400 text-[10px] hover:text-white hover:border-[#3a3d4a] transition-colors"
          >
            <Upload className="w-3 h-3" />
            {referenceName || 'Subir .dst/.dsb'}
          </button>
          <input ref={fileInputRef} type="file" accept=".dst,.dsb" className="hidden" onChange={handleReferenceUpload} />
          {referenceName && (
            <button
              onClick={() => { setReferenceBuffer(null); setReferenceName(null); }}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Inspect button */}
      <button
        onClick={handleInspect}
        disabled={inspecting}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
      >
        {inspecting
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Codificando e inspeccionando...</>
          : <><FileSearch className="w-3.5 h-3.5" /> Inspeccionar archivo generado</>}
      </button>

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 text-[10px] text-red-300">
          {error}
        </div>
      )}

      {/* Results — single file inspection */}
      {result?.type === 'single' && (
        <SingleResult data={result.data} />
      )}

      {/* Results — comparison with reference */}
      {result?.type === 'comparison' && (
        <ComparisonResult data={result.data} />
      )}
    </div>
  );
}

// ─── Single file result ─────────────────────────────────────────────────

function SingleResult({ data }) {
  const { ce01Report, structure, header } = data;
  const StatusIcon = ce01Report.status === 'SAFE' ? ShieldCheck
    : ce01Report.status === 'RISKY' ? ShieldAlert : ShieldX;
  const statusColor = ce01Report.status === 'SAFE' ? 'text-emerald-400'
    : ce01Report.status === 'RISKY' ? 'text-amber-400' : 'text-red-400';
  const statusBg = ce01Report.status === 'SAFE' ? 'bg-emerald-900/20 border-emerald-500/40'
    : ce01Report.status === 'RISKY' ? 'bg-amber-900/20 border-amber-500/40' : 'bg-red-900/20 border-red-500/40';

  return (
    <div className="space-y-2.5">
      {/* CE01 status */}
      <div className={`${statusBg} border rounded-lg px-3 py-2.5 flex items-center gap-2`}>
        <StatusIcon className={`w-4 h-4 ${statusColor}`} />
        <span className={`text-xs font-bold ${statusColor}`}>CE01: {ce01Report.status}</span>
        <span className={`text-[10px] ml-auto ${ce01Report.ce01BinaryReady ? 'text-emerald-400' : 'text-red-400'}`}>
          {ce01Report.ce01BinaryReady ? 'Binariamente listo' : 'Rechazado'}
        </span>
      </div>

      {/* Likely reject reason */}
      {ce01Report.blockingIssues.length > 0 && (
        <div className="bg-red-900/15 border border-red-500/30 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span className="text-[10px] font-bold text-red-400">Razón probable de rechazo</span>
          </div>
          <div className="space-y-0.5">
            {ce01Report.blockingIssues.map((issue, i) => (
              <div key={i} className="text-[10px] text-red-300 flex items-start gap-1">
                <XCircle className="w-2.5 h-2.5 text-red-400 shrink-0 mt-0.5" />
                <span>{issue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {ce01Report.warnings.length > 0 && (
        <div className="bg-amber-900/15 border border-amber-500/30 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] font-bold text-amber-400">Advertencias</span>
          </div>
          <div className="space-y-0.5">
            {ce01Report.warnings.map((w, i) => (
              <div key={i} className="text-[10px] text-amber-300 flex items-start gap-1">
                <span className="text-amber-500 shrink-0">•</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Structure report */}
      <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5 space-y-1">
        <div className="text-[10px] font-bold text-slate-400 mb-1 flex items-center gap-1">
          <FileText className="w-3 h-3 text-cyan-400" /> Estructura binaria
        </div>
        <Row label="Tamaño archivo" value={`${structure.fileSize} B`} ok={structure.fileSize > 512} />
        <Row label="Cabecera 512" value={structure.hasHeader512 ? '✓' : '✗'} ok={structure.hasHeader512} />
        <Row label="Records (3B)" value={structure.recordCount} ok={structure.recordCount > 0} />
        <Row label="Byte final 0x1A" value={structure.hasEofByte ? '✓' : '✗'} ok={structure.hasEofByte} />
        <Row label="Bytes sobrantes" value={structure.trailingBytes} ok={structure.trailingBytes === 0} />
        <Row label="Estructura válida" value={structure.structureValid ? '✓' : '✗'} ok={structure.structureValid} />
      </div>

      {/* Header report */}
      <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5 space-y-1">
        <div className="text-[10px] font-bold text-slate-400 mb-1">Cabecera ASCII</div>
        <Row label="ST declarado" value={ce01Report.headerReport.ST ?? '—'} ok={ce01Report.headerReport.ST !== null} />
        <Row label="ST real" value={ce01Report.recordReport.actualStitches} ok={ce01Report.recordReport.stMatch} />
        <Row label="ST coincide" value={ce01Report.recordReport.stMatch ? '✓' : '✗'} ok={ce01Report.recordReport.stMatch} />
        <Row label="CO colores" value={ce01Report.headerReport.CO ?? '—'} ok={ce01Report.headerReport.CO !== null} />
        <Row label="END command" value={ce01Report.recordReport.hasEnd ? '✓' : '✗'} ok={ce01Report.recordReport.hasEnd} />
        <Row label="Cambios color" value={ce01Report.recordReport.colorChanges} ok={ce01Report.recordReport.colorChanges <= 5} />
      </div>

      {/* Size report */}
      <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5 space-y-1">
        <div className="text-[10px] font-bold text-slate-400 mb-1">Dimensiones</div>
        <Row label="Ancho" value={`${ce01Report.sizeReport.widthMm}mm`} ok={ce01Report.sizeReport.widthMm <= 95} />
        <Row label="Alto" value={`${ce01Report.sizeReport.heightMm}mm`} ok={ce01Report.sizeReport.heightMm <= 95} />
        <Row label="Área segura" value={ce01Report.sizeReport.withinSafeArea ? '✓' : '✗'} ok={ce01Report.sizeReport.withinSafeArea} />
      </div>

      {/* Recommendation */}
      <div className="bg-violet-900/10 border border-violet-500/30 rounded-lg px-3 py-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle className="w-3 h-3 text-violet-400" />
          <span className="text-[10px] font-bold text-violet-300">Recomendación</span>
        </div>
        <p className="text-[10px] text-slate-400 mt-1">{ce01Report.recommendation}</p>
      </div>
    </div>
  );
}

// ─── Comparison result ──────────────────────────────────────────────────

function ComparisonResult({ data }) {
  const { reference, generated, differences, likelyRejectReasons, recommendations } = data;

  return (
    <div className="space-y-2.5">
      {/* Side-by-side summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-emerald-900/10 border border-emerald-500/30 rounded-lg p-2">
          <div className="text-[10px] font-bold text-emerald-400 mb-1">Referencia Wilcom</div>
          <MiniRow label="Tamaño" value={`${reference.fileSize}B`} />
          <MiniRow label="Records" value={reference.recordCount} />
          <MiniRow label="0x1A" value={reference.eofByte ? '✓' : '✗'} />
          <MiniRow label="Válido" value={reference.structureValid ? '✓' : '✗'} />
        </div>
        <div className="bg-cyan-900/10 border border-cyan-500/30 rounded-lg p-2">
          <div className="text-[10px] font-bold text-cyan-400 mb-1">Generado</div>
          <MiniRow label="Tamaño" value={`${generated.fileSize}B`} />
          <MiniRow label="Records" value={generated.recordCount} />
          <MiniRow label="0x1A" value={generated.eofByte ? '✓' : '✗'} />
          <MiniRow label="Válido" value={generated.structureValid ? '✓' : '✗'} />
        </div>
      </div>

      {/* Likely reject reasons */}
      {likelyRejectReasons.length > 0 ? (
        <div className="bg-red-900/15 border border-red-500/30 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span className="text-[10px] font-bold text-red-400">Razones probables de rechazo CE01</span>
          </div>
          <div className="space-y-0.5">
            {likelyRejectReasons.map((r, i) => (
              <div key={i} className="text-[10px] text-red-300 flex items-start gap-1">
                <XCircle className="w-2.5 h-2.5 text-red-400 shrink-0 mt-0.5" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-emerald-900/15 border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-[10px] font-bold text-emerald-400">Sin causas de rechazo detectadas</span>
        </div>
      )}

      {/* Differences */}
      {differences.length > 0 && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5">
          <div className="text-[10px] font-bold text-slate-400 mb-1.5">Diferencias estructurales</div>
          <div className="space-y-1">
            {differences.map((d, i) => (
              <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1">
                <span className="text-amber-500 shrink-0">→</span>
                <span>{d.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="bg-violet-900/10 border border-violet-500/30 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle className="w-3 h-3 text-violet-400" />
            <span className="text-[10px] font-bold text-violet-300">Recomendaciones</span>
          </div>
          <div className="space-y-0.5">
            {recommendations.map((r, i) => (
              <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1">
                <span className="text-violet-500 shrink-0">•</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function Row({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-slate-500">{label}</span>
      <span className={`font-bold ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{value}</span>
    </div>
  );
}

function MiniRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-[9px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-bold">{value}</span>
    </div>
  );
}