import React, { useRef, useState, useCallback } from 'react';
import { UploadCloud, FileX, Loader2 } from 'lucide-react';

/**
 * FileDropzone — local-only file loader for the Diagnostic Lab.
 * Accepts DST / DSB / JSON. Reads as ArrayBuffer. Never uploads.
 */
export default function FileDropzone({ label, accept = '.dst,.dsb,.json', disabled, onFile, loading }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState(null);

  const MAX_BYTES = 64 * 1024 * 1024; // 64 MB safety cap

  const handleFile = useCallback(async (file) => {
    setLocalError(null);
    if (!file) return;
    if (file.size === 0) {
      setLocalError('El archivo está vacío (0 bytes).');
      onFile?.(null, new Error('empty_file'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError(`Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Límite 64 MB.`);
      onFile?.(null, new Error('too_large'));
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      onFile?.({ name: file.name, size: file.size, bytes: new Uint8Array(buf) });
    } catch (e) {
      setLocalError('No se pudo leer el archivo localmente.');
      onFile?.(null, e);
    }
  }, [onFile]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative rounded-xl border-2 border-dashed p-4 transition-colors ${
        dragging ? 'border-violet-500 bg-violet-500/5' : 'border-[#2a2d3a] bg-[#0d0f14]'
      } ${disabled ? 'opacity-40 pointer-events-none' : 'hover:border-violet-500/60'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-3 text-left"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-900/30 border border-violet-500/40">
          {loading ? <Loader2 className="h-5 w-5 text-violet-300 animate-spin" /> : <UploadCloud className="h-5 w-5 text-violet-300" />}
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-slate-200">{label}</div>
          <div className="text-[10px] text-slate-500">DST · DSB · JSON — solo lectura local, sin envío externo</div>
        </div>
      </button>
      {localError && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-300">
          <FileX className="h-3 w-3" /> {localError}
        </div>
      )}
    </div>
  );
}