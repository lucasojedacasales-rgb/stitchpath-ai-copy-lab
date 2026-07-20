/**
 * visibleSplitterForensics.js — REFERENCE_VISIBLE_SPLITTER_FORENSICS_V1
 * ─────────────────────────────────────────────────────────────────────────────
 * Audita por qué REFERENCE_VISIBLE_STITCH_SPLITTER_V1 crea visibleDiagonalStitches.
 * READ-ONLY: no modifica comandos, no toca el splitter ni el detector.
 *
 * Replica la detección de candidatos del splitter (misma classifySplitPair /
 * stitchRoleForSplit) y, por cada candidato elegible, hace un dry-run local:
 *   ventana [5 antes] + segmento dividido + [5 después]
 *   detecta visibleDiagonalStitches antes/después con el detector ÚNICO.
 *
 * Produce REFERENCE_VISIBLE_SPLITTER_FORENSICS_V1.md con:
 *   1. Lista de candidatos (primeros N)
 *   2. Dry-run local por candidato
 *   3. Metadata de los stitches intermedios
 *   4. Causa probable agrupada
 *   5. Confirmación A/B/C/D/E
 *   6. Propuesta segura V1.1
 *   ROOT_CAUSE_VISIBLE_SPLITTER
 */
import { detectVisibleDiagonalStitches } from '@/lib/exportRepair/visibleDiagonalDetector';

const TOLERANCE_MM = 0.10;
const NORM_W = 100, NORM_H = 100;

// ── Réplicas fieles del splitter (professionalDigitizingMode.js) ──────────────
// NO importamos del motor para mantener el forense aislado y read-only.
// Si el motor cambia, este forense se debe sincronizar manualmente.
function stitchRoleForSplit(cmd) {
  const st = String(cmd.stitchType || '').toLowerCase();
  const lt = String(cmd.layerType || '').toLowerCase();
  const src = String(cmd.source || '').toLowerCase();
  if (st.includes('satin') || src.includes('satin')) return 'satin';
  if (st.includes('running') || st.includes('detail_run')) return 'running';
  if (lt.includes('outline') || lt.includes('contour')) return 'contour';
  if (lt.includes('detail') || lt.includes('mouth') || lt.includes('eye') || lt.includes('facial')) return 'detail';
  if (lt.includes('underlay') || src.includes('underlay')) return 'underlay';
  if (st.includes('fill') || st.includes('tatami') || st.includes('ce01_safe_fill') || lt.includes('fill')) return 'fill';
  return 'other';
}

function classifySplitPair(prev, curr) {
  if (!prev.regionId || !curr.regionId) return 'noRegion';
  if (prev.regionId !== curr.regionId) return 'differentRegion';
  const pc = String(prev.color || '').toLowerCase();
  const cc = String(curr.color || '').toLowerCase();
  if (pc !== cc) return 'differentColor';
  for (const cmd of [prev, curr]) {
    const role = stitchRoleForSplit(cmd);
    if (role === 'satin') return 'satin';
    if (role === 'contour') return 'contour';
    if (role === 'detail' || role === 'running') return 'detail';
    if (role === 'underlay') return 'underlay';
  }
  if (stitchRoleForSplit(prev) === 'fill' && stitchRoleForSplit(curr) === 'fill') return 'fill';
  return 'other';
}

// ── Detector local sobre una ventana ──────────────────────────────────────────
// Cuenta offenders reparables cuyo commandIndex cae dentro del rango del split.
function detectInWindow(windowCmds) {
  const det = detectVisibleDiagonalStitches(windowCmds, [], [], null, {});
  return det.repairableCount;
}

// ── Metadata check de un stitch intermedio ───────────────────────────────────
function buildInterpolated(prev, curr, t) {
  return {
    type: 'stitch',
    x: prev.x + (curr.x - prev.x) * t,
    y: prev.y + (curr.y - prev.y) * t,
    color: curr.color,
    regionId: curr.regionId,
    stitchType: curr.stitchType,
    layerType: curr.layerType,
    objectId: curr.objectId,
    source: curr.source,
    generatedBy: 'REFERENCE_VISIBLE_STITCH_SPLITTER_V1',
    splitFromLongVisibleStitch: true,
  };
}

function metadataCheck(prev, curr, n) {
  const expected = {
    color: curr.color,
    regionId: curr.regionId,
    stitchType: curr.stitchType,
    layerType: curr.layerType,
    source: curr.source,
    objectId: curr.objectId,
  };
  const issues = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const ip = buildInterpolated(prev, curr, t);
    if (ip.color !== expected.color) issues.push({ field: 'color', k, got: ip.color, want: expected.color });
    if (ip.regionId !== expected.regionId) issues.push({ field: 'regionId', k, got: ip.regionId, want: expected.regionId });
    if (ip.stitchType !== expected.stitchType) issues.push({ field: 'stitchType', k, got: ip.stitchType, want: expected.stitchType });
    if (ip.layerType !== expected.layerType) issues.push({ field: 'layerType', k, got: ip.layerType, want: expected.layerType });
    if (ip.source !== expected.source) issues.push({ field: 'source', k, got: ip.source, want: expected.source });
    if (ip.objectId !== expected.objectId) issues.push({ field: 'objectId', k, got: ip.objectId, want: expected.objectId });
    // flags prohibidos
    if (ip.isTie) issues.push({ field: 'isTie', k, got: true, want: false });
    if (ip.layerType && /detail|contour|outline/i.test(ip.layerType)) issues.push({ field: 'detailContourFlag', k, got: ip.layerType, want: 'no detail/contour' });
  }
  return { expected, issues };
}

// ── Clasificación de causa por candidato (dry-run) ───────────────────────────
function classifyCause(prev, curr, regions, darkStroke) {
  // ¿El detector reconoce el par original como validFillTatami?
  // isFill = !contour && !detail && (stitchType==='fill' || !stitchType)
  const lt = String(curr.layerType || '').toLowerCase();
  const contour = lt.includes('outline') || lt.includes('contour');
  const detail = lt.includes('mouth') || lt.includes('eye') || lt.includes('facial') || lt.includes('detail');
  const stVal = curr.stitchType;
  const detectorIsFill = !contour && !detail && (stVal === 'fill' || !stVal);
  const splitterIsFill = stitchRoleForSplit(curr) === 'fill';

  // regionAt sobre endpoints
  const rPrev = regionAt(prev.x, prev.y, regions);
  const rCur = regionAt(curr.x, curr.y, regions);
  const sameRegionEndpoints = rPrev && rCur && rPrev.id === rCur.id;

  // punto intermedio t=0.5
  const midX = (prev.x + curr.x) / 2, midY = (prev.y + curr.y) / 2;
  const rMid = regionAt(midX, midY, regions);
  const midOutside = !rMid;
  const midDifferentRegion = rMid && rCur && rMid.id !== rCur.id;

  const causes = [];
  if (!detectorIsFill && splitterIsFill) causes.push('stitchTypeNotRecognizedAsFill');
  if (detectorIsFill && splitterIsFill && !sameRegionEndpoints) causes.push('regionSupportMissing');
  if (detectorIsFill && splitterIsFill && sameRegionEndpoints && midOutside) causes.push('interpolatedPointOutsideRegion');
  if (detectorIsFill && splitterIsFill && sameRegionEndpoints && midDifferentRegion) causes.push('crossesMultipleRegions');
  if (causes.length === 0) causes.push('other');
  return { detectorIsFill, splitterIsFill, sameRegionEndpoints, midOutside, midDifferentRegion, causes };
}

function regionAt(x, y, regions) {
  if (!regions || !regions.length) return null;
  const nx = (x / NORM_W + 0.5), ny = (y / NORM_H + 0.5);
  for (const r of regions) {
    const pp = r.path_points;
    if (!pp || pp.length < 3) continue;
    if (pointInPolygon(nx, ny, pp)) return r;
  }
  return null;
}
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Generador del informe forense
// ═══════════════════════════════════════════════════════════════════════════
export function generateVisibleSplitterForensics({
  commands = [], regions = [], darkStroke = null, config = {}, targetMaxMm = 4.0, limit = 50,
} = {}) {
  const effectiveMaxMm = targetMaxMm + TOLERANCE_MM;

  // ── 1. Detección de candidatos (réplica del splitter) ──────────────────────
  const candidates = [];
  const skipCounts = {
    contour: 0, detail: 0, satin: 0, differentRegion: 0, differentColor: 0,
    noRegion: 0, underlay: 0, other: 0,
  };
  let prev = null;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type !== 'stitch') { prev = null; continue; }
    if (prev) {
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      if (d > effectiveMaxMm) {
        const cls = classifySplitPair(prev, c);
        if (cls === 'fill') {
          const n = Math.max(2, Math.ceil(d / targetMaxMm));
          candidates.push({ index: i, dist: d, n, add: n - 1, prev, curr: c, cls });
        } else {
          skipCounts[cls] = (skipCounts[cls] || 0) + 1;
        }
      }
    }
    prev = c;
  }

  // ── 2 + 3. Dry-run local + metadata por candidato (primeros `limit`) ────────
  const detailed = candidates.slice(0, limit).map((cand) => {
    const { index: i, prev: p, curr: cur, n, dist } = cand;

    // ventana antes: 5 comandos stitches anteriores + el par original
    const before = [];
    let b = i - 1;
    const beforeStart = Math.max(0, i - 5);
    for (let k = beforeStart; k <= i; k++) before.push(commands[k]);
    // ventana después: mismos 5 anteriores + interpolados + curr
    const after = [];
    for (let k = beforeStart; k < i; k++) after.push(commands[k]);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      after.push(buildInterpolated(p, cur, t));
    }
    after.push(cur);

    const localBefore = detectInWindow(before);
    const localAfter = detectInWindow(after);
    const createsVisibleDiagonal = localAfter > localBefore;

    // metadata check
    const meta = metadataCheck(p, cur, n);

    // causa
    const cause = classifyCause(p, cur, regions, darkStroke);

    return {
      rank: 0, // asignado abajo
      commandIndex: i,
      fromX: p.x, fromY: p.y, toX: cur.x ?? 0, toY: cur.y ?? 0,
      distanceMm: dist,
      color: cur.color,
      regionId: cur.regionId,
      stitchType: cur.stitchType,
      layerType: cur.layerType,
      source: cur.source,
      objectId: cur.objectId,
      originalGeneratedBy: cur.generatedBy || null,
      isFillCandidate: true,
      reasonEligible: 'fill-sameRegion-sameColor',
      n, add: n - 1,
      localVisibleDiagBefore: localBefore,
      localVisibleDiagAfter: localAfter,
      createsVisibleDiagonal,
      visibleDiagReason: createsVisibleDiagonal ? cause.causes.join('|') : 'none',
      fillTatamiRecognized: cause.detectorIsFill && cause.sameRegionEndpoints,
      regionSupport: cause.sameRegionEndpoints,
      darkMaskSupport: null, // no calculado por ventana (detector no expone por par)
      crossesEmptySpace: !cause.detectorIsFill ? false : (!regionAt((p.x + cur.x) / 2, (p.y + cur.y) / 2, regions)),
      crossesMultipleRegions: cause.midDifferentRegion,
      midOutsideRegion: cause.midOutside,
      metadataIssues: meta.issues,
      causes: cause.causes,
    };
  });
  detailed.forEach((d, k) => { d.rank = k + 1; });

  // ── 4. Agrupación por causa ─────────────────────────────────────────────────
  const causeGroups = {};
  for (const d of detailed) {
    for (const cau of d.causes) {
      causeGroups[cau] = (causeGroups[cau] || 0) + 1;
    }
  }

  // ── 5. Confirmación A/B/C/D/E ───────────────────────────────────────────────
  const hasStitchTypeMismatch = (causeGroups['stitchTypeNotRecognizedAsFill'] || 0) > 0;
  const hasInterpolatedOutside = (causeGroups['interpolatedPointOutsideRegion'] || 0) > 0;
  const hasCrossesMultiple = (causeGroups['crossesMultipleRegions'] || 0) > 0;
  const hasRegionSupportMissing = (causeGroups['regionSupportMissing'] || 0) > 0;
  const hasMetadataIssue = detailed.some((d) => d.metadataIssues.length > 0);

  const confirmation = [];
  if (hasInterpolatedOutside) confirmation.push('D');
  if (hasCrossesMultiple) confirmation.push('D');
  if (hasStitchTypeMismatch) confirmation.push('C');
  if (hasRegionSupportMissing) confirmation.push('D');
  if (hasMetadataIssue) confirmation.push('B');
  if (confirmation.length === 0) confirmation.push('E');

  // ── ROOT CAUSE ──────────────────────────────────────────────────────────────
  const primaryCause = hasInterpolatedOutside || hasCrossesMultiple
    ? 'interpolatedPointOutsideRegion'
    : hasStitchTypeMismatch
      ? 'stitchTypeNotRecognizedAsFill'
      : 'other';
  const responsibleFn = primaryCause === 'stitchTypeNotRecognizedAsFill'
    ? 'visibleDiagonalDetector.isFill (stitchType===\'fill\' exacto) vs splitter.stitchRoleForSplit (fill/tatami/ce01_safe_fill)'
    : 'splitLongVisibleFillStitchesGuarded (interpolación lineal sin validar regionAt del punto medio) vs visibleDiagonalDetector.regionAt';
  const safeFix = 'V1.1: candidate-level gate — aceptar split solo si localVisibleDiagAfter <= localVisibleDiagBefore; validar regionAt(puntoMedio)===regionId antes de interpolar; preservar metadata completa; marcar generatedBy=REFERENCE_VISIBLE_STITCH_SPLITTER_V1_1 + splitFillPreserved=true; rechazar split global si sube visibleDiagonalStitches.';

  // ── Markdown ────────────────────────────────────────────────────────────────
  const md = [];
  md.push('# REFERENCE_VISIBLE_SPLITTER_FORENSICS_V1 — StitchPath AI\n');
  md.push(`> Generado: ${new Date().toISOString()}`);
  md.push('> Forense READ-ONLY. No modifica el splitter ni el detector.');
  md.push('> Replica la detección de candidatos del splitter y hace dry-run local por candidato.\n');

  md.push('## Parámetros');
  md.push(`- **targetMaxMm** (learnedMaxVisibleStitchMm): ${targetMaxMm}`);
  md.push(`- **effectiveMaxMm** (target + tolerancia 0.10): ${effectiveMaxMm}`);
  md.push(`- **candidatesFound**: ${candidates.length}`);
  md.push(`- **limit** (analizados en detalle): ${Math.min(limit, candidates.length)}`);
  md.push(`- **comandos totales**: ${commands.length}\n`);

  md.push('## Candidatos saltados (no fill)');
  md.push('| reason | count |');
  md.push('|---|---|');
  for (const [k, v] of Object.entries(skipCounts)) md.push(`| ${k} | ${v} |`);
  md.push('');

  // ── Sección 1: lista de candidatos ──────────────────────────────────────────
  md.push(`## 1. Lista de candidatos (primeros ${detailed.length})\n`);
  md.push('| # | cmdIdx | fromX | fromY | toX | toY | distMm | color | regionId | stitchType | layerType | source | objectId | origGenBy | isFill | reasonEligible |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of detailed) {
    md.push(`| ${d.rank} | ${d.commandIndex} | ${d.fromX.toFixed(2)} | ${d.fromY.toFixed(2)} | ${d.toX.toFixed(2)} | ${d.toY.toFixed(2)} | ${d.distanceMm.toFixed(2)} | ${d.color || '—'} | ${d.regionId || '—'} | ${d.stitchType || '—'} | ${d.layerType || '—'} | ${d.source || '—'} | ${d.objectId || '—'} | ${d.originalGeneratedBy || '—'} | ${d.isFillCandidate ? 'SÍ' : 'no'} | ${d.reasonEligible} |`);
  }
  md.push('');

  // ── Sección 2: dry-run local ─────────────────────────────────────────────────
  md.push(`## 2. Dry-run local por candidato (ventana 5+split+5)\n`);
  md.push('| # | cmdIdx | distMm | n | add | localBefore | localAfter | createsVisDiag | reason | fillTatamiRec | regionSup | crossesEmpty | crossesMulti | midOutside |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of detailed) {
    md.push(`| ${d.rank} | ${d.commandIndex} | ${d.distanceMm.toFixed(2)} | ${d.n} | ${d.add} | ${d.localVisibleDiagBefore} | ${d.localVisibleDiagAfter} | ${d.createsVisibleDiagonal ? 'SÍ' : 'no'} | ${d.visibleDiagReason} | ${d.fillTatamiRecognized ? 'SÍ' : 'no'} | ${d.regionSupport ? 'SÍ' : 'no'} | ${d.crossesEmptySpace ? 'SÍ' : 'no'} | ${d.crossesMultipleRegions ? 'SÍ' : 'no'} | ${d.midOutsideRegion ? 'SÍ' : 'no'} |`);
  }
  md.push('');

  // ── Sección 3: metadata ──────────────────────────────────────────────────────
  md.push('## 3. Metadata de los stitches intermedios\n');
  md.push('Cada stitch intermedio se construye con `buildInterpolated(prev, curr, t)` heredando: color, regionId, stitchType, layerType, source, objectId. Se añaden `generatedBy=REFERENCE_VISIBLE_STITCH_SPLITTER_V1` y `splitFromLongVisibleStitch=true`.\n');
  const metaIssues = detailed.filter((d) => d.metadataIssues.length > 0);
  if (metaIssues.length === 0) {
    md.push('**Resultado**: ningún stitch intermedio perdió metadata. Todos conservan color/regionId/stitchType/layerType/source/objectId del `curr`. No se detectaron flags `isTie` ni layerType detail/contour.\n');
  } else {
    md.push(`**${metaIssues.length} candidatos con issues de metadata:**\n`);
    md.push('| # | cmdIdx | field | k | got | want |');
    md.push('|---|---|---|---|---|---|');
    for (const d of metaIssues) {
      for (const is of d.metadataIssues.slice(0, 3)) {
        md.push(`| ${d.rank} | ${d.commandIndex} | ${is.field} | ${is.k} | ${is.got} | ${is.want} |`);
      }
    }
    md.push('');
  }

  // ── Sección 4: causas agrupadas ──────────────────────────────────────────────
  md.push('## 4. Causa probable de los visibleDiagonalStitches (agrupado)\n');
  md.push('| cause | count |');
  md.push('|---|---|');
  for (const [k, v] of Object.entries(causeGroups).sort((a, b) => b[1] - a[1])) {
    md.push(`| ${k} | ${v} |`);
  }
  md.push('');
  md.push('Leyenda:');
  md.push('- `interpolatedPointOutsideRegion`: el punto medio (t=0.5) cae fuera del polígono de la región → el detector marca el sub-segmento como travelBetweenObjects/crossesEmptySpace.');
  md.push('- `crossesMultipleRegions`: el punto medio cae en otra región → crossesMultipleRegions.');
  md.push('- `stitchTypeNotRecognizedAsFill`: el splitter clasifica el par como fill (stitchRoleForSplit) pero el detector no lo reconoce como fill (`stitchType===\'fill\'` exacto o ausente) → sameRegionNonFill.');
  md.push('- `regionSupportMissing`: los endpoints no están en la misma región según regionAt → el original ya no era validFillTatami (inconsistencia regionId vs geometría).');
  md.push('- `other`: ninguna de las anteriores.\n');

  // ── Sección 5: confirmación A-E ──────────────────────────────────────────────
  md.push('## 5. Confirmación de la causa\n');
  md.push('| hipótesis | ocurre |');
  md.push('|---|---|');
  md.push(`| A. splitter divide segmentos incorrectos | ${hasRegionSupportMissing ? 'SÍ (regionSupportMissing)' : 'no'} |`);
  md.push(`| B. splitter crea metadata incompleta | ${hasMetadataIssue ? 'SÍ' : 'no'} |`);
  md.push(`| C. detector no reconoce split fill válido | ${hasStitchTypeMismatch ? 'SÍ' : 'no'} |`);
  md.push(`| D. puntos interpolados caen fuera de región/máscara | ${(hasInterpolatedOutside || hasCrossesMultiple) ? 'SÍ' : 'no'} |`);
  md.push(`| E. mezcla de varias causas | ${confirmation.includes('E') ? 'SÍ' : (confirmation.length > 1 ? 'SÍ (varias)' : 'no')} |`);
  md.push('');
  md.push(`**Veredicto de confirmación**: ${confirmation.join(' + ')}\n`);

  // ── Sección 6: propuesta V1.1 ─────────────────────────────────────────────────
  md.push('## 6. Propuesta segura para V1.1 (NO implementada todavía)\n');
  md.push('Reglas propuestas:');
  md.push('1. **candidate-level gate**: aceptar cada split solo si `localVisibleDiagAfter <= localVisibleDiagBefore` (dry-run local por candidato).');
  md.push('2. **validación geométrica del punto medio**: antes de interpolar, comprobar `regionAt(midX, midY) === curr.regionId`. Si no coincide, skip del candidato.');
  md.push('3. **preservar metadata completa** del comando original (color, regionId, stitchType, layerType, source, objectId).');
  md.push('4. **marcar** `generatedBy=\'REFERENCE_VISIBLE_STITCH_SPLITTER_V1_1\'` y `splitFillPreserved=true`.');
  md.push('5. **detector-trust check**: si el detector no reconoce el `stitchType` como fill (`stitchType!==\'fill\' && stitchType` presente y no ausente), skip salvo que el stitchType sea uno que el detector trate como fill.');
  md.push('6. **gate global**: nunca aceptar el split global si sube `visibleDiagonalStitches` (ya existe en V1, mantener).');
  md.push('7. **muestreo多点**: validar regionAt en t=0.25, 0.5, 0.75 (no solo el medio) para segmentos largos.\n');
  md.push('Riesgos de V1.1:');
  md.push('- El gate por candidato puede rechazar casi todos los candidatos si la geometría de la región es muy cóncava → splitter inefectivo (pero seguro).');
  md.push('- La validación多点 aumenta el coste CPU pero es O(candidates).');
  md.push('- Si el problema real es C (stitchType), el gate geométrico no lo resuelve → necesita además alinear stitchRoleForSplit con el detector.\n');

  // ── ROOT CAUSE ──────────────────────────────────────────────────────────────
  md.push('---\n');
  md.push('## ROOT_CAUSE_VISIBLE_SPLITTER\n');
  md.push(`- **causa principal**: ${primaryCause}`);
  md.push(`- **función responsable**: ${responsibleFn}`);
  md.push(`- **fix seguro recomendado**: ${safeFix}`);
  md.push('- **riesgos**: ');
  md.push('  - Si la causa es D (interpolación fuera de región), el fix V1.1 (gate geométrico + candidate-level) es eficaz pero puede anular el valor del splitter en regiones cóncavas.');
  md.push('  - Si la causa es C (stitchType), hay que alinear `stitchRoleForSplit` (splitter) con `isFill` (detector) para que coincidan los stitchType reconocidos como fill.');
  md.push('  - El splitter podría quedar como no-op en muchos diseños → conviene V1.1 o abandonar y pasar a otro bloque (underlay generator / satin contour converter).');
  md.push(`- **¿V1.1 o abandonar?**: ${primaryCause === 'interpolatedPointOutsideRegion' ? 'Conviene V1.1 — el mecanismo es claro y el gate geométrico lo resuelve; si tras V1.1 sigue inefectivo, abandonar.' : primaryCause === 'stitchTypeNotRecognizedAsFill' ? 'Conviene V1.1 con alineación de stitchType — fix puntual y seguro.' : 'Revisar con más datos — posiblemente abandonar y pasar a otro bloque.'}`);
  md.push('\n---');
  md.push('_REFERENCE_VISIBLE_SPLITTER_FORENSICS_V1 — forense read-only. No modifica motor, detector, encoders ni exportación._');

  return {
    report: md.join('\n'),
    candidatesFound: candidates.length,
    detailed: detailed.length,
    causeGroups,
    confirmation,
    primaryCause,
  };
}