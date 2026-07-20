import React, { useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { TECHNIQUE_LABELS } from '@/lib/objectStitchEditor';
const ROW=104, HEIGHT=520;
export default function ObjectList({objects,selectedId,onSelect,warnings}) {
  const [scrollTop,setScrollTop]=useState(0), start=Math.max(0,Math.floor(scrollTop/ROW)-2), count=Math.ceil(HEIGHT/ROW)+4, visible=objects.slice(start,start+count);
  return <section aria-label="Lista de objetos" className="rounded-lg border border-border bg-card">
    <div className="border-b border-border px-3 py-2 text-xs font-bold">Objetos · {objects.length}</div>
    <div className="overflow-auto" style={{height:HEIGHT}} onScroll={e=>setScrollTop(e.currentTarget.scrollTop)}>
      <div className="relative" style={{height:objects.length*ROW}}>{visible.map((o,n)=>{ const ws=warnings.filter(w=>w.id===o.id); return <button key={o.id} onClick={()=>!o.locks.selection&&onSelect(o.id)} className={`absolute left-0 flex w-full cursor-pointer gap-3 border-b border-border p-3 text-left hover:bg-secondary ${selectedId===o.id?'bg-primary/10 ring-1 ring-inset ring-primary':''}`} style={{top:(start+n)*ROW,height:ROW}}>
        <span className="h-12 w-12 shrink-0 rounded-md border border-border" style={{backgroundColor:o.color}} aria-label={`Color ${o.color}`}/>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-1 truncate text-xs font-bold">{o.locks.selection&&<Lock className="h-3 w-3"/>}{o.name}</span><span className="block truncate font-mono text-[10px] text-muted-foreground">{o.id}</span><span className="mt-1 block text-[10px] text-secondary-foreground">{TECHNIQUE_LABELS[o.technique]} · {o.area.toFixed(1)} mm² · {o.width.toFixed(1)}×{o.height.toFixed(1)}</span><span className="text-[10px] text-muted-foreground">#{o.order+1} · {o.estimatedStitches} st · {o.estimatedJumps} jumps</span></span>
        {ws.length>0&&<span title={ws.map(w=>w.message).join('\n')}><AlertTriangle className="h-4 w-4 text-amber-400"/></span>}
      </button>;})}</div>
    </div>
  </section>;
}