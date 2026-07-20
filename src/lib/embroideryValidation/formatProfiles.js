export const DST_PROFILE = {
  id: 'dst', label: 'DST', maxDeltaMm: 12.1, maxFileBytes: 8_000_000, supportsTrim: true, supportsColorChange: true,
};

export const DSB_PROFILE = {
  id: 'dsb', label: 'DSB', maxDeltaMm: 12.1, maxFileBytes: 8_000_000, supportsTrim: true, supportsColorChange: true,
};

export const PES_PROFILE = { id: 'pes', label: 'PES', future: true, maxDeltaMm: 12.1, maxFileBytes: 12_000_000, supportsTrim: true, supportsColorChange: true };
export const JEF_PROFILE = { id: 'jef', label: 'JEF', future: true, maxDeltaMm: 12.1, maxFileBytes: 8_000_000, supportsTrim: true, supportsColorChange: true };
export const EXP_PROFILE = { id: 'exp', label: 'EXP', future: true, maxDeltaMm: 12.1, maxFileBytes: 8_000_000, supportsTrim: true, supportsColorChange: true };

export const FORMAT_PROFILES = {
  DST: DST_PROFILE,
  DSB: DSB_PROFILE,
  PES: PES_PROFILE,
  JEF: JEF_PROFILE,
  EXP: EXP_PROFILE,
};

export function getFormatProfile(format = 'DST') {
  return FORMAT_PROFILES[String(format).toUpperCase()] || DST_PROFILE;
}