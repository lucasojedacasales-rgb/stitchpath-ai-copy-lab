import { useState } from 'react';
import { ChevronDown, ChevronRight, Image, Layers, GitBranch, Shield, FileCode, AlertTriangle, CheckCircle2, XCircle, Wrench } from 'lucide-react';

/**
 * Debug panel — inspects the full export pipeline:
 *   Image → Regions → Objects → Stitches → Commands → Bytes
 */
export default function ExportDebugPanel({ pipeline }) {
  const [openStage, setOpenStage] = useState('validation');
  const stages = pipeline?.stages;

  if (!stages) return null;

  // Normalize stages — some pipelines only define a subset (e.g. fixReport).
  const regionsStage = stages.regions || { count: 0, visible: 0 };
  const objectsStage = stages.objects || { count: 0, sample: [] };
  const commandsStage = stages.commands || { count: 0, stats: null };
  const validationStage = stages.validation || { errors: [], warnings: [] };
  const fixReport = stages.fixReport || { applied: [] };

  const StageHeader = ({ id, icon: Icon, label, count, status }) => (
    <button
      onClick={() => setOpenStage(openStage === id ? null : id)}
      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[#1a1d28] transition-colors text-left"
    >
      {openStage === id ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
      <Icon className="w-3.5 h-3.5 text-violet-400" />
      <span className="text-xs font-medium text-slate-300 flex-1">{label}</span>
      {count != null && <span className="text-[10px] text-slate-500">{count}</span>}
      {status === 'ok' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
      {status === 'error' && <XCircle className="w-3 h-3 text-red-400" />}
      {status === 'warn' && <AlertTriangle className="w-3 h-3 text-amber-400" />}
    </button>
  );

  return (
    <div className="border border-[#2a2d3a] rounded-lg bg-[#0d0f14] overflow-hidden">
      <div className="px-3 py-2.5 border-b border-[#1e2130] flex items-center gap-2 bg-[#11141c]">
        <FileCode className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-xs font-bold text-white">Pipeline Debug</span>
        <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${
          pipeline.ready ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'
        }`}>
          {pipeline.ready ? 'LISTO' : 'BLOQUEADO'}
        </span>
      </div>

      <div className="divide-y divide-[#1e2130]">
        {/* Stage 1: Regions */}
        <div>
          <StageHeader id="regions" icon={Image} label="Regiones" count={regionsStage.count} status="ok" />
          {openStage === 'regions' && (
            <div className="px-6 py-2 text-[11px] text-slate-400 space-y-1">
              <div>Total: {regionsStage.count}</div>
              <div>Visibles: {regionsStage.visible}</div>
            </div>
          )}
        </div>

        {/* Stage 2: Objects */}
        <div>
          <StageHeader id="objects" icon={Layers} label="Objetos stitch" count={objectsStage.count} status="ok" />
          {openStage === 'objects' && (
            <div className="px-6 py-2 text-[11px] text-slate-400 space-y-1">
              {(objectsStage.sample || []).map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: o.color }} />
                  <span>{o.id}</span>
                  <span className="text-slate-600">{o.points} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stage 3: Commands */}
        <div>
          <StageHeader id="commands" icon={GitBranch} label="Comandos" count={commandsStage.count} status="ok" />
          {openStage === 'commands' && commandsStage.stats && (
            <div className="px-6 py-2 text-[11px] text-slate-400 grid grid-cols-2 gap-1">
              <div>Puntadas: <span className="text-violet-400">{commandsStage.stats.stitchCount}</span></div>
              <div>Cambios color: <span className="text-cyan-400">{commandsStage.stats.colorChanges}</span></div>
              <div>Trims: <span className="text-amber-400">{commandsStage.stats.trims}</span></div>
              <div>Total cmds: <span className="text-slate-300">{commandsStage.stats.totalCommands}</span></div>
            </div>
          )}
        </div>

        {/* Stage 4: Validation */}
        <div>
          <StageHeader
            id="validation"
            icon={Shield}
            label="Validación (12 reglas)"
            status={pipeline.ready ? 'ok' : 'error'}
          />
          {openStage === 'validation' && (
            <div className="px-6 py-2 space-y-2">
              {validationStage.errors.length === 0 ? (
                <div className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Todas las reglas pasaron
                </div>
              ) : (
                validationStage.errors.map((e, i) => (
                  <div key={i} className="text-[10px] text-red-400 bg-red-900/15 border border-red-500/20 rounded px-2 py-1">
                    <span className="font-bold">[{e.rule}]</span> {e.message}
                  </div>
                ))
              )}
              {validationStage.warnings.map((w, i) => (
                <div key={i} className="text-[10px] text-amber-400 bg-amber-900/15 border border-amber-500/20 rounded px-2 py-1">
                  <span className="font-bold">[{w.rule}]</span> {w.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stage 5: Auto-fix applied */}
        {fixReport.applied.length > 0 && (
          <div>
            <StageHeader id="fixes" icon={Wrench} label="Auto-fixes" count={fixReport.applied.length} status="warn" />
            {openStage === 'fixes' && (
              <div className="px-6 py-2 space-y-1">
                {fixReport.applied.map((f, i) => (
                  <div key={i} className="text-[10px] text-amber-300 flex items-center gap-1">
                    <Wrench className="w-2.5 h-2.5" />
                    <span className="font-bold">[{f.rule}]</span> {f.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}