/**
 * contourPreset.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * "Clean Cartoon Outline CE01" preset.
 *
 * Controls outer/inner outline generation, stitch types, refinement params,
 * and embroidery order for cartoon-style designs on the Caydo CE01.
 */
export const cleanCartoonOutlineCE01 = {
  // ── Feature toggles ──
  outerOutlineEnabled: true,
  innerOutlineEnabled: true,
  outerOutlineType: 'satin',
  innerOutlineType: 'triple_run',
  mouthType: 'triple_run',
  outlineOrder: 'last',       // outer outline sewn last
  preserveFill: true,
  preserveColors: true,
  ce01Safe: true,

  // ── Outer satin parameters ──
  outerSatinWidthMm: 1.0,     // 1.0–1.2mm — thinner, more natural
  outerSatinDensityMm: 0.42,  // 0.40–0.45mm range
  outerOffsetOutwardMm: 0.15, // shift path outward so satin covers fill edge

  // ── Inner contour parameters ──
  innerRunWidthMm: 0.5,       // thinner internal details
  innerOffsetInwardMm: 0.10,
  mouthPasses: 3,             // triple run = 3 passes
  mouthMinLenMm: 1.0,
  mouthMaxLenMm: 1.5,
  eyeRunWidthMm: 0.5,

  // ── Lower contour (body lower edge + feet) — independent width ──
  lowerContourWidth: 1.1,   // 1.0–1.2mm — clean, no blobs; separate from mouth/upper
  // ── Path refinement ──
  smoothingPasses: 2,         // Chaikin smoothing passes
  gapCloseThresholdMm: 1.2,   // close gaps < 1.2mm
  minSegmentMm: 0.8,          // remove segments < 0.8mm
  parallelDedupIoU: 0.90,     // remove parallel duplicates with IoU > 0.90

  // ── Validation thresholds ──
  maxContourStitchMm: 3.5,    // no contour stitch > 3.5mm
  outerMinStitches: 80,       // outer outline must have > 80 stitches
  outlineColor: '#1a1a1a',    // dark outline color

  // ── Region name filters ──
  skipContourNames: ['cheek', 'blush', 'mejilla', 'rubor'], // no black contour on cheeks
  mouthNames: ['mouth', 'boca', 'labio', 'lip'],
  eyeNames: ['eye', 'ojo', 'iris', 'pupil'],
};