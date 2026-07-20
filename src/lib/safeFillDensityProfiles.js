const DEFAULT_REQUESTED_FILL_SPACING_MM = 0.4;
const LEGACY_SAFE_FILL_NEEDLE_PITCH_MM = 4.0;

const SAFE_FILL_DENSITY_PROFILES = {
  ce01_safe_dense: {
    profileId: 'ce01_safe_dense',
    densityMode: 'physical_row_spacing_mm',
    maxVisibleStitchMm: 3.0,
    minNeedlePitchMm: 2.0,
    bands: [
      { minAreaMm2: 800, label: 'very_large', min: 0.12, preferred: 0.16, max: 0.22, pitch: 2.4 },
      { minAreaMm2: 350, label: 'large', min: 0.16, preferred: 0.20, max: 0.26, pitch: 2.4 },
      { minAreaMm2: 120, label: 'medium', min: 0.22, preferred: 0.28, max: 0.35, pitch: 2.6 },
      { minAreaMm2: 0, label: 'small', min: 0.30, preferred: 0.36, max: 0.45, pitch: 2.8 },
    ],
  },
  generic_dst_safe: {
    profileId: 'generic_dst_safe',
    densityMode: 'generic_dst_safe_spacing_mm',
    maxVisibleStitchMm: 3.0,
    minNeedlePitchMm: 2.4,
    bands: [
      { minAreaMm2: 800, label: 'very_large', min: 0.35, preferred: 0.45, max: 0.60, pitch: 3.0 },
      { minAreaMm2: 350, label: 'large', min: 0.38, preferred: 0.48, max: 0.65, pitch: 3.0 },
      { minAreaMm2: 120, label: 'medium', min: 0.42, preferred: 0.55, max: 0.72, pitch: 3.0 },
      { minAreaMm2: 0, label: 'small', min: 0.50, preferred: 0.62, max: 0.80, pitch: 3.0 },
    ],
  },
  high_density_preview: {
    profileId: 'high_density_preview',
    densityMode: 'explicit_high_density_preview_spacing_mm',
    maxVisibleStitchMm: 2.8,
    minNeedlePitchMm: 1.8,
    bands: [
      { minAreaMm2: 800, label: 'very_large', min: 0.12, preferred: 0.14, max: 0.18, pitch: 2.0 },
      { minAreaMm2: 350, label: 'large', min: 0.12, preferred: 0.16, max: 0.22, pitch: 2.1 },
      { minAreaMm2: 120, label: 'medium', min: 0.16, preferred: 0.22, max: 0.30, pitch: 2.3 },
      { minAreaMm2: 0, label: 'small', min: 0.24, preferred: 0.30, max: 0.40, pitch: 2.5 },
    ],
  },
};

function roundMm(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : value;
}

function clampValue(value, min, max) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, safe));
}

function firstFiniteNumber(values = []) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function polygonAreaAbs(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    area += (Number(a[0]) || 0) * (Number(b[1]) || 0) - (Number(b[0]) || 0) * (Number(a[1]) || 0);
  }
  return Math.abs(area) / 2;
}

function includesMachineToken(value, tokens = []) {
  const text = String(value || '').toLowerCase();
  return text.length > 0 && tokens.some(token => text.includes(token));
}

function explicitProfileId(machineSettings = {}, config = {}) {
  const candidates = [
    config.safeFillDensityProfileId,
    config.safeFillDensityProfile,
    config.safeFillDensityMode,
    machineSettings.safeFillDensityProfileId,
    machineSettings.safeFillDensityProfile,
    machineSettings.safeFillDensityMode,
  ];
  return candidates.find(value => typeof value === 'string' && value.trim())?.trim() || null;
}

function highDensityPreviewEnabled(machineSettings = {}, config = {}) {
  const explicit = explicitProfileId(machineSettings, config);
  return explicit === 'high_density_preview' ||
    config.highDensityPreview === true ||
    config.safeFillHighDensityPreview === true ||
    machineSettings.highDensityPreview === true ||
    machineSettings.safeFillHighDensityPreview === true;
}

function ce01Requested(machineSettings = {}, config = {}) {
  const explicit = explicitProfileId(machineSettings, config);
  if (explicit === 'ce01_safe_dense') return true;
  if (config.ce01SafeFillMode === true || config.ce01ProductionMode === true || config.validationMode === 'ce01_strict') return true;
  const candidates = [
    config.machineProfile,
    config.machineProfileId,
    config.machine,
    machineSettings.machineProfile,
    machineSettings.machineProfileId,
    machineSettings.profileId,
    machineSettings.profile,
    machineSettings.model,
    machineSettings.name,
    machineSettings.id,
    machineSettings.machine,
  ];
  return candidates.some(value => includesMachineToken(value, ['ce01', 'caydo']));
}

function resolveProfile(machineSettings = {}, config = {}) {
  if (highDensityPreviewEnabled(machineSettings, config)) return SAFE_FILL_DENSITY_PROFILES.high_density_preview;
  if (ce01Requested(machineSettings, config)) return SAFE_FILL_DENSITY_PROFILES.ce01_safe_dense;
  const explicit = explicitProfileId(machineSettings, config);
  return SAFE_FILL_DENSITY_PROFILES[explicit] || SAFE_FILL_DENSITY_PROFILES.generic_dst_safe;
}

function requestedFillSpacing(regionOrObject = {}, config = {}) {
  const rawRegion = regionOrObject.rawRegion || {};
  const direct = firstFiniteNumber([
    regionOrObject.fillSpacingMm,
    regionOrObject.fill_spacing_mm,
    regionOrObject.fillSpacing,
    regionOrObject.density_mm,
    regionOrObject.density,
    rawRegion.fillSpacingMm,
    rawRegion.fill_spacing_mm,
    rawRegion.density_mm,
    rawRegion.density,
    config.fillSpacingMm,
    config.learnedFillDensityMm,
    config.tatami_density,
    config.density,
  ]);
  const n = direct ?? DEFAULT_REQUESTED_FILL_SPACING_MM;

  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REQUESTED_FILL_SPACING_MM;
  if (n > 0.8) return clampValue(DEFAULT_REQUESTED_FILL_SPACING_MM / n, 0.12, 0.8);
  return n;
}

function areaForRegion(regionOrObject = {}) {
  const area = firstFiniteNumber([
    regionOrObject.area_mm2,
    regionOrObject.areaMm2,
    regionOrObject.rawRegion?.area_mm2,
    regionOrObject.rawRegion?.areaMm2,
  ]);
  if (area != null) return area;
  return polygonAreaAbs(regionOrObject.points || regionOrObject.path_points || regionOrObject.rawRegion?.path_points || []);
}

function densityBandForArea(profile, areaMm2) {
  return [...profile.bands].sort((a, b) => b.minAreaMm2 - a.minAreaMm2)
    .find(band => areaMm2 >= band.minAreaMm2) || profile.bands[profile.bands.length - 1];
}

function legacySpacingForIncreaseEstimate(spacingMm) {
  return Math.max(0.35, Math.min(0.8, Number.isFinite(spacingMm) ? spacingMm : 0.45));
}

export function resolveSafeFillDensityProfile(machineSettings = {}, config = {}, regionOrObject = {}) {
  const profile = resolveProfile(machineSettings, config);
  const requestedFillSpacingMm = requestedFillSpacing(regionOrObject, config);
  const areaMm2 = areaForRegion(regionOrObject);
  const band = densityBandForArea(profile, areaMm2);

  let rowSpacingMm = requestedFillSpacingMm;
  if (rowSpacingMm > band.max) rowSpacingMm = band.preferred;
  if (rowSpacingMm < band.min) rowSpacingMm = band.min;
  rowSpacingMm = clampValue(rowSpacingMm, band.min, band.max);

  const machineMax = Number(machineSettings.maxStitchLength);
  const maxVisibleStitchMm = clampValue(
    Math.min(profile.maxVisibleStitchMm, Number.isFinite(machineMax) && machineMax > 0 ? machineMax : profile.maxVisibleStitchMm),
    1.0,
    profile.maxVisibleStitchMm
  );
  const needlePitchMm = clampValue(
    Math.min(band.pitch, maxVisibleStitchMm),
    profile.minNeedlePitchMm,
    maxVisibleStitchMm
  );
  const spacingClampApplied = Math.abs(rowSpacingMm - requestedFillSpacingMm) > 0.0001;
  const oldSpacing = legacySpacingForIncreaseEstimate(requestedFillSpacingMm);
  const estimatedStitchIncreaseFactor = (oldSpacing * LEGACY_SAFE_FILL_NEEDLE_PITCH_MM) / Math.max(0.001, rowSpacingMm * needlePitchMm);
  const estimatedTargetDensity = 1 / Math.max(0.001, rowSpacingMm * needlePitchMm);

  return {
    profileId: profile.profileId,
    rowSpacingMm: roundMm(rowSpacingMm),
    needlePitchMm: roundMm(needlePitchMm),
    maxVisibleStitchMm: roundMm(maxVisibleStitchMm),
    densityMode: profile.densityMode,
    estimatedTargetDensity: roundMm(estimatedTargetDensity),
    spacingClampApplied,
    requestedFillSpacingMm: roundMm(requestedFillSpacingMm),
    estimatedStitchIncreaseFactor: roundMm(estimatedStitchIncreaseFactor),
    areaMm2: roundMm(areaMm2),
    areaBand: band.label,
    calibrationApplied: spacingClampApplied || Math.abs(needlePitchMm - LEGACY_SAFE_FILL_NEEDLE_PITCH_MM) > 0.0001,
    effectiveFillSpacingMm: roundMm(rowSpacingMm),
    effectiveNeedlePitchMm: roundMm(needlePitchMm),
  };
}