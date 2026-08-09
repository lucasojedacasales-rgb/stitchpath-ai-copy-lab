import {
  createSequenceTechnicalFixture,
  createSyntheticTechnicalObject,
} from '../../fixtures/simpleSequenceFixture.js';

const THREADS = Object.freeze({
  green: 'thread:c2:green',
  red: 'thread:c2:red',
  blue: 'thread:c2:blue',
});

function rectangle(x, y = 0) {
  return [
    { x, y },
    { x: x + 4, y },
    { x: x + 4, y: y + 4 },
    { x, y: y + 4 },
  ];
}

function object(id, threadId, x, dependencyIds = []) {
  const colors = {
    [THREADS.green]: '#22AA55',
    [THREADS.red]: '#CC3344',
    [THREADS.blue]: '#3366CC',
  };
  return createSyntheticTechnicalObject(id, {
    threadId,
    visualColor: colors[threadId],
    dependencyIds,
    geometry: rectangle(x),
    layer: dependencyIds.length,
  });
}

export function createColorGroupComplexFixture({ reverseInput = false } = {}) {
  const greenBase = object('z9-green-base', THREADS.green, 0);
  const redMiddle = object('a2-red-middle', THREADS.red, 6, [greenBase.id]);
  const greenTop = object('m7-green-top', THREADS.green, 12, [redMiddle.id]);
  const blueLeft = object('q4-blue-left', THREADS.blue, 24);
  const blueRight = object('b8-blue-right', THREADS.blue, 30);
  const redDisconnected = object('x1-red-disconnected', THREADS.red, 42);
  const objects = [
    greenTop,
    blueRight,
    redMiddle,
    redDisconnected,
    greenBase,
    blueLeft,
  ];
  return createSequenceTechnicalFixture(reverseInput ? [...objects].reverse() : objects);
}

export function createColorGroupReadyThreadFixture() {
  const greenAlpha = object('ready-green-alpha', THREADS.green, 0);
  const red = object('ready-red', THREADS.red, 6);
  const greenOmega = object('ready-green-omega', THREADS.green, 12);
  return createSequenceTechnicalFixture([red, greenOmega, greenAlpha]);
}

export function createColorGroupForcedRevisitFixture() {
  const greenBase = object('revisit-green-base-c2', THREADS.green, 0);
  const redMiddle = object('revisit-red-middle-c2', THREADS.red, 6, [greenBase.id]);
  const greenTop = object('revisit-green-top-c2', THREADS.green, 12, [redMiddle.id]);
  return createSequenceTechnicalFixture([greenTop, redMiddle, greenBase]);
}

export const HATCH_C2_TEST_THREADS = THREADS;
