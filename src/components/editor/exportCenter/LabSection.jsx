/**
 * LabSection.jsx — UI_EXPORT_CENTER_CLEANUP_V1
 * ─────────────────────────────────────────────────────────────────────────────
 * Sección plegable para el modo Laboratorio del centro de exportación.
 * En modo Simple estas secciones no se renderizan (se ocultan por uiMode).
 * Solo organización visual — no cambia lógica.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function LabSection({ title, icon: Icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#1e2130] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#0d0f14] hover:bg-[#12141d] transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
        {Icon && <Icon className="w-3.5 h-3.5 text-cyan-400" />}
        <span className="text-xs font-bold text-slate-300">{title}</span>
        <span className="ml-auto text-[10px] text-slate-600">Laboratorio</span>
      </button>
      {open && <div className="p-3 space-y-3 bg-[#10131b]">{children}</div>}
    </div>
  );
}