/**
 * getEffectiveExportCommands.js — Helper ÚNICO de selección de comandos de exportación
 * ─────────────────────────────────────────────────────────────────────────────
 * Garantiza que TODA exportación / validación de archivo real use los comandos
 * correctos según el estado del pre-export repair V5.
 *
 * Orden de prioridad (obligatorio):
 *   1. repairedCommands     si repairAccepted=true y repairedCommands.length > 0
 *   2. productionCommands   si existen y exportAllowed=true (pasar solo si exportAllowed)
 *   3. editorFinalCommands
 *   4. pipelineCommands     (pipelineResult.commands)
 *
 * Devuelve { commands, source } donde source ∈
 *   'repairedCommands' | 'productionReport.commands' | 'editorFinalCommands' | 'pipelineResult.commands'
 *
 * Registra logs [effective-export-source] para trazabilidad.
 */
export function getEffectiveExportCommands({
  repairAccepted,
  repairedCommands,
  editorFinalCommands,
  pipelineCommands,
  productionCommands,
} = {}) {
  const repaired = (repairAccepted && Array.isArray(repairedCommands) && repairedCommands.length > 0) ? repairedCommands : null;
  const production = (Array.isArray(productionCommands) && productionCommands.length > 0) ? productionCommands : null;
  const editor = (Array.isArray(editorFinalCommands) && editorFinalCommands.length > 0) ? editorFinalCommands : null;
  const pipeline = (Array.isArray(pipelineCommands) && pipelineCommands.length > 0) ? pipelineCommands : null;

  // ── Trazabilidad: candidatos disponibles ──
  console.log('[effective-export-source] candidates:', {
    repairedCommands: repaired?.length || 0,
    productionReportCommands: production?.length || 0,
    editorFinalCommands: editor?.length || 0,
    pipelineResultCommands: pipeline?.length || 0,
  });

  let commands;
  let source;

  if (repaired) {
    commands = repaired;
    source = 'repairedCommands';
  } else if (production) {
    commands = production;
    source = 'productionReport.commands';
  } else if (editor) {
    commands = editor;
    source = 'editorFinalCommands';
  } else {
    commands = pipeline || [];
    source = 'pipelineResult.commands';
  }

  console.log(`[effective-export-source] ${source}`);
  return { commands, source };
}