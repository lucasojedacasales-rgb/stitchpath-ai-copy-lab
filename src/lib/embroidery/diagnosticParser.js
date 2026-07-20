/**
 * diagnosticParser.js — Pure, dependency-free embroidery file parsing + risk
 * detection for the Engine V2 Diagnostic Lab.
 *
 * No external services. No engine modification. Read-only inspection.
 *
 * Supported inputs:
 *   - DST (Tajima ternary, 512-byte ASCII header + 3-byte records)
 *   - DSB (Barudan, 512-byte DST header + 3-byte ctrl/x/y records)
 *   - JSON physical plan / validation report (structural summary)
 *
 * All coordinates are returned in millimetres. DST/DSB record a step of 0.1 mm.
 */

const UNIT_MM = 0.1; // one step == 0.1 mm for both DST and DSB
export const DIAGNOSTIC_PARSER_VERSION = '2.2.0';
export const DIAGNOSTIC_PARSER_CONFIG = Object.freeze({
  jumpLimitMm: 5,
  jumpToleranceMm: 0.01,
  stitchLimitMm: 7,
  coverageGridMm: 0.5,
  highOccupancyRatio: 0.6,
  lateCoverageRatio: 0.6,
  envelopeToleranceMm: 0.5,
});

// ---------------------------------------------------------------------------
// Header parsing (shared by DST / DSB — both use the Tajima-style 512 ASCII hdr)
// ---------------------------------------------------------------------------

function readAscii(bytes, start, end) {
  let s = '';
  for (let i = start; i < end && i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function parseHeaderField(headerText, prefix) {
  const idx = headerText.indexOf(prefix + ':');
  if (idx < 0) return null;
  let end = headerText.indexOf('\r', idx);
  if (end < 0) end = headerText.indexOf('\n', idx);
  if (end < 0) end = headerText.length;
  const raw = headerText.slice(idx + prefix.length + 1, end).trim();
  return raw;
}

function parseTajimaHeader(bytes) {
  const headerText = readAscii(bytes, 0, 512);
  const num = (p) => {
    const v = parseHeaderField(headerText, p);
    if (v == null) return null;
    const n = parseInt(v.replace(/\s+/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  };
  const signed = (p) => {
    const v = parseHeaderField(headerText, p);
    if (v == null) return null;
    const n = parseInt(v.replace(/\s+/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  };
  const label = parseHeaderField(headerText, 'LA');
  const plusX = num('+X');
  const minusX = num('-X');
  const plusY = num('+Y');
  const minusY = num('-Y');
  const ax = signed('AX');
  const ay = signed('AY');
  const declaredDims = (plusX != null && minusX != null && plusY != null && minusY != null)
    ? { w: (plusX + minusX) * UNIT_MM, h: (plusY + minusY) * UNIT_MM }
    : null;
  return {
    label: label || null,
    declaredStitchCount: num('ST'),
    declaredColorCount: num('CO'),
    extents: { plusX, minusX, plusY, minusY },
    declaredDimensions: declaredDims,
    endPoint: (ax != null && ay != null) ? { x: ax * UNIT_MM, y: ay * UNIT_MM } : null,
    headerLength: 512,
  };
}

// ---------------------------------------------------------------------------
// DST decoding
// ---------------------------------------------------------------------------

function decodeDstRecord(b0, b1, b2) {
  let dx = 0, dy = 0;
  // byte 1 (b0)
  if (b0 & 0x80) dy += 1;
  if (b0 & 0x40) dy -= 1;
  if (b0 & 0x20) dy += 9;
  if (b0 & 0x10) dy -= 9;
  if (b0 & 0x08) dx -= 9;
  if (b0 & 0x04) dx += 9;
  if (b0 & 0x02) dx -= 1;
  if (b0 & 0x01) dx += 1;
  // byte 2 (b1)
  if (b1 & 0x80) dy += 3;
  if (b1 & 0x40) dy -= 3;
  if (b1 & 0x20) dy += 27;
  if (b1 & 0x10) dy -= 27;
  if (b1 & 0x08) dx -= 27;
  if (b1 & 0x04) dx += 27;
  if (b1 & 0x02) dx -= 3;
  if (b1 & 0x01) dx += 3;
  // byte 3 (b2) movement bits
  if (b2 & 0x20) dy += 81;
  if (b2 & 0x10) dy -= 81;
  if (b2 & 0x08) dx -= 81;
  if (b2 & 0x04) dx += 81;
  return { dx, dy };
}

function parseDST(bytes) {
  const header = parseTajimaHeader(bytes);
  const errors = [];
  const warnings = [];
  if (bytes.length < 512) {
    errors.push('Archivo DST truncado: menor que la cabecera de 512 bytes.');
  }

  const xs = [];
  const ys = [];
  const types = []; // 0=stitch 1=jump 2=color 3=trim 4=sequin 5=end
  const blocks = [];
  let x = 0, y = 0;
  let colorIndex = 0;
  let blockStart = 0;
  let endFound = false;
  let recordsAfterEnd = 0;
  let stitchCount = 0;
  let jumpCount = 0;
  let colorChangeCount = 0;
  let trimCount = 0;
  let sequinCount = 0;
  let recordsTotal = 0;

  const start = Math.min(512, bytes.length);
  for (let i = start; i + 2 < bytes.length; i += 3) {
    recordsTotal++;
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    if (endFound) {
      recordsAfterEnd++;
      continue;
    }

    // END: 0xF3 (or Wilcom end marker b0 === 0x1A with no movement)
    if (b2 === 0xF3 || (b0 === 0x1A && b1 === 0x00 && (b2 & 0xC0) === 0xC0)) {
      endFound = true;
      xs.push(x); ys.push(y); types.push(5);
      continue;
    }

    const { dx, dy } = decodeDstRecord(b0, b1, b2);
    const c0 = (b2 & 0x80) !== 0;
    const c1 = (b2 & 0x40) !== 0;

    let type;
    if (c0 && c1) {
      // Color change / stop
      colorChangeCount++;
      type = 2;
      // close current block
      if (stitchCount + jumpCount > blockStart) {
        blocks.push({ start: blockStart, end: xs.length, colorIndex });
      }
      colorIndex++;
      blockStart = xs.length + 1;
      // color change typically has zero movement, but apply if present
      x += dx * UNIT_MM; y += dy * UNIT_MM;
    } else if (c0 && !c1) {
      // Jump
      jumpCount++;
      type = 1;
      x += dx * UNIT_MM; y += dy * UNIT_MM;
    } else if (!c0 && c1) {
      // Sequin
      sequinCount++;
      type = 4;
      x += dx * UNIT_MM; y += dy * UNIT_MM;
    } else {
      // Normal stitch
      stitchCount++;
      type = 0;
      x += dx * UNIT_MM; y += dy * UNIT_MM;
    }
    xs.push(x); ys.push(y); types.push(type);
  }

  if (!endFound) {
    warnings.push('No se encontró el registro END (0xF3) en el archivo.');
  }
  if (recordsAfterEnd > 0) {
    errors.push(`Se encontraron ${recordsAfterEnd} registros después del END (ignorados, marcados como error estructural).`);
  }

  // close final block
  if (xs.length > blockStart) {
    blocks.push({ start: blockStart, end: xs.length, colorIndex });
  }

  return {
    format: 'DST',
    header,
    geometry: { xs: Float32Array.from(xs), ys: Float32Array.from(ys), types: Uint8Array.from(types), count: xs.length },
    blocks,
    summary: {
      stitchCount, jumpCount, colorChangeCount, trimCount, sequinCount,
      endFound, recordsAfterEnd, recordsTotal,
    },
    errors, warnings,
  };
}

// ---------------------------------------------------------------------------
// DSB decoding (Barudan)
// ---------------------------------------------------------------------------

function parseDSB(bytes) {
  const header = parseTajimaHeader(bytes);
  const errors = [];
  const warnings = [];
  if (bytes.length < 512) {
    errors.push('Archivo DSB truncado: menor que la cabecera de 512 bytes.');
  }

  const xs = [];
  const ys = [];
  const types = [];
  const blocks = [];
  let x = 0, y = 0;
  let colorIndex = 0;
  let blockStart = 0;
  let endFound = false;
  let recordsAfterEnd = 0;
  let stitchCount = 0, jumpCount = 0, colorChangeCount = 0, trimCount = 0, sequinCount = 0;
  let recordsTotal = 0;

  const start = Math.min(512, bytes.length);
  for (let i = start; i + 2 < bytes.length; i += 3) {
    recordsTotal++;
    const ctrl = bytes[i];
    const by = bytes[i + 1];
    const bx = bytes[i + 2];

    if (endFound) {
      recordsAfterEnd++;
      continue;
    }

    if (ctrl === 0xF8) {
      endFound = true;
      xs.push(x); ys.push(y); types.push(5);
      continue;
    }

    let dy = -by;
    let dx = bx;
    if (ctrl & 0x40) dy = -dy;
    if (ctrl & 0x20) dx = -dx;
    dx *= UNIT_MM;
    dy *= UNIT_MM;

    const low = ctrl & 0x1F;
    let type;
    if (ctrl === 0xE7) {
      // trim
      trimCount++;
      type = 3;
      // trims typically no movement; apply 0
    } else if (ctrl === 0xE8) {
      // stop / color change
      colorChangeCount++;
      type = 2;
      if (stitchCount + jumpCount > blockStart) {
        blocks.push({ start: blockStart, end: xs.length, colorIndex });
      }
      colorIndex++;
      blockStart = xs.length + 1;
      x += dx; y += dy;
    } else if (ctrl >= 0xE9 && ctrl < 0xF8) {
      // needle change (color change to a specific needle)
      colorChangeCount++;
      type = 2;
      if (stitchCount + jumpCount > blockStart) {
        blocks.push({ start: blockStart, end: xs.length, colorIndex });
      }
      colorIndex++;
      blockStart = xs.length + 1;
      x += dx; y += dy;
    } else if (low === 0) {
      // normal stitch
      stitchCount++;
      type = 0;
      x += dx; y += dy;
    } else if (low === 1) {
      // jump / move
      jumpCount++;
      type = 1;
      x += dx; y += dy;
    } else {
      // uncaught control → treat as terminator
      endFound = true;
      warnings.push(`Registro DSB con control no reconocido 0x${ctrl.toString(16).padStart(2, '0')} en el offset ${i}.`);
      xs.push(x); ys.push(y); types.push(5);
      continue;
    }
    xs.push(x); ys.push(y); types.push(type);
  }

  if (!endFound) {
    warnings.push('No se encontró el registro END (0xF8) en el archivo DSB.');
  }
  if (recordsAfterEnd > 0) {
    errors.push(`Se encontraron ${recordsAfterEnd} registros después del END (ignorados, marcados como error estructural).`);
  }
  if (xs.length > blockStart) {
    blocks.push({ start: blockStart, end: xs.length, colorIndex });
  }

  return {
    format: 'DSB',
    header,
    geometry: { xs: Float32Array.from(xs), ys: Float32Array.from(ys), types: Uint8Array.from(types), count: xs.length },
    blocks,
    summary: {
      stitchCount, jumpCount, colorChangeCount, trimCount, sequinCount,
      endFound, recordsAfterEnd, recordsTotal,
    },
    errors, warnings,
  };
}

// ---------------------------------------------------------------------------
// JSON inspection (physical plan / validation report)
// ---------------------------------------------------------------------------

function inspectJson(value, depth = 0) {
  if (depth > 4) return { type: 'truncated' };
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array', length: value.length,
      sample: value.slice(0, 3).map((v) => inspectJson(v, depth + 1)),
    };
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    const children = {};
    for (const k of keys.slice(0, 40)) {
      children[k] = inspectJson(value[k], depth + 1);
    }
    return { type: 'object', keyCount: keys.length, keys: keys.slice(0, 40), children };
  }
  return { type: typeof value, value };
}

function parseJsonFile(bytes, name) {
  const errors = [];
  const warnings = [];
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (e) {
    errors.push('No se pudo decodificar el JSON como UTF-8.');
    return { format: 'JSON', header: null, geometry: null, summary: {}, errors, warnings, json: null };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    errors.push('JSON inválido: ' + e.message);
    return { format: 'JSON', header: null, geometry: null, summary: {}, errors, warnings, json: null };
  }
  const inspection = inspectJson(value);
  const isPlan = !!(value && (value.blocks || value.stitches || value.plan || value.layers));
  const isValidation = !!(value && (value.passed !== undefined || value.errors || value.warnings || value.validations));
  let planSummary = null;
  if (isPlan && Array.isArray(value.blocks)) {
    planSummary = { blockCount: value.blocks.length };
  }
  let validationSummary = null;
  if (isValidation) {
    validationSummary = {
      passed: value.passed,
      errorCount: Array.isArray(value.errors) ? value.errors.length : 0,
      warningCount: Array.isArray(value.warnings) ? value.warnings.length : 0,
    };
  }
  return {
    format: 'JSON',
    kind: isPlan ? 'physical_plan' : isValidation ? 'validation' : 'generic',
    header: null,
    geometry: null,
    summary: { kind: isPlan ? 'physical_plan' : isValidation ? 'validation' : 'generic' },
    planSummary,
    validationSummary,
    json: inspection,
    errors, warnings,
  };
}

// ---------------------------------------------------------------------------
// Extents + risks
// ---------------------------------------------------------------------------

function computeExtents(geom) {
  if (!geom || geom.count === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < geom.count; i++) {
    const x = geom.xs[i], y = geom.ys[i];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function normalizeDstOrientation(parsed) {
  const geom = parsed.geometry;
  const declared = parsed.header?.declaredDimensions;
  const measured = computeExtents(geom);
  if (!geom || !declared || !measured || measured.w === measured.h) return { parsed, axisSwapApplied: false };
  const directError = Math.abs(measured.w - declared.w) + Math.abs(measured.h - declared.h);
  const swappedError = Math.abs(measured.h - declared.w) + Math.abs(measured.w - declared.h);
  if (swappedError + 0.1 >= directError) return { parsed, axisSwapApplied: false };
  const geometry = { ...geom, xs: Float32Array.from(geom.ys), ys: Float32Array.from(geom.xs) };
  return { parsed: { ...parsed, geometry }, axisSwapApplied: true };
}

function detectRisks(parsed, coverage) {
  const risks = [];
  const geom = parsed.geometry;
  if (!geom || geom.count < 2) return risks;

  const JUMP_LIMIT_MM = DIAGNOSTIC_PARSER_CONFIG.jumpLimitMm;
  const JUMP_TOLERANCE_MM = DIAGNOSTIC_PARSER_CONFIG.jumpToleranceMm;
  const STITCH_LIMIT_MM = DIAGNOSTIC_PARSER_CONFIG.stitchLimitMm;
  const ZERO_LEN = 0;
  const REPEAT_LIMIT = 4;
  const DENSITY_LIMIT = 60; // penetrations per mm² cell flagged

  let jumpsOver5 = 0; let maxJump = 0; let maxJumpSample = null;
  let stitchesOver7 = 0; let maxStitch = 0; let maxStitchSample = null;
  let zeroLength = 0;
  let repeatRuns = 0; let maxRepeat = 0;
  let disconnected = 0;
  let repeatCount = 1;

  const { xs, ys, types } = geom;

  for (let i = 1; i < geom.count; i++) {
    const ax = xs[i - 1], ay = ys[i - 1];
    const bx = xs[i], by = ys[i];
    const t = types[i];
    const d = dist(ax, ay, bx, by);

    if (t === 1) {
      // jump
      if (d > JUMP_LIMIT_MM + JUMP_TOLERANCE_MM) {
        jumpsOver5++;
        if (d > maxJump) { maxJump = d; maxJumpSample = { from: { x: ax, y: ay }, to: { x: bx, y: by }, idx: i }; }
      }
    } else if (t === 0) {
      // stitch segment
      if (d > STITCH_LIMIT_MM) {
        stitchesOver7++;
        if (d > maxStitch) { maxStitch = d; maxStitchSample = { from: { x: ax, y: ay }, to: { x: bx, y: by }, idx: i }; }
      }
      if (d === ZERO_LEN) zeroLength++;
      // repeat detection: same absolute point consecutively
      if (bx === ax && by === ay) {
        repeatCount++;
        if (repeatCount >= REPEAT_LIMIT) {
          repeatRuns++;
          if (repeatCount > maxRepeat) maxRepeat = repeatCount;
        }
      } else {
        repeatCount = 1;
      }
    } else if (t === 2) {
      // color change: connection between disconnected regions if followed by far stitches
      disconnected++;
    }
  }

  if (jumpsOver5 > 0) {
    risks.push({
      level: 'high', code: 'JUMP_GT_5MM',
      message: `${jumpsOver5} saltos materialmente superiores a ${JUMP_LIMIT_MM} mm (tolerancia ${JUMP_TOLERANCE_MM.toFixed(2)} mm; máx ${maxJump.toFixed(3)} mm).`,
      count: jumpsOver5, max: maxJump, limit: JUMP_LIMIT_MM, tolerance: JUMP_TOLERANCE_MM, sample: maxJumpSample,
    });
  }
  if (stitchesOver7 > 0) {
    risks.push({
      level: 'high', code: 'STITCH_GT_7MM',
      message: `${stitchesOver7} movimientos cosidos superiores a ${STITCH_LIMIT_MM} mm (máx ${maxStitch.toFixed(2)} mm).`,
      count: stitchesOver7, max: maxStitch, sample: maxStitchSample,
    });
  }
  if (zeroLength > 0) {
    risks.push({
      level: 'medium', code: 'ZERO_LENGTH_STITCH',
      message: `${zeroLength} puntadas de longitud cero detectadas.`,
      count: zeroLength,
    });
  }
  if (repeatRuns > 0) {
    risks.push({
      level: 'medium', code: 'POINT_REPEAT',
      message: `Repetición excesiva de un mismo punto (runs ≥ ${REPEAT_LIMIT}): ${repeatRuns}, máxima repetición ${maxRepeat}.`,
      count: repeatRuns, max: maxRepeat,
    });
  }
  if (disconnected > 0) {
    risks.push({
      level: 'low', code: 'DISCONNECTED_REGIONS',
      message: `${disconnected} conexiones entre regiones (cambios de color / paradas) detectadas.`,
      count: disconnected,
    });
  }

  // High concentration of penetrations (1 mm grid)
  const cellMap = new Map();
  for (let i = 0; i < geom.count; i++) {
    if (types[i] !== 0) continue;
    const cx = Math.floor(xs[i]);
    const cy = Math.floor(ys[i]);
    const key = cx + ',' + cy;
    cellMap.set(key, (cellMap.get(key) || 0) + 1);
  }
  let hotCells = 0; let maxCell = 0; let hotSample = null;
  for (const [key, c] of cellMap) {
    if (c > maxCell) { maxCell = c; hotSample = key; }
    if (c >= DENSITY_LIMIT) hotCells++;
  }
  if (hotCells > 0) {
    risks.push({
      level: 'medium', code: 'HIGH_DENSITY',
      message: `${hotCells} celdas de 1 mm² con concentración ≥ ${DENSITY_LIMIT} penetraciones (máx ${maxCell} en ${hotSample}).`,
      count: hotCells, max: maxCell,
    });
  }

  if (coverage?.highOccupancy.length > 0) {
    risks.push({
      level: 'low', code: 'HIGH_BLOCK_OCCUPANCY',
      message: `${coverage.highOccupancy.length} bloque(s) presentan ocupación cosida alta; por sí sola no implica que cubran capas anteriores.`,
      count: coverage.highOccupancy.length,
      samples: coverage.highOccupancy.slice(0, 5),
    });
  }
  if (coverage?.suspects.length > 0) {
    risks.push({
      level: 'medium', code: 'LAYER_COVERAGE',
      message: `${coverage.suspects.length} bloque(s) tardíos cubren más del 60% de la unión cosida aproximada de bloques anteriores.`,
      count: coverage.suspects.length,
      samples: coverage.suspects.slice(0, 5),
    });
  }

  // Movements outside declared envelope
  if (parsed.header && parsed.header.extents) {
    const ex = parsed.header.extents;
    if (ex.plusX != null && ex.minusX != null && ex.plusY != null && ex.minusY != null) {
      const loX = -ex.minusX * UNIT_MM;
      const hiX = ex.plusX * UNIT_MM;
      const loY = -ex.minusY * UNIT_MM;
      const hiY = ex.plusY * UNIT_MM;
      let outOfBounds = 0; let outSample = null;
      for (let i = 0; i < geom.count; i++) {
        const xx = xs[i], yy = ys[i];
        const tolerance = DIAGNOSTIC_PARSER_CONFIG.envelopeToleranceMm;
        if (xx < loX - tolerance || xx > hiX + tolerance || yy < loY - tolerance || yy > hiY + tolerance) {
          outOfBounds++;
          if (!outSample) outSample = { x: xx, y: yy, idx: i };
        }
      }
      if (outOfBounds > 0) {
        risks.push({
          level: 'high', code: 'OUTSIDE_ENVELOPE',
          message: `${outOfBounds} punto(s) fuera de la envolvente declarada en cabecera.`,
          count: outOfBounds, sample: outSample,
        });
      }
    }
  }

  return risks;
}

// ---------------------------------------------------------------------------
// Long jumps + coverage blocks (used by the exportable diagnostic report)
// ---------------------------------------------------------------------------

function computeLongJumps(geom) {
  if (!geom || geom.count < 2) return [];
  const { xs, ys, types } = geom;
  const out = [];
  for (let i = 1; i < geom.count; i++) {
    if (types[i] !== 1) continue;
    const d = dist(xs[i - 1], ys[i - 1], xs[i], ys[i]);
    if (d > 5) out.push({ idx: i, from: { x: xs[i - 1], y: ys[i - 1] }, to: { x: xs[i], y: ys[i] }, distance: +d.toFixed(3) });
  }
  return out.sort((a, b) => b.distance - a.distance).slice(0, 50);
}

function rasterizeBlock(geom, block, gridMm) {
  const cells = new Set();
  const { xs, ys, types } = geom;
  for (let i = block.start; i < block.end && i < geom.count; i++) {
    if (types[i] !== 0) continue;
    const ax = i > 0 ? xs[i - 1] : xs[i];
    const ay = i > 0 ? ys[i - 1] : ys[i];
    const bx = xs[i], by = ys[i];
    const steps = Math.max(1, Math.ceil(dist(ax, ay, bx, by) / (gridMm / 2)));
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      cells.add(`${Math.floor(x / gridMm)},${Math.floor(y / gridMm)}`);
    }
  }
  return cells;
}

function computeCoverageBlocks(parsed) {
  const geom = parsed.geometry;
  const blocks = parsed.blocks || [];
  if (!geom || geom.count === 0 || blocks.length === 0) return { blocks: [], suspects: [], highOccupancy: [] };
  const gridMm = DIAGNOSTIC_PARSER_CONFIG.coverageGridMm;
  const cellSets = blocks.map((block) => rasterizeBlock(geom, block, gridMm));
  const allCells = new Set(cellSets.flatMap((cells) => Array.from(cells)));
  const previousUnion = new Set();
  const infos = [];
  const suspects = [];
  const highOccupancy = [];
  for (let i = 0; i < blocks.length; i++) {
    const cells = cellSets[i];
    let overlap = 0;
    for (const cell of cells) if (previousUnion.has(cell)) overlap++;
    const occupancyRatio = allCells.size ? cells.size / allCells.size : 0;
    const previousCoverageRatio = previousUnion.size ? overlap / previousUnion.size : 0;
    const info = {
      index: i,
      colorIndex: blocks[i].colorIndex,
      points: blocks[i].end - blocks[i].start,
      occupiedCells: cells.size,
      occupiedAreaMm2: +(cells.size * gridMm * gridMm).toFixed(3),
      occupancyRatio: +occupancyRatio.toFixed(4),
      previousUnionCells: previousUnion.size,
      previousCoverageRatio: +previousCoverageRatio.toFixed(4),
    };
    infos.push(info);
    if (occupancyRatio > DIAGNOSTIC_PARSER_CONFIG.highOccupancyRatio) highOccupancy.push(info);
    if (blocks.length >= 2 && i > 0 && previousUnion.size > 0 && previousCoverageRatio > DIAGNOSTIC_PARSER_CONFIG.lateCoverageRatio) {
      suspects.push({ ...info, reasons: ['LATE_BLOCK_GT_60'] });
    }
    for (const cell of cells) previousUnion.add(cell);
  }
  return { blocks: infos, suspects, highOccupancy };
}

// ---------------------------------------------------------------------------
// Main entry: analyzeFile
// ---------------------------------------------------------------------------

export function detectFormat(name, bytes) {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.dst')) return 'dst';
  if (lower.endsWith('.dsb')) return 'dsb';
  if (lower.endsWith('.json')) return 'json';
  // heuristic on content
  if (bytes.length >= 512) {
    const head = readAscii(bytes, 0, Math.min(3, bytes.length));
    if (head.startsWith('LA') || head.includes(':')) return 'dst';
  }
  return 'json';
}

export function analyzeFile({ name, bytes, sha256 }) {
  const format = detectFormat(name, bytes);
  let parsed;
  let axisSwapApplied = false;
  if (format === 'dst') {
    const normalized = normalizeDstOrientation(parseDST(bytes));
    parsed = normalized.parsed;
    axisSwapApplied = normalized.axisSwapApplied;
  } else if (format === 'dsb') parsed = parseDSB(bytes);
  else parsed = parseJsonFile(bytes, name);

  const geom = parsed.geometry;
  const extents = computeExtents(geom);
  const finalPosition = geom && geom.count > 0
    ? { x: geom.xs[geom.count - 1], y: geom.ys[geom.count - 1] }
    : null;
  const longJumps = computeLongJumps(geom);
  const coverage = computeCoverageBlocks({ ...parsed, blocks: parsed.blocks });
  const risks = detectRisks({ ...parsed, blocks: parsed.blocks }, coverage);

  return {
    meta: { name, format: parsed.format, sizeBytes: bytes.length, sha256 },
    header: parsed.header,
    geometry: geom,
    summary: {
      ...parsed.summary,
      finalPosition,
      extents,
    },
    blocks: parsed.blocks || [],
    risks,
    longJumps,
    coverageBlocks: coverage.blocks,
    suspectBlocks: coverage.suspects,
    json: parsed.json || null,
    planSummary: parsed.planSummary || null,
    validationSummary: parsed.validationSummary || null,
    errors: parsed.errors || [],
    warnings: parsed.warnings || [],
    parser: { version: DIAGNOSTIC_PARSER_VERSION, config: { ...DIAGNOSTIC_PARSER_CONFIG }, axisSwapApplied },
    analysisDate: new Date().toISOString(),
  };
}

export async function sha256Of(bytes) {
  // Use Web Crypto if available (workers + main thread).
  const cryptoObj = (typeof self !== 'undefined' && self.crypto) ? self.crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  if (cryptoObj && cryptoObj.subtle) {
    const buf = await cryptoObj.subtle.digest('SHA-256', bytes.buffer ? bytes.buffer : bytes);
    const arr = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
    return hex;
  }
  // Fallback: simple non-crypto hash (should not normally trigger in a browser).
  let h = 0;
  for (let i = 0; i < bytes.length; i++) h = (Math.imul(31, h) + bytes[i]) | 0;
  return 'f' + (h >>> 0).toString(16).padStart(8, '0') + 'x' + bytes.length.toString(16);
}