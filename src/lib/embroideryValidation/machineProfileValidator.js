import { getMachineProfile } from './machineProfiles';

export function validateMachineProfile(commands = [], regions = [], config = {}, profileName = 'GENERIC_MACHINE') {
  const profile = getMachineProfile(profileName);
  const errors = [];
  const warnings = [];
  let stitches = 0, jumps = 0, trims = 0, colorChanges = 0;
  let longStitches = 0, longJumps = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let prev = null;

  for (const c of commands || []) {
    if (!c || !c.type) continue;
    if (c.type === 'stitch' || c.type === 'jump') {
      if (Number.isFinite(c.x) && Number.isFinite(c.y)) {
        if (prev) {
          const d = Math.hypot(c.x - prev.x, c.y - prev.y);
          if (c.type === 'stitch' && d > profile.maxStitchMm) longStitches++;
          if (c.type === 'jump' && d > profile.maxJumpMm) longJumps++;
        }
        prev = { x: c.x, y: c.y };
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
      }
    }
    if (c.type === 'stitch') stitches++;
    if (c.type === 'jump') jumps++;
    if (c.type === 'trim') trims++;
    if (c.type === 'colorChange') colorChanges++;
  }

  const width = Number.isFinite(minX) ? maxX - minX : 0;
  const height = Number.isFinite(minY) ? maxY - minY : 0;
  if (width > profile.hoopSize[0] || height > profile.hoopSize[1]) errors.push(issue('hoopMismatch', `Diseño ${width.toFixed(1)}×${height.toFixed(1)}mm no encaja en bastidor ${profile.hoopSize[0]}×${profile.hoopSize[1]}mm.`));
  if (stitches > profile.stitchHighRisk) warnings.push(issue('veryLargeDesign', `${stitches} puntadas — riesgo alto, no INVALID automático sin rechazo real.`));
  else if (stitches > profile.stitchWarning) warnings.push(issue('largeDesign', `${stitches} puntadas — diseño grande, advertencia no bloqueante.`));
  if (trims > profile.trimWarning) warnings.push(issue('manyTrims', `${trims} trims — revisar eficiencia.`));
  if (jumps > profile.jumpWarning) warnings.push(issue('manyJumps', `${jumps} saltos — revisar pathing.`));
  if (colorChanges + 1 > profile.maxColorsWarning) warnings.push(issue('manyColors', `${colorChanges + 1} colores — revisar cambios de hilo.`));
  if (longStitches > 0) warnings.push(issue('longStitches', `${longStitches} puntadas largas — revisar tensión/hilo.`));
  if (longJumps > 0) warnings.push(issue('longJumps', `${longJumps} saltos largos — revisar trims.`));

  const status = errors.length ? 'INVALID' : warnings.length > 3 ? 'RISKY' : warnings.length ? 'WARNING' : 'VALID';
  return { validator: 'MACHINE_PROFILE_VALIDATOR', profile: profile.id, status, exportAllowed: status !== 'INVALID', score: status === 'INVALID' ? 0 : Math.max(55, 100 - warnings.length * 8), errors, warnings, metrics: { stitches, jumps, trims, colors: colorChanges + 1, widthMm: +width.toFixed(2), heightMm: +height.toFixed(2) } };
}

function issue(type, message) { return { type, message }; }