/**
 * contourLayerRenderer.js — Draws the dedicated contour layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders region.contour.contour_points as a separate stroke on top of fills.
 * Uses the contour's own color, width, and type — never reconstructs from fill.
 *
 * Satin-light: width ≥ 1.5mm → satin contour columns
 * Running:     width < 1.5mm → running stitch dashes
 */

import { drawRunning, drawSatinContour, drawOutline } from './contourRenderer';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} region       — must have region.contour
 * @param {number} drawW, drawH, zoom, alpha
 * @param {boolean} outlineOnly — outline view mode
 */
export function drawContourLayer(ctx, region, drawW, drawH, zoom, alpha, outlineOnly) {
  const contour = region.contour;
  if (!contour || !contour.contour_points) return;

  const pts = contour.contour_points;
  if (pts.length < 3) return;

  const color   = contour.contour_color || '#1a1a1a';
  const widthMm = contour.contour_width_mm || 1.2;
  const cType   = contour.contour_type || 'outer';

  // Outline-only mode: just draw the contour path as a clean outline
  if (outlineOnly) {
    drawOutline(ctx, pts, drawW, drawH, zoom, color, alpha);
    return;
  }

  // Width-based classification: wide contours → satin columns, thin → running
  if (widthMm >= 1.5) {
    // Satin-light: use satin contour renderer with the contour's width
    const contourRegion = { ...region, mean_width_mm: widthMm, density: region.density || 0.4 };
    drawSatinContour(ctx, pts, contourRegion, drawW, drawH, zoom, color, alpha);
  } else {
    // Running stitch contour
    const contourRegion = { ...region, stitch_length_mm: 2.0 };
    drawRunning(ctx, pts, contourRegion, drawW, drawH, zoom, color, alpha);
  }
}