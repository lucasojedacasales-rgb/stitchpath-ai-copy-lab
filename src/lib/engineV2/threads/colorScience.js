const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const D65 = Object.freeze({ x: 95.047, y: 100, z: 108.883 });

export function parseHexColor(value) {
  if (typeof value !== 'string') return { valid: false, normalizedHex: null, rgb: null, error: 'Color must be a HEX string.' };
  const match = value.trim().match(HEX_PATTERN);
  if (!match) return { valid: false, normalizedHex: null, rgb: null, error: 'Color must use #RGB or #RRGGBB notation.' };
  const expanded = match[1].length === 3 ? [...match[1]].map(character => character.repeat(2)).join('') : match[1];
  const normalizedHex = `#${expanded.toUpperCase()}`;
  return {
    valid: true,
    normalizedHex,
    rgb: {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
    },
    error: null,
  };
}

export function rgbToLinearRgb(rgb) {
  const convert = value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return { r: convert(rgb.r), g: convert(rgb.g), b: convert(rgb.b) };
}

export function linearRgbToXyz(rgb) {
  return {
    x: (rgb.r * 0.4124564 + rgb.g * 0.3575761 + rgb.b * 0.1804375) * 100,
    y: (rgb.r * 0.2126729 + rgb.g * 0.7151522 + rgb.b * 0.072175) * 100,
    z: (rgb.r * 0.0193339 + rgb.g * 0.119192 + rgb.b * 0.9503041) * 100,
  };
}

export function xyzToLab(xyz) {
  const transform = value => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
  const x = transform(xyz.x / D65.x);
  const y = transform(xyz.y / D65.y);
  const z = transform(xyz.z / D65.z);
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

export function rgbToLab(rgb) {
  return xyzToLab(linearRgbToXyz(rgbToLinearRgb(rgb)));
}

export function hexToLab(value) {
  const parsed = parseHexColor(value);
  return parsed.valid ? { valid: true, lab: rgbToLab(parsed.rgb), normalizedHex: parsed.normalizedHex, error: null } : { valid: false, lab: null, normalizedHex: null, error: parsed.error };
}

export function deltaE76(left, right) {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
}

const radians = degrees => degrees * Math.PI / 180;
const degrees = radiansValue => radiansValue * 180 / Math.PI;

export function deltaE2000(left, right) {
  const averageL = (left.l + right.l) / 2;
  const c1 = Math.hypot(left.a, left.b);
  const c2 = Math.hypot(right.a, right.b);
  const averageC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt((averageC ** 7) / (averageC ** 7 + 25 ** 7)));
  const a1 = (1 + g) * left.a;
  const a2 = (1 + g) * right.a;
  const adjustedC1 = Math.hypot(a1, left.b);
  const adjustedC2 = Math.hypot(a2, right.b);
  const hue = (a, b) => {
    const value = degrees(Math.atan2(b, a));
    return value < 0 ? value + 360 : value;
  };
  const h1 = adjustedC1 === 0 ? 0 : hue(a1, left.b);
  const h2 = adjustedC2 === 0 ? 0 : hue(a2, right.b);
  const deltaL = right.l - left.l;
  const deltaC = adjustedC2 - adjustedC1;
  let deltaHue = h2 - h1;
  if (adjustedC1 * adjustedC2 === 0) deltaHue = 0;
  else if (deltaHue > 180) deltaHue -= 360;
  else if (deltaHue < -180) deltaHue += 360;
  const deltaH = 2 * Math.sqrt(adjustedC1 * adjustedC2) * Math.sin(radians(deltaHue / 2));
  const meanL = (left.l + right.l) / 2;
  const meanC = (adjustedC1 + adjustedC2) / 2;
  let meanHue = h1 + h2;
  if (adjustedC1 * adjustedC2 === 0) meanHue = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) meanHue /= 2;
  else if (meanHue < 360) meanHue = (meanHue + 360) / 2;
  else meanHue = (meanHue - 360) / 2;
  const t = 1 - 0.17 * Math.cos(radians(meanHue - 30)) + 0.24 * Math.cos(radians(2 * meanHue)) + 0.32 * Math.cos(radians(3 * meanHue + 6)) - 0.2 * Math.cos(radians(4 * meanHue - 63));
  const deltaTheta = 30 * Math.exp(-(((meanHue - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt((meanC ** 7) / (meanC ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * ((meanL - 50) ** 2)) / Math.sqrt(20 + ((meanL - 50) ** 2));
  const sc = 1 + 0.045 * meanC;
  const sh = 1 + 0.015 * meanC * t;
  const rt = -Math.sin(radians(2 * deltaTheta)) * rc;
  const l = deltaL / sl;
  const c = deltaC / sc;
  const h = deltaH / sh;
  return Math.sqrt(l ** 2 + c ** 2 + h ** 2 + rt * c * h);
}

export function determineColorFamily(value) {
  const parsed = parseHexColor(value);
  if (!parsed.valid) return 'unknown';
  const { r, g, b } = parsed.rgb;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (lightness <= 0.1) return 'black';
  if (lightness >= 0.92 && saturation <= 0.2) return 'white';
  if (saturation <= 0.12) return 'gray';
  let hue;
  if (max === r / 255) hue = 60 * (((g - b) / 255 / delta) % 6);
  else if (max === g / 255) hue = 60 * ((b - r) / 255 / delta + 2);
  else hue = 60 * ((r - g) / 255 / delta + 4);
  if (hue < 0) hue += 360;
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return lightness < 0.38 ? 'brown' : 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 195) return 'cyan';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  if (hue < 345) return 'magenta';
  return 'unknown';
}
