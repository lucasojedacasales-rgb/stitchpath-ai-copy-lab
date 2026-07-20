/**
 * DST Encoder — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Correct DST delta encoder using balanced-ternary bit mapping (powers of 3).
 *
 * The Caydo CE01 uses a non-standard DST bit mapping where each axis is
 * encoded as balanced ternary (digits -1, 0, +1) with powers 1, 3, 9, 27, 81.
 * Max delta: ±121 units = ±12.1mm.
 *
 * Bit mapping:
 *
 * Y axis:
 *   b0 & 0x01 => y += 1     b0 & 0x02 => y -= 1
 *   b0 & 0x04 => y += 9     b0 & 0x08 => y -= 9
 *   b1 & 0x01 => y += 3     b1 & 0x02 => y -= 3
 *   b1 & 0x04 => y += 27    b1 & 0x08 => y -= 27
 *   b2 & 0x04 => y += 81    b2 & 0x08 => y -= 81
 *
 * X axis:
 *   b0 & 0x80 => x += 1     b0 & 0x40 => x -= 1
 *   b0 & 0x20 => x += 9     b0 & 0x10 => x -= 9
 *   b1 & 0x80 => x += 3     b1 & 0x40 => x -= 3
 *   b1 & 0x20 => x += 27    b1 & 0x10 => x -= 27
 *   b2 & 0x20 => x += 81    b2 & 0x10 => x -= 81
 *
 * Control byte (b2) base: 0x03 (normal stitch)
 *   jump:       b2 |= 0x80
 *   colorChange: b2 |= 0x40
 *   end:        b2  = 0xF3
 *
 * Every encode is validated via roundtrip: encode → decode → compare.
 */

const HEADER_SIZE = 512;
const EOF_BYTE = 0x1A;
const RECORD_SIZE = 3;
const MAX_DELTA = 121; // ±121 units = ±12.1mm

// ─── Balanced ternary conversion ────────────────────────────────────────
// Converts an integer to 5 balanced-ternary trits (powers: 1, 3, 9, 27, 81).
// Each trit is -1, 0, or +1. Range: ±121.

function toBalancedTernary(value) {
  const trits = [0, 0, 0, 0, 0];
  let v = Math.round(value);
  for (let i = 0; i < 5; i++) {
    let r = v % 3;
    if (r < 0) r += 3; // normalize negative remainders
    if (r === 0) { trits[i] = 0; v = v / 3; }
    else if (r === 1) { trits[i] = 1; v = (v - 1) / 3; }
    else { trits[i] = -1; v = (v + 1) / 3; }
  }
  return trits;
}

// ─── Encoder ────────────────────────────────────────────────────────────

/**
 * Encodes a single DST delta (dx, dy) with the given flag.
 * Returns [b0, b1, b2].
 *
 * @param {number} dx — delta X in DST units (0.1mm), range ±121
 * @param {number} dy — delta Y in DST units (0.1mm), range ±121
 * @param {string} flag — 'stitch' | 'jump' | 'colorChange' | 'end'
 * @returns {[number, number, number]}
 */
export function encodeDSTDelta(dx, dy, flag = 'stitch') {
  if (flag === 'end') {
    return [0x00, 0x00, 0xF3];
  }

  const rdx = Math.round(dx);
  const rdy = Math.round(dy);

  if (Math.abs(rdx) > MAX_DELTA || Math.abs(rdy) > MAX_DELTA) {
    throw new Error(`[dst-encoder] delta fuera de rango: dx=${rdx} dy=${rdy} (max ±${MAX_DELTA})`);
  }

  const xT = toBalancedTernary(rdx); // [1, 3, 9, 27, 81]
  const yT = toBalancedTernary(rdy);

  let b0 = 0, b1 = 0, b2 = 0x03; // base bits for stitch

  // X bits
  if (xT[0] === 1) b0 |= 0x80; else if (xT[0] === -1) b0 |= 0x40; // ±1
  if (xT[2] === 1) b0 |= 0x20; else if (xT[2] === -1) b0 |= 0x10; // ±9
  if (xT[1] === 1) b1 |= 0x80; else if (xT[1] === -1) b1 |= 0x40; // ±3
  if (xT[3] === 1) b1 |= 0x20; else if (xT[3] === -1) b1 |= 0x10; // ±27
  if (xT[4] === 1) b2 |= 0x20; else if (xT[4] === -1) b2 |= 0x10; // ±81

  // Y bits
  if (yT[0] === 1) b0 |= 0x01; else if (yT[0] === -1) b0 |= 0x02; // ±1
  if (yT[2] === 1) b0 |= 0x04; else if (yT[2] === -1) b0 |= 0x08; // ±9
  if (yT[1] === 1) b1 |= 0x01; else if (yT[1] === -1) b1 |= 0x02; // ±3
  if (yT[3] === 1) b1 |= 0x04; else if (yT[3] === -1) b1 |= 0x08; // ±27
  if (yT[4] === 1) b2 |= 0x04; else if (yT[4] === -1) b2 |= 0x08; // ±81

  // Flag bits — colorChange needs BOTH jump (0x80) and color (0x40) bits
  // to produce 0xC3, which machines like the Caydo CE01 recognize as a real
  // STOP / color change. Using only 0x40 (→ 0x43) is not recognized.
  if (flag === 'jump') b2 |= 0x80;
  else if (flag === 'colorChange') b2 |= 0xC0; // 0x80 | 0x40 → b2 = 0xC3

  return [b0, b1, b2];
}

// ─── Decoder ────────────────────────────────────────────────────────────

/**
 * Decodes a 3-byte DST record into { dx, dy, flag }.
 * @param {[number, number, number]} record
 * @returns {{ dx: number, dy: number, flag: string }}
 */
export function decodeDSTRecord(record) {
  const b0 = record[0], b1 = record[1], b2 = record[2];

  let dx = 0, dy = 0;

  // X
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

  // Y
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

  // Check colorChange (0x40) BEFORE jump (0x80) — a colorChange record (0xC3)
  // has both bits set and must decode as colorChange, not jump.
  let flag = 'stitch';
  if (b2 === 0xF3) flag = 'end';
  else if (b2 & 0x40) flag = 'colorChange';
  else if (b2 & 0x80) flag = 'jump';

  return { dx, dy, flag };
}

// ─── Roundtrip validation ───────────────────────────────────────────────

/**
 * Validates that encode → decode produces the original delta.
 * Throws on mismatch. Logs every step.
 */
export function validateRoundtrip(dx, dy, flag = 'stitch') {
  console.log('[dst-encoder] requested delta:', { dx, dy, flag });
  const record = encodeDSTDelta(dx, dy, flag);
  console.log('[dst-encoder] encoded record:', record.map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()));
  const decoded = decodeDSTRecord(record);
  console.log('[dst-encoder] decoded delta:', decoded);

  if (decoded.dx !== dx || decoded.dy !== dy) {
    console.error('[dst-encoder] roundtrip FAILED:', { requested: { dx, dy }, decoded });
    throw new Error(`[dst-encoder] roundtrip failed: requested dx=${dx} dy=${dy} but decoded dx=${decoded.dx} dy=${decoded.dy}`);
  }
  if (flag !== 'end' && decoded.flag !== flag) {
    console.error('[dst-encoder] flag mismatch:', { requested: flag, decoded: decoded.flag });
    throw new Error(`[dst-encoder] flag mismatch: requested ${flag} but decoded ${decoded.flag}`);
  }

  console.log('[dst-encoder] roundtrip ok:', { dx, dy, flag });
  return true;
}

// ─── Split long moves into valid deltas ─────────────────────────────────

/**
 * Encodes a move that may exceed ±121 by splitting into multiple records.
 * Each sub-record is roundtrip-validated.
 */
export function encodeDSTMove(dx, dy, flag = 'stitch') {
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
    const record = encodeDSTDelta(stepDx, stepDy, flag);
    const decoded = decodeDSTRecord(record);
    if (decoded.dx !== stepDx || decoded.dy !== stepDy) {
      throw new Error(`[dst-encoder] roundtrip failed in split: step ${s}/${steps} dx=${stepDx} dy=${stepDy} → decoded dx=${decoded.dx} dy=${decoded.dy}`);
    }
    records.push(record);
  }
  return records;
}

// ─── Header builder (512 bytes, CR line breaks, 0x1A after PD) ──────────

export function buildDSTHeader({ label, stitchCount, colorChanges, bounds, finalX, finalY }) {
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

  // CR line breaks (not CRLF), 0x1A after PD field
  let header = fields.join('\r') + '\r' + '\x1A';
  while (header.length < HEADER_SIZE) header += ' ';
  return header.substring(0, HEADER_SIZE);
}

// ─── Full file builder with roundtrip + bounds recalculation ────────────

/**
 * Builds a complete DST file from absolute stitch points.
 * - Splits long moves
 * - Roundtrip-validates every record
 * - Recalculates bounds from decoded records
 * - Blocks export if header bounds ≠ decoded bounds
 *
 * @param {Object} params
 * @param {string} params.label
 * @param {Array<[number, number]>} params.stitchPoints — absolute coords in 0.1mm units
 * @param {number} params.colorChanges — real color change count
 * @param {boolean} params.ce01Strict — add EOF 0x1A at end
 * @returns {{ blob, bytes, meta }}
 */
export function buildDSTFile({ label, stitchPoints, colorChanges = 0, ce01Strict = true }) {
  const records = [];
  let prevX = 0, prevY = 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;

  for (const [absX, absY] of stitchPoints) {
    const totalDx = Math.round(absX - prevX);
    const totalDy = Math.round(absY - prevY);
    const moveRecords = encodeDSTMove(totalDx, totalDy, 'stitch');
    for (const rec of moveRecords) records.push(rec);
    prevX = absX;
    prevY = absY;
    if (absX < minX) minX = absX;
    if (absX > maxX) maxX = absX;
    if (absY < minY) minY = absY;
    if (absY > maxY) maxY = absY;
  }

  // END record
  records.push([0x00, 0x00, 0xF3]);

  // ST = total 3-byte records (including END)
  const recordCount = records.length;
  const stitchCount = recordCount; // includes END per CE01 convention
  const bounds = { plusX: maxX, minusX: -minX, plusY: maxY, minusY: -minY };

  // ── Recalculate bounds from decoded records ──
  let cumX = 0, cumY = 0;
  let decMinX = 0, decMaxX = 0, decMinY = 0, decMaxY = 0;
  for (const rec of records) {
    const { dx, dy, flag } = decodeDSTRecord(rec);
    if (flag === 'end') break;
    cumX += dx;
    cumY += dy;
    if (cumX < decMinX) decMinX = cumX;
    if (cumX > decMaxX) decMaxX = cumX;
    if (cumY < decMinY) decMinY = cumY;
    if (cumY > decMaxY) decMaxY = cumY;
  }

  const decodedBounds = {
    plusX: decMaxX, minusX: -decMinX, plusY: decMaxY, minusY: -decMinY,
  };

  console.log('[dst-encoder] decoded bounds:', decodedBounds);
  console.log('[dst-encoder] header bounds:', bounds);

  const headerMatches =
    decodedBounds.plusX === bounds.plusX &&
    decodedBounds.minusX === bounds.minusX &&
    decodedBounds.plusY === bounds.plusY &&
    decodedBounds.minusY === bounds.minusY;

  console.log('[dst-encoder] header matches decoded:', headerMatches);

  if (!headerMatches) {
    throw new Error(`[dst-encoder] bounds mismatch: header=${JSON.stringify(bounds)} decoded=${JSON.stringify(decodedBounds)}`);
  }

  // Build header
  const headerStr = buildDSTHeader({
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

  // Combine: header + records + optional EOF 0x1A
  const totalSize = HEADER_SIZE + records.length * RECORD_SIZE + (ce01Strict ? 1 : 0);
  const fileBytes = new Uint8Array(totalSize);
  fileBytes.set(headerBytes, 0);
  fileBytes.set(recordBytes, HEADER_SIZE);
  if (ce01Strict) fileBytes[totalSize - 1] = EOF_BYTE;

  console.log('[dst-encoder] binary ready:', {
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
      format: 'DST',
      label,
      stitchCount,
      recordCount,
      bounds,
      decodedBounds,
      finalX: prevX,
      finalY: prevY,
      fileSize: totalSize,
      colorChanges,
    },
  };
}

// ─── DSB — real encoder lives in dsbEncoder.js ──────────────────────────
// Re-export for backward compatibility. DSB is now a real Barudan encoder,
// not a DST clone.

export { buildDSBFile, encodeDSBRecord, decodeDSBRecord, compareDSBToWilcom } from './dsbEncoder';