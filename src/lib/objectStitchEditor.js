export const TECHNIQUES = ['auto','tatami','satin','zigzag','running_stitch','triple_running','contour_satin','boundary_only','no_fill'];
export const TECHNIQUE_LABELS = { auto:'Auto',tatami:'Tatami',satin:'Satin',zigzag:'Zigzag',running_stitch:'Running stitch',triple_running:'Triple running',contour_satin:'Contour satin',boundary_only:'Boundary only',no_fill:'No fill / omitido' };
export const DEFAULT_PARAMETERS = { spacing:0.4,stitchLength:2.5,angle:0,borderInset:0.4,compensation:0.2,rowPattern:'alternado',passes:1,underlay:true,underlayType:'edge_run',underlaySpacing:1.2,width:3,density:0.4,widthLimit:8,splitWideColumns:true,direction:'forward',closePath:true };
const pointsOf = (raw) => raw.points || raw.contour || raw.polygon || raw.path || raw.boundary || [];
const boundsOf = (raw, points) => {
  if (raw.bounds) return { minX:raw.bounds.minX ?? raw.bounds.x ?? 0,minY:raw.bounds.minY ?? raw.bounds.y ?? 0,maxX:raw.bounds.maxX ?? (raw.bounds.x ?? 0)+(raw.bounds.width ?? 0),maxY:raw.bounds.maxY ?? (raw.bounds.y ?? 0)+(raw.bounds.height ?? 0) };
  if (!points.length) return { minX:raw.x||0,minY:raw.y||0,maxX:(raw.x||0)+(raw.width||10),maxY:(raw.y||0)+(raw.height||10) };
  const xs=points.map(p=>Array.isArray(p)?p[0]:p.x), ys=points.map(p=>Array.isArray(p)?p[1]:p.y);
  return { minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys) };
};
export function suggestObject(object) {
  const narrow=Math.min(object.width,object.height)<=5, small=object.area<20, contour=/contour|outline|line|borde/i.test(object.name), holes=(object.raw?.holes?.length||0)>2;
  let technique='tatami', confidence=0.78, reasons=['Región ancha y cerrada'];
  if (contour&&narrow) { technique='contour_satin'; confidence=.9; reasons=['Contorno estrecho y continuo']; }
  else if (contour) { technique='running_stitch'; confidence=.86; reasons=['Objeto lineal o de contorno']; }
  else if (narrow) { technique='satin'; confidence=.82; reasons=['Columna estrecha']; }
  else if (small) { technique='running_stitch'; confidence=.72; reasons=['Región pequeña: se evita tatami']; }
  if (holes) reasons.push('Conservar huecos; no rellenar la envolvente');
  return { technique,confidence,reasons,alternatives:technique==='tatami'?['satin','running_stitch']:['running_stitch','triple_running'] };
}
export function normalizePlan(data) {
  const source=data.objects||data.regions||data.layers||data.blocks||data.plan?.objects||data.plan?.regions||[];
  return source.map((raw,index)=>{ const points=pointsOf(raw), bounds=boundsOf(raw,points), width=bounds.maxX-bounds.minX, height=bounds.maxY-bounds.minY, area=raw.area_mm2??raw.area??Math.max(0,width*height);
    const object={ id:String(raw.id??raw.object_id??raw.region_id??`obj-${String(index+1).padStart(4,'0')}`),name:raw.name||raw.label||`Objeto ${index+1}`,color:raw.color||raw.color_hex||raw.hex||'#64748b',area,width,height,bounds,points,raw,technique:raw.technique||raw.stitch_type||'auto',manualTechnique:false,order:raw.order??index,estimatedStitches:raw.estimated_stitches??raw.stitchCount??0,estimatedJumps:raw.estimated_jumps??raw.jumpCount??0,parameters:{...DEFAULT_PARAMETERS,...(raw.parameters||raw.config)},relations:{before:'',after:'',overlapMm:0,hole:false,exclusion:false,trimFrom:''},locks:{selection:false,order:false},notes:'' };
    return {...object,proposal:suggestObject(object)}; });
}
export function applyYoshiTemplate(objects) {
  return objects.map(object=>{ const white=/white|blanco|cara|hocico|eye|ojo|belly|barriga/i.test(`${object.name} ${object.color}`), global0030=/0030$/.test(object.id), contour=/contour|outline|borde/i.test(object.name);
    if (global0030) return {...object,technique:'boundary_only',manualTechnique:false,notes:'Plantilla Yoshi: relleno global desactivado; conservar fronteras como contornos.'};
    if (white) return {...object,technique:object.technique==='auto'?'tatami':object.technique,notes:'Plantilla Yoshi: blanco visible marcado como relleno real.'};
    if (contour) return {...object,proposal:{...object.proposal,technique:object.width<=5?'satin':'running_stitch',reasons:['Detalle o contorno Yoshi']}};
    return object; });
}
export function validateObjects(objects) {
  const designArea=Math.max(1,objects.reduce((sum,o)=>sum+o.area,0));
  return objects.flatMap((o,index)=>{ const warnings=[];
    const isFill=['tatami','satin','zigzag'].includes(o.technique), overlaps=objects.filter(x=>x.id!==o.id&&Math.min(o.bounds.maxX,x.bounds.maxX)>Math.max(o.bounds.minX,x.bounds.minX)&&Math.min(o.bounds.maxY,x.bounds.maxY)>Math.max(o.bounds.minY,x.bounds.minY));
    if (o.technique==='tatami'&&index>=Math.ceil(objects.length*2/3)&&o.area/designArea>.6) warnings.push('Tatami tardío cubre más del 60% del diseño');
    if (/contour|outline|borde|band|banda/i.test(o.name)&&o.technique==='tatami') warnings.push('Objeto de contorno configurado como tatami');
    if (/white|blanco|cara|hocico|eye|ojo|belly|barriga/i.test(`${o.name} ${o.color}`)&&o.technique==='no_fill') warnings.push('Región blanca visible sin relleno');
    if (/green|verde|#0[0-9a-f]{1,3}0/i.test(`${o.name} ${o.color}`)&&isFill&&overlaps.some(x=>/white|blanco|cara|hocico|eye|ojo|belly|barriga/i.test(`${x.name} ${x.color}`))) warnings.push('Relleno verde cubre una región blanca visible');
    if (isFill&&overlaps.some(x=>(x.relations.hole||x.relations.exclusion)&&o.relations.trimFrom!==x.id)) warnings.push('Relleno invade una región marcada como hueco');
    if (isFill&&overlaps.some(x=>['tatami','satin','zigzag'].includes(x.technique)&&!x.relations.hole&&!x.relations.exclusion)) warnings.push('Dos rellenos completos se superponen');
    if ((o.parameters.spacing||1)<.25) warnings.push('Densidad excesiva');
    if ((o.parameters.passes||1)>1&&isFill) warnings.push('Más de una pasada superior completa');
    if (o.parameters.underlay&&(o.parameters.spacing||1)<.32) warnings.push('Underlay y top stitch con densidad combinada excesiva');
    if (o.estimatedJumps>0&&(o.raw.max_jump_mm||0)>5) warnings.push('Jumps largos previstos');
    if (o.area<20&&o.estimatedStitches>500) warnings.push('Objeto pequeño con demasiadas puntadas');
    return warnings.map(message=>({id:o.id,message})); });
}