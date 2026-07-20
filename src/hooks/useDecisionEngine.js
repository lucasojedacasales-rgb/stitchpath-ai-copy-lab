// useDecisionEngine — análisis local de imagen para sugerir parámetros de digitalización
import { useState, useCallback, useRef } from 'react';

export function useDecisionEngine() {
  const [status, setStatus] = useState('idle'); // 'idle' | 'analyzing' | 'complete' | 'error'
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    abortRef.current = true;
    // Clear abort flag after a tick so any in-flight analyze sees it, but
    // a subsequent analyze() call in the same user action isn't pre-aborted.
    setTimeout(() => { abortRef.current = false; }, 0);
    setStatus('idle');
    setResult(null);
    setError(null);
    setProgress(0);
  }, []);

  const analyze = useCallback(async (imageSource) => {
    abortRef.current = false;
    setStatus('analyzing');
    setProgress(10);
    setError(null);
    setResult(null);

    // Track any object URL created for this analysis so we can revoke on abort/error
    let blobUrl = null;
    if (imageSource instanceof File) {
      blobUrl = URL.createObjectURL(imageSource);
    }

    try {
      // Cargar imagen en canvas para análisis local
      const img = await loadImageSource(imageSource instanceof File ? blobUrl : imageSource);
      if (abortRef.current) return null;
      setProgress(30);

      const W = Math.min(img.width, 256);
      const H = Math.round(img.height * (W / img.width));
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;

      setProgress(50);

      // Análisis de propiedades básicas
      const props = analyzePixels(data, W, H);
      if (abortRef.current) return null;
      setProgress(80);

      // Generar estrategia de digitalización
      const strategy = buildStrategy(props);
      const decisionResult = {
        contentType: props.contentType,
        confidence: props.confidence,
        dimensions: { width: img.width, height: img.height },
        properties: props,
        strategy,
        estimatedThreadColors: Math.min(strategy.recommendedParams.maxColors, props.colorCount),
        warnings: buildWarnings(props),
      };

      if (abortRef.current) return null;
      setResult(decisionResult);
      setProgress(100);
      setStatus('complete');
      return decisionResult;

    } catch (err) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (abortRef.current) return null;
      setError(err.message || 'Error en análisis');
      setStatus('error');
      return null;
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }, []);

  const isLoading = status === 'analyzing';

  return { status, result, error, progress, isLoading, analyze, reset };
}

// ─── Cargar imagen desde File, URL o HTMLImageElement ─────────────────────────

// Accepts string URL or HTMLImageElement only — File handling is done in analyze() above
function loadImageSource(source) {
  return new Promise((resolve, reject) => {
    if (source instanceof HTMLImageElement && source.complete) {
      resolve(source); return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    if (typeof source === 'string') {
      img.src = source;
    } else if (source instanceof HTMLImageElement) {
      img.src = source.src;
    } else {
      reject(new Error('Fuente de imagen no soportada'));
    }
  });
}

// ─── Análisis de píxeles ──────────────────────────────────────────────────────

function analyzePixels(data, W, H) {
  let rSum = 0, gSum = 0, bSum = 0;
  let transparentCount = 0;
  let edgeCount = 0;
  let totalOpaque = 0;

  const colorMap = new Map();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) { transparentCount++; continue; }
    totalOpaque++;
    rSum += r; gSum += g; bSum += b;

    // Quantize to 32-step buckets for color counting
    const key = `${Math.round(r / 32)},${Math.round(g / 32)},${Math.round(b / 32)}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }

  // Edge detection (simplified Sobel on luminance)
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx = lum[(y - 1) * W + x + 1] - lum[(y - 1) * W + x - 1]
               + 2 * lum[y * W + x + 1]   - 2 * lum[y * W + x - 1]
               + lum[(y + 1) * W + x + 1] - lum[(y + 1) * W + x - 1];
      const gy = lum[(y + 1) * W + x - 1] - lum[(y - 1) * W + x - 1]
               + 2 * lum[(y + 1) * W + x] - 2 * lum[(y - 1) * W + x]
               + lum[(y + 1) * W + x + 1] - lum[(y - 1) * W + x + 1];
      if (Math.sqrt(gx * gx + gy * gy) > 40) edgeCount++;
    }
  }

  const hasTransparency = transparentCount > (W * H * 0.05);
  const edgeRatio = edgeCount / Math.max(totalOpaque, 1);
  const colorCount = colorMap.size;

  // Variance for gradient detection
  const avgR = rSum / Math.max(totalOpaque, 1);
  const avgG = gSum / Math.max(totalOpaque, 1);
  const avgB = bSum / Math.max(totalOpaque, 1);

  // Content type heuristic
  let contentType = 'illustration';
  let confidence = 0.7;
  if (colorCount < 15 && edgeRatio > 0.1) { contentType = 'logo'; confidence = 0.85; }
  else if (colorCount > 80) { contentType = 'photo'; confidence = 0.8; }
  else if (edgeRatio < 0.05) { contentType = 'solid'; confidence = 0.9; }

  const dominantColors = [...colorMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => {
      const [r, g, b] = key.split(',').map(n => Math.min(255, parseInt(n) * 32));
      return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    });

  return {
    contentType,
    confidence,
    colorCount: Math.min(colorCount, 20),
    hasTransparency,
    hasShadows: colorCount > 30 && edgeRatio < 0.15,
    hasGradients: colorCount > 50,
    hasFineDetails: edgeRatio > 0.2,
    isHighContrast: edgeRatio > 0.15,
    complexity: colorCount > 40 ? 'high' : colorCount > 15 ? 'medium' : 'low',
    dominantColors,
  };
}

// ─── Construir estrategia ──────────────────────────────────────────────────────

function buildStrategy(props) {
  let vectorizationMode = 'color-quantize';
  let stitchType = 'fill';
  let colorReduction = 'light';
  let detailPreservation = 'medium';
  let maxColors = 8;
  let minRegionArea = 5;

  if (props.contentType === 'logo') {
    vectorizationMode = 'posterize';
    stitchType = props.hasFineDetails ? 'mixed' : 'satin';
    colorReduction = 'aggressive';
    detailPreservation = 'high';
    maxColors = Math.min(props.colorCount, 8);
    minRegionArea = 3;
  } else if (props.contentType === 'photo') {
    vectorizationMode = 'color-quantize';
    stitchType = 'fill';
    colorReduction = 'light';
    detailPreservation = 'medium';
    maxColors = 12;
    minRegionArea = 8;
  } else if (props.contentType === 'solid') {
    vectorizationMode = 'posterize';
    stitchType = 'fill';
    colorReduction = 'none';
    maxColors = Math.min(props.colorCount, 6);
    minRegionArea = 2;
  } else {
    // illustration
    vectorizationMode = props.hasFineDetails ? 'edge-trace' : 'posterize';
    stitchType = 'mixed';
    colorReduction = 'light';
    detailPreservation = props.hasFineDetails ? 'high' : 'medium';
    maxColors = Math.min(props.colorCount, 10);
    minRegionArea = 5;
  }

  const pipeline = ['preprocess', 'vectorize', 'classify-stitches', 'generate', 'optimize'];

  return {
    vectorizationMode,
    stitchType,
    colorReduction,
    detailPreservation,
    recommendedParams: { maxColors, minRegionArea },
    pipeline,
  };
}

function buildWarnings(props) {
  const warnings = [];
  if (props.hasGradients) warnings.push('Imagen con degradados: la reducción de colores puede perder detalle.');
  if (props.colorCount > 15) warnings.push(`${props.colorCount} colores detectados. Se reducirán para bordado.`);
  if (!props.hasTransparency) warnings.push('Sin canal alfa: considera usar la herramienta de máscara para aislar el diseño.');
  return warnings;
}