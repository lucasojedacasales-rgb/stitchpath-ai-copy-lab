import { ShieldCheck, ShieldAlert } from 'lucide-react';

/**
 * Export Reality Check Panel
 * Shows the gap between what the user sees (visual regions) and what will
 * actually be exported (finalEmbroideryCommands).
 */
export default function ExportRealityCheck({ reality }) {
  if (!reality) return null;

  const { status } = reality;
  const isRisky = status === 'RISKY';

  const rows = [
    { label: 'Visual colors', value: reality.visualColors, mismatch: reality.colorMismatch },
    { label: 'Command thread blocks', value: reality.threadBlocks, mismatch: reality.colorChangeMismatch },
    { label: 'Command colors', value: reality.commandColors, mismatch: reality.colorMismatch },
    { label: 'ColorChange commands', value: reality.colorChanges, mismatch: reality.colorMismatch },
    { label: 'Expected machine color steps', value: reality.expectedMachineColors },
    { label: 'Fill objects', value: reality.fillObjects },
    { label: 'Detail objects', value: reality.detailObjects },
    { label: 'Contour objects visuales', value: reality.contourVisual, mismatch: reality.contourMismatch },
    { label: 'Contour objects exportados', value: reality.contourExported, mismatch: reality.contourMismatch },
    { label: 'Mouth visual', value: reality.mouthVisual, mismatch: reality.mouthMismatch },
    { label: 'Mouth exported', value: reality.mouthExported, mismatch: reality.mouthMismatch },
    { label: 'Color changes preserved', value: reality.colorChangesPreserved },
    // ── Contour-specific fields ──
    { label: 'Visual outer outline', value: reality.visualOuterOutline, mismatch: reality.contourMissing },
    { label: 'Exported outer outline', value: reality.exportedOuterOutline, mismatch: reality.contourMissing },
    { label: 'Outer outline stitches', value: reality.outerOutlineStitches, mismatch: reality.contourWeak },
    { label: 'Outer outline color', value: reality.outerOutlineColor || '—' },
    { label: 'Outer outline order', value: reality.outerOutlineOrder >= 0 ? reality.outerOutlineOrder : '—' },
    { label: 'Mouth stitches', value: reality.mouthStitches },
    { label: 'Inner contours exported', value: reality.innerContoursExported },
    { label: 'Inner outline stitches', value: reality.innerOutlineStitches },
    { label: 'Detail run stitches', value: reality.detailRunStitches },
  ];

  return (
    <div className={`rounded-lg border p-3 ${isRisky
      ? 'bg-amber-900/15 border-amber-500/30'
      : 'bg-emerald-900/15 border-emerald-500/30'}`}>
      <div className="flex items-center gap-2 mb-2">
        {isRisky
          ? <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          : <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
        <span className={`text-xs font-bold ${isRisky ? 'text-amber-400' : 'text-emerald-400'}`}>
          Export Reality Check — {status}
        </span>
      </div>

      {isRisky && (
        <div className="mb-2 text-[10px] text-amber-300 bg-amber-900/20 rounded px-2 py-1.5">
          ⚠ No se recomienda exportar: el diseño en máquina no coincidirá con la previsualización.
          {reality.colorMismatch && <div>• Color mismatch: el DST saldría como 1 color.</div>}
          {reality.colorChangeMismatch && <div>• ColorChange insuficientes para los bloques de color.</div>}
          {reality.contourMismatch && <div>• Contornos visuales no exportados como stitches.</div>}
          {reality.contourMissing && <div>• El contorno se ve en pantalla pero no se exporta como puntadas.</div>}
          {reality.contourWeak && <div>• Contorno exterior demasiado débil o inexistente (&lt;80 puntadas).</div>}
          {reality.mouthMismatch && <div>• Boca visible pero no exportada.</div>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">{row.label}</span>
            <span className={`font-bold ${
              row.mismatch ? 'text-amber-400'
              : typeof row.value === 'number' && row.value > 0 ? 'text-cyan-400'
              : typeof row.value === 'string' && row.value === 'YES' ? 'text-emerald-400'
              : 'text-slate-400'
            }`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}