export const SAFE_APP_BOOT_MODE_V1 = true;
export const LIGHTWEIGHT_APP_BOOT_V1 = true;

const bootStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

export function perfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function logPerf(label, start) {
  const ms = start == null ? perfNow() - bootStart : perfNow() - start;
  const level = ms >= 1000 ? 'critical' : ms >= 500 ? 'heavy' : ms >= 100 ? 'warning' : 'ok';
  console.log(`[PERF] ${label} ms`, Number(ms.toFixed(1)), level);
  return ms;
}

export function logSafeBootStatus(scope = 'APP') {
  console.log(`[BOOT] ${scope} mounted`);
  if (SAFE_APP_BOOT_MODE_V1) {
    console.log('[BOOT] safe boot active');
    console.log('[BOOT] universal validation skipped until manual run');
    console.log('[BOOT] reference learning skipped until manual run');
  }
  if (LIGHTWEIGHT_APP_BOOT_V1) {
    console.log('[BOOT] lightweight app boot active');
    console.log('[BOOT] command analysis skipped until manual view/export');
  }
}

export function logBootError(error) {
  console.error('[BOOT ERROR]', error);
}