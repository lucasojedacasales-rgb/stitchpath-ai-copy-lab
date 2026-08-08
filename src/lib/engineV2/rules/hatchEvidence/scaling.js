import { defineHatchEvidenceRules } from './model.js';

const LIMITS = Object.freeze([
  'Software-only Hatch test; no physical sew-out was performed.',
  'Only Pure Cotton was tested.',
  'The 90%, 81% and 72.9% revisions are cumulative, not independent resizes from baseline.',
  'Physical stability of isolated details below 1 mm remains unverified.',
]);

export const HATCH_SCALING_EVIDENCE_RULES = defineHatchEvidenceRules({
  phase: 'F_Escalado',
  phaseStatus: 'closed-evidence-only',
  artifactPath: '06_ESCALADO/06_Reglas/F_ESCALADO_reglas.json',
  artifactSha256: '3d5c6cc7fd3f8f3aeb251736fe0c0e6cf86b25ca3d17a65637ccc6a6c6194e0f',
  implementationActive: false,
  limits: LIMITS,
  rules: [
    { id: 'F-R01', sourceState: 'candidate', condition: { cumulativeReductions: [100, 90, 81, 72.9] }, candidateAction: { rule: 'Compute effective scale cumulatively when repeated percentage reductions are applied.', formula: 'effectiveScale[n] = effectiveScale[n-1] * 0.90' }, confidence: null, evidence: [100, 90, 81, 72.9] },
    { id: 'F-R02', sourceState: 'candidate', condition: { observedStitchCounts: [2332, 2063, 1772, 1528] }, candidateAction: 'Do not estimate stitch count linearly from geometric scale; regenerate and validate stitches.', confidence: null, evidence: [2332, 2063, 1772, 1528] },
    { id: 'F-R03', sourceState: 'candidate', condition: 'Observed properties remain absolute across revisions.', candidateAction: 'Keep stitch spacing, pull compensation and underlay in physical units unless a separate technique/fabric rule changes them.', confidence: null, evidence: 'Observed properties remain absolute across revisions.' },
    { id: 'F-R04', sourceState: 'high-priority-candidate', condition: { R02MaxJumpMm: 8.8, R03MaxJumpMm: 11.9 }, candidateAction: 'Revalidate max stitch, max jump, trims and connector routing after every scale operation.', confidence: null, evidence: { R02MaxJumpMm: 8.8, R03MaxJumpMm: 11.9 } },
    { id: 'F-R05', sourceState: 'mandatory-data-hygiene', condition: 'A later file named R00-100P had effective 90% geometry and was excluded as baseline.', candidateAction: 'Anchor every scaling corpus to the untouched original 100% EMB and label cumulative scale explicitly.', confidence: null, evidence: 'A later file named R00-100P had effective 90% geometry and was excluded as baseline.' },
    { id: 'F-R06', sourceState: 'candidate', condition: 'All 10 objects survive, including sub-millimetre isolated details.', candidateAction: 'An object surviving in the sequence is not enough; apply minimum sewability thresholds after recalculation.', confidence: null, evidence: 'All 10 objects survive, including sub-millimetre isolated details.' },
  ],
});
