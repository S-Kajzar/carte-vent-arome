import { parts, dayLabel, longLabel } from './timefmt.js';

const PX_PER_HOUR = 15;
const H = 40;
const HOUR = 3600000;
const PAD = 16;

export class Timeline {
  constructor(root, { onChange, onCommit }) {
    this.root = root;
    this.onChange = onChange;
    this.onCommit = onCommit;
    this.tz = 'local';
    this.start = 0;
    this.end = 0;
    this.time = 0;
    root.innerHTML = `
      <div class="ts-clip"><div class="ts-content"></div></div>
      <div class="ts-line"></div>
      <div class="ts-label"></div>`;
    this.content = root.querySelector('.ts-content');
    this.label = root.querySelector('.ts-label');
    this._bind();
    new ResizeObserver(() => this._place()).observe(root);
  }

  setRange(start, end, tz) {
    this.start = start;
    this.end = end;
    this.tz = tz;
    this._render();
    this._place();
  }

  setTime(ms) {
    this.time = Math.max(this.start, Math.min(this.end, ms));
    this._place();
  }

  x(ms) {
    return PAD + ((ms - this.start) / HOUR) * PX_PER_HOUR;
  }

  _render() {
    const { start, end, tz } = this;
    const w = Math.max(1, this.x(end) + PAD);
    let bands = '';
    let lines = '';
    let texts = '';
    // find local day boundaries
    let dayStart = start;
    let band = 0;
    for (let t = start; t <= end + 1; t += HOUR) {
      const p = parts(t, tz);
      const x = this.x(t);
      if (p.h === 0 && t !== start) {
        bands += `<rect x="${this.x(dayStart)}" y="0" width="${x - this.x(dayStart)}" height="${H}" fill="${band % 2 ? '#f4f4f4' : '#ffffff'}"/>`;
        dayStart = t;
        band++;
      }
      if (t > end) break;
      if (p.h === 0) {
        lines += `<line x1="${x + 0.5}" y1="0" x2="${x + 0.5}" y2="${H}" stroke="#000" stroke-opacity="0.3"/>`;
      } else {
        lines += `<line x1="${x + 0.5}" y1="0" x2="${x + 0.5}" y2="${H}" stroke="#000" stroke-opacity="0.13" stroke-dasharray="2 3"/>`;
      }
      if (p.h % 2 === 0) {
        texts += `<text x="${x}" y="31" text-anchor="middle" class="ts-h">${p.h}h</text>`;
      }
      if (p.h === 12) {
        texts += `<text x="${x}" y="17" text-anchor="middle" class="ts-d">${dayLabel(t, tz)}</text>`;
      }
    }
    bands += `<rect x="${this.x(dayStart)}" y="0" width="${Math.max(0, this.x(end) - this.x(dayStart))}" height="${H}" fill="${band % 2 ? '#f4f4f4' : '#ffffff'}"/>`;
    this.content.style.width = w + 'px';
    this.content.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${bands}${lines}${texts}</svg>`;
  }

  _place() {
    const cw = this.root.clientWidth;
    const off = cw / 2 - this.x(this.time);
    this.content.style.transform = `translateX(${off}px)`;
    this.label.textContent = longLabel(this.time, this.tz);
  }

  _bind() {
    let down = null;
    const root = this.root;
    root.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, t: this.time, moved: false };
      root.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
    });
    root.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 3) down.moved = true;
      if (!down.moved) return;
      this.setTime(down.t - (dx / PX_PER_HOUR) * HOUR);
      this.onChange(this.time);
    });
    const up = (e) => {
      if (!down) return;
      root.classList.remove('dragging');
      if (!down.moved) {
        // click: jump to that hour
        const r = root.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        this.setTime(this.time + (dx / PX_PER_HOUR) * HOUR);
      }
      down = null;
      const snapped = Math.round(this.time / HOUR) * HOUR;
      this.setTime(snapped);
      this.onCommit(this.time);
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        this.setTime(Math.round(this.time / HOUR) * HOUR + Math.sign(d) * HOUR);
        this.onCommit(this.time);
      },
      { passive: false },
    );
  }
}
