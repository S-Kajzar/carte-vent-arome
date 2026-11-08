import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { icons } from './icons.js';
import { baseStyle } from './mapstyle.js';
import { MODELS, DEFAULT_MODEL, modelById, PARAMS, putColor, SCALE, fmtSpeed, fmtSpeedLong, dirName } from './models.js';
import { getMeta, readField, displayModel } from './forecast.js';
import { Particles } from './particles.js';
import { Timeline } from './timeline.js';
import { shortLabel } from './timefmt.js';

const HOUR = 3600000;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- saved settings ----------
const saved = JSON.parse(localStorage.getItem('wmap') || '{}');
const save = () =>
  localStorage.setItem(
    'wmap',
    JSON.stringify({ model: state.model.id, param: state.param, units: state.units, particles: state.particles, opacity: state.opacity }),
  );

const qs = new URLSearchParams(location.search);
const state = {
  model: modelById(qs.get('model') || saved.model || DEFAULT_MODEL),
  param: saved.param || 'wind',
  units: saved.units || 'kn',
  particles: saved.particles !== false,
  opacity: saved.opacity || 100,
  tz: 'local',
  time: Date.now(),
  grid: null,
  meta: null,
  field: null,
  playing: null,
  pickTz: false,
};

// ---------- icons & menus ----------
function fillIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    if (el.dataset.filled) return;
    el.dataset.filled = '1';
    const ic = icons[el.dataset.icon] || '';
    if (el.classList.contains('mainmenu')) {
      el.innerHTML = `${ic}${el.dataset.text ? `<span class="txt">${el.dataset.text}</span>` : ''}`;
    } else {
      el.innerHTML = ic;
    }
  });
}

const MENUS = {
  maps: [
    ['forecastMap', 'Prévisions', 'forecast'],
    ['sea', 'Sea temperature'],
    ['pin', 'Spots'],
    ['station', 'Stations'],
    ['tide', 'Marées'],
    ['stats', 'Wind statistics'],
    ['grid', 'Model coverage'],
  ],
  more: [
    ['tide', 'Marées', null, 'phone-only'],
    ['archive', 'Archives'],
    ['swirl', 'Version PRO'],
    ['phone', 'Applications mobiles'],
    ['target', 'Annuaire des centres'],
    ['share', 'Widgets de prévision'],
    ['station', 'Station météo'],
    ['left', 'Ancienne version'],
  ],
  help: [
    ['doc', 'Aide', 'help'],
    ['news', 'News'],
    ['help', 'Guide rapide', 'help'],
    ['keys', 'Raccourcis clavier', 'help'],
    ['info', 'Nouvelle intro du site'],
  ],
  lang: [
    'Basque', 'Bulgarian', 'Catalan', 'Czech', 'Danish', 'Dutch', 'English', 'Estonian', 'Finnish', 'French',
    'Galician', 'German', 'Hungarian', 'Chinese (traditional)', 'Italian', 'Latvian', 'Lithuanian', 'Polish',
    'Portuguese', 'Romanian', 'Russian', 'Spanish', 'Swedish', 'Turkish', 'Ukrainian',
  ].map((l) => [null, l]),
};

$$('.dropdown[data-items]').forEach((ul) => {
  ul.innerHTML = MENUS[ul.dataset.items]
    .map(
      ([ic, label, act, cls]) =>
        `<li${cls ? ` class="${cls}"` : ''}><a${act ? ` data-act="${act}"` : ''}>${ic ? icons[ic] : ''}<span>${label}</span></a></li>`,
    )
    .join('');
});
$('.m-home .mainmenu').innerHTML = `${icons.home}<span class="txt">Home</span>`;
$('.logo').innerHTML = icons.swirl.replace('class="icon"', 'class="logo-ico"');
fillIcons();
$('.tb-prev').innerHTML = icons.prevFrame;
$('.tb-next').innerHTML = icons.nextFrame;
$('.tb-play').innerHTML = icons.play;
$('.tb-now').innerHTML = icons.clock;
$('.side-step.prev').innerHTML = icons.prevFrame;
$('.side-step.next').innerHTML = icons.nextFrame;
$$('.panel .close').forEach((a) => (a.innerHTML = icons.close));

const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
let closeTimer = null;
function closeMenus(except) {
  $$('.has-sub.open, #time-menu.open').forEach((li) => {
    if (li === except) return;
    li.classList.remove('open');
    const a = li.querySelector('[aria-expanded]');
    if (a) a.setAttribute('aria-expanded', 'false');
  });
}
function openMenu(li) {
  closeMenus(li);
  li.classList.add('open');
  const a = li.querySelector('[aria-expanded]');
  if (a) a.setAttribute('aria-expanded', 'true');
}
$$('.has-sub').forEach((li) => {
  const a = li.querySelector('.mainmenu');
  a.addEventListener('click', (e) => {
    e.stopPropagation();
    li.classList.contains('open') ? closeMenus() : openMenu(li);
  });
  if (finePointer) {
    li.addEventListener('mouseenter', () => {
      clearTimeout(closeTimer);
      if ($('.has-sub.open')) openMenu(li);
    });
    li.addEventListener('mouseleave', () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (li.classList.contains('open')) closeMenus();
      }, 450);
    });
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.has-sub, #time-menu')) closeMenus();
  if (!e.target.closest('#search')) $('#search-results').hidden = true;
});
$$('.dropdown[data-items] a').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenus();
    if (a.dataset.act === 'help') openPanel('help');
  }),
);
$('[data-act="home"]').addEventListener('click', () => map.flyTo({ center: INITIAL.center, zoom: INITIAL.zoom }));
$('[data-act="options"]').addEventListener('click', (e) => {
  e.stopPropagation();
  openPanel('options');
});

// ---------- map ----------
const INITIAL = { center: [7.186869831688227, 43.63364736461472], zoom: 10.127259710306921 };
const lat = parseFloat(qs.get('lat'));
const lon = parseFloat(qs.get('lon'));
const zoom = parseFloat(qs.get('zoom'));

const map = new maplibregl.Map({
  container: 'map',
  style: baseStyle(),
  center: Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : INITIAL.center,
  zoom: Number.isFinite(zoom) ? zoom : INITIAL.zoom,
  maxZoom: 15,
  minZoom: 2,
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
});
// the map stops above the time bar; keep its centre where the full-height map would have it
map.setPadding({ top: 40, bottom: 0, left: 0, right: 0 });
window.addEventListener('load', () => map.resize());
new ResizeObserver(() => map.resize()).observe($('#wgmap-page'));
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
map.addControl(
  new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false }, trackUserLocation: false }),
  'top-left',
);
map.addControl(
  new maplibregl.AttributionControl({
    compact: matchMedia('(max-width: 767px)').matches ? true : undefined,
    customAttribution: '<a href="https://open-meteo.com/" target="_blank">Prévisions © Open-Meteo</a>',
  }),
  'bottom-left',
);

const particles = new Particles(map, $('#particles'));
particles.enabled = state.particles;

function updateUrl() {
  const c = map.getCenter();
  const p = new URLSearchParams({ lat: c.lat.toFixed(5), lon: c.lng.toFixed(5), zoom: map.getZoom().toFixed(3), model: state.model.id });
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

const EMPTY_IMG = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  return c.toDataURL();
})();

map.on('load', () => {
  map.addSource('wind', {
    type: 'image',
    url: EMPTY_IMG,
    coordinates: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  });
  map.addLayer(
    {
      id: 'wind-colors',
      type: 'raster',
      source: 'wind',
      paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0, 'raster-opacity': state.opacity / 100 },
    },
    'water-outline',
  );
  styleReady = true;
  if (state.meta) loadField();
});
let styleReady = false;

let moveTimer = null;
map.on('moveend', () => {
  updateUrl();
  clearTimeout(moveTimer);
  moveTimer = setTimeout(loadField, 250);
});

// ---------- forecast loading ----------
function status(msg, kind = '') {
  const el = $('#status');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = kind;
}

function viewBox() {
  const b = map.getBounds();
  return { west: b.getWest(), east: b.getEast(), south: Math.max(-85, b.getSouth()), north: Math.min(85, b.getNorth()) };
}

function nearestIn(times, ms) {
  let best = times[0];
  for (const t of times) if (Math.abs(t - ms) < Math.abs(best - ms)) best = t;
  return best;
}

// nearest forecast hour of the model run to a time
function validTimeFor(ms) {
  const times = state.meta?.times;
  return times?.length ? nearestIn(times, ms) : null;
}

async function loadMeta(force = false) {
  const model = state.model;
  try {
    const meta = await getMeta(model, force);
    if (model !== state.model) return;
    state.meta = meta;
    setupTimeline();
    loadField();
  } catch {
    status('Prévisions indisponibles (connexion ?). Nouvel essai dans un instant…', 'error');
    setTimeout(() => loadMeta(true), 15000);
  }
}

let loadSeq = 0;
let slowTimer = null;
async function loadField() {
  if (!state.meta || !styleReady) return;
  const t = validTimeFor(state.time);
  const { model, win } = displayModel(state.model, viewBox());
  const seq = ++loadSeq;
  if (!win) {
    state.field = null;
    clearOverlay();
    status(`${state.model.name} ne couvre pas cette zone : choisissez un autre modèle.`, 'error');
    return;
  }
  if (win.tooBig) {
    state.field = null;
    clearOverlay();
    status(`Zoomez pour afficher ${state.model.name}.`, 'loading');
    return;
  }
  // a zoomed-out view of a fine model shows its coarser sibling meanwhile
  const meta = model === state.model ? state.meta : await getMeta(model).catch(() => null);
  if (!meta || seq !== loadSeq) return;
  const tt = model === state.model ? t : nearestIn(meta.times, t);
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => {
    if (seq === loadSeq) status(`Chargement ${state.model.name}…`, 'loading');
  }, 500);
  try {
    const field = await readField(model, meta, tt, win);
    if (seq !== loadSeq) return;
    clearTimeout(slowTimer);
    state.field = field;
    if (model !== state.model) status(`Vue large : ${model.name} affiché. Zoomez pour ${state.model.name}.`, 'loading');
    else status('');
    drawOverlay();
    refreshPopup();
    prefetchNext(model, meta, tt, win);
  } catch {
    if (seq !== loadSeq) return;
    clearTimeout(slowTimer);
    status('Cette heure de prévision n’est pas disponible. Nouvel essai…', 'error');
    setTimeout(() => {
      if (seq === loadSeq) loadMeta(true);
    }, 8000);
  }
}

// warm the next hour so stepping and playing feel instant
function prefetchNext(model, meta, t, win) {
  const i = meta.times.indexOf(t);
  const next = meta.times[i + 1];
  if (next) readField(model, meta, next, win).catch(() => {});
}

// ---------- overlay ----------
function clearOverlay() {
  map.getSource('wind')?.updateImage({ url: EMPTY_IMG, coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]] });
  particles.setField(null);
}

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOf = (y) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

function drawOverlay() {
  const f = state.field;
  if (!styleReady || !f) return;
  const arr = state.param === 'gust' ? f.gust : f.speed;
  // output image: grid columns as they are, rows spaced evenly in map (Mercator) space
  const W = Math.min(f.w, 1400);
  const H = Math.min(Math.max(2, Math.round(f.h * 1.15)), 1400);
  const yN = mercY(Math.min(85, f.north));
  const yS = mercY(Math.max(-85, f.south));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const lons = new Float32Array(W);
  for (let x = 0; x < W; x++) lons[x] = f.west + ((x + 0.5) / W) * (f.east - f.west);
  for (let y = 0; y < H; y++) {
    const lat = latOf(yN + ((y + 0.5) / H) * (yS - yN));
    for (let x = 0; x < W; x++) putColor(d, (y * W + x) * 4, f.sample(arr, lons[x], lat));
  }
  ctx.putImageData(img, 0, 0);
  map.getSource('wind').updateImage({
    url: cv.toDataURL(),
    coordinates: [
      [f.west, latOf(yN)],
      [f.east, latOf(yN)],
      [f.east, latOf(yS)],
      [f.west, latOf(yS)],
    ],
  });
  particles.setField(f);
}

// ---------- time ----------
let dragTimer = null;
const timeline = new Timeline($('#timescroll'), {
  onChange: (ms) => {
    state.time = ms;
    updateTimeLabel();
    clearTimeout(dragTimer);
    dragTimer = setTimeout(loadField, 120);
  },
  onCommit: (ms) => {
    state.time = ms;
    applyTime();
  },
});

function timelineRange() {
  const now = Date.now();
  const times = state.meta?.times;
  if (!times?.length) {
    const s = Math.floor((now - 7 * HOUR) / HOUR) * HOUR;
    return [s, s + 2 * 24 * HOUR];
  }
  const first = times[0];
  const last = times[times.length - 1];
  const start = Math.max(first, Math.floor((now - 7 * HOUR) / HOUR) * HOUR);
  return [Math.min(start, last), last];
}

function setupTimeline() {
  const [s, e] = timelineRange();
  timeline.setRange(s, e, state.tz);
  state.time = Math.max(s, Math.min(e, state.time));
  timeline.setTime(state.time);
  updateTimeLabel();
}

function updateTimeLabel() {
  const t = validTimeFor(state.time) ?? Math.round(state.time / HOUR) * HOUR;
  $('#map-time').textContent = shortLabel(t, state.tz);
}

function applyTime() {
  updateTimeLabel();
  clearTimeout(dragTimer);
  loadField();
}


function step(d) {
  const [s, e] = timelineRange();
  let t = Math.round(state.time / HOUR) * HOUR + d * HOUR;
  if (t > e) t = s;
  if (t < s) t = e;
  state.time = t;
  timeline.setTime(t);
  applyTime();
}

$$('[data-step]').forEach((a) => a.addEventListener('click', () => step(+a.dataset.step)));
$('.tb-now').addEventListener('click', () => {
  stopPlay();
  state.time = Date.now();
  timeline.setTime(state.time);
  applyTime();
});
function stopPlay() {
  if (!state.playing) return;
  clearInterval(state.playing);
  state.playing = null;
  $('.tb-play').innerHTML = icons.play;
  $('.tb-play').setAttribute('aria-label', 'Lecture');
}
$('.tb-play').addEventListener('click', () => {
  if (state.playing) return stopPlay();
  state.playing = setInterval(() => step(1), 1300);
  $('.tb-play').innerHTML = icons.pause;
  $('.tb-play').setAttribute('aria-label', 'Pause');
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === ' ') $('.tb-play').click();
  else if (e.key === 'Escape') {
    closeMenus();
    closePanels();
    hideTip();
  } else return;
  e.preventDefault();
});

// time zone menu
const tzMenu = $('#time-menu');
$('#map-time').addEventListener('click', (e) => {
  e.stopPropagation();
  tzMenu.classList.contains('open') ? closeMenus() : openMenu(tzMenu);
});
$$('#tz-menu a').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenus();
    const v = a.dataset.tz;
    if (v === 'now') {
      state.tz = 'local';
      state.time = Date.now();
    } else if (v === 'UTC') {
      state.tz = 'UTC';
    } else if (v === 'pick') {
      state.pickTz = true;
      map.getCanvas().style.cursor = 'crosshair';
      status('Cliquez sur la carte pour choisir le fuseau horaire.', 'loading');
      return;
    }
    setupTimeline();
    applyTime();
  }),
);
$$('#tz-menu [data-icon]').forEach((s) => (s.innerHTML = icons.clock));

async function pickTimeZone(ll) {
  state.pickTz = false;
  map.getCanvas().style.cursor = '';
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${ll.lat.toFixed(3)}&longitude=${ll.lng.toFixed(3)}&timezone=auto&forecast_days=1&daily=sunrise`,
    );
    const j = await r.json();
    state.tz = j.timezone && j.timezone !== 'GMT' ? j.timezone : 'UTC';
  } catch {
    const off = Math.round(ll.lng / 15);
    state.tz = off === 0 ? 'UTC' : `UTC${off > 0 ? '+' : '-'}${Math.abs(off)}`;
  }
  status('');
  setupTimeline();
  applyTime();
}

// ---------- panels ----------
const panels = { model: $('#panel-model'), param: $('#panel-param'), options: $('#panel-options'), help: $('#panel-help'), compare: $('#panel-compare') };
const anchors = { model: '#ctrl-model', param: '#ctrl-param', options: '#ctrl-options', help: '#ctrl-help', compare: '#ctrl-compare' };

function closePanels(except) {
  for (const [k, p] of Object.entries(panels)) if (k !== except) p.hidden = true;
}
function openPanel(name) {
  const p = panels[name];
  const wasOpen = !p.hidden;
  closePanels();
  closeMenus();
  if (wasOpen) return;
  p.hidden = false;
  const page = $('#wgmap-page').getBoundingClientRect();
  const btn = $(anchors[name]).getBoundingClientRect();
  const w = p.offsetWidth;
  let left = btn.left + btn.width / 2 - w / 2 - page.left;
  left = Math.max(6, Math.min(page.width - w - 6, left));
  p.style.left = left + 'px';
  p.style.setProperty('--arrow', `${btn.left + btn.width / 2 - page.left - left}px`);
  if (name === 'model') {
    const sel = p.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
}
$$('.panel .close').forEach((a) => a.addEventListener('click', () => closePanels()));
for (const k of Object.keys(anchors))
  $(anchors[k]).addEventListener('click', (e) => {
    e.stopPropagation();
    openPanel(k);
  });

function renderModelList() {
  $('#panel-model .list').innerHTML = MODELS.map(
    (m) =>
      `<li class="${m === state.model ? 'selected' : ''}" data-id="${m.id}" style="--bar:${m.bar}"><a>${icons.wind}<span>${m.name} (${m.region})</span></a></li>`,
  ).join('');
  $$('#panel-model li').forEach((li) =>
    li.addEventListener('click', () => {
      state.model = modelById(li.dataset.id);
      save();
      updateUrl();
      renderModelList();
      $('#ctrl-model .t').textContent = state.model.name;
      closePanels();
      state.meta = null;
      loadSeq++;
      status(`Chargement ${state.model.name}…`, 'loading');
      loadMeta();
    }),
  );
}
function renderParamList() {
  $('#panel-param .list').innerHTML = PARAMS.map(
    (p) => `<li class="${p.id === state.param ? 'selected' : ''}" data-id="${p.id}"><a>${icons[p.icon]}<span>${p.label}</span></a></li>`,
  ).join('');
  $$('#panel-param li').forEach((li) =>
    li.addEventListener('click', () => {
      state.param = li.dataset.id;
      save();
      renderParamList();
      const p = PARAMS.find((x) => x.id === state.param);
      $('#ctrl-param .t').textContent = p.label;
      $('#ctrl-param .ico').innerHTML = icons[p.icon];
      closePanels();
      drawOverlay();
    }),
  );
}
function renderLegend() {
  const stops = SCALE.filter(([k]) => k > 0);
  $('#legend').innerHTML =
    `<div class="legend-bar">${stops
      .map(([k, c]) => `<span style="background:rgba(${c[0]},${c[1]},${c[2]},${Math.max(c[3], 0.25)})">${fmtSpeed(k, state.units).replace(/ .*/, '')}</span>`)
      .join('')}</div><div class="legend-unit">${fmtSpeed(1, state.units).replace(/^[\d.]+ /, '')}</div>`;
}
renderModelList();
renderParamList();
renderLegend();
$('#ctrl-model .t').textContent = state.model.name;
{
  const p = PARAMS.find((x) => x.id === state.param) || PARAMS[0];
  $('#ctrl-param .t').textContent = p.label;
  $('#ctrl-param .ico').innerHTML = icons[p.icon];
}

$('#opt-particles').checked = state.particles;
$('#opt-particles').addEventListener('change', (e) => {
  state.particles = e.target.checked;
  particles.setEnabled(state.particles);
  save();
});
$('#opt-units').value = state.units;
$('#opt-units').addEventListener('change', (e) => {
  state.units = e.target.value;
  save();
  renderLegend();
  refreshPopup();
});
$('#opt-opacity').value = state.opacity;
$('#opt-opacity').addEventListener('input', (e) => {
  state.opacity = +e.target.value;
  if (map.getLayer('wind-colors')) map.setPaintProperty('wind-colors', 'raster-opacity', state.opacity / 100);
  save();
});

// ---------- click: forecast at a point ----------
// A small box next to the pointer: mean wind, gusts, direction, model (follows the mouse;
// on touch screens a tap pins it to that spot).
const tip = document.createElement('div');
tip.id = 'wind-tip';
tip.hidden = true;
$('#wgmap-page').appendChild(tip);
let tipLL = null;
let tipPinned = false;

function tipHtml(ll) {
  const f = state.field;
  if (!f) return '<span class="tip-model">Chargement…</span>';
  const w = f.at(ll.lng, ll.lat);
  if (!w) return `Pas de données<span class="tip-model">${f.model.name}</span>`;
  const arrow = `<span class="arr" style="transform:rotate(${w.dir + 180}deg)">↑</span>`;
  return `<span class="tip-row"><span class="tip-k">Moyen</span> <b>${fmtSpeedLong(w.speed, state.units)}</b></span>
    <span class="tip-row"><span class="tip-k">Rafales</span> <b>${Number.isFinite(w.gust) ? fmtSpeedLong(w.gust, state.units) : '–'}</b></span>
    <span class="tip-row">${arrow} ${Math.round(w.dir)} ° ${dirName(w.dir)}</span>
    <span class="tip-model">${f.model.name}</span>`;
}
function placeTip() {
  if (!tipLL) return;
  const p = map.project(tipLL);
  const page = $('#wgmap-page');
  tip.innerHTML = tipHtml(tipLL);
  tip.hidden = false;
  let x = p.x + 12;
  let y = p.y + 12;
  if (x + tip.offsetWidth > page.clientWidth - 4) x = p.x - tip.offsetWidth - 12;
  if (y + tip.offsetHeight > page.clientHeight - 90) y = p.y - tip.offsetHeight - 12;
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hideTip() {
  tipLL = null;
  tipPinned = false;
  tip.hidden = true;
}
function refreshPopup() {
  placeTip();
}
map.on('mousemove', (e) => {
  if (tipPinned || state.pickTz) return;
  tipLL = e.lngLat;
  placeTip();
});
map.getCanvasContainer().addEventListener('mouseleave', () => {
  if (!tipPinned) hideTip();
});
map.on('move', () => {
  if (tipPinned) placeTip();
});
map.on('click', (e) => {
  closeMenus();
  if (state.pickTz) return pickTimeZone(e.lngLat);
  closePanels('compare');
  tipLL = e.lngLat;
  tipPinned = !finePointer;
  placeTip();
  if (!panels.compare.hidden) compareAt(e.lngLat);
});

async function compareAt(ll) {
  const out = $('#compare-out');
  out.innerHTML = 'Chargement…';
  const when = validTimeFor(state.time) ?? state.time;
  const tiny = { west: ll.lng - 0.001, east: ll.lng + 0.001, south: ll.lat - 0.001, north: ll.lat + 0.001 };
  const rows = await Promise.all(
    MODELS.map(async (m) => {
      try {
        const meta = await getMeta(m);
        const t = meta.times.reduce((a, b) => (Math.abs(b - when) < Math.abs(a - when) ? b : a));
        if (Math.abs(t - when) > 3 * HOUR) return { m };
        const { win } = displayModel({ ...m, fallback: null }, tiny);
        if (!win || win.tooBig) return { m };
        const f = await readField(m, meta, t, win);
        return { m, w: f.at(ll.lng, ll.lat) };
      } catch {
        return { m };
      }
    }),
  );
  if (panels.compare.hidden) return;
  out.innerHTML = `<table>${rows
    .map(
      ({ m, w }) =>
        `<tr style="--bar:${m.bar}"><td>${m.name}</td><td>${w ? fmtSpeed(w.speed, state.units) : '–'}</td><td>${w && Number.isFinite(w.gust) ? fmtSpeed(w.gust, state.units) : ''}</td><td>${w ? dirName(w.dir) : ''}</td></tr>`,
    )
    .join('')}</table><p class="note">${shortLabel(when, state.tz)} · vent moyen, rafales, direction</p>`;
}

// ---------- search ----------
const sInput = $('#search-input');
const sList = $('#search-results');
let sTimer = null;
sInput.addEventListener('input', () => {
  clearTimeout(sTimer);
  const q = sInput.value.trim();
  if (q.length < 2) {
    sList.hidden = true;
    return;
  }
  sTimer = setTimeout(async () => {
    try {
      const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=fr`)).json();
      const res = j.results || [];
      sList.innerHTML = res.length
        ? res.map((r, i) => `<li><a data-i="${i}"><span>${r.name}</span><small>${[r.admin1, r.country].filter(Boolean).join(', ')}</small></a></li>`).join('')
        : '<li class="empty"><a>Aucun résultat</a></li>';
      sList.hidden = false;
      $$('a[data-i]', sList).forEach((a) =>
        a.addEventListener('click', () => {
          const r = res[+a.dataset.i];
          map.flyTo({ center: [r.longitude, r.latitude], zoom: 10 });
          sList.hidden = true;
          sInput.value = '';
          sInput.blur();
        }),
      );
    } catch {
      sList.hidden = true;
    }
  }, 300);
});
sInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('a[data-i]', sList)?.click();
  if (e.key === 'Escape') sList.hidden = true;
});

// ---------- start ----------
setupTimeline();
loadMeta();
window.addEventListener('resize', () => timeline.setTime(state.time));
