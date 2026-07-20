/**
 * cartoonOutlineOverride.js — Reference Learning Engine v2
 * ─────────────────────────────────────────────────────────────────────────────
 * CARTOON_OUTLINE_PROFESSIONAL_OVERRIDE
 *
 * El preset aprendido puede haber fijado:
 *   contourAfterFill = false
 *   useSatinForOuterContours = false
 *
 * Para diseños cartoon/personaje con contorno negro real esto es incorrecto:
 * el contorno negro exterior debe coserse DESPUÉS del relleno (sobre él) y en
 * satin (salvo que sea demasiado fino). Los detalles van al final.
 *
 * Este módulo detecta si el diseño actual cumple las tres condiciones:
 *   1. perfil seleccionado = complex_character | cartoon_character
 *   2. existe contorno negro real (darkStroke mask coverage o regiones outer_outline)
 *   3. outerOutlineCount > 0
 *
 * Y devuelve un override del preset justificado. No aplica a logos simples
 * sin contorno cartoon.
 *
 * Read-only respecto al motor: solo decide valores del preset.
 */

const MIN_SATIN_WIDTH_MM = 0.8;

/**
 * @param {object} ctx
 * @param {Array} ctx.regions
 * @param {Array} ctx.commands
 * @param {object} ctx.selectedProfile
 * @param {object} ctx.darkStroke
 * @returns {{ applies, override, reasons, maskCoverage, outerOutlineCount, avgWidth, tooThin }}
 */
export function detectCartoonOutlineOverride({ regions, commands = [], selectedProfile, darkStroke }) {
  const reasons = [];
  const profileName = selectedProfile?.name || '';
  const isCartoonProfile = profileName === 'complex_character' || profileName === 'cartoon_character';
  if (!isCartoonProfile) {
    return { applies: false, reasons: [`perfil "${profileName}" no es cartoon/personaje — override no aplica`], maskCoverage: 0, outerOutlineCount: 0 };
  }

  // ── 1. Black outline real via dark stroke mask coverage ──
  let blackOutlinePixels = 0, maskTotal = 0;
  if (darkStroke?.strictMask && darkStroke.width && darkStroke.height) {
    const m = darkStroke.strictMask, W = darkStroke.width, H = darkStroke.height;
    maskTotal = W * H;
    for (let i = 0; i < m.length; i++) if (m[i]) blackOutlinePixels++;
  }
  const maskCoverage = maskTotal > 0 ? blackOutlinePixels / maskTotal : 0;
  const hasDarkMask = maskCoverage > 0.003; // ≥0.3% píxeles oscuros

  // ── 2. outerOutlineCount desde regiones ──
  const outerRegions = (regions || []).filter((r) => {
    const rc = r.region_class || r.layerType || '';
    const st = r.stitch_type || '';
    return rc.includes('outer_outline') || rc === 'outer_silhouette' || rc === 'limb_contour' ||
      (st === 'running_stitch' && isDarkColorRegion(r));
  });
  const outerOutlineCount = outerRegions.length;
  const hasBlackOutline = hasDarkMask || outerOutlineCount > 0;

  if (!hasBlackOutline || outerOutlineCount === 0) {
    return {
      applies: false,
      reasons: [`sin contorno negro real (maskCoverage=${(maskCoverage * 100).toFixed(2)}%, outerOutlineCount=${outerOutlineCount})`],
      maskCoverage, outerOutlineCount: 0,
    };
  }

  // ── 3. too-thin detection (satin vs running) ──
  const widths = outerRegions.map((r) => r.contour_width_mm || r.satin_width_mm || r.width_mm || 1.5);
  const avgWidth = widths.reduce((s, w) => s + w, 0) / widths.length;
  const tooThin = avgWidth < MIN_SATIN_WIDTH_MM;

  const override = {
    contourAfterFill: true,
    useSatinForOuterContours: !tooThin, // running si demasiado fino
    detailsLast: true,
    minSatinWidthMm: MIN_SATIN_WIDTH_MM,
    avgOuterWidthMm: avgWidth,
  };

  reasons.push(`CARTOON_OUTLINE_PROFESSIONAL_OVERRIDE aplicado: perfil=${profileName}, maskCoverage=${(maskCoverage * 100).toFixed(2)}%, outerOutlineCount=${outerOutlineCount}, avgWidth=${avgWidth.toFixed(2)}mm, tooThin=${tooThin}`);
  if (tooThin) {
    reasons.push(`contorno demasiado fino (${avgWidth.toFixed(2)}mm < ${MIN_SATIN_WIDTH_MM}mm) → useSatinForOuterContours=false (running stitch)`);
  } else {
    reasons.push(`contorno suficientemente ancho → useSatinForOuterContours=true (satin)`);
  }
  reasons.push('contourAfterFill=true (contorno exterior cosido sobre el relleno)');
  reasons.push('detailsLast=true (boca/ojos/detalles al final)');

  return { applies: true, override, reasons, maskCoverage, outerOutlineCount, avgWidth, tooThin };
}

function isDarkColorRegion(r) {
  const c = r.color || '#ffffff';
  const h = c.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  const rr = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
  return (0.299 * rr + 0.587 * gg + 0.114 * bb) < 80;
}