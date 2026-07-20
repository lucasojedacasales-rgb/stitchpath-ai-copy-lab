// ── TATAMI FILL ENGINE ────────────────────────────────────────────────────────
// Professional tatami fill stitch generation for embroidery regions.
// All coordinates are in canvas pixel space (drawW/drawH mapped).

// ── Polygon clipping helpers ──────────────────────────────────────────────────

function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function scale(a, s) { return [a[0] * s, a[1] * s]; }

// Sutherland-Hodgman polygon clipping — clip polygon against a half-plane defined by edge (a→b, inside = left)
function clipPolygonByEdge(poly, a, b) {
  if (poly.length === 0) return [];
  const result = [];
  const normal = [-(b[1] - a[1]), b[0] - a[0]]; // left-pointing normal

  const inside = p => dot(sub(p, a), normal) >= 0;
  const intersect = (p, q) => {
    const d = sub(q, p);
    const denom = dot(normal, d);
    if (Math.abs(denom) < 1e-10) return p;
    const t = dot(normal, sub(a, p)) / denom;
    return add(p, scale(d, t));
  };

  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i - 1 + poly.length) % poly.length];
    const curIn = inside(cur), prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) result.push(intersect(prev, cur));
      result.push(cur);
    } else if (prevIn) {
      result.push(intersect(prev, cur));
    }
  }
  return result;
}

// Clip polygon against all edges of another convex polygon (Sutherland-Hodgman)
function clipPolygon(subject, clip) {
  let output = subject;
  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) return [];
    output = clipPolygonByEdge(output, clip[i], clip[(i + 1) % clip.length]);
  }
  return output;
}

// Clip a line segment [p0, p1] against a polygon, returning array of [enter, exit] pairs
function clipLineAgainstPolygon(p0, p1, polygon) {
  // Parametric clipping: find all t values where line crosses polygon edges
  let tMin = 0, tMax = 1;
  const d = sub(p1, p0);

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const normal = [-(b[1] - a[1]), b[0] - a[0]];
    const denom = dot(normal, d);
    const num = dot(normal, sub(a, p0));

    if (Math.abs(denom) < 1e-10) {
      // Parallel: outside if num < 0
      if (num < 0) return [];
    } else {
      const t = num / denom;
      if (denom < 0) { if (t > tMin) tMin = t; }
      else           { if (t < tMax) tMax = t; }
    }
    if (tMin > tMax) return [];
  }

  if (tMin > tMax) return [];
  return [[add(p0, scale(d, tMin)), add(p0, scale(d, tMax))]];
}

// ── Polygon winding ────────────────────────────────────────────────────────────

/** Signed area via Shoelace. Positive = CCW in standard coords (y-up). Canvas is y-down so positive = CW. */
function signedArea(poly) {
  let area = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i][0] * poly[j][1];
    area -= poly[j][0] * poly[i][1];
  }
  return area / 2;
}

/** Ensure polygon is CW in canvas space (y-down) so outward normals point outward */
function ensureCW(poly) {
  return signedArea(poly) > 0 ? poly : [...poly].reverse();
}

// ── Polygon offset (pull compensation) ────────────────────────────────────────

function offsetPolygon(poly, amount) {
  if (amount === 0 || poly.length < 3) return poly;
  const oriented = ensureCW(poly); // ensure consistent winding before offsetting
  const result = [];
  const n = oriented.length;

  for (let i = 0; i < n; i++) {
    const prev = oriented[(i - 1 + n) % n];
    const cur  = oriented[i];
    const next = oriented[(i + 1) % n];

    const e1 = sub(cur, prev);
    const e2 = sub(next, cur);
    const len1 = Math.hypot(e1[0], e1[1]) || 1;
    const len2 = Math.hypot(e2[0], e2[1]) || 1;

    // Outward normals
    const n1 = [-e1[1] / len1, e1[0] / len1];
    const n2 = [-e2[1] / len2, e2[0] / len2];

    // Bisector
    const bis = add(n1, n2);
    const bisLen = Math.hypot(bis[0], bis[1]) || 1;
    const cosHalf = dot(n1, [bis[0] / bisLen, bis[1] / bisLen]);
    const miterLen = cosHalf > 0.1 ? amount / cosHalf : amount;

    result.push(add(cur, scale([bis[0] / bisLen, bis[1] / bisLen], Math.min(miterLen, amount * 3))));
  }
  return result;
}


// ── Bounding box in rotated space ─────────────────────────────────────────────

function rotatedBBox(pts, angle) {
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, y] of pts) {
    const u = x * cos - y * sin;
    const v = x * sin + y * cos;
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  return { minU, maxU, minV, maxV };
}

// ── MAIN: Generate tatami fill stitches ───────────────────────────────────────
// pts: array of [x,y] in canvas px
// region: { angle, density, pull_compensation, underlay, color }
// Returns { underlayLines: [[p0,p1],...], fillLines: [[p0,p1],...] }

export function generateTatamiLines(pts, region, drawW, drawH) {
  const angle = ((region.angle || 45) * Math.PI) / 180;
  const density = region.density || 0.7;
  // spacing in px: density maps 0.4→5px, 1.0→1px
  const spacing = Math.max(1.5, 5 / density);
  const pullComp = (region.pull_compensation || 0.15) * (drawW / 100); // convert mm to px
  const needleOffset = 0.3 * (drawW / 100); // 0.3mm in px
  const sectionWidth = 6 * (drawW / 100);   // 6mm in px

  // Apply pull compensation — expand polygon outward
  const expandedPoly = offsetPolygon(pts, pullComp);

  // Rotated bounding box
  const bbox = rotatedBBox(expandedPoly, angle);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  // Rotate a point from local (u,v) to world (x,y)
  const toWorld = (u, v) => [u * cos - v * sin, u * sin + v * cos];

  const fillLines = [];
  const underlayLines = [];

  // ── UNDERLAY ─────────────────────────────────────────────────────────────
  if (region.underlay !== false) {
    const underlaySpacing = spacing * 2.5;
    const underlayAngle = angle + Math.PI / 2; // perpendicular
    const ucos = Math.cos(underlayAngle), usin = Math.sin(underlayAngle);
    const ubbox = rotatedBBox(expandedPoly, underlayAngle);

    let uLineIdx = 0;
    for (let v = ubbox.minV; v <= ubbox.maxV; v += underlaySpacing) {
      const worldA = [ubbox.minU * ucos - v * usin, ubbox.minU * usin + v * ucos];
      const worldB = [ubbox.maxU * ucos - v * usin, ubbox.maxU * usin + v * ucos];
      const clipped = clipLineAgainstPolygon(worldA, worldB, expandedPoly);
      for (const [p0, p1] of clipped) {
        // Alternate direction
        underlayLines.push(uLineIdx % 2 === 0 ? [p0, p1] : [p1, p0]);
        uLineIdx++;
      }
    }
  }

  // ── TATAMI FILL ──────────────────────────────────────────────────────────
  let lineIdx = 0;
  // Divide u-extent into sections of sectionWidth
  const totalU = bbox.maxU - bbox.minU;
  const numSections = Math.max(1, Math.ceil(totalU / sectionWidth));

  for (let sec = 0; sec < numSections; sec++) {
    const uStart = bbox.minU + sec * sectionWidth;
    const uEnd   = Math.min(bbox.maxU, uStart + sectionWidth);

    for (let v = bbox.minV; v <= bbox.maxV; v += spacing) {
      // Line endpoints in world space (full section width)
      const worldA = toWorld(uStart, v);
      const worldB = toWorld(uEnd, v);

      const clipped = clipLineAgainstPolygon(worldA, worldB, expandedPoly);
      for (const [p0, p1] of clipped) {
        // Alternate direction (zig-zag / tatami)
        const isOdd = lineIdx % 2 === 1;
        const start = isOdd ? p1 : p0;
        const end   = isOdd ? p0 : p1;

        // Needle offset: alternate entry/exit points ±needleOffset along V axis
        const perp = [-sin, cos]; // perpendicular to stitch direction
        const off = (lineIdx % 4 < 2 ? 1 : -1) * needleOffset;
        const s = add(start, scale(perp, off));
        const e = add(end,   scale(perp, off));

        fillLines.push([s, e]);
        lineIdx++;
      }
    }
  }

  return { fillLines, underlayLines };
}

// ── CANVAS DRAWING ────────────────────────────────────────────────────────────

export function drawTatamiRegion(ctx, pts, region, drawW, drawH, zoom, isSelected, isHovered, stitchOpacity) {
  if (!pts || pts.length < 3) return;

  const color = region.color || '#ffffff';
  const baseAlpha = stitchOpacity / 100;

  // Map normalized pts to canvas px
  const cpx = pts.map(p => [(p[0] - 0.5) * drawW, (p[1] - 0.5) * drawH]);

  const { fillLines, underlayLines } = generateTatamiLines(cpx, region, drawW, drawH);

  // ── Draw underlay (40% opacity, darker color) ─────────────────────────────
  if (underlayLines.length > 0) {
    ctx.globalAlpha = baseAlpha * 0.4;
    ctx.strokeStyle = darkenColor(color, 0.5);
    ctx.lineWidth = 1.0 / zoom;
    ctx.lineCap = 'round';
    for (const [p0, p1] of underlayLines) {
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
  }

  // ── Draw fill (85% opacity, with fuzz at high zoom) ───────────────────────
  ctx.globalAlpha = baseAlpha * 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / zoom;
  ctx.lineCap = 'round';

  const useFuzz = zoom >= 2; // fuzz at zoom > 200%
  const fuzzRange = 0.05 * (drawW / 100); // ±0.05mm in px

  for (let i = 0; i < fillLines.length; i++) {
    const [p0, p1] = fillLines[i];
    // Pseudo-random fuzz seeded by line index (deterministic, no flicker)
    const fuzz = useFuzz ? ((((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 2 * fuzzRange : 0;
    ctx.beginPath();
    ctx.moveTo(p0[0] + fuzz, p0[1] + fuzz);
    ctx.lineTo(p1[0] + fuzz, p1[1] + fuzz);
    ctx.stroke();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function darkenColor(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const d = v => Math.max(0, Math.round(v * factor)).toString(16).padStart(2, '0');
  return `#${d(r)}${d(g)}${d(b)}`;
}