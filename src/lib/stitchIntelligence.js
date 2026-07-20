/**
 * Embroidery Intelligence Engine (EIE)
 * ─────────────────────────────────────────────────────────────────────────────
 * A professional-grade decision system that replicates — and extends — the
 * judgment of a senior embroidery digitizer.
 *
 * Based on:
 *  • Wilcom EmbroideryStudio reference parameters
 *  • StitchFast technical density/compensation guide
 *  • Barudan/Tajima machine spec sheets (DST/PES format limits)
 *  • Empirical data from professional digitizers (pull comp by fabric/width)
 *
 * Architecture:
 *  Each of the 8 decision functions is independent and returns a {value, rationale}
 *  pair so the UI can display full transparency into every decision made.
 *
 *  eieAnalyzeRegion(geo, fabric, context) → EIEResult
 *   ├── stitchType()         → 'fill' | 'satin' | 'running_stitch' | 'motif'
 *   ├── fillAngle()          → degrees [0, 180)
 *   ├── density()            → mm between rows [0.28–0.65]
 *   ├── pullCompensation()   → mm width expansion [0.0–0.8]
 *   ├── pushCompensation()   → mm length expansion [0.0–0.5]
 *   ├── underlay()           → { type, density_mm, angle_deg }
 *   ├── buildPriority()      → [1, 10] — layer stacking order
 *   └── travelScore()        → cost heuristic for TSP ordering
 *
 * All functions operate on normalised geometric descriptors (EIEGeo).
 * Physical units are in mm; the caller is responsible for mm conversion.
 */

// ─── Physical constants (40wt polyester thread, standard needle) ──────────────

const THREAD = {
  diameter_fill:    0.38,   // mm — effective diameter for fill spacing
  diameter_satin:   0.35,   // mm — effective diameter for satin spacing
  diameter_running: 0.25,   // mm — effective diameter for running stitch
  min_stitch_mm:    1.5,    // machine minimum stitch length
  max_stitch_mm:    12.7,   // Tajima spec maximum (0.5 inch)
  max_jump_mm:      12.0,   // max jump before forced trim
};

// ─── Fabric physics model (empirically calibrated) ────────────────────────────
// Each entry: { pull_factor, push_factor, density_adj, stabiliser_need }
// pull_factor : multiplier for lateral pull compensation (1.0 = cotton baseline)
// push_factor : multiplier for longitudinal push compensation
// density_adj : additive mm adjustment (negative = denser needed)
// stabiliser_need: 0 (minimal) → 3 (heavy) — advisory only

export const FABRIC_MODEL = {
  'Lycra':     { pull_factor: 2.20, push_factor: 1.80, density_adj: -0.07, stabiliser_need: 3 },
  'Mezcla':    { pull_factor: 1.35, push_factor: 1.20, density_adj: -0.03, stabiliser_need: 2 },
  'Algodón':   { pull_factor: 1.00, push_factor: 1.00, density_adj:  0.00, stabiliser_need: 1 },
  'Denim':     { pull_factor: 0.78, push_factor: 0.85, density_adj:  0.05, stabiliser_need: 1 },
  'Lino':      { pull_factor: 0.70, push_factor: 0.80, density_adj:  0.08, stabiliser_need: 2 },
  'Poliéster': { pull_factor: 0.55, push_factor: 0.65, density_adj:  0.02, stabiliser_need: 1 },
  'Seda':      { pull_factor: 0.40, push_factor: 0.50, density_adj:  0.10, stabiliser_need: 3 },
  'Otro':      { pull_factor: 1.20, push_factor: 1.10, density_adj:  0.00, stabiliser_need: 2 },
};

// ─── Stitch type thresholds (professional consensus) ─────────────────────────

const SATIN_WIDTH_MAX      = 8.0;   // mm — above this, satin puckers fabric
const SATIN_WIDTH_IDEAL    = 5.5;   // mm — sweet spot for highest quality
const FILL_AREA_MIN        = 12.0;  // mm² — smaller regions can't hold tatami reliably
const RUNNING_AREA_MAX     = 4.0;   // mm² — micro regions → running stitch only
const RUNNING_WIDTH_MAX    = 1.5;   // mm — hairlines → running stitch

// ─── 1. Stitch Type ───────────────────────────────────────────────────────────

/**
 * Multi-signal decision tree for stitch type.
 * Signals, in priority order:
 *   S1: Hairline / filiform → running_stitch
 *   S2: Micro area → running_stitch
 *   S3: Narrow + convex + not too long → satin
 *   S4: Very elongated thin strip → satin (border/stripe)
 *   S5: Default → fill (tatami)
 *
 * Returns { type, confidence, rationale, signals }
 */
export function eieStitchType(geo) {
  const { area_mm2, mean_width_mm, max_width_mm, skeleton_length_mm } = geo;

  // THICKNESS-BASED CLASSIFICATION — primary signal.
  // thickness = max_width_mm (max perpendicular width from skeleton slices).
  //   grosor < 2.5mm  → running_stitch (contorno fino)
  //   2.5mm ≤ grosor ≤ 12mm → satin (borde medio, relleno paralelo denso)
  //   grosor > 12mm   → fill (zona grande, tatami)
  const thickness = max_width_mm || mean_width_mm || 0;
  const elongation = skeleton_length_mm / Math.max(0.1, mean_width_mm);

  // Micro-area + thin → running stitch
  if (area_mm2 < 4 && thickness < 3) {
    return {
      type: 'running_stitch', confidence: 0.95,
      rationale: `Micro-área ${area_mm2.toFixed(1)}mm² + grosor ${thickness.toFixed(1)}mm: running stitch.`,
      signals: [{ id: 'micro_run', weight: 1.0, fired: true }],
    };
  }

  // Filamento extremo (muy alargado y fino) → running stitch
  if (thickness < 2.5 && elongation > 3) {
    return {
      type: 'running_stitch', confidence: 0.97,
      rationale: `Filamento ${thickness.toFixed(1)}mm × ${elongation.toFixed(0)}× elongación: running stitch.`,
      signals: [{ id: 'filament_run', weight: 1.0, fired: true }],
    };
  }

  if (thickness < 2.5) {
    return {
      type: 'running_stitch', confidence: 0.93,
      rationale: `Grosor ${thickness.toFixed(1)}mm < 2.5mm: contorno fino → running stitch.`,
      signals: [{ id: 'thin_run', weight: 1.0, fired: true }],
    };
  }

  if (thickness <= 12) {
    return {
      type: 'satin', confidence: 0.90,
      rationale: `Grosor ${thickness.toFixed(1)}mm (2.5–12mm): borde medio → satin stitch.`,
      signals: [{ id: 'medium_satin', weight: 1.0, fired: true }],
    };
  }

  return {
    type: 'fill', confidence: 0.92,
    rationale: `Grosor ${thickness.toFixed(1)}mm > 12mm: zona grande → fill tatami.`,
    signals: [{ id: 'wide_fill', weight: 1.0, fired: true }],
  };
}

// ─── 2. Fill Angle ────────────────────────────────────────────────────────────

/**
 * Computes optimal fill angle using 5 geometric signals:
 *   A1: PCA orientation (primary axis of mass distribution)
 *   A2: Perpendicular correction for highly elongated shapes
 *   A3: 45° bias for near-axis shapes (standard in the trade)
 *   A4: Curvature correction (diagonal bisects curvature better)
 *   A5: Context angle (neighbouring regions — visual harmony)
 *
 * Returns { angle_deg, rationale, signals }
 */
export function eieFillAngle(geo, context = {}) {
  const { orientation, skeleton_length_mm, mean_width_mm, mean_curvature, convexity } = geo;
  const elongation = skeleton_length_mm / Math.max(0.1, mean_width_mm);

  const signals = [];
  let angle = orientation;
  const decisions = [];

  // A1 — PCA baseline
  decisions.push(`A1: eje PCA = ${orientation}°`);
  signals.push({ id: 'A1_pca', angle: orientation, weight: 1.0 });

  // A2 — Perpendicular for elongated shapes
  if (elongation > 3.0) {
    angle = (orientation + 90) % 180;
    decisions.push(`A2: elongación=${elongation.toFixed(1)}× → perpendicular ${angle}°`);
    signals.push({ id: 'A2_elongated', angle, weight: 0.9 });
  }

  // A3 — 45° bias for near-horizontal/vertical & convex shapes
  // (parallel stitches along fabric grain cause "trampolining" artifacts)
  if ((angle < 25 || angle > 155) && convexity > 0.65) {
    angle = 45;
    decisions.push(`A3: eje casi horizontal/vertical → corrección 45°`);
    signals.push({ id: 'A3_axis_bias', angle: 45, weight: 0.8 });
  }

  // A4 — Curvature correction
  if (mean_curvature > 0.7) {
    const curveAdj = (mean_curvature > 1.2) ? 45 : 30;
    angle = (angle + curveAdj) % 180;
    decisions.push(`A4: curvatura alta (${mean_curvature.toFixed(2)}) → +${curveAdj}° → ${angle}°`);
    signals.push({ id: 'A4_curvature', angle, weight: 0.6 });
  }

  // A5 — Neighbour harmony (avoid jarring angle transitions between adjacent regions)
  if (context.neighbourAngle != null) {
    const diff = Math.abs(angle - context.neighbourAngle);
    if (diff > 70 && diff < 110) {
      // Snap to neighbour to avoid visual seam
      angle = context.neighbourAngle;
      decisions.push(`A5: armonía con vecino (${context.neighbourAngle}°) → ${angle}°`);
      signals.push({ id: 'A5_harmony', angle, weight: 0.5 });
    }
  }

  return {
    angle_deg: Math.round(angle),
    rationale: decisions.join(' → '),
    signals,
  };
}

// ─── 3. Density ───────────────────────────────────────────────────────────────

/**
 * Computes row spacing in mm.
 * Professional target ranges:
 *   Badges/patches : 0.28–0.34 (dense, full coverage)
 *   Standard logos : 0.38–0.45 (balanced)
 *   Lightweight    : 0.50–0.65 (airy, avoids puckering)
 *
 * Pull–density coupling: higher density → more pull → must be co-adjusted.
 * Returns { density_mm, rationale }
 */
export function eieDensity(geo, stitchType, fabricType = 'Algodón') {
  if (stitchType === 'running_stitch') return { density_mm: 0, rationale: 'Running stitch: densidad no aplica.' };

  const fabric = FABRIC_MODEL[fabricType] || FABRIC_MODEL['Algodón'];
  const { area_mm2, mean_width_mm, complexity, convexity, mean_curvature } = geo;
  const reasons = [];

  let d;

  if (stitchType === 'satin') {
    // Satin: base 0.40mm, scale by width and fabric
    d = 0.40;
    if (mean_width_mm < 2.5) { d = 0.30; reasons.push('satin estrecho → denso 0.30'); }
    else if (mean_width_mm < 4) { d = 0.35; reasons.push(`satin medio (${mean_width_mm.toFixed(1)}mm) → 0.35`); }
    else if (mean_width_mm > 6) { d = 0.48; reasons.push(`satin ancho (${mean_width_mm.toFixed(1)}mm) → 0.48`); }
    // Fabric correction
    d += fabric.density_adj * 0.6;
    reasons.push(`tejido ${fabricType}: Δ${(fabric.density_adj * 0.6).toFixed(3)}`);
  } else {
    // Fill (tatami) — 0.40mm minimum spacing (home machine stability, Caydo CE01).
    // Never denser than 0.40mm: tighter spacing bunches fabric + overflows stitch count.
    if (area_mm2 < 80) {
      d = 0.40; reasons.push(`fill pequeño (${area_mm2.toFixed(0)}mm²) → 0.40`);
    } else if (area_mm2 < 300) {
      d = 0.40; reasons.push(`fill estándar (${area_mm2.toFixed(0)}mm²) → 0.40`);
    } else {
      d = 0.42; reasons.push(`fill grande (${area_mm2.toFixed(0)}mm²) → 0.42`);
    }

    // Fabric correction only — complexity/convexity/curvature corrections removed
    // (they pushed spacing below 0.40mm, causing bunching + stitch overflow)
    d += fabric.density_adj;
    reasons.push(`tejido ${fabricType}: Δ${fabric.density_adj.toFixed(3)}`);

    // Hard floor: fill spacing never denser than 0.40mm
    d = Math.max(0.40, d);
  }

  const clamped = +Math.max(stitchType === 'fill' ? 0.40 : 0.28, Math.min(0.65, d)).toFixed(3);
  return { density_mm: clamped, rationale: reasons.join(', ') };
}

// ─── 4. Pull Compensation ─────────────────────────────────────────────────────

/**
 * Lateral (width) pull compensation in mm.
 * Formula calibrated against Wilcom reference values:
 *   cotton/satin 4mm wide → ~0.25mm
 *   lycra/satin 4mm wide  → ~0.55mm
 *   cotton/fill large     → ~0.20mm
 *
 * The pull–density coupling is applied here: denser fill → more pull.
 * Returns { compensation_mm, rationale }
 */
export function eiePullCompensation(geo, stitchType, fabricType = 'Algodón', density_mm = 0.40) {
  if (stitchType === 'running_stitch') return { compensation_mm: 0, rationale: 'Running stitch: sin pull comp.' };

  const fabric = FABRIC_MODEL[fabricType] || FABRIC_MODEL['Algodón'];
  const { mean_width_mm, area_mm2, skeleton_length_mm, complexity } = geo;
  const reasons = [];

  let comp;

  if (stitchType === 'satin') {
    // Wilcom reference: 0.15mm @ 2mm width, 0.35mm @ 8mm width (cotton baseline)
    // Linear interpolation between those anchor points
    const baseComp = 0.15 + ((mean_width_mm - 2) / 6) * 0.20;
    comp = Math.max(0.10, baseComp) * fabric.pull_factor;
    reasons.push(`base=${baseComp.toFixed(3)}mm × fabric_factor=${fabric.pull_factor} (${fabricType})`);

    // Density coupling: denser satin → more tension
    const densAdj = (0.40 - density_mm) * 0.4; // 0.40mm is neutral; denser = positive adj
    comp += densAdj;
    if (Math.abs(densAdj) > 0.01) reasons.push(`coupling densidad: ${densAdj > 0 ? '+' : ''}${densAdj.toFixed(3)}`);

    // Long columns push at ends → slight reduction in width comp
    if (skeleton_length_mm > 25) {
      comp -= 0.03;
      reasons.push('columna larga: -0.03 (efecto push longitudinal)');
    }
  } else {
    // Fill pull compensation: base from fabric, complexity and density adjusted
    const baseComp = 0.18 * fabric.pull_factor;
    comp = baseComp;
    reasons.push(`base_fill=${baseComp.toFixed(3)}mm (${fabricType})`);

    if (area_mm2 > 200)  { comp += 0.04; reasons.push('+0.04 área grande'); }
    if (area_mm2 > 500)  { comp += 0.03; reasons.push('+0.03 área muy grande'); }
    comp += complexity.score * 0.07;
    if (complexity.score > 0.1) reasons.push(`+complejidad=${complexity.score.toFixed(2)}→+${(complexity.score * 0.07).toFixed(3)}`);

    // Density coupling (fill)
    const densAdj = (0.40 - density_mm) * 0.30;
    comp += densAdj;
  }

  const clamped = +Math.max(0, Math.min(0.80, comp)).toFixed(3);
  return { compensation_mm: clamped, rationale: reasons.join(', ') };
}

// ─── 5. Push Compensation ─────────────────────────────────────────────────────

/**
 * Longitudinal (length) push compensation — unique to this engine.
 * Satin columns push outward at their ends proportional to their length.
 * Fill areas push along the fill direction.
 * Most digitizers ignore push compensation; we compute it explicitly.
 *
 * Returns { compensation_mm, rationale }
 */
export function eiePushCompensation(geo, stitchType, fabricType = 'Algodón') {
  if (stitchType === 'running_stitch') return { compensation_mm: 0, rationale: 'Running stitch: sin push comp.' };

  const fabric = FABRIC_MODEL[fabricType] || FABRIC_MODEL['Algodón'];
  const { skeleton_length_mm, mean_width_mm, area_mm2 } = geo;
  const reasons = [];

  let push = 0;

  if (stitchType === 'satin') {
    // Push scales with column length (more stitches = more cumulative push)
    // Reference: ~0.10mm per 10mm of satin length on cotton
    const basePush = (skeleton_length_mm / 100) * 0.08 * fabric.push_factor;
    push = Math.max(0.05, Math.min(0.40, basePush));
    reasons.push(`columna ${skeleton_length_mm.toFixed(0)}mm × push_factor=${fabric.push_factor} → ${basePush.toFixed(3)}mm`);
  } else if (stitchType === 'fill') {
    // Fill push: minor, mostly relevant for large areas along fill direction
    push = area_mm2 > 300 ? 0.05 * fabric.push_factor : 0.02 * fabric.push_factor;
    reasons.push(`fill ${area_mm2.toFixed(0)}mm² → ${push.toFixed(3)}mm (${fabricType})`);
  }

  return {
    compensation_mm: +push.toFixed(3),
    rationale: reasons.join(', ') || 'No aplica.',
  };
}

// ─── 6. Underlay ─────────────────────────────────────────────────────────────

/**
 * Professional underlay decision:
 *
 *   running_stitch → none
 *   satin <2.5mm  → centre_walk
 *   satin 2.5–5mm → centre_walk (standard)
 *   satin >5mm    → zigzag + centre_walk
 *   fill <12mm²   → none (too small)
 *   fill 12–40mm² → edge_walk
 *   fill 40–120mm²→ edge_walk + light zigzag
 *   fill >120mm²  → full zigzag underlay
 *   pile fabric   → full_coverage regardless
 *
 * Returns { type, density_mm, angle_deg, second_pass, rationale }
 */
export function eieUnderlay(geo, stitchType, fabricType = 'Algodón') {
  const { area_mm2, mean_width_mm, complexity } = geo;
  const reasons = [];

  const none = (r) => ({ type: null, density_mm: 0, angle_deg: 0, second_pass: false, rationale: r });

  if (stitchType === 'running_stitch') return none('Running stitch: sin underlay.');
  if (area_mm2 < 6) return none('Micro-área: underlay omitido.');

  const isPile = fabricType === 'Otro'; // Terry/fleece proxy

  if (stitchType === 'satin') {
    if (mean_width_mm < 2.5) {
      return {
        type: 'centre_walk', density_mm: 0, angle_deg: 0, second_pass: false,
        rationale: `Satin estrecho ${mean_width_mm.toFixed(1)}mm: centre walk.`,
      };
    }
    if (mean_width_mm > 5.0) {
      // Wide satin: zigzag + centre_walk (double pass for stability)
      const d = +(THREAD.diameter_fill * 1.6 + (mean_width_mm - 5) * 0.08).toFixed(2);
      return {
        type: 'zigzag_centre', density_mm: d, angle_deg: 90, second_pass: true,
        rationale: `Satin ancho ${mean_width_mm.toFixed(1)}mm: zigzag (${d}mm) + centre walk.`,
      };
    }
    return {
      type: 'centre_walk', density_mm: 0, angle_deg: 0, second_pass: false,
      rationale: `Satin ${mean_width_mm.toFixed(1)}mm: centre walk estándar.`,
    };
  }

  // Fill underlay
  if (isPile) {
    const d = +(THREAD.diameter_fill * 1.5).toFixed(2);
    return {
      type: 'full_coverage', density_mm: d, angle_deg: 45, second_pass: true,
      rationale: `Tejido de pelo: full coverage doble (${d}mm, 45°).`,
    };
  }

  if (area_mm2 < 12) return none(`Fill pequeño ${area_mm2.toFixed(0)}mm²: sin underlay.`);

  if (area_mm2 < 40) {
    return {
      type: 'edge_walk', density_mm: 0, angle_deg: 0, second_pass: false,
      rationale: `Fill pequeño ${area_mm2.toFixed(0)}mm²: edge walk perimetral.`,
    };
  }

  if (area_mm2 < 120) {
    const d = +(THREAD.diameter_fill * 2.0).toFixed(2);
    // Underlay angle: must be perpendicular to the ACTUAL fill angle (not orientation).
    // geo.fill_angle is the computed EIE fill angle; geo.orientation is the PCA axis.
    // The two differ when A2/A3/A4 corrections apply (elongated/curved shapes).
    // Running underlay parallel to top stitches provides zero stabilization — it must cross them.
    const topAngle = geo.fill_angle != null ? geo.fill_angle : (geo.orientation != null ? geo.orientation : 45);
    const underlayAngle = (topAngle + 90) % 180;
    return {
      type: 'edge_walk_zigzag', density_mm: d, angle_deg: underlayAngle, second_pass: false,
      rationale: `Fill medio ${area_mm2.toFixed(0)}mm²: edge walk + zigzag ${d}mm @ ${underlayAngle}° (perp. al ángulo de relleno ${topAngle}°).`,
    };
  }

  // Large fill: full zigzag underlay perpendicular to actual fill angle
  const d = +(THREAD.diameter_fill * 2.5).toFixed(2);
  const topAngle = geo.fill_angle != null ? geo.fill_angle : (geo.orientation != null ? geo.orientation : 45);
  const underlayAngle = (topAngle + 90) % 180;
  return {
    type: 'zigzag', density_mm: d, angle_deg: underlayAngle, second_pass: complexity.level === 'alta',
    rationale: `Fill grande ${area_mm2.toFixed(0)}mm²: zigzag ${d}mm @ ${underlayAngle}° (perp. al ángulo de relleno ${topAngle}°)${complexity.level === 'alta' ? ' doble pase' : ''}.`,
  };
}

// ─── 7. Build Priority ────────────────────────────────────────────────────────

/**
 * Determines embroidery build order [1–10].
 * Rule hierarchy (professional standard):
 *   1. Background fills (large areas) → priority 1–2
 *   2. Mid-ground fills               → priority 3–4
 *   3. Satin elements (wide)          → priority 5–6
 *   4. Detail fills & satin (narrow)  → priority 7
 *   5. Running outlines               → priority 8–9
 *   6. Running detail (eyes, etc.)    → priority 10
 *
 * Returns { priority, rationale }
 */
export function eiePriority(geo, stitchType, existingPriority = null) {
  if (existingPriority != null && existingPriority > 0) {
    return { priority: existingPriority, rationale: `Prioridad manual: ${existingPriority}.` };
  }

  const { area_mm2, mean_width_mm, complexity, holes } = geo;

  if (stitchType === 'running_stitch') {
    // Hairlines and micro details always last
    const p = holes > 0 ? 10 : (area_mm2 < 5 ? 10 : 9);
    return { priority: p, rationale: `Running stitch: prioridad alta (${p}) — detalle superior.` };
  }

  if (stitchType === 'satin') {
    if (mean_width_mm < 2.5) return { priority: 8, rationale: `Satin estrecho (${mean_width_mm.toFixed(1)}mm): detalle.` };
    return { priority: 6, rationale: `Satin (${mean_width_mm.toFixed(1)}mm): capa intermedia.` };
  }

  // Fill
  if (area_mm2 > 800) return { priority: 1, rationale: `Fill enorme (${area_mm2.toFixed(0)}mm²): fondo base.` };
  if (area_mm2 > 400) return { priority: 2, rationale: `Fill grande (${area_mm2.toFixed(0)}mm²): capa de fondo.` };
  if (area_mm2 > 150) return { priority: 3, rationale: `Fill mediano-grande (${area_mm2.toFixed(0)}mm²): capa secundaria.` };
  if (area_mm2 > 60)  return { priority: 4, rationale: `Fill mediano (${area_mm2.toFixed(0)}mm²): capa intermedia.` };
  if (area_mm2 > 20)  return { priority: 5, rationale: `Fill pequeño (${area_mm2.toFixed(0)}mm²): detalle fill.` };
  if (complexity.level === 'alta') return { priority: 7, rationale: `Fill complejo micro: detalle superior.` };
  return { priority: 6, rationale: `Fill micro (${area_mm2.toFixed(0)}mm²): capa superior.` };
}

// ─── 8. Travel Score ─────────────────────────────────────────────────────────

/**
 * Computes a cost heuristic for TSP-based travel ordering.
 * Lower score = prefer visiting earlier within same priority group.
 *
 * Cost factors:
 *   - Centroid distance from previous region (main signal)
 *   - Color change penalty (thread change = costly machine operation)
 *   - Jump length estimate (proportional to distance)
 *
 * Returns { score, factors }
 */
export function eieTravelScore(region, fromCentroid = [0.5, 0.5], prevColor = null) {
  const [rx, ry] = region.centroid || [0.5, 0.5];
  const [fx, fy] = fromCentroid;
  const distance = Math.hypot(rx - fx, ry - fy);

  // Color change: heavy penalty (machine stops, operator changes thread)
  const colorChangePenalty = (prevColor && prevColor !== region.color) ? 0.25 : 0;

  // Jump penalty: scales with distance (more thread waste, more trim marks)
  const jumpPenalty = Math.min(0.3, distance * 0.4);

  const score = distance + colorChangePenalty + jumpPenalty;

  return {
    score: +score.toFixed(4),
    factors: { distance: +distance.toFixed(4), colorChangePenalty, jumpPenalty: +jumpPenalty.toFixed(4) },
  };
}

// ─── Master Analysis ──────────────────────────────────────────────────────────

/**
 * eieAnalyzeRegion — full EIE analysis for one region.
 *
 * @param {object} geo          — geometric metrics from enrichRegion/contourEngine
 * @param {string} fabricType   — fabric type string
 * @param {object} context      — optional: { neighbourAngle, existingPriority, prevColor, fromCentroid }
 * @param {object} overrides    — explicit user overrides; override = respected as-is
 *
 * Returns EIEResult:
 * {
 *   stitch_type, stitch_confidence, stitch_rationale, stitch_signals,
 *   fill_angle, angle_rationale,
 *   density_mm, density_rationale,
 *   pull_compensation_mm, pull_rationale,
 *   push_compensation_mm, push_rationale,
 *   underlay, underlay_rationale,
 *   priority, priority_rationale,
 *   travel_score,
 *   overall_confidence,   ← weighted average confidence across all decisions
 *   eie_version: '2.0',
 * }
 */
export function eieAnalyzeRegion(geo, fabricType = 'Algodón', context = {}, overrides = {}) {
  // — Stitch type —
  // HARD RULE: thickness is the absolute authority for thin contours.
  // A contour < THIN_CONTOUR_THRESHOLD mm wide is ALWAYS running_stitch,
  // regardless of any AI/backend/vectorizer override. This prevents the
  // machine from attempting fill/satin on hairlines it cannot physically sew.
  const THIN_CONTOUR_THRESHOLD = 2.5; // mm — matches eieStitchType + clasificarPorGeometria
  const _thickness = geo.max_width_mm || geo.mean_width_mm || 0;
  let stitchResult, stitch_type, stitch_rationale, stitch_forced = false;
  if (_thickness > 0 && _thickness < THIN_CONTOUR_THRESHOLD) {
    stitchResult = eieStitchType(geo); // still compute for confidence/signals
    stitch_type  = 'running_stitch';
    stitch_rationale = `Contorno delgado ${_thickness.toFixed(1)}mm < ${THIN_CONTOUR_THRESHOLD}mm: puntada de corrido FORZADA (grosor = autoridad absoluta).`;
    stitch_forced = true;
  } else {
    stitchResult   = eieStitchType(geo);
    stitch_type    = overrides.stitch_type || stitchResult.type;
    stitch_rationale = stitchResult.rationale;
  }

  // — Fill angle —
  const angleResult  = eieFillAngle(geo, context);
  const fill_angle   = overrides.angle != null ? overrides.angle : angleResult.angle_deg;

  // — Density —
  const densResult   = eieDensity(geo, stitch_type, fabricType);
  const density_mm   = overrides.density != null ? overrides.density : densResult.density_mm;

  // — Pull compensation (uses density for coupling) —
  const pullResult   = eiePullCompensation(geo, stitch_type, fabricType, density_mm);
  const pull_comp    = overrides.pull_compensation != null ? overrides.pull_compensation : pullResult.compensation_mm;

  // — Push compensation —
  const pushResult   = eiePushCompensation(geo, stitch_type, fabricType);

  // — Underlay: pass fill_angle into geo so the underlay angle is perpendicular
  //   to the ACTUAL top stitch angle (not the raw PCA orientation, which diverges
  //   after A2/A3/A4 corrections for elongated/curved shapes).
  const geoWithAngle = { ...geo, fill_angle };
  const underlayResult = eieUnderlay(geoWithAngle, stitch_type, fabricType);

  // — Priority —
  const prioResult   = eiePriority(geo, stitch_type, context.existingPriority ?? null);
  const priority     = overrides.priority != null ? overrides.priority : prioResult.priority;

  // — Travel score —
  const travelResult = eieTravelScore(
    { centroid: geo.centroid, color: geo.color },
    context.fromCentroid,
    context.prevColor
  );

  // — Overall confidence: weighted avg of stitch confidence + density/comp certainty —
  const overall_confidence = +(stitchResult.confidence * 0.5 +
    (1 - Math.min(1, geo.complexity.score)) * 0.3 +
    (geo.convexity || 0) * 0.2).toFixed(3);

  return {
    // Stitch type
    stitch_type,
    stitch_confidence:   stitch_forced ? 1.0 : stitchResult.confidence,
    stitch_rationale,
    stitch_signals:      stitchResult.signals,
    stitch_forced,

    // Angle
    fill_angle,
    angle_rationale:     angleResult.rationale,

    // Density
    density_mm,
    density_rationale:   densResult.rationale,

    // Compensation
    pull_compensation_mm: pull_comp,
    pull_rationale:       pullResult.rationale,
    push_compensation_mm: pushResult.compensation_mm,
    push_rationale:       pushResult.rationale,

    // Underlay
    underlay:            underlayResult,
    underlay_rationale:  underlayResult.rationale,

    // Priority
    priority,
    priority_rationale:  prioResult.rationale,

    // Travel
    travel_score:        travelResult.score,
    travel_factors:      travelResult.factors,

    // Meta
    overall_confidence,
    eie_version:         '2.0',
  };
}

// ─── Batch optimizer — 2-opt travel path ─────────────────────────────────────

/**
 * Computes optimal sewing order for a set of enriched regions using:
 *   1. Sort by priority (base layers first)
 *   2. Within priority groups: greedy nearest-neighbour by EIE travel score
 *   3. 2-opt improvement to reduce total jump distance
 *
 * Returns regions with travelOrder and travel_score added.
 */
export function eieOptimizeTravelOrder(regions, fabricType = 'Algodón') {
  if (!regions || regions.length === 0) return [];

  // Group by priority
  const groups = {};
  for (const r of regions) {
    const p = r.priority || 5;
    if (!groups[p]) groups[p] = [];
    groups[p].push(r);
  }

  const sorted = [];
  let cx = 0.5, cy = 0.5, prevColor = null;

  for (const p of Object.keys(groups).map(Number).sort((a, b) => a - b)) {
    const group = groups[p];
    const visited = new Set();
    const ordered = [];

    while (ordered.length < group.length) {
      let best = null, bestScore = Infinity;
      for (const r of group) {
        if (visited.has(r.id)) continue;
        const ts = eieTravelScore(r, [cx, cy], prevColor);
        if (ts.score < bestScore) { bestScore = ts.score; best = r; }
      }
      if (!best) break;
      visited.add(best.id);
      const [rx, ry] = best.centroid || [0.5, 0.5];
      cx = rx; cy = ry;
      prevColor = best.color;
      ordered.push({ ...best, travel_score: bestScore });
    }

    // 2-opt improvement within priority group
    const improved = twoOpt(ordered);
    sorted.push(...improved);
  }

  return sorted.map((r, i) => ({ ...r, travelOrder: i + 1 }));
}

function twoOpt(route) {
  if (route.length < 4) return route;
  let improved = true;
  let best = [...route];

  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const d1 = routeDist(best, i - 1, i) + routeDist(best, j, (j + 1) % best.length);
        const d2 = routeDist(best, i - 1, j) + routeDist(best, i, (j + 1) % best.length);
        if (d2 < d1 - 0.001) {
          best = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
          improved = true;
        }
      }
    }
  }
  return best;
}

function routeDist(route, i, j) {
  const ri = route[i], rj = route[j];
  if (!ri || !rj) return 0;
  const [ax, ay] = ri.centroid || [0.5, 0.5];
  const [bx, by] = rj.centroid || [0.5, 0.5];
  return Math.hypot(ax - bx, ay - by);
}