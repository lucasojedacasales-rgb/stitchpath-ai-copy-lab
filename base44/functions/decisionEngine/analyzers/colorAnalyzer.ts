// base44/functions/decisionEngine/analyzers/colorAnalyzer.ts
import { ColorAnalysis } from '../../../entities/DecisionResult';

export function analyzeColors(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): ColorAnalysis {
  const colorMap = new Map<string, number>();
  const totalPixels = width * height;
  let transparentPixels = 0;
  let grayscalePixels = 0;
  let saturationSum = 0;
  let brightnessSum = 0;
  let validPixels = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    if (a < 128) {
      transparentPixels++;
      continue;
    }

    validPixels++;
    const { h, s, l } = rgbToHsl(r, g, b);
    saturationSum += s;
    brightnessSum += l;

    // Detectar escala de grises
    if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15) {
      grayscalePixels++;
    }

    // Cuantizar para conteo de colores únicos
    const quantized = quantizeColor(r, g, b, 8);
    colorMap.set(quantized, (colorMap.get(quantized) || 0) + 1);
  }

  const dominantColors = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([color]) => color);

  const validPixelCount = validPixels || 1;

  return {
    uniqueColors: colorMap.size,
    dominantColors,
    transparencyRatio: transparentPixels / totalPixels,
    grayscaleRatio: grayscalePixels / validPixelCount,
    avgSaturation: saturationSum / validPixelCount,
    avgBrightness: brightnessSum / validPixelCount,
    colorDistribution: calculateColorDistribution(colorMap)
  };
}

// Helpers
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function quantizeColor(r: number, g: number, b: number, levels: number = 8): string {
  const step = 255 / levels;
  const q = (v: number) => Math.round(v / step) * step;
  const qr = q(r), qg = q(g), qb = q(b);
  return `#${qr.toString(16).padStart(2, '0')}${qg.toString(16).padStart(2, '0')}${qb.toString(16).padStart(2, '0')}`;
}

function calculateColorDistribution(
  colorMap: Map<string, number>
): 'uniform' | 'dominant' | 'scattered' {
  const values = Array.from(colorMap.values()).sort((a, b) => b - a);
  const total = values.reduce((a, b) => a + b, 0);
  const top3Ratio = values.slice(0, 3).reduce((a, b) => a + b, 0) / total;
  
  if (top3Ratio > 0.8) return 'dominant';
  if (top3Ratio < 0.3) return 'scattered';
  return 'uniform';
}
