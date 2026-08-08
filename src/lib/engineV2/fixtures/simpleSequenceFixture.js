import { buildTechnicalEmbroideryPlan } from '../technical/technicalPlanningPipeline.js';
import { createSyntheticTechnicalMaterialization, createSyntheticTechnicalObject } from './tatamiTechnicalFixture.js';

export function createSequenceTechnicalFixture(objects) {
  const materialization = createSyntheticTechnicalMaterialization(objects);
  const technicalPlan = buildTechnicalEmbroideryPlan({ regions: materialization.regions, threadedObjectMaterialization: materialization.threadedObjectMaterialization });
  return { ...materialization, objects, technicalPlan };
}

export function createSimpleSequenceFixture() {
  const left = createSyntheticTechnicalObject('sequence-left', { threadId: 'thread:synthetic:green', geometry: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }] });
  const right = createSyntheticTechnicalObject('sequence-right', { threadId: 'thread:synthetic:red', visualColor: '#CC3344', geometry: [{ x: 12, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 8 }, { x: 12, y: 8 }] });
  return createSequenceTechnicalFixture([left, right]);
}

export { createSyntheticTechnicalObject };
