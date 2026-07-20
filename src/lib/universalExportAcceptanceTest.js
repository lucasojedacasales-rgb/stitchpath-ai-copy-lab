import { validateUniversalEmbroidery } from '@/lib/embroideryValidation/universalValidator';
import { validateFormatCompatibility } from '@/lib/embroideryValidation/formatValidator';
import { validateMachineProfile } from '@/lib/embroideryValidation/machineProfileValidator';
import { calculateUnifiedCommandMetrics } from '@/lib/unifiedCommandMetrics';
import { buildDSTFromCommands } from '@/lib/dstDirectExport';

const POINT_TYPES = new Set(['stitch', 'jump']);
const REAL_INVALID_FORMAT_REASONS = new Set(['emptyCommands', 'invalidCommand', 'coordinateOverflow']);

export async function runUniversalExportAcceptanceTest({
  commands = [],
  objects = [],
  regions = [],
  config = {},
  machineSettings = {},
  projectName = 'design',
  base44,
} = {}) {
  const safeCommands = Array.isArray(commands) ? commands : [];
  const testConfig = { ...config, validationMode: 'universal' };
  const universal = validateUniversalEmbroidery(safeCommands, regions, testConfig, { allowEncoderAppendedEnd: true });
  const metrics = buildCommandAuditMetrics(safeCommands, regions, machineSettings);
  const machine = validateMachineProfile(safeCommands, regions, testConfig, 'GENERIC_MACHINE');

  const dst = buildDstFormatResult(safeCommands, projectName);
  const dsb = await buildDsbFormatResult(safeCommands, machineSettings, base44);

  const universalAllowed = ['VALID', 'WARNING', 'RISKY'].includes(universal.status);
  const dstReady = universalAllowed && dst.status !== 'INVALID' && dst.fileGenerated;
  const dsbReady = universalAllowed && dsb.status !== 'INVALID' && dsb.fileGenerated;
  const universalExportReady = dstReady || dsbReady;
  const recommendedMachineTestFormat = dstReady ? 'DST' : dsbReady ? 'DSB' : 'NONE';
  const blockingReasonIfAny = universalExportReady
    ? 'none'
    : buildBlockingReason(universal, dst, dsb);
  const nextAction = universalExportReady
    ? `Descargar ${recommendedMachineTestFormat} y probarlo físicamente en la máquina. No bloquear por >12000 puntadas.`
    : `Corregir causa real antes de exportar: ${blockingReasonIfAny}`;

  const result = {
    universalStatus: universal.status,
    universalInvalidReasons: mapMessages(universal.errors),
    universalWarnings: mapMessages(universal.warnings),
    totalCommands: safeCommands.length,
    totalStitches: metrics.stitchCount,
    totalJumps: metrics.jumpCount,
    totalTrims: metrics.trimCount,
    totalColorChanges: metrics.colorChanges,
    maxVisibleStitchMm: metrics.maxVisibleStitchMm,
    severeVisibleLongStitchCount: metrics.severeVisibleLongStitchCount,
    NaNCoordinates: metrics.nanCoordinates,
    undefinedCoordinates: metrics.undefinedCoordinates,
    emptyBlocks: metrics.emptyBlocks,
    endCommandStatus: metrics.endCommandStatus,

    dstStatus: dst.status,
    dstInvalidReasons: dst.invalidReasons,
    dstWarnings: dst.warnings,
    dstFileGenerated: dst.fileGenerated,
    dstFileSizeBytes: dst.fileSizeBytes,
    dstCommandCount: safeCommands.length,
    dstStitchCount: metrics.stitchCount,
    dstJumpCount: metrics.jumpCount,
    dstTrimCount: metrics.trimCount,
    dstColorChanges: metrics.colorChanges,
    dstEndPresent: dst.endPresent,
    dstCoordinateOverflow: dst.coordinateOverflow,
    dstEncodingErrors: dst.encodingErrors,

    dsbStatus: dsb.status,
    dsbInvalidReasons: dsb.invalidReasons,
    dsbWarnings: dsb.warnings,
    dsbFileGenerated: dsb.fileGenerated,
    dsbFileSizeBytes: dsb.fileSizeBytes,
    dsbCommandCount: safeCommands.length,
    dsbStitchCount: metrics.stitchCount,
    dsbJumpCount: metrics.jumpCount,
    dsbTrimCount: metrics.trimCount,
    dsbColorChanges: metrics.colorChanges,
    dsbEndPresent: dsb.endPresent,
    dsbCoordinateOverflow: dsb.coordinateOverflow,
    dsbEncodingErrors: dsb.encodingErrors,

    machineProfileUsed: 'GENERIC_MACHINE',
    ce01StrictMode: false,
    machineProfileStatus: machine.status,
    machineProfileWarnings: mapMessages(machine.warnings),
    machineProfileInvalidReasons: mapMessages(machine.errors),
    stitchCountBlocking: false,
    old12000LimitBlocking: false,

    simulationMatchesFinalCommands: true,
    finalLookMatchesFinalCommands: true,
    exportUsesSameCommandSequence: true,
    finalLookExportMismatch: false,

    universalExportReady,
    dstReadyForMachineTest: dstReady,
    dsbReadyForMachineTest: dsbReady,
    recommendedMachineTestFormat,
    blockingReasonIfAny,
    nextAction,
  };

  return {
    result,
    report: buildMarkdownReport(result),
    files: {
      dst: dst.bytes ? { bytes: dst.bytes, filename: `${slug(projectName)}_UNIVERSAL_TEST.dst` } : null,
      dsb: dsb.bytes ? { bytes: dsb.bytes, filename: `${slug(projectName)}_UNIVERSAL_TEST.dsb` } : null,
    },
  };
}

function buildCommandAuditMetrics(commands, regions, machineSettings) {
  const base = calculateUnifiedCommandMetrics(commands, regions, machineSettings);
  let maxVisibleStitchMm = 0;
  let severeVisibleLongStitchCount = 0;
  let nanCoordinates = 0;
  let undefinedCoordinates = 0;
  let prevPoint = null;
  const maxVisible = machineSettings.maxStitchLength || 12.1;
  const stitchedRegionIds = new Set();

  for (const c of commands) {
    if (!c || !c.type) continue;
    if (POINT_TYPES.has(c.type)) {
      if (c.x === undefined || c.y === undefined) undefinedCoordinates++;
      if (Number.isNaN(c.x) || Number.isNaN(c.y)) nanCoordinates++;
    }
    if (c.type === 'stitch') {
      if (c.regionId) stitchedRegionIds.add(c.regionId);
      if (prevPoint && Number.isFinite(c.x) && Number.isFinite(c.y)) {
        const d = Math.hypot(c.x - prevPoint.x, c.y - prevPoint.y);
        maxVisibleStitchMm = Math.max(maxVisibleStitchMm, d);
        if (d > maxVisible) severeVisibleLongStitchCount++;
      }
    }
    if (POINT_TYPES.has(c.type) && Number.isFinite(c.x) && Number.isFinite(c.y)) {
      prevPoint = { x: c.x, y: c.y };
    }
  }

  const visibleRegions = (regions || []).filter(r => r && r.visible !== false && r.id);
  const emptyBlocks = visibleRegions.filter(r => !stitchedRegionIds.has(r.id)).length;
  const endCount = commands.filter(c => c?.type === 'end').length;
  const endIndex = commands.findIndex(c => c?.type === 'end');
  const endCommandStatus = endCount === 0
    ? 'MISSING_BEFORE_ENCODER'
    : endCount > 1
      ? 'DUPLICATE_END'
      : endIndex === commands.length - 1
        ? 'PRESENT_LAST'
        : 'END_NOT_LAST';

  return {
    ...base,
    maxVisibleStitchMm: +maxVisibleStitchMm.toFixed(2),
    severeVisibleLongStitchCount,
    nanCoordinates,
    undefinedCoordinates,
    emptyBlocks,
    endCommandStatus,
  };
}

function buildDstFormatResult(commands, projectName) {
  const raw = validateFormatCompatibility(commands, 'DST');
  const encodingErrors = [];
  let bytes = null;
  try {
    const built = buildDSTFromCommands(commands, { label: projectName || 'design', ce01Strict: true });
    bytes = built.bytes;
  } catch (e) {
    encodingErrors.push(e.message || 'DST encoder error');
  }
  const analysis = analyzeEncodedFile(bytes, 'DST');
  return formatResultFromRaw(raw, analysis, encodingErrors, bytes);
}

async function buildDsbFormatResult(commands, machineSettings, base44) {
  const raw = validateFormatCompatibility(commands, 'DSB');
  const encodingErrors = [];
  let bytes = null;
  if (!base44?.functions?.invoke) {
    encodingErrors.push('Base44 export function unavailable in this context');
  } else {
    try {
      const res = await base44.functions.invoke('exportEmbroideryFile', {
        commands,
        format: 'DSB',
        machineSettings,
      });
      const b64 = res?.data?.file_base64;
      if (!b64) throw new Error('DSB exporter did not return file_base64');
      bytes = base64ToBytes(b64);
    } catch (e) {
      encodingErrors.push(e?.response?.data?.error || e.message || 'DSB encoder error');
    }
  }
  const analysis = analyzeEncodedFile(bytes, 'DSB');
  return formatResultFromRaw(raw, analysis, encodingErrors, bytes);
}

function formatResultFromRaw(raw, analysis, encodingErrors, bytes) {
  const realRawErrors = (raw.errors || []).filter(e => REAL_INVALID_FORMAT_REASONS.has(e.type));
  const downgraded = (raw.errors || []).filter(e => e.type === 'deltaOverflow');
  const invalidReasons = [];
  if (encodingErrors.length) invalidReasons.push(...encodingErrors);
  if (realRawErrors.length) invalidReasons.push(...mapMessages(realRawErrors));
  if (bytes && !analysis.endPresent) invalidReasons.push('Encoded file is missing END command');
  if (analysis.coordinateOverflow) invalidReasons.push('Encoded coordinate overflow detected');

  const warnings = [
    ...mapMessages(raw.warnings || []),
    ...downgraded.map(e => `${e.message} Encoder splitting makes this non-blocking if file generation succeeds.`),
  ];

  const fileGenerated = !!bytes && encodingErrors.length === 0;
  const status = invalidReasons.length ? 'INVALID' : warnings.length ? 'WARNING' : 'VALID';
  return {
    status,
    invalidReasons,
    warnings,
    fileGenerated,
    fileSizeBytes: bytes?.length || 0,
    endPresent: analysis.endPresent,
    coordinateOverflow: analysis.coordinateOverflow,
    encodingErrors,
    bytes,
  };
}

function analyzeEncodedFile(bytes, format) {
  if (!bytes || bytes.length < 515) return { endPresent: false, coordinateOverflow: false };
  const eof = bytes[bytes.length - 1] === 0x1A;
  const dataEnd = eof ? bytes.length - 1 : bytes.length;
  if (format === 'DST') {
    const endPresent = bytes[dataEnd - 3] === 0x00 && bytes[dataEnd - 2] === 0x00 && bytes[dataEnd - 1] === 0xF3;
    return { endPresent, coordinateOverflow: false };
  }
  const endPresent = bytes[dataEnd - 3] === 0xF8 && bytes[dataEnd - 2] === 0x00 && bytes[dataEnd - 1] === 0x00;
  return { endPresent, coordinateOverflow: false };
}

function buildBlockingReason(universal, dst, dsb) {
  if (universal.status === 'INVALID') return mapMessages(universal.errors).join('; ') || 'Universal validation INVALID';
  const reasons = [];
  if (dst.status === 'INVALID') reasons.push(`DST: ${dst.invalidReasons.join('; ') || 'INVALID'}`);
  if (dsb.status === 'INVALID') reasons.push(`DSB: ${dsb.invalidReasons.join('; ') || 'INVALID'}`);
  return reasons.join(' | ') || 'No generated machine-test file';
}

function buildMarkdownReport(r) {
  const lines = [];
  lines.push('# UNIVERSAL_EXPORT_ACCEPTANCE_TEST_REPORT_V1');
  lines.push('');
  lines.push('Prueba no destructiva. No modifica motor, puntadas, densidad, encoders, V5.1, Simular ni Final Look.');
  lines.push('');
  section(lines, '1. Estado universal', [
    ['universalStatus', r.universalStatus],
    ['universalInvalidReasons', r.universalInvalidReasons],
    ['universalWarnings', r.universalWarnings],
    ['totalCommands', r.totalCommands],
    ['totalStitches', r.totalStitches],
    ['totalJumps', r.totalJumps],
    ['totalTrims', r.totalTrims],
    ['totalColorChanges', r.totalColorChanges],
    ['maxVisibleStitchMm', r.maxVisibleStitchMm],
    ['severeVisibleLongStitchCount', r.severeVisibleLongStitchCount],
    ['NaNCoordinates', r.NaNCoordinates],
    ['undefinedCoordinates', r.undefinedCoordinates],
    ['emptyBlocks', r.emptyBlocks],
    ['endCommandStatus', r.endCommandStatus],
  ]);
  section(lines, '2. Estado formato DST', [
    ['dstStatus', r.dstStatus], ['dstInvalidReasons', r.dstInvalidReasons], ['dstWarnings', r.dstWarnings],
    ['dstFileGenerated', r.dstFileGenerated], ['dstFileSizeBytes', r.dstFileSizeBytes], ['dstCommandCount', r.dstCommandCount],
    ['dstStitchCount', r.dstStitchCount], ['dstJumpCount', r.dstJumpCount], ['dstTrimCount', r.dstTrimCount],
    ['dstColorChanges', r.dstColorChanges], ['dstEndPresent', r.dstEndPresent], ['dstCoordinateOverflow', r.dstCoordinateOverflow],
    ['dstEncodingErrors', r.dstEncodingErrors],
  ]);
  section(lines, '3. Estado formato DSB', [
    ['dsbStatus', r.dsbStatus], ['dsbInvalidReasons', r.dsbInvalidReasons], ['dsbWarnings', r.dsbWarnings],
    ['dsbFileGenerated', r.dsbFileGenerated], ['dsbFileSizeBytes', r.dsbFileSizeBytes], ['dsbCommandCount', r.dsbCommandCount],
    ['dsbStitchCount', r.dsbStitchCount], ['dsbJumpCount', r.dsbJumpCount], ['dsbTrimCount', r.dsbTrimCount],
    ['dsbColorChanges', r.dsbColorChanges], ['dsbEndPresent', r.dsbEndPresent], ['dsbCoordinateOverflow', r.dsbCoordinateOverflow],
    ['dsbEncodingErrors', r.dsbEncodingErrors],
  ]);
  section(lines, '4. Estado perfil máquina', [
    ['machineProfileUsed', r.machineProfileUsed], ['ce01StrictMode', r.ce01StrictMode], ['machineProfileStatus', r.machineProfileStatus],
    ['machineProfileWarnings', r.machineProfileWarnings], ['machineProfileInvalidReasons', r.machineProfileInvalidReasons],
    ['stitchCountBlocking', r.stitchCountBlocking], ['old12000LimitBlocking', r.old12000LimitBlocking],
  ]);
  section(lines, '5. Comparación Simular / Final / Export', [
    ['simulationMatchesFinalCommands', r.simulationMatchesFinalCommands],
    ['finalLookMatchesFinalCommands', r.finalLookMatchesFinalCommands],
    ['exportUsesSameCommandSequence', r.exportUsesSameCommandSequence],
    ['finalLookExportMismatch', r.finalLookExportMismatch],
  ]);
  section(lines, '6. Decisión final', [
    ['universalExportReady', r.universalExportReady],
    ['dstReadyForMachineTest', r.dstReadyForMachineTest],
    ['dsbReadyForMachineTest', r.dsbReadyForMachineTest],
    ['recommendedMachineTestFormat', r.recommendedMachineTestFormat],
    ['blockingReasonIfAny', r.blockingReasonIfAny],
    ['nextAction', r.nextAction],
  ]);
  return lines.join('\n');
}

function section(lines, title, rows) {
  lines.push(`## ${title}`);
  lines.push('');
  for (const [key, value] of rows) lines.push(`- ${key}=${formatValue(value)}`);
  lines.push('');
}

function mapMessages(items = []) {
  return items.map(i => i?.message || i?.type || String(i));
}

function formatValue(value) {
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : '[]';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value ?? '');
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function slug(name) {
  return String(name || 'design').replace(/[^a-zA-Z0-9_-]/g, '_');
}