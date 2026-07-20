import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
function FileButton({label,accept,onFile}) { return <label className="cursor-pointer rounded-md border border-border bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground hover:text-foreground focus-within:ring-2 focus-within:ring-ring">{label}<input className="sr-only" type="file" accept={accept} onChange={e=>e.target.files?.[0]&&onFile(e.target.files[0])}/></label>; }
export default function ObjectEditorToolbar({editor}) {
  return <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
    <FileButton label="Cargar plan JSON" accept=".json,application/json" onFile={editor.loadPlan}/>
    <FileButton label="Imagen opcional" accept="image/*" onFile={editor.loadImage}/>
    <FileButton label="Config anterior" accept=".json,application/json" onFile={editor.applyConfig}/>
    <FileButton label="DST referencia" accept=".dst" onFile={editor.loadDst}/>
    <FileButton label="Importar overrides" accept=".json,application/json" onFile={editor.applyConfig}/>
    <button onClick={editor.regenerate} disabled={!editor.objects.length} className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-primary/50 px-3 text-xs font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw className="h-4 w-4"/>Regenerar preview</button>
    <button onClick={editor.exportJson} disabled={!editor.objects.length} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-4 w-4"/>Exportar Stitch Overrides JSON</button>
  </div>;
}