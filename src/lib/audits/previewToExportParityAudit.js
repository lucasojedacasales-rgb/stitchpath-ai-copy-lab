const EMPTY_METRICS = {
  commandCount: null,
  stitchCount: null,
  colorCount: null,
  jumpCount: null,
  trimCount: null,
  longVisibleConnectorCount: null,
  stitchLongerThan3mm: null,
  stitchLongerThan6mm: null,
  stitchLongerThan10mm: null,
};

function hasPoint(command) {
  return command && Number.isFinite(command.x) && Number.isFinite(command.y);
}

function normalizeCommands(commands) {
  return Array.isArray(commands) ? commands.filter(Boolean) : null;
}

function commandType(command) {
  return command?.type || command?.flag || command?.command || 'unknown';
}

function isBlackColor(hex = '') {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return luminance < 70 && spread < 90;
}

function isContourCommand(command) {
  const text = `${command?.stitchType || ''} ${command?.layerType || ''} ${command?.source || ''} ${command?.regionId || ''} ${command?.objectId || ''}`.toLowerCase();
  return text.includes('contour') || text.includes('outline') || text.includes('running');
}

function metricForCommands(commands) {
  const normalized = normalizeCommands(commands);
  if (!normalized) return { ...EMPTY_METRICS, available: false };
  let stitchCount = 0;
  let jumpCount = 0;
  let trimCount = 0;
  let longVisibleConnectorCount = 0;
  let stitchLongerThan3mm = 0;
  let stitchLongerThan6mm = 0;
  let stitchLongerThan10mm = 0;
  const colors = new Set();
  let previous = { x: 0, y: 0, type: 'origin' };

  for (const command of normalized) {
    const type = commandType(command);
    if (command.color && (type === 'stitch' || type === 'jump')) colors.add(String(command.color).toLowerCase());
    if (type === 'stitch') stitchCount++;
    if (type === 'jump') jumpCount++;
    if (type === 'trim') trimCount++;
    if (type === 'stitch' && hasPoint(command) && hasPoint(previous)) {
      const distance = Math.hypot(command.x - previous.x, command.y - previous.y);
      if (distance > 3) stitchLongerThan3mm++;
      if (distance > 6) stitchLongerThan6mm++;
      if (distance > 10) stitchLongerThan10mm++;
      if (distance > 3 && previous.type !== 'stitch') longVisibleConnectorCount++;
    }
    if (hasPoint(command) && (type === 'stitch' || type === 'jump' || type === 'trim')) {
      previous = { ...command, type };
    }
  }

  return {
    available: true,
    commandCount: normalized.length,
    stitchCount,
    colorCount: colors.size,
    jumpCount,
    trimCount,
    longVisibleConnectorCount,
    stitchLongerThan3mm,
    stitchLongerThan6mm,
    stitchLongerThan10mm,
  };
}

function signature(command) {
  if (!command) return 'null';
  const type = commandType(command);
  const x = Number.isFinite(command.x) ? command.x.toFixed(2) : 'na';
  const y = Number.isFinite(command.y) ? command.y.toFixed(2) : 'na';
  const color = command.color ? String(command.color).toLowerCase() : 'none';
  return `${type}:${x}:${y}:${color}:${command.regionId || ''}:${command.stitchType || ''}:${command.layerType || ''}`;
}

function commandSetDiff(a, b) {
  const left = normalizeCommands(a) || [];
  const right = normalizeCommands(b) || [];
  const rightSet = new Set(right.map(signature));
  return left.filter(command => !rightSet.has(signature(command))).length;
}

function exactSameCommands(a, b) {
  const left = normalizeCommands(a);
  const right = normalizeCommands(b);
  if (!left || !right || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (signature(left[i]) !== signature(right[i])) return false;
  }
  return true;
}

function blackOutlineLayerPosition(commands) {
  const normalized = normalizeCommands(commands);
  if (!normalized || normalized.length === 0) return 'unavailable';
  const blackIndexes = [];
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (commandType(c) === 'stitch' && isBlackColor(c.color)) blackIndexes.push(i);
  }
  if (blackIndexes.length === 0) return 'no_black_stitches_detected';
  const firstPct = Math.round((blackIndexes[0] / normalized.length) * 100);
  const lastPct = Math.round((blackIndexes[blackIndexes.length - 1] / normalized.length) * 100);
  if (firstPct >= 70) return `final_layer_${firstPct}_${lastPct}`;
  if (lastPct <= 35) return `early_layer_${firstPct}_${lastPct}`;
  return `mixed_layer_${firstPct}_${lastPct}`;
}

function contourDiffCount(a, b) {
  const left = (normalizeCommands(a) || []).filter(isContourCommand);
  const right = (normalizeCommands(b) || []).filter(isContourCommand);
  return commandSetDiff(left, right) + commandSetDiff(right, left);
}

function toBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  if (value?.bytes instanceof Uint8Array) return value.bytes;
  if (Array.isArray(value?.bytes)) return new Uint8Array(value.bytes);
  return null;
}

function decodeDSTRecordLocal(record) {
  const b0 = record[0];
  const b1 = record[1];
  const b2 = record[2];
  let dx = 0;
  let dy = 0;
  if (b0 & 0x80) dx += 1;
  if (b0 & 0x40) dx -= 1;
  if (b0 & 0x20) dx += 9;
  if (b0 & 0x10) dx -= 9;
  if (b1 & 0x80) dx += 3;
  if (b1 & 0x40) dx -= 3;
  if (b1 & 0x20) dx += 27;
  if (b1 & 0x10) dx -= 27;
  if (b2 & 0x20) dx += 81;
  if (b2 & 0x10) dx -= 81;
  if (b0 & 0x01) dy += 1;
  if (b0 & 0x02) dy -= 1;
  if (b0 & 0x04) dy += 9;
  if (b0 & 0x08) dy -= 9;
  if (b1 & 0x01) dy += 3;
  if (b1 & 0x02) dy -= 3;
  if (b1 & 0x04) dy += 27;
  if (b1 & 0x08) dy -= 27;
  if (b2 & 0x04) dy += 81;
  if (b2 & 0x08) dy -= 81;
  let flag = 'stitch';
  if (b2 === 0xF3) flag = 'end';
  else if (b2 & 0x40) flag = 'colorChange';
  else if (b2 & 0x80) flag = 'jump';
  return { dx, dy, flag };
}

function signedByte(value) {
  return value > 127 ? value - 256 : value;
}

function decodeDSBRecordLocal(record) {
  const command = record[0];
  let type = 'stitch';
  if (command === 0xF8) type = 'end';
  else if (command === 0x80) type = 'jump';
  else if (command === 0x88) type = 'colorChange';
  return { dx: signedByte(record[2]), dy: signedByte(record[1]), type };
}

function decodeBytesToCommands(bytesInput, format) {
  const bytes = toBytes(bytesInput);
  if (!bytes || bytes.length < 515) return null;
  const decode = format === 'DSB' ? decodeDSBRecordLocal : decodeDSTRecordLocal;
  const commands = [];
  let x = 0;
  let y = 0;
  const dataEnd = bytes[bytes.length - 1] === 0x1A ? bytes.length - 1 : bytes.length;
  for (let i = 512; i + 2 < dataEnd; i += 3) {
    const decoded = decode([bytes[i], bytes[i + 1], bytes[i + 2]]);
    const type = decoded.type || decoded.flag;
    if (type === 'end') {
      commands.push({ type: 'end', x, y, source: `decoded_${format.toLowerCase()}` });
      break;
    }
    x += (decoded.dx || 0) / 10;
    y += (decoded.dy || 0) / 10;
    commands.push({ type, x, y, source: `decoded_${format.toLowerCase()}` });
  }
  return commands;
}

function choosePreviewCommands(sources) {
  return sources.finalLookCommands || sources.simulatorCommands || sources.rellenosPreviewCommands || sources.finalEmbroideryCommands || null;
}

function firstDivergenceStage(sources) {
  const chain = [
    ['rellenosPreviewCommands', sources.rellenosPreviewCommands],
    ['finalLookCommands', sources.finalLookCommands],
    ['simulatorCommands', sources.simulatorCommands],
    ['finalEmbroideryCommands', sources.finalEmbroideryCommands],
    ['exportCommands', sources.exportCommands],
    ['decodedDstCommands', sources.decodedDstCommands],
    ['decodedDsbCommands', sources.decodedDsbCommands],
  ].filter(([, commands]) => normalizeCommands(commands));
  for (let i = 1; i < chain.length; i++) {
    if (!exactSameCommands(chain[i - 1][1], chain[i][1])) return `${chain[i - 1][0]} -> ${chain[i][0]}`;
  }
  return chain.length > 1 ? 'none_detected_between_available_sources' : 'insufficient_sources_available';
}

function diagnosisFor(sources, metrics, risks) {
  const preview = choosePreviewCommands(sources);
  const exportCommands = sources.exportCommands;
  const rellenosAbstract = !sources.rellenosPreviewCommands && Array.isArray(sources.regions) && sources.regions.length > 0;
  const finalLookSame = sources.finalLookCommands && exportCommands ? exactSameCommands(sources.finalLookCommands, exportCommands) : null;
  const simulatorSame = sources.simulatorCommands && exportCommands ? exactSameCommands(sources.simulatorCommands, exportCommands) : null;
  const hiddenTravel = risks.commandsPresentInExportButNotPreview > 0 || risks.longVisibleConnectorCountExport > risks.longVisibleConnectorCountPreview;
  const longJumpsVisible = metrics.export.jumpCount === 0 && risks.stitchCommandsLongerThan6mm > 0;
  const contourLong = risks.contourCommandsChangedBetweenPreviewAndExport > 0 && risks.stitchCommandsLongerThan6mm > 0;

  return {
    rellenosPreviewUsesAbstractRegionFillsInsteadOfRealFinalCommands: rellenosAbstract,
    finalLookUsesExactSameCommandStreamAsExport: finalLookSame,
    simulatorUsesExactSameCommandStreamAsExport: simulatorSame,
    connectorTravelCommandsHiddenInPreviewButPresentInExport: hiddenTravel,
    longJumpsBeingEncodedOrInterpretedAsVisibleStitches: longJumpsVisible,
    contoursConvertedIntoLongVisibleStitchPaths: contourLong,
    firstStageWherePreviewAndExportDiverge: firstDivergenceStage(sources),
    previewCommandSourceChosenForDiff: preview ? 'available' : 'unavailable',
  };
}

export function runPreviewToExportParityAudit(input = {}) {
  const decodedDstCommands = input.decodedDstCommands || decodeBytesToCommands(input.dstBytes || input.decodedDstBytes, 'DST');
  const decodedDsbCommands = input.decodedDsbCommands || decodeBytesToCommands(input.dsbBytes || input.decodedDsbBytes, 'DSB');
  const sources = {
    rellenosPreviewCommands: normalizeCommands(input.rellenosPreviewCommands),
    finalLookCommands: normalizeCommands(input.finalLookCommands),
    simulatorCommands: normalizeCommands(input.simulatorCommands),
    finalEmbroideryCommands: normalizeCommands(input.finalEmbroideryCommands),
    exportCommands: normalizeCommands(input.exportCommands),
    decodedDstCommands: normalizeCommands(decodedDstCommands),
    decodedDsbCommands: normalizeCommands(decodedDsbCommands),
    regions: input.regions || [],
  };
  const previewCommands = choosePreviewCommands(sources);
  const exportCommands = sources.exportCommands || sources.finalEmbroideryCommands;
  const metrics = {
    rellenosPreview: metricForCommands(sources.rellenosPreviewCommands),
    finalLook: metricForCommands(sources.finalLookCommands),
    simulator: metricForCommands(sources.simulatorCommands),
    finalEmbroidery: metricForCommands(sources.finalEmbroideryCommands),
    export: metricForCommands(exportCommands),
    decodedDst: metricForCommands(sources.decodedDstCommands),
    decodedDsb: metricForCommands(sources.decodedDsbCommands),
  };
  const decodedFileColorCount = metrics.decodedDst.colorCount ?? metrics.decodedDsb.colorCount ?? null;
  const decodedJumpCount = metrics.decodedDst.jumpCount ?? metrics.decodedDsb.jumpCount ?? null;
  const decodedTrimCount = metrics.decodedDst.trimCount ?? metrics.decodedDsb.trimCount ?? null;
  const risks = {
    longVisibleConnectorCountPreview: metricForCommands(previewCommands).longVisibleConnectorCount ?? 0,
    longVisibleConnectorCountExport: metrics.export.longVisibleConnectorCount ?? 0,
    stitchCommandsLongerThan3mm: metrics.export.stitchLongerThan3mm ?? 0,
    stitchCommandsLongerThan6mm: metrics.export.stitchLongerThan6mm ?? 0,
    stitchCommandsLongerThan10mm: metrics.export.stitchLongerThan10mm ?? 0,
    jumpCommandsEncodedAsVisibleStitchesLikely: Math.max(0, (metrics.export.stitchLongerThan6mm ?? 0) - (metrics.export.jumpCount ?? 0)),
    commandsHiddenInPreviewButPresentInExport: commandSetDiff(exportCommands, previewCommands),
    commandsPresentInExportButNotPreview: commandSetDiff(exportCommands, previewCommands),
    contourCommandsChangedBetweenPreviewAndExport: contourDiffCount(previewCommands, exportCommands),
    blackOutlineLayerPositionPreview: blackOutlineLayerPosition(previewCommands),
    blackOutlineLayerPositionExport: blackOutlineLayerPosition(exportCommands),
  };

  return {
    generatedAt: new Date().toISOString(),
    auditName: 'PREVIEW_TO_EXPORT_PARITY_AUDIT_V1',
    auditOnly: true,
    regionsModified: false,
    commandsModified: false,
    exportModified: false,
    encodersTouched: false,
    availableSources: Object.fromEntries(Object.entries(sources).filter(([key]) => key !== 'regions').map(([key, value]) => [key, !!value])),
    rellenosPreviewCommandCount: metrics.rellenosPreview.commandCount,
    finalLookCommandCount: metrics.finalLook.commandCount,
    simulatorCommandCount: metrics.simulator.commandCount,
    finalEmbroideryCommandCount: metrics.finalEmbroidery.commandCount,
    exportCommandCount: metrics.export.commandCount,
    decodedDstCommandCount: metrics.decodedDst.commandCount,
    decodedDsbCommandCount: metrics.decodedDsb.commandCount,
    rellenosPreviewStitchCount: metrics.rellenosPreview.stitchCount,
    finalLookStitchCount: metrics.finalLook.stitchCount,
    simulatorStitchCount: metrics.simulator.stitchCount,
    finalEmbroideryStitchCount: metrics.finalEmbroidery.stitchCount,
    exportStitchCount: metrics.export.stitchCount,
    decodedDstStitchCount: metrics.decodedDst.stitchCount,
    decodedDsbStitchCount: metrics.decodedDsb.stitchCount,
    rellenosPreviewColorCount: metrics.rellenosPreview.colorCount,
    finalLookColorCount: metrics.finalLook.colorCount,
    simulatorColorCount: metrics.simulator.colorCount,
    exportColorCount: metrics.export.colorCount,
    decodedFileColorCount,
    previewJumpCount: metricForCommands(previewCommands).jumpCount,
    exportJumpCount: metrics.export.jumpCount,
    decodedJumpCount,
    previewTrimCount: metricForCommands(previewCommands).trimCount,
    exportTrimCount: metrics.export.trimCount,
    decodedTrimCount,
    ...risks,
    diagnosis: diagnosisFor(sources, metrics, risks),
  };
}

function valueForMarkdown(value) {
  if (value == null) return 'unavailable';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function buildPreviewToExportParityAuditMarkdown(audit) {
  const lines = [];
  lines.push('# PREVIEW_TO_EXPORT_PARITY_AUDIT_V1');
  lines.push('');
  lines.push(`Fecha: ${audit.generatedAt}`);
  lines.push('Tipo: audit-only diagnostic; no modifica generación, comandos, regiones, exportación ni encoders.');
  lines.push('');
  lines.push('## Guardrails');
  for (const key of ['auditOnly', 'regionsModified', 'commandsModified', 'exportModified', 'encodersTouched']) lines.push(`- ${key}=${audit[key]}`);
  lines.push('');
  lines.push('## Available command sources');
  for (const [key, value] of Object.entries(audit.availableSources || {})) lines.push(`- ${key}: ${value}`);
  lines.push('');
  lines.push('## Command count metrics');
  for (const key of ['rellenosPreviewCommandCount', 'finalLookCommandCount', 'simulatorCommandCount', 'finalEmbroideryCommandCount', 'exportCommandCount', 'decodedDstCommandCount', 'decodedDsbCommandCount']) lines.push(`- ${key}: ${valueForMarkdown(audit[key])}`);
  lines.push('');
  lines.push('## Stitch/color/jump/trim comparison');
  for (const key of [
    'rellenosPreviewStitchCount', 'finalLookStitchCount', 'simulatorStitchCount', 'finalEmbroideryStitchCount', 'exportStitchCount', 'decodedDstStitchCount', 'decodedDsbStitchCount',
    'rellenosPreviewColorCount', 'finalLookColorCount', 'simulatorColorCount', 'exportColorCount', 'decodedFileColorCount',
    'previewJumpCount', 'exportJumpCount', 'decodedJumpCount', 'previewTrimCount', 'exportTrimCount', 'decodedTrimCount',
  ]) lines.push(`- ${key}: ${valueForMarkdown(audit[key])}`);
  lines.push('');
  lines.push('## Visual/path risk metrics');
  for (const key of [
    'longVisibleConnectorCountPreview', 'longVisibleConnectorCountExport', 'stitchCommandsLongerThan3mm', 'stitchCommandsLongerThan6mm', 'stitchCommandsLongerThan10mm',
    'jumpCommandsEncodedAsVisibleStitchesLikely', 'commandsHiddenInPreviewButPresentInExport', 'commandsPresentInExportButNotPreview',
    'contourCommandsChangedBetweenPreviewAndExport', 'blackOutlineLayerPositionPreview', 'blackOutlineLayerPositionExport',
  ]) lines.push(`- ${key}: ${valueForMarkdown(audit[key])}`);
  lines.push('');
  lines.push('## Diagnosis');
  lines.push(`1. Is Rellenos preview using abstract region fills instead of real final commands? ${valueForMarkdown(audit.diagnosis.rellenosPreviewUsesAbstractRegionFillsInsteadOfRealFinalCommands)}`);
  lines.push(`2. Is Final Look using the exact same command stream as export? ${valueForMarkdown(audit.diagnosis.finalLookUsesExactSameCommandStreamAsExport)}`);
  lines.push(`3. Is Simular using the exact same command stream as export? ${valueForMarkdown(audit.diagnosis.simulatorUsesExactSameCommandStreamAsExport)}`);
  lines.push(`4. Are connector/travel commands hidden in preview but present in export? ${valueForMarkdown(audit.diagnosis.connectorTravelCommandsHiddenInPreviewButPresentInExport)}`);
  lines.push(`5. Are long jumps being encoded or interpreted as visible stitches? ${valueForMarkdown(audit.diagnosis.longJumpsBeingEncodedOrInterpretedAsVisibleStitches)}`);
  lines.push(`6. Are contours converted into long visible stitch paths? ${valueForMarkdown(audit.diagnosis.contoursConvertedIntoLongVisibleStitchPaths)}`);
  lines.push(`7. What is the first stage where preview and export diverge? ${valueForMarkdown(audit.diagnosis.firstStageWherePreviewAndExportDiverge)}`);
  return lines.join('\n');
}