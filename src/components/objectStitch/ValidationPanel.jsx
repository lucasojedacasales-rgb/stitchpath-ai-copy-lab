import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
export default function ValidationPanel({warnings,selectedId}) {
  const visible=selectedId?warnings.filter(w=>w.id===selectedId):warnings;
  return <section className="rounded-lg border border-border bg-card p-3"><h2 className="mb-2 text-xs font-bold">Validaciones</h2>{visible.length===0?<p className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4"/>Sin advertencias para la selección.</p>:<ul className="space-y-2">{visible.map((w,i)=><li key={`${w.id}-${i}`} className="flex gap-2 text-[11px] text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span><b>{w.id}</b> · {w.message}</span></li>)}</ul>}</section>;
}