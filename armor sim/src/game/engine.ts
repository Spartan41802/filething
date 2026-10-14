// ArmorSim 2D engine — a soft-body lattice armor penetration sandbox.
// Nodes are joined by springs that stretch elastically, yield into permanent
// dents past a strain limit, and snap past a tear limit.

export interface Material {
  n: string;
  k: number; // stiffness
  y: number; // yield strain
  t: number; // tear strain
  im: number; // inverse mass factor
  h: number; // hardness (resists penetration)
  c: string;
  hot: string;
}

export type RoundType = "solid" | "buckshot" | "explosive";

export interface RoundDef {
  n: string;
  type: RoundType;
  m: number;
  h: number;
  r: number;
  c: string;
  pellets?: number;
  spread?: number;
  blast?: number;
  power?: number;
  desc: string;
}

export const MATS: Material[] = [
  { n: "Steel", k: 20000, y: 0.03, t: 0.45, im: 1, h: 1, c: "rgb(132,146,163)", hot: "rgb(200,168,146)" },
  { n: "Aluminum", k: 6000, y: 0.02, t: 0.5, im: 2.8, h: 0.3, c: "rgb(186,193,202)", hot: "rgb(220,196,184)" },
  { n: "Ceramic", k: 30000, y: 0.5, t: 0.06, im: 2, h: 1.8, c: "rgb(222,208,180)", hot: "rgb(236,222,196)" },
  { n: "Kevlar", k: 3200, y: 0.6, t: 0.85, im: 3.4, h: 0.55, c: "rgb(214,196,96)", hot: "rgb(236,222,140)" },
  { n: "Rubber", k: 1800, y: 0.9, t: 1.4, im: 2.2, h: 0.12, c: "rgb(64,70,78)", hot: "rgb(96,84,70)" },
];

export const ROUNDS: RoundDef[] = [
  { n: "AP Core", type: "solid", m: 6, h: 2.2, r: 3, c: "#ff9a4d", desc: "Hardened penetrator, low drag" },
  { n: "Lead FMJ", type: "solid", m: 4.5, h: 0.4, r: 4, c: "#c9b27a", desc: "Soft round, deforms on impact" },
  { n: "Buckshot", type: "buckshot", m: 1.1, h: 0.35, r: 2, c: "#9fd3ff", pellets: 9, spread: 0.3, desc: "Spread of light pellets" },
  { n: "HE Frag", type: "explosive", m: 5, h: 0.5, r: 4, c: "#ff5a5a", blast: 46, power: 2600, desc: "Detonates on contact" },
];

const CELL = 7, PC = 3, SUB = 6;
const DX = [1, 0, 1, -1];
const DY = [0, 1, 1, 1];
const DL = [CELL, CELL, CELL * 1.4142, CELL * 1.4142];

interface Bullet {
  x: number; y: number; vx: number; vy: number;
  m: number; m0: number; h: number; r: number; r0: number; c: string;
  trail: number[];
  state: "fly" | "ready" | "stuck" | "gone";
  hit: boolean; free: number; status: string;
  cells?: [number, number][]; cp?: [number, number][]; mu?: number; a0?: number;
  type?: RoundType; blast?: number; power?: number; exploded?: boolean;
  counted?: boolean; spawnedPellets?: boolean;
}

interface Particle { x: number; y: number; vx: number; vy: number; l: number; c: string; size: number }

export interface Stats {
  speedMps: number;
  torn: number;
  status: string;
  shots: number;
  penetrations: number;
  ricochets: number;
  stopped: number;
  through: number;
  shattered: number;
  nodes: number;
  fps: number;
}

type ToolId = 0 | 1 | 2 | 3; // draw armor, erase, draw bullet, fling

const SAVE_KEY = "armorsim2d-save-v1";

class SoundFX {
  ctx: AudioContext | null = null;
  muted = false;
  noiseBuf: AudioBuffer | null = null;

  private ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      this.ctx = new Ctor();
      const n = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", slideTo?: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  private noise(dur: number, gain: number, cutoff: number) {
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filt).connect(g).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  fire() {
    this.tone(760, 0.06, 0.18, "square", 320);
    this.noise(0.05, 0.12, 2800);
  }
  impact(intensity: number) {
    const i = Math.min(1, intensity);
    this.tone(160 + i * 80, 0.09, 0.05 + i * 0.2, "triangle", 60);
    this.noise(0.08 + i * 0.05, 0.08 + i * 0.25, 1200 + i * 1600);
  }
  tear() {
    this.noise(0.12, 0.2, 4200);
    this.tone(1400, 0.07, 0.08, "sawtooth", 500);
  }
  explosion() {
    this.noise(0.5, 0.5, 400);
    this.tone(90, 0.4, 0.4, "sine", 30);
  }
  bounce() {
    this.tone(900, 0.08, 0.15, "sine", 1400);
  }
}

export class ArmorSimEngine {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private raf = 0;

  // toolbar-controlled state
  tool: ToolId = 0;
  mat = 0;
  rnd = 0;
  brush = 3;
  pinOn = false;
  paused = false;
  ts = 1;
  gravity = false;
  sound = new SoundFX();

  private W = 0; private H = 0; private dpr = 1;
  private gw = 0; private gh = 0;
  private mt!: Uint8Array; private X!: Float32Array; private Y!: Float32Array;
  private VX!: Float32Array; private VY!: Float32Array; private FX!: Float32Array; private FY!: Float32Array;
  private pin!: Uint8Array; private lk!: Uint8Array; private pl!: Uint8Array; private br!: Uint8Array; private cn!: Uint8Array;
  private rest!: Float32Array; private NO: number[] = [1, 1, 1, 1];

  private bullets: Bullet[] = [];
  private debris: Particle[] = [];
  private sparks: Particle[] = [];
  private flashes: { x: number; y: number; r: number; max: number; c: string }[] = [];

  private mouse: { x: number; y: number } | null = null;
  private sling: { ax: number; ay: number; cx: number; cy: number; b: Bullet | null } | null = null;
  private down = false;
  private last: { x: number; y: number } | null = null;
  private rmb = false;
  private draft: Map<string, [number, number]> | null = null;

  private torn = 0;
  private shots = 0; private penetrations = 0; private ricochets = 0; private stopped = 0; private through = 0; private shattered = 0;
  private fps = 60; private fpsAcc = 0; private fpsCount = 0;

  private field = "#12161b"; private gridc = "#1b2128"; private accent = "#ff8a3d"; private muted = "#8693a1"; private pinc = "#4a525c";

  private statsCb: ((s: Stats) => void) | null = null;
  private statsTimer = 0;
  private mqListener: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;

    this.theme();
    this.mqListener = () => this.theme();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", this.mqListener);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointerleave", this.onLeave);

    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", this.mqListener);
    this.cv.removeEventListener("pointerdown", this.onDown);
    this.cv.removeEventListener("pointermove", this.onMove);
    this.cv.removeEventListener("pointerup", this.onUp);
    this.cv.removeEventListener("pointerleave", this.onLeave);
  }

  onStats(cb: (s: Stats) => void) { this.statsCb = cb; }

  private theme() {
    const s = getComputedStyle(document.documentElement);
    const g = (n: string, fallback: string) => s.getPropertyValue(n).trim() || fallback;
    this.field = g("--field", "#12161b");
    this.gridc = g("--grid", "#1b2128");
    this.accent = g("--accent", "#ff8a3d");
    this.muted = g("--muted", "#8693a1");
    this.pinc = g("--pin", "#4a525c");
  }

  // ---------- grid management ----------
  private alloc(nw: number, nh: number) {
    const o = { mt: this.mt, X: this.X, Y: this.Y, VX: this.VX, VY: this.VY, pin: this.pin, lk: this.lk, pl: this.pl, br: this.br, rest: this.rest };
    const ow = this.gw, oh = this.gh;
    this.gw = nw; this.gh = nh;
    const N = this.gw * this.gh;
    this.mt = new Uint8Array(N); this.pin = new Uint8Array(N); this.lk = new Uint8Array(N);
    this.pl = new Uint8Array(N); this.br = new Uint8Array(N); this.cn = new Uint8Array(N);
    this.X = new Float32Array(N); this.Y = new Float32Array(N); this.VX = new Float32Array(N); this.VY = new Float32Array(N);
    this.FX = new Float32Array(N); this.FY = new Float32Array(N);
    this.rest = new Float32Array(N * 4);
    this.NO = [1, this.gw, this.gw + 1, this.gw - 1];
    if (o.mt) {
      for (let y = 0; y < Math.min(oh, this.gh); y++) {
        for (let x = 0; x < Math.min(ow, this.gw); x++) {
          const a = y * ow + x, b = y * this.gw + x;
          this.mt[b] = o.mt[a]; this.X[b] = o.X[a]; this.Y[b] = o.Y[a];
          this.VX[b] = o.VX[a]; this.VY[b] = o.VY[a]; this.pin[b] = o.pin[a]; this.lk[b] = o.lk[a]; this.pl[b] = o.pl[a]; this.br[b] = o.br[a];
          for (let d = 0; d < 4; d++) this.rest[b * 4 + d] = o.rest[a * 4 + d];
        }
      }
    }
    for (let y = 0; y < this.gh; y++) {
      for (let x = 0; x < this.gw; x++) {
        const i = y * this.gw + x;
        if (x === this.gw - 1) this.lk[i] &= ~5;
        if (x === 0) this.lk[i] &= ~8;
        if (y === this.gh - 1) this.lk[i] &= ~14;
      }
    }
  }

  private resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.W = this.cv.clientWidth || 300;
    this.H = this.cv.clientHeight || 150;
    this.cv.width = this.W * this.dpr;
    this.cv.height = this.H * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.alloc(Math.max(1, Math.ceil(this.W / CELL)), Math.max(1, Math.ceil(this.H / CELL)));
  }

  private addNode(i: number, m: number, pn: boolean) {
    const x = i % this.gw, y = (i / this.gw) | 0;
    this.mt[i] = m + 1; this.X[i] = (x + 0.5) * CELL; this.Y[i] = (y + 0.5) * CELL;
    this.VX[i] = this.VY[i] = 0; this.pin[i] = pn ? 1 : 0; this.lk[i] = 0; this.pl[i] = 0; this.br[i] = 0;
    for (let d = 0; d < 4; d++) {
      const fx = x + DX[d], fy = y + DY[d], bx = x - DX[d], by = y - DY[d];
      if (fx >= 0 && fx < this.gw && fy < this.gh && this.mt[fy * this.gw + fx]) { this.lk[i] |= 1 << d; this.rest[i * 4 + d] = DL[d]; }
      if (bx >= 0 && bx < this.gw && by >= 0 && this.mt[by * this.gw + bx]) { const j = by * this.gw + bx; this.lk[j] |= 1 << d; this.rest[j * 4 + d] = DL[d]; }
    }
  }
  private removeNode(i: number) {
    const x = i % this.gw, y = (i / this.gw) | 0;
    this.mt[i] = 0; this.lk[i] = 0; this.pl[i] = 0; this.br[i] = 0; this.pin[i] = 0;
    for (let d = 0; d < 4; d++) { const bx = x - DX[d], by = y - DY[d]; if (bx >= 0 && bx < this.gw && by >= 0) this.lk[by * this.gw + bx] &= ~(1 << d); }
  }
  private freeNode(i: number) {
    if (this.debris.length < 700) this.debris.push({ x: this.X[i], y: this.Y[i], vx: this.VX[i], vy: this.VY[i], l: 0.7 + Math.random() * 0.9, c: MATS[this.mt[i] - 1].c, size: 4 });
    this.removeNode(i);
  }

  // ---------- simulation ----------
  private simNodes(h: number) {
    this.FX.fill(0); this.FY.fill(0); this.cn.fill(0);
    const g = this.gravity ? 500 : 0;
    for (let y = 0, i = 0; y < this.gh; y++) {
      for (let x = 0; x < this.gw; x++, i++) {
        const m = this.mt[i];
        if (!m || !this.lk[i]) continue;
        const A = MATS[m - 1];
        for (let d = 0; d < 4; d++) {
          if (!(this.lk[i] & (1 << d))) continue;
          const j = i + this.NO[d];
          const mj = this.mt[j];
          if (!mj) { this.lk[i] &= ~(1 << d); continue; }
          const B = MATS[mj - 1];
          const dx = this.X[j] - this.X[i], dy = this.Y[j] - this.Y[i];
          const L = Math.hypot(dx, dy) || 1e-3;
          const r = this.rest[i * 4 + d];
          const e = (L - r) / r;
          if (e > Math.min(A.t, B.t)) {
            this.lk[i] &= ~(1 << d);
            this.br[i] = this.br[j] = 1;
            this.torn++;
            this.sound.tear();
            continue;
          }
          this.cn[i]++; this.cn[j]++;
          const ux = dx / L, uy = dy / L;
          const f = (A.k + B.k) * 0.5 * (L - r) + 40 * ((this.VX[j] - this.VX[i]) * ux + (this.VY[j] - this.VY[i]) * uy);
          this.FX[i] += f * ux; this.FY[i] += f * uy; this.FX[j] -= f * ux; this.FY[j] -= f * uy;
          const yy = Math.min(A.y, B.y);
          if (e > yy) { this.rest[i * 4 + d] = r + (e - yy) * r * 0.2; this.pl[i] = this.pl[j] = 1; }
          else if (e < -yy) { this.rest[i * 4 + d] = Math.max(DL[d] * 0.5, r + (e + yy) * r * 0.2); this.pl[i] = this.pl[j] = 1; }
        }
      }
    }
    for (let i = 0; i < this.mt.length; i++) {
      const m = this.mt[i];
      if (!m) continue;
      if (this.br[i] && !this.cn[i]) { this.freeNode(i); continue; }
      if (this.pin[i]) { this.VX[i] = this.VY[i] = 0; continue; }
      const im = MATS[m - 1].im, k = 1 - 1.2 * h;
      this.VY[i] += g * im * 0.02 * h;
      this.VX[i] = (this.VX[i] + this.FX[i] * im * h) * k;
      this.VY[i] = (this.VY[i] + this.FY[i] * im * h) * k;
      this.X[i] += this.VX[i] * h; this.Y[i] += this.VY[i] * h;
    }
  }

  private tn = 0; private ths = 0;
  private touch(b: Bullet) {
    this.tn = 0; this.ths = 0;
    const pts: [number, number][] = b.cells ? (b.cp as [number, number][]) : [[0, 0]];
    const rc = (b.cells ? PC * 0.7 : b.r) + CELL * 0.55;
    const imb = 1 / b.m;
    for (const c of pts) {
      const cx = b.x + c[0], cy = b.y + c[1];
      const gx = Math.floor(cx / CELL), gy = Math.floor(cy / CELL);
      for (let y = gy - 3; y <= gy + 3; y++) {
        for (let x = gx - 3; x <= gx + 3; x++) {
          if (x < 0 || y < 0 || x >= this.gw || y >= this.gh) continue;
          const i = y * this.gw + x, m = this.mt[i];
          if (!m) continue;
          const dx = this.X[i] - cx, dy = this.Y[i] - cy, d2 = dx * dx + dy * dy;
          if (d2 >= rc * rc || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const imn = this.pin[i] ? 0 : MATS[m - 1].im;
          const vn = (this.VX[i] - b.vx) * nx + (this.VY[i] - b.vy) * ny;
          if (vn < 0) {
            const J = -vn / (imn + imb);
            this.VX[i] += J * imn * nx; this.VY[i] += J * imn * ny;
            b.vx -= J * imb * nx; b.vy -= J * imb * ny;
          }
          const pen = rc - d;
          if (imn) { this.X[i] += nx * pen * 0.6; this.Y[i] += ny * pen * 0.6; } else { b.x -= nx * pen; b.y -= ny * pen; }
          this.tn++; this.ths += MATS[m - 1].h;
        }
      }
    }
  }
  private refreshCp(b: Bullet) {
    const cells = b.cells as [number, number][];
    const s = Math.max(1, Math.ceil(cells.length / 100));
    b.cp = cells.filter((_, i) => i % s === 0);
  }
  private erode(b: Bullet, e: number) {
    if (b.cells) {
      const l = e * b.cells.length;
      let n = Math.floor(l) + (Math.random() < l % 1 ? 1 : 0);
      if (n > 0) {
        const ux = b.vx, uy = b.vy;
        b.cells.sort((a, c) => (c[0] * ux + c[1] * uy) - (a[0] * ux + a[1] * uy));
        b.cells.splice(0, n);
        b.m = b.cells.length * (b.mu as number);
        this.refreshCp(b);
      }
      if (!b.cells.length) { b.state = "gone"; b.status = "Shattered"; }
    } else {
      b.m = Math.max(0.8, b.m * (1 - e));
      if (b.h < 1) b.r = b.r0 * (1 + (1 - b.m / b.m0) * 0.9);
    }
  }

  private explode(b: Bullet) {
    if (b.exploded) return;
    b.exploded = true;
    const R = b.blast ?? 40, power = b.power ?? 2000;
    this.flashes.push({ x: b.x, y: b.y, r: 1, max: R * 1.1, c: "#ffcf7a" });
    this.sound.explosion();
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
      this.sparks.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, l: 0.3 + Math.random() * 0.4, c: Math.random() < 0.5 ? "#ffb04d" : "#ffe9b0", size: 2 + Math.random() * 2 });
    }
    const gx = Math.floor(b.x / CELL), gy = Math.floor(b.y / CELL);
    const cellR = Math.ceil(R / CELL) + 1;
    for (let y = gy - cellR; y <= gy + cellR; y++) {
      for (let x = gx - cellR; x <= gx + cellR; x++) {
        if (x < 0 || y < 0 || x >= this.gw || y >= this.gh) continue;
        const i = y * this.gw + x;
        const m = this.mt[i];
        if (!m) continue;
        const dx = this.X[i] - b.x, dy = this.Y[i] - b.y, d = Math.hypot(dx, dy) || 1e-3;
        if (d > R) continue;
        const falloff = 1 - d / R;
        if (!this.pin[i]) {
          const A = MATS[m - 1];
          const impulse = (power * falloff) / (A.h * 40 + 10);
          this.VX[i] += (dx / d) * impulse * 0.02;
          this.VY[i] += (dy / d) * impulse * 0.02;
        }
        if (d < R * 0.35 && Math.random() < 0.6 - A_h(m) * 0.15) this.freeNode(i);
      }
    }
    b.state = "gone";
    b.status = "Detonated";
  }

  private spawnPellets(sourceX: number, sourceY: number, dirX: number, dirY: number, speed: number, R: RoundDef) {
    const n = R.pellets ?? 8;
    const spread = R.spread ?? 0.25;
    const baseAngle = Math.atan2(dirY, dirX);
    for (let i = 0; i < n; i++) {
      const a = baseAngle + (Math.random() - 0.5) * spread;
      const sp = speed * (0.85 + Math.random() * 0.3);
      this.bullets.push({
        x: sourceX, y: sourceY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        m: R.m, m0: R.m, h: R.h, r: R.r, r0: R.r, c: R.c, trail: [],
        state: "fly", hit: false, free: 0, status: "In flight", type: "solid",
      });
    }
    if (this.bullets.length > 220) this.bullets.splice(0, this.bullets.length - 220);
  }

  private stepBullets(h: number) {
    for (const b of this.bullets) {
      if (b.state !== "fly") continue;
      const sp = Math.hypot(b.vx, b.vy);
      const n = Math.max(1, Math.ceil((sp * h) / 3));
      const hh = h / n;
      for (let k = 0; k < n && b.state === "fly"; k++) {
        if (this.gravity) b.vy += 260 * hh;
        b.x += b.vx * hh; b.y += b.vy * hh;
        if (b.x < -80 || b.x > this.W + 80 || b.y < -80 || b.y > this.H + 80) { b.state = "gone"; break; }
        this.touch(b);
        if (this.tn) {
          if (!b.hit) {
            b.hit = true; b.a0 = Math.atan2(b.vy, b.vx);
            this.sound.impact(Math.min(1, Math.hypot(b.vx, b.vy) / 1400));
            for (let s = 0; s < 8; s++) {
              const a = Math.random() * Math.PI * 2;
              this.sparks.push({ x: b.x, y: b.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, l: 0.15 + Math.random() * 0.2, c: "#ffd79a", size: 1.5 });
            }
          }
          if (b.type === "explosive") { this.explode(b); break; }
          b.free = 0; b.status = "Penetrating";
          this.erode(b, this.tn ? (this.ths / b.h) * 0.003 : 0);
          if (b.state === "fly" && Math.hypot(b.vx, b.vy) < 30) { b.state = "stuck"; b.status = "Stopped in armor"; b.vx = b.vy = 0; }
        } else {
          b.free += hh;
          if (b.hit && b.free > 0.02) {
            const a = Math.atan2(b.vy, b.vx) - (b.a0 ?? 0);
            const dv = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
            const was = b.status;
            b.status = dv > 0.5 ? "Ricochet" : "Went through";
            if (was !== b.status && b.status === "Ricochet") this.sound.bounce();
          }
        }
      }
    }
    // tally outcomes once
    for (const b of this.bullets) {
      if (b.counted) continue;
      if (b.status === "Went through" || b.status === "Ricochet" || b.status === "Stopped in armor" || b.status === "Shattered" || b.status === "Detonated") {
        b.counted = true;
        if (b.status === "Went through") this.through++;
        else if (b.status === "Ricochet") this.ricochets++;
        else if (b.status === "Stopped in armor") this.stopped++;
        else if (b.status === "Shattered") this.shattered++;
        else if (b.status === "Detonated") this.penetrations++;
      }
    }
  }

  private step(dt: number) {
    const h = dt / SUB;
    for (let s = 0; s < SUB; s++) { this.simNodes(h); this.stepBullets(h); }
    for (const b of this.bullets) if (b.state === "fly") { b.trail.push(b.x, b.y); if (b.trail.length > 48) b.trail.splice(0, 2); }
    this.bullets = this.bullets.filter((b) => b.state !== "gone");
    for (const d of this.debris) { d.vy += 700 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.l -= dt; }
    this.debris = this.debris.filter((d) => d.l > 0 && d.y < this.H + 20);
    for (const s of this.sparks) { s.vy += 300 * dt; s.vx *= 1 - 2 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.l -= dt; }
    this.sparks = this.sparks.filter((s) => s.l > 0);
    for (const f of this.flashes) f.r += (f.max - f.r) * 0.3;
    this.flashes = this.flashes.filter((f) => f.r < f.max * 0.98);
  }

  // ---------- painting / drafting ----------
  private paint(p: { x: number; y: number }, erase: boolean) {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), r = this.brush - 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 0.5) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= this.gw || y >= this.gh) continue;
        const i = y * this.gw + x;
        if (erase) { if (this.mt[i]) this.removeNode(i); } else if (!this.mt[i]) this.addNode(i, this.mat, this.pinOn);
      }
    }
  }
  private strokeLine(a: { x: number; y: number }, b: { x: number; y: number }, erase: boolean) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL * 0.6)));
    for (let i = 1; i <= n; i++) this.paint({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, erase);
  }
  private addDraft(p: { x: number; y: number }) {
    const rr = Math.max(1, Math.round(this.brush / 2));
    const cx = Math.floor(p.x / PC), cy = Math.floor(p.y / PC);
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) if (dx * dx + dy * dy <= rr * rr + 0.5) this.draft!.set((cx + dx) + "," + (cy + dy), [cx + dx, cy + dy]);
  }
  private strokeDraft(a: { x: number; y: number }, b: { x: number; y: number }) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / PC));
    for (let i = 1; i <= n; i++) this.addDraft({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  }
  private finalizeDraft() {
    const pts = [...this.draft!.values()];
    if (!pts.length) return;
    let sx = 0, sy = 0;
    pts.forEach((q) => { sx += (q[0] + 0.5) * PC; sy += (q[1] + 0.5) * PC; });
    sx /= pts.length; sy /= pts.length;
    const cells: [number, number][] = pts.map((q) => [(q[0] + 0.5) * PC - sx, (q[1] + 0.5) * PC - sy]);
    const br2 = Math.max(...cells.map((c) => Math.hypot(c[0], c[1]))) + PC;
    const R = ROUNDS[this.rnd];
    const mu = R.m / 10;
    const b: Bullet = {
      x: sx, y: sy, vx: 0, vy: 0, cells, mu, m: cells.length * mu, m0: cells.length * mu,
      h: R.h, r: br2, r0: br2, c: R.c, trail: [], state: "ready", hit: false, free: 0, status: "Ready to fling", type: R.type, blast: R.blast, power: R.power,
    };
    this.refreshCp(b);
    this.bullets.push(b);
    this.tool = 3;
  }
  private pick(p: { x: number; y: number }): Bullet | null {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (b.state === "ready" && Math.hypot(p.x - b.x, p.y - b.y) <= b.r + 8) return b;
    }
    return null;
  }
  private fire(s: { ax: number; ay: number; cx: number; cy: number; b: Bullet | null }) {
    const dx = s.ax - s.cx, dy = s.ay - s.cy, d = Math.hypot(dx, dy);
    if (d < 10) return;
    const sp = Math.min(d * 8, 2800);
    const R = ROUNDS[this.rnd];
    this.shots++;
    this.sound.fire();
    if (s.b) { s.b.vx = (dx / d) * sp; s.b.vy = (dy / d) * sp; s.b.state = "fly"; s.b.status = "In flight"; return; }
    if (R.type === "buckshot") { this.spawnPellets(s.ax, s.ay, dx / d, dy / d, sp, R); return; }
    this.bullets.push({
      x: s.ax, y: s.ay, vx: (dx / d) * sp, vy: (dy / d) * sp, m: R.m, m0: R.m, h: R.h, r: R.r, r0: R.r, c: R.c,
      trail: [], state: "fly", hit: false, free: 0, status: "In flight", type: R.type, blast: R.blast, power: R.power,
    });
    if (this.bullets.length > 60) this.bullets.shift();
  }

  private pos(e: PointerEvent) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private onDown = (e: PointerEvent) => {
    this.cv.setPointerCapture(e.pointerId);
    const p = this.pos(e);
    this.rmb = e.button === 2;
    this.down = true;
    if (this.tool === 3 && !this.rmb) {
      const hb = this.pick(p);
      this.sling = hb ? { ax: hb.x, ay: hb.y, cx: p.x, cy: p.y, b: hb } : { ax: p.x, ay: p.y, cx: p.x, cy: p.y, b: null };
    } else if (this.tool === 2 && !this.rmb) {
      this.draft = new Map(); this.last = p; this.addDraft(p);
    } else {
      this.last = p; this.paint(p, this.tool === 1 || this.rmb);
      if (this.tool === 1 || this.rmb) this.bullets = this.bullets.filter((b) => !(b.state === "ready" && Math.hypot(p.x - b.x, p.y - b.y) < b.r + 6));
    }
  };
  private onMove = (e: PointerEvent) => {
    const p = this.pos(e);
    this.mouse = p;
    if (!this.down) return;
    if (this.sling) { this.sling.cx = p.x; this.sling.cy = p.y; }
    else if (this.draft) { this.strokeDraft(this.last!, p); this.last = p; }
    else { this.strokeLine(this.last!, p, this.tool === 1 || this.rmb); this.last = p; }
  };
  private onUp = () => {
    this.down = false;
    if (this.draft) { this.finalizeDraft(); this.draft = null; }
    if (this.sling) { this.fire(this.sling); this.sling = null; }
  };
  private onLeave = () => { if (!this.down) this.mouse = null; };

  // ---------- rendering ----------
  private render() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.fillStyle = this.field; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = this.gridc;
    for (let x = CELL * 10; x < W; x += CELL * 10) ctx.fillRect(x, 0, 1, H);
    for (let y = CELL * 10; y < H; y += CELL * 10) ctx.fillRect(0, y, W, 1);

    const P: Path2D[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(() => new Path2D());
    const o = CELL / 2;
    let solid = 0;
    for (let i = 0; i < this.mt.length; i++) {
      const m = this.mt[i];
      if (!m) continue;
      solid++;
      const idx = this.pin[i] ? 10 : (m - 1) * 2 + this.pl[i];
      P[idx].rect(this.X[i] - o, this.Y[i] - o, CELL + 0.6, CELL + 0.6);
    }
    const fs: string[] = [];
    MATS.forEach((mt) => { fs.push(mt.c, mt.hot); });
    fs.push(this.pinc);
    P.forEach((p, i) => { ctx.fillStyle = fs[i]; ctx.fill(p); });

    for (const f of this.flashes) {
      const a = 1 - f.r / f.max;
      ctx.globalAlpha = Math.max(0, a * 0.8);
      ctx.fillStyle = f.c;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const d of this.debris) { ctx.globalAlpha = Math.min(1, d.l * 2); ctx.fillStyle = d.c; ctx.fillRect(d.x - 2, d.y - 2, 4, 4); }
    for (const s of this.sparks) { ctx.globalAlpha = Math.min(1, s.l * 3); ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;

    for (const b of this.bullets) {
      if (b.trail.length > 3 && b.state === "fly") {
        ctx.strokeStyle = b.c; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(b.trail[0], b.trail[1]);
        for (let i = 2; i < b.trail.length; i += 2) ctx.lineTo(b.trail[i], b.trail[i + 1]);
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = b.c; ctx.globalAlpha = b.state === "fly" ? 1 : 0.7;
      if (b.cells) { for (const c of b.cells) ctx.fillRect(b.x + c[0] - PC / 2, b.y + c[1] - PC / 2, PC, PC); }
      else { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (b.state === "ready") {
        ctx.strokeStyle = this.accent; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    if (this.draft) { ctx.fillStyle = ROUNDS[this.rnd].c; for (const q of this.draft.values()) ctx.fillRect(q[0] * PC, q[1] * PC, PC, PC); }

    if (this.sling) {
      const dx = this.sling.ax - this.sling.cx, dy = this.sling.ay - this.sling.cy, d = Math.hypot(dx, dy), sp = Math.min(d * 8, 2800);
      ctx.strokeStyle = this.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(this.sling.cx, this.sling.cy); ctx.lineTo(this.sling.ax, this.sling.ay); ctx.stroke();
      if (d > 10) {
        ctx.setLineDash([4, 6]); ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(this.sling.ax, this.sling.ay); ctx.lineTo(this.sling.ax + (dx / d) * sp * 0.25, this.sling.ay + (dy / d) * sp * 0.25); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      if (!this.sling.b) { ctx.fillStyle = ROUNDS[this.rnd].c; ctx.beginPath(); ctx.arc(this.sling.ax, this.sling.ay, ROUNDS[this.rnd].r, 0, 7); ctx.fill(); }
      ctx.fillStyle = this.accent; ctx.font = "12px system-ui"; ctx.fillText(Math.round(sp * 0.5) + " m/s", this.sling.cx + 10, this.sling.cy - 10);
    } else if (this.mouse && this.tool < 3) {
      ctx.strokeStyle = this.muted; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.mouse.x, this.mouse.y, this.tool === 2 ? Math.max(1, Math.round(this.brush / 2)) * PC + 1.5 : (this.brush - 0.5) * CELL + 1, 0, 7);
      ctx.stroke();
    }

    ctx.font = "14px system-ui"; ctx.fillStyle = this.muted;
    if (!solid && !this.bullets.length) ctx.fillText("Draw armor, then draw or pick a round and drag on the canvas to fire.", 16, H - 18);
    if (this.paused) { ctx.fillStyle = this.accent; ctx.fillText("Paused — press Space to resume.", 16, 26); }
  }

  private lastT = performance.now();
  private loop = (t: number) => {
    const dt = Math.min(0.033, (t - this.lastT) / 1000);
    this.lastT = t;
    this.fpsAcc += dt; this.fpsCount++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsCount / this.fpsAcc; this.fpsAcc = 0; this.fpsCount = 0; }
    if (!this.paused) this.step(dt * this.ts);
    this.render();

    this.statsTimer += dt;
    if (this.statsTimer > 0.12 && this.statsCb) {
      this.statsTimer = 0;
      const last = this.bullets[this.bullets.length - 1];
      let nodes = 0;
      for (let i = 0; i < this.mt.length; i++) if (this.mt[i]) nodes++;
      this.statsCb({
        speedMps: last ? Math.round(Math.hypot(last.vx, last.vy) * 0.5) : 0,
        torn: this.torn,
        status: last ? last.status : "None yet",
        shots: this.shots, penetrations: this.penetrations, ricochets: this.ricochets,
        stopped: this.stopped, through: this.through, shattered: this.shattered,
        nodes, fps: Math.round(this.fps),
      });
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // ---------- public API ----------
  setTool(t: ToolId) { this.tool = t; }
  setMaterial(i: number) { this.mat = i; }
  setRound(i: number) { this.rnd = i; }
  setBrush(n: number) { this.brush = n; }
  setPin(b: boolean) { this.pinOn = b; }
  setPaused(b: boolean) { this.paused = b; }
  togglePaused() { this.paused = !this.paused; return this.paused; }
  setSpeed(n: number) { this.ts = n; }
  setGravity(b: boolean) { this.gravity = b; }
  setMuted(b: boolean) { this.sound.muted = b; }

  clear() {
    this.mt.fill(0); this.pin.fill(0); this.lk.fill(0); this.pl.fill(0); this.br.fill(0);
    this.bullets = []; this.debris = []; this.sparks = []; this.flashes = [];
    this.torn = 0; this.shots = 0; this.penetrations = 0; this.ricochets = 0; this.stopped = 0; this.through = 0; this.shattered = 0;
  }

  preset(name: string) {
    this.clear();
    const plate = (x0: number, w: number, m: number, pinEdges = true) => {
      const y0 = Math.floor((this.H * 0.18) / CELL), y1 = Math.floor((this.H * 0.82) / CELL);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x0 + w; x++) if (x < this.gw && y < this.gh && !this.mt[y * this.gw + x]) this.addNode(y * this.gw + x, m, pinEdges && (y < y0 + 2 || y >= y1 - 2));
    };
    const x0 = Math.floor((this.W * 0.6) / CELL);
    if (name === "steel") plate(x0, 7, 0);
    else if (name === "composite") { plate(x0, 5, 0); plate(x0 + 9, 3, 2); }
    else if (name === "spaced") { plate(x0, 3, 0); plate(x0 + 10, 5, 0); }
    else if (name === "kevlar") { plate(x0, 10, 3); }
    else if (name === "reactive") { plate(x0, 3, 1); plate(x0 + 7, 2, 2); plate(x0 + 13, 4, 0); }
    else if (name === "rubble") {
      const y0 = Math.floor((this.H * 0.15) / CELL), y1 = Math.floor((this.H * 0.85) / CELL);
      for (let y = y0; y < y1; y++) for (let x = x0 - 4; x < this.gw; x++) {
        if (x >= 0 && x < this.gw && y < this.gh && Math.random() < 0.82) this.addNode(y * this.gw + x, Math.floor(Math.random() * 3), Math.random() < 0.08);
      }
    }
  }

  save(): boolean {
    try {
      const armor: number[] = [];
      const pinned: number[] = [];
      for (let i = 0; i < this.mt.length; i++) if (this.mt[i]) { armor.push(i, this.mt[i]); if (this.pin[i]) pinned.push(i); }
      localStorage.setItem(SAVE_KEY, JSON.stringify({ gw: this.gw, gh: this.gh, armor, pinned }));
      return true;
    } catch { return false; }
  }
  load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as { gw: number; gh: number; armor: number[]; pinned: number[] };
      this.clear();
      const pinSet = new Set(data.pinned);
      for (let k = 0; k < data.armor.length; k += 2) {
        const oldIdx = data.armor[k], m = data.armor[k + 1];
        const x = oldIdx % data.gw, y = (oldIdx / data.gw) | 0;
        if (x < this.gw && y < this.gh) this.addNode(y * this.gw + x, m - 1, pinSet.has(oldIdx));
      }
      return true;
    } catch { return false; }
  }
}

function A_h(m: number) { return MATS[m - 1]?.h ?? 1; }
