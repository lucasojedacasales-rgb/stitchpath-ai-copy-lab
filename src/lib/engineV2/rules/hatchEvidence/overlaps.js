import { defineHatchEvidenceRules } from './model.js';

const LIMITS = Object.freeze([
  'C_Solapes is closed and must not be reopened; this registry uses the reviewed package unchanged.',
  'Visual analysis only; no DST or physical sew-out exists for this test.',
  'Some green-thumbnail assignments are explicitly identified as inferences in the source workbook.',
]);

export const HATCH_OVERLAP_EVIDENCE_RULES = defineHatchEvidenceRules({
  phase: 'C_Solapes',
  phaseStatus: 'closed-reviewed-package',
  artifactPath: '03_SOLAPES/06_Reglas/HATCH-C-OVERLAPS-reglas.json',
  artifactSha256: '38255ab102e38cb66612d745da8e8a8073187466abbbf887cf313e5333d6e377',
  implementationActive: false,
  limits: LIMITS,
  rules: [
    { id: 'OVERLAP-CUTOUT-001', sourceState: 'candidata', condition: 'Objeto opaco superior sobre relleno inferior', candidateAction: 'Restar la zona cubierta para evitar doble densidad, conservando una tolerancia de registro parametrizable.', confidence: 0.95, evidence: 'C3, C4, C6, C9 y C12' },
    { id: 'SPLIT-OCCLUDED-001', sourceState: 'candidata', condition: 'Una pieza superior cruza completamente otra', candidateAction: 'Permitir subobjetos visibles y mantener un padre lógico para secuencia, edición y optimización.', confidence: 0.98, evidence: 'C4' },
    { id: 'SAME-COLOR-UNION-001', sourceState: 'candidata', condition: 'Componentes conectados con intención de continuidad', candidateAction: 'Aplicar unión geométrica; no fusionar componentes desconectados.', confidence: 0.98, evidence: 'C10 y contraste con H12' },
    { id: 'WHITE-FABRIC-001', sourceState: 'candidata', condition: 'Región blanca sobre el fondo', candidateAction: 'Clasificar explícitamente como exclusión de tela o como objeto bordado.', confidence: 0.99, evidence: 'C5 frente a C6' },
    { id: 'CONTOUR-LAST-001', sourceState: 'candidata', condition: 'Contorno que delimita uno o varios rellenos', candidateAction: 'Secuenciar el contorno después de todos sus rellenos dependientes.', confidence: 0.98, evidence: 'C8, C11 y C12', activatedInProfiles: ['hatch-c-experimental'] },
    { id: 'ADJACENT-UNDERLAP-001', sourceState: 'validando', condition: 'Dos colores comparten borde sin superposición visible', candidateAction: 'Usar underlap o compensación adaptada al tejido; no confiar en una unión geométrica exacta como garantía física.', confidence: 0.82, evidence: 'C1 y C2' },
    { id: 'COLOR-GROUP-HEURISTIC-001', sourceState: 'candidata', condition: 'Optimización global de cambios de color', candidateAction: 'Tratar el agrupado por color como heurística; respetar primero el grafo inferior-superior-contorno.', confidence: 0.95, evidence: 'Secuencia de objetos 2 a 28', activatedInProfiles: ['hatch-c-experimental'] },
    { id: 'MULTILAYER-DEPENDENCY-001', sourceState: 'candidata', condition: 'Tres o más capas concéntricas o anidadas', candidateAction: 'Construir un grafo de precedencia y recortes, no una lista plana basada solo en color.', confidence: 0.95, evidence: 'C12' },
  ],
});
export const HATCH_OVERLAP_REVIEW_AUDIT = Object.freeze({
  artifactPath: '03_SOLAPES/07_Informes/AUDITORIA_C_SOLAPES_2026-07-23.txt',
  artifactSha256: 'a652d1d32a325fd70880b891263f5b7ae73508d42fffa54f18a2443e9c4a9d8b',
  result: 'APROBADO CON CORRECCIONES MENORES DE EMPAQUETADO',
  technicalDataModified: false,
  phaseRemainsClosed: true,
});
