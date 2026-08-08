import { createSemanticRegionAssessmentV2 } from '../../semantics/semanticRoleModel.js';

const PACKAGE_ROOT = 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F';
const OVERLAPS_ROOT = `${PACKAGE_ROOT}/03_SOLAPES`;
const CURVE_INTERVALS = 32;
const ROUNDED_CORNER_INTERVALS = 8;

export const HATCH_C_REFERENCE_DESIGN_MM = Object.freeze({ width: 100, height: 80 });

export const HATCH_C_REFERENCE_SOURCE = Object.freeze({
  packageName: 'PAQUETE_MAESTRO_STITCHPATH_HATCH_A_F.zip',
  packageSha256: 'd2ca1f36db18a6d48fe8d471f66d4cf1f96e2804ca65979d57752e97812bf8e3',
  packageByteLength: 320891578,
  artifacts: Object.freeze({
    overlapsSvg: Object.freeze({
      path: `${OVERLAPS_ROOT}/00_Fuentes/Vectores/HATCH-C-OVERLAPS-EXACT-100x80mm.svg`,
      sha256: '08aff6f030fa7850e7e3f5a7e19113dc42a7d322835f5b382c0b45f5769dbc6b',
    }),
    overlapsCsv: Object.freeze({
      path: `${OVERLAPS_ROOT}/05_Datos_Objetos/HATCH-C-OVERLAPS-map.csv`,
      sha256: '2615f1a4cb62fbba70f5324c2f864baed70c1e784f682342e8abcdbb6b69c921',
    }),
    overlapsXlsx: Object.freeze({
      path: `${OVERLAPS_ROOT}/05_Datos_Objetos/HATCH-C-OVERLAPS-R01-analisis.xlsx`,
      sha256: '3a80a22334c2c403fd8759dc25717b3a788fc853d6027d4c54796c09d91f4851',
    }),
  }),
  derivation: Object.freeze({
    coordinateMethod: 'SVG user units are millimetres because the 100 x 80 viewBox matches the 100 x 80 mm document.',
    curveContract: 'Reuses the checked-in Hatch A/B fixture contract: circles and ellipses use 32 uniform angular intervals; each rounded-rectangle quarter uses 8 intervals, equal to 32 intervals per full circle.',
    maximumChordDeviationMm: 0.03,
    semanticRoleMethod: 'Roles come from the closed reference and are supplied explicitly to the planning pipeline; this fixture does not test image-to-role semantic discovery.',
    c7HoleMethod: 'The exact white C7 circle is supplied as an explicit fixture hole; no production white classification or cutout is performed.',
    runtimeDependency: 'none; fixtures are checked-in test constants and never read the 320 MB package at runtime',
  }),
});

function point(x, y) {
  return Object.freeze({ x, y });
}

function sampleEllipse({ centerX, centerY, radiusX, radiusY }, intervals = CURVE_INTERVALS) {
  return Object.freeze(Array.from({ length: intervals }, (_, index) => {
    const angle = 2 * Math.PI * index / intervals;
    return point(
      centerX + radiusX * Math.cos(angle),
      centerY + radiusY * Math.sin(angle),
    );
  }));
}

function sampleRoundedRect({ x, y, width, height, rx = 0, ry = rx }, intervals = ROUNDED_CORNER_INTERVALS) {
  if (rx === 0 || ry === 0) {
    return Object.freeze([
      point(x, y),
      point(x + width, y),
      point(x + width, y + height),
      point(x, y + height),
    ]);
  }
  const corners = [
    { centerX: x + width - rx, centerY: y + ry, start: -Math.PI / 2 },
    { centerX: x + width - rx, centerY: y + height - ry, start: 0 },
    { centerX: x + rx, centerY: y + height - ry, start: Math.PI / 2 },
    { centerX: x + rx, centerY: y + ry, start: Math.PI },
  ];
  const sampled = [point(x + rx, y)];
  corners.forEach(corner => {
    for (let index = 1; index <= intervals; index += 1) {
      const angle = corner.start + Math.PI / 2 * index / intervals;
      sampled.push(point(
        corner.centerX + rx * Math.cos(angle),
        corner.centerY + ry * Math.sin(angle),
      ));
    }
  });
  sampled.pop();
  return Object.freeze(sampled);
}

const circle = (centerX, centerY, radius) => Object.freeze({
  type: 'circle',
  centerX,
  centerY,
  radius,
});

const ellipse = (centerX, centerY, radiusX, radiusY) => Object.freeze({
  type: 'ellipse',
  centerX,
  centerY,
  radiusX,
  radiusY,
});

const roundedRect = (x, y, width, height, rx = 0, fill) => Object.freeze({
  type: 'rect',
  x,
  y,
  width,
  height,
  rx,
  fill,
});

const C7_BASE = roundedRect(54, 33, 18, 14, 2, '#2e7d32');
const C7_BLACK = Object.freeze({ ...circle(63, 40, 4), fill: '#111111' });
const C7_WHITE = Object.freeze({ ...circle(63, 40, 3), fill: '#ffffff' });
const C8_BLACK = roundedRect(79, 33, 18, 14, 2, '#111111');
const C8_ORANGE = roundedRect(80.2, 34.2, 15.6, 11.6, 1.2, '#f57c00');
const C11_GREEN = roundedRect(54, 60, 9, 14, 0, '#2e7d32');
const C11_ORANGE = roundedRect(63, 60, 9, 14, 0, '#f57c00');
const C11_BLACK = roundedRect(62.4, 60, 1.2, 14, 0, '#111111');
const C12_GREEN = roundedRect(79, 60, 18, 14, 2, '#2e7d32');
const C12_BLACK = Object.freeze({ ...ellipse(88, 67, 5.5, 4), fill: '#111111' });
const C12_WHITE = Object.freeze({ ...ellipse(88, 67, 4.5, 3), fill: '#dedede' });
const C12_ORANGE = Object.freeze({ ...circle(88, 67, 1.5), fill: '#f57c00' });

function geometryFor(primitive) {
  if (primitive.type === 'rect') return sampleRoundedRect(primitive);
  if (primitive.type === 'circle') {
    return sampleEllipse({
      centerX: primitive.centerX,
      centerY: primitive.centerY,
      radiusX: primitive.radius,
      radiusY: primitive.radius,
    });
  }
  return sampleEllipse(primitive);
}

export const HATCH_C_REFERENCE_FIXTURES = Object.freeze({
  C7: Object.freeze({
    id: 'C7',
    geometryFamily: 'base_mas_anillo_negro_y_hueco',
    sourceArtifacts: Object.freeze(['overlapsSvg', 'overlapsCsv', 'overlapsXlsx']),
    svgPrimitives: Object.freeze([C7_BASE, C7_BLACK, C7_WHITE]),
    svgSourceLines: Object.freeze([
      '<rect x="54" y="33" width="18" height="14" rx="2" fill="#2e7d32"/>',
      '<circle cx="63" cy="40" r="4" fill="#111111"/>',
      '<circle cx="63" cy="40" r="3" fill="#ffffff"/>',
    ]),
    csvRecord: 'C7,2,3,63,40,base_mas_anillo_negro_y_hueco,2,"verde|negro|blanco_fondo",verde_recortado_alrededor_de_contorno_y_tela,"Comprobar recorte del verde y preservación del hueco protegido."',
    csvLine: 8,
    xlsxRanges: Object.freeze(['Casos C1-C12!A11:H11', 'Secuencia!A9:G9', 'Secuencia!A29:G29']),
    expectedRegionOrder: Object.freeze(['hatch-c7-01-green-base', 'hatch-c7-99-black-outline']),
    regions: Object.freeze([
      Object.freeze({
        id: 'hatch-c7-01-green-base',
        role: 'primary_shape',
        color: '#2e7d32',
        regionClass: 'body',
        geometryMm: geometryFor(C7_BASE),
        holesMm: Object.freeze([geometryFor(C7_WHITE)]),
      }),
      Object.freeze({
        id: 'hatch-c7-99-black-outline',
        role: 'dark_mark',
        color: '#111111',
        regionClass: 'outer outline',
        geometryMm: geometryFor(C7_BLACK),
        holesMm: Object.freeze([]),
        explicitOutline: true,
      }),
    ]),
  }),
  C8: Object.freeze({
    id: 'C8',
    geometryFamily: 'relleno_con_marco_exterior',
    sourceArtifacts: Object.freeze(['overlapsSvg', 'overlapsCsv', 'overlapsXlsx']),
    svgPrimitives: Object.freeze([C8_BLACK, C8_ORANGE]),
    svgSourceLines: Object.freeze([
      '<rect x="79" y="33" width="18" height="14" rx="2" fill="#111111"/>',
      '<rect x="80.2" y="34.2" width="15.6" height="11.6" rx="1.2" fill="#f57c00"/>',
    ]),
    csvRecord: 'C8,2,4,88,40,relleno_con_marco_exterior,2,"naranja|negro",contorno_alrededor_de_relleno,"Determinar si el relleno se ejecuta antes que el contorno y si existe solape útil."',
    csvLine: 9,
    xlsxRanges: Object.freeze(['Casos C1-C12!A12:H12', 'Secuencia!A28:G28', 'Secuencia!A32:G32']),
    expectedRegionOrder: Object.freeze(['hatch-c8-01-orange-fill', 'hatch-c8-99-black-outline']),
    regions: Object.freeze([
      Object.freeze({
        id: 'hatch-c8-01-orange-fill',
        role: 'secondary_shape',
        color: '#f57c00',
        regionClass: 'face',
        geometryMm: geometryFor(C8_ORANGE),
        holesMm: Object.freeze([]),
      }),
      Object.freeze({
        id: 'hatch-c8-99-black-outline',
        role: 'dark_mark',
        color: '#111111',
        regionClass: 'outer outline',
        geometryMm: geometryFor(C8_BLACK),
        holesMm: Object.freeze([]),
        explicitOutline: true,
      }),
    ]),
  }),
  C11: Object.freeze({
    id: 'C11',
    geometryFamily: 'dos_rellenos_mas_banda_negra',
    sourceArtifacts: Object.freeze(['overlapsSvg', 'overlapsCsv', 'overlapsXlsx']),
    svgPrimitives: Object.freeze([C11_GREEN, C11_ORANGE, C11_BLACK]),
    svgSourceLines: Object.freeze([
      '<rect x="54" y="60" width="9" height="14" fill="#2e7d32"/>',
      '<rect x="63" y="60" width="9" height="14" fill="#f57c00"/>',
      '<rect x="62.4" y="60" width="1.2" height="14" fill="#111111"/>',
    ]),
    csvRecord: 'C11,3,3,63,67,dos_rellenos_mas_banda_negra,3,"verde|naranja|negro",contorno_sobre_borde_compartido,"Comprobar que ambos rellenos preceden al contorno y medir cobertura en la frontera."',
    csvLine: 12,
    xlsxRanges: Object.freeze(['Casos C1-C12!A15:H15', 'Secuencia!A8:G8', 'Secuencia!A22:G22', 'Secuencia!A31:G31']),
    expectedRegionOrder: Object.freeze(['hatch-c11-01-green-fill', 'hatch-c11-02-orange-fill', 'hatch-c11-99-black-outline']),
    regions: Object.freeze([
      Object.freeze({
        id: 'hatch-c11-01-green-fill',
        role: 'primary_shape',
        color: '#2e7d32',
        regionClass: 'body',
        geometryMm: geometryFor(C11_GREEN),
        holesMm: Object.freeze([]),
      }),
      Object.freeze({
        id: 'hatch-c11-02-orange-fill',
        role: 'secondary_shape',
        color: '#f57c00',
        regionClass: 'face',
        geometryMm: geometryFor(C11_ORANGE),
        holesMm: Object.freeze([]),
      }),
      Object.freeze({
        id: 'hatch-c11-99-black-outline',
        role: 'dark_mark',
        color: '#111111',
        regionClass: 'outer outline',
        geometryMm: geometryFor(C11_BLACK),
        holesMm: Object.freeze([]),
        explicitOutline: true,
      }),
    ]),
  }),
  C12: Object.freeze({
    id: 'C12',
    geometryFamily: 'base_anillo_blanco_y_acento',
    sourceArtifacts: Object.freeze(['overlapsSvg', 'overlapsCsv', 'overlapsXlsx']),
    svgPrimitives: Object.freeze([C12_GREEN, C12_BLACK, C12_WHITE, C12_ORANGE]),
    svgSourceLines: Object.freeze([
      '<rect x="79" y="60" width="18" height="14" rx="2" fill="#2e7d32"/>',
      '<ellipse cx="88" cy="67" rx="5.5" ry="4" fill="#111111"/>',
      '<ellipse cx="88" cy="67" rx="4.5" ry="3" fill="#dedede"/>',
      '<circle cx="88" cy="67" r="1.5" fill="#f57c00"/>',
    ]),
    csvRecord: 'C12,3,4,88,67,base_anillo_blanco_y_acento,4,"verde|negro|gris_claro|naranja",pila_compleja_base_contorno_blanco_acento,"Analizar orden multicapas, recorte, contorno y riesgo de acumulación de densidad."',
    csvLine: 13,
    xlsxRanges: Object.freeze(['Casos C1-C12!A16:H16', 'Secuencia!A9:G9', 'Secuencia!A20:G21', 'Secuencia!A30:G30']),
    expectedRegionOrder: Object.freeze([
      'hatch-c12-01-green-fill',
      'hatch-c12-02-white-fill',
      'hatch-c12-03-orange-detail',
      'hatch-c12-99-black-outline',
    ]),
    regions: Object.freeze([
      Object.freeze({
        id: 'hatch-c12-01-green-fill',
        role: 'primary_shape',
        color: '#2e7d32',
        regionClass: 'body',
        geometryMm: geometryFor(C12_GREEN),
        holesMm: Object.freeze([]),
      }),
      Object.freeze({
        id: 'hatch-c12-02-white-fill',
        role: 'secondary_shape',
        color: '#dedede',
        regionClass: 'face',
        geometryMm: geometryFor(C12_WHITE),
        holesMm: Object.freeze([]),
      }),
      Object.freeze({
        id: 'hatch-c12-03-orange-detail',
        role: 'secondary_shape',
        color: '#f57c00',
        regionClass: 'detail',
        geometryMm: geometryFor(C12_ORANGE),
        holesMm: Object.freeze([]),
      }),
      Object.freeze({
        id: 'hatch-c12-99-black-outline',
        role: 'dark_mark',
        color: '#111111',
        regionClass: 'outer outline',
        geometryMm: geometryFor(C12_BLACK),
        holesMm: Object.freeze([]),
        explicitOutline: true,
      }),
    ]),
    cutoutCorrectnessClaimed: false,
  }),
});

function clonePoints(points) {
  return points.map(({ x, y }) => ({ x, y }));
}

export function createHatchCReferenceRegions(referenceId) {
  const fixture = HATCH_C_REFERENCE_FIXTURES[referenceId];
  if (!fixture) throw new Error(`Unknown Hatch C reference fixture: ${referenceId}`);
  return fixture.regions.map(region => ({
    id: region.id,
    color: region.color,
    region_class: region.regionClass,
    path_points: clonePoints(region.geometryMm),
    holes: region.holesMm.map(clonePoints),
    darkStrokeSupport: region.explicitOutline
      ? { available: true, ratio: 1, source: 'hatch-c-reference-fixture' }
      : { available: false, ratio: 0, source: 'hatch-c-reference-fixture' },
    source: {
      hatchReferenceId: referenceId,
      hatchPackageSha256: HATCH_C_REFERENCE_SOURCE.packageSha256,
      derivationRuntimeDependency: HATCH_C_REFERENCE_SOURCE.derivation.runtimeDependency,
      ...(region.explicitOutline ? { outlineIntent: 'outer outline' } : {}),
    },
  }));
}

export function createHatchCReferenceSemanticResult(regions, referenceId) {
  const fixture = HATCH_C_REFERENCE_FIXTURES[referenceId];
  const roleByRegionId = Object.fromEntries(fixture.regions.map(region => [region.id, region.role]));
  const assessments = regions.map(region => createSemanticRegionAssessmentV2({
    regionId: region.id,
    semanticRole: roleByRegionId[region.id],
    confidence: 0.98,
    evidence: [{
      code: 'HATCH_C_REFERENCE_FIXTURE',
      message: `Derived from exact ${referenceId} SVG/CSV/XLSX sources.`,
    }],
  }));
  return {
    assessments,
    byRegionId: Object.fromEntries(assessments.map(assessment => [assessment.regionId, assessment])),
    valid: true,
    errors: [],
    warnings: [],
  };
}
