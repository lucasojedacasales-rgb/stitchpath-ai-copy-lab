import { describe, expect, it } from 'vitest';
import {
  analyzeDisconnectedGeometryComponents,
  analyzeDiscreteCurvature,
  analyzePathEnds,
  detectNarrowBridgeCandidates,
  measureMeanWidthMm,
  measureSustainedWidthMm,
} from '../geometry/deterministicGeometryMetrics.js';

const rectangle = (x, y, width, height) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const multiBridgeGeometry = () => [
  { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 6, y: 2 },
  { x: 6, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 2 }, { x: 12, y: 2 },
  { x: 12, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 6 }, { x: 12, y: 6 },
  { x: 12, y: 4 }, { x: 10, y: 4 }, { x: 10, y: 6 }, { x: 6, y: 6 },
  { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 6 }, { x: 0, y: 6 },
];

const areaInput = (geometry, holes = []) => ({
  coordinateSpace: 'millimeter',
  geometry,
  holes,
});

const bridgeOptions = {
  maximumBridgeWidthMm: 2,
  minimumBridgeLengthMm: 1,
  minimumShoulderRatio: 2,
};

function expectPublicNumbersFinite(value) {
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(expectPublicNumbersFinite);
    return;
  }
  if (value && typeof value === 'object') Object.values(value).forEach(expectPublicNumbersFinite);
}

function expectDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(expectDeepFrozen);
}

describe('deterministic geometry metric contract', () => {
  it('exports the common immutable envelope and rejects non-millimeter spaces', () => {
    const input = { ...areaInput(rectangle(0, 0, 10, 4)), coordinateSpace: 'normalized' };
    const output = measureMeanWidthMm(input);
    expect(output).toEqual({
      version: 'engine-v2-deterministic-geometry-metrics-r1',
      valid: false,
      coordinateSpace: 'millimeter',
      value: null,
      errors: [{
        code: 'GEOMETRY_METRIC_COORDINATE_SPACE_INVALID',
        path: 'coordinateSpace',
        message: 'coordinateSpace must be millimeter.',
      }],
      warnings: [],
    });
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.errors)).toBe(true);

    const invalidPoint = measureMeanWidthMm(areaInput([
      { x: 0, y: 0 },
      null,
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]));
    expect(invalidPoint.errors).toContainEqual({
      code: 'GEOMETRY_METRIC_POINT_INVALID',
      path: 'geometry[1]',
      message: 'Point coordinates must be finite numbers.',
    });
  });

  it('measures rectangle mean width from effective area and intrinsic span', () => {
    const output = measureMeanWidthMm(areaInput(rectangle(0, 0, 10, 4)));
    expect(output.valid).toBe(true);
    expect(output.value.meanWidthMm).toBeCloseTo(4, 10);
    expect(output.value.effectiveAreaMm2).toBeCloseTo(40, 10);
    expect(output.value.longitudinalSpanMm).toBeCloseTo(10, 10);
    expect(output.value.method).toBe('effective_area_over_intrinsic_span');
    expectPublicNumbersFinite(output);
  });

  it('subtracts holes from mean width without mutating input', () => {
    const input = areaInput(rectangle(0, 0, 10, 6), [rectangle(4, 2, 2, 2)]);
    const before = structuredClone(input);
    const output = measureMeanWidthMm(input);
    expect(output.valid).toBe(true);
    expect(output.value.effectiveAreaMm2).toBeCloseTo(56, 10);
    expect(input).toEqual(before);
    expect(Object.isFrozen(output.value.axis)).toBe(true);
  });

  it('is insensitive to collinear vertex subdivision and reversed ring order', () => {
    const base = rectangle(0, 0, 10, 4);
    const subdivided = [base[0], { x: 5, y: 0 }, base[1], base[2], base[3]];
    const expected = measureMeanWidthMm(areaInput(base));
    const subdividedResult = measureMeanWidthMm(areaInput(subdivided));
    const reversed = measureMeanWidthMm(areaInput([...base].reverse()));
    expect(subdividedResult.value.meanWidthMm).toBeCloseTo(expected.value.meanWidthMm, 10);
    expect(reversed.value.meanWidthMm).toBeCloseTo(expected.value.meanWidthMm, 10);
  });

  it('obeys translation, rotation, reflection and scale contracts', () => {
    const source = rectangle(0, 0, 10, 4);
    const transform = (points, fn) => points.map(fn);
    const baseline = measureMeanWidthMm(areaInput(source)).value;
    const translated = measureMeanWidthMm(areaInput(transform(source, point => ({ x: point.x + 17, y: point.y - 9 })))).value;
    const rotated = measureMeanWidthMm(areaInput(transform(source, point => ({ x: -point.y, y: point.x })))).value;
    const reflected = measureMeanWidthMm(areaInput(transform(source, point => ({ x: -point.x, y: point.y })))).value;
    const scaled = measureMeanWidthMm(areaInput(transform(source, point => ({ x: point.x * 3, y: point.y * 3 })))).value;
    expect(translated.meanWidthMm).toBeCloseTo(baseline.meanWidthMm, 10);
    expect(rotated.meanWidthMm).toBeCloseTo(baseline.meanWidthMm, 10);
    expect(reflected.meanWidthMm).toBeCloseTo(baseline.meanWidthMm, 10);
    expect(scaled.meanWidthMm).toBeCloseTo(baseline.meanWidthMm * 3, 10);
    expect(scaled.effectiveAreaMm2).toBeCloseTo(baseline.effectiveAreaMm2 * 9, 10);
  });

  it('reports deterministic axis ambiguity for isotropic geometry', () => {
    const first = measureMeanWidthMm(areaInput(rectangle(0, 0, 4, 4)));
    const second = measureMeanWidthMm(areaInput(rectangle(0, 0, 4, 4)));
    expect(first.warnings.map(warning => warning.code)).toContain('GEOMETRY_METRIC_AXIS_AMBIGUOUS');
    expect(first).toEqual(second);
  });

  it('rejects degenerate, self-intersecting and invalid-hole geometry', () => {
    const degenerate = measureMeanWidthMm(areaInput([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]));
    const crossing = measureMeanWidthMm(areaInput([
      { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 },
    ]));
    const invalidHole = measureMeanWidthMm(areaInput(rectangle(0, 0, 4, 4), [rectangle(3, 3, 2, 2)]));
    const insufficientMaterial = measureMeanWidthMm(areaInput(
      rectangle(0, 0, 0.2, 0.2),
      [rectangle(0.006, 0.006, 0.188, 0.188)],
    ));
    const finiteHuge = Number.MAX_VALUE / 2;
    const overflowInput = areaInput(rectangle(0, 0, finiteHuge, finiteHuge));
    const overflowBefore = structuredClone(overflowInput);
    const overflow = measureMeanWidthMm(overflowInput);
    const overflowRepeated = measureMeanWidthMm(overflowInput);
    const overflowHole = measureMeanWidthMm(areaInput(
      rectangle(0, 0, 4, 4),
      [rectangle(0, 0, finiteHuge, finiteHuge)],
    ));
    expect(degenerate.errors[0]).toMatchObject({
      code: 'GEOMETRY_METRIC_POLYGON_DEGENERATE',
      path: 'geometry',
    });
    expect(crossing.errors).toContainEqual(expect.objectContaining({
      code: 'GEOMETRY_METRIC_POLYGON_SELF_INTERSECTING',
      path: 'geometry',
    }));
    expect(invalidHole.errors).toContainEqual(expect.objectContaining({
      code: 'GEOMETRY_METRIC_HOLE_INVALID',
      path: 'holes[0]',
    }));
    expect(insufficientMaterial.errors).toContainEqual({
      code: 'GEOMETRY_METRIC_POLYGON_DEGENERATE',
      path: 'geometry',
      message: 'Effective material area must be finite and at least minimumAreaMm2.',
    });
    expect(overflow.valid).toBe(false);
    expect(overflow.errors).toContainEqual(expect.objectContaining({
      code: 'GEOMETRY_METRIC_POLYGON_DEGENERATE',
      path: 'geometry',
    }));
    expect(overflowInput).toEqual(overflowBefore);
    expect(overflowRepeated).toEqual(overflow);
    expect(Object.isFrozen(overflow)).toBe(true);
    expect(Object.isFrozen(overflow.errors)).toBe(true);
    expect(Object.isFrozen(overflow.errors[0])).toBe(true);
    expectPublicNumbersFinite(overflow);
    expect(overflowHole.errors).toContainEqual(expect.objectContaining({
      code: 'GEOMETRY_METRIC_HOLE_INVALID',
      path: 'holes[0]',
    }));
    expectPublicNumbersFinite(insufficientMaterial);
    expectPublicNumbersFinite(overflowHole);
  });

  it('removes duplicate points with stable warnings', () => {
    const geometry = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 },
    ];
    const output = measureMeanWidthMm(areaInput(geometry));
    expect(output.valid).toBe(true);
    expect(output.value.meanWidthMm).toBeCloseTo(4, 10);
    expect(output.warnings.map(warning => warning.code)).toEqual([
      'GEOMETRY_METRIC_DUPLICATE_POINT_REMOVED',
      'GEOMETRY_METRIC_DUPLICATE_CLOSING_POINT_REMOVED',
    ]);
  });
});

describe('sustained width', () => {
  it('separates mean, maximum and sustained width', () => {
    const geometry = [
      { x: 0, y: -2 }, { x: 4, y: -2 }, { x: 5, y: -5 },
      { x: 6, y: -2 }, { x: 10, y: -2 }, { x: 10, y: 2 },
      { x: 6, y: 2 }, { x: 5, y: 5 }, { x: 4, y: 2 }, { x: 0, y: 2 },
    ];
    const mean = measureMeanWidthMm(areaInput(geometry));
    const sustained = measureSustainedWidthMm(areaInput(geometry), {
      stationCount: 129,
      minimumSustainedRunFraction: 0.3,
    });
    expect(sustained.valid).toBe(true);
    expect(sustained.value.maximumWidthMm).toBeGreaterThan(sustained.value.sustainedWidthMm);
    expect(sustained.value.sustainedWidthMm).toBeLessThanOrEqual(mean.value.meanWidthMm);
    expect(sustained.value.run.coverageFraction).toBeGreaterThanOrEqual(0.3);
  });

  it('returns identical output for repeated executions', () => {
    const input = areaInput(rectangle(0, 0, 12, 3));
    expect(measureSustainedWidthMm(input)).toEqual(measureSustainedWidthMm(input));
  });

  it('rejects invalid deterministic sampling options', () => {
    const output = measureSustainedWidthMm(areaInput(rectangle(0, 0, 10, 4)), { stationCount: 10 });
    expect(output.valid).toBe(false);
    expect(output.errors[0]).toMatchObject({
      code: 'GEOMETRY_METRIC_OPTION_INVALID',
      path: 'options.stationCount',
    });
  });
});

describe('curvature and ends', () => {
  it('measures an open straight path with zero curvature and canonical ends', () => {
    const input = {
      coordinateSpace: 'millimeter',
      closed: false,
      points: [{ x: 10, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 0 }],
    };
    const curvature = analyzeDiscreteCurvature(input, { curvatureSampleCount: 9, curvatureSmoothingWindow: 3 });
    const ends = analyzePathEnds(input);
    expect(curvature.valid).toBe(true);
    expect(curvature.value.maximumAbsoluteCurvatureRadPerMm).toBeCloseTo(0, 12);
    expect(curvature.value.samples[0].signedCurvatureRadPerMm).toBeNull();
    expect(ends.value.ends.map(end => end.point.x)).toEqual([0, 10]);
    expect(ends.value.ends[0].inwardTangent).toEqual({ x: 1, y: 0 });
    expectPublicNumbersFinite(curvature);

    const finiteHuge = Number.MAX_VALUE;
    const overflowOpenPath = {
      coordinateSpace: 'millimeter',
      closed: false,
      points: [{ x: -finiteHuge, y: 0 }, { x: finiteHuge, y: 0 }],
    };
    [analyzeDiscreteCurvature(overflowOpenPath), analyzePathEnds(overflowOpenPath)].forEach(invalid => {
      expect(invalid.valid).toBe(false);
      expect(invalid.value).toBeNull();
      expect(invalid.errors).toContainEqual({
        code: 'GEOMETRY_METRIC_POLYGON_DEGENERATE',
        path: 'points',
        message: 'Path length must be finite and greater than pointToleranceMm.',
      });
      expectPublicNumbersFinite(invalid);
    });
  });

  it('marks corners while preserving raw turning data', () => {
    const output = analyzeDiscreteCurvature({
      coordinateSpace: 'millimeter',
      closed: false,
      points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
    }, {
      curvatureSampleCount: 11,
      curvatureSmoothingWindow: 3,
      cornerTurnThresholdRadians: Math.PI / 6,
    });
    expect(output.valid).toBe(true);
    expect(output.value.samples.some(sample => sample.isCorner)).toBe(true);
    expect(output.value.maximumAbsoluteCurvatureRadPerMm).toBeGreaterThan(0);

    const smoothPoints = Array.from({ length: 33 }, (_, index) => {
      const angle = Math.PI * index / 32;
      return { x: 10 * Math.cos(angle), y: 10 * Math.sin(angle) };
    });
    const noisyPoints = smoothPoints.map((point, index) => {
      const angle = Math.PI * index / 32;
      const radius = 10 + (index % 2 === 0 ? -0.05 : 0.05);
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
    const curveOptions = { curvatureSampleCount: 65, curvatureSmoothingWindow: 5 };
    const smooth = analyzeDiscreteCurvature({
      coordinateSpace: 'millimeter',
      closed: false,
      points: smoothPoints,
    }, curveOptions).value;
    const noisy = analyzeDiscreteCurvature({
      coordinateSpace: 'millimeter',
      closed: false,
      points: noisyPoints,
    }, curveOptions).value;
    expect(smooth.meanAbsoluteCurvatureRadPerMm).toBeGreaterThan(0);
    expect(noisy.meanAbsoluteCurvatureRadPerMm).toBeGreaterThan(0);
    expect(Math.abs(noisy.meanAbsoluteCurvatureRadPerMm - smooth.meanAbsoluteCurvatureRadPerMm))
      .toBeLessThan(smooth.meanAbsoluteCurvatureRadPerMm);
    expect(noisy.maximumAbsoluteCurvatureRadPerMm)
      .toBeGreaterThan(smooth.maximumAbsoluteCurvatureRadPerMm);
    expect(noisy.maximumAbsoluteCurvatureRadPerMm)
      .toBeLessThan(smooth.maximumAbsoluteCurvatureRadPerMm * 3);
  });

  it('preserves a known non-45-degree turn when direct vector products overflow', () => {
    const scale = 1e155;
    const input = {
      coordinateSpace: 'millimeter',
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: scale, y: 0 },
        { x: 1.6 * scale, y: 0.8 * scale },
      ],
    };
    const before = structuredClone(input);
    const options = { curvatureSampleCount: 3, curvatureSmoothingWindow: 1 };

    expect(input.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(scale * (0.6 * scale)).toBe(Number.POSITIVE_INFINITY);
    expect(scale * (0.8 * scale)).toBe(Number.POSITIVE_INFINITY);

    const first = analyzeDiscreteCurvature(input, options);
    const second = analyzeDiscreteCurvature(input, options);

    expect(first.valid).toBe(true);
    const middle = first.value.samples[1];
    expect(second).toEqual(first);
    expect(input).toEqual(before);
    expect(middle.turnRadians).toBeCloseTo(Math.atan2(4, 3), 12);
    expect(Math.abs(middle.turnRadians - Math.PI / 4)).toBeGreaterThan(0.1);
    expectPublicNumbersFinite(first);
  });

  it('reports no topological ends for a closed polygon', () => {
    const output = analyzePathEnds({
      coordinateSpace: 'millimeter',
      closed: true,
      points: rectangle(0, 0, 4, 4),
    });
    expect(output.value).toEqual({
      applicable: false,
      closed: true,
      ends: [],
      reason: 'closed_path_has_no_topological_ends',
    });

    const collinear = {
      coordinateSpace: 'millimeter',
      closed: true,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    };
    [analyzeDiscreteCurvature(collinear), analyzePathEnds(collinear)].forEach(invalid => {
      expect(invalid.valid).toBe(false);
      expect(invalid.errors).toContainEqual({
        code: 'GEOMETRY_METRIC_POLYGON_DEGENERATE',
        path: 'points',
        message: 'Closed path area must be finite and at least minimumAreaMm2.',
      });
    });

    const finiteHuge = Number.MAX_VALUE / 2;
    const overflowClosedPath = {
      coordinateSpace: 'millimeter',
      closed: true,
      points: rectangle(0, 0, finiteHuge, finiteHuge),
    };
    [analyzeDiscreteCurvature(overflowClosedPath), analyzePathEnds(overflowClosedPath)].forEach(invalid => {
      expect(invalid.valid).toBe(false);
      expect(invalid.errors).toContainEqual({
        code: 'GEOMETRY_METRIC_POLYGON_DEGENERATE',
        path: 'points',
        message: 'Closed path area must be finite and at least minimumAreaMm2.',
      });
      expectPublicNumbersFinite(invalid);
    });
  });

  it('keeps absolute curvature under reversed order and scales it inversely', () => {
    const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 5, y: 2 }, { x: 5, y: 5 }];
    const options = { curvatureSampleCount: 21, curvatureSmoothingWindow: 3 };
    const base = analyzeDiscreteCurvature({ coordinateSpace: 'millimeter', closed: false, points }, options).value;
    const reversed = analyzeDiscreteCurvature({ coordinateSpace: 'millimeter', closed: false, points: [...points].reverse() }, options).value;
    const scaled = analyzeDiscreteCurvature({
      coordinateSpace: 'millimeter',
      closed: false,
      points: points.map(point => ({ x: point.x * 2, y: point.y * 2 })),
    }, options).value;
    expect(reversed.maximumAbsoluteCurvatureRadPerMm).toBeCloseTo(base.maximumAbsoluteCurvatureRadPerMm, 10);
    expect(scaled.maximumAbsoluteCurvatureRadPerMm).toBeCloseTo(base.maximumAbsoluteCurvatureRadPerMm / 2, 10);
  });
});

describe('diagnostic bridge candidates', () => {
  it('detects a dumbbell neck as an unconfirmed diagnostic candidate', () => {
    const dumbbell = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
      { x: 8, y: 2 }, { x: 8, y: 0 }, { x: 12, y: 0 },
      { x: 12, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 4 },
      { x: 4, y: 4 }, { x: 4, y: 6 }, { x: 0, y: 6 },
    ];
    const output = detectNarrowBridgeCandidates(areaInput(dumbbell), {
      ...bridgeOptions,
      maximumBridgeWidthMm: 2.1,
    });
    expect(output.valid).toBe(true);
    expect(output.value.candidates.length).toBeGreaterThan(0);
    expect(output.value.candidates.every(candidate =>
      candidate.classification === 'narrow_bridge_candidate' && candidate.confirmed === false)).toBe(true);
    expect(output.value.booleanGeometryClaimed).toBe(false);
  });

  it('does not classify a boundary taper as a bridge', () => {
    const taper = [{ x: 0, y: 0 }, { x: 10, y: -4 }, { x: 10, y: 4 }];
    const output = detectNarrowBridgeCandidates(areaInput(taper), bridgeOptions);
    expect(output.valid).toBe(true);
    expect(output.value.candidates).toEqual([]);
  });

  it('requires explicit bridge thresholds', () => {
    const output = detectNarrowBridgeCandidates(areaInput(rectangle(0, 0, 10, 4)));
    expect(output.valid).toBe(false);
    expect(output.errors.every(error => error.code === 'GEOMETRY_METRIC_OPTION_INVALID')).toBe(true);
    expect(output.errors.map(error => error.path)).toEqual([
      'options.maximumBridgeWidthMm',
      'options.minimumBridgeLengthMm',
      'options.minimumShoulderRatio',
    ]);
  });
});

describe('disconnected geometry components', () => {
  it('orders independent components canonically and ignores input order', () => {
    const regions = [
      { id: 'z', geometry: rectangle(20, 0, 4, 4), holes: [] },
      { id: 'a', geometry: rectangle(0, 0, 4, 4), holes: [] },
    ];
    const output = analyzeDisconnectedGeometryComponents({
      coordinateSpace: 'millimeter',
      regions,
    });
    expect(output.value.components).toEqual([
      { id: 'component-0001', memberRegionIds: ['a'] },
      { id: 'component-0002', memberRegionIds: ['z'] },
    ]);
    expectPublicNumbersFinite(output);
  });

  it('joins touching and overlapping regions', () => {
    const output = analyzeDisconnectedGeometryComponents({
      coordinateSpace: 'millimeter',
      regions: [
        { id: 'a', geometry: rectangle(0, 0, 4, 4), holes: [] },
        { id: 'b', geometry: rectangle(4, 0, 4, 4), holes: [] },
        { id: 'c', geometry: rectangle(7, 1, 4, 2), holes: [] },
      ],
    });
    expect(output.value.components).toEqual([
      { id: 'component-0001', memberRegionIds: ['a', 'b', 'c'] },
    ]);

    const containmentRegions = [
      { id: 'parent', geometry: rectangle(20, 20, 10, 10), holes: [] },
      { id: 'child', geometry: rectangle(23, 23, 2, 2), holes: [] },
    ];
    const contained = analyzeDisconnectedGeometryComponents({
      coordinateSpace: 'millimeter',
      regions: containmentRegions,
    });
    const containedReversed = analyzeDisconnectedGeometryComponents({
      coordinateSpace: 'millimeter',
      regions: [...containmentRegions].reverse(),
    });
    expect(contained.value.components).toEqual([
      { id: 'component-0001', memberRegionIds: ['child', 'parent'] },
    ]);
    expect(contained.value.regionToComponent).toEqual({
      child: 'component-0001',
      parent: 'component-0001',
    });
    expect(containedReversed).toEqual(contained);
  });

  it('keeps an explicit island inside a hole as a separate component', () => {
    const output = analyzeDisconnectedGeometryComponents({
      coordinateSpace: 'millimeter',
      regions: [
        { id: 'parent', geometry: rectangle(0, 0, 10, 10), holes: [rectangle(3, 3, 4, 4)] },
        { id: 'island', geometry: rectangle(4, 4, 2, 2), holes: [] },
      ],
    });
    expect(output.value.components).toHaveLength(2);
    expect(output.value.explicitHoleExclusions).toEqual([{
      regionAId: 'island',
      regionBId: 'parent',
      containerRegionId: 'parent',
      holeIndex: 0,
    }]);
    expect(output.value.unionGeometryProduced).toBe(false);
  });

  it('rejects duplicate region identifiers with a stable path', () => {
    const invalidId = analyzeDisconnectedGeometryComponents({
      coordinateSpace: 'millimeter',
      regions: [{ id: '', geometry: rectangle(0, 0, 2, 2) }],
    });
    const output = analyzeDisconnectedGeometryComponents({
      coordinateSpace: 'millimeter',
      regions: [
        { id: 'same', geometry: rectangle(0, 0, 2, 2) },
        { id: 'same', geometry: rectangle(4, 0, 2, 2) },
      ],
    });
    expect(invalidId.errors).toContainEqual({
      code: 'GEOMETRY_METRIC_REGION_ID_INVALID',
      path: 'regions[0].id',
      message: 'Region id must be a non-empty string.',
    });
    expect(output.valid).toBe(false);
    expect(output.errors.some(error =>
      error.code === 'GEOMETRY_METRIC_REGION_ID_DUPLICATE' && error.path === 'regions[1].id')).toBe(true);
  });
});

describe('P7-F1 deterministic geometry metrics hardening', () => {
  it('orders Unicode identifiers by deterministic UTF-16 code units without localeCompare', () => {
    const ids = ['\u{1F600}', '\u00E9', 'z', '\u00C5', 'a'];
    const input = {
      coordinateSpace: 'millimeter',
      regions: ids.map((id, index) => ({
        id,
        geometry: rectangle(index * 10, 0, 2, 2),
        holes: [],
      })),
    };
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'localeCompare');
    let output;

    try {
      Object.defineProperty(String.prototype, 'localeCompare', {
        ...descriptor,
        value() {
          throw new Error('localeCompare must not participate in canonical ordering.');
        },
      });
      output = analyzeDisconnectedGeometryComponents(input);
    } finally {
      Object.defineProperty(String.prototype, 'localeCompare', descriptor);
    }

    expect(output.valid).toBe(true);
    expect(output.value.components.map(component => component.memberRegionIds[0])).toEqual([
      'a', 'z', '\u00C5', '\u00E9', '\u{1F600}',
    ]);
  });

  it('returns structured results for completely empty inputs across all six exports', () => {
    const omittedInputs = [
      measureMeanWidthMm(),
      measureSustainedWidthMm(),
      analyzeDiscreteCurvature(),
      analyzePathEnds(),
      detectNarrowBridgeCandidates(),
      analyzeDisconnectedGeometryComponents(),
    ];
    const explicitEmptyInputs = [
      measureMeanWidthMm(areaInput([])),
      measureSustainedWidthMm(areaInput([])),
      analyzeDiscreteCurvature({ coordinateSpace: 'millimeter', closed: false, points: [] }),
      analyzePathEnds({ coordinateSpace: 'millimeter', closed: false, points: [] }),
      detectNarrowBridgeCandidates(areaInput([]), bridgeOptions),
      analyzeDisconnectedGeometryComponents({ coordinateSpace: 'millimeter', regions: [] }),
    ];

    omittedInputs.forEach(output => {
      expect(output).toMatchObject({
        version: 'engine-v2-deterministic-geometry-metrics-r1',
        valid: false,
        coordinateSpace: 'millimeter',
        value: null,
        errors: expect.any(Array),
        warnings: expect.any(Array),
      });
      expect(output.errors.length).toBeGreaterThan(0);
    });
    explicitEmptyInputs.forEach(output => {
      expect(output).toMatchObject({
        version: 'engine-v2-deterministic-geometry-metrics-r1',
        coordinateSpace: 'millimeter',
        errors: expect.any(Array),
        warnings: expect.any(Array),
      });
      expectPublicNumbersFinite(output);
    });
    expect(explicitEmptyInputs.at(-1)).toMatchObject({
      valid: true,
      value: {
        components: [],
        regionToComponent: {},
        explicitHoleExclusions: [],
      },
    });
  });

  it('rejects NaN and both infinities without exposing non-finite public numbers', () => {
    const invalidArea = value => areaInput([
      { x: 0, y: 0 }, { x: value, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ]);
    const outputs = [
      measureMeanWidthMm(invalidArea(Number.NaN)),
      measureSustainedWidthMm(invalidArea(Number.POSITIVE_INFINITY)),
      analyzeDiscreteCurvature({
        coordinateSpace: 'millimeter',
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 1, y: Number.NEGATIVE_INFINITY }],
      }),
      analyzePathEnds({
        coordinateSpace: 'millimeter',
        closed: false,
        points: [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }],
      }),
      detectNarrowBridgeCandidates(invalidArea(Number.NEGATIVE_INFINITY), bridgeOptions),
      analyzeDisconnectedGeometryComponents({
        coordinateSpace: 'millimeter',
        regions: [{ id: 'invalid', geometry: invalidArea(Number.NaN).geometry, holes: [] }],
      }),
    ];

    outputs.forEach(output => {
      expect(output.valid).toBe(false);
      expect(output.value).toBeNull();
      expect(output.errors).toContainEqual(expect.objectContaining({
        code: 'GEOMETRY_METRIC_POINT_INVALID',
      }));
      expectPublicNumbersFinite(output);
    });
  });

  it('keeps inputs and options pure for all six exports', () => {
    const cases = [
      {
        run: measureMeanWidthMm,
        args: [areaInput(rectangle(0, 0, 10, 6), [rectangle(4, 2, 2, 2)]), { pointToleranceMm: 1e-6 }],
      },
      {
        run: measureSustainedWidthMm,
        args: [areaInput(rectangle(0, 0, 12, 3)), { stationCount: 9 }],
      },
      {
        run: analyzeDiscreteCurvature,
        args: [{
          coordinateSpace: 'millimeter',
          closed: false,
          points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 2 }],
        }, { curvatureSampleCount: 9, curvatureSmoothingWindow: 3 }],
      },
      {
        run: analyzePathEnds,
        args: [{
          coordinateSpace: 'millimeter',
          closed: false,
          points: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 1 }],
        }, { pointToleranceMm: 1e-6 }],
      },
      {
        run: detectNarrowBridgeCandidates,
        args: [areaInput(rectangle(0, 0, 10, 4)), { ...bridgeOptions }],
      },
      {
        run: analyzeDisconnectedGeometryComponents,
        args: [{
          coordinateSpace: 'millimeter',
          regions: [
            { id: 'parent', geometry: rectangle(0, 0, 10, 10), holes: [rectangle(3, 3, 2, 2)] },
            { id: 'other', geometry: rectangle(20, 0, 4, 4), holes: [] },
          ],
        }, { boundaryToleranceMm: 1e-3 }],
      },
    ];

    cases.forEach(({ run, args }) => {
      const before = structuredClone(args);
      const output = run(...args);
      expect(output.valid).toBe(true);
      expect(args).toEqual(before);
    });
  });

  it('deep-freezes every public result from all six exports', () => {
    const outputs = [
      measureMeanWidthMm(areaInput(rectangle(0, 0, 10, 4))),
      measureSustainedWidthMm(areaInput(rectangle(0, 0, 12, 3))),
      analyzeDiscreteCurvature({
        coordinateSpace: 'millimeter',
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 2 }],
      }, { curvatureSampleCount: 9, curvatureSmoothingWindow: 3 }),
      analyzePathEnds({
        coordinateSpace: 'millimeter',
        closed: false,
        points: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 1 }],
      }),
      detectNarrowBridgeCandidates(areaInput(multiBridgeGeometry()), {
        ...bridgeOptions,
        maximumBridgeWidthMm: 2.1,
      }),
      analyzeDisconnectedGeometryComponents({
        coordinateSpace: 'millimeter',
        regions: [
          { id: 'a', geometry: rectangle(0, 0, 4, 4), holes: [] },
          { id: 'b', geometry: rectangle(10, 0, 4, 4), holes: [] },
        ],
      }),
    ];

    outputs.forEach(output => {
      expect(output.valid).toBe(true);
      expectDeepFrozen(output);
    });
  });

  it('preserves non-consecutive duplicates instead of silently deduplicating topology', () => {
    const openPath = analyzeDiscreteCurvature({
      coordinateSpace: 'millimeter',
      closed: false,
      points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 4 }],
    }, { curvatureSampleCount: 9, curvatureSmoothingWindow: 3 });
    const repeatedVertexArea = measureMeanWidthMm(areaInput([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 },
      { x: 0, y: 4 }, { x: 4, y: 0 },
    ]));

    expect(openPath.valid).toBe(true);
    expect(openPath.value.totalLengthMm).toBeCloseTo(10, 10);
    expect(openPath.warnings).toEqual([]);
    expect(repeatedVertexArea.valid).toBe(false);
    expect(repeatedVertexArea.errors).toContainEqual(expect.objectContaining({
      code: 'GEOMETRY_METRIC_POLYGON_SELF_INTERSECTING',
      path: 'geometry',
    }));
    expect(repeatedVertexArea.warnings).toEqual([]);
  });

  it('keeps multiple diagnostic bridge candidates distinct, ordered and repeatable', () => {
    const input = areaInput(multiBridgeGeometry());
    const options = {
      ...bridgeOptions,
      maximumBridgeWidthMm: 2.1,
      stationCount: 257,
    };
    const first = detectNarrowBridgeCandidates(input, options);
    const second = detectNarrowBridgeCandidates(input, options);
    const candidates = first.value.candidates;
    const ordered = [...candidates].sort((left, right) =>
      left.center.x - right.center.x
      || left.center.y - right.center.y
      || left.widthMm - right.widthMm
      || left.diagnosticDirectionIndex - right.diagnosticDirectionIndex);
    const intrinsicCandidates = candidates.filter(candidate => candidate.diagnosticDirectionIndex === 0);

    expect(first.valid).toBe(true);
    expect(second).toEqual(first);
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates).toEqual(ordered);
    expect(new Set(candidates.map(candidate => candidate.id)).size).toBe(candidates.length);
    expect(candidates.every(candidate => candidate.confirmed === false)).toBe(true);
    expect(intrinsicCandidates).toHaveLength(2);
    expect(Math.abs(intrinsicCandidates[0].center.x - 5)).toBeLessThan(0.1);
    expect(Math.abs(intrinsicCandidates[1].center.x - 11)).toBeLessThan(0.1);
  });
});
