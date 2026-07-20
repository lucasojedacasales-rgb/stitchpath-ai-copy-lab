import { useState, useMemo, useRef, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Eye, Route, Scissors, Palette, Bug, Layers, Brush } from 'lucide-react';
import { countContourStitches, getLastContourAudit, getLastSegmentClassification, getLastDarkStroke, getLastUniversalReport } from '@/lib/contourExportBuilder';
import { getLastLowerContourReport } from '@/lib/lowerContourRebuilder';
import { validateUniversalContours, DESIGN_SCENARIOS } from '@/lib/universalDarkContourTestSuite';
import { classifyStitchSegments } from '@/lib/geometryAudit';
import { detectTravelContamination } from '@/lib/contourRefineValidator';

/**
 * ContourRefinePanel — shows contour metrics + debug view toggles.
 *
 * Props:
 *   commands — finalEmbroideryCommands (read-only)
 *   regions  — visual regions
 *   config   — { width_mm, height_mm }
 */
export default function ContourRefinePanel({ commands = [], regions = [], config = {} }) {
  const [viewMode, setViewMode] = useState('metrics'); // 'metrics' | 'contours_only' | 'contours_travel'
  const canvasRef = useRef(null);

  const report = useMemo(() => {
    const counts = countContourStitches(commands);
    const travelContam = detectTravelContamination(commands, 3.5);
    const hasMouth = regions.some(r => {
      const name = (r.name || '').toLowerCase();
      return name.includes('mouth') || name.includes('boca');
    });

    // Determine outer outline type
    let outerType = 'none';
    for (const c of commands) {
      if (c.type === 'stitch' && c.layerType === 'outer_outline') {
        outerType = (c.stitchType || '').toLowerCase().includes('satin') ? 'satin' : 'run';
        break;
      }
    }

    // Calculate outer outline total length
    let outerLen = 0;
    let prevX = 0, prevY = 0;
    for (const c of commands) {
      if (c.type === 'stitch' && c.layerType === 'outer_outline') {
        outerLen += Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      }
      if (c.type === 'stitch' || c.type === 'jump') {
        prevX = c.x || 0; prevY = c.y || 0;
      }
    }

    // Determine outer outline order (fraction of total commands)
    const totalStitches = commands.filter(c => c.type === 'stitch').length;
    const orderPct = counts.outerOutlineOrder >= 0 && totalStitches > 0
      ? Math.round((counts.outerOutlineOrder / totalStitches) * 100)
      : -1;

    const audit = getLastContourAudit();
    const outerSegIds = new Set();
    for (const c of commands) {
      if (c.type === 'stitch' && (c.layerType || '').toLowerCase() === 'outer_outline') {
        outerSegIds.add(c.regionId);
      }
    }
    return {
      ...counts,
      outerType,
      outerLenMm: Math.round(outerLen),
      orderPct,
      travelContam,
      hasMouth,
      outerContourSegments: outerSegIds.size,
      internalShadingBoundariesDetected: audit?.internalBoundariesDetected || 0,
      invalidInternalOutlinesRemoved: audit?.removedCount || 0,
      visibleFootContourCoverage: audit?.footContourCoverage ?? 100,
      bodyShadowBoundaryOutlined: audit?.removedDetails?.some(d => d.parentGroup === 'body') ? 'NO' : 'YES',
    };
  }, [commands, regions]);

  // ── Debug canvas rendering ──
  useEffect(() => {
    if (viewMode === 'metrics') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = config.width_mm || 100;
    const h = config.height_mm || 100;
    const cw = canvas.width;
    const ch = canvas.height;
    const scale = Math.min(cw / w, ch / h) * 0.9;
    const offX = cw / 2;
    const offY = ch / 2;

    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, cw, ch);

    // Helper: mm → canvas px
    const toPx = (x, y) => [offX + x * scale, offY - y * scale];

    if (viewMode === 'contours_only') {
      // Show only contour stitches (outer, inner, mouth, detail)
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      let prev = null;
      for (const c of commands) {
        if (c.type !== 'stitch') { prev = null; continue; }
        const lt = (c.layerType || '').toLowerCase();
        const rid = (c.regionId || '').toLowerCase();
        const isContour = lt.includes('outline') || lt.includes('contour') ||
                          lt.includes('mouth') || lt.includes('detail') ||
                          rid.includes('outline') || rid.includes('contour') ||
                          rid.includes('mouth') || rid.includes('detail');
        if (!isContour) { prev = null; continue; }
        const [px, py] = toPx(c.x || 0, c.y || 0);
        if (prev) {
          ctx.beginPath();
          ctx.moveTo(prev[0], prev[1]);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
        prev = [px, py];
      }
    } else if (viewMode === 'contours_travel') {
      // Contours = black solid, jumps = green dashed, trims = red dot
      let prev = null;
      for (const c of commands) {
        if (c.type === 'stitch') {
          const lt = (c.layerType || '').toLowerCase();
          const rid = (c.regionId || '').toLowerCase();
          const isContour = lt.includes('outline') || lt.includes('contour') ||
                            lt.includes('mouth') || lt.includes('detail') ||
                            rid.includes('outline') || rid.includes('contour');
          const [px, py] = toPx(c.x || 0, c.y || 0);
          if (isContour && prev) {
            ctx.strokeStyle = '#1a1a1a';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
          prev = [px, py];
        } else if (c.type === 'jump') {
          const [px, py] = toPx(c.x || 0, c.y || 0);
          if (prev) {
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
          prev = [px, py];
        } else if (c.type === 'trim') {
          if (prev) {
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(prev[0], prev[1], 3, 0, Math.PI * 2);
            ctx.fill();
          }
          prev = null;
        } else {
          prev = null;
        }
      }
      ctx.setLineDash([]);
    } else if (viewMode === 'discarded') {
      // Real contours (dark) + discarded internal boundaries (orange dashed)
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      let prev = null;
      for (const c of commands) {
        if (c.type !== 'stitch') { prev = null; continue; }
        const lt = (c.layerType || '').toLowerCase();
        const isContour = lt.includes('outline') || lt.includes('contour') || lt.includes('mouth') || lt.includes('detail');
        if (!isContour) { prev = null; continue; }
        const [px, py] = toPx(c.x || 0, c.y || 0);
        if (prev) {
          ctx.beginPath();
          ctx.moveTo(prev[0], prev[1]);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
        prev = [px, py];
      }
      // Discarded internal boundaries in orange
      const audit = getLastContourAudit();
      if (audit && audit.removedDetails) {
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        for (const detail of audit.removedDetails) {
          const pts = detail.boundaryPoints || [];
          if (pts.length < 2) continue;
          ctx.beginPath();
          const mm0 = toPx((pts[0][0] - 0.5) * w, (pts[0][1] - 0.5) * h);
          ctx.moveTo(mm0[0], mm0[1]);
          for (let i = 1; i < pts.length; i++) {
            const mm = toPx((pts[i][0] - 0.5) * w, (pts[i][1] - 0.5) * h);
            ctx.lineTo(mm[0], mm[1]);
          }
          ctx.closePath();
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    } else if (viewMode === 'classification') {
      // Classify all segments by type: contour / detail / fill / travel / suspicious
      const segments = classifyStitchSegments(commands);
      for (const seg of segments) {
        const [sx, sy] = toPx(seg.start.x, seg.start.y);
        const [ex, ey] = toPx(seg.end.x, seg.end.y);
        ctx.lineWidth = seg.category === 'suspicious' ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        switch (seg.category) {
          case 'dark_stroke_outline': ctx.strokeStyle = '#22c55e'; break;   // verde — real_outline
          case 'outer_silhouette': ctx.strokeStyle = '#22c55e'; break;      // verde — real_outline
          case 'limb_contour': ctx.strokeStyle = '#22c55e'; break;          // verde — real_outline
          case 'real_outline_lower': ctx.strokeStyle = '#22c55e'; break;    // verde — real_outline (lower)
          case 'inner_outline': ctx.strokeStyle = '#3b82f6'; break;         // azul — inner_outline
          case 'facial_detail': ctx.strokeStyle = '#eab308'; break;         // amarillo — detail_open_curve
          case 'eye_detail': ctx.strokeStyle = '#eab308'; break;            // amarillo — detail_open_curve
          case 'fill': ctx.strokeStyle = '#a78bfa'; break;                  // morado — fill
          case 'fill_boundary': ctx.strokeStyle = '#a855f7'; break;         // morado — fill_boundary
          case 'travel': ctx.strokeStyle = '#64748b'; ctx.setLineDash([2, 2]); break; // gris — travel_only
          case 'artifact': ctx.strokeStyle = '#ef4444'; break;              // rojo — rejected pseudo contour
          default: ctx.strokeStyle = '#94a3b8'; break;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (viewMode === 'dark_stroke') {
      // Dark stroke detection view:
      //   - dark stroke pixels/components in cyan
      //   - exportable contours in green
      //   - facial details (mouth) in yellow
      //   - discarded fill boundaries in orange
      //   - artifacts/travel in red/grey
      const ds = getLastDarkStroke();
      if (ds && ds.mask) {
        // Render mask pixels scaled to canvas
        const imgData = ctx.createImageData(cw, ch);
        for (let y = 0; y < ds.height; y++) {
          for (let x = 0; x < ds.width; x++) {
            if (!ds.mask[y * ds.width + x]) continue;
            // Scale to canvas
            const px = Math.floor((x / ds.width) * cw);
            const py = Math.floor((y / ds.height) * ch);
            if (px < 0 || px >= cw || py < 0 || py >= ch) continue;
            const di = (py * cw + px) * 4;
            imgData.data[di] = 34;     // R
            imgData.data[di + 1] = 211; // G
            imgData.data[di + 2] = 238; // B
            imgData.data[di + 3] = 180; // A
          }
        }
        ctx.putImageData(imgData, 0, 0);

        // Mark mouth candidate
        if (ds.mouthCandidate) {
          const mb = ds.mouthCandidate.bbox;
          const [mx, my] = toPx((mb.minX - 0.5) * w, (mb.minY - 0.5) * h);
          const [mx2, my2] = toPx((mb.maxX - 0.5) * w, (mb.maxY - 0.5) * h);
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.strokeRect(mx, my, mx2 - mx, my2 - my);
        }
        // Mark eye candidates
        ctx.strokeStyle = '#06b6d4';
        for (const eye of (ds.eyeCandidates || [])) {
          const eb = eye.bbox;
          const [ex, ey] = toPx((eb.minX - 0.5) * w, (eb.minY - 0.5) * h);
          const [ex2, ey2] = toPx((eb.maxX - 0.5) * w, (eb.maxY - 0.5) * h);
          ctx.strokeRect(ex, ey, ex2 - ex, ey2 - ey);
        }
      } else {
        ctx.fillStyle = '#64748b';
        ctx.font = '11px Inter';
        ctx.fillText('Sin máscara de línea oscura (sube una imagen)', 20, ch / 2);
      }

      // Overlay exportable contours (green) + facial details (yellow) + discarded (orange)
      let prev = null;
      for (const c of commands) {
        if (c.type !== 'stitch') { prev = null; continue; }
        const lt = (c.layerType || '').toLowerCase();
        const [px, py] = toPx(c.x || 0, c.y || 0);
        if (lt === 'dark_stroke_outline' || lt === 'outer_silhouette' || lt === 'limb_contour' || lt === 'real_outline_lower') {
          ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        } else if (lt === 'facial_detail') {
          ctx.strokeStyle = '#eab308'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        } else if (lt === 'eye_detail') {
          ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        } else if (lt === 'fill_boundary') {
          ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        } else if (lt === 'artifact' || lt === 'travel') {
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        } else { prev = null; continue; }
        if (prev) {
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(px, py); ctx.stroke();
        }
        prev = [px, py];
      }
      ctx.setLineDash([]);
    } else if (viewMode === 'universal') {
      // Universal dark contours: outer=green, inner=blue, detail=yellow, noise=red, fill=purple
      let prev = null;
      for (const c of commands) {
        if (c.type !== 'stitch') { prev = null; continue; }
        const lt = (c.layerType || '').toLowerCase();
        const [px, py] = toPx(c.x || 0, c.y || 0);
        if (lt === 'outer_outline') { ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.setLineDash([]); }
        else if (lt === 'inner_outline') { ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
        else if (lt === 'detail_open_curve') { ctx.strokeStyle = '#eab308'; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
        else if (lt === 'rejected_noise') { ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); }
        else if (lt === 'fill_boundary_rejected') { ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); }
        else { prev = null; continue; }
        if (prev) { ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(px, py); ctx.stroke(); }
        prev = [px, py];
      }
      ctx.setLineDash([]);
    }
  }, [viewMode, commands, config]);

  const outerExists = report.outerOutlineStitches > 0;
  const mouthExists = report.mouthStitches > 0;

  return (
    <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-violet-400" />
        <span className="text-xs font-bold text-slate-300">Contour Refine Metrics</span>
      </div>

      {/* View mode toggles */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('metrics')}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
            viewMode === 'metrics' ? 'bg-violet-900/30 border-violet-500 text-violet-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'
          }`}
        >Métricas</button>
        <button
          onClick={() => setViewMode('contours_only')}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
            viewMode === 'contours_only' ? 'bg-violet-900/30 border-violet-500 text-violet-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'
          }`}
        >Solo contornos</button>
        <button
          onClick={() => setViewMode('contours_travel')}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
            viewMode === 'contours_travel' ? 'bg-violet-900/30 border-violet-500 text-violet-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'
          }`}
        >Contornos + viajes</button>
        <button
        onClick={() => setViewMode('discarded')}
        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
          viewMode === 'discarded' ? 'bg-orange-900/30 border-orange-500 text-orange-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'
        }`}
        >Fronteras descartadas</button>
        <button
        onClick={() => setViewMode('classification')}
        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
          viewMode === 'classification' ? 'bg-violet-900/30 border-violet-500 text-violet-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'
        }`}
        >Clasificación</button>
        <button
        onClick={() => setViewMode('dark_stroke')}
        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
          viewMode === 'dark_stroke' ? 'bg-cyan-900/30 border-cyan-500 text-cyan-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'
        }`}
        >Dark Stroke</button>
        <button
        onClick={() => setViewMode('universal')}
        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
          viewMode === 'universal' ? 'bg-emerald-900/30 border-emerald-500 text-emerald-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'
        }`}
        >Universal</button>
        </div>

      {viewMode === 'metrics' ? (
        <>
          {/* Outer outline */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Palette className="w-3 h-3 text-violet-400" />
              <span className="text-[10px] font-bold text-slate-400">Outer Outline</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Metric label="Existe" value={outerExists ? 'YES' : 'NO'} color={outerExists ? 'text-emerald-400' : 'text-red-400'} />
              <Metric label="Tipo" value={report.outerType} color="text-violet-400" />
              <Metric label="Puntadas" value={report.outerOutlineStitches} color={report.outerOutlineStitches > 80 ? 'text-emerald-400' : 'text-amber-400'} />
              <Metric label="Long. mm" value={report.outerLenMm} color="text-cyan-400" />
              <Metric label="Orden" value={report.orderPct >= 0 ? `${report.orderPct}%` : '—'} color={report.orderPct >= 80 ? 'text-emerald-400' : 'text-amber-400'} />
              <Metric label="Color" value={report.outerOutlineColor || '—'} color="text-slate-400" />
            </div>
          </div>

          {/* Inner outlines */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Eye className="w-3 h-3 text-cyan-400" />
              <span className="text-[10px] font-bold text-slate-400">Inner Outlines</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Metric label="Cantidad" value={report.innerContoursExported} color="text-cyan-400" />
              <Metric label="Puntadas" value={report.innerOutlineStitches} color="text-cyan-400" />
            </div>
          </div>

          {/* Mouth */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Scissors className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] font-bold text-slate-400">Mouth</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Metric label="Existe" value={mouthExists ? 'YES' : 'NO'} color={mouthExists ? 'text-emerald-400' : (report.hasMouth ? 'text-red-400' : 'text-slate-500')} />
              <Metric label="Puntadas" value={report.mouthStitches} color="text-amber-400" />
            </div>
          </div>

          {/* Travel contamination */}
          <div className={`rounded-lg p-2.5 border ${report.travelContam > 0 ? 'bg-red-900/20 border-red-500/40' : 'bg-emerald-900/15 border-emerald-500/30'}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Route className={`w-3 h-3 ${report.travelContam > 0 ? 'text-red-400' : 'text-emerald-400'}`} />
              <span className="text-[10px] font-bold text-slate-400">Travel Contamination</span>
            </div>
            <div className="text-sm font-bold mb-1">
              <span className={report.travelContam > 0 ? 'text-red-400' : 'text-emerald-400'}>{report.travelContam}</span>
              <span className="text-[10px] text-slate-500 ml-1">líneas</span>
            </div>
            {report.travelContam > 0 && (
              <div className="text-[10px] text-red-300 flex items-start gap-1">
                <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5" />
                <span>Hay viajes convertidos en puntadas visibles.</span>
              </div>
            )}
          </div>

          {/* Group audit metrics */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Bug className="w-3 h-3 text-orange-400" />
              <span className="text-[10px] font-bold text-slate-400">Group Audit</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Metric label="Segmentos" value={report.outerContourSegments || 0} color="text-violet-400" />
              <Metric label="Fronteras int." value={report.internalShadingBoundariesDetected || 0} color="text-orange-400" />
              <Metric label="Eliminados" value={report.invalidInternalOutlinesRemoved || 0} color="text-emerald-400" />
              <Metric label="Pies cubiertos" value={(report.visibleFootContourCoverage ?? 100) + '%'} color={(report.visibleFootContourCoverage ?? 100) > 95 ? 'text-emerald-400' : 'text-red-400'} />
              <Metric label="Sombra body" value={report.bodyShadowBoundaryOutlined || '—'} color={report.bodyShadowBoundaryOutlined === 'NO' ? 'text-emerald-400' : 'text-red-400'} />
            </div>
          </div>

          {/* Segment classification summary */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Layers className="w-3 h-3 text-violet-400" />
              <span className="text-[10px] font-bold text-slate-400">Clasificación semántica</span>
            </div>
            {(() => {
              const sc = getLastSegmentClassification();
              if (!sc) return <div className="text-[10px] text-slate-600">Sin datos</div>;
              const counts = {};
              for (const c of sc.classified) {
                counts[c.category] = (counts[c.category] || 0) + 1;
              }
              const colors = {
                dark_stroke_outline: 'text-cyan-400',
                outer_silhouette: 'text-emerald-400',
                limb_contour: 'text-cyan-400',
                facial_detail: 'text-blue-400',
                eye_detail: 'text-yellow-400',
                fill_boundary: 'text-orange-400',
                artifact: 'text-red-400',
              };
              return (
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(counts).map(([cat, count]) => (
                    <Metric key={cat} label={cat} value={count} color={colors[cat] || 'text-slate-400'} />
                  ))}
                  <Metric label="Exportados" value={sc.exportableCount} color="text-emerald-400" />
                  <Metric label="Excluidos" value={sc.excludedCount} color="text-orange-400" />
                </div>
              );
            })()}
          </div>

          {/* Dark stroke detection */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Brush className="w-3 h-3 text-cyan-400" />
              <span className="text-[10px] font-bold text-slate-400">Dark Stroke Detection</span>
            </div>
            {(() => {
              const ds = getLastDarkStroke();
              if (!ds) return <div className="text-[10px] text-slate-600">Sin máscara (sube una imagen)</div>;
              return (
                <div className="grid grid-cols-2 gap-1.5">
                  <Metric label="Fuente" value={ds.source === 'strict_raw_original_bitmap' ? 'STRICT' : (ds.source || 'old')} color={ds.source === 'strict_raw_original_bitmap' ? 'text-emerald-400' : 'text-amber-400'} />
                  <Metric label="Componentes" value={ds.components?.length || 0} color="text-cyan-400" />
                  <Metric label="ExportedPaths" value={ds.exportedPaths?.length || 0} color={ds.exportedPaths?.length ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Confianza" value={(ds.confidence ?? 0) + '%'} color="text-violet-400" />
                  <Metric label="Boca detectada" value={ds.hasMouth ? 'YES' : (ds.mouthCandidate ? 'YES' : 'NO')} color={(ds.hasMouth || ds.mouthCandidate) ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Ojos" value={ds.hasEyes ? 'YES' : (ds.eyeCandidates?.length ? 'YES' : 'NO')} color={(ds.hasEyes || ds.eyeCandidates?.length) ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Contorno inferior" value={ds.hasLowerContour ? 'YES' : 'NO'} color={ds.hasLowerContour ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Avg dark support" value={(ds.averagePathDarkSupport ?? 0).toFixed(3)} color={(ds.averagePathDarkSupport ?? 0) >= 0.90 ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Frontera rosa" value={ds.hasPinkBoundary ? 'YES' : 'NO'} color={ds.hasPinkBoundary ? 'text-red-400' : 'text-emerald-400'} />
                  <Metric label="Puntadas dark" value={report.darkStrokeStitches || 0} color={report.darkStrokeStitches > 0 ? 'text-emerald-400' : 'text-amber-400'} />
                </div>
              );
            })()}
          </div>

          {/* Universal dark contour metrics + test suite */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Brush className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] font-bold text-slate-400">Universal Dark Contours</span>
            </div>
            {(() => {
              const u = getLastUniversalReport();
              if (!u) return <div className="text-[10px] text-slate-600">Sin contornos universales</div>;
              const v = validateUniversalContours(u);
              return (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Metric label="Raw segments" value={u.rawSkeletonSegments} color="text-slate-400" />
                    <Metric label="Components" value={u.connectedDarkComponents} color="text-cyan-400" />
                    <Metric label="Consolidados" value={u.consolidatedContours} color={u.consolidatedContours >= 1 && u.consolidatedContours <= 20 ? 'text-emerald-400' : 'text-amber-400'} />
                    <Metric label="Outer" value={u.outerOutlineCount} color={u.outerOutlineCount > 0 ? 'text-emerald-400' : 'text-amber-400'} />
                    <Metric label="Inner" value={u.innerOutlineCount} color="text-blue-400" />
                    <Metric label="Detail" value={u.detailOpenCurveCount} color="text-yellow-400" />
                    <Metric label="Noise rejected" value={u.rejectedNoiseCount} color="text-red-400" />
                    <Metric label="Fill boundary" value={u.rejectedFillBoundaryCount} color="text-purple-400" />
                    <Metric label="Coverage" value={u.darkContourCoverage + '%'} color={u.darkContourCoverage >= 85 ? 'text-emerald-400' : 'text-red-400'} />
                    <Metric label="Outer cov" value={u.outerCoverage + '%'} color={u.outerCoverage >= 90 ? 'text-emerald-400' : 'text-amber-400'} />
                    <Metric label="Inner cov" value={u.innerCoverage + '%'} color="text-blue-400" />
                    <Metric label="Detail cov" value={u.detailCoverage + '%'} color="text-yellow-400" />
                    <Metric label="Fill exported" value={u.fillBoundaryExported ? 'YES' : 'NO'} color={!u.fillBoundaryExported ? 'text-emerald-400' : 'text-red-400'} />
                    <Metric label="Artificial" value={u.artificialGeometryCount} color={u.artificialGeometryCount === 0 ? 'text-emerald-400' : 'text-red-400'} />
                  </div>
                  <div className="mt-2 pt-2 border-t border-[#1e2130]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-slate-500 uppercase tracking-wider">Universal Test Suite</span>
                      <span className={`text-[10px] font-bold ${v.pass ? 'text-emerald-400' : 'text-red-400'}`}>{v.pass ? 'PASS' : 'FAIL'}</span>
                    </div>
                    <div className="space-y-0.5">
                      {v.checks.map(ch => (
                        <div key={ch.id} className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-400">{ch.label}</span>
                          <span className={ch.pass ? 'text-emerald-400' : 'text-red-400'}>{ch.pass ? 'PASS' : 'FAIL'} <span className="text-slate-600 ml-1">{ch.detail}</span></span>
                        </div>
                      ))}
                    </div>
                    <div className="text-[9px] text-slate-600 mt-1.5">Escenarios: {DESIGN_SCENARIOS.map(s => s.name).join(' · ')}</div>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Lower contour — body + feet rebuild metrics (CAMBIO 9) */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Route className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] font-bold text-slate-400">Lower Contour (body + feet)</span>
            </div>
            {(() => {
              const lc = getLastLowerContourReport();
              if (!lc) return <div className="text-[10px] text-slate-600">Sin datos</div>;
              return (
                <div className="grid grid-cols-2 gap-1.5">
                  <Metric label="Borde inferior" value={lc.lowerBodyContourPresent ? 'YES' : 'NO'} color={lc.lowerBodyContourPresent ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Pie izquierdo" value={lc.leftFootContourPresent ? 'YES' : 'NO'} color={lc.leftFootContourPresent ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Pie derecho" value={lc.rightFootContourPresent ? 'YES' : 'NO'} color={lc.rightFootContourPresent ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Cobertura body" value={lc.lowerBodyContourCoverage + '%'} color={lc.lowerBodyContourCoverage >= 95 ? 'text-emerald-400' : 'text-amber-400'} />
                  <Metric label="Cobertura pie izq." value={lc.leftFootContourCoverage + '%'} color={lc.leftFootContourCoverage >= 95 ? 'text-emerald-400' : 'text-amber-400'} />
                  <Metric label="Cobertura pie der." value={lc.rightFootContourCoverage + '%'} color={lc.rightFootContourCoverage >= 95 ? 'text-emerald-400' : 'text-amber-400'} />
                  <Metric label="Extremos abiertos" value={lc.lowerContourOpenEnds} color={lc.lowerContourOpenEnds === 0 ? 'text-emerald-400' : 'text-amber-400'} />
                  <Metric label="Caps redondos" value={lc.lowerContourRoundCapsVisible} color={lc.lowerContourRoundCapsVisible === 0 ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Fusionados" value={lc.lowerContourMergedSegments} color="text-cyan-400" />
                  <Metric label="Rechazados" value={lc.lowerContourRejectedSegments} color="text-orange-400" />
                  <Metric label="Geometría artificial" value={lc.artificialLowerGeometry} color={lc.artificialLowerGeometry === 0 ? 'text-emerald-400' : 'text-red-400'} />
                  <Metric label="Rebuilt" value={lc.rebuiltCount} color="text-violet-400" />
                </div>
              );
            })()}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            width={400}
            height={300}
            className="w-full bg-[#0d0f14] border border-[#1e2130] rounded-lg"
          />
          {viewMode === 'contours_travel' && (
            <div className="flex items-center gap-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#1a1a1a]"></span> Contorno</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 border-t border-dashed border-[#22c55e]"></span> Jump</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-[#ef4444] rounded-full"></span> Trim</span>
            </div>
          )}
          {viewMode === 'contours_only' && (
            <div className="text-[10px] text-slate-500">Solo se muestran outer_outline, inner_outline, mouth y detail_run.</div>
          )}
          {viewMode === 'discarded' && (
            <div className="flex items-center gap-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#1a1a1a]"></span> Contorno real</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 border-t border-dashed border-[#f97316]"></span> Frontera descartada</span>
            </div>
          )}
          {viewMode === 'classification' && (
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#22c55e]"></span> real_outline</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#3b82f6]"></span> inner_outline</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#eab308]"></span> detail_open_curve</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#64748b]"></span> travel_only</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#a855f7]"></span> fill_boundary</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#ef4444]"></span> rejected</span>
            </div>
          )}
          {viewMode === 'dark_stroke' && (
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#22d3ee]"></span> Línea oscura</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#22c55e]"></span> Contorno exportable</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#eab308]"></span> Boca/facial</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#06b6d4]"></span> Ojo</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 border-t border-dashed border-[#f97316]"></span> Frontera descartada</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#ef4444]"></span> Artefacto</span>
            </div>
          )}
          {viewMode === 'universal' && (
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#22c55e]"></span> outer_outline</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#3b82f6]"></span> inner_outline</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#eab308]"></span> detail_open_curve</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#ef4444]"></span> rejected_noise</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#a855f7]"></span> fill_boundary</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div>
      <div className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</div>
      <div className={`text-xs font-bold ${color}`}>{value}</div>
    </div>
  );
}