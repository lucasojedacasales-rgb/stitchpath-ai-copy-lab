import { describe, expect, it } from 'vitest';

import {
  DIAGNOSTIC_LAB_AUDIT_INPUT_SCHEMA_V1,
  convertDiagnosticLabAuditInputToBridgeInput,
  createDiagnosticLabAuditInputFromFixture,
} from '../../engineV2Bridge/diagnosticLabAuditInput.js';
import { createMinimalInternalPipelineFixture } from '../fixtures/minimalInternalPipelineFixture.js';

const EXPLICIT_FIXTURE_PROVENANCE = Object.freeze({
  kind: 'explicit-fixture',
  id: 'minimal-internal-pipeline',
});

function validAuditInput() {
  return createDiagnosticLabAuditInputFromFixture(
    createMinimalInternalPipelineFixture(),
    EXPLICIT_FIXTURE_PROVENANCE,
  );
}

function capturedError(run) {
  try {
    run();
  } catch (error) {
    return {
      name: error.name,
      code: error.code,
      path: error.path,
      message: error.message,
    };
  }
  throw new Error('Expected the diagnostic audit input boundary to reject the input.');
}

function capturedContractError(input) {
  return capturedError(() => convertDiagnosticLabAuditInputToBridgeInput(input));
}

describe('P9-F5-A explicit fixture-only diagnostic audit input boundary', () => {
  it('P9-F5-A 1: converts the valid explicit fixture DTO to an exact cloned bridge input', () => {
    const fixture = createMinimalInternalPipelineFixture();
    const input = createDiagnosticLabAuditInputFromFixture(
      fixture,
      EXPLICIT_FIXTURE_PROVENANCE,
    );
    const result = convertDiagnosticLabAuditInputToBridgeInput(input);

    expect(input).toEqual({
      schema: DIAGNOSTIC_LAB_AUDIT_INPUT_SCHEMA_V1,
      provenance: {
        kind: 'explicit-fixture',
        id: 'minimal-internal-pipeline',
      },
      sourceRegions: fixture.sourceRegions,
      ingestionOptions: {
        coordinateSpace: 'normalized',
      },
      planningConfig: {
        designWidthMm: 20,
        designHeightMm: 20,
      },
    });
    expect(result).toEqual({
      regions: fixture.sourceRegions,
      config: {
        width_mm: 20,
        height_mm: 20,
      },
    });
    expect(input.sourceRegions).not.toBe(fixture.sourceRegions);
    expect(result.regions).not.toBe(input.sourceRegions);
    expect(result.regions[0]).not.toBe(input.sourceRegions[0]);
    expect(result.regions[0].path_points).not.toBe(input.sourceRegions[0].path_points);
    expect(result.regions[0].path_points[0]).not.toBe(input.sourceRegions[0].path_points[0]);

    const fixtureWithUnknownField = createMinimalInternalPipelineFixture();
    fixtureWithUnknownField.sourceRegions[0].unvalidatedMetadata = {
      note: 'must not reach the bridge',
    };
    const projectedInput = createDiagnosticLabAuditInputFromFixture(
      fixtureWithUnknownField,
      EXPLICIT_FIXTURE_PROVENANCE,
    );
    const projectedResult = convertDiagnosticLabAuditInputToBridgeInput(projectedInput);

    expect(projectedInput.sourceRegions[0]).not.toHaveProperty('unvalidatedMetadata');
    expect(projectedResult.regions[0]).not.toHaveProperty('unvalidatedMetadata');
    expect(Object.keys(projectedResult.regions[0])).toEqual([
      'id',
      'name',
      'region_class',
      'color',
      'visible',
      'path_points',
    ]);
    expect(JSON.stringify(projectedResult.regions)).not.toMatch(/derived|truncated/i);
  });

  it('P9-F5-A 2: never mutates the fixture, DTO, regions, or points and returns independent clones', () => {
    const fixture = createMinimalInternalPipelineFixture();
    const fixtureSnapshot = structuredClone(fixture);
    const input = createDiagnosticLabAuditInputFromFixture(
      fixture,
      EXPLICIT_FIXTURE_PROVENANCE,
    );
    const inputSnapshot = structuredClone(input);
    const first = convertDiagnosticLabAuditInputToBridgeInput(input);
    const second = convertDiagnosticLabAuditInputToBridgeInput(input);

    expect(fixture).toEqual(fixtureSnapshot);
    expect(input).toEqual(inputSnapshot);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.regions).not.toBe(second.regions);
    expect(first.regions[0].path_points[0]).not.toBe(second.regions[0].path_points[0]);

    first.regions[0].path_points[0][0] = 0.99;
    first.regions[0].name = 'output-only';
    expect(input).toEqual(inputSnapshot);
    expect(second).toEqual({
      regions: inputSnapshot.sourceRegions,
      config: {
        width_mm: 20,
        height_mm: 20,
      },
    });

    input.sourceRegions[0].path_points[0][0] = 0.01;
    expect(fixture).toEqual(fixtureSnapshot);
  });

  it('P9-F5-A 3: rejects protected or incompatible lineage sources and invalid provenance', () => {
    const forbiddenInputs = [
      { ...validAuditInput(), analysis: { geometry: [] } },
      { ...validAuditInput(), diagnosticReport: { summary: {} } },
      { ...validAuditInput(), extents: { minX: 0, maxX: 1 } },
      {
        ...validAuditInput(),
        sourceRegions: [{ id: 'dst-derived', geometry: [[0, 0], [1, 0], [0, 1]] }],
      },
      {
        ...validAuditInput(),
        sourceRegions: [{ id: 'metric-derived', metrics: { width: 1, height: 1 } }],
      },
    ];

    forbiddenInputs.forEach(input => {
      const error = capturedContractError(input);
      expect(error.name).toBe('DiagnosticLabAuditInputError');
      expect(error.code).toBe('DIAGNOSTIC_LAB_AUDIT_INPUT_FORBIDDEN_SOURCE');
      expect(error.path).toMatch(/analysis|diagnosticReport|extents|geometry|metrics/);
    });

    const sourceRegion = validAuditInput().sourceRegions[0];
    const lineageMarkers = [
      ['derived', true],
      ['truncated', true],
      ['isDerived', false],
      ['isTruncated', false],
      ['sourceDerived', null],
      ['SOURCE_TRUNCATED', 'present'],
    ];

    lineageMarkers.forEach(([field, value]) => {
      const input = {
        ...validAuditInput(),
        sourceRegions: [{ ...sourceRegion, [field]: value }],
      };
      const error = capturedContractError(input);

      expect(error).toEqual({
        name: 'DiagnosticLabAuditInputError',
        code: 'DIAGNOSTIC_LAB_AUDIT_INPUT_INCOMPATIBLE_LINEAGE',
        path: `input.sourceRegions.0.${field}`,
        message: `${field} is an incompatible lineage marker for the explicit fixture audit source.`,
      });
    });

    const fixture = createMinimalInternalPipelineFixture();
    const missingProvenance = capturedError(
      () => createDiagnosticLabAuditInputFromFixture(fixture),
    );
    const incorrectProvenance = capturedError(
      () => createDiagnosticLabAuditInputFromFixture(fixture, {
        kind: 'explicit-fixture',
        id: 'not-the-minimal-fixture',
      }),
    );

    expect(missingProvenance.code).toBe('DIAGNOSTIC_LAB_AUDIT_INPUT_PROVENANCE_INVALID');
    expect(missingProvenance.path).toBe('provenance');
    expect(incorrectProvenance.code).toBe('DIAGNOSTIC_LAB_AUDIT_INPUT_PROVENANCE_INVALID');
    expect(incorrectProvenance.path).toBe('provenance');
  });

  it('P9-F5-A 4: rejects absent or empty regions, invalid or duplicate IDs, and invalid points', () => {
    const sourceRegion = validAuditInput().sourceRegions[0];
    const invalidInputs = [
      { ...validAuditInput(), sourceRegions: undefined },
      { ...validAuditInput(), sourceRegions: [] },
      { ...validAuditInput(), sourceRegions: [null] },
      { ...validAuditInput(), sourceRegions: [{ ...sourceRegion, id: '  ' }] },
      {
        ...validAuditInput(),
        sourceRegions: [sourceRegion, structuredClone(sourceRegion)],
      },
      {
        ...validAuditInput(),
        sourceRegions: [{ ...sourceRegion, path_points: 'not-points' }],
      },
      {
        ...validAuditInput(),
        sourceRegions: [{
          ...sourceRegion,
          path_points: [[0, 0], [Number.NaN, 0], [0, 1]],
        }],
      },
    ];

    expect(invalidInputs.map(input => capturedContractError(input).code)).toEqual([
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGIONS_INVALID',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGIONS_INVALID',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_INVALID',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_ID_INVALID',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_ID_DUPLICATE',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_REGION_POINTS_INVALID',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_NON_FINITE_COORDINATE',
    ]);
  });

  it('P9-F5-A 5: rejects out-of-range coordinates, degenerate polygons, invalid dimensions, and non-normalized space', () => {
    const sourceRegion = validAuditInput().sourceRegions[0];
    const invalidInputs = [
      {
        ...validAuditInput(),
        sourceRegions: [{
          ...sourceRegion,
          path_points: [[0, 0], [1.01, 0], [0, 1]],
        }],
      },
      {
        ...validAuditInput(),
        sourceRegions: [{
          ...sourceRegion,
          path_points: [[0, 0], [0.5, 0.5], [1, 1]],
        }],
      },
      {
        ...validAuditInput(),
        planningConfig: { designWidthMm: 0, designHeightMm: 20 },
      },
      {
        ...validAuditInput(),
        planningConfig: { designWidthMm: 20, designHeightMm: Infinity },
      },
      {
        ...validAuditInput(),
        ingestionOptions: { coordinateSpace: 'millimeter' },
      },
    ];

    expect(invalidInputs.map(input => capturedContractError(input).code)).toEqual([
      'DIAGNOSTIC_LAB_AUDIT_INPUT_COORDINATE_OUT_OF_RANGE',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_DEGENERATE_POLYGON',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_DIMENSION_INVALID',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_DIMENSION_INVALID',
      'DIAGNOSTIC_LAB_AUDIT_INPUT_COORDINATE_SPACE_INVALID',
    ]);
  });
});
