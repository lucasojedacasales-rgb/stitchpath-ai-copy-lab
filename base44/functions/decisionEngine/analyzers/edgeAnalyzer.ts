// base44/functions/decisionEngine/analyzers/edgeAnalyzer.ts
import { EdgeAnalysis } from '../../../entities/DecisionResult';

export function analyzeEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): EdgeAnalysis {
  const edges = new Uint8Array(width * height);
  let edgeCount = 0;
  let strongEdges = 0;

  // Sobel simplificado
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      
      const getLum = (dx: number, dy: number): number => {
        const i = ((y + dy) * width + (x + dx)) * 4;
        return 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      };

      const gx = 
        -1 * getLum(-1, -1) + 0 * getLum(0, -1) + 1 * getLum(1, -1) +
        -2 * getLum(-1, 0)  + 0 * getLum(0, 0)  + 2 * getLum(1, 0) +
        -1 * getLum(-1, 1)  + 0 * getLum(0, 1)  + 1 * getLum(1, 1);

      const gy = 
        -1 * getLum(-1, -1) + -2 * getLum(0, -1) + -1 * getLum(1, -1) +
         0 * getLum(-1, 0)  +  0 * getLum(0, 0)  +  0 * getLum(1, 0) +
         1 * getLum(-1, 1)  +  2 * getLum(0, 1)  +  1 * getLum(1, 1);

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      
      if (magnitude > 50) {
        edges[y * width + x] = 1;
        edgeCount++;
      }
      if (magnitude > 150) {
        strongEdges++;
      }
    }
  }

  return {
    edgeDensity: edgeCount / (width * height),
    strongEdgeRatio: edgeCount > 0 ? strongEdges / edgeCount : 0,
    edgeComplexity: calculateEdgeComplexity(edges, width, height)
  };
}

function calculateEdgeComplexity(edges: Uint8Array, w: number, h: number): number {
  let corners = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!edges[y * w + x]) continue;
      
      const neighbors = [
        edges[(y - 1) * w + x], edges[(y + 1) * w + x],
        edges[y * w + x - 1], edges[y * w + x + 1]
      ].filter(Boolean).length;

      // Esquina: 2 vecinos no opuestos
      if (neighbors === 2) {
        const vertical = edges[(y - 1) * w + x] && edges[(y + 1) * w + x];
        const horizontal = edges[y * w + x - 1] && edges[y * w + x + 1];
        if (!vertical && !horizontal) corners++;
      }
    }
  }
  return corners / (w * h);
}
