/**
 * physicsSimulator.js — Motor de simulación física fotorrealista de bordado
 *
 * Simula con precisión física:
 *   - Perfil cilíndrico del hilo con múltiples capas de luz
 *   - Especular anisotrópico según dirección de la puntada
 *   - Subsurface scattering simulado (hilo translúcido)
 *   - Oclusión ambiental entre puntadas adyacentes
 *   - Sombra de proyección con offset físico (relieve Z)
 *   - Deformación del tejido bajo tensión
 *   - Tensión real: curvatura cuadrática con física de catenaria
 *   - Underlay con compression de tejido visible
 *   - Superposición de capas con acumulación de profundidad
 */

// ─── Perfiles físicos de hilo ─────────────────────────────────────────────────
// Basado en estándares industriales de hilo de bordar 40wt / 60wt

export const STITCH_TYPE_PROFILES = {
  fill: {
    threadDiameterMm:  0.38,   // hilo 40wt estándar
    glossBoost:        0.00,
    shadowAlpha:       0.28,
    specularWidth:     0.30,
    rimLightStrength:  0.18,   // borde iluminado en lado contrario a la luz
    sssStrength:       0.12,   // subsurface scattering
    ovalityX:          1.00,   // perfil circular
    ovalityY:          0.92,   // ligera ovalización por compresión de la tela
  },
  satin: {
    threadDiameterMm:  0.35,
    glossBoost:        0.28,   // satén mucho más brillante — columnas muy juntas
    shadowAlpha:       0.12,
    specularWidth:     0.22,   // pico especular estrecho y duro
    rimLightStrength:  0.25,
    sssStrength:       0.08,
    ovalityX:          1.00,
    ovalityY:          0.88,
  },
  running_stitch: {
    threadDiameterMm:  0.25,   // hilo 60wt fino
    glossBoost:        0.05,
    shadowAlpha:       0.35,   // puntadas aisladas = sombra más visible
    specularWidth:     0.40,
    rimLightStrength:  0.10,
    sssStrength:       0.18,   // más translúcido por ser más fino
    ovalityX:          1.00,
    ovalityY:          1.00,
  },
};

// ─── Tejidos ──────────────────────────────────────────────────────────────────

export const FABRIC_SIM_PARAMS = {
  'Algodón':   { glossiness: 0.25, tensionBase: 0.75, threadMult: 1.00, lightAngleDeg: 40, fabricBump: 0.08 },
  'Poliéster': { glossiness: 0.55, tensionBase: 0.85, threadMult: 0.95, lightAngleDeg: 35, fabricBump: 0.04 },
  'Denim':     { glossiness: 0.15, tensionBase: 0.65, threadMult: 1.15, lightAngleDeg: 50, fabricBump: 0.14 },
  'Lino':      { glossiness: 0.20, tensionBase: 0.70, threadMult: 1.05, lightAngleDeg: 45, fabricBump: 0.12 },
  'Seda':      { glossiness: 0.80, tensionBase: 0.90, threadMult: 0.85, lightAngleDeg: 30, fabricBump: 0.02 },
  'Lycra':     { glossiness: 0.40, tensionBase: 0.55, threadMult: 1.10, lightAngleDeg: 40, fabricBump: 0.06 },
  'Mezcla':    { glossiness: 0.35, tensionBase: 0.75, threadMult: 1.00, lightAngleDeg: 42, fabricBump: 0.07 },
  'Otro':      { glossiness: 0.30, tensionBase: 0.75, threadMult: 1.00, lightAngleDeg: 45, fabricBump: 0.09 },
};

const FABRIC_COLORS = {
  'Algodón':   '#f2ece0',
  'Poliéster': '#eaecf2',
  'Denim':     '#3d4a5c',
  'Lino':      '#e2d8bf',
  'Seda':      '#f5f0e6',
  'Lycra':     '#252535',
  'Mezcla':    '#e8e2d4',
  'Otro':      '#ddd8cc',
};

// ─── Utilidades de color ──────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 128,
    g: parseInt(h.slice(2, 4), 16) || 128,
    b: parseInt(h.slice(4, 6), 16) || 128,
  };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

function lighten(hex, f) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r + (255 - r) * f, g: g + (255 - g) * f, b: b + (255 - b) * f });
}

function darken(hex, f) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r * (1 - f), g: g * (1 - f), b: b * (1 - f) });
}

function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

// Luminancia percibida (0–1) — usada para ajustar brillo especular
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ─── Textura de tejido fotorrealista ─────────────────────────────────────────

export function drawFabricTexture(ctx, W, H, fabricType) {
  ctx.clearRect(0, 0, W, H);

  const baseColor = FABRIC_COLORS[fabricType] || FABRIC_COLORS['Algodón'];
  const params    = FABRIC_SIM_PARAMS[fabricType] || FABRIC_SIM_PARAMS['Algodón'];

  // ── Fondo base ──
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, W, H);

  // ── Gradiente de iluminación ambiental (simula curvatura del bastidor) ──
  const ambient = ctx.createRadialGradient(W * 0.45, H * 0.40, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.65);
  ambient.addColorStop(0,   'rgba(255,255,255,0.08)');
  ambient.addColorStop(0.6, 'rgba(0,0,0,0.00)');
  ambient.addColorStop(1,   'rgba(0,0,0,0.12)');
  ctx.fillStyle = ambient;
  ctx.fillRect(0, 0, W, H);

  // ── Trama específica por tejido ──
  drawFabricWeave(ctx, W, H, fabricType, params.fabricBump);
}

function drawFabricWeave(ctx, W, H, fabricType, bump) {
  if (fabricType === 'Denim') {
    // Trama de sarga diagonal característica del denim
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = '#6a7f9a';
    ctx.lineWidth = 1.2;
    for (let d = -H; d < W + H; d += 7) {
      ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + H, H); ctx.stroke();
    }
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#ffffff';
    for (let d = -H; d < W + H; d += 21) {
      ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + H, H); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (fabricType === 'Seda') {
    // Seda: brillo tornasolado con gradiente diagonal suave
    const grad = ctx.createLinearGradient(0, 0, W * 0.7, H);
    grad.addColorStop(0,    'rgba(255,255,255,0.18)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.04)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1,    'rgba(255,255,255,0.02)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  if (fabricType === 'Lycra') {
    // Lycra: hilos elásticos en diagonal
    ctx.globalAlpha = 0.09;
    ctx.strokeStyle = '#9090cc';
    ctx.lineWidth = 0.6;
    for (let x = -H; x < W + H; x += 4) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H * 0.6, H); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  // Trama genérica ortogonal (algodón, lino, poliéster, mezcla)
  const spacing = fabricType === 'Lino' ? 5 : 4;
  const alpha   = bump * 0.75;
  const color   = fabricType === 'Lino' ? '#9a8a6a' : '#7a6a55';

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  for (let x = 0; x < W; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (fabricType === 'Algodón' ? 1.5 : 0), H); ctx.stroke();
  }
  for (let y = 0; y < H; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + (fabricType === 'Algodón' ? 0.8 : 0)); ctx.stroke();
  }

  // Ruido fino de textura (simula irregularidad del tejido)
  ctx.globalAlpha = alpha * 0.4;
  for (let i = 0; i < W * H * 0.0012; i++) {
    const px = Math.random() * W, py = Math.random() * H;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)';
    ctx.fillRect(px, py, 1, 1);
  }
  ctx.globalAlpha = 1;
}

// ─── Renderizado principal de puntada física ──────────────────────────────────

/**
 * Dibuja una puntada con física completa de hilo de bordar.
 *
 * Capas de render (de abajo a arriba):
 *   1. Deformación del tejido (hundimiento del hilo)
 *   2. Sombra de proyección con offset físico (Z-height)
 *   3. Oclusión ambiental del borde inferior
 *   4. Cuerpo principal — gradiente cilíndrico multi-stop
 *   5. Rim light (luz de contorno lateral contrario)
 *   6. Brillo especular anisotrópico (lóbulo de Phong)
 *   7. Especular secundario de torsión del hilo
 */
export function drawPhysicalStitch(ctx, x0, y0, x1, y1, color, params) {
  const {
    threadThicknessPx = 2.5,
    tension           = 0.75,
    lightAngleDeg     = 45,
    glossiness        = 0.5,
    zoom              = 1,
    layerDepth        = 0,
    stitchType        = 'fill',
  } = params;

  const profile = STITCH_TYPE_PROFILES[stitchType] || STITCH_TYPE_PROFILES.fill;
  const diamRatio = profile.threadDiameterMm / 0.38;
  const thick = Math.max(0.7, (threadThicknessPx * diamRatio));

  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.2) return;

  const ux = dx / len, uy = dy / len;   // dirección de la puntada (unitario)
  const nx = -uy,      ny = ux;          // normal perpendicular

  // Vector de luz
  const lightRad  = (lightAngleDeg * Math.PI) / 180;
  const lx = Math.cos(lightRad), ly = Math.sin(lightRad);

  // Dot products para iluminación
  const threadDot  = Math.abs(ux * lx + uy * ly);         // alineación puntada–luz
  const normalDot  = Math.abs(nx * lx + ny * ly);          // normal perpendicular a luz
  const halfDot    = Math.abs((ux + nx) * lx / 2 + (uy + ny) * ly / 2); // Blinn-Phong half

  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const effectiveGloss = Math.min(1, glossiness + profile.glossBoost);
  const lum = luminance(color); // para ajustar efectos en colores oscuros vs claros

  // ── 1. Hundimiento del tejido (deformación) ──
  // El hilo presiona el tejido creando una ligera indentación visible
  if (thick > 1.0) {
    const deformAlpha = 0.10 + layerDepth * 0.06;
    const deformWidth = thick * (1.0 + profile.ovalityY * 0.3);
    ctx.strokeStyle = `rgba(0,0,0,${deformAlpha.toFixed(2)})`;
    ctx.lineWidth   = deformWidth * 1.8;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(x0 + ny * thick * 0.15, y0 - nx * thick * 0.15);
    ctx.lineTo(x1 + ny * thick * 0.15, y1 - nx * thick * 0.15); ctx.stroke();
  }

  // ── 2. Sombra de proyección con altura física ──
  const shadowAlpha  = profile.shadowAlpha * (0.5 + layerDepth * 0.5) * (1 - effectiveGloss * 0.3);
  const shadowZ      = thick * (0.35 + layerDepth * 0.25); // altura Z proporcional a capas
  const shadowShiftX = lx * shadowZ * 0.35;
  const shadowShiftY = ly * shadowZ * 0.45;

  ctx.strokeStyle = `rgba(0,0,0,${shadowAlpha.toFixed(3)})`;
  ctx.lineWidth   = thick * (1.2 + layerDepth * 0.15);
  ctx.lineCap     = 'round';
  ctx.shadowColor   = 'transparent';
  ctx.beginPath();
  ctx.moveTo(x0 + shadowShiftX, y0 + shadowShiftY);
  ctx.lineTo(x1 + shadowShiftX, y1 + shadowShiftY);
  ctx.stroke();

  // ── 3. AO (oclusión ambiental) en la base del hilo ──
  // Pequeño halo oscuro en el borde inferior crea sensación de relieve
  if (thick > 1.5) {
    const aoGrad = ctx.createLinearGradient(
      mx - nx * thick * 0.6, my - ny * thick * 0.6,
      mx + nx * thick * 0.6, my + ny * thick * 0.6
    );
    const aoAlpha = 0.15 + layerDepth * 0.08;
    aoGrad.addColorStop(0,    `rgba(0,0,0,${(aoAlpha * 0.9).toFixed(3)})`);
    aoGrad.addColorStop(0.12, `rgba(0,0,0,${aoAlpha.toFixed(3)})`);
    aoGrad.addColorStop(0.3,  'rgba(0,0,0,0)');
    aoGrad.addColorStop(0.7,  'rgba(0,0,0,0)');
    aoGrad.addColorStop(0.88, `rgba(0,0,0,${(aoAlpha * 0.7).toFixed(3)})`);
    aoGrad.addColorStop(1,    `rgba(0,0,0,${(aoAlpha * 0.85).toFixed(3)})`);
    ctx.strokeStyle = aoGrad;
    ctx.lineWidth   = thick * 1.05;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  // ── 4. Cuerpo principal — gradiente cilíndrico fotorrealista ──
  const baseRgb   = hexToRgb(color);
  const perpLen   = thick * 0.7;
  const gx0 = mx - nx * perpLen, gy0 = my - ny * perpLen;
  const gx1 = mx + nx * perpLen, gy1 = my + ny * perpLen;
  const bodyGrad  = ctx.createLinearGradient(gx0, gy0, gx1, gy1);

  // Factor de brillo por alineación con la luz + glosiness
  const brightBase    = 0.15 + threadDot * 0.12 + effectiveGloss * 0.10;
  const darkBase      = 0.28 + (1 - normalDot) * 0.10;
  // SSS: colores claros tienen más subsurface (transmisión de luz)
  const sssEffect     = profile.sssStrength * (0.4 + lum * 0.6);

  const hi  = (ch) => Math.min(255, Math.round(ch + (255 - ch) * (brightBase + sssEffect * 0.5)));
  const mid = (ch) => Math.min(255, Math.round(ch + (255 - ch) * sssEffect * 0.3));
  const sh  = (ch, f) => Math.max(0, Math.round(ch * (1 - f)));

  // 8-stop profile: edge_dark → AO_dark → base → SSS_mid → highlight → highlight → SSS_mid → edge_dark
  bodyGrad.addColorStop(0.00, `rgba(${sh(baseRgb.r,darkBase*1.1)},${sh(baseRgb.g,darkBase*1.1)},${sh(baseRgb.b,darkBase*1.1)},0.97)`);
  bodyGrad.addColorStop(0.10, `rgba(${sh(baseRgb.r,darkBase*0.5)},${sh(baseRgb.g,darkBase*0.5)},${sh(baseRgb.b,darkBase*0.5)},0.99)`);
  bodyGrad.addColorStop(0.22, `rgba(${mid(baseRgb.r)},${mid(baseRgb.g)},${mid(baseRgb.b)},1.00)`);
  bodyGrad.addColorStop(0.38, `rgba(${baseRgb.r},${baseRgb.g},${baseRgb.b},1.00)`);
  bodyGrad.addColorStop(0.48, `rgba(${hi(baseRgb.r)},${hi(baseRgb.g)},${hi(baseRgb.b)},1.00)`);
  bodyGrad.addColorStop(0.52, `rgba(${hi(baseRgb.r)},${hi(baseRgb.g)},${hi(baseRgb.b)},1.00)`);
  bodyGrad.addColorStop(0.66, `rgba(${baseRgb.r},${baseRgb.g},${baseRgb.b},1.00)`);
  bodyGrad.addColorStop(0.80, `rgba(${mid(baseRgb.r)},${mid(baseRgb.g)},${mid(baseRgb.b)},0.98)`);
  bodyGrad.addColorStop(0.92, `rgba(${sh(baseRgb.r,darkBase*0.7)},${sh(baseRgb.g,darkBase*0.7)},${sh(baseRgb.b,darkBase*0.7)},0.96)`);
  bodyGrad.addColorStop(1.00, `rgba(${sh(baseRgb.r,darkBase*1.0)},${sh(baseRgb.g,darkBase*1.0)},${sh(baseRgb.b,darkBase*1.0)},0.92)`);

  ctx.strokeStyle = bodyGrad;
  ctx.lineWidth   = thick;
  ctx.lineCap     = 'round';

  // ── Física de tensión: catenaria cuadrática ──
  // Hilo flojo → curva hacia abajo (gravedad simulada)
  // Hilo tenso → línea recta
  const sagMult = stitchType === 'running_stitch' ? 1.6 : stitchType === 'satin' ? 0.4 : 1.0;
  const slack   = Math.max(0, (0.85 - tension)) * sagMult;

  if (slack > 0.01 && len > thick * 2) {
    // Control point de catenaria: desplaza perpendicularmente al hilo
    const sag = thick * slack * 2.2;
    const cpx = mx + ny * sag;
    const cpy = my - nx * sag * 0.4; // ligero componente de gravedad vertical
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cpx, cpy, x1, y1);
    ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  // ── 5. Rim light (contorno contrario a la luz) ──
  // Efecto cinematográfico: borde de luz suave en el lado no iluminado
  if (thick > 1.8 && profile.rimLightStrength > 0.05) {
    const rimStrength = profile.rimLightStrength * (0.5 + effectiveGloss * 0.5);
    const rimOffset   = thick * 0.38;
    const rimGrad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    rimGrad.addColorStop(0,    `rgba(255,255,255,${(rimStrength * 0.9).toFixed(2)})`);
    rimGrad.addColorStop(0.15, `rgba(255,255,255,${(rimStrength * 0.5).toFixed(2)})`);
    rimGrad.addColorStop(0.35, 'rgba(255,255,255,0)');
    rimGrad.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth   = Math.max(0.4, thick * 0.22);
    ctx.lineCap     = 'round';
    ctx.beginPath();
    // Rimlight en el borde opuesto a la luz principal (nx, ny negativo)
    ctx.moveTo(x0 - nx * rimOffset, y0 - ny * rimOffset);
    ctx.lineTo(x1 - nx * rimOffset, y1 - ny * rimOffset);
    ctx.stroke();
  }

  // ── 6. Especular anisotrópico de Phong ──
  // La anisotropía depende del ángulo entre la dirección de la puntada y la luz
  if (effectiveGloss > 0.08 && thick > 1.0) {
    // Exponent de Phong — satin tiene exponent muy alto (pico estrecho y brillante)
    const phongExp   = stitchType === 'satin' ? 18 : stitchType === 'fill' ? 8 : 4;
    const specPeak   = Math.pow(Math.max(0, normalDot), phongExp);
    const specStrength = effectiveGloss * specPeak * (0.7 + halfDot * 0.3);

    if (specStrength > 0.04) {
      const specOffset = thick * 0.22;
      const specW      = profile.specularWidth;
      const specGrad   = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      specGrad.addColorStop(0,               'rgba(255,255,255,0)');
      specGrad.addColorStop(0.5 - specW,     'rgba(255,255,255,0)');
      specGrad.addColorStop(0.5 - specW/2,   `rgba(255,255,255,${(specStrength * 0.65).toFixed(2)})`);
      specGrad.addColorStop(0.5,             `rgba(255,255,255,${specStrength.toFixed(2)})`);
      specGrad.addColorStop(0.5 + specW/2,   `rgba(255,255,255,${(specStrength * 0.65).toFixed(2)})`);
      specGrad.addColorStop(0.5 + specW,     'rgba(255,255,255,0)');
      specGrad.addColorStop(1,               'rgba(255,255,255,0)');

      ctx.strokeStyle = specGrad;
      ctx.lineWidth   = Math.max(0.35, thick * 0.28);
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(x0 + nx * specOffset, y0 + ny * specOffset);
      ctx.lineTo(x1 + nx * specOffset, y1 + ny * specOffset);
      ctx.stroke();
    }
  }

  // ── 7. Micro-brillo de torsión del hilo (solo satin y fill a alta glosiness) ──
  // Simula el reflejo sinusoidal producido por el twist del hilo de bordar
  if (stitchType !== 'running_stitch' && effectiveGloss > 0.35 && thick > 2.2 && len > thick * 4) {
    const twistPeriod = thick * 3.5;  // distancia entre torneados del hilo
    const twistCount  = Math.floor(len / twistPeriod);
    const twistAlpha  = (effectiveGloss - 0.35) * 0.5;

    ctx.strokeStyle = `rgba(255,255,255,${twistAlpha.toFixed(2)})`;
    ctx.lineWidth   = Math.max(0.3, thick * 0.12);
    ctx.lineCap     = 'round';

    for (let t = 0; t < twistCount; t++) {
      const tCenter = (t + 0.5) / twistCount;
      const tx = x0 + dx * tCenter + nx * thick * 0.18;
      const ty = y0 + dy * tCenter + ny * thick * 0.18;
      ctx.beginPath();
      ctx.arc(tx, ty, thick * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${(twistAlpha * 1.5).toFixed(2)})`;
      ctx.fill();
    }
  }
}

// ─── Underlay fotorrealista ───────────────────────────────────────────────────

/**
 * Dibuja underlay con compresión de tejido visible.
 * El underlay es un hilo más fino, más mate, y ligeramente desplazado
 * respecto al fill principal — crea textura de tejido comprimido visible
 * en los bordes de las regiones de fill.
 */
export function drawUnderlayStitches(ctx, stitches, color, params) {
  if (!stitches?.length) return;

  // Underlay más oscuro, más fino, sin brillo
  const underlayColor = darken(mix(color, '#1a1008', 0.35), 0.15);
  const underlayParams = {
    ...params,
    threadThicknessPx: params.threadThicknessPx * 0.55,
    glossiness:        0.05,
    tension:           Math.min(1, (params.tension || 0.75) + 0.15), // underlay más tenso
    layerDepth:        0,
    stitchType:        'running_stitch', // underlay siempre como running para look correcto
  };

  // Underlay en ángulo perpendicular al fill (+90°)
  ctx.globalAlpha = 0.52;
  for (const [x0, y0, x1, y1] of stitches) {
    // Solo dibuja ~60% de las puntadas del underlay (más esparso = más realista)
    if (Math.random() > 0.40) {
      drawPhysicalStitch(ctx, x0, y0, x1, y1, underlayColor, underlayParams);
    }
  }
  ctx.globalAlpha = 1;
}