/**
 * travelPolishForensics.js — TRAVEL_POLISH_FORENSICS.md (FASE 1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Análisis de solo lectura del travel excesivo sobre repairedCommands V5.
 * No modifica comandos. Lista jumps/trips totales, por color, redundancias,
 * consecutivos, color changes sin puntadas, microbloques, distancias y el
 * top 50 de travels más costosos con proposedFix.
 */
const TRIM_THRESHOLD = 3.5;

export function generateTravelPolishForensics(commands, objects = [], regions = [], config = {}) {
  const cmds = commands || [];
  const md = [];
  md.push('# TRAVEL_POLISH_FORENSICS — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Análisis de travel excesivo sobre repairedCommands V5 (solo lectura).\n');

  let totalJumps = 0, totalTrims = 0, totalStitches = 0;
  const jumpsByColor = new Map();
  const trimsByColor = new Map();
  const travels = [];
  let lastX = 0, lastY = 0, lastColor = null;
  let consecutiveJumps = 0, consecutiveTrims = 0;
  let trimJumpTrim = 0;
  let colorChangeNoStitch = 0;
  let tinyBlocks = 0;
  let stitchesSinceMarker = 0;
  let prevCmd = null;
  let blockStitchCount = 0;

  const addColor = (map, c) => { const k = c || 'unknown'; map.set(k, (map.get(k) || 0) + 1); };

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (!c || !c.type) continue;
    if (c.type === 'stitch') {
      totalStitches++;
      stitchesSinceMarker++;
      blockStitchCount++;
      lastX = c.x ?? 0; lastY = c.y ?? 0; lastColor = c.color ?? lastColor;
    } else if (c.type === 'jump') {
      totalJumps++;
      addColor(jumpsByColor, lastColor);
      const dist = Math.hypot((c.x ?? 0) - lastX, (c.y ?? 0) - lastY);
      const nextC = cmds[i + 1];
      let reason = 'travel entre bloques';
      let fix = 'evaluar colapso si hay jumps consecutivos';
      if (prevCmd && prevCmd.type === 'jump') { consecutiveJumps++; reason = 'jump consecutivo'; fix = 'colapsar a jump único al último destino'; }
      if (prevCmd && prevCmd.type === 'trim' && nextC && nextC.type === 'trim') { trimJumpTrim++; reason = 'secuencia trim+jump+trim redundante'; fix = 'eliminar trim redundante (uno de los dos)'; }
      travels.push({ idx: i, type: 'jump', fromX: lastX, fromY: lastY, toX: c.x ?? 0, toY: c.y ?? 0, dist, color: lastColor, prevType: prevCmd?.type, nextType: nextC?.type, reason, fix });
      lastX = c.x ?? 0; lastY = c.y ?? 0;
    } else if (c.type === 'trim') {
      totalTrims++;
      addColor(trimsByColor, lastColor);
      if (prevCmd && prevCmd.type === 'trim') consecutiveTrims++;
      if (blockStitchCount > 0 && blockStitchCount < 4) tinyBlocks++;
      blockStitchCount = 0;
    } else if (c.type === 'colorChange') {
      if (stitchesSinceMarker === 0) colorChangeNoStitch++;
      stitchesSinceMarker = 0;
      blockStitchCount = 0;
    } else if (c.type === 'end') {
      // noop
    }
    prevCmd = c;
  }

  const jumpDists = travels.map(t => t.dist).filter(d => Number.isFinite(d));
  const meanJump = jumpDists.length ? jumpDists.reduce((a, b) => a + b, 0) / jumpDists.length : 0;
  const maxJump = jumpDists.length ? Math.max(...jumpDists) : 0;
  const top50 = [...travels].sort((a, b) => b.dist - a.dist).slice(0, 50);

  // ── 1. Resumen ──
  md.push('## 1. Resumen\n');
  md.push(`- total stitches: **${totalStitches}**`);
  md.push(`- total jumps: **${totalJumps}**`);
  md.push(`- total trims: **${totalTrims}**`);
  md.push(`- distancia media de jump: **${meanJump.toFixed(2)} mm**`);
  md.push(`- distancia máxima de jump: **${maxJump.toFixed(2)} mm**`);
  md.push(`- jumps consecutivos (pares adyacentes): **${consecutiveJumps}**`);
  md.push(`- trims consecutivos (pares adyacentes): **${consecutiveTrims}**`);
  md.push(`- secuencias trim+jump+trim redundantes: **${trimJumpTrim}**`);
  md.push(`- color changes sin puntadas reales entre medias: **${colorChangeNoStitch}**`);
  md.push(`- microbloques (<4 stitches) que generan trim: **${tinyBlocks}**`);
  md.push('');

  // ── 2. Jumps por color ──
  md.push('## 2. Jumps por color\n');
  md.push('| color | jumps |');
  md.push('|---|---|');
  if (jumpsByColor.size === 0) md.push('| — | 0 |');
  for (const [k, v] of jumpsByColor) md.push(`| ${k} | ${v} |`);
  md.push('');

  // ── 3. Trims por color ──
  md.push('## 3. Trims por color\n');
  md.push('| color | trims |');
  md.push('|---|---|');
  if (trimsByColor.size === 0) md.push('| — | 0 |');
  for (const [k, v] of trimsByColor) md.push(`| ${k} | ${v} |`);
  md.push('');

  // ── 4. Top 50 travels más costosos ──
  md.push('## 4. Top 50 travels más costosos\n');
  md.push('| # | cmdIdx | type | from (x,y) | to (x,y) | dist mm | color | prev | next | reason | proposedFix |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|');
  if (top50.length === 0) md.push('| — | — | — | — | — | — | — | — | — | sin travels | — |');
  top50.forEach((t, k) => {
    md.push(`| ${k + 1} | ${t.idx} | ${t.type} | (${t.fromX.toFixed(1)},${t.fromY.toFixed(1)}) | (${t.toX.toFixed(1)},${t.toY.toFixed(1)}) | ${t.dist.toFixed(2)} | ${t.color || '—'} | ${t.prevType || '—'} | ${t.nextType || '—'} | ${t.reason} | ${t.fix} |`);
  });
  md.push('');

  md.push('---');
  md.push('_Forensics de travel sobre repairedCommands V5. Solo lectura. No modifica comandos._');
  return md.join('\n');
}