import { useState, useMemo } from 'react';
import { ChevronDown, Share2, Plus, Trash2, Check, X, Copy } from 'lucide-react';
import { useEmbroideryPresets, applyPresetRules, FACTORY_PRESETS } from '@/hooks/useEmbroideryPresets';

// ── Diff preview ──────────────────────────────────────────────────────────────

function DiffPreview({ preset, regions }) {
  if (!preset || !regions?.length) return null;

  const FIELDS = ['density', 'angle', 'underlay', 'pull_compensation', 'stitch_type'];
  const changes = [];

  for (const r of regions.slice(0, 6)) {
    const rule = preset.rules?.find(ru => ru.match === r.stitch_type);
    if (!rule) continue;
    const diffs = FIELDS.filter(f => rule[f] !== undefined && rule[f] !== r[f]);
    if (diffs.length) changes.push({ name: r.name || r.id, diffs: diffs.map(f => ({ field: f, from: r[f], to: rule[f] })) });
  }

  if (!changes.length) return (
    <div className="text-[10px] text-slate-500 italic px-3 py-2">Sin cambios en las regiones seleccionadas.</div>
  );

  return (
    <div className="px-3 pb-2 space-y-1 max-h-36 overflow-y-auto">
      {changes.map((c, i) => (
        <div key={i} className="text-[10px] rounded bg-[#0a0c12] border border-[#1e2130] px-2 py-1.5">
          <div className="text-slate-300 font-medium truncate mb-0.5">{c.name}</div>
          {c.diffs.map((d, j) => (
            <div key={j} className="flex items-center gap-1 text-slate-500">
              <span className="text-slate-600">{d.field}:</span>
              <span className="text-red-400 line-through">{String(d.from)}</span>
              <span className="text-slate-500">→</span>
              <span className="text-emerald-400">{String(d.to)}</span>
            </div>
          ))}
        </div>
      ))}
      {regions.length > 6 && (
        <div className="text-[10px] text-slate-600 italic">…y {regions.length - 6} más</div>
      )}
    </div>
  );
}

// ── Save form ─────────────────────────────────────────────────────────────────

function SaveForm({ regions, onSave, onCancel }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('⚙');
  const [notes, setNotes] = useState('');

  // Build rules from current region distribution
  const deriveRules = () => {
    const byType = {};
    for (const r of regions) {
      if (!byType[r.stitch_type]) byType[r.stitch_type] = [];
      byType[r.stitch_type].push(r);
    }
    return Object.entries(byType).map(([type, rs]) => {
      const avg = (key) => rs.reduce((s, r) => s + (r[key] || 0), 0) / rs.length;
      return {
        match: type,
        density: Math.round(avg('density') * 10) / 10,
        angle: Math.round(avg('angle')),
        underlay: rs.filter(r => r.underlay).length > rs.length / 2,
        pull_compensation: Math.round(avg('pull_compensation') * 100) / 100,
      };
    });
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), icon, notes, rules: deriveRules() });
  };

  return (
    <div className="mx-3 mb-3 p-3 rounded-lg bg-[#0d0f14] border border-violet-500/30 space-y-2">
      <div className="text-[11px] font-bold text-violet-300 uppercase tracking-wider">Guardar estado actual</div>
      <div className="flex gap-2">
        <input value={icon} onChange={e => setIcon(e.target.value)} placeholder="🎨"
          className="w-10 bg-[#161a23] border border-[#2a2d3a] rounded px-2 py-1.5 text-xs text-center focus:outline-none focus:border-violet-500" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del preset"
          className="flex-1 bg-[#161a23] border border-[#2a2d3a] rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
      </div>
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Descripción (opcional)"
        className="w-full bg-[#161a23] border border-[#2a2d3a] rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
      <div className="flex gap-2">
        <button onClick={handleSave} className="flex-1 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors">Guardar</button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded border border-[#2a2d3a] text-slate-500 text-xs hover:text-white transition-colors"><X className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

// ── Preset card ───────────────────────────────────────────────────────────────

function PresetCard({ preset, onApplyAll, onApplySelected, onDelete, onShare, selectedCount }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleShare = () => {
    const url = onShare(preset);
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="border border-[#1e2130] rounded-lg bg-[#0a0c12] overflow-hidden hover:border-[#2a2d3a] transition-colors">
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-base flex-shrink-0">{preset.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-200 truncate">{preset.name}</span>
            {preset.is_factory && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-500/20 flex-shrink-0">Fábrica</span>}
          </div>
          {preset.description && <p className="text-[10px] text-slate-600 truncate">{preset.description}</p>}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {!preset.is_factory && (
            <button onClick={handleShare} title="Copiar enlace" className="p-1 rounded hover:bg-[#2a2d3a] text-slate-600 hover:text-cyan-400 transition-colors">
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Share2 className="w-3 h-3" />}
            </button>
          )}
          {!preset.is_factory && (
            <button onClick={() => onDelete(preset.id)} title="Eliminar" className="p-1 rounded hover:bg-red-900/20 text-slate-600 hover:text-red-400 transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => setExpanded(e => !e)} className="p-1 rounded hover:bg-[#2a2d3a] text-slate-600 hover:text-slate-300 transition-colors">
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Rules summary */}
      {expanded && (
        <div className="border-t border-[#1e2130] px-3 py-2 space-y-1">
          {(preset.rules || []).map((rule, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px] text-slate-500">
              <span className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${rule.match === 'fill' ? 'badge-fill' : rule.match === 'satin' ? 'badge-satin' : 'badge-run'}`}>
                {rule.match === 'running_stitch' ? 'run' : rule.match}
              </span>
              {rule.stitch_type && rule.stitch_type !== rule.match && <span className="text-amber-400">→{rule.stitch_type}</span>}
              <span>d:{rule.density}</span>
              <span>{rule.angle}°</span>
              {rule.underlay && <span className="text-violet-400">UL</span>}
            </div>
          ))}
        </div>
      )}

      {/* Apply buttons */}
      <div className="border-t border-[#1e2130] flex">
        <button
          onClick={() => onApplyAll(preset)}
          className="flex-1 py-1.5 text-[11px] text-slate-400 hover:text-white hover:bg-violet-900/20 transition-colors"
        >
          Aplicar a todo
        </button>
        {selectedCount > 0 && (
          <>
            <div className="w-px bg-[#1e2130]" />
            <button
              onClick={() => onApplySelected(preset)}
              className="flex-1 py-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/10 transition-colors"
            >
              Aplicar a {selectedCount} sel.
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WorkflowPresetPanel({ regions, selectedRegionIds = [], onRegionsUpdate }) {
  const { allPresets, userPresets, createPreset, deletePreset, getShareUrl } = useEmbroideryPresets();
  const [showSave, setShowSave] = useState(false);
  const [previewPreset, setPreviewPreset] = useState(null);
  const [tab, setTab] = useState('factory'); // 'factory' | 'user'

  const factoryPresets = allPresets.filter(p => p.is_factory);
  const myPresets = allPresets.filter(p => !p.is_factory);

  const handleApplyAll = (preset) => {
    const updated = applyPresetRules(preset, regions);
    onRegionsUpdate(updated);
  };

  const handleApplySelected = (preset) => {
    const ids = new Set(selectedRegionIds);
    const updated = regions.map(r => {
      if (!ids.has(r.id)) return r;
      const rule = preset.rules?.find(ru => ru.match === r.stitch_type);
      if (!rule) return r;
      const { match, ...overrides } = rule;
      return { ...r, ...overrides };
    });
    onRegionsUpdate(updated);
  };

  const handleSave = async (form) => {
    await createPreset(form);
    setShowSave(false);
  };

  const displayPresets = tab === 'factory' ? factoryPresets : myPresets;

  return (
    <div className="space-y-2">
      {/* Tab toggle */}
      <div className="flex rounded-lg overflow-hidden border border-[#2a2d3a]">
        {[['factory', 'Fábrica'], ['user', `Mis presets (${myPresets.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${tab === id ? 'bg-violet-600/30 text-violet-300' : 'text-slate-500 hover:text-slate-300 bg-transparent'}`}
          >{label}</button>
        ))}
      </div>

      {/* Preset cards */}
      <div className="space-y-2">
        {displayPresets.length === 0 && (
          <div className="text-[11px] text-slate-600 text-center py-4">
            {tab === 'user' ? 'Aún no tienes presets guardados' : 'No hay presets'}
          </div>
        )}
        {displayPresets.map(preset => (
          <PresetCard
            key={preset.id}
            preset={preset}
            selectedCount={selectedRegionIds.length}
            onApplyAll={handleApplyAll}
            onApplySelected={handleApplySelected}
            onDelete={deletePreset}
            onShare={getShareUrl}
          />
        ))}
      </div>

      {/* Save current state */}
      {tab === 'user' && !showSave && (
        <button
          onClick={() => setShowSave(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-[#2a2d3a] text-slate-500 hover:text-violet-400 hover:border-violet-500/40 transition-colors text-xs"
        >
          <Plus className="w-3 h-3" /> Guardar estado actual
        </button>
      )}
      {tab === 'user' && showSave && (
        <SaveForm regions={regions} onSave={handleSave} onCancel={() => setShowSave(false)} />
      )}
    </div>
  );
}