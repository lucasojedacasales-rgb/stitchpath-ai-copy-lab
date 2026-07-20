import { validateUniversalEmbroidery } from './universalValidator';
import { validateFormatCompatibility } from './formatValidator';
import { validateMachineProfile } from './machineProfileValidator';
import { validateCE01 } from '@/lib/ce01Validator';

export const VALIDATION_MODES = ['universal', 'format', 'machine_profile', 'ce01_strict'];

export function validateEmbroideryCompatibility({ commands = [], objects = [], regions = [], config = {}, machineSettings = {}, format = 'DST', encodedBytes = null } = {}) {
  const validationMode = VALIDATION_MODES.includes(config.validationMode) ? config.validationMode : 'universal';
  const universal = validateUniversalEmbroidery(commands, regions, config, { allowEncoderAppendedEnd: true });
  const formatReport = validateFormatCompatibility(commands, format, encodedBytes);
  const machineProfileName = config.machineProfile || (validationMode === 'ce01_strict' ? 'CE01_PROFILE' : 'GENERIC_MACHINE');
  const machine = validateMachineProfile(commands, regions, config, machineProfileName);
  const ce01 = validateCE01(commands, objects, regions, config, machineSettings);

  const active = chooseActive(validationMode, universal, formatReport, machine, ce01);
  return { validationMode, active, universal, format: formatReport, machine, ce01 };
}

function chooseActive(mode, universal, formatReport, machine, ce01) {
  if (mode === 'format') return mergeReports('FORMAT_STACK', [universal, formatReport]);
  if (mode === 'machine_profile') return mergeReports('MACHINE_PROFILE_STACK', [universal, formatReport, machine]);
  if (mode === 'ce01_strict') return ce01ToUniversalStatus(ce01);
  return universal;
}

function mergeReports(validator, reports) {
  const errors = reports.flatMap(r => r.errors || r.blockingIssues || []);
  const warnings = reports.flatMap(r => r.warnings || []);
  const statuses = reports.map(r => r.status);
  const status = statuses.includes('INVALID') ? 'INVALID' : statuses.includes('RISKY') ? 'RISKY' : statuses.includes('WARNING') ? 'WARNING' : 'VALID';
  return { validator, status, exportAllowed: status !== 'INVALID', score: Math.min(...reports.map(r => r.score ?? 100)), errors, warnings, metrics: reports[0]?.metrics || {} };
}

function ce01ToUniversalStatus(ce01) {
  const status = ce01.status === 'SAFE' ? 'VALID' : ce01.status;
  return { validator: 'CE01_STRICT_VALIDATOR', status, exportAllowed: status !== 'INVALID', score: ce01.score, errors: ce01.blockingIssues || [], warnings: ce01.warnings || [], metrics: ce01.exportSummary || {} };
}