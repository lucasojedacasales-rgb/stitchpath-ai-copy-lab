import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ZoomIn, ZoomOut, RotateCw } from 'lucide-react';

/**
 * EmbroideryPreview3D — Renders stitches as 3D cylinders with proper overlap/layering
 * Allows inspection of thread superposition before export
 */
export default function EmbroideryPreview3D({ regions, config }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef({ rotation: { x: -0.3, z: 0 }, zoom: 1, pan: { x: 0, y: 0 } });
  const [stats, setStats] = useState({ totalStitches: 0, regions: 0 });
  const [view, setView] = useState('top'); // 'top', 'isometric', 'front'

  useEffect(() => {
    if (!mountRef.current) return;

    // Initialize Three.js scene
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x4a4a4a); // fabric color
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
    cameraRef.current = camera;
    updateCameraPosition(camera, view);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    // Add fabric plane (optional visual reference)
    const fabricGeom = new THREE.PlaneGeometry(100, 100);
    const fabricMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8 });
    const fabricPlane = new THREE.Mesh(fabricGeom, fabricMat);
    fabricPlane.rotationOrder = 'YXZ';
    scene.add(fabricPlane);

    // Build 3D stitches from regions
    const { stitches, totalCount } = buildStitches3D(regions, config);
    const group = new THREE.Group();
    scene.add(group);

    // Render threads as cylinders
    const threadRadius = 0.2; // mm
    const threadMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.1,
      roughness: 0.7,
    });

    const coloredMaterials = {};
    const getColoredMaterial = (color) => {
      if (!coloredMaterials[color]) {
        coloredMaterials[color] = threadMaterial.clone();
        coloredMaterials[color].color = new THREE.Color(color);
      }
      return coloredMaterials[color];
    };

    for (const stitch of stitches) {
      const [x1, y1, z1, x2, y2, z2, color] = stitch;

      // Create cylinder for this stitch segment
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dz = z2 - z1;
      const length = Math.hypot(dx, dy, dz) || 0.1;

      const cylGeom = new THREE.CylinderGeometry(threadRadius, threadRadius, length, 8);
      const mat = getColoredMaterial(color);
      const cyl = new THREE.Mesh(cylGeom, mat);

      // Position at midpoint
      cyl.position.set(x1 + dx / 2, y1 + dy / 2, z1 + dz / 2);

      // Rotation to align with vector
      const axis = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      const quat = new THREE.Quaternion();
      quat.setFromUnitVectors(axis, dir);
      cyl.quaternion.copy(quat);

      // Cast shadows
      cyl.castShadow = true;
      cyl.receiveShadow = true;

      group.add(cyl);
    }

    // Fit to view
    fitCameraToGroup(camera, group);

    // Mouse controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    renderer.domElement.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    renderer.domElement.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      controlsRef.current.rotation.z += deltaX * 0.005;
      controlsRef.current.rotation.x += deltaY * 0.005;

      updateCameraPosition(camera, view);
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    renderer.domElement.addEventListener('mouseup', () => {
      isDragging = false;
    });

    renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      controlsRef.current.zoom *= delta;
      updateCameraPosition(camera, view);
    });

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      // Auto-rotate slightly if not dragging
      group.rotation.z += 0.0005;

      renderer.render(scene, camera);
    };

    animate();

    setStats({ totalStitches: totalCount, regions: regions.length });

    // Cleanup
    return () => {
      renderer.domElement.removeEventListener('mousedown', () => {});
      renderer.domElement.removeEventListener('mousemove', () => {});
      renderer.domElement.removeEventListener('mouseup', () => {});
      renderer.domElement.removeEventListener('wheel', () => {});
      mountRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [regions, config, view]);

  const updateCameraPosition = (camera, viewType) => {
    const ctrl = controlsRef.current;
    const distance = 150 * ctrl.zoom;

    if (viewType === 'top') {
      camera.position.set(0, distance, 0);
    } else if (viewType === 'isometric') {
      camera.position.set(
        Math.sin(ctrl.rotation.z) * distance * 0.7,
        Math.cos(ctrl.rotation.x) * distance * 0.7,
        Math.cos(ctrl.rotation.z) * distance * 0.7
      );
    } else {
      // front
      camera.position.set(
        Math.sin(ctrl.rotation.z) * distance,
        Math.sin(ctrl.rotation.x) * distance,
        Math.cos(ctrl.rotation.z) * distance
      );
    }

    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };

  const fitCameraToGroup = (camera, group) => {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5;

    camera.position.z = cameraZ;
    camera.lookAt(0, 0, 0);
  };

  const handleZoom = (factor) => {
    controlsRef.current.zoom *= factor;
    if (cameraRef.current) {
      updateCameraPosition(cameraRef.current, view);
    }
  };

  const handleReset = () => {
    controlsRef.current = { rotation: { x: -0.3, z: 0 }, zoom: 1, pan: { x: 0, y: 0 } };
    if (cameraRef.current) {
      updateCameraPosition(cameraRef.current, view);
    }
  };

  return (
    <div className="relative w-full h-full bg-[#2a2a2a] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0d0f14] border-b border-[#1e2130]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('top')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              view === 'top'
                ? 'bg-violet-600/30 text-violet-300 border border-violet-500/30'
                : 'bg-[#161a23] text-slate-500 hover:text-white'
            }`}
          >
            ↑ Arriba
          </button>
          <button
            onClick={() => setView('isometric')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              view === 'isometric'
                ? 'bg-violet-600/30 text-violet-300 border border-violet-500/30'
                : 'bg-[#161a23] text-slate-500 hover:text-white'
            }`}
          >
            ⬠ Isométrica
          </button>
          <button
            onClick={() => setView('front')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              view === 'front'
                ? 'bg-violet-600/30 text-violet-300 border border-violet-500/30'
                : 'bg-[#161a23] text-slate-500 hover:text-white'
            }`}
          >
            ⟷ Frente
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => handleZoom(1.2)}
            className="flex items-center px-2 py-1 rounded border border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:text-white transition-colors text-xs"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleZoom(0.8)}
            className="flex items-center px-2 py-1 rounded border border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:text-white transition-colors text-xs"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReset}
            className="flex items-center px-2 py-1 rounded border border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:text-white transition-colors text-xs"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="text-[11px] text-slate-500">
          {stats.totalStitches.toLocaleString()} puntadas • {stats.regions} regiones
        </div>
      </div>

      {/* 3D Canvas */}
      <div ref={mountRef} className="flex-1 overflow-hidden" />
    </div>
  );
}

/**
 * Build 3D stitch cylinders from regions
 * Returns array of [x1, y1, z1, x2, y2, z2, color] tuples
 */
function buildStitches3D(regions, config) {
  const stitches = [];
  const designW = config.width_mm || 100;
  const designH = config.height_mm || 100;

  const sorted = [...regions].sort((a, b) => (a.priority || 0) - (b.priority || 0));

  let zHeight = 0; // DEFECTO 5 FIX: altura acumulada por región

  for (const region of sorted) {
    if (!region.visible || !region.path_points) continue;

    const color = region.color || '#ffffff';
    const path = region.path_points.map((p) => [p[0] * designW - designW / 2, p[1] * designH - designH / 2]);

    const threadRadius = 0.2;
    const angle = ((region.angle || 0) * Math.PI) / 180;
    const density = region.tatami_density || region.density || 0.4;

    // DEFECTO 5 FIX: Generar fills robusto y verificar que todas las puntadas se renderizan
    const fillLines = generateTatamiFillLines3D(path, angle, density, color);

    // DEFECTO 5 FIX: Cada línea de fill genera múltiples puntos para volumen denso
    for (const line of fillLines) {
      const [x1, y1, x2, y2, col] = line;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const steps = Math.max(3, Math.ceil(len / 1.0)); // paso pequeño = más cilindros = más volumen

      for (let s = 0; s < steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const sx1 = x1 + dx * t;
        const sy1 = y1 + dy * t;
        const t2 = steps > 0 ? (s + 1) / steps : 1;
        const sx2 = x1 + dx * t2;
        const sy2 = y1 + dy * t2;
        
        // Cada segmento a altura incrementada
        stitches.push([sx1, sy1, zHeight, sx2, sy2, zHeight + threadRadius * 1.5, col]);
      }
    }

    // Contornos en altura separada
    const contourHeight = zHeight + threadRadius * 2;
    for (let i = 0; i < path.length - 1; i++) {
      const [x1, y1] = path[i];
      const [x2, y2] = path[i + 1];
      stitches.push([x1, y1, contourHeight, x2, y2, contourHeight + threadRadius, color]);
    }

    // DEFECTO 5 FIX: Altura mínima garantizada para volumen visible
    const regionHeight = Math.max(0.5, Math.ceil(fillLines.length * 0.05));
    zHeight += regionHeight;
  }

  return { stitches, totalCount: stitches.length };
}

/**
 * DEFECTO 5 FIX: Generar 3D tatami fills robusto con cobertura completa
 */
function generateTatamiFillLines3D(polygon, angle, density, color) {
  const lines = [];
  if (polygon.length < 3) return lines;

  // DEFECTO 4 FIX: Calcular PCA real
  const pcaAngle = calculatePolygonPCA3D(polygon);
  const effectiveAngle = angle !== undefined ? angle : pcaAngle;

  const cosA = Math.cos(effectiveAngle);
  const sinA = Math.sin(effectiveAngle);

  const rotatePoint = (x, y) => [x * cosA + y * sinA, -x * sinA + y * cosA];
  const rotatedPoly = polygon.map((p) => rotatePoint(p[0], p[1]));

  let rMinY = Infinity, rMaxY = -Infinity;
  for (const [x, y] of rotatedPoly) {
    rMinY = Math.min(rMinY, y);
    rMaxY = Math.max(rMaxY, y);
  }

  const realDensity = Math.max(0.25, Math.min(density, 0.6));

  // DEFECTO 1 FIX: Generar scanlines sin gaps
  for (let y = rMinY; y <= rMaxY; y += realDensity) {
    const intersections = [];
    for (let i = 0; i < rotatedPoly.length; i++) {
      const [x1, y1] = rotatedPoly[i];
      const [x2, y2] = rotatedPoly[(i + 1) % rotatedPoly.length];

      if (Math.abs(y2 - y1) < 1e-6) continue;

      if ((y1 <= y && y <= y2) || (y2 <= y && y <= y1)) {
        const t = (y - y1) / (y2 - y1);
        const x = x1 + t * (x2 - x1);
        intersections.push(x);
      }
    }

    if (intersections.length < 2) continue;

    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length - 1; i += 2) {
      let x1 = intersections[i];
      let x2 = intersections[i + 1];

      // DEFECTO 2 FIX: Margen para evitar gaps
      const margin = 0.05;
      x1 -= margin;
      x2 += margin;

      const unrotate = (x, y) => [x * cosA - y * sinA, x * sinA + y * cosA];
      const [ox1, oy1] = unrotate(x1, y);
      const [ox2, oy2] = unrotate(x2, y);

      // DEFECTO 1 FIX: Verificar punto dentro del polígono
      if (isPointInPolygon3D([(ox1 + ox2) / 2, (oy1 + oy2) / 2], polygon)) {
        lines.push([ox1, oy1, ox2, oy2, color]);
      }
    }
  }

  return lines;
}

function calculatePolygonPCA3D(polygon) {
  if (polygon.length < 3) return 0;
  
  const cx = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
  const cy = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
  
  let cov_xx = 0, cov_yy = 0, cov_xy = 0;
  for (const [x, y] of polygon) {
    const dx = x - cx;
    const dy = y - cy;
    cov_xx += dx * dx;
    cov_yy += dy * dy;
    cov_xy += dx * dy;
  }
  
  const trace = cov_xx + cov_yy;
  const det = cov_xx * cov_yy - cov_xy * cov_xy;
  const lambda = (trace + Math.sqrt(Math.max(0, trace * trace - 4 * det))) / 2;
  
  let angle = 0;
  if (Math.abs(cov_xy) > 1e-6) {
    angle = Math.atan2(lambda - cov_xx, cov_xy);
  } else if (cov_xx > cov_yy) {
    angle = 0;
  } else {
    angle = Math.PI / 2;
  }
  
  return angle;
}

function isPointInPolygon3D(point, polygon) {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside;
}