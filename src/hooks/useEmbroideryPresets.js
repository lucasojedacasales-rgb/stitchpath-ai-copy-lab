import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

// ── Factory presets (not editable) ───────────────────────────────────────────

export const FACTORY_PRESETS = [
  {
    id: 'fac_patch',
    name: 'Parche básico',
    icon: '🔵',
    description: 'Fill denso con contornos running stitch. Ideal para parches estándar.',
    is_factory: true,
    rules: [
      { match: 'fill',            density: 0.6, angle: 45,  underlay: true,  pull_compensation: 0.15 },
      { match: 'satin',           density: 0.8, angle: 45,  underlay: true,  pull_compensation: 0.2  },
      { match: 'running_stitch',  density: 0.3, angle: 0,   underlay: false, pull_compensation: 0.1  },
    ],
  },
  {
    id: 'fac_logo',
    name: 'Logo corporativo',
    icon: '🏢',
    description: 'Fill horizontal limpio, texto satin fino, bordes running mínimos.',
    is_factory: true,
    rules: [
      { match: 'fill',            density: 0.8, angle: 0,   underlay: false, pull_compensation: 0.15 },
      { match: 'satin',           density: 0.7, angle: 45,  underlay: false, pull_compensation: 0.2  },
      { match: 'running_stitch',  density: 0.3, angle: 0,   underlay: false, pull_compensation: 0.1  },
    ],
  },
  {
    id: 'fac_terry',
    name: 'Toalla / Terry',
    icon: '🏊',
    description: 'Densidad muy alta, ángulo 90°, underlay triple para telas con pelo.',
    is_factory: true,
    rules: [
      { match: 'fill',            density: 1.2, angle: 90,  underlay: true,  pull_compensation: 0.3  },
      { match: 'satin',           density: 1.0, angle: 90,  underlay: true,  pull_compensation: 0.3  },
      { match: 'running_stitch',  density: 0.5, angle: 0,   underlay: false, pull_compensation: 0.15 },
    ],
  },
  {
    id: 'fac_small_text',
    name: 'Letras pequeñas (<5mm)',
    icon: '🔤',
    description: 'Todo satin, alta densidad, pull comp 0.3. Sin fill.',
    is_factory: true,
    rules: [
      { match: 'fill',            stitch_type: 'satin', density: 1.0, angle: 45, underlay: false, pull_compensation: 0.3 },
      { match: 'satin',           density: 1.0, angle: 45,  underlay: false, pull_compensation: 0.3 },
      { match: 'running_stitch',  density: 0.5, angle: 0,   underlay: false, pull_compensation: 0.2 },
    ],
  },
];

// ── Apply a preset's rules to a list of regions ───────────────────────────────

export function applyPresetRules(preset, regions) {
  return regions.map(r => {
    const rule = preset.rules?.find(ru => ru.match === r.stitch_type);
    if (!rule) return r;
    const { match, ...overrides } = rule;
    return { ...r, ...overrides };
  });
}

// ── User presets stored in localStorage + backend ─────────────────────────────

const LS_KEY = 'stitchflow_user_presets';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function saveLocal(presets) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(presets)); } catch {}
}

export function useEmbroideryPresets() {
  const [userPresets, setUserPresets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Merge localStorage + backend
    const local = loadLocal();
    setUserPresets(local);
    loadFromBackend(local);
  }, []);

  const loadFromBackend = async (localFallback) => {
    try {
      const data = await base44.entities.Preset.filter({ is_system: false });
      const merged = mergePresets(localFallback, data);
      setUserPresets(merged);
      saveLocal(merged);
    } catch {
      // keep local
    } finally {
      setLoading(false);
    }
  };

  function mergePresets(local, backend) {
    const byId = {};
    for (const p of local) byId[p.id] = p;
    for (const p of backend) byId[p.id] = p; // backend wins
    return Object.values(byId);
  }

  const allPresets = [...FACTORY_PRESETS, ...userPresets];

  const createPreset = async ({ name, icon, notes, rules }) => {
    const newPreset = { id: `user_${Date.now()}`, name, icon: icon || '⚙', notes, rules, is_factory: false };
    const updated = [...userPresets, newPreset];
    setUserPresets(updated);
    saveLocal(updated);
    // Also persist to backend (best-effort)
    try {
      await base44.entities.Preset.create({ name, icon: icon || '⚙', notes, is_system: false });
    } catch {}
    return newPreset;
  };

  const deletePreset = async (id) => {
    const updated = userPresets.filter(p => p.id !== id);
    setUserPresets(updated);
    saveLocal(updated);
    try { await base44.entities.Preset.delete(id); } catch {}
  };

  // Generate share URL (base64-encoded preset)
  const getShareUrl = (preset) => {
    const encoded = btoa(JSON.stringify({ name: preset.name, rules: preset.rules }));
    return `${window.location.origin}${window.location.pathname}?preset=${encoded}`;
  };

  // Load from URL param on init
  const loadFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('preset');
    if (!raw) return null;
    try { return JSON.parse(atob(raw)); } catch { return null; }
  };

  return { allPresets, userPresets, loading, createPreset, deletePreset, getShareUrl, loadFromUrl };
}