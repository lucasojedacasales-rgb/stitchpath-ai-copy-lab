/**
 * Embroidery Binary Inspector — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Diagnostic module for comparing functional Wilcom-generated files with
 * app-generated files. Detects why the Caydo CE01 reads a file on screen
 * but rejects it (double beep) when loading for embroidery.
 *
 * Supports DST (Tajima) and DSB (Barudan) formats.
 *
 * Reference behavior (observed from functional Wilcom DSB):
 *   - 512-byte ASCII header
 *   - ST header field matches exact 3-byte record count
 *   - File ends with byte 0x1A
 *   - No trailing/remainder bytes
 *   - Bounds and header are coherent
 */

const HEADER_SIZE = 512;
const EOF_BYTE = 0x1A;
const RECORD_SIZE = 3;
const CE01_HOOP_MM = 100; // 100×100mm
const CE01_SAFE_MARGIN_MM = 5; // 5mm safety margin
const UNIT_MM = 0.1; // each unit = 0.1mm

// ─── Helpers ────────────────────────────────────────────────────────────

function bufferToAscii(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 13) str += '\r';
    else if (b === 10) str += '\n';
    else if (b >= 32 && b <= 126) str += String.fromCharCode(b);
    else str += '.';
  }
  return str;
}

function parseHeaderField(headerStr, field) {
  // Literal search: field is like "+X", "-X", "ST", etc.
  const tag = field + ':';
  const idx = headerStr.indexOf(tag);
  if (idx === -1) return null;
  const rest = headerStr.substring(idx + tag.length);
  const match = rest.match(/^\s*(-?\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function parseHeaderLabel(headerStr) {
  const idx = headerStr.indexOf('LA:');
  if (idx === -1) return null;
  const rest = headerStr.substring(idx + 3);
  const end = rest.indexOf('\r');
  const label = end !== -1 ? rest.substring(0, end) : rest.substring(0, 16);
  return label.replace(/\s+$/, '');
}

/**
 * Detects format from binary content. Both DST and DSB share 512-byte ASCII
 * headers; we default to DST unless the caller overrides.
 */
export function detectFormat(buffer, hint) {
  if (hint) return hint;
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) return 'UNKNOWN';
  const headerStr = bufferToAscii(bytes.slice(0, Math.min(HEADER_SIZE, bytes.length)));
  if (headerStr.indexOf('LA:') !== -1 && headerStr.indexOf('ST:') !== -1) {
    return 'DST'; // default — DSB shares the same header style
  }
  return 'UNKNOWN';
}

// ─── 1. parseEmbroideryHeader ───────────────────────────────────────────

export function parseEmbroideryHeader(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_SIZE) {
    return { valid: false, error: `Archivo de ${bytes.length} bytes — menor que cabecera de 512` };
  }
  const headerStr = bufferToAscii(bytes.slice(0, HEADER_SIZE));

  const header = {
    valid: true,
    label: parseHeaderLabel(headerStr),
    ST: parseHeaderField(headerStr, 'ST'),
    CO: parseHeaderField(headerStr, 'CO'),
    plusX: parseHeaderField(headerStr, '+X'),
    minusX: parseHeaderField(headerStr, '-X'),
    plusY: parseHeaderField(headerStr, '+Y'),
    minusY: parseHeaderField(headerStr, '-Y'),
    AX: parseHeaderField(headerStr, 'AX'),
    AY: parseHeaderField(headerStr, 'AY'),
    MX: parseHeaderField(headerStr, 'MX'),
    MY: parseHeaderField(headerStr, 'MY'),
    PD: parseHeaderField(headerStr, 'PD'),
  };

  console.log('[binary-inspector] header:', header);
  return header;
}

// ─── Record decoders ────────────────────────────────────────────────────

/**
 * DST record decoder — balanced ternary (powers of 3: 1, 3, 9, 27, 81).
 * Matches the corrected dstEncoder.js encoding used by the Caydo CE01.
 *
 * X: b0 0x80=+1, 0x40=-1, 0x20=+9, 0x10=-9
 *    b1 0x80=+3, 0x40=-3, 0x20=+27, 0x10=-27
 *    b2 0x20=+81, 0x10=-81
 *
 * Y: b0 0x01=+1, 0x02=-1, 0x04=+9, 0x08=-9
 *    b1 0x01=+3, 0x02=-3, 0x04=+27, 0x08=-27
 *    b2 0x04=+81, 0x08=-81
 *
 * Control: b2 0x03=stitch, 0x80=jump, 0x40=colorChange, 0xF3=END
 */
function decodeDSTRecord(b0, b1, b2) {
  let x = 0, y = 0;

  // X
  if (b0 & 0x80) x += 1;
  if (b0 & 0x40) x -= 1;
  if (b0 & 0x20) x += 9;
  if (b0 & 0x10) x -= 9;
  if (b1 & 0x80) x += 3;
  if (b1 & 0x40) x -= 3;
  if (b1 & 0x20) x += 27;
  if (b1 & 0x10) x -= 27;
  if (b2 & 0x20) x += 81;
  if (b2 & 0x10) x -= 81;

  // Y
  if (b0 & 0x01) y += 1;
  if (b0 & 0x02) y -= 1;
  if (b0 & 0x04) y += 9;
  if (b0 & 0x08) y -= 9;
  if (b1 & 0x01) y += 3;
  if (b1 & 0x02) y -= 3;
  if (b1 & 0x04) y += 27;
  if (b1 & 0x08) y -= 27;
  if (b2 & 0x04) y += 81;
  if (b2 & 0x08) y -= 81;

  let type = 'stitch';
  if (b2 === 0xF3) type = 'end';
  else if (b2 & 0x80) type = 'jump';
  else if (b2 & 0x40) type = 'colorChange';

  return { x, y, type };
}

/**
 * Barudan DSB record: [command, Y, X] — command byte first, then signed Y, X.
 * command: 0x80=stitch, 0x81=jump, 0x88=colorChange, 0xF8=end
 */
function decodeDSBRecord(b0, b1, b2) {
  // b0 = command, b1 = Y (signed), b2 = X (signed)
  const y = b1 > 127 ? b1 - 256 : b1;
  const x = b2 > 127 ? b2 - 256 : b2;

  let type = 'stitch';
  if (b0 === 0xF8) type = 'end';
  else if (b0 === 0x81) type = 'jump';
  else if (b0 === 0x88) type = 'colorChange';

  return { x, y, type };
}

function decodeRecord(format, b0, b1, b2) {
  if (format === 'DSB') return decodeDSBRecord(b0, b1, b2);
  return decodeDSTRecord(b0, b1, b2);
}

// ─── 2. validateRecordStructure ─────────────────────────────────────────

export function validateRecordStructure(buffer, formatHint) {
  const bytes = new Uint8Array(buffer);
  const fileSize = bytes.length;
  const format = detectFormat(buffer, formatHint);

  console.log('[binary-inspector] file size:', fileSize);

  const hasHeader512 = fileSize >= HEADER_SIZE;
  const headerSize = hasHeader512 ? HEADER_SIZE : 0;

  const lastByte = fileSize > 0 ? bytes[fileSize - 1] : -1;
  const hasEofByte = lastByte === EOF_BYTE;

  console.log('[binary-inspector] eof byte:', hasEofByte
    ? '0x1A ✓'
    : `0x${(lastByte & 0xFF).toString(16).toUpperCase()} ✗`);

  const dataStart = headerSize;
  const dataEnd = hasEofByte ? fileSize - 1 : fileSize;
  const dataLength = dataEnd - dataStart;
  const recordCount = Math.floor(dataLength / RECORD_SIZE);
  const trailingBytes = dataLength % RECORD_SIZE;

  console.log('[binary-inspector] declared ST: (see header)');
  console.log('[binary-inspector] actual records:', recordCount);
  console.log('[binary-inspector] trailing bytes:', trailingBytes);

  const report = {
    format,
    fileSize,
    headerSize,
    hasHeader512,
    recordCount,
    recordSize: RECORD_SIZE,
    hasEofByte,
    eofByte: lastByte,
    trailingBytes,
    dataLength,
    structureValid: hasHeader512 && trailingBytes === 0 && recordCount > 0 && hasEofByte,
  };

  return report;
}

// ─── 3. validateHeaderAgainstCommands ───────────────────────────────────

export function validateHeaderAgainstCommands(buffer, formatHint) {
  const bytes = new Uint8Array(buffer);
  const format = detectFormat(buffer, formatHint);
  const header = parseEmbroideryHeader(buffer);
  const structure = validateRecordStructure(buffer, format);

  const issues = [];

  let realStitchCount = 0;
  let realColorChanges = 0;
  let hasEnd = false;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  let cumX = 0, cumY = 0;
  let consecutiveSpecials = 0;
  let largeMoves = 0;
  let nanCoords = false;

  const startIdx = structure.headerSize;
  const endIdx = structure.hasEofByte ? bytes.length - 1 : bytes.length;
  const MAX_MOVE = 121; // 12.1mm in 0.1mm units

  for (let i = startIdx; i + 2 < endIdx; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const rec = decodeRecord(format, b0, b1, b2);

    if (rec.x === null || rec.x === undefined || !Number.isFinite(rec.x)) {
      nanCoords = true;
      continue;
    }

    if (rec.type === 'end') {
      hasEnd = true;
      break;
    }

    cumX += rec.x;
    cumY += rec.y;
    if (cumX < minX) minX = cumX;
    if (cumX > maxX) maxX = cumX;
    if (cumY < minY) minY = cumY;
    if (cumY > maxY) maxY = cumY;

    const dist = Math.hypot(rec.x, rec.y);
    if (dist > MAX_MOVE) largeMoves++;

    if (rec.type === 'stitch') {
      realStitchCount++;
    } else if (rec.type === 'colorChange') {
      realColorChanges++;
    }

    if (rec.type !== 'stitch') {
      consecutiveSpecials++;
      if (consecutiveSpecials > 3) {
        issues.push({
          type: 'consecutive_specials',
          severity: 'warning',
          message: `Comandos especiales consecutivos en record ~${(i - startIdx) / 3}`,
        });
      }
    } else {
      consecutiveSpecials = 0;
    }
  }

  const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - maxY };
  console.log('[binary-inspector] bounds:', bounds);
  console.log('[binary-inspector] declared ST:', header.ST);
  console.log('[binary-inspector] actual stitches:', realStitchCount);
  console.log('[binary-inspector] has END:', hasEnd);
  console.log('[binary-inspector] color changes:', realColorChanges);

  // ST match check
  const stMatch = header.ST !== null && header.ST === realStitchCount;
  if (!stMatch) {
    issues.push({
      type: 'st_mismatch',
      severity: 'critical',
      message: `ST del header (${header.ST}) ≠ registros reales (${realStitchCount})`,
    });
  }

  // Bounds match check (header bounds should be >= actual bounds)
  const boundsMatch = header.plusX !== null && header.minusX !== null &&
    header.plusY !== null && header.minusY !== null &&
    header.plusX >= maxX * 0.9 &&
    header.minusX >= -minX * 0.9 &&
    header.plusY >= maxY * 0.9 &&
    header.minusY >= -minY * 0.9;
  if (!boundsMatch && header.plusX !== null) {
    issues.push({
      type: 'bounds_mismatch',
      severity: 'warning',
      message: `Bounds del header no coinciden con bounds reales`,
    });
  }

  if (!hasEnd) {
    issues.push({
      type: 'missing_end',
      severity: 'critical',
      message: 'No se encontró comando END en el archivo',
    });
  }

  if (nanCoords) {
    issues.push({
      type: 'nan_coords',
      severity: 'critical',
      message: 'Coordenadas NaN/null/undefined detectadas en records',
    });
  }

  if (largeMoves > 0) {
    issues.push({
      type: 'large_moves',
      severity: 'warning',
      message: `${largeMoves} movimientos >12.1mm sin dividir`,
    });
  }

  return {
    format,
    declaredST: header.ST,
    actualStitches: realStitchCount,
    stMatch,
    declaredCO: header.CO,
    actualColorChanges: realColorChanges,
    boundsDeclared: { plusX: header.plusX, minusX: header.minusX, plusY: header.plusY, minusY: header.minusY },
    boundsActual: bounds,
    boundsMatch,
    hasEnd,
    fileTerminatesCorrectly: structure.hasEofByte && hasEnd,
    issues,
  };
}

// ─── 4. compareWithWilcomReference ──────────────────────────────────────

export function compareWithWilcomReference(referenceBuffer, generatedBuffer, formatHint) {
  const refHeader = parseEmbroideryHeader(referenceBuffer);
  const refStructure = validateRecordStructure(referenceBuffer, formatHint);
  const refValidation = validateHeaderAgainstCommands(referenceBuffer, formatHint);

  const genHeader = parseEmbroideryHeader(generatedBuffer);
  const genStructure = validateRecordStructure(generatedBuffer, formatHint);
  const genValidation = validateHeaderAgainstCommands(generatedBuffer, formatHint);

  const differences = [];
  const likelyRejectReasons = [];
  const recommendations = [];

  // Header 512
  if (refStructure.hasHeader512 && !genStructure.hasHeader512) {
    differences.push({ field: 'header512', reference: true, generated: false,
      message: 'Referencia tiene cabecera 512 bytes, generado no' });
    likelyRejectReasons.push('Cabecera incompleta — la CE01 espera 512 bytes exactos');
  }

  // EOF byte
  if (refStructure.hasEofByte && !genStructure.hasEofByte) {
    differences.push({ field: 'eofByte', reference: true, generated: false,
      message: 'Referencia termina con 0x1A, generado no' });
    likelyRejectReasons.push('Falta byte final 0x1A — la CE01 puede no detectar fin de archivo');
  }

  // Trailing bytes
  if (genStructure.trailingBytes > 0) {
    differences.push({ field: 'trailingBytes', reference: refStructure.trailingBytes, generated: genStructure.trailingBytes,
      message: `${genStructure.trailingBytes} bytes sobrantes después del último record` });
    likelyRejectReasons.push(`Bytes sobrantes (${genStructure.trailingBytes}) — records no alineados a 3 bytes`);
  }

  // ST match
  if (refValidation.stMatch && !genValidation.stMatch) {
    differences.push({ field: 'stMatch', reference: true, generated: false,
      message: `ST declarado (${genValidation.declaredST}) ≠ registros reales (${genValidation.actualStitches})` });
    likelyRejectReasons.push('ST del header no coincide con registros reales — la CE01 rechaza por inconsistencia');
  }

  // END command
  if (refValidation.hasEnd && !genValidation.hasEnd) {
    differences.push({ field: 'hasEnd', reference: true, generated: false,
      message: 'Referencia tiene END, generado no' });
    likelyRejectReasons.push('Falta comando END — la máquina no sabe cuándo terminar');
  }

  // Bounds vs CE01 safe area
  const SAFE_LIMIT = (CE01_HOOP_MM - CE01_SAFE_MARGIN_MM) / UNIT_MM; // 950 units
  const HARD_LIMIT = CE01_HOOP_MM / UNIT_MM; // 1000 units
  if (genValidation.boundsActual.width > HARD_LIMIT || genValidation.boundsActual.height > HARD_LIMIT) {
    likelyRejectReasons.push(`Diseño fuera del bastidor CE01: ${(genValidation.boundsActual.width * UNIT_MM).toFixed(1)}×${(genValidation.boundsActual.height * UNIT_MM).toFixed(1)}mm > 100×100mm`);
  } else if (genValidation.boundsActual.width > SAFE_LIMIT || genValidation.boundsActual.height > SAFE_LIMIT) {
    likelyRejectReasons.push(`Diseño demasiado cerca del límite CE01: ${(genValidation.boundsActual.width * UNIT_MM).toFixed(1)}×${(genValidation.boundsActual.height * UNIT_MM).toFixed(1)}mm (área segura 95×95mm)`);
  }

  // Record count comparison
  if (refStructure.recordCount > 0 && genStructure.recordCount > 0) {
    const diff = Math.abs(refStructure.recordCount - genStructure.recordCount);
    if (diff > refStructure.recordCount * 0.5) {
      differences.push({ field: 'recordCount', reference: refStructure.recordCount, generated: genStructure.recordCount,
        message: `Diferencia significativa: ref=${refStructure.recordCount} vs gen=${genStructure.recordCount}` });
    }
  }

  // Color count comparison
  if (refValidation.actualColorChanges !== genValidation.actualColorChanges) {
    differences.push({ field: 'colorChanges', reference: refValidation.actualColorChanges, generated: genValidation.actualColorChanges,
      message: `Cambios de color: ref=${refValidation.actualColorChanges} vs gen=${genValidation.actualColorChanges}` });
  }

  // Recommendations
  if (!genStructure.hasHeader512) recommendations.push('Asegurar que la cabecera tenga exactamente 512 bytes ASCII');
  if (!genStructure.hasEofByte) recommendations.push('Añadir byte 0x1A al final del archivo');
  if (genStructure.trailingBytes > 0) recommendations.push('Asegurar que el número de records sea múltiplo exacto de 3 bytes');
  if (!genValidation.stMatch) recommendations.push(`Actualizar ST del header a ${genValidation.actualStitches} para coincidir con registros reales`);
  if (!genValidation.hasEnd) recommendations.push('Añadir comando END (3 bytes con b2=0xF3) antes del byte 0x1A');
  if (genValidation.issues.some(i => i.type === 'large_moves')) recommendations.push('Dividir movimientos >12.1mm en sub-movimientos');
  if (genValidation.issues.some(i => i.type === 'nan_coords')) recommendations.push('Filtrar coordenadas NaN/Infinity antes de codificar');
  if (genValidation.boundsActual.width > SAFE_LIMIT) recommendations.push('Reducir tamaño del diseño para estar dentro del área segura (95×95mm)');

  const rejectReason = likelyRejectReasons[0] || 'none';
  console.log('[binary-inspector] likely CE01 reject reason:', rejectReason);

  return {
    reference: {
      format: refStructure.format,
      fileSize: refStructure.fileSize,
      header: refHeader,
      recordCount: refStructure.recordCount,
      eofByte: refStructure.hasEofByte,
      structureValid: refStructure.structureValid,
    },
    generated: {
      format: genStructure.format,
      fileSize: genStructure.fileSize,
      header: genHeader,
      recordCount: genStructure.recordCount,
      eofByte: genStructure.hasEofByte,
      structureValid: genStructure.structureValid,
    },
    differences,
    likelyRejectReasons,
    recommendations,
  };
}

// ─── 6. validateForCaydoCE01Binary ──────────────────────────────────────

export function validateForCaydoCE01Binary(buffer, formatHint) {
  const bytes = new Uint8Array(buffer);
  const fileSize = bytes.length;
  const format = detectFormat(buffer, formatHint);
  const header = parseEmbroideryHeader(buffer);
  const structure = validateRecordStructure(buffer, format);
  const validation = validateHeaderAgainstCommands(buffer, format);

  const blockingIssues = [];
  const warnings = [];

  // Structure
  if (!structure.hasHeader512) blockingIssues.push('Cabecera incompleta: no tiene 512 bytes');
  if (!structure.hasEofByte) blockingIssues.push('Falta byte final 0x1A');
  if (structure.trailingBytes > 0) blockingIssues.push(`${structure.trailingBytes} bytes sobrantes — records no alineados a 3 bytes`);
  if (structure.recordCount === 0) blockingIssues.push('No hay records de puntada');

  // ST match
  if (!validation.stMatch) blockingIssues.push(`ST del header (${validation.declaredST}) ≠ registros reales (${validation.actualStitches})`);

  // END
  if (!validation.hasEnd) blockingIssues.push('Falta comando END');

  // NaN coords
  if (validation.issues.some(i => i.type === 'nan_coords')) blockingIssues.push('Coordenadas NaN/null detectadas');

  // Bounds
  const w = validation.boundsActual.width;
  const h = validation.boundsActual.height;
  const SAFE_LIMIT = (CE01_HOOP_MM - CE01_SAFE_MARGIN_MM) / UNIT_MM;
  const HARD_LIMIT = CE01_HOOP_MM / UNIT_MM;
  if (w > HARD_LIMIT || h > HARD_LIMIT) {
    blockingIssues.push(`Diseño fuera del bastidor: ${(w * UNIT_MM).toFixed(1)}×${(h * UNIT_MM).toFixed(1)}mm > 100×100mm`);
  } else if (w > SAFE_LIMIT || h > SAFE_LIMIT) {
    warnings.push(`Diseño cerca del límite: ${(w * UNIT_MM).toFixed(1)}×${(h * UNIT_MM).toFixed(1)}mm (área segura 95×95mm)`);
  }

  // Large moves
  const largeMovesIssue = validation.issues.find(i => i.type === 'large_moves');
  if (largeMovesIssue) warnings.push(largeMovesIssue.message);

  // Consecutive specials
  if (validation.issues.some(i => i.type === 'consecutive_specials')) {
    warnings.push('Comandos especiales consecutivos raros detectados');
  }

  // Color count
  const colorCount = validation.actualColorChanges + 1;
  if (colorCount > 6) warnings.push(`${colorCount} colores — la CE01 soporta hasta 6`);

  // Status
  let status = 'SAFE';
  if (warnings.length > 0) status = 'RISKY';
  if (blockingIssues.length > 0) status = 'INVALID';

  const recommendation = blockingIssues.length > 0
    ? `Corregir: ${blockingIssues[0]}`
    : warnings.length > 0
      ? `Revisar: ${warnings[0]}`
      : 'Archivo binariamente válido para CE01';

  const rejectReason = blockingIssues[0] || warnings[0] || 'none';
  console.log('[binary-inspector] likely CE01 reject reason:', rejectReason);

  return {
    ce01BinaryReady: blockingIssues.length === 0,
    status,
    blockingIssues,
    warnings,
    headerReport: {
      valid: header.valid,
      ST: header.ST,
      CO: header.CO,
      label: header.label,
      bounds: { plusX: header.plusX, minusX: header.minusX, plusY: header.plusY, minusY: header.minusY },
    },
    recordReport: {
      recordCount: structure.recordCount,
      trailingBytes: structure.trailingBytes,
      hasEofByte: structure.hasEofByte,
      actualStitches: validation.actualStitches,
      hasEnd: validation.hasEnd,
      stMatch: validation.stMatch,
      colorChanges: validation.actualColorChanges,
    },
    sizeReport: {
      fileSize,
      boundsActual: validation.boundsActual,
      withinSafeArea: w <= SAFE_LIMIT && h <= SAFE_LIMIT,
      widthMm: +(w * UNIT_MM).toFixed(1),
      heightMm: +(h * UNIT_MM).toFixed(1),
    },
    recommendation,
  };
}