/**
 * universalDarkContourTestSuite.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Validation harness for the universal dark contour detector.
 *
 * DESIGN_SCENARIOS documents the 5 minimum design types the detector must
 * handle. validateUniversalContours(report) checks the universal acceptance
 * criteria against any loaded design's report.
 */

export const DESIGN_SCENARIOS = [
  {
    id: 'kirby',
    name: 'Kirby',
    expects: { outer: true, inner: true, detail: true, fillBoundary: false },
    note: 'Conserva boca y contorno; sin fronteras rosa exportadas',
  },
  {
    id: 'black_circle',
    name: 'Círculo con contorno negro',
    expects: { outer: true, inner: false, detail: false, fillBoundary: false },
    note: 'Contorno exterior completo, sin detalles interiores',
  },
  {
    id: 'face',
    name: 'Personaje con ojos y boca',
    expects: { outer: true, inner: true, detail: true, fillBoundary: false },
    note: 'Ojos como inner_outline, boca como detail_open_curve',
  },
  {
    id: 'no_black_lines',
    name: 'Varios colores sin línea negra',
    expects: { outer: false, fillBoundary: false },
    note: 'No debe exportar fronteras entre colores',
  },
  {
    id: 'irregular',
    name: 'Contorno exterior irregular',
    expects: { outer: true, fillBoundary: false },
    note: 'Contorno exterior completo sin tramos perdidos ni diagonales',
  },
];

/**
 * @param {Object} report — from getLastUniversalReport()
 * @returns {{ pass: boolean, checks: Array<{id,label,pass,detail}>, scenarios: typeof DESIGN_SCENARIOS }}
 */
export function validateUniversalContours(report) {
  if (!report) {
    return {
      pass: false,
      checks: [{ id: 'none', label: 'Sin reporte universal', pass: false, detail: '' }],
      scenarios: DESIGN_SCENARIOS,
    };
  }
  const hasOuter = report.outerOutlineCount > 0;
  const checks = [
    {
      id: 'outerComplete',
      label: 'Contorno exterior completo',
      pass: hasOuter ? report.outerCoverage >= 90 : true,
      detail: `outerCoverage ${report.outerCoverage}%`,
    },
    {
      id: 'innerDetails',
      label: 'Detalles negros interiores detectados',
      pass: (report.innerOutlineCount + report.detailOpenCurveCount) > 0 || !hasOuter,
      detail: `inner ${report.innerOutlineCount} · detail ${report.detailOpenCurveCount}`,
    },
    {
      id: 'noFillBoundaries',
      label: 'Sin fronteras de color exportadas',
      pass: !report.fillBoundaryExported && report.rejectedFillBoundaryCount === 0,
      detail: report.fillBoundaryExported ? 'exported' : 'none',
    },
    {
      id: 'noArtificial',
      label: 'Sin diagonales artificiales',
      pass: report.artificialGeometryCount === 0,
      detail: `${report.artificialGeometryCount}`,
    },
    {
      id: 'noOvals',
      label: 'Sin óvalos / bounding boxes inventados',
      pass: !report.ovalBoundaryUsed,
      detail: report.ovalBoundaryUsed ? 'YES' : 'NO',
    },
    {
      id: 'coverage',
      label: 'Cobertura ≥ 85%',
      pass: report.darkContourCoverage >= 85,
      detail: `${report.darkContourCoverage}%`,
    },
    {
      id: 'noMicrofragmentation',
      label: 'Sin microfragmentación',
      pass: report.consolidatedContours <= 20,
      detail: `${report.consolidatedContours}`,
    },
    {
      id: 'noLargeGaps',
      label: 'Sin tramos grandes perdidos',
      pass: report.outerCoverage >= 90 || !hasOuter,
      detail: `outer ${report.outerCoverage}%`,
    },
  ];
  return { pass: checks.every(c => c.pass), checks, scenarios: DESIGN_SCENARIOS };
}