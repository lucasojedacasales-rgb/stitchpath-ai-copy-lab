/** @typedef {{x: number, y: number}} PointV2 */

export const ALLOWED_EMBROIDERY_ROLES = Object.freeze([
  'underlay',
  'base_fill',
  'foreground_fill',
  'internal_detail',
  'dark_detail',
  'outer_outline',
  'inner_outline',
  'highlight',
]);

export const ALLOWED_STITCH_TYPES = Object.freeze(['tatami', 'satin', 'running', 'manual']);
export const ALLOWED_COMMAND_TYPES = Object.freeze(['stitch', 'jump', 'trim', 'colorChange', 'end']);

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }
  return value;
}

function clonePoints(points) {
  return Array.isArray(points) ? points.map(point => cloneValue(point)) : [];
}

function clampConfidence(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/**
 * @typedef {Object} RegionV2
 * @property {string} id
 * @property {PointV2[]} geometry Normalized artwork coordinates in the 0-1 space.
 * @property {PointV2[][]} holes
 * @property {*} visualColor Artwork color, independent from machine thread selection.
 * @property {string|null} semanticRole
 * @property {string|null} parentId
 * @property {string[]} childIds
 * @property {{available: boolean, ratio: number, source: *}} darkStrokeSupport
 * @property {number} confidence
 * @property {*} source
 */

/** @returns {RegionV2} */
export function createRegionV2(input = {}) {
  const darkStroke = input.darkStrokeSupport && typeof input.darkStrokeSupport === 'object'
    ? input.darkStrokeSupport
    : {};
  return {
    id: input.id ?? null,
    geometry: clonePoints(input.geometry),
    holes: Array.isArray(input.holes) ? input.holes.map(clonePoints) : [],
    visualColor: cloneValue(input.visualColor ?? null),
    semanticRole: input.semanticRole ?? null,
    parentId: input.parentId ?? null,
    childIds: Array.isArray(input.childIds) ? [...input.childIds] : [],
    darkStrokeSupport: {
      available: darkStroke.available === true,
      ratio: Number.isFinite(darkStroke.ratio) ? darkStroke.ratio : 0,
      source: cloneValue(darkStroke.source ?? null),
    },
    confidence: clampConfidence(input.confidence),
    source: cloneValue(input.source ?? null),
  };
}

/**
 * @typedef {Object} EmbroideryObjectV2
 * @property {string} id
 * @property {string} regionId
 * @property {string} role
 * @property {string} stitchType
 * @property {PointV2[]} geometry Millimetre coordinates.
 * @property {PointV2[][]} holes Millimetre polygons excluded from the object geometry.
 * @property {*} visualColor Artwork color, independent from the selected machine thread.
 * @property {number} layer
 * @property {string[]} dependencyIds
 * @property {string} threadId
 * @property {PointV2[]} entryCandidates
 * @property {PointV2[]} exitCandidates
 * @property {Object} parameters
 * @property {number} confidence
 * @property {*} source
 */

/** @returns {EmbroideryObjectV2} */
export function createEmbroideryObjectV2(input = {}) {
  return {
    id: input.id ?? null,
    regionId: input.regionId ?? null,
    role: input.role ?? null,
    stitchType: input.stitchType ?? null,
    geometry: clonePoints(input.geometry),
    holes: Array.isArray(input.holes) ? input.holes.map(clonePoints) : [],
    visualColor: cloneValue(input.visualColor ?? null),
    layer: Number.isFinite(input.layer) ? input.layer : 0,
    dependencyIds: Array.isArray(input.dependencyIds) ? [...input.dependencyIds] : [],
    threadId: input.threadId ?? null,
    entryCandidates: clonePoints(input.entryCandidates),
    exitCandidates: clonePoints(input.exitCandidates),
    parameters: input.parameters && typeof input.parameters === 'object'
      ? cloneValue(input.parameters)
      : {},
    confidence: clampConfidence(input.confidence),
    source: cloneValue(input.source ?? null),
  };
}

/**
 * @typedef {Object} ThreadDefinitionV2
 * @property {string} id
 * @property {Array<*>} visualColorSamples
 * @property {*} machineColor
 * @property {string|null} colorFamily
 * @property {*} source
 * @property {number} confidence
 */

/** @returns {ThreadDefinitionV2} */
export function createThreadDefinitionV2(input = {}) {
  return {
    id: input.id ?? null,
    visualColorSamples: Array.isArray(input.visualColorSamples)
      ? input.visualColorSamples.map(cloneValue)
      : [],
    machineColor: cloneValue(input.machineColor ?? null),
    colorFamily: input.colorFamily ?? null,
    source: cloneValue(input.source ?? null),
    confidence: clampConfidence(input.confidence),
  };
}

/**
 * @typedef {Object} ThreadBlockV2
 * @property {string} id
 * @property {string} threadId
 * @property {string[]} objectIds Ordered object identifiers.
 * @property {number} layer
 * @property {string|null} repeatedThreadReason
 */

/** @returns {ThreadBlockV2} */
export function createThreadBlockV2(input = {}) {
  return {
    id: input.id ?? null,
    threadId: input.threadId ?? null,
    objectIds: Array.isArray(input.objectIds) ? [...input.objectIds] : [],
    layer: Number.isFinite(input.layer) ? input.layer : 0,
    repeatedThreadReason: input.repeatedThreadReason ?? null,
  };
}

/**
 * @typedef {Object} CanonicalCommandV2
 * @property {'stitch'|'jump'|'trim'|'colorChange'|'end'} type
 * @property {number|undefined} x
 * @property {number|undefined} y
 * @property {string|null} threadId
 * @property {string|null} objectId
 * @property {string|null} regionId
 * @property {string|null} id
 * @property {number|null} sequenceIndex
 * @property {string|null} threadBlockId
 * @property {string|null} executionStepId
 * @property {string|null} subpathId
 * @property {string|null} physicalPointId
 * @property {string|null} transitionId
 * @property {string|null} phase
 * @property {string|null} technique
 * @property {string|null} reasonCode
 * @property {*} source
 */

/** @returns {CanonicalCommandV2} */
export function createCanonicalCommandV2(input = {}) {
  return {
    type: input.type ?? null,
    x: input.x,
    y: input.y,
    threadId: input.threadId ?? null,
    objectId: input.objectId ?? null,
    regionId: input.regionId ?? null,
    id: input.id ?? null,
    sequenceIndex: Number.isInteger(input.sequenceIndex) ? input.sequenceIndex : null,
    threadBlockId: input.threadBlockId ?? null,
    executionStepId: input.executionStepId ?? null,
    subpathId: input.subpathId ?? null,
    physicalPointId: input.physicalPointId ?? null,
    transitionId: input.transitionId ?? null,
    phase: input.phase ?? null,
    technique: input.technique ?? null,
    reasonCode: input.reasonCode ?? null,
    source: cloneValue(input.source ?? null),
  };
}

/**
 * @typedef {Object} EngineDocumentV2
 * @property {'2'} version
 * @property {RegionV2[]} regions
 * @property {EmbroideryObjectV2[]} objects
 * @property {ThreadDefinitionV2[]} threads
 * @property {ThreadBlockV2[]} threadBlocks
 * @property {CanonicalCommandV2[]} commands
 * @property {Object} metadata
 */

/** @returns {EngineDocumentV2} */
export function createEngineDocumentV2(input = {}) {
  return {
    version: input.version ?? '2',
    regions: Array.isArray(input.regions) ? input.regions.map(createRegionV2) : [],
    objects: Array.isArray(input.objects) ? input.objects.map(createEmbroideryObjectV2) : [],
    threads: Array.isArray(input.threads) ? input.threads.map(createThreadDefinitionV2) : [],
    threadBlocks: Array.isArray(input.threadBlocks) ? input.threadBlocks.map(createThreadBlockV2) : [],
    commands: Array.isArray(input.commands) ? input.commands.map(createCanonicalCommandV2) : [],
    metadata: input.metadata && typeof input.metadata === 'object' ? cloneValue(input.metadata) : {},
  };
}
