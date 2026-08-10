import { afterEach, describe, expect, it, vi } from 'vitest';

const runnerStageHarness = vi.hoisted(() => ({ calls: [] }));

vi.mock('../../pipeline/stages/imageAnalysisStage.js', () => ({
  runImageAnalysis: vi.fn(async context => {
    runnerStageHarness.calls.push('image_analysis');
    context.analysis = { imageWidth: 1600, imageHeight: 1200 };
  }),
}));
vi.mock('../../pipeline/stages/imageEnhancementStage.js', () => ({
  runImageEnhancement: vi.fn(async context => {
    runnerStageHarness.calls.push('image_enhancement');
    context.enhanced = { externalDependencySimulated: true };
  }),
}));
vi.mock('../../pipeline/stages/contourEngineStage.js', () => ({
  runContourEngine: vi.fn(async context => {
    runnerStageHarness.calls.push('contour_engine');
    context.contours = { externalDependencySimulated: true };
  }),
}));
vi.mock('../../pipeline/stages/semanticSegmentationStage.js', () => ({
  runSemanticSegmentation: vi.fn(async context => {
    runnerStageHarness.calls.push('semantic_segmentation');
    context.semantic = { externalDependencySimulated: true };
  }),
}));
vi.mock('../../pipeline/stages/vectorEngineStage.js', () => ({
  runVectorEngine: vi.fn(async context => {
    runnerStageHarness.calls.push('vector_engine');
    context.vectorRegions = [{
      id: 'upstream-random-real-runner',
      name: 'runner body',
      color: '#3366cc',
      hex: '#3366cc',
      visible: true,
      semanticRole: 'primary_shape',
      stitch_type: 'fill',
      density: 0.4,
      angle: 0,
      layer_order: 1,
      pull_compensation: 0.2,
      underlay: true,
      area_norm: 0.49,
      perimeter_norm: 2.8,
      centroid: [0.45, 0.45],
      path_points: [[0.1, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8]],
      holes: 0,
    }];
  }),
}));

import {
  _t1RasterIdCollisionGuard,
  adaptLegacyRasterPipelineResultToEngineV2Input,
  T1_REQUIRED_LEGACY_STAGES,
} from '../../engineV2Bridge/legacyRasterToEngineV2Input.js';
import {
  _t1BoundaryInspection,
  observeLegacyRasterPipelineResult,
  runExperimentalRasterEngineV2Connector,
} from '../../engineV2Bridge/runExperimentalRasterEngineV2Connector.js';
import { experimentalEngineV2RasterObservation } from '../../engineV2Bridge/featureFlags.js';
import { runExperimentalEngineV2Bridge } from '../../engineV2Bridge/runExperimentalEngineV2Bridge.js';
import { runPipeline } from '../../pipeline/runner.js';

const LITERAL_RUNNER_STAGES = Object.freeze([
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
const SIMULATED_EXTERNAL_STAGES = Object.freeze(LITERAL_RUNNER_STAGES.slice(0, 5));

const BOUNDARY_METADATA = Object.freeze({
  machineAdaptationApplied: false,
  encodingApplied: false,
  binaryArtifactCreated: false,
});

function region(overrides = {}) {
  return {
    id: 'legacy-primary',
    name: 'body',
    color: '#3366cc',
    visible: true,
    semanticRole: 'primary_shape',
    stitch_type: 'fill',
    path_points: [
      [0.1, 0.1],
      [0.8, 0.1],
      [0.8, 0.8],
      [0.1, 0.8],
    ],
    holes: 0,
    ...overrides,
  };
}

function completedLegacyResult(overrides = {}) {
  return {
    imageUrl: 'data:image/jpeg;base64,legacy-source',
    config: {
      mode: 'hybrid',
      width_mm: 80,
      height_mm: 60,
    },
    analysis: {
      imageWidth: 1600,
      imageHeight: 1200,
    },
    regions: [region()],
    plan: { source: 'legacy', sequence: ['legacy-primary'] },
    optimized: { source: 'legacy', optimizedSequence: ['legacy-primary'] },
    stageLog: LITERAL_RUNNER_STAGES.map((stage, index) => ({
      stage,
      durationMs: index + 1,
      ok: true,
      ts: 1_800_000_000_000 + index,
    })),
    ...overrides,
  };
}

function successfulBridgeResult(sourceRegions = []) {
  return {
    version: '2',
    valid: true,
    terminalStage: 'documentValidation',
    completedStages: ['ingestion', 'documentValidation'],
    stages: {},
    document: {
      version: '2',
      regions: sourceRegions,
      objects: [],
      threads: [],
      threadBlocks: [],
      commands: [{ id: 'command-1', type: 'stitch', x: 1, y: 1 }],
      metadata: { ...BOUNDARY_METADATA },
    },
    documentValidation: { valid: true, errors: [], warnings: [] },
    errors: [],
    warnings: [],
    metadata: { ...BOUNDARY_METADATA },
  };
}

function captureBlocked(legacyResult, executeBridge = vi.fn()) {
  const observed = observeLegacyRasterPipelineResult(
    legacyResult,
    true,
    executeBridge,
    adaptLegacyRasterPipelineResultToEngineV2Input,
  );
  expect(observed.legacyResult).toBe(legacyResult);
  expect(observed.diagnostic.status).toBe('blocked');
  expect(observed.diagnostic.metadata.governingResult).toBe('legacy');
  expect(observed.diagnostic.canonicalCommands).toEqual([]);
  expect(executeBridge).not.toHaveBeenCalled();
  return observed;
}

function expectSanitizedBoundaryViolation(legacyResult, executeBridge) {
  let observed;
  expect(() => {
    observed = observeLegacyRasterPipelineResult(
      legacyResult,
      true,
      executeBridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );
  }).not.toThrow();
  expect(observed.legacyResult).toBe(legacyResult);
  expect(observed.diagnostic).toMatchObject({
    status: 'blocked',
    requested: true,
    reasonCode: 'T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION',
    errors: [],
    engineV2Result: null,
    canonicalCommands: [],
    metrics: null,
    traces: null,
    metadata: {
      governingResult: 'legacy',
      machineAdaptationApplied: false,
      encodingApplied: false,
      binaryArtifactCreated: false,
      dstArtifactCount: 0,
      dsbArtifactCount: 0,
    },
  });
  expect(() => JSON.stringify(observed.diagnostic)).not.toThrow();
  expect(() => JSON.stringify(observed)).not.toThrow();
  return observed;
}

async function withIsolatedConnectorModules(run, options = {}) {
  const adapterPath = '../../engineV2Bridge/legacyRasterToEngineV2Input.js';
  const bridgePath = '../../engineV2Bridge/runExperimentalEngineV2Bridge.js';
  const loads = { adapter: 0, bridge: 0 };

  vi.resetModules();
  vi.doMock(adapterPath, async () => {
    loads.adapter += 1;
    if (options.failAdapter === true) throw new Error('isolated adapter import failure');
    return vi.importActual(adapterPath);
  });
  vi.doMock(bridgePath, async () => {
    loads.bridge += 1;
    if (options.failBridge === true) throw new Error('isolated bridge import failure');
    return vi.importActual(bridgePath);
  });
  try {
    const connectorModule = await import('../../engineV2Bridge/runExperimentalRasterEngineV2Connector.js');
    await run({ connectorModule, loads });
  } finally {
    vi.doUnmock(adapterPath);
    vi.doUnmock(bridgePath);
    vi.resetModules();
  }
}

function withTemporarilyMissingGlobal(name, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  expect(descriptor).toBeDefined();
  try {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      writable: true,
      value: undefined,
    });
    run();
  } finally {
    Object.defineProperty(globalThis, name, descriptor);
  }
}

describe('T1 experimental raster to Engine V2 connector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps raster observation disabled by default', () => {
    expect(experimentalEngineV2RasterObservation).toBe(false);
  });

  it('does not load the adapter or Engine V2 merely by importing the connector', async () => {
    await withIsolatedConnectorModules(async ({ loads }) => {
      expect(loads).toEqual({ adapter: 0, bridge: 0 });
    });
  });

  it.each([
    ['absent', observer => observer(completedLegacyResult())],
    ['explicit undefined', observer => observer(completedLegacyResult(), undefined)],
    ['OFF', observer => observer(completedLegacyResult(), false)],
    ['invalid', observer => observer(completedLegacyResult(), 'on')],
  ])('does not load active dependencies when activation is %s', async (_name, invoke) => {
    await withIsolatedConnectorModules(async ({ connectorModule, loads }) => {
      const observed = invoke(connectorModule.observeLegacyRasterPipelineResult);
      expect(observed.diagnostic.status).not.toBe('completed');
      expect(loads).toEqual({ adapter: 0, bridge: 0 });
    });
  });

  it('preserves the complete governing legacy result when activation is absent', async () => {
    runnerStageHarness.calls.length = 0;
    const pipelineOptions = { onProgress: vi.fn() };

    const observed = await runExperimentalRasterEngineV2Connector(
      'data:image/jpeg;base64,real-runner-off',
      { mode: 'hybrid', width_mm: 80, height_mm: 60, contourSafeMode: true },
      pipelineOptions,
      undefined,
    );

    expect(vi.isMockFunction(runPipeline)).toBe(false);
    expect(runnerStageHarness.calls).toEqual(SIMULATED_EXTERNAL_STAGES);
    expect(observed.legacyResult.stageLog.map(entry => entry.stage)).toEqual(LITERAL_RUNNER_STAGES);
    expect(observed.diagnostic.status).toBe('not_requested');
    expect(observed.diagnostic.requested).toBe(false);
  });

  it('executes the real nine-stage runner orchestrator into the adapter and Engine V2', async () => {
    await withIsolatedConnectorModules(async ({ connectorModule, loads }) => {
      runnerStageHarness.calls.length = 0;
      const observed = await connectorModule.runExperimentalRasterEngineV2Connector(
        'data:image/jpeg;base64,real-runner-controlled',
        { mode: 'hybrid', width_mm: 80, height_mm: 60, contourSafeMode: true },
        { onProgress: vi.fn() },
        true,
      );

      expect(vi.isMockFunction(runPipeline)).toBe(false);
      expect(loads).toEqual({ adapter: 1, bridge: 1 });
      expect(T1_REQUIRED_LEGACY_STAGES).toEqual(LITERAL_RUNNER_STAGES);
      expect(runnerStageHarness.calls).toEqual(SIMULATED_EXTERNAL_STAGES);
      expect(observed.legacyResult.stageLog.map(entry => entry.stage)).toEqual(LITERAL_RUNNER_STAGES);
      expect(observed.legacyResult.plan).not.toBeNull();
      expect(observed.legacyResult.qualityPhase1Report.phase)
        .toBe('QUALITY_PHASE_1_INPUT_SEGMENTATION_CLEANUP_V1');
      expect(observed.diagnostic.status).toBe('completed');
      expect(observed.diagnostic.metadata).toMatchObject({
        governingResult: 'legacy',
        machineAdaptationApplied: false,
        encodingApplied: false,
        binaryArtifactCreated: false,
      });

      runnerStageHarness.calls.length = 0;
      const repeated = await connectorModule.runExperimentalRasterEngineV2Connector(
        'data:image/jpeg;base64,real-runner-controlled-repeated',
        { mode: 'hybrid', width_mm: 80, height_mm: 60, contourSafeMode: true },
        { onProgress: vi.fn() },
        true,
      );
      expect(repeated.diagnostic.status).toBe('completed');
      expect(loads).toEqual({ adapter: 1, bridge: 1 });
      expect(runnerStageHarness.calls).toEqual(SIMULATED_EXTERNAL_STAGES);
    });

    for (const failedDependency of ['adapter', 'bridge']) {
      await withIsolatedConnectorModules(async ({ connectorModule, loads }) => {
        runnerStageHarness.calls.length = 0;
        const observed = await connectorModule.runExperimentalRasterEngineV2Connector(
          `data:image/jpeg;base64,real-runner-${failedDependency}-import-failure`,
          { mode: 'hybrid', width_mm: 80, height_mm: 60, contourSafeMode: true },
          { onProgress: vi.fn() },
          true,
        );

        expect(observed.legacyResult.stageLog.map(entry => entry.stage)).toEqual(LITERAL_RUNNER_STAGES);
        expect(observed.diagnostic).toMatchObject({
          status: 'failed',
          requested: true,
          reasonCode: 'T1_ENGINE_V2_DEPENDENCY_UNAVAILABLE',
          engineV2Result: null,
          canonicalCommands: [],
          metrics: null,
          traces: null,
          errors: [{
            code: 'T1_ENGINE_V2_DEPENDENCY_UNAVAILABLE',
            path: 'engineV2.dependencies',
          }],
          metadata: { governingResult: 'legacy' },
        });
        expect(loads[failedDependency]).toBe(1);
        expect(runnerStageHarness.calls).toEqual(SIMULATED_EXTERNAL_STAGES);
        expect(() => JSON.stringify(observed.diagnostic)).not.toThrow();
        expect(() => JSON.stringify(observed)).not.toThrow();
      }, {
        failAdapter: failedDependency === 'adapter',
        failBridge: failedDependency === 'bridge',
      });
    }
  }, 30_000);

  it('preserves the complete governing legacy result when activation is explicitly undefined', () => {
    const legacyResult = completedLegacyResult();
    const observed = observeLegacyRasterPipelineResult(legacyResult, undefined, vi.fn());

    expect(observed.legacyResult).toBe(legacyResult);
    expect(observed.legacyResult).toEqual(legacyResult);
    expect(observed.diagnostic.status).toBe('not_requested');
  });

  it('preserves the complete governing legacy result when activation is OFF', () => {
    const legacyResult = completedLegacyResult();
    const executeBridge = vi.fn();
    const observed = observeLegacyRasterPipelineResult(legacyResult, false, executeBridge);

    expect(observed.legacyResult).toBe(legacyResult);
    expect(observed.legacyResult).toEqual(legacyResult);
    expect(observed.diagnostic).toMatchObject({
      status: 'not_requested',
      requested: false,
      reasonCode: 'T1_RASTER_ENGINE_V2_OBSERVATION_NOT_REQUESTED',
    });
    expect(executeBridge).not.toHaveBeenCalled();
  });

  it('does not inspect a hostile legacy result while observation is not requested', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => observeLegacyRasterPipelineResult(proxy, false, vi.fn())).not.toThrow();
    const observed = observeLegacyRasterPipelineResult(proxy, false, vi.fn());
    expect(observed.legacyResult).toBe(proxy);
    expect(observed.diagnostic.status).toBe('not_requested');
  });

  it('passes only adapted copies to the bridge after the complete legacy boundary', () => {
    const legacyResult = completedLegacyResult();
    const executeBridge = vi.fn(({ regions }) => successfulBridgeResult(regions));

    const observed = observeLegacyRasterPipelineResult(
      legacyResult,
      true,
      executeBridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );

    expect(executeBridge).toHaveBeenCalledTimes(1);
    expect(executeBridge.mock.calls[0][0]).toMatchObject({
      enabled: true,
      config: { width_mm: 80, height_mm: 60 },
    });
    expect(executeBridge.mock.calls[0][0].regions).not.toBe(legacyResult.regions);
    expect(observed.legacyResult).toBe(legacyResult);
    expect(observed.diagnostic.status).toBe('completed');
  });

  it('adapts IDs and order deterministically without importing legacy techniques', () => {
    const second = region({
      id: 'legacy-secondary',
      name: 'face',
      color: '#ffeecc',
      semanticRole: 'secondary_shape',
      path_points: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]],
    });
    const input = completedLegacyResult({ regions: [second, region()] });

    const first = adaptLegacyRasterPipelineResultToEngineV2Input(input);
    const repeated = adaptLegacyRasterPipelineResultToEngineV2Input(structuredClone(input));

    expect(first).toEqual(repeated);
    expect(first).not.toBe(repeated);
    expect(first.sourceRegions.map(item => item.id)).toEqual([
      't1-raster-region-0001-369913e13892d80d',
      't1-raster-region-0002-42e600865d7a18a8',
    ]);
    first.sourceRegions.forEach(item => {
      expect(item).not.toHaveProperty('stitch_type');
      expect(item).not.toHaveProperty('technique');
    });
  });

  it('keeps normalized coordinates unchanged and records source and physical dimensions', () => {
    const input = completedLegacyResult();
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(input);

    expect(adapted.sourceRegions[0].path_points).toEqual(input.regions[0].path_points);
    expect(adapted.coordinateContract).toEqual({
      coordinateSpace: 'normalized',
      sourceWidthPx: 1600,
      sourceHeightPx: 1200,
      designWidthMm: 80,
      designHeightMm: 60,
    });
    expect(adapted.bridgeConfig).toEqual({ width_mm: 80, height_mm: 60 });
  });

  it('preserves colors, contour fallback, and explicit hole polygons', () => {
    const outer = [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]];
    const hole = [[0.3, 0.3], [0.3, 0.5], [0.5, 0.5], [0.5, 0.3]];
    const contourRegion = region({
      id: 'legacy-contour',
      color: undefined,
      hex: '#abc',
      path_points: undefined,
      contour_points: outer,
      holes: 1,
      hole_points: [hole],
    });
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(
      completedLegacyResult({ regions: [contourRegion] }),
    );
    const source = adapted.sourceRegions[0];

    expect(source.color).toBe('#aabbcc');
    expect(source.path_points).toEqual(outer);
    expect(source.holes).toEqual([hole]);
    expect(source.source).toMatchObject({
      sourceGeometryField: 'contour_points',
      sourceHoleGeometryField: 'hole_points',
      reportedLegacyHoleCount: 1,
    });
  });

  it('does not invent hole geometry from the legacy numeric estimate', () => {
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(
      completedLegacyResult({ regions: [region({ holes: 2 })] }),
    );

    expect(adapted.sourceRegions[0].holes).toEqual([]);
    expect(adapted.sourceRegions[0].source.reportedLegacyHoleCount).toBe(2);
    expect(adapted.sourceRegions[0].source.sourceHoleGeometryField).toBeNull();
  });

  it('only forwards semantic labels actually present in the source', () => {
    const source = region({
      name: undefined,
      object: undefined,
      object_group: undefined,
      region_class: undefined,
      semanticRole: undefined,
    });
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(
      completedLegacyResult({ regions: [source] }),
    );

    expect(adapted.sourceRegions[0]).not.toHaveProperty('name');
    expect(adapted.sourceRegions[0]).not.toHaveProperty('object');
    expect(adapted.sourceRegions[0]).not.toHaveProperty('object_group');
    expect(adapted.sourceRegions[0]).not.toHaveProperty('region_class');
    expect(adapted.sourceRegions[0]).not.toHaveProperty('semanticRole');
  });

  it('does not mutate the completed legacy context and returns independent structures', () => {
    const input = completedLegacyResult();
    const snapshot = structuredClone(input);
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(input);

    expect(input).toEqual(snapshot);
    expect(adapted.sourceRegions).not.toBe(input.regions);
    expect(adapted.sourceRegions[0]).not.toBe(input.regions[0]);
    expect(adapted.sourceRegions[0].path_points).not.toBe(input.regions[0].path_points);
  });

  it('deeply freezes adapted output and completed diagnostics without freezing legacy state', () => {
    const legacyResult = completedLegacyResult();
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(legacyResult);
    const observed = observeLegacyRasterPipelineResult(
      legacyResult,
      true,
      ({ regions }) => successfulBridgeResult(regions),
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );

    expect(Object.isFrozen(adapted)).toBe(true);
    expect(Object.isFrozen(adapted.sourceRegions)).toBe(true);
    expect(Object.isFrozen(adapted.sourceRegions[0].path_points)).toBe(true);
    expect(Object.isFrozen(observed)).toBe(true);
    expect(Object.isFrozen(observed.diagnostic)).toBe(true);
    expect(Object.isFrozen(observed.diagnostic.canonicalCommands)).toBe(true);
    expect(Object.isFrozen(observed.diagnostic.engineV2Result)).toBe(true);
    expect(Object.isFrozen(legacyResult)).toBe(false);
  });

  it('blocks a degenerate region before Engine V2', () => {
    const observed = captureBlocked(completedLegacyResult({
      regions: [region({ path_points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] })],
    }));

    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_DEGENERATE_POLYGON');
  });

  it('blocks non-finite coordinates before Engine V2', () => {
    const observed = captureBlocked(completedLegacyResult({
      regions: [region({ path_points: [[0.1, 0.1], [Number.NaN, 0.2], [0.3, 0.4]] })],
    }));

    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_POINT_INVALID');
  });

  it.each([
    ['analysis.imageWidth', result => { result.analysis.imageWidth = 0; }, 'T1_RASTER_SOURCE_WIDTH_INVALID'],
    ['analysis.imageHeight', result => { result.analysis.imageHeight = Infinity; }, 'T1_RASTER_SOURCE_HEIGHT_INVALID'],
    ['config.width_mm', result => { result.config.width_mm = null; }, 'T1_RASTER_DESIGN_WIDTH_INVALID'],
    ['config.height_mm', result => { result.config.height_mm = -1; }, 'T1_RASTER_DESIGN_HEIGHT_INVALID'],
  ])('blocks invalid dimension %s before Engine V2', (_name, mutate, code) => {
    const input = completedLegacyResult();
    mutate(input);
    const observed = captureBlocked(input);
    expect(observed.diagnostic.reasonCode).toBe(code);
  });

  it('replaces changing upstream IDs with reproducible Engine V2 identities', () => {
    const first = adaptLegacyRasterPipelineResultToEngineV2Input(completedLegacyResult({
      regions: [region({ id: 'r_random_first' })],
    }));
    const second = adaptLegacyRasterPipelineResultToEngineV2Input(completedLegacyResult({
      regions: [region({ id: 'r_random_second' })],
    }));

    expect(first.sourceRegions).toEqual(second.sourceRegions);
    expect(first.sourceRegions[0].id).toMatch(/^t1-raster-region-0001-[0-9a-f]{16}$/);
    expect(first.nonContractualProvenance.legacyRegionProvenance[0].legacyRegionId).toBe('r_random_first');
    expect(second.nonContractualProvenance.legacyRegionProvenance[0].legacyRegionId).toBe('r_random_second');
    expect(first.sourceRegions[0].source).not.toHaveProperty('legacyRegionId');
  });

  it('keeps duplicate geometry and duplicate legacy IDs collision-free by canonical position', () => {
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(completedLegacyResult({
      regions: [region({ id: 'duplicate' }), region({ id: 'duplicate' })],
    }));

    expect(adapted.sourceRegions[0].id).not.toBe(adapted.sourceRegions[1].id);
    expect(new Set(adapted.sourceRegions.map(item => item.id)).size).toBe(2);
    expect(adapted.nonContractualProvenance.legacyRegionProvenance.map(item => item.legacyRegionId)).toEqual([
      'duplicate',
      'duplicate',
    ]);
  });

  it('generates a deterministic identity when upstream did not provide one', () => {
    const first = adaptLegacyRasterPipelineResultToEngineV2Input(completedLegacyResult({
      regions: [region({ id: undefined })],
    }));
    const second = adaptLegacyRasterPipelineResultToEngineV2Input(completedLegacyResult({
      regions: [region({ id: undefined })],
    }));

    expect(first.sourceRegions[0].id).toBe(second.sourceRegions[0].id);
    expect(first.nonContractualProvenance.legacyRegionProvenance[0].legacyRegionId).toBeNull();
  });

  it('canonicalizes equivalent colors, rings, closures, duplicates, zero and hole order integrally', () => {
    const firstInput = completedLegacyResult({
      regions: [region({
        id: 'legacy-random-alpha',
        color: '#ABC',
        path_points: [[-0, -0], [0.8, 0], [0.8, 0.8], [0, 0.8], [-0, -0]],
        holes: [
          [[0.1, 0.1], [0.1, 0.2], [0.2, 0.2], [0.2, 0.1]],
          [[0.4, 0.4], [0.4, 0.5], [0.5, 0.5], [0.5, 0.4]],
        ],
      })],
    });
    const secondInput = completedLegacyResult({
      regions: [region({
        id: 'legacy-random-beta',
        color: '#aabbcc',
        path_points: [[0.8, 0.8], [0.8, 0], [0, 0], [0, 0.8], [0, 0.8], [0.8, 0.8]],
        holes: [
          [[0.5, 0.5], [0.4, 0.5], [0.4, 0.4], [0.5, 0.4], [0.5, 0.5]],
          [[0.2, 0.1], [0.2, 0.2], [0.1, 0.2], [0.1, 0.1]],
        ],
      })],
    });

    const firstAdapted = adaptLegacyRasterPipelineResultToEngineV2Input(firstInput);
    const secondAdapted = adaptLegacyRasterPipelineResultToEngineV2Input(secondInput);
    const { nonContractualProvenance: firstProvenance, ...firstContract } = firstAdapted;
    const { nonContractualProvenance: secondProvenance, ...secondContract } = secondAdapted;

    expect(firstContract).toEqual(secondContract);
    expect(firstAdapted.sourceRegions[0].color).toBe('#aabbcc');
    expect(firstAdapted.sourceRegions[0].path_points[0]).toEqual([0, 0]);
    expect(firstAdapted.sourceRegions[0].holes).toEqual(secondAdapted.sourceRegions[0].holes);
    expect(firstProvenance.legacyRegionProvenance[0].legacyRegionId).toBe('legacy-random-alpha');
    expect(secondProvenance.legacyRegionProvenance[0].legacyRegionId).toBe('legacy-random-beta');

    const firstObserved = observeLegacyRasterPipelineResult(
      firstInput,
      true,
      runExperimentalEngineV2Bridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );
    const secondObserved = observeLegacyRasterPipelineResult(
      secondInput,
      true,
      runExperimentalEngineV2Bridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );
    const firstSourceContract = {
      coordinateContract: firstObserved.diagnostic.source.coordinateContract,
      metadata: firstObserved.diagnostic.source.metadata,
    };
    const secondSourceContract = {
      coordinateContract: secondObserved.diagnostic.source.coordinateContract,
      metadata: secondObserved.diagnostic.source.metadata,
    };

    expect(firstObserved.diagnostic.status).toBe('completed');
    expect(secondObserved.diagnostic.status).toBe('completed');
    expect(firstSourceContract).toEqual(secondSourceContract);
    expect(firstObserved.diagnostic.engineV2Result).toEqual(secondObserved.diagnostic.engineV2Result);
    expect(firstObserved.diagnostic.canonicalCommands).toEqual(secondObserved.diagnostic.canonicalCommands);
    expect(firstObserved.diagnostic.metrics).toEqual(secondObserved.diagnostic.metrics);
    expect(firstObserved.diagnostic.traces).toEqual(secondObserved.diagnostic.traces);
  }, 15_000);

  it('keeps legacy IDs only in separate non-contractual diagnostic provenance', () => {
    const legacyId = 'legacy-id-must-not-enter-v2-contract';
    const input = completedLegacyResult({ regions: [region({ id: legacyId })] });
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(input);
    const observed = observeLegacyRasterPipelineResult(
      input,
      true,
      runExperimentalEngineV2Bridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );
    const adaptedContract = {
      sourceRegions: adapted.sourceRegions,
      bridgeConfig: adapted.bridgeConfig,
      coordinateContract: adapted.coordinateContract,
      metadata: adapted.metadata,
    };

    expect(JSON.stringify(adaptedContract)).not.toContain(legacyId);
    expect(JSON.stringify(observed.diagnostic.engineV2Result)).not.toContain(legacyId);
    expect(JSON.stringify(observed.diagnostic.canonicalCommands)).not.toContain(legacyId);
    expect(JSON.stringify(observed.diagnostic.metrics)).not.toContain(legacyId);
    expect(JSON.stringify(observed.diagnostic.traces)).not.toContain(legacyId);
    expect(observed.diagnostic.source.nonContractualProvenance.legacyRegionProvenance[0])
      .toMatchObject({ legacyRegionId: legacyId, sourceIndex: 0 });
  });

  it('fails deterministically if one fingerprint is registered for different canonical identities', () => {
    const registry = new Map();
    _t1RasterIdCollisionGuard.registerFingerprintIdentity(
      registry,
      { fingerprint: '0000000000000000', stableInput: 'canonical-alpha' },
      'legacyResult.regions[0].id',
    );

    expect(() => _t1RasterIdCollisionGuard.registerFingerprintIdentity(
      registry,
      { fingerprint: '0000000000000000', stableInput: 'canonical-beta' },
      'legacyResult.regions[1].id',
    )).toThrow(expect.objectContaining({
      code: 'T1_RASTER_REGION_ID_COLLISION',
      path: 'legacyResult.regions[1].id',
    }));
  });

  it('detects an accessor without executing it or reaching Engine V2', () => {
    const getter = vi.fn(() => '#ffffff');
    const setter = vi.fn();
    const hostileRegion = region();
    Object.defineProperty(hostileRegion, 'color', {
      enumerable: true,
      get: getter,
      set: setter,
    });
    const observed = captureBlocked(completedLegacyResult({ regions: [hostileRegion] }));

    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_ACCESSOR_PROPERTY_FORBIDDEN');
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('captures a revoked proxy as blocked without propagating its exception', () => {
    const { proxy, revoke } = Proxy.revocable(region(), {});
    revoke();
    const executeBridge = vi.fn();

    expect(() => observeLegacyRasterPipelineResult(
      completedLegacyResult({ regions: [proxy] }),
      true,
      executeBridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    )).not.toThrow();
    const observed = observeLegacyRasterPipelineResult(
      completedLegacyResult({ regions: [proxy] }),
      true,
      executeBridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );
    expect(observed.diagnostic.status).toBe('blocked');
    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_SOURCE_HOSTILE');
    expect(executeBridge).not.toHaveBeenCalled();
  });

  it('isolates a proxy trap that throws another hostile object', () => {
    const { proxy: thrownProxy, revoke: revokeThrown } = Proxy.revocable({}, {});
    revokeThrown();
    const hostileRegion = new Proxy(region(), {
      ownKeys() {
        throw thrownProxy;
      },
    });
    const observed = captureBlocked(completedLegacyResult({ regions: [hostileRegion] }));

    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_SOURCE_HOSTILE');
    expect(observed.diagnostic.errors).toEqual([{
      code: 'T1_RASTER_SOURCE_HOSTILE',
      path: 'legacyResult.regions[0]',
      message: 'The legacy raster source could not be inspected safely.',
    }]);
  });

  it.each([
    ['symbol property', candidate => { candidate[Symbol('hostile')] = true; }, 'T1_RASTER_SYMBOL_PROPERTY_FORBIDDEN'],
    ['hidden property', candidate => { Object.defineProperty(candidate, 'hidden', { value: true }); }, 'T1_RASTER_HIDDEN_PROPERTY_FORBIDDEN'],
    ['anomalous prototype', candidate => { Object.setPrototypeOf(candidate, null); }, 'T1_RASTER_STRUCTURE_INVALID'],
  ])('blocks an unexpected %s', (_name, mutate, code) => {
    const candidate = region();
    mutate(candidate);
    const observed = captureBlocked(completedLegacyResult({ regions: [candidate] }));
    expect(observed.diagnostic.reasonCode).toBe(code);
  });

  it('blocks an active revoked root without propagating its trap', () => {
    const { proxy, revoke } = Proxy.revocable(completedLegacyResult(), {});
    revoke();
    const observed = captureBlocked(proxy);
    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_SOURCE_HOSTILE');
  });

  it('blocks a root accessor without executing its getter or setter', () => {
    const getter = vi.fn(() => []);
    const setter = vi.fn();
    const input = completedLegacyResult();
    Object.defineProperty(input, 'regions', { enumerable: true, get: getter, set: setter });
    const observed = captureBlocked(input);

    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_ACCESSOR_PROPERTY_FORBIDDEN');
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('blocks an accessor in T1 configuration without executing it', () => {
    const getter = vi.fn(() => 80);
    const setter = vi.fn();
    const input = completedLegacyResult();
    Object.defineProperty(input.config, 'width_mm', { enumerable: true, get: getter, set: setter });
    const observed = captureBlocked(input);

    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_ACCESSOR_PROPERTY_FORBIDDEN');
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('blocks a hidden property on the completed pipeline result', () => {
    const input = completedLegacyResult();
    Object.defineProperty(input, 'hiddenPipelineOutput', { value: true });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_HIDDEN_PROPERTY_FORBIDDEN');
  });

  it('blocks a symbol on a stage-log entry', () => {
    const input = completedLegacyResult();
    input.stageLog[0][Symbol('stage-output')] = true;
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_SYMBOL_PROPERTY_FORBIDDEN');
  });

  it('blocks an adulterated stage collection', () => {
    const input = completedLegacyResult();
    input.stageLog.extra = true;
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_ARRAY_PROPERTY_FORBIDDEN');
  });

  it('blocks a revoked region collection', () => {
    const input = completedLegacyResult();
    const { proxy, revoke } = Proxy.revocable(input.regions, {});
    input.regions = proxy;
    revoke();
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_SOURCE_HOSTILE');
  });

  it('blocks a contour whose getPrototypeOf trap is hostile', () => {
    const hostileContour = new Proxy(region().path_points, {
      getPrototypeOf() { throw new Error('hostile contour prototype'); },
    });
    const input = completedLegacyResult({ regions: [region({ path_points: hostileContour })] });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_SOURCE_HOSTILE');
  });

  it('blocks a hole collection whose descriptor trap is hostile', () => {
    const hostileHoles = new Proxy([], {
      getOwnPropertyDescriptor() { throw new Error('hostile hole descriptors'); },
    });
    const input = completedLegacyResult({ regions: [region({ holes: hostileHoles })] });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_SOURCE_HOSTILE');
  });

  it('blocks an adulterated hole polygon array', () => {
    const hole = [[0.2, 0.2], [0.2, 0.4], [0.4, 0.4], [0.4, 0.2]];
    hole.extra = true;
    const input = completedLegacyResult({ regions: [region({ holes: [hole] })] });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_ARRAY_PROPERTY_FORBIDDEN');
  });

  it('blocks a point accessor without executing its getter or setter', () => {
    const getter = vi.fn(() => 0.1);
    const setter = vi.fn();
    const point = [0.1, 0.1];
    Object.defineProperty(point, '0', { enumerable: true, get: getter, set: setter });
    const input = completedLegacyResult({
      regions: [region({ path_points: [point, [0.8, 0.1], [0.8, 0.8], [0.1, 0.8]] })],
    });
    const observed = captureBlocked(input);

    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_ACCESSOR_PROPERTY_FORBIDDEN');
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('blocks inherited dimension getters without executing them', () => {
    const getter = vi.fn(() => 1600);
    const prototype = {};
    Object.defineProperty(prototype, 'imageWidth', { get: getter });
    const input = completedLegacyResult();
    input.analysis = Object.assign(Object.create(prototype), { imageHeight: 1200 });
    const observed = captureBlocked(input);

    expect(observed.diagnostic.reasonCode).toBe('T1_RASTER_STRUCTURE_INVALID');
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ['ownKeys', new Proxy(region(), { ownKeys() { throw new Error('ownKeys'); } })],
    ['getOwnPropertyDescriptor', new Proxy(region(), { getOwnPropertyDescriptor() { throw new Error('descriptor'); } })],
  ])('blocks a region with hostile %s trap', (_trap, hostileRegion) => {
    expect(captureBlocked(completedLegacyResult({ regions: [hostileRegion] })).diagnostic.reasonCode)
      .toBe('T1_RASTER_SOURCE_HOSTILE');
  });

  it.each([Number.NaN, Infinity, -Infinity])('classifies non-finite coordinate %s as a point value error', value => {
    const input = completedLegacyResult({
      regions: [region({ path_points: [[0.1, 0.1], [value, 0.2], [0.8, 0.8]] })],
    });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_POINT_INVALID');
  });

  it('rejects normalized coordinates outside the declared domain', () => {
    const input = completedLegacyResult({
      regions: [region({ path_points: [[-0.01, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8]] })],
    });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_COORDINATE_OUT_OF_RANGE');
  });

  it('normalizes negative zero deterministically', () => {
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(completedLegacyResult({
      regions: [region({ path_points: [[-0, -0], [0.8, 0], [0.8, 0.8], [0, 0.8]] })],
    }));

    expect(adapted.sourceRegions[0].path_points[0]).toEqual([0, 0]);
    expect(Object.is(adapted.sourceRegions[0].path_points[0][0], -0)).toBe(false);
  });

  it('rejects a self-intersecting contour as geometry invalid', () => {
    const input = completedLegacyResult({
      regions: [region({ path_points: [[0.1, 0.1], [0.9, 0.9], [0.1, 0.9], [0.9, 0.1]] })],
    });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_SELF_INTERSECTION');
  });

  it('canonicalizes consecutive duplicates and a correct explicit closing point', () => {
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(completedLegacyResult({
      regions: [region({
        path_points: [[0.1, 0.1], [0.8, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8], [0.1, 0.1]],
      })],
    }));
    expect(adapted.sourceRegions[0].path_points).toEqual([
      [0.1, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8],
    ]);
  });

  it('rejects an invalid explicit closing sequence', () => {
    const input = completedLegacyResult({
      regions: [region({
        path_points: [[0.1, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8], [0.8, 0.1]],
      })],
    });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_SELF_INTERSECTION');
  });

  it('rejects an empty contour and an empty region collection independently', () => {
    expect(captureBlocked(completedLegacyResult({
      regions: [region({ path_points: [] })],
    })).diagnostic.reasonCode).toBe('T1_RASTER_TOO_FEW_UNIQUE_POINTS');
    expect(captureBlocked(completedLegacyResult({ regions: [] })).diagnostic.reasonCode)
      .toBe('T1_RASTER_REGIONS_EMPTY');
  });

  it.each([
    ['self-intersecting', [[0.2, 0.2], [0.6, 0.6], [0.2, 0.6], [0.6, 0.2]], 'T1_RASTER_SELF_INTERSECTION'],
    ['degenerate', [[0.2, 0.2], [0.3, 0.3], [0.4, 0.4]], 'T1_RASTER_DEGENERATE_POLYGON'],
  ])('rejects a %s hole polygon', (_name, hole, code) => {
    const input = completedLegacyResult({ regions: [region({ holes: [hole] })] });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe(code);
  });

  it('preserves relationally unverified holes because Engine V2 ingestion does not reject them', () => {
    const outside = [[0.82, 0.82], [0.82, 0.95], [0.95, 0.95], [0.95, 0.82]];
    const crossing = [[0.05, 0.3], [0.05, 0.5], [0.2, 0.5], [0.2, 0.3]];
    const overlapping = [[0.3, 0.3], [0.3, 0.5], [0.5, 0.5], [0.5, 0.3]];
    const overlappingAgain = [[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4]];
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(completedLegacyResult({
      regions: [region({ holes: [outside, crossing, overlapping, overlappingAgain] })],
    }));

    expect(adapted.sourceRegions[0].holes).toHaveLength(4);
  });

  it('rejects pixel-like coordinates under the fixed normalized T1 contract', () => {
    const input = completedLegacyResult({
      regions: [region({
        coordinateSpace: 'pixel',
        path_points: [[10, 10], [80, 10], [80, 80], [10, 80]],
      })],
    });
    expect(captureBlocked(input).diagnostic.reasonCode).toBe('T1_RASTER_COORDINATE_OUT_OF_RANGE');
  });

  it('blocks missing or failed legacy stages before Engine V2', () => {
    const missingInput = completedLegacyResult();
    missingInput.stageLog = missingInput.stageLog.slice(1);
    const failedInput = completedLegacyResult();
    failedInput.stageLog[4].ok = false;

    expect(captureBlocked(missingInput).diagnostic.reasonCode).toBe('T1_RASTER_STAGE_MISSING');
    expect(captureBlocked(failedInput).diagnostic.reasonCode).toBe('T1_RASTER_STAGE_FAILED');
  });

  it('blocks invalid activation without inspecting legacy data or reaching Engine V2', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const executeBridge = vi.fn();
    const observed = observeLegacyRasterPipelineResult(proxy, 'on', executeBridge);

    expect(observed.legacyResult).toBe(proxy);
    expect(observed.diagnostic).toMatchObject({
      status: 'blocked',
      reasonCode: 'T1_RASTER_ENGINE_V2_ACTIVATION_INVALID',
    });
    expect(executeBridge).not.toHaveBeenCalled();
  });

  it('isolates an internal Engine V2 exception from the governing legacy result', () => {
    const legacyResult = completedLegacyResult();
    const observed = observeLegacyRasterPipelineResult(legacyResult, true, () => {
      throw new Error('simulated Engine V2 failure');
    }, adaptLegacyRasterPipelineResultToEngineV2Input);

    expect(observed.legacyResult).toBe(legacyResult);
    expect(observed.diagnostic).toMatchObject({
      status: 'failed',
      reasonCode: 'T1_ENGINE_V2_EXECUTION_FAILED',
      metadata: { governingResult: 'legacy' },
    });
    expect(observed.diagnostic.errors).toEqual([{
      code: 'T1_ENGINE_V2_EXECUTION_FAILED',
      path: 'engineV2',
      message: 'simulated Engine V2 failure',
    }]);
    expect(observed.diagnostic).not.toHaveProperty('stack');
    expect(observed.diagnostic).not.toHaveProperty('cause');
  });

  it.each([
    ['plain object', () => ({ message: 'plain object failure', path: 'external.plain' }), 'external.plain', 'plain object failure'],
    ['string', () => 'string failure', 'engineV2', 'string failure'],
    ['number', () => 42, 'engineV2', 'An uninspectable exception was isolated.'],
    ['null', () => null, 'engineV2', 'An uninspectable exception was isolated.'],
  ])('sanitizes a safe thrown %s deterministically', (_name, thrownValue, path, message) => {
    const external = thrownValue();
    const observed = observeLegacyRasterPipelineResult(
      completedLegacyResult(),
      true,
      () => { throw external; },
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );

    expect(observed.diagnostic).toMatchObject({
      status: 'failed',
      reasonCode: 'T1_ENGINE_V2_EXECUTION_FAILED',
      errors: [{
        code: 'T1_ENGINE_V2_EXECUTION_FAILED',
        path,
        message,
      }],
    });
    expect(observed.diagnostic.errors[0]).not.toBe(external);
    expect(() => JSON.stringify(observed.diagnostic)).not.toThrow();
    expect(() => JSON.stringify(observed)).not.toThrow();
  });

  it('inspects a safe Error cause without attaching the cause or stack', () => {
    const exception = new Error('safe caused failure', { cause: { detail: 'internal-only' } });
    const observed = observeLegacyRasterPipelineResult(
      completedLegacyResult(),
      true,
      () => { throw exception; },
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );

    expect(observed.diagnostic.status).toBe('failed');
    expect(observed.diagnostic.reasonCode).toBe('T1_ENGINE_V2_EXECUTION_FAILED');
    expect(observed.diagnostic.errors).toEqual([{
      code: 'T1_ENGINE_V2_EXECUTION_FAILED',
      path: 'engineV2',
      message: 'safe caused failure',
    }]);
    expect(JSON.stringify(observed.diagnostic)).not.toContain('internal-only');
    expect(JSON.stringify(observed.diagnostic)).not.toContain('stack');
  });

  it.each([
    ['Buffer', () => Buffer.from([1, 2])],
    ['ArrayBuffer', () => new ArrayBuffer(8)],
    ['SharedArrayBuffer', () => new SharedArrayBuffer(8)],
    ['DataView', () => new DataView(new ArrayBuffer(8))],
    ['typed array', () => new Uint8Array([1, 2])],
    ['Blob', () => new Blob(['binary'])],
    ['function', () => function externalCallback() {}],
    ['symbol', () => Symbol('external')],
    ['WeakMap', () => new WeakMap()],
    ['WeakSet', () => new WeakSet()],
    ['Promise', () => Promise.resolve('external')],
    ['URL object', () => new URL('https://example.invalid/artifact.dst')],
    ['operational URL field', () => ({ downloadUrl: 'blob:unsafe-exception' })],
    ['DST field', () => ({ dst: 'payload' })],
    ['DSB field', () => ({ dsb: 'payload' })],
    ['nested incompatible value', () => ({ detail: { bytes: new Uint8Array([1]) } })],
    ['revoked proxy', () => { const pair = Proxy.revocable({}, {}); pair.revoke(); return pair.proxy; }],
  ])('prioritizes boundary isolation for an incompatible thrown %s', (_name, thrownValue) => {
    const observed = expectSanitizedBoundaryViolation(completedLegacyResult(), () => {
      throw thrownValue();
    });

    expect(observed.diagnostic.errors).toEqual([]);
    expect(observed.diagnostic).not.toHaveProperty('stack');
    expect(observed.diagnostic).not.toHaveProperty('cause');
  });

  it('inspects native Error data descriptors but never executes an exception accessor', () => {
    const getter = vi.fn(() => function hiddenCallback() {});
    const setter = vi.fn();
    const exception = new Error('hostile exception descriptor');
    Object.defineProperty(exception, 'cause', {
      configurable: true,
      enumerable: false,
      get: getter,
      set: setter,
    });

    expectSanitizedBoundaryViolation(completedLegacyResult(), () => { throw exception; });
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('detects an incompatible payload attached to an otherwise native Error', () => {
    const exception = new TypeError('native error with incompatible payload');
    exception.payload = { bytes: new Uint8Array([1]) };

    expectSanitizedBoundaryViolation(completedLegacyResult(), () => { throw exception; });
  });

  it('distinguishes a deterministic invalid Engine V2 result as blocked', () => {
    const legacyResult = completedLegacyResult();
    const rejected = {
      valid: false,
      errors: [{ code: 'ENGINE_REJECTED', path: 'ingestion', message: 'rejected' }],
      document: { commands: [{ type: 'stitch' }] },
      refs: { source: 'external-engine-result' },
      commands: [{ type: 'jump' }],
      metrics: { stitchCount: 999 },
      traces: { decisions: ['external'] },
      metadata: { ...BOUNDARY_METADATA },
    };
    const observed = observeLegacyRasterPipelineResult(
      legacyResult,
      true,
      () => rejected,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );

    expect(observed.legacyResult).toBe(legacyResult);
    expect(observed.diagnostic.status).toBe('blocked');
    expect(observed.diagnostic.reasonCode).toBe('T1_ENGINE_V2_RESULT_BLOCKED');
    expect(observed.diagnostic.engineV2Result).toBeNull();
    expect(observed.diagnostic.canonicalCommands).toEqual([]);
    expect(observed.diagnostic.metrics).toBeNull();
    expect(observed.diagnostic.traces).toBeNull();
  });

  it.each([
    ['Buffer', () => Buffer.from([1])],
    ['ArrayBuffer', () => new ArrayBuffer(8)],
    ['SharedArrayBuffer', () => new SharedArrayBuffer(8)],
    ['DataView', () => new DataView(new ArrayBuffer(8))],
    ['typed array', () => new Uint8Array([1])],
    ['Blob', () => new Blob(['binary'])],
    ['function', () => function rejectedCallback() {}],
    ['symbol', () => Symbol('rejected')],
    ['WeakMap', () => new WeakMap()],
    ['WeakSet', () => new WeakSet()],
    ['Promise', () => Promise.resolve('rejected')],
    ['URL object', () => new URL('https://example.invalid/rejected.dst')],
    ['operational URL', () => ({ downloadUrl: 'blob:rejected' })],
    ['DST field', () => ({ dst: 'payload' })],
    ['DSB field', () => ({ dsb: 'payload' })],
  ])('prioritizes boundary isolation over valid false for %s', (_name, incompatible) => {
    const rejected = {
      valid: false,
      external: incompatible(),
      metadata: { ...BOUNDARY_METADATA },
    };
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => rejected);
  });

  it('blocks and sanitizes the T1 boundary if a nominally valid result exposes a DST artifact', () => {
    const legacyResult = completedLegacyResult();
    const result = successfulBridgeResult();
    result.dstArtifact = new Uint8Array([1, 2, 3]);
    expectSanitizedBoundaryViolation(legacyResult, () => result);
  });

  it.each([
    ['ArrayBuffer', () => new ArrayBuffer(8)],
    ['DataView', () => new DataView(new ArrayBuffer(8))],
    ['typed array', () => new Uint16Array([1, 2])],
    ['Buffer', () => Buffer.from([1, 2])],
    ['Blob', () => new Blob(['binary'])],
    ['nested buffer', () => ({ nested: { bytes: new Uint8Array([1]) } })],
  ])('blocks and sanitizes a %s before classifying valid', (_name, artifact) => {
    const legacyResult = completedLegacyResult();
    const result = successfulBridgeResult();
    result.diagnosticPayload = artifact();
    expectSanitizedBoundaryViolation(legacyResult, () => result);
  });

  it('rejects aliases that point to the same binary object', () => {
    const result = successfulBridgeResult();
    const sharedBuffer = new ArrayBuffer(8);
    result.firstAlias = sharedBuffer;
    result.secondAlias = sharedBuffer;
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => result);
  });

  it('rejects a falsified Symbol.toStringTag without trusting it', () => {
    const result = successfulBridgeResult();
    result[Symbol.toStringTag] = 'OrdinaryObject';
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => result);
  });

  it('rejects a sparse Engine V2 output array', () => {
    const result = successfulBridgeResult();
    const sparse = new Array(2);
    sparse[1] = { evidence: true };
    result.sparse = sparse;
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => result);
  });

  it.each([
    ['root function', () => function rootCallback() {}],
    ['nested function', () => ({ nested: { callback() {} } })],
    ['function in array', () => ({ nested: [function arrayCallback() {}] })],
    ['symbol value', () => ({ nested: Symbol('value') })],
    ['WeakMap', () => ({ nested: new WeakMap() })],
    ['WeakSet', () => ({ nested: new WeakSet() })],
    ['Promise', () => ({ nested: Promise.resolve('value') })],
    ['URL object', () => ({ nested: new URL('https://example.invalid/output.dst') })],
    ['Date', () => ({ nested: new Date(0) })],
    ['RegExp', () => ({ nested: /external/u })],
    ['unknown class instance', () => ({ nested: new (class ExternalReference {})() })],
  ])('rejects non-contractual Engine V2 output reference: %s', (_name, output) => {
    const value = output();
    const result = typeof value === 'function'
      ? value
      : Object.assign(successfulBridgeResult(), value);
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => result);
  });

  it('blocks SharedArrayBuffer when the runtime exposes it', () => {
    expect(typeof SharedArrayBuffer).toBe('function');
    const legacyResult = completedLegacyResult();
    const result = successfulBridgeResult();
    result.shared = new SharedArrayBuffer(8);
    expectSanitizedBoundaryViolation(legacyResult, () => result);
  });

  it.each([
    ['downloadUrl', 'blob:unsafe-download'],
    ['downloadHref', '/unsafe-download.dst'],
    ['objectUrl', 'blob:unsafe-object'],
    ['binary', 'base64-payload'],
    ['bytes', [1, 2, 3]],
    ['byteArray', [1, 2, 3]],
    ['binaryPayload', 'payload'],
    ['dst', 'payload'],
    ['dsb', 'payload'],
    ['dstBytes', [1]],
    ['dsbBytes', [1]],
    ['encoderInvocationCount', 1],
    ['machineAdapterInvocationCount', 1],
  ])('blocks explicit incompatible field %s', (field, value) => {
    const legacyResult = completedLegacyResult();
    const result = successfulBridgeResult();
    result[field] = value;
    expectSanitizedBoundaryViolation(legacyResult, () => result);
  });

  it.each([
    ['machineAdaptationApplied', true],
    ['encodingApplied', undefined],
    ['binaryArtifactCreated', 0],
    ['encoderInvoked', true],
    ['dstEncoderInvoked', 1],
    ['binaryArtifactCount', -1],
    ['dstArtifactCount', 2],
  ])('inspects invalid Engine V2 output and prioritizes signal %s before valid', (field, value) => {
    const legacyResult = completedLegacyResult();
    const result = {
      valid: false,
      metadata: { ...BOUNDARY_METADATA, [field]: value },
      errors: [],
    };
    expectSanitizedBoundaryViolation(legacyResult, () => result);
  });

  it('does not treat innocent documentary text as a binary artifact', () => {
    const result = successfulBridgeResult();
    result.documentation = 'The words DST, DSB, download, bytes and encoder are documentary text only.';
    result.documentationUrl = 'https://example.invalid/documentation-only';
    const observed = observeLegacyRasterPipelineResult(
      completedLegacyResult(),
      true,
      () => result,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );
    expect(observed.diagnostic.status).toBe('completed');
  });

  it.each([
    ['root result', result => { result.cycle = result; }],
    ['nested object', result => {
      const nested = {};
      nested.cycle = nested;
      result.nested = nested;
    }],
    ['array', result => {
      const nested = [];
      nested.push(nested);
      result.nested = nested;
    }],
    ['valid false', result => {
      result.valid = false;
      result.cycle = result;
    }],
    ['metadata', result => { result.metadata.cycle = result.metadata; }],
    ['commands', result => {
      const command = result.document.commands[0];
      command.cycle = command;
    }],
    ['metrics', result => {
      result.metrics = {};
      result.metrics.cycle = result.metrics;
    }],
    ['traces', result => {
      result.traces = {};
      result.traces.cycle = result.traces;
    }],
  ])('rejects a cycle in %s without retaining the original result', (_location, addCycle) => {
    const result = successfulBridgeResult();
    addCycle(result);
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => result);
  });

  it('rejects a cyclic thrown exception without propagating or retaining it', () => {
    const exception = { message: 'cyclic exception' };
    exception.cycle = exception;
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => { throw exception; });
  });

  it('preserves null prototypes, aliases and frozen data without flattening identity semantics', () => {
    const result = Object.assign(Object.create(null), successfulBridgeResult());
    const shared = Object.assign(Object.create(null), { evidence: 'shared' });
    result.firstAlias = shared;
    result.secondAlias = shared;
    result.frozenEvidence = Object.freeze({ state: 'frozen-source' });

    const observed = observeLegacyRasterPipelineResult(
      completedLegacyResult(),
      true,
      () => result,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );

    expect(observed.diagnostic.status).toBe('completed');
    expect(Object.getPrototypeOf(observed.diagnostic.engineV2Result)).toBeNull();
    expect(Object.getPrototypeOf(observed.diagnostic.engineV2Result.firstAlias)).toBeNull();
    expect(observed.diagnostic.engineV2Result.firstAlias)
      .toBe(observed.diagnostic.engineV2Result.secondAlias);
    expect(Object.isFrozen(observed.diagnostic.engineV2Result.frozenEvidence)).toBe(true);
    expect(Object.isFrozen(observed.diagnostic.engineV2Result.firstAlias)).toBe(true);
    expect(() => JSON.stringify(observed.diagnostic)).not.toThrow();
    expect(() => JSON.stringify(observed)).not.toThrow();
  });

  it.each([
    ['revoked proxy', () => { const pair = Proxy.revocable({}, {}); pair.revoke(); return pair.proxy; }],
    ['getPrototypeOf trap', () => new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } })],
    ['ownKeys trap', () => new Proxy({}, { ownKeys() { throw new Error('trap'); } })],
    ['descriptor trap', () => new Proxy({ visible: true }, { getOwnPropertyDescriptor() { throw new Error('trap'); } })],
  ])('sanitizes hostile Engine V2 output containing a %s', (_name, hostile) => {
    const legacyResult = completedLegacyResult();
    const result = successfulBridgeResult();
    result.hostile = hostile();
    expectSanitizedBoundaryViolation(legacyResult, () => result);
  });

  it('does not execute Engine V2 output getters or setters', () => {
    const getter = vi.fn(() => function externalGetterCallback() {});
    const setter = vi.fn();
    const result = successfulBridgeResult();
    Object.defineProperty(result, 'downloadUrl', { enumerable: true, get: getter, set: setter });

    expectSanitizedBoundaryViolation(completedLegacyResult(), () => result);
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('fails closed when bounded inspection depth is exceeded', () => {
    const result = successfulBridgeResult();
    let cursor = result;
    for (let index = 0; index < 70; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => result);
  });

  it('fails closed when a thrown exception exceeds the inspection depth', () => {
    const exception = { message: 'oversized exception' };
    let cursor = exception;
    for (let index = 0; index < 70; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expectSanitizedBoundaryViolation(completedLegacyResult(), () => { throw exception; });
  });

  it.each([
    ['node', { maxNodes: 2 }, { one: {}, two: {} }],
    ['property', { maxProperties: 1 }, { one: true, two: true }],
  ])('enforces the bounded %s inspection budget', (_name, limits, input) => {
    const inspected = _t1BoundaryInspection.inspect(input, limits);
    expect(inspected.error).toMatchObject({
      code: 'T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION',
    });
    expect(inspected.sanitizedResult).toBeNull();
  });

  it.each([
    ['node', { maxNodes: 2 }, { message: 'large', one: {}, two: {} }],
    ['property', { maxProperties: 1 }, { message: 'large', one: true }],
  ])('enforces the bounded thrown-exception %s budget', (_name, limits, input) => {
    const inspected = _t1BoundaryInspection.inspectThrown(input, limits);
    expect(inspected.error).toMatchObject({
      code: 'T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION',
    });
    expect(inspected.sanitizedResult).toBeNull();
  });

  it.each([
    ['Buffer', () => Buffer.from([1]), 'Buffer'],
    ['ArrayBuffer', () => new ArrayBuffer(8), 'ArrayBuffer'],
    ['SharedArrayBuffer', () => new SharedArrayBuffer(8), 'SharedArrayBuffer'],
    ['Blob', () => new Blob(['binary']), 'Blob'],
  ])('fails closed for %s even while its global constructor is unavailable', (_kind, create, globalName) => {
    const artifact = create();
    withTemporarilyMissingGlobal(globalName, () => {
      const result = successfulBridgeResult();
      result.externalArtifact = artifact;
      expectSanitizedBoundaryViolation(completedLegacyResult(), () => result);
    });
  });

  it('completes through the existing bridge and exposes canonical metrics and traces', () => {
    const legacyResult = completedLegacyResult();
    const observed = observeLegacyRasterPipelineResult(
      legacyResult,
      true,
      runExperimentalEngineV2Bridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );

    expect(observed.legacyResult).toBe(legacyResult);
    expect(observed.diagnostic.status).toBe('completed');
    expect(observed.diagnostic.engineV2Result.valid).toBe(true);
    expect(observed.diagnostic.engineV2Result.document).not.toBeNull();
    expect(observed.diagnostic.canonicalCommands).toBe(
      observed.diagnostic.engineV2Result.document.commands,
    );
    expect(observed.diagnostic.metrics.commandCount).toBe(
      observed.diagnostic.canonicalCommands.length,
    );
    expect(observed.diagnostic.traces.terminalStage).toBe('documentValidation');
  });

  it('accredits zero machine adaptation, encoding, and binary artifacts', () => {
    const observed = observeLegacyRasterPipelineResult(
      completedLegacyResult(),
      true,
      runExperimentalEngineV2Bridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );

    expect(observed.diagnostic.metadata).toMatchObject({
      machineAdaptationApplied: false,
      encodingApplied: false,
      binaryArtifactCreated: false,
      dstArtifactCount: 0,
      dsbArtifactCount: 0,
    });
    expect(observed.diagnostic.engineV2Result.metadata).toEqual(BOUNDARY_METADATA);
    expect(observed.diagnostic.engineV2Result.document.metadata).toMatchObject(BOUNDARY_METADATA);
  });
});
