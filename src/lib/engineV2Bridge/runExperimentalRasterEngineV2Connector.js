import { experimentalEngineV2RasterObservation } from './featureFlags.js';

const VERSION = 't1-experimental-raster-engine-v2-observation';
const EMPTY_LIST = Object.freeze([]);
const MAX_BOUNDARY_DEPTH = 64;
const MAX_BOUNDARY_NODES = 250_000;
const MAX_BOUNDARY_PROPERTIES = 2_000_000;
const BINARY_VALUE_FIELDS = new Set([
  'binary', 'buffer', 'bytes', 'bytearray', 'bytebuffer', 'binarypayload',
  'encodedbytes', 'encodedpayload', 'encoderresult', 'dstartifact', 'dsbartifact',
  'dst', 'dsb', 'dstbytes', 'dsbbytes', 'dstbuffer', 'dsbbuffer', 'dstpayload',
  'dsbpayload', 'binaryfile', 'exportedfile',
]);
const DOWNLOAD_FIELDS = new Set([
  'downloadurl', 'downloadhref', 'downloaduri', 'objecturl', 'objecturi',
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
const NATIVE_ERROR_DATA_KEYS = new Set([
  'name', 'message', 'stack', 'cause', 'errors', 'code', 'path',
]);
const NATIVE_ERROR_PROTOTYPES = new Set([
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
  ...(typeof AggregateError === 'undefined' ? [] : [AggregateError]),
].map(ErrorConstructor => ErrorConstructor.prototype));

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach(key => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function errorRecord(code, path, message) {
  return { code, path, message };
}

function thrownDataField(caught, key) {
  if (caught === null || typeof caught !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(caught, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function errorFrom(caught, fallbackCode, fallbackPath) {
  const code = thrownDataField(caught, 'code');
  const path = thrownDataField(caught, 'path');
  const message = thrownDataField(caught, 'message');
  return errorRecord(
    typeof code === 'string' ? code : fallbackCode,
    typeof path === 'string' ? path : fallbackPath,
    typeof message === 'string'
      ? message
      : typeof caught === 'string' ? caught : 'An uninspectable exception was isolated.',
  );
}

function boundaryMetadata(overrides = {}) {
  return {
    governingResult: 'legacy',
    machineAdaptationApplied: false,
    encodingApplied: false,
    binaryArtifactCreated: false,
    dstArtifactCount: 0,
    dsbArtifactCount: 0,
    ...overrides,
  };
}

function diagnostic(input) {
  return deepFreeze({
    version: VERSION,
    status: input.status,
    requested: input.requested,
    reasonCode: input.reasonCode,
    errors: input.errors || [],
    source: input.source || null,
    engineV2Result: input.engineV2Result || null,
    canonicalCommands: input.canonicalCommands || [],
    metrics: input.metrics || null,
    traces: input.traces || null,
    metadata: boundaryMetadata(input.metadata),
  });
}

function observation(legacyResult, sidecar) {
  return Object.freeze({
    legacyResult,
    diagnostic: sidecar,
  });
}

function boundaryViolation(path, message) {
  return errorRecord('T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION', path, message);
}

function hasPayload(value) {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== '';
}

function binaryObjectKind(value) {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return 'Buffer';
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    return value instanceof DataView ? 'DataView' : 'typed array';
  }
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return 'ArrayBuffer';
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) return 'SharedArrayBuffer';
  if (typeof Blob !== 'undefined' && value instanceof Blob) return 'Blob';
  return null;
}

function inspectEngineBoundary(root, options = {}) {
  const clones = new WeakMap();
  const activeAncestors = new WeakSet();
  const budget = { nodes: 0, properties: 0 };
  const rootPath = options.rootPath || 'engineV2Result';
  const allowNativeErrors = options.allowNativeErrors === true;
  const maxDepth = options.maxDepth ?? MAX_BOUNDARY_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_BOUNDARY_NODES;
  const maxProperties = options.maxProperties ?? MAX_BOUNDARY_PROPERTIES;

  function inspect(value, path, depth) {
    const valueType = typeof value;
    if (valueType === 'function') {
      return { error: boundaryViolation(path, 'Engine V2 output contains a forbidden function value.') };
    }
    if (valueType === 'symbol') {
      return { error: boundaryViolation(path, 'Engine V2 output contains a forbidden symbol value.') };
    }
    if (value === null || valueType !== 'object') return { value };
    if (depth > maxDepth) {
      return { error: boundaryViolation(path, 'Engine V2 output exceeds the bounded T1 inspection depth.') };
    }
    if (activeAncestors.has(value)) {
      return { error: boundaryViolation(path, 'Engine V2 output contains a forbidden cyclic reference.') };
    }
    if (clones.has(value)) return { value: clones.get(value) };
    budget.nodes += 1;
    if (budget.nodes > maxNodes) {
      return { error: boundaryViolation(path, 'Engine V2 output exceeds the bounded T1 object budget.') };
    }

    try {
      const kind = binaryObjectKind(value);
      if (kind !== null) {
        return { error: boundaryViolation(path, `Engine V2 output contains a forbidden ${kind}.`) };
      }

      const isArray = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      const isNativeError = allowNativeErrors && NATIVE_ERROR_PROTOTYPES.has(prototype);
      if ((isArray && prototype !== Array.prototype)
        || (!isArray && !isNativeError && prototype !== Object.prototype && prototype !== null)) {
        return { error: boundaryViolation(path, 'Engine V2 output contains an unsupported object prototype.') };
      }

      const clone = isArray ? [] : prototype === null ? Object.create(null) : {};
      clones.set(value, clone);
      activeAncestors.add(value);
      try {
        const keys = Reflect.ownKeys(value);
        budget.properties += keys.length;
        if (budget.properties > maxProperties) {
          return { error: boundaryViolation(path, 'Engine V2 output exceeds the bounded T1 property budget.') };
        }
        if (keys.some(key => typeof key === 'symbol')) {
          return { error: boundaryViolation(path, 'Engine V2 output contains a symbol property.') };
        }

        const stringKeys = keys.filter(key => key !== 'length').sort();
        if (isArray) {
          const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
          const length = lengthDescriptor?.value;
          if (!Number.isSafeInteger(length) || length < 0 || stringKeys.length !== length) {
            return { error: boundaryViolation(path, 'Engine V2 output contains a sparse or malformed array.') };
          }
        }
        for (const key of stringKeys) {
          if (isArray && !/^(0|[1-9]\d*)$/.test(key)) {
            return { error: boundaryViolation(`${path}.${key}`, 'Engine V2 arrays may contain only indexed data properties.') };
          }
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          const admittedNativeErrorData = isNativeError && NATIVE_ERROR_DATA_KEYS.has(key);
          if (isNativeError && key === 'stack' && descriptor
            && ('get' in descriptor || 'set' in descriptor)) {
            continue;
          }
          if (!descriptor || 'get' in descriptor || 'set' in descriptor
            || (descriptor.enumerable !== true && !admittedNativeErrorData)) {
            return { error: boundaryViolation(`${path}.${key}`, 'Engine V2 output must expose admitted data properties only.') };
          }

          const normalizedKey = key.toLowerCase();
          const nested = descriptor.value;
          if ((BINARY_VALUE_FIELDS.has(normalizedKey) || DOWNLOAD_FIELDS.has(normalizedKey)) && hasPayload(nested)) {
            return { error: boundaryViolation(`${path}.${key}`, `Engine V2 output exposes forbidden T1 field "${key}".`) };
          }
          if (EXACT_FALSE_SIGNAL_FIELDS.has(normalizedKey) && nested !== false) {
            return { error: boundaryViolation(`${path}.${key}`, `Engine V2 signal "${key}" must be exactly false.`) };
          }
          if (ZERO_COUNTER_FIELDS.has(normalizedKey) && nested !== 0) {
            return { error: boundaryViolation(`${path}.${key}`, `Engine V2 counter "${key}" must be exactly zero.`) };
          }
          if (['format', 'fileformat', 'outputformat'].includes(normalizedKey)
            && typeof nested === 'string' && ['dst', 'dsb'].includes(nested.toLowerCase())) {
            return { error: boundaryViolation(`${path}.${key}`, 'Engine V2 output must not select a DST/DSB format in T1.') };
          }

          const inspected = inspect(nested, isArray ? `${path}[${key}]` : `${path}.${key}`, depth + 1);
          if (inspected.error) return inspected;
          Object.defineProperty(clone, key, {
            value: inspected.value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return { value: clone };
      } finally {
        activeAncestors.delete(value);
      }
    } catch {
      return { error: boundaryViolation(path, 'Engine V2 output could not be inspected safely.') };
    }
  }

  const inspected = inspect(root, rootPath, 0);
  return inspected.error
    ? { error: inspected.error, sanitizedResult: null }
    : { error: null, sanitizedResult: inspected.value };
}

export const _t1BoundaryInspection = Object.freeze({
  inspect(root, limits = {}) {
    return inspectEngineBoundary(root, {
      rootPath: 'engineV2Result',
      maxDepth: limits.maxDepth,
      maxNodes: limits.maxNodes,
      maxProperties: limits.maxProperties,
    });
  },
  inspectThrown(root, limits = {}) {
    return inspectEngineBoundary(root, {
      rootPath: 'engineV2Exception',
      allowNativeErrors: true,
      maxDepth: limits.maxDepth,
      maxNodes: limits.maxNodes,
      maxProperties: limits.maxProperties,
    });
  },
});

function hasExactFalseMetadata(metadata) {
  return metadata !== null && typeof metadata === 'object'
    && metadata.machineAdaptationApplied === false
    && metadata.encodingApplied === false
    && metadata.binaryArtifactCreated === false;
}

function validateCompletedMetadata(result) {
  if (!hasExactFalseMetadata(result.metadata) || !hasExactFalseMetadata(result.document?.metadata)) {
    return boundaryViolation(
      'engineV2Result.metadata',
      'Completed T1 output requires explicit false machine/encoding/binary metadata in result and document.',
    );
  }
  return null;
}

function metricsOf(result) {
  const commands = result.document.commands;
  const commandTypes = {};
  commands.forEach(command => {
    commandTypes[command.type] = (commandTypes[command.type] || 0) + 1;
  });
  return {
    regionCount: result.document.regions.length,
    objectCount: result.document.objects.length,
    threadCount: result.document.threads.length,
    threadBlockCount: result.document.threadBlocks.length,
    commandCount: commands.length,
    commandTypes: Object.fromEntries(Object.keys(commandTypes).sort().map(key => [key, commandTypes[key]])),
  };
}

function tracesOf(result) {
  return {
    terminalStage: result.terminalStage,
    completedStages: [...result.completedStages],
    errorCodes: result.errors.map(item => item.code),
    warningCodes: result.warnings.map(item => item.code),
  };
}

function sourceFrom(adapted) {
  return {
    coordinateContract: adapted.coordinateContract,
    metadata: adapted.metadata,
    nonContractualProvenance: adapted.nonContractualProvenance,
  };
}

function blockedBoundaryObservation(legacyResult, adapted = null) {
  return observation(legacyResult, diagnostic({
    status: 'blocked',
    requested: true,
    reasonCode: 'T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION',
    errors: EMPTY_LIST,
    source: adapted === null ? null : sourceFrom(adapted),
    engineV2Result: null,
    canonicalCommands: EMPTY_LIST,
  }));
}

function dependencyUnavailableObservation(legacyResult) {
  return observation(legacyResult, diagnostic({
    status: 'failed',
    requested: true,
    reasonCode: 'T1_ENGINE_V2_DEPENDENCY_UNAVAILABLE',
    errors: [errorRecord(
      'T1_ENGINE_V2_DEPENDENCY_UNAVAILABLE',
      'engineV2.dependencies',
      'The active T1 adapter or Engine V2 dependency could not be loaded.',
    )],
    canonicalCommands: EMPTY_LIST,
  }));
}

function thrownBoundaryIsInvalid(caught, rootPath) {
  return inspectEngineBoundary(caught, {
    rootPath,
    allowNativeErrors: true,
  }).error !== null;
}

export function observeLegacyRasterPipelineResult(
  legacyResult,
  activation = experimentalEngineV2RasterObservation,
  executeBridge,
  adaptInput,
) {
  if (activation === false || activation === undefined) {
    return observation(legacyResult, diagnostic({
      status: 'not_requested',
      requested: false,
      reasonCode: 'T1_RASTER_ENGINE_V2_OBSERVATION_NOT_REQUESTED',
      errors: EMPTY_LIST,
      canonicalCommands: EMPTY_LIST,
    }));
  }
  if (activation !== true) {
    return observation(legacyResult, diagnostic({
      status: 'blocked',
      requested: true,
      reasonCode: 'T1_RASTER_ENGINE_V2_ACTIVATION_INVALID',
      errors: [errorRecord(
        'T1_RASTER_ENGINE_V2_ACTIVATION_INVALID',
        'activation',
        'Experimental raster observation activation must be boolean true or false.',
      )],
      canonicalCommands: EMPTY_LIST,
    }));
  }

  if (typeof executeBridge !== 'function' || typeof adaptInput !== 'function') {
    return observation(legacyResult, diagnostic({
      status: 'failed',
      requested: true,
      reasonCode: 'T1_ENGINE_V2_DEPENDENCY_UNAVAILABLE',
      errors: [errorRecord(
        'T1_ENGINE_V2_DEPENDENCY_UNAVAILABLE',
        'engineV2',
        'The active T1 observer requires explicitly loaded adapter and Engine V2 dependencies.',
      )],
      canonicalCommands: EMPTY_LIST,
    }));
  }

  let adapted;
  try {
    adapted = adaptInput(legacyResult);
  } catch (caught) {
    if (thrownBoundaryIsInvalid(caught, 'adapterException')) {
      return blockedBoundaryObservation(legacyResult);
    }
    const error = errorFrom(caught, 'T1_RASTER_ADAPTATION_BLOCKED', 'legacyResult');
    return observation(legacyResult, diagnostic({
      status: 'blocked',
      requested: true,
      reasonCode: error.code,
      errors: [error],
      canonicalCommands: EMPTY_LIST,
    }));
  }

  try {
    const result = executeBridge({
      regions: adapted.sourceRegions,
      config: adapted.bridgeConfig,
      enabled: true,
    });
    const inspectedBoundary = inspectEngineBoundary(result);
    if (inspectedBoundary.error) return blockedBoundaryObservation(legacyResult, adapted);

    const sanitizedResult = inspectedBoundary.sanitizedResult;
    if (!sanitizedResult || typeof sanitizedResult !== 'object' || sanitizedResult.valid !== true) {
      return observation(legacyResult, diagnostic({
        status: 'blocked',
        requested: true,
        reasonCode: 'T1_ENGINE_V2_RESULT_BLOCKED',
        errors: [errorRecord(
          'T1_ENGINE_V2_RESULT_BLOCKED',
          'engineV2Result',
          'Engine V2 did not return a valid completed result.',
        )],
        source: sourceFrom(adapted),
        engineV2Result: null,
        canonicalCommands: EMPTY_LIST,
      }));
    }

    const metadataError = validateCompletedMetadata(sanitizedResult);
    if (metadataError) return blockedBoundaryObservation(legacyResult, adapted);

    return observation(legacyResult, diagnostic({
      status: 'completed',
      requested: true,
      reasonCode: null,
      errors: EMPTY_LIST,
      source: sourceFrom(adapted),
      engineV2Result: sanitizedResult,
      canonicalCommands: sanitizedResult.document.commands,
      metrics: metricsOf(sanitizedResult),
      traces: tracesOf(sanitizedResult),
    }));
  } catch (caught) {
    if (thrownBoundaryIsInvalid(caught, 'engineV2Exception')) {
      return blockedBoundaryObservation(legacyResult, adapted);
    }
    const error = errorFrom(caught, 'T1_ENGINE_V2_EXECUTION_FAILED', 'engineV2');
    return observation(legacyResult, diagnostic({
      status: 'failed',
      requested: true,
      reasonCode: 'T1_ENGINE_V2_EXECUTION_FAILED',
      errors: [{ ...error, code: 'T1_ENGINE_V2_EXECUTION_FAILED' }],
      source: sourceFrom(adapted),
      canonicalCommands: EMPTY_LIST,
    }));
  }
}

async function runCompleteLegacyRasterPipeline(imageUrl, config, pipelineOptions) {
  const { runPipeline } = await import('../pipeline/runner.js');
  return runPipeline(imageUrl, config, pipelineOptions);
}

async function loadActiveObservationDependencies() {
  const [adapterModule, bridgeModule] = await Promise.all([
    import('./legacyRasterToEngineV2Input.js'),
    import('./runExperimentalEngineV2Bridge.js'),
  ]);
  return {
    adaptInput: adapterModule.adaptLegacyRasterPipelineResultToEngineV2Input,
    executeBridge: bridgeModule.runExperimentalEngineV2Bridge,
  };
}

export async function runExperimentalRasterEngineV2Connector(
  imageUrl,
  config,
  pipelineOptions = {},
  activation = experimentalEngineV2RasterObservation,
) {
  const legacyResult = await runCompleteLegacyRasterPipeline(imageUrl, config, pipelineOptions);
  if (activation !== true) return observeLegacyRasterPipelineResult(legacyResult, activation);

  let dependencies;
  try {
    dependencies = await loadActiveObservationDependencies();
  } catch {
    return dependencyUnavailableObservation(legacyResult);
  }
  return observeLegacyRasterPipelineResult(
    legacyResult,
    true,
    dependencies.executeBridge,
    dependencies.adaptInput,
  );
}
