// Moving wind streaks drawn on a canvas laid over the map.
const CELL = 8; // px of the screen-space velocity field

export class Particles {
  constructor(map, canvas) {
    this.map = map;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.enabled = true;
    this.field = null;
    this.parts = [];
    this.running = false;
    this.moving = false;
    this._frame = this._frame.bind(this);
    map.on('movestart', () => {
      this.moving = true;
      this.clear();
    });
    map.on('moveend', () => {
      this.moving = false;
      this.rebuild();
    });
    map.on('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.start();
    });
    this.resize();
  }

  // field: anything with uv(lon, lat) → [u, v] in knots (towards), or null
  setField(field) {
    this.grid = field;
    this.rebuild();
  }

  setEnabled(on) {
    this.enabled = on;
    this.clear();
    if (on) this.rebuild();
  }

  resize() {
    const c = this.map.getContainer();
    const w = c.clientWidth;
    const h = c.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.rebuild();
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  rebuild() {
    this.field = null;
    if (!this.grid || !this.enabled || this.moving || !this.w) {
      this.clear();
      return;
    }
    const cols = Math.ceil(this.w / CELL) + 1;
    const rows = Math.ceil(this.h / CELL) + 1;
    const vx = new Float32Array(cols * rows);
    const vy = new Float32Array(cols * rows);
    const g = this.grid;
    const zoom = this.map.getZoom();
    // px per frame per knot; grows a little with zoom so motion reads well
    // kept slow on purpose: a gentle drift, not a rush
    const k = 0.045 * Math.pow(1.08, zoom - 10);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ll = this.map.unproject([c * CELL, r * CELL]);
        const w = g.uv(ll.lng, ll.lat);
        const i = r * cols + c;
        if (w) {
          vx[i] = w[0] * k;
          vy[i] = -w[1] * k;
        } else {
          vx[i] = NaN;
          vy[i] = NaN;
        }
      }
    }
    this.field = { cols, rows, vx, vy };
    const count = Math.round((this.w * this.h) / 220);
    this.parts = Array.from({ length: count }, () => this._spawn({}));
    this.clear();
    // draw a settled picture straight away, then animate
    for (let i = 0; i < 50; i++) this._step();
    this.start();
  }

  _spawn(p) {
    p.x = Math.random() * this.w;
    p.y = Math.random() * this.h;
    p.age = Math.floor(Math.random() * 120);
    p.life = 90 + Math.floor(Math.random() * 120);
    return p;
  }

  _vel(x, y) {
    const f = this.field;
    const c = x / CELL;
    const r = y / CELL;
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 >= f.cols - 1 || r0 >= f.rows - 1) return null;
    const tx = c - c0;
    const ty = r - r0;
    const i = r0 * f.cols + c0;
    const bl = (a) => (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + f.cols] * (1 - tx) + a[i + f.cols + 1] * tx) * ty;
    const x1 = bl(f.vx);
    const y1 = bl(f.vy);
    if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;
    return [x1, y1];
  }

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this._frame);
  }

  _frame() {
    if (!this.field || !this.enabled || this.moving || document.hidden) {
      this.running = false;
      return;
    }
    this._step();
    requestAnimationFrame(this._frame);
  }

  // one animation step: fade the old trails, move every streak a little
  _step() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // fade previous trails
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(60,60,60,0.5)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const p of this.parts) {
      const vel = this._vel(p.x, p.y);
      if (!vel || p.age++ > p.life) {
        this._spawn(p);
        p.age = 0;
        continue;
      }
      const nx = p.x + vel[0];
      const ny = p.y + vel[1];
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      p.x = nx;
      p.y = ny;
    }
    ctx.stroke();
  }
}
