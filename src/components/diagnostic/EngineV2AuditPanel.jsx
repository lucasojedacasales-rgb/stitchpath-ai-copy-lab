import React from 'react';

const EMPTY_LIST = Object.freeze([]);

function asList(value) {
  return Array.isArray(value) ? value : EMPTY_LIST;
}

function safeText(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    return '[valor no serializable]';
  }
}

function safeJson(value) {
  if (value === undefined) return 'null';
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return '"[valor no serializable]"';
  }
}

function AuditField({ label, value, field }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#242938] py-1.5 last:border-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd
        data-audit-field={field}
        className="max-w-[70%] break-words text-right font-mono text-[11px] text-slate-200"
      >
        {safeText(value)}
      </dd>
    </div>
  );
}

function AuditIssues({ title, values, tone }) {
  const entries = asList(values);
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {entries.length ? (
        <ul className={`mt-1 space-y-1 text-[11px] ${tone}`}>
          {entries.map((entry, index) => (
            <li key={`${title}-${index}`} className="break-words font-mono">
              {safeText(entry)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] text-slate-600">Ninguno</p>
      )}
    </div>
  );
}

function ContractJson({ value }) {
  return (
    <details className="rounded-lg border border-[#242938] bg-[#0b0d12] p-3">
      <summary className="cursor-default text-[11px] font-semibold text-slate-300">
        JSON contractual
      </summary>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-slate-400">
        {safeJson(value)}
      </pre>
    </details>
  );
}

function PanelFrame({ status, statusTone, children }) {
  return (
    <section
      aria-label="Auditoría técnica Engine V2"
      className="rounded-xl border border-[#2a2d3a] bg-[#11141c] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">
            Evidencia experimental aislada
          </p>
          <h2 className="mt-1 text-sm font-bold text-white">
            Auditoría técnica Engine V2
          </h2>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusTone}`}>
          {status}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DisabledState() {
  return (
    <PanelFrame
      status="Desactivado"
      statusTone="border-slate-600/50 bg-slate-800/40 text-slate-300"
    >
      <p className="text-sm font-semibold text-slate-200">
        Puente experimental desactivado
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        No se ha realizado ninguna ejecución.
      </p>
    </PanelFrame>
  );
}

function WaitingState() {
  return (
    <PanelFrame
      status="Habilitado"
      statusTone="border-amber-500/30 bg-amber-900/20 text-amber-200"
    >
      <p className="text-sm font-semibold text-amber-100">
        Puente experimental habilitado
      </p>
      <p className="mt-1 text-[11px] font-semibold text-slate-300">
        Todavía no ejecutado
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Este panel espera un resultado contractual externo.
      </p>
    </PanelFrame>
  );
}

function ResultState({ result, valid }) {
  const completedStages = asList(result?.completedStages);
  const errors = asList(result?.errors);
  const warnings = asList(result?.warnings);
  const document = result?.document ?? {};
  const metadata = result?.metadata ?? {};

  return (
    <PanelFrame
      status={valid ? 'Válido' : 'Inválido'}
      statusTone={valid
        ? 'border-emerald-500/30 bg-emerald-900/20 text-emerald-200'
        : 'border-red-500/30 bg-red-900/20 text-red-200'}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <dl className="rounded-lg border border-[#242938] bg-[#0d0f14] p-3">
          <AuditField label="valid" value={result?.valid} field="valid" />
          <AuditField
            label="terminalStage"
            value={result?.terminalStage}
            field="terminal-stage"
          />
          <AuditField
            label="completedStages"
            value={completedStages.length ? completedStages.join(' → ') : '—'}
            field="completed-stages"
          />
          <AuditField
            label="documentValidation"
            value={result?.documentValidation}
            field="document-validation"
          />
        </dl>

        <dl className="rounded-lg border border-[#242938] bg-[#0d0f14] p-3">
          <AuditField
            label="Regiones"
            value={asList(document?.regions).length}
            field="regions-count"
          />
          <AuditField
            label="Objetos"
            value={asList(document?.objects).length}
            field="objects-count"
          />
          <AuditField
            label="Hilos"
            value={asList(document?.threads).length}
            field="threads-count"
          />
          <AuditField
            label="Bloques de hilo"
            value={asList(document?.threadBlocks).length}
            field="thread-blocks-count"
          />
          <AuditField
            label="Comandos"
            value={asList(document?.commands).length}
            field="commands-count"
          />
        </dl>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[#242938] bg-[#0d0f14] p-3">
          <AuditIssues title="Errores" values={errors} tone="text-red-300" />
          <div className="mt-3">
            <AuditIssues
              title="Advertencias"
              values={warnings}
              tone="text-amber-300"
            />
          </div>
        </div>

        <dl className="rounded-lg border border-[#242938] bg-[#0d0f14] p-3">
          <AuditField
            label="machineAdaptationApplied"
            value={metadata?.machineAdaptationApplied}
            field="machine-adaptation-applied"
          />
          <AuditField
            label="encodingApplied"
            value={metadata?.encodingApplied}
            field="encoding-applied"
          />
          <AuditField
            label="binaryArtifactCreated"
            value={metadata?.binaryArtifactCreated}
            field="binary-artifact-created"
          />
        </dl>
      </div>

      <div className="mt-3">
        <ContractJson value={result ?? null} />
      </div>
    </PanelFrame>
  );
}

function ExceptionState({ error, result }) {
  const errorView = {
    name: error?.name,
    code: error?.code,
    path: error?.path,
    message: error?.message,
  };

  return (
    <PanelFrame
      status="Inválido"
      statusTone="border-red-500/30 bg-red-900/20 text-red-200"
    >
      <p className="text-sm font-semibold text-red-200">
        Excepción contractual externa
      </p>
      <dl className="mt-3 rounded-lg border border-red-500/20 bg-red-950/10 p-3">
        <AuditField label="name" value={errorView.name} field="error-name" />
        <AuditField label="code" value={errorView.code} field="error-code" />
        <AuditField label="path" value={errorView.path} field="error-path" />
        <AuditField
          label="message"
          value={errorView.message}
          field="error-message"
        />
        <AuditField
          label="terminalStage"
          value={result?.terminalStage}
          field="terminal-stage"
        />
      </dl>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <AuditIssues
          title="Errores"
          values={result?.errors}
          tone="text-red-300"
        />
        <AuditIssues
          title="Advertencias"
          values={result?.warnings}
          tone="text-amber-300"
        />
      </div>
      <div className="mt-3">
        <ContractJson value={result ?? { error: errorView }} />
      </div>
    </PanelFrame>
  );
}

export default function EngineV2AuditPanel({
  enabled = false,
  result = null,
  error = null,
} = {}) {
  if (enabled !== true || result?.status === 'disabled') {
    return <DisabledState />;
  }
  if (error != null) return <ExceptionState error={error} result={result} />;
  if (result == null) return <WaitingState />;
  return <ResultState result={result} valid={result?.valid === true} />;
}
