/**
 * RealImageDiagnosticPanel.jsx — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only diagnostic of the REAL pipeline with the current uploaded image.
 * No motor changes. Only inspects + reports where contours/colors/validation
 * break down between original image → vectorization → final commands.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Download, Bug, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { validateCE01 } from '@/lib/ce01Validator';
import { computeExportReality } from '@/lib/exportRealityCheck';
import { buildStrictDarkStrokeContextFromOriginalImage } from '@/lib/rawDarkStrokeTest';
import { buildUniversalDarkContoursFromContext, getLastUniversalReport } from '@/lib/universalDarkContourDetector';
import { validateFinalContourCommandsAgainstDarkMask } from '@/lib/contourSegmentValidator';

const DARK_LUMA = 55;
const DARK_SAT = 80;

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  if (h.length < 6) return { r: 128, g: 128, b: 128 };
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}
function luma(hex) { const { r, g, b } = hexToRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; }
function sat(hex) { const { r, g, b } = hexToRgb(hex); return Math.max(r, g, b) - Math.min(r, g, b); }
function isBlackColor(hex) { return luma(hex) < DARK_LUMA && sat(hex) < DARK_SAT; }

// ── Analyze the ORIGINAL uploaded bitmap (not preview, not processed) ─────────
function analyzeOriginalImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxW = 320;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const W = Math.max(1, Math.round(img.naturalWidth * scale));
      const H = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;
      let dark = 0;
      const buckets = new Map();
      for (let i = 0; i < W * H; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        const S = Math.max(r, g, b) - Math.min(r, g, b);
        if (L < DARK_LUMA && S < DARK_SAT) dark++;
        const key = `${r >> 5},${g >> 5},${b >> 5}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
      const total = W * H;
      const dominant = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => {
        const [r, g, b] = k.split(',').map(Number);
        const hex = '#' + [r, g, b].map(v => ((v * 32 + 16)).toString(16).padStart(2, '0')).join('');
        return { hex, count: c, pct: +(c / total * 100).toFixed(1), dark: isBlackColor(hex) };
      });
      resolve({
        naturalW: img.naturalWidth, naturalH: img.naturalHeight,
        processW: W, processH: H,
        darkPx: dark, darkPct: +(dark / total * 100).toFixed(2),
        dominantColors: dominant,
        hasBlack: dark > 20,
      });
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen original'));
    img.src = imageUrl;
  });
}

// ── Dark support of a region's path against the strict mask ──────────────────
function regionDarkSupport(region, darkStroke, config) {
  if (!darkStroke || !darkStroke.mask || !region.path_points) return { ratio: 0, supported: false };
  const { mask, width: W, height: H } = darkStroke;
  const widthMm = config.width_mm || 100, heightMm = config.height_mm || 100;
  let hits = 0;
  for (const pt of region.path_points) {
    const [mx, my] = pt;
    const px = Math.round((mx / widthMm + 0.5) * W);
    const py = Math.round((my / heightMm + 0.5) * H);
    let on = false;
    for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (mask[ny * W + nx]) { on = true; break; }
    }
    if (on) hits++;
  }
  const ratio = region.path_points.length ? hits / region.path_points.length : 0;
  return { ratio, supported: ratio > 0.1 };
}

function regionShouldBeContour(r) {
  const name = (r.name || '').toLowerCase();
  const rc = r.region_class || r.layerType || '';
  return name.includes('outline') || name.includes('contour') ||
    rc === 'outer_outline' || rc === 'inner_outline' || rc === 'detail_open_curve';
}

export default function RealImageDiagnosticPanel(props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let secondFrame = null;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-3 rounded-xl border border-[#1e2130] bg-[#0d0f14] text-xs text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        Preparando diagnóstico de imagen…
      </div>
    );
  }

  return <RealImageDiagnosticContent {...props} />;
}

function RealImageDiagnosticContent({
  imageUrl, regions = [], config = {}, darkStroke,
  finalCommands = [], finalObjects = [], machineSettings = {},
  originalImageUrl, darkStrokeSourceUrl, contourSegmentReport,
}) {
  const [origAnalysis, setOrigAnalysis] = useState(null);
  const [origError, setOrigError] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [freshDarkStroke, setFreshDarkStroke] = useState(darkStroke);
  const [darkLoading, setDarkLoading] = useState(false);
  const overlayCanvasRef = useRef(null);
  const imgRef = useRef(null);
  const [overlays, setOverlays] = useState({
    original: true, mask: false, contours: false, regions: true,
    commands: false, contoursOnly: false, fillsOnly: false,
  });
  const isUsingMaskedForDarkStroke = /_masked/i.test(darkStrokeSourceUrl || '');

  // ── Analyze original image on mount / change ──────────────────────────────
  useEffect(() => {
    if (!imageUrl) { setOrigAnalysis(null); return; }
    setAnalyzing(true);
    setOrigError(null);
    analyzeOriginalImage(imageUrl)
      .then(setOrigAnalysis)
      .catch(e => setOrigError(e.message))
      .finally(() => setAnalyzing(false));
  }, [imageUrl]);

  // ── Re-run dark stroke from ORIGINAL (explicit confirmation) ───────────────
  const reanalyzeDarkStroke = useCallback(async () => {
    if (!imageUrl) return;
    setDarkLoading(true);
    try {
      const ctx = await buildStrictDarkStrokeContextFromOriginalImage(imageUrl, config);
      setFreshDarkStroke(ctx);
    } catch (e) {
      setOrigError(e.message);
    } finally { setDarkLoading(false); }
  }, [imageUrl, config]);

  const effectiveDark = freshDarkStroke || darkStroke;

  // ── Universal contours from dark stroke context ────────────────────────────
  const universal = useMemo(() => {
    if (!effectiveDark) return null;
    return buildUniversalDarkContoursFromContext(effectiveDark, config);
  }, [effectiveDark, config]);
  const universalReport = universal?.report || getLastUniversalReport();

  // ── Regions analysis ────────────────────────────────────────────────────────
  const regionRows = useMemo(() => (regions || []).map(r => {
    const support = regionDarkSupport(r, effectiveDark, config);
    const black = isBlackColor(r.color || r.hex);
    const shouldContour = regionShouldBeContour(r);
    const widthMm = config.width_mm || 100, heightMm = config.height_mm || 100;
    const totalMm = widthMm * heightMm;
    const areaRatio = totalMm ? (r.area_mm2 || 0) / totalMm : 0;
    let touchesCanvasEdge = false;
    if (r.path_points?.length && effectiveDark) {
      const Wd = effectiveDark.width, Hd = effectiveDark.height;
      for (const [mx, my] of r.path_points) {
        const px = (mx / widthMm + 0.5) * Wd, py = (my / heightMm + 0.5) * Hd;
        if (px <= 2 || px >= Wd - 2 || py <= 2 || py >= Hd - 2) { touchesCanvasEdge = true; break; }
      }
    }
    let blackRegionType = 'unknown';
    if (black) {
      if (touchesCanvasEdge && areaRatio > 0.15) blackRegionType = 'background';
      else if (areaRatio < 0.02) blackRegionType = 'eye/mouth';
      else if (shouldContour) blackRegionType = 'contour';
    }
    return {
      id: r.id,
      name: r.name || '—',
      color: r.color || r.hex || '#888',
      stitch_type: r.stitch_type || r.region_class || '—',
      region_class: r.region_class || r.layerType || '—',
      object_group: r.object_group || '—',
      area: r.area_mm2 || 0,
      points: r.path_points?.length || 0,
      black, shouldContour,
      supportRatio: support.ratio, supported: support.supported,
      touchesCanvasEdge, areaRatio, blackRegionType,
    };
  }), [regions, effectiveDark, config]);

  // ── Final commands breakdown ───────────────────────────────────────────────
  const commandsBreakdown = useMemo(() => {
    const cmds = finalCommands || [];
    const byType = { stitch: 0, jump: 0, trim: 0, colorChange: 0, end: 0 };
    const byStitchType = {};
    const byColor = {};
    let contourStitches = 0, fillStitches = 0;
    for (const c of cmds) {
      byType[c.type] = (byType[c.type] || 0) + 1;
      if (c.type === 'stitch') {
        byStitchType[c.stitchType || 'unknown'] = (byStitchType[c.stitchType || 'unknown'] || 0) + 1;
        byColor[c.color || 'none'] = (byColor[c.color || 'none'] || 0) + 1;
        if (c.stitchType === 'running_stitch') contourStitches++;
        else fillStitches++;
      }
    }
    return { byType, byStitchType, byColor, contourStitches, fillStitches, total: cmds.length };
  }, [finalCommands]);

  // ── CE01 validation + export reality ───────────────────────────────────────
  const ce01 = useMemo(() => validateCE01(finalCommands, finalObjects, regions, config, machineSettings), [finalCommands, finalObjects, regions, config, machineSettings]);
  const reality = useMemo(() => computeExportReality(regions, finalCommands), [regions, finalCommands]);
  const guardCurrent = useMemo(() => validateFinalContourCommandsAgainstDarkMask(finalCommands, effectiveDark, config), [finalCommands, effectiveDark, config]);
  const guardReport = contourSegmentReport || guardCurrent.report;

  // ── Color comparison ────────────────────────────────────────────────────────
  const colorComparison = useMemo(() => {
    const origBlack = origAnalysis?.hasBlack;
    const origColors = origAnalysis?.dominantColors?.filter(c => !c.dark).length || 0;
    const regionColors = new Set((regions || []).map(r => r.color || r.hex));
    const blackRegions = regionRows.filter(r => r.black);
    const blackFills = blackRegions.filter(r => r.stitch_type === 'fill');
    const blackContours = blackRegions.filter(r => r.stitch_type === 'running_stitch' || r.shouldContour);
    return {
      origBlack, origColors,
      regionColorCount: regionColors.size,
      blackRegions: blackRegions.length,
      blackFills: blackFills.length,
      blackContours: blackContours.length,
      blackDisappeared: origBlack && blackRegions.length === 0,
      blackBecameFill: origBlack && blackFills.length > 0 && blackContours.length === 0,
      commandColors: Object.keys(commandsBreakdown.byColor).length,
    };
  }, [origAnalysis, regions, regionRows, commandsBreakdown]);

  // ── Overlays drawing ────────────────────────────────────────────────────────
  const W = effectiveDark?.width || origAnalysis?.processW || 320;
  const H = effectiveDark?.height || origAnalysis?.processH || 320;

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0c12'; ctx.fillRect(0, 0, W, H);

    if (overlays.original && imgRef.current) {
      ctx.drawImage(imgRef.current, 0, 0, W, H);
    }
    if (overlays.mask && effectiveDark?.mask) {
      const m = effectiveDark.mask;
      const img = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        if (m[i]) { img.data[i * 4] = 239; img.data[i * 4 + 1] = 68; img.data[i * 4 + 2] = 68; img.data[i * 4 + 3] = 200; }
      }
      ctx.putImageData(img, 0, 0);
    }
    const widthMm = config.width_mm || 100, heightMm = config.height_mm || 100;
    const mmToPx = (mx, my) => [(mx / widthMm + 0.5) * W, (my / heightMm + 0.5) * H];

    if (overlays.regions || overlays.fillsOnly || overlays.contoursOnly) {
      for (const r of (regions || [])) {
        if (!r.path_points || r.path_points.length < 2) continue;
        const isC = regionShouldBeContour(r);
        if (overlays.fillsOnly && isC) continue;
        if (overlays.contoursOnly && !isC) continue;
        ctx.beginPath();
        r.path_points.forEach(([mx, my], i) => {
          const [px, py] = mmToPx(mx, my);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = (r.color || r.hex || '#888') + '55';
        ctx.fill();
        ctx.strokeStyle = r.color || r.hex || '#888';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (overlays.contours && universal?.contours) {
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5;
      for (const c of universal.contours) {
        const pts = c._pixelPath || c.points;
        if (!pts || pts.length < 2) continue;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = p.x ?? p[0], y = p.y ?? p[1];
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
    if (overlays.commands) {
      for (const c of finalCommands) {
        if (c.type !== 'stitch') continue;
        const [px, py] = mmToPx(c.x, c.y);
        ctx.fillStyle = c.color || '#fff';
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }, [overlays, W, H, effectiveDark, regions, universal, finalCommands, config]);

  // preload image element for overlay
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; setOverlays(o => ({ ...o })); };
    img.src = imageUrl;
  }, [imageUrl]);

  // ── Download MD report ──────────────────────────────────────────────────────
  const downloadReport = () => {
    const lines = [];
    lines.push('# REAL_IMAGE_PIPELINE_DIAGNOSTIC');
    lines.push('');
    lines.push(`Fecha: ${new Date().toISOString()}`);
    lines.push(`Imagen: ${imageUrl || '(sin imagen)'}`);
    lines.push('');
    lines.push('## 1. Imagen original');
    if (origAnalysis) {
      lines.push(`- Tamaño natural: ${origAnalysis.naturalW}x${origAnalysis.naturalH}px`);
      lines.push(`- Tamaño procesado: ${origAnalysis.processW}x${origAnalysis.processH}px`);
      lines.push(`- Píxeles oscuros reales (luma<55, sat<80): ${origAnalysis.darkPx} (${origAnalysis.darkPct}%)`);
      lines.push(`- Has black: ${origAnalysis.hasBlack}`);
      lines.push('- Colores dominantes:');
      origAnalysis.dominantColors.forEach(c => lines.push(`  - ${c.hex}  ${c.pct}%  dark=${c.dark}`));
    } else lines.push('- (sin análisis)');
    lines.push('');
    lines.push('## 2. Dark stroke real (sobre imagen original)');
    if (effectiveDark) {
      lines.push(`- darkStrokeSourceUrl: ${darkStrokeSourceUrl || '(n/a)'}`);
      lines.push(`- originalUploadUrl: ${originalImageUrl || '(no guardada)'}`);
      lines.push(`- processedImageUrl: ${imageUrl || '(n/a)'}`);
      lines.push(`- isUsingMaskedForDarkStroke: ${isUsingMaskedForDarkStroke}`);
      lines.push(`- source: ${effectiveDark.source || '(desconocido)'}`);
      lines.push(`- width/height: ${effectiveDark.width}x${effectiveDark.height}`);
      lines.push(`- rawDarkPixels: ${effectiveDark.darkPixelsCount ?? '(n/a)'}`);
      lines.push(`- darkComponents: ${effectiveDark.components?.length ?? 0}`);
      lines.push(`- exportedPaths: ${effectiveDark.exportedPaths?.length ?? 0}`);
      lines.push(`- darkBackgroundDetected: ${effectiveDark.darkBackgroundDetected ?? false}`);
      lines.push(`- darkBackgroundPixelsRemoved: ${effectiveDark.darkBackgroundPixelsRemoved ?? 0}`);
      lines.push(`- edgeConnectedDarkComponentsRemoved: ${effectiveDark.edgeConnectedDarkComponentsRemoved ?? 0}`);
      lines.push(`- consolidatedLowerPaths: ${effectiveDark.consolidatedLowerPaths ?? 0}`);
      lines.push(`- hasMouth: ${effectiveDark.hasMouth}  hasEyes: ${effectiveDark.hasEyes}  hasLowerContour: ${effectiveDark.hasLowerContour}`);
      lines.push(`- averagePathDarkSupport: ${effectiveDark.averagePathDarkSupport ?? '(n/a)'}`);
      lines.push(`- minPathDarkSupport: ${effectiveDark.minPathDarkSupport ?? '(n/a)'}`);
    } else lines.push('- (sin dark stroke)');
    lines.push('');
    lines.push('## Universal contours');
    if (universalReport) {
      lines.push(`- rawSkeletonSegments: ${universalReport.rawSkeletonSegments}`);
      lines.push(`- consolidatedContours: ${universalReport.consolidatedContours}`);
      lines.push(`- outerOutlineCount: ${universalReport.outerOutlineCount}`);
      lines.push(`- innerOutlineCount: ${universalReport.innerOutlineCount}`);
      lines.push(`- detailOpenCurveCount: ${universalReport.detailOpenCurveCount}`);
      lines.push(`- rejectedNoiseCount: ${universalReport.rejectedNoiseCount}`);
      lines.push(`- darkContourCoverage: ${universalReport.darkContourCoverage}%`);
      lines.push(`- fillBoundaryExported: ${universalReport.fillBoundaryExported}`);
      lines.push(`- artificialGeometryCount: ${universalReport.artificialGeometryCount}`);
      lines.push(`- longStraightSegmentsFixed: ${universalReport.longStraightSegmentsFixed ?? 0}`);
      lines.push(`- accepted: ${universalReport.accepted}`);
    }
    lines.push('');
    lines.push('## 3. Comparación original vs vectorizado');
    lines.push(`- origHasBlack: ${colorComparison.origBlack}`);
    lines.push(`- origColorCount (no oscuros): ${colorComparison.origColors}`);
    lines.push(`- regionColorCount: ${colorComparison.regionColorCount}`);
    lines.push(`- blackRegions: ${colorComparison.blackRegions}`);
    lines.push(`- blackFills: ${colorComparison.blackFills}`);
    lines.push(`- blackContours: ${colorComparison.blackContours}`);
    lines.push(`- blackDisappeared: ${colorComparison.blackDisappeared}`);
    lines.push(`- blackBecameFill: ${colorComparison.blackBecameFill}`);
    lines.push(`- commandColorCount: ${colorComparison.commandColors}`);
    lines.push('');
    lines.push('## 4. Regiones');
    regionRows.forEach(r => {
      lines.push(`- ${r.id}  name=${r.name}  color=${r.color}  stitch_type=${r.stitch_type}  region_class=${r.region_class}  group=${r.object_group}  area=${r.area.toFixed(1)}mm²  points=${r.points}  black=${r.black}  blackRegionType=${r.blackRegionType}  touchesCanvasEdge=${r.touchesCanvasEdge}  areaRatio=${r.areaRatio.toFixed(3)}  shouldContour=${r.shouldContour}  darkSupport=${r.supportRatio.toFixed(2)}  supported=${r.supported}`);
    });
    lines.push('');
    lines.push('## 5. Comandos finales');
    lines.push(`- total: ${commandsBreakdown.total}`);
    lines.push(`- byType: ${JSON.stringify(commandsBreakdown.byType)}`);
    lines.push(`- byStitchType: ${JSON.stringify(commandsBreakdown.byStitchType)}`);
    lines.push(`- byColor: ${JSON.stringify(commandsBreakdown.byColor)}`);
    lines.push(`- contourStitches: ${commandsBreakdown.contourStitches}  fillStitches: ${commandsBreakdown.fillStitches}`);
    lines.push('');
    lines.push('## 6. Validación');
    lines.push(`- CE01 status: ${ce01.status}  score=${ce01.score}`);
    lines.push(`- blockingIssues (${ce01.blockingIssues.length}):`);
    ce01.blockingIssues.forEach(b => lines.push(`  - [check ${b.check}] ${b.message}`));
    lines.push(`- warnings (${ce01.warnings.length}):`);
    ce01.warnings.forEach(w => lines.push(`  - [check ${w.check}] ${w.message}`));
    lines.push(`- exportReality status: ${reality.status}  ready=${reality.ready}`);
    lines.push(`- colorMismatch=${reality.colorMismatch}  contourMismatch=${reality.contourMismatch}  mouthMismatch=${reality.mouthMismatch}`);
    lines.push('');
    lines.push('## 6b. Guard de diagonales (dark mask)');
    lines.push(`- unsupportedLongContourSegments (current): ${guardCurrent.report.unsupportedLongContourSegments}`);
    lines.push(`- removedArtificialBridges: ${guardReport.removedArtificialBridges}`);
    lines.push(`- longestUnsupportedSegmentMm: ${guardReport.longestUnsupportedSegmentMm}`);
    lines.push(`- longestUnsupportedSegmentSupport: ${guardReport.longestUnsupportedSegmentSupport}`);
    lines.push(`- suspiciousBlackDiagonalDetected (current): ${guardCurrent.report.suspiciousBlackDiagonalDetected}`);
    if (guardReport.segments?.length) {
      lines.push('- segments removed:');
      guardReport.segments.slice(0, 10).forEach(s => lines.push(`  - obj=${s.objectId} name=${s.regionName} len=${s.lengthMm.toFixed(1)}mm support=${s.support.toFixed(2)}`));
    }
    lines.push('');
    lines.push('## 7. Diagnóstico');
    lines.push('## 7. Diagnóstico');
    const diag = [];
    if (!imageUrl) diag.push('A) No hay imagen original cargada.');
    if (isUsingMaskedForDarkStroke) diag.push('DARKSTROKE_USING_MASKED_IMAGE: darkStroke usa una imagen *_masked.png — usar la imagen original subida.');
    if (effectiveDark?.source !== 'strict_raw_original_bitmap') diag.push('B) darkStroke NO se calcula desde la imagen original (source=' + (effectiveDark?.source || 'null') + ').');
    if (regionRows.some(r => r.blackRegionType === 'background')) diag.push('FONDO_NEGRO: hay regiones negras conectadas al borde clasificadas como background — filtrar antes de contornizar.');
    if (colorComparison.blackDisappeared) diag.push('C) El vectorizador eliminó/absorbió el negro — no hay regiones negras.');
    if (colorComparison.blackBecameFill) diag.push('D) El negro se convirtió en relleno en lugar de contorno.');
    if (reality.contourMismatch) diag.push('E) finalCommands pierde contornos respecto a las regiones visuales.');
    if ((universalReport?.outerOutlineCount || 0) > 20) diag.push('TOO_MANY_OUTER_CONTOURS_REAL_IMAGE: ' + universalReport.outerOutlineCount + ' outer outlines — probable fondo negro contaminando la máscara.');
    if (ce01.status === 'INVALID') diag.push('G) Validador bloquea exportación (ver blockingIssues arriba).');
    if (guardCurrent.report.suspiciousBlackDiagonalDetected) diag.push('SUSPICIOUS_BLACK_DIAGONAL: queda una puntada de contorno larga sin soporte en la máscara negra.');
    if (guardReport.removedArtificialBridges > 0) diag.push('DIAGONAL_GUARD: se removieron ' + guardReport.removedArtificialBridges + ' puentes artificiales sin soporte dark.');
    if (ce01.status === 'RISKY' && ce01.blockingIssues.length === 0) diag.push('H) CE01 RISKY sin bloqueo: exceso de saltos/trims/colores y regiones pequeñas.');
    if (diag.length === 0) diag.push('Sin causa clara detectada — revisar métricas manualmente.');
    diag.forEach(d => lines.push(`- ${d}`));
    lines.push('');
    lines.push('## Archivos sospechosos');
    lines.push('- src/lib/pipeline/stages/vectorEngineStage.js (vectorización backend)');
    lines.push('- src/lib/pipeline/stages/regionBuilderStage.js (asignación de color/stitch_type)');
    lines.push('- src/lib/regionBuilder.js (enriquecimiento de regiones)');
    lines.push('- src/lib/rawDarkStrokeTest.js (si source no es strict_raw_original_bitmap)');
    lines.push('- src/components/editor/StitchCanvas.jsx (si la simulación pinta color incorrecto)');
    lines.push('');
    lines.push('## Recomendación (sin aplicar cambios)');
    lines.push('- Confirmar source de darkStroke = strict_raw_original_bitmap.');
    lines.push('- Si blackDisappeared: revisar vectorEngineStage / regionBuilderStage.');
    lines.push('- Si blackBecameFill: forzar clasificación de regiones oscuras como contour.');
    lines.push('- Si contourMismatch: revisar contourExportBuilder / buildFinalCommands.');
    lines.push('- Si CE01 INVALID: corregir la regla concreta en blockingIssues.');

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'REAL_IMAGE_PIPELINE_DIAGNOSTIC.md'; a.click();
    URL.revokeObjectURL(url);
  };

  if (!imageUrl) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Sube una imagen para ejecutar el diagnóstico real.</div>;
  }

  const Toggle = ({ id, label, color }) => (
    <button
      onClick={() => setOverlays(o => ({ ...o, [id]: !o[id] }))}
      className={`text-[10px] px-2 py-1 rounded border transition-colors ${overlays[id] ? `border-${color}-500/50 bg-${color}-900/20 text-${color}-300` : 'border-[#2a2d3a] text-slate-600 hover:text-slate-400'}`}
    >{label}</button>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Diagnóstico imagen real</h3>
            {analyzing && <span className="text-[10px] text-slate-500">analizando…</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={reanalyzeDarkStroke} disabled={darkLoading} className="flex items-center gap-1 px-2 py-1 rounded border border-[#2a2d3a] text-[10px] text-slate-300 hover:bg-[#1e2130]">
              <RefreshCw className={`w-3 h-3 ${darkLoading ? 'animate-spin' : ''}`} /> Re-darkStroke
            </button>
            <button onClick={downloadReport} className="flex items-center gap-1 px-2 py-1 rounded bg-violet-600 text-[10px] text-white font-bold hover:bg-violet-500">
              <Download className="w-3 h-3" /> Descargar diagnóstico real
            </button>
          </div>
        </div>

        {isUsingMaskedForDarkStroke && (
          <div className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-500/40 rounded-lg px-3 py-2 font-bold flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> DARKSTROKE_USING_MASKED_IMAGE — darkStroke usa una imagen *_masked.png; usa la imagen original.
          </div>
        )}
        {(universalReport?.outerOutlineCount || 0) > 20 && (
          <div className="text-[11px] text-red-300 bg-red-900/20 border border-red-500/40 rounded-lg px-3 py-2 font-bold flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> TOO_MANY_OUTER_CONTOURS_REAL_IMAGE — {universalReport.outerOutlineCount} outer outlines; probable fondo negro contaminando la máscara.
          </div>
        )}
        {guardCurrent.report.suspiciousBlackDiagonalDetected && (
          <div className="text-[11px] text-red-300 bg-red-900/20 border border-red-500/40 rounded-lg px-3 py-2 font-bold flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> SUSPICIOUS_BLACK_DIAGONAL — puntada de contorno larga sin soporte en la máscara negra.
          </div>
        )}
        {/* 1. Imagen original */}
        <Section title="1. Imagen original" status={origAnalysis ? (origAnalysis.hasBlack ? 'warn' : 'ok') : 'loading'}>
          {origError && <Err msg={origError} />}
          {origAnalysis && <>
            <Row k="Tamaño real" v={`${origAnalysis.naturalW}×${origAnalysis.naturalH}px (proc ${origAnalysis.processW}×${origAnalysis.processH})`} />
            <Row k="Píxeles negros/oscuros" v={`${origAnalysis.darkPx} (${origAnalysis.darkPct}%)`} accent={origAnalysis.hasBlack ? 'amber' : 'slate'} />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {origAnalysis.dominantColors.map((c, i) => (
                <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0d0f14] border border-[#1e2130]">
                  <div className="w-3 h-3 rounded" style={{ background: c.hex, outline: c.dark ? '1px solid #f87171' : 'none' }} />
                  <span className="text-[9px] text-slate-400">{c.pct}%</span>
                </div>
              ))}
            </div>
          </>}
        </Section>

        {/* 2. Dark stroke real */}
        <Section title="2. Dark stroke real" status={effectiveDark ? (effectiveDark.source === 'strict_raw_original_bitmap' ? 'ok' : 'warn') : 'loading'}>
          {effectiveDark ? <>
            <Row k="source" v={effectiveDark.source || '(n/a)'} accent={effectiveDark.source === 'strict_raw_original_bitmap' ? 'emerald' : 'amber'} />
            <Row k="darkStrokeSourceUrl" v={darkStrokeSourceUrl || '(n/a)'} accent={isUsingMaskedForDarkStroke ? 'amber' : 'emerald'} />
            <Row k="originalUploadUrl" v={originalImageUrl || '(no guardada)'} />
            <Row k="processedImageUrl" v={imageUrl || '(n/a)'} />
            <Row k="isUsingMaskedForDarkStroke" v={String(isUsingMaskedForDarkStroke)} accent={isUsingMaskedForDarkStroke ? 'amber' : 'emerald'} />
            <Row k="rawDarkPixels" v={effectiveDark.darkPixelsCount ?? '(n/a)'} />
            <Row k="darkComponents" v={effectiveDark.components?.length ?? 0} />
            <Row k="exportedPaths" v={effectiveDark.exportedPaths?.length ?? 0} />
            <Row k="minPathDarkSupport" v={effectiveDark.minPathDarkSupport ?? '(n/a)'} />
            <Row k="darkBackgroundDetected" v={String(effectiveDark.darkBackgroundDetected ?? false)} accent={effectiveDark.darkBackgroundDetected ? 'amber' : 'slate'} />
            <Row k="darkBackgroundPixelsRemoved" v={effectiveDark.darkBackgroundPixelsRemoved ?? 0} />
            <Row k="edgeComponentsRemoved" v={effectiveDark.edgeConnectedDarkComponentsRemoved ?? 0} />
            <Row k="hasMouth" v={String(effectiveDark.hasMouth)} />
            <Row k="hasEyes" v={String(effectiveDark.hasEyes)} />
          </> : <Err msg="darkStroke no disponible" />}
        </Section>

        {/* Universal contours */}
        {universalReport && (
          <Section title="Universal contours" status={universalReport.outerOutlineCount > 0 ? 'ok' : 'warn'}>
            <Row k="rawSkeletonSegments" v={universalReport.rawSkeletonSegments} />
            <Row k="consolidatedContours" v={universalReport.consolidatedContours} />
            <Row k="outerOutlineCount" v={universalReport.outerOutlineCount} accent={universalReport.outerOutlineCount > 0 ? 'emerald' : 'red'} />
            <Row k="innerOutlineCount" v={universalReport.innerOutlineCount} />
            <Row k="detailOpenCurveCount" v={universalReport.detailOpenCurveCount} />
            <Row k="darkContourCoverage" v={`${universalReport.darkContourCoverage}%`} />
            <Row k="fillBoundaryExported" v={String(universalReport.fillBoundaryExported)} accent={!universalReport.fillBoundaryExported ? 'emerald' : 'red'} />
            <Row k="artificialGeometryCount" v={universalReport.artificialGeometryCount} accent={universalReport.artificialGeometryCount === 0 ? 'emerald' : 'red'} />
            <Row k="longStraightSegmentsFixed" v={universalReport.longStraightSegmentsFixed ?? 0} />
          </Section>
        )}

        {/* 3. Comparación */}
        <Section title="3. Original vs vectorizado" status={colorComparison.blackDisappeared || colorComparison.blackBecameFill ? 'warn' : 'ok'}>
          <Row k="origHasBlack" v={String(colorComparison.origBlack)} />
          <Row k="regionColorCount" v={colorComparison.regionColorCount} />
          <Row k="commandColorCount" v={colorComparison.commandColors} />
          <Row k="blackRegions" v={colorComparison.blackRegions} />
          <Row k="blackFills" v={colorComparison.blackFills} accent={colorComparison.blackFills > 0 ? 'amber' : 'slate'} />
          <Row k="blackContours" v={colorComparison.blackContours} accent={colorComparison.blackContours > 0 ? 'emerald' : 'slate'} />
          {colorComparison.blackDisappeared && <Flag text="NEGRO DESAPARECIÓ en la vectorización" />}
          {colorComparison.blackBecameFill && <Flag text="NEGRO convertido a FILL (debería ser contorno)" />}
        </Section>

        {/* 4. Regiones */}
        <Section title={`4. Regiones (${regionRows.length})`}>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {regionRows.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-[10px] py-1 px-1.5 rounded bg-[#0d0f14] border border-[#1e2130]">
                <div className="w-2.5 h-2.5 rounded shrink-0" style={{ background: r.color }} />
                <span className="text-slate-300 truncate w-28">{r.name}</span>
                <span className="text-slate-500">{r.stitch_type}</span>
                <span className="text-slate-600">{r.region_class}</span>
                <span className={`ml-auto ${r.supported ? 'text-emerald-400' : 'text-red-400'}`}>dark {Math.round(r.supportRatio * 100)}%</span>
                {r.black && <span className={`font-bold ${r.blackRegionType === 'background' ? 'text-red-400' : r.blackRegionType === 'eye/mouth' ? 'text-cyan-400' : 'text-amber-400'}`}>{r.blackRegionType}</span>}
                {r.shouldContour && !r.black && <span className="text-cyan-400">contour</span>}
                {r.touchesCanvasEdge && <span className="text-amber-400">edge</span>}
              </div>
            ))}
            {regionRows.length === 0 && <div className="text-[10px] text-slate-600">Sin regiones.</div>}
          </div>
        </Section>

        {/* 5. Comandos finales */}
        <Section title="5. Comandos finales" status={commandsBreakdown.total > 0 ? 'ok' : 'warn'}>
          <Row k="total" v={commandsBreakdown.total} />
          <Row k="stitch / jump / trim" v={`${commandsBreakdown.byType.stitch || 0} / ${commandsBreakdown.byType.jump || 0} / ${commandsBreakdown.byType.trim || 0}`} />
          <Row k="colorChange" v={commandsBreakdown.byType.colorChange || 0} />
          <Row k="contourStitches" v={commandsBreakdown.contourStitches} accent={commandsBreakdown.contourStitches > 0 ? 'emerald' : 'red'} />
          <Row k="fillStitches" v={commandsBreakdown.fillStitches} />
          <div className="mt-1.5">
            <div className="text-[9px] text-slate-600 mb-0.5">por color:</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(commandsBreakdown.byColor).map(([col, n]) => (
                <div key={col} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0d0f14] border border-[#1e2130]">
                  <div className="w-2.5 h-2.5 rounded" style={{ background: col }} />
                  <span className="text-[9px] text-slate-300">{n}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* 6. Validación */}
        <Section title="6. Validación actual" status={ce01.status === 'INVALID' ? 'err' : ce01.status === 'RISKY' ? 'warn' : 'ok'}>
          <div className="flex items-center gap-2 mb-1">
            {ce01.status === 'INVALID' ? <XCircle className="w-4 h-4 text-red-400" /> : ce01.status === 'RISKY' ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <span className={`text-xs font-bold ${ce01.status === 'INVALID' ? 'text-red-400' : ce01.status === 'RISKY' ? 'text-amber-400' : 'text-emerald-400'}`}>{ce01.status}</span>
            <span className="text-[10px] text-slate-500">score {ce01.score}</span>
          </div>
          {ce01.blockingIssues.length > 0 && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[9px] text-red-400 font-bold">CRÍTICOS (bloquean):</div>
              {ce01.blockingIssues.map((b, i) => <div key={i} className="text-[10px] text-red-300"><span className="font-bold text-red-400">[R{b.check}]</span> {b.message}</div>)}
            </div>
          )}
          {ce01.warnings.length > 0 && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[9px] text-amber-400 font-bold">Advertencias ({ce01.warnings.length}):</div>
              {ce01.warnings.map((w, i) => <div key={i} className="text-[10px] text-amber-300"><span className="font-bold text-amber-400">[R{w.check}]</span> {w.message}</div>)}
            </div>
          )}
          {ce01.status === 'RISKY' && ce01.blockingIssues.length === 0 && (
            <div className="mt-1 text-[10px] text-amber-300 bg-amber-900/15 border border-amber-500/30 rounded px-2 py-1">
              Sin bloqueo crítico. RISKY por exceso de saltos/trims/colores y regiones pequeñas (probable máscara contaminada).
            </div>
          )}
          <div className="mt-1.5 pt-1.5 border-t border-[#1e2130]">
            <Row k="reality.status" v={reality.status} accent={reality.ready ? 'emerald' : 'amber'} />
            <Row k="colorMismatch" v={String(reality.colorMismatch)} accent={reality.colorMismatch ? 'red' : 'slate'} />
            <Row k="contourMismatch" v={String(reality.contourMismatch)} accent={reality.contourMismatch ? 'red' : 'slate'} />
            <Row k="mouthMismatch" v={String(reality.mouthMismatch)} accent={reality.mouthMismatch ? 'red' : 'slate'} />
          </div>
        </Section>

        {/* 7. Guard de diagonales */}
        <Section title="7. Guard de diagonales (dark mask)" status={guardCurrent.report.suspiciousBlackDiagonalDetected ? 'err' : (guardReport.removedArtificialBridges > 0 ? 'warn' : 'ok')}>
          <Row k="unsupportedLongContourSegments" v={guardCurrent.report.unsupportedLongContourSegments} accent={guardCurrent.report.unsupportedLongContourSegments === 0 ? 'emerald' : 'red'} />
          <Row k="removedArtificialBridges" v={guardReport.removedArtificialBridges} accent={guardReport.removedArtificialBridges === 0 ? 'slate' : 'amber'} />
          <Row k="longestUnsupportedSegmentMm" v={guardReport.longestUnsupportedSegmentMm ? guardReport.longestUnsupportedSegmentMm.toFixed(1) : 0} />
          <Row k="longestUnsupportedSegmentSupport" v={guardReport.longestUnsupportedSegmentSupport ? guardReport.longestUnsupportedSegmentSupport.toFixed(2) : '—'} />
          <Row k="suspiciousBlackDiagonalDetected" v={String(guardCurrent.report.suspiciousBlackDiagonalDetected)} accent={guardCurrent.report.suspiciousBlackDiagonalDetected ? 'red' : 'emerald'} />
          {guardReport.segments?.[0] && <>
            <Row k="sourceObjectId" v={guardReport.segments[0].objectId || '—'} />
            <Row k="sourceRegionName" v={guardReport.segments[0].regionName || '—'} />
          </>}
        </Section>

        {/* 8. Overlays */}
        <Section title="8. Overlays visuales">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Toggle id="original" label="Original" color="amber" />
            <Toggle id="mask" label="StrictDarkMask" color="red" />
            <Toggle id="contours" label="UniversalContours" color="cyan" />
            <Toggle id="regions" label="Regiones" color="violet" />
            <Toggle id="contoursOnly" label="Solo contornos" color="cyan" />
            <Toggle id="fillsOnly" label="Solo rellenos" color="violet" />
            <Toggle id="commands" label="FinalCommands" color="emerald" />
          </div>
          <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2 flex justify-center">
            <canvas ref={overlayCanvasRef} className="max-w-full" style={{ imageRendering: 'pixelated' }} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, status, children }) {
  const dot = status === 'ok' ? 'bg-emerald-500' : status === 'warn' ? 'bg-amber-500' : status === 'err' ? 'bg-red-500' : status === 'loading' ? 'bg-slate-600 animate-pulse' : 'bg-slate-700';
  return (
    <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <h4 className="text-xs font-bold text-slate-200">{title}</h4>
      </div>
      {children}
    </div>
  );
}
function Row({ k, v, accent = 'slate' }) {
  const color = accent === 'emerald' ? 'text-emerald-400' : accent === 'amber' ? 'text-amber-400' : accent === 'red' ? 'text-red-400' : 'text-slate-300';
  return <div className="flex items-center justify-between text-[10px] py-0.5"><span className="text-slate-500">{k}</span><span className={`font-bold ${color}`}>{v}</span></div>;
}
function Err({ msg }) { return <div className="text-[10px] text-red-400">{msg}</div>; }
function Flag({ text }) { return <div className="mt-1 text-[10px] text-red-400 bg-red-900/20 border border-red-500/30 rounded px-2 py-1 font-bold">⚠ {text}</div>; }