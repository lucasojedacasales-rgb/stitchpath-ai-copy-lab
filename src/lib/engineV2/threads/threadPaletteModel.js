import { parseHexColor } from './colorScience.js';

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export function createThreadPaletteEntryV2(input = {}) {
  if (typeof input.id !== 'string' || !input.id.trim()) throw new TypeError('Thread palette entry id is required.');
  const parsed = parseHexColor(input.hex);
  if (!parsed.valid) throw new TypeError('Thread palette entry hex must be a valid #RGB or #RRGGBB color.');
  if (input.metadata !== undefined && (input.metadata === null || typeof input.metadata !== 'object' || Array.isArray(input.metadata))) throw new TypeError('Thread palette entry metadata must be an object.');
  return freeze({
    id: input.id.trim(),
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : input.id.trim(),
    hex: parsed.normalizedHex,
    manufacturer: input.manufacturer ?? null,
    code: input.code ?? null,
    source: clone(input.source ?? null),
    metadata: clone(input.metadata ?? {}),
  });
}

export function createExactArtworkPaletteEntry(value) {
  const parsed = parseHexColor(value);
  if (!parsed.valid) throw new TypeError('Exact artwork palette entries require a valid color.');
  const code = parsed.normalizedHex.slice(1);
  return createThreadPaletteEntryV2({ id: `artwork:${code}`, name: `Artwork ${parsed.normalizedHex}`, hex: parsed.normalizedHex, manufacturer: null, code: null, source: 'artwork_exact', metadata: { physicalSpoolAvailabilityVerified: false } });
}
