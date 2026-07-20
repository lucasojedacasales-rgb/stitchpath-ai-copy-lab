import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { 
      regions, 
      stitchParams = {}, 
      sequencingMode = 'optimize',
      useVectorizerStitches = true,  // NUEVO: usar stitches del vectorizador
    } = await req.json();

    if (!regions || !Array.isArray(regions)) {
      return Response.json({ error: 'regions array required' }, { status: 400 });
    }

    // ── Parámetros de puntada ─────────────────────────────────────────────
    const sp = {
      tatamiDensityMm: 0.4,
      fillAngle: null,
      fillDensity: 1.0,
      satinWidth: 3.0,
      runningStitchLength: 2.5,
      pullCompensation: 0.15,
      underlay: true,
      underlayDensity: 0.5,
      underlayAngle: -45,
      underlayStitchLength: 3.0,
      trimThreshold: 5.0,           // NUEVO: distancia para trim
      maxStitchLength: 12.0,        // NUEVO: máxima longitud de puntada
      ...stitchParams,
    };

    // ── Generar puntadas por región ────────────────────────────────────────
    const stitchPaths = [];

    for (const region of regions) {
      const poly = region.path_points || region.polygon;
      if (!poly || poly.length < 3) continue;

      const area = region.area_mm2 || region.area || 0;
      const type = region.stitch_type || region.type || 'fill';
      const color = region.color || '#000000';
      const layerOrder = region.layer_order || region.layerOrder || 999;

      // === PASO 1: Intentar usar stitches del vectorizador ===
      let mainPoints = [];
      let contourPoints = [];
      let usedVectorizer = false;

      if (useVectorizerStitches && region.stitches && region.stitches.length > 0) {
        // Usar stitches del vectorizador directamente
        mainPoints = region.stitches.map(p => [p[0], p[1]]);
        usedVectorizer = true;
        console.log(`Region ${region.id}: usando ${mainPoints.length} stitches del vectorizador`);
      } else {
        // Regenerar desde path_points
        mainPoints = generateStitchesForType(poly, type, sp, region);
      }

      // Contour stitches (si existen del vectorizador, usarlos)
      if (region.contour_stitches && region.contour_stitches.length > 0) {
        contourPoints = region.contour_stitches.map(p => [p[0], p[1]]);
      } else if (type === 'fill' || type === 'satin') {
        contourPoints = generateContour(poly, type, sp);
      }

      // === PASO 2: Agregar underlay si está configurado ===
      let underlayPoints = [];
      if (sp.underlay && (type === 'fill' || type === 'satin') && area > 20) {
        underlayPoints = generateUnderlay(poly, type, sp, region);
      }

      // === PASO 3: Crear StitchPaths ===

      // Underlay primero (si existe)
      if (underlayPoints.length > 0) {
        stitchPaths.push({
          regionId: `${region.id}_underlay`,
          type: type === 'satin' ? 'satin' : 'fill',
          color,
          layerOrder: layerOrder - 0.5,  // underlay antes del main
          points: underlayPoints,
          isUnderlay: true,
        });
      }

      // Main stitches — wrap with tie-on / tie-off anchors
      if (mainPoints.length > 0) {
        const withTieOn  = addTieOn(mainPoints);
        const withTieOff = addTieOff(withTieOn);
        stitchPaths.push({
          regionId: region.id,
          type,
          color,
          layerOrder,
          priority: region.priority || layerOrder,
          points: withTieOff,
          isUnderlay: false,
        });
      }

      // Contour stitches (después del fill)
      if (contourPoints.length > 0) {
        stitchPaths.push({
          regionId: `${region.id}_contour`,
          type: type === 'satin' ? 'satin' : 'running_stitch',
          color,
          layerOrder: layerOrder + 0.5,  // contour después del main
          points: contourPoints,
          isUnderlay: false,
        });
      }
    }

    // ── Secuenciación optimizada ──────────────────────────────────────────
    const sequenced = sequencePathsOptimized(stitchPaths, sequencingMode, sp.trimThreshold);

    // ── Estadísticas ─────────────────────────────────────────────────────────
    const totalStitches = sequenced.reduce((s, p) => s + p.points.length, 0);
    const totalColors = new Set(sequenced.map(p => p.color)).size;
    const estimatedTimeMin = parseFloat((totalStitches / 800).toFixed(1));
    const threadLengthMeters = parseFloat(((totalStitches * 2.5) / 1000).toFixed(1));

    // Contar trims
    let trimCount = 0;
    for (let i = 1; i < sequenced.length; i++) {
      const prev = sequenced[i-1];
      const curr = sequenced[i];
      if (prev.color === curr.color) {
        const lastPt = prev.points[prev.points.length - 1];
        const firstPt = curr.points[0];
        const dist = Math.hypot(firstPt[0] - lastPt[0], firstPt[1] - lastPt[1]);
        if (dist > sp.trimThreshold) trimCount++;
      }
    }

    return Response.json({
      success: true,
      stitchPaths: sequenced,
      stats: {
        totalStitches,
        totalPaths: sequenced.length,
        totalColors,
        estimatedTimeMin,
        threadLengthMeters,
        trimCount,
      }
    });

  } catch (error) {
    console.error('Stitch generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GENERADORES DE PUNTADAS POR TIPO
// ═══════════════════════════════════════════════════════════════════════════

function generateStitchesForType(poly, type, sp, region) {
  switch (type) {
    case 'fill':
      const angle = sp.fillAngle !== null ? sp.fillAngle : 
                    (region.fill_angle !== undefined ? region.fill_angle : 
                     dominantAngleDeg(poly));
      return generateTatamiFill(poly, sp.tatamiDensityMm, sp.maxStitchLength, angle, sp.pullCompensation);

    case 'satin':
      return generateSatinZigZag(poly, sp.satinWidth, sp.pullCompensation);

    case 'running_stitch':
      return generateRunningStitch(poly, sp.runningStitchLength, 0);

    default:
      return generateRunningStitch(poly, sp.runningStitchLength, 0);
  }
}

function generateContour(poly, type, sp) {
  if (type === 'satin') {
    return generateSatinContour(poly, sp.satinWidth * 0.3, sp.pullCompensation);
  }
  return generateRunningStitch(poly, sp.runningStitchLength, 0.5);
}

function generateUnderlay(poly, type, sp, region) {
  // Use adaptive engine underlay type when available
  const underlayConfig = region.recommended_underlay || region.underlay_data || {};
  const underlayType = underlayConfig.type || (type === 'satin' ? 'centre_walk' : 'zigzag');

  if (type === 'fill') {
    const mainAngle = sp.fillAngle !== null ? sp.fillAngle :
                      (region.fill_angle !== undefined ? region.fill_angle : 45);

    switch (underlayType) {
      case 'edge_walk':
        // Perimeter running stitch only — no fill
        return generateRunningStitch(poly, sp.underlayStitchLength, 0);

      case 'full_coverage':
        // Two-pass grid: main angle + perpendicular (fleece/terry)
        const pass1 = generateTatamiFill(poly, sp.tatamiDensityMm * 1.5, sp.underlayStitchLength, mainAngle, 0);
        const pass2 = generateTatamiFill(poly, sp.tatamiDensityMm * 1.5, sp.underlayStitchLength, (mainAngle + 90) % 180, 0);
        return [...pass1, ...pass2];

      case 'zigzag':
      default:
        // Standard tatami at perpendicular angle, looser density
        return generateTatamiFill(poly, sp.tatamiDensityMm * 2, sp.underlayStitchLength, (mainAngle + 90) % 180, sp.pullCompensation * 0.4);
    }
  } else if (type === 'satin') {
    switch (underlayType) {
      case 'centre_walk':
        // Single line down the centre axis (prevents sinking)
        return generateCentreWalk(poly, sp.underlayStitchLength);
      case 'zigzag':
        // Zigzag underlay for wide satin columns
        return generateSatinZigZag(poly, sp.satinWidth * 0.5, sp.pullCompensation * 0.3);
      default:
        return generateCentreWalk(poly, sp.underlayStitchLength);
    }
  }
  return [];
}

// Centre walk: single running stitch along the medial axis of a satin region
function generateCentreWalk(poly, stitchLength) {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const angle = dominantAngle(poly);
  const axisDir = [Math.cos(angle), Math.sin(angle)];

  const projections = poly.map(p => (p[0] - cx) * axisDir[0] + (p[1] - cy) * axisDir[1]);
  const tMin = Math.min(...projections);
  const tMax = Math.max(...projections);

  const points = [];
  for (let t = tMin; t <= tMax; t += stitchLength) {
    points.push([
      parseFloat((cx + t * axisDir[0]).toFixed(3)),
      parseFloat((cy + t * axisDir[1]).toFixed(3)),
    ]);
  }
  points.push([
    parseFloat((cx + tMax * axisDir[0]).toFixed(3)),
    parseFloat((cy + tMax * axisDir[1]).toFixed(3)),
  ]);
  return points;
}

// ── TATAMI FILL MEJORADO ──────────────────────────────────────────────────
function generateTatamiFill(poly, densityMm, stitchLength, angleDeg, pullComp) {
  if (!poly || poly.length < 3) return [];

  // Expandir polígono para compensación de pull
  const expanded = pullComp > 0 ? expandPolygonByNormals(poly, pullComp) : poly;

  const angle = angleDeg * Math.PI / 180;
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const cosR = Math.cos(angle), sinR = Math.sin(angle);

  // Rotar polígono alineado con el ángulo de fill
  const rotated = expanded.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);

  const minY = Math.min(...rotated.map(p => p[1]));
  const maxY = Math.max(...rotated.map(p => p[1]));
  const rowSpacing = Math.max(0.15, densityMm);

  const allPoints = [];
  const OFFSETS = [0, 0.25, 0.5, 0.75];
  let rowIdx = 0;

  for (let y = minY + rowSpacing / 2; y <= maxY; y += rowSpacing) {
    const intersections = scanLineIntersect(rotated, y);
    if (intersections.length < 2) { rowIdx++; continue; }
    intersections.sort((a, b) => a - b);

    const cycleOffset = OFFSETS[rowIdx % 4] * stitchLength;
    const forward = rowIdx % 2 === 0;
    const rowPoints = [];

    for (let i = 0; i < intersections.length - 1; i += 2) {
      const xL = intersections[i], xR = intersections[i + 1];
      const segLen = xR - xL;
      if (segLen < 0.1) continue;

      // Puntos de inicio y fin del segmento
      const startX = xL + cycleOffset;
      const endX = xR;

      if (startX >= endX) continue;

      // Generar puntadas a lo largo del segmento
      const numStitches = Math.max(1, Math.floor((endX - startX) / stitchLength));

      if (forward) {
        for (let j = 0; j <= numStitches; j++) {
          const x = Math.min(startX + j * stitchLength, endX);
          rowPoints.push([x, y]);
        }
      } else {
        for (let j = numStitches; j >= 0; j--) {
          const x = Math.min(startX + j * stitchLength, endX);
          rowPoints.push([x, y]);
        }
      }
    }

    if (rowPoints.length > 0) {
      // Desrotar puntos
      for (const [x, y] of rowPoints) {
        allPoints.push([
          parseFloat((x * cosR - y * sinR).toFixed(3)),
          parseFloat((x * sinR + y * cosR).toFixed(3)),
        ]);
      }
    }

    rowIdx++;
  }

  return allPoints;
}

function scanLineIntersect(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
      const t = (y - a[1]) / (b[1] - a[1]);
      xs.push(a[0] + t * (b[0] - a[0]));
    }
  }
  return xs;
}

// ── SATIN ZIG-ZAG MEJORADO ────────────────────────────────────────────────
function generateSatinZigZag(poly, width, pullComp) {
  const expanded = pullComp > 0 ? expandPolygonByNormals(poly, pullComp) : poly;

  // Calcular eje principal del polígono
  const axisAngle = dominantAngle(expanded);
  const axisDir = [Math.cos(axisAngle), Math.sin(axisAngle)];
  const perpDir = [-Math.sin(axisAngle), Math.cos(axisAngle)];

  const cx = expanded.reduce((s, p) => s + p[0], 0) / expanded.length;
  const cy = expanded.reduce((s, p) => s + p[1], 0) / expanded.length;

  // Proyectar vértices en el eje principal
  const projAxis = expanded.map(p => (p[0] - cx) * axisDir[0] + (p[1] - cy) * axisDir[1]);
  const tMin = Math.min(...projAxis), tMax = Math.max(...projAxis);

  const stitchSpacing = Math.max(0.2, width * 0.15);
  const points = [];
  let stitchIdx = 0;

  for (let t = tMin; t <= tMax; t += stitchSpacing) {
    const mx = cx + t * axisDir[0];
    const my = cy + t * axisDir[1];

    // Encontrar intersecciones con el polígono en dirección perpendicular
    const intersections = linePolyIntersectPerp(expanded, mx, my, perpDir);
    if (intersections.length < 2) continue;
    intersections.sort((a, b) => a.t - b.t);

    const p0 = intersections[0], p1 = intersections[intersections.length - 1];
    const len = Math.abs(p1.t - p0.t);
    const segments = Math.max(1, Math.ceil(len / width));
    const step = (p1.t - p0.t) / segments;

    for (let s = 0; s < segments; s++) {
      const ta = p0.t + s * step;
      const tb = p0.t + (s + 1) * step;
      const forward = stitchIdx % 2 === 0;

      const startT = forward ? ta : tb;
      const endT = forward ? tb : ta;

      points.push([
        parseFloat((mx + startT * perpDir[0]).toFixed(3)),
        parseFloat((my + startT * perpDir[1]).toFixed(3)),
      ]);
      points.push([
        parseFloat((mx + endT * perpDir[0]).toFixed(3)),
        parseFloat((my + endT * perpDir[1]).toFixed(3)),
      ]);

      stitchIdx++;
    }
  }

  return points;
}

function linePolyIntersectPerp(poly, mx, my, perpDir) {
  const results = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const denom = perpDir[0] * dy - perpDir[1] * dx;
    if (Math.abs(denom) < 1e-10) continue;
    const t_seg = ((mx - a[0]) * dy - (my - a[1]) * dx) / denom;
    const u_seg = ((mx - a[0]) * perpDir[1] - (my - a[1]) * perpDir[0]) / denom;
    if (u_seg >= 0 && u_seg <= 1) results.push({ t: t_seg });
  }
  return results;
}

// ── RUNNING STITCH ─────────────────────────────────────────────────────────
function generateRunningStitch(poly, stitchLength, offsetMm) {
  const offsetPoly = offsetMm !== 0 ? expandPolygonByNormals(poly, offsetMm) : poly;
  const points = [];
  let dist = 0;

  points.push([parseFloat(offsetPoly[0][0].toFixed(3)), parseFloat(offsetPoly[0][1].toFixed(3))]);

  for (let i = 0; i < offsetPoly.length; i++) {
    const a = offsetPoly[i], b = offsetPoly[(i + 1) % offsetPoly.length];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen < 1e-10) continue;

    const dx = (b[0] - a[0]) / segLen, dy = (b[1] - a[1]) / segLen;
    let d = stitchLength - dist;

    while (d < segLen) {
      points.push([
        parseFloat((a[0] + dx * d).toFixed(3)),
        parseFloat((a[1] + dy * d).toFixed(3)),
      ]);
      d += stitchLength;
    }
    dist = segLen - (d - stitchLength);
  }

  // Cerrar el polígono
  points.push([parseFloat(offsetPoly[0][0].toFixed(3)), parseFloat(offsetPoly[0][1].toFixed(3))]);
  return points;
}

// ── SATIN CONTOUR ──────────────────────────────────────────────────────────
function generateSatinContour(poly, width, pullComp) {
  const expanded = pullComp > 0 ? expandPolygonByNormals(poly, pullComp) : poly;
  const stitches = [];
  const baseHalfWidth = width / 2;
  const n = expanded.length;

  // Calcular normales
  const normals = [];
  for (let i = 0; i < n; i++) {
    const prev = expanded[(i - 1 + n) % n];
    const curr = expanded[i];
    const next = expanded[(i + 1) % n];

    const dx1 = curr[0] - prev[0], dy1 = curr[1] - prev[1];
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next[0] - curr[0], dy2 = next[1] - curr[1];
    const len2 = Math.hypot(dx2, dy2);

    let nx = 0, ny = 0;
    if (len1 > 0.001) { nx += (-dy1 / len1); ny += (dx1 / len1); }
    if (len2 > 0.001) { nx += (-dy2 / len2); ny += (dx2 / len2); }

    const nLen = Math.hypot(nx, ny);
    if (nLen > 0.001) normals.push([nx / nLen, ny / nLen]);
    else normals.push([0, 1]);
  }

  // Generar zig-zag a lo largo del contorno
  for (let i = 0; i < n; i++) {
    const p1 = expanded[i], p2 = expanded[(i + 1) % n];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen < 0.01) continue;

    const density = Math.max(0.15, Math.min(0.4, segLen / 50));
    const steps = Math.max(3, Math.floor(segLen / density));

    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const baseX = p1[0] + dx * t, baseY = p1[1] + dy * t;
      const n1 = normals[i], n2 = normals[(i + 1) % n];
      const nx = n1[0] * (1 - t) + n2[0] * t;
      const ny = n1[1] * (1 - t) + n2[1] * t;
      const nLen = Math.hypot(nx, ny);
      const nnx = nLen > 0 ? nx / nLen : 0;
      const nny = nLen > 0 ? ny / nLen : 1;
      const side = (j % 2 === 0) ? 1 : -1;

      stitches.push([
        baseX + nnx * baseHalfWidth * side,
        baseY + nny * baseHalfWidth * side,
      ]);
    }
  }

  return stitches;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECUENCIACIÓN OPTIMIZADA
// ═══════════════════════════════════════════════════════════════════════════

function sequencePathsOptimized(paths, mode, trimThreshold) {
  if (paths.length <= 1) return paths;

  // Paso 1: Ordenar por priority (adaptive engine) then layerOrder as fallback
  const sorted = [...paths].sort((a, b) => {
    const pa = a.priority ?? a.layerOrder ?? 999;
    const pb = b.priority ?? b.layerOrder ?? 999;
    return pa - pb;
  });

  if (mode === 'layerOrder') {
    return sorted;
  }

  // Paso 2: Agrupar por color
  const byColor = {};
  for (const p of sorted) {
    const normalizedColor = (p.color || '').toLowerCase().trim();
    if (!byColor[normalizedColor]) byColor[normalizedColor] = [];
    byColor[normalizedColor].push(p);
  }

  // Paso 3: Ordenar colores por cantidad de puntadas (más grandes primero)
  const colorKeys = Object.keys(byColor);
  colorKeys.sort((a, b) => {
    const stitchesA = byColor[a].reduce((s, p) => s + p.points.length, 0);
    const stitchesB = byColor[b].reduce((s, p) => s + p.points.length, 0);
    return stitchesB - stitchesA;
  });

  const result = [];

  for (const color of colorKeys) {
    const group = byColor[color];

    // Paso 4: TSP aproximado (nearest neighbor con 2-opt)
    const ordered = tspNearestNeighbor(group);

    result.push(...ordered);
  }

  return result;
}

function tspNearestNeighbor(paths) {
  if (paths.length <= 1) return paths;

  const remaining = [...paths];
  const result = [remaining.shift()];

  while (remaining.length > 0) {
    const last = result[result.length - 1];
    const lastPt = last.points[last.points.length - 1] || [0, 0];

    let bestIdx = 0;
    let bestScore = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const path = remaining[i];
      const firstPt = path.points[0] || [0, 0];
      const dist = Math.hypot(firstPt[0] - lastPt[0], firstPt[1] - lastPt[1]);

      // Score: distancia - bonus por cercanía
      const bonus = dist < 5 ? 100 : 0;
      const score = dist - bonus;

      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    result.push(remaining.splice(bestIdx, 1)[0]);
  }

  // 2-opt improvement (simplificado)
  return twoOptImprove(result);
}

function twoOptImprove(paths) {
  if (paths.length < 4) return paths;

  let improved = true;
  let iterations = 0;
  const maxIterations = 50;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 1; i < paths.length - 2; i++) {
      for (let j = i + 1; j < paths.length - 1; j++) {
        const a = paths[i - 1].points[paths[i - 1].points.length - 1];
        const b = paths[i].points[0];
        const c = paths[j].points[paths[j].points.length - 1];
        const d = paths[j + 1].points[0];

        const currentDist = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(d[0] - c[0], d[1] - c[1]);
        const newDist = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(d[0] - b[0], d[1] - b[1]);

        if (newDist < currentDist * 0.9) {
          // Reverse segment [i..j]
          const segment = paths.slice(i, j + 1).reverse();
          paths.splice(i, j - i + 1, ...segment);
          improved = true;
        }
      }
    }
  }

  return paths;
}

// ═══════════════════════════════════════════════════════════════════════════
// TIE-ON / TIE-OFF  (anclajes de hilo — estándar pyembroidery / ink-stitch)
// ═══════════════════════════════════════════════════════════════════════════

// Adds short back-stitches at the start of a path to lock the thread.
// Standard tie-on: 3 tiny stitches near the first point (±0.3mm each).
function addTieOn(points) {
  if (!points || points.length === 0) return points || [];
  const [x0, y0] = points[0];
  if (x0 == null || y0 == null) return points; // guard: invalid first point
  const tieOff = 0.3; // mm — sub-fabric lock stitch
  return [
    [x0 + tieOff, y0],
    [x0, y0],
    [x0 + tieOff, y0],
    [x0, y0],
    ...points,
  ];
}

// Adds short back-stitches at the end to lock off the thread.
function addTieOff(points) {
  if (!points || points.length === 0) return points || [];
  const [xN, yN] = points[points.length - 1];
  if (xN == null || yN == null) return points; // guard: invalid last point
  const tieOff = 0.3;
  return [
    ...points,
    [xN + tieOff, yN],
    [xN, yN],
    [xN + tieOff, yN],
    [xN, yN],
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES GEOMÉTRICAS
// ═══════════════════════════════════════════════════════════════════════════

function dominantAngle(poly) {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  let cxx = 0, cxy = 0, cyy = 0;
  for (const [x, y] of poly) {
    const dx = x - cx, dy = y - cy;
    cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
  }
  return 0.5 * Math.atan2(2 * cxy, cxx - cyy);
}

function dominantAngleDeg(poly) {
  return parseFloat((dominantAngle(poly) * 180 / Math.PI).toFixed(1));
}

function expandPolygonByNormals(poly, amount) {
  if (!amount || amount === 0) return poly;
  const n = poly.length;
  if (n < 3) return poly;

  const normals = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];

    const dx1 = curr[0] - prev[0], dy1 = curr[1] - prev[1];
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next[0] - curr[0], dy2 = next[1] - curr[1];
    const len2 = Math.hypot(dx2, dy2);

    let nx = 0, ny = 0;
    if (len1 > 0.001) { nx += (-dy1 / len1); ny += (dx1 / len1); }
    if (len2 > 0.001) { nx += (-dy2 / len2); ny += (dx2 / len2); }

    const nLen = Math.hypot(nx, ny);
    if (nLen > 0.001) normals.push([nx / nLen, ny / nLen]);
    else normals.push([0, 1]);
  }

  return poly.map((p, i) => [p[0] + normals[i][0] * amount, p[1] + normals[i][1] * amount]);
}