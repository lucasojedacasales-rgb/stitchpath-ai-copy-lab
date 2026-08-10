import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileImage, Loader2, Play, ShieldAlert } from 'lucide-react';
import { adaptLegacyRasterPipelineResultToEngineV2Input } from '../../lib/engineV2Bridge/legacyRasterToEngineV2Input.js';
import { runExperimentalRasterEngineV2Connector } from '../../lib/engineV2Bridge/runExperimentalRasterEngineV2Connector.js';
import {
  YOSHI_T2_ARTIFACT_NAMES,
  YOSHI_T2_EXPECTED_FILE,
  YOSHI_T2_REQUIRED_STAGES,
  downloadYoshiT2Artifact,
  executeYoshiT2DiagnosticRun,
  inspectYoshiT2File,
  validateYoshiT2FileSelection,
} from '../../lib/engineV2Bridge/yoshiT2DiagnosticArtifacts.js';

const INITIAL_PROGRESS = Object.freeze(Object.fromEntries(
  YOSHI_T2_REQUIRED_STAGES.map(stage => [stage, 'pending']),
));
const defaultCreateInputObjectURL = value => URL.createObjectURL(value);
const defaultRevokeInputObjectURL = value => URL.revokeObjectURL(value);
const defaultCommitState = commit => commit();

function fileValue(metadata, key) {
  return metadata?.[key] ?? '—';
}

function MetadataRow({ label, expected, observed, valid }) {
  return (
    <div className="grid grid-cols-[110px_1fr_1fr] gap-2 border-b border-[#242938] py-1.5 last:border-0">
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className="break-all font-mono text-[10px] text-slate-400">{expected}</dd>
      <dd className={`break-all font-mono text-[10px] ${valid ? 'text-emerald-300' : 'text-slate-300'}`}>
        {observed}
      </dd>
    </div>
  );
}

function stageTone(status) {
  if (status === 'completed') return 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300';
  if (status === 'running') return 'border-violet-500/30 bg-violet-950/20 text-violet-200';
  return 'border-slate-700 bg-slate-900/30 text-slate-500';
}

function failedExecution(code = 'T2_EXECUTION_FAILED') {
  return Object.freeze({ ok: false, code, artifacts: null, summary: null });
}

function errorCode(caught) {
  return typeof caught?.code === 'string' && caught.code.length > 0
    ? caught.code
    : 'T2_EXECUTION_FAILED';
}

function inspectionErrorCode(caught) {
  return typeof caught?.code === 'string' && caught.code.length > 0
    ? caught.code
    : 'T2_YOSHI_FILE_INSPECTION_FAILED';
}

export function commitIfCurrent(mountedRef, tokenRef, expectedToken, commit) {
  if (mountedRef.current !== true || tokenRef.current !== expectedToken || typeof commit !== 'function') {
    return false;
  }
  commit();
  return true;
}

export default function YoshiT2RunnerPanel({
  inspectFile = inspectYoshiT2File,
  executeRun = executeYoshiT2DiagnosticRun,
  runConnector = runExperimentalRasterEngineV2Connector,
  adaptLegacy = adaptLegacyRasterPipelineResultToEngineV2Input,
  downloadArtifact = downloadYoshiT2Artifact,
  createInputObjectURL = defaultCreateInputObjectURL,
  revokeInputObjectURL = defaultRevokeInputObjectURL,
  commitState = defaultCommitState,
} = {}) {
  const mountedRef = useRef(true);
  const inspectionTokenRef = useRef(0);
  const executionTokenRef = useRef(0);
  const uiExecutionGateRef = useRef(false);
  const executionGate = useRef(false);
  const activeObjectUrlRef = useRef(null);
  const objectUrlControllerDisposedRef = useRef(false);
  const runResultRef = useRef(null);
  const [selection, setSelection] = useState({
    status: 'idle',
    file: null,
    metadata: null,
    code: null,
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const [runResult, setRunResult] = useState(null);

  const commitAsyncState = (tokenRef, expectedToken, commit) => commitIfCurrent(
    mountedRef,
    tokenRef,
    expectedToken,
    () => commitState(commit),
  );

  const revokeTrackedObjectUrl = url => {
    if (objectUrlControllerDisposedRef.current) return;
    if (url === null || activeObjectUrlRef.current !== url) return;
    activeObjectUrlRef.current = null;
    try {
      revokeInputObjectURL(url);
    } catch {
      // Local cleanup is best-effort and must never escape into the UI.
    }
  };

  const createTrackedObjectUrl = value => {
    if (!mountedRef.current || objectUrlControllerDisposedRef.current) {
      throw Object.assign(new Error('Panel unmounted before input URL creation.'), { code: 'T2_PANEL_UNMOUNTED' });
    }
    const url = createInputObjectURL(value);
    if (!mountedRef.current || objectUrlControllerDisposedRef.current) {
      try {
        revokeInputObjectURL(url);
      } catch {
        // The component is already unavailable; no UI work may follow.
      }
      throw Object.assign(new Error('Yoshi T2 panel is unmounted.'), {
        code: 'T2_PANEL_UNMOUNTED',
      });
    }
    activeObjectUrlRef.current = url;
    return url;
  };

  useEffect(() => {
    mountedRef.current = true;
    objectUrlControllerDisposedRef.current = false;
    return () => {
      mountedRef.current = false;
      inspectionTokenRef.current += 1;
      executionTokenRef.current += 1;
      uiExecutionGateRef.current = false;
      executionGate.current = false;
      runResultRef.current = null;

      const activeUrl = activeObjectUrlRef.current;
      activeObjectUrlRef.current = null;
      objectUrlControllerDisposedRef.current = true;
      if (activeUrl !== null) {
        try {
          revokeInputObjectURL(activeUrl);
        } catch {
          // Unmount cleanup is idempotent and never propagates cleanup failures.
        }
      }
    };
  }, [revokeInputObjectURL]);

  const selectFile = async event => {
    if (!mountedRef.current) return;
    const inspectionToken = ++inspectionTokenRef.current;
    executionTokenRef.current += 1;
    const files = event.target.files;
    runResultRef.current = null;
    setRunResult(null);
    setProgress(INITIAL_PROGRESS);
    const selected = validateYoshiT2FileSelection(files);
    if (!selected.valid) {
      commitAsyncState(inspectionTokenRef, inspectionToken, () => {
        setSelection({ status: 'invalid', file: null, metadata: null, code: selected.code });
      });
      return;
    }

    const file = selected.file;
    setSelection({ status: 'inspecting', file: null, metadata: null, code: null });
    let inspected;
    try {
      inspected = await inspectFile(file);
    } catch (caught) {
      inspected = {
        valid: false,
        code: inspectionErrorCode(caught),
        metadata: null,
      };
    }
    commitAsyncState(inspectionTokenRef, inspectionToken, () => {
      setSelection({
        status: inspected.valid ? 'valid' : 'invalid',
        file: inspected.valid ? file : null,
        metadata: inspected.metadata ?? null,
        code: inspected.code,
      });
    });
  };

  const execute = async () => {
    if (!mountedRef.current || running || uiExecutionGateRef.current
      || executionGate.current || selection.status !== 'valid') return;
    const executionToken = ++executionTokenRef.current;
    const activeFile = selection.file;
    const activeMetadata = selection.metadata;
    uiExecutionGateRef.current = true;
    setRunning(true);
    runResultRef.current = null;
    setRunResult(null);
    setProgress(INITIAL_PROGRESS);
    let result;
    try {
      result = await executeRun({
        file: activeFile,
        fileMetadata: activeMetadata,
        executionGate,
        runConnector,
        adaptLegacy,
        createObjectURL: createTrackedObjectUrl,
        revokeObjectURL: revokeTrackedObjectUrl,
        onProgress: (_percentage, stage) => {
          if (!YOSHI_T2_REQUIRED_STAGES.includes(stage)) return;
          commitAsyncState(executionTokenRef, executionToken, () => {
            setProgress(previous => ({ ...previous, [stage]: 'running' }));
          });
        },
      });
    } catch (caught) {
      result = failedExecution(errorCode(caught));
    }
    uiExecutionGateRef.current = false;
    commitAsyncState(executionTokenRef, executionToken, () => {
      if (result.ok) {
        setProgress(Object.fromEntries(YOSHI_T2_REQUIRED_STAGES.map(stage => [stage, 'completed'])));
      }
      runResultRef.current = result;
      setRunResult(result);
      setRunning(false);
    });
  };

  const download = name => {
    if (!mountedRef.current || runResultRef.current?.ok !== true) return false;
    return downloadArtifact(runResultRef.current, name);
  };

  const expectedDimensions = `${YOSHI_T2_EXPECTED_FILE.width} × ${YOSHI_T2_EXPECTED_FILE.height}`;
  const observedDimensions = selection.metadata
    ? `${selection.metadata.width} × ${selection.metadata.height}`
    : '—';

  return (
    <section
      aria-label="Yoshi T2 — runner diagnóstico"
      className="rounded-xl border border-cyan-500/30 bg-[#11141c] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            Desarrollo · T1 experimental · resultado legacy gobernante
          </p>
          <h2 className="mt-1 text-sm font-bold text-white">Yoshi T2 — ejecución diagnóstica local</h2>
          <p className="mt-1 max-w-3xl text-[11px] text-slate-500">
            Selecciona únicamente el JPEG original acreditado. No persiste entidades ni genera EMB, DST, DSB, ZIP o binarios.
          </p>
        </div>
        <span className="rounded-full border border-cyan-500/30 bg-cyan-950/20 px-2.5 py-1 text-[10px] font-semibold text-cyan-200">
          DEV ONLY
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <label className="block rounded-lg border border-dashed border-cyan-500/40 bg-cyan-950/10 p-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
              <FileImage className="h-4 w-4" /> JPEG Yoshi original
            </span>
            <input
              type="file"
              accept=".jpeg,image/jpeg"
              disabled={running}
              onChange={selectFile}
              className="mt-3 block w-full text-[10px] text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-700 file:px-3 file:py-1.5 file:text-[10px] file:font-semibold file:text-white"
            />
          </label>

          <button
            type="button"
            onClick={execute}
            disabled={selection.status !== 'valid' || running}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Ejecutar T2
          </button>

          {selection.status === 'inspecting' && (
            <p className="flex items-center gap-2 text-[11px] text-cyan-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Validando JPEG local…
            </p>
          )}
          {selection.status === 'invalid' && (
            <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/20 p-2 font-mono text-[10px] text-red-300">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {selection.code}
            </p>
          )}
          {selection.status === 'valid' && (
            <p className="flex items-center gap-2 text-[11px] text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Archivo acreditado; ejecución manual habilitada.
            </p>
          )}
        </div>

        <dl className="rounded-lg border border-[#242938] bg-[#0d0f14] p-3">
          <div className="grid grid-cols-[110px_1fr_1fr] gap-2 border-b border-[#242938] pb-2 text-[9px] font-semibold uppercase tracking-wide text-slate-600">
            <dt>Campo</dt><dd>Esperado</dd><dd>Observado</dd>
          </div>
          <MetadataRow label="Nombre" expected={YOSHI_T2_EXPECTED_FILE.name} observed={fileValue(selection.metadata, 'name')} valid={selection.metadata?.name === YOSHI_T2_EXPECTED_FILE.name} />
          <MetadataRow label="Tipo" expected={YOSHI_T2_EXPECTED_FILE.type} observed={fileValue(selection.metadata, 'type')} valid={selection.metadata?.type === YOSHI_T2_EXPECTED_FILE.type} />
          <MetadataRow label="Bytes" expected={YOSHI_T2_EXPECTED_FILE.size} observed={fileValue(selection.metadata, 'size')} valid={selection.metadata?.size === YOSHI_T2_EXPECTED_FILE.size} />
          <MetadataRow label="Dimensiones" expected={expectedDimensions} observed={observedDimensions} valid={observedDimensions === expectedDimensions} />
          <MetadataRow label="SHA-256" expected={YOSHI_T2_EXPECTED_FILE.sha256} observed={fileValue(selection.metadata, 'sha256')} valid={selection.metadata?.sha256 === YOSHI_T2_EXPECTED_FILE.sha256} />
        </dl>
      </div>

      <div className="mt-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Progreso del pipeline legacy real</h3>
        <ol className="mt-2 grid gap-1.5 md:grid-cols-3">
          {YOSHI_T2_REQUIRED_STAGES.map((stage, index) => (
            <li key={stage} className={`rounded-md border px-2 py-1.5 font-mono text-[9px] ${stageTone(progress[stage])}`}>
              {index + 1}. {stage}
            </li>
          ))}
        </ol>
      </div>

      {runResult?.ok === false && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-950/20 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red-400">Ejecución bloqueada</p>
          <p className="mt-1 font-mono text-xs text-red-200">{runResult.code}</p>
          <p className="mt-1 text-[10px] text-slate-500">No se construyó ni habilitó ningún artefacto.</p>
        </div>
      )}

      {runResult?.ok === true && (
        <div className="mt-4 space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-950/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">T2 completada</p>
              <p className="mt-1 text-[11px] text-slate-400">
                {runResult.summary.regionCount} regiones legacy · {runResult.summary.adaptedRegionCount} regiones V2 · {runResult.summary.commandCount} comandos canónicos
              </p>
            </div>
            <span className="font-mono text-[10px] text-emerald-300">governingResult: legacy</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {YOSHI_T2_ARTIFACT_NAMES.map(name => (
              <button
                key={name}
                type="button"
                onClick={() => download(name)}
                className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-[#0d0f14] px-2 py-2 text-left font-mono text-[9px] text-emerald-200 hover:border-emerald-500/50"
              >
                <Download className="h-3 w-3 shrink-0" /> {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
