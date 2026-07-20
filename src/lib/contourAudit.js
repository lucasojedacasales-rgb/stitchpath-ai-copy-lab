/**
 * contourAudit.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Post-generation audit that removes invalid internal outlines.
 *
 * An outline is "invalid_internal_outline" if it separates two regions with
 * the SAME object_group — that's an internal shading boundary (e.g. the
 * frontier between light pink and shadow pink on the body), NOT a visible
 * contour.
 *
 * Mandatory logs:
 *   [outline-audit] removed internal shading outline between body/body
 *   [outline-audit] internal shading boundaries detected: N
 *   [outline-audit] invalid internal outlines removed: N
 */

import { sameObjectGroup, getRegionGroup } from './contourGroupClassifier.js';

function computeBbox(pts) {
  if (!pts || pts.length === 0) return { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5, w: 0, h: 0 };
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function findAdjacentRegions(fill, allRegions) {
  const bbox = computeBbox(fill.path_points || fill.contour_points || []);
  const adjacent = [];
  for (const other of allRegions) {
    if (other.id === fill.id) continue;
    const ob = computeBbox(other.path_points || []);
    const xOv = Math.max(0, Math.min(bbox.maxX, ob.maxX) - Math.max(bbox.minX, ob.minX));
    const yOv = Math.max(0, Math.min(bbox.maxY, ob.maxY) - Math.max(bbox.minY, ob.minY));
    const isAdjacent = (xOv > 0 && yOv > -0.05) || (yOv > 0 && xOv > -0.05);
    if (isAdjacent) adjacent.push(other);
  }
  return adjacent;
}

/**
 * Audits generated outlines and removes invalid internal outlines.
 *
 * @param {Array} outlines — generated outlines (from generateOutlines)
 * @param {Array} regions — classified regions (with object_group)
 * @returns {{ outlines, removedCount, removedDetails, internalBoundariesDetected, internalBoundaries }}
 */
export function auditContours(outlines, regions) {
  const cleaned = [];
  let removedCount = 0;
  const removedDetails = [];
  const internalBoundaries = [];
  let internalBoundariesDetected = 0;

  for (const outline of outlines) {
    // Only audit inner outlines — outer outlines are always valid
    if (outline.region_class === 'outer_outline') {
      cleaned.push(outline);
      continue;
    }

    const parent = regions.find(r => r.id === outline.parentRegionId);
    if (!parent) {
      cleaned.push(outline);
      continue;
    }

    const parentGroup = getRegionGroup(parent);
    const adjacent = findAdjacentRegions(parent, regions);

    let invalid = false;
    let invalidNeighbor = null;
    for (const neighbor of adjacent) {
      if (sameObjectGroup(parent, neighbor)) {
        invalid = true;
        invalidNeighbor = neighbor;
        internalBoundariesDetected++;
        internalBoundaries.push({
          parentRegionId: parent.id,
          parentName: parent.name || parent.id,
          parentGroup,
          neighborRegionId: neighbor.id,
          neighborName: neighbor.name || neighbor.id,
          neighborGroup: getRegionGroup(neighbor),
          boundaryPoints: outline.contour_points || outline.path_points || [],
        });
        break;
      }
    }

    if (invalid) {
      removedCount++;
      const group = parentGroup || 'unknown';
      removedDetails.push({
        outlineId: outline.id,
        outlineName: outline.name,
        parentRegionId: outline.parentRegionId,
        parentGroup: group,
        neighborGroup: getRegionGroup(invalidNeighbor) || group,
        boundaryPoints: outline.contour_points || outline.path_points || [],
        reason: 'internal_shading_boundary',
      });
      console.log(`[outline-audit] removed internal shading outline between ${group}/${getRegionGroup(invalidNeighbor) || group} (${(outline.name || outline.id).substring(0, 30)})`);
    } else {
      cleaned.push(outline);
    }
  }

  console.log(`[outline-audit] total outlines: ${outlines.length}`);
  console.log(`[outline-audit] internal shading boundaries detected: ${internalBoundariesDetected}`);
  console.log(`[outline-audit] invalid internal outlines removed: ${removedCount}`);

  return { outlines: cleaned, removedCount, removedDetails, internalBoundariesDetected, internalBoundaries };
}

/**
 * Computes the foot contour coverage metric.
 * Returns the percentage of foot regions that have an outer outline.
 */
export function computeFootContourCoverage(outlines, regions) {
  const footRegions = regions.filter(r => {
    const g = r.object_group || '';
    return g === 'foot_left' || g === 'foot_right';
  });
  if (footRegions.length === 0) return 100;

  let covered = 0;
  for (const foot of footRegions) {
    const hasOutline = outlines.some(o =>
      o.region_class === 'outer_outline' && o.parentRegionId === foot.id
    );
    if (hasOutline) covered++;
  }
  return Math.round((covered / footRegions.length) * 100);
}