import { filterValidVisualRegions } from '../visualRegionGuard.js';
import { cleanCartoonSegmentationRegions } from '../cartoonSegmentationCleanup.js';
import { buildStitchObjects, flattenToCommands, buildFinalCommands, DEFAULT_MACHINE } from '../exportPipeline.js';
import { applyProfessionalPipeline } from '../professionalDigitizingMode.js';
import { applyStitchedTransitionToJumpGuard } from '../stitchTransitionGuard.js';

const PHASE2_METADATA_KEYS = [
  'knockoutZones',
  'excludedZones',
  'removedByKnockout',
  'qualityPhase2',
  'layerPriority',
  'skipFill',
  'skipExport',
  'hiddenByLayer',
  'disabledByComposition',
  'safeToRemove',
  'destructiveApplied',
  'exclusionPolygons',
];

const STAGE_LABELS = {
  filterValidVisualRegions: 'filterValidVisualRegions',
  cleanCartoonSegmentationRegions: 'cleanCartoonSegmentationRegions',
  buildStitchObjects: 'buildStitchObjects',
  ce01SafeFillGenerator: 'CE01 safe fill generator / flattenToCommands',
  buildFinalCommands: 'buildFinalCommands post-processing',
  professionalPipeline: 'professional pipeline',
  transitionGuard: 'transition guard',
};

function regionId(region, index = 0) {
  return region?.id || region?.regionId || `region_${index}`;
}

function isFillRegion(region = {}) {
  const stitchType = String(region.stitch_type || 'fill').toLowerCase();
  const text = `${region.type || ''} ${region.layerType || ''} ${region.region_class || ''} ${region.name || ''}`.toLowerCase();
  return stitchType === 'fill' && !/contour|outline|running/.test(text);
}

function isContourRegion(region = {}) {
  const text = `${region.type || ''} ${region.stitch_type || ''} ${region.layerType || ''} ${region.region_class || ''} ${region.name || ''}`.toLowerCase();
  return /contour|outline|running/.test(text);
}

function commandRegionId(command = {}) {
  return command.regionId || command.region_id || command.objectId || command.blockId || null;
}

function countStitches(commands = []) {
  return commands.filter((command) => command?.type === 'stitch').length;
}

function countCommandsWithoutRegionId(commands = []) {
  return commands.filter((command) => commandRegionId(command) == null).length;
}

function countStitchCommandsWithoutRegionId(commands = []) {
  return commands.filter((command) => command?.type === 'stitch' && commandRegionId(command) == null).length;
}

function countStitchesByRegion(commands = []) {
  const counts = new Map();
  for (const command of commands || []) {
    if (command?.type !== 'stitch') continue;
    const id = commandRegionId(command);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function countObjectsByRegion(objects = []) {
  const counts = new Map();
  for (const object of objects || []) {
    const id = object?.id || object?.regionId || object?.rawRegion?.id;
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function polygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area / 2);
}

function toMmPolygon(region = {}, config = {}) {
  const w = Number(config.width_mm) || 100;
  const h = Number(config.height_mm) || 100;
  const points = region.path_points || region.contour_points || [];
  if (!Array.isArray(points)) return [];
  const valid = points.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  const normalized = valid.every(([x, y]) => Math.abs(x) <= 1.5 && Math.abs(y) <= 1.5);
  return valid.map(([x, y]) => normalized ? [(x - 0.5) * w, (y - 0.5) * h] : [x, y]);
}

function expectedStitches(region, areaMm2) {
  const explicit = Number(region.expectedStitches ?? region.stitch_count ?? region.stitchCount ?? region.regionalStitchCount);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit);
  if (!isFillRegion(region)) return Math.max(0, Math.round((region.path_points?.length || 0) * 1.5));
  const density = Math.max(0.35, Math.min(1.2, Number(region.density) || 0.45));
  return Math.round(areaMm2 / density);
}

function detectPhase2Metadata(region = {}) {
  return PHASE2_METADATA_KEYS.filter((key) => {
    const value = region[key];
    if (value === undefined || value === null || value === false) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
}

function ids(regions = []) {
  return regions.map(regionId);
}

function diffIds(before = [], after = []) {
  const afterIds = new Set(ids(after));
  return ids(before).filter((id) => !afterIds.has(id));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function percent(numerator, denominator) {
  if (!denominator) return 100;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function droppedStage(flags) {
  if (flags.filter) return 'filterValidVisualRegions';
  if (flags.cleanup) return 'cleanCartoonSegmentationRegions';
  if (flags.objects) return 'buildStitchObjects';
  if (flags.raw) return 'ce01SafeFillGenerator';
  if (flags.finalBuild) return 'buildFinalCommands';
  if (flags.professional) return 'professionalPipeline';
  if (flags.guard) return 'transitionGuard';
  return '';
}

function droppedReason({ region, metadataKeys, stage, rawStitches, finalStitches, expected }) {
  if (region.visible === false) return 'region.visible=false';
  if (region.supported === false) return 'region.supported=false';
  for (const key of ['skipFill', 'skipExport', 'hiddenByLayer', 'disabledByComposition']) {
    if (region[key]) return `${key} metadata present`;
  }
  if (stage) return `dropped by ${STAGE_LABELS[stage] || stage}`;
  if (metadataKeys.length && (finalStitches === 0 || finalStitches < expected * 0.25)) return `under-generated with metadata: ${metadataKeys.join(', ')}`;
  if (isFillRegion(region) && rawStitches === 0 && expected > 0) return 'CE01 safe fill produced zero stitches';
  if (expected > 0 && finalStitches < expected * 0.25) return 'under-generated below 25% of expected stitches';
  return '';
}

function pushStageDrop(droppedByStage, stage, id) {
  if (!stage) return;
  if (!Array.isArray(droppedByStage[stage])) return;
  droppedByStage[stage].push(id);
}

export function runRegionToCommandCoverageAudit({
  regions = [],
  config = {},
  machineSettings = {},
  finalCommands = null,
  finalObjects = null,
  simulationCommands = null,
  finalLookCommands = null,
  exportCommands = null,
  darkStroke = null,
  commandSourceLabel = 'finalEmbroideryCommands',
} = {}) {
  const inputRegions = Array.isArray(regions) ? regions : [];
  const ms = { ...DEFAULT_MACHINE, ...machineSettings };

  const visualRegions = filterValidVisualRegions(inputRegions);
  const cleanup = cleanCartoonSegmentationRegions(visualRegions, config);
  const cleanedRegions = cleanup?.regions || visualRegions;

  const objects = buildStitchObjects(cleanedRegions, config);
  const rawCommands = flattenToCommands(objects, ms);
  const built = buildFinalCommands(cleanedRegions, config, ms);
  const builtCommands = built.commands || [];
  const builtObjects = built.objects || objects;

  let professionalCommands = builtCommands;
  let professionalObjects = builtObjects;
  let professionalReport = null;
  if (config?.professionalMode) {
    const professional = applyProfessionalPipeline({ commands: builtCommands, objects: builtObjects, regions: cleanedRegions, config, darkStroke });
    professionalCommands = professional.commands || builtCommands;
    professionalObjects = professional.objects || builtObjects;
    professionalReport = professional.report || null;
  }

  const guarded = applyStitchedTransitionToJumpGuard({
    commands: professionalCommands,
    objects: professionalObjects,
    regions: cleanedRegions,
    config,
    darkStroke,
    machineSettings: ms,
  });

  const guardedCommands = guarded.commands || professionalCommands;
  const effectiveFinalCommands = Array.isArray(finalCommands) ? finalCommands : guardedCommands;
  const effectiveFinalObjects = Array.isArray(finalObjects) ? finalObjects : professionalObjects;
  const effectiveSimulationCommands = Array.isArray(simulationCommands) ? simulationCommands : effectiveFinalCommands;
  const effectiveFinalLookCommands = Array.isArray(finalLookCommands) ? finalLookCommands : effectiveFinalCommands;
  const effectiveExportCommands = Array.isArray(exportCommands) ? exportCommands : effectiveFinalCommands;

  const visualIds = new Set(ids(visualRegions));
  const cleanupIds = new Set(ids(cleanedRegions));
  const objectCounts = countObjectsByRegion(objects);
  const rawCounts = countStitchesByRegion(rawCommands);
  const builtCounts = countStitchesByRegion(builtCommands);
  const professionalCounts = countStitchesByRegion(professionalCommands);
  const guardCounts = countStitchesByRegion(guardedCommands);
  const finalCounts = countStitchesByRegion(effectiveFinalCommands);
  const simulationCounts = countStitchesByRegion(effectiveSimulationCommands);
  const finalLookCounts = countStitchesByRegion(effectiveFinalLookCommands);
  const exportCounts = countStitchesByRegion(effectiveExportCommands);

  const droppedRegionIdsByStage = {
    filterValidVisualRegions: diffIds(inputRegions, visualRegions),
    cleanCartoonSegmentationRegions: diffIds(visualRegions, cleanedRegions),
    buildStitchObjects: ids(cleanedRegions).filter((id) => !objectCounts.has(id)),
    ce01SafeFillGenerator: [],
    buildFinalCommands: [],
    professionalPipeline: [],
    transitionGuard: [],
    finalEmbroideryCommands: [],
    MachineSimulator: [],
    FinalLookSimulator: [],
    ExportModal: [],
  };

  const regionRows = inputRegions.map((region, index) => {
    const id = regionId(region, index);
    const areaMm2 = polygonArea(toMmPolygon(region, config));
    const metadataKeys = detectPhase2Metadata(region);
    const regionalStitchCount = Number(region.stitch_count ?? region.stitchCount ?? region.regionalStitchCount ?? 0) || 0;
    const expected = expectedStitches(region, areaMm2);
    const rawStitches = rawCounts.get(id) || 0;
    const builtStitches = builtCounts.get(id) || 0;
    const professionalStitches = professionalCounts.get(id) || 0;
    const guardStitches = guardCounts.get(id) || 0;
    const finalCommandStitches = finalCounts.get(id) || 0;
    const exportCommandStitches = exportCounts.get(id) || 0;
    const stage = droppedStage({
      filter: !visualIds.has(id),
      cleanup: visualIds.has(id) && !cleanupIds.has(id),
      objects: cleanupIds.has(id) && !objectCounts.has(id),
      raw: objectCounts.has(id) && expected > 0 && rawStitches === 0,
      finalBuild: rawStitches > 0 && builtStitches === 0,
      professional: builtStitches > 0 && professionalStitches === 0,
      guard: professionalStitches > 0 && guardStitches === 0,
    });

    return {
      regionId: id,
      name: region.name || '',
      color: region.color || region.hex || '',
      stitch_type: region.stitch_type || 'fill',
      visible: region.visible !== false,
      supported: region.supported !== false,
      area_mm2: Number(areaMm2.toFixed(3)),
      path_points_count: Array.isArray(region.path_points) ? region.path_points.length : 0,
      regionalStitchCount,
      expectedStitches: expected,
      finalCommandStitches,
      exportCommandStitches,
      appearsInFinalCommands: finalCommandStitches > 0,
      appearsInSimulation: (simulationCounts.get(id) || 0) > 0,
      appearsInFinalLook: (finalLookCounts.get(id) || 0) > 0,
      appearsInExport: exportCommandStitches > 0,
      droppedReason: droppedReason({ region, metadataKeys, stage, rawStitches, finalStitches: finalCommandStitches, expected }),
      droppedByStage: stage,
      rawCommandStitches: rawStitches,
      buildFinalCommandStitches: builtStitches,
      professionalCommandStitches: professionalStitches,
      transitionGuardCommandStitches: guardStitches,
      phase2MetadataKeys: metadataKeys,
      isFill: isFillRegion(region),
      isContour: isContourRegion(region),
    };
  });

  for (const row of regionRows) {
    pushStageDrop(droppedRegionIdsByStage, row.droppedByStage, row.regionId);
    if (row.isFill && row.rawCommandStitches === 0 && row.expectedStitches > 0) droppedRegionIdsByStage.ce01SafeFillGenerator.push(row.regionId);
    if (row.rawCommandStitches > 0 && row.buildFinalCommandStitches === 0) droppedRegionIdsByStage.buildFinalCommands.push(row.regionId);
    if (row.buildFinalCommandStitches > 0 && row.professionalCommandStitches === 0) droppedRegionIdsByStage.professionalPipeline.push(row.regionId);
    if (row.professionalCommandStitches > 0 && row.transitionGuardCommandStitches === 0) droppedRegionIdsByStage.transitionGuard.push(row.regionId);
    if (!row.appearsInFinalCommands && row.expectedStitches > 0) droppedRegionIdsByStage.finalEmbroideryCommands.push(row.regionId);
    if (row.appearsInFinalCommands && !row.appearsInSimulation) droppedRegionIdsByStage.MachineSimulator.push(row.regionId);
    if (row.appearsInFinalCommands && !row.appearsInFinalLook) droppedRegionIdsByStage.FinalLookSimulator.push(row.regionId);
    if (row.appearsInFinalCommands && !row.appearsInExport) droppedRegionIdsByStage.ExportModal.push(row.regionId);
  }
  for (const key of Object.keys(droppedRegionIdsByStage)) droppedRegionIdsByStage[key] = unique(droppedRegionIdsByStage[key]);

  const fillRows = regionRows.filter((row) => row.isFill);
  const contourRows = regionRows.filter((row) => row.isContour || !row.isFill);
  const lostFillRegions = fillRows.filter((row) => row.expectedStitches > 0 && row.finalCommandStitches === 0);
  const lostContourRegions = contourRows.filter((row) => row.expectedStitches > 0 && row.finalCommandStitches === 0);
  const underGeneratedRegions = regionRows.filter((row) => row.expectedStitches >= 20 && row.finalCommandStitches < row.expectedStitches * 0.25);
  const suspiciousZeroRegions = regionRows.filter((row) => row.visible && row.path_points_count >= 3 && row.expectedStitches > 0 && row.finalCommandStitches === 0);
  const affectedRegionIds = regionRows.filter((row) => row.phase2MetadataKeys.length > 0).map((row) => row.regionId);
  const stageCounts = Object.entries(droppedRegionIdsByStage).map(([stage, idsForStage]) => ({ stage, count: idsForStage.length })).sort((a, b) => b.count - a.count);
  const primaryCoverageFailureStage = stageCounts[0]?.count ? stageCounts[0].stage : 'none';
  const secondaryCoverageFailureStage = stageCounts[1]?.count ? stageCounts[1].stage : 'none';
  const fillIds = ids(inputRegions.filter(isFillRegion));
  const contourIds = ids(inputRegions.filter(isContourRegion));
  const finalCommandStitchCount = countStitches(effectiveFinalCommands);
  const commandsWithoutRegionIdCount = countCommandsWithoutRegionId(effectiveFinalCommands);
  const stitchCommandsWithoutRegionIdCount = countStitchCommandsWithoutRegionId(effectiveFinalCommands);
  const percentStitchCommandsWithoutRegionId = finalCommandStitchCount > 0
    ? Number(((stitchCommandsWithoutRegionIdCount / finalCommandStitchCount) * 100).toFixed(2))
    : 0;

  const summary = {
    auditOnly: true,
    regionsModified: false,
    commandsModified: false,
    exportModified: false,
    totalRegions: inputRegions.length,
    visibleRegions: inputRegions.filter((region) => region.visible !== false).length,
    fillRegions: fillRows.length,
    contourRegions: contourRows.length,
    regionalStitchCountTotal: regionRows.reduce((sum, row) => sum + row.regionalStitchCount, 0),
    finalCommandCount: effectiveFinalCommands.length,
    finalCommandStitchCount,
    commandsWithoutRegionIdCount,
    stitchCommandsWithoutRegionIdCount,
    percentStitchCommandsWithoutRegionId,
    regionIdCoverageReliable: percentStitchCommandsWithoutRegionId <= 20,
    simulationCommandCount: effectiveSimulationCommands.length,
    finalLookCommandCount: effectiveFinalLookCommands.length,
    exportCommandCount: effectiveExportCommands.length,
    regionToCommandCoveragePercent: percent(regionRows.filter((row) => row.appearsInFinalCommands).length, regionRows.length),
    fillRegionCoveragePercent: percent(fillRows.filter((row) => row.appearsInFinalCommands).length, fillRows.length),
    contourRegionCoveragePercent: percent(contourRows.filter((row) => row.appearsInFinalCommands).length, contourRows.length),
    lostFillRegionsCount: lostFillRegions.length,
    lostContourRegionsCount: lostContourRegions.length,
    underGeneratedRegionsCount: underGeneratedRegions.length,
    suspiciousZeroRegionsCount: suspiciousZeroRegions.length,
    primaryCoverageFailureStage,
    secondaryCoverageFailureStage,
    phase2MetadataAffectingCommands: affectedRegionIds.length > 0 && regionRows.some((row) => row.phase2MetadataKeys.length && (row.finalCommandStitches === 0 || row.finalCommandStitches < row.expectedStitches * 0.25)),
    filterValidVisualRegionsDroppingFills: droppedRegionIdsByStage.filterValidVisualRegions.some((id) => fillIds.includes(id)),
    buildFinalCommandsDroppingFills: droppedRegionIdsByStage.buildFinalCommands.some((id) => fillIds.includes(id)),
    ce01SafeFillGeneratorDroppingFills: droppedRegionIdsByStage.ce01SafeFillGenerator.some((id) => fillIds.includes(id)),
    professionalPipelineDroppingFills: droppedRegionIdsByStage.professionalPipeline.some((id) => fillIds.includes(id)) || regionRows.some((row) => row.isFill && row.phase2MetadataKeys.includes('knockoutZones') && row.finalCommandStitches === 0),
    transitionGuardDroppingFills: droppedRegionIdsByStage.transitionGuard.some((id) => fillIds.includes(id)),
    finalLookOnlyIssue: droppedRegionIdsByStage.FinalLookSimulator.length > 0 && droppedRegionIdsByStage.finalEmbroideryCommands.length === 0,
    simulationOnlyIssue: droppedRegionIdsByStage.MachineSimulator.length > 0 && droppedRegionIdsByStage.finalEmbroideryCommands.length === 0,
    lostFillRegions: lostFillRegions.map((row) => row.regionId),
    underGeneratedRegions: underGeneratedRegions.map((row) => row.regionId),
    droppedByStage: droppedRegionIdsByStage,
    recommendedNextStep: primaryCoverageFailureStage === 'ce01SafeFillGenerator'
      ? 'Inspect CE01 safe fill zero-output regions and residual knockout/exclusion metadata before applying any fix.'
      : primaryCoverageFailureStage === 'professionalPipeline'
        ? 'Audit professional pipeline metadata effects before enabling any command-generation fix.'
        : primaryCoverageFailureStage === 'FinalLookSimulator' || primaryCoverageFailureStage === 'MachineSimulator'
          ? 'Treat as visual consumer issue; command generation appears covered.'
          : 'Use this report to choose the narrowest non-export command-generation fix.',
  };

  const finalIds = new Set([...finalCounts.keys()]);
  const stageCounters = {
    inputRegionCount: inputRegions.length,
    afterFilterValidVisualRegionsCount: visualRegions.length,
    afterCartoonCleanupCount: cleanedRegions.length,
    buildFinalCommandsObjectCount: effectiveFinalObjects.length,
    buildFinalCommandsCommandCount: effectiveFinalCommands.length,
    fillRegionCountIn: fillIds.length,
    fillRegionCountOut: fillRows.filter((row) => finalIds.has(row.regionId)).length,
    contourRegionCountIn: contourIds.length,
    contourRegionCountOut: contourRows.filter((row) => finalIds.has(row.regionId)).length,
    droppedRegionIdsByStage,
  };

  return {
    generatedAt: new Date().toISOString(),
    auditOnly: true,
    commandSourceLabel,
    summary,
    stageCounters,
    regions: regionRows,
    phase2MetadataAffectingCommands: summary.phase2MetadataAffectingCommands,
    affectedRegionIds,
    professionalReport,
    transitionGuardReport: guarded.report || null,
    cleanupReport: cleanup?.report || null,
  };
}

function markdownValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  return String(value);
}

export function buildRegionToCommandCoverageAuditMarkdown(audit) {
  const a = audit || runRegionToCommandCoverageAudit();
  const lines = [];
  const summaryKeys = [
    'auditOnly', 'regionsModified', 'commandsModified', 'exportModified', 'totalRegions', 'visibleRegions', 'fillRegions', 'contourRegions',
    'regionalStitchCountTotal', 'finalCommandCount', 'finalCommandStitchCount', 'commandsWithoutRegionIdCount', 'stitchCommandsWithoutRegionIdCount',
    'percentStitchCommandsWithoutRegionId', 'regionIdCoverageReliable', 'simulationCommandCount', 'finalLookCommandCount', 'exportCommandCount',
    'regionToCommandCoveragePercent', 'fillRegionCoveragePercent', 'contourRegionCoveragePercent', 'lostFillRegionsCount', 'lostContourRegionsCount',
    'underGeneratedRegionsCount', 'suspiciousZeroRegionsCount', 'primaryCoverageFailureStage', 'secondaryCoverageFailureStage',
    'phase2MetadataAffectingCommands', 'filterValidVisualRegionsDroppingFills', 'buildFinalCommandsDroppingFills', 'ce01SafeFillGeneratorDroppingFills',
    'professionalPipelineDroppingFills', 'transitionGuardDroppingFills', 'finalLookOnlyIssue', 'simulationOnlyIssue', 'lostFillRegions',
    'underGeneratedRegions', 'droppedByStage', 'recommendedNextStep',
  ];

  lines.push('# QUALITY_PHASE_2B_REGION_TO_FINAL_COMMAND_COVERAGE_AUDIT_REPORT_V1');
  lines.push('');
  lines.push(`generatedAt=${a.generatedAt}`);
  lines.push(`commandSourceLabel=${a.commandSourceLabel}`);
  lines.push('');
  lines.push('## Required Summary');
  for (const key of summaryKeys) lines.push(`- ${key}=${markdownValue(a.summary?.[key])}`);
  lines.push('');
  lines.push('## Stage Counters');
  for (const [key, value] of Object.entries(a.stageCounters || {})) lines.push(`- ${key}=${markdownValue(value)}`);
  lines.push('');
  lines.push('## Phase 2 Metadata');
  lines.push(`- phase2MetadataAffectingCommands=${a.phase2MetadataAffectingCommands === true}`);
  lines.push(`- affectedRegionIds=${JSON.stringify(a.affectedRegionIds || [])}`);
  lines.push('');
  lines.push('## Per Region Coverage');
  lines.push('| regionId | name | color | stitch_type | visible | supported | area_mm2 | path_points_count | regionalStitchCount | expectedStitches | finalCommandStitches | exportCommandStitches | appearsInFinalCommands | appearsInSimulation | appearsInFinalLook | appearsInExport | droppedByStage | droppedReason | phase2MetadataKeys |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|');
  for (const row of a.regions || []) {
    lines.push(`| ${row.regionId} | ${row.name} | ${row.color} | ${row.stitch_type} | ${row.visible} | ${row.supported} | ${row.area_mm2} | ${row.path_points_count} | ${row.regionalStitchCount} | ${row.expectedStitches} | ${row.finalCommandStitches} | ${row.exportCommandStitches} | ${row.appearsInFinalCommands} | ${row.appearsInSimulation} | ${row.appearsInFinalLook} | ${row.appearsInExport} | ${row.droppedByStage || ''} | ${row.droppedReason || ''} | ${(row.phase2MetadataKeys || []).join(', ')} |`);
  }
  lines.push('');
  lines.push('## Audit Guarantees');
  lines.push('- auditOnly=true');
  lines.push('- regionsModified=false');
  lines.push('- commandsModified=false');
  lines.push('- exportModified=false');
  lines.push('- dstDsbEncodersTouched=false');
  return lines.join('\n');
}

export function downloadRegionToCommandCoverageAudit(audit, filename = 'QUALITY_PHASE_2B_REGION_TO_FINAL_COMMAND_COVERAGE_AUDIT_REPORT_V1.md') {
  const markdown = buildRegionToCommandCoverageAuditMarkdown(audit);
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return markdown;
}

export default runRegionToCommandCoverageAudit;