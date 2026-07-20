// base44/functions/decisionEngine/analyzers/shapeAnalyzer.ts
import { ShapeAnalysis } from '../../../entities/DecisionResult';

export function analyzeShapes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): ShapeAnalysis {
  const visited = new Uint8Array(width * height);
  const regions: { size: number; boundingBox: [number, number, number, number]; solidity: number }[] = [];

  for (let y = 0; y < height; y += 2) { // Skip cada 2px para velocidad
    for (let x = 0; x < width; x += 2) {
      const idx = y * width + x;
      if (visited[idx]) continue;

      const region = floodFill(pixels, width, height, x, y, visited);
      if (region.size > 50) {
        regions.push(region);
      }
    }
  }

  const totalPixels = width * height;
  const largeRegions = regions.filter(r => r.size > totalPixels * 0.01);
  const geometricRegions = regions.filter(r => r.solidity > 0.8);

  return {
    regionCount: regions.length,
    largeRegionCount: largeRegions.length,
    geometricRatio: regions.length > 0 ? geometricRegions.length / regions.length : 0,
    avgRegionSize: regions.length > 0 
      ? regions.reduce((sum, r) => sum + r.size, 0) / regions.length 
      : 0,
    hasClearShapes: regions.length > 0 && geometricRegions.length / regions.length > 0.5
  };
}

function floodFill(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  visited: Uint8Array
) {
  const startIdx = (sy * w + sx) * 4;
  const targetColor = [pixels[startIdx], pixels[startIdx + 1], pixels[startIdx + 2]];
  const stack: [number, number][] = [[sx, sy]];
  const regionPixels: [number, number][] = [];
  
  let minX = sx, maxX = sx, minY = sy, maxY = sy;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const idx = y * w + x;
    
    if (visited[idx]) continue;
    
    const pIdx = idx * 4;
    const currentColor = [pixels[pIdx], pixels[pIdx + 1], pixels[pIdx + 2]];
    
    if (colorDistance(currentColor, targetColor) > 30) continue;

    visited[idx] = 1;
    regionPixels.push([x, y]);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // Vecinos (4-conectividad)
    const neighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dy] of neighbors) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        stack.push([nx, ny]);
      }
    }
  }

  const area = (maxX - minX + 1) * (maxY - minY + 1);
  const solidity = area > 0 ? regionPixels.length / area : 0;

  return {
    size: regionPixels.length,
    boundingBox: [minX, minY, maxX, maxY] as [number, number, number, number],
    solidity
  };
}

function colorDistance(c1: number[], c2: number[]): number {
  return Math.sqrt(
    Math.pow(c1[0] - c2[0], 2) +
    Math.pow(c1[1] - c2[1], 2) +
    Math.pow(c1[2] - c2[2], 2)
  );
}
