/**
 * referenceFileParser.js — Reference Embroidery Learning System
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads real DST/DSB embroidery files and converts them into the internal
 * command representation used by StitchPath AI:
 *
 *   { type: 'stitch'|'jump'|'trim'|'colorChange'|'end', x, y (mm), index }
 *
 * Also extracts file-level metadata: size, stitch count, color blocks,
 * jumps, trims (inferred), stitch lengths, bounding box, color sequence,
 * approximate density, visible travel, long/short stitches, duplicates.
 *
 * DST and DSB are the only initial formats. PES/EXP/JEF/VP3 will be added
 * later — this module is the single entry point for reference ingestion.
 *
 * IMPORTANT: read-only diagnostic. Never writes or modifies files.
 */

import { decodeDSTRecord } from '@/lib/dstEncoder';
import { decodeDSBRecord } from '@/lib/dsbEncoder';

const HEADER_SIZE = 512;
const RECORD_SIZE = 3;
const UNIT_MM = 0.1; // DST/DSB units are 0.1mm

// Jump length above which we infer a trim was intended (mm). Professional
// files almost always trim before jumps > ~3.5mm. We infer trims heuristically
// because DST/DSB have no explicit trim command.
const INFERRED_TRIM_JUMP_MM = 3.5;
// A "visible travel" jump is one that crosses open space (no fill under it)
// — approximated here by jump length > 6mm without a following fill cluster.
const VISIBLE_TRAVEL_JUMP_MM = 6.0;
// Duplicate stitch: same point as the previous one.
const DUPLICATE_TOL_MM = 0.05;
// Short stitch threshold (mm)
const SHORT_STITCH_MM = 1.0;
// Long visible stitch threshold (mm) — real stitches above this are usually
// split by professional digitizers.
const LONG_VISIBLE_STITCH_MM = 7.0;

// ─── Header parser (shared by DST and DSB) ──────────────────────────────────

function parseAsciiHeader(bytes) {
  if (bytes.length < HEADER_SIZE) return null;
  let str = '';
  for (let i = 0; i < HEADER_SIZE; i++) {
    const b = bytes[i];
    if (b === 13) str += '\r';
    else if (b === 10) str += '\n';
    else if (b >= 32 && b <= 126) str += String.fromCharCode(b);
    else str += '.';
  }
  const getField = (name) => {
    const tag = name + ':';
    const idx = str.indexOf(tag);
    if (idx === -1) return null;
    const rest = str.substring(idx + tag.length);
    const m = rest.match(/^\s*(-?\d+)/);
    return m ? parseInt(m[1], 10) : null;
  };
  const getLabel = () => {
    const idx = str.indexOf('LA:');
    if (idx === -1) return null;
    const rest = str.substring(idx + 3);
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

// ─── Record iterator ────────────────────────────────────────────────────────

function iterateRecords(bytes, decodeFn) {
  const hasEof = bytes[bytes.length - 1] === 0x1A;
  const dataEnd = hasEof ? bytes.length - 1 : bytes.length;
  const records = [];
  for (let i = HEADER_SIZE; i + RECORD_SIZE <= dataEnd; i += RECORD_SIZE) {
    const rec = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const decoded = decodeFn(rec);
    records.push(decoded);
    if (decoded.flag === 'end' || decoded.type === 'end') break;
  }
  return records;
}

// ─── Public: parseFile ──────────────────────────────────────────────────────────

/**
 * Parses a DST or DSB file (as ArrayBuffer/Uint8Array) into internal commands
 * and extracts all file-level metadata required by the learning system.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} filename
 * @returns {{ filename, format, commands, header, metadata, parseWarnings }}
 */
export function parseReferenceFile(buffer, filename = 'reference') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const ext = (filename.split('.').pop() || '').toUpperCase();
  const format = ext === 'DSB' ? 'DSB' : 'DST';
  const parseWarnings = [];

  if (bytes.length < HEADER_SIZE + RECORD_SIZE) {
    return {
      filename, format,
      commands: [],
      header: null,
      metadata: emptyMetadata(),
      parseWarnings: ['File too small to contain any stitch record.'],
    };
  }

  const header = parseAsciiHeader(bytes);
  const decodeFn = format === 'DSB' ? decodeDSBRecord : decodeDSTRecord;
  const decodedRecords = iterateRecords(bytes, decodeFn);

  // Convert decoded deltas to absolute commands in mm
  const commands = [];
  let x = 0, y = 0; // accumulator in 0.1mm units
  let colorIndex = 0;
  let colorBlockStartIdx = 0;

  for (let i = 0; i < decodedRecords.length; i++) {
    const r = decodedRecords[i];
    const flag = r.flag || r.type;
    if (flag === 'end') {
      commands.push({ type: 'end', x: x * UNIT_MM, y: y * UNIT_MM, index: commands.length });
      break;
    }
    // accumulate delta for every record (jumps also move the head)
    x += r.dx;
    y += r.dy;
    const absX = x * UNIT_MM;
    const absY = y * UNIT_MM;
    if (flag === 'jump') {
      commands.push({ type: 'jump', x: absX, y: absY, color: colorIndex, index: commands.length });
    } else if (flag === 'colorChange') {
      // close current color block
      commands.push({ type: 'colorChange', x: absX, y: absY, color: colorIndex, index: commands.length, blockStart: colorBlockStartIdx });
      colorIndex += 1;
      colorBlockStartIdx = commands.length;
    } else {
      commands.push({ type: 'stitch', x: absX, y: absY, color: colorIndex, index: commands.length });
    }
  }

  if (commands.length === 0) {
    parseWarnings.push('No stitch records decoded.');
  }

  const metadata = extractMetadata(commands, header, bytes.length);
  return { filename, format, commands, header, metadata, parseWarnings };
}

// ─── Metadata extraction ───────────────────────────────────────────────────────

function emptyMetadata() {
  return {
    stitchCount: 0, colorCount: 0, jumpCount: 0, trimCount: 0,
    colorBlocks: [], colorSequence: [], stitchLengths: [],
    boundingBoxMm: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
    estimatedDensity: 0, visibleTravelMm: 0, longStitchCount: 0,
    shortStitchCount: 0, duplicateStitchCount: 0, fileSize: 0,
  };
}

function extractMetadata(commands, header, fileSize) {
  const stitches = commands.filter(c => c.type === 'stitch');
  const jumps = commands.filter(c => c.type === 'jump');
  const colorChanges = commands.filter(c => c.type === 'colorChange');

  // Bounding box (mm)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of commands) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = 0; }
  const bbArea = Math.max(0, (maxX - minX) * (maxY - minY));

  // Stitch lengths
  const stitchLengths = [];
  let prevStitch = null;
  let totalStitchLen = 0;
  let longStitchCount = 0;
  let shortStitchCount = 0;
  let duplicateStitchCount = 0;
  for (const c of commands) {
    if (c.type !== 'stitch') continue;
    if (prevStitch) {
      const len = Math.hypot(c.x - prevStitch.x, c.y - prevStitch.y);
      stitchLengths.push(len);
      totalStitchLen += len;
      if (len < DUPLICATE_TOL_MM) duplicateStitchCount++;
      else if (len < SHORT_STITCH_MM) shortStitchCount++;
      else if (len > LONG_VISIBLE_STITCH_MM) longStitchCount++;
    }
    prevStitch = c;
  }

  // Jump lengths + inferred trims
  let visibleTravelMm = 0;
  let trimCount = 0;
  let prevCmd = null;
  for (const c of commands) {
    if (c.type === 'jump' && prevCmd) {
      const jlen = Math.hypot(c.x - prevCmd.x, c.y - prevCmd.y);
      if (jlen > INFERRED_TRIM_JUMP_MM) trimCount++;
      if (jlen > VISIBLE_TRAVEL_JUMP_MM) visibleTravelMm += jlen;
    }
    prevCmd = c;
  }

  // Color blocks: contiguous runs of the same color
  const colorBlocks = [];
  let blockStart = 0;
  let blockColor = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'colorChange') {
      colorBlocks.push({ color: blockColor, start: blockStart, end: i, stitchCount: countStitches(commands, blockStart, i) });
      blockStart = i;
      blockColor = c.color + 1;
    } else if (c.type === 'end') {
      colorBlocks.push({ color: blockColor, start: blockStart, end: i, stitchCount: countStitches(commands, blockStart, i) });
      break;
    }
  }
  if (colorBlocks.length === 0 && stitches.length > 0) {
    colorBlocks.push({ color: 0, start: 0, end: commands.length, stitchCount: stitches.length });
  }

  const colorSequence = colorBlocks.map(b => b.color);

  // Estimated density: total stitch length / bounding box area (mm/mm²)
  const estimatedDensity = bbArea > 0 ? totalStitchLen / bbArea : 0;

  return {
    stitchCount: stitches.length,
    colorCount: colorBlocks.length,
    jumpCount: jumps.length,
    trimCount,
    colorBlocks,
    colorSequence,
    stitchLengths,
    averageStitchLength: stitchLengths.length ? totalStitchLen / stitchLengths.length : 0,
    maxStitchLength: stitchLengths.length ? Math.max(...stitchLengths) : 0,
    boundingBoxMm: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
    estimatedDensity,
    visibleTravelMm,
    longStitchCount,
    shortStitchCount,
    duplicateStitchCount,
    fileSize,
    headerLabel: header?.label || null,
  };
}

function countStitches(commands, start, end) {
  let n = 0;
  for (let i = start; i < end; i++) if (commands[i].type === 'stitch') n++;
  return n;
}

// ─── Convenience: parse from a browser File ────────────────────────────────────

/**
 * Parses a browser File (DST/DSB) into the reference structure.
 * @param {File} file
 * @returns {Promise<object>} — same shape as parseReferenceFile
 */
export async function parseReferenceFileFromFile(file) {
  const buffer = await file.arrayBuffer();
  return parseReferenceFile(buffer, file.name);
}

export const PARSE_CONSTANTS = {
  INFERRED_TRIM_JUMP_MM,
  VISIBLE_TRAVEL_JUMP_MM,
  DUPLICATE_TOL_MM,
  SHORT_STITCH_MM,
  LONG_VISIBLE_STITCH_MM,
};