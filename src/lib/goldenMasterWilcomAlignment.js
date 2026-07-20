/**
 * GOLDEN_MASTER_WILCOM_ALIGNMENT helpers
 * Opt-in only utilities for reference-profile export tuning.
 */

const YOSHI_WILCOM_REFERENCE_PROFILE_ID = 'yoshi_wilcom_reference';
const GOLDEN_MASTER_MAX_JUMP_MM = 10;
const POSITION_EPSILON_MM = 0.05;

export function getGoldenMasterProfileId(config = {}, machineSettings = {}) {
  return config.goldenMasterProfileId ||
    machineSettings.goldenMasterProfileId ||
    config.referenceProfileId ||
    machineSettings.referenceProfileId ||
    null;
}

export function isGoldenMasterWilcomAlignmentEnabled(config = {}, machineSettings = {}) {
  return config.goldenMasterWilcomAlignment === true &&
    getGoldenMasterProfileId(config, machineSettings) === YOSHI_WILCOM_REFERENCE_PROFILE_ID;
}

function hasPosition(command) {
  return command && Number.isFinite(command.x) && Number.isFinite(command.y);
}

function cloneCommand(command) {
  return command ? { ...command } : command;
}

function countCommandType(commands = [], type) {
  return (commands || []).filter(command => command?.type === type).length;
}

function countUniqueCommandColors(commands = []) {
  return new Set((commands || [])
    .filter(command => command?.color && (command.type === 'stitch' || command.type === 'jump'))
    .map(command => String(command.color).toLowerCase())).size;
}

function countJumpMetrics(commands = []) {
  let previous = { x: 0, y: 0 };
  let jumpsOver10mm = 0;
  let jumpTravelDistanceMm = 0;
  let longestJumpMm = 0;

  for (const command of commands || []) {
    if (!hasPosition(command)) continue;
    if (command.type === 'jump') {
      const distance = Math.hypot(command.x - previous.x, command.y - previous.y);
      jumpTravelDistanceMm += distance;
      longestJumpMm = Math.max(longestJumpMm, distance);
      if (distance > GOLDEN_MASTER_MAX_JUMP_MM) jumpsOver10mm++;
    }
    if (command.type === 'stitch' || command.type === 'jump' || command.type === 'trim') {
      previous = { x: command.x, y: command.y };
    }
  }

  return {
    jumpsOver10mm,
    jumpTravelDistanceMm: roundMetric(jumpTravelDistanceMm),
    longestJumpMm: roundMetric(longestJumpMm),
  };
}

function roundMetric(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function dedupeStationaryTravel(commands = []) {
  const output = [];
  let previousPosition = { x: 0, y: 0 };

  for (const command of commands || []) {
    if (!hasPosition(command)) {
      output.push(cloneCommand(command));
      continue;
    }

    if (command.type === 'jump') {
      const distance = Math.hypot(command.x - previousPosition.x, command.y - previousPosition.y);
      if (distance <= POSITION_EPSILON_MM) continue;
    }

    output.push(cloneCommand(command));

    if (command.type === 'stitch' || command.type === 'jump' || command.type === 'trim') {
      previousPosition = { x: command.x, y: command.y };
    }
  }

  return output;
}

function splitLongJumpCommands(commands = [], maxJumpMm = GOLDEN_MASTER_MAX_JUMP_MM) {
  const output = [];
  let previousPosition = { x: 0, y: 0 };

  for (const command of commands || []) {
    if (command?.type === 'jump' && hasPosition(command)) {
      const distance = Math.hypot(command.x - previousPosition.x, command.y - previousPosition.y);
      if (distance > maxJumpMm) {
        const steps = Math.ceil(distance / maxJumpMm);
        for (let step = 1; step <= steps; step++) {
          output.push({
            ...command,
            x: previousPosition.x + ((command.x - previousPosition.x) * step) / steps,
            y: previousPosition.y + ((command.y - previousPosition.y) * step) / steps,
            goldenMasterTravelReduced: true,
          });
        }
        previousPosition = { x: command.x, y: command.y };
        continue;
      }
    }

    output.push(cloneCommand(command));

    if (hasPosition(command) && (command.type === 'stitch' || command.type === 'jump' || command.type === 'trim')) {
      previousPosition = { x: command.x, y: command.y };
    }
  }

  return output;
}

export function applyGoldenMasterTravelReduction(commands = [], options = {}) {
  const { config = {}, machineSettings = {}, colorCount = null, colorBlockCount = null, uniqueColorCount = null } = options;
  const profileId = getGoldenMasterProfileId(config, machineSettings);
  const enabled = isGoldenMasterWilcomAlignmentEnabled(config, machineSettings);
  const before = countJumpMetrics(commands);
  const actualColorBlockCount = Number.isFinite(colorBlockCount) ? colorBlockCount : countCommandType(commands, 'colorChange') + 1;
  const actualUniqueColorCount = Number.isFinite(uniqueColorCount) ? uniqueColorCount : countUniqueCommandColors(commands);
  const actualColorCount = Number.isFinite(colorCount) ? colorCount : actualColorBlockCount;

  if (!enabled) {
    return {
      commands,
      report: {
        goldenMasterTravelReductionApplied: false,
        goldenMasterModeRequiresExplicitFlag: true,
        goldenMasterProfileId: profileId,
        before,
        after: before,
        colorCount: actualColorCount,
        colorBlockCount: actualColorBlockCount,
        uniqueColorCount: actualUniqueColorCount,
        reason: 'goldenMasterWilcomAlignment=true with yoshi_wilcom_reference profile is required',
      },
    };
  }

  const deduped = dedupeStationaryTravel(commands);
  const reduced = splitLongJumpCommands(deduped, GOLDEN_MASTER_MAX_JUMP_MM);
  const after = countJumpMetrics(reduced);

  return {
    commands: reduced,
    report: {
      goldenMasterTravelReductionApplied: true,
      goldenMasterModeRequiresExplicitFlag: true,
      goldenMasterProfileId: profileId,
      maxJumpMm: GOLDEN_MASTER_MAX_JUMP_MM,
      before,
      after,
      colorCount: actualColorCount,
      colorBlockCount: actualColorBlockCount,
      uniqueColorCount: actualUniqueColorCount,
      jumpsOver10mmReducedBy: before.jumpsOver10mm - after.jumpsOver10mm,
      jumpTravelDistanceReducedMm: roundMetric(before.jumpTravelDistanceMm - after.jumpTravelDistanceMm),
    },
  };
}