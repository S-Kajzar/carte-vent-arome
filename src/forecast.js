// Reads model wind fields from Open-Meteo's open data files (one file per forecast hour,
// covering the whole model grid). Only the part of the grid around the view is downloaded.
import { OmHttpBackendPool, LruBlockCache, OmDataType } from '@openmeteo/file-reader';
import { MODELS } from './models.js';

const BASE = 'https://openmeteo.s3.amazonaws.com/data_spatial/';
const KN = 1.943844; // m/s → knots
const MAX_CELLS = 600000; // most grid cells read for one view
const CHUNK = 32; // the files store the grid in 32×32 blocks

const blockCache = new LruBlockCache(64 * 1024, 768);
const pool = new OmHttpBackendPool({ backendOptions: { retries: 2, eTagValidation: false }, maxBackends: 48 });
const metaCache = new Map();
const fieldCache = new Map();

const pad = (n) => String(n).padStart(2, '0');

// Model run information: reference time and the hours it covers.
export async function getMeta(model, force = false) {
  const hit = metaCache.get(model.domain);
  if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.meta;
  const res = await fetch(`${BASE}${model.domain}/latest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`meta ${res.status}`);
  const j = await res.json();
  const meta = {
    run: Date.parse(j.reference_time),
    times: j.valid_times.map((t) => Date.parse(t)),
    variables: j.variables || [],
  };
  metaCache.set(model.domain, { at: Date.now(), meta });
  return meta;
}

function fileUrl(model, meta, t) {
  const r = new Date(meta.run);
  const v = new Date(t);
  return (
    `${BASE}${model.domain}/${r.getUTCFullYear()}/${pad(r.getUTCMonth() + 1)}/${pad(r.getUTCDate())}/${pad(r.getUTCHours())}00Z/` +
    `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}T${pad(v.getUTCHours())}00.om`
  );
}

// Grid rows/columns needed for the view (with a margin), snapped to the file's blocks.
// Returns null when the model doesn't cover the view, or {tooBig} when it is too large to read.
export function windowFor(model, view) {
  const g = model.grid;
  const padX = (view.east - view.west) * 0.2;
  const padY = (view.north - view.south) * 0.2;
  let c0 = Math.floor((view.west - padX - g.lonMin) / g.dx);
  let c1 = Math.ceil((view.east + padX - g.lonMin) / g.dx) + 1;
  let r0 = Math.floor((view.south - padY - g.latMin) / g.dy);
  let r1 = Math.ceil((view.north + padY - g.latMin) / g.dy) + 1;
  c0 = Math.max(0, Math.floor(c0 / CHUNK) * CHUNK);
  r0 = Math.max(0, Math.floor(r0 / CHUNK) * CHUNK);
  c1 = Math.min(g.nx, Math.ceil(c1 / CHUNK) * CHUNK);
  r1 = Math.min(g.ny, Math.ceil(r1 / CHUNK) * CHUNK);
  if (c1 - c0 < 2 || r1 - r0 < 2) return null;
  const cells = (c1 - c0) * (r1 - r0);
  if (cells > MAX_CELLS) return { tooBig: true, cells };
  return { r0, r1, c0, c1 };
}

// Pick the model to display for a view: the chosen one, or its coarser fallback when zoomed far out.
export function displayModel(model, view) {
  let m = model;
  for (let i = 0; i < 4; i++) {
    const w = windowFor(m, view);
    if (!w || !w.tooBig || !m.fallback) return { model: m, win: w };
    m = MODELS.find((x) => x.id === m.fallback);
  }
  return { model: m, win: windowFor(m, view) };
}

export class WindField {
  constructor(model, win, time, u, v, gust) {
    const g = model.grid;
    this.model = model;
    this.time = time;
    this.w = win.c1 - win.c0;
    this.h = win.r1 - win.r0;
    this.lon0 = g.lonMin + win.c0 * g.dx; // centre of the first column
    this.lat0 = g.latMin + win.r0 * g.dy; // centre of the first (southern) row
    this.dx = g.dx;
    this.dy = g.dy;
    const n = this.w * this.h;
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.gust = new Float32Array(n);
    this.speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const uu = u[i] * KN;
      const vv = v[i] * KN;
      this.u[i] = uu;
      this.v[i] = vv;
      this.speed[i] = Math.hypot(uu, vv);
      this.gust[i] = gust ? gust[i] * KN : NaN;
    }
    this.west = this.lon0 - this.dx / 2;
    this.east = this.lon0 + (this.w - 0.5) * this.dx;
    this.south = this.lat0 - this.dy / 2;
    this.north = this.lat0 + (this.h - 0.5) * this.dy;
  }

  sample(arr, lon, lat) {
    const fx = (lon - this.lon0) / this.dx;
    const fy = (lat - this.lat0) / this.dy;
    if (fx < 0 || fy < 0 || fx > this.w - 1 || fy > this.h - 1) return NaN;
    const x0 = Math.min(Math.floor(fx), this.w - 2);
    const y0 = Math.min(Math.floor(fy), this.h - 2);
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * this.w + x0;
    const a = arr[i];
    const b = arr[i + 1];
    const c = arr[i + this.w];
    const d = arr[i + this.w + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  uv(lon, lat) {
    const u = this.sample(this.u, lon, lat);
    const v = this.sample(this.v, lon, lat);
    return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
  }

  at(lon, lat) {
    const w = this.uv(lon, lat);
    if (!w) return null;
    const [u, v] = w;
    return {
      speed: Math.hypot(u, v),
      dir: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360,
      gust: this.sample(this.gust, lon, lat),
    };
  }
}

// Read the wind of one forecast hour for a window of the grid.
export function readField(model, meta, time, win) {
  const key = `${model.domain}|${meta.run}|${time}|${win.r0}|${win.r1}|${win.c0}|${win.c1}`;
  const hit = fieldCache.get(key);
  if (hit) {
    fieldCache.delete(key);
    fieldCache.set(key, hit);
    return hit;
  }
  const p = (async () => {
    const backend = pool.backend(fileUrl(model, meta, time));
    const ranges = [
      { start: win.r0, end: win.r1 },
      { start: win.c0, end: win.c1 },
    ];
    const [u, v, gust] = await backend.withReader(blockCache, async (reader) => {
      const read = async (name) => {
        const child = await reader.getChildByName(name);
        return child ? child.read({ type: OmDataType.FloatArray, ranges }) : null;
      };
      return Promise.all([read('wind_u_component_10m'), read('wind_v_component_10m'), read('wind_gusts_10m')]);
    });
    if (!u || !v) throw new Error('no wind in file');
    return new WindField(model, win, time, u, v, gust);
  })();
  fieldCache.set(key, p);
  p.catch(() => fieldCache.delete(key));
  while (fieldCache.size > 40) fieldCache.delete(fieldCache.keys().next().value);
  return p;
}
