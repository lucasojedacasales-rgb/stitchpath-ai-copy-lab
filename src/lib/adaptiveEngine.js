/**
 * adaptiveEngine.js — Thin adapter over the Embroidery Intelligence Engine (EIE)
 *
 * Legacy API surface preserved for backward compatibility with regionBuilder.js.
 * All computation now delegates to stitchIntelligence.js (EIE v2.0).
 *
 * New code should import from stitchIntelligence.js directly.
 */

import {
  eieAnalyzeRegion,
  eieStitchType,
  eieDensity,
  eieFillAngle,
  eiePullCompensation,
  eiePushCompensation,
  eieUnderlay,
  eiePriority,
  FABRIC_MODEL,
} from './stitchIntelligence.js';

// Re-export EIE constants for legacy consumers
export { FABRIC_MODEL };

// ─── Legacy shim functions (thin wrappers) ────────────────────────────────────

export function adaptStitchType(geo) {
  const r = eieStitchType(geo);
  return { type: r.stitch_type || r.type, confidence: r.confidence, rationale: r.rationale };
}

export function adaptDensity(geo, stitchType, fabricType = 'Algodón') {
  return eieDensity(geo, stitchType, fabricType).density_mm;
}

export function adaptStitchLength(geo, stitchType) {
  const { area_mm2, mean_curvature, complexity, convexity, mean_width_mm } = geo;
  if (stitchType === 'running_stitch') {
    const base = 2.5;
    const curvAdj = -Math.min(1.0, (mean_curvature || 0) * 0.8);
    return +Math.max(1.5, Math.min(4.0, base + curvAdj)).toFixed(2);
  }
  if (stitchType === 'satin') {
    return +Math.max(1.5, Math.min(8.0, (mean_width_mm || 4) * 1.05)).toFixed(2);
  }
  let len = 3.0;
  len -= (complexity?.score || 0) * 0.8;
  len -= Math.min(0.5, (mean_curvature || 0) * 0.4);
  if (area_mm2 < 20) len = Math.min(len, 2.0);
  else if (area_mm2 < 60) len = Math.min(len, 2.5);
  if (area_mm2 > 200 && (convexity || 0) > 0.80 && complexity?.level === 'simple') len = Math.max(len, 3.5);
  return +Math.max(1.5, Math.min(5.0, len)).toFixed(2);
}

export function adaptCompensation(geo, stitchType, fabricType = 'Algodón') {
  return eiePullCompensation(geo, stitchType, fabricType).compensation_mm;
}

export function adaptUnderlay(geo, stitchType, fabricType = 'Algodón') {
  const u = eieUnderlay(geo, stitchType, fabricType);
  return {
    enabled:     !!u.type,
    type:        u.type,
    density_mm:  u.density_mm,
    angle_deg:   u.angle_deg,
    rationale:   u.rationale,
  };
}

export function adaptDirection(geo, stitchType) {
  return eieFillAngle(geo).angle_deg;
}

export function adaptPriority(geo, stitchType, existingPriority = null) {
  return eiePriority(geo, stitchType, existingPriority).priority;
}

// ─── Master adapter (used by regionBuilder.js) ────────────────────────────────

export function adaptRegion(geo, overrides = {}, fabricType = 'Algodón') {
  const eie = eieAnalyzeRegion(geo, fabricType, {
    existingPriority: overrides.priority ?? null,
  }, overrides);

  const stitch_length_mm = adaptStitchLength(geo, eie.stitch_type);

  return {
    stitch_type:         eie.stitch_type,
    stitch_confidence:   eie.stitch_confidence,
    stitch_rationale:    eie.stitch_rationale,
    density:             eie.density_mm,
    stitch_length_mm,
    pull_compensation:   eie.pull_compensation_mm,
    push_compensation:   eie.push_compensation_mm,
    underlay: {
      enabled:     !!eie.underlay?.type,
      type:        eie.underlay?.type,
      density_mm:  eie.underlay?.density_mm,
      angle_deg:   eie.underlay?.angle_deg,
      rationale:   eie.underlay_rationale,
    },
    fill_angle:          eie.fill_angle,
    priority:            eie.priority,
    overall_confidence:  eie.overall_confidence,
    eie_version:         eie.eie_version,
    adaptive:            true,
  };
}