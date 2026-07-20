// base44/entities/DecisionResult.ts
export type ContentType = 'logo' | 'text' | 'anime' | 'photo' | 'illustration' | 'mixed';

export type Complexity = 'low' | 'medium' | 'high';

export type VectorizationMode = 'posterize' | 'edge-trace' | 'color-quantize' | 'skip';

export type StitchType = 'fill' | 'satin' | 'running' | 'mixed' | 'auto';

export type ColorReduction = 'none' | 'light' | 'aggressive';

export type DetailPreservation = 'high' | 'medium' | 'low';

export type PipelineStep = 'preprocess' | 'vectorize' | 'classify-stitches' | 'generate' | 'optimize';

export interface ColorAnalysis {
  uniqueColors: number;
  dominantColors: string[]; // hex
  transparencyRatio: number;
  grayscaleRatio: number;
  avgSaturation: number;
  avgBrightness: number;
  colorDistribution: 'uniform' | 'dominant' | 'scattered';
}

export interface EdgeAnalysis {
  edgeDensity: number;
  strongEdgeRatio: number;
  edgeComplexity: number;
}

export interface TextureAnalysis {
  avgVariance: number;
  smoothRatio: number;
  texturedRatio: number;
  isPhotographic: boolean;
}

export interface ShapeAnalysis {
  regionCount: number;
  largeRegionCount: number;
  geometricRatio: number;
  avgRegionSize: number;
  hasClearShapes: boolean;
}

export interface ImageProperties {
  hasShadows: boolean;
  hasGradients: boolean;
  hasTransparency: boolean;
  hasFineDetails: boolean;
  isHighContrast: boolean;
  colorCount: number;
  dominantColors: string[];
  complexity: Complexity;
}

export interface ProcessingStrategy {
  vectorizationMode: VectorizationMode;
  stitchType: StitchType;
  colorReduction: ColorReduction;
  detailPreservation: DetailPreservation;
  recommendedParams: {
    maxColors: number;
    minRegionArea: number;
    mergeThreshold: number;
    simplification: number;
  };
  pipeline: PipelineStep[];
}

export interface DecisionResult {
  contentType: ContentType;
  confidence: number;
  properties: ImageProperties;
  strategy: ProcessingStrategy;
  dimensions: { width: number; height: number };
  estimatedThreadColors: number;
  warnings: string[];
  rawAnalysis: {
    color: ColorAnalysis;
    edge: EdgeAnalysis;
    texture: TextureAnalysis;
    shape: ShapeAnalysis;
  };
}
