/**
 * CE01 Validator — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-export validation specific to the Caydo CE01 home embroidery machine.
 *
 * Analyzes the FINAL command sequence (after pipeline + autoFix) and returns
 * a structured report. Does NOT modify regions, commands, or visual state.
 *
 * CE01 constraints:
 *   - Stitch count is non-blocking up to 35,000; >35,000 is warning/risky, >50,000 high risk.
 *   - Hoop: 100×100mm
 *   - Trim threshold: 3.5mm
 *   - Home-machine stitch range: 0.8mm – 8.0mm (warnings outside)
 *
 * 15 checks:
 *   1.  Total stitch count risk only: <=35,000 non-blocking; >35,000 warning; >50,000 high risk
 *   2.  Jump count
 *   3.  Jumps > 3.5mm without preceding trim
 *   4.  Stitches < 0.8mm (too short / dense)
 *   5.  Stitches > 8mm (too long for home machine)
 *   6.  Duplicate stitches (same coordinates)
 *   7.  Coordinates outside hoop
 *   8.  Design bounding box outside 100×100mm
 *   9.  Regions without tie-in
 *   10. Regions without tie-off
 *   11. Color change count
 *   12. Excessive density per 10mm zone
 *   13. Contour objects treated as fill
 *   14. Fill objects sent as contour
 *   15. Empty or invalid commands
 */

// ─── CE01 Machine Specs ──────────────────────────────────────────────────────

// El límite anterior de 12000 era demasiado conservador. Se recalibra porque una muestra Wilcom funcional aceptada por CE01 contiene ~33845 puntadas.
const CE01_STITCH_WARNING_THRESHOLD = 35000;
const CE01_STITCH_HIGH_RISK_THRESHOLD = 50000;
const CE01_HOOP_W         = 100;   // mm
const CE01_HOOP_H         = 100;   // mm
const CE01_TRIM_THRESHOLD = 3.5;   // mm
const CE01_MIN_STITCH     = 0.8;   // mm — below = warning
const CE01_MAX_STITCH     = 8.0;   // mm — above = warning
const CE01_GRID_CELL_MM   = 10;    // density grid cell size
const CE01_MAX_DENSITY    = 250;   // stitches per 10×10mm cell
const CE01_MAX_COLORS     = 6;     // CE01 practical color limit
const TIE_STITCH_MAX_MM   = 1.5;   // tie-in/off stitches are short

/**
 * @param {Array}  commands       — final flat command sequence from exportPipeline
 * @param {Array}  objects        — stitch objects (from buildStitchObjects)
 * @param {Array}  regions        — visual regions (for type mismatch checks)
 * @param {Object} config         — { width_mm, height_mm }
 * @param {Object} machineSettings — { maxSpeed, hoopSize, ... }
 * @returns {{
 *   status: "SAFE"|"RISKY"|"INVALID",
 *   ce01Ready: boolean,
 *   score: number,
 *   blockingIssues: Array<{check, message}>,
 *   warnings: Array<{check, message}>,
 *   exportSummary: { stitches, jumps, trims, colors, widthMm, heightMm, estimatedTime }
 * }}
 */
export function validateCE01(commands, objects = [], regions = [], config = {}, machineSettings = {}) {
  const blockingIssues = [];
  const warnings = [];
  let score = 100;

  // ── 15. Empty or invalid commands ─────────────────────────────────────────
  if (!commands || commands.length === 0) {
    blockingIssues.push({ check: 15, message: 'Secuencia de comandos vacía — no se puede exportar.' });
    return _buildReport('INVALID', 0, blockingIssues, warnings, _emptySummary(), _emptyMetrics());
  }

  // ── Tally stats in a single pass ──────────────────────────────────────────
  let stitches = 0, jumps = 0, trims = 0, colorChanges = 0;
  let longJumpsNoTrim = 0;
  let shortStitches = 0;
  let longStitches = 0;
  let duplicates = 0;
  let outOfHoop = 0;
  const seenPoints = new Set();

  // Bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  // Region grouping for tie-in/off (group by regionId)
  const regionGroups = new Map();

  // Density grid
  const grid = new Map();

  let prevX = 0, prevY = 0;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!c || !c.type) {
      blockingIssues.push({ check: 15, message: `Comando inválido en posición ${i}.` });
      continue;
    }

    if (c.type === 'stitch') {
      stitches++;

      const dist = Math.hypot(c.x - prevX, c.y - prevY);

      // 4. Short stitches
      if (dist > 0 && dist < CE01_MIN_STITCH) shortStitches++;

      // 5. Long stitches
      if (dist > CE01_MAX_STITCH) longStitches++;

      // 6. Duplicates
      const key = `${c.x.toFixed(2)},${c.y.toFixed(2)}`;
      if (seenPoints.has(key)) duplicates++;
      else seenPoints.add(key);

      // 7. Out of hoop
      if (Math.abs(c.x) > CE01_HOOP_W / 2 || Math.abs(c.y) > CE01_HOOP_H / 2) outOfHoop++;

      // Bounding box
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;

      // 12. Density grid
      const gx = Math.floor((c.x + CE01_HOOP_W / 2) / CE01_GRID_CELL_MM);
      const gy = Math.floor((c.y + CE01_HOOP_H / 2) / CE01_GRID_CELL_MM);
      const gkey = `${gx},${gy}`;
      grid.set(gkey, (grid.get(gkey) || 0) + 1);

      // Region grouping
      const rid = c.regionId || 'unknown';
      if (!regionGroups.has(rid)) regionGroups.set(rid, []);
      regionGroups.get(rid).push({ x: c.x, y: c.y });
    }

    if (c.type === 'jump') {
      jumps++;
      const dist = Math.hypot(c.x - prevX, c.y - prevY);
      const prev = i > 0 ? commands[i - 1] : null;
      const isFirstInSeq = !prev || prev.type !== 'jump';
      // 3. Jump > 3.5mm without preceding trim
      if (isFirstInSeq && prev && dist > CE01_TRIM_THRESHOLD && prev.type !== 'trim') {
        longJumpsNoTrim++;
      }
    }

    if (c.type === 'trim') trims++;
    if (c.type === 'colorChange') colorChanges++;

    if (c.type !== 'colorChange' && c.type !== 'end') {
      prevX = c.x ?? prevX;
      prevY = c.y ?? prevY;
    }
  }

  // ── 1. Total stitch count ─────────────────────────────────────────────────
  // Recalibrado: 12,000 puntadas NO bloquea CE01. Wilcom funcional aceptado por CE01 muestra ~33,845 puntadas.
  // El conteo total solo genera riesgo; INVALID requiere evidencia real de archivo imposible/corrupto o rechazo de máquina.
  if (stitches > CE01_STITCH_HIGH_RISK_THRESHOLD) {
    warnings.push({
      check: 1,
      message: `${stitches.toLocaleString()} puntadas — riesgo alto de tiempo/memoria, pero no se bloquea automáticamente sin evidencia real de rechazo CE01.`,
    });
    score -= 18;
  } else if (stitches > CE01_STITCH_WARNING_THRESHOLD) {
    warnings.push({
      check: 1,
      message: `${stitches.toLocaleString()} puntadas — por encima de ${CE01_STITCH_WARNING_THRESHOLD.toLocaleString()}, revisar rendimiento; no bloqueante para CE01.`,
    });
    score -= 8;
  }

  // ── 2. Jump count ──────────────────────────────────────────────────────────
  // >500 → RISKY strong, 250-500 → RISKY soft, 100-250 → minor, <100 → OK
  if (jumps > 500) {
    warnings.push({
      check: 2,
      message: `${jumps} saltos — excesivo. Usar Travel Path Optimizer.`,
    });
    score -= 15;
  } else if (jumps > 250) {
    warnings.push({
      check: 2,
      message: `${jumps} saltos — algo elevado para CE01.`,
    });
    score -= 8;
  } else if (jumps > 100) {
    warnings.push({ check: 2, message: `${jumps} saltos — eficiencia mejorable.` });
    score -= 4;
  }

  // ── 2b. Trim count ─────────────────────────────────────────────────────────
  // >150 → RISKY strong, 80-150 → RISKY soft, 40-80 → WARNING, <40 → OK
  if (trims > 150) {
    warnings.push({
      check: 2,
      message: `${trims} cortes (trim) — excesivo. Usar Trim Optimizer para reducir.`,
    });
    score -= 15;
  } else if (trims > 80) {
    warnings.push({
      check: 2,
      message: `${trims} cortes — considerar reducir trims innecesarios.`,
    });
    score -= 8;
  } else if (trims > 40) {
    warnings.push({ check: 2, message: `${trims} cortes — algo elevado.` });
    score -= 4;
  }

  // ── 3. Jumps > 3.5mm without trim ─────────────────────────────────────────
  if (longJumpsNoTrim > 0) {
    warnings.push({
      check: 3,
      message: `${longJumpsNoTrim} salto(s) >${CE01_TRIM_THRESHOLD}mm sin trim previo — riesgo de enredo de hilo.`,
    });
    score -= Math.min(5, longJumpsNoTrim * 1);
  }

  // ── 4. Short stitches ─────────────────────────────────────────────────────
  if (shortStitches > 20) {
    warnings.push({
      check: 4,
      message: `${shortStitches} puntadas <${CE01_MIN_STITCH}mm — posible densidad excesiva o ruido.`,
    });
    score -= Math.min(5, shortStitches * 0.1);
  }

  // ── 5. Long stitches ──────────────────────────────────────────────────────
  if (longStitches > 0) {
    warnings.push({
      check: 5,
      message: `${longStitches} puntada(s) >${CE01_MAX_STITCH}mm — demasiado largas para CE01 (riesgo de rotura de hilo).`,
    });
    score -= Math.min(15, longStitches * 2);
  }

  // ── 6. Duplicate stitches ─────────────────────────────────────────────────
  if (duplicates > 10) {
    warnings.push({
      check: 6,
      message: `${duplicates} puntadas duplicadas — posible redundancia de pathing.`,
    });
    score -= Math.min(5, duplicates * 0.1);
  }

  // ── 7. Coordinates outside hoop ───────────────────────────────────────────
  if (outOfHoop > 0) {
    blockingIssues.push({
      check: 7,
      message: `${outOfHoop} coordenada(s) fuera del bastidor ${CE01_HOOP_W}×${CE01_HOOP_H}mm.`,
    });
    score -= 25;
  }

  // ── 8. Design bounding box ────────────────────────────────────────────────
  const designW = isFinite(minX) ? maxX - minX : 0;
  const designH = isFinite(minY) ? maxY - minY : 0;
  if (designW > CE01_HOOP_W || designH > CE01_HOOP_H) {
    blockingIssues.push({
      check: 8,
      message: `Diseño ${designW.toFixed(1)}×${designH.toFixed(1)}mm excede el bastidor ${CE01_HOOP_W}×${CE01_HOOP_H}mm.`,
    });
    score -= 20;
  }

  // ── 9 & 10. Tie-in / tie-off per region ───────────────────────────────────
  let noTieIn = 0, noTieOff = 0;
  for (const [rid, group] of regionGroups) {
    if (group.length < 4) continue; // too small to require tie-in/off
    // Compute intra-group distances (dist between consecutive stitches in same region)
    const dists = [];
    for (let i = 1; i < group.length; i++) {
      dists.push(Math.hypot(group[i].x - group[i - 1].x, group[i].y - group[i - 1].y));
    }
    // Tie-in: first 2 intra-distances should be short (locking stitches)
    const tieIn = dists.length >= 2 && dists.slice(0, 2).every(d => d < TIE_STITCH_MAX_MM);
    // Tie-off: last 2 intra-distances should be short
    const tieOff = dists.length >= 2 && dists.slice(-2).every(d => d < TIE_STITCH_MAX_MM);
    if (!tieIn) noTieIn++;
    if (!tieOff) noTieOff++;
  }
  if (noTieIn > 0) {
    warnings.push({ check: 9, message: `${noTieIn} región(es) sin tie-in detectado.` });
    score -= Math.min(3, noTieIn * 0.5);
  }
  if (noTieOff > 0) {
    warnings.push({ check: 10, message: `${noTieOff} región(es) sin tie-off detectado.` });
    score -= Math.min(3, noTieOff * 0.5);
  }

  // ── 11. Color changes ─────────────────────────────────────────────────────
  const totalColors = colorChanges + 1;
  if (totalColors > CE01_MAX_COLORS) {
    warnings.push({
      check: 11,
      message: `${totalColors} colores — la CE01 maneja prácticamente hasta ${CE01_MAX_COLORS}.`,
    });
    score -= 5;
  }

  // ── 12. Excessive density per zone ────────────────────────────────────────
  let maxCell = 0;
  for (const count of grid.values()) {
    if (count > maxCell) maxCell = count;
  }
  if (maxCell > CE01_MAX_DENSITY) {
    warnings.push({
      check: 12,
      message: `Densidad excesiva: ${maxCell} puntadas en una zona de ${CE01_GRID_CELL_MM}×${CE01_GRID_CELL_MM}mm (máx ${CE01_MAX_DENSITY}).`,
    });
    score -= 10;
  }

  // ── 13. Contour objects treated as fill ───────────────────────────────────
  let contourAsFill = 0;
  let fillAsContour = 0;
  for (const r of regions) {
    const rc = r.region_class || '';
    const name = (r.name || '').toLowerCase();
    const isContour = rc === 'outer_outline' || rc === 'inner_outline' || rc === 'detail_run' ||
                      name.includes('outline') || name.includes('contour');
    if (isContour && r.stitch_type === 'fill') contourAsFill++;
    if (!isContour && r.stitch_type === 'running_stitch') fillAsContour++;
  }
  if (contourAsFill > 0) {
    blockingIssues.push({
      check: 13,
      message: `${contourAsFill} objeto(s) contour tratados erróneamente como fill.`,
    });
    score -= 15;
  }

  // ── 14. Fills sent as contour ─────────────────────────────────────────────
  if (fillAsContour > 0) {
    warnings.push({
      check: 14,
      message: `${fillAsContour} fill(s) enviados como contour — verificar tipo de puntada.`,
    });
    score -= 10;
  }

  // ── Determine status ──────────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, Math.round(score)));
  // RISKY when jumps > 250 or trims > 80 — prevents SAFE with excessive travel
  const excessiveTravel = jumps > 250 || trims > 80;
  const status = blockingIssues.length > 0
    ? 'INVALID'
    : (excessiveTravel || score < 80) ? 'RISKY' : 'SAFE';
  const ce01Ready = status !== 'INVALID';

  const spm = machineSettings.maxSpeed || machineSettings.max_speed_spm || 800;
  const estimatedTime = +(stitches / spm).toFixed(2);

  const exportSummary = {
    stitches,
    jumps,
    trims,
    colors: totalColors,
    widthMm: +designW.toFixed(1),
    heightMm: +designH.toFixed(1),
    estimatedTime,
  };

  return {
    status, ce01Ready, score, blockingIssues, warnings, exportSummary,
    rawMetrics: { shortStitches, longStitches, duplicates, jumps, longJumpsNoTrim, outOfHoop },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _emptySummary() {
  return { stitches: 0, jumps: 0, trims: 0, colors: 0, widthMm: 0, heightMm: 0, estimatedTime: 0 };
}

function _emptyMetrics() {
  return { shortStitches: 0, longStitches: 0, duplicates: 0, jumps: 0, longJumpsNoTrim: 0, outOfHoop: 0 };
}

function _buildReport(status, score, blockingIssues, warnings, exportSummary, rawMetrics = _emptyMetrics()) {
  return {
    status,
    ce01Ready: status !== 'INVALID',
    score,
    blockingIssues,
    warnings,
    exportSummary,
    rawMetrics,
  };
}