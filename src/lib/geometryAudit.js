/**
 * geometryAudit.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects and removes artificial geometry from embroidery command sequences.
 *
 * Artificial geometry = long visible stitched segments that don't belong to
 * a real contour, detail, or fill — typically caused by:
 *   - Auto-closure of open contours with straight segments
 *   - Convex hull bridging between non-adjacent regions
 *   - Return-to-origin stitched as running stitch
 *   - Travel path erroneously converted to visible stitch
 *
 * Public API:
 *   detectArtificialSegments(commands, threshold)   → suspicious []
 *   removeArtificialSegments(commands, threshold)   → { commands, removed }
 *   auditEndPosition(commands)                      → { ok, index?, dist? }
 *   fixEndPosition(commands)                        → { commands, fixed }
 *   classifyStitchSegments(commands)                → segments [] (for visual report)
 *   auditAndCleanGeometry(commands, config)         → { commands, ...metrics }
 */

const SUSPICIOUS_SEGMENT_THRESHOLD_MM = 6.0;

// ─── Stitch validation ──────────────────────────────────────────────────────

function isValidVisibleStitch(cmd) {
  const stitchType = (cmd.stitchType || '').toLowerCase();
  const layerType = (cmd.layerType || '').toLowerCase();
  const regionId = (cmd.regionId || '').toLowerCase();

  // Satin columns are always valid (outer outlines)
  if (stitchType === 'satin') return true;

  // Contour layers are valid
  if (layerType.includes('outline') || layerType.includes('contour')) return true;

  // Detail layers are valid (mouth, eyes, details)
  if (layerType.includes('detail') || layerType.includes('mouth')) return true;
  if (layerType.includes('facial') || layerType.includes('eye')) return true;
  if (regionId.includes('mouth') || regionId.includes('detail')) return true;
  if (regionId.includes('eye')) return true;

  // Fill stitches are valid
  if (stitchType === 'fill' || cmd.source === 'clipped_fill_optimized') return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DETECT — long visible segments that aren't part of valid elements
// ═══════════════════════════════════════════════════════════════════════════

export function detectArtificialSegments(commands, threshold = SUSPICIOUS_SEGMENT_THRESHOLD_MM) {
  const suspicious = [];
  let prevX = 0, prevY = 0;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'stitch') {
      const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      if (dist > threshold && !isValidVisibleStitch(c)) {
        suspicious.push({
          index: i,
          start: { x: prevX, y: prevY },
          end: { x: c.x || 0, y: c.y || 0 },
          length: dist,
          stitchType: c.stitchType,
          layerType: c.layerType,
          regionId: c.regionId,
        });
        console.log(
          `[travel-audit] long visible segment detected: ` +
          `start=(${prevX.toFixed(1)},${prevY.toFixed(1)}) ` +
          `end=(${(c.x || 0).toFixed(1)},${(c.y || 0).toFixed(1)}) ` +
          `length=${dist.toFixed(1)}mm ` +
          `object=${c.regionId || c.layerType || 'unknown'}`
        );
      }
    }
    if (c.type === 'stitch' || c.type === 'jump') {
      prevX = c.x || 0;
      prevY = c.y || 0;
    }
  }
  return suspicious;
}

// ═══════════════════════════════════════════════════════════════════════════
//  REMOVE — convert artificial segments to invisible jumps
// ═══════════════════════════════════════════════════════════════════════════

export function removeArtificialSegments(commands, threshold = SUSPICIOUS_SEGMENT_THRESHOLD_MM) {
  const result = [...commands];
  let removed = 0;
  let prevX = 0, prevY = 0;

  for (let i = 0; i < result.length; i++) {
    const c = result[i];
    if (c.type === 'stitch') {
      const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      if (dist > threshold && !isValidVisibleStitch(c)) {
        result[i] = { ...c, type: 'jump' };
        removed++;
        console.log(
          `[travel-audit] artificial closure removed at index ${i}: ` +
          `${dist.toFixed(1)}mm converted to jump`
        );
      }
    }
    if (c.type === 'stitch' || c.type === 'jump') {
      prevX = c.x || 0;
      prevY = c.y || 0;
    }
  }
  return { commands: result, removed };
}

// ═══════════════════════════════════════════════════════════════════════════
//  END POSITION — no return-to-origin stitched visibly
// ═══════════════════════════════════════════════════════════════════════════

export function auditEndPosition(commands) {
  if (commands.length === 0) return { ok: true };

  // Find last stitch before END
  let lastStitchIdx = -1;
  for (let i = commands.length - 1; i >= 0; i--) {
    if (commands[i].type === 'stitch') { lastStitchIdx = i; break; }
  }
  if (lastStitchIdx < 0) return { ok: true };

  const lastStitch = commands[lastStitchIdx];
  const distToOrigin = Math.hypot(lastStitch.x || 0, lastStitch.y || 0);

  // Check if there's a long stitch near the end that goes to origin
  if (distToOrigin < 3 && lastStitchIdx > 0) {
    const prev = commands[lastStitchIdx - 1];
    if (prev && (prev.type === 'stitch' || prev.type === 'jump')) {
      const jumpDist = Math.hypot(
        (lastStitch.x || 0) - (prev.x || 0),
        (lastStitch.y || 0) - (prev.y || 0)
      );
      if (jumpDist > 5) {
        console.log(`[travel-audit] final return converted to jump: ${jumpDist.toFixed(1)}mm`);
        return { ok: false, index: lastStitchIdx, dist: jumpDist };
      }
    }
  }

  return { ok: true };
}

export function fixEndPosition(commands) {
  const result = [...commands];
  const audit = auditEndPosition(commands);
  if (!audit.ok && audit.index >= 0) {
    result[audit.index] = { ...result[audit.index], type: 'jump' };
  }
  return { commands: result, fixed: !audit.ok };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLASSIFY — for visual report (contour / detail / fill / travel / suspicious)
// ═══════════════════════════════════════════════════════════════════════════

export function classifyStitchSegments(commands) {
  const segments = [];
  let prevX = 0, prevY = 0;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'stitch') {
      const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      let category;

      if (dist > SUSPICIOUS_SEGMENT_THRESHOLD_MM && !isValidVisibleStitch(c)) {
        category = 'artifact';
      } else {
        const layerType = (c.layerType || '').toLowerCase();
        const stitchType = (c.stitchType || '').toLowerCase();
        const regionId = (c.regionId || '').toLowerCase();

        if (layerType.includes('mouth') || regionId.includes('mouth')) {
          category = 'facial_detail';
        } else if (layerType.includes('eye') || regionId.includes('eye')) {
          category = 'eye_detail';
        } else if (layerType === 'facial_detail') {
          category = 'facial_detail';
        } else if (layerType === 'eye_detail') {
          category = 'eye_detail';
        } else if (layerType === 'limb_contour') {
          category = 'limb_contour';
        } else if (layerType === 'outer_silhouette' || layerType.includes('outer_outline') || stitchType === 'satin') {
          category = 'outer_silhouette';
        } else if (layerType.includes('inner_outline')) {
          category = 'fill_boundary';
        } else if (stitchType === 'fill' || c.source === 'clipped_fill_optimized') {
          category = 'fill';
        } else {
          category = 'other_stitch';
        }
      }

      segments.push({
        index: i,
        start: { x: prevX, y: prevY },
        end: { x: c.x || 0, y: c.y || 0 },
        length: dist,
        category,
        color: c.color,
      });
    } else if (c.type === 'jump') {
      const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      segments.push({
        index: i,
        start: { x: prevX, y: prevY },
        end: { x: c.x || 0, y: c.y || 0 },
        length: dist,
        category: 'travel',
        color: c.color,
      });
    }

    if (c.type === 'stitch' || c.type === 'jump') {
      prevX = c.x || 0;
      prevY = c.y || 0;
    }
  }

  return segments;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FULL AUDIT — detect + remove + fix end + check mouth
// ═══════════════════════════════════════════════════════════════════════════

export function auditAndCleanGeometry(commands, config = {}) {
  const threshold = config.suspiciousThreshold || SUSPICIOUS_SEGMENT_THRESHOLD_MM;

  // 1. Detect artificial segments
  const suspicious = detectArtificialSegments(commands, threshold);

  // 2. Remove them (convert to jumps)
  const { commands: cleaned, removed } = removeArtificialSegments(commands, threshold);

  // 3. Fix end position
  const { commands: final, fixed } = fixEndPosition(cleaned);

  // 4. Check mouth preservation
  const mouthStitches = final.filter(c =>
    c.type === 'stitch' && (
      (c.layerType || '').toLowerCase().includes('mouth') ||
      (c.regionId || '').toLowerCase().includes('mouth')
    )
  ).length;
  console.log(`[mouth-audit] mouth preserved = ${mouthStitches > 0}`);

  return {
    commands: final,
    suspiciousDetected: suspicious.length,
    segmentsRemoved: removed,
    endPositionFixed: fixed,
    mouthPreserved: mouthStitches > 0,
  };
}