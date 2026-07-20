/**
 * stitchPlanner.js
 *
 * Motor de planificación estratégica de bordado.
 * Dado un conjunto de regiones analizadas, genera un plan completo:
 * - Secuencia óptima de capas
 * - Tipo de puntada por región (con justificación)
 * - Underlays recomendados
 * - Estimación de saltos de color
 * - Advertencias de producción
 * - Score de viabilidad
 */

import { computeStitchCount } from './stitchCount.js';

// ─── Constantes de decisión ───────────────────────────────────────────────────

const STITCH_RULES = {
  fill: {
    minAreaMm2: 30,
    maxPerimeterRatio: 0.08, // área/perímetro² — formas compactas
    needsUnderlay: true,
    typicalDensityMm: 0.4,
  },
  satin: {
    minAreaMm2: 2,
    maxAreaMm2: 200,
    maxWidthMm: 12,
    needsUnderlay: true,
    typicalDensityMm: 0.5,
  },
  running_stitch: {
    maxAreaMm2: 40,
    isContourType: true,
    needsUnderlay: false,
    typicalDensityMm: 1.5,
  },
};

const LAYER_ORDER = {
  underlay:        0,
  running_stitch:  1,
  satin:           2,
  fill:            3,
  detail:          4,
};

// ─── Region class → layer order (used when region_class is set) ───────────────
// Ensures embroidery order: fills → micro_fills → details → inner outlines → outer outline
const CLASS_LAYER_ORDER = {
  fill:              3,  // large fills first
  micro_fill:        4,  // small closed details after large fills
  detail_run:        5,  // mouth, facial lines — on top of fills
  detail_satin:      5,  // narrow satin details
  decorative_detail: 5,  // other preserved details
  inner_outline:     6,  // inner borders after details
  outer_outline:     7,  // outer silhouette last — maximum definition
};

// ─── Clasificador de región ───────────────────────────────────────────────────
// When the Adaptive Engine has already processed the region (region.adaptive === true),
// we trust its stitch_type, fill_angle, density, stitch_length_mm, and priority directly.
// This function is only called as a fallback for regions that bypassed the engine.

function classifyRegion(region) {
  // Adaptive Engine result — use it directly, no re-classification
  if (region.adaptive) {
    return {
      type:       region.stitch_type,
      reason:     region.stitch_rationale || 'Adaptive Engine classification.',
      confidence: region.stitch_confidence || 0.90,
    };
  }

  const area    = region.area_mm2    || 0;
  const perim   = region.perimeter_mm || 1;
  const compactness = (perim * perim) / Math.max(area, 0.1);
  const avgWidth = area / perim;
  const color   = (region.color || '').toLowerCase();
  const name    = (region.name  || '').toLowerCase();

  if (name.includes('contour') || color === '#000000' || color === '#1a1a1a') {
    return { type: 'running_stitch', reason: 'Contorno detectado — pespunte perimetral', confidence: 0.95 };
  }
  if (avgWidth < 4 && area < 150) {
    return { type: 'satin', reason: `Forma estrecha (ancho medio ${avgWidth.toFixed(1)} mm) — satén columnar`, confidence: 0.88 };
  }
  if (area < 8) {
    return { type: 'running_stitch', reason: 'Área mínima — pespunte simple', confidence: 0.85 };
  }
  if (area >= STITCH_RULES.fill.minAreaMm2 && compactness < 60) {
    return { type: 'fill', reason: `Zona amplia (${area.toFixed(0)} mm², compacidad ${compactness.toFixed(0)}) — relleno Tatami`, confidence: 0.92 };
  }
  if (area < 200 && avgWidth < 8) {
    return { type: 'satin', reason: `Forma de grosor medio (${avgWidth.toFixed(1)} mm) — satén`, confidence: 0.80 };
  }
  return { type: 'fill', reason: `Forma genérica — relleno Tatami por defecto`, confidence: 0.70 };
}

// ─── Ángulo óptimo ────────────────────────────────────────────────────────────
// Prefer fill_angle from the Adaptive Engine / contourTracer (PCA already computed).
// Only recompute PCA here as a last resort for regions without it.

function resolveAngle(region) {
  // Adaptive Engine or contourTracer already computed this — respect it
  if (region.fill_angle != null) return region.fill_angle;
  if (region.angle      != null) return region.angle;
  if (!region.path_points || region.path_points.length < 3) return 45;
  const pts = region.path_points;
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return Math.round(((angle * 180) / Math.PI + 180) % 180);
}

// ─── Underlay strategy ───────────────────────────────────────────────────────

function recommendUnderlay(region, stitchType) {
  const area  = region.area_mm2 || 0;
  const color = (region.color || '#ffffff').toLowerCase();
  const isLight = isLightColor(color);

  if (stitchType === 'running_stitch') return null;

  if (stitchType === 'satin') {
    return { type: 'center_run', density: 1.2, reason: 'Estabilización central para satén' };
  }

  if (area > 300 || isLight) {
    return {
      type: 'edge_run_plus_zigzag',
      density: 0.8,
      reason: isLight
        ? 'Color claro — doble underlay para cobertura máxima'
        : 'Zona grande — underlay perimetral + zigzag',
    };
  }

  return { type: 'edge_run', density: 1.0, reason: 'Underlay perimetral estándar' };
}

function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 180;
}

// ─── Secuenciación de color (min. saltos) ─────────────────────────────────────
// Layer-first ordering: fills before satins before running — within each layer,
// group by color to minimize thread changes. This preserves EIE travelOrder intent
// (fills are background, satins are midground, run is detail/outline).

function optimizeColorSequence(regionPlans) {
  // Sort by layer first (fill=3 < satin=2 < run=1), then by EIE travelOrder when available,
  // then group same-layer same-color together to minimize changes.
  const layerSorted = [...regionPlans].sort((a, b) => {
    // Use layerOrder from the plan (respects region_class when available)
    const la = a.layerOrder || LAYER_ORDER[a.stitchType] || 0;
    const lb = b.layerOrder || LAYER_ORDER[b.stitchType] || 0;
    if (la !== lb) return la - lb; // base layers first
    // Within same layer: group by color to minimize thread changes
    if (a.color !== b.color) return a.color.localeCompare(b.color);
    return 0;
  });

  // Count actual color changes in this sequence
  let colorChanges = 0;
  const uniqueColors = new Set(layerSorted.map(r => r.color)).size;
  for (let i = 1; i < layerSorted.length; i++) {
    if (layerSorted[i].color !== layerSorted[i - 1].color) colorChanges++;
  }

  return { sequenced: layerSorted, colorChanges, uniqueColors };
}

// ─── Advertencias de producción ───────────────────────────────────────────────

function generateWarnings(regions, regionPlans, config) {
  const warnings = [];

  // Demasiados colores
  const uniqueColors = new Set(regionPlans.map(r => r.color)).size;
  if (uniqueColors > 12) {
    warnings.push({ level: 'error', code: 'TOO_MANY_COLORS', message: `${uniqueColors} colores detectados. La mayoría de máquinas soportan ≤12. Reducir paleta.` });
  } else if (uniqueColors > 8) {
    warnings.push({ level: 'warn', code: 'HIGH_COLOR_COUNT', message: `${uniqueColors} colores. Considera reducir a ≤8 para mayor compatibilidad.` });
  }

  // Regiones muy pequeñas
  const tinyCount = regions.filter(r => (r.area_mm2 || 0) < 5).length;
  if (tinyCount > 0) {
    warnings.push({ level: 'warn', code: 'TINY_REGIONS', message: `${tinyCount} región(es) < 5mm². Pueden perderse en bordado físico.` });
  }

  // Alta densidad de puntadas
  const totalStitches = regionPlans.reduce((s, r) => s + (r.estimatedStitches || 0), 0);
  if (totalStitches > 50000) {
    warnings.push({ level: 'warn', code: 'HIGH_STITCH_COUNT', message: `~${Math.round(totalStitches / 1000)}k puntadas estimadas. Tiempo de bordado prolongado.` });
  }

  // Diseño muy pequeño con fill
  const fillSmall = regionPlans.filter(r => r.stitchType === 'fill' && (r.areaMm2 || 0) < 20).length;
  if (fillSmall > 0) {
    warnings.push({ level: 'info', code: 'FILL_SMALL_AREA', message: `${fillSmall} zona(s) con fill en áreas pequeñas (<20mm²). Considera running stitch.` });
  }

  // Saturación de satén
  const satinWide = regionPlans.filter(r => r.stitchType === 'satin' && (r.areaMm2 || 0) > 200).length;
  if (satinWide > 0) {
    warnings.push({ level: 'warn', code: 'SATIN_TOO_WIDE', message: `${satinWide} región(es) satin muy amplias. Riesgo de puntadas flojas. Cambiar a fill.` });
  }

  return warnings;
}

// ─── Score de viabilidad ──────────────────────────────────────────────────────

function computeViabilityScore(warnings, regionPlans, colorChanges) {
  let score = 100;
  for (const w of warnings) {
    if (w.level === 'error') score -= 25;
    else if (w.level === 'warn')  score -= 10;
    else score -= 2;
  }
  // Penalizar muchos cambios de color
  if (colorChanges > 8)  score -= 10;
  if (colorChanges > 12) score -= 10;

  // Penalizar si muchas regiones tienen baja confianza
  const lowConf = regionPlans.filter(r => r.confidence < 0.75).length;
  score -= Math.min(20, lowConf * 3);

  return Math.max(0, Math.min(100, score));
}

// ─── Estimación de tiempo de bordado ─────────────────────────────────────────

function estimateTime(totalStitches, colorChanges, speedSpm = 800) {
  const stitchMinutes = totalStitches / speedSpm;
  const colorMinutes  = colorChanges * 0.5; // 30s por cambio de color
  const totalMinutes  = stitchMinutes + colorMinutes;
  return {
    totalMinutes: +totalMinutes.toFixed(1),
    stitchMinutes: +stitchMinutes.toFixed(1),
    colorMinutes:  +colorMinutes.toFixed(1),
    formatted: totalMinutes < 1
      ? `<1 min`
      : totalMinutes < 60
      ? `${Math.round(totalMinutes)} min`
      : `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}min`,
  };
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Genera un plan estratégico completo de bordado.
 *
 * @param {Array}  regions  - regiones del proyecto
 * @param {object} config   - configuración del proyecto (width_mm, height_mm, fabric_type, etc.)
 * @returns {StitchPlan}
 */
export function generateStitchPlan(regions, config = {}) {
  const { width_mm = 100, height_mm = 100, fabric_type = 'Algodón' } = config;

  // 1. Clasificar y enriquecer cada región
  // When region.adaptive === true, the Adaptive Engine has already resolved
  // stitch_type, fill_angle, density, stitch_length_mm, pull_compensation, and underlay.
  // We consume those values directly and skip redundant re-computation.
  const regionPlans = regions
    .filter(r => r.path_points?.length >= 3)
    .map(region => {
      // When region_class is set (by regionClassifier.js), use it directly
      // for layer ordering instead of re-classifying by stitch type.
      const classification = region.region_class
        ? {
            type:       region.stitch_type,
            reason:     region.classification_reason || `Class: ${region.region_class}`,
            confidence: 0.95,
            class:      region.region_class,
          }
        : classifyRegion(region);

      // Angle: trust Adaptive Engine / contourTracer PCA, fallback to recompute
      const angle = resolveAngle(region);

      // Underlay: trust Adaptive Engine's recommended_underlay when available
      const underlay = region.recommended_underlay?.enabled
        ? region.recommended_underlay
        : recommendUnderlay(region, classification.type);

      // Density: use adaptive value, fallback to stitch rule default
      const density = region.density
        || STITCH_RULES[classification.type]?.typicalDensityMm
        || 0.4;

      // Stitch length: use adaptive value, fallback to sensible default per type
      const stitchLenMm = region.stitch_length_mm
        || (classification.type === 'satin' ? region.mean_width_mm || 3.0 : 3.0);

      // Estimate stitches — canonical physical model matching regionBuilder.js
      // Fill:   rows = area / (rowSpacing × stitchLength); stitchLength nominal 2.4mm
      // Satin:  columns = (perim/2) / density — each pass = one needle penetration
      // Run:    one stitch per 1.8mm of perimeter
      const area  = region.area_mm2     || 0;
      const perim = region.perimeter_mm || 1;
      let estimatedStitches = region.stitch_count || 0;
      if (!estimatedStitches) {
        estimatedStitches = computeStitchCount(
          { ...region, stitch_type: classification.type, area_mm2: area, perimeter_mm: perim, density },
          density
        );
      }

      // Layer order: prefer region_class mapping (new system) over stitch type
      const layerOrder = classification.class
        ? (CLASS_LAYER_ORDER[classification.class] || 3)
        : (LAYER_ORDER[classification.type] || 0);

      return {
        regionId:          region.id,
        regionName:        region.name,
        color:             region.color || '#000000',
        areaMm2:           area,
        stitchType:        classification.type,
        reason:            classification.reason,
        confidence:        classification.confidence,
        optimalAngle:      angle,
        density,
        stitchLenMm,
        pullCompensation:  region.pull_compensation || 0,
        underlay,
        estimatedStitches,
        layerOrder,
        adaptive:          region.adaptive || false,
      };
    });

  // 2. Optimizar secuencia de colores
  const { sequenced, colorChanges, uniqueColors } = optimizeColorSequence(regionPlans);

  // 3. Advertencias
  const warnings = generateWarnings(regions, regionPlans, config);

  // 4. Totales
  const totalStitches = regionPlans.reduce((s, r) => s + r.estimatedStitches, 0);

  // 5. Tiempo estimado
  const time = estimateTime(totalStitches, colorChanges);

  // 6. Viabilidad
  const viabilityScore = computeViabilityScore(warnings, regionPlans, colorChanges);

  // 7. Resumen de estrategia
  const fillCount    = regionPlans.filter(r => r.stitchType === 'fill').length;
  const satinCount   = regionPlans.filter(r => r.stitchType === 'satin').length;
  const runCount     = regionPlans.filter(r => r.stitchType === 'running_stitch').length;
  const withUnderlay = regionPlans.filter(r => r.underlay).length;

  return {
    // Plan secuenciado
    sequence: sequenced,

    // Resumen
    summary: {
      totalRegions:   regionPlans.length,
      uniqueColors,
      colorChanges,
      totalStitches,
      fillCount,
      satinCount,
      runCount,
      withUnderlay,
      viabilityScore,
      time,
      fabricType: fabric_type,
      designSizeMm: `${width_mm}×${height_mm}`,
    },

    // Advertencias
    warnings,

    // Recomendación narrativa
    narrative: buildNarrative({ fillCount, satinCount, runCount, uniqueColors, colorChanges, viabilityScore, time, warnings }),
  };
}

function buildNarrative({ fillCount, satinCount, runCount, uniqueColors, colorChanges, viabilityScore, time, warnings }) {
  const parts = [];

  if (fillCount > 0 && satinCount > 0) {
    parts.push(`Diseño mixto: ${fillCount} zonas de relleno Tatami y ${satinCount} zonas de satén.`);
  } else if (fillCount > 0) {
    parts.push(`Diseño dominado por relleno Tatami (${fillCount} zonas).`);
  } else if (satinCount > 0) {
    parts.push(`Diseño orientado a satén (${satinCount} zonas) — ideal para letras o formas estrechas.`);
  }

  if (runCount > 0) parts.push(`${runCount} contorno(s) en pespunte.`);
  parts.push(`${uniqueColors} color(es) · ${colorChanges} cambio(s) de hilo · tiempo estimado: ${time.formatted}.`);

  if (viabilityScore >= 85) parts.push('✓ Diseño viable para producción.');
  else if (viabilityScore >= 60) parts.push('⚠ Requiere ajustes antes de producción.');
  else parts.push('✗ Diseño con problemas significativos — revisar advertencias.');

  return parts.join(' ');
}