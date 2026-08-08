import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import EngineV2AuditPanel from '../EngineV2AuditPanel.jsx';

function renderPanel(props) {
  return renderToStaticMarkup(
    createElement(EngineV2AuditPanel, props),
  );
}

function validResult() {
  return {
    valid: true,
    terminalStage: 'documentValidation',
    completedStages: ['ingestion', 'physicalGeneration', 'documentValidation'],
    documentValidation: { valid: true, errors: [], warnings: [] },
    errors: [],
    warnings: [],
    document: {
      regions: [{ id: 'region-1' }, { id: 'region-2' }],
      objects: [{ id: 'object-1' }],
      threads: [{ id: 'thread-1' }, { id: 'thread-2' }, { id: 'thread-3' }],
      threadBlocks: [{ id: 'block-1' }, { id: 'block-2' }],
      commands: [
        { type: 'stitch' },
        { type: 'stitch' },
        { type: 'jump' },
        { type: 'end' },
      ],
    },
    metadata: {
      machineAdaptationApplied: false,
      encodingApplied: false,
      binaryArtifactCreated: false,
    },
  };
}

describe('EngineV2AuditPanel', () => {
  it('shows a disabled bridge and confirms no execution occurred', () => {
    const markup = renderPanel({});

    expect(markup).toContain('Auditoría técnica Engine V2');
    expect(markup).toContain('Puente experimental desactivado');
    expect(markup).toContain('No se ha realizado ninguna ejecución.');
  });

  it('gives disabled result status precedence even when enabled is true', () => {
    const markup = renderPanel({
      enabled: true,
      result: { status: 'disabled', valid: false },
      error: { message: 'must not win precedence' },
    });

    expect(markup).toContain('Puente experimental desactivado');
    expect(markup).not.toContain('Excepción contractual externa');
  });

  it('shows enabled waiting state when no result exists', () => {
    const markup = renderPanel({ enabled: true });

    expect(markup).toContain('Puente experimental habilitado');
    expect(markup).toContain('Todavía no ejecutado');
    expect(markup).toContain('espera un resultado contractual externo');
  });

  it('renders a valid contractual result with counts, isolation, and JSON', () => {
    const markup = renderPanel({ enabled: true, result: validResult() });

    expect(markup).toContain('documentValidation');
    expect(markup).toContain('ingestion → physicalGeneration → documentValidation');
    expect(markup).toContain('data-audit-field="document-validation"');
    expect(markup).toMatch(/data-audit-field="regions-count"[^>]*>2</);
    expect(markup).toMatch(/data-audit-field="objects-count"[^>]*>1</);
    expect(markup).toMatch(/data-audit-field="threads-count"[^>]*>3</);
    expect(markup).toMatch(/data-audit-field="thread-blocks-count"[^>]*>2</);
    expect(markup).toMatch(/data-audit-field="commands-count"[^>]*>4</);
    expect(markup).toContain('machineAdaptationApplied');
    expect(markup).toContain('encodingApplied');
    expect(markup).toContain('binaryArtifactCreated');
    expect(markup).toContain('<details');
    expect(markup).toContain('&quot;terminalStage&quot;');
  });

  it('renders an invalid result with errors, warnings, and available JSON', () => {
    const result = {
      valid: false,
      terminalStage: 'physicalGeneration',
      completedStages: ['ingestion'],
      errors: [{ code: 'PHYSICAL_GENERATOR_FAILED' }],
      warnings: ['synthetic warning'],
      metadata: {},
    };
    const markup = renderPanel({ enabled: true, result });

    expect(markup).toContain('physicalGeneration');
    expect(markup).toContain('PHYSICAL_GENERATOR_FAILED');
    expect(markup).toContain('synthetic warning');
    expect(markup).toContain('<details');
    expect(markup).toContain('&quot;valid&quot;: false');
  });

  it('renders all safe contractual exception fields', () => {
    const markup = renderPanel({
      enabled: true,
      error: {
        name: 'Base44ProjectToEngineV2InputError',
        code: 'BASE44_ENGINE_V2_REGIONS_INVALID',
        path: 'regions',
        message: 'regions must be a non-empty array.',
      },
    });

    expect(markup).toContain('Base44ProjectToEngineV2InputError');
    expect(markup).toContain('BASE44_ENGINE_V2_REGIONS_INVALID');
    expect(markup).toContain('regions');
    expect(markup).toContain('regions must be a non-empty array.');
  });

  it('keeps the rendered surface strictly presentational', () => {
    const markup = renderPanel({ enabled: true, result: validResult() });
    const lowerMarkup = markup.toLowerCase();

    expect(lowerMarkup).not.toContain('<button');
    expect(lowerMarkup).not.toContain('<a');
    expect(lowerMarkup).not.toContain('<form');
    expect(lowerMarkup).not.toContain('download=');
    expect(lowerMarkup).not.toMatch(/\b(ejecutar|exportar|descargar|guardar|persistir)\b/);
  });
});
