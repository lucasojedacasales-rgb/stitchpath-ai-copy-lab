/**
 * Intelligent Engine — pure decision logic (no side effects).
 * Analyzes regions and selects the optimal digitizing engine for each one.
 */

export function analyzeRegionComplexity(region) {
  const vertexCount = region.vertices?.length ?? region.vertices ?? 0;
  const area        = region.area || 0;
  const colorCount  = region.colors?.length || 1;

  const complexity = Math.min(1, (
    (vertexCount / 500) * 0.4 +
    (colorCount  / 10)  * 0.3 +
    (area < 1000 ? 0.3 : area > 5000 ? 0.1 : 0.2)
  ));

  return { complexity, vertexCount, area, colorCount };
}

export function selectEngineForRegion(region) {
  const { complexity, area } = analyzeRegionComplexity(region);

  if (complexity > 0.85 && area < 2000) return 'precision';
  if (complexity > 0.9)                 return 'ai';
  if (area > 8000)                      return 'fast';
  if (complexity < 0.3 && area > 3000)  return 'fast';
  return 'hybrid';
}

export function generateProcessingPlan(regions) {
  const plan = regions.map(region => ({
    regionId:      region.id,
    engine:        selectEngineForRegion(region),
    reason:        getEngineReason(region),
    estimatedTime: getEstimatedTime(region),
  }));

  const stats = {
    fast:               plan.filter(p => p.engine === 'fast').length,
    precision:          plan.filter(p => p.engine === 'precision').length,
    hybrid:             plan.filter(p => p.engine === 'hybrid').length,
    ai:                 plan.filter(p => p.engine === 'ai').length,
    totalRegions:       regions.length,
    estimatedTotalTime: plan.reduce((sum, p) => sum + p.estimatedTime, 0),
  };

  return { plan, stats };
}

function getEngineReason(region) {
  const { complexity, area } = analyzeRegionComplexity(region);
  if (complexity > 0.85 && area < 2000) return 'Detalles finos detectados — precisión máxima requerida';
  if (complexity > 0.9)                 return 'Región compleja — IA necesaria para clasificación óptima';
  if (area > 8000)                      return 'Región grande — motor rápido para eficiencia';
  if (complexity < 0.3 && area > 3000)  return 'Región simple y grande — procesamiento rápido';
  return 'Balance óptimo — motor híbrido';
}

function getEstimatedTime(region) {
  const { area, complexity } = analyzeRegionComplexity(region);
  return Math.round((area * 0.001 + complexity * 2) * 10) / 10;
}