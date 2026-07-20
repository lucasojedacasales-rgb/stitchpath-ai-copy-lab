/**
 * referenceLibrary.js — Reference Embroidery Learning System
 * ─────────────────────────────────────────────────────────────────────────────
 * In-memory storage for analyzed reference files + their metrics, classified
 * blocks, extracted rules, professional score and optional tags.
 *
 * Persisted to localStorage so the library survives reloads (diagnostic mode
 * only — no backend entity yet). Each entry is serializable.
 */

import { referenceLibraryAutoLoad } from '@/lib/emergencyStabilization';

const STORAGE_KEY = 'stitchpath_reference_library_v1';

const TAGS = ['cartoon', 'logo', 'text', 'animal', 'character', 'simple', 'complex'];

/**
 * Adds an analyzed file to the library.
 * @param {object} entry — { filename, format, size, metrics, classifiedBlocks, extractedRules, professionalScore, tags }
 * @returns {object} the saved entry (with id + timestamp)
 */
export function addReference(entry) {
  const lib = listReferences({ manual: true });
  const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    filename: entry.filename,
    format: entry.format,
    size: entry.size,
    metrics: entry.metrics,
    classifiedBlocks: (entry.classifiedBlocks || []).map(b => ({
      blockType: b.blockType, start: b.start, end: b.end, color: b.color,
      features: {
        stitchCount: b.features.stitchCount,
        meanLength: b.features.meanLength,
        widthMm: b.features.widthMm,
        heightMm: b.features.heightMm,
        density: b.features.density,
        rowSpacingMm: b.features.rowSpacingMm,
        rowCount: b.features.rowCount,
      },
    })),
    extractedRules: entry.extractedRules || [],
    professionalScore: entry.professionalScore ?? entry.metrics?.professionalScore ?? 0,
    tags: (entry.tags || []).filter(t => TAGS.includes(t)),
    addedAt: new Date().toISOString(),
  };
  lib.push(record);
  saveLib(lib);
  return record;
}

export function listReferences(options = {}) {
  if (!referenceLibraryAutoLoad && !options.manual) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getReference(id) {
  return listReferences({ manual: true }).find(r => r.id === id);
}

export function removeReference(id) {
  const lib = listReferences({ manual: true }).filter(r => r.id !== id);
  saveLib(lib);
}

export function clearLibrary() {
  saveLib([]);
}

export function updateReferenceTags(id, tags) {
  const lib = listReferences({ manual: true });
  const r = lib.find(x => x.id === id);
  if (r) { r.tags = tags.filter(t => TAGS.includes(t)); saveLib(lib); }
}

function saveLib(lib) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lib)); } catch { /* quota */ }
}

/**
 * Re-extracts rules across all stored references (rules depend on the whole set).
 * Returns the rules without persisting them on each entry.
 * @param {Array<object>} references — from listReferences()
 * @param {Function} extractFn — professionalRuleExtractor.extractProfessionalRules
 * @returns {Array<object>} rules
 */
export function refreshRules(references, extractFn) {
  const files = references.map(r => ({
    filename: r.filename,
    metrics: r.metrics,
    classifiedBlocks: r.classifiedBlocks,
  }));
  return extractFn(files);
}

export const AVAILABLE_TAGS = TAGS;