import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';

const MESSAGES = [
  'Analizando imagen...',
  'Aplicando K-means++...',
  'Detectando regiones...',
  'Clasificando puntadas...',
  'Generando contornos...',
  'Refinando con IA...',
  'Escribiendo parámetros...',
];

export default function AIProgressIndicator({ active, elapsed }) {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setMsgIdx(i => (i + 1) % MESSAGES.length), 1800);
    return () => clearInterval(t);
  }, [active]);

  if (!active) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-900/20 border border-violet-500/20">
      <Brain className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
      <span className="text-xs text-violet-300">{MESSAGES[msgIdx]}</span>
      {elapsed > 0 && <span className="text-[10px] text-cyan-400 ml-1">({elapsed}s)</span>}
    </div>
  );
}