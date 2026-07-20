import { useCallback, useEffect, useRef, useState } from 'react';

const idleState = { status: 'idle', slow: false };
const perfEnabled = import.meta.env.DEV && globalThis.__STITCHPATH_TECH_TOOL_PERF__ !== false;
const perfLog = (name, event, detail) => {
  if (perfEnabled) console.debug(`[technical-tool:${name}] ${event}`, detail || '');
};

export default function useTechnicalToolLauncher(loaders) {
  const [tools, setTools] = useState({});
  const runtime = useRef({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(runtime.current).forEach((entry) => clearTimeout(entry.timer));
    };
  }, []);

  const update = useCallback((name, value) => {
    if (mounted.current) setTools((current) => ({ ...current, [name]: value }));
  }, []);

  const preload = useCallback((name) => {
    const entry = runtime.current[name];
    if (entry?.status === 'loading') return entry.promise;
    return loaders[name]().catch((error) => console.debug(`[technical-tool:${name}] preload failed`, error?.message));
  }, [loaders]);

  const open = useCallback((name, execute) => {
    const previous = runtime.current[name];
    if (previous?.status === 'loading' || previous?.status === 'ready') return previous.promise;
    const requestId = (previous?.requestId || 0) + 1;
    const startedAt = performance.now();
    perfLog(name, previous?.status === 'error' ? 'reintento' : 'inicio de apertura');
    const entry = { status: 'loading', requestId, startedAt, promise: null, timer: null };
    runtime.current[name] = entry;
    update(name, { status: 'loading', slow: false });
    entry.timer = window.setTimeout(() => {
      if (runtime.current[name]?.requestId === requestId) update(name, { status: 'loading', slow: true });
    }, 6000);
    let moduleLoaded = false;
    const isCurrent = () => mounted.current && runtime.current[name]?.requestId === requestId;
    entry.promise = loaders[name]().then(async (module) => {
      moduleLoaded = true;
      if (!isCurrent()) return;
      perfLog(name, 'módulo cargado');
      await execute(module, isCurrent);
      if (!isCurrent()) return;
      entry.status = 'ready';
      update(name, { status: 'ready', slow: false });
      perfLog(name, 'herramienta lista', { durationMs: Math.round(performance.now() - startedAt) });
    }).catch((error) => {
      if (runtime.current[name]?.requestId !== requestId) return;
      entry.status = 'error';
      const phase = moduleLoaded ? 'ejecución' : 'importación';
      console.error(`[technical-tool:${name}] fallo de ${phase}`, error);
      update(name, { status: 'error', slow: false });
      perfLog(name, `fallo de ${phase}`, { durationMs: Math.round(performance.now() - startedAt) });
    }).finally(() => clearTimeout(entry.timer));
    return entry.promise;
  }, [loaders, update]);

  const close = useCallback((name) => {
    const entry = runtime.current[name];
    if (entry?.status === 'loading') perfLog(name, 'cierre durante carga');
    clearTimeout(entry?.timer);
    runtime.current[name] = { status: 'idle', requestId: (entry?.requestId || 0) + 1 };
    update(name, idleState);
  }, [update]);

  return { tools, open, close, preload };
}