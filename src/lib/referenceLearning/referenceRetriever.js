/**
 * referenceRetriever.js — Reference Learning Engine v2 (FASE 5)
 * ─────────────────────────────────────────────────────────────────────────────
 * Given the metrics of the current design (or an uploaded image profile),
 * finds the most similar reference files inside the corpus and returns the
 * recommended profile, applicable rules and suggested motor parameters.
 *
 * Read-only: never modifies the design or the corpus.
 */

import { findBestProfile } from './learnedProfessionalProfiles';

/**
 * @param {object} designProfile — { widthMm, heightMm, colorCount, estimatedType, fillRatio, contourRatio, complexity, stitchCount }
 * @param {Array<object>} corpus
 * @param {Array<object>} profiles — from generateLearnedProfiles
 * @param {Array<object>} rules — from mineProfessionalRules
 * @returns {object} retrieval result
 */
export function retrieveSimilarReferences(designProfile, corpus, profiles, rules) {
  if (!corpus || corpus.length === 0) {
    return { topReferences: [], recommendedProfile: null, applicableRules: [], suggestedParams: null };
  }
  const scored = corpus.map(e => ({ entry: e, score: similarityScore(designProfile, e) }));
  scored.sort((a, b) => b.score - a.score);
  const topReferences = scored.slice(0, 5).map(s => ({
    filename: s.entry.filename,
    score: Math.round(s.score * 100) / 100,
    colorCount: s.entry.colorCount,
    stitchCount: s.entry.stitchCount,
    widthMm: s.entry.widthMm,
    heightMm: s.entry.heightMm,
    blockCount: s.entry.technicalBlocks.length,
  }));

  const recommendedProfile = findBestProfile(designProfile, profiles);
  const applicableRules = selectApplicableRules(designProfile, rules, recommendedProfile);
  const suggestedParams = recommendedProfile
    ? extractParamsFromProfile(recommendedProfile)
    : null;

  return { topReferences, recommendedProfile, applicableRules, suggestedParams };
}

function similarityScore(design, entry) {
  let score = 0;
  const dArea = (design.widthMm || 0) * (design.heightMm || 0);
  const eArea = entry.widthMm * entry.heightMm;
  // size similarity (0..1)
  if (dArea > 0 && eArea > 0) score += 1 - Math.min(1, Math.abs(Math.log(dArea / eArea)) / 3);
  // color count similarity
  const dc = design.colorCount || 0;
  score += 1 - Math.min(1, Math.abs(dc - entry.colorCount) / 6);
  // complexity similarity (block count proxy)
  const dComplex = design.complexity || design.blockCount || 0;
  score += 1 - Math.min(1, Math.abs(dComplex - entry.technicalBlocks.length) / 15);
  // fill / contour ratio
  if (design.fillRatio != null) {
    const eFillRatio = entry.fillBlocks / Math.max(1, entry.technicalBlocks.length);
    score += 1 - Math.min(1, Math.abs(design.fillRatio - eFillRatio));
  }
  if (design.contourRatio != null) {
    const eContourRatio = entry.contourCandidates / Math.max(1, entry.technicalBlocks.length);
    score += 1 - Math.min(1, Math.abs(design.contourRatio - eContourRatio));
  }
  return score;
}

function selectApplicableRules(design, rules, profile) {
  if (!rules) return [];
  // Applicable rules: those whose category matches the profile focus, plus
  // always the layer-order and jumps/trims rules (universal).
  const focus = profile ? profileFocus(profile) : [];
  return rules.filter(r => {
    if (r.confidence < 0.5) return false;
    if (['layer_order', 'jumps_trims'].includes(r.category)) return true;
    return focus.includes(r.category);
  });
}

function profileFocus(profile) {
  if (profile.name === 'text_design' || profile.name === 'satin_heavy') return ['contour', 'colors'];
  if (profile.name === 'fill_heavy') return ['fill', 'jumps_trims'];
  if (profile.name === 'cartoon_character' || profile.name === 'complex_character') return ['contour', 'fill', 'layer_order', 'colors'];
  return ['fill', 'contour'];
}

function extractParamsFromProfile(profile) {
  return {
    fillDensity: profile.recommendedFillDensity,
    satinDensity: profile.recommendedSatinDensity,
    runningStep: profile.recommendedRunningLength,
    underlayEnabled: !!(profile.useUnderlayRules && profile.useUnderlayRules.largeFills),
    contourAfterFill: profile.contourAfterFill,
    maxVisibleStitchMm: profile.maxVisibleStitchMm,
    trimLongTravels: !!(profile.travelRules && profile.travelRules.trimLongTravels),
    reduceSimilarColors: profile.reduceSimilarColors,
    useSatinForOuterContours: profile.useSatinForOuterContours,
    useDoubleRunForDetails: profile.useDoubleRunForDetails,
    maxColorCount: profile.maxColorCount,
    layerOrderRules: profile.layerOrderRules,
  };
}

/**
 * Builds a design profile from a StitchPath AI generated design (regions + metrics).
 */
export function buildDesignProfileFromDesign(regions, metrics) {
  const blockCount = (regions || []).length;
  const fillRegions = (regions || []).filter(r => r.stitch_type === 'fill').length;
  const contourRegions = (regions || []).filter(r => r.stitch_type === 'satin' || r.stitch_type === 'running_stitch').length;
  return {
    widthMm: metrics?.widthMm || (regions?.[0]?.bbox?.widthMm) || 100,
    heightMm: metrics?.heightMm || (regions?.[0]?.bbox?.heightMm) || 100,
    colorCount: metrics?.colorCount || new Set((regions || []).map(r => r.color).filter(Boolean)).size,
    estimatedType: estimateDesignType(regions, metrics),
    fillRatio: blockCount ? fillRegions / blockCount : 0,
    contourRatio: blockCount ? contourRegions / blockCount : 0,
    complexity: blockCount,
    stitchCount: metrics?.stitchCount || 0,
  };
}

function estimateDesignType(regions, metrics) {
  const n = (regions || []).length;
  const colors = new Set((regions || []).map(r => r.color).filter(Boolean)).size;
  if (colors >= 5 && n >= 12) return 'complex_character';
  if (colors >= 4 && n >= 6) return 'cartoon_character';
  if (n <= 5) return 'simple_logo';
  return 'fill_heavy';
}