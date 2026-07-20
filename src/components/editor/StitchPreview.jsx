/**
 * StitchPreview.jsx
 *
 * Vista Previa de Puntadas Interactiva — fusión de:
 *  • Panel de regiones con filtros, visibilidad y selección
 *  • Simulación física con canvas de capas (tejido + puntadas + post-process)
 *
 * Props:
 *   imageUrl   — URL de la imagen original
 *   regions    — array de regiones enriquecidas del pipeline
 *   config     — { fabric_type, width_mm, height_mm }
 *   onClose    — callback para cerrar el modal
 *   onExport   — callback para confirmar y exportar
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { X, Eye, EyeOff, Pencil, Download, ZoomIn, ZoomOut, Maximize2, Sliders, CheckCircle2 } from 'lucide-react';
import { generateTatamiFill } from '@/lib/tatamiFill';
import {
  drawFabricTexture,
  drawPhysicalStitch,
  drawUnderlayStitches,
  FABRIC_SIM_PARAMS,
  STITCH_TYPE_PROFILES,
} from '@/lib/physicsSimulator';

// ─── Sample path generator ────────────────────────────────────────────────────

function genSamplePath(x0, y0, x1, y1) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return [
    [x0, y0], [mx, y0 * 0.95], [x1, y0], [x1, my],
    [x1, y1], [mx, y1 * 1.02], [x0, y1], [x0, my], [x0, y0],
  ];
}

// ─── Sample data (used when no regions prop provided) ─────────────────────────

const SAMPLE_REGIONS = [
  { id: 'r1',  name: '39a935',          stitch_type: 'fill',   color: '#39a935', visible: true, stitch_count: 450,  path_points: genSamplePath(0.15, 0.15, 0.35, 0.35) },
  { id: 'r2',  name: 'contour_39a935',  stitch_type: 'satin',  color: '#000000', visible: true, stitch_count: 120,  path_points: genSamplePath(0.12, 0.12, 0.38, 0.38) },
  { id: 'r3',  name: 'contour_e31d2d',  stitch_type: 'satin',  color: '#e31d2d', visible: true, stitch_count: 200,  path_points: genSamplePath(0.40, 0.10, 0.60, 0.30) },
  { id: 'r4',  name: 'contour_e31d2d',  stitch_type: 'satin',  color: '#e31d2d', visible: true, stitch_count: 180,  path_points: genSamplePath(0.55, 0.40, 0.75, 0.65) },
  { id: 'r5',  name: 'contour_f07e1f',  stitch_type: 'satin',  color: '#f07e1f', visible: true, stitch_count: 95,   path_points: genSamplePath(0.20, 0.55, 0.45, 0.80) },
  { id: 'r6',  name: 'd0bb38',          stitch_type: 'running_stitch', color: '#d0bb38', visible: true, stitch_count: 320, path_points: genSamplePath(0.60, 0.60, 0.85, 0.85) },
  { id: 'r7',  name: 'contour_bd460e',  stitch_type: 'satin',  color: '#bd460e', visible: true, stitch_count: 150,  path_points: genSamplePath(0.65, 0.15, 0.90, 0.40) },
  { id: 'r8',  name: 'contour_b6a22b',  stitch_type: 'satin',  color: '#b6a22b', visible: true, stitch_count: 110,  path_points: genSamplePath(0.05, 0.65, 0.30, 0.90) },
  { id: 'r9',  name: 'contour_d0bb38',  stitch_type: 'satin',  color: '#d0bb38', visible: true, stitch_count: 140,  path_points: genSamplePath(0.35, 0.35, 0.60, 0.60) },
  { id: 'r10', name: 'contour_f07e1f2', stitch_type: 'satin',  color: '#f07e1f', visible: true, stitch_count: 175,  path_points: genSamplePath(0.70, 0.70, 0.95, 0.95) },
];

// ─── Type config ──────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  fill:            { label: 'Fill',  badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  satin:           { label: 'Satin', badgeClass: 'bg-blue-100 text-blue-700 border-blue-200'         },
  running_stitch:  { label: 'Run',   badgeClass: 'bg-orange-100 text-orange-700 border-orange-200'   },
};

function typeBadge(type) {
  const cfg = TYPE_CONFIG[type] || { label: type, badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${cfg.badgeClass}`}>
      {cfg.label}
    </span>
  );
}

function isContourRegion(r) {
  return (r.name || '').toLowerCase().includes('contour_') ||
    ['#000000', '#1a1a1a'].includes((r.color || '').toLowerCase());
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StitchPreview({ imageUrl, regions: regionsIn, config = {}, onClose, onExport }) {
  const sourceRegions = (regionsIn && regionsIn.length > 0) ? regionsIn : SAMPLE_REGIONS;

  // ── State ──────────────────────────────────────────────────────────────────
  const [regions,       setRegions]      = useState(() => sourceRegions.map(r => ({ ...r, visible: r.visible !== false })));
  const [selectedId,    setSelectedId]   = useState(null);
  const [hoveredId,     setHoveredId]    = useState(null);
  const [filter,        setFilter]       = useState('all');   // 'all' | 'fill' | 'satin' | 'running_stitch'
  const [zoom,          setZoom]         = useState(1);
  const [offset,        setOffset]       = useState({ x: 0, y: 0 });
  const [isDragging,    setIsDragging]   = useState(false);
  const [dragStart,     setDragStart]    = useState(null);
  const [showControls,  setShowControls] = useState(false);

  const fabricType   = config.fabric_type || 'Algodón';
  const fabricPreset = FABRIC_SIM_PARAMS[fabricType] || FABRIC_SIM_PARAMS['Algodón'];

  const [simParams, setSimParams] = useState({
    threadScale:   1.0,
    tension:       fabricPreset?.tensionBase   ?? 0.5,
    glossiness:    fabricPreset?.glossiness    ?? 0.6,
    lightAngleDeg: fabricPreset?.lightAngleDeg ?? 45,
    showUnderlay:  true,
  });

  // Sync simParams when fabric changes
  useEffect(() => {
    const p = FABRIC_SIM_PARAMS[fabricType] || FABRIC_SIM_PARAMS['Algodón'];
    if (!p) return;
    setSimParams(prev => ({ ...prev, tension: p.tensionBase, glossiness: p.glossiness, lightAngleDeg: p.lightAngleDeg }));
    stitchCacheRef.current.clear();
  }, [fabricType]);

  // Sync regions when prop changes
  useEffect(() => {
    if (regionsIn && regionsIn.length > 0) {
      setRegions(regionsIn.map(r => ({ ...r, visible: r.visible !== false })));
    }
  }, [regionsIn]);

  // ── Canvas refs ────────────────────────────────────────────────────────────
  const fabricCanvasRef = useRef(null);
  const stitchCanvasRef = useRef(null);
  const postCanvasRef   = useRef(null);
  const containerRef    = useRef(null);
  const imageRef        = useRef(null);
  const stitchCacheRef  = useRef(new Map());
  const listItemRefs    = useRef({});

  // ── Filtered regions ───────────────────────────────────────────────────────
  const FILTER_MAP = { fill: 'fill', satin: 'satin', run: 'running_stitch' };
  const filteredRegions = useMemo(() => {
    if (filter === 'all') return regions;
    const typeKey = FILTER_MAP[filter];
    return regions.filter(r => r.stitch_type === typeKey);
  }, [regions, filter]);

  const visibleForCanvas = useMemo(() =>
    regions.filter(r => r.visible && r.path_points?.length >= 3),
    [regions]
  );

  // ── Sync scrolling: select in canvas → scroll panel ───────────────────────
  useEffect(() => {
    if (selectedId && listItemRefs.current[selectedId]) {
      listItemRefs.current[selectedId].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedId]);

  // ── Canvas resize ──────────────────────────────────────────────────────────
  function resizeCanvases() {
    const el = containerRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    for (const ref of [fabricCanvasRef, stitchCanvasRef, postCanvasRef]) {
      if (ref.current) { ref.current.width = W; ref.current.height = H; }
    }
  }

  useEffect(() => {
    const obs = new ResizeObserver(() => { resizeCanvases(); drawFabric(); drawStitches(); });
    if (containerRef.current) obs.observe(containerRef.current);
    resizeCanvases();
    return () => obs.disconnect();
  }, []);

  // ── Load image ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageRef.current = img; drawFabric(); drawStitches(); };
    img.src = imageUrl;
  }, [imageUrl]);

  // ── Redraw on changes ──────────────────────────────────────────────────────
  useEffect(() => { drawFabric(); drawStitches(); }, [visibleForCanvas, zoom, offset, simParams, selectedId, hoveredId]);

  // ── Layer 1: fabric texture ────────────────────────────────────────────────
  const drawFabric = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    // Light fabric base for this UI (white/light mode)
    ctx.fillStyle = '#f1f0eb';
    ctx.fillRect(0, 0, W, H);
    try { drawFabricTexture(ctx, W, H, fabricType); } catch (_) {}
  }, [fabricType]);

  // ── Layer 3: post-process ──────────────────────────────────────────────────
  const drawPostProcess = useCallback(() => {
    const canvas = postCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.7, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.20)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }, []);

  // ── Layer 2: stitches ──────────────────────────────────────────────────────
  const drawStitches = useCallback(() => {
    const canvas = stitchCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const sorted = [...visibleForCanvas].sort((a, b) => {
      const ac = isContourRegion(a), bc = isContourRegion(b);
      if (ac && !bc) return 1;
      if (!ac && bc) return -1;
      const pa = a.travelOrder ?? a.priority ?? (a.stitch_type === 'fill' ? 2 : a.stitch_type === 'satin' ? 5 : 8);
      const pb = b.travelOrder ?? b.priority ?? (b.stitch_type === 'fill' ? 2 : b.stitch_type === 'satin' ? 5 : 8);
      return pa - pb;
    });

    const drawW = W * 0.78, drawH = H * 0.78;
    const designW = config.width_mm  || 100;
    const designH = config.height_mm || 100;
    const pxPerMm = Math.min(drawW / designW, drawH / designH);

    const threadMult       = FABRIC_SIM_PARAMS[fabricType]?.threadMult || 1;
    const physThreadPx     = 0.38 * pxPerMm * threadMult * (simParams.threadScale || 1.0);
    const threadThicknessPx = Math.max(1.2, physThreadPx);
    const baseParams       = { ...simParams, threadThicknessPx, zoom };

    ctx.save();
    ctx.translate(offset.x + W / 2, offset.y + H / 2);
    ctx.scale(zoom, zoom);

    for (let li = 0; li < sorted.length; li++) {
      const region   = sorted[li];
      const pts      = region.path_points;
      const color    = region.color || '#888888';
      const isSelected = region.id === selectedId;
      const isHovered  = region.id === hoveredId;
      const effectiveType = isContourRegion(region) ? 'running_stitch' : (region.stitch_type || 'fill');
      const layerDepth = Math.min(li / sorted.length * 2, 1.5);
      const regionParams = { ...baseParams, layerDepth, stitchType: effectiveType };

      ctx.save();

      // Highlight ring for selected/hovered
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.moveTo((pts[0][0] - 0.5) * drawW, (pts[0][1] - 0.5) * drawH);
        for (let i = 1; i < pts.length; i++) ctx.lineTo((pts[i][0] - 0.5) * drawW, (pts[i][1] - 0.5) * drawH);
        ctx.closePath();
        ctx.strokeStyle = isSelected ? '#7c3aed' : '#a78bfa';
        ctx.lineWidth   = isSelected ? 3 / zoom : 1.5 / zoom;
        ctx.globalAlpha = isSelected ? 0.95 : 0.65;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Clip to region boundary
      ctx.beginPath();
      ctx.moveTo((pts[0][0] - 0.5) * drawW, (pts[0][1] - 0.5) * drawH);
      for (let i = 1; i < pts.length; i++) ctx.lineTo((pts[i][0] - 0.5) * drawW, (pts[i][1] - 0.5) * drawH);
      ctx.closePath();
      ctx.clip();

      // Dim non-selected regions when one is selected
      ctx.globalAlpha = selectedId && !isSelected && !isHovered ? 0.45 : 1;

      if (effectiveType === 'fill') {
        const density     = region.density || region.density_mm || 0.38;
        const angle       = region.fill_angle ?? region.angle ?? region.orientation ?? 45;
        const stitchLenMm = region.stitch_length_mm ?? 3.0;
        const cacheKey    = `${region.id}_${drawW.toFixed(0)}_${drawH.toFixed(0)}_${angle}_${density.toFixed(3)}_${stitchLenMm}_${color}`;
        let cached = stitchCacheRef.current.get(cacheKey);
        if (!cached) {
          const polygon = pts.map(p => [(p[0] - 0.5) * drawW, (p[1] - 0.5) * drawH]);
          try { const { stitches } = generateTatamiFill(polygon, density, stitchLenMm, angle, pxPerMm); cached = stitches; }
          catch (_) { cached = []; }
          stitchCacheRef.current.set(cacheKey, cached);
        }
        if (simParams.showUnderlay && region.underlay !== false) {
          try { drawUnderlayStitches(ctx, cached, color, { ...regionParams, zoom, stitchType: 'fill' }); } catch (_) {}
        }
        ctx.globalAlpha = (selectedId && !isSelected) ? 0.45 : 0.96;
        for (const [x0, y0, x1, y1] of cached) {
          try { drawPhysicalStitch(ctx, x0, y0, x1, y1, color, regionParams); } catch (_) {}
        }

      } else if (effectiveType === 'satin') {
        const satinAngle = ((region.fill_angle ?? region.angle ?? 45) * Math.PI) / 180;
        const spacingPx  = Math.max(0.8, (STITCH_TYPE_PROFILES?.satin?.threadDiameterMm ?? 0.35) * pxPerMm);
        const xs = pts.map(p => (p[0] - 0.5) * drawW);
        const ys = pts.map(p => (p[1] - 0.5) * drawH);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const diagLen = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.5 + spacingPx * 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(satinAngle);
        for (let sy = -diagLen; sy <= diagLen; sy += spacingPx) {
          try { drawPhysicalStitch(ctx, -diagLen, sy, diagLen, sy, color, { ...regionParams, zoom }); } catch (_) {}
        }
        ctx.restore();

      } else {
        // Running stitch — dashed physical segments
        const dashPx = Math.max(2, 3.5 / zoom), gapPx = Math.max(1.5, 2.5 / zoom);
        let acc = 0, drawing = true;
        for (let i = 0; i < pts.length - 1; i++) {
          const x0c = (pts[i][0]   - 0.5) * drawW, y0c = (pts[i][1]   - 0.5) * drawH;
          const x1c = (pts[i+1][0] - 0.5) * drawW, y1c = (pts[i+1][1] - 0.5) * drawH;
          const segLen = Math.hypot(x1c - x0c, y1c - y0c);
          if (segLen < 0.1) continue;
          let t = 0;
          while (t < 1) {
            const rem  = drawing ? dashPx - acc : gapPx - acc;
            const tEnd = Math.min(t + rem / segLen, 1);
            if (drawing) {
              try {
                drawPhysicalStitch(ctx,
                  x0c + (x1c - x0c) * t,   y0c + (y1c - y0c) * t,
                  x0c + (x1c - x0c) * tEnd, y0c + (y1c - y0c) * tEnd,
                  color, regionParams
                );
              } catch (_) {}
            }
            acc += (tEnd - t) * segLen;
            if (acc >= (drawing ? dashPx : gapPx) - 0.01) { drawing = !drawing; acc = 0; }
            t = tEnd;
            if (tEnd >= 1) break;
          }
        }
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.restore();
    drawPostProcess();
  }, [visibleForCanvas, zoom, offset, simParams, fabricType, config, selectedId, hoveredId]);

  // ── Canvas interaction ─────────────────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(z => Math.max(0.3, Math.min(20, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
  }, []);

  const handleMouseDown = (e) => { setIsDragging(true); setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y }); };
  const handleMouseMove = (e) => { if (isDragging && dragStart) setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); };
  const handleMouseUp   = () => { setIsDragging(false); setDragStart(null); };

  // Click on canvas: find region by centroid proximity (normalized coords → canvas coords)
  const handleCanvasClick = useCallback((e) => {
    const canvas = stitchCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width, H = canvas.height;
    const drawW = W * 0.78, drawH = H * 0.78;
    // Transform click to design space
    const mx = ((e.clientX - rect.left) - (offset.x + W / 2)) / zoom;
    const my = ((e.clientY - rect.top)  - (offset.y + H / 2)) / zoom;
    // Convert to normalized [0,1]
    const nx = mx / drawW + 0.5;
    const ny = my / drawH + 0.5;

    let bestId = null, bestDist = Infinity;
    for (const r of visibleForCanvas) {
      const c = r.centroid;
      if (c) {
        const d = Math.hypot(nx - c[0], ny - c[1]);
        if (d < bestDist) { bestDist = d; bestId = r.id; }
      } else if (r.path_points?.length) {
        const xs = r.path_points.map(p => p[0]);
        const ys = r.path_points.map(p => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const d  = Math.hypot(nx - cx, ny - cy);
        if (d < bestDist) { bestDist = d; bestId = r.id; }
      }
    }
    if (bestId) setSelectedId(prev => prev === bestId ? null : bestId);
  }, [visibleForCanvas, zoom, offset]);

  const toggleVisibility = useCallback((id) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, visible: !r.visible } : r));
    stitchCacheRef.current.clear();
  }, []);

  const fitToScreen = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };

  const downloadPNG = () => {
    const W = fabricCanvasRef.current?.width || 800;
    const H = fabricCanvasRef.current?.height || 600;
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
    const ctx = tmp.getContext('2d');
    if (fabricCanvasRef.current) ctx.drawImage(fabricCanvasRef.current, 0, 0);
    if (stitchCanvasRef.current) ctx.drawImage(stitchCanvasRef.current, 0, 0);
    if (postCanvasRef.current)   ctx.drawImage(postCanvasRef.current,   0, 0);
    const a = document.createElement('a'); a.download = 'stitch-preview.png'; a.href = tmp.toDataURL('image/png', 0.95); a.click();
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalStitches  = useMemo(() => regions.reduce((s, r) => s + (r.stitch_count || r.stitchCount || 0), 0), [regions]);
  const colorCount     = useMemo(() => new Set(regions.map(r => r.color)).size, [regions]);
  const widthMm        = config.width_mm  || 100;
  const heightMm       = config.height_mm || 100;

  const FILTERS = [
    { id: 'all',   label: 'Todas' },
    { id: 'fill',  label: 'Fill'  },
    { id: 'satin', label: 'Satin' },
    { id: 'run',   label: 'Run'   },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0 bg-gray-50">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Vista Previa de Puntadas Interactiva</h2>
            <p className="text-sm text-gray-500 mt-0.5">Haz clic en una región para seleccionarla · Arrastra para navegar · Scroll para zoom</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-semibold">
              ✦ Simulación física
            </span>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-200 transition-colors text-gray-500 hover:text-gray-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Body: canvas + panel ── */}
        <div className="flex flex-1 min-h-0">

          {/* ── Canvas (60%) ── */}
          <div className="flex flex-col" style={{ width: '60%' }}>
            {/* Canvas toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-white flex-shrink-0">
              <CanvasBtn onClick={() => setZoom(z => Math.min(20, z * 1.25))} title="Zoom In"><ZoomIn className="w-3.5 h-3.5" /></CanvasBtn>
              <CanvasBtn onClick={() => setZoom(z => Math.max(0.3, z / 1.25))} title="Zoom Out"><ZoomOut className="w-3.5 h-3.5" /></CanvasBtn>
              <CanvasBtn onClick={fitToScreen} title="Ajustar"><Maximize2 className="w-3.5 h-3.5" /></CanvasBtn>
              <div className="w-px h-4 bg-gray-200 mx-1" />
              <CanvasBtn
                onClick={() => setShowControls(v => !v)}
                active={showControls}
                title="Parámetros físicos"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span className="ml-1 text-xs">Físico</span>
              </CanvasBtn>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs font-mono text-gray-400">{Math.round(zoom * 100)}%</span>
                <CanvasBtn onClick={downloadPNG} title="Exportar PNG">
                  <Download className="w-3.5 h-3.5" />
                  <span className="ml-1 text-xs">PNG</span>
                </CanvasBtn>
              </div>
            </div>

            {/* Physics controls */}
            {showControls && (
              <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex-shrink-0">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <SimSlider label="Escala de hilo"   value={simParams.threadScale}   min={0.5} max={2.5} step={0.05} color="text-violet-600"
                    onChange={v => { setSimParams(p => ({ ...p, threadScale: v })); stitchCacheRef.current.clear(); }}
                    display={v => v === 1.0 ? '1× real' : `${v.toFixed(2)}×`} />
                  <SimSlider label="Tensión"          value={simParams.tension}       min={0}   max={1}   step={0.05} color="text-cyan-600"
                    onChange={v => setSimParams(p => ({ ...p, tension: v }))}
                    display={v => v < 0.4 ? 'Flojo' : v < 0.7 ? 'Normal' : 'Tenso'} />
                  <SimSlider label="Brillo"           value={simParams.glossiness}    min={0}   max={1}   step={0.05} color="text-amber-600"
                    onChange={v => setSimParams(p => ({ ...p, glossiness: v }))}
                    display={v => v < 0.3 ? 'Mate' : v < 0.6 ? 'Semi' : 'Brillante'} />
                  <SimSlider label="Ángulo de luz"    value={simParams.lightAngleDeg} min={0}   max={360} step={5}    color="text-emerald-600"
                    onChange={v => setSimParams(p => ({ ...p, lightAngleDeg: v }))}
                    display={v => `${v}°`} />
                </div>
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-200">
                  <label className="flex items-center gap-2 cursor-pointer" onClick={() => setSimParams(p => ({ ...p, showUnderlay: !p.showUnderlay }))}>
                    <div className={`relative w-8 h-4 rounded-full transition-colors ${simParams.showUnderlay ? 'bg-violet-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${simParams.showUnderlay ? 'translate-x-4' : ''}`} />
                    </div>
                    <span className="text-xs text-gray-600">Mostrar underlay</span>
                  </label>
                  <button
                    onClick={() => {
                      const p = FABRIC_SIM_PARAMS[fabricType] || FABRIC_SIM_PARAMS['Algodón'];
                      setSimParams(prev => ({ ...prev, tension: p?.tensionBase ?? 0.5, glossiness: p?.glossiness ?? 0.6, lightAngleDeg: p?.lightAngleDeg ?? 45, threadScale: 1.0 }));
                      stitchCacheRef.current.clear();
                    }}
                    className="ml-auto text-xs text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    ↺ Restablecer
                  </button>
                </div>
              </div>
            )}

            {/* Canvas stack */}
            <div
              ref={containerRef}
              className="flex-1 relative overflow-hidden"
              style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={handleCanvasClick}
            >
              <canvas ref={fabricCanvasRef} className="absolute inset-0 w-full h-full" />
              <canvas ref={stitchCanvasRef} className="absolute inset-0 w-full h-full" />
              <canvas ref={postCanvasRef}   className="absolute inset-0 w-full h-full pointer-events-none" />

              {selectedId && (
                <div className="absolute top-3 left-3 bg-violet-600 text-white text-xs px-3 py-1.5 rounded-full shadow-md pointer-events-none font-semibold">
                  {regions.find(r => r.id === selectedId)?.name || selectedId}
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel (40%) ── */}
          <div className="flex flex-col border-l border-gray-200 bg-gray-50" style={{ width: '40%' }}>

            {/* Panel header */}
            <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-800">
                  Regiones <span className="text-gray-400 font-normal">({filteredRegions.length})</span>
                </h3>
                {selectedId && (
                  <button onClick={() => setSelectedId(null)} className="text-xs text-violet-600 hover:text-violet-800 font-medium">
                    Deseleccionar
                  </button>
                )}
              </div>

              {/* Type filters */}
              <div className="flex gap-1">
                {FILTERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                      filter === f.id
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Region list */}
            <div className="flex-1 overflow-y-auto py-2">
              {filteredRegions.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-gray-400">Sin regiones</div>
              ) : (
                filteredRegions.map(region => {
                  const isSelected = region.id === selectedId;
                  const isHovered  = region.id === hoveredId;
                  return (
                    <div
                      key={region.id}
                      ref={el => { if (el) listItemRefs.current[region.id] = el; }}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all border-l-2 ${
                        isSelected
                          ? 'bg-violet-50 border-violet-500'
                          : isHovered
                            ? 'bg-gray-100 border-transparent'
                            : 'border-transparent hover:bg-gray-100'
                      }`}
                      onClick={() => setSelectedId(prev => prev === region.id ? null : region.id)}
                      onMouseEnter={() => setHoveredId(region.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      {/* Color circle */}
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-300 shadow-sm"
                        style={{ background: region.color }}
                      />

                      {/* Name + badge */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs font-medium truncate max-w-[120px] ${isSelected ? 'text-violet-800' : 'text-gray-700'}`}>
                            {region.name}
                          </span>
                          {typeBadge(region.stitch_type)}
                          {isSelected && <CheckCircle2 className="w-3 h-3 text-violet-500 flex-shrink-0" />}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {(region.stitch_count || region.stitchCount || 0).toLocaleString()} puntadas
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); /* edit hook */ }}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
                          title="Editar región"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); toggleVisibility(region.id); }}
                          className={`p-1 rounded transition-colors ${
                            region.visible
                              ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-200'
                              : 'text-gray-300 hover:bg-gray-200'
                          }`}
                          title={region.visible ? 'Ocultar' : 'Mostrar'}
                        >
                          {region.visible
                            ? <Eye    className="w-3 h-3" />
                            : <EyeOff className="w-3 h-3" />
                          }
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Stats + export */}
            <div className="flex-shrink-0 border-t border-gray-200 px-4 py-4 bg-white space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Total puntadas', value: totalStitches.toLocaleString() },
                  { label: 'Colores',        value: colorCount },
                  { label: 'Tamaño',         value: `${widthMm}×${heightMm}mm` },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 rounded-lg px-2 py-2 text-center border border-gray-100">
                    <div className="text-sm font-bold text-gray-800">{s.value}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{s.label}</div>
                  </div>
                ))}
              </div>

              <button
                onClick={onExport}
                className="w-full py-3 rounded-xl text-white text-sm font-bold shadow-md transition-all hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' }}
              >
                Confirmar y exportar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CanvasBtn({ onClick, children, title, active }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center px-2 py-1.5 rounded border text-xs transition-colors ${
        active
          ? 'border-violet-400 bg-violet-50 text-violet-700'
          : 'border-gray-200 bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function SimSlider({ label, value, min, max, step, onChange, display, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-violet-600 h-1"
      />
      <span className={`text-[11px] font-bold w-16 text-right ${color}`}>{display(value)}</span>
    </div>
  );
}