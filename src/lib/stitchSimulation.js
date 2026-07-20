/**
 * stitchSimulation.js — Visual embroidery simulation engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Separates VISUAL simulation from command generation.
 * Does NOT modify commands, regions, canvas state, or export pipeline.
 *
 * Public API:
 *   buildSimulationBlocks(commands, regions, options) → { blocks, commandToBlock, stats, warnings, commands }
 *   renderSimulationOverlay(ctx, simData, currentCommandIndex, settings, projection, heatMap?) → renderReport
 *   DEFAULT_SIMULATION_SETTINGS
 */

// ─── Default simulation settings ─────────────────────────────────────────────

export const DEFAULT_SIMULATION_SETTINGS = {
  showStitches:           true,
  showJumps:              false,
  showTrims:              true,
  showNeedlePath:         false,
  showDebugPath:          false,
  showDensityHeatmap:     false,
  showWarnings:           true,
  showCurrentBlockOnly:   false,
  realisticThreadPreview: true,
};

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Convert normalized 0-1 path_points to mm coordinates centered at (0,0). */
function normToMm(pts, w, h) {
  return pts.map(p => [(p[0] - 0.5) * w, (p[1] - 0.5) * h]);
}

/** Standard ray-casting point-in-polygon test. */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function buildRegionPolygonMap(regions, w, h) {
  const map = new Map();
  for (const r of regions) {
    const pts = r.path_points || r.contour_points;
    if (!pts || pts.length < 3) continue;
    map.set(r.id, {
      polygon: normToMm(pts, w, h),
      type: r.type || 'fill',
      stitchType: r.stitch_type,
      color: r.color,
      name: r.name,
    });
  }
  return map;
}

// ─── buildSimulationBlocks ───────────────────────────────────────────────────

/**
 * Groups commands into sewing blocks by color + region + stitch type.
 * Computes visual diagnostics: outside-region, duplicates, micro/macro, density.
 *
 * @param {Array}  commands — flat command sequence from flattenToCommands
 * @param {Array}  regions  — visual regions with path_points
 * @param {Object} options  — { width_mm, height_mm }
 * @returns {{ blocks, commandToBlock, stats, warnings, commands }}
 */
export function buildSimulationBlocks(commands, regions, options = {}) {
  const w = options.width_mm || 100;
  const h = options.height_mm || 100;
  const minStitch = 0.8;
  const maxStitch = 8.0;
  const dupThreshold = 0.05;

  const regionMap = buildRegionPolygonMap(regions, w, h);

  console.log(`[simulation] commands input: ${commands.length}`);

  const blocks = [];
  const warnings = [];
  const stats = {
    totalStitches: 0,
    totalJumps: 0,
    totalTrims: 0,
    colorChanges: 0,
    stitchesOutsideRegion: 0,
    duplicateStitches: 0,
    shortStitches: 0,
    longStitches: 0,
    maxDensityPerZone: 0,
    blocksBuilt: 0,
  };

  let currentBlock = null;
  let prevX = 0, prevY = 0;
  let prevColor = null;
  let prevStitchX = null, prevStitchY = null;
  let blockId = 0;

  // Density grid (10mm cells)
  const grid = {};
  const GRID_SIZE = 10;
  const densityKey = (x, y) => `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const hasCoords = c.x !== undefined && Number.isFinite(c.x) && Number.isFinite(c.y);

    // ── Non-stitch command handling ──────────────────────────────────────
    if (c.type === 'colorChange') {
      stats.colorChanges++;
      if (currentBlock) { currentBlock.endIndex = i - 1; blocks.push(currentBlock); currentBlock = null; }
      if (c.color) prevColor = c.color;
      continue;
    }
    if (c.type === 'trim') {
      stats.totalTrims++;
      if (currentBlock) { currentBlock.endIndex = i - 1; blocks.push(currentBlock); currentBlock = null; }
      continue;
    }
    if (c.type === 'end') {
      if (currentBlock) { currentBlock.endIndex = i - 1; blocks.push(currentBlock); currentBlock = null; }
      continue;
    }

    if (!hasCoords) continue;

    const length = Math.hypot(c.x - prevX, c.y - prevY);

    if (c.type === 'jump') {
      stats.totalJumps++;
      if (currentBlock) {
        if (!currentBlock.jumps) currentBlock.jumps = [];
        currentBlock.jumps.push({ index: i, from: [prevX, prevY], to: [c.x, c.y], length });
      }
      prevX = c.x; prevY = c.y;
      continue;
    }

    // ── Stitch ───────────────────────────────────────────────────────────
    stats.totalStitches++;

    const regionId = c.regionId;
    const regionInfo = regionMap.get(regionId);
    const isContour = regionInfo?.type === 'contour' || regionInfo?.stitchType === 'running_stitch';

    // Check if stitch is inside its region
    let outsideRegion = false;
    if (regionInfo?.polygon) {
      if (!pointInPolygon(c.x, c.y, regionInfo.polygon)) {
        outsideRegion = true;
        stats.stitchesOutsideRegion++;
        if (warnings.length < 200) {
          warnings.push({ index: i, type: 'OUTSIDE_REGION', message: `Puntada #${i} fuera de región ${regionId}` });
        }
      }
    }

    // Check duplicates
    if (prevStitchX !== null) {
      const d = Math.hypot(c.x - prevStitchX, c.y - prevStitchY);
      if (d < dupThreshold) {
        stats.duplicateStitches++;
      }
    }

    // Check length
    if (length > 0 && length < minStitch) stats.shortStitches++;
    if (length > maxStitch) {
      stats.longStitches++;
      if (warnings.length < 200) {
        warnings.push({ index: i, type: 'LONG_STITCH', message: `Puntada #${i} demasiado larga (${length.toFixed(1)}mm)` });
      }
    }

    // Density grid
    const key = densityKey(c.x, c.y);
    grid[key] = (grid[key] || 0) + 1;

    // Start new block if color or region changed
    const blockColor = c.color || prevColor;
    if (!currentBlock || currentBlock.color !== blockColor || currentBlock.regionId !== regionId) {
      if (currentBlock) { currentBlock.endIndex = i - 1; blocks.push(currentBlock); }
      blockId++;
      currentBlock = {
        blockId,
        regionId,
        regionName: regionInfo?.name || null,
        color: blockColor,
        stitchType: isContour ? 'running' : (regionInfo?.stitchType || 'fill'),
        isContour,
        polygon: regionInfo?.polygon || null,
        startIndex: i,
        endIndex: i,
        stitches: [],
        jumps: [],
        bbox: { minX: c.x, minY: c.y, maxX: c.x, maxY: c.y },
        warnings: [],
      };
    }

    // Add stitch to block
    currentBlock.stitches.push({ index: i, from: [prevX, prevY], to: [c.x, c.y], length, outsideRegion });
    currentBlock.endIndex = i;

    // Update bbox
    if (c.x < currentBlock.bbox.minX) currentBlock.bbox.minX = c.x;
    if (c.x > currentBlock.bbox.maxX) currentBlock.bbox.maxX = c.x;
    if (c.y < currentBlock.bbox.minY) currentBlock.bbox.minY = c.y;
    if (c.y > currentBlock.bbox.maxY) currentBlock.bbox.maxY = c.y;

    if (outsideRegion) currentBlock.warnings.push({ index: i, type: 'OUTSIDE_REGION' });

    prevX = c.x; prevY = c.y;
    prevStitchX = c.x; prevStitchY = c.y;
    if (c.color) prevColor = c.color;
  }

  // Close last block
  if (currentBlock) { currentBlock.endIndex = commands.length - 1; blocks.push(currentBlock); }

  // Max density
  stats.maxDensityPerZone = Math.max(0, ...Object.values(grid));
  stats.blocksBuilt = blocks.length;

  // Report planner issue if many stitches outside region
  if (stats.totalStitches > 0 && stats.stitchesOutsideRegion > stats.totalStitches * 0.1) {
    warnings.unshift({
      type: 'PLANNER_ISSUE',
      message: `Planner está generando ${stats.stitchesOutsideRegion} puntadas fuera del polígono (${Math.round(stats.stitchesOutsideRegion / stats.totalStitches * 100)}%)`,
    });
  }

  // Build command-to-block lookup for the renderer
  const commandToBlock = new Map();
  for (const block of blocks) {
    for (const s of block.stitches) {
      commandToBlock.set(s.index, block);
    }
  }

  console.log(`[simulation] blocks built: ${blocks.length}`);
  console.log(`[simulation] stitches outside region: ${stats.stitchesOutsideRegion}`);
  console.log(`[simulation] duplicate stitches: ${stats.duplicateStitches}`);

  return { blocks, commandToBlock, stats, warnings, commands };
}

// ─── renderSimulationOverlay ─────────────────────────────────────────────────

/**
 * Renders the embroidery simulation up to currentCommandIndex.
 * Respects simulation settings — does NOT modify commands or canvas state
 * beyond the drawing operations themselves.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object}  simData            — from buildSimulationBlocks
 * @param {number}  currentCommandIndex — progress position (command index)
 * @param {Object}  settings           — simulation settings
 * @param {Object}  projection         — { toX, toY, scale }
 * @param {Array?}  heatMap            — optional [{ index, status }] from analyzeSimulation
 * @returns {{ stitchesRendered, jumpsRendered, jumpsHidden, currentBlock }}
 */
export function renderSimulationOverlay(ctx, simData, currentCommandIndex, settings, projection, heatMap = null) {
  const { commands, commandToBlock, blocks } = simData;
  const { toX, toY, scale } = projection;

  let stitchesRendered = 0;
  let jumpsRendered = 0;
  let jumpsHidden = 0;
  let currentBlock = null;

  let prevX = 0, prevY = 0;
  let prevColor = null;
  let activeBlock = null;
  let activeClipActive = false;

  // For showCurrentBlockOnly mode
  const visibleBlockId = settings.showCurrentBlockOnly
    ? commandToBlock.get(currentCommandIndex)?.blockId
    : undefined;

  for (let i = 0; i <= currentCommandIndex && i < commands.length; i++) {
    const c = commands[i];
    const hasCoords = c.x !== undefined && Number.isFinite(c.x);

    // ── Close clip at any non-stitch command ─────────────────────────────
    if (c.type !== 'stitch' && activeClipActive) {
      ctx.restore();
      activeClipActive = false;
      activeBlock = null;
    }

    // ── Color change ─────────────────────────────────────────────────────
    if (c.type === 'colorChange') {
      if (c.color) prevColor = c.color;
      if (settings.showDebugPath) {
        _drawColorChangeMarker(ctx, toX(prevX), toY(prevY));
      }
      continue;
    }

    // ── Trim ─────────────────────────────────────────────────────────────
    if (c.type === 'trim') {
      if (settings.showTrims) {
        _drawTrimMarker(ctx, toX(prevX), toY(prevY));
      }
      continue;
    }

    // ── End ──────────────────────────────────────────────────────────────
    if (c.type === 'end') continue;

    if (!hasCoords) continue;

    // ── Jump ─────────────────────────────────────────────────────────────
    if (c.type === 'jump') {
      if (settings.showJumps) {
        ctx.save();
        ctx.strokeStyle = 'rgba(100,116,139,0.35)';
        ctx.lineWidth = 0.6;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(prevX), toY(prevY));
        ctx.lineTo(toX(c.x), toY(c.y));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        jumpsRendered++;
      } else {
        jumpsHidden++;
      }
      prevX = c.x; prevY = c.y;
      continue;
    }

    // ── Stitch ───────────────────────────────────────────────────────────
    if (!settings.showStitches) {
      prevX = c.x; prevY = c.y;
      continue;
    }

    const block = commandToBlock.get(i);

    // Skip other blocks in showCurrentBlockOnly mode
    if (visibleBlockId !== undefined && block && block.blockId !== visibleBlockId) {
      prevX = c.x; prevY = c.y;
      continue;
    }

    // Block change — set up clip + stroke style
    if (block !== activeBlock) {
      activeBlock = block;
      const isContour = block?.isContour;
      const shouldClip = block && !isContour && block.polygon
        && !settings.showDebugPath && !settings.showDensityHeatmap;

      if (shouldClip) {
        ctx.save();
        const poly = block.polygon;
        ctx.beginPath();
        ctx.moveTo(toX(poly[0][0]), toY(poly[0][1]));
        for (let j = 1; j < poly.length; j++) ctx.lineTo(toX(poly[j][0]), toY(poly[j][1]));
        ctx.closePath();
        ctx.clip();
        activeClipActive = true;
      }

      // Set stroke style for this block
      const color = block?.color || c.color || prevColor || '#a78bfa';
      if (settings.showDensityHeatmap && heatMap) {
        const heat = heatMap[i]?.status || 'green';
        ctx.strokeStyle = heat === 'red' ? '#ef4444' : heat === 'yellow' ? '#fbbf24' : '#22c55e';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
      } else if (settings.realisticThreadPreview) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.6, 0.35 * scale);
        ctx.globalAlpha = 0.72;
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = isContour ? 1.2 : 1.5;
        ctx.globalAlpha = 0.88;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }

    // Draw stitch segment
    ctx.beginPath();
    ctx.moveTo(toX(prevX), toY(prevY));
    ctx.lineTo(toX(c.x), toY(c.y));
    ctx.stroke();
    stitchesRendered++;

    // Warning marker for outside-region stitches
    if (settings.showWarnings && block) {
      const stitchInfo = block.stitches.find(s => s.index === i);
      if (stitchInfo?.outsideRegion) {
        ctx.save();
        ctx.fillStyle = '#f97316';
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(toX(c.x), toY(c.y), 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (block) currentBlock = block;
    prevX = c.x; prevY = c.y;
    if (c.color) prevColor = c.color;
  }

  // Close any remaining clip
  if (activeClipActive) ctx.restore();

  // ── Debug overlays ────────────────────────────────────────────────────────
  if (settings.showDebugPath) {
    ctx.save();
    ctx.font = '8px Inter, sans-serif';
    ctx.fillStyle = 'rgba(34,211,238,0.7)';
    for (const block of blocks) {
      if (block.startIndex > currentCommandIndex) break;
      const cx = toX((block.bbox.minX + block.bbox.maxX) / 2);
      const cy = toY((block.bbox.minY + block.bbox.maxY) / 2);
      ctx.fillText(`B${block.blockId}`, cx, cy);
    }
    ctx.restore();
  }

  // ── Needle path (faint full path) ──────────────────────────────────────────
  if (settings.showNeedlePath) {
    ctx.save();
    ctx.strokeStyle = 'rgba(124,58,237,0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    let np = false, npx = 0, npy = 0;
    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];
      if (c.x === undefined || !Number.isFinite(c.x)) continue;
      if (c.type === 'stitch') {
        if (!np) { ctx.moveTo(toX(npx), toY(npy)); np = true; }
        ctx.lineTo(toX(c.x), toY(c.y));
      } else {
        np = false;
      }
      npx = c.x; npy = c.y;
    }
    ctx.stroke();
    ctx.restore();
  }

  const renderReport = {
    stitchesRendered,
    jumpsRendered,
    jumpsHidden,
    currentBlock: currentBlock
      ? {
          blockId: currentBlock.blockId,
          regionId: currentBlock.regionId,
          regionName: currentBlock.regionName,
          color: currentBlock.color,
          stitchType: currentBlock.stitchType,
          isContour: currentBlock.isContour,
        }
      : null,
  };

  console.log(`[simulation] stitches rendered: ${stitchesRendered}`);
  console.log(`[simulation] jumps hidden: ${jumpsHidden}`);
  console.log(`[simulation] jumps rendered: ${jumpsRendered}`);
  if (currentBlock) console.log(`[simulation] current block: B${currentBlock.blockId} (${currentBlock.stitchType})`);
  console.log(`[simulation] render mode: ${settings.showDebugPath ? 'debug' : 'normal'}`);

  return renderReport;
}

// ─── Marker helpers ──────────────────────────────────────────────────────────

function _drawTrimMarker(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _drawColorChangeMarker(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}