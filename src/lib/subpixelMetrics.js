/**
 * subpixelMetrics.js
 *
 * Motor de métricas sub-pixel para regiones de bordado.
 * - Interpolación bicúbica para medidas de grosor
 * - Skeletonización (Zhang-Suen thinning) con análisis medial
 * - Detección de ramificaciones (branch points, endpoints)
 * - Histograma de distribución de grosor
 */

// ─── Interpolación Bicúbica ───────────────────────────────────────────────────

/**
 * Kernel cúbico de Catmull-Rom (a = -0.5)
 */
function cubicKernel(t) {
  const a = -0.5;
  const at = Math.abs(t);
  if (at < 1) return (a + 2) * at * at * at - (a + 3) * at * at + 1;
  if (at < 2) return a * at * at * at - 5 * a * at * at + 8 * a * at - 4 * a;
  return 0;
}

/**
 * Muestra un valor en coordenadas sub-pixel usando interpolación bicúbica.
 * @param {Float32Array} data  - datos de imagen (un canal)
 * @param {number} W           - ancho
 * @param {number} H           - alto
 * @param {number} x           - coordenada x sub-pixel
 * @param {number} y           - coordenada y sub-pixel
 */
function bicubicSample(data, W, H, x, y) {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  let value = 0;
  for (let m = -1; m <= 2; m++) {
    const ky = cubicKernel(y - (fy + m));
    for (let n = -1; n <= 2; n++) {
      const kx = cubicKernel(x - (fx + n));
      const px = Math.max(0, Math.min(W - 1, fx + n));
      const py = Math.max(0, Math.min(H - 1, fy + m));
      value += data[py * W + px] * kx * ky;
    }
  }
  return value;
}

// ─── Rasterización de polígono ────────────────────────────────────────────────

/**
 * Rasteriza un polígono normalizado [0..1] en una máscara binaria Float32Array.
 * Aplica supersampling 4x para sub-pixel accuracy.
 */
function rasterizePolygon(pathPoints, W, H) {
  const SS = 4; // supersampling factor
  const SW = W * SS;
  const SH = H * SS;
  const ssBuffer = new Uint8Array(SW * SH);

  // Convert normalized → supersampled px
  const poly = pathPoints.map(p => [p[0] * SW, p[1] * SH]);

  // Scanline fill en buffer supersampleado
  for (let sy = 0; sy < SH; sy++) {
    const intersections = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[j];
      if ((y0 <= sy && sy < y1) || (y1 <= sy && sy < y0)) {
        const xi = x0 + (sy - y0) * (x1 - x0) / (y1 - y0);
        intersections.push(xi);
      }
    }
    intersections.sort((a, b) => a - b);
    for (let k = 0; k < intersections.length - 1; k += 2) {
      const xStart = Math.round(intersections[k]);
      const xEnd   = Math.round(intersections[k + 1]);
      for (let sx = xStart; sx <= xEnd; sx++) {
        if (sx >= 0 && sx < SW) ssBuffer[sy * SW + sx] = 1;
      }
    }
  }

  // Downsample: promedio del bloque SS×SS → valor float [0..1]
  const mask = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          sum += ssBuffer[(y * SS + dy) * SW + (x * SS + dx)];
        }
      }
      mask[y * W + x] = sum / (SS * SS);
    }
  }
  return mask;
}

// ─── Distance Transform (EDT aproximada) ──────────────────────────────────────

/**
 * Distancia euclidiana aproximada via transformada 8-SED (sequential).
 * Retorna Float32Array con distancia en píxeles desde el borde interior.
 */
function distanceTransform(binaryMask, W, H) {
  const INF = 1e9;
  const dist = new Float32Array(W * H).fill(INF);

  // Inicializar: bordes de la máscara = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (binaryMask[i] < 0.5) { dist[i] = 0; continue; }
      // Si algún vecino está fuera o es 0 → es borde
      let isBorder = false;
      for (let dy = -1; dy <= 1 && !isBorder; dy++) {
        for (let dx = -1; dx <= 1 && !isBorder; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || binaryMask[ny * W + nx] < 0.5) {
            isBorder = true;
          }
        }
      }
      if (isBorder) dist[i] = 0;
    }
  }

  // Forward pass
  for (let y = 1; y < H; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (binaryMask[i] < 0.5) continue;
      const cands = [
        dist[(y - 1) * W + (x - 1)] + Math.SQRT2,
        dist[(y - 1) * W + x]       + 1,
        dist[(y - 1) * W + (x + 1)] + Math.SQRT2,
        dist[y       * W + (x - 1)] + 1,
      ];
      dist[i] = Math.min(dist[i], ...cands);
    }
  }

  // Backward pass
  for (let y = H - 2; y >= 0; y--) {
    for (let x = W - 2; x >= 1; x--) {
      const i = y * W + x;
      if (binaryMask[i] < 0.5) continue;
      const cands = [
        dist[(y + 1) * W + (x + 1)] + Math.SQRT2,
        dist[(y + 1) * W + x]       + 1,
        dist[(y + 1) * W + (x - 1)] + Math.SQRT2,
        dist[y       * W + (x + 1)] + 1,
      ];
      dist[i] = Math.min(dist[i], ...cands);
    }
  }

  return dist;
}

// ─── Zhang-Suen Thinning ──────────────────────────────────────────────────────

/**
 * Skeletonización Zhang-Suen sobre máscara binaria (Uint8Array).
 * Retorna Uint8Array del mismo tamaño con el esqueleto.
 */
function zhangSuenThinning(binaryMask, W, H) {
  const img = new Uint8Array(binaryMask); // copia de trabajo

  function getP(arr, x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    return arr[y * W + x];
  }

  function transitions(x, y) {
    const neighbors = [
      getP(img, x,   y-1), getP(img, x+1, y-1),
      getP(img, x+1, y),   getP(img, x+1, y+1),
      getP(img, x,   y+1), getP(img, x-1, y+1),
      getP(img, x-1, y),   getP(img, x-1, y-1),
      getP(img, x,   y-1),
    ];
    let count = 0;
    for (let i = 0; i < 8; i++) {
      if (neighbors[i] === 0 && neighbors[i + 1] === 1) count++;
    }
    return count;
  }

  function sumNeighbors(x, y) {
    return getP(img, x,   y-1) + getP(img, x+1, y-1) +
           getP(img, x+1, y)   + getP(img, x+1, y+1) +
           getP(img, x,   y+1) + getP(img, x-1, y+1) +
           getP(img, x-1, y)   + getP(img, x-1, y-1);
  }

  let changed = true;
  let iterations = 0;
  const maxIter = 500;

  while (changed && iterations++ < maxIter) {
    changed = false;
    const toDelete = [];

    // Sub-iteration 1
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (img[y * W + x] !== 1) continue;
        const B = sumNeighbors(x, y);
        if (B < 2 || B > 6) continue;
        if (transitions(x, y) !== 1) continue;
        if (getP(img, x, y-1) * getP(img, x+1, y) * getP(img, x, y+1) !== 0) continue;
        if (getP(img, x+1, y) * getP(img, x, y+1) * getP(img, x-1, y) !== 0) continue;
        toDelete.push(y * W + x);
      }
    }
    for (const i of toDelete) { img[i] = 0; changed = true; }
    toDelete.length = 0;

    // Sub-iteration 2
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (img[y * W + x] !== 1) continue;
        const B = sumNeighbors(x, y);
        if (B < 2 || B > 6) continue;
        if (transitions(x, y) !== 1) continue;
        if (getP(img, x, y-1) * getP(img, x+1, y) * getP(img, x-1, y) !== 0) continue;
        if (getP(img, x, y-1) * getP(img, x, y+1) * getP(img, x-1, y) !== 0) continue;
        toDelete.push(y * W + x);
      }
    }
    for (const i of toDelete) { img[i] = 0; changed = true; }
  }

  return img;
}

// ─── Análisis de esqueleto ────────────────────────────────────────────────────

const N8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

/**
 * Clasifica cada píxel del esqueleto en: endpoint (1 vecino), branch (3+ vecinos).
 * Retorna { endpoints: [[x,y],...], branches: [[x,y],...], edgeCount }
 */
function analyzeSkeletonTopology(skeleton, W, H) {
  const endpoints = [];
  const branches  = [];
  let edgeCount   = 0;

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!skeleton[y * W + x]) continue;
      let neighborCount = 0;
      for (const [dy, dx] of N8) {
        if (skeleton[(y + dy) * W + (x + dx)]) neighborCount++;
      }
      if (neighborCount === 1) endpoints.push([x, y]);
      else if (neighborCount >= 3) branches.push([x, y]);
      if (neighborCount === 2) edgeCount++;
    }
  }

  return { endpoints, branches, edgeCount };
}

// ─── Histograma de grosor ─────────────────────────────────────────────────────

/**
 * Construye histograma de distribución de grosor usando el distance transform
 * muestreado sobre el esqueleto. Valores en píxeles → convertidos a mm.
 * @param {Float32Array} distMap - EDT
 * @param {Uint8Array}   skeleton
 * @param {number}       pxPerMm - píxeles por mm en el canvas de análisis
 * @param {number}       bins
 */
function buildThicknessHistogram(distMap, skeleton, W, H, pxPerMm, bins = 32) {
  const thicknessMm = [];
  const MAX_MM = 20;
  const binWidth = MAX_MM / bins;
  const histogram = new Array(bins).fill(0);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!skeleton[y * W + x]) continue;
      // grosor ≈ 2 × radio (EDT) en mm
      const radiusPx = distMap[y * W + x];
      const thickPx  = radiusPx * 2;
      const thickMm  = thickPx / pxPerMm;
      thicknessMm.push(thickMm);
      const bin = Math.min(bins - 1, Math.floor(thickMm / binWidth));
      histogram[bin]++;
    }
  }

  if (thicknessMm.length === 0) return { histogram: [], labels: [], mean: 0, std: 0, min: 0, max: 0, p10: 0, p50: 0, p90: 0 };

  thicknessMm.sort((a, b) => a - b);
  const n = thicknessMm.length;
  const mean = thicknessMm.reduce((s, v) => s + v, 0) / n;
  const std  = Math.sqrt(thicknessMm.reduce((s, v) => s + (v - mean) ** 2, 0) / n);

  return {
    histogram,
    labels: Array.from({ length: bins }, (_, i) => +((i * binWidth + binWidth / 2).toFixed(2))),
    mean:   +mean.toFixed(3),
    std:    +std.toFixed(3),
    min:    +thicknessMm[0].toFixed(3),
    max:    +thicknessMm[n - 1].toFixed(3),
    p10:    +thicknessMm[Math.floor(n * 0.1)].toFixed(3),
    p50:    +thicknessMm[Math.floor(n * 0.5)].toFixed(3),
    p90:    +thicknessMm[Math.floor(n * 0.9)].toFixed(3),
    sampleCount: n,
  };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Calcula métricas sub-pixel completas para una región tipo "fill".
 *
 * @param {Array}  pathPoints   - coordenadas normalizadas [[x,y], ...]
 * @param {number} widthMm      - ancho real del diseño en mm
 * @param {number} heightMm     - alto real del diseño en mm
 * @param {object} opts
 * @param {number} opts.resolution - resolución de análisis en px por lado (default 256)
 * @param {number} opts.histogramBins - número de bins del histograma (default 32)
 *
 * @returns {Promise<SubpixelMetrics>}
 */
export async function computeSubpixelMetrics(pathPoints, widthMm, heightMm, opts = {}) {
  const { resolution = 256, histogramBins = 32 } = opts;
  const W = resolution;
  const H = Math.max(8, Math.round(resolution * (heightMm / Math.max(widthMm, 1))));
  const pxPerMm = W / widthMm;

  // 1. Rasterizar polígono con supersampling → máscara float sub-pixel
  const mask = rasterizePolygon(pathPoints, W, H);

  // 2. Máscara binaria para operaciones morfológicas
  const binary = new Uint8Array(W * H);
  let area = 0;
  for (let i = 0; i < W * H; i++) {
    if (mask[i] >= 0.5) { binary[i] = 1; area++; }
  }

  if (area < 4) {
    return emptyMetrics();
  }

  // 3. Distance Transform (EDT)
  const distMap = distanceTransform(mask, W, H);

  // 4. Skeletonización Zhang-Suen
  const skeleton = zhangSuenThinning(binary, W, H);

  // 5. Análisis topológico del esqueleto
  const topology = analyzeSkeletonTopology(skeleton, W, H);

  // 6. Histograma de grosor
  const thickness = buildThicknessHistogram(distMap, skeleton, W, H, pxPerMm, histogramBins);

  // 7. Longitud del esqueleto (en mm)
  let skeletonPx = 0;
  for (let i = 0; i < W * H; i++) if (skeleton[i]) skeletonPx++;
  const skeletonLengthMm = +(skeletonPx / pxPerMm).toFixed(2);

  // 8. Área real con cobertura sub-pixel (integrate the float mask)
  let subpixelArea = 0;
  for (let i = 0; i < W * H; i++) subpixelArea += mask[i];
  const areaMm2 = +(subpixelArea / (pxPerMm * pxPerMm)).toFixed(3);

  // 9. Métricas de ramificación
  const branchCount    = topology.branches.length;
  const endpointCount  = topology.endpoints.length;
  const branchDensity  = skeletonLengthMm > 0 ? +(branchCount / skeletonLengthMm).toFixed(4) : 0;

  // 10. Clasificar complejidad basada en topología
  const complexity = classifyComplexity(branchCount, endpointCount, thickness);

  return {
    // Área
    areaMm2,
    areaPx: area,

    // Esqueleto
    skeletonLengthMm,
    skeletonPixels: skeletonPx,

    // Topología
    topology: {
      branchPoints:    branchCount,
      endpoints:       endpointCount,
      branchDensity,   // ramas por mm de esqueleto
      branchCoords:    topology.branches.map(([x, y]) => [
        +(x / pxPerMm).toFixed(3),
        +(y / pxPerMm).toFixed(3),
      ]),
      endpointCoords:  topology.endpoints.map(([x, y]) => [
        +(x / pxPerMm).toFixed(3),
        +(y / pxPerMm).toFixed(3),
      ]),
    },

    // Grosor
    thickness,

    // Complejidad
    complexity,

    // Metadatos
    resolution: { W, H, pxPerMm: +pxPerMm.toFixed(4) },
  };
}

function classifyComplexity(branchCount, endpointCount, thickness) {
  if (branchCount === 0 && endpointCount <= 2) return 'simple';
  if (branchCount <= 3 && thickness.std < 1.5)  return 'moderate';
  if (branchCount <= 10)                         return 'complex';
  return 'highly_complex';
}

function emptyMetrics() {
  return {
    areaMm2: 0, areaPx: 0,
    skeletonLengthMm: 0, skeletonPixels: 0,
    topology: { branchPoints: 0, endpoints: 0, branchDensity: 0, branchCoords: [], endpointCoords: [] },
    thickness: { histogram: [], labels: [], mean: 0, std: 0, min: 0, max: 0, p10: 0, p50: 0, p90: 0, sampleCount: 0 },
    complexity: 'simple',
    resolution: { W: 0, H: 0, pxPerMm: 0 },
  };
}

/**
 * Versión por lotes: calcula métricas para múltiples regiones en paralelo.
 * Usa Promise.all para máxima velocidad.
 */
export async function computeMetricsBatch(regions, widthMm, heightMm, opts = {}) {
  return Promise.all(
    regions
      .filter(r => r.stitch_type === 'fill' && r.path_points?.length >= 3)
      .map(async r => {
        const metrics = await computeSubpixelMetrics(r.path_points, widthMm, heightMm, opts);
        return { regionId: r.id, regionName: r.name, metrics };
      })
  );
}