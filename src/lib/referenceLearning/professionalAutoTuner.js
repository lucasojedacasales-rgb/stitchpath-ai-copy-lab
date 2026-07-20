/**
 * professionalAutoTuner.js — Reference Learning Engine v2 (FASE 8)
 * ─────────────────────────────────────────────────────────────────────────────
 * Iteratively tunes generation parameters so the produced embroidery gets
 * closer to the learned professional profile.
 *
 * Flow:
 *   1. Generate embroidery with current parameters (caller provides metrics).
 *   2. Measure metrics of the produced design.
 *   3. Compare against the learned profile.
 *   4. Adjust parameters toward the profile.
 *   5. Repeat up to MAX_ITERATIONS.
 *   6. Pick the version with the best professionalGapScore (lowest gap wins).
 *
 * It does NOT touch the DST/DSB encoder, CE01, or the universal detector — it
 * only adjusts generation parameters. The caller is responsible for actually
 * regenerating the design between iterations.
 */

import { applyLearnedProfileToMotor, mergeLearnedConfig } from './applyLearnedProfileToMotor';
import { buildDesignProfileFromDesign, retrieveSimilarReferences } from './referenceRetriever';
import { compareAgainstCorpus } from './wilcomStyleComparator';

const MAX_ITERATIONS = 3;

/**
 * @param {object} opts
 * @param {object} opts.currentConfig — project config (read + patched)
 * @param {Array} opts.regions — current regions
 * @param {object} opts.currentMetrics — unified metrics of the current design
 * @param {Array} opts.corpus — from buildReferenceCorpus
 * @param {Array} opts.profiles — from generateLearnedProfiles
 * @param {Array} opts.rules — from mineProfessionalRules
 * @param {Function} opts.regenerate — async (config) => { regions, metrics } ; called each iteration
 * @returns {Promise<object>} tuning result
 */
export async function runProfessionalAutoTuner(opts) {
  const { currentConfig, regions, currentMetrics, corpus, profiles, rules, regenerate } = opts;
  if (!corpus || corpus.length === 0 || !profiles || profiles.length === 0) {
    return { ran: false, reason: 'Sin corpus/perfiles para aprender', bestConfig: currentConfig, iterations: [] };
  }

  const designProfile = buildDesignProfileFromDesign(regions, currentMetrics);
  const retrieval = retrieveSimilarReferences(designProfile, corpus, profiles, rules);
  const recommendedProfile = retrieval.recommendedProfile;
  const applicableRules = retrieval.applicableRules;
  const patch = applyLearnedProfileToMotor(recommendedProfile, applicableRules);

  const iterations = [];
  let bestConfig = mergeLearnedConfig(currentConfig, patch);
  let bestGap = Infinity;
  let bestRegions = regions;
  let bestMetrics = currentMetrics;

  // Iteration 0: evaluate current design as-is
  let workingConfig = currentConfig;
  let workingRegions = regions;
  let workingMetrics = currentMetrics;
  let workingGap = evaluateGap(currentMetrics, corpus, recommendedProfile);

  iterations.push({
    iteration: 0,
    config: currentConfig,
    metrics: currentMetrics,
    gapScore: workingGap,
    note: 'Diseño actual sin aplicar perfil aprendido',
  });

  if (workingGap < bestGap) { bestGap = workingGap; bestConfig = currentConfig; bestRegions = regions; bestMetrics = currentMetrics; }

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    // Gradually blend the learned patch: full strength after iteration 1.
    workingConfig = i === 1 ? mergeLearnedConfig(currentConfig, patch) : refineConfig(workingConfig, workingMetrics, recommendedProfile, applicableRules);

    if (typeof regenerate === 'function') {
      try {
        const regen = await regenerate(workingConfig);
        workingRegions = regen.regions ?? workingRegions;
        workingMetrics = regen.metrics ?? workingMetrics;
      } catch (e) {
        iterations.push({ iteration: i, error: e.message, gapScore: null });
        break;
      }
    }

    workingGap = evaluateGap(workingMetrics, corpus, recommendedProfile);
    iterations.push({
      iteration: i,
      config: workingConfig,
      metrics: workingMetrics,
      gapScore: workingGap,
      note: i === 1 ? 'Perfil aprendido aplicado' : `Refinamiento iteración ${i}`,
    });

    if (workingGap < bestGap) {
      bestGap = workingGap;
      bestConfig = workingConfig;
      bestRegions = workingRegions;
      bestMetrics = workingMetrics;
    }
    if (workingGap <= 10) break; // close enough
  }

  return {
    ran: true,
    recommendedProfile,
    applicableRules,
    learnedPatch: patch,
    bestConfig,
    bestRegions,
    bestMetrics,
    bestGapScore: bestGap,
    iterations,
    improvement: iterations[0]?.gapScore != null ? (iterations[0].gapScore - bestGap) : 0,
  };
}

function evaluateGap(metrics, corpus, profile) {
  if (!metrics) return 100;
  const comparison = compareAgainstCorpus(metrics, corpus, profile);
  // gap score: higher is worse; we want to minimize it
  return comparison.professionalGapScore;
}

function refineConfig(config, metrics, profile, rules) {
  if (!metrics || !profile) return config;
  const next = { ...config };
  // If long visible stitches remain, tighten the ceiling
  if ((metrics.longVisibleStitchCount || 0) > 0) {
    next.learnedMaxVisibleStitchMm = Math.max(1.8, (next.learnedMaxVisibleStitchMm || 2.5) - 0.3);
  }
  // If visible travel is high, force trim on long travels
  if ((metrics.visibleTravelScore || 0) > 0.05) {
    next.learnedTrimLongTravels = true;
  }
  // If too many colors, reduce
  if ((metrics.colorCount || 0) > (profile.maxColorCount || 8)) {
    next.learnedReduceSimilarColors = true;
  }
  return next;
}

export const AUTO_TUNER_MAX_ITERATIONS = MAX_ITERATIONS;