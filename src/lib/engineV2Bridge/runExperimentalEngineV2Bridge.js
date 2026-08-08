import { runEngineV2InternalPipeline } from '../engineV2/index.js';
import { adaptBase44ProjectToEngineV2Input } from './base44ProjectToEngineV2Input.js';
import { experimentalEngineV2Base44Bridge } from './featureFlags.js';

const BRIDGE_DISABLED_RESULT = Object.freeze({
  version: 'p9-f2-experimental-engine-v2-bridge',
  valid: false,
  status: 'disabled',
  enabled: false,
  reasonCode: 'EXPERIMENTAL_ENGINE_V2_BASE44_BRIDGE_DISABLED',
});

export function runExperimentalEngineV2Bridge({
  regions,
  config,
  enabled = experimentalEngineV2Base44Bridge,
} = {}) {
  if (enabled !== true) return BRIDGE_DISABLED_RESULT;

  const engineInput = adaptBase44ProjectToEngineV2Input({ regions, config });
  return runEngineV2InternalPipeline(engineInput);
}
