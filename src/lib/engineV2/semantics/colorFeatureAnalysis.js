export const DEFAULT_ARTWORK_COLOR_THRESHOLDS = Object.freeze({
  veryDarkLuminance: 0.10,
  darkLuminance: 0.22,
  lightLuminance: 0.78,
  veryLightLuminance: 0.90,
  neutralSaturation: 0.12,
});

function invalid(message) {
  return {
    valid: false,
    normalizedHex: null,
    red: null,
    green: null,
    blue: null,
    luminance: null,
    saturation: null,
    hue: null,
    chroma: null,
    isDark: false,
    isVeryDark: false,
    isLight: false,
    isVeryLight: false,
    isNeutral: false,
    isChromatic: false,
    errors: [{ code: 'INVALID_ARTWORK_COLOR', path: 'visualColor', message }],
  };
}

function linearChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function analyzeArtworkColor(visualColor, options = {}) {
  if (typeof visualColor !== 'string') return invalid('Artwork color must be a #RGB or #RRGGBB string.');
  const trimmed = visualColor.trim();
  if (!/^#[0-9a-f]{3}$/i.test(trimmed) && !/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return invalid('Artwork color must use valid #RGB or #RRGGBB hexadecimal notation.');
  }
  const expanded = trimmed.length === 4
    ? `#${trimmed.slice(1).split('').map(value => value + value).join('')}`
    : trimmed;
  const normalizedHex = expanded.toLowerCase();
  const red = Number.parseInt(normalizedHex.slice(1, 3), 16);
  const green = Number.parseInt(normalizedHex.slice(3, 5), 16);
  const blue = Number.parseInt(normalizedHex.slice(5, 7), 16);
  const channels = [red / 255, green / 255, blue / 255];
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (chroma > 0) {
    if (max === channels[0]) hue = ((channels[1] - channels[2]) / chroma) % 6;
    else if (max === channels[1]) hue = (channels[2] - channels[0]) / chroma + 2;
    else hue = (channels[0] - channels[1]) / chroma + 4;
    hue = ((hue * 60) + 360) % 360;
  }
  const luminance = 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
  const thresholds = { ...DEFAULT_ARTWORK_COLOR_THRESHOLDS, ...options };
  return {
    valid: true,
    normalizedHex,
    red,
    green,
    blue,
    luminance,
    saturation,
    hue,
    chroma,
    isDark: luminance <= thresholds.darkLuminance,
    isVeryDark: luminance <= thresholds.veryDarkLuminance,
    isLight: luminance >= thresholds.lightLuminance,
    isVeryLight: luminance >= thresholds.veryLightLuminance,
    isNeutral: saturation <= thresholds.neutralSaturation,
    isChromatic: saturation > thresholds.neutralSaturation,
    errors: [],
  };
}
