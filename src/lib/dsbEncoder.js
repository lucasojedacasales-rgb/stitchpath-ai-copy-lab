/**
 * DSB Encoder — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Real Barudan/Wilcom DSB encoder.
 *
 * DSB format (Barudan FDR-3):
 *   - 512-byte ASCII header (LA, ST, CO, +X, -X, +Y, -Y, AX, AY, MX, MY, PD)
 *   - 0x1A after PD field, padded to 512 bytes
 *   - 3-byte records: [commandByte, yByte, xByte]
 *   - Y and X are signed bytes (two's complement), 0.1mm units, range ±127
 *   - commandByte: 0x80=stitch, 0x81=jump, 0x88=colorChange, 0xF8=end
 *   - END record: [0xF8, 0x00, 0x00]
 *   - File ends with 0x1A
 *
 * Max delta per record: ±127 units = ±12.7mm. Long moves are split.
 * Every encode is validated via roundtrip: encode → decode → compare.
 */

const HEADER_SIZE = 512;
const EOF_BYTE = 0x1A;
const RECORD_SIZE = 3;
const MAX_DELTA = 127; // ±127 units = ±12.7mm per record

// ─── Command bytes ──────────────────────────────────────────────────────

const COMMANDS = {
  stitch: 0x80,
  jump: 0x81,
  colorChange: 0x88,
  end: 0xF8,
};

// ─── Signed byte helpers ────────────────────────────────────────────────

function toSignedByte(value) {
  const clamped = Math.max(-127, Math.min(127, Math.round(value)));
  if (clamped < 0) return clamped + 256; // two's complement
  return clamped;
}

function fromSignedByte(byte) {
  return byte > 127 ? byte - 256 : byte;
}

// ─── Encoder ────────────────────────────────────────────────────────────

/**
 * Encodes a single DSB delta (dx, dy) with the given type.
 * Returns [commandByte, yByte, xByte].
 *
 * @param {number} dx — delta X in 0.1mm units, range ±127
 * @param {number} dy — delta Y in 0.1mm units, range ±127
 * @param {string} type — 'stitch' | 'jump' | 'colorChange' | 'end'
 * @returns {[number, number, number]}
 */
export function encodeDSBRecord(dx, dy, type = 'stitch') {
  if (type === 'end') {
    return [COMMANDS.end, 0x00, 0x00];
  }

  const rdx = Math.round(dx);
  const rdy = Math.round(dy);

  if (Math.abs(rdx) > MAX_DELTA || Math.abs(rdy) > MAX_DELTA) {
    throw new Error(`[dsb-encoder] delta fuera de rango: dx=${rdx} dy=${rdy} (max ±${MAX_DELTA})`);
  }

  const cmd = COMMANDS[type] ?? COMMANDS.stitch;
  return [cmd, toSignedByte(rdy), toSignedByte(rdx)];
}

// ─── Decoder ────────────────────────────────────────────────────────────

/**
 * Decodes a 3-byte DSB record into { command, dx, dy, type }.
 * @param {[number, number, number]} record
 * @returns {{ command: number, dx: number, dy: number, type: string }}
 */
export function decodeDSBRecord(record) {
  const command = record[0];
  const yByte = record[1];
  const xByte = record[2];

  const dy = fromSignedByte(yByte);
  const dx = fromSignedByte(xByte);

  let type = 'stitch';
  if (command === COMMANDS.end) type = 'end';
  else if (command === COMMANDS.jump) type = 'jump';
  else if (command === COMMANDS.colorChange) type = 'colorChange';

  return { command, dx, dy, type };
}

// ─── Roundtrip validation ───────────────────────────────────────────────

export function validateDSBRoundtrip(dx, dy, type = 'stitch') {
  console.log('[dsb-encoder] requested delta:', { dx, dy, type });
  const record = encodeDSBRecord(dx, dy, type);
  console.log('[dsb-encoder] encoded record:', record.map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()));
  const decoded = decodeDSBRecord(record);
  console.log('[dsb-encoder] decoded delta:', decoded);

  if (decoded.dx !== dx || decoded.dy !== dy) {
    console.error('[dsb-encoder] roundtrip FAILED:', { requested: { dx, dy }, decoded });
    throw new Error(`[dsb-encoder] roundtrip failed: requested dx=${dx} dy=${dy} but decoded dx=${decoded.dx} dy=${decoded.dy}`);
  }
  if (type !== 'end' && decoded.type !== type) {
    console.error('[dsb-encoder] type mismatch:', { requested: type, decoded: decoded.type });
    throw new Error(`[dsb-encoder] type mismatch: requested ${type} but decoded ${decoded.type}`);
  }

  console.log('[dsb-encoder] roundtrip ok:', { dx, dy, type });
  return true;
}

// ─── Split long moves into valid deltas ─────────────────────────────────

export function encodeDSBMove(dx, dy, type = 'stitch') {
  const rdx = Math.round(dx);
  const rdy = Math.round(dy);
  const steps = Math.max(
    1,
    Math.ceil(Math.abs(rdx) / MAX_DELTA),
    Math.ceil(Math.abs(rdy) / MAX_DELTA)
  );

  const records = [];
  for (let s = 1; s <= steps; s++) {
    const stepDx = Math.round(rdx * s / steps) - Math.round(rdx * (s - 1) / steps);
    const stepDy = Math.round(rdy * s / steps) - Math.round(rdy * (s - 1) / steps);
    const record = encodeDSBRecord(stepDx, stepDy, type);
    const decoded = decodeDSBRecord(record);
    if (decoded.dx !== stepDx || decoded.dy !== stepDy) {
      throw new Error(`[dsb-encoder] roundtrip failed in split: step ${s}/${steps} dx=${stepDx} dy=${stepDy} → decoded dx=${decoded.dx} dy=${decoded.dy}`);
    }
    records.push(record);
  }
  return records;
}

// ─── Header builder (512 bytes, CR line breaks, 0x1A after PD) ──────────

export function buildDSBHeader({ label, stitchCount, colorChanges, bounds, finalX, finalY }) {
  const fields = [
    `LA:${(label || 'design').padEnd(16, ' ').substring(0, 16)}`,
    `ST:${String(stitchCount).padStart(6, ' ')}`,
    `CO:${String(colorChanges).padStart(4, ' ')}`,
    `+X:${String(bounds.plusX).padStart(6, ' ')}`,
    `-X:${String(bounds.minusX).padStart(6, ' ')}`,
    `+Y:${String(bounds.plusY).padStart(6, ' ')}`,
    `-Y:${String(bounds.minusY).padStart(6, ' ')}`,
    `AX:${String(finalX).padStart(6, ' ')}`,
    `AY:${String(finalY).padStart(6, ' ')}`,
    `MX:${String(0).padStart(6, ' ')}`,
    `MY:${String(0).padStart(6, ' ')}`,
    `PD:******`,
  ];

  let header = fields.join('\r') + '\r' + '\x1A';
  while (header.length < HEADER_SIZE) header += ' ';
  return header.substring(0, HEADER_SIZE);
}

// ─── Full file builder with roundtrip + bounds recalculation ────────────

/**
 * Builds a complete DSB file from absolute stitch points.
 * @param {Object} params
 * @param {string} params.label
 * @param {Array<[number, number]>} params.stitchPoints — absolute coords in 0.1mm units
 * @param {number} params.colorChanges — real color change count
 * @param {boolean} params.ce01Strict — add EOF 0x1A at end
 * @returns {{ blob, bytes, meta }}
 */
export function buildDSBFile({ label, stitchPoints, colorChanges = 0, ce01Strict = true }) {
  console.log('[dsb-encoder] enabled: true');

  const records = [];
  let prevX = 0, prevY = 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;

  for (const [absX, absY] of stitchPoints) {
    const totalDx = Math.round(absX - prevX);
    const totalDy = Math.round(absY - prevY);
    const moveRecords = encodeDSBMove(totalDx, totalDy, 'stitch');
    for (const rec of moveRecords) records.push(rec);
    prevX = absX;
    prevY = absY;
    if (absX < minX) minX = absX;
    if (absX > maxX) maxX = absX;
    if (absY < minY) minY = absY;
    if (absY > maxY) maxY = absY;
  }

  // END record: [0xF8, 0x00, 0x00]
  records.push([COMMANDS.end, 0x00, 0x00]);

  const recordCount = records.length;
  const stitchCount = recordCount; // includes END per CE01 convention
  const bounds = { plusX: maxX, minusX: -minX, plusY: maxY, minusY: -minY };

  // ── Recalculate bounds from decoded records ──
  let cumX = 0, cumY = 0;
  let decMinX = 0, decMaxX = 0, decMinY = 0, decMaxY = 0;
  const cmdDist = {};

  for (const rec of records) {
    const decoded = decodeDSBRecord(rec);
    const cmdHex = '0x' + decoded.command.toString(16).padStart(2, '0').toUpperCase();
    cmdDist[cmdHex] = (cmdDist[cmdHex] || 0) + 1;

    if (decoded.type === 'end') break;
    cumX += decoded.dx;
    cumY += decoded.dy;
    if (cumX < decMinX) decMinX = cumX;
    if (cumX > decMaxX) decMaxX = cumX;
    if (cumY < decMinY) decMinY = cumY;
    if (cumY > decMaxY) decMaxY = cumY;
  }

  const decodedBounds = {
    plusX: decMaxX, minusX: -decMinX, plusY: decMaxY, minusY: -decMinY,
  };

  console.log('[dsb-encoder] command distribution:', cmdDist);
  console.log('[dsb-encoder] header:', { stitchCount, colorChanges, bounds, finalX: prevX, finalY: prevY });
  console.log('[dsb-encoder] records:', recordCount);
  console.log('[dsb-encoder] final command:', '0x' + COMMANDS.end.toString(16).padStart(2, '0').toUpperCase() + ' 0x00 0x00');
  console.log('[dsb-encoder] eof byte:', '0x' + EOF_BYTE.toString(16).padStart(2, '0').toUpperCase());
  console.log('[dsb-encoder] bounds:', bounds);
  console.log('[dsb-encoder] decoded bounds:', decodedBounds);

  const headerMatches =
    decodedBounds.plusX === bounds.plusX &&
    decodedBounds.minusX === bounds.minusX &&
    decodedBounds.plusY === bounds.plusY &&
    decodedBounds.minusY === bounds.minusY;

  console.log('[dsb-encoder] header matches decoded:', headerMatches);

  if (!headerMatches) {
    throw new Error(`[dsb-encoder] bounds mismatch: header=${JSON.stringify(bounds)} decoded=${JSON.stringify(decodedBounds)}`);
  }

  // Build header
  const headerStr = buildDSBHeader({
    label,
    stitchCount,
    colorChanges,
    bounds,
    finalX: prevX,
    finalY: prevY,
  });

  const headerBytes = new Uint8Array(HEADER_SIZE);
  for (let i = 0; i < HEADER_SIZE; i++) {
    headerBytes[i] = headerStr.charCodeAt(i) & 0xFF;
  }

  // Build record bytes
  const recordBytes = new Uint8Array(records.length * RECORD_SIZE);
  for (let i = 0; i < records.length; i++) {
    recordBytes[i * 3] = records[i][0];
    recordBytes[i * 3 + 1] = records[i][1];
    recordBytes[i * 3 + 2] = records[i][2];
  }

  // Combine: header + records + EOF 0x1A
  const totalSize = HEADER_SIZE + records.length * RECORD_SIZE + (ce01Strict ? 1 : 0);
  const fileBytes = new Uint8Array(totalSize);
  fileBytes.set(headerBytes, 0);
  fileBytes.set(recordBytes, HEADER_SIZE);
  if (ce01Strict) fileBytes[totalSize - 1] = EOF_BYTE;

  console.log('[dsb-encoder] binary ready:', {
    fileSize: totalSize,
    stitchCount,
    recordCount,
    bounds,
    finalX: prevX,
    finalY: prevY,
    hasEof: ce01Strict,
  });

  return {
    blob: new Blob([fileBytes], { type: 'application/octet-stream' }),
    bytes: fileBytes,
    meta: {
      format: 'DSB',
      label,
      stitchCount,
      recordCount,
      bounds,
      decodedBounds,
      finalX: prevX,
      finalY: prevY,
      fileSize: totalSize,
      colorChanges,
      commandDistribution: cmdDist,
    },
  };
}

// ─── Compare with Wilcom reference ──────────────────────────────────────

function parseDSBHeader(bytes) {
  if (bytes.length < HEADER_SIZE) return null;
  let headerStr = '';
  for (let i = 0; i < HEADER_SIZE; i++) {
    const b = bytes[i];
    if (b === 13) headerStr += '\r';
    else if (b === 10) headerStr += '\n';
    else if (b >= 32 && b <= 126) headerStr += String.fromCharCode(b);
    else headerStr += '.';
  }

  const getField = (name) => {
    const tag = name + ':';
    const idx = headerStr.indexOf(tag);
    if (idx === -1) return null;
    const rest = headerStr.substring(idx + tag.length);
    const match = rest.match(/^\s*(-?\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  const getLabel = () => {
    const idx = headerStr.indexOf('LA:');
    if (idx === -1) return null;
    const rest = headerStr.substring(idx + 3);
    const end = rest.indexOf('\r');
    return (end !== -1 ? rest.substring(0, end) : rest.substring(0, 16)).replace(/\s+$/, '');
  };

  return {
    label: getLabel(),
    ST: getField('ST'),
    CO: getField('CO'),
    plusX: getField('+X'),
    minusX: getField('-X'),
    plusY: getField('+Y'),
    minusY: getField('-Y'),
    AX: getField('AX'),
    AY: getField('AY'),
  };
}

/**
 * Compares a functional Wilcom DSB reference with a generated DSB file.
 * Reports header, structure, command distribution, and bounds differences.
 */
export function compareDSBToWilcom(referenceBuffer, generatedBuffer) {
  const refBytes = new Uint8Array(referenceBuffer);
  const genBytes = new Uint8Array(generatedBuffer);

  const refHeader = parseDSBHeader(refBytes);
  const genHeader = parseDSBHeader(genBytes);

  // Structure
  const refHasEof = refBytes[refBytes.length - 1] === EOF_BYTE;
  const genHasEof = genBytes[genBytes.length - 1] === EOF_BYTE;
  const refDataEnd = refHasEof ? refBytes.length - 1 : refBytes.length;
  const genDataEnd = genHasEof ? genBytes.length - 1 : genBytes.length;
  const refRecordCount = Math.floor((refDataEnd - HEADER_SIZE) / RECORD_SIZE);
  const genRecordCount = Math.floor((genDataEnd - HEADER_SIZE) / RECORD_SIZE);
  const refTrailing = (refDataEnd - HEADER_SIZE) % RECORD_SIZE;
  const genTrailing = (genDataEnd - HEADER_SIZE) % RECORD_SIZE;

  // Check END command (last 3 bytes of data region)
  const refEnd = refBytes.length >= HEADER_SIZE + 3
    ? [refBytes[refDataEnd - 3], refBytes[refDataEnd - 2], refBytes[refDataEnd - 1]]
    : null;
  const genEnd = genBytes.length >= HEADER_SIZE + 3
    ? [genBytes[genDataEnd - 3], genBytes[genDataEnd - 2], genBytes[genDataEnd - 1]]
    : null;
  const refHasEndCmd = refEnd && refEnd[0] === COMMANDS.end;
  const genHasEndCmd = genEnd && genEnd[0] === COMMANDS.end;

  // Command distribution for both files
  function analyzeCommands(bytes, dataEnd) {
    const dist = {};
    let cumX = 0, cumY = 0;
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    let stitches = 0, jumps = 0, colorChanges = 0;
    let hasEnd = false;

    for (let i = HEADER_SIZE; i + 2 < dataEnd; i += 3) {
      const cmd = bytes[i];
      const yByte = bytes[i + 1];
      const xByte = bytes[i + 2];
      const cmdHex = '0x' + cmd.toString(16).padStart(2, '0').toUpperCase();
      dist[cmdHex] = (dist[cmdHex] || 0) + 1;

      if (cmd === COMMANDS.end) { hasEnd = true; break; }

      const dy = fromSignedByte(yByte);
      const dx = fromSignedByte(xByte);
      cumX += dx;
      cumY += dy;
      if (cumX < minX) minX = cumX;
      if (cumX > maxX) maxX = cumX;
      if (cumY < minY) minY = cumY;
      if (cumY > maxY) maxY = cumY;

      if (cmd === COMMANDS.stitch) stitches++;
      else if (cmd === COMMANDS.jump) jumps++;
      else if (cmd === COMMANDS.colorChange) colorChanges++;
    }

    return {
      dist, stitches, jumps, colorChanges, hasEnd,
      bounds: { plusX: maxX, minusX: -minX, plusY: maxY, minusY: -minY,
        width: maxX - minX, height: maxY - minY },
    };
  }

  const refAnalysis = analyzeCommands(refBytes, refDataEnd);
  const genAnalysis = analyzeCommands(genBytes, genDataEnd);

  const differences = [];
  const rejectReasons = [];

  // Header
  if (refBytes.length >= HEADER_SIZE && genBytes.length < HEADER_SIZE) {
    differences.push({ field: 'headerSize', message: 'Generado no tiene cabecera 512 bytes' });
    rejectReasons.push('Cabecera incompleta');
  }

  // ST match
  if (refHeader && genHeader) {
    if (refHeader.ST === refRecordCount && genHeader.ST !== genRecordCount) {
      differences.push({ field: 'stMatch', message: `ST generado (${genHeader.ST}) ≠ records (${genRecordCount})` });
      rejectReasons.push('ST no coincide con records reales');
    }
  }

  // EOF byte
  if (refHasEof && !genHasEof) {
    differences.push({ field: 'eofByte', message: 'Referencia tiene 0x1A, generado no' });
    rejectReasons.push('Falta byte final 0x1A');
  }

  // Trailing bytes
  if (refTrailing === 0 && genTrailing > 0) {
    differences.push({ field: 'trailing', message: `Generado tiene ${genTrailing} bytes sobrantes` });
    rejectReasons.push('Bytes sobrantes');
  }

  // END command
  if (refHasEndCmd && !genHasEndCmd) {
    differences.push({ field: 'endCmd', message: 'Referencia tiene F8 END, generado no' });
    rejectReasons.push('Falta comando END (F8 00 00)');
  }

  // Command distribution comparison
  const refCmds = Object.keys(refAnalysis.dist).sort();
  const genCmds = Object.keys(genAnalysis.dist).sort();
  const refOnlyCmds = refCmds.filter(c => !genCmds.includes(c));
  const genOnlyCmds = genCmds.filter(c => !refCmds.includes(c));

  if (refOnlyCmds.length > 0) {
    differences.push({ field: 'cmdDistribution', message: `Referencia usa comandos no presentes en generado: ${refOnlyCmds.join(', ')}` });
  }
  if (genOnlyCmds.length > 0) {
    differences.push({ field: 'cmdDistribution', message: `Generado usa comandos no presentes en referencia: ${genOnlyCmds.join(', ')}` });
  }

  // Bounds comparison
  if (refHeader && genHeader) {
    if (refHeader.plusX !== null && genHeader.plusX !== null) {
      if (Math.abs(refHeader.plusX - genHeader.plusX) > 100) {
        differences.push({ field: 'bounds', message: `+X: ref=${refHeader.plusX} vs gen=${genHeader.plusX}` });
      }
    }
  }

  // Decoded bounds comparison
  if (refAnalysis.bounds.width > 0 && genAnalysis.bounds.width > 0) {
    const wDiff = Math.abs(refAnalysis.bounds.width - genAnalysis.bounds.width);
    if (wDiff > 100) {
      differences.push({ field: 'decodedBounds', message: `Ancho decodificado: ref=${refAnalysis.bounds.width} vs gen=${genAnalysis.bounds.width}` });
    }
  }

  // Jumps comparison
  if (refAnalysis.jumps === 0 && genAnalysis.jumps > 0) {
    differences.push({ field: 'jumps', message: `Referencia sin jumps; generado tiene ${genAnalysis.jumps}` });
  }

  console.log('[dsb-encoder] compared to Wilcom:', {
    refRecords: refRecordCount,
    genRecords: genRecordCount,
    refCmds: refAnalysis.dist,
    genCmds: genAnalysis.dist,
    differences: differences.length,
  });

  return {
    reference: {
      fileSize: refBytes.length,
      header: refHeader,
      recordCount: refRecordCount,
      hasEof: refHasEof,
      hasEndCmd: refHasEndCmd,
      endBytes: refEnd,
      trailingBytes: refTrailing,
      commandDistribution: refAnalysis.dist,
      analysis: refAnalysis,
    },
    generated: {
      fileSize: genBytes.length,
      header: genHeader,
      recordCount: genRecordCount,
      hasEof: genHasEof,
      hasEndCmd: genHasEndCmd,
      endBytes: genEnd,
      trailingBytes: genTrailing,
      commandDistribution: genAnalysis.dist,
      analysis: genAnalysis,
    },
    differences,
    rejectReasons,
  };
}