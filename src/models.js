// Forecast models offered on the map. Data: Open-Meteo open data files (one file per hour,
// whole model grid, read in pieces). `grid` is the model's regular lat/lon grid.
// `bar` is the colour stripe shown in the model list (by resolution, like the original).
const GFS_DY = 0.11714935;

export const MODELS = [
  { id: 'gdps', name: 'GDPS 15 km', region: 'World', domain: 'cmc_gem_gdps', bar: '#79e3f6',
    grid: { nx: 2400, ny: 1201, latMin: -90, lonMin: -180, dx: 0.15, dy: 0.15 } },
  { id: 'gfs', name: 'GFS 13 km', region: 'World', domain: 'ncep_gfs013', bar: '#79e3f6',
    grid: { nx: 3072, ny: 1536, latMin: (-GFS_DY * 1535) / 2, lonMin: -180, dx: 360 / 3072, dy: GFS_DY } },
  { id: 'icon13', name: 'ICON 13 km', region: 'World', domain: 'dwd_icon', bar: '#79e3f6',
    grid: { nx: 2879, ny: 1441, latMin: -90, lonMin: -180, dx: 0.125, dy: 0.125 } },
  { id: 'ifs', name: 'IFS 25 km', region: 'World', domain: 'ecmwf_ifs025', bar: '#79e3f6',
    grid: { nx: 1440, ny: 721, latMin: -90, lonMin: -180, dx: 0.25, dy: 0.25 } },
  { id: 'ukmo', name: 'UKMO 10 km', region: 'World', domain: 'ukmo_global_deterministic_10km', bar: '#5fe35f',
    grid: { nx: 2560, ny: 1920, latMin: -90, lonMin: -180, dx: 360 / 2560, dy: 180 / 1920 } },
  { id: 'arpege', name: 'ARPEGE 11 km', region: 'Europe', domain: 'meteofrance_arpege_europe', bar: '#5fe35f',
    grid: { nx: 741, ny: 521, latMin: 20, lonMin: -32, dx: 0.1, dy: 0.1 } },
  { id: 'icon7', name: 'ICON 7 km', region: 'Europe', domain: 'dwd_icon_eu', bar: '#5fe35f',
    grid: { nx: 1377, ny: 657, latMin: 29.5, lonMin: -23.5, dx: 0.0625, dy: 0.0625 } },
  { id: 'arome25', name: 'AROME-FR 2.5 km', region: 'France', domain: 'meteofrance_arome_france0025', bar: '#f6c443',
    grid: { nx: 1121, ny: 717, latMin: 37.5, lonMin: -12, dx: 0.025, dy: 0.025 } },
  { id: 'icond2', name: 'ICON 2.2', region: 'Germany+', domain: 'dwd_icon_d2', bar: '#f6a743',
    grid: { nx: 1215, ny: 746, latMin: 43.18, lonMin: -3.94, dx: 0.02, dy: 0.02 } },
  { id: 'icon2i', name: 'ICON-2I 2.2 km', region: 'Italy', domain: 'italia_meteo_arpae_icon_2i', bar: '#f6a743',
    grid: { nx: 761, ny: 761, latMin: 33.7, lonMin: 3, dx: 0.025, dy: 0.02 } },
  { id: 'arome13', name: 'AROME-FR 1.3 km', region: 'France+', domain: 'meteofrance_arome_france_hd', bar: '#f0624d',
    grid: { nx: 2801, ny: 1791, latMin: 37.5, lonMin: -12, dx: 0.01, dy: 0.01 }, fallback: 'arome25' },
];

export const DEFAULT_MODEL = 'arome13';

export function modelById(id) {
  return MODELS.find((m) => m.id === id) || MODELS.find((m) => m.id === DEFAULT_MODEL);
}

// Map parameters (what the colours show).
export const PARAMS = [
  { id: 'wind', label: 'Vent', icon: 'wind' },
  { id: 'gust', label: 'Rafales', icon: 'gust' },
];

// Wind colour gradient in knots → [r,g,b,a], matched to the person's reference picture of the
// original: see-through in light wind, then white → cyan → bright green → yellow → orange →
// red → pink → purple, blended smoothly between the stops.
export const SCALE = [
  [0, [255, 255, 255, 0]],
  [3, [255, 255, 255, 0.08]],
  [5, [235, 255, 255, 0.55]],
  [7, [175, 250, 250, 0.85]],
  [9, [100, 240, 240, 0.92]],
  [11, [60, 238, 205, 0.93]],
  [13, [20, 240, 110, 0.93]],
  [15, [10, 245, 40, 0.94]],
  [17, [110, 240, 10, 0.94]],
  [19, [195, 238, 0, 0.94]],
  [21, [255, 228, 0, 0.94]],
  [24, [255, 165, 0, 0.94]],
  [27, [255, 95, 30, 0.94]],
  [30, [255, 45, 60, 0.94]],
  [34, [255, 30, 150, 0.94]],
  [40, [225, 30, 220, 0.94]],
  [48, [150, 40, 220, 0.94]],
  [60, [90, 20, 170, 0.94]],
];

// 0..80 kn lookup table, 4 steps per knot
const LUT = (() => {
  const out = new Uint8ClampedArray(321 * 4);
  for (let i = 0; i <= 320; i++) {
    const c = colorAt(i / 4);
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = Math.round(c[3] * 255);
  }
  return out;
})();

function colorAt(kn) {
  if (kn >= SCALE[SCALE.length - 1][0]) return SCALE[SCALE.length - 1][1];
  for (let i = 1; i < SCALE.length; i++) {
    const [k1, c1] = SCALE[i];
    if (kn <= k1) {
      const [k0, c0] = SCALE[i - 1];
      const t = (kn - k0) / (k1 - k0);
      return c0.map((v, j) => v + (c1[j] - v) * t);
    }
  }
  return [0, 0, 0, 0];
}

// Writes the colour for `kn` into `out` at byte offset `o` (transparent when no data).
export function putColor(out, o, kn) {
  if (!(kn >= 0)) {
    out[o + 3] = 0;
    return;
  }
  const i = Math.min(320, Math.round(kn * 4)) * 4;
  out[o] = LUT[i];
  out[o + 1] = LUT[i + 1];
  out[o + 2] = LUT[i + 2];
  out[o + 3] = LUT[i + 3];
}

export const UNITS = {
  kn: { label: 'nœuds', short: 'kn', f: 1 },
  ms: { label: 'm/s', short: 'm/s', f: 0.514444 },
  kmh: { label: 'km/h', short: 'km/h', f: 1.852 },
  bft: { label: 'Beaufort', short: 'Bft', f: null },
};

export function fmtSpeed(kn, unit) {
  const u = UNITS[unit] || UNITS.kn;
  if (unit === 'bft') {
    const lim = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
    let b = 0;
    while (b < lim.length && kn >= lim[b]) b++;
    return `${b} Bft`;
  }
  const v = kn * u.f;
  return `${v < 10 && unit === 'ms' ? v.toFixed(1) : Math.round(v)} ${u.short}`;
}

// "9 nœuds", "4.6 m/s", "17 km/h", "3 Beaufort"
export function fmtSpeedLong(kn, unit) {
  const s = fmtSpeed(kn, unit);
  if (unit === 'bft') return s.replace('Bft', 'Beaufort');
  if (unit === 'ms' || unit === 'kmh') return s;
  return s.replace(' kn', ' nœuds');
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
export function dirName(deg) {
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
