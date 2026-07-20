// ============================================================
// RENDER STITCH PREVIEW - CON MEJORAS DE CONTORNO
// ============================================================

interface StitchPoint {
  x: number;
  y: number;
}

interface Region {
  id: string;
  color: string;
  type: 'fill' | 'satin' | 'running_stitch' | 'run' | 'border';
  path_points: number[][];
  stitches: number[][];
  contour_stitches: number[][];
  is_external_border: boolean;
  stitch_count: number;
  area_mm2?: number;
  compacidad?: number;
  inertia_ratio?: number;
  bbox_aspect?: number;
  fill_angle?: number;
}

interface DesignData {
  regions: Region[];
  metadata: any;
}

// ============================================================
// CONFIGURACIÓN VISUAL
// ============================================================

const CONFIG = {
  // Fondo
  backgroundColor: '#1a1a2e',
  gridColor: '#2a2a4e',
  
  // Contornos
  externalBorder: {
    color: '#ffffff',
    width: 3,
    shadowColor: 'rgba(255,255,255,0.3)',
    shadowBlur: 4,
    style: 'solid'
  },
  internalBorder: {
    color: '#666666',
    width: 1,
    dash: [4, 4],
    style: 'dashed'
  },
  
  // Rellenos
  tatami: {
    strokeWidth: 0.8,
    opacity: 0.9
  },
  
  // Satin
  satin: {
    strokeWidth: 1.5,
    opacity: 1.0
  },
  
  // Running stitch
  running: {
    strokeWidth: 0.6,
    opacity: 0.85,
    dotSize: 0.15
  },
  
  // Zoom y pan
  minZoom: 0.1,
  maxZoom: 10,
  zoomStep: 0.1
};

// ============================================================
// CLASE PRINCIPAL DEL RENDERER
// ============================================================

class StitchCanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private designData: DesignData | null = null;
  private zoom: number = 1;
  private panX: number = 0;
  private panY: number = 0;
  private showFill: boolean = true;
  private showContours: boolean = true;
  private showExternalBorder: boolean = true;
  private selectedRegion: string | null = null;
  private hoveredRegion: string | null = null;
  private mouseX: number = 0;
  private mouseY: number = 0;
  
  // Cache de renderizado
  private fillCache: Map<string, ImageData> = new Map();
  private contourCache: Map<string, ImageData> = new Map();
  
  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.setupEventListeners();
    this.resize();
  }
  
  // ============================================================
  // SETUP Y EVENTOS
  // ============================================================
  
  private setupEventListeners() {
    // Zoom con rueda del mouse
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -CONFIG.zoomStep : CONFIG.zoomStep;
      this.zoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, this.zoom + delta));
      this.render();
    });
    
    // Pan con drag
    let isDragging = false;
    let lastX = 0, lastY = 0;
    
    this.canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      
      // Hover detection
      this.detectHover();
      
      if (!isDragging) return;
      this.panX += e.clientX - lastX;
      this.panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.render();
    });
    
    this.canvas.addEventListener('mouseup', () => isDragging = false);
    this.canvas.addEventListener('mouseleave', () => {
      isDragging = false;
      this.hoveredRegion = null;
      this.render();
    });
    
    // Click para seleccionar
    this.canvas.addEventListener('click', (e) => {
      this.selectRegionAt(this.mouseX, this.mouseY);
    });
  }
  
  private resize() {
    const parent = this.canvas.parentElement!;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    this.render();
  }
  
  // ============================================================
  // DETECCIÓN DE HOVER Y SELECCIÓN
  // ============================================================
  
  private detectHover() {
    if (!this.designData) return;
    
    // Convertir mouse a coordenadas del diseño
    const designX = (this.mouseX - this.panX) / this.zoom;
    const designY = (this.mouseY - this.panY) / this.zoom;
    
    let found: string | null = null;
    
    for (const region of this.designData.regions) {
      if (this.isPointInRegion(designX, designY, region)) {
        found = region.id;
        break;
      }
    }
    
    if (found !== this.hoveredRegion) {
      this.hoveredRegion = found;
      this.render();
    }
  }
  
  private isPointInRegion(x: number, y: number, region: Region): boolean {
    const pts = region.path_points;
    if (pts.length < 3) return false;
    
    // Ray casting algorithm
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
  
  private selectRegionAt(screenX: number, screenY: number) {
    const designX = (screenX - this.panX) / this.zoom;
    const designY = (screenY - this.panY) / this.zoom;
    
    for (const region of this.designData!.regions) {
      if (this.isPointInRegion(designX, designY, region)) {
        this.selectedRegion = this.selectedRegion === region.id ? null : region.id;
        this.render();
        return;
      }
    }
    
    this.selectedRegion = null;
    this.render();
  }
  
  // ============================================================
  // CARGA DE DATOS
  // ============================================================
  
  public loadDesign(data: DesignData) {
    // === PASO 1: Normalizar tipos ===
    this.designData = {
      ...data,
      regions: data.regions.map(r => ({
        ...r,
        type: this.normalizeType(r.type)
      }))
    };
    this.fillCache.clear();
    this.contourCache.clear();
    this.autoFit();
    this.render();
  }
  
  private normalizeType(type: string): Region['type'] {
    if (type === 'running_stitch') return 'running_stitch';
    if (type === 'run') return 'running_stitch';
    if (type === 'satin') return 'satin';
    if (type === 'fill') return 'fill';
    if (type === 'border') return 'border';
    return 'fill';
  }
  
  public setVisibility(showFill: boolean, showContours: boolean, showExternal: boolean = true) {
    this.showFill = showFill;
    this.showContours = showContours;
    this.showExternalBorder = showExternal;
    this.render();
  }
  
  public selectRegion(regionId: string | null) {
    this.selectedRegion = regionId;
    this.render();
  }
  
  // ============================================================
  // AJUSTE AUTOMÁTICO DE VISTA
  // ============================================================
  
  private autoFit() {
    if (!this.designData || this.designData.regions.length === 0) return;
    
    // Calcular bounding box de todo el diseño
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const region of this.designData.regions) {
      for (const pt of region.path_points) {
        minX = Math.min(minX, pt[0]);
        maxX = Math.max(maxX, pt[0]);
        minY = Math.min(minY, pt[1]);
        maxY = Math.max(maxY, pt[1]);
      }
    }
    
    const designW = maxX - minX;
    const designH = maxY - minY;
    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;
    
    // Calcular zoom para que el diseño ocupe el 90% del canvas
    const zoomX = (canvasW * 0.9) / designW;
    const zoomY = (canvasH * 0.9) / designH;
    this.zoom = Math.min(zoomX, zoomY);
    
    // Centrar
    this.panX = canvasW / 2 - (minX + designW / 2) * this.zoom;
    this.panY = canvasH / 2 - (minY + designH / 2) * this.zoom;
  }
  
  // ============================================================
  // RENDER PRINCIPAL
  // ============================================================
  
  public render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Limpiar fondo
    ctx.fillStyle = CONFIG.backgroundColor;
    ctx.fillRect(0, 0, w, h);
    
    // Dibujar grid
    this.drawGrid();
    
    if (!this.designData) return;
    
    ctx.save();
    
    // Aplicar transformación de zoom y pan
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
    
    // 1. Dibujar rellenos (Tatami + Satin) - capa inferior
    if (this.showFill) {
      this.drawFills();
    }
    
    // 2. Dibujar contornos - capa superior
    if (this.showContours) {
      this.drawContours();
    }
    
    // 3. Dibujar borde externo del diseño - capa más alta
    if (this.showExternalBorder) {
      this.drawExternalBorder();
    }
    
    // 4. Dibujar puntadas seleccionadas (highlight)
    if (this.selectedRegion) {
      this.drawSelectedRegion();
    }
    
    // 5. Dibujar hover
    if (this.hoveredRegion && this.hoveredRegion !== this.selectedRegion) {
      this.drawHoveredRegion();
    }
    
    ctx.restore();
    
    // Dibujar UI overlay (zoom, info, panel de métricas)
    this.drawOverlay();
  }
  
  // ============================================================
  // DIBUJAR GRID
  // ============================================================
  
  private drawGrid() {
    const ctx = this.ctx;
    const gridSize = 10 * this.zoom; // 10mm grid
    
    ctx.strokeStyle = CONFIG.gridColor;
    ctx.lineWidth = 0.5;
    
    const offsetX = this.panX % gridSize;
    const offsetY = this.panY % gridSize;
    
    for (let x = offsetX; x < this.canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
    }
    
    for (let y = offsetY; y < this.canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.canvas.width, y);
      ctx.stroke();
    }
  }
  
  // ============================================================
  // DIBUJAR RELLENOS (TATAMI + SATIN)
  // ============================================================
  
  private drawFills() {
    const ctx = this.ctx;
    
    for (const region of this.designData!.regions) {
      // === PASO 2: Dibujar fill Y satin como relleno ===
      if (region.type !== 'fill' && region.type !== 'satin') continue;
      
      const isSatin = region.type === 'satin';
      
      ctx.strokeStyle = region.color;
      ctx.lineWidth = isSatin 
        ? CONFIG.satin.strokeWidth / this.zoom 
        : CONFIG.tatami.strokeWidth / this.zoom;
      ctx.globalAlpha = isSatin ? CONFIG.satin.opacity : CONFIG.tatami.opacity;
      
      if (isSatin) {
        // Satin: dibujar como zig-zag denso
        this.drawSatinStitches(region.stitches, region.color);
      } else {
        // Tatami: dibujar líneas de fill
        this.drawStitchLines(region.stitches, region.color);
      }
      
      ctx.globalAlpha = 1.0;
    }
  }
  
  // ============================================================
  // DIBUJAR LÍNEAS DE PUNTADAS (TATAMI) - CORREGIDO
  // ============================================================
  
  private drawStitchLines(stitches: number[][], color: string) {
    const ctx = this.ctx;
    
    if (stitches.length < 2) return;
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5 / this.zoom;
    
    // === PASO 3: Agrupar segmentos conectados ===
    let currentPath: number[][] = [];
    
    for (let i = 0; i < stitches.length - 1; i++) {
      const p1 = stitches[i];
      const p2 = stitches[i + 1];
      const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      
      if (dist < 5) { // Segmento conectado
        if (currentPath.length === 0) currentPath.push(p1);
        currentPath.push(p2);
      } else { // Jump stitch - cerrar path actual y empezar nuevo
        if (currentPath.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(currentPath[0][0], currentPath[0][1]);
          for (let j = 1; j < currentPath.length; j++) {
            ctx.lineTo(currentPath[j][0], currentPath[j][1]);
          }
          ctx.stroke();
        }
        currentPath = [];
      }
    }
    
    // Dibujar último path
    if (currentPath.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(currentPath[0][0], currentPath[0][1]);
      for (let j = 1; j < currentPath.length; j++) {
        ctx.lineTo(currentPath[j][0], currentPath[j][1]);
      }
      ctx.stroke();
    }
  }
  
  // ============================================================
  // DIBUJAR PUNTADAS SATIN (ZIG-ZAG)
  // ============================================================
  
  private drawSatinStitches(stitches: number[][], color: string) {
    const ctx = this.ctx;
    
    if (stitches.length < 2) return;
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 / this.zoom;
    
    // Dibujar como zig-zag continuo
    ctx.beginPath();
    ctx.moveTo(stitches[0][0], stitches[0][1]);
    
    for (let i = 1; i < stitches.length; i++) {
      ctx.lineTo(stitches[i][0], stitches[i][1]);
    }
    
    ctx.stroke();
  }
  
  // ============================================================
  // DIBUJAR CONTORNOS
  // ============================================================
  
  private drawContours() {
    const ctx = this.ctx;
    
    for (const region of this.designData!.regions) {
      // Saltar el borde externo especial (se dibuja aparte)
      if (region.id === 'design_border') continue;
      
      const isExternal = region.is_external_border;
      const style = isExternal ? CONFIG.externalBorder : CONFIG.internalBorder;
      
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width / this.zoom;
      ctx.setLineDash(style.style === 'dashed' ? style.dash : []);
      
      // Sombra para bordes externos
      if (isExternal) {
        ctx.shadowColor = (style as any).shadowColor;
        ctx.shadowBlur = (style as any).shadowBlur;
      }
      
      // Dibujar contorno como path
      if (region.path_points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(region.path_points[0][0], region.path_points[0][1]);
        
        for (let i = 1; i < region.path_points.length; i++) {
          ctx.lineTo(region.path_points[i][0], region.path_points[i][1]);
        }
        
        ctx.closePath();
        ctx.stroke();
      }
      
      // Resetear sombra
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      
      // Dibujar puntadas de contorno
      if (region.contour_stitches && region.contour_stitches.length > 0) {
        this.drawContourStitches(region.contour_stitches, region.color, region.type, isExternal);
      }
      
      // === PASO 4: Dibujar running_stitch como puntos ===
      if (region.type === 'running_stitch' && region.stitches && region.stitches.length > 0) {
        this.drawRunningStitches(region.stitches, region.color);
      }
    }
  }
  
  // ============================================================
  // DIBUJAR PUNTADAS DE CONTORNO (SATIN/RUN) - MEJORADO
  // ============================================================
  
  private drawContourStitches(stitches: number[][], color: string, type: string, isExternal: boolean) {
    const ctx = this.ctx;
    
    if (stitches.length < 2) return;
    
    if (type === 'satin') {
      // Satin contour: zig-zag visible
      ctx.strokeStyle = color;
      ctx.lineWidth = isExternal ? 1.5 / this.zoom : 0.8 / this.zoom;
      ctx.globalAlpha = 0.9;
      
      ctx.beginPath();
      ctx.moveTo(stitches[0][0], stitches[0][1]);
      for (let i = 1; i < stitches.length; i++) {
        ctx.lineTo(stitches[i][0], stitches[i][1]);
      }
      ctx.stroke();
      
    } else {
      // Running contour: línea punteada
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5 / this.zoom;
      ctx.setLineDash([0.5, 0.5]);
      ctx.globalAlpha = 0.6;
      
      ctx.beginPath();
      ctx.moveTo(stitches[0][0], stitches[0][1]);
      for (let i = 1; i < stitches.length; i++) {
        ctx.lineTo(stitches[i][0], stitches[i][1]);
      }
      ctx.stroke();
      
      ctx.setLineDash([]);
    }
    
    ctx.globalAlpha = 1.0;
  }
  
  // ============================================================
  // DIBUJAR RUNNING STITCH COMO PUNTOS
  // ============================================================
  
  private drawRunningStitches(stitches: number[][], color: string) {
    const ctx = this.ctx;
    const dotSize = CONFIG.running.dotSize / this.zoom;
    
    ctx.fillStyle = color;
    ctx.globalAlpha = CONFIG.running.opacity;
    
    for (const pt of stitches) {
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.globalAlpha = 1.0;
  }
  
  // ============================================================
  // DIBUJAR BORDE EXTERNO DEL DISEÑO
  // ============================================================
  
  private drawExternalBorder() {
    const borderRegion = this.designData!.regions.find(r => r.id === 'design_border');
    if (!borderRegion) return;
    
    const ctx = this.ctx;
    const style = CONFIG.externalBorder;
    
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width / this.zoom;
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur;
    
    if (borderRegion.path_points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(borderRegion.path_points[0][0], borderRegion.path_points[0][1]);
      
      for (let i = 1; i < borderRegion.path_points.length; i++) {
        ctx.lineTo(borderRegion.path_points[i][0], borderRegion.path_points[i][1]);
      }
      
      ctx.closePath();
      ctx.stroke();
    }
    
    // Resetear
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }
  
  // ============================================================
  // REGIÓN SELECCIONADA (HIGHLIGHT)
  // ============================================================
  
  private drawSelectedRegion() {
    const region = this.designData!.regions.find(r => r.id === this.selectedRegion);
    if (!region) return;
    
    const ctx = this.ctx;
    
    // Dibujar bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const pt of region.path_points) {
      minX = Math.min(minX, pt[0]);
      maxX = Math.max(maxX, pt[0]);
      minY = Math.min(minY, pt[1]);
      maxY = Math.max(maxY, pt[1]);
    }
    
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2 / this.zoom;
    ctx.setLineDash([5, 5]);
    
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    ctx.setLineDash([]);
    
    // Dibujar centroid
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(cx, cy, 2 / this.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // ============================================================
  // REGIÓN HOVER (HIGHLIGHT SUAVE)
  // ============================================================
  
  private drawHoveredRegion() {
    const region = this.designData!.regions.find(r => r.id === this.hoveredRegion);
    if (!region) return;
    
    const ctx = this.ctx;
    
    // Relleno semitransparente
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(region.path_points[0][0], region.path_points[0][1]);
    for (let i = 1; i < region.path_points.length; i++) {
      ctx.lineTo(region.path_points[i][0], region.path_points[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    
    // Borde
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1 / this.zoom;
    ctx.stroke();
  }
  
  // ============================================================
  // OVERLAY DE UI CON MÉTRICAS
  // ============================================================
  
  private drawOverlay() {
    const ctx = this.ctx;
    
    // Panel principal (arriba izquierda)
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(10, 10, 200, 80);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.fillText(`Zoom: ${(this.zoom * 100).toFixed(0)}%`, 20, 30);
    
    if (this.designData) {
      const totalStitches = this.designData.regions.reduce((sum, r) => sum + r.stitch_count, 0);
      const totalRegions = this.designData.regions.length;
      ctx.fillText(`Puntadas: ${totalStitches.toLocaleString()}`, 20, 50);
      ctx.fillText(`Regiones: ${totalRegions}`, 20, 70);
    }
    
    // === PASO 5: Panel de métricas de región seleccionada ===
    if (this.selectedRegion) {
      const region = this.designData!.regions.find(r => r.id === this.selectedRegion);
      if (region) {
        this.drawMetricsPanel(region);
      }
    }
    
    // Panel de leyenda (abajo derecha)
    this.drawLegend();
  }
  
  // ============================================================
  // PANEL DE MÉTRICAS
  // ============================================================
  
  private drawMetricsPanel(region: Region) {
    const ctx = this.ctx;
    const panelX = this.canvas.width - 220;
    const panelY = 10;
    const lineHeight = 18;
    
    const metrics = [
      `ID: ${region.id}`,
      `Tipo: ${region.type}`,
      `Color: ${region.color}`,
      `Puntadas: ${region.stitch_count}`,
      `Área: ${(region.area_mm2 || 0).toFixed(2)} mm²`,
      `Compacidad: ${(region.compacidad || 0).toFixed(3)}`,
      `Inertia: ${(region.inertia_ratio || 0).toFixed(2)}`,
      `Aspect: ${(region.bbox_aspect || 0).toFixed(2)}`,
      `Fill Angle: ${region.fill_angle !== undefined ? region.fill_angle + '°' : 'N/A'}`,
    ];
    
    const panelH = metrics.length * lineHeight + 20;
    
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(panelX, panelY, 200, panelH);
    
    ctx.fillStyle = '#00ff88';
    ctx.font = '11px monospace';
    
    metrics.forEach((m, i) => {
      ctx.fillText(m, panelX + 10, panelY + 18 + i * lineHeight);
    });
  }
  
  // ============================================================
  // LEYENDA DE COLORES
  // ============================================================
  
  private drawLegend() {
    const ctx = this.ctx;
    
    if (!this.designData) return;
    
    // Agrupar regiones por color
    const colorMap = new Map<string, { color: string; types: Set<string>; count: number }>();
    
    for (const region of this.designData.regions) {
      if (region.id === 'design_border') continue;
      
      const hex = region.color.toLowerCase();
      if (!colorMap.has(hex)) {
        colorMap.set(hex, { color: region.color, types: new Set(), count: 0 });
      }
      const entry = colorMap.get(hex)!;
      entry.types.add(region.type);
      entry.count++;
    }
    
    const colors = Array.from(colorMap.values());
    if (colors.length === 0) return;
    
    const itemHeight = 20;
    const panelW = 180;
    const panelH = colors.length * itemHeight + 30;
    const panelX = this.canvas.width - panelW - 10;
    const panelY = this.canvas.height - panelH - 10;
    
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px monospace';
    ctx.fillText('Colores:', panelX + 10, panelY + 18);
    
    colors.forEach((entry, i) => {
      const y = panelY + 35 + i * itemHeight;
      
      // Muestra de color
      ctx.fillStyle = entry.color;
      ctx.fillRect(panelX + 10, y - 8, 12, 12);
      
      // Texto
      ctx.fillStyle = '#cccccc';
      const typeStr = Array.from(entry.types).join('/');
      ctx.fillText(`${entry.color} (${typeStr})`, panelX + 28, y + 2);
    });
  }
}

// ============================================================
// EXPORT PARA USO EN REACT/VUE
// ============================================================

export function createStitchRenderer(canvasId: string): StitchCanvasRenderer {
  return new StitchCanvasRenderer(canvasId);
}

// Hook para React
export function useStitchRenderer(canvasId: string) {
  const rendererRef = React.useRef<StitchCanvasRenderer | null>(null);
  
  React.useEffect(() => {
    rendererRef.current = new StitchCanvasRenderer(canvasId);
    
    return () => {
      // Cleanup si es necesario
    };
  }, [canvasId]);
  
  return rendererRef;
}

// ============================================================
// INICIALIZACIÓN (si se usa standalone)
// ============================================================

// @ts-ignore
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.StitchCanvasRenderer = StitchCanvasRenderer;
}
