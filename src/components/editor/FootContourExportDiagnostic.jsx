/**
 * FootContourExportDiagnostic.jsx — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Localiza en qué fase desaparece el contorno del segundo pie comparando:
 *   1. dark stroke mask   2. universal contours   3. contour objects
 *   4. final commands     5. export commands      6. simulator vs export
 *   7. layer order (fill vs contour)
 *
 * Diagnóstico de solo lectura: no modifica el motor. Genera
 * FOOT_CONTOUR_EXPORT_DIAGNOSTIC.md con la fase culpable.
 */
import { useMemo } from 'react';
import { Download, Bug } from 'lucide-react';
import { buildContourObjects } from '@/lib/contourExportBuilder';
import { buildUniversalDarkContoursFromContext } from '@/lib/universalDarkContourDetector';
import { prepareCE01ProductionExport } from '@/lib/ce01ProductionExport';

function footZonePx(px, py, W, H) {
  const ny = py / H, nx = px / W;
  if (ny < 0.66) return null;
  if (nx < 0.45) return 'left';
  if (nx > 0.55) return 'right';
  return null;
}
function footZoneMm(x, y, w, h) {
  if (y < h * 0.2) return null;
  if (x < -w * 0.05) return 'left';
  if (x > w * 0.05) return 'right';
  return null;
}
function bboxCenter(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    const x = p.x ?? p[0], y = p.y ?? p[1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minX, maxX, minY, maxY };
}

export default function FootContourExportDiagnostic({
  regions = [], config = {}, darkStroke,
  finalCommands = [], finalObjects = [], machineSettings = {},
}) {
  const w = config.width_mm || 100, h = config.height_mm || 100;
  const W = darkStroke?.width || 320, H = darkStroke?.height || 320;
  const cfg = { ...config, darkStroke };

  // ── Phase 1: dark stroke ──────────────────────────────────────────────────
  const phase1 = useMemo(() => {
    const res = { leftFootDarkComponent: false, rightFootDarkComponent: false, leftFootContourPixels: 0, rightFootContourPixels: 0 };
    if (!darkStroke?.strictMask) return res;
    const mask = darkStroke.strictMask;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const z = footZonePx(x, y, W, H);
      if (z === 'left') res.leftFootContourPixels++;
      else if (z === 'right') res.rightFootContourPixels++;
    }
    for (const c of darkStroke.components || []) {
      const b = c.bbox || {};
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      const z = footZonePx(cx, cy, W, H);
      if (z === 'left') res.leftFootDarkComponent = true;
      else if (z === 'right') res.rightFootDarkComponent = true;
    }
    return res;
  }, [darkStroke, W, H]);

  // ── Phase 2: universal contours ────────────────────────────────────────────
  const phase2 = useMemo(() => {
    const res = { left: null, right: null };
    if (!darkStroke?.strictMask) return res;
    const universal = buildUniversalDarkContoursFromContext(darkStroke, cfg);
    for (const c of universal.contours || []) {
      const pp = c._pixelPath || [];
      if (pp.length < 2) continue;
      const bc = bboxCenter(pp);
      const z = footZonePx(bc.cx, bc.cy, W, H);
      if (!z) continue;
      // dark support: fraction of pixel-path points over the strict mask
      let hits = 0;
      const mask = darkStroke.strictMask;
      for (const p of pp) {
        const px = Math.round(p.x), py = Math.round(p.y);
        let on = false;
        for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (mask[ny * W + nx]) { on = true; break; }
        }
        if (on) hits++;
      }
      const obj = {
        objectId: c.id, universalClass: c.universalClass, points: pp.length,
        lengthPx: Math.round(pp.reduce((s, p, i) => i ? s + Math.hypot(p.x - pp[i - 1].x, p.y - pp[i - 1].y) : s, 0)),
        darkSupport: hits / pp.length, bbox: bc, exported: true,
      };
      if (z === 'left' && !res.left) res.left = obj;
      else if (z === 'right' && !res.right) res.right = obj;
    }
    return res;
  }, [darkStroke, cfg, W, H]);

  // ── Phase 3: contour objects ──────────────────────────────────────────────
  const phase3 = useMemo(() => {
    const res = { left: null, right: null };
    let built;
    try { built = buildContourObjects(regions, cfg); } catch { return res; }
    for (const o of built.objects || []) {
      const pts = o.points || [];
      if (pts.length < 2) continue;
      const bc = bboxCenter(pts.map(p => ({ x: p[0], y: p[1] })));
      const z = footZoneMm(bc.cx, bc.cy, w, h);
      if (!z) continue;
      const obj = { exists: true, points: pts.length, stitchType: o.stitch_type, layerType: o.layerType, objectId: o.id, color: o.color };
      if (z === 'left' && !res.left) res.left = obj;
      else if (z === 'right' && !res.right) res.right = obj;
    }
    return res;
  }, [regions, cfg, w, h]);

  // ── Phase 4: final commands ────────────────────────────────────────────────
  const phase4 = useMemo(() => {
    const res = { left: emptyFoot(), right: emptyFoot() };
    for (let i = 0; i < finalCommands.length; i++) {
      const c = finalCommands[i];
      if (c.type !== 'stitch' && c.type !== 'jump' && c.type !== 'trim') continue;
      const z = footZoneMm(c.x || 0, c.y || 0, w, h);
      if (!z) continue;
      const f = res[z];
      if (c.type === 'stitch') {
        f.stitchCount++;
        if (f.firstCommandIndex < 0) f.firstCommandIndex = i;
        f.lastCommandIndex = i;
        f.color = c.color;
        f.stitchType = c.stitchType || f.stitchType;
      } else if (c.type === 'jump') f.jumpCount++;
      else if (c.type === 'trim') f.trimCount++;
    }
    // removedByRepair / convertedToJump: contour object exists but 0 stitches
    for (const z of ['left', 'right']) {
      const f = res[z];
      const obj = phase3[z];
      f.removedByRepair = obj?.exists && f.stitchCount === 0;
      f.convertedToJump = obj?.exists && f.stitchCount === 0 && f.jumpCount > 0;
    }
    return res;
  }, [finalCommands, w, h, phase3]);

  // ── Phase 5: export commands (productionReport) ────────────────────────────
  const phase5 = useMemo(() => {
    const res = { left: { stitches: 0 }, right: { stitches: 0 }, exportCommands: [] };
    let prod;
    try {
      prod = prepareCE01ProductionExport(finalCommands, regions, cfg, machineSettings, finalObjects, 'DST');
    } catch { return res; }
    const cmds = prod.commands || finalCommands;
    res.exportCommands = cmds;
    for (const c of cmds) {
      if (c.type !== 'stitch') continue;
      const z = footZoneMm(c.x || 0, c.y || 0, w, h);
      if (!z) continue;
      res[z].stitches++;
    }
    res.leftFootPresentInDSTCommands = res.left.stitches > 0;
    res.rightFootPresentInDSTCommands = res.right.stitches > 0;
    return res;
  }, [finalCommands, regions, cfg, machineSettings, finalObjects, w, h]);

  // ── Phase 6: simulator vs export mismatch ──────────────────────────────────
  const phase6 = useMemo(() => {
    const simLeft = phase4.left.stitchCount, simRight = phase4.right.stitchCount;
    const expLeft = phase5.left.stitches, expRight = phase5.right.stitches;
    return {
      simLeft, simRight, expLeft, expRight,
      simulationExportMismatch: simLeft !== expLeft || simRight !== expRight,
    };
  }, [phase4, phase5]);

  // ── Phase 7: layer order ───────────────────────────────────────────────────
  const phase7 = useMemo(() => {
    const res = { left: { fillBeforeContour: false, contourAfterFill: false, contourHiddenByLaterFill: false }, right: { fillBeforeContour: false, contourAfterFill: false, contourHiddenByLaterFill: false } };
    for (const z of ['left', 'right']) {
      let firstFill = -1, firstContour = -1, lastFill = -1;
      for (let i = 0; i < finalCommands.length; i++) {
        const c = finalCommands[i];
        if (c.type !== 'stitch') continue;
        if (footZoneMm(c.x || 0, c.y || 0, w, h) !== z) continue;
        const isContour = (c.stitchType === 'running_stitch' || c.stitchType === 'satin' || (c.layerType || '').toLowerCase().includes('outline') || (c.layerType || '').toLowerCase().includes('contour'));
        const isFill = c.stitchType === 'fill' || c.source === 'clipped_fill_optimized';
        if (isFill) { if (firstFill < 0) firstFill = i; lastFill = i; }
        if (isContour) { if (firstContour < 0) firstContour = i; }
      }
      res[z].fillBeforeContour = firstFill >= 0 && firstContour >= 0 && firstFill < firstContour;
      res[z].contourAfterFill = firstContour >= 0 && firstFill >= 0 && firstContour > firstFill;
      res[z].contourHiddenByLaterFill = firstContour >= 0 && lastFill > firstContour;
    }
    return res;
  }, [finalCommands, w, h]);

  // ── Verdict ───────────────────────────────────────────────────────────────
  const verdict = useMemo(() => {
    const fails = [];
    if (!phase1.leftFootDarkComponent || !phase1.rightFootDarkComponent) fails.push('DARKSTROKE');
    if (!phase2.left || !phase2.right) fails.push('UNIVERSAL_CONTOURS');
    if (!phase3.left?.exists || !phase3.right?.exists) fails.push('BUILD_CONTOUR_OBJECTS');
    if (phase4.left.stitchCount === 0 || phase4.right.stitchCount === 0) fails.push('BUILD_FINAL_COMMANDS');
    if (!phase5.leftFootPresentInDSTCommands || !phase5.rightFootPresentInDSTCommands) fails.push('PRODUCTION_EXPORT_COMMANDS');
    if (phase6.simulationExportMismatch) fails.push('SIMULATOR_ONLY');
    return { fails, oneFootOnly: (phase3.left?.exists ? 1 : 0) + (phase3.right?.exists ? 1 : 0) === 1 };
  }, [phase1, phase2, phase3, phase4, phase5, phase6]);

  const downloadReport = () => {
    const L = [];
    L.push('# FOOT_CONTOUR_EXPORT_DIAGNOSTIC');
    L.push(`Fecha: ${new Date().toISOString()}`);
    L.push('');
    L.push('## 1. Dark stroke');
    L.push(`- leftFootDarkComponent: ${phase1.leftFootDarkComponent}`);
    L.push(`- rightFootDarkComponent: ${phase1.rightFootDarkComponent}`);
    L.push(`- leftFootContourPixels: ${phase1.leftFootContourPixels}`);
    L.push(`- rightFootContourPixels: ${phase1.rightFootContourPixels}`);
    L.push('');
    L.push('## 2. Universal contours');
    for (const z of ['left', 'right']) {
      const o = phase2[z];
      L.push(`- ${z}FootContourObject: ${!!o}`);
      if (o) L.push(`  - objectId=${o.objectId} class=${o.universalClass} points=${o.points} lengthPx=${o.lengthPx} darkSupport=${o.darkSupport.toFixed(2)} exported=${o.exported}`);
    }
    L.push('');
    L.push('## 3. Contour objects');
    for (const z of ['left', 'right']) {
      const o = phase3[z];
      L.push(`- ${z}FootObjectExists: ${!!o?.exists}`);
      if (o?.exists) L.push(`  - objectId=${o.objectId} points=${o.points} stitchType=${o.stitchType} layerType=${o.layerType} color=${o.color}`);
    }
    L.push('');
    L.push('## 4. Final commands');
    for (const z of ['left', 'right']) {
      const f = phase4[z];
      L.push(`- ${z}Foot: stitches=${f.stitchCount} jumps=${f.jumpCount} trims=${f.trimCount} firstIdx=${f.firstCommandIndex} lastIdx=${f.lastCommandIndex} color=${f.color} stitchType=${f.stitchType} removedByRepair=${f.removedByRepair} convertedToJump=${f.convertedToJump}`);
    }
    L.push('');
    L.push('## 5. Export commands (DST)');
    L.push(`- leftFootExportedStitches: ${phase5.left.stitches}`);
    L.push(`- rightFootExportedStitches: ${phase5.right.stitches}`);
    L.push(`- leftFootPresentInDSTCommands: ${phase5.leftFootPresentInDSTCommands}`);
    L.push(`- rightFootPresentInDSTCommands: ${phase5.rightFootPresentInDSTCommands}`);
    L.push('');
    L.push('## 6. Simulator vs export');
    L.push(`- simLeft=${phase6.simLeft} expLeft=${phase6.expLeft}`);
    L.push(`- simRight=${phase6.simRight} expRight=${phase6.expRight}`);
    L.push(`- SIMULATION_EXPORT_MISMATCH: ${phase6.simulationExportMismatch}`);
    L.push('');
    L.push('## 7. Layer order');
    for (const z of ['left', 'right']) {
      const o = phase7[z];
      L.push(`- ${z}Foot: fillBeforeContour=${o.fillBeforeContour} contourAfterFill=${o.contourAfterFill} contourHiddenByLaterFill=${o.contourHiddenByLaterFill}`);
    }
    L.push('');
    L.push('## Veredicto');
    if (verdict.fails.length === 0) L.push('- AMBOS pies exportados correctamente. Sin fallo detectado.');
    else {
      L.push(`- Fase(s) culpable(s): ${verdict.fails.join(', ')}`);
      if (verdict.fails[0] === 'DARKSTROKE') L.push('- El fallo está en darkStroke: la máscara negra no detecta uno de los pies.');
      else if (verdict.fails[0] === 'UNIVERSAL_CONTOURS') L.push('- El fallo está en universalDarkContourDetector: no genera objeto de contorno para uno de los pies.');
      else if (verdict.fails[0] === 'BUILD_CONTOUR_OBJECTS') L.push('- El fallo está en buildContourObjects: pierde el contorno del segundo pie.');
      else if (verdict.fails[0] === 'BUILD_FINAL_COMMANDS') L.push('- El fallo está en buildFinalCommands: no genera puntadas reales para uno de los pies.');
      else if (verdict.fails[0] === 'PRODUCTION_EXPORT_COMMANDS') L.push('- El fallo está en production/exportCommands: el DST no contiene uno de los pies.');
      else if (verdict.fails[0] === 'SIMULATOR_ONLY') L.push('- El fallo está solo en el simulador: Final Look muestra algo que no está en exportCommands.');
    }
    const blob = new Blob([L.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'FOOT_CONTOUR_EXPORT_DIAGNOSTIC.md'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Foot Contour Export Diagnostic</h3>
          </div>
          <button onClick={downloadReport} className="flex items-center gap-1 px-2 py-1 rounded bg-violet-600 text-[10px] text-white font-bold hover:bg-violet-500">
            <Download className="w-3 h-3" /> Descargar diagnóstico
          </button>
        </div>

        <div className={`text-[11px] rounded-lg px-3 py-2 font-bold border ${verdict.fails.length === 0 ? 'text-emerald-300 bg-emerald-900/20 border-emerald-500/40' : 'text-red-300 bg-red-900/20 border-red-500/40'}`}>
          {verdict.fails.length === 0
            ? '✓ Ambos pies exportados correctamente'
            : `✗ Fallo en: ${verdict.fails.join(' → ')}`}
        </div>

        <Card title="1. Dark stroke">
          <KV k="leftFootDarkComponent" v={String(phase1.leftFootDarkComponent)} ok={phase1.leftFootDarkComponent} />
          <KV k="rightFootDarkComponent" v={String(phase1.rightFootDarkComponent)} ok={phase1.rightFootDarkComponent} />
          <KV k="leftFootContourPixels" v={phase1.leftFootContourPixels} ok={phase1.leftFootContourPixels > 0} />
          <KV k="rightFootContourPixels" v={phase1.rightFootContourPixels} ok={phase1.rightFootContourPixels > 0} />
        </Card>

        <Card title="2. Universal contours">
          {['left', 'right'].map(z => {
            const o = phase2[z];
            return (
              <div key={z} className="mb-1.5 p-1.5 rounded bg-[#0d0f14] border border-[#1e2130]">
                <KV k={`${z}FootContourObject`} v={!!o} ok={!!o} />
                {o && <>
                  <KV k="  objectId" v={o.objectId} />
                  <KV k="  universalClass" v={o.universalClass} />
                  <KV k="  points" v={o.points} />
                  <KV k="  lengthPx" v={o.lengthPx} />
                  <KV k="  darkSupport" v={o.darkSupport.toFixed(2)} ok={o.darkSupport >= 0.85} />
                  <KV k="  exported" v={String(o.exported)} ok={o.exported} />
                </>}
              </div>
            );
          })}
        </Card>

        <Card title="3. Contour objects">
          {['left', 'right'].map(z => {
            const o = phase3[z];
            return (
              <div key={z} className="mb-1.5 p-1.5 rounded bg-[#0d0f14] border border-[#1e2130]">
                <KV k={`${z}FootObjectExists`} v={!!o?.exists} ok={!!o?.exists} />
                {o?.exists && <>
                  <KV k="  points" v={o.points} />
                  <KV k="  stitchType" v={o.stitchType} />
                  <KV k="  layerType" v={o.layerType} />
                  <KV k="  color" v={o.color} />
                </>}
              </div>
            );
          })}
        </Card>

        <Card title="4. Final commands">
          {['left', 'right'].map(z => {
            const f = phase4[z];
            return (
              <div key={z} className="mb-1.5 p-1.5 rounded bg-[#0d0f14] border border-[#1e2130]">
                <KV k={`${z}Foot stitchCount`} v={f.stitchCount} ok={f.stitchCount > 0} />
                <KV k="  jumpCount" v={f.jumpCount} />
                <KV k="  trimCount" v={f.trimCount} />
                <KV k="  firstCommandIndex" v={f.firstCommandIndex} />
                <KV k="  lastCommandIndex" v={f.lastCommandIndex} />
                <KV k="  color" v={f.color || '—'} />
                <KV k="  stitchType" v={f.stitchType || '—'} />
                <KV k="  removedByRepair" v={String(f.removedByRepair)} ok={!f.removedByRepair} />
                <KV k="  convertedToJump" v={String(f.convertedToJump)} ok={!f.convertedToJump} />
              </div>
            );
          })}
        </Card>

        <Card title="5. Export commands (DST)">
          <KV k="leftFootExportedStitches" v={phase5.left.stitches} ok={phase5.left.stitches > 0} />
          <KV k="rightFootExportedStitches" v={phase5.right.stitches} ok={phase5.right.stitches > 0} />
          <KV k="leftFootPresentInDSTCommands" v={String(phase5.leftFootPresentInDSTCommands)} ok={phase5.leftFootPresentInDSTCommands} />
          <KV k="rightFootPresentInDSTCommands" v={String(phase5.rightFootPresentInDSTCommands)} ok={phase5.rightFootPresentInDSTCommands} />
        </Card>

        <Card title="6. Simulator vs export">
          <KV k="simLeft / expLeft" v={`${phase6.simLeft} / ${phase6.expLeft}`} ok={phase6.simLeft === phase6.expLeft} />
          <KV k="simRight / expRight" v={`${phase6.simRight} / ${phase6.expRight}`} ok={phase6.simRight === phase6.expRight} />
          <KV k="SIMULATION_EXPORT_MISMATCH" v={String(phase6.simulationExportMismatch)} ok={!phase6.simulationExportMismatch} />
        </Card>

        <Card title="7. Layer order">
          {['left', 'right'].map(z => {
            const o = phase7[z];
            return (
              <div key={z} className="mb-1">
                <KV k={`${z} fillBeforeContour`} v={String(o.fillBeforeContour)} ok={o.fillBeforeContour} />
                <KV k={`${z} contourAfterFill`} v={String(o.contourAfterFill)} ok={o.contourAfterFill} />
                <KV k={`${z} contourHiddenByLaterFill`} v={String(o.contourHiddenByLaterFill)} ok={!o.contourHiddenByLaterFill} />
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

function emptyFoot() {
  return { stitchCount: 0, jumpCount: 0, trimCount: 0, firstCommandIndex: -1, lastCommandIndex: -1, color: null, stitchType: null, removedByRepair: false, convertedToJump: false };
}

function Card({ title, children }) {
  return (
    <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-3">
      <h4 className="text-xs font-bold text-slate-200 mb-2">{title}</h4>
      {children}
    </div>
  );
}
function KV({ k, v, ok }) {
  const color = ok === undefined ? 'text-slate-300' : ok ? 'text-emerald-400' : 'text-red-400';
  return <div className="flex items-center justify-between text-[10px] py-0.5"><span className="text-slate-500">{k}</span><span className={`font-bold ${color}`}>{String(v)}</span></div>;
}