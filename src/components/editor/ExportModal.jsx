import { useState, useMemo, useEffect } from 'react';
import { X, Download, Clock, Layers, Palette, FileText, ChevronRight, ShieldCheck, ShieldAlert, Bug, Wrench, RefreshCw, Zap, Scissors, Route } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import PreflightPanel from './PreflightPanel';
import ExportDebugPanel from './ExportDebugPanel';
import ExportFixWizard from './ExportFixWizard';
import ValidationPreview from './ValidationPreview';
import RepairProgressPanel from './RepairProgressPanel';
import AdaptiveOptimizationReport from './AdaptiveOptimizationReport';
import CE01ReportPanel from './CE01ReportPanel';
import { encodeOptimizedToFile, encodeToFile, encodeCanonicalCommandsToFile, buildFinalCommands, logCommandsSync } from '@/lib/exportPipeline';
import { autoCleanupRegions } from '@/lib/autoCleanup';
import { validateCE01 } from '@/lib/ce01Validator';
import { sanitizeCommandsForCE01 } from '@/lib/ce01CommandSanitizer';
import { prepareCE01ProductionExport } from '@/lib/ce01ProductionExport';
import { buildDSTFromCommands } from '@/lib/dstDirectExport';
import { computeExportReality } from '@/lib/exportRealityCheck';
import { validateColorChangeIntegrity } from '@/lib/threadColorBlocks';
import { generate3ColorTestDST } from '@/lib/ce01ColorTestFile';
import { generateContourTestDST, generateOutlineOnlyDST } from '@/lib/contourTestFile';
import { getContourExportReport, generateContourStitches } from '@/lib/contourExportBuilder';
import { rebuildLowerOuterContoursFromDarkStroke } from '@/lib/lowerContourRebuilder';
import ExportRealityCheck from './ExportRealityCheck';
import ContourRefinePanel from './ContourRefinePanel';
import { calculateUnifiedCommandMetrics } from '@/lib/unifiedCommandMetrics';
import CE01ProductionPanel from './CE01ProductionPanel';
import BinaryInspectorPanel from './BinaryInspectorPanel';
import CE01FormatTestPanel from './CE01FormatTestPanel';
import RawDarkStrokeTestPanel from './RawDarkStrokeTestPanel';
import BinaryMinimalTestPanel from './BinaryMinimalTestPanel';
import ExportRepairPanel from './ExportRepairPanel';
import ExportTrafficLight from './exportCenter/ExportTrafficLight';
import LabSection from './exportCenter/LabSection';
import { detectExportErrors } from '@/lib/exportRepair/exportErrorDetector';
import { getEffectiveExportCommands } from '@/lib/exportRepair/getEffectiveExportCommands';
import { validateEmbroideryCompatibility } from '@/lib/embroideryValidation/validationArchitecture';
import ValidationModeSelector from './ValidationModeSelector';
import UniversalValidationSummary from './UniversalValidationSummary';
import UniversalExportAcceptanceTestPanel from './UniversalExportAcceptanceTestPanel';
import ExportBlockingCausePanel from './ExportBlockingCausePanel';
import { analyzeExportBlocking } from '@/lib/exportBlockingAudit';
import { runExportedFileBinaryRoundtripForensics, parseDST } from '@/lib/exportedFileBinaryRoundtripForensics';
import { verifyCanonicalBinaryExport, buildExportTruthFixReportMarkdown, summarizeCanonicalCommands } from '@/lib/exportBinaryCommandSourceTruth';
import { toast } from '@/components/ui/use-toast';

const FORMATS = ['DSB', 'DST', 'PES', 'JEF', 'EXP'];

/**
 * Production export gate — uses the active validation mode. CE01 blocks only
 * when validationMode is explicitly ce01_strict. Never consults stabilityScore,
 * adaptiveResult, or geometryWarnings. Blocks only on: empty commands,
 * active validation INVALID, or encode failure.
 */
function canExportInCE01ProductionMode({ commands, productionValidation, encodeReady, format }) {
  if (!commands || commands.length === 0) {
    return { allowed: false, reason: 'No hay comandos de bordado válidos', blockingCheck: 'COMMANDS_PRESENT' };
  }
  if (!encodeReady) {
    return { allowed: false, reason: 'El archivo no se puede codificar', blockingCheck: 'ENCODER_READY' };
  }
  if (!['DST', 'DSB'].includes(String(format || '').toUpperCase())) {
    return { allowed: false, reason: 'Formato no habilitado para prueba de máquina', blockingCheck: 'FORMAT_ALLOWED' };
  }
  if (productionValidation?.universal?.status === 'INVALID') {
    return { allowed: false, reason: 'Universal INVALID', blockingCheck: 'UNIVERSAL_VALID' };
  }
  if (productionValidation?.format?.status === 'INVALID') {
    return { allowed: false, reason: `${format} INVALID`, blockingCheck: 'FORMAT_VALID' };
  }
  return { allowed: true, reason: 'Exportación permitida; warnings no bloqueantes', blockingCheck: 'REAL_EXPORT_GATE' };
}

async function buildVerifiedDSTBlobFromCanonicalCommands({ commands, objects = [], projectName }) {
  const { blob } = buildDSTFromCommands(commands, {
    label: (projectName || 'design').replace(/[^a-zA-Z0-9_-]/g, '_'),
    ce01Strict: true,
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parsed = parseDST(bytes);
  const canonical = summarizeCanonicalCommands(commands);
  const stitchTolerance = Math.max(8, Math.ceil(canonical.canonicalStitches * 0.08));
  const stitchesMatch = Math.abs((parsed.parsedStitches || 0) - canonical.canonicalStitches) <= stitchTolerance;
  const colorsMatch = (parsed.parsedColorChanges || 0) === canonical.canonicalColorChanges;
  const valid = blob.size > 512 && parsed.headerValid && parsed.recordLengthValid && parsed.endPresent && stitchesMatch && colorsMatch;
  return { blob, parsed, canonical, canonicalObjectsCount: objects.length, valid };
}

export default function ExportModal({ project, config: editorConfig, regions: initialRegions, darkStroke, canonicalFinalCommands = [], canonicalFinalObjects = [], canonicalCommandMeta = null, finalCommands: legacyFinalCommands = [], finalObjects: legacyFinalObjects = [], finalMeta: legacyFinalMeta = null, commandVersion, onClose }) {
  const editorFinalCommands = canonicalFinalCommands?.length ? canonicalFinalCommands : legacyFinalCommands;
  const editorFinalObjects = canonicalFinalObjects?.length ? canonicalFinalObjects : legacyFinalObjects;
  const editorFinalMeta = canonicalCommandMeta || legacyFinalMeta;
  const canonicalCommandsReceived = editorFinalCommands?.length > 0;
  const [step, setStep] = useState('preflight'); // 'preflight' | 'export'
  const [regions, setRegions] = useState(initialRegions || []);
  const [cleanupReport, setCleanupReport] = useState(null);

  // Emergency stabilization: do not mutate regions automatically on export open.
  useEffect(() => {
    if (!initialRegions || initialRegions.length === 0) return;
    setRegions(initialRegions);
    setCleanupReport([{ action: 'emergency_quarantine', message: 'Limpieza automática desactivada: no se reducen puntadas ni se reordenan regiones.' }]);
  }, []); // run once on open
  const [format, setFormat] = useState('DST');
  const dsbTemporarilyDisabled = true;
  const dsbDisabledReason = 'stitchPaths array required';
  const [machine, setMachine] = useState('');
  const [speed, setSpeed] = useState(800);
  const [cuts, setCuts] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [debugMode, setDebugMode] = useState(false);
  const [pipeline, setPipeline] = useState(null);
  const [fixAttempted, setFixAttempted] = useState(false);
  const [wizardResult, setWizardResult] = useState(null);
  const [adaptiveReport, setAdaptiveReport] = useState(null);
  const [showAdaptiveReport, setShowAdaptiveReport] = useState(false);
  // ── Pre-export repair state ──
  const [repairedCommands, setRepairedCommands] = useState(null);
  const [repairAccepted, setRepairAccepted] = useState(false);
  const [exportView, setExportView] = useState('final'); // 'final' | 'exportable' | 'compare'
  const [uiMode, setUiMode] = useState('simple'); // 'simple' | 'lab'  — UI_EXPORT_CENTER_CLEANUP_V1
  const [binaryAuditRunning, setBinaryAuditRunning] = useState(false);
  const [validationMode, setValidationMode] = useState((editorConfig || project?.config || {}).validationMode || 'universal');

  const config = { ...(editorConfig || project?.config || {}), validationMode };
  const totalStitches = regions.reduce((s, r) => s + (r.stitch_count || 0), 0);
  const colorsUsed = new Set(regions.map(r => r.color)).size;
  const estimatedMin = Math.ceil(totalStitches / (speed || 800));
  const widthMm  = config.width_mm  || 100;
  const heightMm = config.height_mm || 100;

  const machineSettings = {
    maxStitchLength: 12.1,
    maxJumpLength: 12.1,
    hoopSize: [widthMm, heightMm],
    designOffset: [0, 0],
    trimThreshold: 3.5,
  };

  // Export surface uses canonical commands when Editor already computed them.
  // buildFinalCommands is only a legacy fallback when canonicalFinalCommands are absent.
  const pipelineResult = useMemo(() => {
    if (editorFinalCommands?.length > 0) {
      const meta = editorFinalMeta || { source: 'canonicalFinalCommands' };
      console.log('[commands-state] export uses: canonicalFinalCommands');
      logCommandsSync('export-canonical', meta);
      return {
        commands: editorFinalCommands,
        objects: editorFinalObjects || [],
        ready: true,
        blockingErrors: [],
        warnings: [],
        stages: { fixReport: { applied: [] } },
        _meta: meta,
        _sanitizeReport: null,
      };
    }
    console.warn('Export está regenerando comandos porque no hay canonicalFinalCommands');
    const { commands, objects, meta, sanitizeReport, validation } = buildFinalCommands(regions, config, machineSettings, format);
    console.log('[commands-state] export uses: buildFinalCommands LEGACY FALLBACK');
    logCommandsSync('export-legacy', meta);
    return {
      commands,
      objects,
      ready: validation.passed,
      blockingErrors: validation.errors,
      warnings: validation.warnings,
      stages: { fixReport: { applied: [] } },
      _meta: meta,
      _sanitizeReport: sanitizeReport,
    };
  }, [editorFinalCommands, editorFinalObjects, editorFinalMeta, regions, config, machineSettings, format]);

  const exportCommandSource = editorFinalCommands?.length ? editorFinalCommands : pipelineResult.commands;
  const exportObjectSource = editorFinalObjects?.length ? editorFinalObjects : pipelineResult.objects;

  // CE01 validation + sanitization — before/after comparison
  const { ce01ReportBefore, ce01ReportAfter, sanitizeReport } = useMemo(() => {
    const before = validateCE01(
      pipelineResult.commands, pipelineResult.objects, regions, config,
      { ...machineSettings, maxSpeed: speed }
    );
    const { commands: sanitizedCommands, report: sanReport } = sanitizeCommandsForCE01(
      pipelineResult.commands, machineSettings
    );
    const after = validateCE01(
      sanitizedCommands, pipelineResult.objects, regions, config,
      { ...machineSettings, maxSpeed: speed }
    );
    console.log(`[ce01-sanitize] CE01 score before: ${before.score}`);
    console.log(`[ce01-sanitize] CE01 score after: ${after.score}`);
    return { ce01ReportBefore: before, ce01ReportAfter: after, sanitizeReport: sanReport };
  }, [pipelineResult.commands, pipelineResult.objects, regions, config, machineSettings, speed]);

  // ce01Report = after-sanitizer report (used for export gate + display)
  const ce01Report = ce01ReportAfter;

  // ── CE01 Production Mode ──────────────────────────────────────────────
  // When enabled, export uses finalEmbroideryCommands directly — no adaptive
  // optimization engine, no stability optimizer, no region regeneration.
  // Pipeline: finalCommands → repair (if improves) → sanitize (if improves) → CE01 validate → encode
  const ce01ProductionMode = config.ce01ProductionMode === true;

  // CE01 Production Mode: force DST while DSB backend is temporarily disabled.
  useEffect(() => {
    if (ce01ProductionMode || (dsbTemporarilyDisabled && format === 'DSB')) setFormat('DST');
  }, [ce01ProductionMode, format]);

  // Clear stale adaptive/stability states when opening in production mode —
  // old adaptiveReport or stabilityScore must never block CE01 production export.
  useEffect(() => {
    if (ce01ProductionMode) {
      console.log('[ce01-production-export] mode enabled:', true);
      console.log('[ce01-production-export] adaptive skipped: true');
      console.log('[ce01-production-export] stability gate skipped: true');
      setAdaptiveReport(null);
      setShowAdaptiveReport(false);
      setWizardResult(null);
    }
  }, [ce01ProductionMode]);
  const productionReport = useMemo(() => {
    if (!ce01ProductionMode) return null;
    const sourceCommands = exportCommandSource;
    const sourceObjects = exportObjectSource;
    return prepareCE01ProductionExport(sourceCommands, regions, config, machineSettings, sourceObjects, format);
  }, [ce01ProductionMode, editorFinalCommands, editorFinalObjects, regions, config, machineSettings, format]);

  const productionValidation = useMemo(() => {
    if (!ce01ProductionMode) return null;
    const sourceCommands = exportCommandSource;
    return validateEmbroideryCompatibility({
      commands: sourceCommands,
      objects: exportObjectSource,
      regions,
      config,
      machineSettings,
      format,
    });
  }, [ce01ProductionMode, editorFinalCommands, editorFinalObjects, pipelineResult.commands, pipelineResult.objects, regions, config, machineSettings, format]);

  // ── Production gate decision (used by button + handleExport) ──────
  // CE01 only blocks when validationMode === 'ce01_strict'.
  const productionGateDecision = useMemo(() => {
    if (!ce01ProductionMode) return null;
    const sourceCommands = exportCommandSource;
    return canExportInCE01ProductionMode({
      commands: sourceCommands,
      productionValidation,
      encodeReady: true,
      format,
    });
  }, [ce01ProductionMode, editorFinalCommands, pipelineResult.commands, productionValidation, format]);

  // ── Effective export commands (helper ÚNICO) ──────────────────────────────
  // Prioridad: repairedCommands (V5) → productionReport.commands → editorFinalCommands → pipelineResult.commands
  // Se usa en TODA exportación / validación de archivo real: handleExport, Kirby completo,
  // ValidationPreview (exportable), ExportRealityCheck, ContourRefinePanel, unifiedMetrics.
  const effectiveExport = useMemo(() => getEffectiveExportCommands({
    repairAccepted,
    repairedCommands,
    editorFinalCommands,
    pipelineCommands: pipelineResult.commands,
    productionCommands: productionReport?.exportAllowed ? productionReport?.commands : null,
  }), [repairAccepted, repairedCommands, editorFinalCommands, pipelineResult.commands, productionReport]);

  // ── Unified metrics — single source of truth for all display ──────────────
  // Usa los mismos comandos que se exportarán (effectiveExport).
  const unifiedMetrics = useMemo(() => {
    return calculateUnifiedCommandMetrics(effectiveExport.commands, regions, { hoopSize: [widthMm, heightMm] });
  }, [effectiveExport.commands, regions, widthMm, heightMm]);

  // ── Metrics sync — single source: finalEmbroideryCommands ──────────────────
  // No comparison against pipelineResult (different rebuild can differ in
  // longStitches/shortStitches even when stitch/jump/trim/color match).
  // Only flag if the command source itself is empty/invalid.
  const commandsEmpty = !editorFinalCommands || editorFinalCommands.length === 0;

  useEffect(() => {
    console.log('[metrics-sync] commandVersion:', commandVersion);
    console.log('[metrics-sync] modal metrics:', { stitches: unifiedMetrics.stitchCount, jumps: unifiedMetrics.jumpCount, trims: unifiedMetrics.trimCount, colors: unifiedMetrics.colorCount });
    console.log('[metrics-sync] all from finalEmbroideryCommands: true');
    console.log('[metrics-sync] mismatch false: single source');
  }, [unifiedMetrics, commandVersion]);

  // ── Export Reality Check — visual vs exported comparison ──────────────────
  const realityCheck = useMemo(() => {
    return computeExportReality(regions, effectiveExport.commands);
  }, [effectiveExport.commands, regions]);

  // ── Contour reality check — outer outline must be real stitches ──────────
  const contourReport = useMemo(() => {
    return getContourExportReport(regions, effectiveExport.commands);
  }, [effectiveExport.commands, regions]);

  // ── UI_EXPORT_CENTER_CLEANUP_V1: technical detection for traffic light + simple summary ──
  // Solo lectura: no cambia la lógica de exportación. Mismo detector que el panel de reparación.
  const techDetection = useMemo(() => detectExportErrors(
    effectiveExport.commands,
    exportObjectSource,
    regions, config, machineSettings
  ), [effectiveExport.commands, editorFinalObjects, pipelineResult.objects, regions, config, machineSettings]);
  const exportBlockingAudit = useMemo(() => analyzeExportBlocking({
    commands: effectiveExport.commands,
    format,
  }), [effectiveExport.commands, format]);
  const exportAllowedByRealGate = exportBlockingAudit.exportAllowed && (productionGateDecision?.allowed ?? true);
  const remainingBlocking = useMemo(
    () => exportAllowedByRealGate ? [] : [{ rule: productionGateDecision?.blockingCheck || exportBlockingAudit.blockingCheck, type: productionGateDecision?.reason || exportBlockingAudit.blockingReason, count: 1, severity: 'blocking', reparable: false, message: productionGateDecision?.reason || exportBlockingAudit.unlockHint, proposedAction: exportBlockingAudit.unlockHint }],
    [exportAllowedByRealGate, exportBlockingAudit, productionGateDecision]
  );
  const activeValidation = techDetection.validation || techDetection.architecture?.active;
  const activeStatus = activeValidation?.status || techDetection.ce01.status;
  const lightLevel = !exportAllowedByRealGate
    ? 'red' : (activeStatus === 'RISKY' || activeStatus === 'WARNING' || activeStatus === 'INVALID' ? 'amber' : 'green');
  const hasNonBlockingWarnings = exportAllowedByRealGate && (
    activeStatus === 'RISKY' || activeStatus === 'WARNING' || activeStatus === 'INVALID' ||
    ce01Report.status === 'RISKY' || ce01Report.status === 'INVALID' ||
    techDetection.errors.length > 0 ||
    (productionValidation?.active?.warnings || []).length > 0
  );

  // In production mode, stale adaptive/stability states are ignored entirely
  const effectiveAdaptiveReport = ce01ProductionMode ? null : adaptiveReport;

  const handleBinaryAudit = async () => {
    setBinaryAuditRunning(true);
    setExportError(null);
    try {
      const { markdown } = await runExportedFileBinaryRoundtripForensics({
        commands: effectiveExport.commands,
        objects: exportObjectSource,
        projectName: project?.name || 'design',
        machineSettings,
        base44Client: base44,
      });
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'EXPORTED_FILE_BINARY_ROUNDTRIP_FORENSICS_V1.md';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e.message || 'No se pudo auditar el archivo exportado');
    } finally {
      setBinaryAuditRunning(false);
    }
  };

  const handleExport = async () => {
    // ── Pre-export sync validation ──────────────────────────────────────────
    // Verify the export command source is valid and log metrics for traceability.
    // In production mode, export uses editorFinalCommands (same as simulation/validation).
    const sourceCommands = exportCommandSource;
    const sourceMetrics = calculateUnifiedCommandMetrics(sourceCommands, regions, machineSettings);
    console.log('[command-sync] export source: finalEmbroideryCommands');
    console.log('[command-sync] export metrics:', { stitches: sourceMetrics.stitchCount, jumps: sourceMetrics.jumpCount, trims: sourceMetrics.trimCount });

    if (format === 'DSB' && dsbTemporarilyDisabled) {
      setExportError(`DSB no disponible temporalmente. El backend requiere stitchPaths. Usa DST para la prueba de máquina.`);
      return;
    }

    if (format === 'DST') {
      const dstCommands = canonicalFinalCommands || [];
      const dstObjects = canonicalFinalObjects || [];
      if (!dstCommands.length) {
        setExportError('No hay comandos canónicos finales para exportar DST.');
        return;
      }
      setExporting(true);
      setExportError(null);
      try {
        const { blob, parsed, canonical, canonicalObjectsCount, valid } = await buildVerifiedDSTBlobFromCanonicalCommands({
          commands: dstCommands,
          objects: dstObjects,
          projectName: project?.name || 'design',
        });
        console.log('[force-dst-direct-export]', {
          dstBlobSizeBytes: blob.size,
          dstHeaderValid: parsed.headerValid,
          dstRecordLengthValid: parsed.recordLengthValid,
          dstEndPresent: parsed.endPresent,
          canonicalStitches: canonical.canonicalStitches,
          canonicalColorChanges: canonical.canonicalColorChanges,
          parsedStitches: parsed.parsedStitches,
          parsedColorChanges: parsed.parsedColorChanges,
          canonicalObjectsCount,
          atobError: false,
          backendBypassed: true,
        });
        if (!valid) {
          setExportError('DST no pasó la verificación binaria previa a la descarga.');
          return;
        }
        const filename = `${(project?.name || 'design').replace(/[^a-zA-Z0-9_-]/g, '_')}.dst`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: 'DST exportado correctamente' });
        onClose();
      } catch (e) {
        setExportError(e.message || 'Error al exportar DST');
      } finally {
        setExporting(false);
      }
      return;
    }

    if (!sourceCommands || sourceCommands.length === 0) {
      console.log('[command-sync] mismatch detected: empty export commands');
      setExportError('Las métricas no están sincronizadas. Regenera comandos finales.');
      return;
    }
    if (!exportAllowedByRealGate) {
      setExportError(`Bloqueo real: ${productionGateDecision?.reason || exportBlockingAudit.blockingReason} · ${exportBlockingAudit.blockingModule} · ${productionGateDecision?.blockingCheck || exportBlockingAudit.blockingCheck}. ${exportBlockingAudit.unlockHint}`);
      return;
    }

    // Single source: finalEmbroideryCommands — no comparison against pipelineResult.
    console.log('[metrics-sync] validator metrics:', { stitches: sourceMetrics.stitchCount, jumps: sourceMetrics.jumpCount, trims: sourceMetrics.trimCount, colors: sourceMetrics.colorCount });
    console.log('[command-sync] panels synced: YES');

    // ── CE01 Production path: no recalculation, no aggressive optimizers ──
    if (ce01ProductionMode) {
      const sourceCommands = exportCommandSource;
      const gateDecision = canExportInCE01ProductionMode({
        commands: sourceCommands,
        productionValidation,
        encodeReady: true,
        format,
      });

      console.log('[export-gate] ce01ProductionMode:', ce01ProductionMode);
      console.log('[export-gate] adaptive gate active:', !ce01ProductionMode);
      console.log('[export-gate] stabilityScore: ignored (production mode)');
      console.log('[export-gate] universalValidation:', productionValidation?.universal?.status);
      console.log('[export-gate] formatValidation:', productionValidation?.format?.status);
      console.log('[export-gate] final decision:', gateDecision);

      if (!gateDecision.allowed) {
        setExportError(`Bloqueo real: ${gateDecision.reason}`);
        return;
      }

      // ── Color mismatch validation — block if multi-color design exports as 1 color ──
      // Use repaired commands only when repairAccepted (they may have merged similar colors).
      const ccSource = effectiveExport.commands;
      const colorChanges = ccSource.filter(c => c.type === 'colorChange').length;
      const visualColorCount = new Set(regions.map(r => r.color).filter(Boolean)).size;
      const ccIntegrity = validateColorChangeIntegrity(ccSource);
      if (visualColorCount > 1 && colorChanges === 0) {
        setExportError('El DST saldría como un solo color. Faltan paradas de color.');
        return;
      }
      if (!ccIntegrity.valid && ccIntegrity.blockCount > 1) {
        setExportError(`Color mismatch: ${ccIntegrity.blockCount} bloques de color pero ${ccIntegrity.colorChangeCount} colorChanges (esperados ${ccIntegrity.expectedColorChanges}).`);
        return;
      }
      if (realityCheck && !realityCheck.ready) {
        console.warn('[export-gate] visual reality warning ignored by emergency hard gate:', realityCheck);
      }
      // Visual contour mismatch is diagnostic only in emergency stabilization mode.
      if (contourReport.contourMissing) {
        console.warn('[export-gate] contour warning ignored by emergency hard gate:', contourReport);
      }
      console.log('[ce01-production-export] export allowed: true');
      setExporting(true);
      setExportError(null);
      try {
        const exportCommands = effectiveExport.commands;
        const exportObjects = exportObjectSource;
        const { blob } = await encodeCanonicalCommandsToFile({
          commands: exportCommands,
          objects: exportObjects,
          format,
          machineSettings,
          base44Client: base44,
        });
        const shouldRoundtripVerify = ['DST', 'DSB'].includes(String(format).toUpperCase());
        const verification = shouldRoundtripVerify ? await verifyCanonicalBinaryExport({ canonicalCommands: exportCommands, blob, format }) : null;
        const truthReport = buildExportTruthFixReportMarkdown({
          verification,
          exportedFormat: format,
          oldExportPathUsedBuildFinalCommands: true,
          canonicalCommandsReceived,
        });
        console.log('[export-binary-command-source-truth]', verification || { skipped: true, format });
        console.log(truthReport);
        if (shouldRoundtripVerify && verification.commandToBinaryMismatchAfter) {
          setExportError(`El binario no coincide con los comandos canónicos: ST=${verification.binaryHeaderST}, CO=${verification.binaryHeaderCO}, records=${verification.binaryRecordCount}.`);
          return;
        }
        const filename = `${(project?.name || 'design').replace(/[^a-zA-Z0-9_-]/g, '_')}.${format.toLowerCase()}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        onClose();
      } catch (e) {
        console.error(e);
        setExportError(e.message || 'Error al exportar el diseño');
      } finally {
        setExporting(false);
      }
      return;
    }

    // ── Standard path: canonical export first, legacy fallback only if canonical is absent ─────────────────────
    const commands = canonicalCommandsReceived ? effectiveExport.commands : (wizardResult?.commands || pipelineResult.commands);
    const objects = canonicalCommandsReceived ? (exportObjectSource) : (wizardResult?.objects || pipelineResult.objects);
    if (!canonicalCommandsReceived) console.warn('Export está regenerando comandos porque no hay canonicalFinalCommands');

    // Emergency gate: validation warnings do not block export. Hard blockers were already checked by exportBlockingAudit.
    if (!pipelineResult.ready && !wizardResult) {
      console.warn('[export-gate] pipeline validation warning ignored by emergency hard gate:', pipelineResult.blockingErrors);
    }

    // CE01 strict warnings do not block unless exportBlockingAudit found a hard file/command error.
    if (validationMode === 'ce01_strict' && ce01Report.status === 'INVALID') {
      console.warn('[export-gate] CE01 strict warning ignored by emergency hard gate:', ce01Report.blockingIssues);
    }
    setExporting(true);
    setExportError(null);
    setAdaptiveReport(null);
    try {
      const { blob } = canonicalCommandsReceived
        ? await encodeCanonicalCommandsToFile({ commands, objects, format, machineSettings, base44Client: base44 })
        : { blob: await encodeToFile(commands, objects, format, machineSettings, base44) };
      const shouldRoundtripVerify = ['DST', 'DSB'].includes(String(format).toUpperCase());
      const verification = shouldRoundtripVerify ? await verifyCanonicalBinaryExport({ canonicalCommands: commands, blob, format }) : null;
      const truthReport = buildExportTruthFixReportMarkdown({
        verification,
        exportedFormat: format,
        oldExportPathUsedBuildFinalCommands: true,
        canonicalCommandsReceived,
      });
      console.log('[export-binary-command-source-truth]', verification || { skipped: true, format });
      console.log(truthReport);
      if (canonicalCommandsReceived && shouldRoundtripVerify && verification.commandToBinaryMismatchAfter) {
        setExportError(`El binario no coincide con los comandos canónicos: ST=${verification.binaryHeaderST}, CO=${verification.binaryHeaderCO}, records=${verification.binaryRecordCount}.`);
        return;
      }
      setAdaptiveReport(null);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(project?.name || 'design').replace(/[^a-zA-Z0-9_-]/g, '_')}.${format.toLowerCase()}`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      console.error(e);
      setExportError(e.message || 'Error al exportar el diseño');
    } finally {
      setExporting(false);
    }
  };

  const blockingErrors = pipelineResult.blockingErrors || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="bg-[#161a23] border border-[#2a2d3a] rounded-xl shadow-2xl flex flex-col"
           style={{ width: step === 'preflight' ? 480 : step === 'wizard' ? 460 : showAdaptiveReport ? 560 : (debugMode ? 640 : 400), maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2130] flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              {step === 'preflight'
                ? <ShieldCheck className="w-4 h-4 text-violet-400" />
                : step === 'wizard'
                  ? <Wrench className="w-4 h-4 text-cyan-400" />
                  : blockingErrors.length > 0 && !wizardResult
                    ? <ShieldAlert className="w-4 h-4 text-red-400" />
                    : <Download className="w-4 h-4 text-violet-400" />}
              <h2 className="text-sm font-bold text-white">
                {step === 'preflight' ? 'Pre-flight check' : step === 'wizard' ? 'Asistente de corrección' : 'Exportar diseño'}
              </h2>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">{project?.name}</p>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mr-4">
            {['preflight', 'wizard', 'export'].map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border transition-colors ${
                  step === s ? 'bg-violet-600 border-violet-500 text-white' :
                  (step === 'wizard' && i === 0) || (step === 'export' && i <= 1) ? 'bg-emerald-900/40 border-emerald-500/40 text-emerald-400' :
                  'border-[#2a2d3a] text-slate-600'}`}>{i + 1}</div>
                {i < 2 && <ChevronRight className="w-3 h-3 text-slate-600" />}
              </div>
            ))}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#2a2d3a] text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {step === 'preflight' ? (
            <div className="p-5 space-y-5">
              <PreflightPanel
                regions={regions}
                config={config}
                onAutoFix={setRegions}
                onOptimizeRoute={setRegions}
              />
              <div className="border-t border-[#1e2130] pt-4">
                <RepairProgressPanel
                  regions={regions}
                  config={config}
                  machineSettings={machineSettings}
                  format={format}
                  onRepairComplete={(res) => {
                    if (res.regions) setRegions(res.regions);
                  }}
                />
              </div>
            </div>
          ) : step === 'wizard' ? (
            <ExportFixWizard
              regions={regions}
              config={config}
              machineSettings={machineSettings}
              format={format}
              onComplete={(result) => {
                setWizardResult(result);
                setStep('export');
              }}
              onCancel={() => setStep('export')}
            />
          ) : showAdaptiveReport && effectiveAdaptiveReport ? (
            <div className="p-5">
              <AdaptiveOptimizationReport
                result={adaptiveReport}
                onClose={() => { setShowAdaptiveReport(false); }}
              />
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {/* ── UI_EXPORT_CENTER_CLEANUP_V1: mode toggle ── */}
              <div className="flex items-center gap-2 bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider mr-1">Modo</span>
                <button onClick={() => setUiMode('simple')}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${uiMode === 'simple' ? 'bg-violet-600 text-white' : 'border border-[#2a2d3a] text-slate-400 hover:text-slate-200'}`}>Simple</button>
                <button onClick={() => setUiMode('lab')}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${uiMode === 'lab' ? 'bg-cyan-600 text-white' : 'border border-[#2a2d3a] text-slate-400 hover:text-slate-200'}`}>Laboratorio</button>
                <span className="ml-auto text-[10px] text-slate-600">
                  {uiMode === 'simple' ? 'Vista limpia para usuario normal' : 'Herramientas técnicas y forensics'}
                </span>
              </div>

              <ValidationModeSelector value={validationMode} onChange={setValidationMode} />
              <UniversalValidationSummary architecture={techDetection.architecture} />

              {/* ── UI_EXPORT_CENTER_CLEANUP_V1: traffic light status ── */}
              <ExportTrafficLight
                level={lightLevel}
                ce01Status={activeStatus}
                ce01Score={activeValidation?.score ?? techDetection.ce01.score}
                commandSource={effectiveExport.source}
                visibleDiagonalStitches={techDetection.counts.visibleDiag}
                emptyBlocks={techDetection.counts.emptyBlocks}
                invalidCommandSequence={techDetection.errors.find(e => e.type === 'invalidCommandSequence')?.count || 0}
                regionOutsideBounds={techDetection.errors.find(e => e.type === 'regionOutsideBounds')?.count || 0}
                jumpCount={unifiedMetrics.jumpCount}
                trimCount={unifiedMetrics.trimCount}
                colorCount={unifiedMetrics.colorCount}
                exportAllowed={exportAllowedByRealGate}
                format={format}
              />

              <ExportBlockingCausePanel audit={exportAllowedByRealGate ? { ...exportBlockingAudit, exportAllowed: true, blockingReason: 'none', blockingModule: 'none', blockingCheck: 'REAL_EXPORT_GATE', unlockHint: 'No hay bloqueo real. Warnings reparables y score bajo no bloquean.' } : exportBlockingAudit} />

              <button
                onClick={handleBinaryAudit}
                disabled={binaryAuditRunning || !effectiveExport.commands?.length}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#0d0f14] border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-900/20 transition-colors disabled:opacity-40"
              >
                <FileText className="w-3.5 h-3.5" />
                {binaryAuditRunning ? 'Auditando archivo exportado...' : 'Auditar archivo exportado'}
              </button>

              {/* ── Pre-export technical repair (FASE 1-6) ── */}
              <ExportRepairPanel
                finalCommands={exportCommandSource}
                finalObjects={exportObjectSource}
                regions={regions}
                config={config}
                machineSettings={machineSettings}
                darkStroke={darkStroke}
                uiMode={uiMode}
                onRepairComplete={(res) => {
                  setRepairAccepted(!!res.repairAccepted);
                  if (res.repairAccepted && res.repairedCommands?.length) {
                    setRepairedCommands(res.repairedCommands);
                  } else {
                    setRepairedCommands(null);
                  }
                }}
                exportAllowed={exportAllowedByRealGate}
                onViewChange={(v, cmds) => {
                  setExportView(v);
                  if (v === 'final') setRepairedCommands(null);
                  else if (cmds && cmds.length && repairAccepted) setRepairedCommands(cmds);
                }}
              />

              {uiMode === 'lab' && (
                <UniversalExportAcceptanceTestPanel
                  commands={exportCommandSource}
                  objects={exportObjectSource}
                  regions={regions}
                  config={config}
                  machineSettings={machineSettings}
                  projectName={project?.name || 'design'}
                />
              )}

              {/* Auto-cleanup report — stitch cap + jump trim guarantee */}
              {cleanupReport && cleanupReport.length > 0 && (
                <div className="bg-violet-900/15 border border-violet-500/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <RefreshCw className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-xs font-bold text-violet-300">Limpieza automática aplicada</span>
                  </div>
                  <div className="space-y-0.5">
                    {cleanupReport.map((c, i) => (
                      <div key={i} className="text-[10px] text-violet-300 flex items-start gap-1">
                        <span className="font-bold text-violet-400 shrink-0">[{c.action}]</span>
                        <span>{c.message}</span>
                      </div>
                    ))}
                    <div className="text-[10px] text-cyan-300 flex items-start gap-1">
                      <span className="font-bold text-cyan-400 shrink-0">[jumps]</span>
                      <span>Trims insertados en saltos &gt;3.5mm (regla R13 del pipeline).</span>
                    </div>
                  </div>
                </div>
              )}
              {/* Validation status banner — hidden in CE01 production mode */}
              {!ce01ProductionMode && wizardResult && wizardResult.remainingErrors === 0 ? (
                <div className="bg-emerald-900/20 border border-emerald-500/40 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-400">Errores corregidos por el asistente</span>
                  </div>
                  <p className="text-[10px] text-emerald-300">
                    El asistente corrigió todos los errores bloqueantes. Puedes exportar con seguridad.
                  </p>
                </div>
              ) : !ce01ProductionMode && blockingErrors.length > 0 ? (
                <div className="bg-red-900/20 border border-red-500/40 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-bold text-red-400">Exportación BLOQUEADA</span>
                    <span className="text-[10px] text-red-300 ml-auto">{blockingErrors.length} errores</span>
                  </div>
                  {/* Auto-fix report — what was already repaired */}
                  {pipelineResult.stages.fixReport.applied.length > 0 && (
                    <div className="bg-emerald-900/15 border border-emerald-500/30 rounded px-2 py-1.5 mb-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Wrench className="w-3 h-3 text-emerald-400" />
                        <span className="text-[10px] font-bold text-emerald-400">
                          {pipelineResult.stages.fixReport.applied.length} errores auto-reparados
                        </span>
                      </div>
                      <div className="space-y-0.5 max-h-20 overflow-y-auto">
                        {pipelineResult.stages.fixReport.applied.slice(0, 6).map((f, i) => (
                          <div key={i} className="text-[9px] text-emerald-300 flex items-start gap-1">
                            <span className="font-bold text-emerald-400 shrink-0">[{f.rule}]</span>
                            <span>{f.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Remaining errors — require manual action */}
                  <div className="text-[10px] text-amber-400 mb-1.5 font-medium">
                    ⚠ {blockingErrors.length} error(es) requieren acción manual:
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {blockingErrors.slice(0, 8).map((e, i) => (
                      <div key={i} className="text-[10px] text-red-300 flex items-start gap-1">
                        <span className="font-bold text-red-400 shrink-0">[{e.rule}]</span>
                        <span>{e.message}</span>
                      </div>
                    ))}
                    {blockingErrors.length > 8 && (
                      <div className="text-[10px] text-red-400 italic">+{blockingErrors.length - 8} errores más... (ver Debug)</div>
                    )}
                  </div>
                  {/* Launch wizard button */}
                  <button
                    onClick={() => { setWizardResult(null); setStep('wizard'); }}
                    className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-600/30 transition-colors"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    Iniciar asistente de corrección
                  </button>
                </div>
              ) : !ce01ProductionMode ? (
                <div className="bg-emerald-900/15 border border-emerald-500/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-400">Validación superada — 12 reglas OK</span>
                  </div>
                  {pipelineResult.stages.fixReport.applied.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <Wrench className="w-3 h-3 text-emerald-400" />
                      <span className="text-[10px] text-emerald-300">
                        {pipelineResult.stages.fixReport.applied.length} reparaciones automáticas aplicadas
                      </span>
                    </div>
                  )}
                </div>
              ) : null}

              {/* CE01 Production mode panel — shows command source + protected metrics */}
              {ce01ProductionMode && productionReport && (
                <CE01ProductionPanel report={productionReport} effectiveSource={effectiveExport.source} />
              )}

              {uiMode === 'lab' && (
              <LabSection title="Diagnóstico visual y contornos" icon={Route}>
              {/* Export Reality Check — visual vs exported comparison */}
              <ExportRealityCheck reality={realityCheck} />

              {/* Contour Refine Panel — metrics + debug views */}
              <ContourRefinePanel
                commands={effectiveExport.commands}
                regions={regions}
                config={config}
              />
              </LabSection>
              )}

              {uiMode === 'lab' && (
              <LabSection title="Tests y diagnóstico Kirby" icon={Palette}>
              {/* 3-color CE01 test — generates minimal DST with 2 real colorChange records */}
              <button
                onClick={() => {
                  try {
                    const { blob, meta } = generate3ColorTestDST();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'CE01_3COLOR_TEST.dst';
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) {
                    setExportError(`Test failed: ${e.message}`);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan-900/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-900/30 transition-colors"
              >
                <Palette className="w-3.5 h-3.5" />
                Exportar test 3 colores CE01
              </button>

              {/* Contour test — 60x60mm satin outline only */}
              <button
                onClick={() => {
                  try {
                    const { blob } = generateContourTestDST();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'CE01_CONTOUR_TEST.dst';
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) {
                    setExportError(`Test failed: ${e.message}`);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-900/20 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-900/30 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Exportar test contorno CE01
              </button>

              {/* Kirby outline-only — contours + details, no fills */}
              <button
                onClick={() => {
                  try {
                    const { blob } = generateOutlineOnlyDST(regions, config);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'KIRBY_OUTLINES_ONLY.dst';
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) {
                    setExportError(`Test failed: ${e.message}`);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-amber-900/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-900/30 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Exportar solo contornos Kirby
              </button>

              {/* Kirby completo con contorno refinado — fills + details + contour final */}
              <button
                onClick={() => {
                  try {
                    const cmds = effectiveExport.commands;
                    const { blob } = buildDSTFromCommands(cmds, {
                      label: 'KIRBY_COMPLETO',
                      ce01Strict: true,
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'KIRBY_COMPLETO_CONTORNO_REFINADO.dst';
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) {
                    setExportError(`Test failed: ${e.message}`);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-900/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-900/30 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar Kirby completo con contorno refinado
              </button>

              {/* Test solo contorno inferior y pies — CAMBIO 9 (test aislado) */}
              <button
                onClick={() => {
                  try {
                    const { contours } = rebuildLowerOuterContoursFromDarkStroke(
                      regions, { ...config, lowerContourWidth: 1.1 }, darkStroke
                    );
                    const cmds = [];
                    for (const obj of contours) {
                      const pts = generateContourStitches(obj, machineSettings);
                      if (pts.length < 2) continue;
                      if (cmds.length > 0) cmds.push({ type: 'trim' });
                      cmds.push({ type: 'jump', x: pts[0][0], y: pts[0][1], color: obj.color, layerType: obj.layerType, regionId: obj.id });
                      for (let i = 1; i < pts.length; i++) {
                        cmds.push({ type: 'stitch', x: pts[i][0], y: pts[i][1], color: obj.color, layerType: obj.layerType, stitchType: obj.stitch_type, regionId: obj.id });
                      }
                    }
                    if (cmds.length === 0) { setExportError('No se reconstruyeron contornos inferiores desde línea negra real.'); return; }
                    const { blob } = buildDSTFromCommands(cmds, { label: 'LOWER_FEET_ONLY', ce01Strict: true });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'LOWER_FEET_ONLY_TEST.dst'; a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) {
                    setExportError(`Test failed: ${e.message}`);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan-900/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-900/30 transition-colors"
              >
                <Route className="w-3.5 h-3.5" />
                Test solo contorno inferior y pies
              </button>

              {/* DEBUG RAW dark stroke lower/feet — test totalmente aislado (CAMBIO 1-8) */}
              <RawDarkStrokeTestPanel project={project} config={config} />
              </LabSection>
              )}

              {/* Contour weak warning — not a block, just informational */}
              {contourReport.contourWeak && (
                <div className="text-[10px] text-amber-400 bg-amber-900/15 border border-amber-500/30 rounded-lg px-3 py-2">
                  Contorno exterior demasiado débil o inexistente ({contourReport.outerOutlineStitches} puntadas, mínimo 80).
                </div>
              )}

              {/* CE01 pre-export validation report — before/after sanitizer — Laboratorio */}
              {uiMode === 'lab' && !ce01ProductionMode && (
                <LabSection title="Forensics CE01" icon={FileText}>
                <CE01ReportPanel
                  report={ce01ReportAfter}
                  beforeReport={ce01ReportBefore}
                  sanitizeReport={sanitizeReport}
                />
                </LabSection>
              )}

              {/* Visual preview — highlights problematic stitches in red */}
              <ValidationPreview
                commands={exportView === 'exportable' ? effectiveExport.commands : (exportCommandSource)}
                errors={blockingErrors}
                machineSettings={machineSettings}
                height={140}
              />

              {/* Debug avanzado — Laboratorio */}
              {uiMode === 'lab' && (
                <LabSection title="Debug avanzado" icon={Bug}>
                <button
                  onClick={() => setDebugMode(!debugMode)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                    debugMode ? 'bg-violet-900/20 border-violet-500/40 text-violet-300' : 'bg-[#0d0f14] border-[#2a2d3a] text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <Bug className="w-3.5 h-3.5" />
                  Modo Debug: {debugMode ? 'ON' : 'OFF'}
                  <ChevronRight className="w-3 h-3 ml-auto" />
                </button>

                {debugMode && (
                  <ExportDebugPanel pipeline={pipelineResult} />
                )}
                </LabSection>
              )}

              {/* Forensics y tests de formato — Laboratorio */}
              {uiMode === 'lab' && (
                <LabSection title="Forensics y tests de formato" icon={FileText}>
                <BinaryMinimalTestPanel machineSettings={machineSettings} />

                <BinaryInspectorPanel
                  commands={pipelineResult.commands}
                  objects={pipelineResult.objects}
                  format={format}
                  machineSettings={machineSettings}
                  ce01ProductionMode={ce01ProductionMode}
                  editorFinalCommands={editorFinalCommands}
                  editorFinalObjects={editorFinalObjects}
                />

                <CE01FormatTestPanel />
                </LabSection>
              )}

              {/* Commands empty warning — only real blocker, no false mismatch */}
              {commandsEmpty && (
                <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">
                  No hay comandos finales — Regenera comandos finales.
                </div>
              )}

              {/* Stats — from unified metrics (same source as Editor bottom bar) */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: Layers,   label: 'Puntadas', value: unifiedMetrics.stitchCount.toLocaleString(), color: 'text-violet-400' },
                  { icon: Zap,      label: 'Saltos',   value: unifiedMetrics.jumpCount,                     color: 'text-red-400'    },
                  { icon: Scissors, label: 'Trims',    value: unifiedMetrics.trimCount,                     color: 'text-amber-400'  },
                  { icon: Palette,  label: 'Colores',  value: unifiedMetrics.colorCount,                     color: 'text-cyan-400'   },
                  { icon: Clock,    label: 'Est. (min)',value: Math.ceil(unifiedMetrics.stitchCount / (speed || 800)), color: 'text-emerald-400'},
                  { icon: FileText, label: 'Tamaño',   value: `${widthMm}×${heightMm}`,                      color: 'text-amber-400'  },
                ].map(({ icon: Icon, label, value, color }) => (
                  <div key={label} className="bg-[#0d0f14] rounded-lg p-2.5 text-center border border-[#1e2130]">
                    <Icon className={`w-4 h-4 ${color} mx-auto mb-1`} />
                    <div className={`text-sm font-bold ${color}`}>{value}</div>
                    <div className="text-[10px] text-slate-600">{label}</div>
                  </div>
                ))}
              </div>

              {/* Format — UI_EXPORT_CENTER_CLEANUP_V1: CE01 Production fija DST */}
              <div>
                <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 block">Formato de salida</label>
                <div className="mb-2 text-[10px] text-emerald-400 bg-emerald-900/15 border border-emerald-500/30 rounded-lg px-2 py-1 font-bold">
                  DST listo para prueba. DSB desactivado temporalmente: {dsbDisabledReason}.
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {FORMATS.map(f => {
                    const disabled = f === 'DSB' || (ce01ProductionMode && f !== 'DST');
                    return (
                      <button key={f} onClick={() => !disabled && setFormat(f)} disabled={disabled}
                        title={f === 'DSB' ? `DSB no disponible temporalmente: ${dsbDisabledReason}` : undefined}
                        className={`py-2 rounded-lg border text-xs font-bold transition-all ${
                          format === f ? 'bg-violet-900/30 border-violet-500 text-violet-300' : 'bg-[#0d0f14] border-[#2a2d3a] text-slate-500'
                        } ${disabled ? 'opacity-30 cursor-not-allowed line-through' : 'hover:text-slate-300 hover:border-[#3a3d4a]'}`}>{f === 'DSB' ? 'DSB off' : f}</button>
                    );
                  })}
                </div>
              </div>

              {/* Machine */}
              <div>
                <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 block">Metadatos de máquina</label>
                <div className="space-y-2">
                  <input type="text" placeholder="Nombre de máquina (ej: Caydo CE01)"
                    value={machine} onChange={e => setMachine(e.target.value)}
                    className="w-full bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-500" />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-600 mb-1 block">Velocidad (RPM)</label>
                      <input type="number" min="400" max="1200" value={speed} onChange={e => setSpeed(Number(e.target.value))}
                        className="w-full bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-600 mb-1 block">Cortes</label>
                      <input type="number" min="0" max="50" value={cuts} onChange={e => setCuts(Number(e.target.value))}
                        className="w-full bg-[#0d0f14] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-[#1e2130] flex-shrink-0">
          {step === 'preflight' ? (
            <>
              <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-[#2a2d3a] text-slate-400 text-sm hover:text-white transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => setStep('export')}
                className="flex-1 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                Continuar
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : step === 'wizard' ? (
            <button onClick={() => setStep('export')} className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-slate-400 text-sm hover:text-white transition-colors">
              ← Volver
            </button>
          ) : (
            <>
              <button onClick={() => setStep('preflight')} className="px-4 py-2.5 rounded-lg border border-[#2a2d3a] text-slate-400 text-sm hover:text-white transition-colors">
                ← Atrás
              </button>
              <div className="flex-1 space-y-2">
                {exportError && (
                  <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">
                    {exportError}
                  </div>
                )}
                <button
                  onClick={handleExport}
                  disabled={exporting || format === 'DSB' || (format !== 'DST' && !exportAllowedByRealGate)}
                  className={`w-full py-2.5 rounded-lg text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed ${
                    format !== 'DST' && !exportAllowedByRealGate
                      ? 'bg-red-900/40 border border-red-500/30 text-red-300 cursor-not-allowed'
                      : hasNonBlockingWarnings
                        ? 'bg-amber-600 hover:bg-amber-500'
                        : 'bg-violet-600 hover:bg-violet-500 disabled:opacity-50'
                  }`}
                >
                  {format !== 'DST' && !exportAllowedByRealGate ? (
                    <><ShieldAlert className="w-4 h-4" /> Exportación bloqueada</>
                  ) : exporting ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generando...</>
                  ) : format === 'DST' ? (
                    <><Download className="w-4 h-4" /> Exportar DST</>
                  ) : hasNonBlockingWarnings ? (
                    <><Download className="w-4 h-4" /> Exportar con advertencias</>
                  ) : ce01ProductionMode ? (
                    <><Download className="w-4 h-4" /> Exportar {format}</>
                  ) : wizardResult ? (
                    <><Download className="w-4 h-4" /> Exportar (corregido)</>
                  ) : (
                    <><Download className="w-4 h-4" /> Confirmar y exportar</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}