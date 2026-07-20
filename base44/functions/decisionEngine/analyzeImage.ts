// base44/functions/decisionEngine/analyzeImage.ts
import { DecisionResult } from '../../entities/DecisionResult';
import { analyzeColors } from './analyzers/colorAnalyzer';
import { analyzeEdges } from './analyzers/edgeAnalyzer';
import { analyzeTexture } from './analyzers/textureAnalyzer';
import { analyzeShapes } from './analyzers/shapeAnalyzer';
import { classifyContent } from './classifiers/contentClassifier';
import { detectProperties } from './classifiers/propertyDetector';
import { generateStrategy } from './classifiers/strategyGenerator';

/**
 * Carga una imagen desde diferentes fuentes (File, URL, HTMLImageElement)
 */
export async function loadImage(
  source: File | string | HTMLImageElement
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => resolve(img);
    img.onerror = reject;

    if (source instanceof HTMLImageElement) {
      if (source.complete) resolve(source);
      else source.onload = () => resolve(source);
    } else if (source instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target!.result as string; };
      reader.readAsDataURL(source);
    } else {
      img.src = source;
    }
  });
}

/**
 * Función principal: analiza una imagen y devuelve la decisión completa
 */
export async function analyzeImage(
  imageSource: File | string | HTMLImageElement
): Promise<DecisionResult> {
  // 1. Cargar imagen
  const img = await loadImage(imageSource);
  
  // 2. Crear canvas y obtener pixels
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  // Redimensionar para análisis rápido (máximo 512px)
  const maxSize = 512;
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  // 3. Ejecutar analizadores en paralelo
  const [colorAnalysis, edgeAnalysis, textureAnalysis, shapeAnalysis] = await Promise.all([
    Promise.resolve(analyzeColors(pixels, canvas.width, canvas.height)),
    Promise.resolve(analyzeEdges(pixels, canvas.width, canvas.height)),
    Promise.resolve(analyzeTexture(pixels, canvas.width, canvas.height)),
    Promise.resolve(analyzeShapes(pixels, canvas.width, canvas.height))
  ]);

  // 4. Clasificar contenido
  const contentType = classifyContent(colorAnalysis, edgeAnalysis, textureAnalysis, shapeAnalysis);

  // 5. Detectar propiedades
  const properties = detectProperties(colorAnalysis, edgeAnalysis, textureAnalysis, shapeAnalysis);

  // 6. Generar estrategia
  const strategy = generateStrategy(contentType.type, properties);

  // 7. Generar warnings
  const warnings = generateWarnings(properties, contentType, strategy);

  // 8. Estimar colores de hilo
  const estimatedThreadColors = Math.min(colorAnalysis.dominantColors.length, 64);

  return {
    contentType: contentType.type,
    confidence: contentType.confidence,
    properties,
    strategy,
    dimensions: { width: img.width, height: img.height },
    estimatedThreadColors,
    warnings,
    rawAnalysis: {
      color: colorAnalysis,
      edge: edgeAnalysis,
      texture: textureAnalysis,
      shape: shapeAnalysis
    }
  };
}

// Generar warnings basados en el análisis
function generateWarnings(
  properties: DecisionResult['properties'],
  contentType: { type: string; confidence: number },
  strategy: DecisionResult['strategy']
): string[] {
  const warnings: string[] = [];

  if (properties.hasShadows) {
    warnings.push('⚠️ Sombras detectadas. El bordado no reproduce degradados. Se convertirán a colores planos.');
  }

  if (properties.hasGradients) {
    warnings.push('⚠️ Degradados detectados. Se posterizarán a bandas de color discretas.');
  }

  if (properties.colorCount > 32) {
    warnings.push(`⚠️ Muchos colores (${properties.colorCount}). Se reducirán a ${strategy.recommendedParams.maxColors} para bordado.`);
  }

  if (contentType.confidence < 0.5) {
    warnings.push('⚠️ Baja confianza en la clasificación. Revisión manual recomendada.');
  }

  if (properties.hasFineDetails && contentType.type === 'photo') {
    warnings.push('⚠️ Detalles finos en foto pueden perderse. Considera aumentar el tamaño del diseño.');
  }

  if (properties.complexity === 'high') {
    warnings.push('⚠️ Alta complejidad detectada. El archivo de bordado puede ser grande.');
  }

  if (properties.hasTransparency && contentType.type !== 'logo') {
    warnings.push('⚠️ Transparencia detectada. El fondo transparente se tratará como blanco.');
  }

  return warnings;
}
