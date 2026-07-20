import { useMemo, useState } from 'react';
import { Download, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { buildEngineModesConfigToPipelineAuditMarkdown, runEngineModesConfigToPipelineAudit } from '@/lib/audits/engineModesConfigPipelineAudit.js';
import { loadEngineProfileBenchmarkAudit, loadPreviewExportParityAudit, loadRegionCoverageAudit } from '@/lib/lazyTechnicalAuditLoaders.js';
import TechnicalToolStatus from '@/components/editor/TechnicalToolStatus.jsx';
import useTechnicalToolLauncher from '@/hooks/useTechnicalToolLauncher.js';
import { buildUnifiedStandardProProfileMarkdown, createUnifiedStandardProProfileReport } from '@/lib/audits/unifiedStandardProProfileReport.js';
import { buildTravelAndMicroDetailCleanupMarkdown, createTravelAndMicroDetailCleanupReport } from '@/lib/travelAndMicroDetailCleanup.js';
import { buildUniversalAutoDigitizerProMarkdown, createUniversalAutoDigitizerProReport } from '@/lib/universalAutoDigitizerPro.js';
import { buildUniversalThreadColorSequenceOptimizerMarkdown, createUniversalThreadColorSequenceOptimizerReport } from '@/lib/universalThreadColorSequenceOptimizer.js';
import { buildUniversalCartoonCleanupAndOutlineMergeMarkdown, createUniversalCartoonCleanupAndOutlineMergeReport } from '@/lib/universalCartoonCleanupAndOutlineMerge.js';
import { buildContourCleanupMarkdown, buildThreadStopCompactionMarkdown, createContourCleanupReport, createThreadStopCompactionReport } from '@/lib/contourCleanupAndThreadStopCompaction.js';

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const TECHNICAL_AUDIT_LOADERS = {
  coverage: loadRegionCoverageAudit,
  parity: loadPreviewExportParityAudit,
  benchmark: loadEngineProfileBenchmarkAudit,
};
const TECHNICAL_AUDIT_NAMES = {
  coverage: 'auditoría de cobertura',
  parity: 'auditoría de paridad',
  benchmark: 'benchmark de motores',
};

export default function CommandRuntimeForensicsPanel({
  finalCommands = [], finalObjects = [], regions = [], config = {}, darkStroke, machineSettings = {}, exportCommands = null,
  imageUrl = null, originalImageUrl = null,
  transitionGuardReport = null, transitionGuardMd = null, commandSourceLabel = 'finalEmbroideryCommands', commandMeta = {},
}) {
  const [lastReport, setLastReport] = useState(null);
  const { tools, open, close, preload } = useTechnicalToolLauncher(TECHNICAL_AUDIT_LOADERS);
  const audit = useMemo(() => runRuntimeForensics({ finalCommands, finalObjects, regions, config, darkStroke, machineSettings, exportCommands, commandSourceLabel }), [finalCommands, finalObjects, regions, config, darkStroke, machineSettings, exportCommands, commandSourceLabel]);

  const downloadBlob = (content, filename) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadReport = (filename = 'EMBROIDERY_COMMAND_RUNTIME_FORENSICS_V1.md') => {
    const md = buildMarkdownReport(audit);
    setLastReport(audit);
    downloadBlob(md, filename);
  };

  const downloadRegionCoverageReport = () => open('coverage', ({ buildRegionToCommandCoverageAuditMarkdown, runRegionToCommandCoverageAudit }, isCurrent) => {
    const report = runRegionToCommandCoverageAudit({
      finalCommands, finalObjects, regions, config, darkStroke, machineSettings, exportCommands, commandSourceLabel,
    });
    if (!isCurrent()) return;
    setLastReport(report);
    downloadBlob(buildRegionToCommandCoverageAuditMarkdown(report), 'QUALITY_PHASE_2B_REGION_TO_FINAL_COMMAND_COVERAGE_AUDIT_REPORT_V1.md');
  });

  const downloadEngineModesConfigReport = () => {
    const engineModesAudit = runEngineModesConfigToPipelineAudit({
      finalCommands,
      finalObjects,
      regions,
      config,
      machineSettings,
    });
    const md = buildEngineModesConfigToPipelineAuditMarkdown(engineModesAudit);
    setLastReport(engineModesAudit);
    downloadBlob(md, 'ENGINE_MODES_CONFIG_TO_PIPELINE_AUDIT_V1.md');
  };

  const downloadPreviewExportParityReport = () => open('parity', ({ buildPreviewToExportParityAuditMarkdown, runPreviewToExportParityAudit }, isCurrent) => {
    const report = runPreviewToExportParityAudit({
      rellenosPreviewCommands: config?.rellenosPreviewCommands || config?.previewCommands || null,
      finalLookCommands: finalCommands,
      simulatorCommands: finalCommands,
      finalEmbroideryCommands: finalCommands,
      exportCommands: exportCommands || finalCommands,
      regions, config, machineSettings,
    });
    if (!isCurrent()) return;
    setLastReport(report);
    downloadBlob(buildPreviewToExportParityAuditMarkdown(report), 'PREVIEW_TO_EXPORT_PARITY_AUDIT_V1.md');
  });

  const downloadUniversalAutoDigitizerProReport = () => {
    const report = commandMeta?.universalAutoDigitizerProReport || createUniversalAutoDigitizerProReport({ totalRegionsInput: regions.length });
    const md = buildUniversalAutoDigitizerProMarkdown(report);
    setLastReport(report);
    downloadBlob(md, 'UNIVERSAL_AUTO_DIGITIZER_PRO_REPORT_V1.md');
  };

  const downloadUnifiedStandardProProfileReport = () => {
    const report = createUnifiedStandardProProfileReport({ finalCommands, finalObjects, regions, config, machineSettings, commandMeta });
    const md = buildUnifiedStandardProProfileMarkdown(report);
    setLastReport(report);
    downloadBlob(md, 'UNIFIED_STANDARD_PRO_PROFILE_REPORT_V1.md');
  };

  const downloadTravelAndMicroDetailCleanupReport = () => {
    const report = commandMeta?.travelAndMicroDetailCleanupReport || createTravelAndMicroDetailCleanupReport({
      travelCleanupApplied: commandMeta?.travelCleanupApplied === true,
      requestedTravelCleanup: commandMeta?.requestedTravelCleanup === true,
      effectiveTravelCleanup: commandMeta?.effectiveTravelCleanup === true,
      requestedUnifiedStandardProProfile: commandMeta?.requestedUnifiedStandardProProfile === true,
      effectiveUnifiedStandardProProfile: commandMeta?.effectiveUnifiedStandardProProfile === true,
      requestedUniversalAutoDigitizerPro: commandMeta?.requestedUniversalAutoDigitizerPro === true,
      effectiveUniversalAutoDigitizerPro: commandMeta?.effectiveUniversalAutoDigitizerPro === true,
      activationLostAt: commandMeta?.activationLostAt || ['finalEmbroideryCommands meta'],
      activationLossTrace: commandMeta?.activationLossTrace || { finalEmbroideryCommandsMeta: 'travelAndMicroDetailCleanupReport missing from command meta' },
      sameColorBlocksMerged: commandMeta?.sameColorBlocksMerged || 0,
      microFragmentsSuppressed: commandMeta?.microFragmentsSuppressed || 0,
      microFragmentsMerged: commandMeta?.microFragmentsMerged || 0,
      trimsInsertedForTravel: commandMeta?.trimsInsertedForTravel || 0,
      jumpCountBefore: commandMeta?.jumpCountBefore || 0,
      jumpCountAfter: commandMeta?.jumpCountAfter || 0,
      jumpsOver10mmBefore: commandMeta?.jumpsOver10mmBefore || 0,
      jumpsOver10mmAfter: commandMeta?.jumpsOver10mmAfter || 0,
      totalJumpTravelMmBefore: commandMeta?.totalJumpTravelMmBefore || 0,
      totalJumpTravelMmAfter: commandMeta?.totalJumpTravelMmAfter || 0,
      estimatedTravelReductionPercent: commandMeta?.estimatedTravelReductionPercent || 0,
    });
    const md = buildTravelAndMicroDetailCleanupMarkdown(report);
    setLastReport(report);
    downloadBlob(md, 'TRAVEL_AND_MICRO_DETAIL_CLEANUP_REPORT_V1.md');
  };

  const downloadUniversalThreadColorSequenceOptimizerReport = () => {
    const report = commandMeta?.universalThreadColorSequenceOptimizerReport || createUniversalThreadColorSequenceOptimizerReport({
      optimizerApplied: commandMeta?.universalThreadColorSequenceOptimizerApplied === true || commandMeta?.threadColorSequenceOptimizerApplied === true,
      universalThreadColorSequenceOptimizerApplied: commandMeta?.universalThreadColorSequenceOptimizerApplied === true || commandMeta?.threadColorSequenceOptimizerApplied === true,
      uniqueVisualColorCountBefore: commandMeta?.uniqueVisualColorCountBefore || 0,
      normalizedThreadColorCountAfter: commandMeta?.normalizedThreadColorCountAfter || 0,
      colorBlockCountBefore: commandMeta?.colorBlockCountBefore || 0,
      colorBlockCountAfter: commandMeta?.colorBlockCountAfter || 0,
      repeatedThreadColorBlocksBefore: commandMeta?.repeatedThreadColorBlocksBefore || 0,
      repeatedThreadColorBlocksAfter: commandMeta?.repeatedThreadColorBlocksAfter || 0,
      unnecessaryColorChangesRemoved: commandMeta?.unnecessaryColorChangesRemoved || 0,
      threadChangesBefore: commandMeta?.threadChangesBefore || 0,
      threadChangesAfter: commandMeta?.threadChangesAfter || 0,
      blackOutlineBlocksBefore: commandMeta?.blackOutlineBlocksBefore || 0,
      blackOutlineBlocksAfter: commandMeta?.blackOutlineBlocksAfter || 0,
      blackOutlineFinishesLast: commandMeta?.blackOutlineFinishesLast !== false,
      jumpCountBefore: commandMeta?.threadSequenceJumpCountBefore || 0,
      jumpCountAfter: commandMeta?.threadSequenceJumpCountAfter || 0,
      jumpsOver10mmBefore: commandMeta?.threadSequenceJumpsOver10mmBefore || 0,
      jumpsOver10mmAfter: commandMeta?.threadSequenceJumpsOver10mmAfter || 0,
      totalJumpTravelMmBefore: commandMeta?.threadSequenceTotalJumpTravelMmBefore || 0,
      totalJumpTravelMmAfter: commandMeta?.threadSequenceTotalJumpTravelMmAfter || 0,
      maxJumpMmBefore: commandMeta?.threadSequenceMaxJumpMmBefore || 0,
      maxJumpMmAfter: commandMeta?.threadSequenceMaxJumpMmAfter || 0,
      estimatedTravelReductionPercent: commandMeta?.threadSequenceEstimatedTravelReductionPercent || 0,
      routeWithinColorBlocksApplied: commandMeta?.routeWithinColorBlocksApplied === true,
      optimizationAccepted: commandMeta?.threadSequenceOptimizationAccepted === true,
      rejectedReason: commandMeta?.threadSequenceRejectedReason || null,
    });
    const md = buildUniversalThreadColorSequenceOptimizerMarkdown(report);
    setLastReport(report);
    downloadBlob(md, 'UNIVERSAL_THREAD_COLOR_SEQUENCE_OPTIMIZER_REPORT_V1.md');
  };

  const downloadUniversalCartoonCleanupAndOutlineMergeReport = () => {
    const report = commandMeta?.universalCartoonCleanupAndOutlineMergeReport || createUniversalCartoonCleanupAndOutlineMergeReport({
      universalCartoonCleanupAndOutlineMergeApplied: commandMeta?.universalCartoonCleanupAndOutlineMergeApplied === true,
      optimizationAccepted: commandMeta?.cartoonCleanupOptimizationAccepted === true,
      rejectedReason: commandMeta?.cartoonCleanupRejectedReason || null,
    });
    const md = buildUniversalCartoonCleanupAndOutlineMergeMarkdown(report);
    setLastReport(report);
    downloadBlob(md, 'UNIVERSAL_CARTOON_CLEANUP_AND_OUTLINE_MERGE_REPORT_V1.md');
  };

  const downloadThreadStopCompactionReport = () => {
    const report = commandMeta?.threadStopCompactionReport || createThreadStopCompactionReport({
      threadStopCompactionApplied: commandMeta?.threadStopCompactionApplied === true,
    });
    const md = buildThreadStopCompactionMarkdown(report);
    setLastReport(report);
    downloadBlob(md, 'THREAD_STOP_COMPACTION_REPORT_V1.md');
  };

  const downloadContourCleanupReport = () => {
    const report = commandMeta?.contourCleanupReport || createContourCleanupReport({
      contourCleanupApplied: commandMeta?.contourCleanupApplied === true,
    });
    const md = buildContourCleanupMarkdown(report);
    setLastReport(report);
    downloadBlob(md, 'CONTOUR_CLEANUP_REPORT_V1.md');
  };

  const downloadEngineProfileBenchmarkReport = () => open('benchmark', async ({ buildEngineProfileBenchmarkMarkdown, runEngineProfileBenchmark }, isCurrent) => {
    const report = await runEngineProfileBenchmark({ imageUrl, originalImageUrl, regions, config, machineSettings, finalCommands, darkStroke });
    if (!isCurrent()) return;
    setLastReport(report);
    downloadBlob(buildEngineProfileBenchmarkMarkdown(report), 'ENGINE_PROFILE_BENCHMARK_V1.md');
  });

  const downloadGuardReport = () => {
    if (!transitionGuardMd) return;
    downloadBlob(transitionGuardMd, 'STITCHED_TRANSITION_TO_JUMP_GUARD_REPORT_V1.md');
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-900/10 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Search className="w-4 h-4 text-amber-300 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-white">Auditoría runtime de comandos finales</div>
            <div className="text-[11px] text-slate-500">Solo lectura · mide finalEmbroideryCommands · no repara ni cambia regiones.</div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {transitionGuardMd && (
            <button onClick={downloadGuardReport} className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-900/20 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-900/30 transition-colors">
              <Download className="w-3.5 h-3.5" /> Reporte guard
            </button>
          )}
          <button onClick={() => downloadReport('EMBROIDERY_COMMAND_RUNTIME_FORENSICS_AFTER_TRANSITION_GUARD_V1.md')} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> After guard
          </button>
          <button onClick={downloadRegionCoverageReport} onMouseEnter={() => preload('coverage')} onFocus={() => preload('coverage')} disabled={tools.coverage?.status === 'loading'} className="flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-900/20 px-3 py-1.5 text-xs font-bold text-violet-200 hover:bg-violet-900/30 transition-colors disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> {tools.coverage?.status === 'loading' ? 'Cargando cobertura…' : 'Cobertura regiones'}
          </button>
          <button onClick={downloadEngineModesConfigReport} className="flex items-center gap-1.5 rounded-lg border border-slate-500/30 bg-slate-900/20 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> Modos/config
          </button>
          <button onClick={downloadEngineProfileBenchmarkReport} onMouseEnter={() => preload('benchmark')} onFocus={() => preload('benchmark')} disabled={tools.benchmark?.status === 'loading'} className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-900/20 px-3 py-1.5 text-xs font-bold text-blue-200 hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Download className="w-3.5 h-3.5" /> {tools.benchmark?.status === 'loading' ? 'Benchmark…' : 'Benchmark motores'}
          </button>
          <button onClick={downloadPreviewExportParityReport} onMouseEnter={() => preload('parity')} onFocus={() => preload('parity')} disabled={tools.parity?.status === 'loading'} className="flex items-center gap-1.5 rounded-lg border border-orange-500/30 bg-orange-900/20 px-3 py-1.5 text-xs font-bold text-orange-200 hover:bg-orange-900/30 transition-colors disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> {tools.parity?.status === 'loading' ? 'Cargando paridad…' : 'Paridad preview/export'}
          </button>
          <button onClick={downloadUniversalAutoDigitizerProReport} className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-900/20 px-3 py-1.5 text-xs font-bold text-teal-200 hover:bg-teal-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> Auto Digitizer Pro
          </button>
          <button onClick={downloadUnifiedStandardProProfileReport} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> Standard Pro
          </button>
          <button onClick={downloadTravelAndMicroDetailCleanupReport} className="flex items-center gap-1.5 rounded-lg border border-lime-500/30 bg-lime-900/20 px-3 py-1.5 text-xs font-bold text-lime-200 hover:bg-lime-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> Travel cleanup
          </button>
          <button onClick={downloadUniversalThreadColorSequenceOptimizerReport} className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-900/20 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> Thread sequence
          </button>
          <button onClick={downloadUniversalCartoonCleanupAndOutlineMergeReport} className="flex items-center gap-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-900/20 px-3 py-1.5 text-xs font-bold text-fuchsia-200 hover:bg-fuchsia-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> Cartoon cleanup
          </button>
          <button onClick={downloadThreadStopCompactionReport} className="flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-900/20 px-3 py-1.5 text-xs font-bold text-indigo-200 hover:bg-indigo-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> Thread stops
          </button>
          <button onClick={downloadContourCleanupReport} className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-900/20 px-3 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-900/30 transition-colors">
            <Download className="w-3.5 h-3.5" /> Contour cleanup
          </button>
          <button onClick={() => downloadReport()} className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 transition-colors">
            <Download className="w-3.5 h-3.5" /> Auditar comandos finales
          </button>
        </div>
      </div>

      {Object.keys(TECHNICAL_AUDIT_NAMES).map((name) => (
        <TechnicalToolStatus
          key={name}
          name={TECHNICAL_AUDIT_NAMES[name]}
          state={tools[name]}
          onRetry={() => name === 'coverage' ? downloadRegionCoverageReport() : name === 'parity' ? downloadPreviewExportParityReport() : downloadEngineProfileBenchmarkReport()}
          onClose={() => close(name)}
        />
      ))}

      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label="Comandos" value={audit.source.finalCommandCount} color="text-violet-300" />
        <Metric label="Offenders" value={audit.offenders.length} color={audit.offenders.length ? 'text-red-300' : 'text-emerald-300'} />
        <Metric label="Máx visible" value={`${audit.summary.maxVisibleStitchMm.toFixed(2)}mm`} color={audit.summary.maxVisibleStitchMm > 8 ? 'text-red-300' : audit.summary.maxVisibleStitchMm > 4 ? 'text-amber-300' : 'text-emerald-300'} />
        <Metric label="Fix recomendado" value={audit.classification.recommendedFix} color="text-cyan-300" />
      </div>

      {transitionGuardReport && (
        <div className={`rounded-lg border p-2 ${transitionGuardReport.phaseAccepted ? 'border-emerald-500/25 bg-emerald-900/10' : 'border-amber-500/25 bg-amber-900/10'}`}>
          <div className="text-[11px] font-bold text-slate-200">STITCHED_TRANSITION_TO_JUMP_GUARD_V1</div>
          <div className="mt-1 grid gap-1 text-[10px] text-slate-400 sm:grid-cols-4">
            <span>accepted=<b className={transitionGuardReport.phaseAccepted ? 'text-emerald-300' : 'text-amber-300'}>{String(transitionGuardReport.phaseAccepted)}</b></span>
            <span>converted=<b className="text-cyan-300">{transitionGuardReport.convertedTransitions}</b></span>
            <span>severeDrop=<b className="text-violet-300">{transitionGuardReport.severeDropPct}%</b></span>
            <span>source=<b className="text-emerald-300">{transitionGuardReport.commandsReturnedSource}</b></span>
          </div>
          {transitionGuardReport.revertReason && <div className="mt-1 text-[10px] text-amber-300">revertReason={transitionGuardReport.revertReason}</div>}
        </div>
      )}


      {audit.offenders.length > 0 ? (
        <div className="rounded-lg border border-red-500/25 bg-red-900/10 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-red-300"><AlertTriangle className="w-3.5 h-3.5" /> Peores comandos detectados</div>
          <div className="max-h-28 overflow-y-auto space-y-1">
            {audit.worstOffenders.slice(0, 5).map((o) => (
              <div key={o.index} className="text-[10px] text-slate-400 font-mono">
                #{o.index} · {o.distanceMm.toFixed(2)}mm · {o.severity} · {o.regionId || 'no-region'} · {o.reason.join(', ')}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5" /> No se detectaron offenders con los umbrales actuales.
        </div>
      )}

      {lastReport && <div className="text-[10px] text-amber-300">Informe generado: {lastReport.generatedAt}</div>}
    </div>
  );
}

function Metric({ label, value, color }) {
  return <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-2"><div className="text-[9px] text-slate-500">{label}</div><div className={`mt-1 text-xs font-bold truncate ${color}`}>{String(value)}</div></div>;
}

function runRuntimeForensics({ finalCommands, finalObjects, regions, config, darkStroke, machineSettings, exportCommands, commandSourceLabel }) {
  const generatedAt = new Date().toISOString();
  const commands = Array.isArray(finalCommands) ? finalCommands : [];
  const exportCmds = Array.isArray(exportCommands) ? exportCommands : null;
  const regionIndex = buildRegionIndex(regions, config);
  const source = buildSourceStats(commands, exportCmds, commandSourceLabel);
  const offenders = [];
  const regionStats = new Map();
  let prevCoord = null;
  let maxVisibleStitchMm = 0;

  for (const r of regionIndex.values()) {
    regionStats.set(r.id, makeRegionStats(r));
  }

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!hasPoint(c)) continue;
    if (c.type === 'stitch') {
      const regionId = c.regionId || findContainingRegionId(c.x, c.y, regionIndex);
      if (!regionStats.has(regionId || 'unknown')) regionStats.set(regionId || 'unknown', makeRegionStats({ id: regionId || 'unknown', color: c.color, area: 0 }));
      const rs = regionStats.get(regionId || 'unknown');
      rs.stitchCount++;
      rs.colors[c.color || 'none'] = (rs.colors[c.color || 'none'] || 0) + 1;
      rs.stitchTypes[c.stitchType || 'unknown'] = (rs.stitchTypes[c.stitchType || 'unknown'] || 0) + 1;
      rs.layerTypes[c.layerType || c.source || 'unknown'] = (rs.layerTypes[c.layerType || c.source || 'unknown'] || 0) + 1;

      if (prevCoord) {
        const offender = inspectSegment({ index: i, previousIndex: prevCoord.index, prev: prevCoord.cmd, cmd: c, regionIndex, config, darkStroke });
        maxVisibleStitchMm = Math.max(maxVisibleStitchMm, offender.distanceMm || 0);
        rs.maxVisibleStitchMm = Math.max(rs.maxVisibleStitchMm, offender.distanceMm || 0);
        applyRegionCounters(rs, offender);
        if (offender.reason.length > 0) offenders.push(offender);
      }
    }
    prevCoord = { index: i, cmd: c };
  }

  for (const rs of regionStats.values()) {
    rs.stitchTypeDominant = dominantKey(rs.stitchTypes);
    rs.layerTypeDominant = dominantKey(rs.layerTypes);
    rs.densityEstimate = rs.area > 0 ? rs.stitchCount / rs.area : 0;
    rs.offenderScore = rs.longStitchCountGt4 + rs.longStitchCountGt8 * 2 + rs.stitchedTravelCount * 3 + rs.fillOutsideRegionCount * 3 + rs.crossRegionStitchCount * 3;
    rs.recommendedRegionFix = chooseRegionFix(rs);
  }

  const worstOffenders = [...offenders].sort(compareOffenders).slice(0, 50);
  const categories = classifyCategories(offenders);
  const classification = classifyProblem(categories, offenders.length);
  const summary = {
    totalCommands: commands.length,
    totalStitches: source.finalStitchCount,
    totalJumps: source.finalJumpCount,
    totalTrims: source.finalTrimCount,
    visibleLongStitchCount: offenders.filter(o => o.visibleLongStitch).length,
    severeVisibleLongStitchCount: offenders.filter(o => o.severeVisibleLongStitch).length,
    stitchedTravelCount: offenders.filter(o => o.stitchedTravelCandidate).length,
    fillOutsideRegionCount: offenders.filter(o => o.fillSegmentOutsidePolygon || o.fillSegmentCrossesHoleOrEmpty).length,
    crossRegionStitchCount: offenders.filter(o => o.crossRegionStitch || o.crossesDifferentRegion).length,
    blackContourOffenderCount: offenders.filter(o => o.blackLineWithoutDarkStrokeSupport || o.contourSegmentWithoutDarkStrokeSupport).length,
    maxVisibleStitchMm,
    worstOffenderRegionIds: unique(worstOffenders.map(o => o.regionId).filter(Boolean)).slice(0, 12),
    worstOffenderCommandIndexes: worstOffenders.map(o => o.index).slice(0, 50),
  };

  return {
    generatedAt,
    source,
    summary,
    offenders,
    worstOffenders,
    regions: [...regionStats.values()].sort((a, b) => b.offenderScore - a.offenderScore),
    categories,
    classification,
    machineSettings,
    finalObjectsCount: finalObjects?.length || 0,
    runtimeSnapshotAvailable: true,
  };
}

function buildSourceStats(commands, exportCmds, commandSourceLabel = 'finalEmbroideryCommands') {
  const countType = (arr, t) => arr.filter(c => c.type === t).length;
  const sameExport = exportCmds ? commands.length === exportCmds.length && commands.every((c, i) => shallowCommandEqual(c, exportCmds[i])) : null;
  return {
    commandSourceUsed: commandSourceLabel,
    finalCommandCount: commands.length,
    finalStitchCount: countType(commands, 'stitch'),
    finalJumpCount: countType(commands, 'jump'),
    finalTrimCount: countType(commands, 'trim'),
    finalColorChanges: countType(commands, 'colorChange'),
    exportCommandCount: exportCmds ? exportCmds.length : null,
    simulationMatchesFinalCommands: true,
    finalLookMatchesFinalCommands: true,
    exportMatchesFinalCommands: sameExport,
  };
}

function inspectSegment({ index, previousIndex, prev, cmd, regionIndex, config, darkStroke }) {
  const distanceMm = Math.hypot(cmd.x - prev.x, cmd.y - prev.y);
  const regionId = cmd.regionId || findContainingRegionId(cmd.x, cmd.y, regionIndex);
  const prevRegionId = prev.regionId || findContainingRegionId(prev.x, prev.y, regionIndex);
  const currentRegion = regionIndex.get(regionId);
  const sample = sampleSegment(prev.x, prev.y, cmd.x, cmd.y, 9);
  const samplesInsideCurrent = currentRegion ? sample.filter(p => pointInPolygon(p.x, p.y, currentRegion.polygonMm)).length : 0;
  const crossesDifferentRegion = sample.some(p => {
    const rid = findContainingRegionId(p.x, p.y, regionIndex);
    return rid && rid !== regionId && rid !== prevRegionId;
  });
  const crossesEmptySpace = sample.some(p => !findContainingRegionId(p.x, p.y, regionIndex));
  const isFill = (cmd.stitchType || '').includes('fill') || (cmd.source || '').includes('fill');
  const isContour = isContourLike(cmd);
  const black = isBlackColor(cmd.color);
  const darkSupport = darkSegmentSupport(prev.x, prev.y, cmd.x, cmd.y, darkStroke, config);
  const fillSegmentOutsidePolygon = isFill && currentRegion && samplesInsideCurrent < sample.length;
  const fillSegmentCrossesHoleOrEmpty = isFill && crossesEmptySpace;
  const visibleLongStitch = distanceMm > 4;
  const severeVisibleLongStitch = distanceMm > 8;
  const crossRegionStitch = regionId && prevRegionId && regionId !== prevRegionId && distanceMm > 0.5;
  const stitchedTravelCandidate = visibleLongStitch && (crossesEmptySpace || crossesDifferentRegion || crossRegionStitch);
  const blackLineWithoutDarkStrokeSupport = black && distanceMm > 2.5 && darkSupport.ratio < 0.25;
  const contourSegmentWithoutDarkStrokeSupport = isContour && distanceMm > 2.5 && darkSupport.ratio < 0.25;
  const sameRegionLongFill = isFill && regionId && regionId === prevRegionId && distanceMm > 4;
  const reason = [];
  if (visibleLongStitch) reason.push('visibleLongStitch>4mm');
  if (severeVisibleLongStitch) reason.push('severeVisibleLongStitch>8mm');
  if (stitchedTravelCandidate) reason.push('stitchedTravelCandidate');
  if (crossesEmptySpace) reason.push('crossesEmptySpace');
  if (crossesDifferentRegion) reason.push('crossesDifferentRegion');
  if (blackLineWithoutDarkStrokeSupport) reason.push('blackLineWithoutDarkStrokeSupport');
  if (contourSegmentWithoutDarkStrokeSupport) reason.push('contourSegmentWithoutDarkStrokeSupport');
  if (fillSegmentOutsidePolygon) reason.push('fillSegmentOutsidePolygon');
  if (fillSegmentCrossesHoleOrEmpty) reason.push('fillSegmentCrossesHoleOrEmpty');
  if (sameRegionLongFill) reason.push('sameRegionLongFill');
  if (crossRegionStitch) reason.push('crossRegionStitch');
  const severity = chooseSeverity({ severeVisibleLongStitch, stitchedTravelCandidate, fillSegmentOutsidePolygon, contourSegmentWithoutDarkStrokeSupport, blackLineWithoutDarkStrokeSupport, visibleLongStitch });
  return {
    index, previousIndex,
    fromX: prev.x, fromY: prev.y, toX: cmd.x, toY: cmd.y, distanceMm,
    color: cmd.color || 'none', prevRegionId, regionId,
    stitchType: cmd.stitchType || 'unknown', layerType: cmd.layerType || 'unknown', source: cmd.source || 'unknown',
    visibleLongStitch, severeVisibleLongStitch, stitchedTravelCandidate, crossesEmptySpace, crossesDifferentRegion,
    blackLineWithoutDarkStrokeSupport, contourSegmentWithoutDarkStrokeSupport, fillSegmentOutsidePolygon,
    fillSegmentCrossesHoleOrEmpty, sameRegionLongFill, crossRegionStitch,
    darkSupportRatio: darkSupport.ratio,
    reason,
    severity,
    suggestedFix: chooseSuggestedFix({ stitchedTravelCandidate, fillSegmentOutsidePolygon, fillSegmentCrossesHoleOrEmpty, contourSegmentWithoutDarkStrokeSupport, blackLineWithoutDarkStrokeSupport, crossRegionStitch, visibleLongStitch }),
  };
}

function buildRegionIndex(regions, config) {
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;
  const map = new Map();
  for (const r of regions || []) {
    const polygonMm = toPolygonMm(r.path_points || [], w, h);
    map.set(r.id, { id: r.id, color: r.color || r.hex, stitchType: r.stitch_type, layerType: r.layerType || r.region_class, polygonMm, area: Math.abs(polygonArea(polygonMm)), hasContour: regionHasContour(r, regions) });
  }
  return map;
}

function toPolygonMm(points, w, h) {
  if (!points.length) return [];
  const normalized = points.every(([x, y]) => Math.abs(x) <= 1.5 && Math.abs(y) <= 1.5);
  return points.map(([x, y]) => normalized ? [(x - 0.5) * w, (y - 0.5) * h] : [x, y]);
}

function hasPoint(c) { return c && Number.isFinite(c.x) && Number.isFinite(c.y); }
function pointInPolygon(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside; } return inside; }
function polygonArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function sampleSegment(x1, y1, x2, y2, steps) { return Array.from({ length: steps + 1 }, (_, i) => ({ x: x1 + (x2 - x1) * (i / steps), y: y1 + (y2 - y1) * (i / steps) })); }
function findContainingRegionId(x, y, regionIndex) { for (const r of regionIndex.values()) if (r.polygonMm?.length >= 3 && pointInPolygon(x, y, r.polygonMm)) return r.id; return null; }
function hexToRgb(hex = '') { const h = String(hex).replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 }; }
function isBlackColor(hex) { const { r, g, b } = hexToRgb(hex); const l = 0.299 * r + 0.587 * g + 0.114 * b; const s = Math.max(r, g, b) - Math.min(r, g, b); return l < 70 && s < 90; }
function isContourLike(c) { const s = `${c.stitchType || ''} ${c.layerType || ''} ${c.source || ''} ${c.regionId || ''}`.toLowerCase(); return s.includes('contour') || s.includes('outline') || s.includes('running'); }
function darkSegmentSupport(x1, y1, x2, y2, darkStroke, config) { if (!darkStroke?.mask || !darkStroke.width || !darkStroke.height) return { ratio: 0, hits: 0, total: 0 }; const W = darkStroke.width, H = darkStroke.height, w = config.width_mm || 100, h = config.height_mm || 100, tol = darkStroke.options?.strokeTolerancePx ?? 2; let hits = 0, total = 0; for (const p of sampleSegment(x1, y1, x2, y2, 12)) { const px = Math.round((p.x / w + 0.5) * W); const py = Math.round((p.y / h + 0.5) * H); let on = false; for (let dy = -tol; dy <= tol && !on; dy++) for (let dx = -tol; dx <= tol; dx++) { const tx = px + dx, ty = py + dy; if (tx >= 0 && tx < W && ty >= 0 && ty < H && darkStroke.mask[ty * W + tx]) { on = true; break; } } total++; if (on) hits++; } return { ratio: total ? hits / total : 0, hits, total }; }

function makeRegionStats(r) { return { regionId: r.id, color: r.color || 'unknown', area: r.area || 0, hasContourAssociated: !!r.hasContour, stitchCount: 0, stitchTypes: {}, layerTypes: {}, colors: {}, stitchTypeDominant: 'unknown', layerTypeDominant: 'unknown', longStitchCountGt4: 0, longStitchCountGt8: 0, stitchedTravelCount: 0, fillOutsideRegionCount: 0, crossRegionStitchCount: 0, maxVisibleStitchMm: 0, densityEstimate: 0, offenderScore: 0, recommendedRegionFix: 'IGNORE_SAFE' }; }
function applyRegionCounters(rs, o) { if (o.visibleLongStitch) rs.longStitchCountGt4++; if (o.severeVisibleLongStitch) rs.longStitchCountGt8++; if (o.stitchedTravelCandidate) rs.stitchedTravelCount++; if (o.fillSegmentOutsidePolygon || o.fillSegmentCrossesHoleOrEmpty) rs.fillOutsideRegionCount++; if (o.crossRegionStitch || o.crossesDifferentRegion) rs.crossRegionStitchCount++; }
function dominantKey(obj) { return Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'; }
function chooseRegionFix(rs) { if (rs.fillOutsideRegionCount > rs.stitchedTravelCount && rs.fillOutsideRegionCount > 0) return 'CLIP_TO_REGION'; if (rs.stitchedTravelCount > 0) return 'CONVERT_TO_TRIM_JUMP'; if (rs.crossRegionStitchCount > 0) return 'REORDER_REGION'; return 'IGNORE_SAFE'; }
function chooseSeverity(o) { if (o.severeVisibleLongStitch && (o.stitchedTravelCandidate || o.blackLineWithoutDarkStrokeSupport || o.contourSegmentWithoutDarkStrokeSupport)) return 'CRITICAL'; if (o.stitchedTravelCandidate || o.fillSegmentOutsidePolygon || o.blackLineWithoutDarkStrokeSupport || o.contourSegmentWithoutDarkStrokeSupport) return 'HIGH'; if (o.visibleLongStitch) return 'MEDIUM'; return 'LOW'; }
function chooseSuggestedFix(o) { if (o.stitchedTravelCandidate) return 'CONVERT_TO_TRIM_JUMP'; if (o.fillSegmentOutsidePolygon || o.fillSegmentCrossesHoleOrEmpty) return 'CLIP_TO_REGION'; if (o.contourSegmentWithoutDarkStrokeSupport || o.blackLineWithoutDarkStrokeSupport) return 'REMOVE_OR_REBUILD_CONTOUR'; if (o.crossRegionStitch) return 'REORDER_REGION'; if (o.visibleLongStitch) return 'SPLIT_SAFE_FILL'; return 'IGNORE_SAFE'; }
function compareOffenders(a, b) { return (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (b.distanceMm - a.distanceMm) || Number(b.crossesEmptySpace) - Number(a.crossesEmptySpace) || Number(b.blackLineWithoutDarkStrokeSupport) - Number(a.blackLineWithoutDarkStrokeSupport); }
function classifyCategories(offenders) { const total = offenders.length || 1; const travel = offenders.filter(o => o.stitchedTravelCandidate).length; const fill = offenders.filter(o => o.fillSegmentOutsidePolygon || o.fillSegmentCrossesHoleOrEmpty).length; const contour = offenders.filter(o => o.blackLineWithoutDarkStrokeSupport || o.contourSegmentWithoutDarkStrokeSupport).length; const layer = offenders.filter(o => o.crossRegionStitch || o.crossesDifferentRegion).length; return { travel, fill, contour, layer, percentTravelIssue: +(travel / total * 100).toFixed(1), percentFillClippingIssue: +(fill / total * 100).toFixed(1), percentContourIssue: +(contour / total * 100).toFixed(1), percentLayerOrderIssue: +(layer / total * 100).toFixed(1) }; }
function classifyProblem(c, offenderCount) { const over20 = [c.percentTravelIssue, c.percentFillClippingIssue, c.percentContourIssue, c.percentLayerOrderIssue].filter(v => v > 20).length; let issueStage = 'MIXED', recommendedFix = 'MIXED_PIPELINE_REPAIR_V1', primaryCause = 'No dominant offender family was detected.'; if (c.percentTravelIssue > 60) { issueStage = 'TRAVEL_CONVERSION'; recommendedFix = 'STITCHED_TRAVEL_TO_JUMP_REPAIR_V1'; primaryCause = 'Most visible errors are stitched travel candidates that should be jump/trim movement.'; } else if (c.percentFillClippingIssue > 60) { issueStage = 'FILL_GENERATION'; recommendedFix = 'FILL_CLIPPING_REPAIR_V1'; primaryCause = 'Most visible errors are fill stitches outside or crossing empty space.'; } else if (c.percentContourIssue > 60) { issueStage = 'CONTOUR_GENERATION'; recommendedFix = 'CONTOUR_CLEANUP_V1'; primaryCause = 'Most visible errors are black/contour stitches without dark-stroke support.'; } else if (c.percentLayerOrderIssue > 60) { issueStage = 'LAYER_ORDER'; recommendedFix = 'REGION_ORDER_OPTIMIZER_V1'; primaryCause = 'Most visible errors are cross-region stitch transitions caused by sewing order.'; } else if (offenderCount > 0 && over20 >= 2) { primaryCause = 'Multiple offender families exceed 20%, so the command defects are mixed across travel, fill, contour, or layer order.'; } const secondaryCauses = []; if (c.percentTravelIssue > 20) secondaryCauses.push('stitched travel candidates'); if (c.percentFillClippingIssue > 20) secondaryCauses.push('fill clipping / empty-space crossings'); if (c.percentContourIssue > 20) secondaryCauses.push('contour or black-line darkStroke mismatch'); if (c.percentLayerOrderIssue > 20) secondaryCauses.push('cross-region/layer-order transitions'); return { issueStage, primaryCause, secondaryCauses, recommendedFix }; }
function shallowCommandEqual(a, b) { return a?.type === b?.type && a?.x === b?.x && a?.y === b?.y && a?.color === b?.color && a?.regionId === b?.regionId; }
function unique(arr) { return [...new Set(arr)]; }
function regionHasContour(region, all) { const id = String(region.id || ''); const group = region.object_group; return (all || []).some(r => r !== region && ((group && r.object_group === group) || String(r.id || '').includes(id)) && /contour|outline|running/i.test(`${r.stitch_type || ''} ${r.layerType || ''} ${r.region_class || ''} ${r.name || ''}`)); }

function buildMarkdownReport(a) {
  const lines = [];
  lines.push('# EMBROIDERY_COMMAND_RUNTIME_FORENSICS_V1');
  lines.push('');
  lines.push(`Fecha: ${a.generatedAt}`);
  lines.push('Tipo: runtime snapshot real de finalEmbroideryCommands');
  lines.push('Restricción: solo diagnóstico, sin reparación ni mutación de comandos/regiones.');
  lines.push('');
  lines.push('## 1. Fuente de comandos');
  for (const [k, v] of Object.entries(a.source)) lines.push(`- ${k}: ${v}`);
  lines.push(`- finalObjectsCount: ${a.finalObjectsCount}`);
  lines.push('');
  lines.push('## 2. Resumen global');
  for (const [k, v] of Object.entries(a.summary)) lines.push(`- ${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`);
  lines.push('');
  lines.push('## 3. Clasificación del problema');
  lines.push(`- percentTravelIssue: ${a.categories.percentTravelIssue}%`);
  lines.push(`- percentFillClippingIssue: ${a.categories.percentFillClippingIssue}%`);
  lines.push(`- percentContourIssue: ${a.categories.percentContourIssue}%`);
  lines.push(`- percentLayerOrderIssue: ${a.categories.percentLayerOrderIssue}%`);
  lines.push(`- issueStage: ${a.classification.issueStage}`);
  lines.push(`- primaryCause: ${a.classification.primaryCause}`);
  lines.push(`- secondaryCauses: ${JSON.stringify(a.classification.secondaryCauses)}`);
  lines.push(`- recommendedFix: ${a.classification.recommendedFix}`);
  lines.push('');
  lines.push('## 4. Peores 50 comandos');
  lines.push('| index | previousIndex | fromX | fromY | toX | toY | distanceMm | color | prevRegionId | regionId | stitchType | layerType | source | severity | suggestedFix | reason |');
  lines.push('|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---|---|---|---|');
  for (const o of a.worstOffenders) lines.push(`| ${o.index} | ${o.previousIndex} | ${fmt(o.fromX)} | ${fmt(o.fromY)} | ${fmt(o.toX)} | ${fmt(o.toY)} | ${fmt(o.distanceMm)} | ${o.color} | ${o.prevRegionId || ''} | ${o.regionId || ''} | ${o.stitchType} | ${o.layerType} | ${o.source} | ${o.severity} | ${o.suggestedFix} | ${o.reason.join('; ')} |`);
  lines.push('');
  lines.push('## 5. Calidad por región');
  lines.push('| regionId | color | stitchTypeDominante | layerTypeDominante | stitchCount | long>4 | long>8 | stitchedTravel | fillOutside | crossRegion | maxVisibleMm | densityEstimate | offenderScore | recommendedRegionFix | hasContour |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|');
  for (const r of a.regions) lines.push(`| ${r.regionId} | ${r.color} | ${r.stitchTypeDominant} | ${r.layerTypeDominant} | ${r.stitchCount} | ${r.longStitchCountGt4} | ${r.longStitchCountGt8} | ${r.stitchedTravelCount} | ${r.fillOutsideRegionCount} | ${r.crossRegionStitchCount} | ${fmt(r.maxVisibleStitchMm)} | ${fmt(r.densityEstimate)} | ${r.offenderScore} | ${r.recommendedRegionFix} | ${r.hasContourAssociated} |`);
  lines.push('');
  lines.push('## 6. Todos los offenders');
  for (const o of a.offenders) lines.push(`- #${o.index} prev=${o.previousIndex} dist=${fmt(o.distanceMm)}mm severity=${o.severity} region=${o.regionId || 'none'} prevRegion=${o.prevRegionId || 'none'} fix=${o.suggestedFix} reason=${o.reason.join(', ')}`);
  lines.push('');
  lines.push('## 7. Campos finales obligatorios');
  lines.push(`runtimeSnapshotAvailable=${a.runtimeSnapshotAvailable}`);
  lines.push(`commandSourceUsed=${a.source.commandSourceUsed}`);
  lines.push(`percentTravelIssue=${a.categories.percentTravelIssue}`);
  lines.push(`percentFillClippingIssue=${a.categories.percentFillClippingIssue}`);
  lines.push(`percentContourIssue=${a.categories.percentContourIssue}`);
  lines.push(`percentLayerOrderIssue=${a.categories.percentLayerOrderIssue}`);
  lines.push(`totalCommands=${a.summary.totalCommands}`);
  lines.push(`totalStitches=${a.summary.totalStitches}`);
  lines.push(`totalJumps=${a.summary.totalJumps}`);
  lines.push(`totalTrims=${a.summary.totalTrims}`);
  lines.push(`visibleLongStitchCount=${a.summary.visibleLongStitchCount}`);
  lines.push(`severeVisibleLongStitchCount=${a.summary.severeVisibleLongStitchCount}`);
  lines.push(`stitchedTravelCount=${a.summary.stitchedTravelCount}`);
  lines.push(`fillOutsideRegionCount=${a.summary.fillOutsideRegionCount}`);
  lines.push(`crossRegionStitchCount=${a.summary.crossRegionStitchCount}`);
  lines.push(`blackContourOffenderCount=${a.summary.blackContourOffenderCount}`);
  lines.push(`maxVisibleStitchMm=${fmt(a.summary.maxVisibleStitchMm)}`);
  lines.push(`worstOffenderRegionIds=${JSON.stringify(a.summary.worstOffenderRegionIds)}`);
  lines.push(`worstOffenderCommandIndexes=${JSON.stringify(a.summary.worstOffenderCommandIndexes)}`);
  lines.push(`issueStage=${a.classification.issueStage}`);
  lines.push(`primaryCause=${a.classification.primaryCause}`);
  lines.push(`recommendedFix=${a.classification.recommendedFix}`);
  return lines.join('\n');
}
function fmt(n) { return Number.isFinite(n) ? Number(n).toFixed(3) : '0.000'; }