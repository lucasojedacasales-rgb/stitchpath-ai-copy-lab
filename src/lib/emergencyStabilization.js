export const EMERGENCY_PIPELINE_STABILIZATION_AND_REFERENCE_LEARNING_QUARANTINE_V1 = true;

export const referenceLearningEnabled = false;
export const referenceLearningAutoRun = false;
export const referenceLibraryAutoLoad = false;
export const stpTrainingAutoProcess = false;

const perfMarks = new Map();
const vectorizationRuns = [];

export function markEmergencyPerfStart(label) {
  perfMarks.set(label, typeof performance !== 'undefined' ? performance.now() : Date.now());
}

export function markEmergencyPerfEnd(label) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const start = perfMarks.get(label) ?? now;
  const ms = +(now - start).toFixed(1);
  console.log(`[EMERGENCY_PERF] ${label}Ms`, ms);
  return ms;
}

export function recordVectorizationRun(reason, imageUrl, config = {}) {
  const signature = JSON.stringify({ imageUrl, mode: config.mode, width: config.width_mm, height: config.height_mm, colors: config.color_count });
  vectorizationRuns.push({ reason, signature, at: new Date().toISOString() });
  console.log('[VECTORIZE_RUN_CONTROL]', { vectorizationRunCount: vectorizationRuns.length, vectorizationRunReasons: vectorizationRuns.map(r => r.reason) });
  return { vectorizationRunCount: vectorizationRuns.length, vectorizationRunReasons: vectorizationRuns.map(r => r.reason), signature };
}

export function getVectorizationRunAudit() {
  return { vectorizationRunCount: vectorizationRuns.length, vectorizationRunReasons: vectorizationRuns.map(r => r.reason) };
}

export function isReferenceLearningManualOnly() {
  return !referenceLearningEnabled && !referenceLearningAutoRun && !referenceLibraryAutoLoad && !stpTrainingAutoProcess;
}