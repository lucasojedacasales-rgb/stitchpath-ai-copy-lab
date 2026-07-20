/**
 * CE01 Format Test Suite — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates minimal, design-independent test files to diagnose Caydo CE01
 * compatibility issues. Uses the corrected dstEncoder with roundtrip validation.
 *
 * DSB is blocked — no real DSB encoder exists.
 *
 * Tests:
 *   TEST_01_DST_LINE     — 10mm horizontal line, 1 color, 0 jumps, 0 trims
 *   TEST_02_DST_SQUARE   — 30×30mm square outline, 1 color, 0 jumps, 0 trims
 *   TEST_03_DST_FILL     — 50×50mm filled square, 1 color
 */

import { buildDSTFile, decodeDSTRecord } from './dstEncoder';
import { buildDSBFile, compareDSBToWilcom } from './dsbEncoder';

// Re-export DSB comparison for panels that import from this module
export { compareDSBToWilcom };

const HEADER_SIZE = 512;
const EOF_BYTE = 0x1A;
const RECORD_SIZE = 3;

// ─── Coordinate generators (all units in 0.1mm) ─────────────────────────

function generateLinePoints(lengthUnits, stitchCount) {
  const points = [];
  const step = lengthUnits / stitchCount;
  for (let i = 1; i <= stitchCount; i++) {
    points.push([Math.round(step * i), 0]);
  }
  return points;
}

function generateSquarePoints(sizeUnits, stitchLen) {
  const points = [];
  const sides = [
    [0, 0, sizeUnits, 0],
    [sizeUnits, 0, sizeUnits, sizeUnits],
    [sizeUnits, sizeUnits, 0, sizeUnits],
    [0, sizeUnits, 0, 0],
  ];
  for (const [x1, y1, x2, y2] of sides) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const count = Math.max(1, Math.round(dist / stitchLen));
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      points.push([
        Math.round(x1 + (x2 - x1) * t),
        Math.round(y1 + (y2 - y1) * t),
      ]);
    }
  }
  return points;
}

function generateFillPoints(sizeUnits, rowSpacing, stitchLen) {
  const points = [];
  const rowCount = Math.floor(sizeUnits / rowSpacing);
  const stitchesPerRow = Math.floor(sizeUnits / stitchLen);

  for (let row = 0; row <= rowCount; row++) {
    const y = row * rowSpacing;
    if (row % 2 === 0) {
      for (let i = 1; i <= stitchesPerRow; i++) {
        points.push([i * stitchLen, y]);
      }
    } else {
      for (let i = stitchesPerRow; i >= 0; i--) {
        points.push([i * stitchLen, y]);
      }
    }
  }
  return points;
}

// ─── Test definitions ────────────────────────────────────────────────────

const TESTS = {
  TEST_01_DST_LINE: {
    format: 'DST',
    label: 'TEST01_LINE',
    generate: () => {
      // 10mm = 100 units, 25 stitches of 4 units each
      // Header: +X=100, +Y=0, -X=0, -Y=0
      // Decoded path: X=100, Y=0
      const points = generateLinePoints(100, 25);
      return buildDSTFile({
        label: 'TEST01_LINE',
        stitchPoints: points,
        colorChanges: 0,
        ce01Strict: true,
      });
    },
  },
  TEST_02_DST_SQUARE: {
    format: 'DST',
    label: 'TEST02_SQUARE',
    generate: () => {
      // 30×30mm = 300×300 units, stitch len 5 units (0.5mm)
      // Header: +X=300, +Y=300
      // Decoded path: 30×30mm
      const points = generateSquarePoints(300, 5);
      return buildDSTFile({
        label: 'TEST02_SQUARE',
        stitchPoints: points,
        colorChanges: 0,
        ce01Strict: true,
      });
    },
  },
  TEST_03_DST_SIMPLE_FILL: {
    format: 'DST',
    label: 'TEST03_FILL',
    generate: () => {
      // 50×50mm = 500×500 units, row spacing 30 units (3mm), stitch 10 units (1mm)
      const points = generateFillPoints(500, 30, 10);
      return buildDSTFile({
        label: 'TEST03_FILL',
        stitchPoints: points,
        colorChanges: 0,
        ce01Strict: true,
      });
    },
  },
  TEST_DSB_01_LINE: {
    format: 'DSB',
    label: 'TEST_DSB_01_LINE',
    generate: () => {
      // 10mm = 100 units, 25 stitches of 4 units each, 1 color, no jumps, no trims
      const points = generateLinePoints(100, 25);
      return buildDSBFile({
        label: 'TEST_DSB_01_LINE',
        stitchPoints: points,
        colorChanges: 0,
        ce01Strict: true,
      });
    },
  },
  TEST_DSB_02_SQUARE: {
    format: 'DSB',
    label: 'TEST_DSB_02_SQUARE',
    generate: () => {
      // 30×30mm = 300×300 units, stitch len 5 units (0.5mm), 1 color, <300 stitches
      const points = generateSquarePoints(300, 5);
      return buildDSBFile({
        label: 'TEST_DSB_02_SQUARE',
        stitchPoints: points,
        colorChanges: 0,
        ce01Strict: true,
      });
    },
  },
  TEST_DSB_03_FILL: {
    format: 'DSB',
    label: 'TEST_DSB_03_FILL',
    generate: () => {
      // 50×50mm = 500×500 units, row spacing 30 units (3mm), stitch 10 units (1mm), <1000 stitches
      const points = generateFillPoints(500, 30, 10);
      return buildDSBFile({
        label: 'TEST_DSB_03_FILL',
        stitchPoints: points,
        colorChanges: 0,
        ce01Strict: true,
      });
    },
  },
};

/**
 * Generates a test file by ID.
 * @param {string} testId
 * @returns {{ blob, bytes, meta }}
 */
export function generateTestFile(testId) {
  const test = TESTS[testId];
  if (!test) throw new Error(`Unknown test: ${testId}`);
  return test.generate();
}

/**
 * Returns metadata for all available tests.
 */
export function listTests() {
  return Object.entries(TESTS).map(([id, t]) => ({
    id,
    format: t.format,
    label: t.label,
  }));
}

/**
 * Triggers a browser download for a generated test file.
 */
export function downloadTestFile(testId) {
  const { blob, meta } = generateTestFile(testId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ext = meta.format.toLowerCase();
  a.download = `${meta.label}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  return meta;
}

// ─── compareToWilcomDSB — uses corrected DST decoder ─────────────────────

function parseHeaderFields(bytes) {
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
  };
}

function analyzeRecords(bytes, decoder) {
  let stitches = 0, jumps = 0, colorChanges = 0, hasEnd = false;
  let cumX = 0, cumY = 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  let maxDisp = 0;
  let overLimit = 0;

  const dataEnd = bytes[bytes.length - 1] === EOF_BYTE ? bytes.length - 1 : bytes.length;

  for (let i = HEADER_SIZE; i + 2 < dataEnd; i += 3) {
    const rec = decoder(bytes[i], bytes[i + 1], bytes[i + 2]);
    if (rec.flag === 'end') { hasEnd = true; break; }

    const disp = Math.hypot(rec.dx, rec.dy);
    if (disp > maxDisp) maxDisp = disp;
    if (disp > 121) overLimit++;

    cumX += rec.dx;
    cumY += rec.dy;
    if (cumX < minX) minX = cumX;
    if (cumX > maxX) maxX = cumX;
    if (cumY < minY) minY = cumY;
    if (cumY > maxY) maxY = cumY;

    if (rec.flag === 'stitch') stitches++;
    else if (rec.flag === 'jump') jumps++;
    else if (rec.flag === 'colorChange') colorChanges++;
  }

  return {
    stitches, jumps, colorChanges, hasEnd,
    maxDisp, overLimit,
    bounds: { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY },
  };
}

// Corrected DST decoder (balanced ternary) — same as dstEncoder.decodeDSTRecord
function decodeDSTStyle(b0, b1, b2) {
  const { dx, dy, flag } = decodeDSTRecord([b0, b1, b2]);
  return { dx, dy, flag };
}

// DSB signed-byte decoder (for reference file analysis only)
function decodeDSBStyle(b0, b1, b2) {
  let x = b0 > 127 ? b0 - 256 : b0;
  let y = b1 > 127 ? b1 - 256 : b1;
  let flag = 'stitch';
  if (b2 === 0xF3) flag = 'end';
  else if (b2 & 0x80) flag = 'jump';
  else if (b2 & 0x40) flag = 'colorChange';
  return { dx: x, dy: y, flag };
}

/**
 * Compares a functional Wilcom reference with a generated file.
 * Uses the corrected balanced-ternary DST decoder for analysis.
 */
export function compareToWilcomDSB(referenceBuffer, generatedBuffer) {
  const refBytes = new Uint8Array(referenceBuffer);
  const genBytes = new Uint8Array(generatedBuffer);

  const refHeader = parseHeaderFields(refBytes);
  const genHeader = parseHeaderFields(genBytes);

  const refHasEof = refBytes[refBytes.length - 1] === EOF_BYTE;
  const genHasEof = genBytes[genBytes.length - 1] === EOF_BYTE;
  const refDataEnd = refHasEof ? refBytes.length - 1 : refBytes.length;
  const genDataEnd = genHasEof ? genBytes.length - 1 : genBytes.length;
  const refRecordCount = Math.floor((refDataEnd - HEADER_SIZE) / RECORD_SIZE);
  const genRecordCount = Math.floor((genDataEnd - HEADER_SIZE) / RECORD_SIZE);
  const refTrailing = (refDataEnd - HEADER_SIZE) % RECORD_SIZE;
  const genTrailing = (genDataEnd - HEADER_SIZE) % RECORD_SIZE;

  // Decode both files with both encodings to detect style
  const refDST = analyzeRecords(refBytes, decodeDSTStyle);
  const refDSB = analyzeRecords(refBytes, decodeDSBStyle);
  const genDST = analyzeRecords(genBytes, decodeDSTStyle);

  // Detect reference encoding style
  const refIsDSTStyle = refDST.overLimit <= refDSB.overLimit;
  const refEncoding = refIsDSTStyle ? 'DST-balanced-ternary' : 'DSB-signed-byte';

  const differences = [];
  const rejectReasons = [];

  if (refBytes.length >= HEADER_SIZE && genBytes.length < HEADER_SIZE) {
    differences.push({ field: 'headerSize', message: 'Generado no tiene cabecera de 512 bytes' });
    rejectReasons.push('Cabecera incompleta');
  }

  if (refHeader && genHeader) {
    if (refHeader.ST === refRecordCount && genHeader.ST !== genRecordCount) {
      differences.push({ field: 'stMatch', message: `Referencia ST=${refHeader.ST} coincide; generado ST=${genHeader.ST} ≠ records=${genRecordCount}` });
      rejectReasons.push('ST del header no coincide con records reales');
    }
  }

  if (refHasEof && !genHasEof) {
    differences.push({ field: 'eofByte', message: 'Referencia tiene 0x1A, generado no' });
    rejectReasons.push('Falta byte final 0x1A');
  }

  if (refTrailing === 0 && genTrailing > 0) {
    differences.push({ field: 'trailing', message: `Generado tiene ${genTrailing} bytes sobrantes` });
    rejectReasons.push('Bytes sobrantes después del último record');
  }

  if (refDST.hasEnd && !genDST.hasEnd) {
    differences.push({ field: 'endCommand', message: 'Referencia tiene END, generado no' });
    rejectReasons.push('Falta comando END');
  }

  differences.push({ field: 'encodingStyle', message: `Referencia usa: ${refEncoding}` });

  if (refHeader && genHeader) {
    if (refHeader.plusX !== null && genHeader.plusX !== null) {
      if (Math.abs(refHeader.plusX - genHeader.plusX) > 500) {
        differences.push({ field: 'bounds', message: `Bounds difieren: ref +X=${refHeader.plusX} vs gen +X=${genHeader.plusX}` });
      }
    }
  }

  if (refDST.jumps === 0 && genDST.jumps > 0) {
    differences.push({ field: 'jumps', message: `Referencia sin jumps; generado tiene ${genDST.jumps} jumps` });
    rejectReasons.push('Generado tiene jumps que la referencia no tiene');
  }

  if (genDST.overLimit > 0) {
    differences.push({ field: 'overLimit', message: `${genDST.overLimit} movimientos >12.1mm en generado` });
    rejectReasons.push('Movimientos excesivos sin dividir');
  }

  console.log('[ce01-format-test] compareToWilcomDSB:');
  console.log('[ce01-format-test]   reference encoding:', refEncoding);
  console.log('[ce01-format-test]   reference records:', refRecordCount, 'ST:', refHeader?.ST);
  console.log('[ce01-format-test]   generated records:', genRecordCount, 'ST:', genHeader?.ST);
  console.log('[ce01-format-test]   differences:', differences.length);
  console.log('[ce01-format-test]   reject reasons:', rejectReasons.length);

  return {
    reference: {
      fileSize: refBytes.length,
      header: refHeader,
      recordCount: refRecordCount,
      hasEof: refHasEof,
      trailingBytes: refTrailing,
      encoding: refEncoding,
      analysis: refIsDSTStyle ? refDST : refDSB,
    },
    generated: {
      fileSize: genBytes.length,
      header: genHeader,
      recordCount: genRecordCount,
      hasEof: genHasEof,
      trailingBytes: genTrailing,
      analysis: genDST,
    },
    differences,
    rejectReasons,
    encodingMatch: refEncoding === 'DST-balanced-ternary',
  };
}