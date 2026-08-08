function rect(id, regionClass, color, x1, y1, x2, y2, extra = {}) {
  return { id, color, region_class: regionClass, path_points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], source: { fixture: 'synthetic_phase_4_planning', ...extra } };
}

export function createEmbroideryPlanningFixture() {
  return [
    rect('background', 'background', '#ffffff', 0, 0, 1, 1),
    rect('body', 'body', '#45a95e', 0.1, 0.08, 0.9, 0.92),
    rect('face', 'face', '#f5ead8', 0.27, 0.25, 0.73, 0.7),
    rect('eye', 'eye', '#111111', 0.38, 0.32, 0.43, 0.38),
    rect('highlight', 'highlight', '#ffffff', 0.39, 0.33, 0.405, 0.345),
    rect('negative', 'unknown', '#ffffff', 0.77, 0.32, 0.82, 0.42, { negativeSpace: true }),
    rect('unknown', 'unclassified', '#888888', 0.82, 0.75, 0.88, 0.81),
  ];
}

export function createStitchTypePlanningFixture() {
  return [
    rect('thin-running', 'eye', '#111111', 0.1, 0.1, 0.11, 0.4),
    rect('narrow-satin', 'detail', '#111111', 0.2, 0.1, 0.24, 0.5),
    rect('closed-tatami', 'detail', '#111111', 0.35, 0.1, 0.55, 0.35),
    rect('ambiguous-detail', 'detail', '#111111', 0.65, 0.1, 0.69, 0.14),
  ];
}
