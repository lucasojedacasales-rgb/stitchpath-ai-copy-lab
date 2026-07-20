import { runRegressionSuite } from '@/tests/runEmbroideryRegression';

self.onmessage = (event) => {
  if (event.data?.type !== 'run') return;
  try {
    const result = runRegressionSuite();
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Regression worker failed', stack: error?.stack || '' });
  }
};