import { defineHatchEvidenceRules } from './model.js';

const LIMITS = Object.freeze([
  'The phase is closed as evidence, but none of its candidate actions is active in the engine.',
  'No physical sew-out or DST export was performed.',
  'Hatch did not expose underlay for F3; it must remain recorded as not exposed/not applicable.',
]);

export const HATCH_TECHNIQUE_EVIDENCE_RULES = defineHatchEvidenceRules({
  phase: 'D_Técnicas',
  phaseStatus: 'closed',
  artifactPath: '04_TECNICAS/06_Reglas/HATCH-D-TECHNIQUES-reglas.json',
  artifactSha256: 'a33c4b46d35250b2bae1d4b501abe40b631fd1cd5b89c8926a794df7e4664aef',
  implementationActive: false,
  limits: LIMITS,
  rules: [
    { id: 'TECHNIQUE-TATAMI-UNDERLAY-CONTROL-001', sourceState: 'candidata', condition: null, candidateAction: 'Tratar el underlay como una decisión independiente. F1 y F4 usan Tatami equivalente, pero el resultado estructural cambia al retirar los dos refuerzos.', confidence: 0.97, evidence: ['F1', 'F4'], notes: ['The source rule declares no separate conditions field.'] },
    { id: 'TECHNIQUE-SATIN-WIDE-DIVISION-001', sourceState: 'candidata', condition: null, candidateAction: 'No cambiar automáticamente a Tatami solo por anchura. Evaluar división automática, longitud máxima y geometría antes de descartar Satín.', confidence: 0.94, evidence: ['F2'], notes: ['The source rule declares no separate conditions field.'] },
    { id: 'TECHNIQUE-UNDULATING-SEPARATE-001', sourceState: 'candidata', condition: null, candidateAction: "Modelar Ondulante como técnica diferenciada con espaciado y longitud propios. Cuando Hatch no exponga underlay, registrar 'no expuesto/no aplicable', no asumir desactivado.", confidence: 0.96, evidence: ['F3'], notes: ['The source rule declares no separate conditions field.'] },
    { id: 'TECHNIQUE-RUNNING-PASS-COUNT-001', sourceState: 'candidata', condition: null, candidateAction: 'Distinguir running sencillo y triple como técnicas diferentes; no simular triple running aumentando densidad de una única línea.', confidence: 0.99, evidence: ['L1', 'L2'], notes: ['The source rule declares no separate conditions field.'] },
    { id: 'TECHNIQUE-ZIGZAG-TOP-STITCH-001', sourceState: 'candidata', condition: null, candidateAction: 'Cuando Zigzag sea la puntada principal de diagnóstico, desactivar refuerzos adicionales para no mezclar técnicas.', confidence: 0.97, evidence: ['L3'], notes: ['The source rule declares no separate conditions field.'] },
    { id: 'TECHNIQUE-BOUNDARY-PAIR-001', sourceState: 'candidata', condition: null, candidateAction: 'Representar límite exterior e interior como dos objetos running independientes. No tratar Boundary only como nombre de puntada ni rellenar la banda.', confidence: 0.99, evidence: ['L4'], notes: ['The source rule declares no separate conditions field.'] },
  ],
});
