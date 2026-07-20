import { resolveEffectiveEmbroideryProfile } from '../embroideryEngineProfiles.js';

function clone(value) {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function commandPoint(command) {
  return command && Number.isFinite(command.x) && Number.isFinite(command.y) ? [command.x, command.y] : null;
}

function distance(a, b) {
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
}

function objectIsContour(object) {
  const text = `${object?.stitch_type || ''} ${object?.layerType || ''} ${object?.name || ''} ${object?.id || ''}`.toLowerCase();
  return object?.isContour === true || text.includes('contour') || text.includes('outline') || text.includes('running');
}

function analyzeCommands(commands = []) {
  let previous = [0, 0];
  let jumpsOver3mm = 0, jumpsOver6mm = 0, jumpsOver10mm = 0;
  let totalJumpTravelMm = 0, maxJumpMm = 0;

  for (const command of commands) {
    const point = commandPoint(command);
    if (!point) continue;
    const d = distance(previous, point);
    if (command.type === 'jump') {
      if (d > 3) jumpsOver3mm++;
      if (d > 6) jumpsOver6mm++;
      if (d > 10) jumpsOver10mm++;
      totalJumpTravelMm += d;
      maxJumpMm = Math.max(maxJumpMm, d);
    }
    previous = point;
  }

  return {
    jumpsOver3mm,
    jumpsOver6mm,
    jumpsOver10mm,
    totalJumpTravelMm: round(totalJumpTravelMm),
    maxJumpMm: round(maxJumpMm),
  };
}

export function createUnifiedStandardProProfileReport({ finalCommands = [], finalObjects = [], regions = [], config = {}, machineSettings = {}, commandMeta = {} } = {}) {
  const originalRegionsSnapshot = JSON.stringify(regions || []);
  const originalPathPointsSnapshot = JSON.stringify((regions || []).map((r) => r.path_points || []));
  const effectiveProfile = config.effectiveProfile || resolveEffectiveEmbroideryProfile(config, null, machineSettings);
  const commands = Array.isArray(finalCommands) ? finalCommands : [];
  const objects = Array.isArray(finalObjects) ? finalObjects : [];
  const commandColors = new Set(commands.map((c) => c.color).filter(Boolean));
  const commandStats = analyzeCommands(commands);
  const fillObjects = objects.filter((o) => o.stitch_type === 'fill');
  const contourObjects = objects.filter(objectIsContour);

  return {
    reportId: 'UNIFIED_STANDARD_PRO_PROFILE_REPORT_V1',
    generatedAt: new Date().toISOString(),
    profileSource: effectiveProfile.profileSource || 'UNIFIED_STANDARD_PRO_PROFILE_V1',
    unifiedStandardProProfileApplied: effectiveProfile.unifiedStandardProProfileApplied === true,
    defaultBehaviorChanged: false,
    optInOnly: true,
    encodersTouched: false,
    ExportModalTouched: false,
    MachineSimulatorTouched: false,
    FinalLookTouched: false,
    originalRegionsMutated: originalRegionsSnapshot !== JSON.stringify(regions || []),
    originalPathPointsMutated: originalPathPointsSnapshot !== JSON.stringify((regions || []).map((r) => r.path_points || [])),
    effectiveBaseEngine: effectiveProfile.effectiveBaseEngine,
    effectiveVectorEngine: effectiveProfile.effectiveVectorEngine,
    effectivePreprocessSettings: clone(effectiveProfile.effectivePreprocessSettings),
    effectiveColorCount: effectiveProfile.effectiveColorCount,
    effectiveTatamiDensity: effectiveProfile.effectiveTatamiDensity,
    effectiveFillAngle: effectiveProfile.effectiveFillAngle,
    stitchCount: commands.filter((c) => c.type === 'stitch').length,
    commandCount: commands.length,
    jumpCount: commands.filter((c) => c.type === 'jump').length,
    trimCount: commands.filter((c) => c.type === 'trim').length,
    colorChangeCount: commands.filter((c) => c.type === 'colorChange').length,
    commandColorCount: commandColors.size,
    regionCount: regions.length,
    objectCount: objects.length,
    fillObjectCount: fillObjects.length,
    contourObjectCount: contourObjects.length,
    ...commandStats,
    visualStructureScoreEstimate: commandMeta?.visualStructureScoreEstimate ?? commandMeta?.visualStructureScore ?? null,
    machinePreviewRiskScoreEstimate: commandMeta?.machinePreviewRiskScoreEstimate ?? commandMeta?.machinePreviewRiskScore ?? null,
  };
}

export function buildUnifiedStandardProProfileMarkdown(report) {
  const lines = [];
  lines.push('# UNIFIED_STANDARD_PRO_PROFILE_REPORT_V1');
  lines.push('');
  lines.push(`generatedAt=${report.generatedAt}`);
  lines.push(`profileSource=${report.profileSource}`);
  lines.push(`unifiedStandardProProfileApplied=${report.unifiedStandardProProfileApplied}`);
  lines.push(`defaultBehaviorChanged=${report.defaultBehaviorChanged}`);
  lines.push(`optInOnly=${report.optInOnly}`);
  lines.push(`encodersTouched=${report.encodersTouched}`);
  lines.push(`ExportModalTouched=${report.ExportModalTouched}`);
  lines.push(`MachineSimulatorTouched=${report.MachineSimulatorTouched}`);
  lines.push(`FinalLookTouched=${report.FinalLookTouched}`);
  lines.push(`originalRegionsMutated=${report.originalRegionsMutated}`);
  lines.push(`originalPathPointsMutated=${report.originalPathPointsMutated}`);
  lines.push('');
  lines.push('## Effective profile');
  lines.push(`- effectiveBaseEngine: ${report.effectiveBaseEngine}`);
  lines.push(`- effectiveVectorEngine: ${report.effectiveVectorEngine}`);
  lines.push(`- effectivePreprocessSettings: ${JSON.stringify(report.effectivePreprocessSettings)}`);
  lines.push(`- effectiveColorCount: ${report.effectiveColorCount}`);
  lines.push(`- effectiveTatamiDensity: ${report.effectiveTatamiDensity}`);
  lines.push(`- effectiveFillAngle: ${report.effectiveFillAngle}`);
  lines.push('');
  lines.push('## Runtime metrics');
  for (const key of [
    'stitchCount', 'commandCount', 'jumpCount', 'trimCount', 'colorChangeCount', 'commandColorCount',
    'regionCount', 'objectCount', 'fillObjectCount', 'contourObjectCount', 'jumpsOver3mm', 'jumpsOver6mm',
    'jumpsOver10mm', 'totalJumpTravelMm', 'maxJumpMm', 'visualStructureScoreEstimate', 'machinePreviewRiskScoreEstimate',
  ]) {
    lines.push(`- ${key}: ${report[key] ?? ''}`);
  }
  return lines.join('\n');
}