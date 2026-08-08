import { createThreadPaletteEntryV2 } from './threadPaletteModel.js';

const issue = (code, path, message) => ({ code, path, message });

export function validateThreadCatalog(catalog) {
  if (!Array.isArray(catalog)) return { valid: false, entries: [], errors: [issue('INVALID_THREAD_CATALOG', 'catalog', 'Thread catalog must be an array.')], warnings: [] };
  const entries = [];
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const hexOwners = new Map();
  catalog.forEach((raw, index) => {
    const path = `catalog[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(issue('INVALID_CATALOG_ENTRY', path, 'Catalog entry must be an object.'));
      return;
    }
    if (typeof raw.id !== 'string' || !raw.id.trim()) errors.push(issue('MISSING_CATALOG_ENTRY_ID', `${path}.id`, 'Catalog entry ID is required.'));
    else if (ids.has(raw.id.trim())) errors.push(issue('DUPLICATE_CATALOG_ENTRY_ID', `${path}.id`, `Duplicate catalog entry ID "${raw.id.trim()}".`));
    else ids.add(raw.id.trim());
    try {
      const entry = createThreadPaletteEntryV2(raw);
      entries.push(entry);
      const owner = hexOwners.get(entry.hex);
      if (owner) warnings.push(issue('DUPLICATE_CATALOG_HEX', `${path}.hex`, `Catalog entries "${owner}" and "${entry.id}" share ${entry.hex}.`));
      else hexOwners.set(entry.hex, entry.id);
    } catch (caught) {
      errors.push(issue(raw?.metadata !== undefined && (raw.metadata === null || typeof raw.metadata !== 'object' || Array.isArray(raw.metadata)) ? 'INVALID_CATALOG_METADATA' : 'INVALID_CATALOG_ENTRY', path, caught.message));
    }
  });
  return { valid: errors.length === 0, entries: entries.sort((a, b) => a.id.localeCompare(b.id)), errors, warnings };
}
