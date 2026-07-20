export function analyzeExportBlocking({ commands = [], format = 'DST' } = {}) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return blocked('commands_empty', 'command_source', 'COMMANDS_PRESENT', null, 'Regenera comandos finales o vuelve a procesar el diseño.');
  }

  let stitchCount = 0;
  let endCount = 0;
  let firstEndIndex = -1;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!c || !c.type) return blocked('invalid_command_object', 'command_sequence', 'COMMAND_OBJECT_VALID', i, 'Eliminar o regenerar el comando inválido.');
    if ((c.type === 'stitch' || c.type === 'jump') && (!Number.isFinite(c.x) || !Number.isFinite(c.y))) {
      return blocked('nan_or_undefined_coordinates', 'command_sequence', 'COORDINATES_FINITE', i, 'Regenerar comandos o reparar coordenadas no numéricas.');
    }
    if ((c.type === 'stitch' || c.type === 'jump') && (Math.abs(c.x) > 1000 || Math.abs(c.y) > 1000)) {
      return blocked('impossible_coordinates', 'command_sequence', 'COORDINATES_PLAUSIBLE', i, 'Revisar escala/tamaño del diseño antes de exportar.');
    }
    if (c.type === 'stitch') stitchCount++;
    if (c.type === 'end') { endCount++; if (firstEndIndex === -1) firstEndIndex = i; }
  }

  if (stitchCount === 0) return blocked('file_has_no_stitch_data', 'command_sequence', 'STITCH_DATA_PRESENT', null, 'El diseño no contiene puntadas exportables.');
  if (endCount === 0) return blocked('missing_end_command', 'command_sequence', 'END_PRESENT', null, 'Regenerar comandos finales para añadir END.');
  if (endCount > 1) return blocked('duplicate_end_command', 'command_sequence', 'END_UNIQUE', firstEndIndex, 'Eliminar END duplicado o regenerar comandos finales.');
  if (firstEndIndex !== commands.length - 1) return blocked('end_not_last', 'command_sequence', 'END_LAST', firstEndIndex, 'Regenerar comandos finales para colocar END al final.');
  if (!['DST', 'DSB', 'PES', 'JEF', 'EXP'].includes(String(format).toUpperCase())) {
    return blocked('unsupported_format', 'format', 'FORMAT_SUPPORTED', null, 'Selecciona un formato compatible.');
  }

  return {
    exportAllowed: true,
    blockingReason: 'none',
    blockingModule: 'none',
    blockingCheck: 'HARD_EXPORT_GATE',
    firstInvalidCommandIndex: null,
    unlockHint: 'No hay bloqueo técnico real. Warnings visuales, conteo de puntadas, CE01 risky o reference learning incompleto no bloquean.',
  };
}

function blocked(blockingReason, blockingModule, blockingCheck, firstInvalidCommandIndex, unlockHint) {
  return { exportAllowed: false, blockingReason, blockingModule, blockingCheck, firstInvalidCommandIndex, unlockHint };
}