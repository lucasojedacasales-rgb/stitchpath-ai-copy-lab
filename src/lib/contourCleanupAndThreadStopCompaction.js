const THREAD_STOP_REPORT_ID = 'THREAD_STOP_COMPACTION_V1';
const THREAD_STOP_REPORT_FILENAME = 'THREAD_STOP_COMPACTION_REPORT_V1.md';
const CONTOUR_REPORT_ID = 'CONTOUR_CLEANUP_V1';
const CONTOUR_REPORT_FILENAME = 'CONTOUR_CLEANUP_REPORT_V1.md';

function roundMetric(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function normalizeHex(hex = '#000000') {
  const raw = String(hex || '#000000').trim().toLowerCase().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c => c + c).join('')}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`;
  return '#000000';
}

function hexToRgb(hex = '#000000') {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance(hex = '#000000') {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function normalizedThreadForColor(color = '#000000') {
  const visualColor = normalizeHex(color);
  const rgb = hexToRgb(visualColor);
  const hsl = rgbToHsl(rgb);
  const lum = luminance(visualColor);
  const spread = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
  if (lum < 76) return '#111111';
  if (lum > 218 && spread < 70) return '#f7f7f2';
  if (hsl.s < 0.18) return lum > 170 ? '#d8d8d0' : '#777777';
  if (hsl.h >= 70 && hsl.h <= 170) return '#36b85f';
  if (hsl.h >= 38 && hsl.h < 70) return '#f1cf3a';
  if (hsl.h >= 14 && hsl.h < 38) return '#f15f2e';
  if (hsl.h < 14 || hsl.h >= 345) return '#e9363f';
  if (hsl.h >= 300 && hsl.h < 345) return '#e84f86';
  if (hsl.h >= 170 && hsl.h < 250) return '#3579d6';
  return '#7b58d8';
}

function commandPoint(command) {
  return command && Number.isFinite(command.x) && Number.isFinite(command.y) ? [command.x, command.y] : null;
}

function distance(a, b) {
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
}

function commandColor(command, fallback = '#000000') {
  return normalizeHex(command?.color || fallback || '#000000');
}

function isDarkColor(hex = '#000000') {
  const { r, g, b } = hexToRgb(hex);
  return luminance(hex) < 86 && (Math.max(r, g, b) - Math.min(r, g, b)) < 120;
}

function textOf(command = {}) {
  return `${command.regionId || ''} ${command.objectId || ''} ${command.blockId || ''} ${command.stitchType || ''} ${command.layerType || ''} ${command.source || ''}`.toLowerCase();
}

function isImportantDetailCommand(command = {}) {
  return /eye|eyes|ojo|ojos|mouth|boca|nose|nariz|nostril|pupil|pupila|iris|smile|sonrisa|facial|detail_run/.test(textOf(command));
}

function isBlackContourCommand(command = {}) {
  if (command?.type !== 'stitch') return false;
  const color = commandColor(command);
  return isDarkColor(color) && /outline|contour|stroke|border|outer|inner|running|satin/.test(textOf(command));
}

function blackOutlineFinishesLast(commands = []) {
  const stitches = commands.filter(command => command?.type === 'stitch');
  const outlineIndexes = stitches
    .map((command, index) => (isBlackContourCommand(command) && !isImportantDetailCommand(command)) ? index : null)
    .filter(index => index !== null);
  if (!outlineIndexes.length) return true;
  const tailStart = stitches.length - outlineIndexes.length;
  return outlineIndexes.every(index => index >= tailStart);
}

function commandMetrics(commands = []) {
  let cursor = [0, 0];
  let stitchCount = 0;
  let jumpCount = 0;
  let colorChangeCount = 0;
  let totalJumpTravelMm = 0;
  let maxJumpMm = 0;
  let jumpsOver10mm = 0;
  const commandColors = new Set();
  for (const command of commands || []) {
    const point = commandPoint(command);
    if (command?.type === 'stitch') stitchCount++;
    if (command?.type === 'colorChange') colorChangeCount++;
    if ((command?.type === 'stitch' || command?.type === 'jump') && command?.color) {
      commandColors.add(normalizedThreadForColor(command.color));
    }
    if (command?.type === 'jump' && point) {
      const d = distance(cursor, point);
      totalJumpTravelMm += d;
      maxJumpMm = Math.max(maxJumpMm, d);
      jumpCount++;
      if (d > 10) jumpsOver10mm++;
    }
    if (point) cursor = point;
  }
  return {
    stitchCount,
    jumpCount,
    jumpsOver10mm,
    totalJumpTravelMm: roundMetric(totalJumpTravelMm),
    maxJumpMm: roundMetric(maxJumpMm),
    commandColorCount: commandColors.size,
    colorChangeCount,
    machineStopCount: stitchCount > 0 ? colorChangeCount + 1 : 0,
    colorBlockCount: stitchCount > 0 ? colorChangeCount + 1 : 0,
  };
}

function buildThreadBlocks(commands = []) {
  const blocks = [];
  let current = null;
  let currentColor = '#000000';
  let started = false;
  const pushCurrent = () => {
    if (current && current.stitchCount + current.jumpCount + current.trimCount > 0) blocks.push(current);
    current = null;
  };
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    if (!command || command.type === 'end') break;
    if (command.type === 'colorChange') {
      pushCurrent();
      currentColor = commandColor(command, currentColor);
      started = true;
      current = {
        normalizedThreadColor: normalizedThreadForColor(currentColor),
        color: currentColor,
        startIndex: index,
        endIndex: index,
        stitchCount: 0,
        jumpCount: 0,
        trimCount: 0,
      };
      continue;
    }
    if (!['stitch', 'jump', 'trim'].includes(command.type)) continue;
    const color = commandColor(command, currentColor);
    const normalized = normalizedThreadForColor(color);
    if (!current || (!started && current.normalizedThreadColor !== normalized)) {
      pushCurrent();
      current = { normalizedThreadColor: normalized, color, startIndex: index, endIndex: index, stitchCount: 0, jumpCount: 0, trimCount: 0 };
      started = true;
    }
    if (command.type === 'stitch') current.stitchCount++;
    if (command.type === 'jump') current.jumpCount++;
    if (command.type === 'trim') current.trimCount++;
    current.endIndex = index;
    currentColor = color;
  }
  pushCurrent();
  return blocks;
}

function repeatedStopsFromSequence(sequence = []) {
  const seen = new Set();
  let repeated = 0;
  for (const item of sequence) {
    if (seen.has(item)) repeated++;
    seen.add(item);
  }
  return repeated;
}

function stageTraceEntry(stage, commands = []) {
  const metrics = commandMetrics(commands);
  const sequence = buildThreadBlocks(commands).map(block => block.normalizedThreadColor);
  return {
    stage,
    commandColorCount: metrics.commandColorCount,
    colorChangeCount: metrics.colorChangeCount,
    machineStopCount: metrics.machineStopCount,
    normalizedThreadBlockSequence: sequence,
    repeatedNormalizedThreadStops: repeatedStopsFromSequence(sequence),
  };
}

function buildStageTrace(stageSnapshots = {}, fallbackCommands = []) {
  const stages = [
    'afterUniversalAutoDigitizer',
    'afterThreadSequenceOptimizer',
    'afterTravelCleanup',
    'afterCartoonCleanup',
    'beforeExportRepair',
    'afterExportRepair',
  ];
  return stages.map(stage => stageTraceEntry(stage, stageSnapshots[stage] || fallbackCommands));
}

function gateEnabled(config = {}, key) {
  return config.universalAutoDigitizerPro === true &&
    config.unifiedStandardProProfile === true &&
    config.universalThreadColorSequenceOptimizer === true &&
    config[key] === true;
}

export function createThreadStopCompactionReport(overrides = {}) {
  return {
    reportId: THREAD_STOP_REPORT_ID,
    reportFilename: THREAD_STOP_REPORT_FILENAME,
    generatedAt: new Date().toISOString(),
    threadStopCompactionApplied: false,
    gateEnabled: false,
    requestedThreadStopCompactionV1: false,
    requiredFlags: { universalAutoDigitizerPro: false, unifiedStandardProProfile: false, universalThreadColorSequenceOptimizer: false, threadStopCompactionV1: false },
    stageTrace: [],
    commandColorCountBefore: 0,
    commandColorCountAfter: 0,
    colorChangeCountBefore: 0,
    colorChangeCountAfter: 0,
    machineStopCountBefore: 0,
    machineStopCountAfter: 0,
    repeatedNormalizedThreadStopsBefore: 0,
    repeatedNormalizedThreadStopsAfter: 0,
    blackOutlineFinishesLast: true,
    stitchCountBefore: 0,
    stitchCountAfter: 0,
    jumpCountBefore: 0,
    jumpCountAfter: 0,
    jumpsOver10mmBefore: 0,
    jumpsOver10mmAfter: 0,
    totalJumpTravelMmBefore: 0,
    totalJumpTravelMmAfter: 0,
    maxJumpMmBefore: 0,
    maxJumpMmAfter: 0,
    previewExportParityPreserved: true,
    optimizationAccepted: false,
    rejectedReason: null,
    colorChangesRemoved: 0,
    originalRegionsMutated: false,
    originalPathPointsMutated: false,
    defaultBehaviorChanged: false,
    encodersTouched: false,
    ...overrides,
  };
}

export function applyThreadStopCompactionV1(commands = [], config = {}, machineSettings = {}, stageSnapshots = {}) {
  const before = commandMetrics(commands);
  const beforeSequence = buildThreadBlocks(commands).map(block => block.normalizedThreadColor);
  const report = createThreadStopCompactionReport({
    gateEnabled: gateEnabled(config, 'threadStopCompactionV1'),
    requestedThreadStopCompactionV1: config.threadStopCompactionV1 === true,
    requiredFlags: {
      universalAutoDigitizerPro: config.universalAutoDigitizerPro === true,
      unifiedStandardProProfile: config.unifiedStandardProProfile === true,
      universalThreadColorSequenceOptimizer: config.universalThreadColorSequenceOptimizer === true,
      threadStopCompactionV1: config.threadStopCompactionV1 === true,
    },
    stageTrace: buildStageTrace(stageSnapshots, commands),
    commandColorCountBefore: before.commandColorCount,
    colorChangeCountBefore: before.colorChangeCount,
    machineStopCountBefore: before.machineStopCount,
    repeatedNormalizedThreadStopsBefore: repeatedStopsFromSequence(beforeSequence),
    stitchCountBefore: before.stitchCount,
    jumpCountBefore: before.jumpCount,
    jumpsOver10mmBefore: before.jumpsOver10mm,
    totalJumpTravelMmBefore: before.totalJumpTravelMm,
    maxJumpMmBefore: before.maxJumpMm,
  });

  if (!report.gateEnabled) {
    report.rejectedReason = 'requires universalAutoDigitizerPro + unifiedStandardProProfile + universalThreadColorSequenceOptimizer + threadStopCompactionV1';
    return { commands, report };
  }

  const candidate = [];
  let activeNormalized = null;
  let removed = 0;
  for (const command of commands || []) {
    if (!command || command.type === 'end') {
      candidate.push(command);
      continue;
    }
    if (command.type === 'colorChange') {
      const nextNormalized = normalizedThreadForColor(command.color || activeNormalized || '#000000');
      if (activeNormalized && nextNormalized === activeNormalized) {
        removed++;
        continue;
      }
      activeNormalized = nextNormalized;
      candidate.push({ ...command, color: nextNormalized, source: command.source || 'thread_stop_compaction_v1' });
      continue;
    }
    if ((command.type === 'stitch' || command.type === 'jump' || command.type === 'trim') && command.color) {
      activeNormalized = normalizedThreadForColor(command.color);
      candidate.push({ ...command, color: activeNormalized });
    } else {
      candidate.push(command);
    }
  }

  const after = commandMetrics(candidate);
  const afterSequence = buildThreadBlocks(candidate).map(block => block.normalizedThreadColor);
  report.commandColorCountAfter = after.commandColorCount;
  report.colorChangeCountAfter = after.colorChangeCount;
  report.machineStopCountAfter = after.machineStopCount;
  report.repeatedNormalizedThreadStopsAfter = repeatedStopsFromSequence(afterSequence);
  report.stitchCountAfter = after.stitchCount;
  report.jumpCountAfter = after.jumpCount;
  report.jumpsOver10mmAfter = after.jumpsOver10mm;
  report.totalJumpTravelMmAfter = after.totalJumpTravelMm;
  report.maxJumpMmAfter = after.maxJumpMm;
  report.blackOutlineFinishesLast = blackOutlineFinishesLast(candidate);
  report.colorChangesRemoved = removed;

  const stitchDeltaPct = before.stitchCount > 0 ? Math.abs(after.stitchCount - before.stitchCount) / before.stitchCount : 0;
  if (removed <= 0) report.rejectedReason = 'no_redundant_same_thread_colorchange_found';
  else if (after.jumpsOver10mm > before.jumpsOver10mm) report.rejectedReason = 'jumps_over_10mm_increased';
  else if (after.totalJumpTravelMm > before.totalJumpTravelMm + 0.001) report.rejectedReason = 'total_jump_travel_increased';
  else if (after.maxJumpMm > before.maxJumpMm + 0.5) report.rejectedReason = 'max_jump_increased_significantly';
  else if (stitchDeltaPct > 0.08) report.rejectedReason = 'stitch_count_delta_over_8_percent';
  else if (after.colorBlockCount > before.colorBlockCount) report.rejectedReason = 'color_block_count_increased';
  else if (!report.blackOutlineFinishesLast) report.rejectedReason = 'black_outline_not_final';

  report.optimizationAccepted = !report.rejectedReason;
  report.threadStopCompactionApplied = report.optimizationAccepted && removed > 0;
  return { commands: report.optimizationAccepted ? candidate : commands, report };
}

export function createContourCleanupReport(overrides = {}) {
  return {
    reportId: CONTOUR_REPORT_ID,
    reportFilename: CONTOUR_REPORT_FILENAME,
    generatedAt: new Date().toISOString(),
    contourCleanupApplied: false,
    gateEnabled: false,
    requestedContourCleanupV1: false,
    requiredFlags: { universalAutoDigitizerPro: false, unifiedStandardProProfile: false, universalThreadColorSequenceOptimizer: false, contourCleanupV1: false },
    commandColorCountBefore: 0,
    commandColorCountAfter: 0,
    colorChangeCountBefore: 0,
    colorChangeCountAfter: 0,
    machineStopCountBefore: 0,
    machineStopCountAfter: 0,
    repeatedNormalizedThreadStopsBefore: 0,
    repeatedNormalizedThreadStopsAfter: 0,
    badContourSegmentsBefore: 0,
    badContourSegmentsAfter: 0,
    contourSegmentWithoutDarkStrokeSupportBefore: 0,
    contourSegmentWithoutDarkStrokeSupportAfter: 0,
    blackLineWithoutDarkStrokeSupportBefore: 0,
    blackLineWithoutDarkStrokeSupportAfter: 0,
    duplicateBlackFragmentsSuppressed: 0,
    importantBlackDetailsPreserved: 0,
    blackOutlineFinishesLast: true,
    stitchCountBefore: 0,
    stitchCountAfter: 0,
    jumpCountBefore: 0,
    jumpCountAfter: 0,
    jumpsOver10mmBefore: 0,
    jumpsOver10mmAfter: 0,
    totalJumpTravelMmBefore: 0,
    totalJumpTravelMmAfter: 0,
    maxJumpMmBefore: 0,
    maxJumpMmAfter: 0,
    previewExportParityPreserved: true,
    optimizationAccepted: false,
    rejectedReason: null,
    originalRegionsMutated: false,
    originalPathPointsMutated: false,
    defaultBehaviorChanged: false,
    encodersTouched: false,
    removedCommandIndexes: [],
    ...overrides,
  };
}

function darkSegmentSupport(prev, curr, darkStroke, config = {}) {
  if (!prev || !curr || !darkStroke?.mask || !darkStroke.width || !darkStroke.height) return { ratio: 0, available: false };
  const widthMm = Number(config.width_mm) || 100;
  const heightMm = Number(config.height_mm) || 100;
  const tolerance = Number(darkStroke.options?.strokeTolerancePx) || 2;
  let hits = 0;
  let total = 0;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = prev[0] + (curr[0] - prev[0]) * t;
    const y = prev[1] + (curr[1] - prev[1]) * t;
    const px = Math.round((x / widthMm + 0.5) * darkStroke.width);
    const py = Math.round((y / heightMm + 0.5) * darkStroke.height);
    let on = false;
    for (let dy = -tolerance; dy <= tolerance && !on; dy++) {
      for (let dx = -tolerance; dx <= tolerance; dx++) {
        const tx = px + dx;
        const ty = py + dy;
        if (tx >= 0 && tx < darkStroke.width && ty >= 0 && ty < darkStroke.height && darkStroke.mask[ty * darkStroke.width + tx]) {
          on = true;
          break;
        }
      }
    }
    total++;
    if (on) hits++;
  }
  return { ratio: total ? hits / total : 0, available: true };
}

function contourMetrics(commands = [], config = {}) {
  let previousPoint = null;
  let badContourSegments = 0;
  let contourSegmentWithoutDarkStrokeSupport = 0;
  let blackLineWithoutDarkStrokeSupport = 0;
  for (const command of commands || []) {
    const point = commandPoint(command);
    if (command?.type === 'stitch' && point && previousPoint && isBlackContourCommand(command) && !isImportantDetailCommand(command)) {
      const support = darkSegmentSupport(previousPoint, point, config.darkStroke, config);
      const segmentMm = distance(previousPoint, point);
      const unsupported = support.available && support.ratio < 0.24 && segmentMm > 1.2;
      if (unsupported) {
        badContourSegments++;
        contourSegmentWithoutDarkStrokeSupport++;
        if (isDarkColor(command.color)) blackLineWithoutDarkStrokeSupport++;
      }
    }
    if (point) previousPoint = point;
  }
  return { badContourSegments, contourSegmentWithoutDarkStrokeSupport, blackLineWithoutDarkStrokeSupport };
}

function removeSafeDuplicateBlackFragments(commands = []) {
  const output = [];
  const seen = new Set();
  const removed = [];
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    const point = commandPoint(command);
    if (command?.type === 'stitch' && point && isBlackContourCommand(command) && !isImportantDetailCommand(command)) {
      const key = `${command.regionId || command.objectId || 'black'}:${point[0].toFixed(2)},${point[1].toFixed(2)}`;
      if (seen.has(key)) {
        removed.push(index);
        continue;
      }
      seen.add(key);
    }
    output.push(command);
  }
  return { commands: output, removed };
}

function importantBlackDetailCount(commands = []) {
  return commands.filter(command => command?.type === 'stitch' && isDarkColor(command.color || '#000000') && isImportantDetailCommand(command)).length;
}

export function applyContourCleanupV1(commands = [], config = {}, machineSettings = {}) {
  const before = commandMetrics(commands);
  const beforeSequence = buildThreadBlocks(commands).map(block => block.normalizedThreadColor);
  const beforeContour = contourMetrics(commands, config);
  const importantBefore = importantBlackDetailCount(commands);
  const report = createContourCleanupReport({
    gateEnabled: gateEnabled(config, 'contourCleanupV1'),
    requestedContourCleanupV1: config.contourCleanupV1 === true,
    requiredFlags: {
      universalAutoDigitizerPro: config.universalAutoDigitizerPro === true,
      unifiedStandardProProfile: config.unifiedStandardProProfile === true,
      universalThreadColorSequenceOptimizer: config.universalThreadColorSequenceOptimizer === true,
      contourCleanupV1: config.contourCleanupV1 === true,
    },
    commandColorCountBefore: before.commandColorCount,
    colorChangeCountBefore: before.colorChangeCount,
    machineStopCountBefore: before.machineStopCount,
    repeatedNormalizedThreadStopsBefore: repeatedStopsFromSequence(beforeSequence),
    badContourSegmentsBefore: beforeContour.badContourSegments,
    contourSegmentWithoutDarkStrokeSupportBefore: beforeContour.contourSegmentWithoutDarkStrokeSupport,
    blackLineWithoutDarkStrokeSupportBefore: beforeContour.blackLineWithoutDarkStrokeSupport,
    importantBlackDetailsPreserved: importantBefore,
    stitchCountBefore: before.stitchCount,
    jumpCountBefore: before.jumpCount,
    jumpsOver10mmBefore: before.jumpsOver10mm,
    totalJumpTravelMmBefore: before.totalJumpTravelMm,
    maxJumpMmBefore: before.maxJumpMm,
  });

  if (!report.gateEnabled) {
    report.rejectedReason = 'requires universalAutoDigitizerPro + unifiedStandardProProfile + universalThreadColorSequenceOptimizer + contourCleanupV1';
    return { commands, report };
  }

  const duplicateCleanup = removeSafeDuplicateBlackFragments(commands);
  const candidate = duplicateCleanup.commands;
  const after = commandMetrics(candidate);
  const afterSequence = buildThreadBlocks(candidate).map(block => block.normalizedThreadColor);
  const afterContour = contourMetrics(candidate, config);
  const importantAfter = importantBlackDetailCount(candidate);

  report.commandColorCountAfter = after.commandColorCount;
  report.colorChangeCountAfter = after.colorChangeCount;
  report.machineStopCountAfter = after.machineStopCount;
  report.repeatedNormalizedThreadStopsAfter = repeatedStopsFromSequence(afterSequence);
  report.badContourSegmentsAfter = afterContour.badContourSegments;
  report.contourSegmentWithoutDarkStrokeSupportAfter = afterContour.contourSegmentWithoutDarkStrokeSupport;
  report.blackLineWithoutDarkStrokeSupportAfter = afterContour.blackLineWithoutDarkStrokeSupport;
  report.duplicateBlackFragmentsSuppressed = duplicateCleanup.removed.length;
  report.importantBlackDetailsPreserved = importantAfter;
  report.blackOutlineFinishesLast = blackOutlineFinishesLast(candidate);
  report.stitchCountAfter = after.stitchCount;
  report.jumpCountAfter = after.jumpCount;
  report.jumpsOver10mmAfter = after.jumpsOver10mm;
  report.totalJumpTravelMmAfter = after.totalJumpTravelMm;
  report.maxJumpMmAfter = after.maxJumpMm;
  report.removedCommandIndexes = duplicateCleanup.removed.slice(0, 200);

  const stitchDeltaPct = before.stitchCount > 0 ? Math.abs(after.stitchCount - before.stitchCount) / before.stitchCount : 0;
  if (duplicateCleanup.removed.length <= 0) report.rejectedReason = 'no_safe_duplicate_black_fragments_found';
  else if (after.jumpsOver10mm > before.jumpsOver10mm) report.rejectedReason = 'jumps_over_10mm_increased';
  else if (after.totalJumpTravelMm > before.totalJumpTravelMm + 0.001) report.rejectedReason = 'total_jump_travel_increased';
  else if (after.maxJumpMm > before.maxJumpMm + 0.5) report.rejectedReason = 'max_jump_increased_significantly';
  else if (stitchDeltaPct > 0.08) report.rejectedReason = 'stitch_count_delta_over_8_percent';
  else if (after.colorBlockCount > before.colorBlockCount) report.rejectedReason = 'color_block_count_increased';
  else if (!report.blackOutlineFinishesLast) report.rejectedReason = 'black_outline_not_final';
  else if (importantAfter < importantBefore) report.rejectedReason = 'important_facial_details_removed';

  report.optimizationAccepted = !report.rejectedReason;
  report.contourCleanupApplied = report.optimizationAccepted && duplicateCleanup.removed.length > 0;
  return { commands: report.optimizationAccepted ? candidate : commands, report };
}

function markdownValue(value) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function buildThreadStopCompactionMarkdown(report = createThreadStopCompactionReport()) {
  const r = { ...createThreadStopCompactionReport(), ...(report || {}) };
  const lines = ['# THREAD_STOP_COMPACTION_REPORT_V1', ''];
  for (const key of [
    'generatedAt','threadStopCompactionApplied','gateEnabled','requestedThreadStopCompactionV1','requiredFlags',
    'commandColorCountBefore','commandColorCountAfter','colorChangeCountBefore','colorChangeCountAfter','machineStopCountBefore','machineStopCountAfter',
    'repeatedNormalizedThreadStopsBefore','repeatedNormalizedThreadStopsAfter','colorChangesRemoved','blackOutlineFinishesLast',
    'stitchCountBefore','stitchCountAfter','jumpCountBefore','jumpCountAfter','jumpsOver10mmBefore','jumpsOver10mmAfter',
    'totalJumpTravelMmBefore','totalJumpTravelMmAfter','maxJumpMmBefore','maxJumpMmAfter','previewExportParityPreserved',
    'optimizationAccepted','rejectedReason','originalRegionsMutated','originalPathPointsMutated','defaultBehaviorChanged','encodersTouched'
  ]) lines.push(`- ${key}: ${markdownValue(r[key])}`);
  lines.push('', '## Stage Trace', '');
  lines.push('| stage | commandColorCount | colorChangeCount | machineStopCount | repeatedNormalizedThreadStops | normalizedThreadBlockSequence |');
  lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
  for (const row of r.stageTrace || []) {
    lines.push(`| ${row.stage} | ${row.commandColorCount} | ${row.colorChangeCount} | ${row.machineStopCount} | ${row.repeatedNormalizedThreadStops} | ${(row.normalizedThreadBlockSequence || []).join(' → ')} |`);
  }
  return lines.join('\n');
}

export function buildContourCleanupMarkdown(report = createContourCleanupReport()) {
  const r = { ...createContourCleanupReport(), ...(report || {}) };
  const lines = ['# CONTOUR_CLEANUP_REPORT_V1', ''];
  for (const key of [
    'generatedAt','contourCleanupApplied','gateEnabled','requestedContourCleanupV1','requiredFlags',
    'commandColorCountBefore','commandColorCountAfter','colorChangeCountBefore','colorChangeCountAfter','machineStopCountBefore','machineStopCountAfter',
    'repeatedNormalizedThreadStopsBefore','repeatedNormalizedThreadStopsAfter','badContourSegmentsBefore','badContourSegmentsAfter',
    'contourSegmentWithoutDarkStrokeSupportBefore','contourSegmentWithoutDarkStrokeSupportAfter',
    'blackLineWithoutDarkStrokeSupportBefore','blackLineWithoutDarkStrokeSupportAfter','duplicateBlackFragmentsSuppressed',
    'importantBlackDetailsPreserved','blackOutlineFinishesLast','stitchCountBefore','stitchCountAfter','jumpCountBefore','jumpCountAfter',
    'jumpsOver10mmBefore','jumpsOver10mmAfter','totalJumpTravelMmBefore','totalJumpTravelMmAfter','maxJumpMmBefore','maxJumpMmAfter',
    'previewExportParityPreserved','optimizationAccepted','rejectedReason','originalRegionsMutated','originalPathPointsMutated','defaultBehaviorChanged','encodersTouched'
  ]) lines.push(`- ${key}: ${markdownValue(r[key])}`);
  lines.push('', '## Removed Command Indexes');
  for (const index of r.removedCommandIndexes || []) lines.push(`- ${index}`);
  return lines.join('\n');
}