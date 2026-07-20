/**
 * Semantic Segmenter
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses LLM Vision to identify real objects in an image, then maps each
 * geometric contour (from contourEngine) to a semantic object.
 *
 * Each output region contains:
 *   object       — semantic label (e.g. "eye", "shirt", "background")
 *   object_group — category (e.g. "face", "clothing", "background")
 *   color        — dominant hex color
 *   geometry     — "compact" | "elongated" | "complex" | "linear"
 *   complexity   — 1–5 (1=simple, 5=very complex)
 *   curvature    — "flat" | "smooth" | "wavy" | "sharp"
 *   orientation  — degrees (0–180) of dominant axis
 *   priority     — 1–10 (embroidery build order: low layers first)
 *   stitch_type  — "fill" | "satin" | "running_stitch"
 *   stitch_notes — brief rationale for stitch type choice
 */

import { base44 } from '@/api/base44Client';

// ─── Content-type detection heuristics ────────────────────────────────────────

export function detectContentType(analysis) {
  const colors    = analysis?.dominantColors?.length || 0;
  const edgeAvg   = analysis?.edgeDensityMap
    ? analysis.edgeDensityMap.flat().reduce((s, v) => s + v, 0) / (analysis.edgeDensityMap.flat().length || 1)
    : 0;

  if (colors <= 5  && edgeAvg > 0.15) return 'logo';
  if (colors > 12)                    return 'photo';
  if (edgeAvg > 0.20)                 return 'drawing';
  if (colors <= 8  && edgeAvg < 0.10) return 'anime';
  return 'illustration';
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Analyzes image with LLM Vision to produce semantic object descriptions.
 * @param {string} imageUrl
 * @param {Object} analysis - from imageAnalysisStage (optional enrichment)
 * @param {string} contentType - 'logo' | 'photo' | 'drawing' | 'anime' | 'illustration'
 * @returns {Promise<SemanticMap>}
 */
export async function analyzeSemantics(imageUrl, analysis, contentType = 'illustration') {
  const prompt = buildPrompt(contentType, analysis);

  const schema = {
    type: 'object',
    properties: {
      content_type_confirmed: { type: 'string' },
      objects: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label:        { type: 'string' },
            description:  { type: 'string' },
            object_group: { type: 'string' },
            bbox:         {
              type: 'object',
              properties: {
                x: { type: 'number' }, y: { type: 'number' },
                w: { type: 'number' }, h: { type: 'number' },
              },
            },
            color_hex:    { type: 'string' },
            geometry:     { type: 'string', enum: ['compact', 'elongated', 'complex', 'linear'] },
            complexity:   { type: 'number' },
            curvature:    { type: 'string', enum: ['flat', 'smooth', 'wavy', 'sharp'] },
            orientation:  { type: 'number' },
            priority:     { type: 'number' },
            stitch_type:  { type: 'string', enum: ['fill', 'satin', 'running_stitch'] },
            stitch_notes: { type: 'string' },
          },
        },
      },
    },
  };

  const result = await base44.integrations.Core.InvokeLLM({
    prompt,
    file_urls:            [imageUrl],
    model:                'claude_sonnet_4_6',
    response_json_schema: schema,
  });

  return {
    contentType:           result.content_type_confirmed || contentType,
    objects:               normalizeObjects(result.objects || []),
  };
}

/**
 * Maps contour regions (from contourEngine) to semantic objects.
 * Each contour gets enriched with semantic metadata.
 */
export function mapContoursToSemantics(contourRegions, semanticMap) {
  if (!semanticMap?.objects?.length) return contourRegions;

  return contourRegions.map(region => {
    const match = findBestMatch(region, semanticMap.objects);
    if (!match) return { ...region, semantic: defaultSemantic(region) };

    return {
      ...region,
      semantic: {
        object:       match.label,
        description:  match.description,
        object_group: match.object_group,
        geometry:     match.geometry,
        complexity:   match.complexity,
        curvature:    match.curvature,
        orientation:  match.orientation,
        priority:     match.priority,
        stitch_type:  match.stitch_type,
        stitch_notes: match.stitch_notes,
        confidence:   match._confidence,
      },
    };
  });
}

// ─── Matching: contour centroid → semantic bbox ───────────────────────────────

function findBestMatch(region, objects) {
  const [cx, cy] = region.centroid || [0.5, 0.5];
  // Also use region color for color-aware matching
  const regionHex = (region.hex || region.color || '').toLowerCase();
  let best = null, bestScore = -Infinity;

  for (const obj of objects) {
    const { x, y, w, h } = obj.bbox;
    let score = bboxScore(cx, cy, x, y, w, h);

    // Color similarity bonus: if LLM color_hex is close to region's pixel color, boost score
    if (regionHex && obj.color_hex) {
      const colorSim = hexColorSimilarity(regionHex, obj.color_hex);
      score += colorSim * 0.3; // up to +0.3 boost for exact color match
    }

    if (score > bestScore) { bestScore = score; best = { ...obj, _confidence: score }; }
  }

  // Stricter threshold: require centroid clearly inside bbox OR strong color+spatial match
  // 0.4 = centroid must be inside bbox (score starts at 0.5 for inside)
  return bestScore >= 0.4 ? best : null;
}

function bboxScore(cx, cy, bx, by, bw, bh) {
  const inside = cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh;
  if (inside) {
    // Score by how centered the point is within the bbox (more centered = better match)
    const overlapX = Math.min(cx - bx, bx + bw - cx) / (bw / 2 + 1e-9);
    const overlapY = Math.min(cy - by, by + bh - cy) / (bh / 2 + 1e-9);
    return 0.5 + (overlapX + overlapY) * 0.25;
  }
  // Outside bbox: no match — LLM bbox estimates are too imprecise to trust outside hits
  return 0;
}

/** Returns 0–1 similarity between two hex colors (1 = identical) */
function hexColorSimilarity(hexA, hexB) {
  const parse = h => {
    const c = h.replace('#', '');
    return [parseInt(c.slice(0,2),16)||0, parseInt(c.slice(2,4),16)||0, parseInt(c.slice(4,6),16)||0];
  };
  const [r1,g1,b1] = parse(hexA);
  const [r2,g2,b2] = parse(hexB);
  const dist = Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
  return Math.max(0, 1 - dist / 441.67); // 441.67 = max possible RGB distance
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(contentType, analysis) {
  const typeGuide = {
    logo: `This is a LOGO or vector graphic. Focus on:
- Identify each graphic element (text, icon, shape, border, badge, shadow)
- Simple shapes → satin stitch (columns), complex fills → tatami fill
- Background areas if any → usually skip or running_stitch outline
- Prioritize: outlines and text last (they cover underlying fills)`,

    photo: `This is a PHOTOGRAPH. Focus on:
- Identify semantic regions: face, hair, skin, clothing, background, accessories
- Use fill for all large areas; satin only for very narrow elongated shapes (<3mm)
- Fine details like eyes, lips, buttons → running_stitch or satin
- Complex gradients areas → fill with high density
- Priority: background first, then clothing, then face, then details`,

    drawing: `This is a LINE DRAWING or ILLUSTRATION. Focus on:
- Black outlines → satin stitch (smooth columns along the edge)
- Colored fill areas → tatami fill
- Small details and line art → running_stitch
- Separate outline from fill regions clearly
- Priority: fill areas first, then all outlines on top`,

    anime: `This is ANIME / MANGA style art. Focus on:
- Large flat color areas (clothing, skin, hair) → fill (tatami)
- Black outlines and borders → satin
- Gradients in hair or shading → fill with adjusted density
- Eyes and face details → satin for irises, running_stitch for pupils
- Priority: background fill → clothing → skin → hair → outlines → eyes`,

    illustration: `This is a DIGITAL ILLUSTRATION. Focus on:
- Identify each distinct visual element as a semantic object
- Large flat areas → fill, narrow smooth areas → satin, details → running_stitch
- Preserve layer order (backgrounds first, details last)
- Consider whether edges are hard (→ satin border) or soft (→ fill blending)`,
  };

  const colors = analysis?.dominantColors?.length || 'unknown';

  return `You are a professional embroidery digitizing expert analyzing an image for machine embroidery production.
Content type: ${contentType.toUpperCase()}.

${typeGuide[contentType] || typeGuide.illustration}

TASK: Identify ALL visually distinct regions/objects that need separate embroidery treatment.
The image has approximately ${colors} dominant colors.

For EACH object/region, provide:
- label: short name (e.g. "left_eye", "shirt_body", "hair_highlight")
- description: 1 sentence describing it
- object_group: parent category (e.g. "face", "clothing", "background", "outline", "detail")
- bbox: normalized 0.0–1.0 bounding box {x, y, w, h} where (0,0) is top-left
- color_hex: dominant color as #rrggbb
- geometry: "compact" (round/square) | "elongated" (thin/long) | "complex" (irregular) | "linear" (line/stroke)
- complexity: 1–5 (1=simple rectangle, 5=very intricate with holes and curves)
- curvature: "flat" (straight edges) | "smooth" (gentle curves) | "wavy" (undulating) | "sharp" (angular, many corners)
- orientation: dominant axis angle in degrees 0–180 (0=horizontal, 90=vertical)
- priority: 1–10 embroidery build order (1=stitch first/bottom layer, 10=stitch last/top layer)
- stitch_type: "fill" | "satin" | "running_stitch"
  RULES: satin ONLY for shapes with width < ~5mm or clear elongated strokes.
         running_stitch for outlines, details, thin lines.
         fill for everything else.
- stitch_notes: 1 sentence explaining your stitch_type choice

Be comprehensive. Include background if visible. Separate overlapping objects (e.g. outline separate from fill).
Return a complete JSON matching the schema.`;
}

// ─── Normalizers and defaults ─────────────────────────────────────────────────

function normalizeObjects(objects) {
  return objects.map(o => ({
    label:        o.label        || 'region',
    description:  o.description  || '',
    object_group: o.object_group || 'element',
    bbox: {
      x: clamp(o.bbox?.x ?? 0),
      y: clamp(o.bbox?.y ?? 0),
      w: clamp(o.bbox?.w ?? 1),
      h: clamp(o.bbox?.h ?? 1),
    },
    color_hex:    o.color_hex   || '#888888',
    geometry:     o.geometry    || 'compact',
    complexity:   Math.min(5, Math.max(1, Math.round(o.complexity || 2))),
    curvature:    o.curvature   || 'smooth',
    orientation:  o.orientation ?? 0,
    priority:     Math.min(10, Math.max(1, Math.round(o.priority || 5))),
    stitch_type:  o.stitch_type || 'fill',
    stitch_notes: o.stitch_notes || '',
  }));
}

function defaultSemantic(region) {
  const isSmall    = (region.area_norm || 0) < 0.01;
  const isElongated = (region.inertia_ratio || 1) > 3;
  const stitch_type = isElongated ? 'satin' : isSmall ? 'running_stitch' : 'fill';
  return {
    object:       'region',
    description:  '',
    object_group: 'element',
    geometry:     isElongated ? 'elongated' : 'compact',
    complexity:   2,
    curvature:    'smooth',
    orientation:  region.fill_angle || 0,
    priority:     5,
    stitch_type,
    stitch_notes: 'Auto-classified from geometry',
    confidence:   0,
  };
}

function clamp(v) { return Math.max(0, Math.min(1, v)); }