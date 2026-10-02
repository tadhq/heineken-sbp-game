import { place } from "./math";
import type { Sprite } from "./sprites";

/**
 * Fixed-capacity particle pool in typed arrays: zero allocations while playing, so no
 * garbage-collection pauses mid-game. Dead particles are swapped with the last live one.
 */
export class Particles {
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private grav: Float32Array;
  private spin: Float32Array;
  private rot: Float32Array;
  private sprite: Uint8Array;
  private count = 0;

  constructor(
    private readonly capacity: number,
    private readonly sprites: Sprite[],
    /** Effective cap; lowered in low-quality mode without reallocating. */
    public limit = capacity,
  ) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.sprite = new Uint8Array(capacity);
  }

  /** Radial burst. `spriteIndex` picks from the sprites passed to the constructor. */
  burst(x: number, y: number, n: number, spriteIndex: number, speed: number, opts: { life?: number; size?: number; gravity?: number; up?: number } = {}) {
    const life = opts.life ?? 0.7;
    const size = opts.size ?? 1;
    for (let i = 0; i < n && this.count < Math.min(this.limit, this.capacity); i++) {
      const k = this.count++;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.x[k] = x;
      this.y[k] = y;
      this.vx[k] = Math.cos(a) * s;
      this.vy[k] = Math.sin(a) * s - (opts.up ?? 0);
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.4);
      this.size[k] = size * (0.6 + Math.random() * 0.6);
      this.grav[k] = opts.gravity ?? 900;
      this.spin[k] = (Math.random() - 0.5) * 10;
      this.rot[k] = Math.random() * Math.PI;
      this.sprite[k] = spriteIndex;
    }
  }

  update(dt: number) {
    for (let k = 0; k < this.count; ) {
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        const last = --this.count;
        this.x[k] = this.x[last];
        this.y[k] = this.y[last];
        this.vx[k] = this.vx[last];
        this.vy[k] = this.vy[last];
        this.life[k] = this.life[last];
        this.maxLife[k] = this.maxLife[last];
        this.size[k] = this.size[last];
        this.grav[k] = this.grav[last];
        this.spin[k] = this.spin[last];
        this.rot[k] = this.rot[last];
        this.sprite[k] = this.sprite[last];
        continue;
      }
      this.vy[k] += this.grav[k] * dt;
      this.vx[k] *= 0.985;
      this.x[k] += this.vx[k] * dt;
      this.y[k] += this.vy[k] * dt;
      this.rot[k] += this.spin[k] * dt;
      k++;
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    for (let k = 0; k < this.count; k++) {
      const t = this.life[k] / this.maxLife[k];
      const sp = this.sprites[this.sprite[k]];
      const s = this.size[k] * (0.4 + 0.6 * t);
      ctx.globalAlpha = t < 0.5 ? t * 2 : 1;
      place(ctx, this.x[k], this.y[k], s, this.rot[k]);
      ctx.drawImage(sp.canvas, -sp.cx, -sp.cy);
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    this.count = 0;
  }

  get active() {
    return this.count;
  }
}
