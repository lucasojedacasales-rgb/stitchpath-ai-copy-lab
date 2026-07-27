export function createMinimalInternalPipelineFixture() {
  return {
    sourceRegions: [{
      id: 'p6-primary-shape',
      name: 'body',
      region_class: 'body',
      color: '#3366cc',
      visible: true,
      path_points: [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.8, 0.8],
        [0.2, 0.8],
      ],
    }],
    // The ingestion contract requires the coordinate space to be explicit.
    ingestionOptions: {
      coordinateSpace: 'normalized',
    },
    planningConfig: {
      designWidthMm: 20,
      designHeightMm: 20,
    },
  };
}
