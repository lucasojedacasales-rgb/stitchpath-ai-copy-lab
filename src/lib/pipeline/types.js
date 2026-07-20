/**
 * pipeline/types.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Canonical data contracts for the embroidery digitization pipeline.
 * Every stage consumes and produces these well-defined objects.
 * NO stage imports from another stage — all communication is through these types.
 *
 * Pipeline:
 *  ImageAnalysisResult
 *    → EnhancedImageResult
 *    → ContourSet
 *    → VectorRegion[]
 *    → EnrichedRegion[]
 *    → StitchPlan
 *    → OptimizedPlan
 *    → SimulationScene
 *    → ExportPayload
 */

// ─── Stage 1: Image Analysis ─────────────────────────────────────────────────

/**
 * @typedef {Object} DominantColor
 * @property {string}   hex       - '#rrggbb'
 * @property {number[]} rgb       - [r, g, b] 0–255
 * @property {number}   coverage  - fraction of image 0–1
 */

/**
 * @typedef {Object} ColorRegionBbox
 * @property {string}  hex
 * @property {number}  coverage
 * @property {number}  minX  - normalized 0–1
 * @property {number}  maxX
 * @property {number}  minY
 * @property {number}  maxY
 * @property {number}  pixelCount
 */

/**
 * @typedef {Object} ImageAnalysisResult
 * @property {string}          imageUrl        - original URL
 * @property {number}          imageWidth      - px
 * @property {number}          imageHeight     - px
 * @property {number}          aspectRatio
 * @property {DominantColor[]} dominantColors
 * @property {ColorRegionBbox[]} colorRegions
 * @property {number[][]}      edgeDensityMap  - NxN grid 0–1
 * @property {number}          analysisW       - downscaled analysis width
 * @property {number}          analysisH
 * @property {'logo'|'photo'|'illustration'|'solid'} contentType
 * @property {number}          confidence      - 0–1
 * @property {boolean}         hasTransparency
 * @property {boolean}         hasFineDetails
 * @property {boolean}         hasGradients
 * @property {'low'|'medium'|'high'} complexity
 */

// ─── Stage 2: Image Enhancement ──────────────────────────────────────────────

/**
 * @typedef {Object} EnhancedImageResult
 * @property {string}  originalUrl
 * @property {string}  enhancedUrl    - URL after preprocessing
 * @property {Blob}    blob
 * @property {number}  width
 * @property {number}  height
 * @property {Object}  appliedSettings - the preprocess options used
 */

// ─── Stage 3: Contour Engine ──────────────────────────────────────────────────

/**
 * @typedef {Object} RawContourRegion
 * @property {string}   hex
 * @property {number[]} rgb
 * @property {number}   coverage        - fraction of image
 * @property {number}   pixelCount
 * @property {number}   area_norm       - polygon area in [0,1]² space
 * @property {number}   perimeter_norm  - polygon perimeter in [0,1]² space
 * @property {number}   compacidad      - 4π·area/perim² (1=circle)
 * @property {number}   inertia_ratio   - PCA eigenvalue ratio (1=circle, >3=elongated)
 * @property {number}   bbox_aspect     - bounding box w/h
 * @property {number}   fill_angle      - PCA dominant angle, degrees [0,180)
 * @property {number[]} centroid        - [cx, cy] normalized
 * @property {number[][]} path_points   - normalized [[x,y], ...] closed polygon
 * @property {Object}   bbox            - {minX, maxX, minY, maxY} in px
 */

/**
 * @typedef {Object} ContourSet
 * @property {RawContourRegion[]} regions
 * @property {number}  imageWidth
 * @property {number}  imageHeight
 * @property {number}  analysisW
 * @property {number}  analysisH
 */

// ─── Stage 4: Vector Engine (AI labeling + geometry classification) ───────────

/**
 * @typedef {Object} VectorRegion
 * @property {string}  id
 * @property {string}  name
 * @property {string}  color              - '#rrggbb'
 * @property {'fill'|'satin'|'running_stitch'} stitch_type
 * @property {number}  density            - mm row spacing
 * @property {number}  angle              - fill angle degrees
 * @property {number}  layer_order        - 1=bottom
 * @property {number}  pull_compensation  - mm
 * @property {boolean} underlay
 * @property {number}  area_mm2
 * @property {number}  perimeter_mm
 * @property {number[]} centroid          - [cx, cy] normalized
 * @property {number}  stitch_count
 * @property {boolean} is_auto_contour
 * @property {boolean} visible
 * @property {number[][]} path_points
 * @property {Object}  _metrics           - raw geometric metrics from contour stage
 */

// ─── Stage 5: Region Builder (enrichment) ────────────────────────────────────

/**
 * @typedef {Object} EnrichedRegion
 * @extends VectorRegion
 * @property {number}  orientation        - dominant angle degrees
 * @property {number}  convexity          - 0–1
 * @property {number}  curvature          - mean curvature
 * @property {{score:number, level:string}} complexity
 * @property {number}  holes
 * @property {number}  estimatedTime      - minutes
 * @property {{mm:number, grams:number}} estimatedThread
 * @property {number}  priority           - 1–5
 * @property {number}  qualityScore       - 0–100
 * @property {number}  travelOrder        - sequencing index
 */

// ─── Stage 6: Stitch Planner ──────────────────────────────────────────────────

/**
 * @typedef {Object} RegionPlan
 * @property {string}  regionId
 * @property {string}  regionName
 * @property {string}  color
 * @property {number}  areaMm2
 * @property {'fill'|'satin'|'running_stitch'} stitchType
 * @property {string}  reason
 * @property {number}  confidence
 * @property {number}  optimalAngle
 * @property {Object|null} underlay
 * @property {number}  estimatedStitches
 * @property {number}  layerOrder
 */

/**
 * @typedef {Object} StitchPlan
 * @property {RegionPlan[]} sequence        - ordered by color+layer
 * @property {Object}       summary         - counts, totals, viability
 * @property {Object[]}     warnings        - {level, code, message}
 * @property {string}       narrative       - human-readable summary
 */

// ─── Stage 7: Stitch Optimizer (travel path) ──────────────────────────────────

/**
 * @typedef {Object} TravelMetrics
 * @property {number} jumps
 * @property {number} jumpDistanceMm
 * @property {number} cuts
 * @property {number} colorChanges
 * @property {number} totalTimeSec
 * @property {number} threadMm
 * @property {number} totalStitches
 */

/**
 * @typedef {Object} OptimizedPlan
 * @property {EnrichedRegion[]} optimizedSequence  - final production order
 * @property {TravelMetrics}    before
 * @property {TravelMetrics}    after
 * @property {Object}           savings            - % improvements
 * @property {number}           overallSaving      - % weighted
 * @property {Object[]}         colorGroups
 */

// ─── Stage 8: Simulation Engine ───────────────────────────────────────────────

/**
 * @typedef {Object} SimulationParams
 * @property {number}  threadThicknessPx
 * @property {number}  tension          - 0–1
 * @property {number}  lightAngleDeg
 * @property {number}  glossiness       - 0–1
 * @property {number}  zoom
 * @property {string}  fabricType
 */

/**
 * @typedef {Object} SimulationScene
 * @property {EnrichedRegion[]} regions
 * @property {SimulationParams} params
 * @property {string}           fabricType
 */

// ─── Stage 9: Export Engine ───────────────────────────────────────────────────

/**
 * @typedef {Object} ExportConfig
 * @property {string}   format         - 'DST'|'PES'|'JEF'|'VP3'|'EXP'|'HUS'
 * @property {number}   width_mm
 * @property {number}   height_mm
 * @property {number}   speed_spm
 * @property {number}   max_colors
 */

/**
 * @typedef {Object} ExportPayload
 * @property {EnrichedRegion[]} regions
 * @property {ExportConfig}     config
 * @property {StitchPlan}       plan
 * @property {TravelMetrics}    metrics
 */

// ─── Pipeline Context ─────────────────────────────────────────────────────────

/**
 * Single object passed through the full pipeline.
 * Each stage reads what it needs and appends its output.
 * Immutability contract: stages must not mutate previous stage outputs.
 *
 * @typedef {Object} PipelineContext
 * @property {string}              imageUrl
 * @property {Object}              config         - user/mode config
 * @property {ImageAnalysisResult} [analysis]
 * @property {EnhancedImageResult} [enhanced]
 * @property {ContourSet}          [contours]
 * @property {VectorRegion[]}      [vectorRegions]
 * @property {EnrichedRegion[]}    [regions]
 * @property {StitchPlan}          [plan]
 * @property {OptimizedPlan}       [optimized]
 * @property {SimulationScene}     [simulation]
 * @property {ExportPayload}       [export]
 * @property {Object[]}            stageLog       - [{stage, durationMs, ok}]
 */

export const PIPELINE_STAGES = [
  'image_analysis',
  'image_enhancement',
  'contour_engine',
  'semantic_segmentation',
  'vector_engine',
  'region_builder',
  'stitch_planner',
  'stitch_optimizer',
  'simulation_engine',
  'export_engine',
];

/**
 * Creates an empty pipeline context.
 * @param {string} imageUrl
 * @param {Object} config
 * @returns {PipelineContext}
 */
export function createContext(imageUrl, config = {}) {
  return {
    imageUrl,
    config: { ...config },
    stageLog: [],
  };
}

/**
 * Logs a completed stage into the context.
 * @param {PipelineContext} ctx
 * @param {string} stage
 * @param {number} durationMs
 * @param {boolean} ok
 */
export function logStage(ctx, stage, durationMs, ok = true) {
  ctx.stageLog.push({ stage, durationMs, ok, ts: Date.now() });
}