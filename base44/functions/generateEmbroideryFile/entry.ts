import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ============================================
// CONFIGURACIÓN Y CONSTANTES
// ============================================
const SCALE = 10; // 10 unidades por mm (0.1mm resolución)
const MAX_JUMP_DST = 121; // Máximo salto en formato DST
const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 100;
const DEFAULT_SPEED = 800;
const DEFAULT_DENSITY = 0.8;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    
    // Validación robusta de entrada
    const validation = validateInput(body);
    if (!validation.valid) {
      return Response.json({ error: validation.error }, { status: 400 });
    }

    const { 
      regions, 
      format, 
      width_mm = DEFAULT_WIDTH, 
      height_mm = DEFAULT_HEIGHT, 
      machine_name, 
      speed_rpm = DEFAULT_SPEED, 
      cuts, 
      project_name 
    } = body;

    // Generar datos de puntadas optimizados
    const stitchData = generateStitchData(regions, width_mm, height_mm);
    
    // Optimizar trayectoria (reducir saltos largos)
    const optimizedStitches = optimizeStitchPath(stitchData);

    // Generar archivo según formato
    let fileBuffer;
    let mimeType = 'application/octet-stream';
    let fileName = `${sanitizeFileName(project_name) || 'design'}.${format.toLowerCase()}`;

    const formatUpper = format.toUpperCase();
    switch (formatUpper) {
      case 'DST':
        fileBuffer = generateDST(optimizedStitches, width_mm, height_mm, machine_name, speed_rpm);
        mimeType = 'application/x-dst';
        break;
      case 'PES':
        fileBuffer = generatePES(optimizedStitches, width_mm, height_mm, machine_name, regions);
        mimeType = 'application/x-pes';
        break;
      case 'JEF':
        fileBuffer = generateJEF(optimizedStitches, width_mm, height_mm, machine_name, regions);
        mimeType = 'application/x-jef';
        break;
      case 'DSB':
        fileBuffer = generateDSB(optimizedStitches, width_mm, height_mm, machine_name);
        mimeType = 'application/x-dsb';
        break;
      default:
        return Response.json({ error: `Unsupported format: ${format}` }, { status: 400 });
    }

    // Codificación Base64 eficiente
    const base64 = arrayBufferToBase64(fileBuffer);

    return Response.json({
      success: true,
      file_base64: base64,
      file_name: fileName,
      format: formatUpper,
      stitch_count: optimizedStitches.filter(s => s.type === 'stitch').length,
      color_changes: optimizedStitches.filter(s => s.type === 'colorChange').length,
      metadata: {
        machine: machine_name || 'StitchFlow',
        speed_rpm: speed_rpm,
        cuts: cuts || 0,
        width_mm,
        height_mm
      }
    });
  } catch (error) {
    console.error('Embroidery generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ============================================
// VALIDACIÓN DE ENTRADA
// ============================================
function validateInput(body) {
  if (!body) return { valid: false, error: 'Request body required' };
  if (!body.regions || !Array.isArray(body.regions) || body.regions.length === 0) {
    return { valid: false, error: 'regions array required and must not be empty' };
  }
  if (!body.format || typeof body.format !== 'string') {
    return { valid: false, error: 'format string required' };
  }
  
  const validFormats = ['DST', 'PES', 'JEF', 'DSB'];
  if (!validFormats.includes(body.format.toUpperCase())) {
    return { valid: false, error: `format must be one of: ${validFormats.join(', ')}` };
  }
  
  // Validar regiones
  for (let i = 0; i < body.regions.length; i++) {
    const region = body.regions[i];
    if (!region.path_points && !region.type) {
      return { valid: false, error: `Region ${i} must have path_points or type` };
    }
    if (region.path_points && !Array.isArray(region.path_points)) {
      return { valid: false, error: `Region ${i} path_points must be an array` };
    }
  }
  
  return { valid: true };
}

function sanitizeFileName(name) {
  if (!name) return null;
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
}

// ============================================
// GENERACIÓN DE PUNTADAS (OPTIMIZADA)
// ============================================
function generateStitchData(regions, width_mm, height_mm) {
  const stitches = [];
  const scale = SCALE;

  for (const region of regions) {
    if (region.visible === false) continue;
    
    const points = region.path_points || generateDefaultPoints(region);
    const color = hexToRgb(region.color || '#000000');
    
    // Cambio de color
    stitches.push({ type: 'colorChange', color });

    // Puntos de contorno
    const contourStitches = pointsToStitches(points, width_mm, height_mm, scale);
    stitches.push(...contourStitches);

    // Relleno si aplica
    if (region.stitch_type === 'fill') {
      const fillStitches = generateFillStitches(
        points, 
        region.density || DEFAULT_DENSITY, 
        region.angle || 45, 
        width_mm, 
        height_mm, 
        scale,
        region.stitch_pattern || 'parallel'
      );
      stitches.push(...fillStitches);
    }
    
    // Corte al final de la región
    stitches.push({ type: 'trim' });
  }

  stitches.push({ type: 'end' });
  return stitches;
}

function pointsToStitches(points, width_mm, height_mm, scale) {
  return points.map(([nx, ny]) => ({
    type: 'stitch',
    x: Math.round(nx * width_mm * scale),
    y: Math.round(ny * height_mm * scale)
  }));
}

function generateDefaultPoints(region) {
  const cx = 0.5, cy = 0.5, r = 0.3;
  const sides = region.sides || 12;
  return Array.from({ length: sides }, (_, i) => [
    cx + r * Math.cos((i * 2 * Math.PI) / sides),
    cy + r * Math.sin((i * 2 * Math.PI) / sides)
  ]);
}

// ============================================
// RELLENO DE PUNTADAS (CORREGIDO Y OPTIMIZADO)
// ============================================
function generateFillStitches(points, density, angle, width_mm, height_mm, scale, pattern = 'parallel') {
  if (!points || points.length < 3) return [];
  
  const stitches = [];
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  
  // Calcular bounding box de la forma
  const bbox = getBoundingBox(points);
  const spacing = 1 / (density * 3); // Espaciado entre líneas de relleno
  
  // Generar líneas de relleno paralelas al ángulo
  const step = spacing * Math.max(width_mm, height_mm) * scale;
  const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * scale * 1.5;
  
  for (let offset = -maxDim; offset <= maxDim; offset += step) {
    const line = generateScanLine(points, offset, rad, bbox, width_mm, height_mm, scale);
    
    if (line.length >= 2) {
      // Zigzag: alternar dirección para minimizar saltos
      const isEven = Math.floor((offset + maxDim) / step) % 2 === 0;
      const orderedLine = isEven ? line : [...line].reverse();
      
      for (const [x, y] of orderedLine) {
        stitches.push({ type: 'stitch', x, y });
      }
    }
  }
  
  return stitches;
}

function getBoundingBox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function generateScanLine(points, offset, angle, bbox, width_mm, height_mm, scale) {
  // Rotar el offset para alinear con el ángulo
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  
  // Línea de escaneo: puntos donde la línea perpendicular al ángulo intersecta la forma
  const intersections = [];
  
  // Para cada arista del polígono, encontrar intersecciones
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const p1 = points[i];
    const p2 = points[j];
    
    // Proyección perpendicular al ángulo
    const proj1 = p1[0] * cosA + p1[1] * sinA;
    const proj2 = p2[0] * cosA + p2[1] * sinA;
    
    // Verificar si la línea de escaneo cruza esta arista
    const normalizedOffset = offset / (scale * Math.max(width_mm, height_mm));
    if ((proj1 <= normalizedOffset && proj2 >= normalizedOffset) || 
        (proj2 <= normalizedOffset && proj1 >= normalizedOffset)) {
      
      if (Math.abs(proj2 - proj1) > 1e-10) {
        const t = (normalizedOffset - proj1) / (proj2 - proj1);
        const ix = p1[0] + t * (p2[0] - p1[0]);
        const iy = p1[1] + t * (p2[1] - p1[1]);
        intersections.push([
          Math.round(ix * width_mm * scale),
          Math.round(iy * height_mm * scale)
        ]);
      }
    }
  }
  
  // Ordenar intersecciones
  intersections.sort((a, b) => {
    const perpA = -a[0] * sinA + a[1] * cosA;
    const perpB = -b[0] * sinA + b[1] * cosA;
    return perpA - perpB;
  });
  
  return intersections;
}

// ============================================
// OPTIMIZACIÓN DE TRAYECTORIA
// ============================================
function optimizeStitchPath(stitches) {
  const optimized = [];
  let lastX = 0, lastY = 0;
  
  for (const stitch of stitches) {
    if (stitch.type === 'stitch') {
      // Verificar si el salto es demasiado largo
      const dx = stitch.x - lastX;
      const dy = stitch.y - lastY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > MAX_JUMP_DST * 3) {
        // Insertar puntadas intermedias para evitar saltos largos
        const steps = Math.ceil(distance / MAX_JUMP_DST);
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          optimized.push({
            type: 'stitch',
            x: Math.round(lastX + dx * t),
            y: Math.round(lastY + dy * t)
          });
        }
      }
      
      optimized.push(stitch);
      lastX = stitch.x;
      lastY = stitch.y;
    } else {
      optimized.push(stitch);
      if (stitch.type === 'colorChange') {
        lastX = 0; lastY = 0; // Reset después de cambio de color
      }
    }
  }
  
  return optimized;
}

// ============================================
// GENERADOR DST (CORREGIDO)
// ============================================
function generateDST(stitches, width_mm, height_mm, machine, speed) {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  
  const stitchCount = stitches.filter(s => s.type === 'stitch').length;
  const colorChanges = stitches.filter(s => s.type === 'colorChange').length;
  
  const headerLines = [
    `LA:${(machine || 'StitchFlow').padEnd(16, ' ')}`,
    `ST:${stitchCount.toString().padEnd(7, ' ')}`,
    `CO:${colorChanges.toString().padEnd(3, ' ')}`,
    `+X:${Math.round((width_mm || DEFAULT_WIDTH) * SCALE).toString().padEnd(5, ' ')}`,
    `-X:0    `,
    `+Y:${Math.round((height_mm || DEFAULT_HEIGHT) * SCALE).toString().padEnd(5, ' ')}`,
    `-Y:0    `,
    `AX:+0   `,
    `AY:+0   `,
    `MX:+0   `,
    `MY:+0   `,
    `PD:******`,
    `\x1a`
  ];
  
  const headerStr = headerLines.join('\r') + ' '.repeat(512);
  const headerBytes = enc.encode(headerStr.slice(0, 512));
  header.set(headerBytes);

  const dataBytes = [];
  let cx = 0, cy = 0;

  for (const s of stitches) {
    if (s.type === 'stitch') {
      // Manejar saltos largos dividiéndolos
      let dx = s.x - cx;
      let dy = s.y - cy;
      
      while (Math.abs(dx) > MAX_JUMP_DST || Math.abs(dy) > MAX_JUMP_DST) {
        const stepX = Math.sign(dx) * Math.min(Math.abs(dx), MAX_JUMP_DST);
        const stepY = Math.sign(dy) * Math.min(Math.abs(dy), MAX_JUMP_DST);
        const [b1, b2, b3] = encodeDSTStitch(stepX, stepY, 0x80); // jump stitch
        dataBytes.push(b1, b2, b3);
        cx += stepX;
        cy += stepY;
        dx = s.x - cx;
        dy = s.y - cy;
      }
      
      const [b1, b2, b3] = encodeDSTStitch(dx, dy, 0);
      dataBytes.push(b1, b2, b3);
      cx = s.x;
      cy = s.y;
    } else if (s.type === 'colorChange') {
      dataBytes.push(0xC3, 0xC3, 0xC3);
    } else if (s.type === 'trim') {
      dataBytes.push(0xC3, 0xC3, 0xC3); // trim = color change en DST
    } else if (s.type === 'end') {
      dataBytes.push(0xF3, 0xF3, 0xF3);
    }
  }

  const result = new Uint8Array(512 + dataBytes.length);
  result.set(header);
  result.set(new Uint8Array(dataBytes), 512);
  return result.buffer;
}

function encodeDSTStitch(dx, dy, flag) {
  // Codificación DST correcta según especificación
  let b1 = 0, b2 = 0, b3 = flag & 0x03;
  
  // X encoding
  if (dx > 40)  { b3 |= 0x04; dx -= 81; }
  if (dx < -40) { b3 |= 0x08; dx += 81; }
  if (dx < 0)   { dx = -dx; b1 |= 0x80; }
  
  // Y encoding
  if (dy > 40)  { b3 |= 0x20; dy -= 81; }
  if (dy < -40) { b3 |= 0x40; dy += 81; }
  if (dy < 0)   { dy = -dy; b2 |= 0x80; }
  
  b1 |= (dx & 0x7F);
  b2 |= (dy & 0x7F);
  
  return [b1, b2, b3];
}

// ============================================
// GENERADOR PES (MEJORADO)
// ============================================
function generatePES(stitches, width_mm, height_mm, machine, regions) {
  // PES v1 formato básico
  const enc = new TextEncoder();
  const sections = [];
  
  // Header PES
  const header = new Uint8Array(8);
  header.set(enc.encode('#PES0001'));
  sections.push(header);
  
  // PEC section (diseño de bordado)
  const pecData = generatePECData(stitches, width_mm, height_mm);
  sections.push(pecData);
  
  // Unir secciones
  const totalLength = sections.reduce((sum, s) => sum + s.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const section of sections) {
    result.set(section, offset);
    offset += section.length;
  }
  
  return result.buffer;
}

function generatePECData(stitches, width_mm, height_mm) {
  // PEC header básico
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  
  // Magic + version
  header.set(enc.encode('LA:'), 0);
  header.set(enc.encode('StitchFlow'.padEnd(16, ' ')), 3);
  
  // Bounds
  const view = new DataView(header.buffer);
  view.setInt16(19, 0, true);   // min x
  view.setInt16(21, 0, true);   // min y
  view.setInt16(23, Math.round(width_mm * SCALE), true);  // max x
  view.setInt16(25, Math.round(height_mm * SCALE), true);  // max y
  
  // Stitch data
  const stitchBytes = [];
  let lastX = 0, lastY = 0;
  
  for (const s of stitches) {
    if (s.type === 'stitch') {
      const dx = s.x - lastX;
      const dy = s.y - lastY;
      
      if (Math.abs(dx) <= 63 && Math.abs(dy) <= 63) {
        stitchBytes.push((dx + 63) & 0x7F, (dy + 63) & 0x7F);
      } else {
        // Long stitch
        stitchBytes.push(0x80, 0x01, 
          (dx >> 8) & 0xFF, dx & 0xFF,
          (dy >> 8) & 0xFF, dy & 0xFF);
      }
      lastX = s.x;
      lastY = s.y;
    } else if (s.type === 'colorChange') {
      stitchBytes.push(0xFE, 0xB0);
    } else if (s.type === 'end') {
      stitchBytes.push(0xFF);
    }
  }
  
  const result = new Uint8Array(512 + stitchBytes.length);
  result.set(header);
  result.set(new Uint8Array(stitchBytes), 512);
  return result;
}

// ============================================
// GENERADOR JEF (MEJORADO)
// ============================================
function generateJEF(stitches, width_mm, height_mm, machine, regions) {
  const enc = new TextEncoder();
  const stitchBytes = [];
  let lastX = 0, lastY = 0;
  
  // JEF Header
  const header = new Uint8Array(80);
  header.set(enc.encode('JEF'), 0);
  
  const view = new DataView(header.buffer);
  view.setInt32(4, stitches.filter(s => s.type === 'stitch').length, true);
  view.setInt32(8, stitches.filter(s => s.type === 'colorChange').length, true);
  view.setInt32(12, Math.round(width_mm * SCALE), true);
  view.setInt32(16, Math.round(height_mm * SCALE), true);
  
  // Stitch encoding
  for (const s of stitches) {
    if (s.type === 'stitch') {
      const dx = s.x - lastX;
      const dy = s.y - lastY;
      stitchBytes.push(dx & 0xFF, dy & 0xFF);
      lastX = s.x;
      lastY = s.y;
    } else if (s.type === 'colorChange') {
      stitchBytes.push(0x80, 0x01);
    } else if (s.type === 'end') {
      stitchBytes.push(0x80, 0x10);
    }
  }
  
  const result = new Uint8Array(80 + stitchBytes.length);
  result.set(header);
  result.set(new Uint8Array(stitchBytes), 80);
  return result.buffer;
}

// ============================================
// GENERADOR DSB (MEJORADO)
// ============================================
function generateDSB(stitches, width_mm, height_mm, machine) {
  const enc = new TextEncoder();
  const stitchBytes = [];
  let lastX = 0, lastY = 0;
  
  // DSB Header (Tajima variant)
  const header = new Uint8Array(512);
  header.set(enc.encode('DSB'), 0);
  header.set(enc.encode((machine || 'StitchFlow').padEnd(16, ' ')), 3);
  
  // Stitch data (similar a DST pero con diferente encoding)
  for (const s of stitches) {
    if (s.type === 'stitch') {
      const dx = s.x - lastX;
      const dy = s.y - lastY;
      
      // DSB usa 2 bytes por coordenada
      stitchBytes.push((dx >> 8) & 0xFF, dx & 0xFF, (dy >> 8) & 0xFF, dy & 0xFF, 0x00);
      lastX = s.x;
      lastY = s.y;
    } else if (s.type === 'colorChange') {
      stitchBytes.push(0x00, 0x00, 0x00, 0x00, 0x01);
    } else if (s.type === 'end') {
      stitchBytes.push(0x00, 0x00, 0x00, 0x00, 0xFF);
    }
  }
  
  const result = new Uint8Array(512 + stitchBytes.length);
  result.set(header);
  result.set(new Uint8Array(stitchBytes), 512);
  return result.buffer;
}

// ============================================
// UTILIDADES
// ============================================
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  
  return { 
    r: isNaN(r) ? 0 : r, 
    g: isNaN(g) ? 0 : g, 
    b: isNaN(b) ? 0 : b 
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.length;
  
  // Procesar en chunks para evitar stack overflow
  const chunkSize = 65536;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  
  return btoa(binary);
}