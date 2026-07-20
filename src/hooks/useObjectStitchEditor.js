import { useMemo, useState } from 'react';
import { analyzeFile } from '@/lib/embroidery/diagnosticParser';
import { applyYoshiTemplate, normalizePlan, validateObjects } from '@/lib/objectStitchEditor';

const readJson = async (file) => JSON.parse(await file.text());
const sha256 = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export default function useObjectStitchEditor(user) {
  const [objects,setObjects]=useState([]), [previewObjects,setPreviewObjects]=useState([]), [selectedId,setSelectedId]=useState(null);
  const [planHash,setPlanHash]=useState(''), [imageUrl,setImageUrl]=useState(null), [dstAnalysis,setDstAnalysis]=useState(null), [hideOthers,setHideOthers]=useState(false), [message,setMessage]=useState('');
  const selected=objects.find(o=>o.id===selectedId)||null, warnings=useMemo(()=>validateObjects(objects),[objects]);
  const loadPlan=async(file)=>{ const text=await file.text(), data=JSON.parse(text); let next=normalizePlan(data); if (/yoshi/i.test(`${file.name} ${data.name||''} ${data.label||''}`)) next=applyYoshiTemplate(next); setObjects(next); setPreviewObjects(next); setSelectedId(next[0]?.id||null); setPlanHash(await sha256(text)); setMessage(`${next.length} objetos cargados`); };
  const loadImage=(file)=>{ if(imageUrl) URL.revokeObjectURL(imageUrl); setImageUrl(URL.createObjectURL(file)); };
  const loadDst=async(file)=>{ const bytes=new Uint8Array(await file.arrayBuffer()); setDstAnalysis(analyzeFile({name:file.name,bytes,sha256:await sha256(`${file.name}:${bytes.length}`)})); };
  const applyConfig=async(file)=>{ const data=await readJson(file), raw=data.decisions||data.objects||[], decisions=Array.isArray(raw)?raw:Object.entries(raw).map(([id,value])=>({id,...value})); setObjects(current=>current.map(o=>{ const d=decisions.find(x=>String(x.id||x.objectId)===o.id); return d?{...o,technique:d.technique||o.technique,manualTechnique:true,parameters:{...o.parameters,...d.parameters},order:d.order??o.order,relations:{...o.relations,...(d.overlaps||d.relations),hole:d.hole??o.relations.hole},locks:{...o.locks,...d.locks},notes:d.notes??o.notes}:o; })); setMessage('Configuración importada; pulsa Regenerar preview'); };
  const update=(patch)=>setObjects(current=>current.map(o=>o.id===selectedId?{...o,...patch,manualTechnique:patch.technique?true:o.manualTechnique}:o));
  const updateParameters=(patch)=>setObjects(current=>current.map(o=>o.id===selectedId?{...o,parameters:{...o.parameters,...patch}}:o));
  const updateRelations=(patch)=>setObjects(current=>current.map(o=>o.id===selectedId?{...o,relations:{...o.relations,...patch}}:o));
  const move=(direction)=>setObjects(current=>{ const i=current.findIndex(o=>o.id===selectedId); if(i<0||current[i].locks.order) return current; const j=i+direction; if(j<0||j>=current.length||current[j].locks.order) return current; const next=[...current]; [next[i],next[j]]=[next[j],next[i]]; return next.map((o,index)=>({...o,order:index})); });
  const regenerate=()=>{ setPreviewObjects(objects); setMessage('Preview regenerado'); };
  const exportJson=()=>{ const payload={version:'1.0',planHash,decisions:objects.map(o=>({id:o.id,technique:o.technique,parameters:o.parameters,order:o.order,overlaps:o.relations,hole:o.relations.hole,locks:o.locks,notes:o.notes})),user:user?.email||user?.full_name||null,date:new Date().toISOString()}; const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})), a=document.createElement('a'); a.href=url; a.download=`engine-v2-stitch-overrides-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); URL.revokeObjectURL(url); };
  return {objects,previewObjects,selected,selectedId,setSelectedId,planHash,imageUrl,dstAnalysis,hideOthers,setHideOthers,warnings,message,loadPlan,loadImage,loadDst,applyConfig,update,updateParameters,updateRelations,move,regenerate,exportJson};
}