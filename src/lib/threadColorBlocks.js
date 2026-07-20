/**
 * Thread Color Blocks — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Groups finalEmbroideryCommands by real thread color, and guarantees
 * colorChange commands exist between distinct color blocks before export.
 *
 * In DST format, colors are not stored as RGB — the machine stops at each
 * colorChange/STOP record so the operator can change thread manually.
 * Without real colorChange records, the machine sews everything with one
 * thread.
 */

/**
 * Groups commands into contiguous color blocks.
 * Each block = all commands sewn with one thread before a color change.
 *
 * @param {Array} commands — flat command sequence
 * @returns {Array<{ colorKey, colorHex, label, commands, stitchCount, layerTypes, order }>}
 */
export function buildThreadColorBlocks(commands = []) {
  const blocks = [];
  let currentBlock = null;
  let currentColor = null;

  for (const c of commands) {
    if (!c || !c.type) continue;
    if (c.type === 'end') break;

    // Explicit colorChange — close current block, start new one
    if (c.type === 'colorChange') {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = null;
      currentColor = c.color || currentColor;
      continue;
    }

    // Trim — belongs to the current block (preserves thread context)
    if (c.type === 'trim') {
      if (currentBlock) currentBlock.commands.push(c);
      continue;
    }

    if (c.type !== 'stitch' && c.type !== 'jump') continue;

    const cmdColor = c.color || currentColor || '#000000';

    // Color changed without explicit colorChange — start new block
    if (currentColor !== null && cmdColor !== currentColor) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = null;
    }
    currentColor = cmdColor;

    if (!currentBlock) {
      currentBlock = {
        colorKey: cmdColor,
        colorHex: cmdColor,
        label: `Block ${blocks.length + 1}`,
        commands: [],
        stitchCount: 0,
        layerTypes: new Set(),
        order: blocks.length,
      };
    }

    currentBlock.commands.push(c);
    if (c.type === 'stitch') currentBlock.stitchCount++;
    if (c.stitchType) currentBlock.layerTypes.add(c.stitchType);
  }

  if (currentBlock) blocks.push(currentBlock);

  // Convert layerTypes Set to array for serialization
  for (const b of blocks) {
    b.layerTypes = [...b.layerTypes];
  }

  return blocks;
}

/**
 * Rebuilds the command sequence guaranteeing colorChange records between
 * every pair of distinct color blocks.
 *
 * Rules:
 *   - No colorChange at the start
 *   - No colorChange at the end
 *   - colorChange only between two blocks of different color
 *   - N colors → N-1 colorChange records
 *
 * @param {Array} commands — original command sequence
 * @returns {Array} rebuilt sequence with guaranteed colorChange records
 */
export function ensureColorChangesBetweenBlocks(commands = []) {
  const blocks = buildThreadColorBlocks(commands);

  // Find END command
  const endCmd = commands.find(c => c && c.type === 'end') ||
    { type: 'end', x: 0, y: 0, color: null };

  if (blocks.length === 0) {
    return [endCmd];
  }

  if (blocks.length === 1) {
    return [...blocks[0].commands, endCmd];
  }

  // Rebuild: block1 → colorChange → block2 → colorChange → ... → blockN → end
  const result = [];
  for (let i = 0; i < blocks.length; i++) {
    result.push(...blocks[i].commands);

    if (i < blocks.length - 1) {
      const lastCmd = blocks[i].commands[blocks[i].commands.length - 1];
      result.push({
        type: 'colorChange',
        x: lastCmd?.x || 0,
        y: lastCmd?.y || 0,
        color: blocks[i + 1].colorHex,
        regionId: blocks[i + 1].commands[0]?.regionId,
      });
    }
  }

  result.push(endCmd);
  return result;
}

/**
 * Validates that colorChange count matches thread block count.
 * @returns {{ valid, colorChangeCount, blockCount, expectedColorChanges }}
 */
export function validateColorChangeIntegrity(commands = []) {
  const blocks = buildThreadColorBlocks(commands);
  const colorChangeCount = commands.filter(c => c && c.type === 'colorChange').length;
  const expectedColorChanges = Math.max(0, blocks.length - 1);

  return {
    valid: colorChangeCount === expectedColorChanges,
    colorChangeCount,
    blockCount: blocks.length,
    expectedColorChanges,
  };
}