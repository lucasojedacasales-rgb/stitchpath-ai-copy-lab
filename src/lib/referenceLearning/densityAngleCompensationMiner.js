/**
 * densityAngleCompensationMiner.js — Reference Learning Engine v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts professional rules for three generation parameters that the motor
 * must apply automatically in future digitizations (Professional Mode only):
 *
 *   • FILL DENSITY  — tatami row spacing (mm) derived from fill_tatami blocks.
 *   • FILL ANGLE    — dominant fill direction (degrees) from fill_tatami blocks.
 *   • SATIN COLUMN SPACING — satin border density (mm) from satin_border blocks.
 *   • PULL COMPENSATION    — satin width expansion (mm) estimated from satin width.
 *
 * Derivation (from technical blocks produced by blockClassifier):
 *   rowSpacingMm  = areaMm2 / (stitchCount * averageStitchLength)
 *   columnSpacingMm = areaMm2 / (stitchCount * averageStitchLength)  (satin blocks)
 *   pullCompensationMm = clamp(0.12 * satinWidthMm, 0.08, 0.40)
 *
 * Read-only: produces rules + a summary. Application to the motor happens in
 * applyLearnedProfileToMotor (gated by Professional Mode).
 */

const FILL_DENSITY_RANGE = { min: 0.30, max: 0.60 };
const SATIN_SPACING_RANGE = { min: 0.30, max: 0.55 };
const PULL_COMP_RANGE = { min: 0.08, max: 0.40 };

/**
 * @param {Array<object>} corpus — from referenceCorpus.buildReferenceCorpus
 * @returns {{ summary: object, rules: Array<object> }}
 */
export function mineDensityAngleCompensationRules(corpus) {
  if (!corpus || corpus.length < 2) {
    return { summary: emptySummary(), rules: [] };
  }

  const fillSpacings = [];
  const fillAngles = [];
  const satinSpacings = [];
  const satinWidths = [];
  const perFile = [];

  for (const entry of corpus) {
    const fileFillSpacings = [];
    const fileFillAngles = [];
    const fileSatinSpacings = [];
    const fileSatinWidths = [];

    for (const b of entry.technicalBlocks || []) {
      if (b.blockType === 'fill_tatami') {
        const rs = blockRowSpacing(b);
        if (Number.isFinite(rs) && rs > 0) {
          fillSpacings.push(rs);
          fileFillSpacings.push(rs);
        }
        const ang = normalizedAngle(b.averageAngle);
        if (Number.isFinite(ang)) {
          fillAngles.push(ang);
          fileFillAngles.push(ang);
        }
      } else if (b.blockType === 'satin_border') {
        const cs = blockRowSpacing(b);
        if (Number.isFinite(cs) && cs > 0) {
          satinSpacings.push(cs);
          fileSatinSpacings.push(cs);
        }
        const w = satinWidth(b);
        if (Number.isFinite(w) && w > 0) satinWidths.push(w);
        fileSatinWidths.push(w);
      }
    }

    perFile.push({
      filename: entry.filename,
      archetype: classifyArchetype(entry),
      fillDensityMm: median(fileFillSpacings),
      fillAngleDeg: circularMedian(fileFillAngles),
      satinColumnSpacingMm: median(fileSatinSpacings),
      pullCompensationMm: estimatePullCompensation(fileSatinWidths),
    });
  }

  const fillDensityMm = clampMedian(fillSpacings, FILL_DENSITY_RANGE);
  const fillAngleDeg = circularMedian(fillAngles);
  const satinColumnSpacingMm = clampMedian(satinSpacings, SATIN_SPACING_RANGE);
  const pullCompensationMm = clampValue(
    estimatePullCompensation(satinWidths),
    PULL_COMP_RANGE,
  );

  const summary = {
    learnedFromFiles: corpus.length,
    fillDensityMm,
    fillAngleDeg,
    satinColumnSpacingMm,
    satinDensityMm: satinColumnSpacingMm,
    pullCompensationMm,
    samples: {
      fillBlocks: fillSpacings.length,
      satinBlocks: satinSpacings.length,
    },
    byArchetype: aggregateByArchetype(perFile),
  };

  const rules = [
    buildRule('D001_fill_row_spacing', 'Densidad de relleno (espaciado de filas tatami)',
      'fill', fillSpacings, FILL_DENSITY_RANGE, 'bloques fill_tatami presentes',
      'Usar este espaciado de filas en rellenos tatami.', 'mm', corpus),
    buildAngleRule('D002_fill_angle', 'Ángulo dominante de relleno',
      fillAngles, 'bloques fill_tatami presentes',
      'Rotar los rellenos al ángulo dominante del corpus profesional.', corpus),
    buildRule('D003_satin_column_spacing', 'Densidad de satin (espaciado de columnas)',
      'contour', satinSpacings, SATIN_SPACING_RANGE, 'bloques satin_border presentes',
      'Usar este espaciado de columnas en satin borders.', 'mm', corpus),
    buildPullCompRule('D004_pull_compensation', 'Compensación de tracción (pull compensation)',
      satinWidths, 'bloques satin_border presentes',
      'Expandir el ancho de satin según la compensación aprendida.', corpus),
  ];

  return { summary, rules: rules.filter(r => r.confidence > 0) };
}

// ─── Block-level derivations ────────────────────────────────────────────────

function blockRowSpacing(b) {
  const area = b.bbox?.areaMm2 || 0;
  const stitches = b.stitchCount || 0;
  const avgLen = b.averageStitchLength || 0;
  if (area <= 0 || stitches <= 0 || avgLen <= 0) return null;
  // total thread length ≈ stitches * avgLen; row spacing ≈ area / totalLen
  return area / (stitches * avgLen);
}

function satinWidth(b) {
  const w = b.bbox?.widthMm || 0;
  const h = b.bbox?.heightMm || 0;
  // satin is a column: the narrow dimension is the width
  return Math.max(w, h) > 0 ? Math.min(w, h) : 0;
}

function normalizedAngle(deg) {
  if (!Number.isFinite(deg)) return null;
  let a = ((deg % 180) + 180) % 180;
  return a;
}

function estimatePullCompensation(widths) {
  if (!widths.length) return null;
  const med = median(widths);
  if (!Number.isFinite(med) || med <= 0) return null;
  return clampValue(0.12 * med, PULL_COMP_RANGE);
}

// ─── Rule builders ───────────────────────────────────────────────────────────

function buildRule(ruleId, name, category, values, range, condition, action, unit, corpus) {
  if (!values.length) return lowConfidence(ruleId, name, category);
  const med = median(values);
  return {
    ruleId,
    name,
    category,
    learnedFromFiles: corpus.length,
    confidence: values.length >= 3 ? 0.8 : 0.55,
    condition,
    recommendedAction: action,
    parameterRange: {
      min: clampValue(Math.min(...values), range).toFixed(3),
      max: clampValue(Math.max(...values), range).toFixed(3),
      mean: clampValue(avg(values), range).toFixed(3),
      median: clampValue(med, range).toFixed(3),
      unit,
    },
    examples: corpus.slice(0, 5).map(e => e.filename),
  };
}

function buildAngleRule(ruleId, name, values, condition, action, corpus) {
  if (!values.length) return lowConfidence(ruleId, name, 'fill');
  const med = circularMedian(values);
  return {
    ruleId,
    name,
    category: 'fill',
    learnedFromFiles: corpus.length,
    confidence: values.length >= 3 ? 0.75 : 0.5,
    condition,
    recommendedAction: action,
    parameterRange: {
      median: med.toFixed(1),
      spread: circularSpread(values).toFixed(1),
      unit: 'deg',
    },
    examples: corpus.slice(0, 5).map(e => e.filename),
  };
}

function buildPullCompRule(ruleId, name, widths, condition, action, corpus) {
  const comp = estimatePullCompensation(widths);
  if (comp == null) return lowConfidence(ruleId, name, 'contour');
  return {
    ruleId,
    name,
    category: 'contour',
    learnedFromFiles: corpus.length,
    confidence: widths.length >= 3 ? 0.7 : 0.5,
    condition,
    recommendedAction: action,
    parameterRange: {
      mean: comp.toFixed(3),
      unit: 'mm',
      satinWidthMedian: (median(widths) || 0).toFixed(2),
    },
    examples: corpus.slice(0, 5).map(e => e.filename),
  };
}

function lowConfidence(ruleId, name, category) {
  return {
    ruleId, name, category, learnedFromFiles: 0, confidence: 0,
    condition: 'no hay bloques suficientes', recommendedAction: '—',
    parameterRange: null, examples: [],
  };
}

// ─── Archetype aggregation (lightweight, independent of profiles) ────────────

function classifyArchetype(entry) {
  const blockCount = (entry.technicalBlocks || []).length;
  const colorCount = entry.colorCount || 0;
  const area = (entry.widthMm || 0) * (entry.heightMm || 0);
  const satinRatio = entry.satinBlocks / Math.max(1, blockCount);
  const fillRatio = entry.fillBlocks / Math.max(1, blockCount);
  if (colorCount >= 4 && blockCount >= 6 && satinRatio > 0.1) return 'cartoon_character';
  if (colorCount <= 4 && blockCount <= 6 && area < 8000) return 'simple_logo';
  if (blockCount <= 5 && satinRatio > 0.4) return 'text_design';
  if (satinRatio > 0.4) return 'satin_heavy';
  if (fillRatio > 0.4) return 'fill_heavy';
  return 'other';
}

function aggregateByArchetype(perFile) {
  const groups = {};
  for (const f of perFile) {
    (groups[f.archetype] ||= []).push(f);
  }
  const out = {};
  for (const [k, vals] of Object.entries(groups)) {
    out[k] = {
      files: vals.length,
      fillDensityMm: round(median(vals.map(v => v.fillDensityMm).filter(Number.isFinite))),
      fillAngleDeg: round(circularMedian(vals.map(v => v.fillAngleDeg).filter(Number.isFinite))),
      satinColumnSpacingMm: round(median(vals.map(v => v.satinColumnSpacingMm).filter(Number.isFinite))),
      pullCompensationMm: round(median(vals.map(v => v.pullCompensationMm).filter(Number.isFinite))),
    };
  }
  return out;
}

// ─── Statistics helpers ─────────────────────────────────────────────────────

function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function clampMedian(values, range) {
  if (!values.length) return (range.min + range.max) / 2;
  return clampValue(median(values), range);
}

function clampValue(v, range) {
  if (!Number.isFinite(v)) return (range.min + range.max) / 2;
  return Math.max(range.min, Math.min(range.max, v));
}

function round(v) { return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0; }

// Circular median for angles in [0,180)
function circularMedian(angles) {
  if (!angles.length) return 0;
  const sorted = [...angles].sort((a, b) => a - b);
  // Use vector mean to avoid wraparound issues, then pick nearest sample
  const rad = sorted.map(a => (a * Math.PI) / 180);
  const cx = avg(rad.map(Math.cos));
  const sx = avg(rad.map(Math.sin));
  let mean = Math.atan2(sx, cx) * 180 / Math.PI;
  if (mean < 0) mean += 180;
  // nearest sample to mean
  let best = sorted[0], bestD = Infinity;
  for (const a of sorted) {
    let d = Math.abs(a - mean) % 180;
    if (d > 90) d = 180 - d;
    if (d < bestD) { bestD = d; best = a; }
  }
  return Math.round(best * 10) / 10;
}

function circularSpread(angles) {
  if (!angles.length) return 0;
  const rad = angles.map(a => (a * Math.PI) / 180);
  const cx = avg(rad.map(Math.cos));
  const sx = avg(rad.map(Math.sin));
  const R = Math.hypot(cx, sx); // 1 = perfectly aligned, 0 = uniform
  return Math.round((1 - R) * 90 * 10) / 10;
}

function emptySummary() {
  return {
    learnedFromFiles: 0,
    fillDensityMm: (FILL_DENSITY_RANGE.min + FILL_DENSITY_RANGE.max) / 2,
    fillAngleDeg: 0,
    satinColumnSpacingMm: (SATIN_SPACING_RANGE.min + SATIN_SPACING_RANGE.max) / 2,
    satinDensityMm: (SATIN_SPACING_RANGE.min + SATIN_SPACING_RANGE.max) / 2,
    pullCompensationMm: (PULL_COMP_RANGE.min + PULL_COMP_RANGE.max) / 2,
    samples: { fillBlocks: 0, satinBlocks: 0 },
    byArchetype: {},
  };
}

export const DENSITY_ANGLE_COMPENSATION_RULE_IDS = ['D001_fill_row_spacing', 'D002_fill_angle', 'D003_satin_column_spacing', 'D004_pull_compensation'];