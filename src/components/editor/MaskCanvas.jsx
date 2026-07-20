import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';

// Utility: get draw dimensions keeping aspect ratio
function getDrawDims(imgEl, W, H) {
  if (!imgEl) return { drawW: W * 0.8, drawH: H * 0.8, offX: W * 0.1, offY: H * 0.1 };
  const scale = Math.min((W * 0.9) / imgEl.naturalWidth, (H * 0.9) / imgEl.naturalHeight);
  const drawW = imgEl.naturalWidth * scale;
  const drawH = imgEl.naturalHeight * scale;
  return { drawW, drawH, offX: (W - drawW) / 2, offY: (H - drawH) / 2 };
}

// Magic wand flood fill (normalized color distance)
function magicWand(imageData, W, H, startX, startY, tolerancePct) {
  const tol = (tolerancePct / 100) * 441; // 441 = max RGB dist
  const d = imageData.data;
  const si = (startY * W + startX) * 4;
  const sr = d[si], sg = d[si + 1], sb = d[si + 2];

  const mask = new Uint8Array(W * H);
  const visited = new Uint8Array(W * H);
  const stack = [startY * W + startX];
  visited[startY * W + startX] = 1;

  while (stack.length) {
    const idx = stack.pop();
    const x = idx % W, y = Math.floor(idx / W);
    const i = idx * 4;
    const dr = d[i] - sr, dg = d[i + 1] - sg, db = d[i + 2] - sb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist > tol) continue;
    mask[idx] = 1;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (!visited[ni]) { visited[ni] = 1; stack.push(ni); }
    }
  }
  return mask;
}

const MaskCanvas = forwardRef(function MaskCanvas(
  { imageUrl, activeTool, brushSize, brushMode, wandTolerance, showMaskOverlay, showOriginal, onMaskChange },
  ref
) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);        // composite display canvas
  const maskCanvasRef = useRef(null);    // off-screen mask (red channel = masked)
  const imageRef = useRef(null);
  const isPaintingRef = useRef(false);
  const lastPosRef = useRef(null);
  const [dims, setDims] = useState({ W: 800, H: 600 });

  // Expose mask operations to parent
  useImperativeHandle(ref, () => ({
    getMaskedImageBlob: () => getMaskedImageBlob(),
    clearMask: () => clearMask(),
    invertMask: () => invertMask(),
    getMaskedPixelCount: () => countMasked(),
  }));

  // Load image
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      initMaskCanvas(img);
      render();
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Resize observer
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) return;
      setDims({ W: el.clientWidth, H: el.clientHeight });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Re-render when dims or settings change
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.width = dims.W;
      canvasRef.current.height = dims.H;
    }
    render();
  }, [dims, showMaskOverlay, showOriginal]);

  function initMaskCanvas(img) {
    const mc = maskCanvasRef.current;
    if (!mc) return;
    mc.width = img.naturalWidth;
    mc.height = img.naturalHeight;
    const ctx = mc.getContext('2d');
    ctx.clearRect(0, 0, mc.width, mc.height);
  }

  function clearMask() {
    const mc = maskCanvasRef.current;
    if (!mc) return;
    const ctx = mc.getContext('2d');
    ctx.clearRect(0, 0, mc.width, mc.height);
    render();
    reportMaskChange();
  }

  function invertMask() {
    const mc = maskCanvasRef.current;
    if (!mc || !imageRef.current) return;
    const W = mc.width, H = mc.height;
    const ctx = mc.getContext('2d');
    const imgData = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < W * H * 4; i += 4) {
      // If not masked → mask; if masked → unmask
      const wasMasked = imgData.data[i + 3] > 0;
      imgData.data[i]     = 255;
      imgData.data[i + 1] = 0;
      imgData.data[i + 2] = 0;
      imgData.data[i + 3] = wasMasked ? 0 : 200;
    }
    ctx.putImageData(imgData, 0, 0);
    render();
    reportMaskChange();
  }

  function countMasked() {
    const mc = maskCanvasRef.current;
    if (!mc) return 0;
    const ctx = mc.getContext('2d');
    const data = ctx.getImageData(0, 0, mc.width, mc.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) count++; }
    return count;
  }

  function reportMaskChange() {
    if (onMaskChange) onMaskChange(countMasked());
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const mc = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { W, H } = { W: canvas.width, H: canvas.height };
    const img = imageRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    if (!img) return;
    const { drawW, drawH, offX, offY } = getDrawDims(img, W, H);

    // Draw image (optionally dimmed if showing mask)
    ctx.save();
    ctx.globalAlpha = showOriginal ? 1 : 0.85;
    ctx.drawImage(img, offX, offY, drawW, drawH);
    ctx.restore();

    // Red mask overlay
    if (showMaskOverlay && mc && mc.width > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(mc, offX, offY, drawW, drawH);
      ctx.restore();
    }
  }, [showMaskOverlay, showOriginal]);

  useEffect(() => { render(); }, [render]);

  // ── COORDINATE TRANSFORM ──────────────────────────────────────────────────
  function canvasToImage(cx, cy) {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return null;
    const { drawW, drawH, offX, offY } = getDrawDims(img, canvas.width, canvas.height);
    const ix = Math.round(((cx - offX) / drawW) * img.naturalWidth);
    const iy = Math.round(((cy - offY) / drawH) * img.naturalHeight);
    if (ix < 0 || iy < 0 || ix >= img.naturalWidth || iy >= img.naturalHeight) return null;
    return { x: ix, y: iy };
  }

  function canvasBrushToImageRadius() {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return brushSize;
    const { drawW } = getDrawDims(img, canvas.width, canvas.height);
    return Math.ceil((brushSize / drawW) * img.naturalWidth);
  }

  // ── BRUSH PAINTING ────────────────────────────────────────────────────────
  function paintBrush(cx, cy) {
    const mc = maskCanvasRef.current;
    const img = imageRef.current;
    if (!mc || !img) return;
    const pos = canvasToImage(cx, cy);
    if (!pos) return;
    const r = canvasBrushToImageRadius();
    const ctx = mc.getContext('2d');

    if (brushMode === 'erase') {
      // Paint red mask
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255,0,0,0.9)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Restore: clear mask in this area
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    render();
    reportMaskChange();
  }

  function interpolateBrush(from, to, cx, cy) {
    const dx = cx - from.x, dy = cy - from.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, brushSize / 4);
    const steps = Math.ceil(dist / step);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      paintBrush(from.x + dx * t, from.y + dy * t);
    }
  }

  // ── MAGIC WAND ────────────────────────────────────────────────────────────
  function applyWand(cx, cy) {
    const mc = maskCanvasRef.current;
    const img = imageRef.current;
    if (!mc || !img) return;
    const pos = canvasToImage(cx, cy);
    if (!pos) return;

    // Draw image to temp canvas to sample pixel data
    const tmp = document.createElement('canvas');
    tmp.width = img.naturalWidth;
    tmp.height = img.naturalHeight;
    const tCtx = tmp.getContext('2d');
    tCtx.drawImage(img, 0, 0);
    const imageData = tCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);

    const mask = magicWand(imageData, img.naturalWidth, img.naturalHeight, pos.x, pos.y, wandTolerance);

    // Apply mask to maskCanvas
    const mCtx = mc.getContext('2d');
    const mData = mCtx.getImageData(0, 0, mc.width, mc.height);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        mData.data[i * 4]     = 255;
        mData.data[i * 4 + 1] = 0;
        mData.data[i * 4 + 2] = 0;
        mData.data[i * 4 + 3] = 200;
      }
    }
    mCtx.putImageData(mData, 0, 0);
    render();
    reportMaskChange();
  }

  // ── GET MASKED IMAGE BLOB ─────────────────────────────────────────────────
  async function getMaskedImageBlob() {
    const mc = maskCanvasRef.current;
    const img = imageRef.current;
    if (!img) return null;
    const W = img.naturalWidth, H = img.naturalHeight;

    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(img, 0, 0);

    if (mc && mc.width > 0) {
      const maskData = mc.getContext('2d').getImageData(0, 0, W, H);
      const imgData = ctx.getImageData(0, 0, W, H);
      for (let i = 0; i < W * H; i++) {
        if (maskData.data[i * 4 + 3] > 0) {
          imgData.data[i * 4 + 3] = 0; // make transparent
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    return new Promise(resolve => tmp.toBlob(resolve, 'image/png'));
  }

  // ── POINTER EVENTS ────────────────────────────────────────────────────────
  function getCanvasPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  const handlePointerDown = (e) => {
    if (!imageRef.current) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    if (activeTool === 'brush') {
      isPaintingRef.current = true;
      lastPosRef.current = pos;
      paintBrush(pos.x, pos.y);
    } else if (activeTool === 'wand') {
      applyWand(pos.x, pos.y);
    }
  };

  const handlePointerMove = (e) => {
    if (!isPaintingRef.current || activeTool !== 'brush') return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    if (lastPosRef.current) interpolateBrush(lastPosRef.current, lastPosRef.current, pos.x, pos.y);
    paintBrush(pos.x, pos.y);
    lastPosRef.current = pos;
  };

  const handlePointerUp = () => {
    isPaintingRef.current = false;
    lastPosRef.current = null;
  };

  // Cursor style
  const cursor = activeTool === 'brush'
    ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${brushSize}' height='${brushSize}'%3E%3Ccircle cx='${brushSize/2}' cy='${brushSize/2}' r='${brushSize/2-1}' fill='none' stroke='white' stroke-width='1.5' stroke-dasharray='3,2'/%3E%3C/svg%3E") ${brushSize/2} ${brushSize/2}, crosshair`
    : 'crosshair';

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#1a1a2e]">
      {/* Off-screen mask canvas */}
      <canvas ref={maskCanvasRef} style={{ display: 'none' }} />

      {/* Display canvas */}
      <canvas
        ref={canvasRef}
        width={dims.W}
        height={dims.H}
        className="w-full h-full"
        style={{ cursor, touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />

      {/* Brush size cursor ring overlay (visual only) */}
      {activeTool === 'brush' && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-[#0d0f14]/80 border border-[#2a2d3a] rounded-lg px-2.5 py-1.5 text-[10px] text-slate-400 pointer-events-none">
          <div
            className="rounded-full border border-dashed border-white/50"
            style={{ width: Math.min(brushSize, 40), height: Math.min(brushSize, 40) }}
          />
          <span>{brushSize}px • <span className={brushMode === 'erase' ? 'text-red-400' : 'text-emerald-400'}>{brushMode === 'erase' ? 'Borrar' : 'Restaurar'}</span></span>
        </div>
      )}
    </div>
  );
});

export default MaskCanvas;