import React from 'react';
import { ArrowLeft, Scissors } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import useObjectStitchEditor from '@/hooks/useObjectStitchEditor';
import ObjectEditorToolbar from '@/components/objectStitch/ObjectEditorToolbar';
import ObjectList from '@/components/objectStitch/ObjectList';
import ObjectPreviewCanvas from '@/components/objectStitch/ObjectPreviewCanvas';
import TechniqueEditor from '@/components/objectStitch/TechniqueEditor';
import RelationsEditor from '@/components/objectStitch/RelationsEditor';
import ProposalPanel from '@/components/objectStitch/ProposalPanel';
import ValidationPanel from '@/components/objectStitch/ValidationPanel';
export default function EngineV2ObjectStitchEditor() {
  const {user}=useAuth(), navigate=useNavigate(), editor=useObjectStitchEditor(user);
  return <main className="min-h-screen bg-background p-4 text-foreground md:p-6"><div className="mx-auto max-w-[1600px] space-y-4">
    <header className="flex flex-wrap items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/40 bg-primary/10"><Scissors className="h-5 w-5 text-primary"/></span><div className="min-w-0 flex-1"><h1 className="text-lg font-bold">Engine V2 Object Stitch Editor</h1><p className="text-xs text-muted-foreground">Revisión manual asistida por objeto · procesamiento local · no modifica encoders</p></div><button onClick={()=>navigate('/')} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-xs font-bold"><ArrowLeft className="h-4 w-4"/>Inicio</button></header>
    <ObjectEditorToolbar editor={editor}/>{editor.message&&<p role="status" className="text-xs text-emerald-300">{editor.message}</p>}
    {!editor.objects.length?<section className="flex min-h-[560px] items-center justify-center rounded-xl border border-dashed border-border bg-card text-center"><div><Scissors className="mx-auto h-8 w-8 text-muted-foreground"/><h2 className="mt-3 text-sm font-bold">Carga un plan Engine V2</h2><p className="mt-1 text-xs text-muted-foreground">JSON de objetos, regiones, capas o plan físico.</p></div></section>:<div className="grid gap-4 xl:grid-cols-[330px_minmax(480px,1fr)_360px]"><ObjectList objects={editor.objects} selectedId={editor.selectedId} onSelect={editor.setSelectedId} warnings={editor.warnings}/><section className="space-y-3"><label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={editor.hideOthers} onChange={e=>editor.setHideOthers(e.target.checked)} className="accent-primary"/>Mostrar solo el objeto seleccionado</label><ObjectPreviewCanvas objects={editor.previewObjects} selectedId={editor.selectedId} hideOthers={editor.hideOthers} imageUrl={editor.imageUrl} dstAnalysis={editor.dstAnalysis}/><ValidationPanel warnings={editor.warnings} selectedId={null}/></section><aside className="space-y-3"><ProposalPanel object={editor.selected} onApply={editor.update}/><TechniqueEditor object={editor.selected} onUpdate={editor.update} onParameters={editor.updateParameters}/><RelationsEditor object={editor.selected} objects={editor.objects} onUpdate={editor.update} onRelations={editor.updateRelations} onMove={editor.move}/><ValidationPanel warnings={editor.warnings} selectedId={editor.selectedId}/></aside></div>}
  </div></main>;
}