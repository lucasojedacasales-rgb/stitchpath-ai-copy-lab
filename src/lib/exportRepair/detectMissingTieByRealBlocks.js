/**
 * detectMissingTieByRealBlocks.js — Medición de missingTie por bloques reales
 * ─────────────────────────────────────────────────────────────────────────────
 * El detector antiguo (exportErrorDetector/countMissingTie) agrupa por regionId
 * global: si una región aparece en varios puntos del fichero, cuenta un único
 * bloque. safeAddTieInTieOffV2 inserta ties en bloques consecutivos reales, por
 * lo que la medición por regionId no refleja los ties añadidos.
 *
 * Esta función cuenta bloques REALES: secuencias consecutivas de stitches cortadas
 * por jump / trim / colorChange / end / cambio de color / cambio de regionId.
 *
 * Reglas:
 *  1. Un bloque real = secuencia consecutiva de stitches.
 *  2. El bloque se corta al aparecer: jump, trim, colorChange, end, cambio de
 *     color, o cambio de regionId.
 *  3. Ignora bloques con < 4 stitches.
 *  4. Bloques de detalle (mouth/eye/facial/detail/outline/contour) se marcan
 *     como protected (no se exigen ties, pero se cuentan).
 *  5. tie-in reconocido si: alguno de los primeros 3 stitches tiene isTie=true
 *     y tieKind incluye 'TieIn', o el primer stitch real tiene hasTieIn=true.
 *  6. tie-off reconocido si: alguno de los últimos 3 stitches tiene isTie=true
 *     y tieKind incluye 'TieOff', o el último stitch real tiene hasTieOff=true.
 *
 * Devuelve:
 *   {
 *     realBlockCount,        // total de bloques ≥4 stitches
 *     protectedBlockCount,   // bloques de detalle (no cuentan como missing)
 *     evaluatedBlockCount,   // realBlockCount - protectedBlockCount
 *     missingTieIn,          // bloques evaluados sin tie-in
 *     missingTieOff,         // bloques evaluados sin tie-off
 *     blocksWithTieIn,       // bloques con tie-in reconocido
 *     blocksWithTieOff,      // bloques con tie-off reconocido
 *     blocks: [              // detalle por bloque
 *       { index, firstIdx, lastIdx, stitchCount, color, regionId,
 *         protected, hasTieIn, hasTieOff, tieInBy, tieOffBy }
 *     ]
 *   }
 */

function isImportantDetail(cmd) {
  const lt = String(cmd?.layerType || '').toLowerCase();
  const rc = String(cmd?.region_class || '').toLowerCase();
  return lt.includes('mouth') || lt.includes('eye') || lt.includes('facial') ||
    lt.includes('detail') || lt.includes('outline') || lt.includes('contour') ||
    rc.includes('detail') || rc.includes('mouth') || rc.includes('eye') ||
    rc.includes('outline') || rc.includes('contour');
}

function tieKindIncludes(kind, needle) {
  return typeof kind === 'string' && kind.toLowerCase().includes(needle.toLowerCase());
}

export function detectMissingTieByRealBlocks(commands) {
  const cmds = commands || [];
  const blocks = [];
  let cur = [];
  let curColor = null;
  let curRegion = null;

  const flush = () => {
    if (cur.length) {
      blocks.push(cur);
      cur = [];
    }
    curColor = null;
    curRegion = null;
  };

  for (const c of cmds) {
    if (!c) { continue; }
    if (c.type === 'stitch') {
      const colorChanged = curColor != null && c.color != null && c.color !== curColor;
      const regionChanged = curRegion != null && c.regionId != null && c.regionId !== curRegion;
      if (colorChanged || regionChanged) {
        flush();
      }
      cur.push(c);
      curColor = c.color ?? curColor;
      curRegion = c.regionId ?? curRegion;
    } else {
      // jump / trim / colorChange / end → corta el bloque
      flush();
    }
  }
  flush();

  let realBlockCount = 0;
  let protectedBlockCount = 0;
  let missingTieIn = 0;
  let missingTieOff = 0;
  let blocksWithTieIn = 0;
  let blocksWithTieOff = 0;
  const blockDetails = [];

  cmds; // (cmds ya iterado via blocks)
  for (let i = 0; i < blocks.length; i++) {
    const st = blocks[i];
    if (st.length < 4) continue;
    realBlockCount++;
    const first = st[0];
    const last = st[st.length - 1];
    const protectedBlock = isImportantDetail(first);
    if (protectedBlock) protectedBlockCount++;

    // ── tie-in: primeros 3 stitches con isTie + tieKind incluye TieIn, o first.hasTieIn ──
    let tieInBy = null;
    for (let k = 0; k < Math.min(3, st.length); k++) {
      if (st[k]?.isTie && tieKindIncludes(st[k]?.tieKind, 'TieIn')) { tieInBy = 'isTie:' + st[k].tieKind; break; }
    }
    if (!tieInBy && first?.hasTieIn) tieInBy = 'hasTieIn';
    const hasTieIn = !!tieInBy;

    // ── tie-off: últimos 3 stitches con isTie + tieKind incluye TieOff, o last.hasTieOff ──
    let tieOffBy = null;
    for (let k = st.length - 1; k >= Math.max(0, st.length - 3); k--) {
      if (st[k]?.isTie && tieKindIncludes(st[k]?.tieKind, 'TieOff')) { tieOffBy = 'isTie:' + st[k].tieKind; break; }
    }
    if (!tieOffBy && last?.hasTieOff) tieOffBy = 'hasTieOff';
    const hasTieOff = !!tieOffBy;

    if (hasTieIn) blocksWithTieIn++; else if (!protectedBlock) missingTieIn++;
    if (hasTieOff) blocksWithTieOff++; else if (!protectedBlock) missingTieOff++;

    blockDetails.push({
      index: i,
      firstIdx: 0,
      lastIdx: st.length - 1,
      stitchCount: st.length,
      color: first?.color ?? null,
      regionId: first?.regionId ?? null,
      protected: protectedBlock,
      hasTieIn,
      hasTieOff,
      tieInBy,
      tieOffBy,
    });
  }

  return {
    realBlockCount,
    protectedBlockCount,
    evaluatedBlockCount: realBlockCount - protectedBlockCount,
    missingTieIn,
    missingTieOff,
    blocksWithTieIn,
    blocksWithTieOff,
    blocks: blockDetails,
  };
}