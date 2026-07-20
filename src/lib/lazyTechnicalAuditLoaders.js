const modulePromises = {};

function loadCached(name, importer) {
  if (!modulePromises[name]) {
    modulePromises[name] = importer().catch((error) => {
      modulePromises[name] = null;
      throw error;
    });
  }
  return modulePromises[name];
}

export function loadRegionCoverageAudit() {
  return loadCached('coverage', () => import('@/lib/audits/regionToCommandCoverageAudit.js'));
}

export function loadPreviewExportParityAudit() {
  return loadCached('parity', () => import('@/lib/audits/previewToExportParityAudit.js'));
}

export function loadEngineProfileBenchmarkAudit() {
  return loadCached('benchmark', () => import('@/lib/audits/engineProfileBenchmark.js'));
}