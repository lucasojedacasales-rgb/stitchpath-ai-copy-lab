import { adaptV1RegionsToRegionV2 } from './v1RegionAdapter.js';
import { buildRegionGraphV2 } from '../topology/regionGraph.js';
import { validateRegionGraphV2 } from '../topology/regionGraphValidation.js';

export function ingestV1RegionsToRegionGraphV2(regions, options = {}) {
  const ingestion = adaptV1RegionsToRegionV2(regions, options);
  const graph = buildRegionGraphV2(ingestion.regions, options);
  const graphValidation = validateRegionGraphV2(graph, ingestion.regions);
  const hasFatalRejection = ingestion.rejected.some(item =>
    (item.errors || []).some(error => error.code !== 'HIDDEN_REGION_SKIPPED'));
  return {
    ...ingestion,
    graph,
    graphValidation,
    valid: !hasFatalRejection && graphValidation.valid,
  };
}

export const ingestRegionsV2 = ingestV1RegionsToRegionGraphV2;
