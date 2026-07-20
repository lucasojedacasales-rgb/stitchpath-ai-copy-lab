/**
 * learnedProfessionalProfiles.js — Reference Learning Engine v2 (FASE 4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates professional profiles automatically from the corpus + mined rules.
 *
 * Profiles group designs by archetype (cartoon_character, simple_logo, …) and
 * each profile carries the recommended parameters the motor should use when a
 * design matches that archetype.
 *
 * Read-only: profiles are data; application to the motor happens in
 * applyLearnedProfileToMotor.
 */

import { summarizeCorpus } from './referenceCorpus';
import { mineDensityAngleCompensationRules } from './densityAngleCompensationMiner';
import { ACCEPTED_MACHINE_SAMPLE_CONFIG_PATCH, ACCEPTED_WILCOM_SAMPLE_V1 } from './acceptedMachineSamples';

const PROFILE_KEYS = [
  'cartoon_character', 'simple_logo', 'text_design', 'patch_style',
  'complex_character', 'small_icon', 'satin_heavy', 'fill_heavy',
];

/**
 * @param {Array<object>} corpus
 * @param {Array<object>} rules — from professionalRuleMiner
 * @returns {Array<object>} profiles
 */
export function generateLearnedProfiles(corpus, rules) {
  const summary = summarizeCorpus(corpus);
  // Density / angle / pull-compensation summary mined from the corpus.
  const dac = mineDensityAngleCompensationRules(corpus).summary;
  const profiles = PROFILE_KEYS.map(name => buildProfile(name, corpus, rules, summary, dac));
  // Attach which corpus entries fall into each profile (for traceability)
  for (const p of profiles) p.matchedFiles = corpus.filter(e => profileMatches(e, p)).map(e => e.filename);
  return profiles.filter(p => p.matchedFiles.length > 0 || p.isDefault);
}

function buildProfile(name, corpus, rules, summary, dac) {
  const candidates = corpus.filter(e => profileMatches(e, { name }));
  const sample = candidates.length ? candidates : corpus;
  const base = baseParams(summary, rules, dac);

  switch (name) {
    case 'cartoon_character':
      return {
        ...base,
        name: 'cartoon_character',
        label: 'Personaje cartoon',
        isDefault: false,
        recommendedFillDensity: clamp(base.recommendedFillDensity, 0.06, 0.12),
        recommendedSatinDensity: clamp(base.recommendedSatinDensity, 0.15, 0.4),
        useSatinForOuterContours: true,
        useDoubleRunForDetails: true,
        contourAfterFill: true,
        useUnderlayRules: { largeFills: true },
        maxColorCount: Math.round(percentile(sample.map(e => e.colorCount), 0.75)),
        maxVisibleStitchMm: 2.5,
        layerOrderRules: ['underlay', 'fill', 'details', 'outline_outer'],
        contourRules: { type: 'satin', afterFill: true, reinforced: true },
        detailRules: { atEnd: true, stitchType: 'double_run' },
        travelRules: { trimLongTravels: true, maxVisibleStitchMm: 2.5 },
      };
    case 'simple_logo':
      return {
        ...base,
        name: 'simple_logo',
        label: 'Logo simple',
        isDefault: false,
        recommendedFillDensity: clamp(base.recommendedFillDensity, 0.05, 0.10),
        maxColorCount: Math.min(4, Math.round(percentile(sample.map(e => e.colorCount), 0.5))),
        maxVisibleStitchMm: 3.0,
        useUnderlayRules: { largeFills: true },
        layerOrderRules: ['underlay', 'fill', 'outline_outer'],
        contourRules: { type: 'running', afterFill: true },
        detailRules: { atEnd: true, stitchType: 'running' },
        travelRules: { trimLongTravels: true, maxVisibleStitchMm: 3.0 },
      };
    case 'text_design':
      return {
        ...base,
        name: 'text_design',
        label: 'Diseño de texto',
        isDefault: false,
        recommendedSatinDensity: clamp(base.recommendedSatinDensity, 0.2, 0.5),
        maxColorCount: Math.min(3, Math.round(percentile(sample.map(e => e.colorCount), 0.5))),
        maxVisibleStitchMm: 2.0,
        layerOrderRules: ['underlay', 'satin', 'outline_outer'],
        contourRules: { type: 'satin', afterFill: true },
        detailRules: { atEnd: true, stitchType: 'satin' },
        travelRules: { trimLongTravels: true, maxVisibleStitchMm: 2.0 },
      };
    case 'patch_style':
      return {
        ...base,
        name: 'patch_style',
        label: 'Estilo parche',
        isDefault: false,
        recommendedFillDensity: clamp(base.recommendedFillDensity, 0.08, 0.14),
        useSatinForOuterContours: true,
        contourAfterFill: true,
        useUnderlayRules: { largeFills: true },
        maxVisibleStitchMm: 2.5,
        layerOrderRules: ['underlay', 'fill', 'outline_outer'],
        contourRules: { type: 'satin', afterFill: true, reinforced: true },
        detailRules: { atEnd: true, stitchType: 'double_run' },
        travelRules: { trimLongTravels: true, maxVisibleStitchMm: 2.5 },
      };
    case 'complex_character':
      return {
        ...base,
        name: 'complex_character',
        label: 'Personaje complejo',
        isDefault: false,
        maxColorCount: Math.round(percentile(sample.map(e => e.colorCount), 0.85)),
        maxVisibleStitchMm: 2.5,
        useUnderlayRules: { largeFills: true },
        layerOrderRules: ['underlay', 'fill', 'details', 'outline_outer'],
        contourRules: { type: 'satin', afterFill: true, reinforced: true },
        detailRules: { atEnd: true, stitchType: 'double_run' },
        travelRules: { trimLongTravels: true, maxVisibleStitchMm: 2.5 },
      };
    case 'small_icon':
      return {
        ...base,
        name: 'small_icon',
        label: 'Icono pequeño',
        isDefault: false,
        recommendedFillDensity: clamp(base.recommendedFillDensity, 0.07, 0.13),
        maxColorCount: Math.min(5, Math.round(percentile(sample.map(e => e.colorCount), 0.5))),
        maxVisibleStitchMm: 2.5,
        maxJumpRatio: 0.15,
        maxTrimRatio: 0.1,
        layerOrderRules: ['fill', 'outline_outer'],
        contourRules: { type: 'running', afterFill: true },
        detailRules: { atEnd: true, stitchType: 'running' },
        travelRules: { trimLongTravels: true, maxVisibleStitchMm: 2.5 },
      };
    case 'satin_heavy':
      return {
        ...base,
        name: 'satin_heavy',
        label: 'Predominio satin',
        isDefault: false,
        recommendedSatinDensity: clamp(base.recommendedSatinDensity, 0.2, 0.5),
        useSatinForOuterContours: true,
        maxVisibleStitchMm: 2.5,
        layerOrderRules: ['underlay', 'satin', 'outline_outer'],
        contourRules: { type: 'satin', afterFill: true, reinforced: true },
        detailRules: { atEnd: true, stitchType: 'satin' },
        travelRules: { trimLongTravels: true, maxVisibleStitchMm: 2.5 },
      };
    case 'fill_heavy':
      return {
        ...base,
        name: 'fill_heavy',
        label: 'Predominio relleno',
        isDefault: false,
        recommendedFillDensity: clamp(base.recommendedFillDensity, 0.06, 0.12),
        useUnderlayRules: { largeFills: true },
        maxVisibleStitchMm: 3.0,
        layerOrderRules: ['underlay', 'fill', 'outline_outer'],
        contourRules: { type: 'running', afterFill: true },
        detailRules: { atEnd: true, stitchType: 'running' },
        travelRules: { trimLongTravels: true, maxVisibleStitchMm: 3.0 },
      };
    default:
      return { ...base, name, label: name, isDefault: true };
  }
}

function baseParams(summary, rules, dac) {
  const avg = summary ? summary.avg : {};
  const d = dac || {};
  return {
    recommendedFillDensity: avg.estimatedDensity || 0.08,
    recommendedFillDensityMm: d.fillDensityMm || 0.4,
    recommendedFillAngleDeg: d.fillAngleDeg || 0,
    recommendedSatinDensity: 0.25,
    recommendedSatinColumnSpacingMm: d.satinColumnSpacingMm || 0.4,
    recommendedPullCompensationMm: d.pullCompensationMm || 0.2,
    recommendedRunningLength: 0,
    maxVisibleStitchMm: 2.5,
    maxColorCount: 8,
    maxJumpRatio: 0.3,
    maxTrimRatio: 0.2,
    useUnderlayRules: { largeFills: false },
    layerOrderRules: [],
    contourRules: {},
    detailRules: {},
    travelRules: { trimLongTravels: false },
    useSatinForOuterContours: false,
    useDoubleRunForDetails: false,
    contourAfterFill: false,
    reduceSimilarColors: true,
    learnedFromFiles: summary ? summary.count : 0,
    acceptedMachineSample: ACCEPTED_WILCOM_SAMPLE_V1,
    ...ACCEPTED_MACHINE_SAMPLE_CONFIG_PATCH,
    stitchCountBlocking: false,
    old12000LimitBlocking: false,
  };
}

function profileMatches(entry, profile) {
  const aspect = entry.widthMm / Math.max(1, entry.heightMm);
  const blockCount = entry.technicalBlocks.length;
  const colorCount = entry.colorCount;
  const area = entry.widthMm * entry.heightMm;
  const satinRatio = entry.satinBlocks / Math.max(1, blockCount);
  const fillRatio = entry.fillBlocks / Math.max(1, blockCount);
  const hasDetail = entry.detailCandidates > 0;
  switch (profile.name) {
    case 'cartoon_character':
      return colorCount >= 4 && hasDetail && blockCount >= 6 && satinRatio > 0.1;
    case 'simple_logo':
      return colorCount <= 4 && blockCount <= 6 && area < 8000;
    case 'text_design':
      return blockCount <= 5 && satinRatio > 0.4;
    case 'patch_style':
      return aspect > 0.7 && aspect < 1.4 && satinRatio > 0.2 && entry.contourCandidates > 0;
    case 'complex_character':
      return colorCount >= 5 && blockCount >= 12;
    case 'small_icon':
      return area < 2000 && blockCount <= 5;
    case 'satin_heavy':
      return satinRatio > 0.4;
    case 'fill_heavy':
      return fillRatio > 0.4;
    default:
      return false;
  }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v || (min + max) / 2)); }

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)] || sorted[sorted.length - 1];
}

export const PROFILE_NAMES = PROFILE_KEYS;

/**
 * Finds the best matching profile for a design profile.
 */
export function findBestProfile(designProfile, profiles) {
  if (!profiles || profiles.length === 0) return null;
  // Prefer an explicit archetype match by name, else fall back to the profile
  // whose matchedFiles are most similar in size/color.
  const byName = profiles.find(p => p.name === designProfile.estimatedType);
  if (byName) return byName;
  let best = null, bestScore = -Infinity;
  for (const p of profiles) {
    let s = 0;
    if (p.maxColorCount && designProfile.colorCount) {
      s -= Math.abs(p.maxColorCount - designProfile.colorCount);
    }
    s += (p.matchedFiles || []).length;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best || profiles[0];
}