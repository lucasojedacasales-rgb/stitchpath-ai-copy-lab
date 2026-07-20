/**
 * diagnostic.worker.js — Web Worker for the Engine V2 Diagnostic Lab.
 *
 * Receives { id, name, bytes, sha256? } and returns the parsed analysis.
 * All binary parsing happens off the main thread. No external calls.
 */
import { analyzeFile, sha256Of } from '@/lib/embroidery/diagnosticParser';

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'analyze') return;
  const { id, name, bytes, sha256 } = msg;
  try {
    const hash = sha256 || (await sha256Of(bytes));
    const analysis = analyzeFile({ name, bytes, sha256: hash });
    self.postMessage({ type: 'done', id, analysis });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || 'Analysis failed', stack: error?.stack || '' });
  }
};