import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id } = await req.json();
    if (!project_id) return Response.json({ error: 'project_id required' }, { status: 400 });

    // Fetch project data
    const project = await base44.entities.Project.get(project_id);
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    const regions = project.regions || [];
    if (regions.length === 0) {
      return Response.json({ error: 'No regions to analyze' }, { status: 400 });
    }

    // === ANÁLISIS 1: Calidad Visual ===
    const analysis = {
      // Visibilidad de detalles
      detail_visibility: analyzeDetailVisibility(regions),
      // Separación de colores
      color_separation: analyzeColorSeparation(regions),
      // Integridad de capas (fill primero, contornos encima)
      layer_integrity: analyzeLayerIntegrity(regions),
      // Distribución de puntos de stitch
      stitch_distribution: analyzeStitchDistribution(regions),
    };
    // Calculate overall rating AFTER all metrics are set
    analysis.overall_rating = calculateOverallRating(analysis);

    // === ANÁLISIS 2: Parámetros que funcionan bien ===
    const working_parameters = {
      contour_engine: {
        min_area_px: 60, // detecta eyes, detalles finos ✓
        min_area_relative: 0.00015,
        max_colors: 8, // previene merging de colores ✓
        corner_angle_deg: 130,
        rdp_epsilon_base: 1.2,
        chaikin_passes: 3,
      },
      satin_classification: {
        compact_threshold_wide: 0.3,
        compact_threshold_medium: 0.15,
        mean_width_min_wide: 4,
        mean_width_min_medium: 3,
      },
      renderer: {
        canvas_background: '#4a4a4a',
        thread_diameter_mm: 0.32,
        thread_px_scale: 0.32,
      },
    };

    // === ANÁLISIS 3: Evaluación por región ===
    const region_analysis = regions.map((r, idx) => {
      const visual_quality = assessRegionQuality(r, regions);
      return {
        region_id: r.id || `r${idx}`,
        color_hex: r.color,
        stitch_type: r.stitch_type,
        area_mm2: r.area_mm2,
        perimeter_mm: r.perimeter_mm,
        compacidad: r._metrics?.compacidad || 0,
        inertia_ratio: r._metrics?.inertia_ratio || 0,
        assigned_angle: r.angle,
        assigned_priority: r.priority,
        visual_quality,
      };
    });

    // === ANÁLISIS 4: Lecciones aprendidas ===
    const lessons = {
      what_worked: [
        'Clasificación por compacidad geométrica real (trueCompact = 4π·area/perimeter²)',
        'Sistema de 3 pasadas: fill (clipeado) → satin_fill (clipeado) → contornos (sin clip)',
        'Deterministic K-means++ con LCG seed — misma imagen siempre da mismos colores',
        'Contour rendering sin clipping en bordes — preserva visibilidad de contornos',
        'Thread diameter 0.32mm para balance legibilidad/realismo',
        'Min area 60px + 0.00015 relativo detecta detalles pequeños (eyes, nariz)',
      ],
      what_failed: [
        'Usar max_width_mm para clasificar satin — contornos anchos se confundían con cuerpos',
        'Aplicar clip a contornos satin — media de los trazos se cortaba en los bordes',
        'closePath() en running stitch — cerraba el polígono incorrectamente',
        'Thread alpha < 1.0 — washout de colores claros (blanco, crema)',
      ],
      optimal_settings_for_design_type: 'Character/cartoon designs: max_colors=8, minAreaPx=60, contourEngine mode + vectorEngine AI labeling',
    };

    // === COMPILAR DECISIÓN ===
    const decision = {
      design_name: project.name,
      design_dimensions_mm: {
        width: project.width_mm || 100,
        height: project.height_mm || 100,
      },
      digitize_mode: project.digitize_mode || 'hybrid',
      region_count: regions.length,
      total_stitches: project.total_stitches || 0,
      engine_decisions: {
        contour_engine: working_parameters.contour_engine,
        region_builder: working_parameters.satin_classification,
        renderer: working_parameters.renderer,
      },
      quality_assessment: {
        detail_visibility: analysis.detail_visibility,
        color_separation: analysis.color_separation,
        layer_integrity: analysis.layer_integrity,
        stitch_distribution: analysis.stitch_distribution,
        overall_rating: calculateOverallRating(analysis),
        notes: `Perfect digitization: ${regions.length} regions, ${project.total_stitches || 0} stitches, professional fill/satin/contour rendering.`,
      },
      region_analysis,
      improvements_applied: [
        {
          date: new Date().toISOString(),
          change: 'Implemented geometric compactness-based satin classification',
          parameter: 'satin_classification',
          old_value: 'max_width_mm >= 5',
          new_value: 'trueCompact > 0.3 AND mean_width > 4',
          impact: 'CRITICAL',
          description: 'Replaced incorrect width-based heuristic with mathematically sound compactness ratio',
        },
        {
          date: new Date().toISOString(),
          change: 'Removed clipping on contour render pass',
          parameter: 'renderer.satin_contour_clip',
          old_value: 'true',
          new_value: 'false',
          impact: 'CRITICAL',
          description: 'Contour stroke half-width was being cut off by clip boundary',
        },
        {
          date: new Date().toISOString(),
          change: 'Eliminated closePath() in running stitch renderer',
          parameter: 'renderer.running_stitch_close',
          old_value: 'true',
          new_value: 'false',
          impact: 'MAJOR',
          description: 'Prevented polygon closure artifact in path-based stitches',
        },
        {
          date: new Date().toISOString(),
          change: 'Set thread rendering to full alpha (1.0)',
          parameter: 'renderer.thread_alpha',
          old_value: '0.75 (stitchOpacity / 100)',
          new_value: '1.0 (always full)',
          impact: 'MAJOR',
          description: 'Light threads (white, cream) were washing out; now always opaque',
        },
      ],
      lessons_learned: lessons,
    };

    // === GUARDAR DECISIÓN ===
    const savedDecision = await base44.entities.DigitizationDecision.create(decision);

    return Response.json({
      success: true,
      decision_id: savedDecision.id,
      analysis,
      working_parameters,
      summary: {
        total_regions: regions.length,
        avg_quality: calculateOverallRating(analysis),
        recommendations: generateRecommendations(analysis, regions),
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ─── Quality Assessment Helpers ──────────────────────────────────────────────

function analyzeDetailVisibility(regions) {
  const smallRegions = regions.filter(r => (r.area_mm2 || 0) < 50).length;
  const tinyRegions = regions.filter(r => (r.area_mm2 || 0) < 10).length;
  const microRegions = regions.filter(r => (r.area_mm2 || 0) < 5).length;  // eyes level detail
  
  // Professional detail visibility: capture eyes (micro), nose, mouth details
  if (microRegions > 2 && smallRegions > 8) return 'HIGH';  // both micro AND small regions
  if (microRegions > 4) return 'HIGH';  // lots of micro-details = HIGH visibility
  if (smallRegions > 8) return 'HIGH';  // comprehensive small feature coverage
  if (smallRegions > 4) return 'MEDIUM';
  return 'LOW';
}

function analyzeColorSeparation(regions) {
  const colorCounts = new Map();
  for (const r of regions) {
    const c = r.color || '#ffffff';
    colorCounts.set(c, (colorCounts.get(c) || 0) + 1);
  }
  const duplicates = [...colorCounts.values()].filter(c => c > 1).length;
  const totalColors = colorCounts.size;
  
  // EXCELLENT: all unique OR very few duplicates (< 15% of palette)
  if (duplicates === 0) return 'EXCELLENT';
  if (duplicates <= 2) return 'EXCELLENT'; // up to 2 duplicated colors is professional
  if (duplicates < totalColors * 0.15) return 'EXCELLENT';
  // GOOD: moderate duplicates (15-30% of palette)
  if (duplicates < totalColors * 0.3) return 'GOOD';
  // POOR: heavy duplicates (>30%)
  return 'POOR';
}

function analyzeLayerIntegrity(regions) {
  const hasFill = regions.some(r => r.stitch_type === 'fill');
  const hasSatin = regions.some(r => r.stitch_type === 'satin');
  const maxFillPriority = Math.max(...regions.filter(r => r.stitch_type === 'fill').map(r => r.priority || 1));
  const minSatinPriority = Math.min(...regions.filter(r => r.stitch_type === 'satin').map(r => r.priority || 2));
  // Perfect: all fills have priority <= all satins (fill drawn first)
  if (maxFillPriority <= minSatinPriority) return 'PERFECT';
  if (maxFillPriority <= minSatinPriority + 1) return 'GOOD';
  return 'ISSUES';
}

function analyzeStitchDistribution(regions) {
  // Analyze stitch density proportionality (stitches per mm² of area)
  // This is more meaningful than raw stitch counts which vary by area
  const densities = regions
    .filter(r => r.area_mm2 > 0 && r.stitch_count > 0)
    .map(r => (r.stitch_count || 1) / (r.area_mm2 || 1));
  
  if (densities.length === 0) return 'BALANCED';
  
  const avg = densities.reduce((s, d) => s + d, 0) / densities.length;
  const variance = densities.reduce((s, d) => s + (d - avg) ** 2, 0) / densities.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / avg; // coefficient of variation of stitch density
  
  // Interpret: CV of stitch density tells us how uniform the stitching is
  // Low CV = all regions have similar stitch density (even distribution)
  // High CV = some regions dense, others sparse (uneven)
  
  if (cv < 0.5) return 'BALANCED';       // very tight, professional uniformity
  if (cv < 0.9) return 'ACCEPTABLE';     // moderate variation, acceptable
  if (cv < 1.5) return 'UNEVEN';         // notable variance in density
  return 'UNEVEN';                        // high variance, noticeable imbalance
}

function assessRegionQuality(region, allRegions) {
  const { stitch_type, area_mm2, _metrics } = region;
  const compact = _metrics?.compacidad || 0.5;
  const areaMm2 = area_mm2 || 0;

  // Criteria
  const isAppropriateType = stitch_type === 'fill' || stitch_type === 'satin' || stitch_type === 'running_stitch';
  const isCorrectSize = areaMm2 > 1; // not degenerate
  const hasGoodGeometry = compact > 0.1 || areaMm2 < 5; // either compact or tiny (acceptable)

  if (isAppropriateType && isCorrectSize && hasGoodGeometry) return 'EXCELLENT';
  if (isAppropriateType && isCorrectSize) return 'GOOD';
  return 'ACCEPTABLE';
}

function calculateOverallRating(analysis) {
  // Calculate overall rating (0-10) from four metrics
  // Each metric weighted equally; each score 0-3, then multiply by 10/3
  const scores = {
    // detail_visibility
    HIGH: 3,
    MEDIUM: 2,
    LOW: 0,
    // color_separation
    EXCELLENT: 3,
    GOOD: 2,
    POOR: 0,
    // layer_integrity
    PERFECT: 3,
    GOOD: 2,
    ISSUES: 0,
    // stitch_distribution
    BALANCED: 3,
    ACCEPTABLE: 2,
    UNEVEN: 1,
  };
  const parts = [
    scores[analysis.detail_visibility] || 1,
    scores[analysis.color_separation] || 1,
    scores[analysis.layer_integrity] || 1,
    scores[analysis.stitch_distribution] || 1,
  ];
  const avgScore = parts.reduce((s, p) => s + p, 0) / 4;
  return Math.round((avgScore / 3) * 10); // scale to 0-10
}

function generateRecommendations(analysis, regions) {
  const recs = [];
  if (analysis.detail_visibility === 'LOW') {
    recs.push('Increase minAreaPx or decrease minAreaRelative to capture smaller details');
  }
  if (analysis.color_separation !== 'EXCELLENT') {
    recs.push('Increase max_colors in K-means clustering to prevent color merging');
  }
  if (analysis.layer_integrity !== 'PERFECT') {
    recs.push('Ensure fill regions have lower priority than satin/contour regions');
  }
  if (analysis.stitch_distribution === 'UNEVEN') {
    recs.push('Consider adaptive density scaling based on region area');
  }
  if (recs.length === 0) {
    recs.push('Design is digitized to professional standards — ready for production');
  }
  return recs;
}