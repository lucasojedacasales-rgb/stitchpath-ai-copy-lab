// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import YoshiT2RunnerPanel from '../../../components/diagnostic/YoshiT2RunnerPanel.jsx';
import {
  YOSHI_T2_ARTIFACT_NAMES,
  YOSHI_T2_EXPECTED_FILE,
  YOSHI_T2_REQUIRED_STAGES,
} from '../../engineV2Bridge/yoshiT2DiagnosticArtifacts.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function expectedFileMetadata() {
  return { ...YOSHI_T2_EXPECTED_FILE };
}

function completedPanelResult() {
  return {
    ok: true,
    code: null,
    artifacts: Object.fromEntries(YOSHI_T2_ARTIFACT_NAMES.map(name => [name, {
      name,
      mimeType: 'text/plain;charset=utf-8',
      text: '{}\n',
    }])),
    summary: {
      regionCount: 1,
      adaptedRegionCount: 1,
      commandCount: 1,
    },
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

const mountedPanels = new Set();
const ACT_ENVIRONMENT_KEY = 'IS_REACT_ACT_ENVIRONMENT';
const INITIAL_ACT_ENVIRONMENT_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  globalThis,
  ACT_ENVIRONMENT_KEY,
);
const ACT_ENVIRONMENT_WAS_PRESENT = INITIAL_ACT_ENVIRONMENT_DESCRIPTOR !== undefined;

function installActEnvironment() {
  if (INITIAL_ACT_ENVIRONMENT_DESCRIPTOR?.configurable === false) {
    if ('value' in INITIAL_ACT_ENVIRONMENT_DESCRIPTOR && INITIAL_ACT_ENVIRONMENT_DESCRIPTOR.writable) {
      Object.defineProperty(globalThis, ACT_ENVIRONMENT_KEY, {
        ...INITIAL_ACT_ENVIRONMENT_DESCRIPTOR,
        value: true,
      });
      return;
    }
    throw new TypeError('IS_REACT_ACT_ENVIRONMENT cannot be configured safely for this test suite.');
  }
  Object.defineProperty(globalThis, ACT_ENVIRONMENT_KEY, {
    configurable: true,
    enumerable: INITIAL_ACT_ENVIRONMENT_DESCRIPTOR?.enumerable ?? false,
    value: true,
    writable: true,
  });
}

function restoreActEnvironment() {
  if (ACT_ENVIRONMENT_WAS_PRESENT) {
    Object.defineProperty(
      globalThis,
      ACT_ENVIRONMENT_KEY,
      INITIAL_ACT_ENVIRONMENT_DESCRIPTOR,
    );
    return;
  }
  if (!delete globalThis[ACT_ENVIRONMENT_KEY]) {
    throw new TypeError('IS_REACT_ACT_ENVIRONMENT could not be removed after the test suite.');
  }
}

beforeAll(() => {
  installActEnvironment();
});

afterAll(() => {
  restoreActEnvironment();
});

afterEach(async () => {
  for (const panel of [...mountedPanels]) await panel.unmount();
  vi.restoreAllMocks();
});

async function renderPanel(overrides = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const props = {
    inspectFile: vi.fn().mockResolvedValue({
      valid: true,
      code: null,
      metadata: expectedFileMetadata(),
    }),
    executeRun: vi.fn().mockResolvedValue(completedPanelResult()),
    runConnector: vi.fn(),
    adaptLegacy: vi.fn(),
    downloadArtifact: vi.fn(() => true),
    createInputObjectURL: vi.fn(() => 'blob:panel-input'),
    revokeInputObjectURL: vi.fn(),
    ...overrides,
  };
  const root = createRoot(container);
  const panel = {
    container,
    props,
    root,
    mounted: true,
    async unmount() {
      if (!panel.mounted) return;
      panel.mounted = false;
      mountedPanels.delete(panel);
      await act(async () => {
        root.unmount();
        await flush();
      });
      container.remove();
    },
  };
  mountedPanels.add(panel);
  await act(async () => {
    root.render(<YoshiT2RunnerPanel {...props} />);
    await flush();
  });
  return panel;
}

function fileInput(panel) {
  return panel.container.querySelector('input[type="file"]');
}

function executeButton(panel) {
  return [...panel.container.querySelectorAll('button')]
    .find(button => button.textContent.includes('Ejecutar T2'));
}

function downloadButtons(panel) {
  return [...panel.container.querySelectorAll('button')]
    .filter(button => YOSHI_T2_ARTIFACT_NAMES.some(name => button.textContent.includes(name)));
}

async function select(panel, file = { name: YOSHI_T2_EXPECTED_FILE.name }) {
  const input = fileInput(panel);
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
  });
}

describe('YoshiT2RunnerPanel with real jsdom', () => {
  it('renders and enables execution only after a valid inspection', async () => {
    const panel = await renderPanel();
    expect(panel.container.textContent).toContain('Yoshi T2');
    expect(fileInput(panel)).toBeInstanceOf(HTMLInputElement);
    expect(executeButton(panel).disabled).toBe(true);

    await select(panel);
    expect(panel.container.textContent).toContain('Archivo acreditado');
    expect(executeButton(panel).disabled).toBe(false);
  });

  it('renders an invalid JPEG code and keeps execution disabled', async () => {
    const executeRun = vi.fn();
    const runConnector = vi.fn();
    const createInputObjectURL = vi.fn();
    const panel = await renderPanel({
      inspectFile: vi.fn().mockResolvedValue({
        valid: false,
        code: 'T2_YOSHI_FILE_SIGNATURE_INVALID',
        metadata: null,
      }),
      executeRun,
      runConnector,
      createInputObjectURL,
    });
    await select(panel);
    expect(panel.container.textContent).toContain('T2_YOSHI_FILE_SIGNATURE_INVALID');
    expect(executeButton(panel).disabled).toBe(true);
    executeButton(panel).click();
    expect(executeRun).not.toHaveBeenCalled();
    expect(runConnector).not.toHaveBeenCalled();
    expect(createInputObjectURL).not.toHaveBeenCalled();
  });

  it('admits one execution on a same-tick double click and disables the button', async () => {
    const pending = deferred();
    const executeRun = vi.fn(() => pending.promise);
    const panel = await renderPanel({ executeRun });
    await select(panel);

    await act(async () => {
      executeButton(panel).click();
      executeButton(panel).click();
      await flush();
    });
    expect(executeRun).toHaveBeenCalledOnce();
    expect(executeButton(panel).disabled).toBe(true);

    pending.resolve(completedPanelResult());
    await act(flush);
  });

  it('reflects connector progress only while mounted', async () => {
    const pending = deferred();
    const executeRun = vi.fn(options => {
      options.onProgress(10, 'image_analysis');
      options.onProgress(20, 'not-a-contractual-stage');
      return pending.promise;
    });
    const panel = await renderPanel({ executeRun });
    await select(panel);
    await act(async () => {
      executeButton(panel).click();
      await flush();
    });

    const runningStage = [...panel.container.querySelectorAll('li')]
      .find(item => item.textContent.includes('image_analysis'));
    expect(runningStage.className).toContain('violet');
    expect(panel.container.textContent).not.toContain('not-a-contractual-stage');
    pending.resolve(completedPanelResult());
    await act(flush);
  });

  it('drops late progress through the real central guard after unmount', async () => {
    const pending = deferred();
    let onProgress;
    const executeRun = vi.fn(async options => {
      onProgress = options.onProgress;
      const url = options.createObjectURL({});
      try {
        return await pending.promise;
      } finally {
        options.revokeObjectURL(url);
      }
    });
    const commitState = vi.fn(commit => commit());
    const revokeInputObjectURL = vi.fn();
    const panel = await renderPanel({ executeRun, commitState, revokeInputObjectURL });
    await select(panel);
    commitState.mockClear();
    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    await panel.unmount();

    expect(revokeInputObjectURL).toHaveBeenCalledExactlyOnceWith('blob:panel-input');
    expect(() => onProgress(90, 'stitch_optimizer')).not.toThrow();
    expect(commitState).not.toHaveBeenCalled();
    expect(panel.container.childNodes).toHaveLength(0);
    expect(downloadButtons(panel)).toHaveLength(0);

    pending.resolve(completedPanelResult());
    await act(flush);
    expect(commitState).not.toHaveBeenCalled();
    expect(revokeInputObjectURL).toHaveBeenCalledOnce();
  });

  it('ignores a late inspection after unmount without a React state warning', async () => {
    const pending = deferred();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const panel = await renderPanel({ inspectFile: vi.fn(() => pending.promise) });
    await select(panel);
    await panel.unmount();

    pending.resolve({ valid: true, code: null, metadata: expectedFileMetadata() });
    await act(flush);
    expect(panel.container.childNodes).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'])('revokes once and ignores late connector %s after unmount', async outcome => {
    const pending = deferred();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const executeRun = vi.fn(async options => {
      const url = options.createObjectURL({});
      try {
        return await pending.promise;
      } finally {
        options.revokeObjectURL(url);
      }
    });
    const revokeInputObjectURL = vi.fn();
    const panel = await renderPanel({ executeRun, revokeInputObjectURL });
    await select(panel);
    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    await panel.unmount();
    expect(revokeInputObjectURL).toHaveBeenCalledExactlyOnceWith('blob:panel-input');

    if (outcome === 'resolve') pending.resolve(completedPanelResult());
    else pending.reject(Object.assign(new Error('late failure'), { code: 'T2_LATE_FAILURE' }));
    await act(flush);
    expect(revokeInputObjectURL).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('refuses delayed object URL creation after unmount before calling the browser API', async () => {
    const pending = deferred();
    let executionOptions;
    const executeRun = vi.fn(options => {
      executionOptions = options;
      return pending.promise;
    });
    const createInputObjectURL = vi.fn(() => 'blob:must-not-exist');
    const panel = await renderPanel({ executeRun, createInputObjectURL });
    await select(panel);
    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    await panel.unmount();

    expect(() => executionOptions.createObjectURL({})).toThrow(expect.objectContaining({
      code: 'T2_PANEL_UNMOUNTED',
    }));
    expect(createInputObjectURL).not.toHaveBeenCalled();
    pending.resolve(completedPanelResult());
    await act(flush);
  });

  it('keeps repeated helper and unmount cleanup idempotent after URL creation', async () => {
    const pending = deferred();
    let repeatCleanup;
    const executeRun = vi.fn(async options => {
      const url = options.createObjectURL({});
      repeatCleanup = () => options.revokeObjectURL(url);
      try {
        return await pending.promise;
      } finally {
        options.revokeObjectURL(url);
      }
    });
    const revokeInputObjectURL = vi.fn();
    const panel = await renderPanel({ executeRun, revokeInputObjectURL });
    await select(panel);
    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    await panel.unmount();
    repeatCleanup();
    repeatCleanup();
    await panel.unmount();
    expect(revokeInputObjectURL).toHaveBeenCalledExactlyOnceWith('blob:panel-input');

    pending.resolve(completedPanelResult());
    await act(flush);
    expect(revokeInputObjectURL).toHaveBeenCalledOnce();
  });

  it('lets only the newest A-to-B inspection update real DOM state', async () => {
    const first = deferred();
    const second = deferred();
    const inspectFile = vi.fn(file => file.name === 'A.jpeg' ? first.promise : second.promise);
    const panel = await renderPanel({ inspectFile });
    const input = fileInput(panel);

    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'A.jpeg' }] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'B.jpeg' }] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });

    second.resolve({ valid: true, code: null, metadata: expectedFileMetadata() });
    await act(flush);
    first.resolve({ valid: false, code: 'STALE_A_MUST_NOT_WIN', metadata: null });
    await act(flush);
    expect(panel.container.textContent).toContain('Archivo acreditado');
    expect(panel.container.textContent).not.toContain('STALE_A_MUST_NOT_WIN');
  });

  it('clears completed artifacts immediately when a new inspection starts', async () => {
    const nextInspection = deferred();
    const inspectFile = vi.fn()
      .mockResolvedValueOnce({ valid: true, code: null, metadata: expectedFileMetadata() })
      .mockImplementationOnce(() => nextInspection.promise);
    const panel = await renderPanel({ inspectFile });
    await select(panel);
    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    expect(downloadButtons(panel)).toHaveLength(8);

    const input = fileInput(panel);
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'replacement.jpeg' }] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    expect(downloadButtons(panel)).toHaveLength(0);
    nextInspection.resolve({ valid: false, code: 'T2_REPLACEMENT_INVALID', metadata: null });
    await act(flush);
  });

  it.each(['blocked', 'failed'])('keeps downloads disabled for a %s result', async status => {
    const panel = await renderPanel({
      executeRun: vi.fn().mockResolvedValue({
        ok: false,
        code: `T2_${status.toUpperCase()}`,
        artifacts: null,
        summary: null,
      }),
    });
    await select(panel);
    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    expect(downloadButtons(panel)).toHaveLength(0);
    expect(panel.container.textContent).toContain(`T2_${status.toUpperCase()}`);
  });

  it('allows a second sequential execution after the first one settles', async () => {
    const executeRun = vi.fn().mockResolvedValue(completedPanelResult());
    const panel = await renderPanel({ executeRun });
    await select(panel);

    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    expect(executeRun).toHaveBeenCalledOnce();
    expect(executeButton(panel).disabled).toBe(false);

    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    expect(executeRun).toHaveBeenCalledTimes(2);
    expect(downloadButtons(panel)).toHaveLength(8);
  });

  it('enables exactly eight local downloads only after completion', async () => {
    const downloadArtifact = vi.fn(() => true);
    const panel = await renderPanel({ downloadArtifact });
    await select(panel);
    await act(async () => {
      executeButton(panel).click();
      await flush();
    });
    const buttons = downloadButtons(panel);
    expect(buttons).toHaveLength(8);
    await act(async () => {
      buttons.forEach(button => button.click());
      await flush();
    });
    expect(downloadArtifact).toHaveBeenCalledTimes(8);
    expect(downloadArtifact.mock.calls.map(([, name]) => name)).toEqual(YOSHI_T2_ARTIFACT_NAMES);
    expect(YOSHI_T2_REQUIRED_STAGES).toHaveLength(9);
  });
});
