import { analyzeArtworkColor } from './colorFeatureAnalysis.js';
import { analyzeRegionGeometryFeatures } from './geometryFeatureAnalysis.js';
import {
  ARTWORK_SEMANTIC_ROLES,
  createSemanticRegionAssessmentV2,
  resolveSemanticAnalysisOptions,
} from './semanticRoleModel.js';
import { analyzeSourceSemanticEvidence } from './sourceSemanticEvidence.js';
import { validateSemanticAnalysisResult, validateSemanticAnalyzerOptions } from './semanticAnalysisValidation.js';

const SCORABLE_ROLES = ARTWORK_SEMANTIC_ROLES.filter(role => role !== 'unknown');

function snapshot(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function emptyScores() {
  return Object.fromEntries(SCORABLE_ROLES.map(role => [role, 0]));
}

function clampScore(score) {
  return Math.min(1, Math.max(0, score));
}

function buildFeatureScores(region, source, color, geometry) {
  const sourceScores = emptyScores();
  source.evidence.forEach(item => {
    if (sourceScores[item.role] !== undefined) sourceScores[item.role] = Math.max(sourceScores[item.role], source.conflicts.length ? 0.55 : 0.85);
  });
  if (source.trustedRoleCandidate) sourceScores[source.trustedRoleCandidate] = 1;
  const darkFeatureTags = new Set(['pupil', 'mouth', 'nose', 'nostril', 'stroke', 'line', 'darkmark', 'darkdetail']);
  if ((color.isDark || color.isVeryDark) && source.semanticTags.some(tag => darkFeatureTags.has(tag))) {
    sourceScores.dark_mark = 1;
    sourceScores.internal_feature = Math.max(sourceScores.internal_feature, 0.72);
  }

  const topologyScores = emptyScores();
  topologyScores.background = geometry.isRoot && geometry.touchesDesignBoundaryCount >= 3 ? 1 : 0;
  topologyScores.primary_shape = Math.min(1, (geometry.isRoot ? 0.55 : 0) + (geometry.containsCount >= 2 ? 0.45 : geometry.containsCount * 0.15));
  topologyScores.secondary_shape = geometry.isNested ? 0.75 : (geometry.isRoot ? 0.25 : 0.4);
  topologyScores.internal_feature = geometry.isNested ? 0.85 : 0.2;
  topologyScores.dark_mark = geometry.isNested ? 0.55 : 0.15;
  topologyScores.highlight = geometry.isNested ? 0.65 : 0.1;
  topologyScores.negative_space = source.trustedRoleCandidate === 'negative_space' ? 1 : 0;

  const geometryScores = emptyScores();
  geometryScores.background = geometry.isLarge && geometry.touchesDesignBoundaryCount >= 3 ? 1 : 0;
  geometryScores.primary_shape = geometry.isLarge ? 0.95 : (geometry.containsCount > 0 ? 0.65 : 0.25);
  geometryScores.secondary_shape = geometry.isSmall ? 0.25 : (geometry.isNested ? 0.8 : 0.55);
  geometryScores.internal_feature = geometry.isSmall ? 0.9 : (geometry.isNested ? 0.7 : 0.2);
  geometryScores.dark_mark = geometry.isThin ? 0.9 : (geometry.isSmall ? 0.65 : 0.2);
  geometryScores.highlight = geometry.isSmall ? 0.9 : 0.2;
  geometryScores.negative_space = source.trustedRoleCandidate === 'negative_space' ? 1 : 0;

  const colorScores = emptyScores();
  colorScores.background = color.valid && (color.isLight || color.isNeutral) ? 0.45 : 0.1;
  colorScores.primary_shape = color.valid && color.isChromatic ? 0.55 : 0.25;
  colorScores.secondary_shape = color.valid ? 0.5 : 0;
  colorScores.internal_feature = color.valid ? 0.45 : 0;
  colorScores.dark_mark = color.isVeryDark ? 1 : (color.isDark ? 0.8 : 0);
  colorScores.highlight = color.isVeryLight ? 1 : (color.isLight ? 0.75 : 0);
  colorScores.negative_space = 0;

  if (region?.darkStrokeSupport?.available === true) {
    sourceScores.dark_mark = Math.max(sourceScores.dark_mark, Math.min(1, 0.65 + Number(region.darkStrokeSupport.ratio || 0) * 0.35));
  }
  return { sourceScores, topologyScores, geometryScores, colorScores };
}

function scoreRoles(featureScores, options, source) {
  const scores = emptyScores();
  SCORABLE_ROLES.forEach(role => {
    scores[role] = clampScore(
      featureScores.sourceScores[role] * options.sourceEvidenceWeight
      + featureScores.topologyScores[role] * options.topologyWeight
      + featureScores.geometryScores[role] * options.geometryWeight
      + featureScores.colorScores[role] * options.colorWeight,
    );
  });
  let overrideCandidate = source.trustedRoleCandidate;
  if (featureScores.sourceScores.dark_mark === 1 && source.semanticTags.some(tag => ['pupil', 'mouth', 'nose', 'nostril', 'stroke', 'line', 'darkmark', 'darkdetail'].includes(tag))) {
    overrideCandidate = 'dark_mark';
  }
  if (options.allowSourceRoleOverride && overrideCandidate && source.conflicts.length === 0) {
    scores[overrideCandidate] = Math.max(scores[overrideCandidate], source.confidence);
  }
  return scores;
}

function sourceRoleOf(region) {
  return region?.semanticRole ?? region?.source?.regionClass ?? null;
}

export function analyzeSemanticRegionRoles(regions, graph, inputOptions = {}) {
  const optionValidation = validateSemanticAnalyzerOptions(inputOptions);
  if (!optionValidation.valid) {
    return { assessments: [], byRegionId: {}, valid: false, errors: optionValidation.errors, warnings: [], summary: {}, metadata: { mutationsDetected: false } };
  }
  const options = resolveSemanticAnalysisOptions(inputOptions);
  const sourceRegions = Array.isArray(regions) ? regions : [];
  const before = snapshot(sourceRegions);
  const assessments = [...sourceRegions]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(region => {
      const source = analyzeSourceSemanticEvidence(region);
      const colorFeatures = analyzeArtworkColor(region.visualColor, inputOptions.colorThresholds);
      const geometryFeatures = analyzeRegionGeometryFeatures(region, graph, inputOptions.geometryThresholds);
      const topologyFeatures = {
        parentId: graph?.nodes?.[region.id]?.parentId ?? null,
        childIds: [...(graph?.nodes?.[region.id]?.childIds || [])],
        componentId: graph?.nodes?.[region.id]?.disconnectedComponentId ?? null,
        isInsideExplicitHole: (graph?.metadata?.explicitHoleExclusions || []).some(item => item.regionAId === region.id || item.regionBId === region.id),
      };
      const featureScores = buildFeatureScores(region, source, colorFeatures, geometryFeatures);
      const scores = scoreRoles(featureScores, options, source);
      const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const [bestRole, bestScore] = ranked[0];
      const explicitNegative = source.evidence.some(item => item.code === 'EXPLICIT_NEGATIVE_SPACE');
      let semanticRole = bestScore >= options.minimumAcceptedConfidence ? bestRole : 'unknown';
      if (semanticRole === 'negative_space' && !explicitNegative) semanticRole = 'unknown';
      const sourceRole = sourceRoleOf(region);
      const evidence = [
        ...source.evidence,
        {
          code: 'SOURCE_ROLE_CONSIDERED',
          message: 'Incoming source role was preserved and considered as evidence.',
          sourceValue: sourceRole,
        },
        {
          code: 'DETERMINISTIC_WEIGHTED_SCORE',
          message: `Highest deterministic role score was ${bestRole}=${bestScore.toFixed(6)}.`,
          role: bestRole,
          score: bestScore,
        },
      ];
      if (!colorFeatures.valid) evidence.push({ code: 'INVALID_ARTWORK_COLOR', message: 'Artwork color could not contribute to semantic scoring.' });
      const alternatives = ranked
        .filter(([role]) => role !== semanticRole)
        .slice(0, 2)
        .map(([role, score]) => ({ role, score }));
      return createSemanticRegionAssessmentV2({
        regionId: region.id,
        semanticRole,
        semanticTags: source.semanticTags,
        confidence: bestScore,
        evidence,
        alternatives,
        needsReview: bestScore < options.minimumAcceptedConfidence || semanticRole === 'unknown' || source.conflicts.length > 0,
        sourceRole,
        sourceRoleTrusted: Boolean(source.trustedRoleCandidate && source.conflicts.length === 0),
        colorFeatures,
        geometryFeatures,
        topologyFeatures,
      });
    });
  const byRegionId = Object.fromEntries(assessments.map(assessment => [assessment.regionId, assessment]));
  const summary = {
    roleDistribution: Object.fromEntries(ARTWORK_SEMANTIC_ROLES.map(role => [role, assessments.filter(item => item.semanticRole === role).length])),
    needsReviewCount: assessments.filter(item => item.needsReview).length,
    highConfidenceCount: assessments.filter(item => item.confidence >= options.minimumHighConfidence).length,
  };
  const result = {
    assessments,
    byRegionId,
    valid: true,
    errors: [],
    warnings: [],
    summary,
    metadata: { options, mutationsDetected: before !== snapshot(sourceRegions) },
  };
  const validation = validateSemanticAnalysisResult(result, sourceRegions, graph);
  return { ...result, valid: validation.valid, errors: validation.errors, warnings: validation.warnings };
}
