import { describe, expect, it } from 'vitest';

import { adaptBase44ProjectToEngineV2Input } from '../../engineV2Bridge/base44ProjectToEngineV2Input.js';
import { createMinimalInternalPipelineFixture } from '../fixtures/minimalInternalPipelineFixture.js';

function validInput(overrides = {}) {
  const fixture = createMinimalInternalPipelineFixture();
  return {
    regions: fixture.sourceRegions,
    config: {
      width_mm: fixture.planningConfig.designWidthMm,
      height_mm: fixture.planningConfig.designHeightMm,
    },
    ...overrides,
  };
}

function capturedContractError(input) {
  try {
    adaptBase44ProjectToEngineV2Input(input);
  } catch (error) {
    return {
      name: error.name,
      code: error.code,
      path: error.path,
      message: error.message,
    };
  }
  throw new Error('Expected the adapter to reject the input.');
}

describe('Base44 project to Engine V2 input adapter', () => {
  it('adapts a valid input to the exact expected contract', () => {
    const input = validInput();

    expect(adaptBase44ProjectToEngineV2Input(input)).toEqual({
      sourceRegions: input.regions,
      ingestionOptions: {
        coordinateSpace: 'normalized',
      },
      planningConfig: {
        designWidthMm: 20,
        designHeightMm: 20,
      },
    });
  });

  it('preserves finite positive dimensions without conversion or rounding', () => {
    const width_mm = 12.345678901234;
    const height_mm = 0.000000123456;
    const result = adaptBase44ProjectToEngineV2Input(
      validInput({ config: { width_mm, height_mm } }),
    );

    expect(result.planningConfig.designWidthMm).toBe(width_mm);
    expect(result.planningConfig.designHeightMm).toBe(height_mm);
  });

  it('preserves order, fields, and regions with visible false without filtering', () => {
    const first = {
      ...createMinimalInternalPipelineFixture().sourceRegions[0],
      source_metadata: { layer: 1 },
    };
    const hidden = {
      ...first,
      id: 'p9-hidden-region',
      name: 'hidden detail',
      visible: false,
      source_metadata: { layer: 2, semantic_hint: 'detail' },
    };
    const input = validInput({ regions: [hidden, first] });
    const result = adaptBase44ProjectToEngineV2Input(input);

    expect(result.sourceRegions).toEqual([hidden, first]);
    expect(result.sourceRegions.map(region => region.id)).toEqual([
      'p9-hidden-region',
      'p6-primary-shape',
    ]);
    expect(result.sourceRegions[0].visible).toBe(false);
    expect(result.sourceRegions[0].source_metadata).toEqual({
      layer: 2,
      semantic_hint: 'detail',
    });
  });

  it('does not mutate the input and returns independent structures', () => {
    const input = validInput();
    input.regions[0].source_metadata = {
      tags: ['synthetic', 'normalized'],
    };
    const snapshot = structuredClone(input);
    const result = adaptBase44ProjectToEngineV2Input(input);

    result.sourceRegions[0].path_points[0][0] = 0.99;
    result.sourceRegions[0].source_metadata.tags.push('output-only');

    expect(input).toEqual(snapshot);
    expect(result.sourceRegions).not.toBe(input.regions);
    expect(result.sourceRegions[0]).not.toBe(input.regions[0]);
    expect(result.sourceRegions[0].path_points).not.toBe(input.regions[0].path_points);
    expect(result.sourceRegions[0].source_metadata).not.toBe(
      input.regions[0].source_metadata,
    );
  });

  it('produces deterministic results for equivalent inputs', () => {
    const firstInput = validInput();
    const secondInput = structuredClone(firstInput);
    const first = adaptBase44ProjectToEngineV2Input(firstInput);
    const second = adaptBase44ProjectToEngineV2Input(secondInput);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.sourceRegions).not.toBe(second.sourceRegions);
  });

  it('rejects absent, non-array, or empty regions with a stable error', () => {
    const expected = {
      name: 'Base44ProjectToEngineV2InputError',
      code: 'BASE44_ENGINE_V2_REGIONS_INVALID',
      path: 'regions',
      message: 'regions must be a non-empty array.',
    };
    const validConfig = { width_mm: 20, height_mm: 20 };
    const inputs = [
      undefined,
      {},
      { regions: undefined, config: validConfig },
      { regions: null, config: validConfig },
      { regions: {}, config: validConfig },
      { regions: 'region', config: validConfig },
      { regions: [], config: validConfig },
    ];

    inputs.forEach(input => {
      expect(capturedContractError(input)).toEqual(expected);
    });
  });

  it('rejects invalid width_mm values with a stable error', () => {
    const expected = {
      name: 'Base44ProjectToEngineV2InputError',
      code: 'BASE44_ENGINE_V2_WIDTH_MM_INVALID',
      path: 'config.width_mm',
      message: 'width_mm must be a finite number greater than zero.',
    };
    const regions = createMinimalInternalPipelineFixture().sourceRegions;
    const invalidWidths = [undefined, null, '20', Number.NaN, Infinity, -Infinity, 0, -1];

    invalidWidths.forEach(width_mm => {
      expect(capturedContractError({
        regions,
        config: { width_mm, height_mm: 20 },
      })).toEqual(expected);
    });
  });

  it('rejects invalid height_mm values with a stable error', () => {
    const expected = {
      name: 'Base44ProjectToEngineV2InputError',
      code: 'BASE44_ENGINE_V2_HEIGHT_MM_INVALID',
      path: 'config.height_mm',
      message: 'height_mm must be a finite number greater than zero.',
    };
    const regions = createMinimalInternalPipelineFixture().sourceRegions;
    const invalidHeights = [undefined, null, '20', Number.NaN, Infinity, -Infinity, 0, -1];

    invalidHeights.forEach(height_mm => {
      expect(capturedContractError({
        regions,
        config: { width_mm: 20, height_mm },
      })).toEqual(expected);
    });
  });
});
