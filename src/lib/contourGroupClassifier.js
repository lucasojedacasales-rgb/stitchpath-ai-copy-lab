/**
 * contourGroupClassifier.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Classifies regions into object_group + contour_policy.
 *
 * Two regions with the SAME object_group NEVER generate an internal contour
 * between them — their boundary is an internal_fill_boundary, not a visible
 * outline. This prevents the black line between two shades of pink on the body.
 *
 * object_group examples (Kirby):
 *   body, foot_left, foot_right, eye_left, eye_right, mouth, cheek_left, cheek_right
 *
 * contour_policy:
 *   outer_only           — only outer outline (feet)
 *   inner_detail         — inner outline only (eyes, mouth)
 *   no_contour_boundary  — no contour between same-group fills (body, cheeks)
 *   conditional          — depends on context
 */

// ─── Color helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  if (h.length < 6) return { r: 128, g: 128, b: 128 };
  return {
    r: parseInt(h.slice(0, 2), 16) || 128,
    g: parseInt(h.slice(2, 4), 16) || 128,
    b: parseInt(h.slice(4, 6), 16) || 128,
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = 0; s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hexToHsl(hex) {
  return rgbToHsl(hexToRgb(hex).r, hexToRgb(hex).g, hexToRgb(hex).b);
}

function isPinkHue(hex) {
  const hsl = hexToHsl(hex);
  return (hsl.h >= 300 || hsl.h <= 30) && hsl.s > 15;
}

function isRedHue(hex) {
  const hsl = hexToHsl(hex);
  return hsl.h <= 20 && hsl.s > 40;
}

function isDarkColor(hex) {
  return hexToHsl(hex).l < 40;
}

function isLightColor(hex) {
  return hexToHsl(hex).l > 70;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function computeBbox(pts) {
  if (!pts || pts.length === 0) return { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5, w: 0, h: 0 };
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

// ─── Region classification ────────────────────────────────────────────────────

/**
 * Classifies each region with object_group + contour_policy.
 * Returns a NEW array of enriched regions (original regions untouched).
 */
export function classifyRegionGroups(regions) {
  const enriched = regions.map(r => ({ ...r }));

  // ── Pre-scan: body base lightness from large pink regions ──
  // A small pink region DARKER than the body base is a SHADOW (→ body group),
  // not a foot. This prevents the false contour between light pink and dark pink.
  let bodyBaseLum = Infinity;
  for (const r of enriched) {
    const color = r.color || r.hex || '#888888';
    if (isPinkHue(color)) {
      const lum = hexToHsl(color).l;
      const bb = computeBbox(r.path_points || []);
      const isLarge = (r.area_mm2 || 0) > 500 || (bb.w * bb.h > 0.25);
      if (isLarge && lum < bodyBaseLum) bodyBaseLum = lum;
    }
  }
  const SHADOW_DELTA = 12;

  for (const r of enriched) {
    const name = (r.name || '').toLowerCase();
    const color = r.color || r.hex || '#888888';
    const bbox = computeBbox(r.path_points || []);
    const area = r.area_mm2 || 0;
    const isLarge = area > 500 || (bbox.w * bbox.h > 0.25);
    const isAtBottom = bbox.minY > 0.55;
    const isAtLeft = bbox.maxX < 0.5;

    if (name.includes('mouth') || name.includes('boca') || name.includes('labio')) {
      r.object_group = 'mouth';
      r.contour_policy = 'inner_detail';
    } else if (name.includes('eye') || name.includes('ojo') || name.includes('iris') || name.includes('pupil')) {
      r.object_group = isAtLeft ? 'eye_left' : 'eye_right';
      r.contour_policy = 'inner_detail';
    } else if (name.includes('cheek') || name.includes('mejilla') || name.includes('blush') || name.includes('rubor')) {
      r.object_group = isAtLeft ? 'cheek_left' : 'cheek_right';
      r.contour_policy = 'no_contour_boundary';
    } else if (name.includes('foot') || name.includes('pie') || name.includes('feet')) {
      r.object_group = isAtLeft ? 'foot_left' : 'foot_right';
      r.contour_policy = 'outer_only';
    } else if (name.includes('body') || name.includes('cuerpo') || name.includes('face') || name.includes('cara')) {
      r.object_group = 'body';
      r.contour_policy = 'no_contour_boundary';
    } else if (name.includes('shadow') || name.includes('sombra') || name.includes('shade')) {
      r.object_group = 'body';
      r.contour_policy = 'no_contour_boundary';
    } else {
      // Color-based fallback
      // Large pink → body regardless of position (prevents body shadow
      // being misclassified as foot, which caused the black arc between pinks)
      if (isPinkHue(color) && isLarge) {
        r.object_group = 'body';
        r.contour_policy = 'no_contour_boundary';
      } else if (isPinkHue(color) && !isLarge && isAtBottom) {
        // Distinguish foot (same lightness as body) from shadow (darker).
        // A dark-pink shadow at the bottom must stay in the body group, otherwise
        // a contour appears at the light-pink / dark-pink junction.
        const lum = hexToHsl(color).l;
        const isShadow = bodyBaseLum !== Infinity && lum < bodyBaseLum - SHADOW_DELTA;
        if (isShadow) {
          r.object_group = 'body';
          r.contour_policy = 'no_contour_boundary';
          console.log('[outline-grouping] dark-pink shadow reclassified → body (no contour)');
        } else {
          r.object_group = isAtLeft ? 'foot_left' : 'foot_right';
          r.contour_policy = 'outer_only';
        }
      } else if (isPinkHue(color) && !isLarge) {
        r.object_group = 'body';
        r.contour_policy = 'no_contour_boundary';
      } else if (isRedHue(color) && isAtBottom) {
        r.object_group = isAtLeft ? 'foot_left' : 'foot_right';
        r.contour_policy = 'outer_only';
      } else if (isDarkColor(color) && !isLarge) {
        r.object_group = isAtLeft ? 'eye_left' : 'eye_right';
        r.contour_policy = 'inner_detail';
      } else if (isLightColor(color) && !isLarge) {
        r.object_group = isAtLeft ? 'eye_left' : 'eye_right';
        r.contour_policy = 'inner_detail';
      } else {
        r.object_group = `other_${(r.id || 'x').toString().slice(-4)}`;
        r.contour_policy = 'conditional';
      }
    }
  }

  // Second pass: merge unclassified pink fills adjacent to body fills
  const bodyFills = enriched.filter(r => r.object_group === 'body');
  for (const r of enriched) {
    if (!r.object_group.startsWith('other_')) continue;
    if (!isPinkHue(r.color || r.hex)) continue;
    const bbox = computeBbox(r.path_points || []);
    const adjacent = bodyFills.some(bf => {
      const bb = computeBbox(bf.path_points || []);
      const xOv = Math.max(0, Math.min(bbox.maxX, bb.maxX) - Math.max(bbox.minX, bb.minX));
      return xOv > -0.05;
    });
    if (adjacent) {
      r.object_group = 'body';
      r.contour_policy = 'no_contour_boundary';
    }
  }

  // ── Mandatory logs ──
  for (const r of enriched) {
    console.log(`[outline-grouping] ${(r.name || r.id || '?').substring(0, 30)} -> object_group=${r.object_group} contour_policy=${r.contour_policy}`);
  }

  // Log same-group adjacencies
  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      const a = enriched[i], b = enriched[j];
      if (a.object_group !== b.object_group) continue;
      const ba = computeBbox(a.path_points || []);
      const bb = computeBbox(b.path_points || []);
      const xOv = Math.max(0, Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX));
      const yOv = Math.max(0, Math.min(ba.maxY, bb.maxY) - Math.max(ba.minY, bb.minY));
      const isAdjacent = (xOv > 0 && yOv > -0.05) || (yOv > 0 && xOv > -0.05);
      if (isAdjacent && a.contour_policy === 'no_contour_boundary') {
        console.log(`[outline-grouping] adjacent same-group boundary skipped: ${a.object_group} (${(a.name||a.id).substring(0,15)} / ${(b.name||b.id).substring(0,15)})`);
      }
    }
  }

  return enriched;
}

export function getRegionGroup(r) {
  return r?.object_group || null;
}

export function sameObjectGroup(a, b) {
  return !!(a?.object_group && b?.object_group && a.object_group === b.object_group);
}

// ─── Convex hull (Andrew's monotone chain) ────────────────────────────────────

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function convexHull(points) {
  const pts = points.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = pts.length;
  if (n < 3) return pts;

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Computes the union silhouette of a group of fills using convex hull.
 * Collects all path_points from all fills in the group → convex hull.
 */
export function unionSilhouette(fills) {
  const allPoints = [];
  for (const fill of fills) {
    for (const p of (fill.path_points || [])) allPoints.push([p[0], p[1]]);
  }
  if (allPoints.length < 3) return [];
  return convexHull(allPoints);
}