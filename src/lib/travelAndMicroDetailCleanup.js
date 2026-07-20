const REPORT_ID = 'TRAVEL_AND_MICRO_DETAIL_CLEANUP_V1';
const REPORT_FILENAME = 'TRAVEL_AND_MICRO_DETAIL_CLEANUP_REPORT_V1.md';
const MICRO_AREA_MM2 = 1.25;
const SMALL_AREA_MM2 = 4.0;
const SAME_COLOR_MERGE_RADIUS_MM = 2.4;
const TRAVEL_TRIM_THRESHOLD_MM = 3.5;
const MAX_CONNECTOR_JUMP_MM = 9.8;

export function shouldApplyTravelAndMicroDetailCleanup(config = {}) {
  return config.travelAndMicroDetailCleanup === true &&
    config.universalAutoDigitizerPro === true &&
    config.unifiedStandardProProfile === true;
}

function requestedUnifiedStandardProProfile(config = {}) {
  const requested = config.effectiveProfile?.requestedProfile?.unifiedStandardProProfile;
  if (requested != null) return requested === true;
  return config.unifiedStandardProProfile === true ||
    config.profile_id === 'unified_standard_pro' ||
    config.profileId === 'unified_standard_pro' ||
    config.engineProfileId === 'unified_standard_pro';
}

function requestedFlag(config = {}, key) {
  const requested = config.effectiveProfile?.requestedProfile?.[key];
  return requested != null ? requested === true : config[key] === true;
}

function buildActivationLossTrace({ requestedTravelCleanup, effectiveTravelCleanup, requestedUnifiedStandardProProfile, effectiveUnifiedStandardProProfile, requestedUniversalAutoDigitizerPro, effectiveUniversalAutoDigitizerPro, gateEnabled, hasProfileResolver }) {
  const trace = {
    UI: 'ok',
    profileResolver: 'ok',
    EditorState: 'ok',
    exportPipeline: 'ok',
    finalEmbroideryCommandsMeta: 'pending',
  };
  const lostAt = [];

  if (!requestedTravelCleanup) { trace.UI = 'travelAndMicroDetailCleanup=false'; lostAt.push('UI'); }
  if (!requestedUnifiedStandardProProfile) { trace.UI = trace.UI === 'ok' ? 'unifiedStandardProProfile=false' : `${trace.UI}; unifiedStandardProProfile=false`; lostAt.push('UI'); }
  if (!requestedUniversalAutoDigitizerPro) { trace.UI = trace.UI === 'ok' ? 'universalAutoDigitizerPro=false' : `${trace.UI}; universalAutoDigitizerPro=false`; lostAt.push('UI'); }

  if (requestedTravelCleanup && !effectiveTravelCleanup) { trace.EditorState = 'travelAndMicroDetailCleanup lost before export config'; lostAt.push(hasProfileResolver ? 'profile resolver' : 'Editor state'); }
  if (requestedUnifiedStandardProProfile && !effectiveUnifiedStandardProProfile) { trace.profileResolver = 'unifiedStandardProProfile lost or not resolved'; lostAt.push('profile resolver'); }
  if (requestedUniversalAutoDigitizerPro && !effectiveUniversalAutoDigitizerPro) { trace.profileResolver = 'universalAutoDigitizerPro lost or overridden'; lostAt.push('profile resolver'); }

  if (effectiveTravelCleanup && effectiveUnifiedStandardProProfile && effectiveUniversalAutoDigitizerPro && !gateEnabled) {
    trace.exportPipeline = 'effective flags true but gate disabled';
    lostAt.push('export pipeline');
  }

  trace.finalEmbroideryCommandsMeta = gateEnabled ? 'gate state included in meta report' : 'gate-disabled state included in meta report';
  return { trace, lostAt: [...new Set(lostAt)] };
}

export function createTravelAndMicroDetailCleanupReport(overrides = {}) {
  return {
    reportId: REPORT_ID,
    reportFilename: REPORT_FILENAME,
    generatedAt: new Date().toISOString(),
    travelCleanupApplied: false,
    gateEnabled: false,
    requestedTravelCleanup: false,
    effectiveTravelCleanup: false,
    requestedUnifiedStandardProProfile: false,
    effectiveUnifiedStandardProProfile: false,
    requestedUniversalAutoDigitizerPro: false,
    effectiveUniversalAutoDigitizerPro: false,
    requiredFlags: {
      travelAndMicroDetailCleanup: false,
      universalAutoDigitizerPro: false,
      unifiedStandardProProfile: false,
    },
    activationLostAt: [],
    activationLossTrace: {
      UI: 'unknown',
      profileResolver: 'unknown',
      EditorState: 'unknown',
      exportPipeline: 'unknown',
      finalEmbroideryCommandsMeta: 'unknown',
    },
    sameColorBlocksMerged: 0,
    microFragmentsSuppressed: 0,
    microFragmentsMerged: 0,
    trimsInsertedForTravel: 0,
    jumpCountBefore: 0,
    jumpCountAfter: 0,
    jumpsOver10mmBefore: 0,
    jumpsOver10mmAfter: 0,
    totalJumpTravelMmBefore: 0,
    totalJumpTravelMmAfter: 0,
    estimatedTravelReductionPercent: 0,
    commandBlocksReordered: 0,
    redundantContoursSuppressed: 0,
    importantBlackDetailsPreserved: 0,
    originalRegionsMutated: false,
    originalPathPointsMutated: false,
    commandsModified: false,
    encodersTouched: false,
    previewExportParityPreserved: true,
    skippedReason: null,
    ...overrides,
  };
}

function roundMetric(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function isFinitePoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function pointOf(command) {
  return command && Number.isFinite(command.x) && Number.isFinite(command.y)
    ? [command.x, command.y]
    : null;
}

function commandHasNeedlePoint(command) {
  return !!pointOf(command) && ['stitch', 'jump', 'trim'].includes(command.type);
}

function polygonArea(points = []) {
  const pts = points.filter(isFinitePoint);
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area / 2);
}

function bounds(points = []) {
  const pts = points.filter(isFinitePoint);
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
  };
}

function objectCenter(object) {
  return bounds(object?.points || [])?.center || null;
}

function objectEnd(object) {
  const points = object?.points || [];
  for (let i = points.length - 1; i >= 0; i--) {
    if (isFinitePoint(points[i])) return [points[i][0], points[i][1]];
  }
  return objectCenter(object);
}

function distance(a, b) {
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Infinity;
}

function rgb(hex = '') {
  const h = String(hex || '').replace('#', '').trim().padEnd(6, '0');
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function isDarkColor(hex) {
  const { r, g, b } = rgb(hex);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return luminance < 72 && spread < 110;
}

function objectText(object) {
  return `${object?.id || ''} ${object?.name || ''} ${object?.stitch_type || ''} ${object?.layerType || ''} ${object?.rawRegion?.name || ''} ${object?.rawRegion?.region_class || ''}`.toLowerCase();
}

function isContourObject(object) {
  const text = objectText(object);
  return object?.isContour === true ||
    text.includes('contour') ||
    text.includes('outline') ||
    text.includes('running');
}

function isImportantBlackDetail(object) {
  const text = objectText(object);
  return isDarkColor(object?.color) ||
    text.includes('eye') ||
    text.includes('mouth') ||
    text.includes('black') ||
    text.includes('dark') ||
    text.includes('outer_outline') ||
    text.includes('inner_outline');
}

function isFillLike(object) {
  const text = objectText(object);
  return object?.stitch_type === 'fill' || text.includes('fill') || text.includes('tatami');
}

function sourceKey(object) {
  const raw = object?.rawRegion || {};
  return String(
    raw.parentRegionId ||
    raw.sourceRegionId ||
    raw.parentId ||
    raw.parentGroupId ||
    raw.regionId ||
    raw.id ||
    object?.sourceRegionId ||
    object?.parentRegionId ||
    object?.id ||
    object?.name ||
    ''
  );
}

function colorKey(objectOrCommand) {
  return String(objectOrCommand?.color || '#000000').toLowerCase();
}

function cloneObject(object, index) {
  const rawRegion = object?.rawRegion ? { ...object.rawRegion } : object?.rawRegion;
  return {
    ...object,
    rawRegion,
    points: (object?.points || []).map(point => Array.isArray(point) ? [...point] : point),
    _travelCleanupOriginalIndex: index,
  };
}

function cloneCommand(command) {
  return command ? { ...command } : command;
}

function nearestSameColorAnchor(object, anchors) {
  const center = objectCenter(object);
  if (!center) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    if (colorKey(anchor) !== colorKey(object)) continue;
    if (!isFillLike(anchor) && !isFillLike(object)) continue;
    const d = distance(center, objectCenter(anchor));
    if (d < bestDistance) {
      best = anchor;
      bestDistance = d;
    }
  }
  return best && bestDistance <= SAME_COLOR_MERGE_RADIUS_MM ? best : null;
}

function reportGate(config = {}) {
  const effectiveTravelCleanup = config.travelAndMicroDetailCleanup === true;
  const effectiveUnifiedStandardProProfile = config.unifiedStandardProProfile === true;
  const effectiveUniversalAutoDigitizerPro = config.universalAutoDigitizerPro === true;
  const requestedTravelCleanup = requestedFlag(config, 'travelAndMicroDetailCleanup');
  const requestedUniversalAutoDigitizerPro = requestedFlag(config, 'universalAutoDigitizerPro');
  const requestedUnifiedStandardPro = requestedUnifiedStandardProProfile(config);
  const gateEnabled = effectiveTravelCleanup && effectiveUnifiedStandardProProfile && effectiveUniversalAutoDigitizerPro;
  const activation = buildActivationLossTrace({
    requestedTravelCleanup,
    effectiveTravelCleanup,
    requestedUnifiedStandardProProfile: requestedUnifiedStandardPro,
    effectiveUnifiedStandardProProfile,
    requestedUniversalAutoDigitizerPro,
    effectiveUniversalAutoDigitizerPro,
    gateEnabled,
    hasProfileResolver: config.profileResolverApplied === true || config.effectiveProfile?.profileResolverApplied === true,
  });

  return {
    travelAndMicroDetailCleanup: effectiveTravelCleanup,
    universalAutoDigitizerPro: effectiveUniversalAutoDigitizerPro,
    unifiedStandardProProfile: effectiveUnifiedStandardProProfile,
    requestedTravelCleanup,
    effectiveTravelCleanup,
    requestedUnifiedStandardProProfile: requestedUnifiedStandardPro,
    effectiveUnifiedStandardProProfile,
    requestedUniversalAutoDigitizerPro,
    effectiveUniversalAutoDigitizerPro,
    gateEnabled,
    activationLostAt: activation.lostAt,
    activationLossTrace: activation.trace,
  };
}

export function applyTravelAndMicroDetailCleanupToObjects(objects = [], config = {}, machineSettings = {}) {
  const gate = reportGate(config);
  const report = createTravelAndMicroDetailCleanupReport({
    gateEnabled: gate.gateEnabled,
    requestedTravelCleanup: gate.requestedTravelCleanup,
    effectiveTravelCleanup: gate.effectiveTravelCleanup,
    requestedUnifiedStandardProProfile: gate.requestedUnifiedStandardProProfile,
    effectiveUnifiedStandardProProfile: gate.effectiveUnifiedStandardProProfile,
    requestedUniversalAutoDigitizerPro: gate.requestedUniversalAutoDigitizerPro,
    effectiveUniversalAutoDigitizerPro: gate.effectiveUniversalAutoDigitizerPro,
    requiredFlags: {
      travelAndMicroDetailCleanup: gate.travelAndMicroDetailCleanup,
      universalAutoDigitizerPro: gate.universalAutoDigitizerPro,
      unifiedStandardProProfile: gate.unifiedStandardProProfile,
    },
    activationLostAt: gate.activationLostAt,
    activationLossTrace: gate.activationLossTrace,
  });
  if (!report.gateEnabled) {
    report.skippedReason = 'requires travelAndMicroDetailCleanup + universalAutoDigitizerPro + unifiedStandardProProfile';
    return { objects, report };
  }

  const sourceObjects = Array.isArray(objects) ? objects : [];
  const sorted = sourceObjects.map(cloneObject);
  const kept = [];
  const contourSeen = new Map();
  const maxMicroArea = Number(config.travelCleanupMicroAreaMm2) || MICRO_AREA_MM2;
  const maxSmallArea = Number(config.travelCleanupSmallAreaMm2) || SMALL_AREA_MM2;

  for (const object of sorted) {
    const area = polygonArea(object.points || []);
    const center = objectCenter(object);
    const importantBlack = isImportantBlackDetail(object);
    if (importantBlack) report.importantBlackDetailsPreserved++;

    const contourKey = `${colorKey(object)}:${sourceKey(object)}:${object.layerType || ''}`;
    if (isContourObject(object) && !importantBlack) {
      const previous = contourSeen.get(contourKey);
      if (previous && distance(center, objectCenter(previous)) <= SAME_COLOR_MERGE_RADIUS_MM) {
        report.redundantContoursSuppressed++;
        report.microFragmentsSuppressed++;
        continue;
      }
      contourSeen.set(contourKey, object);
    }

    if (!importantBlack && area > 0 && area <= maxMicroArea) {
      const anchor = nearestSameColorAnchor(object, kept);
      if (anchor) {
        const anchorKey = sourceKey(anchor) || anchor.id;
        object.rawRegion = {
          ...(object.rawRegion || {}),
          parentRegionId: anchorKey,
          mergedIntoRegionId: anchor.id,
          travelAndMicroDetailCleanupMerged: true,
        };
        object.priority = Math.min(object.priority || 50, anchor.priority || 50);
        kept.push(object);
        report.microFragmentsMerged++;
        report.sameColorBlocksMerged++;
      } else {
        report.microFragmentsSuppressed++;
      }
      continue;
    }

    if (!importantBlack && area > 0 && area <= maxSmallArea) {
      const anchor = nearestSameColorAnchor(object, kept);
      if (anchor) {
        object.rawRegion = {
          ...(object.rawRegion || {}),
          parentRegionId: sourceKey(anchor) || anchor.id,
          travelAndMicroDetailCleanupMerged: true,
        };
        object.priority = Math.min(object.priority || 50, anchor.priority || 50);
        report.sameColorBlocksMerged++;
      }
    }

    kept.push(object);
  }

  report.travelCleanupApplied = report.sameColorBlocksMerged > 0 ||
    report.microFragmentsSuppressed > 0 ||
    report.microFragmentsMerged > 0 ||
    report.redundantContoursSuppressed > 0;
  report.objectsBefore = sourceObjects.length;
  report.objectsAfter = kept.length;
  report.machineMaxJumpLengthMm = Number(machineSettings.maxJumpLength) || null;
  return { objects: kept, report };
}

export function commandTravelMetrics(commands = []) {
  let cursor = [0, 0];
  let hasCursor = true;
  let jumpCount = 0;
  let jumpsOver10mm = 0;
  let totalJumpTravelMm = 0;

  for (const command of commands || []) {
    const point = pointOf(command);
    if (!point) continue;
    if (command.type === 'jump') {
      const d = hasCursor ? distance(cursor, point) : 0;
      jumpCount++;
      totalJumpTravelMm += Number.isFinite(d) ? d : 0;
      if (d > 10) jumpsOver10mm++;
    }
    if (commandHasNeedlePoint(command) || command.type === 'colorChange') {
      cursor = point;
      hasCursor = true;
    }
  }

  return {
    jumpCount,
    jumpsOver10mm,
    totalJumpTravelMm: roundMetric(totalJumpTravelMm),
  };
}

function commandRouteKey(command) {
  return String(
    command?.regionId ||
    command?.objectId ||
    command?.blockId ||
    command?.sourceObjectId ||
    ''
  );
}

function buildObjectIndex(objects = []) {
  const index = new Map();
  for (const object of objects || []) {
    if (!object?.id) continue;
    index.set(String(object.id), {
      id: object.id,
      sourceKey: sourceKey(object),
      isContour: isContourObject(object),
      isFill: isFillLike(object),
    });
  }
  return index;
}

function finalizeBlock(block, objectIndex) {
  if (!block) return null;
  const firstStitchIndex = block.commands.findIndex(command => command?.type === 'stitch' && pointOf(command));
  const firstNeedleIndex = block.commands.findIndex(commandHasNeedlePoint);
  const entryIndex = firstStitchIndex >= 0 ? firstStitchIndex : firstNeedleIndex;
  if (entryIndex < 0) return null;
  const commands = block.commands.slice(entryIndex).map(cloneCommand);
  const entry = pointOf(commands[0]);
  let exit = entry;
  for (let i = commands.length - 1; i >= 0; i--) {
    const point = pointOf(commands[i]);
    if (point) {
      exit = point;
      break;
    }
  }
  const meta = objectIndex.get(block.key) || {};
  return {
    ...block,
    commands,
    entry,
    exit,
    color: block.color,
    sourceKey: meta.sourceKey || block.key,
    isContour: meta.isContour === true,
    isFill: meta.isFill === true,
  };
}

function splitBlocks(commands = [], objectIndex = new Map()) {
  const blocks = [];
  let current = null;
  let fallbackId = 0;

  const push = () => {
    const block = finalizeBlock(current, objectIndex);
    if (block) blocks.push(block);
    current = null;
  };

  for (const command of commands || []) {
    if (!command || command.type === 'colorChange' || command.type === 'end') continue;
    const key = commandRouteKey(command) || current?.key || `misc:${fallbackId}`;
    const startsNew = current && key !== current.key && command.type !== 'trim';
    if (!current || startsNew) {
      push();
      current = {
        key,
        color: command.color || current?.color || '#000000',
        commands: [],
        originalIndex: blocks.length,
      };
    }
    current.commands.push(command);
    if (!commandRouteKey(command)) fallbackId++;
  }
  push();
  return blocks;
}

function splitColorGroups(commands = []) {
  const groups = [];
  let current = { colorChange: null, commands: [] };
  let endCommand = null;
  for (const command of commands || []) {
    if (command?.type === 'end') {
      endCommand = command;
      continue;
    }
    if (command?.type === 'colorChange') {
      if (current.colorChange || current.commands.length > 0) groups.push(current);
      current = { colorChange: command, commands: [] };
      continue;
    }
    current.commands.push(command);
  }
  if (current.colorChange || current.commands.length > 0) groups.push(current);
  return { groups, endCommand };
}

function orderBlocks(blocks = [], start = [0, 0]) {
  const remaining = [...blocks];
  const ordered = [];
  let cursor = start;
  let previous = null;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const d = distance(cursor, candidate.entry);
      const pairBonus = previous?.sourceKey &&
        previous.sourceKey === candidate.sourceKey &&
        ((previous.isFill && candidate.isContour) || (previous.isContour && candidate.isFill));
      const score = pairBonus ? d * 0.55 : d;
      if (score < bestScore || (score === bestScore && candidate.originalIndex < remaining[bestIndex].originalIndex)) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    ordered.push(next);
    cursor = next.exit || cursor;
    previous = next;
  }
  return ordered;
}

function appendConnector(output, cursor, target, template, machineSettings = {}) {
  if (!cursor || !target) return { cursor: target || cursor || [0, 0], trimsInserted: 0 };
  const d = distance(cursor, target);
  if (!Number.isFinite(d) || d <= 0.5) return { cursor, trimsInserted: 0 };
  const maxJump = Math.min(
    Number(machineSettings.maxJumpLength) || MAX_CONNECTOR_JUMP_MM,
    MAX_CONNECTOR_JUMP_MM
  );
  const last = output[output.length - 1];
  let trimsInserted = 0;
  if (d > TRAVEL_TRIM_THRESHOLD_MM && last?.type !== 'trim' && last?.type !== 'colorChange') {
    output.push({
      type: 'trim',
      x: cursor[0],
      y: cursor[1],
      color: template.color,
      regionId: template.regionId,
      objectId: template.objectId,
      blockId: template.blockId,
      source: 'travel_and_micro_detail_cleanup',
      generatedBy: REPORT_ID,
    });
    trimsInserted++;
  }
  const steps = Math.max(1, Math.ceil(d / maxJump));
  for (let step = 1; step <= steps; step++) {
    output.push({
      type: 'jump',
      x: cursor[0] + (target[0] - cursor[0]) * step / steps,
      y: cursor[1] + (target[1] - cursor[1]) * step / steps,
      color: template.color,
      regionId: template.regionId,
      objectId: template.objectId,
      blockId: template.blockId,
      source: 'travel_and_micro_detail_cleanup',
      generatedBy: REPORT_ID,
    });
  }
  return { cursor: target, trimsInserted };
}

function lastNeedlePoint(commands = [], fallback = [0, 0]) {
  for (let i = commands.length - 1; i >= 0; i--) {
    const point = pointOf(commands[i]);
    if (point) return point;
  }
  return fallback;
}

function countType(commands = [], type) {
  return (commands || []).filter(command => command?.type === type).length;
}

export function applyTravelAndMicroDetailCleanupToCommands(commands = [], objects = [], config = {}, machineSettings = {}, baseReport = null) {
  const gate = reportGate(config);
  const report = {
    ...createTravelAndMicroDetailCleanupReport({
      gateEnabled: gate.gateEnabled,
      requestedTravelCleanup: gate.requestedTravelCleanup,
      effectiveTravelCleanup: gate.effectiveTravelCleanup,
      requestedUnifiedStandardProProfile: gate.requestedUnifiedStandardProProfile,
      effectiveUnifiedStandardProProfile: gate.effectiveUnifiedStandardProProfile,
      requestedUniversalAutoDigitizerPro: gate.requestedUniversalAutoDigitizerPro,
      effectiveUniversalAutoDigitizerPro: gate.effectiveUniversalAutoDigitizerPro,
      requiredFlags: {
        travelAndMicroDetailCleanup: gate.travelAndMicroDetailCleanup,
        universalAutoDigitizerPro: gate.universalAutoDigitizerPro,
        unifiedStandardProProfile: gate.unifiedStandardProProfile,
      },
      activationLostAt: gate.activationLostAt,
      activationLossTrace: gate.activationLossTrace,
    }),
    ...(baseReport || {}),
    generatedAt: new Date().toISOString(),
  };
  const beforeMetrics = commandTravelMetrics(commands);
  report.jumpCountBefore = beforeMetrics.jumpCount;
  report.jumpsOver10mmBefore = beforeMetrics.jumpsOver10mm;
  report.totalJumpTravelMmBefore = beforeMetrics.totalJumpTravelMm;

  if (!report.gateEnabled || !Array.isArray(commands) || commands.length <= 2) {
    report.skippedReason = report.skippedReason || 'cleanup gate disabled or command stream empty';
    const afterMetrics = commandTravelMetrics(commands);
    report.jumpCountAfter = afterMetrics.jumpCount;
    report.jumpsOver10mmAfter = afterMetrics.jumpsOver10mm;
    report.totalJumpTravelMmAfter = afterMetrics.totalJumpTravelMm;
    return { commands, report };
  }

  const objectIndex = buildObjectIndex(objects);
  const { groups, endCommand } = splitColorGroups(commands);
  const output = [];
  let cursor = [0, 0];
  let commandBlocksReordered = 0;
  let trimsInsertedForTravel = 0;

  for (const group of groups) {
    const blocks = splitBlocks(group.commands, objectIndex);
    if (group.colorChange) {
      output.push({ ...group.colorChange, x: cursor[0], y: cursor[1] });
    }
    if (blocks.length === 0) {
      output.push(...group.commands.map(cloneCommand));
      cursor = lastNeedlePoint(group.commands, cursor);
      continue;
    }
    const ordered = blocks.length > 1 ? orderBlocks(blocks, cursor) : blocks;
    const beforeOrder = blocks.map(block => block.key).join('|');
    const afterOrder = ordered.map(block => block.key).join('|');
    if (beforeOrder !== afterOrder) commandBlocksReordered += ordered.length;

    for (const block of ordered) {
      const connector = appendConnector(output, cursor, block.entry, {
        color: block.color,
        regionId: block.key,
        objectId: block.key,
        blockId: block.key,
      }, machineSettings);
      cursor = connector.cursor;
      trimsInsertedForTravel += connector.trimsInserted;
      output.push(...block.commands);
      cursor = block.exit || lastNeedlePoint(block.commands, cursor);
    }
  }

  output.push(endCommand ? { ...endCommand, x: cursor[0], y: cursor[1] } : { type: 'end', x: cursor[0], y: cursor[1], color: null });

  const stitchCountPreserved = countType(output, 'stitch') === countType(commands, 'stitch');
  const colorChangePreserved = countType(output, 'colorChange') === countType(commands, 'colorChange');
  const afterMetrics = commandTravelMetrics(output);
  const reduction = beforeMetrics.totalJumpTravelMm - afterMetrics.totalJumpTravelMm;
  const accepted = stitchCountPreserved && colorChangePreserved && reduction >= -0.001;
  const finalCommands = accepted ? output : commands;
  const finalMetrics = accepted ? afterMetrics : commandTravelMetrics(commands);

  report.commandBlocksReordered = accepted ? commandBlocksReordered : 0;
  report.trimsInsertedForTravel = accepted ? trimsInsertedForTravel : 0;
  report.jumpCountAfter = finalMetrics.jumpCount;
  report.jumpsOver10mmAfter = finalMetrics.jumpsOver10mm;
  report.totalJumpTravelMmAfter = finalMetrics.totalJumpTravelMm;
  report.estimatedTravelReductionPercent = beforeMetrics.totalJumpTravelMm > 0
    ? roundMetric(((beforeMetrics.totalJumpTravelMm - finalMetrics.totalJumpTravelMm) / beforeMetrics.totalJumpTravelMm) * 100)
    : 0;
  report.commandsModified = accepted && (
    commandBlocksReordered > 0 ||
    trimsInsertedForTravel > 0 ||
    finalMetrics.totalJumpTravelMm < beforeMetrics.totalJumpTravelMm
  );
  report.travelCleanupApplied = report.travelCleanupApplied || report.commandsModified;
  report.skippedReason = accepted ? null : 'discarded_to_preserve_stitch_count_color_changes_or_travel';
  report.previewExportParityPreserved = true;
  return { commands: finalCommands, report };
}

export function buildTravelAndMicroDetailCleanupMarkdown(report = createTravelAndMicroDetailCleanupReport()) {
  const r = { ...createTravelAndMicroDetailCleanupReport(), ...(report || {}) };
  const lines = [];
  lines.push('# TRAVEL_AND_MICRO_DETAIL_CLEANUP_REPORT_V1');
  lines.push('');
  lines.push(`- generatedAt: ${r.generatedAt}`);
  lines.push(`- travelCleanupApplied: ${r.travelCleanupApplied}`);
  lines.push(`- gateEnabled: ${r.gateEnabled}`);
  lines.push(`- requestedTravelCleanup: ${r.requestedTravelCleanup}`);
  lines.push(`- effectiveTravelCleanup: ${r.effectiveTravelCleanup}`);
  lines.push(`- requestedUnifiedStandardProProfile: ${r.requestedUnifiedStandardProProfile}`);
  lines.push(`- effectiveUnifiedStandardProProfile: ${r.effectiveUnifiedStandardProProfile}`);
  lines.push(`- requestedUniversalAutoDigitizerPro: ${r.requestedUniversalAutoDigitizerPro}`);
  lines.push(`- effectiveUniversalAutoDigitizerPro: ${r.effectiveUniversalAutoDigitizerPro}`);
  lines.push(`- requiredFlags: ${JSON.stringify(r.requiredFlags)}`);
  lines.push(`- activationLostAt: ${JSON.stringify(r.activationLostAt || [])}`);
  lines.push(`- activationLossTrace: ${JSON.stringify(r.activationLossTrace || {})}`);
  lines.push(`- sameColorBlocksMerged: ${r.sameColorBlocksMerged}`);
  lines.push(`- microFragmentsSuppressed: ${r.microFragmentsSuppressed}`);
  lines.push(`- microFragmentsMerged: ${r.microFragmentsMerged}`);
  lines.push(`- trimsInsertedForTravel: ${r.trimsInsertedForTravel}`);
  lines.push(`- jumpCountBefore: ${r.jumpCountBefore}`);
  lines.push(`- jumpCountAfter: ${r.jumpCountAfter}`);
  lines.push(`- jumpsOver10mmBefore: ${r.jumpsOver10mmBefore}`);
  lines.push(`- jumpsOver10mmAfter: ${r.jumpsOver10mmAfter}`);
  lines.push(`- totalJumpTravelMmBefore: ${r.totalJumpTravelMmBefore}`);
  lines.push(`- totalJumpTravelMmAfter: ${r.totalJumpTravelMmAfter}`);
  lines.push(`- estimatedTravelReductionPercent: ${r.estimatedTravelReductionPercent}`);
  lines.push(`- commandBlocksReordered: ${r.commandBlocksReordered}`);
  lines.push(`- redundantContoursSuppressed: ${r.redundantContoursSuppressed}`);
  lines.push(`- importantBlackDetailsPreserved: ${r.importantBlackDetailsPreserved}`);
  lines.push(`- originalRegionsMutated: ${r.originalRegionsMutated}`);
  lines.push(`- originalPathPointsMutated: ${r.originalPathPointsMutated}`);
  lines.push(`- commandsModified: ${r.commandsModified}`);
  lines.push(`- encodersTouched: ${r.encodersTouched}`);
  lines.push(`- previewExportParityPreserved: ${r.previewExportParityPreserved}`);
  if (r.skippedReason) lines.push(`- skippedReason: ${r.skippedReason}`);
  return lines.join('\n');
}