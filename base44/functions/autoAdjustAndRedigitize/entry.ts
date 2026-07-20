import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Auto-Adjust and Re-Digitize
 * Reads quality analysis, identifies problems, adjusts parameters, and re-digitizes
 * Goal: iteratively improve from 8/10 → 10/10
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id } = await req.json();
    if (!project_id) return Response.json({ error: 'project_id required' }, { status: 400 });

    // Get project
    const project = await base44.entities.Project.get(project_id);
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    // Get latest analysis
    const decisions = await base44.asServiceRole.entities.DigitizationDecision.filter(
      { design_name: project.name },
      '-created_date',
      1
    );
    if (!decisions || decisions.length === 0) {
      return Response.json({ error: 'No analysis found — run analyzeDigitizationQuality first' }, { status: 400 });
    }
    
    const latestDecision = decisions[0];
    const { quality_assessment: qa } = latestDecision;
    const currentRating = qa?.overall_rating || 0;

    // If already 10/10, no changes needed
    if (currentRating >= 10) {
      return Response.json({
        success: true,
        message: 'Already at 10/10 — no adjustments needed',
        current_rating: currentRating,
        adjustments_applied: [],
      });
    }

    // Identify issues and determine which parameter to adjust
    const adjustments = [];
    const newConfig = { ...project.config };

    // === ISSUE 1: color_separation not EXCELLENT ===
    if (qa?.color_separation !== 'EXCELLENT' && !adjustments.some(a => a.param === 'max_colors')) {
      adjustments.push({
        param: 'max_colors',
        reason: `color_separation is ${qa?.color_separation}, not EXCELLENT`,
        old_value: project.config?.color_count || 8,
        new_value: Math.min(16, (project.config?.color_count || 8) + 2),
      });
      newConfig.color_count = adjustments[adjustments.length - 1].new_value;
    }

    // === ISSUE 2: stitch_distribution not BALANCED ===
    if (qa?.stitch_distribution !== 'BALANCED' && !adjustments.some(a => a.param === 'adaptive_density')) {
      adjustments.push({
        param: 'adaptive_density',
        reason: `stitch_distribution is ${qa?.stitch_distribution}, not BALANCED`,
        old_value: 'disabled',
        new_value: 'enabled',
      });
      newConfig.adaptive_density = true;
    }

    // === ISSUE 3: Micro-details and eyes not captured (always apply if rating < 9) ===
    if (currentRating < 9 && !adjustments.some(a => a.param === 'minAreaPx')) {
      adjustments.push({
        param: 'minAreaPx',
        reason: `Rating < 9 — lowering minAreaPx to capture eyes, noses, micro-details`,
        old_value: 60,
        new_value: 25, // very aggressive: 25px² ≈ 3-4mm detail at 1024px
      });
      newConfig.contour_min_area_px = 25;
      newConfig.contour_min_area_relative = 0.00007; // very permissive for micro
    }

    // === ISSUE 4: layer_integrity not PERFECT ===
    if (qa?.layer_integrity !== 'PERFECT') {
      adjustments.push({
        param: 'layer_integrity_fix',
        reason: `layer_integrity is ${qa?.layer_integrity}, must rebuild priorities`,
        old_value: 'auto-assign',
        new_value: 'explicit priority reset',
      });
      // This requires region rebuilding; signal to re-run pipeline
      newConfig.rebuild_priorities = true;
    }

    // If no issues found, already at target
    if (adjustments.length === 0) {
      return Response.json({
        success: true,
        message: 'All metrics at target levels',
        current_rating: currentRating,
        adjustments_applied: [],
      });
    }

    // Update project config with adjustments
    await base44.entities.Project.update(project_id, {
      config: newConfig,
      step: 2, // mark for re-processing
    });

    // Update project config with new parameters (step 2 = re-processing stage)
    // The user will manually trigger the pipeline re-run in the UI, or we can mark it for auto-reprocess
    await base44.entities.Project.update(project_id, {
      config: newConfig,
      step: 2,
      status: 'processing',
    });

    return Response.json({
      success: true,
      message: `Parámetros ajustados — proyecto marcado para re-procesamiento`,
      current_rating: currentRating,
      adjustments_applied: adjustments,
      next_step: 'El pipeline se re-ejecutará automáticamente con los nuevos parámetros',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});