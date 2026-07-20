import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Fetch image and re-upload via Base44 UploadFile so Claude Vision can access it.
// SSRF guard: reject non-HTTP(S) protocols and private/loopback addresses.
async function reuploadForClaude(imageUrl, base44) {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error('image_url is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('image_url must be http or https');
  }
  // Block obvious internal addresses (SSRF mitigation)
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
      host.startsWith('10.') || host.startsWith('172.') || host.startsWith('192.168.') ||
      host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('image_url must be a publicly accessible URL');
  }

  const res = await fetch(url.href, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
  const contentType = res.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Expected image content-type, got ${contentType}`);
  }
  const buffer = await res.arrayBuffer();
  // Guard: reject files > 25MB (avoid memory exhaustion)
  if (buffer.byteLength > 25 * 1024 * 1024) {
    throw new Error('Image exceeds 25MB limit');
  }
  const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : contentType.includes('webp') ? 'webp' : 'jpg';
  const file = new File([buffer], `image.${ext}`, { type: contentType });
  const uploaded = await base44.asServiceRole.integrations.Core.UploadFile({ file });
  return uploaded.file_url;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      image_url, mode, width_mm, height_mm, color_count,
      use_ia_vision, image_analysis, traced_contours,
      max_regions, stitch_strategy, tatami_density, fill_angle
    } = await req.json();

    if (!image_url) return Response.json({ error: 'image_url required' }, { status: 400 });

    // Color count: 6-8 is optimal for character/mascot designs.
    // Too many colors → over-segmentation + unnecessary thread changes.
    // Minimum 6 captures body, eyes, mouth, cheeks, feet, contours.
    const maxColors = Math.min(Math.max(6, color_count || 8), 12);
    const w = width_mm || 100;
    const h = height_mm || 100;
    const regionLimit = max_regions || 150;
    const density = tatami_density || 0.4;
    const adaptiveAngles = stitch_strategy?.adaptiveAngles || false;
    const travelOptimize = stitch_strategy?.travelOptimize || false;
    const underlayEnabled = stitch_strategy?.underlayEnabled !== false;

    // Re-upload image so Claude Vision always gets a valid Base44-hosted URL
    const imageDataUrl = await reuploadForClaude(image_url, base44);

    // ─── PATH A: Use real traced contours from client ────────────────────────
    if (traced_contours && traced_contours.regions && traced_contours.regions.length > 0) {
      const clientRegions = traced_contours.regions;

      // === NUEVO: Usar métricas geométricas del vectorizador para clasificación ===
      const regionDescriptions = clientRegions.slice(0, 200).map((r, i) => {
        const bbox = r.bbox;
        const aW = traced_contours.analysisW || 512;
        const aH = traced_contours.analysisH || 512;
        const cx = ((bbox.minX + bbox.maxX) / 2 / aW).toFixed(3);
        const cy = ((bbox.minY + bbox.maxY) / 2 / aH).toFixed(3);
        const bw = ((bbox.maxX - bbox.minX) / aW * w).toFixed(1);
        const bh = ((bbox.maxY - bbox.minY) / aH * h).toFixed(1);
        const areaMm2 = (r.coverage * w * h).toFixed(1);
        const compacidad = r.compacidad !== undefined ? r.compacidad.toFixed(3) : '?';
        const inertia = r.inertia_ratio !== undefined ? r.inertia_ratio.toFixed(2) : '?';
        const aspect = r.bbox_aspect !== undefined ? r.bbox_aspect.toFixed(2) : '?';
        const corners = r.corner_count !== undefined ? r.corner_count : '?';
        const pts = r.path_points?.length || '?';
        const perimEst = r.perimeter_norm ? (r.perimeter_norm * Math.hypot(w, h)).toFixed(1) : '?';
        // Pre-classify for context (AI can override if visual evidence contradicts)
        const geoHint = clasificarPorGeometria(r, w, h, aW, aH);
        return `R${i}: hex=${r.hex} cx=${cx} cy=${cy} bbox=${bw}x${bh}mm area=${areaMm2}mm² perim≈${perimEst}mm compact=${compacidad} inertia=${inertia} aspect=${aspect} corners=${corners} pts=${pts} geo_hint=${geoHint}`;
      }).join('\n');

      const labelPrompt = `Eres un experto digitalizador de bordados con 20 años de experiencia en Wilcom y Hatch. Analiza la imagen adjunta con máximo detalle.

DISEÑO: ${w}mm × ${h}mm | ${Math.min(clientRegions.length, 200)} regiones detectadas geométricamente

REGIONES (geo_hint = sugerencia geométrica del vectorizador, puedes confirmar o corregir según lo que VES):
${regionDescriptions}

REGLAS DE DIGITIZACIÓN PROFESIONAL:
1. stitch_type:
   - "fill" (tatami): zonas grandes >80mm², compactas. Ángulo perpendicular a la dirección visual dominante.
   - "satin": formas medianas <80mm², elongadas (inertia>2 o aspect>1.8), contornos, letras, pétalos. MAX ancho recomendado 7mm.
   - "running_stitch": líneas muy finas <3mm de ancho, contornos de detalle, pelo, nervios de hoja.
   - Si geo_hint=satin pero el área es >120mm² → cambia a fill.
   - Si geo_hint=fill pero inertia>3 → cambia a satin.

2. angle: Sigue la forma visual real:
   - Zonas redondas/circulares → 45°
   - Rectángulos horizontales → 0°
   - Rectángulos verticales → 90°
   - Diagonales → 135° o 45°
   - Satin elongado → perpendicular al eje largo

3. density:
   - fill grande: 0.35-0.45mm (densidad media — no asfixia la tela)
   - satin detalle: 0.25-0.35mm (más denso = mejor cobertura)
   - running: 0.3-0.4mm

4. layer_order: 1=fondo más grande, 2=capas medias, 3=detalles encima, 4=micro-detalles. Fills siempre antes que satin del mismo color.

5. underlay: true si area_mm² > 20 y stitch_type=fill. true si es satin y ancho > 2mm. false para micro-detalles.

6. pull_compensation: 0.10 para satin fino, 0.15 para fill estándar, 0.20 para fill en lycra/elásticos.

CRÍTICO: Asigna TODOS los índices 0 a ${Math.min(clientRegions.length, 200) - 1}. No omitas ninguno.

Responde SOLO JSON:
{"labels":[{"index":0,"name":"nombre_descriptivo_en_español","stitch_type":"fill","density":0.4,"angle":45,"layer_order":1,"underlay":true,"pull_compensation":0.15}],"estimated_time_min":12}`;

      const labelResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: labelPrompt,
        file_urls: [imageDataUrl],
        model: 'claude_sonnet_4_6',
        response_json_schema: {
          type: 'object',
          properties: {
            labels: { type: 'array', items: { type: 'object' } },
            estimated_time_min: { type: 'number' }
          }
        }
      });

      const labels = labelResult.labels || [];
      const labelMap = {};
      for (const l of labels) labelMap[l.index] = l;

      const finalRegions = clientRegions.slice(0, regionLimit).map((r, i) => {
        const label = labelMap[i] || {};

        // === GROSOR = AUTORIDAD ABSOLUTA para contornos delgados ===
        // Un contorno < 2.5mm de grosor SIEMPRE es running_stitch,
        // sin importar lo que diga el vectorizador (r.type) o la IA (label.stitch_type).
        const geoType = clasificarPorGeometria(r, w, h, aW, aH);
        const stitch_type = geoType === 'running_stitch'
          ? 'running_stitch'
          : (r.type || label.stitch_type || geoType);
        
        // === ADAPTIVE DENSITY: smaller regions = higher density (better coverage) ===
        const baseRegionDensity = stitch_type === 'fill' ? density : stitch_type === 'satin' ? density * 1.25 : 0.4;
        const areaMm2 = (r.coverage || 0.01) * w * h;
        const regionDensity = label.density || adaptDensity(baseRegionDensity, areaMm2);
        
        // Ángulo: priority chain — PCA (if adaptiveAngles) > Claude label > global fill_angle > color-coherent fallback
        let angle;
        if (adaptiveAngles && r.fill_angle !== undefined) {
          angle = r.fill_angle;                                    // PCA per-region — most precise
        } else if (label.angle !== undefined) {
          angle = label.angle;                                     // AI classification
        } else if (fill_angle !== null && fill_angle !== undefined) {
          angle = fill_angle;                                      // user override
        } else if (r.fill_angle !== undefined) {
          angle = r.fill_angle;                                    // PCA even when not adaptiveAngles
        } else {
          // Color-coherent fallback: same color → same angle (deterministic from hex)
          // Default to 45° — safest embroidery angle (avoids trampolining on axis-aligned shapes)
          angle = 45;
        }
        
        const stitch_count = calcularStitchCount(r, stitch_type, regionDensity, w, h);

        // Underlay: respects mode strategy
        const useUnderlay = underlayEnabled
          ? (label.underlay !== undefined ? label.underlay : stitch_type === 'fill')
          : false;

        // Derive perimeter_mm from normalized perimeter (diagonal of design = reference)
        const diagMm = Math.hypot(w, h);
        const perimeterMm = r.perimeter_norm
          ? r.perimeter_norm * diagMm
          : (r.perimeter_mm || Math.sqrt(r.coverage * w * h) * 3.5);

        // Semantic fallback name: position + color + stitch_type (never region_hex_index)
        const fallbackName = semanticName(r, i, w, h, stitch_type);

        return {
          id: `r${i + 1}`,
          name: label.name || fallbackName,
          color: r.hex,
          stitch_type,
          density: regionDensity,
          angle,
          layer_order: label.layer_order || (stitch_type === 'fill' ? 1 : stitch_type === 'satin' ? 2 : 3),
          // Map layer_order → priority so regionBuilder preserves embroidery build order:
          // layer 1 (bottom) = priority 1, layer 10 (top/details) = priority 10
          priority: label.layer_order ? label.layer_order : (stitch_type === 'fill' ? 2 : stitch_type === 'satin' ? 5 : 8),
          pull_compensation: label.pull_compensation || 0.15,
          underlay: useUnderlay,
          area_mm2: Math.round(r.coverage * w * h),
          perimeter_mm: +perimeterMm.toFixed(2),
          centroid: r.centroid || [0.5, 0.5],
          stitch_count,
          is_auto_contour: false,
          visible: true,
          path_points: r.path_points,
          _metrics: {
            compacidad: r.compacidad,
            inertia_ratio: r.inertia_ratio,
            bbox_aspect: r.bbox_aspect,
            fill_angle: r.fill_angle,
          }
        };
      });

      // Cap total stitches at 12,000 — if exceeded, scale down density proportionally
      const rawTotal = finalRegions.reduce((s, r) => s + r.stitch_count, 0);
      if (rawTotal > 12000) {
        const scale = 12000 / rawTotal;
        for (const r of finalRegions) {
          r.stitch_count = Math.round(r.stitch_count * scale);
        }
      }
      const total_stitches = finalRegions.reduce((s, r) => s + r.stitch_count, 0);
      return Response.json({
        success: true,
        data: {
          regions: finalRegions,
          total_stitches,
          estimated_time_min: labelResult.estimated_time_min || Math.round(total_stitches / 800),
          colors_used: new Set(finalRegions.map(r => r.color)).size,
          width_mm: w,
          height_mm: h,
        }
      });
    }

    // ─── PATH B: Pure AI generation (solo si no hay contornos) ──────────────
    const regionTarget = mode === 'ultra' ? '80-120' : mode === 'precision' ? '50-80' : mode === 'fast' ? '10-20' : mode === 'standard' ? '15-30' : '30-60';
    const pointsPerShape = mode === 'ultra' ? '40-80' : mode === 'precision' ? '30-60' : mode === 'fast' ? '8-15' : '15-40';

    let colorDataBlock = '';
    if (image_analysis?.dominantColors?.length > 0) {
      colorDataBlock = `\nCOLORES DETECTADOS:\n${image_analysis.dominantColors.map(c => `  ${c.hex} (${(c.coverage * 100).toFixed(1)}%)`).join('\n')}\n`;
    }

    const prompt = `Eres el mejor digitalizador de bordados. Analiza la imagen adjunta y genera ${regionTarget} regiones de bordado con contornos precisos.
TAMAÑO DISEÑO: ${w}mm × ${h}mm | COLORES MÁX: ${maxColors} | MODO: ${mode || 'hybrid'}
${colorDataBlock}
INSTRUCCIONES:
- path_points: ${pointsPerShape} puntos siguiendo el contorno REAL de cada zona de color
- Coordenadas normalizadas 0.0–1.0 (0,0 = arriba-izquierda, 1,1 = abajo-derecha)
- Polígono cerrado: el último punto debe ser igual al primero
- Orden de capas: fills grandes primero (layer_order=1), luego medianos, luego contornos satin, luego detalles running_stitch
- Usa los colores REALES que ves en la imagen para los hex codes
- stitch_count: estima realista según area (fill ~15pts/mm², satin ~20pts/mm, running ~5pts/mm)

Responde SOLO con JSON válido (sin texto extra):
{
  "regions": [
    {
      "id": "r1",
      "name": "nombre_descriptivo",
      "color": "#rrggbb",
      "stitch_type": "fill",
      "density": 0.7,
      "angle": 45,
      "layer_order": 1,
      "pull_compensation": 0.15,
      "underlay": true,
      "area_mm2": 800,
      "stitch_count": 2200,
      "is_auto_contour": false,
      "visible": true,
      "path_points": [[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9],[0.1,0.1]]
    }
  ],
  "total_stitches": 18000,
  "estimated_time_min": 12,
  "colors_used": 6,
  "width_mm": ${w},
  "height_mm": ${h}
}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      file_urls: [imageDataUrl],
      model: 'claude_sonnet_4_6',
      response_json_schema: {
        type: 'object',
        properties: {
          regions: { type: 'array', items: { type: 'object' } },
          total_stitches: { type: 'number' },
          estimated_time_min: { type: 'number' },
          colors_used: { type: 'number' },
          width_mm: { type: 'number' },
          height_mm: { type: 'number' }
        }
      }
    });

    return Response.json({ success: true, data: result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Generates a semantic region name from color, position, and stitch type.
 * Format: [position]_[color]_[stitch_type] — e.g., "sup_izq_negro_fill", "cen_rosa_fill"
 * Never returns "region_hex_index" — always human-readable.
 */
function semanticName(r, i, w, h, stitchType) {
  // Position from centroid
  const [cx, cy] = r.centroid || [0.5, 0.5];
  const vPos = cy < 0.33 ? 'sup' : cy > 0.66 ? 'inf' : 'cen';
  const hPos = cx < 0.33 ? '_izq' : cx > 0.66 ? '_der' : '';
  const pos = `${vPos}${hPos}`;

  // Color name from hex
  const colorName = colorToName(r.hex);

  // Stitch abbreviation
  const stitchAbbr = stitchType === 'fill' ? 'fill' : stitchType === 'satin' ? 'satin' : 'run';

  return `${pos}_${colorName}_${stitchAbbr}`;
}

function colorToName(hex) {
  if (!hex || hex.length < 7) return 'color';
  const h = hex.toLowerCase();
  const r = parseInt(h.slice(1,3),16) || 128;
  const g = parseInt(h.slice(3,5),16) || 128;
  const b = parseInt(h.slice(5,7),16) || 128;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lum = (r + g + b) / 3;
  const delta = max - min;

  if (lum < 30) return 'negro';
  if (lum > 230 && delta < 20) return 'blanco';
  if (delta < 25) return 'gris';

  // Hue-based classification (accurate for all colors)
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = hue * 60;
  if (hue < 0) hue += 360;

  // Red/pink boundary (345°-15°): distinguish by saturation + luminance
  // Low saturation + light = pink; high saturation = red
  if (hue < 15 || hue >= 345) {
    if (delta < 80 && lum > 150) return 'rosa';
    return 'rojo';
  }
  if (hue < 45) return 'naranja';
  if (hue < 65) return 'amarillo';
  if (hue < 165) return 'verde';
  if (hue < 195) return 'cyan';
  if (hue < 255) return 'azul';
  if (hue < 285) return 'morado';
  return 'rosa';
}

/**
 * Classify stitch type from THICKNESS (primary signal).
 * Thickness = minimum bbox dimension in mm — the physical width the needle
 * must cover. Reliable classifier for home machines (Caydo CE01):
 *
 *   grosor < 2.5mm  → running_stitch (contorno fino)
 *   2.5mm ≤ grosor ≤ 12mm → satin (relleno denso paralelo)
 *   grosor > 12mm   → fill (tatami)
 *
 * Fallback when bbox unavailable: area + inertia heuristics.
 */
function clasificarPorGeometria(r, w = 100, h = 100, aW = 512, aH = 512) {
  const areaMm2 = (r.coverage || 0) * w * h;
  const bbox = r.bbox;

  let thicknessMm = Infinity;
  if (bbox && bbox.minX !== undefined) {
    const bwMm = ((bbox.maxX - bbox.minX) / aW) * w;
    const bhMm = ((bbox.maxY - bbox.minY) / aH) * h;
    thicknessMm = Math.min(bwMm, bhMm);
  }

  if (!isFinite(thicknessMm)) {
    const inertia = r.inertia_ratio !== undefined ? r.inertia_ratio : 1;
    const aspect  = r.bbox_aspect   !== undefined ? r.bbox_aspect   : 1;
    if (areaMm2 < 2.5) return 'running_stitch';
    if (inertia > 4 || aspect > 3.5) return areaMm2 < 50 ? 'running_stitch' : 'satin';
    if (areaMm2 < 50) return 'satin';
    return 'fill';
  }

  if (thicknessMm < 2.5) return 'running_stitch';
  if (thicknessMm <= 12) return 'satin';
  return 'fill';
}

/**
 * Adaptive density scaling based on region area.
 * Smaller regions: higher density (better coverage)
 * Larger regions: lower density (faster, less needle stress)
 * Maintains visual uniformity across all sizes.
 */
function adaptDensity(baseDensity, areaMm2) {
  if (areaMm2 < 10) return Math.min(0.6, baseDensity * 1.8);  // Tiny: very dense
  if (areaMm2 < 20) return Math.min(0.55, baseDensity * 1.5);  // Small: dense
  if (areaMm2 < 50) return Math.min(0.5, baseDensity * 1.2);   // Medium-small: slightly dense
  if (areaMm2 > 300) return Math.max(0.40, baseDensity * 0.7); // Large: never denser than 0.40mm
  return baseDensity; // Normal
}

/**
 * Canonical stitch count formula — single source of truth for backend + regionBuilder.
 * Aligned with physical embroidery constants:
 *   fill:    ~2.5 stitches/mm² at density 1.0 (0.4mm row spacing)
 *   satin:   ~2 stitches/mm of perimeter per mm of width
 *   running: ~1 stitch per 1.5mm of perimeter
 */
function calcularStitchCount(r, type, density, w, h) {
  const areaMm2     = (r.coverage || 0.01) * w * h;
  const diagMm      = Math.hypot(w, h);
  const perimeterMm = r.perimeter_norm
    ? r.perimeter_norm * diagMm
    : (r.perimeter_mm || Math.sqrt(areaMm2) * 3.8);

  const dens = Math.max(0.2, density); // guard against zero/negative

  if (type === 'fill') {
    // Physical formula: rows = area / (rowSpacing * avgRowLength)
    // rowSpacing = density (mm), avgRowLength ≈ sqrt(area) * 1.1 (accounts for shape irregularity)
    // stitchesPerRow = avgRowLength / stitch_length (2.5mm nominal)
    const rowSpacing   = dens;
    const avgRowLength = Math.sqrt(areaMm2) * 1.1;
    const numRows      = avgRowLength / rowSpacing;
    const stitchLength = 2.4; // mm nominal
    return Math.round((areaMm2 / rowSpacing) * (1 / stitchLength));
  } else if (type === 'satin') {
    // Satin physical model: needle travels perpendicular to the shape axis.
    // Number of columns = perimeter / 2 (half-perimeter = one side of the shape).
    // Column spacing = density_mm along the axis of travel.
    // Each column is a single stitch from edge to edge — no doubling.
    // Reference: 20mm long × 4mm wide satin @ 0.4mm = 20/0.4 = 50 stitches ✓
    const numColumns = (perimeterMm / 2) / dens;
    return Math.round(Math.max(1, numColumns));
  } else {
    // Running: 1 stitch every 1.8mm (standard 40wt thread)
    return Math.round(perimeterMm / 1.8);
  }
}