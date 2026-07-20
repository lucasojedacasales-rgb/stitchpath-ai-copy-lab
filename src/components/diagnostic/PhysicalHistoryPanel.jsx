import React, { useEffect, useState } from 'react';
import { ClipboardList, Save, Camera, Check } from 'lucide-react';

const STORAGE_KEY = 'engineV2_diag_history_v1';
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveHistory(obj) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch (e) { /* quota */ }
}

const FIELDS = [
  { key: 'machineRecognized', label: 'La máquina lo reconoce', type: 'check' },
  { key: 'previewCorrect', label: 'Preview correcto', type: 'check' },
  { key: 'manualPathCorrect', label: 'Recorrido manual correcto', type: 'check' },
  { key: 'embroideryStarted', label: 'Bordado iniciado', type: 'check' },
  { key: 'embroideryCompleted', label: 'Bordado completado', type: 'check' },
  { key: 'tension', label: 'Tensión', type: 'text' },
  { key: 'puckering', label: 'Puckering', type: 'text' },
  { key: 'visibleJumps', label: 'Saltos visibles', type: 'text' },
  { key: 'accumulations', label: 'Acumulaciones', type: 'text' },
  { key: 'coverage', label: 'Cobertura', type: 'text' },
  { key: 'notes', label: 'Observaciones', type: 'textarea' },
];

export default function PhysicalHistoryPanel({ sha256, fileName }) {
  const [history, setHistory] = useState({});
  const [form, setForm] = useState({});
  const [photo, setPhoto] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!sha256) { setForm({}); setPhoto(null); return; }
    const entry = history[sha256] || {};
    setForm(entry.form || {});
    setPhoto(entry.photo || null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sha256]);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onPhoto = (file) => {
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) { alert('La foto supera 2 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const save = () => {
    if (!sha256) return;
    const next = { ...history, [sha256]: { fileName, form, photo, savedAt: new Date().toISOString() } };
    setHistory(next);
    saveHistory(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-900/30 border border-emerald-500/40">
          <ClipboardList className="h-4 w-4 text-emerald-300" />
        </div>
        <div className="text-xs font-bold text-white">Historial físico</div>
        <div className="ml-auto text-[10px] text-slate-500">
          {sha256 ? `clave: ${sha256.slice(0, 10)}…` : 'carga un archivo para registrar'}
        </div>
      </div>

      {!sha256 ? (
        <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3 text-[11px] text-slate-500">
          El historial se asocia al archivo por su SHA-256 y se guarda localmente en el navegador (no en la base de datos).
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-[#1e2130] bg-[#0d0f14] p-3 space-y-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="flex items-start gap-3">
                {f.type === 'check' ? (
                  <label className="flex flex-1 items-center gap-2 text-[11px] text-slate-200">
                    <input
                      type="checkbox"
                      checked={!!form[f.key]}
                      onChange={(e) => update(f.key, e.target.checked)}
                      className="h-3.5 w-3.5 accent-emerald-500"
                    />
                    {f.label}
                  </label>
                ) : f.type === 'textarea' ? (
                  <div className="flex-1">
                    <label className="text-[10px] uppercase tracking-wide text-slate-500">{f.label}</label>
                    <textarea
                      value={form[f.key] || ''}
                      onChange={(e) => update(f.key, e.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-md bg-[#0d0f14] border border-[#2a2d3a] p-2 text-[11px] text-slate-200 focus:border-emerald-500 outline-none"
                    />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <label className="w-32 text-[10px] uppercase tracking-wide text-slate-500">{f.label}</label>
                    <input
                      value={form[f.key] || ''}
                      onChange={(e) => update(f.key, e.target.value)}
                      className="flex-1 rounded-md bg-[#0d0f14] border border-[#2a2d3a] px-2 py-1 text-[11px] text-slate-200 focus:border-emerald-500 outline-none"
                    />
                  </div>
                )}
              </div>
            ))}

            <div className="flex items-center gap-3 pt-1">
              <label className="flex items-center gap-2 rounded-md border border-[#2a2d3a] bg-[#0d0f14] px-2.5 py-1.5 text-[11px] text-slate-300 cursor-pointer hover:border-emerald-500">
                <Camera className="h-3.5 w-3.5" /> Foto opcional
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
              </label>
              {photo && <img src={photo} alt="referencia" className="h-12 w-12 rounded object-cover border border-[#2a2d3a]" />}
              <button
                onClick={save}
                className="ml-auto flex items-center gap-2 rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white"
              >
                {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {saved ? 'Guardado' : 'Guardar observación'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}