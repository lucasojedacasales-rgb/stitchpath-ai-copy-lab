/**
 * referenceDesignMetrics.js — Reference Learning Engine v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Calcula el "design profile" del diseño actual (regiones + comandos) para
 * poder compararlo contra el corpus aprendido y seleccionar un perfil.
 *
 * Read-only: no toca el motor.
 */

/**
 * @param {Array} currentRegions
 * @param {Array} currentCommands
 * @returns {object} design profile
 */
export function computeCurrentDesignProfile(currentRegions, currentCommands) {
  const regions = Array.isArray(currentRegions) ? currentRegions : [];
  const cmds = Array.isArray(currentCommands) ? currentCommands : [];

  const colorCount = new Set(regions.map(r => r.color).filter(Boolean)).size;
  const blockCount = regions.length;
  const satinCount = regions.filter(r => r.stitch_type === 'satin').length;
  const fillCount = regions.filter(r => r.stitch_type === 'fill').length;
  const runningCount = regions.filter(r => r.stitch_type === 'running_stitch').length;
  const satinRatio = blockCount ? satinCount / blockCount : 0;
  const fillRatio = blockCount ? fillCount / blockCount : 0;
  const hasDetail = runningCount > 0 || regions.some(r => (r.area_mm2 || 0) < 200);

  // Bounding box from regions path_points (normalized -0.5..0.5 → mm via width_mm)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of regions) {
    const pp = r.path_points || [];
    const w = r.width_mm || 100, h = r.height_mm || 100;
    for (const pt of pp) {
      const x = (pt[0] ?? 0) * w, y = (pt[1] ?? 0) * h;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const widthMm = (Number.isFinite(minX) && Number.isFinite(maxX)) ? (maxX - minX) : 0;
  const heightMm = (Number.isFinite(minY) && Number.isFinite(maxY)) ? (maxY - minY) : 0;
  const area = widthMm * heightMm;
  const aspect = heightMm > 0 ? widthMm / heightMm : 1;
  const contourCount = runningCount;

  // Stitch metrics from commands
  const stitchLens = [];
  let prev = null;
  let jumpCount = 0, trimCount = 0;
  for (const c of cmds) {
    if (c.type === 'jump') { jumpCount++; prev = { x: c.x, y: c.y }; continue; }
    if (c.type === 'trim') { trimCount++; continue; }
    if (c.type !== 'stitch') continue;
    if (prev) {
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      stitchLens.push(d);
    }
    prev = { x: c.x, y: c.y };
  }
  const stitchCount = stitchLens.length;
  const shortCount = stitchLens.filter(l => l > 0 && l < 1.0).length;
  const dupCount = stitchLens.filter(l => l < 0.3).length;
  const longVisibleCount = stitchLens.filter(l => l > 7.0).length;
  const shortRatio = stitchCount ? shortCount / stitchCount : 0;
  const dupRatio = stitchCount ? dupCount / stitchCount : 0;
  const longVisibleRatio = stitchCount ? longVisibleCount / stitchCount : 0;
  const visibleDiagonals = countVisibleDiagonals(cmds);
  const fillTatamiBlocks = fillCount;
  const satinBorderCount = satinCount;
  const underlayBlocks = cmds.filter(c => (c.layerType || '').toLowerCase().includes('underlay') || (c.source || '').toLowerCase().includes('underlay')).length;

  return {
    colorCount, blockCount, satinCount, fillCount, runningCount,
    satinRatio, fillRatio, hasDetail, contourCount,
    widthMm, heightMm, area, aspect,
    stitchCount, jumpCount, trimCount,
    shortRatio, dupRatio, longVisibleRatio,
    visibleDiagonals, fillTatamiBlocks, satinBorderCount, underlayBlocks,
  };
}

function countVisibleDiagonals(cmds) {
  let count = 0, prev = null;
  for (const c of cmds) {
    if (c.type !== 'stitch') { if (c.type === 'jump') prev = { x: c.x, y: c.y }; continue; }
    if (!prev) { prev = { x: c.x, y: c.y }; continue; }
    const dx = (c.x ?? 0) - prev.x, dy = (c.y ?? 0) - prev.y;
    const d = Math.hypot(dx, dy);
    if (d > 2.5) {
      let deg = Math.atan2(dy, dx) * 180 / Math.PI;
      deg = ((deg % 180) + 180) % 180;
      if ((deg >= 20 && deg <= 70) || (deg >= 110 && deg <= 160)) count++;
    }
    prev = { x: c.x, y: c.y };
  }
  return count;
}