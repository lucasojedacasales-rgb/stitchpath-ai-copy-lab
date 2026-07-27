import { defineHatchEvidenceRules } from './model.js';

const LIMITS = Object.freeze([
  'Technical and visual Hatch evidence only; no physical sew-out was performed.',
  'Pure Cotton lacks complete object-by-object screenshots, although its native EMB is preserved.',
  'Values apply to G1-G7 and must not be extrapolated without validation.',
  'Engine rules must use ranges and conditions rather than blindly copying a single value.',
]);

export const HATCH_FABRIC_EVIDENCE_RULES = defineHatchEvidenceRules({
  phase: 'E_Telas',
  phaseStatus: 'closed',
  artifactPath: '05_TELAS/06_Reglas/E_TELAS_reglas.json',
  artifactSha256: 'f9784669e394a8767974c5c2e50a97a04a5f49fb9641a1582efb62b254f159cc',
  implementationActive: false,
  limits: LIMITS,
  rules: [
    { id: 'E-FAB-001', sourceState: null, condition: { fabricClass: 'stretch_knit', appliesTo: 'satin_objects' }, candidateAction: { stitchType: 'satin', spacingTargetMm: 0.36, underlay: ['center_run_2.0', 'zigzag_5.0_3.0'], pullCompensationMm: 0.4 }, confidence: 'high' },
    { id: 'E-FAB-002', sourceState: null, condition: { fabricClass: 'terry_toweling', appliesTo: 'satin_objects' }, candidateAction: { stitchType: 'satin', spacingTargetMm: 0.4, underlay: ['center_run_2.0', 'zigzag_5.0_5.0'], pullCompensationMm: 0.4 }, confidence: 'high' },
    { id: 'E-FAB-003', sourceState: null, condition: { fabricClass: 'terry_toweling', appliesTo: 'rings_and_holes' }, candidateAction: { stitchType: 'satin', spacingTargetMm: 0.4, underlay: ['center_run_2.0', 'double_zigzag_12.7_5.0'], pullCompensationMm: 0.4 }, confidence: 'high' },
    { id: 'E-FAB-004', sourceState: null, condition: { fabricClass: 'chiffon', appliesTo: 'satin_objects' }, candidateAction: { stitchType: 'satin', spacingTargetMm: 0.43, underlay: ['center_run_2.0'], pullCompensationMm: 0.4 }, confidence: 'high' },
    { id: 'E-FAB-005', sourceState: null, condition: { fabricClass: 'any', appliesTo: 'geometry_classifier' }, candidateAction: 'do_not_reclassify_geometry_or_close_holes_from_fabric_profile_alone', confidence: 'high' },
    { id: 'E-FAB-006', sourceState: null, condition: { fabricClass: 'any', appliesTo: 'micro_details_1.2_to_3.0mm' }, candidateAction: 'preserve_before_simplification_and_then_apply_fabric_modifier', confidence: 'medium' },
  ],
});
