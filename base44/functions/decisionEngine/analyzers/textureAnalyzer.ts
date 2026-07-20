// base44/functions/decisionEngine/analyzers/textureAnalyzer.ts
import { TextureAnalysis } from '../../../entities/DecisionResult';

export function analyzeTexture(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): TextureAnalysis {
  const blockSize = 4;
  const blocksW = Math.floor(width / blockSize);
  const blocksH = Math.floor(height / blockSize);
  
  let varianceSum = 0;
  let smoothBlocks = 0;
  let texturedBlocks = 0;

  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      let blockMean = 0;
      let count = 0;
      const lums: number[] = [];

      // Calcular luminancias del bloque
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const x = bx * blockSize + dx;
          const y = by * blockSize + dy;
          const idx = (y * width + x) * 4;
          const lum = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
          lums.push(lum);
          blockMean += lum;
          count++;
        }
      }
      blockMean /= count;

      // Calcular varianza
      let blockVariance = 0;
      for (const lum of lums) {
        blockVariance += Math.pow(lum - blockMean, 2);
      }
      blockVariance /= count;
      varianceSum += blockVariance;

      if (blockVariance < 50) smoothBlocks++;
      else if (blockVariance > 500) texturedBlocks++;
    }
  }

  const totalBlocks = blocksW * blocksH || 1;

  return {
    avgVariance: varianceSum / totalBlocks,
    smoothRatio: smoothBlocks / totalBlocks,
    texturedRatio: texturedBlocks / totalBlocks,
    isPhotographic: texturedBlocks / totalBlocks > 0.3
  };
}
