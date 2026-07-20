// base44/functions/decisionEngine/classifiers/propertyDetector.ts
import { ImageProperties, ColorAnalysis, EdgeAnalysis, TextureAnalysis, ShapeAnalysis, Complexity } from '../../../entities/DecisionResult';

export function detectProperties(
  color: ColorAnalysis,
  edge: EdgeAnalysis,
  texture: TextureAnalysis,
  shape: ShapeAnalysis
): ImageProperties {
  // Sombras: baja luminancia con alta varianza local
  const hasShadows = color.avgBrightness < 0.4 && texture.avgVariance > 200;

  // Degradados: muchos colores únicos pero transiciones suaves (pocos bordes)
  const hasGradients = color.uniqueColors > 50 && edge.edgeDensity < 0.05;

  // Detalles finos: muchas regiones pequeñas o alta densidad de bordes
  const hasFineDetails = shape.regionCount > 500 || edge.edgeDensity > 0.15;

  // Alto contraste: pocos colores con diferencias grandes (bordes fuertes)
  const isHighContrast = color.uniqueColors < 8 && edge.strongEdgeRatio > 0.3;

  return {
    hasShadows,
    hasGradients,
    hasTransparency: color.transparencyRatio > 0.05,
    hasFineDetails,
    isHighContrast,
    colorCount: color.uniqueColors,
    dominantColors: color.dominantColors,
    complexity: calculateComplexity(color, edge, shape)
  };
}

function calculateComplexity(
  color: ColorAnalysis,
  edge: EdgeAnalysis,
  shape: ShapeAnalysis
): Complexity {
  let score = 0;
  
  if (color.uniqueColors > 50) score += 2;
  else if (color.uniqueColors > 16) score += 1;
  
  if (edge.edgeDensity > 0.1) score += 2;
  
  if (shape.regionCount > 200) score += 2;
  else if (shape.regionCount > 50) score += 1;

  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}
