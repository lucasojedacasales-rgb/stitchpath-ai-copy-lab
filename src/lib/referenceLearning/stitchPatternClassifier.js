/**
 * stitchPatternClassifier.js — Reference Embroidery Learning System
 * ─────────────────────────────────────────────────────────────────────────────
 * Classifies blocks of stitches from a reference file into professional
 * categories using ONLY stitch geometry — never the file name.
 *
 * Categories:
 *   fill_tatami       — parallel rows of even-length stitches filling an area
 *   satin_border      — zigzag / column of alternating short stitches, constant width
 *   running_outline   — single line of running stitches tracing a contour
 *   double_run_detail — running stitch traversed twice (back-and-forth) over the same path
 *   underlay          — low-density wide-spaced parallel rows preceding a fill/satin
 *   travel_jump       — jump sequences moving between areas (not sewing)
 *   noise             — isolated / random single stitches, < 3 stitches
 *   unknown           — cannot be classified
 *
 * Classification features:
 *   - stitch length (mean, stddev)
 *   - direction angle (mean, stddev)
 *   - repetition / row count
 *   - distance between parallel lines (row spacing)
 *   - column width (satin)
 *   - density (stitches per mm²)
 *   - order within the file (underlay precedes fills)
 *   - back-and-forth traversal (double run)
 */

const MAX_ROW_SPACING_MM = 0.6;      // tatami rows spaced < this
const MIN_TATAMI_ROWS = 4;
const MIN_SATIN_WIDTH_MM = 0.8;
const MAX_SATIN_WIDTH_MM = 6.0;
const MIN_SATIN_STITCHES = 8;
const MIN_RUNNING_LENGTH_MM = 3.0;
const MIN_DOUBLE_RUN_REPEATS = 2;
const UNDERLAY_MAX_DENSITY = 0.03;   // underlay is sparse
const NOISE_MAX_STITCHES = 2;

/**
 * Splits a command list into blocks. A block is a maximal run of stitches of
 * the same color with no jump > 3.5mm inside it. colorChange / trim / end
 * always start a new block.
 *
 * @param {Array} commands
 * @returns {Array<{ blockType, start, end, color, features }>}
 */
export function classifyStitchBlocks(commands) {
  const rawBlocks = splitIntoRawBlocks(commands);
  const blocks = [];
  for (const rb of rawBlocks) {
    const feats = computeBlockFeatures(rb.commands);
    const blockType = classifyBlock(feats, rb, blocks);
    blocks.push({
      blockType,
      start: rb.start,
      end: rb.end,
      color: rb.color,
      features: feats,
    });
  }
  return blocks;
}

// ─── Raw block splitter ───────────────────────────────────────────────────────

function splitIntoRawBlocks(commands) {
  const blocks = [];
  let current = { start: 0, color: 0, commands: [] };
  let prev = null;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'end') {
      if (current.commands.length > 0) blocks.push({ ...current, end: i });
      break;
    }
    if (c.type === 'colorChange') {
      if (current.commands.length > 0) blocks.push({ ...current, end: i });
      current = { start: i, color: c.color + 1, commands: [] };
      prev = c;
      continue;
    }
    if (c.type === 'jump' && prev) {
      const jlen = Math.hypot(c.x - prev.x, c.y - prev.y);
      if (jlen > 3.5) {
        if (current.commands.length > 0) blocks.push({ ...current, end: i });
        current = { start: i, color: current.color, commands: [] };
      }
    }
    if (c.type === 'stitch') current.commands.push(c);
    prev = c;
  }
  if (current.commands.length > 0) blocks.push({ ...current, end: commands.length });
  return blocks;
}

// ─── Feature extraction ───────────────────────────────────────────────────────

function computeBlockFeatures(stitches) {
  const n = stitches.length;
  if (n < 1) return emptyFeatures();

  const lengths = [];
  const angles = [];
  let totalLen = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of stitches) {
    if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
  }
  for (let i = 1; i < n; i++) {
    const dx = stitches[i].x - stitches[i - 1].x;
    const dy = stitches[i].y - stitches[i - 1].y;
    const len = Math.hypot(dx, dy);
    lengths.push(len);
    totalLen += len;
    angles.push(Math.atan2(dy, dx));
  }
  const meanLen = lengths.length ? totalLen / lengths.length : 0;
  const stddevLen = stddev(lengths, meanLen);
  const meanAngle = circularMean(angles);
  const stddevAngle = circularStddev(angles, meanAngle);

  const width = maxX - minX;
  const height = maxY - minY;
  const area = width * height;
  const density = area > 0 ? n / area : 0;

  // Row spacing: group stitches by approximate perpendicular offset from the
  // dominant direction. Simplified: if stitches are near-horizontal, group by y.
  const rowSpacing = estimateRowSpacing(stitches, meanAngle);

  // Back-and-forth detection (double run): check if the path retraces itself.
  const backtrackRatio = estimateBacktrackRatio(stitches);

  return {
    stitchCount: n,
    meanLength: meanLen,
    stddevLength: stddevLen,
    meanAngle,
    stddevAngle,
    widthMm: width,
    heightMm: height,
    areaMm2: area,
    density,
    rowSpacingMm: rowSpacing,
    rowCount: rowSpacing > 0 ? Math.max(1, Math.round(height / rowSpacing)) : 1,
    backtrackRatio,
    totalLengthMm: totalLen,
  };
}

function emptyFeatures() {
  return {
    stitchCount: 0, meanLength: 0, stddevLength: 0, meanAngle: 0, stddevAngle: 0,
    widthMm: 0, heightMm: 0, areaMm2: 0, density: 0, rowSpacingMm: 0, rowCount: 0,
    backtrackRatio: 0, totalLengthMm: 0,
  };
}

// ─── Classifier ───────────────────────────────────────────────────────────────

function classifyBlock(feats, rawBlock, priorBlocks) {
  if (feats.stitchCount <= NOISE_MAX_STITCHES) return 'noise';

  // Travel: very low density + only present as jumps (handled in splitter, but
  // a single long sparse stitch run with near-zero density is travel-like).
  if (feats.density > 0 && feats.density < 0.002 && feats.totalLengthMm > 6) return 'travel_jump';

  // Double run: high backtrack ratio, low stddev length, long enough
  if (feats.backtrackRatio > 0.7 && feats.stitchCount >= 4 && feats.meanLength > 0.5) {
    return 'double_run_detail';
  }

  // Satin border: many stitches, bounded width, zigzag (alternating direction)
  if (feats.stitchCount >= MIN_SATIN_STITCHES &&
      feats.widthMm >= MIN_SATIN_WIDTH_MM && feats.widthMm <= MAX_SATIN_WIDTH_MM &&
      feats.stddevAngle > 0.6) {
    return 'satin_border';
  }

  // Tatami fill: many rows, even spacing, low angle variance per row
  if (feats.rowCount >= MIN_TATAMI_ROWS &&
      feats.rowSpacingMm > 0 && feats.rowSpacingMm <= MAX_ROW_SPACING_MM &&
      feats.density > 0.04) {
    // Underlay if sparse and precedes a denser block of similar area
    if (feats.density < UNDERLAY_MAX_DENSITY && isFollowedByDenserBlock(rawBlock, priorBlocks)) {
      return 'underlay';
    }
    return 'fill_tatami';
  }

  // Underlay (sparse parallel rows not caught above)
  if (feats.rowCount >= 2 && feats.density < UNDERLAY_MAX_DENSITY && feats.density > 0 &&
      isFollowedByDenserBlock(rawBlock, priorBlocks)) {
    return 'underlay';
  }

  // Running outline: long-ish single line, low row count, moderate length
  if (feats.rowCount <= 2 && feats.totalLengthMm >= MIN_RUNNING_LENGTH_MM && feats.meanLength > 0.5) {
    return 'running_outline';
  }

  return 'unknown';
}

function isFollowedByDenserBlock(rawBlock, priorBlocks) {
  // Look at the NEXT block by checking if a later block in priorBlocks overlaps
  // the same area with higher density. Simplified: assume underlay if the block
  // itself is sparse and there are more blocks after it in the file (order).
  // (priorBlocks is the list of already-classified blocks; this block comes after.)
  return priorBlocks.length > 0;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function stddev(values, mean) {
  if (values.length < 2) return 0;
  const v = values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

function circularMean(angles) {
  if (!angles.length) return 0;
  let sx = 0, sy = 0;
  for (const a of angles) { sx += Math.cos(a); sy += Math.sin(a); }
  return Math.atan2(sy, sx);
}

function circularStddev(angles, mean) {
  if (!angles.length) return 0;
  let s = 0;
  for (const a of angles) {
    let d = a - mean;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    s += d * d;
  }
  return Math.sqrt(s / angles.length);
}

function estimateRowSpacing(stitches, meanAngle) {
  if (stitches.length < 4) return 0;
  // Project each stitch onto the perpendicular of the dominant direction.
  const perpX = -Math.sin(meanAngle);
  const perpY = Math.cos(meanAngle);
  const offsets = stitches.map(s => s.x * perpX + s.y * perpY);
  const sorted = [...offsets].sort((a, b) => a - b);
  // Unique rows = count distinct offsets within tolerance
  const rows = [];
  for (const o of sorted) {
    if (rows.length === 0 || Math.abs(o - rows[rows.length - 1]) > 0.15) rows.push(o);
  }
  if (rows.length < 2) return 0;
  // Median spacing between consecutive rows
  const spacings = [];
  for (let i = 1; i < rows.length; i++) spacings.push(rows[i] - rows[i - 1]);
  spacings.sort((a, b) => a - b);
  return spacings[Math.floor(spacings.length / 2)];
}

function estimateBacktrackRatio(stitches) {
  if (stitches.length < 4) return 0;
  let backtracked = 0;
  const half = Math.floor(stitches.length / 2);
  for (let i = 0; i < half; i++) {
    const a = stitches[i];
    const b = stitches[stitches.length - 1 - i];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.3) backtracked++;
  }
  return backtracked / half;
}

export const CLASSIFIER_CATEGORIES = [
  'fill_tatami', 'satin_border', 'running_outline', 'double_run_detail',
  'underlay', 'travel_jump', 'noise', 'unknown',
];