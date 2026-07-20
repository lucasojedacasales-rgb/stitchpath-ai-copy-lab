// base44/functions/decisionEngine/classifiers/strategyGenerator.ts
import { ContentType, ImageProperties, ProcessingStrategy } from '../../../entities/DecisionResult';

export function generateStrategy(
  contentType: ContentType,
  properties: ImageProperties
): ProcessingStrategy {
  // Estrategia base por defecto
  const strategy: ProcessingStrategy = {
    vectorizationMode: 'color-quantize',
    stitchType: 'auto',
    colorReduction: 'light',
    detailPreservation: 'medium',
    recommendedParams: {
      maxColors: 16,
      minRegionArea: 100,
      mergeThreshold: 30,
      simplification: 0.5
    },
    pipeline: ['preprocess', 'vectorize', 'classify-stitches', 'generate', 'optimize']
  };

  // Ajustes según tipo de contenido
  switch (contentType) {
    case 'logo':
      strategy.vectorizationMode = 'edge-trace';
      strategy.stitchType = 'satin';
      strategy.colorReduction = 'none';
      strategy.detailPreservation = 'high';
      strategy.recommendedParams.maxColors = Math.min(properties.colorCount, 16);
      strategy.recommendedParams.simplification = 0.2;
      strategy.recommendedParams.mergeThreshold = 50;
      break;

    case 'text':
      strategy.vectorizationMode = 'edge-trace';
      strategy.stitchType = 'satin';
      strategy.colorReduction = 'none';
      strategy.detailPreservation = 'high';
      strategy.recommendedParams.maxColors = 2;
      strategy.recommendedParams.minRegionArea = 50;
      strategy.recommendedParams.simplification = 0.1;
      // Texto no necesita optimización de path (es secuencial)
      strategy.pipeline = ['preprocess', 'vectorize', 'classify-stitches', 'generate'];
      break;

    case 'anime':
      strategy.vectorizationMode = 'color-quantize';
      strategy.stitchType = 'fill';
      strategy.colorReduction = 'light';
      strategy.detailPreservation = 'medium';
      strategy.recommendedParams.maxColors = 16;
      strategy.recommendedParams.mergeThreshold = 20;
      strategy.recommendedParams.minRegionArea = 80;
      break;

    case 'photo':
      strategy.vectorizationMode = 'posterize';
      strategy.stitchType = 'mixed';
      strategy.colorReduction = 'aggressive';
      strategy.detailPreservation = 'low';
      strategy.recommendedParams.maxColors = 12;
      strategy.recommendedParams.minRegionArea = 200;
      strategy.recommendedParams.simplification = 1.0;
      // Fotos necesitan más preprocesamiento
      strategy.pipeline = ['preprocess', 'preprocess', 'vectorize', 'classify-stitches', 'generate', 'optimize'];
      break;

    case 'illustration':
      strategy.vectorizationMode = 'color-quantize';
      strategy.stitchType = 'mixed';
      strategy.colorReduction = 'light';
      strategy.detailPreservation = 'medium';
      strategy.recommendedParams.maxColors = 24;
      strategy.recommendedParams.mergeThreshold = 25;
      break;

    case 'mixed':
      strategy.vectorizationMode = 'color-quantize';
      strategy.stitchType = 'auto';
      strategy.colorReduction = 'light';
      strategy.detailPreservation = 'medium';
      strategy.recommendedParams.maxColors = 20;
      break;
  }

  // Ajustes según propiedades detectadas
  if (properties.hasShadows) {
    strategy.recommendedParams.simplification += 0.3;
    // Las sombras se convierten a fill con densidad variable
    if (strategy.stitchType === 'satin') strategy.stitchType = 'mixed';
  }

  if (properties.hasGradients) {
    strategy.vectorizationMode = 'posterize';
    strategy.colorReduction = 'aggressive';
    // Forzar más colores para capturar bandas de degradado
    strategy.recommendedParams.maxColors = Math.min(strategy.recommendedParams.maxColors + 4, 32);
  }

  if (properties.hasFineDetails) {
    strategy.detailPreservation = 'high';
    strategy.recommendedParams.minRegionArea = Math.max(50, strategy.recommendedParams.minRegionArea - 50);
  }

  if (properties.isHighContrast) {
    strategy.colorReduction = 'none';
    strategy.recommendedParams.mergeThreshold = 60;
  }

  if (properties.complexity === 'high') {
    // Alta complejidad = más optimización necesaria
    if (!strategy.pipeline.includes('optimize')) {
      strategy.pipeline.push('optimize');
    }
  }

  return strategy;
}
