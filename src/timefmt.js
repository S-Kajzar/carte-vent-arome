// Date formatting in a chosen time zone: 'local', 'UTC' or a fixed offset like 'UTC+1'.
const DAYS = ['di', 'lu', 'ma', 'me', 'je', 've', 'sa'];
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map();

function ianaFor(tz) {
  if (tz === 'local') return undefined;
  if (tz.includes('/')) return tz;
  if (tz === 'UTC') return 'UTC';
  const m = /^UTC([+-])(\d+)$/.exec(tz);
  if (m) {
    const n = parseInt(m[2], 10);
    if (n === 0) return 'UTC';
    return `Etc/GMT${m[1] === '+' ? '-' : '+'}${n}`;
  }
  return undefined;
}

function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat('en-GB', {
        timeZone: ianaFor(tz),
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        hourCycle: 'h23',
        timeZoneName: 'short',
      }),
    );
  }
  return fmtCache.get(tz);
}

export function parts(ms, tz) {
  const o = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  let zone = o.timeZoneName || '';
  if (tz === 'UTC') zone = 'UTC';
  else if (/^UTC[+-]/.test(tz)) zone = tz;
  else if (/^GMT$/.test(zone)) zone = 'UTC';
  else zone = zone.replace(/^GMT/, 'UTC');
  return {
    y: +o.year,
    mo: +o.month,
    d: +o.day,
    h: +o.hour % 24,
    mi: +o.minute,
    wd: WD[o.weekday] ?? 0,
    zone,
  };
}

const pad = (n) => String(n).padStart(2, '0');

// "sa 7. 21h CET"
export function shortLabel(ms, tz) {
  const p = parts(ms, tz);
  return `${DAYS[p.wd]} ${p.d}. ${p.h}h ${p.zone}`;
}

// "7. 11. 2026 21:04 CET"
export function longLabel(ms, tz) {
  const p = parts(ms, tz);
  return `${p.d}. ${p.mo}. ${p.y} ${pad(p.h)}:${pad(p.mi)} ${p.zone}`;
}

// "Di 8.11."
export function dayLabel(ms, tz) {
  const p = parts(ms, tz);
  const d = DAYS[p.wd];
  return `${d[0].toUpperCase()}${d[1]} ${p.d}.${p.mo}.`;
}
