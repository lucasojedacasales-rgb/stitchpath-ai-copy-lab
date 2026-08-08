import { compileCanonicalCommandStream } from './commandCompilation/canonicalCommandCompiler.js';
import { ingestV1RegionsToRegionGraphV2 } from './ingestion/regionIngestion.js';
import { materializeEmbroideryObjectDrafts } from './materialization/objectDraftMaterializer.js';
import { createEngineDocumentV2 } from './model.js';
import { validateEngineDocumentV2 } from './modelValidation.js';
import { buildEmbroideryObjectProposalPlan } from './planning/objectPlanningPipeline.js';
import { analyzeSemanticRegionRoles } from './semantics/semanticRoleAnalyzer.js';
import { buildGlobalSequencePlan } from './sequencing/globalSequencePlanner.js';
import { buildMachineIndependentPhysicalStitchPlan } from './stitchGeneration/physicalStitchPipeline.js';
import { buildTechnicalEmbroideryPlan } from './technical/technicalPlanningPipeline.js';
import { materializeThreadedEmbroideryObjects } from './threads/finalObjectMaterializer.js';

export const ENGINE_V2_VERSION = '2';

const STAGE_NAMES = Object.freeze([
  'ingestion',
  'semanticAnalysis',
  'objectPlanning',
  'draftMaterialization',
  'threadedMaterialization',
  'technicalPlanning',
  'sequencePlanning',
  'physicalGeneration',
  'canonicalCompilation',
]);

const PIPELINE_METADATA = Object.freeze({
  machineAdaptationApplied: false,
  encodingApplied: false,
  binaryArtifactCreated: false,
});

function createEmptyStages() {
  return Object.fromEntries(STAGE_NAMES.map(name => [name, null]));
}

function stageErrors(stageName, value) {
  const direct = Array.isArray(value?.errors) ? value.errors : [];
  if (stageName !== 'ingestion') return direct;
  return [
    ...direct,
    ...(Array.isArray(value?.rejected)
      ? value.rejected.flatMap(rejection => Array.isArray(rejection?.errors) ? rejection.errors : [])
      : []),
    ...(Array.isArray(value?.graphValidation?.errors) ? value.graphValidation.errors : []),
  ];
}

function stageWarnings(value) {
  return [
    ...(Array.isArray(value?.warnings) ? value.warnings : []),
    ...(Array.isArray(value?.graphValidation?.warnings) ? value.graphValidation.warnings : []),
  ];
}

function failedResult({
  terminalStage,
  completedStages,
  stages,
  errors,
  warnings,
  document = null,
  documentValidation = null,
}) {
  return {
    version: ENGINE_V2_VERSION,
    valid: false,
    terminalStage,
    completedStages: [...completedStages],
    stages,
    document,
    documentValidation,
    errors: [...errors],
    warnings: [...warnings],
    metadata: { ...PIPELINE_METADATA },
  };
}

function runStage({ name, stages, completedStages, warnings, operation }) {
  try {
    const value = operation();
    stages[name] = value;
    warnings.push(...stageWarnings(value));
    if (value?.valid !== true) {
      return {
        valid: false,
        result: failedResult({
          terminalStage: name,
          completedStages,
          stages,
          errors: stageErrors(name, value),
          warnings,
        }),
      };
    }
    completedStages.push(name);
    return { valid: true, value };
  } catch (caught) {
    const error = {
      code: 'ENGINE_V2_INTERNAL_STAGE_EXCEPTION',
      path: name,
      message: caught instanceof Error ? caught.message : String(caught),
    };
    stages[name] = {
      version: `2-internal-${name}-failure`,
      valid: false,
      errors: [error],
      warnings: [],
    };
    return {
      valid: false,
      result: failedResult({
        terminalStage: name,
        completedStages,
        stages,
        errors: [error],
        warnings,
      }),
    };
  }
}

export function runEngineV2InternalPipeline({
  sourceRegions = [],
  ingestionOptions = {},
  semanticOptions = {},
  planningConfig = {},
  technicalConfig = {},
  reviewDecisions = [],
  reviewConfig = {},
  threadResolutionConfig = {},
  sequenceConfig = {},
  physicalConfig = {},
  compilationConfig = {},
} = {}) {
  const stages = createEmptyStages();
  const completedStages = [];
  const warnings = [];

  const ingestion = runStage({
    name: 'ingestion',
    stages,
    completedStages,
    warnings,
    operation: () => ingestV1RegionsToRegionGraphV2(sourceRegions, ingestionOptions),
  });
  if (!ingestion.valid) return ingestion.result;

  const semanticAnalysis = runStage({
    name: 'semanticAnalysis',
    stages,
    completedStages,
    warnings,
    operation: () => analyzeSemanticRegionRoles(
      ingestion.value.regions,
      ingestion.value.graph,
      semanticOptions,
    ),
  });
  if (!semanticAnalysis.valid) return semanticAnalysis.result;

  const objectPlanning = runStage({
    name: 'objectPlanning',
    stages,
    completedStages,
    warnings,
    operation: () => buildEmbroideryObjectProposalPlan({
      regions: ingestion.value.regions,
      graph: ingestion.value.graph,
      semanticResult: semanticAnalysis.value,
      config: planningConfig,
      technicalConfig,
    }),
  });
  if (!objectPlanning.valid) return objectPlanning.result;

  const draftMaterialization = runStage({
    name: 'draftMaterialization',
    stages,
    completedStages,
    warnings,
    operation: () => materializeEmbroideryObjectDrafts({
      regions: ingestion.value.regions,
      graph: ingestion.value.graph,
      semanticResult: semanticAnalysis.value,
      proposalPlan: objectPlanning.value,
      explicitReviewDecisions: reviewDecisions,
      config: reviewConfig,
    }),
  });
  if (!draftMaterialization.valid) return draftMaterialization.result;

  const threadedMaterialization = runStage({
    name: 'threadedMaterialization',
    stages,
    completedStages,
    warnings,
    operation: () => materializeThreadedEmbroideryObjects({
      regions: ingestion.value.regions,
      objectDraftMaterialization: draftMaterialization.value,
      threadResolutionConfig,
    }),
  });
  if (!threadedMaterialization.valid) return threadedMaterialization.result;

  const technicalPlanning = runStage({
    name: 'technicalPlanning',
    stages,
    completedStages,
    warnings,
    operation: () => buildTechnicalEmbroideryPlan({
      regions: ingestion.value.regions,
      threadedObjectMaterialization: threadedMaterialization.value,
      config: technicalConfig,
    }),
  });
  if (!technicalPlanning.valid) return technicalPlanning.result;

  const sequencePlanning = runStage({
    name: 'sequencePlanning',
    stages,
    completedStages,
    warnings,
    operation: () => buildGlobalSequencePlan({
      regions: ingestion.value.regions,
      threadedObjectMaterialization: threadedMaterialization.value,
      technicalPlan: technicalPlanning.value,
      config: sequenceConfig,
    }),
  });
  if (!sequencePlanning.valid) return sequencePlanning.result;

  const safePhysicalConfig = {
    experimentalPhysicalMmStitchLengthInvariant: false,
    ...physicalConfig,
  };

  const physicalGeneration = runStage({
    name: 'physicalGeneration',
    stages,
    completedStages,
    warnings,
    operation: () => buildMachineIndependentPhysicalStitchPlan({
      regions: ingestion.value.regions,
      threadedObjectMaterialization: threadedMaterialization.value,
      technicalPlan: technicalPlanning.value,
      sequencePlan: sequencePlanning.value,
      config: safePhysicalConfig,
    }),
  });
  if (!physicalGeneration.valid) return physicalGeneration.result;

  const canonicalCompilation = runStage({
    name: 'canonicalCompilation',
    stages,
    completedStages,
    warnings,
    operation: () => compileCanonicalCommandStream({
      regions: ingestion.value.regions,
      threadedObjectMaterialization: threadedMaterialization.value,
      technicalPlan: technicalPlanning.value,
      sequencePlan: sequencePlanning.value,
      physicalPlan: physicalGeneration.value,
      config: compilationConfig,
    }),
  });
  if (!canonicalCompilation.valid) return canonicalCompilation.result;

  const document = createEngineDocumentV2({
    version: ENGINE_V2_VERSION,
    regions: ingestion.value.regions,
    objects: threadedMaterialization.value.objects,
    threads: threadedMaterialization.value.threads,
    threadBlocks: sequencePlanning.value.threadBlocks,
    commands: canonicalCompilation.value.commands,
    metadata: {
      source: 'engineV2-internal-pipeline',
      terminalStage: 'documentValidation',
      ...PIPELINE_METADATA,
    },
  });
  const documentValidation = validateEngineDocumentV2(document);
  if (!documentValidation.valid) {
    return failedResult({
      terminalStage: 'documentValidation',
      completedStages,
      stages,
      document,
      documentValidation,
      errors: documentValidation.errors,
      warnings: [...warnings, ...documentValidation.warnings],
    });
  }

  completedStages.push('documentValidation');
  return {
    version: ENGINE_V2_VERSION,
    valid: true,
    terminalStage: 'documentValidation',
    completedStages,
    stages,
    document,
    documentValidation,
    errors: [],
    warnings: [...warnings, ...documentValidation.warnings],
    metadata: { ...PIPELINE_METADATA },
  };
}
