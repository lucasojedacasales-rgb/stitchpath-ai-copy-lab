export const LAB_TEST_NAMES = ['A_Anchuras','B_Huecos','C_Solapes','D_Técnicas','E_Tejidos','F_Escalado','G_Lettering'];
export const LAB_STATUS = {
  untested: { label: 'Sin probar', className: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  validation: { label: 'Necesita validación', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  approved: { label: 'Aprobado', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  failed: { label: 'Fallido', className: 'bg-red-500/15 text-red-300 border-red-500/30' },
};
export const RULE_STATUS = { candidate: 'Candidata', validating: 'Validando', approved: 'Aprobada', rejected: 'Rechazada' };
export const downloadJson = (name, value) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};
const splitCsv = (line) => line.match(/("[^"]*(?:""[^"]*)*"|[^,]*)(?:,|$)/g)?.map((v) => v.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
export async function parseLabImport(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith('.json')) return JSON.parse(text);
  const [header, ...rows] = text.split(/\r?\n/).filter(Boolean).map(splitCsv);
  return rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ''])));
}
export const approvedRulesExport = (rules) => ({
  schema: 'stitchpath-hatch-approved-rules', version: 1, generated_at: new Date().toISOString(),
  rules: rules.filter((r) => r.status === 'approved').map(({ rule_id, title, geometric_conditions, fabric_profile, recommendation, parameters, confidence }) => ({ ruleId: rule_id, title, conditions: geometric_conditions || {}, fabricProfile: fabric_profile || null, recommendation, parameters: parameters || {}, confidence })),
});