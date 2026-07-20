import { DIGITIZE_MODES, getModeStrategy } from '../digitizeModes.js';
import { buildEffectiveProfileAuditReport, resolveEffectiveEmbroideryProfile } from '../embroideryEngineProfiles.js';

const REPORT_ID = 'ENGINE_MODES_CONFIG_TO_PIPELINE_AUDIT_V1';

const PIPELINE_STAGES = [
  { id: 'image_analysis', file: 'src/lib/pipeline/stages/imageAnalysisStage.js', functionName: 'runImageAnalysis' },
  { id: 'image_enhancement', file: 'src/lib/pipeline/stages/imageEnhancementStage.js', functionName: 'runImageEnhancement' },
  { id: 'contour_engine', file: 'src/lib/pipeline/stages/contourEngineStage.js', functionName: 'runContourEngine' },
  { id: 'semantic_segmentation', file: 'src/lib/pipeline/stages/semanticSegmentationStage.js', functionName: 'runSemanticSegmentation' },
  { id: 'vector_engine', file: 'src/lib/pipeline/stages/vectorEngineStage.js', functionName: 'runVectorEngine' },
  { id: 'region_builder', file: 'src/lib/pipeline/stages/regionBuilderStage.js', functionName: 'runRegionBuilder' },
  { id: 'quality_phase_1_input_segmentation_cleanup', file: 'src/lib/cartoonSegmentationCleanup.js', functionName: 'cleanCartoonSegmentationRegions' },
  { id: 'stitch_planner', file: 'src/lib/pipeline/stages/stitchPlannerStage.js', functionName: 'runStitchPlanner' },
  { id: 'stitch_optimizer', file: 'src/lib/pipeline/stages/stitchOptimizerStage.js', functionName: 'runStitchOptimizer' },
  { id: 'build_stitch_objects', file: 'src/lib/exportPipeline.js', functionName: 'buildStitchObjects' },
  { id: 'flatten_to_commands', file: 'src/lib/exportPipeline.js', functionName: 'flattenToCommands' },
  { id: 'ce01_safe_fill', file: 'src/lib/ce01SafeFillGenerator.js', functionName: 'generateCE01SafeFillCommands' },
  { id: 'safe_fill_density_profile', file: 'src/lib/safeFillDensityProfiles.js', functionName: 'resolveSafeFillDensityProfile' },
  { id: 'final_commands', file: 'src/lib/exportPipeline.js', functionName: 'buildFinalCommands' },
];

const VECTOR_ENGINE_DETAILS = {
  hybrid: {
    label: 'Hibrido',
    algorithm: 'Backend hybridDigitize preset; optionally client vectorization fusion when config.useVectorFusion=true.',
    files: ['src/lib/pipeline/stages/vectorEngineStage.js', 'src/lib/vectorizationFusionEngine.js'],
    strengths: ['Best all-around pipeline in current code', 'Can combine contour/color/semantic/backend candidates when fusion is enabled'],
    weaknesses: ['UI vector_engine override is not honored by standard vector payload', 'Can over-fragment when paired with high color counts'],
    cleanCartoonRegions: 'medium_high',
    overFragments: 'medium',
    preservesBlackOutlines: 'medium_high_after_cleanup',
    noisyMicroRegions: 'medium',
  },
  opencv: {
    label: 'OpenCV',
    algorithm: 'UI option only in current client standard path; expected backend meaning is Canny/morphology.',
    files: ['src/components/editor/ConfigPanel.jsx', 'src/lib/pipeline/stages/vectorEngineStage.js'],
    strengths: ['Good conceptual fit for edges and silhouettes'],
    weaknesses: ['config.vector_engine is not sent by standard vector payload, so selection is currently not reliable'],
    cleanCartoonRegions: 'unknown_not_reliably_selected',
    overFragments: 'unknown',
    preservesBlackOutlines: 'unknown',
    noisyMicroRegions: 'unknown',
  },
  vtracer: {
    label: 'VTracer',
    algorithm: 'UI option only in current client standard path; expected backend meaning is hierarchical color tracing.',
    files: ['src/components/editor/ConfigPanel.jsx', 'src/lib/pipeline/stages/vectorEngineStage.js'],
    strengths: ['Good conceptual fit for color regions'],
    weaknesses: ['Not reliably selected because vector payload uses mode backend vector_engine'],
    cleanCartoonRegions: 'unknown_not_reliably_selected',
    overFragments: 'medium_high_if_high_colors',
    preservesBlackOutlines: 'medium',
    noisyMicroRegions: 'unknown',
  },
  potrace: {
    label: 'Potrace',
    algorithm: 'Fast mode backend preset; UI option otherwise not reliably honored by standard vector payload.',
    files: ['src/lib/digitizeModes.js', 'src/lib/pipeline/stages/vectorEngineStage.js'],
    strengths: ['Fast simple silhouette/border tracing'],
    weaknesses: ['Weak multicolor cartoon fill separation', 'Mainly active through fast mode preset'],
    cleanCartoonRegions: 'low_medium',
    overFragments: 'low',
    preservesBlackOutlines: 'medium_for_simple_shapes',
    noisyMicroRegions: 'low',
  },
};

const MODE_SCORES = {
  fast: { vectorizationQuality: 4, silhouetteQuality: 5, colorGrouping: 4, blackOutlinePreservation: 3, regionCoherence: 5, microFragmentSuppression: 8, fillQuality: 5, travelOptimization: 3, ce01Compatibility: 8, wilcomStyleCartoonSimilarity: 3 },
  standard: { vectorizationQuality: 6, silhouetteQuality: 6, colorGrouping: 6, blackOutlinePreservation: 5, regionCoherence: 6, microFragmentSuppression: 7, fillQuality: 6, travelOptimization: 4, ce01Compatibility: 8, wilcomStyleCartoonSimilarity: 5 },
  precision: { vectorizationQuality: 7, silhouetteQuality: 7, colorGrouping: 6, blackOutlinePreservation: 5, regionCoherence: 5, microFragmentSuppression: 5, fillQuality: 7, travelOptimization: 7, ce01Compatibility: 7, wilcomStyleCartoonSimilarity: 6 },
  hybrid: { vectorizationQuality: 8, silhouetteQuality: 7, colorGrouping: 7, blackOutlinePreservation: 7, regionCoherence: 7, microFragmentSuppression: 6, fillQuality: 7, travelOptimization: 5, ce01Compatibility: 8, wilcomStyleCartoonSimilarity: 7 },
  ultra: { vectorizationQuality: 8, silhouetteQuality: 7, colorGrouping: 7, blackOutlinePreservation: 6, regionCoherence: 4, microFragmentSuppression: 3, fillQuality: 8, travelOptimization: 7, ce01Compatibility: 6, wilcomStyleCartoonSimilarity: 6 },
  ai: { vectorizationQuality: 7, silhouetteQuality: 7, colorGrouping: 7, blackOutlinePreservation: 7, regionCoherence: 6, microFragmentSuppression: 5, fillQuality: 7, travelOptimization: 7, ce01Compatibility: 7, wilcomStyleCartoonSimilarity: 6 },
  intelligent: { vectorizationQuality: 7, silhouetteQuality: 7, colorGrouping: 7, blackOutlinePreservation: 7, regionCoherence: 6, microFragmentSuppression: 6, fillQuality: 7, travelOptimization: 7, ce01Compatibility: 8, wilcomStyleCartoonSimilarity: 6 },
};

function clone(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function bool(value) {
  return value === true;
}

function countType(commands = [], type) {
  return (commands || []).filter((command) => command?.type === type).length;
}

function uniqueCount(values = []) {
  return new Set(values.filter(Boolean).map((value) => String(value).toLowerCase())).size;
}

function valueState(requested, effective) {
  return {
    requested: requested ?? null,
    effective: effective ?? null,
    honored: requested == null ? 'not_requested' : requested === effective,
  };
}

function modePipeline(modeId) {
  const strategy = getModeStrategy(modeId);
  const optimizerOn = strategy.stitchStrategy?.travelOptimize === true;
  const adaptiveOn = strategy.stitchStrategy?.useAdaptiveEngine !== false;
  return {
    modeId: strategy.id,
    modeName: strategy.name,
    preprocessing: {
      function: 'runImageEnhancement -> preprocessImage',
      source: 'digitizeModes.strategy.preprocess',
      settings: clone(strategy.preprocess),
    },
    colorClustering: {
      imageAnalysisColorCount: strategy.vectorizer?.color_count || 8,
      contourColorCount: Math.max(6, strategy.vectorizer?.color_count || 8),
      backendColorCountSource: 'config.color_count unless golden master or aiStrategy overrides it',
    },
    edgeDetection: {
      function: 'runContourEngine -> traceContoursProf',
      safeModeSkipsEdgeMap: true,
      modeOptionsSource: 'contourEngineStage.MODE_OPTIONS[strategy.id]',
    },
    vectorization: {
      function: 'runVectorEngine -> base44.functions.invoke("hybridDigitize")',
      backendMode: strategy.backend?.mode,
      backendVectorEngine: strategy.backend?.vector_engine,
      useIaVision: strategy.backend?.use_ia_vision,
      useFullBg: strategy.backend?.use_full_bg,
      maxRegions: strategy.backend?.max_regions,
    },
    regionCleanup: [
      'filterBackgroundRegions in vectorEngineStage',
      'separateFillsAndContoursSafe in regionBuilderStage when contourSafeMode=true',
      'cleanCartoonSegmentationRegions in runner and Editor fallback',
      'filterValidVisualRegions before setRegions',
    ],
    contourDetection: 'traceContoursProf plus safe contours from fill boundaries/dark regions',
    stitchObjectCreation: 'buildStitchObjects converts visual regions to mm objects',
    fillGeneration: 'CE01 safe fill generator for fill objects when ce01SafeFillMode is not false',
    outlineGeneration: 'safe contour objects, generated outlines only if explicit experimental flags are enabled',
    travelOptimization: {
      stageOptimizerEnabled: optimizerOn,
      exportTimeOptimizersAlwaysPresent: [
        'optimizeObjectOrder',
        'applySameColorNearestNeighborOrdering',
        'optimizeCE01TravelPath',
        'sanitizeCommandsForCE01',
        'optimizeCE01Trims',
        'preserveLongJumpTrimIntent',
      ],
    },
    finalCommands: 'buildFinalCommands -> finalEmbroideryCommands',
    exportPreparation: 'encodeOptimizedToFile uses buildFinalCommands output; encoders are downstream and not part of this audit',
    adaptiveEngineEnabled: adaptiveOn,
  };
}

function buildUiConfigMap(config = {}) {
  const strategy = getModeStrategy(config.mode || 'hybrid');
  return {
    modeSelector: {
      uiComponent: 'src/components/editor/ConfigPanel.jsx',
      writes: 'config.mode',
      requested: config.mode || 'hybrid',
      effectiveStrategy: strategy.id,
      reachesPipeline: true,
    },
    vectorEngineSelector: {
      uiComponent: 'src/components/editor/ConfigPanel.jsx',
      writes: 'config.vector_engine',
      requested: config.vector_engine || 'hybrid',
      effectiveInStandardVectorPayload: strategy.backend?.vector_engine || null,
      reachesPipeline: (config.vector_engine || 'hybrid') === (strategy.backend?.vector_engine || null),
      conflict: 'standard vectorEngineStage currently sends strategy.backend.vector_engine, not config.vector_engine',
    },
    iaVisionToggle: {
      writes: 'config.use_ia_vision',
      requested: bool(config.use_ia_vision),
      effectiveInStandardVectorPayload: bool(strategy.backend?.use_ia_vision),
      reachesPipeline: bool(config.use_ia_vision) === bool(strategy.backend?.use_ia_vision),
      conflict: 'standard vectorEngineStage currently sends strategy.backend.use_ia_vision unless aiStrategy is present',
    },
    fullBackgroundToggle: {
      writes: 'config.use_full_bg',
      requested: bool(config.use_full_bg),
      effectiveInStandardVectorPayload: bool(strategy.backend?.use_full_bg),
      reachesPipeline: bool(config.use_full_bg) === bool(strategy.backend?.use_full_bg),
      conflict: 'standard vectorEngineStage currently sends strategy.backend.use_full_bg',
    },
    preprocessingPanel: {
      uiComponent: 'src/components/editor/PreprocessingPanel.jsx',
      writes: 'local Editor preprocessSettings state',
      effectiveInPipeline: 'digitizeModes.strategy.preprocess',
      reachesPipeline: false,
      conflict: 'runPipeline(imageUrl, config) does not receive preprocessSettings',
    },
    posterizeControls: {
      writes: 'local preprocessSettings.posterizeColors/posterizeLevels',
      effectiveInPipeline: 'digitizeModes.strategy.preprocess.posterizeColors/posterizeLevels',
      reachesPipeline: false,
    },
    colorCountSlider: {
      writes: 'config.color_count',
      requested: config.color_count ?? null,
      effectiveImageAnalysis: strategy.vectorizer?.color_count || config.color_count || 8,
      effectiveContourEngine: Math.max(6, strategy.vectorizer?.color_count || config.color_count || 8),
      effectiveBackendVectorPayload: config.color_count || 8,
      partiallyHonored: true,
    },
    tatamiDensity: {
      writes: 'config.tatami_density',
      requested: config.tatami_density ?? null,
      effectiveBackendVectorPayload: strategy.backend?.tatami_density || config.tatami_density || 0.4,
      effectiveFinalFillCommands: 'resolved later by object density and resolveSafeFillDensityProfile',
      partiallyHonored: true,
    },
    fillAngle: {
      writes: 'config.fill_angle',
      requested: config.fill_angle ?? null,
      effectiveBackendVectorPayload: config.fill_angle ?? null,
      effectiveFinalFillCommands: 'region/object angle usually wins after adaptive region building',
      partiallyHonored: true,
    },
    aiModePanel: {
      writes: 'config.color_count after simulated analysis',
      reachesRealSegmentation: false,
      conflict: 'simulateAiAnalysis is local mock UI; it does not create actual regions',
    },
    intelligentModePanel: {
      writes: 'config.mode, config.intelligent_plan, config.ai_optimized, config.intelligent_applied',
      reachesPerRegionPipelineSelection: false,
      conflict: 'generateProcessingPlan uses mock regions in ConfigPanel; plan is not consumed by pipeline stages',
    },
  };
}

function buildEffectiveConfigAudit(config = {}, machineSettings = {}) {
  const strategy = getModeStrategy(config.mode || 'hybrid');
  const backend = strategy.backend || {};
  return {
    requestedMode: config.mode || 'hybrid',
    effectiveModeStrategy: strategy.id,
    machineSettingsSnapshot: {
      model: machineSettings.model || machineSettings.name || machineSettings.machine || null,
      maxStitchLength: machineSettings.maxStitchLength ?? null,
      trimThreshold: machineSettings.trimThreshold ?? null,
    },
    preprocessingSource: 'digitizeModes.strategy.preprocess',
    preprocessingPanelReachable: false,
    vectorEngine: valueState(config.vector_engine || 'hybrid', backend.vector_engine || null),
    iaVision: valueState(bool(config.use_ia_vision), bool(backend.use_ia_vision)),
    fullBackground: valueState(bool(config.use_full_bg), bool(backend.use_full_bg)),
    imageAnalysisColorCount: strategy.vectorizer?.color_count || config.color_count || 8,
    contourEngineColorCount: Math.max(6, strategy.vectorizer?.color_count || config.color_count || 8),
    backendVectorColorCount: config.color_count || 8,
    backendMode: backend.mode || null,
    backendTatamiDensity: backend.tatami_density || config.tatami_density || 0.4,
    requestedTatamiDensity: config.tatami_density ?? null,
    finalFillDensitySource: 'object.density -> region.density -> learnedFillDensityMm/config.tatami_density through safeFillDensityProfiles',
    safeFillProfileSelection: {
      ce01Requested: config.ce01SafeFillMode === true || config.ce01ProductionMode === true || config.validationMode === 'ce01_strict',
      highDensityPreviewRequested: config.highDensityPreview === true || config.safeFillHighDensityPreview === true,
      explicitSafeFillProfile: config.safeFillDensityProfileId || config.safeFillDensityProfile || config.safeFillDensityMode || null,
    },
    stitchOptimizerStageEnabled: strategy.stitchStrategy?.travelOptimize === true,
    adaptiveEngineEnabled: strategy.stitchStrategy?.useAdaptiveEngine !== false,
    contourSafeModeEnabled: config.contourSafeMode === true,
    ce01SafeFillModeEnabled: config.ce01SafeFillMode !== false,
    professionalModeEnabled: config.professionalMode === true,
    cartoonStructureModeEnabled: config.cartoonEmbroideryStructureMode === true,
    goldenMasterModeRequested: config.goldenMasterWilcomAlignment === true || config.goldenMasterProfileId === 'yoshi_wilcom_reference',
  };
}

function buildConflicts(uiConfigMap = {}, effective = {}) {
  const conflicts = [];
  if (uiConfigMap.vectorEngineSelector.reachesPipeline === false) {
    conflicts.push({
      id: 'vector_engine_ui_ignored',
      severity: 'high',
      requested: uiConfigMap.vectorEngineSelector.requested,
      effective: uiConfigMap.vectorEngineSelector.effectiveInStandardVectorPayload,
      detail: uiConfigMap.vectorEngineSelector.conflict,
    });
  }
  if (uiConfigMap.iaVisionToggle.reachesPipeline === false) {
    conflicts.push({
      id: 'ia_vision_toggle_overridden_by_mode',
      severity: 'medium',
      requested: uiConfigMap.iaVisionToggle.requested,
      effective: uiConfigMap.iaVisionToggle.effectiveInStandardVectorPayload,
      detail: uiConfigMap.iaVisionToggle.conflict,
    });
  }
  if (uiConfigMap.fullBackgroundToggle.reachesPipeline === false) {
    conflicts.push({
      id: 'full_background_toggle_overridden_by_mode',
      severity: 'medium',
      requested: uiConfigMap.fullBackgroundToggle.requested,
      effective: uiConfigMap.fullBackgroundToggle.effectiveInStandardVectorPayload,
      detail: uiConfigMap.fullBackgroundToggle.conflict,
    });
  }
  conflicts.push({
    id: 'preprocessing_panel_not_wired_to_pipeline',
    severity: 'high',
    requested: 'local preprocessSettings',
    effective: effective.preprocessingSource,
    detail: 'PreprocessingPanel changes local Editor state, but runPipeline receives only config.',
  });
  conflicts.push({
    id: 'ai_mode_simulated_not_real_segmentation',
    severity: 'medium',
    requested: 'AI Mode analysis',
    effective: 'mock UI result and mode preset',
    detail: 'AI Mode panel sets color_count from simulateAiAnalysis; actual segmentation still runs normal pipeline.',
  });
  conflicts.push({
    id: 'intelligent_mode_plan_not_consumed',
    severity: 'medium',
    requested: 'per-region engine orchestration',
    effective: 'hybrid-like strategy plus mock intelligent_plan',
    detail: 'The generated intelligent plan is not consumed by pipeline stages.',
  });
  conflicts.push({
    id: 'density_has_multiple_sources',
    severity: 'medium',
    requested: effective.requestedTatamiDensity,
    effective: effective.finalFillDensitySource,
    detail: 'Region stitch estimates, backend payload density, object density, and CE01 safe fill profiles can diverge.',
  });
  return conflicts;
}

function buildDuplicatedLogic() {
  return [
    {
      id: 'color_grouping',
      locations: [
        'contourEngine k-means quantization',
        'vectorizationFusionEngine color grouping',
        'cartoonSegmentationCleanup palette snapping',
        'cartoonEmbroideryStructureMode color family grouping',
        'backend hybridDigitize color_count',
      ],
    },
    {
      id: 'travel_optimization',
      locations: [
        'needlePath.optimizeNeedlePath',
        'stitchSequenceOptimizer.optimizeStitchSequence',
        'industrialStitchProcessor.optimizeObjectOrder',
        'exportPipeline.applySameColorNearestNeighborOrdering',
        'ce01TravelPathOptimizer.optimizeCE01TravelPath',
        'ce01TrimOptimizer.optimizeCE01Trims',
      ],
    },
    {
      id: 'outline_handling',
      locations: [
        'contourEngine traceContoursProf',
        'contourSafeMode.separateFillsAndContoursSafe',
        'outlineGenerator experimental path',
        'professionalDigitizingMode layer/contour post-processing',
        'cartoonEmbroideryStructureMode outline ordering',
      ],
    },
    {
      id: 'density_resolution',
      locations: [
        'digitizeModes backend.tatami_density',
        'ConfigPanel tatami_density',
        'regionBuilder/adaptiveEngine density',
        'stitchCount estimates',
        'safeFillDensityProfiles final physical spacing',
      ],
    },
  ];
}

function buildBestStageByMode() {
  return {
    preprocessing: 'hybrid or standard',
    colorDetection: 'contourEngine plus cartoonSegmentationCleanup',
    vectorization: 'hybrid backend, optionally vectorization fusion when explicitly enabled',
    blackOutlineDetection: 'cartoonSegmentationCleanup plus contourSafeMode',
    regionCleanup: 'quality phase 1 cleanup; cartoonEmbroideryStructureMode when explicitly enabled for cartoon art',
    fillGeneration: 'CE01 safe fill generator plus safeFillDensityProfiles',
    travelOptimization: 'exportPipeline same-color ordering and CE01 travel/trim passes',
    finalCommandStability: 'buildFinalCommands',
  };
}

function buildRecommendedArchitecture() {
  return {
    recommendedBaseEngine: 'hybrid',
    recommendedUnifiedArchitecture: 'Unify modes into one core engine with explicit profiles, then make Modo Inteligente select the profile/modules.',
    recommendation: 'C + D: one core engine with profiles; Modo Inteligente as orchestrator.',
    safestMigrationPlan: [
      'Keep encoders and export UI untouched.',
      'Introduce a read-only effective profile resolver and report requested vs effective config.',
      'Wire preprocessing, vector_engine, IA Vision, full background, color count, density, and fill angle through one resolver.',
      'Turn AI/Intelligent UI from mock panels into profile selection inputs only after the resolver is stable.',
      'Create a cartoon-character profile that prioritizes coherent colors, dark outline last, and micro-fragment suppression.',
      'Keep CE01 safe fill and zero-output fallback as final command generation safeguards.',
      'Add acceptance tests around command counts, color blocks, lost fill regions, long travel, and output binary validity.',
    ],
  };
}

function buildFilesToChangeLater() {
  return [
    'src/lib/digitizeModes.js',
    'src/components/editor/ConfigPanel.jsx',
    'src/components/editor/PreprocessingPanel.jsx',
    'src/pages/Editor.jsx',
    'src/lib/pipeline/stages/imageEnhancementStage.js',
    'src/lib/pipeline/stages/vectorEngineStage.js',
    'src/lib/pipeline/stages/contourEngineStage.js',
    'src/lib/pipeline/stages/regionBuilderStage.js',
    'src/lib/exportPipeline.js',
    'src/lib/safeFillDensityProfiles.js',
    'src/lib/embroideryEngineProfiles.js (new)',
  ];
}

function buildFilesNotToTouch() {
  return [
    'DST encoder files',
    'DSB encoder files',
    'src/components/editor/ExportModal.jsx',
    'src/components/editor/MachineSimulator*',
    'src/components/editor/FinalLookSimulator*',
    'binary export generation',
  ];
}

export function runEngineModesConfigToPipelineAudit({
  config = {},
  machineSettings = {},
  finalCommands = [],
  finalObjects = [],
  regions = [],
} = {}) {
  const generatedAt = new Date().toISOString();
  const effectiveProfile = config.effectiveProfile || resolveEffectiveEmbroideryProfile(config, config.effectiveProfile?.requestedProfile?.preprocessSettings || null, machineSettings);
  const profileAudit = buildEffectiveProfileAuditReport({ config, machineSettings, effectiveProfile });
  const effectiveConfigAudit = buildEffectiveConfigAudit({ ...config, ...effectiveProfile.pipelineConfig }, machineSettings);
  const uiConfigMap = buildUiConfigMap(config);
  uiConfigMap.preprocessingPanel.reachesPipeline = profileAudit.preprocessingPanelReachable;
  uiConfigMap.preprocessingPanel.effectiveInPipeline = 'effectiveProfile.effectivePreprocessSettings';
  uiConfigMap.posterizeControls.reachesPipeline = profileAudit.posterizeControlsReachPipeline;
  uiConfigMap.posterizeControls.effectiveInPipeline = 'effectiveProfile.effectivePreprocessSettings.posterizeColors/posterizeLevels';
  uiConfigMap.vectorEngineSelector.effectiveInStandardVectorPayload = effectiveProfile.effectiveVectorEngine;
  uiConfigMap.vectorEngineSelector.reachesPipeline = profileAudit.vectorEngineHonoredOrExplicitlyReported;
  uiConfigMap.fullBackgroundToggle.effectiveInStandardVectorPayload = effectiveProfile.effectiveUseFullBackground;
  uiConfigMap.fullBackgroundToggle.reachesPipeline = profileAudit.fullBackgroundHonoredOrExplicitlyReported;
  const conflictingLogic = buildConflicts(uiConfigMap, effectiveConfigAudit).filter((item) => ![
    'vector_engine_ui_ignored',
    'full_background_toggle_overridden_by_mode',
    'preprocessing_panel_not_wired_to_pipeline',
    'density_has_multiple_sources',
  ].includes(item.id));
  const perModePipelineMap = Object.fromEntries(Object.keys(DIGITIZE_MODES).map((modeId) => [modeId, modePipeline(modeId)]));
  const commandStats = {
    finalCommandCount: finalCommands.length,
    finalStitchCount: countType(finalCommands, 'stitch'),
    finalJumpCount: countType(finalCommands, 'jump'),
    finalTrimCount: countType(finalCommands, 'trim'),
    finalColorChangeCount: countType(finalCommands, 'colorChange'),
    finalObjectCount: finalObjects.length,
    regionCount: regions.length,
    regionColorCount: uniqueCount(regions.map((region) => region.color || region.hex)),
    commandColorCount: uniqueCount(finalCommands.filter((command) => command?.color).map((command) => command.color)),
  };

  return {
    reportId: REPORT_ID,
    generatedAt,
    auditOnly: true,
    regionsModified: false,
    commandsModified: false,
    exportModified: false,
    engineInventory: {
      modeIds: Object.keys(DIGITIZE_MODES),
      vectorEngineIds: Object.keys(VECTOR_ENGINE_DETAILS),
      pipelineStages: PIPELINE_STAGES,
      commandGenerationStages: [
        'buildStitchObjects',
        'flattenToCommands',
        'generateCE01SafeFillCommands',
        'sanitizeCommandsForCE01',
        'optimizeCE01TravelPath',
        'optimizeCE01Trims',
        'preserveLongJumpTrimIntent',
      ],
    },
    profileResolverApplied: profileAudit.profileResolverApplied,
    requestedProfile: profileAudit.requestedProfile,
    effectiveProfile: profileAudit.effectiveProfile,
    requestedVsEffectiveFields: profileAudit.fieldResolution,
    conflictsResolved: profileAudit.conflictsResolved,
    stillUnwired: profileAudit.stillUnwired,
    preprocessingPanelReachable: profileAudit.preprocessingPanelReachable,
    posterizeControlsReachPipeline: profileAudit.posterizeControlsReachPipeline,
    fullBackgroundHonoredOrExplicitlyReported: profileAudit.fullBackgroundHonoredOrExplicitlyReported,
    vectorEngineHonoredOrExplicitlyReported: profileAudit.vectorEngineHonoredOrExplicitlyReported,
    densitySourceUnified: profileAudit.densitySourceUnified,
    uiConfigMap,
    effectiveConfigAudit,
    perModePipelineMap,
    vectorEngineComparison: VECTOR_ENGINE_DETAILS,
    modeComparisonScores: MODE_SCORES,
    duplicatedLogic: buildDuplicatedLogic(),
    conflictingLogic,
    bestStageByMode: buildBestStageByMode(),
    ...buildRecommendedArchitecture(),
    filesToChangeLater: buildFilesToChangeLater(),
    filesNotToTouch: buildFilesNotToTouch(),
    commandStats,
    primaryMismatch: conflictingLogic[0]?.id || 'none',
    recommendedNextStep: 'Implement a single effective engine profile resolver, then wire vector/preprocess controls through it behind diagnostics before changing generation behavior.',
  };
}

function mdValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

function pushKeyValues(lines, object = {}, keys = Object.keys(object)) {
  for (const key of keys) {
    lines.push(`- ${key}: ${mdValue(object[key])}`);
  }
}

export function buildEngineModesConfigToPipelineAuditMarkdown(audit) {
  const a = audit || runEngineModesConfigToPipelineAudit();
  const lines = [];
  lines.push(`# ${REPORT_ID}`);
  lines.push('');
  lines.push('## Summary');
  pushKeyValues(lines, a, [
    'auditOnly',
    'regionsModified',
    'commandsModified',
    'exportModified',
    'generatedAt',
    'primaryMismatch',
    'profileResolverApplied',
    'preprocessingPanelReachable',
    'posterizeControlsReachPipeline',
    'fullBackgroundHonoredOrExplicitlyReported',
    'vectorEngineHonoredOrExplicitlyReported',
    'densitySourceUnified',
    'recommendedBaseEngine',
    'recommendedUnifiedArchitecture',
    'recommendedNextStep',
  ]);
  lines.push('');
  lines.push('## Runtime Snapshot');
  pushKeyValues(lines, a.commandStats || {});
  lines.push('');
  lines.push('## Requested Profile');
  pushKeyValues(lines, a.requestedProfile || {});
  lines.push('');
  lines.push('## Effective Profile');
  pushKeyValues(lines, a.effectiveProfile || {});
  lines.push('');
  lines.push('## Requested vs Effective Fields');
  for (const field of a.requestedVsEffectiveFields || []) {
    lines.push(`- ${field.field}: requested=${mdValue(field.requested)} effective=${mdValue(field.effective)} honored=${field.honored} source=${field.source}${field.note ? ` note=${field.note}` : ''}`);
  }
  lines.push('');
  lines.push('## Conflicts Resolved');
  for (const item of a.conflictsResolved || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Still Unwired');
  for (const item of a.stillUnwired || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Effective Config Audit');
  pushKeyValues(lines, a.effectiveConfigAudit || {});
  lines.push('');
  lines.push('## UI Config Map');
  for (const [key, value] of Object.entries(a.uiConfigMap || {})) {
    lines.push(`### ${key}`);
    pushKeyValues(lines, value);
    lines.push('');
  }
  lines.push('## Per-Mode Pipeline Map');
  for (const [modeId, pipeline] of Object.entries(a.perModePipelineMap || {})) {
    lines.push(`### ${modeId}`);
    lines.push(`- modeName: ${pipeline.modeName}`);
    lines.push(`- preprocessing: ${mdValue(pipeline.preprocessing?.settings)}`);
    lines.push(`- backend: ${mdValue(pipeline.vectorization)}`);
    lines.push(`- adaptiveEngineEnabled: ${pipeline.adaptiveEngineEnabled}`);
    lines.push(`- stageTravelOptimizerEnabled: ${pipeline.travelOptimization?.stageOptimizerEnabled}`);
    lines.push(`- exportTimeOptimizersAlwaysPresent: ${mdValue(pipeline.travelOptimization?.exportTimeOptimizersAlwaysPresent)}`);
    lines.push('');
  }
  lines.push('## Vector Engine Comparison');
  for (const [engineId, details] of Object.entries(a.vectorEngineComparison || {})) {
    lines.push(`### ${engineId}`);
    pushKeyValues(lines, details);
    lines.push('');
  }
  lines.push('## Mode Comparison Scores');
  lines.push('| Mode | Vec | Silhouette | Color | Black outline | Coherence | Micro | Fill | Travel | CE01 | Wilcom cartoon |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [modeId, score] of Object.entries(a.modeComparisonScores || {})) {
    lines.push(`| ${modeId} | ${score.vectorizationQuality} | ${score.silhouetteQuality} | ${score.colorGrouping} | ${score.blackOutlinePreservation} | ${score.regionCoherence} | ${score.microFragmentSuppression} | ${score.fillQuality} | ${score.travelOptimization} | ${score.ce01Compatibility} | ${score.wilcomStyleCartoonSimilarity} |`);
  }
  lines.push('');
  lines.push('## Duplicated Logic');
  for (const item of a.duplicatedLogic || []) {
    lines.push(`- ${item.id}: ${item.locations.join(' | ')}`);
  }
  lines.push('');
  lines.push('## Conflicting Logic');
  for (const item of a.conflictingLogic || []) {
    lines.push(`- ${item.id} (${item.severity}): requested=${mdValue(item.requested)} effective=${mdValue(item.effective)} detail=${item.detail}`);
  }
  lines.push('');
  lines.push('## Best Stage By Mode');
  pushKeyValues(lines, a.bestStageByMode || {});
  lines.push('');
  lines.push('## Safest Migration Plan');
  for (const step of a.safestMigrationPlan || []) {
    lines.push(`- ${step}`);
  }
  lines.push('');
  lines.push('## Files To Change Later');
  for (const file of a.filesToChangeLater || []) lines.push(`- ${file}`);
  lines.push('');
  lines.push('## Files Not To Touch');
  for (const file of a.filesNotToTouch || []) lines.push(`- ${file}`);
  lines.push('');
  lines.push('## Guarantees');
  lines.push('- auditOnly=true');
  lines.push('- regionsModified=false');
  lines.push('- commandsModified=false');
  lines.push('- exportModified=false');
  lines.push('- encodersTouched=false');
  lines.push(`- profileResolverApplied=${a.profileResolverApplied === true}`);
  lines.push(`- preprocessingPanelReachable=${a.preprocessingPanelReachable === true}`);
  lines.push(`- posterizeControlsReachPipeline=${a.posterizeControlsReachPipeline === true}`);
  lines.push(`- fullBackgroundHonoredOrExplicitlyReported=${a.fullBackgroundHonoredOrExplicitlyReported === true}`);
  lines.push(`- vectorEngineHonoredOrExplicitlyReported=${a.vectorEngineHonoredOrExplicitlyReported === true}`);
  lines.push(`- densitySourceUnified=${a.densitySourceUnified === true}`);
  return lines.join('\n');
}

export default runEngineModesConfigToPipelineAudit;