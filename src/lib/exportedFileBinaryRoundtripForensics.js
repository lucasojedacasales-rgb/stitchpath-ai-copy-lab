import { buildDSTFromCommands } from './dstDirectExport';
import { decodeDSTRecord } from './dstEncoder';
import { decodeDSBRecord } from './dsbEncoder';
import { normalizeBackendFileResponse } from './exportResponseNormalizer';

const HEADER_SIZE = 512;
const RECORD_SIZE = 3;
const EOF_BYTE = 0x1A;

export async function runExportedFileBinaryRoundtripForensics({
  commands = [],
  objects = [],
  projectName = 'design',
  machineSettings = {},
  base44Client,
}) {
  const safeName = sanitizeFileName(projectName || 'design');
  const internal = summarizeCommands(commands);

  const dst = await buildAndAuditDST(commands, safeName);
  const dsb = await buildAndAuditDSB(commands, objects, safeName, machineSettings, base44Client);
  const backend = summarizeBackend(dst, dsb);
  const comparison = compareInternalToParsed(internal, dst.parse, dsb.parse);
  const rootCause = chooseRootCause(dst, dsb, backend, comparison);
  const nextFix = chooseNextFix(rootCause);
  const primaryFailureLayer = choosePrimaryLayer(rootCause);

  const report = {
    summary: {
      exportedFileFunctional: false,
      internalCommandsValid: commands.length > 0,
      binaryFileValid: dst.parse.binaryFileValid && dsb.parse.binaryFileValid,
      machineReadableLikely: dst.parse.machineReadableLikely || dsb.parse.machineReadableLikely,
      primaryFailureLayer,
    },
    dst,
    dsb,
    backend,
    internal,
    comparison,
    rootCause,
    nextFix,
  };

  return { report, markdown: buildMarkdown(report) };
}

async function buildAndAuditDST(commands, safeName) {
  try {
    const { bytes, blob, meta } = buildDSTFromCommands(commands, { label: safeName, ce01Strict: true });
    const byteInfo = await inspectBytes({ bytes, blob, requestedFormat: 'DST', fileName: `${safeName}.dst`, backendResponseShape: 'frontend_direct_buildDSTFromCommands', backendReturnedFormat: 'DST' });
    return {
      requestedFormat: 'DST',
      fileName: `${safeName}.dst`,
      downloadFileName: `${safeName}.dst`,
      encoderUsed: 'frontend buildDSTFromCommands / dstEncoder',
      meta,
      ...byteInfo,
      parse: parseDST(byteInfo.bytes),
      backendErrorIfAny: null,
    };
  } catch (error) {
    return failedAudit('DST', `${safeName}.dst`, error);
  }
}

async function buildAndAuditDSB(commands, objects, safeName, machineSettings, base44Client) {
  try {
    const response = await base44Client.functions.invoke('exportEmbroideryFile', {
      commands,
      format: 'DSB',
      machineSettings,
    });
    const data = response?.data;
    const backendResponseShape = Array.isArray(data) ? 'array' : data && typeof data === 'object' ? `object:${Object.keys(data).join(',')}` : typeof data;
    const normalized = await normalizeBackendFileResponse(data, { status: response?.status });
    const bytes = normalized.bytes;
    const blob = normalized.blob;
    const byteInfo = await inspectBytes({
      bytes,
      blob,
      requestedFormat: 'DSB',
      fileName: data?.filename || `${safeName}.dsb`,
      backendResponseShape,
      backendReturnedFormat: data?.filename?.split('.').pop()?.toUpperCase() || 'DSB',
      base64LengthOverride: normalized.diagnostics?.base64Length || null,
    });
    return {
      requestedFormat: 'DSB',
      fileName: data?.filename || `${safeName}.dsb`,
      downloadFileName: `${safeName}.dsb`,
      encoderUsed: 'backend exportEmbroideryFile encodeDSB',
      meta: { size: data?.size, checksum: data?.checksum, warnings: data?.warnings || [] },
      ...byteInfo,
      parse: parseDSB(byteInfo.bytes),
      backendErrorIfAny: null,
      backendReturnedJsonInsteadOfFile: false,
    };
  } catch (error) {
    return failedAudit('DSB', `${safeName}.dsb`, error);
  }
}

function failedAudit(format, fileName, error) {
  const backendData = error?.response?.data;
  const realError = backendData?.error || backendData?.message || error?.message || String(error);
  const details = backendData?.details ? ` details=${JSON.stringify(backendData.details)}` : '';
  const message = `${realError}${details}`;
  return {
    requestedFormat: format,
    fileName,
    fileExtension: fileName.split('.').pop(),
    mimeType: null,
    blobSizeBytes: 0,
    base64Length: 0,
    decodedByteLength: 0,
    first64BytesHex: '',
    last64BytesHex: '',
    downloadFileName: fileName,
    downloadExtension: fileName.split('.').pop(),
    backendResponseShape: backendData ? `error:${Object.keys(backendData).join(',')}` : 'error',
    backendReturnedFormat: null,
    backendErrorIfAny: message,
    backendStatus: error?.response?.status || null,
    backendDetails: backendData?.details || null,
    encoderUsed: format === 'DST' ? 'frontend buildDSTFromCommands / dstEncoder' : 'backend exportEmbroideryFile encodeDSB',
    bytes: new Uint8Array(),
    parse: format === 'DST' ? emptyDSTParse([message]) : emptyDSBParse([message]),
  };
}

async function inspectBytes({ bytes, blob, requestedFormat, fileName, backendResponseShape, backendReturnedFormat, base64LengthOverride = null }) {
  const actualBytes = bytes || new Uint8Array(await blob.arrayBuffer());
  const decodedByteLength = actualBytes.length;
  const first64BytesHex = toHex(actualBytes.slice(0, 64));
  const last64BytesHex = toHex(actualBytes.slice(Math.max(0, actualBytes.length - 64)));
  const base64Length = base64LengthOverride ?? Math.ceil(decodedByteLength / 3) * 4;
  return {
    requestedFormat,
    fileName,
    fileExtension: extension(fileName),
    mimeType: blob?.type || 'application/octet-stream',
    blobSizeBytes: blob?.size ?? decodedByteLength,
    base64Length,
    decodedByteLength,
    first64BytesHex,
    last64BytesHex,
    downloadExtension: extension(fileName),
    backendResponseShape,
    backendReturnedFormat,
    bytes: actualBytes,
    looksLikeJsonOrError: looksLikeJsonOrError(actualBytes),
    looksLikeHtml: looksLikeHtml(actualBytes),
    looksLikeUndecodedBase64: looksLikeUndecodedBase64(actualBytes),
  };
}

export function parseDST(bytes) {
  const errors = [];
  if (!bytes || bytes.length === 0) return emptyDSTParse(['empty_file']);
  if (looksLikeJsonOrError(bytes)) errors.push('blobLooksLikeJsonOrError');
  if (looksLikeHtml(bytes)) errors.push('blobLooksLikeHtml');
  if (looksLikeUndecodedBase64(bytes)) errors.push('blobLooksLikeUndecodedBase64');

  const hasHeader = bytes.length >= HEADER_SIZE;
  if (!hasHeader) errors.push('header_shorter_than_512');
  const headerText = hasHeader ? bytesToAscii(bytes.slice(0, HEADER_SIZE)) : '';
  const headerValid = hasHeader && headerText.includes('LA:') && headerText.includes('ST:') && headerText.includes('CO:') && headerText.includes('PD:');
  if (!headerValid) errors.push('dst_header_invalid');

  const hasEof = bytes[bytes.length - 1] === EOF_BYTE;
  const dataEnd = hasEof ? bytes.length - 1 : bytes.length;
  const recordLengthValid = hasHeader && (dataEnd - HEADER_SIZE) > 0 && (dataEnd - HEADER_SIZE) % RECORD_SIZE === 0;
  if (!recordLengthValid) errors.push('invalidRecordLength');
  const recordCount = recordLengthValid ? (dataEnd - HEADER_SIZE) / RECORD_SIZE : 0;

  let stitches = 0, jumps = 0, colorChanges = 0, trims = 0, parsedCommands = 0;
  let endPresent = false;
  let x = 0, y = 0;
  let maxAbsX = 0, maxAbsY = 0;
  if (recordLengthValid) {
    for (let i = HEADER_SIZE; i + 2 < dataEnd; i += RECORD_SIZE) {
      const decoded = decodeDSTRecord([bytes[i], bytes[i + 1], bytes[i + 2]]);
      parsedCommands++;
      if (decoded.flag === 'end') { endPresent = true; break; }
      x += decoded.dx;
      y += decoded.dy;
      maxAbsX = Math.max(maxAbsX, Math.abs(x));
      maxAbsY = Math.max(maxAbsY, Math.abs(y));
      if (decoded.flag === 'stitch') stitches++;
      else if (decoded.flag === 'jump') jumps++;
      else if (decoded.flag === 'colorChange') colorChanges++;
    }
  }
  if (!endPresent) errors.push('dstEndMissing');

  const headerST = readHeaderNumber(headerText, 'ST');
  const headerCO = readHeaderNumber(headerText, 'CO');
  if (Number.isFinite(headerST) && recordCount && Math.abs(headerST - recordCount) > 1) errors.push(`headerSTMismatch:${headerST}_vs_${recordCount}`);
  if (Number.isFinite(headerCO) && headerCO !== colorChanges) errors.push(`headerCOMismatch:${headerCO}_vs_${colorChanges}`);

  const binaryFileValid = bytes.length > 0 && headerValid && recordLengthValid && endPresent && errors.length === 0;
  return {
    format: 'DST',
    binaryFileValid,
    machineReadableLikely: binaryFileValid,
    headerValid,
    headerST,
    headerCO,
    recordCount,
    recordLengthValid,
    endPresent,
    parsedCommands,
    parsedStitches: stitches,
    parsedJumps: jumps,
    parsedTrims: trims,
    parsedColorChanges: colorChanges,
    parsedColors: colorChanges + 1,
    maxAbsX,
    maxAbsY,
    parseErrors: errors,
  };
}

export function parseDSB(bytes) {
  const errors = [];
  if (!bytes || bytes.length === 0) return emptyDSBParse(['empty_file']);
  if (looksLikeJsonOrError(bytes)) errors.push('blobLooksLikeJsonOrError');
  if (looksLikeHtml(bytes)) errors.push('blobLooksLikeHtml');
  if (looksLikeUndecodedBase64(bytes)) errors.push('blobLooksLikeUndecodedBase64');

  const hasHeader = bytes.length >= HEADER_SIZE;
  if (!hasHeader) errors.push('header_shorter_than_512');
  const headerText = hasHeader ? bytesToAscii(bytes.slice(0, HEADER_SIZE)) : '';
  const headerValid = hasHeader && headerText.includes('LA:') && headerText.includes('ST:') && headerText.includes('CO:') && headerText.includes('PD:');
  if (!headerValid) errors.push('dsb_header_invalid');

  const hasEof = bytes[bytes.length - 1] === EOF_BYTE;
  const dataEnd = hasEof ? bytes.length - 1 : bytes.length;
  const recordLengthValid = hasHeader && (dataEnd - HEADER_SIZE) > 0 && (dataEnd - HEADER_SIZE) % RECORD_SIZE === 0;
  if (!recordLengthValid) errors.push('invalidRecordLength');
  const recordCount = recordLengthValid ? (dataEnd - HEADER_SIZE) / RECORD_SIZE : 0;

  let stitches = 0, jumps = 0, colorChanges = 0, parsedCommands = 0;
  let endPresent = false;
  let unknownCommands = 0;
  let dstLikeRecords = 0;
  let x = 0, y = 0;
  let maxAbsX = 0, maxAbsY = 0;
  if (recordLengthValid) {
    for (let i = HEADER_SIZE; i + 2 < dataEnd; i += RECORD_SIZE) {
      const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      if (b2 === 0x03 || b2 === 0x83 || b2 === 0xC3 || b2 === 0xF3) dstLikeRecords++;
      const decoded = decodeDSBRecord([b0, b1, b2]);
      parsedCommands++;
      if (decoded.type === 'end') { endPresent = true; break; }
      if (!['stitch', 'jump', 'colorChange', 'end'].includes(decoded.type) || ![0x80, 0x81, 0x88, 0xF8].includes(b0)) unknownCommands++;
      x += decoded.dx;
      y += decoded.dy;
      maxAbsX = Math.max(maxAbsX, Math.abs(x));
      maxAbsY = Math.max(maxAbsY, Math.abs(y));
      if (decoded.type === 'stitch') stitches++;
      else if (decoded.type === 'jump') jumps++;
      else if (decoded.type === 'colorChange') colorChanges++;
    }
  }
  if (!endPresent) errors.push('dsbEndMissing');
  if (unknownCommands > 0) errors.push(`unknownDSBCommandBytes:${unknownCommands}`);

  const headerST = readHeaderNumber(headerText, 'ST');
  const headerCO = readHeaderNumber(headerText, 'CO');
  if (Number.isFinite(headerST) && recordCount && Math.abs(headerST - recordCount) > 1) errors.push(`headerSTMismatch:${headerST}_vs_${recordCount}`);
  if (Number.isFinite(headerCO) && headerCO !== colorChanges) errors.push(`headerCOMismatch:${headerCO}_vs_${colorChanges}`);

  const dsbActuallyDstRenamed = recordLengthValid && dstLikeRecords > Math.max(10, recordCount * 0.8);
  if (dsbActuallyDstRenamed) errors.push('dsbActuallyDstRenamed');
  const structureRecognized = headerValid && recordLengthValid && unknownCommands === 0 && !dsbActuallyDstRenamed;
  const binaryFileValid = structureRecognized && endPresent && !looksLikeJsonOrError(bytes) && !looksLikeHtml(bytes) && !looksLikeUndecodedBase64(bytes);
  return {
    format: 'DSB',
    binaryFileValid,
    machineReadableLikely: binaryFileValid,
    headerValid,
    headerST,
    headerCO,
    recordCount,
    recordLengthValid,
    endPresent,
    dsbActuallyDstRenamed,
    dsbStructureRecognized: structureRecognized,
    parsedCommands,
    parsedStitches: stitches,
    parsedJumps: jumps,
    parsedTrims: 0,
    parsedColorChanges: colorChanges,
    parsedColors: colorChanges + 1,
    maxAbsX,
    maxAbsY,
    parseErrors: errors,
  };
}

function summarizeCommands(commands) {
  const colors = new Set();
  let totalStitches = 0, totalJumps = 0, totalTrims = 0, totalColorChanges = 0;
  for (const c of commands || []) {
    if (c?.color && (c.type === 'stitch' || c.type === 'jump')) colors.add(c.color);
    if (c?.type === 'stitch') totalStitches++;
    else if (c?.type === 'jump') totalJumps++;
    else if (c?.type === 'trim') totalTrims++;
    else if (c?.type === 'colorChange') totalColorChanges++;
  }
  return { finalCommandsTotal: commands.length, finalCommandsStitches: totalStitches, finalCommandsJumps: totalJumps, finalCommandsTrims: totalTrims, finalCommandsColorChanges: totalColorChanges, finalCommandsColors: colors.size };
}

function compareInternalToParsed(internal, dstParse, dsbParse) {
  const parsed = dstParse?.binaryFileValid ? dstParse : dsbParse;
  return {
    parsedFileStitches: parsed?.parsedStitches || 0,
    parsedFileJumps: parsed?.parsedJumps || 0,
    parsedFileColorChanges: parsed?.parsedColorChanges || 0,
    commandCountMismatch: Math.abs((parsed?.parsedCommands || 0) - internal.finalCommandsTotal) > Math.max(5, internal.finalCommandsTotal * 0.05),
    stitchCountMismatch: Math.abs((parsed?.parsedStitches || 0) - internal.finalCommandsStitches) > Math.max(5, internal.finalCommandsStitches * 0.05),
    colorCountMismatch: (parsed?.parsedColorChanges || 0) !== internal.finalCommandsColorChanges,
    endMissing: !parsed?.endPresent,
    corruptedHeader: !parsed?.headerValid,
    invalidRecordLength: !parsed?.recordLengthValid,
    unsupportedFormat: false,
    wrongExtension: false,
    backendReturnedWrongFormat: dsbParse?.dsbActuallyDstRenamed || false,
    blobLooksLikeJsonOrError: [...(dstParse?.parseErrors || []), ...(dsbParse?.parseErrors || [])].some(e => String(e).includes('JsonOrError') || String(e).includes('Html') || String(e).includes('Base64')),
    commandToFileMismatch: Math.abs((parsed?.parsedStitches || 0) - internal.finalCommandsStitches) > Math.max(5, internal.finalCommandsStitches * 0.05),
  };
}

function summarizeBackend(dst, dsb) {
  return {
    backendFunctionName: 'exportEmbroideryFile',
    backendReturnedBase64: dsb.backendResponseShape?.includes('file_base64') || false,
    backendReturnedJsonInsteadOfFile: !!dsb.backendReturnedJsonInsteadOfFile,
    backendReturnedErrorAsFile: !!dsb.looksLikeJsonOrError,
    backendDoubleBase64Encoded: !!dsb.looksLikeUndecodedBase64,
    backendWrongFormat: !!dsb.parse?.dsbActuallyDstRenamed,
    encoderUsedForDST: dst.encoderUsed,
    encoderUsedForDSB: dsb.encoderUsed,
    backendErrorIfAny: dsb.backendErrorIfAny,
  };
}

function chooseRootCause(dst, dsb, backend, comparison) {
  if (dst.backendErrorIfAny || dsb.backendErrorIfAny) return 'UNKNOWN_NEEDS_EXPORTED_FILE_UPLOAD';
  if (backend.backendReturnedJsonInsteadOfFile) return 'BACKEND_RETURNS_JSON_NOT_FILE';
  if (backend.backendDoubleBase64Encoded) return 'BASE64_DECODE_ERROR';
  if (comparison.wrongExtension || comparison.backendReturnedWrongFormat) return 'FORMAT_EXTENSION_MISMATCH';
  if (!dst.parse?.headerValid) return 'DST_ENCODER_HEADER_INVALID';
  if (!dst.parse?.recordLengthValid) return 'DST_RECORD_ENCODING_INVALID';
  if (!dst.parse?.endPresent) return 'DST_END_MISSING';
  if (dsb.parse?.dsbActuallyDstRenamed || !dsb.parse?.dsbStructureRecognized) return 'DSB_ENCODER_NOT_REAL_DSB';
  if (!commandsReachedFile(dst, dsb)) return 'COMMANDS_NOT_REACHING_BACKEND';
  if (dst.parse?.machineReadableLikely || dsb.parse?.machineReadableLikely) return 'MACHINE_REJECTS_VALID_FILE_UNKNOWN_REASON';
  return 'UNKNOWN_NEEDS_EXPORTED_FILE_UPLOAD';
}

function chooseNextFix(rootCause) {
  if (rootCause.startsWith('DST_')) return 'FIX_DST_ENCODER_BINARY_V1';
  if (rootCause === 'DSB_ENCODER_NOT_REAL_DSB') return 'FIX_DSB_ENCODER_BINARY_V1';
  if (rootCause === 'BACKEND_RETURNS_JSON_NOT_FILE' || rootCause === 'BASE64_DECODE_ERROR') return 'FIX_BACKEND_RESPONSE_BLOB_V1';
  if (rootCause === 'FORMAT_EXTENSION_MISMATCH') return 'FIX_EXPORT_FORMAT_EXTENSION_V1';
  if (rootCause === 'MACHINE_REJECTS_VALID_FILE_UNKNOWN_REASON') return 'COMPARE_WITH_WILCOM_BINARY_REFERENCE_V1';
  return 'ADD_EXPORT_ROUNDTRIP_VALIDATOR_V1';
}

function choosePrimaryLayer(rootCause) {
  if (rootCause.startsWith('DST_') || rootCause.startsWith('DSB_')) return 'BACKEND_ENCODER';
  if (rootCause.includes('BLOB') || rootCause.includes('BASE64')) return 'BLOB_DOWNLOAD';
  if (rootCause.includes('EXTENSION')) return 'FORMAT_EXTENSION';
  if (rootCause.includes('COMMANDS')) return 'COMMANDS';
  if (rootCause.includes('MACHINE_REJECTS')) return 'MACHINE_PROFILE';
  return 'UNKNOWN';
}

function commandsReachedFile(dst, dsb) {
  return (dst.parse?.parsedStitches || 0) > 0 || (dsb.parse?.parsedStitches || 0) > 0;
}

function buildMarkdown(r) {
  return `# EXPORTED_FILE_BINARY_ROUNDTRIP_FORENSICS_V1\n\n` +
`## 1. Resumen\n\n` +
`exportedFileFunctional=${r.summary.exportedFileFunctional}\n` +
`internalCommandsValid=${r.summary.internalCommandsValid}\n` +
`binaryFileValid=${r.summary.binaryFileValid}\n` +
`machineReadableLikely=${r.summary.machineReadableLikely}\n` +
`primaryFailureLayer=${r.summary.primaryFailureLayer}\n\n` +
`## 2. DST\n\n` +
`dstGenerated=${!r.dst.backendErrorIfAny}\n` +
`dstBlobSizeBytes=${r.dst.blobSizeBytes}\n` +
`dstHeaderValid=${r.dst.parse.headerValid}\n` +
`dstRecordCount=${r.dst.parse.recordCount}\n` +
`dstRecordLengthValid=${r.dst.parse.recordLengthValid}\n` +
`dstEndPresent=${r.dst.parse.endPresent}\n` +
`dstParsedStitches=${r.dst.parse.parsedStitches}\n` +
`dstParsedJumps=${r.dst.parse.parsedJumps}\n` +
`dstParsedColorChanges=${r.dst.parse.parsedColorChanges}\n` +
`dstParseErrors=${JSON.stringify(r.dst.parse.parseErrors)}\n` +
`dstMachineReadableLikely=${r.dst.parse.machineReadableLikely}\n` +
`dstFirst64BytesHex=${r.dst.first64BytesHex}\n` +
`dstLast64BytesHex=${r.dst.last64BytesHex}\n\n` +
`## 3. DSB\n\n` +
`dsbGenerated=${!r.dsb.backendErrorIfAny}\n` +
`dsbBlobSizeBytes=${r.dsb.blobSizeBytes}\n` +
`dsbHeaderValid=${r.dsb.parse.headerValid}\n` +
`dsbActuallyDstRenamed=${r.dsb.parse.dsbActuallyDstRenamed}\n` +
`dsbStructureRecognized=${r.dsb.parse.dsbStructureRecognized}\n` +
`dsbEndPresent=${r.dsb.parse.endPresent}\n` +
`dsbParsedStitches=${r.dsb.parse.parsedStitches}\n` +
`dsbParsedJumps=${r.dsb.parse.parsedJumps}\n` +
`dsbParsedColorChanges=${r.dsb.parse.parsedColorChanges}\n` +
`dsbParseErrors=${JSON.stringify(r.dsb.parse.parseErrors)}\n` +
`dsbMachineReadableLikely=${r.dsb.parse.machineReadableLikely}\n` +
`dsbFirst64BytesHex=${r.dsb.first64BytesHex}\n` +
`dsbLast64BytesHex=${r.dsb.last64BytesHex}\n\n` +
`## 4. Backend\n\n` +
`backendFunctionName=${r.backend.backendFunctionName}\n` +
`backendReturnedBase64=${r.backend.backendReturnedBase64}\n` +
`backendReturnedJsonInsteadOfFile=${r.backend.backendReturnedJsonInsteadOfFile}\n` +
`backendReturnedErrorAsFile=${r.backend.backendReturnedErrorAsFile}\n` +
`backendDoubleBase64Encoded=${r.backend.backendDoubleBase64Encoded}\n` +
`backendWrongFormat=${r.backend.backendWrongFormat}\n` +
`encoderUsedForDST=${r.backend.encoderUsedForDST}\n` +
`encoderUsedForDSB=${r.backend.encoderUsedForDSB}\n` +
`backendErrorIfAny=${r.backend.backendErrorIfAny || 'none'}\n\n` +
`## 5. Comparación interna\n\n` +
`finalCommandsTotal=${r.internal.finalCommandsTotal}\n` +
`finalCommandsStitches=${r.internal.finalCommandsStitches}\n` +
`finalCommandsJumps=${r.internal.finalCommandsJumps}\n` +
`finalCommandsTrims=${r.internal.finalCommandsTrims}\n` +
`finalCommandsColorChanges=${r.internal.finalCommandsColorChanges}\n` +
`parsedFileStitches=${r.comparison.parsedFileStitches}\n` +
`parsedFileJumps=${r.comparison.parsedFileJumps}\n` +
`parsedFileColorChanges=${r.comparison.parsedFileColorChanges}\n` +
`commandCountMismatch=${r.comparison.commandCountMismatch}\n` +
`stitchCountMismatch=${r.comparison.stitchCountMismatch}\n` +
`colorCountMismatch=${r.comparison.colorCountMismatch}\n` +
`endMissing=${r.comparison.endMissing}\n` +
`corruptedHeader=${r.comparison.corruptedHeader}\n` +
`invalidRecordLength=${r.comparison.invalidRecordLength}\n` +
`unsupportedFormat=${r.comparison.unsupportedFormat}\n` +
`wrongExtension=${r.comparison.wrongExtension}\n` +
`backendReturnedWrongFormat=${r.comparison.backendReturnedWrongFormat}\n` +
`blobLooksLikeJsonOrError=${r.comparison.blobLooksLikeJsonOrError}\n` +
`commandToFileMismatch=${r.comparison.commandToFileMismatch}\n\n` +
`## 6. Causa raíz\n\n${r.rootCause}\n\n` +
`## 7. Siguiente fix recomendado\n\n${r.nextFix}\n`;
}

function emptyDSTParse(parseErrors) {
  return { format: 'DST', binaryFileValid: false, machineReadableLikely: false, headerValid: false, headerST: null, headerCO: null, recordCount: 0, recordLengthValid: false, endPresent: false, parsedCommands: 0, parsedStitches: 0, parsedJumps: 0, parsedTrims: 0, parsedColorChanges: 0, parsedColors: 0, parseErrors };
}

function emptyDSBParse(parseErrors) {
  return { format: 'DSB', binaryFileValid: false, machineReadableLikely: false, headerValid: false, headerST: null, headerCO: null, recordCount: 0, recordLengthValid: false, endPresent: false, dsbActuallyDstRenamed: false, dsbStructureRecognized: false, parsedCommands: 0, parsedStitches: 0, parsedJumps: 0, parsedTrims: 0, parsedColorChanges: 0, parsedColors: 0, parseErrors };
}

function toHex(bytes) {
  return Array.from(bytes || []).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function bytesToAscii(bytes) {
  return Array.from(bytes || []).map(b => (b >= 32 && b <= 126) || b === 13 || b === 10 ? String.fromCharCode(b) : '.').join('');
}

function readHeaderNumber(header, key) {
  const m = header.match(new RegExp(`${key}:\\s*([+-]?\\d+)`));
  return m ? Number(m[1]) : null;
}

function looksLikeJsonOrError(bytes) {
  const text = bytesToAscii(bytes.slice(0, 80)).trim().toLowerCase();
  return text.startsWith('{') || text.startsWith('[') || text.includes('"error"') || text.includes('error:');
}

function looksLikeHtml(bytes) {
  const text = bytesToAscii(bytes.slice(0, 120)).trim().toLowerCase();
  return text.startsWith('<!doctype html') || text.startsWith('<html') || text.includes('<body');
}

function looksLikeUndecodedBase64(bytes) {
  if (!bytes || bytes.length < 128) return false;
  const sample = bytesToAscii(bytes.slice(0, Math.min(512, bytes.length))).trim();
  return /^[A-Za-z0-9+/=\r\n]+$/.test(sample) && !sample.includes('LA:') && sample.length > 120;
}

function extension(fileName) {
  return String(fileName || '').split('.').pop()?.toLowerCase() || '';
}

function sanitizeFileName(name) {
  return String(name || 'design').replace(/[^a-zA-Z0-9_-]/g, '_');
}