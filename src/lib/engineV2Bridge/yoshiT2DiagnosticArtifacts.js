const EMPTY_LIST = Object.freeze([]);

export const YOSHI_T2_EXPECTED_FILE = deepFreeze({
  name: 'YOSHI-FUENTE-ORIGINAL.jpeg',
  type: 'image/jpeg',
  size: 31_496,
  width: 360,
  height: 482,
  sha256: '066F5629D48AA4D62E8B2D3EDF57B499B4438381653AAA156FBCE2EDD23D7827',
  jpegSignatureValid: true,
});

export const YOSHI_T2_PIPELINE_CONFIG = deepFreeze({
  mode: 'hybrid',
  width_mm: 83.4,
  height_mm: 114.3,
  color_count: 8,
  fabric_type: 'Algodón',
  remove_bg: false,
  contourSafeMode: true,
  useVectorFusion: false,
  experimentalDetailPreservation: false,
  experimentalOutlineGenerator: false,
  tatami_density: 0.4,
  machine_speed: 800,
});

export const YOSHI_T2_ACTIVATION = true;

export const YOSHI_T2_REQUIRED_STAGES = Object.freeze([
  'image_analysis',
  'image_enhancement',
  'contour_engine',
  'semantic_segmentation',
  'vector_engine',
  'region_builder',
  'quality_phase_1_input_segmentation_cleanup',
  'stitch_planner',
  'stitch_optimizer',
]);

export const YOSHI_T2_R02_REFERENCE = deepFreeze({
  embStitchCount: 18_145,
  dstStitchCount: 18_139,
  objectCount: 26,
  colorCount: 6,
  blockCount: 7,
  blockOrder: ['verde', 'blanco', 'naranja', 'rojo', 'naranja', 'amarillo', 'negro'],
});

export const YOSHI_T2_ARTIFACT_NAMES = Object.freeze([
  'yoshi-t2-legacy-summary.json',
  'yoshi-t2-source-regions.json',
  'yoshi-t2-engine-v2-document.json',
  'yoshi-t2-canonical-commands.json',
  'yoshi-t2-metrics.json',
  'yoshi-t2-traces.json',
  'yoshi-t2-vs-r02-comparison.md',
  'MANIFEST_SHA256.txt',
]);

const JSON_ARTIFACT_NAMES = new Set(YOSHI_T2_ARTIFACT_NAMES.slice(0, 6));
const BINARY_VALUE_FIELDS = new Set([
  'binary', 'buffer', 'bytes', 'bytearray', 'bytebuffer', 'binarypayload',
  'encodedbytes', 'encodedpayload', 'encoderresult', 'dstartifact', 'dsbartifact',
  'dst', 'dsb', 'dstbytes', 'dsbbytes', 'dstbuffer', 'dsbbuffer', 'dstpayload',
  'dsbpayload', 'binaryfile', 'exportedfile',
]);
const FORBIDDEN_URL_FIELDS = new Set([
  'appbaseurl', 'serverurl', 'uploadurl', 'downloadurl', 'objecturl',
  'downloadhref', 'downloaduri', 'objecturi',
]);
const EXACT_FALSE_SIGNAL_FIELDS = new Set([
  'machineadaptationapplied', 'encodingapplied', 'binaryartifactcreated',
  'machineadapterinvoked', 'machineadaptationinvoked', 'encoderinvoked',
  'encodinginvoked', 'dstencoderinvoked', 'dsbencoderinvoked',
]);
const ZERO_COUNTER_FIELDS = new Set([
  'machineadaptationcount', 'machineadapterinvocationcount', 'encodingcount',
  'encoderinvocationcount', 'dstencodercount', 'dsbencodercount',
  'binaryartifactcount', 'dstartifactcount', 'dsbartifactcount',
]);
const SENSITIVE_KEYS = new Set([
  'authorization', 'credential', 'credentials', 'password', 'token', 'accesstoken',
  'refreshtoken', 'authtoken', 'sessiontoken', 'idtoken', 'csrftoken',
  'cookie', 'cookies', 'email', 'user', 'userid', 'username',
  'session', 'sessionid', 'apikey', 'secret', 'clientsecret', 'privatekey',
  'base44url', 'base44baseurl', 'base44appurl', 'base44appid',
  'appbaseurl', 'serverurl', 'uploadurl', 'downloadurl', 'objecturl',
]);
const TEMPORAL_KEYS = new Set([
  'timestamp', 'timestamps', 'ts', 'durationms', 'createdat', 'updatedat',
  'generatedat', 'startedat', 'endedat',
]);

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach(key => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function normalizedKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(value) {
  return SENSITIVE_KEYS.has(value)
    || value.startsWith('base44')
    || value.endsWith('apikey')
    || value.endsWith('email')
    || value.endsWith('password')
    || value.endsWith('privatekey')
    || value.includes('credential')
    || value.includes('clientsecret')
    || value.includes('authorization')
    || value.includes('cookie');
}

function outcome(valid, code = null, details = EMPTY_LIST) {
  return deepFreeze({ valid, code, details });
}

function fail(code, details = EMPTY_LIST) {
  return outcome(false, code, details);
}

function asOwnData(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function safeErrorCode(caught, fallback) {
  const code = asOwnData(caught, 'code');
  return typeof code === 'string' && code.length > 0 ? code : fallback;
}

function binaryObjectKind(value) {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return 'Buffer';
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) return 'typed-array';
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return 'ArrayBuffer';
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) return 'SharedArrayBuffer';
  if (typeof Blob !== 'undefined' && value instanceof Blob) return 'Blob';
  return null;
}

function hasPayload(value) {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== '';
}

function inspectForForbiddenSignal(root, rootPath) {
  const active = new WeakSet();

  function inspect(value, path) {
    if (value === null || typeof value !== 'object') return null;
    if (active.has(value)) return { path, kind: 'cycle' };

    const binaryKind = binaryObjectKind(value);
    if (binaryKind !== null) return { path, kind: binaryKind };

    active.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      for (const key of keys) {
        if (key === 'length') continue;
        if (typeof key === 'symbol') return { path, kind: 'symbol-property' };
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) return { path: `${path}.${key}`, kind: 'accessor' };
        const nested = descriptor.value;
        const normalized = normalizedKey(key);
        if ((BINARY_VALUE_FIELDS.has(normalized) || FORBIDDEN_URL_FIELDS.has(normalized)) && hasPayload(nested)) {
          return { path: `${path}.${key}`, kind: FORBIDDEN_URL_FIELDS.has(normalized) ? 'url-field' : 'binary-field' };
        }
        if (EXACT_FALSE_SIGNAL_FIELDS.has(normalized) && nested !== false) {
          return { path: `${path}.${key}`, kind: 'binary-signal' };
        }
        if (ZERO_COUNTER_FIELDS.has(normalized) && nested !== 0) {
          return { path: `${path}.${key}`, kind: 'binary-counter' };
        }
        if (['format', 'fileformat', 'outputformat'].includes(normalized)
          && typeof nested === 'string' && ['dst', 'dsb'].includes(nested.toLowerCase())) {
          return { path: `${path}.${key}`, kind: 'binary-format' };
        }
        const found = inspect(nested, `${path}.${key}`);
        if (found) return found;
      }
      return null;
    } catch {
      return { path, kind: 'uninspectable' };
    } finally {
      active.delete(value);
    }
  }

  return inspect(root, rootPath);
}

function isPlainSerializableObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalSerializableClone(root, rootPath) {
  const active = new WeakSet();

  function clone(value, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw Object.assign(new TypeError('Non-finite number.'), { code: 'T2_ARTIFACT_NOT_SERIALIZABLE', path });
      return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value !== 'object') {
      throw Object.assign(new TypeError('Unsupported value.'), { code: 'T2_ARTIFACT_NOT_SERIALIZABLE', path });
    }
    if (binaryObjectKind(value) !== null) {
      throw Object.assign(new TypeError('Binary value forbidden.'), { code: 'T2_BINARY_SIGNAL_FORBIDDEN', path });
    }
    if (active.has(value)) {
      throw Object.assign(new TypeError('Cyclic value forbidden.'), { code: 'T2_ARTIFACT_NOT_SERIALIZABLE', path });
    }

    const isArray = Array.isArray(value);
    if (!isArray && !isPlainSerializableObject(value)) {
      throw Object.assign(new TypeError('Unsupported prototype.'), { code: 'T2_ARTIFACT_NOT_SERIALIZABLE', path });
    }

    active.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (keys.some(key => typeof key === 'symbol')) {
        throw Object.assign(new TypeError('Symbol property forbidden.'), { code: 'T2_ARTIFACT_NOT_SERIALIZABLE', path });
      }
      if (isArray) {
        const stringKeys = keys.filter(key => key !== 'length');
        if (stringKeys.length !== value.length
          || stringKeys.some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
          throw Object.assign(new TypeError('Sparse array forbidden.'), { code: 'T2_ARTIFACT_NOT_SERIALIZABLE', path });
        }
        return stringKeys
          .sort((left, right) => Number(left) - Number(right))
          .map(key => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
              throw Object.assign(new TypeError('Accessor forbidden.'), { code: 'T2_ARTIFACT_NOT_SERIALIZABLE', path: `${path}[${key}]` });
            }
            return clone(descriptor.value, `${path}[${key}]`);
          });
      }

      const result = {};
      for (const key of keys.sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
          throw Object.assign(new TypeError('Accessor forbidden.'), { code: 'T2_ARTIFACT_NOT_SERIALIZABLE', path: `${path}.${key}` });
        }
        const normalized = normalizedKey(key);
        if (isSensitiveKey(normalized)) {
          throw Object.assign(new TypeError('Sensitive field forbidden.'), { code: 'T2_SENSITIVE_DATA_FORBIDDEN', path: `${path}.${key}` });
        }
        if (TEMPORAL_KEYS.has(normalized)) {
          throw Object.assign(new TypeError('Temporal field forbidden.'), { code: 'T2_TIMESTAMP_FORBIDDEN', path: `${path}.${key}` });
        }
        result[key] = clone(descriptor.value, `${path}.${key}`);
      }
      return result;
    } finally {
      active.delete(value);
    }
  }

  return clone(root, rootPath);
}

function canonicalJson(value, path) {
  return `${JSON.stringify(canonicalSerializableClone(value, path), null, 2)}\n`;
}

function canonicalText(value) {
  return `${value.replace(/\r\n?/g, '\n').replace(/\n*$/, '')}\n`;
}

function forbiddenTextCode(value) {
  if (/\b(?:blob|file):/i.test(value)) return 'T2_OBJECT_URL_FORBIDDEN';
  if (/(?:https?:\/\/|base44\.(?:app|com)\b|\b(?:data|javascript):)/i.test(value)) {
    return 'T2_EXTERNAL_URL_FORBIDDEN';
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return 'T2_SENSITIVE_DATA_FORBIDDEN';
  return null;
}

export async function sha256Bytes(bytes, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle?.digest) {
    throw Object.assign(new Error('Web Crypto SHA-256 is unavailable.'), { code: 'T2_SHA256_UNAVAILABLE' });
  }
  const buffer = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await cryptoImpl.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export async function sha256Text(value, cryptoImpl = globalThis.crypto) {
  return sha256Bytes(new TextEncoder().encode(canonicalText(value)), cryptoImpl);
}

export function validateYoshiT2FileMetadata(metadata) {
  if (metadata === null || typeof metadata !== 'object') return fail('T2_YOSHI_FILE_METADATA_INVALID');
  if (metadata.name !== YOSHI_T2_EXPECTED_FILE.name) return fail('T2_YOSHI_FILE_NAME_INVALID');
  if (metadata.type !== YOSHI_T2_EXPECTED_FILE.type) return fail('T2_YOSHI_FILE_TYPE_INVALID');
  if (metadata.size !== YOSHI_T2_EXPECTED_FILE.size) return fail('T2_YOSHI_FILE_SIZE_INVALID');
  if (metadata.jpegSignatureValid !== true) return fail('T2_YOSHI_FILE_SIGNATURE_INVALID');
  if (metadata.width !== YOSHI_T2_EXPECTED_FILE.width || metadata.height !== YOSHI_T2_EXPECTED_FILE.height) {
    return fail('T2_YOSHI_FILE_DIMENSIONS_INVALID');
  }
  if (metadata.sha256 !== YOSHI_T2_EXPECTED_FILE.sha256) return fail('T2_YOSHI_FILE_SHA256_INVALID');
  return outcome(true);
}

export function validateYoshiT2FileSelection(files) {
  if (!files || files.length !== 1) return fail('T2_YOSHI_SINGLE_FILE_REQUIRED');
  return deepFreeze({ ...outcome(true), file: files[0] });
}

export async function inspectYoshiT2File(file, {
  createImageBitmapImpl = globalThis.createImageBitmap,
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') return fail('T2_YOSHI_FILE_REQUIRED');
  if (typeof createImageBitmapImpl !== 'function') return fail('T2_YOSHI_IMAGE_DECODER_UNAVAILABLE');

  let bitmap;
  try {
    const bytes = await file.arrayBuffer();
    const byteView = new Uint8Array(bytes);
    const jpegSignatureValid = byteView.length >= 5
      && byteView[0] === 0xFF
      && byteView[1] === 0xD8
      && byteView[2] === 0xFF
      && byteView[byteView.length - 2] === 0xFF
      && byteView[byteView.length - 1] === 0xD9;
    if (!jpegSignatureValid) return fail('T2_YOSHI_FILE_SIGNATURE_INVALID');
    if (byteView.byteLength !== file.size) return fail('T2_YOSHI_FILE_SIZE_INVALID');
    const sha256 = await sha256Bytes(bytes, cryptoImpl);
    bitmap = await createImageBitmapImpl(file);
    const metadata = deepFreeze({
      name: file.name,
      type: file.type,
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
      sha256,
      jpegSignatureValid,
    });
    const validation = validateYoshiT2FileMetadata(metadata);
    return deepFreeze({ ...validation, metadata });
  } catch (caught) {
    return fail(safeErrorCode(caught, 'T2_YOSHI_FILE_INSPECTION_FAILED'));
  } finally {
    try {
      bitmap?.close?.();
    } catch {
      // The decoded image is diagnostic-only; cleanup failures must not escape.
    }
  }
}

function stageValidation(legacyResult) {
  const stageLog = asOwnData(legacyResult, 'stageLog');
  if (!Array.isArray(stageLog) || stageLog.length !== YOSHI_T2_REQUIRED_STAGES.length) {
    return fail('T2_LEGACY_STAGE_SET_INVALID');
  }
  const observed = new Set();
  for (let index = 0; index < stageLog.length; index += 1) {
    const stage = asOwnData(stageLog[index], 'stage');
    const ok = asOwnData(stageLog[index], 'ok');
    if (typeof stage !== 'string' || observed.has(stage)) return fail('T2_LEGACY_STAGE_SET_INVALID');
    observed.add(stage);
    if (ok !== true) return fail('T2_LEGACY_STAGE_FAILED', [stage]);
  }
  if (YOSHI_T2_REQUIRED_STAGES.some(stage => !observed.has(stage))) return fail('T2_LEGACY_STAGE_SET_INVALID');
  return outcome(true);
}

function hasExactMetadataContract(metadata, { requireArtifactCounters = false } = {}) {
  if (metadata === null || typeof metadata !== 'object') return false;
  const expectedEntries = [
    ['machineAdaptationApplied', false],
    ['encodingApplied', false],
    ['binaryArtifactCreated', false],
    ...(requireArtifactCounters ? [
      ['dstArtifactCount', 0],
      ['dsbArtifactCount', 0],
    ] : []),
  ];

  try {
    return expectedEntries.every(([key, expected]) => {
      const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
      if (!descriptor || !('value' in descriptor)) return false;
      if (expected === 0 && !Number.isFinite(descriptor.value)) return false;
      return descriptor.value === expected;
    });
  } catch {
    return false;
  }
}

function preAdaptationValidation(observation) {
  if (observation === null || typeof observation !== 'object') return fail('T2_T1_OBSERVATION_INVALID');
  const legacyResult = asOwnData(observation, 'legacyResult');
  const diagnostic = asOwnData(observation, 'diagnostic');
  if (legacyResult === null || typeof legacyResult !== 'object') return fail('T2_LEGACY_RESULT_MISSING');

  const stages = stageValidation(legacyResult);
  if (!stages.valid) return stages;
  const legacyRegions = asOwnData(legacyResult, 'regions');
  if (!Array.isArray(legacyRegions) || legacyRegions.length === 0) return fail('T2_LEGACY_REGIONS_EMPTY');

  const status = asOwnData(diagnostic, 'status');
  if (status !== 'completed') {
    const reasonCode = asOwnData(diagnostic, 'reasonCode');
    return fail(typeof reasonCode === 'string' && reasonCode.length > 0 ? reasonCode : 'T2_T1_NOT_COMPLETED');
  }
  if (asOwnData(diagnostic, 'requested') !== true) return fail('T2_T1_NOT_REQUESTED');

  const engineV2Result = asOwnData(diagnostic, 'engineV2Result');
  if (!engineV2Result || asOwnData(engineV2Result, 'valid') !== true) return fail('T2_ENGINE_V2_RESULT_INVALID');
  const documentValidation = asOwnData(engineV2Result, 'documentValidation');
  if (!documentValidation || asOwnData(documentValidation, 'valid') !== true) return fail('T2_ENGINE_V2_DOCUMENT_INVALID');
  const document = asOwnData(engineV2Result, 'document');
  if (!document || typeof document !== 'object') return fail('T2_ENGINE_V2_DOCUMENT_INVALID');
  const documentCommands = asOwnData(document, 'commands');
  const canonicalCommands = asOwnData(diagnostic, 'canonicalCommands');
  if (!Array.isArray(canonicalCommands) || canonicalCommands.length === 0) return fail('T2_CANONICAL_COMMANDS_EMPTY');
  if (canonicalCommands !== documentCommands) return fail('T2_CANONICAL_COMMAND_IDENTITY_MISMATCH');

  const diagnosticMetadata = asOwnData(diagnostic, 'metadata');
  const resultMetadata = asOwnData(engineV2Result, 'metadata');
  const documentMetadata = asOwnData(document, 'metadata');
  if (!hasExactMetadataContract(diagnosticMetadata, { requireArtifactCounters: true })
    || !hasExactMetadataContract(resultMetadata)
    || !hasExactMetadataContract(documentMetadata)) {
    return fail('T2_BINARY_METADATA_INVALID');
  }
  if (asOwnData(diagnosticMetadata, 'governingResult') !== 'legacy') return fail('T2_LEGACY_GOVERNANCE_INVALID');

  const metrics = asOwnData(diagnostic, 'metrics');
  const traces = asOwnData(diagnostic, 'traces');
  if (!metrics || typeof metrics !== 'object') return fail('T2_METRICS_INVALID');
  if (!traces || typeof traces !== 'object') return fail('T2_TRACES_INVALID');

  const inspectedSurfaces = [
    ['diagnostic.metadata', diagnosticMetadata],
    ['diagnostic.source', asOwnData(diagnostic, 'source')],
    ['diagnostic.engineV2Result', engineV2Result],
    ['diagnostic.canonicalCommands', canonicalCommands],
    ['diagnostic.metrics', metrics],
    ['diagnostic.traces', traces],
    ['legacyResult.stageLog', asOwnData(legacyResult, 'stageLog')],
  ];
  for (const [path, surface] of inspectedSurfaces) {
    const signal = inspectForForbiddenSignal(surface, path);
    if (signal) return fail('T2_BINARY_SIGNAL_FORBIDDEN', [signal.path, signal.kind]);
  }
  return outcome(true);
}

function sameCanonicalValue(left, right) {
  try {
    return JSON.stringify(canonicalSerializableClone(left, 'comparison.left'))
      === JSON.stringify(canonicalSerializableClone(right, 'comparison.right'));
  } catch {
    return false;
  }
}

function engineV2PointsFromSource(points) {
  if (!Array.isArray(points)) return points;
  return points.map(point => Array.isArray(point) && point.length === 2
    ? { x: point[0], y: point[1] }
    : point);
}

function engineV2HolesFromSource(holes) {
  if (!Array.isArray(holes)) return holes;
  return holes.map(engineV2PointsFromSource);
}

function validateAdaptationAgainstObservation(observation, adapted) {
  const diagnostic = asOwnData(observation, 'diagnostic');
  const diagnosticSource = asOwnData(diagnostic, 'source');
  if (!diagnosticSource || typeof diagnosticSource !== 'object') {
    return fail('T2_ADAPTATION_SOURCE_MISMATCH');
  }
  const coordinateContractMatches = sameCanonicalValue(
    asOwnData(diagnosticSource, 'coordinateContract'),
    asOwnData(adapted, 'coordinateContract'),
  );
  if (!coordinateContractMatches) return fail('T2_SOURCE_REGIONS_DOCUMENT_MISMATCH');

  const sourceContractMatches = sameCanonicalValue(
    asOwnData(diagnosticSource, 'metadata'),
    asOwnData(adapted, 'metadata'),
  ) && sameCanonicalValue(
    asOwnData(diagnosticSource, 'nonContractualProvenance'),
    asOwnData(adapted, 'nonContractualProvenance'),
  );
  if (!sourceContractMatches) return fail('T2_ADAPTATION_SOURCE_MISMATCH');

  const sourceRegions = asOwnData(adapted, 'sourceRegions');
  const document = asOwnData(asOwnData(diagnostic, 'engineV2Result'), 'document');
  const documentRegions = asOwnData(document, 'regions');
  if (!Array.isArray(documentRegions) || documentRegions.length === 0
    || documentRegions.length !== sourceRegions.length) {
    return fail('T2_SOURCE_REGIONS_DOCUMENT_MISMATCH');
  }

  for (let index = 0; index < sourceRegions.length; index += 1) {
    const sourceRegion = sourceRegions[index];
    const documentRegion = documentRegions[index];
    const documentSource = asOwnData(documentRegion, 'source');
    const contractMatches = asOwnData(documentRegion, 'id') === asOwnData(sourceRegion, 'id')
      && sameCanonicalValue(asOwnData(documentRegion, 'visualColor'), asOwnData(sourceRegion, 'color'))
      && sameCanonicalValue(
        asOwnData(documentRegion, 'geometry'),
        engineV2PointsFromSource(asOwnData(sourceRegion, 'path_points')),
      )
      && sameCanonicalValue(
        asOwnData(documentRegion, 'holes'),
        engineV2HolesFromSource(asOwnData(sourceRegion, 'holes')),
      )
      && sameCanonicalValue(
        asOwnData(documentRegion, 'semanticRole'),
        asOwnData(sourceRegion, 'semanticRole') ?? null,
      )
      && asOwnData(documentSource, 'originalSourceId') === asOwnData(sourceRegion, 'id')
      && sameCanonicalValue(asOwnData(documentSource, 'originalSource'), asOwnData(sourceRegion, 'source'))
      && sameCanonicalValue(asOwnData(documentSource, 'name'), asOwnData(sourceRegion, 'name') ?? null)
      && sameCanonicalValue(asOwnData(documentSource, 'object'), asOwnData(sourceRegion, 'object') ?? null)
      && sameCanonicalValue(asOwnData(documentSource, 'objectGroup'), asOwnData(sourceRegion, 'object_group') ?? null)
      && sameCanonicalValue(asOwnData(documentSource, 'regionClass'), asOwnData(sourceRegion, 'region_class') ?? null)
      && asOwnData(documentSource, 'visible') === (asOwnData(sourceRegion, 'visible') !== false)
      && asOwnData(documentSource, 'coordinateSpace')
        === asOwnData(asOwnData(sourceRegion, 'source'), 'coordinateSpace');
    if (!contractMatches) return fail('T2_SOURCE_REGIONS_DOCUMENT_MISMATCH', [String(index)]);
  }
  return outcome(true);
}

export function validateYoshiT2Observation(observation, adapted) {
  const preliminary = preAdaptationValidation(observation);
  if (!preliminary.valid) return preliminary;
  const sourceRegions = asOwnData(adapted, 'sourceRegions');
  if (!Array.isArray(sourceRegions) || sourceRegions.length === 0) return fail('T2_ADAPTED_REGIONS_EMPTY');
  const signal = inspectForForbiddenSignal(sourceRegions, 'adapted.sourceRegions');
  if (signal) return fail('T2_BINARY_SIGNAL_FORBIDDEN', [signal.path, signal.kind]);
  return validateAdaptationAgainstObservation(observation, adapted);
}

function legacySummary(observation, fileMetadata) {
  const legacyResult = observation.legacyResult;
  return {
    schema: 'stitchpath-yoshi-t2-legacy-summary-v1',
    activation: YOSHI_T2_ACTIVATION,
    governingResult: observation.diagnostic.metadata.governingResult,
    input: {
      name: fileMetadata.name,
      type: fileMetadata.type,
      size: fileMetadata.size,
      width: fileMetadata.width,
      height: fileMetadata.height,
      sha256: fileMetadata.sha256,
      jpegSignatureValid: fileMetadata.jpegSignatureValid,
    },
    config: YOSHI_T2_PIPELINE_CONFIG,
    stageLog: legacyResult.stageLog.map(entry => ({ stage: entry.stage, ok: entry.ok })),
    regionCount: legacyResult.regions.length,
    planAvailable: legacyResult.plan !== null && legacyResult.plan !== undefined,
    optimizedPlanAvailable: legacyResult.optimized !== null && legacyResult.optimized !== undefined,
  };
}

function r02ComparisonMarkdown(metrics) {
  const comparableCount = (value, suffix = '') => Number.isSafeInteger(value) && value >= 0
    ? `${value}${suffix}`
    : 'no comparable';
  const commandCount = comparableCount(metrics.commandCount);
  const objectCount = comparableCount(metrics.objectCount);
  const threadCount = comparableCount(metrics.threadCount, ' hilos');
  const threadBlockCount = comparableCount(metrics.threadBlockCount);
  return canonicalText(`# Yoshi T2 — comparación diagnóstica con YOSHI-R02

## Referencia profesional R02

- JPEG: 360 × 482 px;
- objetivo: 83,4 × 114,3 mm;
- escala horizontal aproximada: 0,23167 mm/px;
- escala vertical aproximada: 0,23714 mm/px;
- diferencia aproximada: 2,36%;
- la medida objetivo reproduce la referencia profesional R02;
- la diferencia no se atribuye automáticamente a un defecto del motor;
- comandos canónicos no equivalen automáticamente a puntadas DST.

| Evidencia | R02 | Engine V2 T2 |
| --- | ---: | ---: |
| Puntadas EMB | ${YOSHI_T2_R02_REFERENCE.embStitchCount} | no equivalente |
| Puntadas DST | ${YOSHI_T2_R02_REFERENCE.dstStitchCount} | no equivalente |
| Objetos nativos | ${YOSHI_T2_R02_REFERENCE.objectCount} | ${objectCount}; no equivalencia acreditada |
| Colores profesionales / hilos V2 | ${YOSHI_T2_R02_REFERENCE.colorCount} | ${threadCount}; no equivalencia acreditada |
| Bloques profesionales / bloques de hilo V2 | ${YOSHI_T2_R02_REFERENCE.blockCount} | ${threadBlockCount}; no equivalencia acreditada |
| Comandos canónicos | no aplica | ${commandCount} |

Orden de bloques R02: ${YOSHI_T2_R02_REFERENCE.blockOrder.join(' → ')}.

Los comandos canónicos de Engine V2 describen su documento intermedio y no equivalen automáticamente a puntadas DST. T2 no adapta a máquina, no codifica y no crea archivos binarios; por tanto, este recuento no acredita equivalencia física ni mejora de bordado.
`);
}

function artifact(name, text) {
  return deepFreeze({
    name,
    mimeType: JSON_ARTIFACT_NAMES.has(name)
      ? 'application/json;charset=utf-8'
      : 'text/plain;charset=utf-8',
    text: canonicalText(text),
  });
}

export async function buildYoshiT2DiagnosticArtifacts({ observation, adapted, fileMetadata }) {
  const fileValidation = validateYoshiT2FileMetadata(fileMetadata);
  if (!fileValidation.valid) return deepFreeze({ ok: false, code: fileValidation.code, artifacts: null });
  const successValidation = validateYoshiT2Observation(observation, adapted);
  if (!successValidation.valid) return deepFreeze({ ok: false, code: successValidation.code, artifacts: null });

  try {
    const diagnostic = observation.diagnostic;
    const payloads = [
      ['yoshi-t2-legacy-summary.json', canonicalJson(legacySummary(observation, fileMetadata), 'legacySummary')],
      ['yoshi-t2-source-regions.json', canonicalJson(adapted.sourceRegions, 'sourceRegions')],
      ['yoshi-t2-engine-v2-document.json', canonicalJson(diagnostic.engineV2Result.document, 'engineV2Document')],
      ['yoshi-t2-canonical-commands.json', canonicalJson(diagnostic.canonicalCommands, 'canonicalCommands')],
      ['yoshi-t2-metrics.json', canonicalJson(diagnostic.metrics, 'metrics')],
      ['yoshi-t2-traces.json', canonicalJson(diagnostic.traces, 'traces')],
      ['yoshi-t2-vs-r02-comparison.md', r02ComparisonMarkdown(diagnostic.metrics)],
    ];
    const forbiddenCode = payloads
      .map(([, text]) => forbiddenTextCode(text))
      .find(code => code !== null);
    if (forbiddenCode) return deepFreeze({ ok: false, code: forbiddenCode, artifacts: null });

    const artifacts = {};
    const manifestLines = [];
    for (const [name, text] of payloads) {
      const normalized = canonicalText(text);
      manifestLines.push(`${await sha256Text(normalized)}  ${name}`);
      artifacts[name] = artifact(name, normalized);
    }
    const manifestText = canonicalText(manifestLines.join('\n'));
    artifacts['MANIFEST_SHA256.txt'] = artifact('MANIFEST_SHA256.txt', manifestText);

    const serializedArtifacts = JSON.stringify(Object.values(artifacts).map(item => ({
      name: item.name,
      mimeType: item.mimeType,
      text: item.text,
    })));
    if (typeof serializedArtifacts !== 'string') {
      return deepFreeze({ ok: false, code: 'T2_ARTIFACT_NOT_SERIALIZABLE', artifacts: null });
    }
    return deepFreeze({ ok: true, code: null, artifacts });
  } catch (caught) {
    return deepFreeze({
      ok: false,
      code: safeErrorCode(caught, 'T2_ARTIFACT_BUILD_FAILED'),
      artifacts: null,
    });
  }
}

function runSummary(observation) {
  return deepFreeze({
    status: observation.diagnostic.status,
    regionCount: observation.legacyResult.regions.length,
    adaptedRegionCount: observation.diagnostic.metrics.regionCount,
    commandCount: observation.diagnostic.metrics.commandCount,
    objectCount: observation.diagnostic.metrics.objectCount,
    threadCount: observation.diagnostic.metrics.threadCount,
    threadBlockCount: observation.diagnostic.metrics.threadBlockCount,
    metadata: {
      governingResult: observation.diagnostic.metadata.governingResult,
      machineAdaptationApplied: observation.diagnostic.metadata.machineAdaptationApplied,
      encodingApplied: observation.diagnostic.metadata.encodingApplied,
      binaryArtifactCreated: observation.diagnostic.metadata.binaryArtifactCreated,
    },
  });
}

export async function executeYoshiT2DiagnosticRun({
  file,
  fileMetadata,
  executionGate,
  runConnector,
  adaptLegacy,
  onProgress,
  createObjectURL = value => URL.createObjectURL(value),
  revokeObjectURL = value => URL.revokeObjectURL(value),
} = {}) {
  if (!executionGate || typeof executionGate !== 'object') {
    return deepFreeze({ ok: false, code: 'T2_EXECUTION_GATE_REQUIRED', artifacts: null, summary: null });
  }
  if (executionGate.current === true) {
    return deepFreeze({ ok: false, code: 'T2_EXECUTION_ALREADY_RUNNING', artifacts: null, summary: null });
  }
  const fileValidation = validateYoshiT2FileMetadata(fileMetadata);
  if (!fileValidation.valid) {
    return deepFreeze({ ok: false, code: fileValidation.code, artifacts: null, summary: null });
  }
  if (!file || typeof runConnector !== 'function' || typeof adaptLegacy !== 'function') {
    return deepFreeze({ ok: false, code: 'T2_EXECUTION_DEPENDENCY_INVALID', artifacts: null, summary: null });
  }

  executionGate.current = true;
  let imageObjectUrl = null;
  try {
    imageObjectUrl = createObjectURL(file);
    const observation = await runConnector(
      imageObjectUrl,
      YOSHI_T2_PIPELINE_CONFIG,
      {
        onProgress: (percentage, stage) => {
          try {
            onProgress?.(percentage, stage);
          } catch {
            // UI progress is non-governing and cannot interrupt the real pipeline.
          }
        },
      },
      YOSHI_T2_ACTIVATION,
    );

    const preliminary = preAdaptationValidation(observation);
    if (!preliminary.valid) {
      return deepFreeze({ ok: false, code: preliminary.code, artifacts: null, summary: null });
    }

    let adapted;
    try {
      adapted = adaptLegacy(observation.legacyResult);
    } catch (caught) {
      return deepFreeze({
        ok: false,
        code: safeErrorCode(caught, 'T2_RASTER_ADAPTATION_BLOCKED'),
        artifacts: null,
        summary: null,
      });
    }

    const built = await buildYoshiT2DiagnosticArtifacts({ observation, adapted, fileMetadata });
    if (!built.ok) return deepFreeze({ ...built, summary: null });
    return deepFreeze({
      ok: true,
      code: null,
      artifacts: built.artifacts,
      summary: runSummary(observation),
    });
  } catch (caught) {
    return deepFreeze({
      ok: false,
      code: safeErrorCode(caught, 'T2_EXECUTION_FAILED'),
      artifacts: null,
      summary: null,
    });
  } finally {
    if (imageObjectUrl !== null) {
      try {
        revokeObjectURL(imageObjectUrl);
      } catch {
        // Revocation is attempted unconditionally; cleanup errors remain non-governing.
      }
    }
    executionGate.current = false;
  }
}

export function downloadYoshiT2Artifact(runResult, name, {
  BlobImpl = globalThis.Blob,
  createObjectURL = value => URL.createObjectURL(value),
  revokeObjectURL = value => URL.revokeObjectURL(value),
  createAnchor = () => document.createElement('a'),
} = {}) {
  const selected = runResult?.ok === true ? runResult.artifacts?.[name] : null;
  if (!selected || !YOSHI_T2_ARTIFACT_NAMES.includes(name)) return false;
  if (typeof BlobImpl !== 'function') return false;

  let downloadUrl = null;
  let anchor = null;
  try {
    const textBlob = new BlobImpl([selected.text], { type: selected.mimeType });
    downloadUrl = createObjectURL(textBlob);
    anchor = createAnchor();
    anchor.href = downloadUrl;
    anchor.download = name;
    anchor.rel = 'noopener';
    anchor.click();
    return true;
  } catch {
    return false;
  } finally {
    try {
      anchor?.remove?.();
    } catch {
      // Detached anchors need no further action.
    }
    if (downloadUrl !== null) {
      try {
        revokeObjectURL(downloadUrl);
      } catch {
        // The local text URL is still revoked whenever the browser permits it.
      }
    }
  }
}
