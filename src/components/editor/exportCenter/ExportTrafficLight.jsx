/**
 * ExportTrafficLight.jsx — UI_EXPORT_CENTER_CLEANUP_V1
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloque superior tipo semáforo para el centro de exportación.
 * Verde: exportAllowed true y validación activa VALID/SAFE.
 * Amber: WARNING/RISKY pero exportable.
 * Rojo: INVALID o bloqueos restantes.
 *
 * Solo lectura: no cambia lógica de exportación.
 */
import { CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';

const LEVELS = {
  green: { bg: 'bg-emerald-900/20 border-emerald-500/40', dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Listo para exportar', Icon: CheckCircle2 },
  amber: { bg: 'bg-amber-900/20 border-amber-500/40', dot: 'bg-amber-400', text: 'text-amber-400', label: 'RISKY — exportable con precaución', Icon: AlertTriangle },
  red:   { bg: 'bg-red-900/20 border-red-500/40', dot: 'bg-red-400', text: 'text-red-400', label: 'Bloqueado — revisar errores', Icon: ShieldAlert },
};

export default function ExportTrafficLight({
  level, ce01Status, ce01Score, commandSource,
  visibleDiagonalStitches, emptyBlocks, invalidCommandSequence, regionOutsideBounds,
  jumpCount, trimCount, colorCount, exportAllowed, format,
}) {
  const L = LEVELS[level] || LEVELS.red;
  const { Icon } = L;
  return (
    <div className={`rounded-xl border p-3 ${L.bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-3 h-3 rounded-full ${L.dot} animate-pulse`} />
        <Icon className={`w-4 h-4 ${L.text}`} />
        <span className={`text-sm font-bold ${L.text}`}>{L.label}</span>
        <span className="ml-auto text-[10px] text-slate-400">Formato: <b className="text-cyan-400">{format}</b></span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-[10px]">
        <Cell label="validation" value={ce01Status} accent={ce01Status === 'SAFE' || ce01Status === 'VALID' ? 'text-emerald-400' : ce01Status === 'RISKY' || ce01Status === 'WARNING' ? 'text-amber-300' : 'text-red-400'} />
        <Cell label="score" value={ce01Score} />
        <Cell label="commandSource" value={commandSource} accent="text-cyan-400" />
        <Cell label="exportAllowed" value={exportAllowed ? 'SÍ' : 'NO'} accent={exportAllowed ? 'text-emerald-400' : 'text-red-400'} />
        <Cell label="visibleDiag" value={visibleDiagonalStitches} accent={visibleDiagonalStitches === 0 ? 'text-emerald-400' : 'text-red-400'} />
        <Cell label="emptyBlocks" value={emptyBlocks} accent={emptyBlocks === 0 ? 'text-emerald-400' : 'text-red-400'} />
        <Cell label="invalidCmd" value={invalidCommandSequence} accent={invalidCommandSequence === 0 ? 'text-emerald-400' : 'text-red-400'} />
        <Cell label="outOfBounds" value={regionOutsideBounds} accent={regionOutsideBounds === 0 ? 'text-emerald-400' : 'text-red-400'} />
        <Cell label="jumps" value={jumpCount} />
        <Cell label="trims" value={trimCount} />
        <Cell label="colors" value={colorCount} />
        <Cell label="formato" value={format} accent="text-cyan-400" />
      </div>
    </div>
  );
}

function Cell({ label, value, accent = 'text-slate-200' }) {
  return (
    <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130] flex flex-col">
      <span className="text-slate-500">{label}</span>
      <span className={`font-bold ${accent}`}>{String(value ?? '—')}</span>
    </div>
  );
}