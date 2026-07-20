// base44/functions/decisionEngine/classifiers/contentClassifier.ts
import { ContentType, ColorAnalysis, EdgeAnalysis, TextureAnalysis, ShapeAnalysis } from '../../../entities/DecisionResult';

interface ClassificationResult {
  type: ContentType;
  confidence: number;
}

export function classifyContent(
  color: ColorAnalysis,
  edge: EdgeAnalysis,
  texture: TextureAnalysis,
  shape: ShapeAnalysis
): ClassificationResult {
  const scores: Record<ContentType, number> = {
    logo: 0,
    text: 0,
    anime: 0,
    photo: 0,
    illustration: 0,
    mixed: 0
  };

  // === REGLAS DE CLASIFICACIÓN ===

  // LOGO: Pocos colores, bordes fuertes, formas claras, posible transparencia
  if (color.uniqueColors < 16 && edge.strongEdgeRatio > 0.3 && shape.hasClearShapes) {
    scores.logo += 0.8;
  }
  if (color.transparencyRatio > 0.1) {
    scores.logo += 0.2;
  }
  if (color.colorDistribution === 'dominant' && edge.edgeDensity > 0.05) {
    scores.logo += 0.1;
  }

  // TEXTO: Baja saturación, bordes densos, formas geométricas, pocos colores
  if (color.avgSaturation < 0.2 && edge.edgeDensity > 0.1) {
    scores.text += 0.7;
  }
  if (shape.geometricRatio > 0.7 && color.uniqueColors < 8) {
    scores.text += 0.3;
  }
  if (color.grayscaleRatio > 0.8 && edge.strongEdgeRatio > 0.4) {
    scores.text += 0.2;
  }

  // ANIME: Colores planos, bordes negros fuertes, saturación alta, sin textura foto
  if (!texture.isPhotographic && color.avgSaturation > 0.4 && edge.strongEdgeRatio > 0.2) {
    scores.anime += 0.7;
  }
  if (color.uniqueColors < 32 && texture.smoothRatio > 0.7) {
    scores.anime += 0.3;
  }
  if (edge.edgeDensity > 0.08 && color.avgSaturation > 0.3) {
    scores.anime += 0.1;
  }

  // FOTO: Textura fotográfica, muchos colores, degradados, bordes suaves
  if (texture.isPhotographic) {
    scores.photo += 0.6;
  }
  if (color.uniqueColors > 100 && edge.strongEdgeRatio < 0.2) {
    scores.photo += 0.4;
  }
  if (texture.texturedRatio > 0.4 && color.avgSaturation < 0.5) {
    scores.photo += 0.2;
  }

  // ILUSTRACIÓN: Intermedio entre anime y foto
  if (!texture.isPhotographic && color.uniqueColors > 16 && color.uniqueColors < 64) {
    scores.illustration += 0.5;
  }
  if (shape.regionCount > 20 && shape.regionCount < 200 && !texture.isPhotographic) {
    scores.illustration += 0.3;
  }

  // MIXED: Si no hay un claro ganador
  const values = Object.values(scores);
  const maxScore = Math.max(...values);
  const sorted = [...values].sort((a, b) => b - a);
  if (maxScore - sorted[1] < 0.2) {
    scores.mixed = 0.5;
  }

  // Determinar ganador
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  
  return {
    type: winner[0] as ContentType,
    confidence: Math.min(winner[1], 1.0)
  };
}
