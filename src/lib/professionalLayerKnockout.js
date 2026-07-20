import { buildThreadColorBlocks } from './threadColorBlocks';

const ROLE_PRIORITY = {
  underlay: 5,
  base_fill: 20,
  foreground_fill: 30,
  shadows_or_details: 40,
  black_outline: 90,
};

function hexToRgb(hex = '#000000') {
  const h = String(hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isDark(hex) { return luminance(hex) < 70; }
function isWhite(hex) { return luminance(hex) > 210; }

function polygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return Math.abs(area / 2);
}

function bbox(points = []) {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function centroid(points = []) {
  if (!points.length) return [0, 0];
  let x = 0, y = 0;
  for (const p of points) { x += p[0]; y += p[1]; }
  return [x / points.length, y / points.length];
}

function bboxOverlap(a, b) {
  if (!a || !b) return false;
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

function classifyObject(obj) {
  const text = `${obj.name || ''} ${obj.id || ''} ${obj.layerType || ''} ${obj.stitch_type || ''}`.toLowerCase();
  const area = polygonArea(obj.points || []);
  const b = bbox(obj.points || []);
  const bboxArea = b ? Math.max(0.001, b.width * b.height) : Math.max(0.001, area);
  const compactness = area / bboxArea;
  const dark = isDark(obj.color);
  const white = isWhite(obj.color);
  const outlineText = /outline|contour|stroke|line|mouth|eye|facial|detail|black/.test(text);
  const thinShape = compactness < 0.38 || (b && Math.max(b.width, b.height) / Math.max(0.001, Math.min(b.width, b.height)) > 3.2);

  if (text.includes('underlay')) return 'underlay';
  if (dark && (outlineText || thinShape || obj.stitch_type === 'running_stitch' || obj.stitch_type === 'satin')) return 'black_outline';
  if (/shadow|shade|small|detail|cheek|highlight/.test(text)) return 'shadows_or_details';
  if (white || /eye|mouth|belly|face|foreground/.test(text)) return 'foreground_fill';
  return 'base_fill';
}

function shouldKnockout(lower, upper) {
  if (!lower || !upper || lower === upper) return false;
  if (lower.role === 'black_outline') return false;
  if (lower.role !== 'base_fill' && lower.role !== 'foreground_fill') return false;
  if (upper.role === 'underlay' || upper.role === lower.role) return false;
  if (String(lower.color || '').toLowerCase() === String(upper.color || '').toLowerCase()) return false;
  if (!bboxOverlap(lower.bbox, upper.bbox)) return false;
  const [cx, cy] = upper.centroid;
  return pointInPolygon(cx, cy, lower.points || []) || pointInPolygon(lower.centroid[0], lower.centroid[1], upper.points || []);
}

function normalizeBlackOutlineObject(obj) {
  if (obj.role !== 'black_outline') return obj;
  const area = polygonArea(obj.points || []);
  const b = bbox(obj.points || []);
  const bboxArea = b ? Math.max(0.001, b.width * b.height) : Math.max(0.001, area);
  const compactness = area / bboxArea;
  const isMassiveRealFill = area > 120 && compactness > 0.55 && !/outline|contour|stroke|line|mouth|eye|facial|detail/.test(String(obj.name || obj.id || '').toLowerCase());
  if (isMassiveRealFill) return { ...obj, priority: ROLE_PRIORITY.shadows_or_details, layerRole: 'shadows_or_details' };
  return {
    ...obj,
    stitch_type: obj.stitch_type === 'satin' ? 'satin' : 'running_stitch',
    stitchType: obj.stitchType === 'satin' ? 'satin' : 'running_stitch',
    layerType: obj.layerType || 'black_outline',
    layerRole: 'black_outline',
    priority: ROLE_PRIORITY.black_outline,
    blackOutlineFinalPass: true,
  };
}

export function prepareProfessionalLayerObjects(objects = [], options = {}) {
  const applyKnockouts = options.applyKnockouts === true;
  const prepared = (objects || []).map((obj, index) => {
    const role = classifyObject(obj);
    const pts = obj.points || [];
    return {
      ...obj,
      _originalOrder: index,
      role,
      layerRole: role,
      priority: ROLE_PRIORITY[role] || obj.priority || 25,
      centroid: centroid(pts),
      bbox: bbox(pts),
      areaMm2: polygonArea(pts),
    };
  }).map(normalizeBlackOutlineObject);

  if (applyKnockouts) {
    for (const lower of prepared) {
      const zones = [];
      for (const upper of prepared) {
      if (shouldKnockout(lower, upper) && (upper.areaMm2 || 0) > 0.8) {
        zones.push({ id: upper.id, role: upper.role, color: upper.color, points: upper.points });
      }
    }
      if (zones.length) {
        lower.knockoutZones = zones.map(z => z.points);
        lower.knockoutZoneMeta = zones.map(({ id, role, color }) => ({ id, role, color }));
        lower.hasProfessionalKnockout = true;
      }
    }
  }

  prepared.sort((a, b) =>
    (ROLE_PRIORITY[a.role] || 25) - (ROLE_PRIORITY[b.role] || 25) ||
    String(a.color || '').localeCompare(String(b.color || '')) ||
    (a._originalOrder - b._originalOrder)
  );

  const report = {
    version: 'PROFESSIONAL_LAYER_KNOCKOUT_AND_COLOR_SEQUENCE_V1',
    applyKnockouts,
    objectCount: prepared.length,
    baseFillCount: prepared.filter(o => o.role === 'base_fill').length,
    foregroundFillCount: prepared.filter(o => o.role === 'foreground_fill').length,
    shadowDetailCount: prepared.filter(o => o.role === 'shadows_or_details').length,
    blackOutlineCount: prepared.filter(o => o.role === 'black_outline').length,
    knockoutObjectCount: prepared.filter(o => o.hasProfessionalKnockout).length,
    knockoutZoneCount: prepared.reduce((s, o) => s + (o.knockoutZones?.length || 0), 0),
    outlineAfterFill: true,
  };
  return { objects: prepared, report };
}

export function auditProfessionalColorSequence(commands = []) {
  const blocks = buildThreadColorBlocks(commands);
  const uniqueThreadColors = new Set(commands.filter(c => c?.color && (c.type === 'stitch' || c.type === 'jump')).map(c => String(c.color).toLowerCase())).size;
  const colorChangeCommands = commands.filter(c => c?.type === 'colorChange').length;
  const colorSeen = new Map();
  let repeatedColorBlocks = 0;
  let sameColorSeparatedBlocks = 0;
  for (let i = 0; i < blocks.length; i++) {
    const key = String(blocks[i].colorHex || '').toLowerCase();
    if (colorSeen.has(key)) {
      repeatedColorBlocks++;
      if (i - colorSeen.get(key) > 1) sameColorSeparatedBlocks++;
    }
    colorSeen.set(key, i);
  }
  return {
    uniqueThreadColors,
    colorChangeCommands,
    colorBlocks: blocks.length,
    repeatedColorBlocks,
    sameColorSeparatedBlocks,
    unnecessaryColorChanges: Math.max(0, colorChangeCommands - Math.max(0, blocks.length - 1)),
    machineThreadStopsEstimated: Math.max(0, blocks.length),
  };
}