/**
 * unifiedCommandMetrics.js
 *
 * SINGLE SOURCE OF TRUTH for raw command metrics.
 * Every panel that needs stitch/jump/trim/color counts MUST use this function.
 *
 * This prevents the "221 jumps vs 803 jumps" discrepancy that occurs when
 * different panels compute metrics from different command sources.
 *
 * Rule: finalEmbroideryCommands is the ONLY valid command source.
 */

/**
 * Calculate unified metrics from a command array.
 *
 * @param {Array} commands — finalEmbroideryCommands.commands
 * @param {Array} regions  — visual regions (for outside-region checks)
 * @param {Object} machineSettings — maxStitchLength, hoopSize, etc.
 * @returns {Object} unified metrics
 */
export function calculateUnifiedCommandMetrics(commands, regions = [], machineSettings = {}) {
  if (!commands || commands.length === 0) {
    return {
      source: 'finalEmbroideryCommands',
      totalCommands: 0,
      stitchCount: 0,
      jumpCount: 0,
      trimCount: 0,
      colorCount: 0,
      colorChanges: 0,
      shortStitches: 0,
      longStitches: 0,
      outsideHoop: 0,
      maxJumpDist: 0,
      synced: true,
    };
  }

  const maxStitch = machineSettings.maxStitchLength || 12.1;
  const maxJump = machineSettings.maxJumpLength || 12.1;
  const hoopW = machineSettings.hoopSize?.[0] || 100;
  const hoopH = machineSettings.hoopSize?.[1] || 100;
  const shortThreshold = 0.5; // mm — stitches shorter than this are "short"

  let stitchCount = 0;
  let jumpCount = 0;
  let trimCount = 0;
  let colorChanges = 0;
  let shortStitches = 0;
  let longStitches = 0;
  let outsideHoop = 0;
  let maxJumpDist = 0;

  const colors = new Set();
  let prevX = null, prevY = null;
  let prevType = null;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];

    if (c.type === 'stitch') {
      stitchCount++;
      if (c.color) colors.add(c.color);

      // Distance from previous point (stitch or jump)
      if (prevX !== null && (prevType === 'stitch' || prevType === 'jump')) {
        const dist = Math.hypot(c.x - prevX, c.y - prevY);
        if (dist > maxStitch) longStitches++;
        if (dist > 0 && dist < shortThreshold) shortStitches++;
      }

      // Check hoop bounds
      if (Math.abs(c.x) > hoopW / 2 || Math.abs(c.y) > hoopH / 2) {
        outsideHoop++;
      }
    } else if (c.type === 'jump') {
      jumpCount++;
      if (prevX !== null) {
        const dist = Math.hypot(c.x - prevX, c.y - prevY);
        if (dist > maxJumpDist) maxJumpDist = dist;
      }
    } else if (c.type === 'trim') {
      trimCount++;
    } else if (c.type === 'colorChange') {
      colorChanges++;
      if (c.color) colors.add(c.color);
    }

    if (c.x !== undefined && c.x !== null) {
      prevX = c.x;
      prevY = c.y;
      prevType = c.type;
    }
  }

  const metrics = {
    source: 'finalEmbroideryCommands',
    totalCommands: commands.length,
    stitchCount,
    jumpCount,
    trimCount,
    colorCount: colors.size,
    colorChanges,
    shortStitches,
    longStitches,
    outsideHoop,
    maxJumpDist: +maxJumpDist.toFixed(2),
    synced: true,
  };

  console.log('[command-sync] unified metrics:', {
    stitches: metrics.stitchCount,
    jumps: metrics.jumpCount,
    trims: metrics.trimCount,
    colors: metrics.colorCount,
  });

  return metrics;
}

/**
 * Compare two metric sets and return whether they match.
 * Used by the pre-export sync validation.
 */
export function metricsMatch(a, b) {
  if (!a || !b) return false;
  const fields = ['stitchCount', 'jumpCount', 'trimCount', 'colorCount', 'longStitches', 'shortStitches'];
  for (const f of fields) {
    if (a[f] !== b[f]) {
      console.log(`[command-sync] mismatch in ${f}: ${a[f]} vs ${b[f]}`);
      return false;
    }
  }
  return true;
}