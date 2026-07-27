const PACKAGE_ROOT = 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F';
const WIDTHS_ROOT = `${PACKAGE_ROOT}/01_ANCHURAS`;
const HOLES_ROOT = `${PACKAGE_ROOT}/02_HUECOS`;

export const HATCH_REFERENCE_DESIGN_MM = Object.freeze({ width: 100, height: 80 });

export const HATCH_AB_REFERENCE_SOURCE = Object.freeze({
  packageName: 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F.zip',
  packageSha256: 'd2ca1f36db18a6d48fe8d471f66d4cf1f96e2804ca65979d57752e97812bf8e3',
  packageByteLength: 320891578,
  artifacts: Object.freeze({
    widthsSvg: Object.freeze({
      path: `${WIDTHS_ROOT}/00_Fuentes/Vectores/HATCH-A-WIDTHS-EXACT-100x80mm.svg`,
      sha256: '548cbe7ab351dfdc481f31643f5482a8391918a54ad842ef68d77447facadcbe',
    }),
    widthsCsv: Object.freeze({
      path: `${WIDTHS_ROOT}/05_Datos_Objetos/HATCH-A-WIDTHS-EXACT-map.csv`,
      sha256: '08d833e7b63327bee8d7c9422833d31808834a72bec8e36a34b34cc640ce9a08',
    }),
    widthsXlsx: Object.freeze({
      path: `${WIDTHS_ROOT}/05_Datos_Objetos/HATCH-A-WIDTHS-R01-analisis-ABCD.xlsx`,
      sha256: '4064bdc426072cb31e43fa0b26e231aae2423eacc6708620630f9bae784e0986',
    }),
    holesSvg: Object.freeze({
      path: `${HOLES_ROOT}/00_Fuentes/Vectores/HATCH-B-HOLES-EXACT-100x80mm.svg`,
      sha256: 'f9c9df2d6bcea3f61f119fabfff676684d126c9220b6ad464765565a9c7a6d83',
    }),
    holesCsv: Object.freeze({
      path: `${HOLES_ROOT}/05_Datos_Objetos/HATCH-B-HOLES-map.csv`,
      sha256: '834e518ac4bf4830141cd4e150a43e0fa86c04532ba329b8ecaac834ddfb7d57',
    }),
    holesXlsx: Object.freeze({
      path: `${HOLES_ROOT}/05_Datos_Objetos/HATCH-B-HOLES-R01-analisis.xlsx`,
      sha256: '7388d8d3cf036e0f6027031cf9f8ea118c876a2f2dae2925fcd20eac61f964f0',
    }),
  }),
  derivation: Object.freeze({
    coordinateMethod: 'SVG user units are millimetres because the 100 x 80 viewBox matches the 100 x 80 mm document.',
    quadraticMethod: 'Each exact quadratic SVG segment is retained and sampled at t = k/8 for the polygon-only Engine V2 test boundary.',
    capsuleMethod: 'The exact SVG rect and rx/ry are retained; each semicircle is sampled uniformly in 16 angular intervals.',
    circleMethod: 'Each exact H9 SVG arc circle is retained as center/radius and sampled uniformly at 32 angles including all cardinal axes.',
    runtimeDependency: 'none; fixtures are checked-in test constants and never read the 320 MB package at runtime',
  }),
});

function point(x, y) {
  return Object.freeze({ x, y });
}

function quadraticPoint(start, control, end, t) {
  const inverse = 1 - t;
  return point(
    inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  );
}

function sampleQuadraticPath(start, segments, samplesPerSegment = 8) {
  const sampled = [point(start.x, start.y)];
  let current = start;
  segments.forEach(segment => {
    for (let sampleIndex = 1; sampleIndex <= samplesPerSegment; sampleIndex += 1) {
      sampled.push(quadraticPoint(current, segment.control, segment.end, sampleIndex / samplesPerSegment));
    }
    current = segment.end;
  });
  const last = sampled.at(-1);
  if (last.x === sampled[0].x && last.y === sampled[0].y) sampled.pop();
  return Object.freeze(sampled);
}

function sampleVerticalCapsule({ x, y, width, height, radius }, semicircleIntervals = 16) {
  const centerX = x + width / 2;
  const topCenterY = y + radius;
  const bottomCenterY = y + height - radius;
  const sampled = [];
  for (let index = 0; index <= semicircleIntervals; index += 1) {
    const angle = Math.PI + Math.PI * index / semicircleIntervals;
    sampled.push(point(centerX + radius * Math.cos(angle), topCenterY + radius * Math.sin(angle)));
  }
  sampled.push(point(centerX + radius, bottomCenterY));
  for (let index = 1; index <= semicircleIntervals; index += 1) {
    const angle = Math.PI * index / semicircleIntervals;
    sampled.push(point(centerX + radius * Math.cos(angle), bottomCenterY + radius * Math.sin(angle)));
  }
  return Object.freeze(sampled);
}

function sampleCircle({ centerX, centerY, radius }, intervals = 32) {
  return Object.freeze(Array.from({ length: intervals }, (_, index) => {
    const angle = 2 * Math.PI * index / intervals;
    return point(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
  }));
}

const C6_QUADRATIC_SEGMENTS = Object.freeze([
  Object.freeze({ control: point(94, 48), end: point(94, 50) }),
  Object.freeze({ control: point(94, 52), end: point(90, 57) }),
  Object.freeze({ control: point(86, 52), end: point(86, 50) }),
  Object.freeze({ control: point(86, 48), end: point(90, 43) }),
]);

const H9_CIRCLES = Object.freeze([
  Object.freeze({ centerX: 7, centerY: 67, radius: 0.4, diameterMm: 0.8 }),
  Object.freeze({ centerX: 11, centerY: 67, radius: 0.6, diameterMm: 1.2 }),
  Object.freeze({ centerX: 15, centerY: 67, radius: 0.9, diameterMm: 1.8 }),
  Object.freeze({ centerX: 19, centerY: 67, radius: 1.25, diameterMm: 2.5 }),
]);

export const HATCH_AB_REFERENCE_FIXTURES = Object.freeze({
  A8: Object.freeze({
    id: 'A8',
    geometryFamily: 'barra_recta',
    sourceWidthMm: 8,
    sourceHeightMm: 16,
    observedHatchWidthMm: 8.04,
    svgPrimitive: Object.freeze({ type: 'rect', x: 89, y: 5, width: 8, height: 16 }),
    svgSelector: '<rect x="89.0" y="5.0" width="8.0" height="16.0">',
    sourceArtifacts: Object.freeze(['widthsSvg', 'widthsCsv', 'widthsXlsx']),
    csvRecord: 'A8,barra_recta,8.0,16.0,93,13.0',
    csvLine: 9,
    xlsxRange: 'Fila_A!A9:P9',
    geometryMm: Object.freeze([
      point(89, 5),
      point(97, 5),
      point(97, 21),
      point(89, 21),
    ]),
    holesMm: Object.freeze([]),
  }),
  C6: Object.freeze({
    id: 'C6',
    geometryFamily: 'forma_afilada',
    sourceWidthMm: 8,
    sourceHeightMm: 14,
    observedHatchWidthMm: 8.04,
    svgPathData: 'M 90 43.0 Q 94.0 48.0, 94.0 50.0 Q 94.0 52.0, 90 57.0 Q 86.0 52.0, 86.0 50.0 Q 86.0 48.0, 90 43.0 Z',
    svgQuadraticStart: point(90, 43),
    svgQuadraticSegments: C6_QUADRATIC_SEGMENTS,
    quadraticSamplesPerSegment: 8,
    sourceArtifacts: Object.freeze(['widthsSvg', 'widthsCsv', 'widthsXlsx']),
    csvRecord: 'C6,forma_afilada,8.0,14.0,90,50.0',
    csvLine: 21,
    xlsxRange: 'Fila_C!A7:Q7',
    geometryMm: sampleQuadraticPath(point(90, 43), C6_QUADRATIC_SEGMENTS),
    holesMm: Object.freeze([]),
  }),
  D6: Object.freeze({
    id: 'D6',
    geometryFamily: 'capsula',
    sourceWidthMm: 9,
    sourceHeightMm: 14,
    sourceRadiusMm: 4.5,
    observedHatchWidthMm: 9.18,
    svgPrimitive: Object.freeze({
      type: 'rect',
      x: 85.5,
      y: 62,
      width: 9,
      height: 14,
      rx: 4.5,
      ry: 4.5,
    }),
    svgSelector: '<rect x="85.5" y="62.0" width="9.0" height="14.0" rx="4.5" ry="4.5">',
    sourceArtifacts: Object.freeze(['widthsSvg', 'widthsCsv', 'widthsXlsx']),
    csvRecord: 'D6,capsula,9.0,14.0,90,69.0',
    csvLine: 27,
    xlsxRange: 'Fila_D!A7:Q7',
    geometryMm: sampleVerticalCapsule({ x: 85.5, y: 62, width: 9, height: 14, radius: 4.5 }),
    holesMm: Object.freeze([]),
  }),
  H9: Object.freeze({
    id: 'H9',
    geometryFamily: 'rectangulo_umbral_huecos',
    sourceWidthMm: 20,
    sourceHeightMm: 14,
    svgPathData: 'M 3 60 H 23 V 74 H 3 Z M 6.6 67 a 0.4 0.4 0 1 1 0.8 0 a 0.4 0.4 0 1 1 -0.8 0 M 10.4 67 a 0.6 0.6 0 1 1 1.2 0 a 0.6 0.6 0 1 1 -1.2 0 M 14.1 67 a 0.9 0.9 0 1 1 1.8 0 a 0.9 0.9 0 1 1 -1.8 0 M 17.75 67 a 1.25 1.25 0 1 1 2.5 0 a 1.25 1.25 0 1 1 -2.5 0 Z',
    sourceArtifacts: Object.freeze(['holesSvg', 'holesCsv', 'holesXlsx']),
    csvRecord: 'H9,3,1,13,67,rectangulo_umbral_huecos,20×14,"Ø0.8, Ø1.2, Ø1.8, Ø2.5",Medir el tamaño mínimo de hueco que Hatch conserva.',
    csvLine: 10,
    xlsxRange: 'Casos_H1_H12!A10:N10',
    geometryMm: Object.freeze([
      point(3, 60),
      point(23, 60),
      point(23, 74),
      point(3, 74),
    ]),
    sourceCircles: H9_CIRCLES,
    holesMm: Object.freeze(H9_CIRCLES.map(circle => sampleCircle(circle))),
    observedHatchResult: '3/4 visibles; Ø0,8 colapsa, Ø1,2+ se conservan',
  }),
});

function clonePoints(points) {
  return points.map(({ x, y }) => ({ x, y }));
}

export function createHatchReferenceRegion(referenceId) {
  const fixture = HATCH_AB_REFERENCE_FIXTURES[referenceId];
  if (!fixture) throw new Error(`Unknown Hatch reference fixture: ${referenceId}`);
  return {
    id: `hatch-reference-${referenceId.toLowerCase()}`,
    color: referenceId === 'H9' ? '#55aa66' : '#111111',
    region_class: referenceId === 'H9' ? 'body' : 'detail',
    path_points: clonePoints(fixture.geometryMm),
    holes: fixture.holesMm.map(clonePoints),
    source: {
      hatchReferenceId: referenceId,
      hatchPackageSha256: HATCH_AB_REFERENCE_SOURCE.packageSha256,
      derivationRuntimeDependency: HATCH_AB_REFERENCE_SOURCE.derivation.runtimeDependency,
    },
  };
}
