import { createEmbroideryObjectV2, createRegionV2, createThreadDefinitionV2 } from '../model.js';

const normalized = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];

export function createSyntheticTechnicalObject(id, options = {}) {
  return createEmbroideryObjectV2({
    id: `object:${id}`, regionId: `region:${id}`, role: options.role || 'base_fill', stitchType: options.stitchType || 'tatami',
    geometry: options.geometry || [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }], holes: options.holes || [], visualColor: options.visualColor || '#22AA55',
    layer: options.layer ?? 0, dependencyIds: options.dependencyIds || [], threadId: options.threadId || 'thread:synthetic:green', entryCandidates: [], exitCandidates: [],
    parameters: { technicalIntent: options.technicalIntent || { geometryType: 'region_polygon' }, deferred: { threadAssignment: false, stitchGeneration: true, underlayPlanning: true, fillAngleSelection: true, densitySelection: true, pullCompensation: true, entryExitPlanning: true, globalSequencing: true, machineAdaptation: true } },
    confidence: options.confidence ?? 0.95, source: { fixture: 'synthetic_phase_7', technicalGeometryIntent: options.technicalGeometryIntent || options.technicalIntent?.geometryType || 'region_polygon' },
  });
}

export function createSyntheticTechnicalMaterialization(objects) {
  const threadIds = [...new Set(objects.map(item => item.threadId))].sort();
  const threads = threadIds.map(id => createThreadDefinitionV2({ id, visualColorSamples: [...new Set(objects.filter(item => item.threadId === id).map(item => item.visualColor))], machineColor: { hex: objects.find(item => item.threadId === id).visualColor, name: id, manufacturer: null, code: null, catalogEntryId: id.replace('thread:', '') }, colorFamily: 'synthetic', source: { fixture: 'synthetic_phase_7' }, confidence: 1 }));
  const regions = objects.map(object => createRegionV2({ id: object.regionId, geometry: normalized, visualColor: object.visualColor, source: { fixture: 'synthetic_phase_7' } }));
  const byId = new Map(objects.map(item => [item.id, item])); const emitted = new Set(); const executionLayers = [];
  while (emitted.size < objects.length) { const ready = [...byId.keys()].filter(id => !emitted.has(id) && byId.get(id).dependencyIds.every(dependencyId => emitted.has(dependencyId))).sort(); if (!ready.length) break; executionLayers.push(ready); ready.forEach(id => emitted.add(id)); }
  return { regions, threadedObjectMaterialization: { version: '2-threaded-object-materialization', objects, threads, executionLayers, valid: true, errors: [], warnings: [], summary: { finalObjectCount: objects.length, dependencyCycleCount: objects.length - emitted.size }, metadata: { inputMutationsDetected: false } } };
}

export function createTatamiTechnicalFixture() {
  const valid = createSyntheticTechnicalObject('tatami-valid');
  const withHole = createSyntheticTechnicalObject('tatami-hole', { holes: [[{ x: 7, y: 3 }, { x: 13, y: 3 }, { x: 13, y: 7 }, { x: 7, y: 7 }]] });
  const tiny = createSyntheticTechnicalObject('tatami-tiny', { geometry: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] });
  const degenerate = createSyntheticTechnicalObject('tatami-degenerate', { geometry: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] });
  return { valid, withHole, tiny, degenerate, ...createSyntheticTechnicalMaterialization([valid, withHole, tiny, degenerate]) };
}
