import { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import EmbroideryPreview3D from '@/components/editor/EmbroideryPreview3D.jsx';

/**
 * EmbroideryPreview: Canvas-based embroidery stitch visualization
 * Renders actual stitches in sequence with playback controls
 */
export default function EmbroideryPreview({ regions, config }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  // ─── State ──────────────────────────────────────────────────────────────
  const [progress, setProgress] = useState(100); // 0-100%
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // 1x, 2x, 5x, 10x
  const [showTravel, setShowTravel] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fabricColor, setFabricColor] = useState('#ffffff');
  const [viewMode, setViewMode] = useState('sequential'); // 'flat', 'sequential', 'layers'
  const [show3D, setShow3D] = useState(false); // toggle 3D view

  // ─── Build stitches array from regions (memoizado) ──────────────────────────────
  // Solo recalcula si regions o config cambian; progress no afecta la construcción
  const stitches = useMemo(() => buildStitchesFromRegions(regions, config), [regions, config]);
  const visibleStitches = useMemo(() => stitches.slice(0, Math.ceil((progress / 100) * stitches.length)), [stitches, progress]);

  // ─── Playback animation loop ────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;

    const speedMultiplier = speed === 1 ? 1 : speed === 2 ? 2 : speed === 5 ? 5 : 10;
    const frameDelay = Math.max(16, 100 / speedMultiplier); // ms per frame

    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = prev + (frameDelay / 16) * (100 / stitches.length) * speedMultiplier;
        if (next >= 100) {
          setIsPlaying(false);
          return 100;
        }
        return next;
      });
    }, frameDelay);

    return () => clearInterval(interval);
  }, [isPlaying, speed, stitches.length]);

  // ─── Canvas rendering ───────────────────────────────────────────────────
  // ─── Canvas rendering (optimizado: solo redibuja cuando cambian datos visuales)
  const drawingParams = useMemo(() => ({
    bounds: stitches.length > 0 ? calculateBounds(stitches) : null,
    scale: stitches.length > 0 ? calculateScale(calculateBounds(stitches), 800, 600, zoom) : 1,
  }), [stitches, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Draw fabric background (always visible, not part of stitch phases)
    ctx.fillStyle = fabricColor;
    ctx.fillRect(0, 0, w, h);

    if (stitches.length === 0 || !drawingParams.bounds) {
      // Even with no stitches, show the fabric
      drawInfoOverlay(ctx, w, h, progress, 0, 0, config);
      return;
    }

    const bounds = drawingParams.bounds;
    const scale = drawingParams.scale;
    const offsetX = (w - (bounds.maxX - bounds.minX) * scale) / 2;
    const offsetY = (h - (bounds.maxY - bounds.minY) * scale) / 2;

    const toScreenX = (x) => offsetX + (x - bounds.minX) * scale;
    const toScreenY = (y) => offsetY + (y - bounds.minY) * scale;

    // Draw based on view mode
    if (viewMode === 'flat') {
      drawAllStitches(ctx, stitches, toScreenX, toScreenY, showTravel);
    } else if (viewMode === 'sequential') {
      drawStitchesSequential(ctx, visibleStitches, stitches, toScreenX, toScreenY, showTravel);
    } else if (viewMode === 'layers') {
      drawStitchesByLayer(ctx, regions, stitches, progress, toScreenX, toScreenY, showTravel);
    }

    // Info overlay
    drawInfoOverlay(ctx, w, h, progress, visibleStitches.length, stitches.length, config);
  }, [visibleStitches, progress, zoom, fabricColor, viewMode, showTravel, regions, config, stitches.length, drawingParams]);

  // ─── Controls ───────────────────────────────────────────────────────────
  const handlePlayPause = () => {
    if (progress >= 99.5) setProgress(0);
    setIsPlaying(!isPlaying);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setProgress(0);
  };

  const handleZoomIn = () => setZoom((z) => Math.min(3, z * 1.25));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, z / 1.25));

  // If 3D view is enabled, show the 3D component instead
  if (show3D) {
    return (
      <div className="relative h-full w-full flex flex-col">
        {/* 3D Toggle Button */}
        <div className="flex-shrink-0 border-b border-[#1e2130] bg-[#0a0c12] p-2">
          <button
            onClick={() => setShow3D(false)}
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
          >
            ← 2D
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <EmbroideryPreview3D regions={regions} config={config} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0f14]">
      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-[#1e2130] bg-[#0a0c12] p-2 space-y-2">
        {/* Top row: Playback controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePlayPause}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? 'Pausa' : 'Reproducir'}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[#161a23] border border-[#2a2d3a] text-slate-400 hover:text-white text-xs font-medium transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reiniciar
          </button>

          <div className="flex-1 flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              value={progress}
              onChange={(e) => {
                setProgress(Number(e.target.value));
                setIsPlaying(false);
              }}
              className="flex-1 accent-violet-600 h-1.5 rounded-lg"
              title="Progreso de reproducción"
            />
            <span className="text-xs text-slate-400 font-mono w-12">
              {Math.round(progress)}%
            </span>
          </div>

          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="px-2 py-1 rounded bg-[#161a23] border border-[#2a2d3a] text-slate-300 text-xs font-medium"
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
          </select>
        </div>

        {/* Bottom row: View options */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-[#2a2d3a] overflow-hidden bg-[#0d0f14]">
            {['flat', 'sequential', 'layers'].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-violet-600/30 text-violet-300 border-r border-violet-500/30'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {mode === 'flat' ? 'Plano' : mode === 'sequential' ? 'Secuencial' : 'Capas'}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShow3D(true)}
            className="px-2.5 py-1 rounded-lg border border-[#2a2d3a] bg-[#0d0f14] text-slate-400 hover:text-slate-300 text-xs font-medium transition-colors"
            title="Vista 3D con relieve"
          >
            📦 3D
          </button>

          <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#2a2d3a] bg-[#0d0f14] text-slate-400 hover:text-slate-300 cursor-pointer text-xs font-medium transition-colors">
            <input
              type="checkbox"
              checked={showTravel}
              onChange={(e) => setShowTravel(e.target.checked)}
              className="w-3 h-3 rounded"
            />
            Travel
          </label>

          <div className="flex items-center gap-1 rounded-lg border border-[#2a2d3a] bg-[#0d0f14]">
            <button
              onClick={handleZoomOut}
              className="p-1 hover:bg-[#1a1d27] text-slate-400 hover:text-white transition-colors"
              title="Alejar"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-slate-500 px-1 font-mono w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1 hover:bg-[#1a1d27] text-slate-400 hover:text-white transition-colors"
              title="Acercar"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <select
            value={fabricColor}
            onChange={(e) => setFabricColor(e.target.value)}
            className="px-2 py-1 rounded bg-[#161a23] border border-[#2a2d3a] text-slate-300 text-xs font-medium h-7"
            title="Color de tela"
          >
            <option value="#ffffff">Blanco</option>
            <option value="#f5f1ea">Beige</option>
            <option value="#1a1a1a">Negro</option>
            <option value="#e8c4a0">Piel</option>
            <option value="#4a4a4a">Gris</option>
          </select>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#0d0f14] relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          className="border border-[#1e2130]"
          style={{ maxWidth: '100%', maxHeight: '100%' }}
        />
        {stitches.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
            Procesa la imagen para ver la vista previa del bordado
          </div>
        )}
      </div>

      {/* Status bar */}
      {stitches.length > 0 && (
        <div className="flex-shrink-0 border-t border-[#1e2130] bg-[#0a0c12] px-4 py-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-400">
            Puntadas: <span className="text-violet-400 font-bold">{visibleStitches.length}</span> /
            <span className="text-slate-500 ml-1">{stitches.length}</span>
          </span>
          <span className="text-slate-400">
            Cobertura:{' '}
            <span className={`font-bold ${calculateCoverage(regions) > 85 ? 'text-green-400' : calculateCoverage(regions) > 70 ? 'text-yellow-400' : 'text-orange-400'}`}>
              {calculateCoverage(regions)}%
            </span>
          </span>
          <span className="text-slate-400">
            Tiempo: <span className="text-cyan-400 font-bold">{estimateTime(stitches.length, config)}</span>
          </span>
          <span className="text-slate-400">
            Regiones: <span className="text-emerald-400 font-bold">{regions.length}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build stitches array from regions — FILL + CONTOURS
 * Genera tatami y satin fills con texturas diferenciadas
 * 
 * OPTIMIZACIÓN: Caché por región para evitar recalcular fills
 * cada vez que se actualiza el estado (zoom, progress, opacity, etc).
 * Solo recalcula si region.id, density, angle, o config cambian.
 */
const _stitchCache = new Map(); // regionId → {hash, stitches}

function buildStitchesFromRegions(regions, config) {
  const stitches = [];
  const designW = config.width_mm || 100;
  const designH = config.height_mm || 100;

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECUENCIADO CORRECTO: FASE 1 → FASE 2 → FASE 3
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // FASE 1: RELLENOS (fills) — Ordenados por prioridad (1-5 = fills)
  // Esto forma la BASE del bordado. La prioridad es asignada por EIE/enrichRegion
  const fillRegions = regions
    .filter(r => r.visible && r.path_points && r.path_points.length >= 3 && r.stitch_type === 'fill')
    .sort((a, b) => {
      // Primero por prioridad (menor = primero) — EIE asigna 1-5 a fills
      if ((a.priority || 999) !== (b.priority || 999)) {
        return (a.priority || 999) - (b.priority || 999);
      }
      // Luego por área (grande a pequeño) dentro de la misma prioridad
      return (b.area_mm2 || 0) - (a.area_mm2 || 0);
    });

  for (const region of fillRegions) {
    const color = region.color || '#ffffff';
    const angle = (region.angle || 0) * (Math.PI / 180);
    const polygonMm = region.path_points.map((p) => [p[0] * designW, p[1] * designH]);
    const density = region.tatami_density || region.density || 0.4;
    const stitchLen = 2.5;

    // Generar fill (tatami)
    const cacheKey = `${region.id}`;
    const paramHash = `fill|${density}|${angle}|${color}`;
    const cached = _stitchCache.get(cacheKey);
    
    let fillStitches;
    if (cached && cached.hash === paramHash) {
      fillStitches = cached.stitches;
    } else {
      fillStitches = generateTatamiFillLines(polygonMm, angle, density, stitchLen, color, region.id);
      _stitchCache.set(cacheKey, { hash: paramHash, stitches: fillStitches });
    }
    
    stitches.push(...fillStitches);
  }

  // FASE 2: DETALLES INTERNOS (run, small fills) — Orden por prioridad (6-9 = detalles)
  const detailRegions = regions
    .filter(r => r.visible && r.path_points && r.path_points.length >= 3 && (r.stitch_type === 'running_stitch' || (r.area_mm2 || 0) < 50))
    .sort((a, b) => {
      // Orden por prioridad (EIE asigna 6-9 a detalles)
      return (a.priority || 999) - (b.priority || 999);
    });

  for (const region of detailRegions) {
    const color = region.color || '#ffffff';
    const angle = (region.angle || 0) * (Math.PI / 180);
    const polygonMm = region.path_points.map((p) => [p[0] * designW, p[1] * designH]);

    // Generar contorno (detalles pequeños)
    const threadWidth = getThreadWidth(region.stitch_type);
    for (let i = 0; i < polygonMm.length - 1; i++) {
      const [x0, y0] = polygonMm[i];
      const [x1, y1] = polygonMm[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(2, Math.ceil(dist / 0.3));

      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        stitches.push({
          x: x0 + dx * t,
          y: y0 + dy * t,
          type: 'run',
          regionId: region.id,
          color,
          isJump: false,
          threadWidth: threadWidth * 0.7,
        });
      }
    }
  }

  // FASE 3: CONTORNOS SATIN (bordes) — ÚLTIMO (define los bordes limpios)
  // CRÍTICO: Esto va al FINAL para que cierre el bordado sobre los rellenos
  // EIE asigna prioridad 5-8 a satins, pero dentro de Fase 3 van todos después de fills
  const satinRegions = regions
    .filter(r => r.visible && r.path_points && r.path_points.length >= 3 && r.stitch_type === 'satin')
    .sort((a, b) => {
      // Orden por prioridad (EIE asigna 5-8 a satins)
      return (a.priority || 999) - (b.priority || 999);
    });

  for (const region of satinRegions) {
    const color = region.color || '#ffffff';
    const angle = (region.angle || 0) * (Math.PI / 180);
    const polygonMm = region.path_points.map((p) => [p[0] * designW, p[1] * designH]);
    const density = region.tatami_density || region.density || 0.4;
    const stitchLen = 2.5;

    // Generar satin fill (para satins anchos) o contorno satin (para contornos)
    const isSatinFill = region.compacidad > 0.15;
    
    const cacheKey = `${region.id}`;
    const paramHash = `satin|${density}|${angle}|${color}|${isSatinFill}`;
    const cached = _stitchCache.get(cacheKey);
    
    let satinStitches;
    if (cached && cached.hash === paramHash) {
      satinStitches = cached.stitches;
    } else {
      satinStitches = isSatinFill
        ? generateSatinFillLines(polygonMm, angle, density, stitchLen, color, region.id)
        : generateSatinContourLines(polygonMm, angle, color, region.id);
      _stitchCache.set(cacheKey, { hash: paramHash, stitches: satinStitches });
    }
    
    stitches.push(...satinStitches);
  }

  return stitches;
}

/**
 * DEFECTO 1-6 FIX: Scanline fill robusto con solapamiento automático para eliminar huecos
 * Garantiza: sin gaps, cobertura total, bordes limpios, solapamiento de filas
 */
function generateTatamiFillLines(polygon, angle, density, stitchLen, color, regionId) {
  const stitches = [];
  if (polygon.length < 3) return stitches;

  // DEFECTO 4 FIX: Calcular PCA sobre puntos reales del polígono (no bounding box)
  const pcaAngle = calculatePolygonPCA(polygon);
  const effectiveAngle = angle !== undefined ? angle : pcaAngle;

  // Rotate polygon into fill-space
  const cosA = Math.cos(effectiveAngle);
  const sinA = Math.sin(effectiveAngle);
  
  const rotatePoint = (x, y) => [
    x * cosA + y * sinA,
    -x * sinA + y * cosA,
  ];

  const rotatedPoly = polygon.map(p => rotatePoint(p[0], p[1]));
  
  // Calculate bbox of rotated polygon
  let rMinY = Infinity, rMaxY = -Infinity;
  for (const [x, y] of rotatedPoly) {
    rMinY = Math.min(rMinY, y);
    rMaxY = Math.max(rMaxY, y);
  }

  // DEFECTO 6 FIX: Densidad adaptativa con solapamiento automático
  // Reduce 10-20% el espaciado para garantizar solapamiento entre filas
  const realDensity = Math.max(0.25, Math.min(density, 0.6));
  const overlapFactor = 0.85; // 15% de solapamiento = filas se superponen
  const adjustedDensity = realDensity * overlapFactor;

  // DEFECTO 6 FIX: Generar scanlines con solapamiento garantizado
  for (let y = rMinY; y <= rMaxY; y += adjustedDensity) {
    // CRÍTICO: Encontrar TODAS las intersecciones (no solo pares)
    const intersections = [];
    for (let i = 0; i < rotatedPoly.length; i++) {
      const [x1, y1] = rotatedPoly[i];
      const [x2, y2] = rotatedPoly[(i + 1) % rotatedPoly.length];

      // Evitar casos degenerados
      if (Math.abs(y2 - y1) < 1e-6) continue;

      // Intersección de scanline con edge
      if ((y1 <= y && y <= y2) || (y2 <= y && y <= y1)) {
        const t = Math.abs(y2 - y1) > 1e-6 ? (y - y1) / (y2 - y1) : 0;
        const x = x1 + t * (x2 - x1);
        intersections.push(x);
      }
    }

    if (intersections.length < 2) continue;

    // Ordenar y generar segmentos entre pares (even-odd rule)
    intersections.sort((a, b) => a - b);
    
    for (let i = 0; i < intersections.length - 1; i += 2) {
      let x1 = intersections[i];
      let x2 = intersections[i + 1];
      
      // DEFECTO 2 FIX: Clipping robusto — expandir para evitar gaps EN BORDES
      // DEFECTO 6 FIX: Margen expandido para solapamiento de los bordes
      const margin = 0.12; // margen aumentado para garantizar solapamiento en transiciones
      x1 -= margin;
      x2 += margin;

      // Convertir de vuelta a espacio original
      const unrotate = (x, y) => [
        x * cosA - y * sinA,
        x * sinA + y * cosA,
      ];

      const [ox1, oy1] = unrotate(x1, y);
      const [ox2, oy2] = unrotate(x2, y);

      // Generar stitches a lo largo de la línea de fill con MAYOR densidad para cobertura
      const dx = ox2 - ox1;
      const dy = oy2 - oy1;
      const len = Math.hypot(dx, dy);
      // DEFECTO 6 FIX: Reducir espaciado entre stitches dentro de cada línea (0.8 en lugar de 1.2)
      // esto asegura que los puntos consecutivos se superpongan ligeramente
      const steps = Math.max(6, Math.ceil(len / 0.8)); // más puntos = más solapamiento

      for (let s = 0; s <= steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const x = ox1 + dx * t;
        const y = oy1 + dy * t;
        
        // DEFECTO 1 FIX: Verificar que el punto está DENTRO del polígono
        if (isPointInPolygon([x, y], polygon)) {
          stitches.push({
            x, y,
            type: 'fill',
            regionId,
            color,
            isJump: false,
            threadWidth: 0.42,
          });
        }
      }
    }
  }

  // DEFECTO 6 FIX: Pase de relleno de huecos — agregar filas intermedias si hay gaps detectados
  // Detectar cobertura y añadir filas intermedias donde falte
  const coverage = calculateFillCoverage(polygon, stitches);
  if (coverage < 0.95) {
    // Si cobertura < 95%, agregar filas intermedias
    for (let y = rMinY + adjustedDensity * 0.5; y <= rMaxY; y += adjustedDensity) {
      const intersections = [];
      for (let i = 0; i < rotatedPoly.length; i++) {
        const [x1, y1] = rotatedPoly[i];
        const [x2, y2] = rotatedPoly[(i + 1) % rotatedPoly.length];
        if (Math.abs(y2 - y1) < 1e-6) continue;
        if ((y1 <= y && y <= y2) || (y2 <= y && y <= y1)) {
          const t = Math.abs(y2 - y1) > 1e-6 ? (y - y1) / (y2 - y1) : 0;
          const x = x1 + t * (x2 - x1);
          intersections.push(x);
        }
      }
      if (intersections.length < 2) continue;
      
      intersections.sort((a, b) => a - b);
      for (let i = 0; i < intersections.length - 1; i += 2) {
        let x1 = intersections[i];
        let x2 = intersections[i + 1];
        x1 -= 0.12;
        x2 += 0.12;

        const unrotate = (x, y) => [x * cosA - y * sinA, x * sinA + y * cosA];
        const [ox1, oy1] = unrotate(x1, y);
        const [ox2, oy2] = unrotate(x2, y);

        const dx = ox2 - ox1;
        const dy = oy2 - oy1;
        const len = Math.hypot(dx, dy);
        const steps = Math.max(6, Math.ceil(len / 0.8));

        for (let s = 0; s <= steps; s++) {
          const t = steps > 0 ? s / steps : 0;
          const x = ox1 + dx * t;
          const y = oy1 + dy * t;
          
          if (isPointInPolygon([x, y], polygon)) {
            stitches.push({
              x, y,
              type: 'fill',
              regionId,
              color,
              isJump: false,
              threadWidth: 0.42,
            });
          }
        }
      }
    }
  }

  return stitches;
}

/**
 * Calcula el porcentaje de cobertura del relleno dentro del polígono
 * Usa grid-based sampling para detectar huecos
 */
function calculateFillCoverage(polygon, stitches) {
  if (stitches.length === 0 || polygon.length === 0) return 0;

  // Calcular bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  // Grid sampling — puntos en una grilla cada 0.3mm
  const gridSpacing = 0.3;
  let sampledInside = 0;
  let totalSamples = 0;

  for (let x = minX; x <= maxX; x += gridSpacing) {
    for (let y = minY; y <= maxY; y += gridSpacing) {
      if (isPointInPolygon([x, y], polygon)) {
        totalSamples++;
        // Verificar si hay stitch dentro de distancia de 0.5mm (radio de thread)
        const covered = stitches.some(s => Math.hypot(s.x - x, s.y - y) < 0.5);
        if (covered) sampledInside++;
      }
    }
  }

  return totalSamples > 0 ? sampledInside / totalSamples : 0;
}

/**
 * Calcula el ángulo de componente principal (PCA) sobre los puntos del polígono
 * DEFECTO 4 FIX: Usa la forma real, no bounding box
 */
function calculatePolygonPCA(polygon) {
  if (polygon.length < 3) return 0;
  
  // Calcular centroide
  const cx = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
  const cy = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
  
  // Matriz de covarianza
  let cov_xx = 0, cov_yy = 0, cov_xy = 0;
  for (const [x, y] of polygon) {
    const dx = x - cx;
    const dy = y - cy;
    cov_xx += dx * dx;
    cov_yy += dy * dy;
    cov_xy += dx * dy;
  }
  
  // Eigenvector del mayor eigenvalue
  const trace = cov_xx + cov_yy;
  const det = cov_xx * cov_yy - cov_xy * cov_xy;
  const lambda = (trace + Math.sqrt(trace * trace - 4 * det)) / 2;
  
  let angle = 0;
  if (Math.abs(cov_xy) > 1e-6) {
    angle = Math.atan2(lambda - cov_xx, cov_xy);
  } else if (cov_xx > cov_yy) {
    angle = 0;
  } else {
    angle = Math.PI / 2;
  }
  
  return angle;
}

/**
 * Verifica si un punto está dentro de un polígono usando ray casting
 */
function isPointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside;
}

/**
 * DEFECTO 1-6 FIX: Satin fill robusto con solapamiento automático
 */
function generateSatinFillLines(polygon, angle, density, stitchLen, color, regionId) {
  const stitches = [];
  if (polygon.length < 3) return stitches;

  // DEFECTO 4 FIX: Calcular PCA y rotar perpendicular
  const pcaAngle = calculatePolygonPCA(polygon);
  const satinAngle = (angle !== undefined ? angle : pcaAngle) + Math.PI / 2;

  const cosA = Math.cos(satinAngle);
  const sinA = Math.sin(satinAngle);
  
  const rotatePoint = (x, y) => [
    x * cosA + y * sinA,
    -x * sinA + y * cosA,
  ];

  const rotatedPoly = polygon.map(p => rotatePoint(p[0], p[1]));
  
  let rMinX = Infinity, rMaxX = -Infinity;
  for (const [x, y] of rotatedPoly) {
    rMinX = Math.min(rMinX, x);
    rMaxX = Math.max(rMaxX, x);
  }

  // DEFECTO 6 FIX: Solapamiento automático también en satin
  const satinDensity = Math.max(0.4, Math.min(density * 1.3, 0.8));
  const adjustedDensity = satinDensity * 0.85; // 15% solapamiento

  for (let x = rMinX; x <= rMaxX; x += adjustedDensity) {
    const intersections = [];
    for (let i = 0; i < rotatedPoly.length; i++) {
      const [x1, y1] = rotatedPoly[i];
      const [x2, y2] = rotatedPoly[(i + 1) % rotatedPoly.length];

      if (Math.abs(x2 - x1) < 1e-6) continue;

      if ((x1 <= x && x <= x2) || (x2 <= x && x <= x1)) {
        const t = Math.abs(x2 - x1) > 1e-6 ? (x - x1) / (x2 - x1) : 0;
        const y = y1 + t * (y2 - y1);
        intersections.push(y);
      }
    }

    if (intersections.length < 2) continue;

    intersections.sort((a, b) => a - b);
    
    for (let i = 0; i < intersections.length - 1; i += 2) {
      let y1 = intersections[i];
      let y2 = intersections[i + 1];
      
      const margin = 0.12; // margen aumentado para solapamiento
      y1 -= margin;
      y2 += margin;

      const unrotate = (x, y) => [
        x * cosA - y * sinA,
        x * sinA + y * cosA,
      ];

      const [ox1, oy1] = unrotate(x, y1);
      const [ox2, oy2] = unrotate(x, y2);

      const dx = ox2 - ox1;
      const dy = oy2 - oy1;
      const len = Math.hypot(dx, dy);
      // DEFECTO 6 FIX: Mayor densidad de puntos (0.8 en lugar de 1.2)
      const steps = Math.max(6, Math.ceil(len / 0.8));

      for (let s = 0; s <= steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const px = ox1 + dx * t;
        const py = oy1 + dy * t;
        
        if (isPointInPolygon([px, py], polygon)) {
          stitches.push({
            x: px,
            y: py,
            type: 'fill',
            regionId,
            color,
            isJump: false,
            fillPattern: 'satin',
            threadWidth: 0.45,
          });
        }
      }
    }
  }

  // DEFECTO 6 FIX: Pase de relleno de huecos para satin también
  const coverage = calculateFillCoverage(polygon, stitches);
  if (coverage < 0.95) {
    for (let x = rMinX + adjustedDensity * 0.5; x <= rMaxX; x += adjustedDensity) {
      const intersections = [];
      for (let i = 0; i < rotatedPoly.length; i++) {
        const [x1, y1] = rotatedPoly[i];
        const [x2, y2] = rotatedPoly[(i + 1) % rotatedPoly.length];
        if (Math.abs(x2 - x1) < 1e-6) continue;
        if ((x1 <= x && x <= x2) || (x2 <= x && x <= x1)) {
          const t = Math.abs(x2 - x1) > 1e-6 ? (x - x1) / (x2 - x1) : 0;
          const y = y1 + t * (y2 - y1);
          intersections.push(y);
        }
      }
      if (intersections.length < 2) continue;
      
      intersections.sort((a, b) => a - b);
      for (let i = 0; i < intersections.length - 1; i += 2) {
        let y1 = intersections[i];
        let y2 = intersections[i + 1];
        y1 -= 0.12;
        y2 += 0.12;

        const unrotate = (x, y) => [x * cosA - y * sinA, x * sinA + y * cosA];
        const [ox1, oy1] = unrotate(x, y1);
        const [ox2, oy2] = unrotate(x, y2);

        const dx = ox2 - ox1;
        const dy = oy2 - oy1;
        const len = Math.hypot(dx, dy);
        const steps = Math.max(6, Math.ceil(len / 0.8));

        for (let s = 0; s <= steps; s++) {
          const t = steps > 0 ? s / steps : 0;
          const px = ox1 + dx * t;
          const py = oy1 + dy * t;
          
          if (isPointInPolygon([px, py], polygon)) {
            stitches.push({
              x: px,
              y: py,
              type: 'fill',
              regionId,
              color,
              isJump: false,
              fillPattern: 'satin',
              threadWidth: 0.45,
            });
          }
        }
      }
    }
  }

  return stitches;
}

/**
 * Genera líneas de contorno satin puro (sin relleno interior)
 * Para contornos delgados: borde definido sin área interna
 */
function generateSatinContourLines(polygonMm, angle, color, regionId) {
  const stitches = [];
  if (polygonMm.length < 2) return stitches;

  // Generar puntos a lo largo del contorno
  for (let i = 0; i < polygonMm.length - 1; i++) {
    const [x0, y0] = polygonMm[i];
    const [x1, y1] = polygonMm[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(2, Math.ceil(dist / 0.3));

    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      stitches.push({
        x: x0 + dx * t,
        y: y0 + dy * t,
        type: 'satin',
        regionId,
        color,
        isJump: false,
        threadWidth: 0.6,
      });
    }
  }

  return stitches;
}

function getThreadWidth(type) {
  if (type === 'fill') return 0.4; // mm
  if (type === 'satin') return 0.6;
  if (type === 'running_stitch') return 0.35;
  return 0.4;
}

function calculateBounds(stitches) {
  if (stitches.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100 };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const stitch of stitches) {
    minX = Math.min(minX, stitch.x);
    maxX = Math.max(maxX, stitch.x);
    minY = Math.min(minY, stitch.y);
    maxY = Math.max(maxY, stitch.y);
  }

  // Add padding
  const padX = (maxX - minX) * 0.05 || 10;
  const padY = (maxY - minY) * 0.05 || 10;

  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
  };
}

function calculateScale(bounds, canvasW, canvasH, zoom) {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const scaleX = canvasW / w;
  const scaleY = canvasH / h;
  return Math.min(scaleX, scaleY) * zoom;
}

function drawAllStitches(ctx, stitches, toScreenX, toScreenY, showTravel) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Group by type for proper layering: fill first, contour on top
  const fillStitches = stitches.filter(s => s.type === 'fill');
  const contourStitches = stitches.filter(s => s.type === 'contour' || s.type === 'satin');

  // === Draw FILL first (base layer, dense parallel lines) ===
  const fillByColor = {};
  for (const s of fillStitches) {
    if (!fillByColor[s.color]) fillByColor[s.color] = [];
    fillByColor[s.color].push(s);
  }

  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 1;

  for (const [color, colorStitches] of Object.entries(fillByColor)) {
    if (colorStitches.length < 2) continue;
    ctx.strokeStyle = color;

    // Draw as row-by-row polylines
    let currentPath = [colorStitches[0]];
    for (let i = 1; i < colorStitches.length; i++) {
      const s0 = colorStitches[i - 1];
      const s1 = colorStitches[i];
      const dist = Math.hypot(s1.x - s0.x, s1.y - s0.y);
      
      if (dist < 3) {
        currentPath.push(s1);
      } else {
        if (currentPath.length > 1) {
          ctx.beginPath();
          ctx.moveTo(toScreenX(currentPath[0].x), toScreenY(currentPath[0].y));
          for (let j = 1; j < currentPath.length; j++) {
            ctx.lineTo(toScreenX(currentPath[j].x), toScreenY(currentPath[j].y));
          }
          ctx.stroke();
        }
        currentPath = [s1];
      }
    }
    if (currentPath.length > 1) {
      ctx.beginPath();
      ctx.moveTo(toScreenX(currentPath[0].x), toScreenY(currentPath[0].y));
      for (let j = 1; j < currentPath.length; j++) {
        ctx.lineTo(toScreenX(currentPath[j].x), toScreenY(currentPath[j].y));
      }
      ctx.stroke();
    }
  }

  // === Draw CONTOURS on top (solid) ===
  const contourByColor = {};
  for (const s of contourStitches) {
    if (!contourByColor[s.color]) contourByColor[s.color] = [];
    contourByColor[s.color].push(s);
  }

  ctx.setLineDash([]);
  ctx.lineWidth = 1.2;

  for (const [color, colorStitches] of Object.entries(contourByColor)) {
    ctx.strokeStyle = color;
    for (let i = 0; i < colorStitches.length - 1; i++) {
      const s1 = colorStitches[i];
      const s2 = colorStitches[i + 1];
      ctx.beginPath();
      ctx.moveTo(toScreenX(s1.x), toScreenY(s1.y));
      ctx.lineTo(toScreenX(s2.x), toScreenY(s2.y));
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
}

function drawStitchesSequential(ctx, visibleStitches, allStitches, toScreenX, toScreenY, showTravel) {
  // Separate by type: fills first (dense), then contours (overlay)
  const fillStitches = visibleStitches.filter(s => s.type === 'fill');
  const contourStitches = visibleStitches.filter(s => s.type === 'contour' || s.type === 'satin');
  const jumpStitches = visibleStitches.filter(s => s.isJump);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // === PASS 1: Draw FILL stitches (dense parallel lines) ===
  const fillByColor = {};
  for (const s of fillStitches) {
    if (!fillByColor[s.color]) fillByColor[s.color] = [];
    fillByColor[s.color].push(s);
  }

  ctx.globalAlpha = 1; // full opacity for fills
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const [color, stitches] of Object.entries(fillByColor)) {
    if (stitches.length < 2) continue;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5; // thin lines to show individual rows
    ctx.setLineDash([]); // solid lines (not dashed)

    // Draw fill lines as continuous paths per row
    // Group by proximity to detect row changes
    let currentPath = [stitches[0]];
    for (let i = 1; i < stitches.length; i++) {
      const s0 = stitches[i - 1];
      const s1 = stitches[i];
      const dist = Math.hypot(s1.x - s0.x, s1.y - s0.y);
      
      if (dist < 3) {
        // Same row, continue path
        currentPath.push(s1);
      } else {
        // New row, draw current path and start fresh
        if (currentPath.length > 1) {
          ctx.beginPath();
          ctx.moveTo(toScreenX(currentPath[0].x), toScreenY(currentPath[0].y));
          for (let j = 1; j < currentPath.length; j++) {
            ctx.lineTo(toScreenX(currentPath[j].x), toScreenY(currentPath[j].y));
          }
          ctx.stroke();
        }
        currentPath = [s1];
      }
    }
    // Draw last path
    if (currentPath.length > 1) {
      ctx.beginPath();
      ctx.moveTo(toScreenX(currentPath[0].x), toScreenY(currentPath[0].y));
      for (let j = 1; j < currentPath.length; j++) {
        ctx.lineTo(toScreenX(currentPath[j].x), toScreenY(currentPath[j].y));
      }
      ctx.stroke();
    }
  }

  // === PASS 2: Draw CONTOUR stitches (overlay, solid) ===
  const contourByColor = {};
  for (const s of contourStitches) {
    if (!contourByColor[s.color]) contourByColor[s.color] = [];
    contourByColor[s.color].push(s);
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  for (const [color, stitches] of Object.entries(contourByColor)) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;

    for (let i = 0; i < stitches.length - 1; i++) {
      const s1 = stitches[i];
      const s2 = stitches[i + 1];

      ctx.beginPath();
      ctx.moveTo(toScreenX(s1.x), toScreenY(s1.y));
      ctx.lineTo(toScreenX(s2.x), toScreenY(s2.y));
      ctx.stroke();
    }
  }

  // === PASS 3: Draw TRAVEL stitches (optional, thin gray dashes) ===
  if (showTravel && jumpStitches.length > 0) {
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 3]);
    ctx.globalAlpha = 0.6;

    for (let i = 0; i < jumpStitches.length - 1; i++) {
      const s1 = jumpStitches[i];
      const s2 = jumpStitches[i + 1];

      ctx.beginPath();
      ctx.moveTo(toScreenX(s1.x), toScreenY(s1.y));
      ctx.lineTo(toScreenX(s2.x), toScreenY(s2.y));
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function drawStitchesByLayer(ctx, regions, allStitches, progress, toScreenX, toScreenY, showTravel) {
  const sorted = [...regions].sort((a, b) => (a.priority || 0) - (b.priority || 0));
  const regionIndex = Math.floor((progress / 100) * sorted.length);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let i = 0; i <= regionIndex && i < sorted.length; i++) {
    const region = sorted[i];
    const fillStitches = allStitches.filter((s) => s.regionId === region.id && s.type === 'fill');
    const contourStitches = allStitches.filter((s) => s.regionId === region.id && s.type === 'contour');

    // Draw fill first (as dense parallel rows)
    if (fillStitches.length > 0) {
      ctx.strokeStyle = region.color || '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      let currentPath = [fillStitches[0]];
      for (let j = 1; j < fillStitches.length; j++) {
        const s0 = fillStitches[j - 1];
        const s1 = fillStitches[j];
        const dist = Math.hypot(s1.x - s0.x, s1.y - s0.y);
        
        if (dist < 3) {
          currentPath.push(s1);
        } else {
          if (currentPath.length > 1) {
            ctx.beginPath();
            ctx.moveTo(toScreenX(currentPath[0].x), toScreenY(currentPath[0].y));
            for (let k = 1; k < currentPath.length; k++) {
              ctx.lineTo(toScreenX(currentPath[k].x), toScreenY(currentPath[k].y));
            }
            ctx.stroke();
          }
          currentPath = [s1];
        }
      }
      if (currentPath.length > 1) {
        ctx.beginPath();
        ctx.moveTo(toScreenX(currentPath[0].x), toScreenY(currentPath[0].y));
        for (let k = 1; k < currentPath.length; k++) {
          ctx.lineTo(toScreenX(currentPath[k].x), toScreenY(currentPath[k].y));
        }
        ctx.stroke();
      }
    }

    // Draw contours on top
    if (contourStitches.length > 0) {
      ctx.strokeStyle = region.color || '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([]);
      
      for (let j = 0; j < contourStitches.length - 1; j++) {
        const s1 = contourStitches[j];
        const s2 = contourStitches[j + 1];
        ctx.beginPath();
        ctx.moveTo(toScreenX(s1.x), toScreenY(s1.y));
        ctx.lineTo(toScreenX(s2.x), toScreenY(s2.y));
        ctx.stroke();
      }
    }
  }

  ctx.setLineDash([]);
}

function drawInfoOverlay(ctx, w, h, progress, visibleCount, totalCount, config) {
  ctx.fillStyle = 'rgba(13, 15, 20, 0.7)';
  ctx.fillRect(0, 0, 200, 60);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Puntada ${visibleCount}/${totalCount}`, 10, 20);

  ctx.font = '10px monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`Progreso: ${Math.round(progress)}%`, 10, 35);
  ctx.fillText(`Tiempo: ${estimateTime(totalCount, config)}`, 10, 50);
}

function calculateCoverage(regions) {
  if (!regions || regions.length === 0) return 0;
  const totalArea = regions.reduce((sum, r) => sum + (r.area_mm2 || 0), 0);
  const filledArea = regions.filter(r => r.stitch_type === 'fill' || r.stitch_type === 'satin').reduce((sum, r) => sum + (r.area_mm2 || 0), 0);
  return Math.round((filledArea / totalArea) * 100) || 0;
}

function estimateTime(stitchCount, config) {
  const machineSpeed = 800; // stitches per minute (typical)
  const minutes = stitchCount / machineSpeed;
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}