import { analyzeEmbroideryObjectGeometry } from '../../technical/objectGeometryMetrics.js';
import { validateTechnicalPlanningConfig } from '../../technical/technicalPlanningConfig.js';
import { defineHatchEvidenceRules } from './model.js';
import { hatchEvidenceContextMatchesPureCotton } from './profiles.js';

const SATIN_RANGE_RULE_ID = 'SATIN-RANGE-OBSERVED-001';
const LOCAL_WIDTH_RULE_ID = 'LOCAL-WIDTH-PROFILE-001';
const OBSERVED_MINIMUM_HEIGHT_MM = 13;
const OBSERVED_MAXIMUM_HEIGHT_MM = 16;
const VERTICAL_AXIS_TOLERANCE_DEGREES = 1;
const MEASUREMENT_TOLERANCE_MM = 1e-6;

const LIMITS = Object.freeze([
  'Visual analysis only; no physical sew-out was performed.',
  'Observed on Pure Cotton and the A1-D6 geometry families.',
  'Thresholds depend on fabric, height, stitch length, automatic division and geometry.',
]);

export const HATCH_WIDTH_EVIDENCE_LIMITS = Object.freeze({
  maximumSourceSatinWidthMm: 9,
  maximumObservedSatinWidthMm: 9.18,
  observedPullCompensationMm: 0.4,
});

export const HATCH_WIDTH_EVIDENCE_RULES = defineHatchEvidenceRules({
  phase: 'A_Anchuras',
  phaseStatus: 'visual-analysis-complete',
  artifactPath: '01_ANCHURAS/06_Reglas/HATCH-A-WIDTHS-reglas.json',
  artifactSha256: 'af0f84318ed59b5979827ca0ed8f188472b511c1408fc25f1a8c7d6d5833d698',
  implementationActive: true,
  limits: LIMITS,
  rules: [
    { id: 'SATIN-RANGE-OBSERVED-001', sourceState: 'candidata', implementationActive: true, condition: 'Objetos columna/cápsula de unos 13–16 mm de alto sobre Pure Cotton.', candidateAction: 'Mantener satín como candidato al menos hasta 9,18 mm y validar longitud máxima, división y geometría antes de cambiar a tatami.', confidence: 0.95, evidence: ['A1-A8', 'B1-B6', 'C1-C6', 'D1-D6'] },
    { id: 'LOCAL-WIDTH-PROFILE-001', sourceState: 'candidata', implementationActive: true, condition: 'Formas con anchura variable, curvas o extremos afilados/redondeados.', candidateAction: 'Usar anchura local, anchura media, porcentaje de longitud cerca del máximo, curvatura, relación longitud/anchura y forma de extremos; no usar solo la caja delimitadora.', confidence: 0.98, evidence: ['A7 vs C5/C6', 'A vs B', 'A vs D'] },
    { id: 'UNDERLAY-GEOMETRY-001', sourceState: 'candidata', condition: 'Objetos satinados sobre Pure Cotton.', candidateAction: 'Corrido centrado en formas estrechas; corrido de borde + zigzag cuando la anchura sostenida y geometría superen el umbral propio de la familia.', confidence: 0.96, evidence: ['A5/A6', 'B3/B4', 'C3/C4', 'D3/D4'] },
    { id: 'SPACING-GEOMETRY-001', sourceState: 'candidata', condition: 'Satín con división automática.', candidateAction: 'Aplicar 0,36 mm manual cuando la anchura alta se mantenga durante suficiente longitud; conservar automático en formas afiladas con sección variable.', confidence: 0.95, evidence: ['A7/A8', 'B5/B6', 'C5/C6', 'D5/D6'] },
    { id: 'PULL-COMP-COTTON-040-001', sourceState: 'candidata', condition: 'Pure Cotton, familias A-D de esta lámina.', candidateAction: 'Usar 0,40 mm como valor inicial de referencia, nunca como constante universal.', confidence: 0.9, evidence: ['A1-D6'] },
  ],
});

export function analyzeHatchLocalWidthProfile({ geometryMm = [], holesMm = [] } = {}) {
  const metrics = analyzeEmbroideryObjectGeometry({ id: 'hatch-width-analysis', geometry: geometryMm, holes: holesMm, stitchType: 'satin' });
  return Object.freeze({
    valid: metrics.geometryValid && metrics.holeGeometryValid,
    widthMm: metrics.widthMm,
    heightMm: metrics.heightMm,
    minimumWidthMm: metrics.estimatedMinimumWidthMm,
    medianWidthMm: metrics.estimatedMedianWidthMm,
    maximumWidthMm: metrics.estimatedMaximumWidthMm,
    widthVariationRatio: metrics.widthVariationRatio,
    aspectRatio: metrics.aspectRatio,
    principalAxisDegrees: metrics.principalAxisDegrees,
    hasHoles: metrics.hasHoles,
    measurementMethod: 'engine_v2_principal_axis_local_width_bins',
  });
}

function enabled(enabledRuleIds, ruleId) {
  return Array.isArray(enabledRuleIds) && enabledRuleIds.includes(ruleId);
}

function verticalReferenceGeometry(profile) {
  return Number.isFinite(profile.principalAxisDegrees)
    && Math.abs(profile.principalAxisDegrees - 90) <= VERTICAL_AXIS_TOLERANCE_DEGREES
    && profile.heightMm >= OBSERVED_MINIMUM_HEIGHT_MM - MEASUREMENT_TOLERANCE_MM
    && profile.heightMm <= OBSERVED_MAXIMUM_HEIGHT_MM + MEASUREMENT_TOLERANCE_MM
    && profile.heightMm >= profile.widthMm;
}

export function evaluateHatchWidthTechniqueCandidate({
  legacyTechnique,
  geometryMm = [],
  holesMm = [],
  context = {},
  technicalConfig,
  enabledRuleIds = [],
  minimumSatinWidthMm,
  minimumSatinAspectRatio,
} = {}) {
  const satinRangeEnabled = enabled(enabledRuleIds, SATIN_RANGE_RULE_ID);
  const localWidthEnabled = enabled(enabledRuleIds, LOCAL_WIDTH_RULE_ID);
  if (!satinRangeEnabled && !localWidthEnabled) {
    return Object.freeze({
      applied: false,
      technique: legacyTechnique,
      legacyTechnique,
      candidateActionApplied: false,
      localWidthProfile: null,
      ruleIds: [],
      evaluations: [],
      evidence: [],
    });
  }

  const localWidthProfile = analyzeHatchLocalWidthProfile({ geometryMm, holesMm });
  const contextCompatible = hatchEvidenceContextMatchesPureCotton(context) && context.referenceScaleCompatible === true;
  const geometryCompatible = localWidthProfile.valid && !localWidthProfile.hasHoles;
  const baseWidthCompatible = Number.isFinite(minimumSatinWidthMm)
    && Number.isFinite(minimumSatinAspectRatio)
    && localWidthProfile.medianWidthMm >= minimumSatinWidthMm
    && localWidthProfile.aspectRatio >= minimumSatinAspectRatio;
  const technicalConfigProvided = technicalConfig !== null
    && typeof technicalConfig === 'object'
    && !Array.isArray(technicalConfig);
  const technicalValidation = satinRangeEnabled && technicalConfigProvided
    ? validateTechnicalPlanningConfig(technicalConfig)
    : null;
  const effectiveTechnicalSatinMaximumWidthMm = technicalValidation?.config?.satin?.maximumWidthMm;
  const technicalLimitCompatible = technicalValidation?.valid === true
    && Number.isFinite(effectiveTechnicalSatinMaximumWidthMm)
    && localWidthProfile.maximumWidthMm <= effectiveTechnicalSatinMaximumWidthMm + MEASUREMENT_TOLERANCE_MM;
  const heightAndOrientationCompatible = verticalReferenceGeometry(localWidthProfile);
  const sourceFamilyWidthCompatible = Number.isFinite(localWidthProfile.maximumWidthMm)
    && localWidthProfile.maximumWidthMm
      <= HATCH_WIDTH_EVIDENCE_LIMITS.maximumSourceSatinWidthMm + MEASUREMENT_TOLERANCE_MM;
  const withinAccreditedSourceFamily = baseWidthCompatible
    && sourceFamilyWidthCompatible
    && heightAndOrientationCompatible;
  const satinRangeApplicable = satinRangeEnabled
    && contextCompatible
    && geometryCompatible
    && technicalLimitCompatible
    && withinAccreditedSourceFamily;
  const satinCandidateApplied = satinRangeApplicable && legacyTechnique === 'tatami';
  const technique = satinCandidateApplied ? 'satin' : legacyTechnique;
  const evaluations = [
    ...(localWidthEnabled ? [{
      ruleId: LOCAL_WIDTH_RULE_ID,
      evaluated: true,
      applicable: contextCompatible && geometryCompatible,
      applied: contextCompatible && geometryCompatible,
      candidateActionApplied: false,
      measuredFields: [
        'minimumWidthMm',
        'medianWidthMm',
        'maximumWidthMm',
        'widthVariationRatio',
        'aspectRatio',
        'principalAxisDegrees',
      ],
      unavailableFields: ['meanWidthMm', 'sustainedMaximumPercentage', 'curvature', 'endShape'],
      fallbackReason: !contextCompatible ? 'context_outside_evidence'
        : !geometryCompatible ? 'geometry_outside_evidence'
          : null,
      localWidthProfile,
    }] : []),
    ...(satinRangeEnabled ? [{
      ruleId: SATIN_RANGE_RULE_ID,
      evaluated: true,
      applicable: satinRangeApplicable,
      applied: satinCandidateApplied,
      candidateActionApplied: satinCandidateApplied,
      observedHeightRangeMm: [OBSERVED_MINIMUM_HEIGHT_MM, OBSERVED_MAXIMUM_HEIGHT_MM],
      maximumSourceSatinWidthMm: HATCH_WIDTH_EVIDENCE_LIMITS.maximumSourceSatinWidthMm,
      maximumObservedSatinWidthMm: HATCH_WIDTH_EVIDENCE_LIMITS.maximumObservedSatinWidthMm,
      effectiveTechnicalSatinMaximumWidthMm: Number.isFinite(effectiveTechnicalSatinMaximumWidthMm)
        ? effectiveTechnicalSatinMaximumWidthMm
        : null,
      technicalConfigValidationPassed: technicalValidation?.valid === true,
      fallbackReason: !contextCompatible ? 'context_outside_evidence'
        : !geometryCompatible ? 'geometry_outside_evidence'
          : !heightAndOrientationCompatible ? 'height_or_orientation_outside_evidence'
            : !baseWidthCompatible ? 'width_or_aspect_outside_evidence'
              : !sourceFamilyWidthCompatible ? 'width_above_source_family'
                : !technicalConfigProvided ? 'technical_config_not_provided'
                  : technicalValidation?.valid !== true ? 'technical_config_invalid'
                    : !technicalLimitCompatible ? 'width_above_technical_maximum'
                  : legacyTechnique !== 'tatami' ? 'legacy_decision_retained'
                    : null,
      localWidthProfile,
    }] : []),
  ];
  const evidence = [
    ...(localWidthEnabled && contextCompatible && geometryCompatible ? [{
      code: 'HATCH_A_LOCAL_WIDTH_PROFILE_EVALUATED',
      message: 'Only the available Engine V2 local-width fields were evaluated; unavailable Hatch fields were not claimed.',
      source: LOCAL_WIDTH_RULE_ID,
    }] : []),
    ...(satinCandidateApplied ? [{
      code: 'HATCH_A_SATIN_CANDIDATE_SELECTED',
      message: 'Satin remains a candidate inside the observed range and the effective technical satin maximum.',
      source: SATIN_RANGE_RULE_ID,
    }] : []),
  ];
  return Object.freeze({
    applied: evaluations.some(evaluation => evaluation.applied),
    technique,
    legacyTechnique,
    candidateActionApplied: satinCandidateApplied,
    localWidthProfile,
    ruleIds: evaluations.map(evaluation => evaluation.ruleId),
    evaluations: Object.freeze(evaluations.map(evaluation => Object.freeze(evaluation))),
    downstreamValidationRequired: satinRangeEnabled ? ['maximum_stitch_length', 'automatic_division', 'geometry'] : [],
    evidence: Object.freeze(evidence.map(item => Object.freeze(item))),
  });
}
