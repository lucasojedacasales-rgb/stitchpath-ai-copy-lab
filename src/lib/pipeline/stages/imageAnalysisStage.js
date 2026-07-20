/**
 * Stage 1: Image Analysis
 * Input:  ctx.imageUrl, ctx.config
 * Output: ctx.analysis (ImageAnalysisResult)
 */

import { analyzeImage } from '../../imageAnalyzer.js';
import { getModeStrategy } from '../../digitizeModes.js';

export async function runImageAnalysis(ctx) {
  const strategy = getModeStrategy(ctx.config.mode || 'hybrid');
  const analysisSize = strategy.preprocess?.outputSize || 512;
  const colorCount = strategy.vectorizer?.color_count || ctx.config.color_count || 8;

  const raw = await analyzeImage(ctx.imageUrl, colorCount, analysisSize);

  // Classify content type from raw analysis data
  const colorBuckets = raw.dominantColors?.length || 0;
  const edgeAvg = raw.edgeDensityMap
    ? raw.edgeDensityMap.flat().reduce((s, v) => s + v, 0) / (raw.edgeDensityMap.flat().length || 1)
    : 0;

  let contentType = 'illustration';
  let confidence = 0.7;
  if (colorBuckets < 5 && edgeAvg > 0.1)    { contentType = 'logo';         confidence = 0.85; }
  else if (colorBuckets > 10)                { contentType = 'photo';        confidence = 0.80; }
  else if (edgeAvg < 0.04)                   { contentType = 'solid';        confidence = 0.90; }

  ctx.analysis = {
    ...raw,
    contentType,
    confidence,
    hasTransparency: raw.hasTransparency || false,
    hasFineDetails:  edgeAvg > 0.18,
    hasGradients:    colorBuckets > 8,
    complexity:      colorBuckets > 8 ? 'high' : colorBuckets > 4 ? 'medium' : 'low',
  };
}