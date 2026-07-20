const POINT_COMMANDS = new Set(['stitch', 'jump']);
const VALID_COMMANDS = new Set(['stitch', 'jump', 'trim', 'colorChange', 'end']);

export function validateUniversalEmbroidery(commands = [], regions = [], config = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const cmds = Array.isArray(commands) ? commands : [];
  const allowEncoderAppendedEnd = options.allowEncoderAppendedEnd !== false;
  const maxUniversalDistanceMm = options.maxUniversalDistanceMm || 121;

  if (cmds.length === 0) errors.push(reason('emptyCommands', 'commands vacío — no hay datos exportables.'));

  let stitches = 0, jumps = 0, trims = 0, colorChanges = 0;
  let endCount = 0;
  let endIndex = -1;
  let prevPoint = null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (!c || !VALID_COMMANDS.has(c.type)) {
      errors.push(reason('invalidCommandSequence', `Comando inválido en índice ${i}.`));
      continue;
    }
    if (endIndex >= 0 && i > endIndex) errors.push(reason('commandsAfterEnd', `Comando después de END en índice ${i}.`));
    if (c.type === 'end') { endCount++; if (endIndex < 0) endIndex = i; continue; }
    if (POINT_COMMANDS.has(c.type)) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) {
        errors.push(reason('invalidCoordinates', `${c.type} sin coordenadas válidas en índice ${i}.`));
        continue;
      }
      if (prevPoint) {
        const d = Math.hypot(c.x - prevPoint.x, c.y - prevPoint.y);
        if (d > maxUniversalDistanceMm) errors.push(reason('impossibleDistance', `${c.type} con distancia imposible (${d.toFixed(2)}mm) en índice ${i}.`));
      }
      prevPoint = { x: c.x, y: c.y };
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
    if (c.type === 'stitch') stitches++;
    if (c.type === 'jump') jumps++;
    if (c.type === 'trim') trims++;
    if (c.type === 'colorChange') colorChanges++;
  }

  if (endCount === 0) {
    const msg = 'END faltante en comandos previos al encoder; el encoder debe añadirlo antes de escribir el archivo.';
    if (allowEncoderAppendedEnd) warnings.push(reason('missingEndBeforeEncoding', msg));
    else errors.push(reason('missingEnd', msg));
  }
  if (endCount > 1) errors.push(reason('duplicateEnd', `END duplicado (${endCount}).`));

  const width = Number(config.width_mm || config.width || 100);
  const height = Number(config.height_mm || config.height || 100);
  const designW = Number.isFinite(minX) ? maxX - minX : 0;
  const designH = Number.isFinite(minY) ? maxY - minY : 0;
  if (designW > width || designH > height) errors.push(reason('designOutsideDeclaredArea', `Diseño ${designW.toFixed(1)}×${designH.toFixed(1)}mm fuera del área declarada ${width}×${height}mm.`));

  if (stitches > 50000) warnings.push(reason('veryHighStitchCount', `${stitches} puntadas — riesgo alto, no INVALID automático sin corrupción o rechazo real.`));
  else if (stitches > 35000) warnings.push(reason('highStitchCount', `${stitches} puntadas — revisar rendimiento, no bloqueante.`));

  const status = errors.length ? 'INVALID' : warnings.length ? 'WARNING' : 'VALID';
  return { validator: 'UNIVERSAL_EMBROIDERY_VALIDATOR', status, exportAllowed: status !== 'INVALID', score: score(status, warnings.length), errors, warnings, metrics: { stitches, jumps, trims, colorChanges, widthMm: +designW.toFixed(2), heightMm: +designH.toFixed(2) } };
}

function reason(type, message) { return { type, message }; }
function score(status, warningCount) { if (status === 'INVALID') return 0; return Math.max(70, 100 - warningCount * 5); }