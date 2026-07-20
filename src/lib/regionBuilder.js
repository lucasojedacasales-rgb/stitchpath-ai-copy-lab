/**
 * regionBuilder.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reescritura completa. Cada región enriquecida almacena:
 *
 * GEOMETRÍA
 *   area_mm2          — área en mm²
 *   perimeter_mm      — perímetro en mm
 *   orientation       — orientación principal [0,180) grados (PCA)
 *   convexity         — ratio área / área casco convexo [0,1]
 *   concavity         — 1 - convexity (profundidad de hendiduras)
 *   skeleton_length_mm— longitud aproximada del esqueleto medial en mm
 *   mean_width_mm     — ancho medio (area / longitud esqueleto)
 *   max_width_mm      — grosor máximo estimado (diámetro máximo inscritos)
 *   min_width_mm      — grosor mínimo estimado
 *   mean_curvature    — curvatura media del contorno (radianes)
 *   holes             — número estimado de agujeros internos
 *   complexity        — { score: 0-1, level: 'simple'|'media'|'alta' }
 *
 * COLOR / HILO
 *   color             — hex dominante
 *   recommended_thread— { brand, code, name, hex } hilo más cercano
 *   recommended_stitch— 'fill' | 'satin' | 'running_stitch'
 *   stitch_rationale  — texto justificando el tipo de puntada
 *   recommended_underlay — boolean + tipo de underlay
 *   recommended_density  — mm entre filas (0.3–0.5)
 *   recommended_compensation — mm de pull compensation (0–0.5)
 *
 * PRODUCCIÓN
 *   stitch_count      — puntadas estimadas (o desde backend)
 *   estimatedTime     — minutos de máquina
 *   estimatedThread   — { mm, grams }
 *   priority          — [1,10] orden de construcción de capas
 *   travelOrder       — índice en la secuencia de viaje óptima
 *   quality_score     — [0,100] calidad estimada
 *   quality_issues    — string[] lista de problemas detectados
 */

import { adaptRegion } from './adaptiveEngine.js';
import { eieOptimizeTravelOrder } from './stitchIntelligence.js';
import { computeStitchCount } from './stitchCount.js';

// ─── Constantes ────────────────────────────────────────────────────────────────

const THREAD_MM_PER_STITCH = 5.5;
const MACHINE_SPM_DEFAULT  = 800;
const MM_PER_GRAM          = 220;

// ─── Geometría básica ──────────────────────────────────────────────────────────

function polygonArea(pts) {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1];
    area -= pts[j][0] * pts[i][1];
  }
  return Math.abs(area) / 2;
}

function polygonPerimeter(pts) {
  let p = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p += Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
  }
  return p;
}

function centroid(pts) {
  const n = pts.length;
  return [
    pts.reduce((s, p) => s + p[0], 0) / n,
    pts.reduce((s, p) => s + p[1], 0) / n,
  ];
}

// ─── Casco convexo ────────────────────────────────────────────────────────────

function convexHull(pts) {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function computeConvexity(pts) {
  const hull = convexHull(pts);
  const areaOrig = polygonArea(pts);
  const areaHull = polygonArea(hull);
  if (areaHull < 1e-9) return 1;
  return Math.min(1, areaOrig / areaHull);
}

// ─── Orientación PCA ──────────────────────────────────────────────────────────

function computeOrientation(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  const [cx, cy] = centroid(pts);
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return Math.round(((angle * 180) / Math.PI + 180) % 180);
}

// ─── Curvatura ────────────────────────────────────────────────────────────────

function computeMeanCurvature(pts) {
  if (pts.length < 4) return 0;
  let total = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const v1 = [b[0]-a[0], b[1]-a[1]];
    const v2 = [c[0]-b[0], c[1]-b[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const dot = (v1[0]*v2[0] + v1[1]*v2[1]) / (l1 * l2);
    total += Math.acos(Math.max(-1, Math.min(1, dot)));
  }
  return +(total / n).toFixed(4);
}

// ─── Esqueleto medial (aproximación por ejes PCA) ─────────────────────────────
// Estimación geométrica sin tratar pixels: proyecta puntos sobre el eje principal,
// calcula el rango, y deriva anchuras perpendiculares.

function computeSkeletonMetrics(pts, orientationDeg) {
  if (pts.length < 3) return { skeleton_length_mm: 0, mean_width_mm: 0, max_width_mm: 0, min_width_mm: 0 };

  const rad = (orientationDeg * Math.PI) / 180;
  const axisX = Math.cos(rad), axisY = Math.sin(rad);
  const perpX = -axisY, perpY = axisX;

  // Proyección de cada punto sobre el eje principal y perpendicular
  const proj  = pts.map(p => p[0] * axisX + p[1] * axisY);
  const perps = pts.map(p => p[0] * perpX + p[1] * perpY);

  const minProj = Math.min(...proj), maxProj = Math.max(...proj);
  const skeleton_length_mm = maxProj - minProj;

  if (skeleton_length_mm < 1e-6) {
    const fallback = Math.sqrt(polygonArea(pts));
    return { skeleton_length_mm: fallback, mean_width_mm: fallback, max_width_mm: fallback, min_width_mm: fallback };
  }

  // Estimar anchos en franjas a lo largo del eje principal (16 secciones)
  const SLICES = 16;
  const step = skeleton_length_mm / SLICES;
  const widths = [];
  for (let s = 0; s < SLICES; s++) {
    const lo = minProj + s * step;
    const hi = lo + step;
    const inSlice = perps.filter((_, i) => proj[i] >= lo && proj[i] < hi);
    if (inSlice.length >= 2) {
      widths.push(Math.max(...inSlice) - Math.min(...inSlice));
    }
  }

  const mean_width_mm = widths.length > 0
    ? +(widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(2)
    : +(polygonArea(pts) / skeleton_length_mm).toFixed(2);
  const max_width_mm = widths.length > 0 ? +Math.max(...widths).toFixed(2) : mean_width_mm;
  const min_width_mm = widths.length > 0 ? +Math.min(...widths).toFixed(2) : mean_width_mm;

  return {
    skeleton_length_mm: +skeleton_length_mm.toFixed(2),
    mean_width_mm,
    max_width_mm,
    min_width_mm,
  };
}

// ─── Complejidad ──────────────────────────────────────────────────────────────

function computeComplexity(pts, curvature, convexity) {
  const vertexScore = Math.min(1, pts.length / 200);
  const curvScore   = Math.min(1, curvature / 1.5);
  const convexScore = 1 - convexity;
  const raw = vertexScore * 0.35 + curvScore * 0.40 + convexScore * 0.25;
  const level = raw < 0.25 ? 'simple' : raw < 0.55 ? 'media' : 'alta';
  return { score: +raw.toFixed(3), level };
}

// ─── Detección de agujeros ────────────────────────────────────────────────────

function estimateHoles(region, allRegions) {
  if (!allRegions?.length) return 0;
  const [cx, cy] = region.centroid || [0.5, 0.5];
  const myArea   = region.area_mm2 || 1;
  let holes = 0;
  for (const other of allRegions) {
    if (other.id === region.id || !other.centroid) continue;
    const [ox, oy] = other.centroid;
    const dist = Math.hypot(ox - cx, oy - cy);
    if ((other.area_mm2 || 0) < myArea * 0.12 && dist < 0.15) holes++;
  }
  return holes;
}

// ─── (Legacy recommend* functions replaced by lib/adaptiveEngine.js) ─────────

// ─── Hilo recomendado (match de color simplificado) ───────────────────────────

const BASIC_THREAD_PALETTE = [
  { code: 'BLK', name: 'Negro', hex: '#1a1a1a', r: 26,  g: 26,  b: 26  },
  { code: 'WHT', name: 'Blanco', hex: '#f5f5f5', r: 245, g: 245, b: 245 },
  { code: 'RED', name: 'Rojo', hex: '#cc2222', r: 204, g: 34,  b: 34  },
  { code: 'BLU', name: 'Azul', hex: '#1a4acc', r: 26,  g: 74,  b: 204 },
  { code: 'GRN', name: 'Verde', hex: '#2a8c3a', r: 42,  g: 140, b: 58  },
  { code: 'YEL', name: 'Amarillo', hex: '#e8d020', r: 232, g: 208, b: 32  },
  { code: 'ORG', name: 'Naranja', hex: '#e87020', r: 232, g: 112, b: 32  },
  { code: 'PNK', name: 'Rosa', hex: '#e060a0', r: 224, g: 96,  b: 160 },
  { code: 'PUR', name: 'Morado', hex: '#7030c0', r: 112, g: 48,  b: 192 },
  { code: 'BRN', name: 'Marrón', hex: '#7a4020', r: 122, g: 64,  b: 32  },
  { code: 'GRY', name: 'Gris', hex: '#888888', r: 136, g: 136, b: 136 },
  { code: 'LBL', name: 'Azul claro', hex: '#4090e0', r: 64,  g: 144, b: 224 },
  { code: 'LGR', name: 'Verde claro', hex: '#60c060', r: 96,  g: 192, b: 96  },
  { code: 'CRM', name: 'Crema', hex: '#f0e0b0', r: 240, g: 224, b: 176 },
  { code: 'GLD', name: 'Dorado', hex: '#d4a820', r: 212, g: 168, b: 32  },
  { code: 'SLV', name: 'Plateado', hex: '#c0c8d0', r: 192, g: 200, b: 208 },
];

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  return { r: parseInt(h.slice(0,2),16)||128, g: parseInt(h.slice(2,4),16)||128, b: parseInt(h.slice(4,6),16)||128 };
}

function recommendThread(colorHex) {
  const { r, g, b } = hexToRgb(colorHex);
  let best = BASIC_THREAD_PALETTE[0], bestD = Infinity;
  for (const t of BASIC_THREAD_PALETTE) {
    const d = (r-t.r)**2 + (g-t.g)**2 + (b-t.b)**2;
    if (d < bestD) { bestD = d; best = t; }
  }
  return { brand: 'Generic 40wt', code: best.code, name: best.name, hex: best.hex };
}

// ─── Estimaciones de producción ───────────────────────────────────────────────

/**
 * Physical stitch count estimation — single source of truth for regionBuilder.
 *
 * Fill (tatami):
 *   Physical model: stitches = area / (rowSpacing × stitchLength)
 *   rowSpacing = density_mm; stitchLength = 2.4mm (Tajima nominal for 40wt)
 *   This matches the backend calcularStitchCount formula exactly.
 *   Old formula (area * 2.5 / density) was ~30% high for non-square shapes
 *   because it assumed avgRowLength = area/rowSpacing without dividing by stitchLength.
 *
 * Satin:
 *   Columns = (perimeter/2) / density  (half-perimeter = one side of shape)
 *   Each column = one needle pass (not doubled). Matches Wilcom reference output.
 *   Old formula (perim * 2 * area/perim) = 2*area — completely wrong, used area not perimeter.
 *
 * Running: 1 stitch per 1.8mm (standard 40wt thread run length).
 *
 * Impact: eliminates systematic over-count on fill (old: ~2.5×, new: ~1.67× at 0.4mm density/2.4mm length)
 * and fixes satin count which was using wrong physical model entirely.
 */
// Canonical stitch count now lives in stitchCount.js — thin alias for readability.
function estimateStitchCount(region, density) {
  return computeStitchCount(region, density);
}

function estimateTime(stitches) {
  return +(stitches / MACHINE_SPM_DEFAULT).toFixed(2);
}

function estimateThread(stitches) {
  const mm    = stitches * THREAD_MM_PER_STITCH;
  return { mm: Math.round(mm), grams: +(mm / MM_PER_GRAM).toFixed(2) };
}

// ─── Calidad ──────────────────────────────────────────────────────────────────

function computeQuality(region, stitchType, skeletonMetrics, convexity, complexity, holes, density) {
  let score = 100;
  const issues = [];
  const area   = region.area_mm2 || 0;

  if (area < 3) { score -= 40; issues.push('Área extremadamente pequeña (<3mm²), posible pérdida de detalle.'); }
  else if (area < 8) { score -= 20; issues.push('Área pequeña (<8mm²), verificar resolución mínima de máquina.'); }

  if (stitchType === 'satin' && skeletonMetrics.max_width_mm > 8) {
    score -= 25; issues.push(`Ancho satin (${skeletonMetrics.max_width_mm.toFixed(1)}mm) excede el límite recomendado (8mm); considerar fill.`);
  }
  if (stitchType === 'satin' && convexity < 0.5) {
    score -= 15; issues.push('Forma cóncava con satin puede generar solapamientos de hilo.');
  }
  if (stitchType === 'fill' && complexity.level === 'alta') {
    score -= 10; issues.push('Alta complejidad geométrica puede causar saltos de aguja.');
  }
  if (holes > 0) {
    score -= holes * 8; issues.push(`${holes} agujero(s) detectado(s); el motor deberá gestionar saltos internos.`);
  }
  if (density < 0.30) {
    score -= 10; issues.push('Densidad muy alta (<0.30mm), riesgo de distorsión de tejido.');
  }
  if (stitchType === 'fill' && region.underlay_data?.enabled && area > 50) {
    score += 5;
  }

  return { quality_score: Math.max(0, Math.min(100, Math.round(score))), quality_issues: issues };
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Enriquece una única región con todas las métricas y recomendaciones.
 */
export function enrichRegion(region, allRegions = [], designWidthMm = 100, designHeightMm = 100, fabricType = 'Algodón', useAdaptive = true) {
  const pts = region.path_points || [];
  if (pts.length < 3) return region;

  // Convertir puntos normalizados → mm
  const scaled = pts.map(p => [p[0] * designWidthMm, p[1] * designHeightMm]);

  // ── Geometría ──
  const area_mm2      = +polygonArea(scaled).toFixed(2);
  const perimeter_mm  = +polygonPerimeter(scaled).toFixed(2);
  const orientation   = computeOrientation(scaled);
  const convexity     = +computeConvexity(scaled).toFixed(3);
  const concavity     = +(1 - convexity).toFixed(3);
  const mean_curvature = computeMeanCurvature(scaled);
  const complexity    = computeComplexity(scaled, mean_curvature, convexity);
  // Centroid: use pre-computed value from the vector engine (normalized), or derive from scaled points
  const derivedCentroid = region.centroid || centroid(pts).map((v, i) => v / (i === 0 ? designWidthMm : designHeightMm));
  const holes         = estimateHoles({ ...region, area_mm2, centroid: derivedCentroid }, allRegions);

  const skeletonMetrics = computeSkeletonMetrics(scaled, orientation);

  // ── Adaptive Engine — all parameters derived from geometry ──────────────────
  // Skip when useAdaptive=false (fast mode) and the region already has a stitch_type
  if (!useAdaptive && region.stitch_type) {
    const originalColor = region.color || region.hex || '#888888';
    const threadRec = recommendThread(originalColor);
    const stitch_count = region.stitch_count || estimateStitchCount(
      { stitch_type: region.stitch_type, area_mm2, perimeter_mm },
      region.density || 0.4
    );
    return {
      ...region,
      area_mm2, perimeter_mm, orientation, convexity, concavity,
      skeleton_length_mm: skeletonMetrics.skeleton_length_mm,
      mean_width_mm: skeletonMetrics.mean_width_mm,
      max_width_mm: skeletonMetrics.max_width_mm,
      min_width_mm: skeletonMetrics.min_width_mm,
      mean_curvature, holes, complexity,
      color: originalColor,
      recommended_thread: threadRec,
      stitch_count,
      estimatedTime: estimateTime(stitch_count),
      estimatedThread: estimateThread(stitch_count),
      priority: region.priority || 1,
      quality_score: 70,
      quality_issues: [],
      adaptive: false,
    };
  }

  const geoMetrics = {
    area_mm2,
    perimeter_mm,
    orientation,
    convexity,
    concavity,
    skeleton_length_mm: skeletonMetrics.skeleton_length_mm,
    mean_width_mm:      skeletonMetrics.mean_width_mm,
    max_width_mm:       skeletonMetrics.max_width_mm,
    min_width_mm:       skeletonMetrics.min_width_mm,
    mean_curvature,
    complexity,
    holes,
  };

  // Overrides: only explicit values from backend/user (never defaults)
  const overrides = {};
  if (region.stitch_type) overrides.stitch_type = region.stitch_type;
  // Use != null so that a 0 value is preserved (0 density is invalid, but 0 angle is valid)
  if (region.density != null && region.density > 0)            overrides.density           = region.density;
  if (region.pull_compensation != null && region.pull_compensation >= 0) overrides.pull_compensation = region.pull_compensation;
  if (region.angle != null)                                    overrides.angle             = region.angle;
  if (region.priority != null && region.priority > 0)          overrides.priority          = region.priority;

  const adapted = adaptRegion(geoMetrics, overrides, fabricType);

  const threadRec = recommendThread(region.color || '#888888');

  // ── Producción ──
  const stitch_count    = (region.stitch_count > 0)
    ? region.stitch_count
    : estimateStitchCount({ stitch_type: adapted.stitch_type, area_mm2, perimeter_mm }, adapted.density);
  const estimatedTime   = estimateTime(stitch_count);
  const estimatedThread = estimateThread(stitch_count);

  // ── Calidad ──
  const { quality_score, quality_issues } = computeQuality(
    { area_mm2, perimeter_mm, underlay_data: adapted.underlay },
    adapted.stitch_type, skeletonMetrics, convexity, complexity, holes, adapted.density
  );

  // Preserve original pixel color — never overwrite
  const originalColor = region.color || region.hex || '#888888';

  return {
    ...region,
    // Geometría
    area_mm2,
    perimeter_mm,
    orientation,
    convexity,
    concavity,
    skeleton_length_mm: skeletonMetrics.skeleton_length_mm,
    mean_width_mm:      skeletonMetrics.mean_width_mm,
    max_width_mm:       skeletonMetrics.max_width_mm,
    min_width_mm:       skeletonMetrics.min_width_mm,
    mean_curvature,
    holes,
    complexity,
    // Color — never overwritten
    color:               originalColor,
    recommended_thread:  threadRec,
    // Contour layer — preserved from contourEngineStage, never overwritten
    contour:             region.contour || null,
    contour_stitch_count: region.contour
      ? Math.round(perimeter_mm / (region.contour.contour_width_mm || 1.2))
      : 0,
    // Adaptive parameters (computed from geometry)
    stitch_type:         adapted.stitch_type,
    stitch_confidence:   adapted.stitch_confidence,
    stitch_rationale:    adapted.stitch_rationale,
    density:             adapted.density,
    stitch_length_mm:    adapted.stitch_length_mm,
    pull_compensation:   adapted.pull_compensation,
    recommended_underlay: adapted.underlay,
    underlay:            adapted.underlay.enabled,
    fill_angle:          adapted.fill_angle,
    angle:               adapted.fill_angle,
    priority:            adapted.priority,
    // Production
    stitch_count,
    estimatedTime,
    estimatedThread,
    quality_score,
    quality_issues,
    // Marker
    adaptive:            true,
  };
}

/**
 * Enriquece todas las regiones y asigna travelOrder (secuencia greedy por prioridad + proximidad).
 */
export function enrichAllRegions(regions, designWidthMm = 100, designHeightMm = 100, fabricType = 'Algodón', useAdaptive = true) {
  const enriched = regions.map(r => enrichRegion(r, regions, designWidthMm, designHeightMm, fabricType, useAdaptive));

  // EIE 2-opt optimized travel order: priority-grouped + nearest-neighbour + 2-opt improvement.
  // Ensures fills are drawn before satin outlines, and satin before running_stitch details.
  return eieOptimizeTravelOrder(enriched, fabricType);
}