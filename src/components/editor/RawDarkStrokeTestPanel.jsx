import { useState, useRef, useEffect } from 'react';
import { Bug, Download, Image as ImageIcon, ShieldAlert, Eye } from 'lucide-react';
import { runRawDarkStrokeTest } from '@/lib/rawDarkStrokeTest';
import { buildDSTFromCommands } from '@/lib/dstDirectExport';

/**
 * RawDarkStrokeTestPanel — FULLY ISOLATED diagnostic, STRICT dark mask.
 *
 * Uses ONLY the original upload bitmap + a strict dark mask (luma<55,
 * sat<80, localContrast>20). Two overlays:
 *   A) Strict dark mask only (white bg + cyan pixels)
 *   B) Exported paths over strict dark mask (cyan + yellow + red rejected)
 */
export default function RawDarkStrokeTestPanel({ project, config, finalCommands }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('mask_only'); // 'mask_only' | 'paths_over_mask'
  const canvasRef = useRef(null);

  const sourceUsed = {
    originalImage: true,
    darkStrokeMask: true,
    finalEmbroideryCommands: false,
    regionBoundaries: false,
    cachedContours: false,
  };

  const invalid = finalCommands !== undefined && finalCommands !== null;
  const hasOriginal = !!project?.image_url;
  const ok = !invalid && hasOriginal && sourceUsed.originalImage && sourceUsed.darkStrokeMask &&
    !sourceUsed.finalEmbroideryCommands && !sourceUsed.regionBoundaries && !sourceUsed.cachedContours;

  const handleRun = async () => {
    if (invalid) { setError('TEST INVALID: using finalEmbroideryCommands'); return; }
    if (!hasOriginal) { setError('RAW DARK TEST INVALID: original bitmap missing'); return; }
    setRunning(true); setError(null); setResult(null);
    try {
      const res = await runRawDarkStrokeTest(project.image_url, config);
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const handleDownload = () => {
    if (!result || result.commands.length === 0) return;
    try {
      const { blob } = buildDSTFromCommands(result.commands, { label: 'RAW_DARK_LOWER_FEET', ce01Strict: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'RAW_DARK_LOWER_FEET_TEST.dst'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`DST failed: ${e.message}`);
    }
  };

  // Overlay render
  useEffect(() => {
    if (!result) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width: W, height: H, strictMask, exportedPaths, rejected, consolidatedLowerOutlinePaths, consolidationRejected } = result;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    if (viewMode === 'mask_only') {
      // A) Strict dark mask only — white bg + cyan pixels
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const overlay = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        if (strictMask[i]) {
          overlay.data[i * 4] = 34;
          overlay.data[i * 4 + 1] = 211;
          overlay.data[i * 4 + 2] = 238;
          overlay.data[i * 4 + 3] = 255;
        }
      }
      ctx.putImageData(overlay, 0, 0);
    } else if (viewMode === 'paths_over_mask') {
      // B) Exported paths over strict dark mask
      // faint white bg + cyan mask
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(0, 0, W, H);
      const overlay = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        if (strictMask[i]) {
          overlay.data[i * 4] = 34;
          overlay.data[i * 4 + 1] = 211;
          overlay.data[i * 4 + 2] = 238;
          overlay.data[i * 4 + 3] = 160;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = W; tmp.height = H;
      tmp.getContext('2d').putImageData(overlay, 0, 0);
      ctx.drawImage(tmp, 0, 0);

      // red rejected
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      for (const r of rejected) {
        const path = r.path;
        if (path.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // yellow exported
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.8;
      for (const path of exportedPaths) {
        if (path.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
    } else if (viewMode === 'consolidated') {
      // C) Consolidated contours: micro-paths grey, consolidated by zone, rejected red
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(0, 0, W, H);
      const overlay = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        if (strictMask[i]) {
          overlay.data[i * 4] = 34; overlay.data[i * 4 + 1] = 211; overlay.data[i * 4 + 2] = 238; overlay.data[i * 4 + 3] = 90;
        }
      }
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      tmp.getContext('2d').putImageData(overlay, 0, 0); ctx.drawImage(tmp, 0, 0);
      // micro-paths grey thin
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 0.8;
      for (const path of exportedPaths) {
        if (path.length < 2) continue;
        ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
      // rejected red dashed
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 2]);
      for (const r of (consolidationRejected || [])) {
        const path = r.path; if (!path || path.length < 2) continue;
        ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // consolidated colored by zone
      ctx.lineWidth = 2;
      for (const c of (consolidatedLowerOutlinePaths || [])) {
        const path = c.path; if (!path || path.length < 2) continue;
        ctx.strokeStyle = c.zone === 'body_lower_outline' ? '#22c55e'
          : c.zone === 'left_foot_outer_outline' ? '#3b82f6'
          : c.zone === 'right_foot_outer_outline' ? '#f97316' : '#a78bfa';
        ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
    }
  }, [result, viewMode]);

  const d = result?.diagnostics;
  const accepted = d &&
    d.exportedPaths > 0 &&
    d.averagePathDarkSupport >= 0.90 &&
    d.hasMouth && d.hasEyes && d.hasLowerContour &&
    !d.hasPinkBoundary &&
    d.consolidatedLowerPaths >= 3 && d.consolidatedLowerPaths <= 12 &&
    d.bodyLowerDetected && d.leftFootDetected && d.rightFootDetected &&
    (d.footCoverageLeft ?? 0) >= 85 && (d.footCoverageRight ?? 0) >= 85 && (d.bodyLowerCoverage ?? 0) >= 85 &&
    !d.consolidationFailReason;

  return (
    <div className="bg-[#0d0f14] border border-cyan-500/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Bug className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-cyan-300">DEBUG RAW dark stroke lower/feet (strict mask)</span>
      </div>

      {/* Source declaration */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <SourceRow label="originalImage" value="true" ok />
        <SourceRow label="darkStrokeMask" value="true" ok />
        <SourceRow label="finalEmbroideryCommands" value="false" ok />
        <SourceRow label="regionBoundaries" value="false" ok />
        <SourceRow label="cachedContours" value="false" ok />
      </div>

      {invalid && (
        <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-500/30 rounded px-2 py-1 flex items-center gap-1">
          <ShieldAlert className="w-3 h-3" /> TEST INVALID: using finalEmbroideryCommands
        </div>
      )}
      {!hasOriginal && (
        <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-500/30 rounded px-2 py-1 flex items-center gap-1">
          <ShieldAlert className="w-3 h-3" /> RAW DARK TEST INVALID: original bitmap missing
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={running || !ok}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan-900/30 border border-cyan-500/40 text-cyan-200 text-xs font-bold hover:bg-cyan-900/40 transition-colors disabled:opacity-50"
      >
        {running ? <div className="w-3.5 h-3.5 border-2 border-cyan-300/30 border-t-cyan-300 rounded-full animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
        {running ? 'Procesando bitmap original...' : 'Ejecutar test aislado (máscara estricta)'}
      </button>

      {error && (
        <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-500/30 rounded px-2 py-1">{error}</div>
      )}

      {result && (
        <>
          {/* View toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('mask_only')}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${viewMode === 'mask_only' ? 'bg-cyan-900/30 border-cyan-500 text-cyan-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'}`}
            >A) Máscara pura</button>
            <button
              onClick={() => setViewMode('paths_over_mask')}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${viewMode === 'paths_over_mask' ? 'bg-cyan-900/30 border-cyan-500 text-cyan-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'}`}
            >B) Paths sobre máscara</button>
            <button
              onClick={() => setViewMode('consolidated')}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${viewMode === 'consolidated' ? 'bg-cyan-900/30 border-cyan-500 text-cyan-300' : 'bg-[#161a23] border-[#2a2d3a] text-slate-500'}`}
            >C) Consolidados</button>
          </div>

          <canvas ref={canvasRef} className="w-full bg-[#0d0f14] border border-[#1e2130] rounded-lg" />
          <div className="flex items-center gap-3 text-[9px] text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#22d3ee]"></span> Máscara</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#eab308]"></span> Exportados</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 border-t border-dashed border-[#ef4444]"></span> Rechazados</span>
          </div>

          {/* Strict mask content checks */}
          <div className="bg-[#161a23] rounded-lg p-2.5 border border-[#1e2130] grid grid-cols-2 gap-1.5 text-[10px]">
            <Diag label="dark pixels" value={d?.darkPixelsCount} />
            <Diag label="components" value={d?.componentsCount} />
            <Diag label="lower comps" value={d?.lowerComponentsCount} />
            <Diag label="raw before filter" value={d?.rawPathsBeforeFilter} />
            <Diag label="raw after filter" value={d?.rawPathsAfterFilter} />
            <Diag label="exported paths" value={d?.exportedPaths} color={d?.exportedPaths > 0 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="rejected crop border" value={d?.rejectedCropBorderPaths} />
            <Diag label="rejected low support" value={d?.rejectedLowDarkSupportPaths} />
            <Diag label="avg dark support" value={d?.averagePathDarkSupport != null ? d.averagePathDarkSupport.toFixed(3) : '—'} color={d?.averagePathDarkSupport >= 0.90 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="min dark support" value={d?.minPathDarkSupport != null ? d.minPathDarkSupport.toFixed(3) : '—'} color={d?.minPathDarkSupport >= 0.90 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="mask has mouth" value={d?.hasMouth ? 'YES' : 'NO'} color={d?.hasMouth ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="mask has eyes" value={d?.hasEyes ? 'YES' : 'NO'} color={d?.hasEyes ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="mask has lower" value={d?.hasLowerContour ? 'YES' : 'NO'} color={d?.hasLowerContour ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="pink boundary" value={d?.hasPinkBoundary ? 'YES' : 'NO'} color={d?.hasPinkBoundary ? 'text-red-400' : 'text-emerald-400'} />
            <Diag label="mouth px" value={d?.mouthPixels} />
            <Diag label="eye px" value={d?.eyePixels} />
            <Diag label="lower px" value={d?.lowerPixels} />
            <Diag label="junctions" value={d?.skeletonJunctionCount} />
            <Diag label="split paths" value={d?.splitPathCount} />
            <Diag label="lower subpaths" value={d?.lowerRawSubpaths} color={d?.lowerRawSubpaths > 0 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="L foot subpaths" value={d?.leftFootRawSubpaths} color={d?.leftFootRawSubpaths > 0 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="R foot subpaths" value={d?.rightFootRawSubpaths} color={d?.rightFootRawSubpaths > 0 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="consolidated" value={d?.consolidatedLowerPaths} color={d?.consolidatedLowerPaths >= 3 && d?.consolidatedLowerPaths <= 12 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="body lower" value={d?.bodyLowerDetected ? 'YES' : 'NO'} color={d?.bodyLowerDetected ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="L foot" value={d?.leftFootDetected ? 'YES' : 'NO'} color={d?.leftFootDetected ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="R foot" value={d?.rightFootDetected ? 'YES' : 'NO'} color={d?.rightFootDetected ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="cov L foot" value={(d?.footCoverageLeft ?? 0) + '%'} color={(d?.footCoverageLeft ?? 0) >= 85 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="cov R foot" value={(d?.footCoverageRight ?? 0) + '%'} color={(d?.footCoverageRight ?? 0) >= 85 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="cov body" value={(d?.bodyLowerCoverage ?? 0) + '%'} color={(d?.bodyLowerCoverage ?? 0) >= 85 ? 'text-emerald-400' : 'text-red-400'} />
            <Diag label="oval used" value={d?.ovalBoundaryUsed ? 'YES' : 'NO'} color={d?.ovalBoundaryUsed ? 'text-red-400' : 'text-emerald-400'} />
            <Diag label="largest only" value={d?.largestComponentOnly ? 'YES' : 'NO'} color={d?.largestComponentOnly ? 'text-red-400' : 'text-emerald-400'} />
            <Diag label="scale" value={d?.scale} />
          </div>

          {d?.lowerOutlineMissing && (
            <div className="text-[10px] text-amber-400 bg-amber-900/20 border border-amber-500/30 rounded px-2 py-1 flex items-center gap-1">
              <Eye className="w-3 h-3" /> lower outline missing in strict dark mask — sin inventar contorno.
            </div>
          )}

          {/* Acceptance */}
          <div className={`text-[10px] rounded px-2 py-1.5 border ${accepted ? 'text-emerald-300 bg-emerald-900/20 border-emerald-500/30' : 'text-red-300 bg-red-900/20 border-red-500/30'}`}>
            {accepted
              ? '✓ Aceptado: máscara estricta con boca+ojos+inferior, sin frontera rosa, paths con soporte >= 0.90'
              : '✗ No aceptado. Revisa overlay A (¿detecta boca/ojos/inferior?) y B (¿amarillo sobre cian?).'}
          </div>

          <button
            onClick={handleDownload}
            disabled={result.commands.length === 0}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-amber-900/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-900/30 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar DST (solo paths inferiores/pies)
          </button>

          <div className="text-[9px] text-slate-600 leading-relaxed">
            A) comprueba si la máscara detecta boca/ojos/contorno inferior y NO la unión rosa-rosa.
            B) comprueba si los paths amarillos están encima del cian. Si B no coincide con A → fallo de vectorización.
          </div>
        </>
      )}
    </div>
  );
}

function SourceRow({ label, value, ok }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className="text-slate-400">{label}</span>
      <span className={`ml-auto font-bold ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{value}</span>
    </div>
  );
}

function Diag({ label, value, color }) {
  return (
    <div>
      <div className="text-[8px] text-slate-600 uppercase tracking-wider">{label}</div>
      <div className={`text-[11px] font-bold ${color || 'text-slate-300'}`}>{value ?? '—'}</div>
    </div>
  );
}