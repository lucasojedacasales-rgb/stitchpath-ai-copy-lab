import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileCanonicalCommandStream } from '../commandCompilation/canonicalCommandCompiler.js';
import { ingestV1RegionsToRegionGraphV2 } from '../ingestion/regionIngestion.js';
import { materializeEmbroideryObjectDrafts } from '../materialization/objectDraftMaterializer.js';
import { buildEmbroideryObjectProposalPlan } from '../planning/objectPlanningPipeline.js';
import { evaluateHatchHoleProtection } from '../rules/hatchEvidence/holes.js';
import { analyzeHatchLocalWidthProfile } from '../rules/hatchEvidence/widths.js';
import { buildGlobalSequencePlan } from '../sequencing/globalSequencePlanner.js';
import { createSemanticRegionAssessmentV2 } from '../semantics/semanticRoleModel.js';
import { buildMachineIndependentPhysicalStitchPlan } from '../stitchGeneration/physicalStitchPipeline.js';
import { buildTechnicalEmbroideryPlan } from '../technical/technicalPlanningPipeline.js';
import { materializeThreadedEmbroideryObjects } from '../threads/finalObjectMaterializer.js';
import {
  HATCH_AB_REFERENCE_FIXTURES,
  HATCH_AB_REFERENCE_SOURCE,
} from './fixtures/hatchABReferenceFixtures.js';

const SATIN_RANGE = 'SATIN-RANGE-OBSERVED-001';
const LOCAL_WIDTH = 'LOCAL-WIDTH-PROFILE-001';
const HOLE_PRESERVE = 'HOLE-PRESERVE-001';
const HOLE_MIN_SIZE = 'HOLE-MIN-SIZE-001';
const RULE_IDS = Object.freeze([SATIN_RANGE, LOCAL_WIDTH, HOLE_PRESERVE, HOLE_MIN_SIZE]);
const EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM = 9.18;
const DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM = 7;
const NORMALIZATION_DECIMALS = 6;

const ARMS = Object.freeze([
  Object.freeze({ id: 'LEGACY', ruleIds: null, technicalSatinMaximumWidthMm: EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM }),
  Object.freeze({ id: 'FLAGS-OFF', ruleIds: [], technicalSatinMaximumWidthMm: EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM }),
  Object.freeze({ id: 'SATIN-RANGE', ruleIds: [SATIN_RANGE], technicalSatinMaximumWidthMm: EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM }),
  Object.freeze({ id: 'LOCAL-WIDTH', ruleIds: [LOCAL_WIDTH], technicalSatinMaximumWidthMm: EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM }),
  Object.freeze({ id: 'HOLE-PRESERVE', ruleIds: [HOLE_PRESERVE], technicalSatinMaximumWidthMm: EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM }),
  Object.freeze({ id: 'HOLE-MIN-SIZE', ruleIds: [HOLE_MIN_SIZE], technicalSatinMaximumWidthMm: EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM }),
  Object.freeze({ id: 'SATIN-NEGATIVE', ruleIds: [SATIN_RANGE], technicalSatinMaximumWidthMm: DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM }),
  Object.freeze({ id: 'ALL-ON', ruleIds: [...RULE_IDS], technicalSatinMaximumWidthMm: EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM }),
]);

const EXPECTED_ARM_HASHES = Object.freeze({
  LEGACY: '9e61060cb7ac1456ddcc51bde010f2a0792bb57b59a5ee2babd7bcd6374625d5',
  'FLAGS-OFF': '9e61060cb7ac1456ddcc51bde010f2a0792bb57b59a5ee2babd7bcd6374625d5',
  'SATIN-RANGE': '11fd394533cebae1e2e3512c3a3040584e40303891a25aebc48b5b3e1b728364',
  'LOCAL-WIDTH': 'cb035fd8781db67af564a1f32db49f9cf14e9a9c8d02577db362e4f5ee75f5eb',
  'HOLE-PRESERVE': '68f7de328f6b73cde55b3745a6197c83cbf79c25f64ce879ecc981a8e3bab30b',
  'HOLE-MIN-SIZE': '893c7f1800eb34fe6ed28cdefc22f49ce5a85558ce8dae660d52b9fd50b5dcca',
  'SATIN-NEGATIVE': 'f99bb2ba1d45fe977a7c8cd2046955080d38691a14fc2faf7d17fbbfb20d613b',
  'ALL-ON': '682d1a23f14fb6a384fe787500a41d34dcfbb76e7b15f0bf1e5d2279fb5b9983',
});

const EXPECTED_COMMON_GEOMETRY_HASH = '2a2eec260ee93a5d4b3d49df761a7a94807c79380a1c3d492e7934f3c7f0807b';
const EXPECTED_REFERENCE_CORPUS_HASH = '69ef7cbd8078753d7739ea09cbaf91d3832e547e41219fce8fd70a03f9db703f';

const EXPECTED_ARM_METRICS = Object.freeze({
  LEGACY: {
    proposalCount: 4,
    activeProposalCount: 4,
    manualReviewCount: 0,
    technicalSatinMaximumWidthMm: 9.18,
    objectCount: 4,
    physicalStitchCount: 1337,
    stitchCommands: 1516,
    jumpCommands: 25,
    trimCommands: 24,
    techniqueDistribution: { tatami: 3, satin: 1, running: 0 },
    underlayStitchCount: 407,
    topStitchCount: 930,
    runningStitchCount: 0,
    tatamiStitchCount: 894,
    satinStitchCount: 36,
    minimumGeneratedStitchLengthMm: 0.4,
    maximumGeneratedStitchLengthMm: 6.412488,
    averageGeneratedStitchLengthMm: 3.044895,
    totalGeneratedStitchLengthMm: 4071.024903,
    estimatedTravelMm: 26,
    transitionCount: 3,
    threadChangeCount: 1,
    threadRevisitCount: 0,
    commandCount: 1567,
    physicalSourceStitchCommandCount: 1337,
    connectorStitchCommandCount: 179,
    colorChangeCommands: 1,
    endCommands: 1,
    explicitHoleObjectCount: 2,
    holeCrossingSegmentCount: 0,
    invalidOutsidePointCount: 0,
  },
  'FLAGS-OFF': {
    proposalCount: 4,
    activeProposalCount: 4,
    manualReviewCount: 0,
    technicalSatinMaximumWidthMm: 9.18,
    objectCount: 4,
    physicalStitchCount: 1337,
    stitchCommands: 1516,
    jumpCommands: 25,
    trimCommands: 24,
    techniqueDistribution: { tatami: 3, satin: 1, running: 0 },
    underlayStitchCount: 407,
    topStitchCount: 930,
    runningStitchCount: 0,
    tatamiStitchCount: 894,
    satinStitchCount: 36,
    minimumGeneratedStitchLengthMm: 0.4,
    maximumGeneratedStitchLengthMm: 6.412488,
    averageGeneratedStitchLengthMm: 3.044895,
    totalGeneratedStitchLengthMm: 4071.024903,
    estimatedTravelMm: 26,
    transitionCount: 3,
    threadChangeCount: 1,
    threadRevisitCount: 0,
    commandCount: 1567,
    physicalSourceStitchCommandCount: 1337,
    connectorStitchCommandCount: 179,
    colorChangeCommands: 1,
    endCommands: 1,
    explicitHoleObjectCount: 2,
    holeCrossingSegmentCount: 0,
    invalidOutsidePointCount: 0,
  },
  'SATIN-RANGE': {
    proposalCount: 4,
    activeProposalCount: 4,
    manualReviewCount: 0,
    technicalSatinMaximumWidthMm: 9.18,
    objectCount: 4,
    physicalStitchCount: 1310,
    stitchCommands: 1450,
    jumpCommands: 24,
    trimCommands: 23,
    techniqueDistribution: { tatami: 2, satin: 2, running: 0 },
    underlayStitchCount: 411,
    topStitchCount: 899,
    runningStitchCount: 0,
    tatamiStitchCount: 824,
    satinStitchCount: 75,
    minimumGeneratedStitchLengthMm: 0.4,
    maximumGeneratedStitchLengthMm: 8.409518,
    averageGeneratedStitchLengthMm: 3.145165,
    totalGeneratedStitchLengthMm: 4120.165996,
    estimatedTravelMm: 26,
    transitionCount: 3,
    threadChangeCount: 1,
    threadRevisitCount: 0,
    commandCount: 1499,
    physicalSourceStitchCommandCount: 1310,
    connectorStitchCommandCount: 140,
    colorChangeCommands: 1,
    endCommands: 1,
    explicitHoleObjectCount: 2,
    holeCrossingSegmentCount: 0,
    invalidOutsidePointCount: 0,
  },
  'LOCAL-WIDTH': {
    proposalCount: 4,
    activeProposalCount: 4,
    manualReviewCount: 0,
    technicalSatinMaximumWidthMm: 9.18,
    objectCount: 4,
    physicalStitchCount: 1337,
    stitchCommands: 1516,
    jumpCommands: 25,
    trimCommands: 24,
    techniqueDistribution: { tatami: 3, satin: 1, running: 0 },
    underlayStitchCount: 407,
    topStitchCount: 930,
    runningStitchCount: 0,
    tatamiStitchCount: 894,
    satinStitchCount: 36,
    minimumGeneratedStitchLengthMm: 0.4,
    maximumGeneratedStitchLengthMm: 6.412488,
    averageGeneratedStitchLengthMm: 3.044895,
    totalGeneratedStitchLengthMm: 4071.024903,
    estimatedTravelMm: 26,
    transitionCount: 3,
    threadChangeCount: 1,
    threadRevisitCount: 0,
    commandCount: 1567,
    physicalSourceStitchCommandCount: 1337,
    connectorStitchCommandCount: 179,
    colorChangeCommands: 1,
    endCommands: 1,
    explicitHoleObjectCount: 2,
    holeCrossingSegmentCount: 0,
    invalidOutsidePointCount: 0,
  },
  'HOLE-PRESERVE': {
    proposalCount: 4,
    activeProposalCount: 4,
    manualReviewCount: 0,
    technicalSatinMaximumWidthMm: 9.18,
    objectCount: 4,
    physicalStitchCount: 1337,
    stitchCommands: 1516,
    jumpCommands: 25,
    trimCommands: 24,
    techniqueDistribution: { tatami: 3, satin: 1, running: 0 },
    underlayStitchCount: 407,
    topStitchCount: 930,
    runningStitchCount: 0,
    tatamiStitchCount: 894,
    satinStitchCount: 36,
    minimumGeneratedStitchLengthMm: 0.4,
    maximumGeneratedStitchLengthMm: 6.412488,
    averageGeneratedStitchLengthMm: 3.044895,
    totalGeneratedStitchLengthMm: 4071.024903,
    estimatedTravelMm: 26,
    transitionCount: 3,
    threadChangeCount: 1,
    threadRevisitCount: 0,
    commandCount: 1567,
    physicalSourceStitchCommandCount: 1337,
    connectorStitchCommandCount: 179,
    colorChangeCommands: 1,
    endCommands: 1,
    explicitHoleObjectCount: 2,
    holeCrossingSegmentCount: 0,
    invalidOutsidePointCount: 0,
  },
  'HOLE-MIN-SIZE': {
    proposalCount: 4,
    activeProposalCount: 3,
    manualReviewCount: 1,
    technicalSatinMaximumWidthMm: 9.18,
    objectCount: 3,
    physicalStitchCount: 765,
    stitchCommands: 876,
    jumpCommands: 17,
    trimCommands: 16,
    techniqueDistribution: { tatami: 2, satin: 1, running: 0 },
    underlayStitchCount: 247,
    topStitchCount: 518,
    runningStitchCount: 0,
    tatamiStitchCount: 482,
    satinStitchCount: 36,
    minimumGeneratedStitchLengthMm: 0.4,
    maximumGeneratedStitchLengthMm: 6.412488,
    averageGeneratedStitchLengthMm: 3.086962,
    totalGeneratedStitchLengthMm: 2361.526188,
    estimatedTravelMm: 21,
    transitionCount: 2,
    threadChangeCount: 1,
    threadRevisitCount: 0,
    commandCount: 911,
    physicalSourceStitchCommandCount: 765,
    connectorStitchCommandCount: 111,
    colorChangeCommands: 1,
    endCommands: 1,
    explicitHoleObjectCount: 1,
    holeCrossingSegmentCount: 0,
    invalidOutsidePointCount: 0,
  },
  'SATIN-NEGATIVE': {
    proposalCount: 4,
    activeProposalCount: 4,
    manualReviewCount: 0,
    technicalSatinMaximumWidthMm: 7,
    objectCount: 4,
    physicalStitchCount: 1337,
    stitchCommands: 1516,
    jumpCommands: 25,
    trimCommands: 24,
    techniqueDistribution: { tatami: 3, satin: 1, running: 0 },
    underlayStitchCount: 407,
    topStitchCount: 930,
    runningStitchCount: 0,
    tatamiStitchCount: 894,
    satinStitchCount: 36,
    minimumGeneratedStitchLengthMm: 0.4,
    maximumGeneratedStitchLengthMm: 6.412488,
    averageGeneratedStitchLengthMm: 3.044895,
    totalGeneratedStitchLengthMm: 4071.024903,
    estimatedTravelMm: 26,
    transitionCount: 3,
    threadChangeCount: 1,
    threadRevisitCount: 0,
    commandCount: 1567,
    physicalSourceStitchCommandCount: 1337,
    connectorStitchCommandCount: 179,
    colorChangeCommands: 1,
    endCommands: 1,
    explicitHoleObjectCount: 2,
    holeCrossingSegmentCount: 0,
    invalidOutsidePointCount: 0,
  },
  'ALL-ON': {
    proposalCount: 4,
    activeProposalCount: 3,
    manualReviewCount: 1,
    technicalSatinMaximumWidthMm: 9.18,
    objectCount: 3,
    physicalStitchCount: 738,
    stitchCommands: 810,
    jumpCommands: 16,
    trimCommands: 15,
    techniqueDistribution: { tatami: 1, satin: 2, running: 0 },
    underlayStitchCount: 251,
    topStitchCount: 487,
    runningStitchCount: 0,
    tatamiStitchCount: 412,
    satinStitchCount: 75,
    minimumGeneratedStitchLengthMm: 0.4,
    maximumGeneratedStitchLengthMm: 8.409518,
    averageGeneratedStitchLengthMm: 3.266487,
    totalGeneratedStitchLengthMm: 2410.667281,
    estimatedTravelMm: 21,
    transitionCount: 2,
    threadChangeCount: 1,
    threadRevisitCount: 0,
    commandCount: 843,
    physicalSourceStitchCommandCount: 738,
    connectorStitchCommandCount: 72,
    colorChangeCommands: 1,
    endCommands: 1,
    explicitHoleObjectCount: 1,
    holeCrossingSegmentCount: 0,
    invalidOutsidePointCount: 0,
  },
});

const EXPECTED_ARM_DELTAS = Object.freeze({
  LEGACY: {},
  'FLAGS-OFF': {},
  'SATIN-RANGE': {
    physicalStitchCount: -27,
    stitchCommands: -66,
    jumpCommands: -1,
    trimCommands: -1,
    techniqueDistribution: { tatami: -1, satin: 1 },
    underlayStitchCount: 4,
    topStitchCount: -31,
    tatamiStitchCount: -70,
    satinStitchCount: 39,
    maximumGeneratedStitchLengthMm: 1.99703,
    averageGeneratedStitchLengthMm: 0.10027,
    totalGeneratedStitchLengthMm: 49.141093,
    commandCount: -68,
    physicalSourceStitchCommandCount: -27,
    connectorStitchCommandCount: -39,
  },
  'LOCAL-WIDTH': {},
  'HOLE-PRESERVE': {},
  'HOLE-MIN-SIZE': {
    activeProposalCount: -1,
    manualReviewCount: 1,
    objectCount: -1,
    physicalStitchCount: -572,
    stitchCommands: -640,
    jumpCommands: -8,
    trimCommands: -8,
    techniqueDistribution: { tatami: -1 },
    underlayStitchCount: -160,
    topStitchCount: -412,
    tatamiStitchCount: -412,
    averageGeneratedStitchLengthMm: 0.042067,
    totalGeneratedStitchLengthMm: -1709.498715,
    estimatedTravelMm: -5,
    transitionCount: -1,
    commandCount: -656,
    physicalSourceStitchCommandCount: -572,
    connectorStitchCommandCount: -68,
    explicitHoleObjectCount: -1,
  },
  'SATIN-NEGATIVE': { technicalSatinMaximumWidthMm: -2.18 },
  'ALL-ON': {
    activeProposalCount: -1,
    manualReviewCount: 1,
    objectCount: -1,
    physicalStitchCount: -599,
    stitchCommands: -706,
    jumpCommands: -9,
    trimCommands: -9,
    techniqueDistribution: { tatami: -2, satin: 1 },
    underlayStitchCount: -156,
    topStitchCount: -443,
    tatamiStitchCount: -482,
    satinStitchCount: 39,
    maximumGeneratedStitchLengthMm: 1.99703,
    averageGeneratedStitchLengthMm: 0.221592,
    totalGeneratedStitchLengthMm: -1660.357622,
    estimatedTravelMm: -5,
    transitionCount: -1,
    commandCount: -724,
    physicalSourceStitchCommandCount: -599,
    connectorStitchCommandCount: -107,
    explicitHoleObjectCount: -1,
  },
});

const BASELINE_GLOBAL_REGION_RESULTS = Object.freeze({
  'corpus-hole-safe': {
    proposedStitchType: 'tatami',
    proposedEmbroideryRole: 'base_fill',
    needsReview: false,
    hatchRuleIds: [],
    objectCount: 1,
    finalStitchType: 'tatami',
    technicalStatus: 'planned',
    sequenceIndex: 1,
    physicalPathCount: 1,
    physicalStitchCount: 572,
    underlayStitchCount: 160,
    topStitchCount: 412,
    totalGeneratedStitchLengthMm: 1706.13303,
    commandCount: 659,
    stitchCommands: 641,
    jumpCommands: 9,
    trimCommands: 9,
    physicalSourceStitchCommands: 572,
    connectorStitchCommands: 69,
  },
  'corpus-hole-small': {
    proposedStitchType: 'tatami',
    proposedEmbroideryRole: 'base_fill',
    needsReview: false,
    hatchRuleIds: [],
    objectCount: 1,
    finalStitchType: 'tatami',
    technicalStatus: 'planned',
    sequenceIndex: 0,
    physicalPathCount: 1,
    physicalStitchCount: 572,
    underlayStitchCount: 160,
    topStitchCount: 412,
    totalGeneratedStitchLengthMm: 1709.498715,
    commandCount: 654,
    stitchCommands: 641,
    jumpCommands: 7,
    trimCommands: 6,
    physicalSourceStitchCommands: 572,
    connectorStitchCommands: 69,
  },
  'corpus-local': {
    proposedStitchType: 'satin',
    proposedEmbroideryRole: 'internal_detail',
    needsReview: false,
    hatchRuleIds: [],
    objectCount: 1,
    finalStitchType: 'satin',
    technicalStatus: 'planned',
    sequenceIndex: 2,
    physicalPathCount: 1,
    physicalStitchCount: 80,
    underlayStitchCount: 44,
    topStitchCount: 36,
    totalGeneratedStitchLengthMm: 295.363033,
    commandCount: 90,
    stitchCommands: 81,
    jumpCommands: 4,
    trimCommands: 4,
    physicalSourceStitchCommands: 80,
    connectorStitchCommands: 1,
  },
  'corpus-satin': {
    proposedStitchType: 'tatami',
    proposedEmbroideryRole: 'internal_detail',
    needsReview: false,
    hatchRuleIds: [],
    objectCount: 1,
    finalStitchType: 'tatami',
    technicalStatus: 'planned',
    sequenceIndex: 3,
    physicalPathCount: 1,
    physicalStitchCount: 113,
    underlayStitchCount: 43,
    topStitchCount: 70,
    totalGeneratedStitchLengthMm: 360.030126,
    commandCount: 164,
    stitchCommands: 153,
    jumpCommands: 5,
    trimCommands: 5,
    physicalSourceStitchCommands: 113,
    connectorStitchCommands: 40,
  },
});

const MANUAL_SMALL_GLOBAL_REGION_RESULT = Object.freeze({
  proposedStitchType: 'manual',
  proposedEmbroideryRole: 'manual_review',
  needsReview: true,
  hatchRuleIds: [HOLE_MIN_SIZE],
  objectCount: 0,
  finalStitchType: null,
  technicalStatus: null,
  sequenceIndex: null,
  physicalPathCount: 0,
  physicalStitchCount: 0,
  underlayStitchCount: 0,
  topStitchCount: 0,
  totalGeneratedStitchLengthMm: 0,
  commandCount: 0,
  stitchCommands: 0,
  jumpCommands: 0,
  trimCommands: 0,
  physicalSourceStitchCommands: 0,
  connectorStitchCommands: 0,
});

const SATIN_RANGE_GLOBAL_REGION_RESULT = Object.freeze({
  ...BASELINE_GLOBAL_REGION_RESULTS['corpus-satin'],
  proposedStitchType: 'satin',
  hatchRuleIds: [SATIN_RANGE],
  finalStitchType: 'satin',
  physicalStitchCount: 86,
  underlayStitchCount: 47,
  topStitchCount: 39,
  totalGeneratedStitchLengthMm: 409.171218,
  commandCount: 96,
  stitchCommands: 87,
  jumpCommands: 4,
  trimCommands: 4,
  physicalSourceStitchCommands: 86,
  connectorStitchCommands: 1,
});

const RESEQUENCED_SAFE_GLOBAL_REGION_RESULT = Object.freeze({
  ...BASELINE_GLOBAL_REGION_RESULTS['corpus-hole-safe'],
  hatchRuleIds: [HOLE_MIN_SIZE],
  sequenceIndex: 0,
  commandCount: 657,
  stitchCommands: 642,
  jumpCommands: 8,
  trimCommands: 7,
  connectorStitchCommands: 70,
});

const EXPECTED_GLOBAL_REGION_RESULTS = Object.freeze({
  LEGACY: BASELINE_GLOBAL_REGION_RESULTS,
  'FLAGS-OFF': BASELINE_GLOBAL_REGION_RESULTS,
  'SATIN-RANGE': {
    ...BASELINE_GLOBAL_REGION_RESULTS,
    'corpus-local': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-local'],
      hatchRuleIds: [SATIN_RANGE],
    },
    'corpus-satin': SATIN_RANGE_GLOBAL_REGION_RESULT,
  },
  'LOCAL-WIDTH': {
    ...BASELINE_GLOBAL_REGION_RESULTS,
    'corpus-local': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-local'],
      hatchRuleIds: [LOCAL_WIDTH],
    },
    'corpus-satin': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-satin'],
      hatchRuleIds: [LOCAL_WIDTH],
    },
  },
  'HOLE-PRESERVE': {
    ...BASELINE_GLOBAL_REGION_RESULTS,
    'corpus-hole-safe': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-hole-safe'],
      hatchRuleIds: [HOLE_PRESERVE],
    },
    'corpus-hole-small': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-hole-small'],
      hatchRuleIds: [HOLE_PRESERVE],
    },
  },
  'HOLE-MIN-SIZE': {
    ...BASELINE_GLOBAL_REGION_RESULTS,
    'corpus-hole-safe': RESEQUENCED_SAFE_GLOBAL_REGION_RESULT,
    'corpus-hole-small': MANUAL_SMALL_GLOBAL_REGION_RESULT,
    'corpus-local': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-local'],
      sequenceIndex: 1,
    },
    'corpus-satin': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-satin'],
      sequenceIndex: 2,
    },
  },
  'SATIN-NEGATIVE': {
    ...BASELINE_GLOBAL_REGION_RESULTS,
    'corpus-local': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-local'],
      hatchRuleIds: [SATIN_RANGE],
    },
    'corpus-satin': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-satin'],
      hatchRuleIds: [SATIN_RANGE],
    },
  },
  'ALL-ON': {
    ...BASELINE_GLOBAL_REGION_RESULTS,
    'corpus-hole-safe': {
      ...RESEQUENCED_SAFE_GLOBAL_REGION_RESULT,
      hatchRuleIds: [HOLE_PRESERVE, HOLE_MIN_SIZE],
    },
    'corpus-hole-small': {
      ...MANUAL_SMALL_GLOBAL_REGION_RESULT,
      hatchRuleIds: [HOLE_PRESERVE, HOLE_MIN_SIZE],
    },
    'corpus-local': {
      ...BASELINE_GLOBAL_REGION_RESULTS['corpus-local'],
      hatchRuleIds: [LOCAL_WIDTH, SATIN_RANGE],
      sequenceIndex: 1,
    },
    'corpus-satin': {
      ...SATIN_RANGE_GLOBAL_REGION_RESULT,
      hatchRuleIds: [LOCAL_WIDTH, SATIN_RANGE],
      sequenceIndex: 2,
    },
  },
});

const REGION_GEOMETRY_HASHES = Object.freeze({
  'corpus-hole-safe': 'b2f672ec154e6f2bf10e4a98e7cc599f6142c8b682b9a0127262e33140aee403',
  'corpus-hole-small': '8779478eee19a8d7fe144f5bd42f7aa514357304a4237063b66bb5b31332cd3f',
  'corpus-local': 'd488b88104c806ec2a6c215a662d96f4d849a12e7fc64bc6c64808cbd776aeec',
  'corpus-satin': '6a1fb4162c8662162ecbd2f8152ecf8b6ce3aebf7ae4447f358c564154e06e54',
});

const BASELINE_INTRINSIC_REGION_RESULTS = Object.freeze({
  'corpus-hole-safe': {
    regionId: 'corpus-hole-safe',
    geometryHash: REGION_GEOMETRY_HASHES['corpus-hole-safe'],
    holeCount: 1,
    reviewStatus: 'active',
    objectCount: 1,
    proposedStitchType: 'tatami',
    finalStitchType: 'tatami',
    physicalPathCount: 1,
    physicalStitchCount: 572,
    underlayStitchCount: 160,
    topStitchCount: 412,
    physicalSourceStitchCommands: 572,
    holeCrossingSegmentCount: 0,
  },
  'corpus-hole-small': {
    regionId: 'corpus-hole-small',
    geometryHash: REGION_GEOMETRY_HASHES['corpus-hole-small'],
    holeCount: 1,
    reviewStatus: 'active',
    objectCount: 1,
    proposedStitchType: 'tatami',
    finalStitchType: 'tatami',
    physicalPathCount: 1,
    physicalStitchCount: 572,
    underlayStitchCount: 160,
    topStitchCount: 412,
    physicalSourceStitchCommands: 572,
    holeCrossingSegmentCount: 0,
  },
  'corpus-local': {
    regionId: 'corpus-local',
    geometryHash: REGION_GEOMETRY_HASHES['corpus-local'],
    holeCount: 0,
    reviewStatus: 'active',
    objectCount: 1,
    proposedStitchType: 'satin',
    finalStitchType: 'satin',
    physicalPathCount: 1,
    physicalStitchCount: 80,
    underlayStitchCount: 44,
    topStitchCount: 36,
    physicalSourceStitchCommands: 80,
    holeCrossingSegmentCount: 0,
  },
  'corpus-satin': {
    regionId: 'corpus-satin',
    geometryHash: REGION_GEOMETRY_HASHES['corpus-satin'],
    holeCount: 0,
    reviewStatus: 'active',
    objectCount: 1,
    proposedStitchType: 'tatami',
    finalStitchType: 'tatami',
    physicalPathCount: 1,
    physicalStitchCount: 113,
    underlayStitchCount: 43,
    topStitchCount: 70,
    physicalSourceStitchCommands: 113,
    holeCrossingSegmentCount: 0,
  },
});

const SATIN_INTRINSIC_REGION_RESULT = Object.freeze({
  ...BASELINE_INTRINSIC_REGION_RESULTS['corpus-satin'],
  proposedStitchType: 'satin',
  finalStitchType: 'satin',
  physicalStitchCount: 86,
  underlayStitchCount: 47,
  topStitchCount: 39,
  physicalSourceStitchCommands: 86,
});

const MANUAL_SMALL_INTRINSIC_REGION_RESULT = Object.freeze({
  ...BASELINE_INTRINSIC_REGION_RESULTS['corpus-hole-small'],
  reviewStatus: 'manual_review',
  objectCount: 0,
  proposedStitchType: 'manual',
  finalStitchType: null,
  physicalPathCount: 0,
  physicalStitchCount: 0,
  underlayStitchCount: 0,
  topStitchCount: 0,
  physicalSourceStitchCommands: 0,
});

const EXPECTED_INTRINSIC_REGION_RESULTS = Object.freeze({
  LEGACY: BASELINE_INTRINSIC_REGION_RESULTS,
  'FLAGS-OFF': BASELINE_INTRINSIC_REGION_RESULTS,
  'SATIN-RANGE': {
    ...BASELINE_INTRINSIC_REGION_RESULTS,
    'corpus-satin': SATIN_INTRINSIC_REGION_RESULT,
  },
  'LOCAL-WIDTH': BASELINE_INTRINSIC_REGION_RESULTS,
  'HOLE-PRESERVE': BASELINE_INTRINSIC_REGION_RESULTS,
  'HOLE-MIN-SIZE': {
    ...BASELINE_INTRINSIC_REGION_RESULTS,
    'corpus-hole-small': MANUAL_SMALL_INTRINSIC_REGION_RESULT,
  },
  'SATIN-NEGATIVE': BASELINE_INTRINSIC_REGION_RESULTS,
  'ALL-ON': {
    ...BASELINE_INTRINSIC_REGION_RESULTS,
    'corpus-hole-small': MANUAL_SMALL_INTRINSIC_REGION_RESULT,
    'corpus-satin': SATIN_INTRINSIC_REGION_RESULT,
  },
});

const ALL_RULES_OFF = Object.freeze(Object.fromEntries(RULE_IDS.map(ruleId => [ruleId, false])));
const hatchTreatment = enabledRuleIds => ({
  profile: 'hatch-a-f-experimental',
  context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
  ruleFlags: Object.fromEntries(RULE_IDS.map(ruleId => [ruleId, enabledRuleIds.includes(ruleId)])),
});

const EXPECTED_HATCH_TREATMENTS = Object.freeze({
  LEGACY: { profile: null, context: null, ruleFlags: null },
  'FLAGS-OFF': { ...hatchTreatment([]), ruleFlags: ALL_RULES_OFF },
  'SATIN-RANGE': hatchTreatment([SATIN_RANGE]),
  'LOCAL-WIDTH': hatchTreatment([LOCAL_WIDTH]),
  'HOLE-PRESERVE': hatchTreatment([HOLE_PRESERVE]),
  'HOLE-MIN-SIZE': hatchTreatment([HOLE_MIN_SIZE]),
  'SATIN-NEGATIVE': hatchTreatment([SATIN_RANGE]),
  'ALL-ON': hatchTreatment(RULE_IDS),
});

const EXPECTED_TECHNICAL_SATIN_MAXIMUM_BY_ARM = Object.freeze({
  LEGACY: 9.18,
  'FLAGS-OFF': 9.18,
  'SATIN-RANGE': 9.18,
  'LOCAL-WIDTH': 9.18,
  'HOLE-PRESERVE': 9.18,
  'HOLE-MIN-SIZE': 9.18,
  'SATIN-NEGATIVE': 7,
  'ALL-ON': 9.18,
});

function polygon(id, role, x, y, widthMm, heightMm, holes = []) {
  return {
    source: {
      id,
      color: role === 'internal_feature' ? '#221144' : '#55aa66',
      region_class: role === 'internal_feature' ? 'detail' : 'body',
      path_points: [
        [x, y],
        [x + widthMm / 100, y],
        [x + widthMm / 100, y + heightMm / 100],
        [x, y + heightMm / 100],
      ],
      holes,
    },
    role,
  };
}

function squareHole(centerX, centerY, sideMm) {
  const half = sideMm / 200;
  return [
    [centerX - half, centerY - half],
    [centerX - half, centerY + half],
    [centerX + half, centerY + half],
    [centerX + half, centerY - half],
  ];
}

function corpusSources() {
  return [
    polygon('corpus-satin', 'internal_feature', 0.05, 0.05, 8, 16),
    polygon('corpus-local', 'internal_feature', 0.2, 0.05, 6, 15),
    polygon('corpus-hole-safe', 'primary_shape', 0.4, 0.05, 25, 25, [squareHole(0.525, 0.175, 1.2)]),
    polygon('corpus-hole-small', 'primary_shape', 0.7, 0.05, 25, 25, [squareHole(0.825, 0.175, 0.8)]),
  ];
}

function experimentalPlanningConfig(ruleIds) {
  const enabled = new Set(ruleIds);
  return {
    hatchEvidenceProfile: 'hatch-a-f-experimental',
    hatchEvidenceRuleFlags: Object.fromEntries(RULE_IDS.map(ruleId => [ruleId, enabled.has(ruleId)])),
    hatchEvidenceContext: {
      fabricProfile: 'Pure Cotton',
      referenceScaleCompatible: true,
    },
  };
}

function semanticResultFor(regions, rolesById) {
  const assessments = regions.map(region => createSemanticRegionAssessmentV2({
    regionId: region.id,
    semanticRole: rolesById[region.id],
    confidence: 0.95,
    evidence: [{ code: 'HATCH_AB_R02_CORPUS_ROLE', message: 'Controlled R02 A/B corpus role.' }],
  }));
  return {
    assessments,
    byRegionId: Object.fromEntries(assessments.map(assessment => [assessment.regionId, assessment])),
    valid: true,
    errors: [],
    warnings: [],
  };
}

function runCorpus(arm) {
  const definitions = corpusSources();
  const sourceRegions = definitions.map(item => item.source);
  const sourceBefore = structuredClone(sourceRegions);
  const rolesById = Object.fromEntries(definitions.map(item => [item.source.id, item.role]));
  const ingestion = ingestV1RegionsToRegionGraphV2(sourceRegions, { coordinateSpace: 'normalized' });
  const semanticResult = semanticResultFor(ingestion.regions, rolesById);
  const technicalConfig = { satin: { maximumWidthMm: arm.technicalSatinMaximumWidthMm } };
  const proposalPlan = buildEmbroideryObjectProposalPlan({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    config: arm.ruleIds === null ? {} : experimentalPlanningConfig(arm.ruleIds),
    technicalConfig,
  });
  const objectDraftMaterialization = materializeEmbroideryObjectDrafts({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    proposalPlan,
  });
  const threadedObjectMaterialization = materializeThreadedEmbroideryObjects({
    regions: ingestion.regions,
    objectDraftMaterialization,
  });
  const technicalPlan = buildTechnicalEmbroideryPlan({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    config: technicalConfig,
  });
  const sequencePlan = buildGlobalSequencePlan({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    technicalPlan,
  });
  const physicalPlan = buildMachineIndependentPhysicalStitchPlan({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    technicalPlan,
    sequencePlan,
  });
  const canonicalCompilation = compileCanonicalCommandStream({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    technicalPlan,
    sequencePlan,
    physicalPlan,
  });
  return {
    sourceRegions,
    sourceBefore,
    rolesById,
    ingestion,
    proposalPlan,
    objectDraftMaterialization,
    threadedObjectMaterialization,
    technicalPlan,
    sequencePlan,
    physicalPlan,
    canonicalCompilation,
  };
}

function normalize(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const factor = 10 ** NORMALIZATION_DECIMALS;
    return Math.round(value * factor) / factor;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}

function hashNormalized(value) {
  return crypto.createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function metricsFor(run) {
  const physical = run.physicalPlan.summary;
  const sequence = run.sequencePlan.summary;
  const compilation = run.canonicalCompilation.summary;
  return {
    proposalCount: run.proposalPlan.proposals.length,
    activeProposalCount: run.proposalPlan.summary.activeProposalCount,
    manualReviewCount: run.proposalPlan.summary.manualReviewCount,
    technicalSatinMaximumWidthMm: run.technicalPlan.config.satin.maximumWidthMm,
    objectCount: run.threadedObjectMaterialization.objects.length,
    physicalStitchCount: physical.physicalStitchCount,
    stitchCommands: compilation.stitchCommandCount,
    jumpCommands: compilation.jumpCommandCount,
    trimCommands: compilation.trimCommandCount,
    techniqueDistribution: {
      tatami: physical.tatamiObjectPathCount,
      satin: physical.satinObjectPathCount,
      running: physical.runningObjectPathCount,
    },
    underlayStitchCount: physical.underlayStitchCount,
    topStitchCount: physical.topStitchCount,
    runningStitchCount: physical.runningStitchCount,
    tatamiStitchCount: physical.tatamiStitchCount,
    satinStitchCount: physical.satinStitchCount,
    minimumGeneratedStitchLengthMm: physical.minimumGeneratedStitchLengthMm,
    maximumGeneratedStitchLengthMm: physical.maximumGeneratedStitchLengthMm,
    averageGeneratedStitchLengthMm: physical.averageGeneratedStitchLengthMm,
    totalGeneratedStitchLengthMm: physical.totalGeneratedStitchLengthMm,
    estimatedTravelMm: sequence.estimatedTravelMm,
    transitionCount: sequence.transitionCount,
    threadChangeCount: sequence.threadChangeCount,
    threadRevisitCount: sequence.threadRevisitCount,
    commandCount: compilation.commandCount,
    physicalSourceStitchCommandCount: compilation.physicalSourceStitchCommandCount,
    connectorStitchCommandCount: compilation.connectorStitchCommandCount,
    colorChangeCommands: compilation.colorChangeCommandCount,
    endCommands: compilation.endCommandCount,
    explicitHoleObjectCount: physical.explicitHoleObjectCount,
    holeCrossingSegmentCount: physical.holeCrossingSegmentCount,
    invalidOutsidePointCount: physical.invalidOutsidePointCount,
  };
}

function commandsForRegion(compilation, regionId) {
  const commands = compilation.commands.filter(command => command.regionId === regionId);
  const count = type => commands.filter(command => command.type === type).length;
  return {
    commandCount: commands.length,
    stitchCommands: count('stitch'),
    jumpCommands: count('jump'),
    trimCommands: count('trim'),
    physicalSourceStitchCommands: commands.filter(command => command.reasonCode === 'PHYSICAL_SOURCE_STITCH').length,
    connectorStitchCommands: commands.filter(command => command.reasonCode === 'SAFE_SUBPATH_CONNECTOR').length,
  };
}

function regionBreakdownFor(run) {
  return Object.fromEntries(run.sourceRegions.map(source => {
    const proposal = run.proposalPlan.byRegionId[source.id];
    const object = run.threadedObjectMaterialization.objects.find(item => item.regionId === source.id) ?? null;
    const specification = object ? run.technicalPlan.byObjectId[object.id] : null;
    const step = run.sequencePlan.executionSteps.find(item => item.regionId === source.id) ?? null;
    const path = run.physicalPlan.objectPaths.find(item => item.regionId === source.id) ?? null;
    return [source.id, {
      proposedStitchType: proposal?.proposedStitchType ?? null,
      proposedEmbroideryRole: proposal?.proposedEmbroideryRole ?? null,
      needsReview: proposal?.needsReview === true,
      hatchRuleIds: proposal?.source?.hatchEvidence?.evaluations?.map(item => item.ruleId) ?? [],
      objectCount: object ? 1 : 0,
      finalStitchType: object?.stitchType ?? null,
      technicalStatus: specification?.status ?? null,
      sequenceIndex: step?.sequenceIndex ?? null,
      physicalPathCount: path ? 1 : 0,
      physicalStitchCount: path?.physicalStitchCount ?? 0,
      underlayStitchCount: path?.underlayStitchCount ?? 0,
      topStitchCount: path?.topStitchCount ?? 0,
      totalGeneratedStitchLengthMm: path?.totalLengthMm ?? 0,
      ...commandsForRegion(run.canonicalCompilation, source.id),
    }];
  }));
}

function proposalGeometryFor(run) {
  return run.proposalPlan.proposals.map(proposal => ({
    regionId: proposal.regionId,
    geometryMm: proposal.geometryMm,
    holesMm: proposal.holesMm,
  }));
}

function normalizedRunOutput(run) {
  return normalize({
    metrics: metricsFor(run),
    byRegion: regionBreakdownFor(run),
    proposalGeometry: proposalGeometryFor(run),
  });
}

function intrinsicRegionResultsFor(run) {
  const globalByRegion = regionBreakdownFor(run);
  const proposalByRegion = Object.fromEntries(
    proposalGeometryFor(run).map(item => [item.regionId, item]),
  );
  return normalize(Object.fromEntries(Object.entries(globalByRegion).map(([regionId, region]) => {
    const proposalGeometry = proposalByRegion[regionId];
    const path = run.physicalPlan.objectPaths.find(item => item.regionId === regionId) ?? null;
    return [regionId, {
      regionId,
      geometryHash: hashNormalized({
        geometryMm: proposalGeometry.geometryMm,
        holesMm: proposalGeometry.holesMm,
      }),
      holeCount: proposalGeometry.holesMm.length,
      reviewStatus: region.needsReview ? 'manual_review' : 'active',
      objectCount: region.objectCount,
      proposedStitchType: region.proposedStitchType,
      finalStitchType: region.finalStitchType,
      physicalPathCount: region.physicalPathCount,
      physicalStitchCount: region.physicalStitchCount,
      underlayStitchCount: region.underlayStitchCount,
      topStitchCount: region.topStitchCount,
      physicalSourceStitchCommands: region.physicalSourceStitchCommands,
      holeCrossingSegmentCount: path?.coverageMetrics?.holeCrossingSegmentCount ?? 0,
    }];
  })));
}

function controlledConfigurationFor(run) {
  const { extras = {}, ...commonPlanningConfig } = run.proposalPlan.config;
  const { satin = {}, ...commonTechnicalConfig } = run.technicalPlan.config;
  const { maximumWidthMm: technicalSatinMaximumWidthMm, ...commonSatinConfig } = satin;
  return normalize({
    common: {
      corpusHash: hashNormalized(run.sourceBefore),
      rolesById: run.rolesById,
      planningConfig: commonPlanningConfig,
      materialProfileId: run.technicalPlan.materialProfile.id,
      technicalConfig: { ...commonTechnicalConfig, satin: commonSatinConfig },
      sequenceConfig: run.sequencePlan.config,
      physicalConfig: run.physicalPlan.config,
      canonicalCompilationConfig: run.canonicalCompilation.config,
    },
    technicalSatinMaximumWidthMm,
    hatchTreatment: {
      profile: extras.hatchEvidenceProfile ?? null,
      context: extras.hatchEvidenceContext ?? null,
      ruleFlags: extras.hatchEvidenceRuleFlags ?? null,
    },
  });
}

function assertValidUnmutatedPreExportRun(run) {
  [
    run.ingestion,
    run.proposalPlan,
    run.objectDraftMaterialization,
    run.threadedObjectMaterialization,
    run.technicalPlan,
    run.sequencePlan,
    run.physicalPlan,
    run.canonicalCompilation,
  ].forEach(result => expect(result.valid).toBe(true));
  expect(run.sourceRegions).toEqual(run.sourceBefore);
  [
    run.proposalPlan,
    run.objectDraftMaterialization,
    run.threadedObjectMaterialization,
    run.technicalPlan,
    run.sequencePlan,
    run.physicalPlan,
  ].forEach(result => expect(result.metadata.inputMutationsDetected).toBe(false));
  expect(run.proposalPlan.summary.silentRegionDropCount).toBe(0);
  expect(run.objectDraftMaterialization.summary.silentProposalDropCount).toBe(0);
  expect(run.threadedObjectMaterialization.summary.silentDraftDropCount).toBe(0);
  expect(run.technicalPlan.summary.silentFinalObjectDropCount).toBe(0);
  expect(run.sequencePlan.summary.silentFinalObjectDropCount).toBe(0);
  expect(run.physicalPlan.summary.silentScheduledObjectDropCount).toBe(0);
  expect(run.canonicalCompilation.summary.silentScheduledObjectDropCount).toBe(0);
  expect(run.canonicalCompilation.summary.silentPhysicalStitchDropCount).toBe(0);
  expect(run.canonicalCompilation.summary.silentDiscontinuityDropCount).toBe(0);
  expect(run.physicalPlan.summary.holeCrossingSegmentCount).toBe(0);
  expect(run.physicalPlan.summary.invalidOutsidePointCount).toBe(0);
  expect(run.canonicalCompilation).not.toHaveProperty('artifact');
  expect(run.canonicalCompilation.metadata.machineAdaptationAdded).toBe(false);
  expect(run.canonicalCompilation.metadata.encodingAdded).toBe(false);
}

function changedTechniqueRegionIds(left, right) {
  return Object.keys(left.byRegion)
    .filter(regionId => left.byRegion[regionId].proposedStitchType !== right.byRegion[regionId].proposedStitchType)
    .sort();
}

function nonZeroNumericDeltas(current, baseline) {
  if (typeof current === 'number' && typeof baseline === 'number') {
    const delta = normalize(current - baseline);
    return delta === 0 ? undefined : delta;
  }
  if (!current || !baseline || typeof current !== 'object' || typeof baseline !== 'object'
    || Array.isArray(current) || Array.isArray(baseline)) return undefined;
  const deltas = Object.fromEntries(Object.keys(current).flatMap(key => {
    const delta = nonZeroNumericDeltas(current[key], baseline[key]);
    return delta === undefined ? [] : [[key, delta]];
  }));
  return Object.keys(deltas).length ? deltas : undefined;
}

function numericLeafCount(value) {
  if (typeof value === 'number') return 1;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.values(value).reduce((sum, nested) => sum + numericLeafCount(nested), 0);
}

function referenceCorpusSnapshot() {
  const widthCases = Object.fromEntries(['A8', 'C6', 'D6'].map(referenceId => {
    const fixture = HATCH_AB_REFERENCE_FIXTURES[referenceId];
    const profile = analyzeHatchLocalWidthProfile({ geometryMm: fixture.geometryMm, holesMm: fixture.holesMm });
    return [referenceId, {
      geometryFamily: fixture.geometryFamily,
      sourceWidthMm: fixture.sourceWidthMm,
      sourceHeightMm: fixture.sourceHeightMm,
      observedHatchWidthMm: fixture.observedHatchWidthMm,
      measuredMinimumWidthMm: profile.minimumWidthMm,
      measuredMedianWidthMm: profile.medianWidthMm,
      measuredMaximumWidthMm: profile.maximumWidthMm,
      measuredAspectRatio: profile.aspectRatio,
      principalAxisDegrees: profile.principalAxisDegrees,
    }];
  }));
  const h9 = HATCH_AB_REFERENCE_FIXTURES.H9;
  const holeEvaluation = evaluateHatchHoleProtection({
    geometryMm: h9.geometryMm,
    holesMm: h9.holesMm,
    context: { fabricProfile: 'Pure Cotton', referenceScaleCompatible: true },
    enabledRuleIds: [HOLE_PRESERVE, HOLE_MIN_SIZE],
  });
  return normalize({
    packageSha256: HATCH_AB_REFERENCE_SOURCE.packageSha256,
    widthCases,
    H9: {
      geometryFamily: h9.geometryFamily,
      sourceWidthMm: h9.sourceWidthMm,
      sourceHeightMm: h9.sourceHeightMm,
      measuredHoleSpansMm: holeEvaluation.measurements.map(item => item.minimumSpanMm),
      dispositions: holeEvaluation.measurements.map(item => item.disposition),
      requiresManualReview: holeEvaluation.requiresManualReview,
      automaticGenerationRejected: holeEvaluation.automaticGenerationRejected,
    },
  });
}

describe('Hatch A/B R02 isolated numeric metrics', () => {
  it('measures all eight arms twice and preserves the required invariants', () => {
    const snapshots = {};
    const results = {};
    const intrinsicRegionResults = {};
    const controlledConfigurations = {};

    ARMS.forEach(arm => {
      const firstRun = runCorpus(arm);
      const secondRun = runCorpus(arm);
      assertValidUnmutatedPreExportRun(firstRun);
      assertValidUnmutatedPreExportRun(secondRun);
      const first = normalizedRunOutput(firstRun);
      const second = normalizedRunOutput(secondRun);
      const firstHash = hashNormalized(first);
      const secondHash = hashNormalized(second);
      const firstGeometryHash = hashNormalized(first.proposalGeometry);
      const secondGeometryHash = hashNormalized(second.proposalGeometry);
      const firstIntrinsic = intrinsicRegionResultsFor(firstRun);
      const secondIntrinsic = intrinsicRegionResultsFor(secondRun);
      const firstConfiguration = controlledConfigurationFor(firstRun);
      const secondConfiguration = controlledConfigurationFor(secondRun);

      expect(second).toEqual(first);
      expect(secondHash).toBe(firstHash);
      expect(secondGeometryHash).toBe(firstGeometryHash);
      expect(secondIntrinsic).toEqual(firstIntrinsic);
      expect(secondConfiguration).toEqual(firstConfiguration);
      expect(numericLeafCount(first.metrics)).toBe(33);
      expect(first.metrics).toEqual(EXPECTED_ARM_METRICS[arm.id]);
      expect(first.byRegion).toEqual(EXPECTED_GLOBAL_REGION_RESULTS[arm.id]);
      expect(firstIntrinsic).toEqual(EXPECTED_INTRINSIC_REGION_RESULTS[arm.id]);
      expect(firstHash).toBe(EXPECTED_ARM_HASHES[arm.id]);
      expect(firstGeometryHash).toBe(EXPECTED_COMMON_GEOMETRY_HASH);
      expect(firstConfiguration.technicalSatinMaximumWidthMm)
        .toBe(EXPECTED_TECHNICAL_SATIN_MAXIMUM_BY_ARM[arm.id]);
      expect(firstConfiguration.hatchTreatment).toEqual(EXPECTED_HATCH_TREATMENTS[arm.id]);

      snapshots[arm.id] = first;
      intrinsicRegionResults[arm.id] = firstIntrinsic;
      controlledConfigurations[arm.id] = firstConfiguration;
      results[arm.id] = {
        hash: firstHash,
        repeatHash: secondHash,
        geometryHash: firstGeometryHash,
        metrics: first.metrics,
        byRegion: first.byRegion,
      };
    });

    const legacy = snapshots.LEGACY;
    const legacyIntrinsic = intrinsicRegionResults.LEGACY;
    const regionSubset = (armId, regionIds) => Object.fromEntries(
      regionIds.map(regionId => [regionId, intrinsicRegionResults[armId][regionId]]),
    );
    const expectIntrinsicParity = (armId, regionIds) => {
      expect(regionSubset(armId, regionIds)).toEqual(regionSubset('LEGACY', regionIds));
    };

    expect(snapshots['FLAGS-OFF']).toEqual(legacy);
    expect(intrinsicRegionResults['FLAGS-OFF']).toEqual(legacyIntrinsic);
    expect(intrinsicRegionResults['LOCAL-WIDTH']).toEqual(legacyIntrinsic);
    expect(intrinsicRegionResults['HOLE-PRESERVE']).toEqual(legacyIntrinsic);

    expect(changedTechniqueRegionIds(legacy, snapshots['SATIN-RANGE'])).toEqual(['corpus-satin']);
    expect(legacy.byRegion['corpus-satin'].proposedStitchType).toBe('tatami');
    expect(snapshots['SATIN-RANGE'].byRegion['corpus-satin'].proposedStitchType).toBe('satin');
    expectIntrinsicParity('SATIN-RANGE', [
      'corpus-local',
      'corpus-hole-safe',
      'corpus-hole-small',
    ]);

    const negativeControl = snapshots['SATIN-NEGATIVE'];
    expect(negativeControl.byRegion['corpus-satin'].proposedStitchType).toBe('tatami');
    const { technicalSatinMaximumWidthMm: _legacyMaximum, ...legacyWithoutMaximum } = legacy.metrics;
    const { technicalSatinMaximumWidthMm: _negativeMaximum, ...negativeWithoutMaximum } = negativeControl.metrics;
    expect(negativeWithoutMaximum).toEqual(legacyWithoutMaximum);
    expect(negativeControl.metrics.technicalSatinMaximumWidthMm).toBe(7);
    expect(intrinsicRegionResults['SATIN-NEGATIVE']).toEqual(legacyIntrinsic);

    const minimumHole = snapshots['HOLE-MIN-SIZE'];
    expect(minimumHole.byRegion['corpus-hole-small']).toMatchObject({
      proposedStitchType: 'manual',
      needsReview: true,
      objectCount: 0,
      physicalPathCount: 0,
    });
    expect(minimumHole.byRegion['corpus-hole-safe'].proposedStitchType).toBe('tatami');
    expect(minimumHole.metrics.manualReviewCount).toBe(legacy.metrics.manualReviewCount + 1);
    expect(minimumHole.metrics.objectCount).toBe(legacy.metrics.objectCount - 1);
    expectIntrinsicParity('HOLE-MIN-SIZE', [
      'corpus-satin',
      'corpus-local',
      'corpus-hole-safe',
    ]);
    expect(minimumHole.byRegion['corpus-hole-safe']).toMatchObject({
      commandCount: 657,
      stitchCommands: 642,
      jumpCommands: 8,
      trimCommands: 7,
      connectorStitchCommands: 70,
    });

    expect(snapshots['ALL-ON'].byRegion['corpus-satin'].proposedStitchType).toBe('satin');
    expect(snapshots['ALL-ON'].byRegion['corpus-hole-small'].proposedStitchType).toBe('manual');
    expectIntrinsicParity('ALL-ON', ['corpus-local', 'corpus-hole-safe']);
    expect(snapshots['ALL-ON'].byRegion['corpus-hole-safe']).toMatchObject({
      commandCount: 657,
      stitchCommands: 642,
      jumpCommands: 8,
      trimCommands: 7,
      connectorStitchCommands: 70,
    });

    Object.values(controlledConfigurations).forEach(configuration => {
      expect(configuration.common).toEqual(controlledConfigurations.LEGACY.common);
    });
    expect(controlledConfigurations.LEGACY.hatchTreatment).toEqual({
      profile: null,
      context: null,
      ruleFlags: null,
    });
    ARMS.filter(arm => arm.id !== 'LEGACY').forEach(arm => {
      expect(controlledConfigurations[arm.id].hatchTreatment.context).toEqual({
        fabricProfile: 'Pure Cotton',
        referenceScaleCompatible: true,
      });
    });

    Object.values(snapshots).forEach(snapshot => {
      expect(snapshot.proposalGeometry).toEqual(legacy.proposalGeometry);
      expect(snapshot.metrics.holeCrossingSegmentCount).toBe(0);
      expect(snapshot.metrics.invalidOutsidePointCount).toBe(0);
    });

    const actualDeltas = Object.fromEntries(ARMS.map(arm => [
      arm.id,
      nonZeroNumericDeltas(results[arm.id].metrics, results.LEGACY.metrics) ?? {},
    ]));
    expect(actualDeltas).toEqual(EXPECTED_ARM_DELTAS);

    const references = referenceCorpusSnapshot();
    expect(hashNormalized(references)).toBe(EXPECTED_REFERENCE_CORPUS_HASH);
    expect(references.H9.measuredHoleSpansMm).toEqual([0.8, 1.2, 1.8, 2.5]);
    expect(references.H9.dispositions).toEqual([
      'reject_automatic_generation',
      'protect',
      'protect',
      'protect',
    ]);
    ['A8', 'C6', 'D6'].forEach(referenceId => {
      expect(references.widthCases[referenceId].measuredMaximumWidthMm)
        .toBeCloseTo(references.widthCases[referenceId].sourceWidthMm, 6);
    });

    expect(Object.keys(results)).toEqual(ARMS.map(arm => arm.id));
  }, 30000);
});
