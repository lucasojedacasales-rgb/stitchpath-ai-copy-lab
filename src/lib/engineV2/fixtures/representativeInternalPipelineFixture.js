export const REPRESENTATIVE_REGION_IDS = Object.freeze({
  outerContour: 'p7-outer-contour',
  baseFill: 'p7-base-fill',
  innerContour: 'p7-inner-contour',
  nestedFill: 'p7-nested-fill',
  repeatedColorDetail: 'p7-repeated-color-detail',
  overlappingFill: 'p7-overlapping-fill',
  highlightDetail: 'p7-highlight-detail',
});

export const REPRESENTATIVE_REPEATED_COLOR = '#2e7d32';

function rectangle(left, top, right, bottom) {
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}

export function createRepresentativeInternalPipelineFixture() {
  return {
    sourceRegions: [
      {
        id: REPRESENTATIVE_REGION_IDS.outerContour,
        name: 'synthetic outer contour',
        region_class: 'body outline',
        color: '#1a1a1a',
        visible: true,
        darkStrokeSupport: { available: true, ratio: 0.96 },
        path_points: rectangle(0.05, 0.08, 0.58, 0.92),
      },
      {
        id: REPRESENTATIVE_REGION_IDS.baseFill,
        name: 'synthetic base body',
        region_class: 'body',
        color: REPRESENTATIVE_REPEATED_COLOR,
        visible: true,
        path_points: rectangle(0.07, 0.10, 0.56, 0.90),
      },
      {
        id: REPRESENTATIVE_REGION_IDS.nestedFill,
        name: 'synthetic nested belly',
        region_class: 'belly',
        color: '#f5c542',
        visible: true,
        path_points: rectangle(0.16, 0.22, 0.47, 0.72),
      },
      {
        id: REPRESENTATIVE_REGION_IDS.repeatedColorDetail,
        name: 'synthetic repeated inset fill',
        region_class: 'belly',
        color: REPRESENTATIVE_REPEATED_COLOR,
        visible: true,
        path_points: rectangle(0.25, 0.38, 0.36, 0.56),
      },
      {
        id: REPRESENTATIVE_REGION_IDS.overlappingFill,
        name: 'synthetic overlapping arm',
        region_class: 'arm',
        color: '#d96c2f',
        visible: true,
        path_points: rectangle(0.66, 0.12, 0.96, 0.88),
      },
      {
        id: REPRESENTATIVE_REGION_IDS.innerContour,
        name: 'synthetic inner contour',
        region_class: 'belly inner outline',
        color: '#3b244a',
        visible: true,
        darkStrokeSupport: { available: true, ratio: 0.92 },
        path_points: rectangle(0.70, 0.22, 0.92, 0.78),
      },
      {
        id: REPRESENTATIVE_REGION_IDS.highlightDetail,
        name: 'synthetic highlight',
        region_class: 'highlight',
        color: '#f8f1a1',
        visible: true,
        path_points: rectangle(0.89, 0.32, 0.94, 0.48),
      },
    ],
    ingestionOptions: {
      coordinateSpace: 'normalized',
    },
    planningConfig: {
      designWidthMm: 40,
      designHeightMm: 40,
      hatchOverlapProfile: 'hatch-c-experimental',
      hatchOverlapRuleFlags: {
        'CONTOUR-LAST-001': true,
        'COLOR-GROUP-HEURISTIC-001': false,
        'MULTILAYER-DEPENDENCY-001': false,
      },
    },
  };
}
