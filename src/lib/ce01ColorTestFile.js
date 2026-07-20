/**
 * CE01 Color Test File — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a minimal 3-color DST test file for the Caydo CE01.
 *
 * Design: 3 small squares (red, blue, black) with 2 real colorChange records.
 * The machine should display 3 color steps or stop twice for thread changes.
 *
 * This bypasses all visual optimizers — the colorChange records are hardcoded.
 */

import { buildDSTFromCommands } from './dstDirectExport';

/**
 * Builds a minimal 3-color command sequence.
 * @returns {Array} commands with 2 colorChange records
 */
export function build3ColorTestCommands() {
  const commands = [];

  // ── Block 1: Red square (20×20mm, centered at x=-25) ──────────────────
  const red = '#E53935';
  // Jump to start (from origin)
  commands.push({ type: 'jump', x: -35, y: -10, color: red, regionId: 'test_red' });
  commands.push({ type: 'jump', x: -35, y: -10, color: red, regionId: 'test_red' });
  // Square perimeter
  const redSquare = [
    [-35, -10], [-15, -10], [-15, 10], [-35, 10], [-35, -10]
  ];
  for (const [x, y] of redSquare) {
    commands.push({ type: 'stitch', x, y, color: red, stitchType: 'running_stitch', regionId: 'test_red' });
  }

  // ── Color change 1: red → blue ────────────────────────────────────────
  commands.push({ type: 'colorChange', x: -15, y: 10, color: '#1E88E5', regionId: 'test_blue' });

  // ── Block 2: Blue square (20×20mm, centered at x=0) ───────────────────
  const blue = '#1E88E5';
  commands.push({ type: 'jump', x: -10, y: -10, color: blue, regionId: 'test_blue' });
  const blueSquare = [
    [-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]
  ];
  for (const [x, y] of blueSquare) {
    commands.push({ type: 'stitch', x, y, color: blue, stitchType: 'running_stitch', regionId: 'test_blue' });
  }

  // ── Color change 2: blue → black ──────────────────────────────────────
  commands.push({ type: 'colorChange', x: 10, y: 10, color: '#000000', regionId: 'test_black' });

  // ── Block 3: Black square (20×20mm, centered at x=25) ─────────────────
  const black = '#000000';
  commands.push({ type: 'jump', x: 15, y: -10, color: black, regionId: 'test_black' });
  const blackSquare = [
    [15, -10], [35, -10], [35, 10], [15, 10], [15, -10]
  ];
  for (const [x, y] of blackSquare) {
    commands.push({ type: 'stitch', x, y, color: black, stitchType: 'running_stitch', regionId: 'test_black' });
  }

  // END
  commands.push({ type: 'end', x: 35, y: -10, color: null });

  return commands;
}

/**
 * Generates and downloads a 3-color DST test file.
 * @returns {{ bytes, blob, meta, commands }}
 */
export function generate3ColorTestDST() {
  const commands = build3ColorTestCommands();
  const { bytes, blob, meta } = buildDSTFromCommands(commands, {
    label: 'CE01_3COLOR_TEST',
    ce01Strict: true,
  });

  // ── Logs ──────────────────────────────────────────────────────────────
  const colorChanges = commands.filter(c => c.type === 'colorChange').length;
  console.log('[color-test] 3-color test file generated');
  console.log('[color-test] colorChanges:', colorChanges);
  console.log('[color-test] header CO:', meta.colorChanges);
  console.log('[color-test] expected machine colors:', colorChanges + 1);
  console.log('[color-test] file size:', meta.fileSize);

  return { bytes, blob, meta, commands };
}