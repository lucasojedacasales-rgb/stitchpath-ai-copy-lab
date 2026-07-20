import { getFormatProfile } from './formatProfiles';

const POINT_COMMANDS = new Set(['stitch', 'jump']);

export function validateFormatCompatibility(commands = [], format = 'DST', encodedBytes = null) {
  const profile = getFormatProfile(format);
  const errors = [];
  const warnings = [];
  const cmds = Array.isArray(commands) ? commands : [];
  let prev = null;
  let stitches = 0, jumps = 0, trims = 0, colorChanges = 0;

  if (cmds.length === 0) errors.push(issue('emptyCommands', 'No hay comandos para codificar.'));

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (!c || !c.type) { errors.push(issue('invalidCommand', `Comando inválido en índice ${i}.`)); continue; }
    if (POINT_COMMANDS.has(c.type)) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) { errors.push(issue('coordinateOverflow', `${c.type} sin coordenadas codificables en índice ${i}.`)); continue; }
      if (prev) {
        const d = Math.hypot(c.x - prev.x, c.y - prev.y);
        if (d > profile.maxDeltaMm) errors.push(issue('deltaOverflow', `${profile.label}: ${c.type} de ${d.toFixed(2)}mm excede delta codificable ${profile.maxDeltaMm}mm.`));
      }
      prev = { x: c.x, y: c.y };
    }
    if (c.type === 'stitch') stitches++;
    if (c.type === 'jump') jumps++;
    if (c.type === 'trim') trims++;
    if (c.type === 'colorChange') colorChanges++;
  }

  if (encodedBytes?.length && encodedBytes.length > profile.maxFileBytes) warnings.push(issue('largeFile', `${profile.label}: tamaño de archivo alto (${encodedBytes.length} bytes).`));
  if (profile.future) warnings.push(issue('futureProfile', `${profile.label}: perfil futuro, validación conservadora.`));

  const status = errors.length ? 'INVALID' : warnings.length ? 'WARNING' : 'VALID';
  return { validator: 'FORMAT_VALIDATOR', profile: profile.id, status, exportAllowed: status !== 'INVALID', score: status === 'INVALID' ? 0 : Math.max(75, 100 - warnings.length * 5), errors, warnings, metrics: { stitches, jumps, trims, colorChanges } };
}

function issue(type, message) { return { type, message }; }