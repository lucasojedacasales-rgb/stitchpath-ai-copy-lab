/**
 * referenceDesignSelector.js — Reference Learning Engine v2 (FASE 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Selecciona el mejor perfil aprendido para el diseño actual, puntuando las
 * características del diseño (colores, bloques, satin/fill ratio, área, detalles)
 * contra los arquetipos conocidos del corpus.
 *
 * Read-only: solo elige, no aplica nada al motor.
 */

import { computeCurrentDesignProfile } from './referenceDesignMetrics';

const ARCHETYPE_PRIORITY = [
  'complex_character',
  'cartoon_character',
  'patch_style',
  'satin_heavy',
  'fill_heavy',
  'simple_logo',
  'text_design',
  'small_icon',
];

/**
 * @param {Array} currentRegions
 * @param {Array} currentCommands
 * @param {Array<object>} learnedProfiles — from generateLearnedProfiles
 * @returns {{ selectedProfileId, confidence, reason, matchedReferenceFiles, applicableRules, selectedProfile }}
 */
export function selectBestLearnedProfileForCurrentDesign(currentRegions, currentCommands, learnedProfiles) {
  if (!learnedProfiles || learnedProfiles.length === 0) {
    return { selectedProfileId: null, confidence: 0, reason: 'Sin perfiles aprendidos', matchedReferenceFiles: [], applicableRules: [], selectedProfile: null };
  }
  const dp = computeCurrentDesignProfile(currentRegions, currentCommands);

  // Score each available learned profile against the design profile
  const scored = learnedProfiles.map((p) => {
    const s = scoreProfileMatch(dp, p);
    return { profile: p, score: s.score, reason: s.reason };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  return {
    selectedProfileId: best.profile.name,
    selectedProfile: best.profile,
    confidence: Math.min(1, best.score / 100),
    reason: best.reason,
    matchedReferenceFiles: best.profile.matchedFiles || [],
    applicableRules: [],
    designProfile: dp,
  };
}

function scoreProfileMatch(dp, profile) {
  let score = 0;
  const reasons = [];
  const name = profile.name;

  // Color count proximity
  if (profile.maxColorCount && dp.colorCount != null) {
    const diff = Math.abs(profile.maxColorCount - dp.colorCount);
    score += Math.max(0, 25 - diff * 5);
    if (diff <= 2) reasons.push(`colores cercanos (${dp.colorCount} vs ${profile.maxColorCount})`);
  }

  // Archetype-specific signals
  switch (name) {
    case 'complex_character':
    case 'cartoon_character':
      if (dp.colorCount >= 4) { score += 20; reasons.push('multicolor'); }
      if (dp.hasDetail) { score += 20; reasons.push('tiene detalles'); }
      if (dp.blockCount >= 6) { score += 15; reasons.push('bloques suficientes'); }
      if (dp.satinRatio > 0.1) { score += 10; reasons.push('usa satin'); }
      break;
    case 'patch_style':
      if (dp.aspect > 0.7 && dp.aspect < 1.4) { score += 20; reasons.push('aspecto cuadrado'); }
      if (dp.satinRatio > 0.2) { score += 20; reasons.push('satin presente'); }
      if (dp.contourCount > 0) { score += 10; reasons.push('tiene contorno'); }
      break;
    case 'satin_heavy':
      if (dp.satinRatio > 0.4) { score += 45; reasons.push('predominio satin'); }
      break;
    case 'fill_heavy':
      if (dp.fillRatio > 0.4) { score += 45; reasons.push('predominio relleno'); }
      break;
    case 'simple_logo':
      if (dp.colorCount <= 4 && dp.blockCount <= 6) { score += 35; reasons.push('simple y pocos colores'); }
      if (dp.area < 8000) { score += 10; }
      break;
    case 'text_design':
      if (dp.blockCount <= 5 && dp.satinRatio > 0.4) { score += 35; reasons.push('pocos bloques satinados'); }
      break;
    case 'small_icon':
      if (dp.area < 2000 && dp.blockCount <= 5) { score += 35; reasons.push('área pequeña'); }
      break;
    default:
      score += 5;
  }

  // Bonus: matchedFiles count (more evidence = more reliable)
  score += Math.min(10, (profile.matchedFiles || []).length);

  return { score, reason: reasons.join(', ') || 'mejor coincidencia heurística' };
}