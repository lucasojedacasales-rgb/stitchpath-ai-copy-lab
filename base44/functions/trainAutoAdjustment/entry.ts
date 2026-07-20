import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all digitization decisions to build a dataset
    const decisions = await base44.asServiceRole.entities.DigitizationDecision.list();
    if (!decisions || decisions.length < 2) {
      return Response.json({
        message: 'Not enough historical data yet (need 2+ decisions)',
        data_points: decisions?.length || 0,
      });
    }

    // === ANÁLISIS: Patrones en decisiones exitosas ===
    const patterns = analyzePatterns(decisions);
    const recommendations = generateAdaptiveRules(patterns);

    // === CREAR REGLAS DE AUTO-AJUSTE ===
    const autoAdjustmentRules = {
      design_type: {
        character_cartoon: {
          // Para personajes pequeños/medianos como Yoshi
          recommended_settings: {
            contour_engine: {
              minAreaPx: 60,
              minAreaRelative: 0.00015,
              maxColors: 8,
              cornerAngleDeg: 130,
              rdpBaseEpsilon: 1.2,
            },
            region_builder: {
              satin_compact_wide: 0.3,
              satin_compact_medium: 0.15,
              mean_width_min_wide: 4,
            },
            renderer: {
              canvas_background: '#4a4a4a',
              threadDiameter_mm: 0.32,
            },
          },
          triggers: [
            { condition: 'area_mm2 < 200', action: 'increase_max_colors_to_10' },
            { condition: 'tiny_regions > 5', action: 'decrease_minAreaPx_to_45' },
            { condition: 'detail_visibility == LOW', action: 'enable_sub_pixel_refinement' },
          ],
        },
        logo_text: {
          // Para logos/texto con líneas finas
          recommended_settings: {
            contour_engine: {
              minAreaPx: 100,
              minAreaRelative: 0.0002,
              maxColors: 6,
              cornerAngleDeg: 135,
              rdpBaseEpsilon: 0.8,
            },
          },
          triggers: [
            { condition: 'avg_compactness < 0.2', action: 'favor_satin_contour' },
            { condition: 'thin_regions > 50%', action: 'increase_rdp_tightness' },
          ],
        },
        photorealistic: {
          // Para fotos/realistas con muchos colores
          recommended_settings: {
            contour_engine: {
              minAreaPx: 150,
              minAreaRelative: 0.0005,
              maxColors: 16,
            },
          },
          triggers: [
            { condition: 'color_separation < GOOD', action: 'increase_max_colors' },
          ],
        },
      },

      // Reglas dinámicas basadas en métricas de calidad
      dynamic_rules: [
        {
          metric: 'detail_visibility',
          current: 'LOW',
          actions: [
            'decrease minAreaPx by 20%',
            'decrease minAreaRelative by 30%',
            'enable sub-pixel boundary refinement',
            'increase Chaikin smoothing passes from 3 to 4',
          ],
        },
        {
          metric: 'color_separation',
          current: 'POOR',
          actions: [
            'increase max_colors by 2 (but cap at 16)',
            'use Lab color space distance (already done)',
            'apply post-processing color merging threshold',
          ],
        },
        {
          metric: 'stitch_distribution',
          current: 'UNEVEN',
          actions: [
            'enable adaptive density scaling based on region area',
            'apply area-weighted density: smaller regions = tighter stitches',
          ],
        },
        {
          metric: 'overall_rating',
          current: '< 6',
          actions: [
            'Re-run full pipeline with enhanced parameters',
            'Manual refinement or AI semantic labeling review',
          ],
        },
      ],

      // Parameters that proved successful
      proven_optimal: {
        thread_rendering: {
          diameter_mm: 0.32,
          alpha: 1.0, // always full opacity for light colors
          line_cap: 'round',
          line_join: 'round',
        },
        contour_rendering: {
          no_clip_on_contours: true,
          perpendicular_satin_columns: true,
          running_stitch_open_path: true, // no closePath()
        },
        stitch_order: {
          pass_1: 'fill_regions (clipped)',
          pass_2: 'satin_fill (clipped)',
          pass_3: 'contour_regions (no clip)',
        },
        classification_logic: {
          satin_fill_condition: 'trueCompact > 0.3 AND mean_width_mm > 4',
          satin_medium_condition: 'trueCompact > 0.15 AND mean_width_mm > 3',
          satin_contour_condition: 'everything else (elongated, ring-shaped)',
        },
      },
    };

    // === SCORING FRAMEWORK ===
    const scoringFramework = {
      weighted_metrics: {
        detail_visibility: 0.25,
        color_separation: 0.25,
        layer_integrity: 0.25,
        stitch_distribution: 0.25,
      },
      quality_thresholds: {
        professional: { min: 8, targets: ['HIGH', 'EXCELLENT', 'PERFECT', 'BALANCED'] },
        acceptable: { min: 6, targets: ['MEDIUM', 'GOOD', 'ACCEPTABLE'] },
        needs_review: { min: 0, targets: ['LOW', 'POOR'] },
      },
    };

    // === GUARDAR CONFIGURACIÓN DE AUTO-AJUSTE ===
    const autoAdjustConfig = {
      timestamp: new Date().toISOString(),
      trained_on_decisions: decisions.length,
      auto_adjustment_rules: autoAdjustmentRules,
      scoring_framework: scoringFramework,
      recommendations_for_next_run: recommendations,
      
      // Instrucciones para los motores
      engine_instructions: {
        contour_engine: {
          apply_rule: 'Use dynamic_rules[0] logic when detail_visibility < HIGH',
          baseline: 'minAreaPx=60, minAreaRelative=0.00015, maxColors=8',
        },
        region_builder: {
          apply_rule: 'Use compactness-based classification (not max_width)',
          logic: 'trueCompact = 4π·area/perimeter² → determines satin type',
        },
        renderer: {
          apply_rule: '3-pass system: fill→satin_fill→contours (no clip on pass 3)',
          thread_alpha: 'Always 1.0 (full opacity) — prevents light color washout',
        },
      },
    };

    return Response.json({
      success: true,
      auto_adjustment_rules: autoAdjustmentRules,
      scoring_framework: scoringFramework,
      recommendations: recommendations,
      next_steps: [
        '1. Run analyzeDigitizationQuality on current project',
        '2. Compare results against scoring_framework thresholds',
        '3. If overall_rating < 8, apply dynamic_rules for the failing metric',
        '4. Re-process with updated parameters',
        '5. Iterate until professional (8+) rating achieved',
      ],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ─── Pattern Analysis ────────────────────────────────────────────────────────

function analyzePatterns(decisions) {
  return {
    avg_quality_rating: decisions.reduce((s, d) => s + (d.quality_assessment?.overall_rating || 0), 0) / decisions.length,
    successful_designs: decisions.filter(d => (d.quality_assessment?.overall_rating || 0) >= 8).length,
    common_parameters: extractCommonParameters(decisions),
    design_size_distribution: analyzeDesignSizes(decisions),
  };
}

function extractCommonParameters(decisions) {
  const successful = decisions.filter(d => (d.quality_assessment?.overall_rating || 0) >= 8);
  if (successful.length === 0) return {};

  return {
    avg_min_area_px: avg(successful.map(d => d.engine_decisions?.contour_engine?.min_area_px || 60)),
    avg_max_colors: avg(successful.map(d => d.engine_decisions?.contour_engine?.max_colors || 8)),
    satin_compact_threshold: avg(successful.map(d => d.engine_decisions?.region_builder?.satin_compact_wide || 0.3)),
    thread_diameter_mm: avg(successful.map(d => d.engine_decisions?.renderer?.thread_diameter_mm || 0.32)),
  };
}

function analyzeDesignSizes(decisions) {
  const w = decisions.map(d => d.design_dimensions_mm?.width || 100);
  const h = decisions.map(d => d.design_dimensions_mm?.height || 100);
  return {
    avg_width: avg(w),
    avg_height: avg(h),
    min_width: Math.min(...w),
    max_width: Math.max(...w),
  };
}

function generateAdaptiveRules(patterns) {
  return [
    {
      condition: 'design_area < 50mm²',
      action: 'Use character_cartoon preset (minAreaPx=60, maxColors=8)',
      reasoning: 'Small designs benefit from aggressive detail detection',
    },
    {
      condition: 'design_area > 500mm²',
      action: 'Use photorealistic preset (minAreaPx=150, maxColors=16)',
      reasoning: 'Large designs need more color resolution',
    },
    {
      condition: 'region_count < 20',
      action: 'Lower maxColors to 5-6 (fewer distinct regions possible)',
      reasoning: 'Prevent over-clustering with limited palette',
    },
    {
      condition: 'region_count > 60',
      action: 'Increase maxColors to 12-16 (more detail)',
      reasoning: 'More regions need more granular color separation',
    },
    {
      condition: 'tiny_regions (area<5mm²) > 10',
      action: 'Enable sub-pixel refinement + decrease minAreaPx to 45',
      reasoning: 'Design has fine details requiring precise boundary capture',
    },
  ];
}

function avg(arr) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}