/**
 * emptyBlockForensics.js — EMPTY_BLOCK_FORENSICS.md
 * ─────────────────────────────────────────────────────────────────────────────
 * Forense legible de bloques vacíos restantes tras removeEmptyBlocks.
 * NO imprime [object Object] — serializa cada comando en JSON compacto.
 *
 * Generado a partir de la lista de comandos (repairedCandidate o source) y,
 * opcionalmente, del report.unremovableBlocks producido por removeEmptyBlocks.
 */
function describeCmd(c) {
  if (!c) return 'none';
  return JSON.stringify({
    type: c.type,
    x: c.x,
    y: c.y,
    color: c.color || null,
    regionId: c.regionId || null,
    layerType: c.layerType || null,
    stitchType: c.stitchType || null,
  });
}

/**
 * @param {Array} commands  comandos a inspeccionar (repairedCandidate o source)
 * @param {Array} unremovable  report.unremovableBlocks de removeEmptyBlocks (opcional)
 * @returns {string} markdown EMPTY_BLOCK_FORENSICS.md
 */
export function generateEmptyBlockForensics(commands, unremovable = []) {
  const cmds = commands || [];
  const md = [];
  md.push('# EMPTY_BLOCK_FORENSICS — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Forense de bloques vacíos (0 stitches) restantes tras removeEmptyBlocks.');
  md.push('> Serialización JSON legible — sin [object Object].\n');

  // ── Escanear bloques vacíos directamente de los comandos ──
  const empty = [];
  let blockIndex = 0;
  let blockStart = 0, blockSt = 0;
  for (let i = 0; i <= cmds.length; i++) {
    const c = cmds[i];
    if (!c || c.type === 'colorChange' || c.type === 'end' || i === cmds.length) {
      if (blockSt === 0 && i > blockStart) {
        const seg = cmds.slice(blockStart, i);
        empty.push(buildBlock(blockIndex, blockStart, i, seg, cmds));
      }
      blockIndex++;
      blockStart = i; blockSt = 0;
    } else if (c.type === 'stitch') blockSt++;
  }

  md.push(`## Resumen\n`);
  md.push(`- bloques vacíos detectados: **${empty.length}**`);
  md.push(`- total comandos: **${cmds.length}**\n`);

  if (empty.length === 0) {
    md.push('## Bloques vacíos\n');
    md.push('_Ninguno — todos los bloques tienen al menos 1 stitch._\n');
    md.push('---');
    md.push('_Forense de bloques vacíos. Solo lectura._');
    return md.join('\n');
  }

  // ── Tabla resumen ──
  md.push('## Tabla resumen\n');
  md.push('| # | startIdx | endIdx | color | onlyCC | onlyJumpTrim | hasEnd | leading | trailing | betweenCC | removable | whyEmpty |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of empty) {
    md.push(`| ${b.blockIndex} | ${b.startCommandIndex} | ${b.endCommandIndex} | ${b.color} | ${b.hasOnlyColorChange} | ${b.hasOnlyJumpTrim} | ${b.hasEnd} | ${b.isLeadingBlock} | ${b.isTrailingBlock} | ${b.isBetweenColorChanges} | ${b.removable ? '✅' : '❌'} | ${b.whyEmpty} |`);
  }
  md.push('');

  // ── Detalle por bloque ──
  md.push('## Detalle por bloque\n');
  for (const b of empty) {
    md.push(`### Bloque #${b.blockIndex} — [${b.startCommandIndex}, ${b.endCommandIndex})`);
    md.push(`- **color**: \`${b.color}\``);
    md.push(`- **hasStitches**: ${b.hasStitches}`);
    md.push(`- **hasOnlyColorChange**: ${b.hasOnlyColorChange}`);
    md.push(`- **hasOnlyJumpTrim**: ${b.hasOnlyJumpTrim}`);
    md.push(`- **hasEnd**: ${b.hasEnd}`);
    md.push(`- **isLeadingBlock**: ${b.isLeadingBlock}`);
    md.push(`- **isTrailingBlock**: ${b.isTrailingBlock}`);
    md.push(`- **isBetweenColorChanges**: ${b.isBetweenColorChanges}`);
    md.push(`- **createdByColorReduction**: ${b.createdByColorReduction}`);
    md.push(`- **whyEmpty**: ${b.whyEmpty}`);
    md.push(`- **proposedFix**: ${b.proposedFix}`);
    md.push(`- **removable**: ${b.removable}`);
    if (b.whyNotRemovable) md.push(`- **whyNotRemovable**: ${b.whyNotRemovable}`);
    md.push(`- **previousCommand**: \`${b.previousCommand}\``);
    md.push(`- **nextCommand**: \`${b.nextCommand}\``);
    md.push(`- **commandsInsideBlock** (${b.commandsInsideBlock.length}):`);
    for (const s of b.commandsInsideBlock) md.push(`  - \`${s}\``);
    md.push('');
  }

  // ── Forense de removeEmptyBlocks (si se proporcionó) ──
  if (unremovable && unremovable.length) {
    md.push('## Forense interno de removeEmptyBlocks (unremovableBlocks)\n');
    md.push('| # | startIdx | color | whyEmpty | proposedFix | removable | whyNotRemovable |');
    md.push('|---|---|---|---|---|---|---|');
    for (const b of unremovable) {
      md.push(`| ${b.blockIndex ?? '—'} | ${b.startCommandIndex ?? '—'} | ${b.color ?? '—'} | ${b.whyEmpty ?? '—'} | ${b.proposedFix ?? '—'} | ${b.removable ? '✅' : '❌'} | ${b.whyNotRemovable ?? '—'} |`);
    }
    md.push('');
  }

  // ── Recomendación global ──
  md.push('## Recomendación global\n');
  const allRemovable = empty.every(b => b.removable);
  if (allRemovable) {
    md.push('- Todos los bloques vacíos son removibles por removeEmptyBlocks.');
    md.push('- Re-ejecutar removeEmptyBlocks (más pasadas) debería llevar emptyBlocks a 0.');
  } else {
    md.push('- Algunos bloques no son removibles por removeEmptyBlocks (caso no cubierto).');
    md.push('- Revisar la función indicada en `proposedFix` para cubrir el caso restante.');
  }
  md.push('');

  md.push('---');
  md.push('_Forense de bloques vacíos. Solo lectura. No modifica comandos._');
  return md.join('\n');
}

function buildBlock(blockIndex, startIdx, endIdx, seg, cmds) {
  const hasStitches = seg.some(c => c.type === 'stitch');
  const hasColorChange = seg.some(c => c.type === 'colorChange');
  const hasJumpTrim = seg.some(c => c.type === 'jump' || c.type === 'trim');
  const hasEnd = seg.some(c => c.type === 'end');
  const hasOnlyColorChange = hasColorChange && !hasJumpTrim && !hasEnd && !hasStitches;
  const hasOnlyJumpTrim = !hasStitches && !hasColorChange && hasJumpTrim;
  const isLeadingBlock = startIdx === 0;
  const isTrailingBlock = endIdx === cmds.length;
  const prevCmd = startIdx > 0 ? cmds[startIdx - 1] : null;
  const nextCmd = endIdx < cmds.length ? cmds[endIdx] : null;
  const isBetweenColorChanges =
    (prevCmd?.type === 'colorChange' || isLeadingBlock) &&
    (nextCmd?.type === 'colorChange' || isTrailingBlock);

  let whyEmpty, proposedFix, removable = true, whyNotRemovable = null;
  if (hasOnlyColorChange) {
    whyEmpty = 'colorChange sin stitches antes del siguiente colorChange/EOF';
    proposedFix = 'eliminar colorChange redundante (no produce stitches)';
  } else if (hasEnd && !hasJumpTrim && !hasColorChange) {
    whyEmpty = 'bloque final con solo marcador end';
    proposedFix = 'dropear end — el encoder DST reañade END automáticamente';
  } else if (hasOnlyJumpTrim && isBetweenColorChanges) {
    whyEmpty = 'jump/trim sueltos entre colorChanges sin stitches';
    proposedFix = 'eliminar jumps/trims del bloque vacío + colorChange del bloque adyacente';
  } else if (isLeadingBlock) {
    whyEmpty = 'bloque inicial sin stitches reales';
    proposedFix = 'eliminar todos los jumps/trims iniciales';
  } else if (isTrailingBlock) {
    whyEmpty = 'bloque final sin stitches reales';
    proposedFix = 'eliminar jumps/trims finales + colorChange del bloque final';
  } else {
    whyEmpty = 'bloque vacío residual no clasificado';
    proposedFix = 'revisar removeEmptyBlocks — caso no cubierto';
    removable = false;
    whyNotRemovable = 'caso no cubierto por removeEmptyBlocks';
  }

  return {
    blockIndex,
    startCommandIndex: startIdx,
    endCommandIndex: endIdx,
    color: seg[0]?.color || '—',
    previousCommand: describeCmd(prevCmd),
    nextCommand: nextCmd ? describeCmd(nextCmd) : 'EOF',
    commandsInsideBlock: seg.map(describeCmd),
    hasStitches,
    hasOnlyColorChange,
    hasOnlyJumpTrim,
    hasEnd,
    isTrailingBlock,
    isLeadingBlock,
    isBetweenColorChanges,
    createdByColorReduction: false,
    whyEmpty,
    proposedFix,
    removable,
    whyNotRemovable,
  };
}