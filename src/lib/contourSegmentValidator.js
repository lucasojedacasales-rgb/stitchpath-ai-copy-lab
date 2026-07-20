/**
 * contourSegmentValidator.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Final validation of contour segments against the strict dark mask.
 *
 * Artificial diagonals appear when a contour that is really an OPEN dark line
 * gets classified as closed and is satin-closed / triple-run-closed across a
 * gap with no real black pixels — producing a long visible stitch crossing the
 * design interior.
 *
 * Two guards:
 *   1. validateContourSegmentsAgainstDarkMask(contourObjects, darkStroke, config)
 *      — runs at object-build time. For each contour object it checks every
 *        consecutive segment AND the implied closing segment (last→first for
 *        closed contours). Any segment longer than 2.5mm (or 6px) with dark-mask
 *        support < 0.85 is cut: the chain is split into open sub-objects, or
 *        the contour is forced open so no closing stitch is generated.
 *   2. validateFinalContourCommandsAgainstDarkMask(commands, darkStroke, config)
 *      — backstop at command level. Any contour/detail stitch longer than
 *        2.5mm without dark support is converted to a jump (+trim if it
 *        bridges two stitched pieces), never left as a visible stitch.
 *
 * Cuts only — never bridges, never invents geometry, never converts to
 * bbox/hull/oval. "Si hay duda entre unir o cortar, cortar."
 */

const MIN_LEN_MM = 2.5;
const MIN_LEN_PX = 6;
const SUPPORT_THRESHOLD = 0.85;
const SUSPICIOUS_MM = 8;

function mmToPx(pt, w, h, W, H) {
  return [(pt[0] / w + 0.5) * W, (pt[1] / h + 0.5) * H];
}

function segmentDarkSupport(ax, ay, bx, by, mask, W, H) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return 1;
  const steps = Math.max(2, Math.ceil(len));
  let hits = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    let on = false;
    for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = Math.round(x) + dx, ny = Math.round(y) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (mask[ny * W + nx]) { on = true; break; }
    }
    if (on) hits++;
  }
  return hits / (steps + 1);
}

function checkSegment(a, b, darkStroke, config, report, obj) {
  if (!darkStroke || !darkStroke.strictMask) return { unsupported: false, support: 1 };
  const W = darkStroke.width, H = darkStroke.height;
  const mask = darkStroke.strictMask;
  const w = config.width_mm || 100, h = config.height_mm || 100;
  const lenMm = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [ax, ay] = mmToPx(a, w, h, W, H);
  const [bx, by] = mmToPx(b, w, h, W, H);
  const lenPx = Math.hypot(bx - ax, by - ay);
  if (lenMm <= MIN_LEN_MM && lenPx <= MIN_LEN_PX) return { unsupported: false, support: 1 };
  const support = segmentDarkSupport(ax, ay, bx, by, mask, W, H);
  if (support >= SUPPORT_THRESHOLD) return { unsupported: false, support };
  report.unsupportedLongContourSegments++;
  report.removedArtificialBridges++;
  if (lenMm > report.longestUnsupportedSegmentMm) {
    report.longestUnsupportedSegmentMm = lenMm;
    report.longestUnsupportedSegmentSupport = support;
  }
  if (lenMm > SUSPICIOUS_MM) report.suspiciousBlackDiagonalDetected = true;
  report.segments.push({ objectId: obj?.id, regionName: obj?.name, lengthMm: lenMm, support });
  return { unsupported: true, support };
}

export function validateContourSegmentsAgainstDarkMask(contourObjects, darkStroke, config = {}) {
  const report = {
    unsupportedLongContourSegments: 0,
    removedArtificialBridges: 0,
    longestUnsupportedSegmentMm: 0,
    longestUnsupportedSegmentSupport: 0,
    suspiciousBlackDiagonalDetected: false,
    segments: [],
  };
  if (!darkStroke || !darkStroke.strictMask) return { objects: contourObjects, report };

  const out = [];
  for (const obj of contourObjects) {
    const pts = obj.points || [];
    if (pts.length < 2) { out.push(obj); continue; }

    // 1. Consecutive segments — cut chain at unsupported long segments
    const chains = [];
    let cur = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const r = checkSegment(a, b, darkStroke, config, report, obj);
      if (r.unsupported) {
        if (cur.length >= 2) chains.push(cur);
        cur = [b];
      } else {
        cur.push(b);
      }
    }
    if (cur.length >= 2) chains.push(cur);

    // 2. Closing segment (closed contours) — if unsupported long, force open
    const isClosed = obj.rawRegion?.closed !== false;
    let forceOpen = false;
    if (isClosed && chains.length === 1 && chains[0].length >= 3) {
      const chain = chains[0];
      const r = checkSegment(chain[chain.length - 1], chain[0], darkStroke, config, report, obj);
      if (r.unsupported) forceOpen = true;
    }

    if (chains.length === 0) {
      // entirely unsupported — dropped
    } else if (chains.length === 1 && !forceOpen) {
      out.push(obj);
    } else {
      for (const chain of chains) {
        if (chain.length < 2) continue;
        out.push({
          ...obj,
          points: chain,
          rawRegion: { ...(obj.rawRegion || {}), closed: false },
          _forceOpen: true,
        });
      }
    }
  }
  return { objects: out, report };
}

function isContourCommand(c) {
  if (c.type !== 'stitch') return false;
  const lt = (c.layerType || '').toLowerCase();
  const st = (c.stitchType || '').toLowerCase();
  const rid = (c.regionId || '').toLowerCase();
  return lt.includes('outline') || lt.includes('contour') || lt.includes('detail') ||
    lt.includes('mouth') || lt.includes('eye') || lt.includes('facial') ||
    st === 'satin' || st === 'running_stitch' ||
    rid.includes('outline') || rid.includes('contour') || rid.includes('mouth') ||
    rid.includes('detail') || rid.includes('eye');
}

export function validateFinalContourCommandsAgainstDarkMask(commands, darkStroke, config = {}) {
  const report = {
    unsupportedLongContourSegments: 0,
    removedArtificialBridges: 0,
    longestUnsupportedSegmentMm: 0,
    longestUnsupportedSegmentSupport: 0,
    suspiciousBlackDiagonalDetected: false,
    details: [],
  };
  if (!darkStroke || !darkStroke.strictMask) return { commands, report };

  const W = darkStroke.width, H = darkStroke.height;
  const mask = darkStroke.strictMask;
  const w = config.width_mm || 100, h = config.height_mm || 100;

  const out = [];
  let prevX = 0, prevY = 0;
  let prevWasStitch = false;

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (isContourCommand(c)) {
      const lenMm = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
      if (lenMm > MIN_LEN_MM) {
        const [ax, ay] = mmToPx([prevX, prevY], w, h, W, H);
        const [bx, by] = mmToPx([c.x || 0, c.y || 0], w, h, W, H);
        const support = segmentDarkSupport(ax, ay, bx, by, mask, W, H);
        if (support < SUPPORT_THRESHOLD) {
          report.unsupportedLongContourSegments++;
          report.removedArtificialBridges++;
          if (lenMm > report.longestUnsupportedSegmentMm) {
            report.longestUnsupportedSegmentMm = lenMm;
            report.longestUnsupportedSegmentSupport = support;
          }
          if (lenMm > SUSPICIOUS_MM) report.suspiciousBlackDiagonalDetected = true;
          report.details.push({
            commandIndex: i, sourceObjectId: c.regionId, sourceRegionName: c.regionId,
            lengthMm: lenMm, support,
          });
          // insert trim only if previous was a stitch and last pushed isn't already a trim
          if (prevWasStitch && out[out.length - 1]?.type !== 'trim') {
            out.push({ type: 'trim', x: prevX, y: prevY, color: c.color, regionId: c.regionId });
          }
          out.push({ ...c, type: 'jump' });
          prevX = c.x || 0; prevY = c.y || 0; prevWasStitch = false;
          continue;
        }
      }
    }
    out.push(c);
    if (c.type === 'stitch') { prevX = c.x || 0; prevY = c.y || 0; prevWasStitch = true; }
    else if (c.type === 'jump') { prevX = c.x || 0; prevY = c.y || 0; prevWasStitch = false; }
    else if (c.type === 'trim') { prevWasStitch = false; }
  }
  return { commands: out, report };
}