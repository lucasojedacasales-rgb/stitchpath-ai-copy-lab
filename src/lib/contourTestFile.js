/**
 * contourTestFile.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates test DST files for contour/outline verification on Caydo CE01.
 *
 * Test 1: 60×60mm square with satin outline only (no fill, 1 color, <1000 sts)
 * Test 2: Kirby outline-only (mouth + inner lines + outer outline, no fills)
 */

import { buildDSTFromCommands } from './dstDirectExport';
import { generateOutlines } from './outlineGenerator';
import { generateContourStitches } from './contourExportBuilder';

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 1: 60×60mm square, satin outline only
// ═══════════════════════════════════════════════════════════════════════════

export function generateContourTestDST() {
  const halfSize = 30; // 60mm / 2
  const square = [
    [-halfSize, -halfSize],
    [halfSize, -halfSize],
    [halfSize, halfSize],
    [-halfSize, halfSize],
  ];

  const obj = {
    id: 'test_contour_square',
    color: '#000000',
    name: 'test_square_outer_outline',
    stitch_type: 'satin',
    points: square,
    rawRegion: { closed: true },
    contourWidthMm: 1.2,
    isContour: true,
    layerType: 'outer_outline',
  };

  const stitches = generateContourStitches(obj, { maxStitchLength: 3.5 });

  const commands = [];
  for (let i = 0; i < stitches.length; i++) {
    commands.push({
      type: 'stitch',
      x: stitches[i][0],
      y: stitches[i][1],
      color: '#000000',
      regionId: 'test_contour_square',
      stitchType: 'satin',
      layerType: 'outer_outline',
    });
  }
  if (commands.length > 0) {
    const last = commands[commands.length - 1];
    commands.push({ type: 'end', x: last.x, y: last.y, color: null });
  }

  const { blob, meta } = buildDSTFromCommands(commands, {
    label: 'CE01_CONTOUR',
    ce01Strict: true,
  });

  console.log('[contour-test] square 60x60mm satin outline');
  console.log('[contour-test] stitches:', stitches.length);
  console.log('[contour-test] commands:', commands.length);
  console.log('[contour-test] satin width: 1.2mm, density: 0.4mm');
  console.log('[contour-test] colors: 1 (black)');

  return { blob, meta };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST 2: Kirby outline-only (no fills, only contours + details)
// ═══════════════════════════════════════════════════════════════════════════

export function generateOutlineOnlyDST(regions, config = {}) {
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;

  // Generate outline regions from fills
  const { outlines } = generateOutlines(regions, { ...config, generateOutlines: true });

  // Get detail regions (mouth, eyes, internal lines) — skip fills
  const detailRegions = regions.filter(r => {
    if (r.visible === false) return false;
    const name = (r.name || '').toLowerCase();
    const rc = r.region_class || '';
    return r.stitch_type === 'running_stitch' &&
           (name.includes('mouth') || name.includes('detail') || name.includes('eye') ||
            name.includes('line') || rc === 'detail_run' || rc === 'mouth_detail_run');
  });

  // Build stitch objects (outlines + details only — NO fills)
  const objects = [];

  for (const outline of outlines) {
    const pts = outline.path_points || [];
    if (pts.length < 2) continue;
    const mmPoints = pts.map(([nx, ny]) => [(nx - 0.5) * w, (ny - 0.5) * h]);
    const rc = outline.region_class || '';
    const isOuter = rc === 'outer_outline';
    objects.push({
      id: outline.id,
      color: outline.color || '#1a1a1a',
      name: outline.name || 'outline',
      stitch_type: isOuter ? 'satin' : (outline.stitch_type || 'running_stitch'),
      priority: isOuter ? 90 : 80,
      layerType: rc,
      isContour: true,
      contourWidthMm: isOuter ? 1.2 : 0.8,
      points: mmPoints,
      rawRegion: outline,
    });
  }

  for (const r of detailRegions) {
    const pts = r.path_points || [];
    if (pts.length < 2) continue;
    const mmPoints = pts.map(([nx, ny]) => [(nx - 0.5) * w, (ny - 0.5) * h]);
    objects.push({
      id: r.id,
      color: r.color || '#000000',
      name: r.name || 'detail',
      stitch_type: 'running_stitch',
      priority: 70,
      layerType: 'detail_run',
      isContour: true,
      contourWidthMm: 0.5,
      points: mmPoints,
      rawRegion: { ...r, closed: false },
    });
  }

  // Sort by priority: details (70) → inner (80) → outer (90)
  objects.sort((a, b) => (a.priority || 5) - (b.priority || 5));

  // Flatten to commands
  const commands = [];
  let prevColor = null;
  let prevX = 0, prevY = 0;
  let firstCmd = true;

  for (const obj of objects) {
    const stitches = generateContourStitches(obj, { maxStitchLength: 3.5 });
    if (stitches.length < 2) continue;

    // Color change
    if (prevColor !== null && obj.color !== prevColor) {
      commands.push({ type: 'colorChange', x: prevX, y: prevY, color: obj.color });
    }
    prevColor = obj.color;

    // Jump to start
    const [sx, sy] = stitches[0];
    const startDist = Math.hypot(sx - prevX, sy - prevY);
    if (startDist > 0.5) {
      if (!firstCmd && startDist > 3.5) {
        commands.push({ type: 'trim', x: prevX, y: prevY, color: obj.color });
      }
      const steps = Math.ceil(startDist / 12.1);
      for (let s = 1; s <= steps; s++) {
        commands.push({
          type: 'jump',
          x: prevX + (sx - prevX) * s / steps,
          y: prevY + (sy - prevY) * s / steps,
          color: obj.color,
        });
      }
      prevX = sx;
      prevY = sy;
    }

    // Stitches
    for (const [px, py] of stitches) {
      const dist = Math.hypot(px - prevX, py - prevY);
      if (dist > 3.5) {
        const steps = Math.ceil(dist / 3.5);
        for (let s = 1; s < steps; s++) {
          commands.push({
            type: 'stitch',
            x: prevX + (px - prevX) * s / steps,
            y: prevY + (py - prevY) * s / steps,
            color: obj.color,
            regionId: obj.id,
            stitchType: obj.stitch_type,
            layerType: obj.layerType,
          });
        }
      }
      commands.push({
        type: 'stitch',
        x: px,
        y: py,
        color: obj.color,
        regionId: obj.id,
        stitchType: obj.stitch_type,
        layerType: obj.layerType,
      });
      prevX = px;
      prevY = py;
      firstCmd = false;
    }
  }

  // END
  if (commands.length > 0) {
    const last = commands[commands.length - 1];
    commands.push({ type: 'end', x: last.x, y: last.y, color: null });
  }

  const { blob, meta } = buildDSTFromCommands(commands, {
    label: 'KIRBY_OUTLINE',
    ce01Strict: true,
  });

  console.log('[outline-only] objects:', objects.length);
  console.log('[outline-only] details:', detailRegions.length);
  console.log('[outline-only] outlines:', outlines.length);
  console.log('[outline-only] commands:', commands.length);
  console.log('[outline-only] stitches:', commands.filter(c => c.type === 'stitch').length);
  console.log('[outline-only] fills excluded: true');

  return { blob, meta };
}