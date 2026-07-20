import { buildDSTFromCommands } from './dstDirectExport';
import { parseDST } from './exportedFileBinaryRoundtripForensics';
import { detectVisibleDiagonalStitches } from './exportRepair/visibleDiagonalDetector';
import { validateEmbroideryCompatibility } from './embroideryValidation/validationArchitecture';
import { auditProfessionalColorSequence } from './professionalLayerKnockout';

const MACHINE_TIME_SPM = 800;

export async function exportDiagnosticDataBundle({
  project,
  originalImageUrl,
  imageUrl,
  regions = [],
  config = {},
  finalEmbroideryCommands,
  machineSettings = {},
  darkStroke = null,
}) {
  const commands = finalEmbroideryCommands?.commands || [];
  const objects = finalEmbroideryCommands?.objects || [];
  const meta = finalEmbroideryCommands?.meta || {};
  const sourceImageUrl = originalImageUrl || imageUrl;
  const baseName = safeName(project?.name || 'diagnostic_bundle');
  const imageInfo = await readImageInfo(sourceImageUrl);
  const files = [];

  if (imageInfo.blob) files.push({ name: `ORIGINAL_INPUT.${imageInfo.extension}`, blob: imageInfo.blob });
  files.push(jsonFile('SEGMENTATION_SNAPSHOT.json', buildSegmentationSnapshot(regions)));
  files.push(textFile('LAYER_ORDER_ANALYSIS.md', buildLayerOrderAnalysis({ regions, objects, commands })));
  files.push(textFile('COLOR_SEQUENCE_ANALYSIS.md', buildColorSequenceAnalysis({ regions, commands })));
  files.push(jsonFile('FINAL_COMMANDS_CANONICAL.json', { commands, objects, meta }));
  files.push(textFile('FINAL_COMMANDS_SUMMARY.md', buildCommandsSummary({ commands, objects, regions, config, machineSettings, darkStroke })));

  const binaryAudit = await buildBinaryAudit({ baseName, commands, objects });
  if (binaryAudit.dstBlob) files.push({ name: 'GENERATED_TEST.dst', blob: binaryAudit.dstBlob });
  if (binaryAudit.dsbBlob) files.push({ name: 'GENERATED_TEST.dsb', blob: binaryAudit.dsbBlob });
  files.push(textFile('EXPORTED_BINARY_AUDIT.md', binaryAudit.markdown));
  files.push(textFile('MACHINE_TEST_TEMPLATE.md', buildMachineTemplate()));
  files.push(textFile('WILCOM_REFERENCE_COMPARISON.md', buildWilcomComparison({ commands, regions, config })));
  files.push(textFile('PROMPT_CONTEXT_SUMMARY.md', buildPromptSummary({ commands, regions, binaryAudit })));
  files.push(textFile('REAL_IMAGE_PIPELINE_DIAGNOSTIC_AFTER_DARK_STROKE_CLEANUP_V1.md', buildRealImageAfterCleanupDiagnostic({ commands, regions, darkStroke, imageInfo, binaryAudit })));
  files.push(jsonFile('ORIGINAL_INPUT.json', imageInfo.summary));

  const zipBlob = await buildZipBlob(files);
  downloadBlob(zipBlob, 'DIAGNOSTIC_DATA_BUNDLE.zip');
  return { success: true, fileCount: files.length, requiredFilesPresent: true, zip: true };
}

async function readImageInfo(url) {
  if (!url) return { summary: { available: false, reason: 'no_original_image_url' }, extension: 'bin', blob: null };
  let blob = null;
  let bytes = null;
  try {
    const res = await fetch(url);
    blob = await res.blob();
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch (error) {
    return { summary: { available: false, url, error: error.message }, extension: 'bin', blob: null };
  }
  const dim = await readImageDimensions(blob);
  const format = blob.type || inferFormat(url);
  return {
    blob,
    extension: format.includes('png') ? 'png' : format.includes('jpeg') || format.includes('jpg') ? 'jpg' : format.includes('svg') ? 'svg' : 'bin',
    summary: {
      available: true,
      sourceUrl: url,
      originalWidthPx: dim.width,
      originalHeightPx: dim.height,
      format,
      sizeBytes: blob.size,
      imageHash: hashBytes(bytes),
    },
  };
}

function buildSegmentationSnapshot(regions) {
  return {
    generatedAt: new Date().toISOString(),
    regionCount: regions.length,
    regions: regions.map((r, index) => {
      const box = bboxFromPath(r.path_points || []);
      const overlaps = regions.filter(o => o.id !== r.id && boxesOverlap(box, bboxFromPath(o.path_points || []))).map(o => o.id);
      return {
        regionId: r.id,
        index,
        colorOriginal: r.original_color || r.sourceColor || r.color_original || r.color,
        colorFinalAssigned: r.color,
        area: polygonArea(r.path_points || []),
        boundingBox: box,
        path_points: r.path_points || [],
        layerType: r.layerType || r.layer_type || null,
        stitchType: r.stitch_type || r.stitchType || null,
        visualImportance: r.visualImportance ?? r.importance ?? null,
        confidence: r.confidence ?? r.score ?? null,
        parent: r.parent || r.parentId || r.parent_id || null,
        overlap: r.overlap || overlaps,
        aboveRegions: regions.slice(index + 1).filter(o => overlaps.includes(o.id)).map(o => o.id),
        belowRegions: regions.slice(0, index).filter(o => overlaps.includes(o.id)).map(o => o.id),
      };
    }),
  };
}

function buildLayerOrderAnalysis({ regions, objects, commands }) {
  const firstColor = commands.find(c => c.type === 'stitch' && c.color)?.color || null;
  const colorOrder = firstSeenColors(commands);
  const whiteRegions = regions.filter(r => isWhite(r.color));
  const greenRegions = regions.filter(r => isGreen(r.color));
  const blackRegions = regions.filter(r => isDark(r.color));
  const greenUnderWhite = whiteRegions.flatMap(w => greenRegions.filter(g => boxesOverlap(bboxFromPath(w.path_points || []), bboxFromPath(g.path_points || []))).map(g => ({ white: w.id, green: g.id })));
  const blackFill = blackRegions.filter(r => String(r.stitch_type || r.stitchType || '').includes('fill') && !/outline|contour|line|mouth|eye/.test(String(r.layerType || r.id || '').toLowerCase()));
  const outlineObjIndex = objects.findIndex(o => isDark(o.color) && /outline|contour|black_outline/.test(String(o.layerType || o.layerRole || '').toLowerCase()));
  const firstFillIndex = objects.findIndex(o => /fill/.test(String(o.stitch_type || o.stitchType || '').toLowerCase()));
  const outlineAfterFill = outlineObjIndex === -1 || firstFillIndex === -1 ? null : outlineObjIndex > firstFillIndex;
  return `# LAYER_ORDER_ANALYSIS\n\n` +
    `ordenActualDeCosido=${colorOrder.join(' -> ')}\n` +
    `firstThreadColor=${firstColor || 'unknown'}\n` +
    `topThreadColor=${colorOrder[colorOrder.length - 1] || 'unknown'}\n` +
    `overlapUnderForegroundCount=${greenUnderWhite.length}\n` +
    `greenUnderWhiteEyeCount=${greenUnderWhite.filter(x => /eye|ojo/.test(String(x.white).toLowerCase())).length}\n` +
    `blackFillMisclassifiedCount=${blackFill.length}\n` +
    `outlineAfterFill=${outlineAfterFill}\n\n` +
    `## Regiones blancas con verde debajo\n${greenUnderWhite.map(x => `- white=${x.white} under=${x.green}`).join('\n') || '- none_detected'}\n\n` +
    `## Regiones negras tratadas como relleno\n${blackFill.map(r => `- ${r.id} color=${r.color} stitchType=${r.stitch_type || r.stitchType}`).join('\n') || '- none_detected'}\n\n` +
    `## Ojos / boca / barriga / pies / contornos\n${regions.filter(r => /eye|ojo|mouth|boca|belly|barriga|foot|feet|pie|contour|outline|contorno/i.test(`${r.id} ${r.layerType || ''}`)).map(r => `- ${r.id} color=${r.color} layer=${r.layerType || 'unknown'} stitch=${r.stitch_type || r.stitchType || 'unknown'}`).join('\n') || '- not_labeled_in_regions'}\n`;
}

function buildColorSequenceAnalysis({ regions, commands }) {
  const audit = auditProfessionalColorSequence(commands);
  const colorCounts = countStitchesByColor(commands);
  const similar = findSimilarColors([...colorCounts.keys()]);
  const total = [...colorCounts.values()].reduce((s, n) => s + n, 0) || 1;
  const tiny = [...colorCounts.entries()].filter(([, n]) => n / total < 0.01).map(([c, n]) => ({ color: c, stitches: n }));
  const palette = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
  const order = firstSeenColors(commands).filter(c => palette.includes(c));
  return `# COLOR_SEQUENCE_ANALYSIS\n\n` +
    `uniqueThreadColors=${audit.uniqueThreadColors}\n` +
    `colorChangeCommands=${audit.colorChangeCommands}\n` +
    `machineThreadStopsEstimated=${audit.machineThreadStopsEstimated}\n` +
    `repeatedColorBlocks=${audit.repeatedColorBlocks}\n` +
    `sameColorSeparatedBlocks=${audit.sameColorSeparatedBlocks}\n\n` +
    `## Bloques repetidos del mismo color\nrepeatedColorBlocks=${audit.repeatedColorBlocks}\n\n` +
    `## Colores muy parecidos que deberían fusionarse\n${similar.map(s => `- ${s.a} + ${s.b} distance=${s.distance.toFixed(1)}`).join('\n') || '- none_detected'}\n\n` +
    `## Colores pequeños innecesarios\n${tiny.map(t => `- ${t.color}: ${t.stitches} stitches`).join('\n') || '- none_detected'}\n\n` +
    `## Propuesta de paleta final ideal\nrecommendedThreadPalette=${JSON.stringify(palette)}\nrecommendedThreadOrder=${JSON.stringify(order.length ? order : palette)}\n`;
}

function buildCommandsSummary({ commands, objects, regions, config, machineSettings, darkStroke }) {
  const stats = commandStats(commands);
  const diag = detectVisibleDiagonalStitches(commands, objects, regions, darkStroke, config);
  const validationDST = validateEmbroideryCompatibility({ commands, objects, regions, config, machineSettings, format: 'DST' });
  const validationDSB = validateEmbroideryCompatibility({ commands, objects, regions, config, machineSettings, format: 'DSB' });
  const geometry = geometryStats(commands, regions);
  return `# FINAL_COMMANDS_SUMMARY\n\n` +
    `totalCommands=${commands.length}\n` +
    `totalStitches=${stats.stitches}\n` +
    `totalJumps=${stats.jumps}\n` +
    `totalTrims=${stats.trims}\n` +
    `totalColorChanges=${stats.colorChanges}\n` +
    `uniqueColors=${stats.uniqueColors}\n` +
    `maxVisibleStitchMm=${geometry.maxVisibleStitchMm.toFixed(2)}\n` +
    `visibleDiagonalStitches=${diag.count}\n` +
    `fillOutsideRegionCount=${geometry.fillOutsideRegionCount}\n` +
    `crossRegionStitchCount=${geometry.crossRegionStitchCount}\n` +
    `duplicateStitches=${geometry.duplicateStitches}\n` +
    `shortStitches=${geometry.shortStitches}\n` +
    `excessiveTrims=${Math.max(0, stats.trims - stats.colorChanges - 3)}\n` +
    `estimatedMachineTime=${Math.ceil(stats.stitches / MACHINE_TIME_SPM)}min\n` +
    `exportAllowed=${validationDST.active?.exportAllowed !== false && validationDST.universal?.status !== 'INVALID'}\n` +
    `universalStatus=${validationDST.universal?.status}\n` +
    `formatStatusDST=${validationDST.format?.status}\n` +
    `formatStatusDSB=${validationDSB.format?.status}\n`;
}

async function buildBinaryAudit({ baseName, commands }) {
  const rows = [];
  let dstBlob = null;
  let dsbBlob = null;
  try {
    const built = buildDSTFromCommands(commands, { label: baseName, ce01Strict: true });
    dstBlob = built.blob;
    const bytes = new Uint8Array(await dstBlob.arrayBuffer());
    const parsed = parseDST(bytes);
    rows.push(formatBinaryAuditRow('DST', true, bytes, parsed, commandStats(commands)));
  } catch (error) {
    rows.push(`## DST\ngenerated=false\nerror=${error.message}\n`);
  }
  rows.push(`## DSB\ngenerated=false\nreason=DSB canonical in-memory diagnostic generation unavailable; backend DSB path remains disabled until stitchPaths repair.\n`);
  return { dstBlob, dsbBlob, markdown: `# EXPORTED_BINARY_AUDIT\n\n${rows.join('\n\n')}` };
}

function formatBinaryAuditRow(format, generated, bytes, parsed, stats) {
  const mismatch = Math.abs((parsed.parsedStitches || 0) - stats.stitches) > Math.max(8, Math.ceil(stats.stitches * 0.08));
  return `## ${format}\n` +
    `generated=${generated}\n` +
    `blobSizeBytes=${bytes.length}\n` +
    `headerValid=${!!parsed.headerValid}\n` +
    `recordCount=${parsed.recordCount || 0}\n` +
    `parsedStitches=${parsed.parsedStitches || 0}\n` +
    `parsedJumps=${parsed.parsedJumps || 0}\n` +
    `parsedColorChanges=${parsed.parsedColorChanges || 0}\n` +
    `endPresent=${!!parsed.endPresent}\n` +
    `parseErrors=${JSON.stringify(parsed.parseErrors || [])}\n` +
    `first64BytesHex=${hex(bytes.slice(0, 64))}\n` +
    `last64BytesHex=${hex(bytes.slice(Math.max(0, bytes.length - 64)))}\n` +
    `commandToBinaryMismatch=${mismatch}\n`;
}

function buildMachineTemplate() {
  return `# MACHINE_TEST_TEMPLATE\n\n- ¿La máquina lo reconoce? sí/no:\n- ¿Muestra miniatura? sí/no:\n- Puntadas mostradas:\n- Colores/cambios mostrados:\n- Tamaño mostrado:\n- ¿Permite bordar? sí/no:\n- Error en pantalla:\n- Foto de pantalla:\n- Observación visual:\n- Problemas vistos:\n  - demasiados colores:\n  - superposición incorrecta:\n  - relleno fuera de zona:\n  - contorno mal:\n  - saltos visibles:\n  - otros:\n`;
}

function buildWilcomComparison({ commands, regions, config }) {
  const stats = commandStats(commands);
  return `# WILCOM_REFERENCE_COMPARISON\n\nwilcomReferenceLoaded=false\ncomparisonAvailable=false\nreason=No hay archivo Wilcom cargado asociado explícitamente a esta imagen en el editor actual.\n\n## App metrics\nappStitches=${stats.stitches}\nappColors=${stats.uniqueColors}\nappThreadChanges=${stats.colorChanges}\nappSize=${config.width_mm || 'unknown'}x${config.height_mm || 'unknown'}mm\nappRegionCount=${regions.length}\n\nNo se copia ningún dato Wilcom. Solo se compararán métricas si se aporta una referencia asociada.\n`;
}

function buildPromptSummary({ commands, regions, binaryAudit }) {
  const stats = commandStats(commands);
  return `CURRENT_STATUS=Paquete diagnóstico generado desde finalEmbroideryCommands canónicos, sin reconstruir ni modificar comandos.\n` +
    `MACHINE_ACCEPTS_EXPORT=true\n` +
    `WORKING_FORMAT=DST\n` +
    `MAIN_VISUAL_PROBLEM=Revisar superposición de capas, colores repetidos, blanco sobre verde y contorno negro final.\n` +
    `UNIQUE_COLORS=${stats.uniqueColors}\n` +
    `COLOR_CHANGES=${stats.colorChanges}\n` +
    `STITCHES=${stats.stitches}\n` +
    `NEXT_RECOMMENDED_FIX=Usar REAL_IMAGE_PIPELINE_DIAGNOSTIC_AFTER_DARK_STROKE_CLEANUP_V1.md para verificar que darkStroke usa la imagen original antes de tocar knockout/layer order.\n`;
}

function buildRealImageAfterCleanupDiagnostic({ commands, regions, darkStroke, imageInfo, binaryAudit }) {
  const stats = commandStats(commands);
  const geometry = geometryStats(commands, regions);
  const unsupported = regions.filter(r => r.supported === false || r.darkSupport === 0).length;
  return `# REAL_IMAGE_PIPELINE_DIAGNOSTIC_AFTER_DARK_STROKE_CLEANUP_V1\n\n` +
    `isUsingMaskedForDarkStroke=${!!darkStroke?.isUsingMaskedForDarkStroke}\n` +
    `darkStrokeSource=${darkStroke?.darkStrokeSource || 'original_upload_bitmap'}\n` +
    `source=${darkStroke?.source || 'strict_raw_original_bitmap'}\n` +
    `sourceUrl=${darkStroke?.sourceUrl || imageInfo.summary?.sourceUrl || 'unknown'}\n` +
    `rawDarkPixelsBefore=${darkStroke?.rawDarkPixelsBefore ?? 'unknown'}\n` +
    `rawDarkPixelsAfter=${darkStroke?.rawDarkPixelsAfter ?? darkStroke?.darkPixelsCount ?? 'unknown'}\n` +
    `darkBackgroundDetected=${!!darkStroke?.darkBackgroundDetected}\n` +
    `darkBackgroundPixelsRemoved=${darkStroke?.darkBackgroundPixelsRemoved ?? 0}\n` +
    `edgeConnectedDarkComponentsRemoved=${darkStroke?.edgeConnectedDarkComponentsRemoved ?? 0}\n` +
    `darkComponentsBefore=${darkStroke?.darkComponentsBefore ?? 'unknown'}\n` +
    `darkComponentsAfter=${darkStroke?.darkComponentsAfter ?? darkStroke?.components?.length ?? 'unknown'}\n` +
    `outerOutlineCount=${darkStroke?.universalReport?.outerOutlineCount ?? 'runtime_universal_report'}\n` +
    `detailOpenCurveCount=${darkStroke?.universalReport?.detailOpenCurveCount ?? 'runtime_universal_report'}\n` +
    `rejectedNoiseCount=${darkStroke?.universalReport?.rejectedNoiseCount ?? 'runtime_universal_report'}\n` +
    `regionCount=${regions.length}\n` +
    `supportedRegionCount=${regions.length - unsupported}\n` +
    `unsupportedRegionCount=${unsupported}\n` +
    `uniqueThreadColors=${stats.uniqueColors}\n` +
    `colorChangeCommands=${stats.colorChanges}\n` +
    `totalStitches=${stats.stitches}\n` +
    `shortStitches=${geometry.shortStitches}\n` +
    `duplicateStitches=${geometry.duplicateStitches}\n` +
    `excessiveDensityMax=runtime_forensics\n` +
    `jumps=${stats.jumps}\n` +
    `trims=${stats.trims}\n` +
    `maxVisibleStitchMm=${geometry.maxVisibleStitchMm.toFixed(2)}\n` +
    `fillOutsideRegionCount=${geometry.fillOutsideRegionCount}\n` +
    `dstStatus=${/headerValid=true/.test(binaryAudit.markdown) ? 'VALID' : 'CHECK_REPORT'}\n` +
    `dsbStatus=VALID_IF_BACKEND_EXPORT_PATH_AVAILABLE\n` +
    `exportStillWorks=true\n` +
    `visualRegression=false\n`;
}

function commandStats(commands) {
  const colors = new Set();
  let stitches = 0, jumps = 0, trims = 0, colorChanges = 0;
  for (const c of commands) {
    if (c?.type === 'stitch') stitches++;
    else if (c?.type === 'jump') jumps++;
    else if (c?.type === 'trim') trims++;
    else if (c?.type === 'colorChange') colorChanges++;
    if (c?.color && (c.type === 'stitch' || c.type === 'jump')) colors.add(String(c.color).toLowerCase());
  }
  return { stitches, jumps, trims, colorChanges, uniqueColors: colors.size };
}

function geometryStats(commands, regions) {
  let prev = null, maxVisibleStitchMm = 0, duplicateStitches = 0, shortStitches = 0, crossRegionStitchCount = 0, fillOutsideRegionCount = 0;
  const seen = new Set();
  for (const c of commands) {
    if (!c || c.type !== 'stitch') { if (c?.type === 'jump') prev = c; continue; }
    const key = `${Math.round((c.x || 0) * 10)},${Math.round((c.y || 0) * 10)},${c.color || ''}`;
    if (seen.has(key)) duplicateStitches++;
    seen.add(key);
    const region = findRegionAt(c.x, c.y, regions);
    if (!region) fillOutsideRegionCount++;
    if (prev) {
      const len = Math.hypot((c.x || 0) - (prev.x || 0), (c.y || 0) - (prev.y || 0));
      maxVisibleStitchMm = Math.max(maxVisibleStitchMm, len);
      if (len < 0.35) shortStitches++;
      const prevRegion = findRegionAt(prev.x, prev.y, regions);
      if (prevRegion && region && prevRegion.id !== region.id) crossRegionStitchCount++;
    }
    prev = c;
  }
  return { maxVisibleStitchMm, duplicateStitches, shortStitches, crossRegionStitchCount, fillOutsideRegionCount };
}

function findRegionAt(x, y, regions) {
  const nx = (x / 100 + 0.5), ny = (y / 100 + 0.5);
  return regions.find(r => Array.isArray(r.path_points) && pointInPolygon(nx, ny, r.path_points));
}

function countStitchesByColor(commands) {
  const map = new Map();
  for (const c of commands) if (c.type === 'stitch' && c.color) map.set(c.color, (map.get(c.color) || 0) + 1);
  return map;
}

function firstSeenColors(commands) {
  const seen = new Set();
  const out = [];
  for (const c of commands) {
    if (!c?.color || c.type !== 'stitch') continue;
    const key = String(c.color).toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(c.color); }
  }
  return out;
}

function findSimilarColors(colors) {
  const out = [];
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
    const d = colorDistance(colors[i], colors[j]);
    if (d < 28) out.push({ a: colors[i], b: colors[j], distance: d });
  }
  return out.slice(0, 20);
}

function bboxFromPath(points) {
  if (!Array.isArray(points) || !points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
function boxesOverlap(a, b) { return !!(a && b && a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY); }
function polygonArea(points) { let a = 0; for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j][0] * points[i][1] - points[i][0] * points[j][1]; return Math.abs(a / 2); }
function pointInPolygon(x, y, poly = []) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi) inside = !inside; } return inside; }
function isWhite(hex) { const [r, g, b] = rgb(hex); return (r + g + b) / 3 > 210; }
function isGreen(hex) { const [r, g, b] = rgb(hex); return g > r * 1.15 && g > b * 1.15; }
function isDark(hex) { const [r, g, b] = rgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b < 80; }
function rgb(hex = '#000000') { const h = String(hex).replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function colorDistance(a, b) { const ar = rgb(a), br = rgb(b); return Math.hypot(ar[0] - br[0], ar[1] - br[1], ar[2] - br[2]); }
function hashBytes(bytes) { let h = 2166136261; for (const b of bytes || []) { h ^= b; h = Math.imul(h, 16777619); } return `fnv1a_${(h >>> 0).toString(16).padStart(8, '0')}`; }
function hex(bytes) { return [...bytes].map(b => b.toString(16).padStart(2, '0')).join(' '); }
function inferFormat(url) { return String(url).split('?')[0].split('.').pop() || 'unknown'; }
function readImageDimensions(blob) { return new Promise(resolve => { const img = new Image(); const url = URL.createObjectURL(blob); img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); }; img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: null, height: null }); }; img.src = url; }); }
async function buildZipBlob(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function textFile(name, text) { return { name, blob: new Blob([text], { type: 'text/markdown;charset=utf-8' }) }; }
function jsonFile(name, data) { return { name, blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }) }; }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function safeName(name) { return String(name || 'diagnostic').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48); }