import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ShieldCheck, Microscope, GitCompareArrows, Eye, EyeOff,
  SquareDashed, Spline, Loader2, Lock, Boxes,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import FileDropzone from '@/components/diagnostic/FileDropzone';
import SummaryPanel from '@/components/diagnostic/SummaryPanel';
import RiskPanel from '@/components/diagnostic/RiskPanel';
import StitchCanvas from '@/components/diagnostic/StitchCanvas';
import ComparePanel from '@/components/diagnostic/ComparePanel';
import PhysicalHistoryPanel from '@/components/diagnostic/PhysicalHistoryPanel';
import DiagnosticExportPanel from '@/components/diagnostic/DiagnosticExportPanel';

// Session cache keyed by SHA-256 (never persisted to DB).
const sessionCache = new Map();

export default function EngineV2DiagnosticLab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState('inspector');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [viewOpts, setViewOpts] = useState({
    showStitches: true, showJumps: true, showEnvelope: true, showBlocks: true, showStartEnd: true,
  });

  // A / B slots for comparison.
  const [slotA, setSlotA] = useState(null);
  const [slotB, setSlotB] = useState(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);

  const workerRef = useRef(null);
  const jobIdRef = useRef(0);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const inspectorEntries = useMemo(() => {
    if (!analysis?.geometry) return [];
    return [{ geom: analysis.geometry, blocks: analysis.blocks, stitchColor: '#a78bfa', jumpColor: '#f59e0b', opacity: 1, label: 'design' }];
  }, [analysis]);

  const computeSha = async (bytes) => {
    try {
      const buf = await crypto.subtle.digest('SHA-256', bytes.buffer || bytes);
      const arr = new Uint8Array(buf);
      let hex = '';
      for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
      return hex;
    } catch {
      return 'local-' + bytes.length + '-' + Date.now();
    }
  };

  const runAnalysis = async (file, slot) => {
    if (!file) return;
    setLoadError(null);
    const setBusy = slot === 'A' ? setLoadingA : slot === 'B' ? setLoadingB : setLoading;
    const setResult = slot === 'A' ? setSlotA : slot === 'B' ? setSlotB : setAnalysis;

    // Cancel any in-flight worker.
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    setBusy(true);
    try {
      const sha = await computeSha(file.bytes);
      if (sessionCache.has(sha)) {
        setResult(sessionCache.get(sha));
        setBusy(false);
        return;
      }
      const id = ++jobIdRef.current;
      const worker = new Worker(new URL('../workers/diagnostic.worker.js', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event) => {
        if (event.data?.id !== id) return; // stale
        if (event.data?.type === 'done') {
          const res = event.data.analysis;
          if (res?.meta?.sha256) sessionCache.set(res.meta.sha256, res);
          setResult(res);
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          setBusy(false);
        } else if (event.data?.type === 'error') {
          setLoadError(event.data.message);
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          setBusy(false);
        }
      };
      worker.onerror = (e) => {
        setLoadError(e.message || 'Error en el worker de análisis');
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        setBusy(false);
      };
      worker.postMessage({ type: 'analyze', id, name: file.name, bytes: file.bytes, sha256: sha }, [file.bytes.buffer]);
    } catch (e) {
      setLoadError(e?.message || 'No se pudo analizar el archivo.');
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0d0f14] text-slate-200 p-6">
        <div className="mx-auto max-w-md rounded-xl border border-red-500/30 bg-red-900/10 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-red-400" />
          <h1 className="mt-3 text-sm font-bold text-white">Acceso restringido</h1>
          <p className="mt-1 text-xs text-slate-400">Engine V2 Diagnostic Lab es una herramienta interna exclusiva para administradores.</p>
          <button onClick={() => navigate('/')} className="mt-4 rounded-lg bg-[#161a23] border border-[#2a2d3a] px-3 py-2 text-xs text-slate-300 hover:border-violet-500">
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0f14] text-slate-200 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-900/30 border border-violet-500/40">
            <Microscope className="h-5 w-5 text-violet-400" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Engine V2 Diagnostic Lab</h1>
            <p className="text-xs text-slate-500">Inspección, comparación y validación de archivos de bordado. Solo lectura — no modifica el motor.</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-md bg-emerald-900/20 border border-emerald-500/30 px-2 py-1 text-[10px] font-semibold text-emerald-300">
            <ShieldCheck className="h-3 w-3" /> ADMIN
          </span>
          <button onClick={() => navigate('/')} className="flex items-center gap-2 rounded-lg bg-[#161a23] border border-[#2a2d3a] px-3 py-2 text-xs font-bold text-slate-300 hover:border-violet-500">
            <ArrowLeft className="h-3.5 w-3.5" /> Inicio
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-[#1e2130] bg-[#0d0f14] p-1">
          <button
            onClick={() => setTab('inspector')}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold ${tab === 'inspector' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Boxes className="h-3.5 w-3.5" /> Inspector
          </button>
          <button
            onClick={() => setTab('compare')}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold ${tab === 'compare' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <GitCompareArrows className="h-3.5 w-3.5" /> Comparación A / B
          </button>
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-500/40 bg-red-900/20 p-3 text-[11px] text-red-300">
            {loadError}
          </div>
        )}

        {tab === 'inspector' && (
          <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
            {/* Left column */}
            <div className="space-y-4">
              <FileDropzone label="Cargar archivo (DST / DSB / JSON)" loading={loading} onFile={(f) => f && runAnalysis(f, 'main')} />
              {loading && (
                <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-950/10 p-3 text-[11px] text-violet-200">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analizando en Web Worker…
                </div>
              )}
              {analysis && <SummaryPanel analysis={analysis} />}
              {analysis && <RiskPanel risks={analysis.risks} />}
              {analysis && <PhysicalHistoryPanel sha256={analysis.meta?.sha256} fileName={analysis.meta?.name} />}
            </div>

            {/* Right column — viewer */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#1e2130] bg-[#0d0f14] p-2">
                <Toggle active={viewOpts.showStitches} onClick={() => setViewOpts((v) => ({ ...v, showStitches: !v.showStitches }))} icon={Spline} label="Puntadas" />
                <Toggle active={viewOpts.showJumps} onClick={() => setViewOpts((v) => ({ ...v, showJumps: !v.showJumps }))} icon={SquareDashed} label="Jumps" />
                <Toggle active={viewOpts.showEnvelope} onClick={() => setViewOpts((v) => ({ ...v, showEnvelope: !v.showEnvelope }))} icon={Eye} label="Envolvente" />
                <Toggle active={viewOpts.showBlocks} onClick={() => setViewOpts((v) => ({ ...v, showBlocks: !v.showBlocks }))} icon={Boxes} label="Bloques" />
                <Toggle active={viewOpts.showStartEnd} onClick={() => setViewOpts((v) => ({ ...v, showStartEnd: !v.showStartEnd }))} icon={Eye} label="Inicio/Fin" />
              </div>

              {analysis?.geometry ? (
                <StitchCanvas entries={inspectorEntries} options={viewOpts} height={560} />
              ) : (
                <div className="flex h-[560px] items-center justify-center rounded-xl border border-[#2a2d3a] bg-[#0b0d12] text-center">
                  <div className="space-y-2">
                    <Microscope className="mx-auto h-8 w-8 text-slate-700" />
                    <p className="text-xs text-slate-600">Carga un archivo para visualizar la trayectoria.</p>
                  </div>
                </div>
              )}

              {analysis && <DiagnosticExportPanel analysis={analysis} />}
              {analysis?.json && (
                <JsonInspection json={analysis.json} kind={analysis.summary?.kind} />
              )}
            </div>
          </div>
        )}

        {tab === 'compare' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FileDropzone label="Archivo A" loading={loadingA} onFile={(f) => f && runAnalysis(f, 'A')} />
              <FileDropzone label="Archivo B" loading={loadingB} onFile={(f) => f && runAnalysis(f, 'B')} />
            </div>
            <ComparePanel analysisA={slotA} analysisB={slotB} />
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
        active ? 'border-violet-500/50 bg-violet-900/20 text-violet-200' : 'border-[#2a2d3a] bg-[#0d0f14] text-slate-500'
      }`}
    >
      {Icon ? <Icon className="h-3 w-3" /> : active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      {label}
    </button>
  );
}

function JsonInspection({ json, kind }) {
  return (
    <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
        Inspección JSON — {kind || 'generic'}
      </div>
      <pre className="max-h-64 overflow-auto text-[10px] text-slate-300 font-mono">
        {JSON.stringify(json, null, 2)}
      </pre>
    </div>
  );
}