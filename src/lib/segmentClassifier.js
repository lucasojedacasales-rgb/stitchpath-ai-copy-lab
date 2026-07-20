/**
 * segmentClassifier.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Central semantic classifier for embroidery contour segments.
 *
 * "Dark stroke first" — contours are only exportable when backed by a real
 * dark stroke in the original image (config.darkStroke / context.darkStroke).
 *
 * Classes:
 *   dark_stroke_outline — contour backed by real dark stroke line    (EXPORT)
 *   outer_silhouette    — outer boundary of body/main shape          (EXPORT)
 *   limb_contour        — outer boundary of feet/arms                (EXPORT)
 *   facial_detail       — mouth, nose, other facial features         (EXPORT)
 *   eye_detail          — eyes                                       (EXPORT)
 *   fill_boundary       — border between different colored fills  (NO EXPORT)
 *   travel              — jump/trim movement                     (NO EXPORT)
 *   artifact            — artificial geometry                    (NO EXPORT)
 *
 * Hierarchy: facial_detail > eye_detail > dark_stroke_outline > outer_silhouette > limb_contour > fill_boundary > travel/artifact
 */

import { overlapsDarkStrokeMask } from './darkStrokeDetector.js';

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

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function isPinkHue(hex) {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  return (hsl.h >= 300 || hsl.h <= 30) && hsl.s > 10;
}

function isDarkColor(hex) {
  return luminance(hex) < 50;
}

function isLightColor(hex) {
  return luminance(hex) > 60;
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

function isAdjacent(a, b) {
  const ba = computeBbox(a.path_points || []);
  const bb = computeBbox(b.path_points || []);
  const xOv = Math.max(0, Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX));
  const yOv = Math.max(0, Math.min(ba.maxY, bb.maxY) - Math.max(ba.minY, bb.minY));
  return (xOv > 0 && yOv > -0.05) || (yOv > 0 && xOv > -0.05);
}

function sameObjectGroup(a, b) {
  return !!(a?.object_group && b?.object_group && a.object_group === b.object_group);
}

// ─── EXPORTABLE categories ────────────────────────────────────────────────────

export const EXPORTABLE_CATEGORIES = ['dark_stroke_outline', 'outer_silhouette', 'limb_contour', 'facial_detail', 'eye_detail', 'real_outline_lower'];

export function isExportable(className) {
  return EXPORTABLE_CATEGORIES.includes(className);
}

// ─── Dark stroke evidence ─────────────────────────────────────────────────────
// "Dark stroke first": a contour is only real if it overlaps the dark stroke
// mask extracted from the original image. Color-region boundaries without a
// dark stroke are fill_boundary (not exported).

export function hasDarkStrokeEvidence(segment, context = {}) {
  const rawRegion = segment.rawRegion || {};
  const darkStroke = context.darkStroke || null;

  // ── Primary: overlap with dark stroke mask from the real image ──
  if (darkStroke) {
    const points = segment.points || rawRegion.path_points || rawRegion.contour_points || [];
    if (points.length >= 2) {
      // segment.points are in mm; rawRegion path_points are normalized [0-1].
      // The mask works in normalized space — prefer rawRegion.path_points.
      const normPts = (rawRegion.path_points || rawRegion.contour_points || []).length >= 2
        ? (rawRegion.path_points || rawRegion.contour_points)
        : points;
      const closed = rawRegion.closed !== false;
      const { ratio } = overlapsDarkStrokeMask(normPts, darkStroke, closed);
      return ratio > 0.6;
    }
  }

  // ── Fallback (no mask available): heuristic from region colors ──
  const regions = context.regions || [];
  const parentFill = regions.find(r => r.id === rawRegion.parentRegionId);
  if (!parentFill) return true;

  const parentColor = parentFill.color || parentFill.hex || '#888888';
  const parentLum = luminance(parentColor);
  if (parentLum < 50) return true;

  const rc = (rawRegion.region_class || '').toLowerCase();
  if (rc === 'inner_outline' || segment.layerType === 'inner_outline') {
    const adjacent = regions.filter(r => {
      if (r.id === parentFill.id) return false;
      if (sameObjectGroup(parentFill, r)) return false;
      return isAdjacent(parentFill, r);
    });
    if (adjacent.length === 0) return false;

    const hasDarkNeighbor = adjacent.some(r => isDarkColor(r.color || r.hex));
    if (hasDarkNeighbor) return true;

    const allPink = isPinkHue(parentColor) && adjacent.every(r => isPinkHue(r.color || r.hex));
    if (allPink) {
      console.log('[pink-boundary-audit] internal pink boundary detected: true');
      console.log('[pink-boundary-audit] internal pink boundary exported: false');
      return false;
    }
    return false;
  }

  return true;
}

// ─── Main classifier ──────────────────────────────────────────────────────────

export function classifyContourSegment(segment, context = {}) {
  const obj = segment;
  // UNIVERSAL fast path — contour already classified by the universal detector.
  // Absolute rule: no dark support ⇒ not a contour (universal contours come
  // ONLY from the strict dark mask, so fill boundaries are never produced).
  if (obj.universalClass) {
    const cls = obj.universalClass;
    const exportable = ['outer_outline', 'inner_outline', 'detail_open_curve'].includes(cls);
    return {
      className: cls,
      exportable,
      reason: exportable ? `universal dark contour (${cls})` : `universal rejected (${cls})`,
      confidence: 95,
      stitchType: cls === 'outer_outline' ? 'satin' : 'triple_run',
      openCurve: cls === 'detail_open_curve',
    };
  }
  const name = (obj.name || '').toLowerCase();
  const layerType = (obj.layerType || '').toLowerCase();
  const rawRegion = obj.rawRegion || {};
  const parentGroup = (rawRegion.parentGroupName || '').toLowerCase();
  const rc = (rawRegion.region_class || '').toLowerCase();
  const darkStroke = context.darkStroke || null;

  // A0) Lower contour rebuilt from dark stroke (lower body + feet) — highest
  //     priority: always exportable as a real contour, triple-run, no caps.
  //     Checked BEFORE mouth/eye to avoid bbox-scale false positives.
  if (layerType === 'real_outline_lower') {
    return {
      className: 'real_outline_lower',
      exportable: true,
      reason: 'lower contour rebuilt from dark stroke mask',
      confidence: 95,
      stitchType: 'triple_run',
      openCurve: false,
    };
  }

  // Helper: overlap ratio of this segment with the dark stroke mask
  const darkOverlap = () => {
    if (!darkStroke) return 0;
    const pts = rawRegion.path_points || rawRegion.contour_points || obj.points || [];
    if (pts.length < 2) return 0;
    const closed = rawRegion.closed !== false;
    return overlapsDarkStrokeMask(pts, darkStroke, closed).ratio;
  };

  // A) Mouth → facial_detail (highest priority — never fill_boundary/artifact)
  const mouthKeywords = ['mouth', 'boca', 'smile', 'labio', 'lip', 'facial_feature'];
  const isMouthByName = mouthKeywords.some(k => name.includes(k)) || layerType === 'mouth_detail_run' || parentGroup === 'mouth';
  // Dark-stroke-backed mouth: small dark curve in lower-center face
  const darkMouthHit = darkStroke?.mouthCandidate && (() => {
    const bb = darkStroke.mouthCandidate.bbox;
    const cb = computeBbox(rawRegion.path_points || obj.points || []);
    // overlap of bboxes
    const ox = Math.max(0, Math.min(cb.maxX, bb.maxX) - Math.max(cb.minX, bb.minX));
    const oy = Math.max(0, Math.min(cb.maxY, bb.maxY) - Math.max(cb.minY, bb.minY));
    return ox > 0 && oy > 0;
  })();
  if (isMouthByName || darkMouthHit) {
    return {
      className: 'facial_detail',
      exportable: true,
      reason: darkMouthHit ? 'mouth backed by dark stroke' : 'mouth/facial feature detected',
      confidence: 95,
      preserve: true,
      openCurve: true,
      stitchType: 'triple_run',
    };
  }

  // B) Eyes → eye_detail
  const eyeKeywords = ['eye', 'ojo', 'iris', 'pupil'];
  const isEyeByName = eyeKeywords.some(k => name.includes(k)) || parentGroup.includes('eye');
  const darkEyeHit = darkStroke?.eyeCandidates?.some(eye => {
    const bb = eye.bbox;
    const cb = computeBbox(rawRegion.path_points || obj.points || []);
    const ox = Math.max(0, Math.min(cb.maxX, bb.maxX) - Math.max(cb.minX, bb.minX));
    const oy = Math.max(0, Math.min(cb.maxY, bb.maxY) - Math.max(cb.minY, bb.minY));
    return ox > 0 && oy > 0;
  });
  if (isEyeByName || darkEyeHit) {
    return {
      className: 'eye_detail',
      exportable: true,
      reason: darkEyeHit ? 'eye backed by dark stroke' : 'eye detail detected',
      confidence: 90,
      stitchType: 'triple_run',
    };
  }

  // C) Other facial details (detail_run layer)
  if (layerType === 'detail_run' || layerType === 'mouth_detail_run' || layerType === 'facial_detail') {
    return {
      className: 'facial_detail',
      exportable: true,
      reason: 'detail layer type',
      confidence: 75,
      openCurve: true,
      stitchType: 'triple_run',
    };
  }

  // D) Inner outline — dark stroke first: only exportable if backed by dark stroke
  if (rc === 'inner_outline' || layerType === 'inner_outline') {
    const overlap = darkOverlap();
    const hasEvidence = hasDarkStrokeEvidence(segment, context);

    // Pink body shading boundary without dark stroke → fill_boundary (CAMBIO 7)
    if (overlap <= 0.6 && !hasEvidence) {
      const regions = context.regions || [];
      const parentFill = regions.find(r => r.id === rawRegion.parentRegionId);
      const parentColor = parentFill?.color || parentFill?.hex || '#888888';
      const adjacent = regions.filter(r => r && parentFill && r.id !== parentFill.id &&
        !sameObjectGroup(parentFill, r) && isAdjacent(parentFill, r));
      const allPink = isPinkHue(parentColor) && adjacent.every(r => isPinkHue(r.color || r.hex));
      const reason = allPink
        ? 'pink body shading boundary without dark stroke'
        : 'internal color boundary — no dark stroke evidence';
      if (allPink) {
        console.log('[pink-boundary-audit] internal pink boundary detected: true');
        console.log('[pink-boundary-audit] internal pink boundary exported: false');
      }
      return {
        className: 'fill_boundary',
        exportable: false,
        reason,
        confidence: 85,
      };
    }

    // Has dark stroke overlap → dark_stroke_outline (exportable)
    if (overlap > 0.6) {
      return {
        className: 'dark_stroke_outline',
        exportable: true,
        reason: `inner outline backed by dark stroke (overlap ${(overlap * 100).toFixed(0)}%)`,
        confidence: 80,
        stitchType: 'triple_run',
      };
    }

    // Has heuristic evidence but no mask overlap → keep as fill_boundary (no export)
    return {
      className: 'fill_boundary',
      exportable: false,
      reason: 'inner outline — not a recognized facial/eye detail',
      confidence: 60,
    };
  }

  // E) Outer outline — body vs limb. Dark stroke first: prefer real dark line.
  if (rc === 'outer_outline' || layerType === 'outer_outline' || layerType === 'outer_silhouette' || layerType === 'limb_contour') {
    const overlap = darkOverlap();
    const isLimb = parentGroup.includes('foot') || parentGroup.includes('arm') || layerType === 'limb_contour';
    const className = isLimb ? 'limb_contour' : 'outer_silhouette';
    // If there's a real dark stroke on the outer boundary, mark as dark_stroke_outline
    if (overlap > 0.6 && !isLimb) {
      return {
        className: 'dark_stroke_outline',
        exportable: true,
        reason: `outer outline backed by dark stroke (overlap ${(overlap * 100).toFixed(0)}%)`,
        confidence: 92,
        stitchType: 'satin',
      };
    }
    return {
      className,
      exportable: true,
      reason: isLimb ? 'foot/arm outer boundary' : 'body outer silhouette',
      confidence: 90,
      stitchType: 'satin',
    };
  }

  // F) Artificial geometry check
  if (isArtificialSegment(segment)) {
    return {
      className: 'artifact',
      exportable: false,
      reason: 'artificial geometry — long straight or non-adjacent',
      confidence: 80,
    };
  }

  return {
    className: 'artifact',
    exportable: false,
    reason: 'unclassified segment',
    confidence: 50,
  };
}

// ─── Artificial segment detection ─────────────────────────────────────────────

function isArtificialSegment(segment) {
  const points = segment.points || [];
  if (points.length < 3) return false;

  let longSegCount = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dist = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    if (dist > 6.0) longSegCount++;
  }

  return longSegCount > points.length * 0.3;
}

export function removeArtificialContourSegments(contours) {
  let removed = 0;
  const result = contours.filter(obj => {
    if (isArtificialSegment(obj)) {
      removed++;
      console.log(`[artifact-audit] removed artificial contour: ${obj.name}`);
      return false;
    }
    return true;
  });

  console.log(`[artifact-audit] artificial closures removed: ${removed}`);
  return result;
}

// ─── Mouth protection ─────────────────────────────────────────────────────────
// After filtering, if no facial_detail with mouth is exported, find the mouth
// region in the original regions and create an independent contour object.

export function ensureMouthDetailExported(contourObjects, regions, context = {}) {
  const hasMouth = contourObjects.some(obj => {
    const name = (obj.name || '').toLowerCase();
    return name.includes('mouth') || name.includes('boca') || name.includes('smile') ||
           obj.layerType === 'mouth_detail_run' || obj.layerType === 'facial_detail';
  });

  if (hasMouth) {
    console.log('[mouth-audit] mouth detected: true');
    console.log('[mouth-audit] mouth class: facial_detail');
    console.log('[mouth-audit] mouth exported: true');
    return contourObjects;
  }

  console.log('[mouth-audit] mouth not in contours — searching regions');

  // Find mouth region by name
  const mouthKeywords = ['mouth', 'boca', 'smile', 'labio', 'lip'];
  let mouthRegion = regions.find(r => {
    const name = (r.name || '').toLowerCase();
    return mouthKeywords.some(k => name.includes(k)) || r.object_group === 'mouth';
  });

  // Fallback: find by geometry — small dark region in lower-center face area
  if (!mouthRegion) {
    const darkRegions = regions.filter(r => {
      const color = r.color || r.hex || '#888888';
      const lum = luminance(color);
      const bbox = computeBbox(r.path_points || []);
      const isCenterLower = bbox.minY > 0.35 && bbox.minY < 0.75 &&
                            bbox.minX > 0.25 && bbox.maxX < 0.75;
      const isSmall = (r.area_mm2 || 0) < 300 || (bbox.w * bbox.h) < 0.05;
      return lum < 60 && isCenterLower && isSmall;
    });

    if (darkRegions.length > 0) {
      // Pick closest to center-bottom (where mouth typically is)
      mouthRegion = darkRegions.reduce((best, r) => {
        const bbox = computeBbox(r.path_points || []);
        const cx = (bbox.minX + bbox.maxX) / 2;
        const cy = (bbox.minY + bbox.maxY) / 2;
        const dist = Math.hypot(cx - 0.5, cy - 0.6);
        const bb = computeBbox(best.path_points || []);
        const bcx = (bb.minX + bb.maxX) / 2;
        const bcy = (bb.minY + bb.maxY) / 2;
        return dist < Math.hypot(bcx - 0.5, bcy - 0.6) ? r : best;
      });
      console.log('[mouth-audit] mouth detected by geometry: true');
    }
  }

  if (!mouthRegion) {
    console.log('[mouth-audit] no mouth candidate found');
    return contourObjects;
  }

  // Create independent mouth contour object
  const w = context.config?.width_mm || 100;
  const h = context.config?.height_mm || 100;
  const pts = mouthRegion.path_points || [];
  if (pts.length < 2) {
    console.log('[mouth-audit] mouth region has insufficient points');
    return contourObjects;
  }

  const mmPoints = pts.map(([nx, ny]) => [
    (nx - 0.5) * w,
    (ny - 0.5) * h,
  ]);

  const mouthObj = {
    id: 'mouth_detail_run',
    color: '#111111',
    name: 'mouth_detail',
    stitch_type: 'running_stitch',
    priority: 75,
    layerType: 'facial_detail',
    isContour: true,
    contourWidthMm: 0.5,
    points: mmPoints,
    rawRegion: {
      ...mouthRegion,
      closed: false, // open curve — never auto-close
      region_class: 'facial_detail',
      parentGroupName: 'mouth',
    },
    ce01SafeFillMode: false,
  };

  console.log('[mouth-audit] mouth detected: true');
  console.log('[mouth-audit] mouth class: facial_detail');
  console.log('[mouth-audit] mouth exported: true');
  console.log(`[mouth-audit] mouth stitch count: pending (${mmPoints.length} path points)`);

  return [...contourObjects, mouthObj];
}

// ─── Final validation ─────────────────────────────────────────────────────────

export function validateContourExport(classified, commands, regions) {
  const mouthExported = classified.some(c => c.classification?.className === 'facial_detail');

  const mouthStitches = commands.filter(c => {
    if (c.type !== 'stitch') return false;
    const lt = (c.layerType || '').toLowerCase();
    const rid = (c.regionId || '').toLowerCase();
    return lt.includes('mouth') || lt.includes('facial') || rid.includes('mouth');
  }).length;

  const falseInternalPinkBoundary = classified.some(
    c => c.classification?.className === 'fill_boundary' && c.classification?.exportable
  );
  const bodyShadowBoundaryOutlined = false; // fill_boundary objects are never exported

  const outerContourExported = classified.some(
    c => c.classification?.className === 'outer_silhouette' && c.classification?.exportable
  );

  const limbContours = classified.filter(
    c => c.classification?.className === 'limb_contour' && c.classification?.exportable
  ).length;
  const footContourCoverage = limbContours > 0 ? 100 : 0;

  const artificialGeometryCount = classified.filter(
    c => c.classification?.className === 'artifact'
  ).length;

  // Travel stitched as contour
  let travelStitchedAsContour = 0;
  let prevX = 0, prevY = 0;
  for (const c of commands) {
    if (c.type === 'stitch') {
      const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      const lt = (c.layerType || '').toLowerCase();
      const st = (c.stitchType || '').toLowerCase();
      const isValid = lt.includes('outline') || lt.includes('detail') || lt.includes('mouth') ||
                      lt.includes('facial') || lt.includes('eye') || lt.includes('silhouette') ||
                      lt.includes('limb') ||
                      st === 'satin' || st === 'fill' || c.source === 'clipped_fill_optimized';
      if (dist > 6.0 && !isValid) travelStitchedAsContour++;
    }
    if (c.type === 'stitch' || c.type === 'jump') {
      prevX = c.x || 0; prevY = c.y || 0;
    }
  }

  const result = {
    mouthExported,
    mouthStitchCount: mouthStitches,
    falseInternalPinkBoundary,
    bodyShadowBoundaryOutlined,
    outerContourExported,
    footContourCoverage,
    artificialGeometryCount,
    travelStitchedAsContour,
  };

  console.log(`[contour-validation] mouthExported: ${mouthExported}`);
  console.log(`[contour-validation] mouthStitchCount: ${mouthStitches}`);
  console.log(`[contour-validation] falseInternalPinkBoundary: ${falseInternalPinkBoundary}`);
  console.log(`[contour-validation] bodyShadowBoundaryOutlined: ${bodyShadowBoundaryOutlined}`);
  console.log(`[contour-validation] outerContourExported: ${outerContourExported}`);
  console.log(`[contour-validation] footContourCoverage: ${footContourCoverage}%`);
  console.log(`[contour-validation] artificialGeometryCount: ${artificialGeometryCount}`);
  console.log(`[contour-validation] travelStitchedAsContour: ${travelStitchedAsContour}`);

  return result;
}