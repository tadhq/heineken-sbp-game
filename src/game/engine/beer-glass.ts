import { clamp, damp } from "./math";
import { makeSprite, type Sprite, starPath } from "./sprites";

/*
 * Lightweight 2.5D beer: no fluid simulation. The liquid is one polygon (a wavy surface
 * that tilts against the glass's motion, spring-driven) filled with baked gradients, a
 * foam band riding the surface and a few rising bubbles, all drawn into a small offscreen
 * canvas and clipped to the glass interior with one `destination-in` blit. The glass art
 * is drawn on top, so its own highlights and logo sit over the beer like real glass.
 */

/** Glass art plus its interior, measured from the art itself so any glass image works. */
export type GlassArt = {
  /** Anchor at the centre of the base. */
  sprite: Sprite;
  /** Interior silhouette (opaque inside), same size as the sprite. */
  mask: HTMLCanvasElement;
  /** Inner half-width at the mouth: the catch opening. */
  mouthHalf: number;
  /** Mouth height above the base (px). */
  rimHeight: number;
  /** Liquid limits in sprite coordinates: surface at 100% and the inner floor. */
  innerTop: number;
  innerFloor: number;
};

// Measured on the supplied Heineken pint glass (alpha profile per row, see GAME_DESIGN.md):
// rim band ~4% of the height, thick base from ~86%, walls ~3.5% of the width.
const RIM = 0.045;
const FLOOR = 0.855;
const WALL = 0.036;

/** Bakes the glass at `height` px and derives its interior from the art's alpha. */
export function makeGlassArt(src: CanvasImageSource, srcW: number, srcH: number, height: number): GlassArt {
  const h = Math.round(height);
  const w = Math.round((srcW / srcH) * h);
  const sprite = makeSprite(
    w,
    h,
    (ctx) => {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, w, h);
    },
    w / 2,
    h,
  );
  // Outline per row: first and last pixel that is clearly glass (walls are far more opaque
  // than the clear body, so this traces the silhouette, not the logo).
  const data = sprite.canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
  const left = new Float32Array(h);
  const right = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        if (l < 0) l = x;
        r = x;
      }
    }
    left[y] = l < 0 ? w * 0.1 : l;
    right[y] = r < 0 ? w * 0.9 : r;
  }
  const innerTop = Math.round(h * RIM);
  const innerFloor = Math.round(h * FLOOR);
  const wall = w * WALL;
  const mask = makeSprite(w, h, (ctx) => {
    ctx.beginPath();
    for (let y = innerTop; y <= innerFloor; y += 3) ctx.lineTo(left[y] + wall, y);
    // Rounded inner floor, as in a real pint glass.
    const lf = left[innerFloor] + wall;
    const rf = right[innerFloor] - wall;
    ctx.quadraticCurveTo((lf + rf) / 2, innerFloor + h * 0.03, rf, innerFloor);
    for (let y = innerFloor; y >= innerTop; y -= 3) ctx.lineTo(right[y] - wall, y);
    ctx.closePath();
    ctx.fillStyle = "#000";
    ctx.fill();
  }).canvas;
  return { sprite, mask, mouthHalf: (right[innerTop] - left[innerTop]) / 2 - wall, rimHeight: h - innerTop, innerTop, innerFloor };
}

const SEGMENTS = 12;
const BUBBLES = 12;

export class BeerGlass {
  /** Shown level 0-1 (eases toward `level`). */
  shown = 0;
  level = 0;
  /** Foam boost while the glass is full (0-1). */
  crown = 0;
  private buf: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private body: CanvasGradient;
  private shade: CanvasGradient;
  private foam: CanvasGradient;
  private slosh = 0;
  private sloshV = 0;
  private amp = 0;
  private phase = 0;
  private bubbles = Array.from({ length: BUBBLES }, (_, i) => ({ x: 0, y: 0, v: 0, s: 0, seed: i }));
  private bubble: Sprite;
  detail = true;

  constructor(private art: GlassArt) {
    const { w, h } = art.sprite;
    this.buf = document.createElement("canvas");
    this.buf.width = Math.ceil(w);
    this.buf.height = Math.ceil(h);
    this.ctx = this.buf.getContext("2d")!;
    const c = this.ctx;
    // Lager: deep amber at the walls, golden and lit in the middle, a bright streak left
    // of centre where the light passes through.
    this.body = c.createLinearGradient(0, 0, w, 0);
    this.body.addColorStop(0, "#8a4d05");
    this.body.addColorStop(0.2, "#d98c12");
    this.body.addColorStop(0.32, "#ffd25e");
    this.body.addColorStop(0.42, "#f2ab25");
    this.body.addColorStop(0.75, "#d28511");
    this.body.addColorStop(1, "#7a4204");
    this.shade = c.createLinearGradient(0, art.innerTop, 0, art.innerFloor + 20);
    this.shade.addColorStop(0, "rgba(255,240,180,0.18)");
    this.shade.addColorStop(0.5, "rgba(120,60,0,0)");
    this.shade.addColorStop(1, "rgba(70,30,0,0.45)");
    this.foam = c.createLinearGradient(0, 0, w, 0);
    this.foam.addColorStop(0, "#e9dcc0");
    this.foam.addColorStop(0.35, "#fffaf0");
    this.foam.addColorStop(1, "#ddd0b4");
    this.bubble = makeSprite(10, 10, (b) => {
      b.beginPath();
      b.arc(5, 5, 3.6, 0, Math.PI * 2);
      b.fillStyle = "rgba(255,248,215,0.75)";
      b.fill();
    });
    for (const p of this.bubbles) this.resetBubble(p, true);
  }

  get canvas() {
    return this.buf;
  }

  /** Splash: kicks the surface (catches, bumps). */
  impulse(k: number) {
    this.amp = Math.min(14, this.amp + k);
    this.sloshV += (Math.random() - 0.5) * k * 0.02;
  }

  /** `accel` is the glass's horizontal acceleration (px/s²); `tilt` its lean (rad). */
  update(dt: number, accel: number, tilt: number) {
    this.shown += (this.level - this.shown) * damp(7, dt);
    // Surface lags the glass: a damped spring driven by acceleration, tipped against the lean.
    const target = clamp(-accel * 0.000045, -0.32, 0.32) - tilt;
    this.sloshV += ((target - this.slosh) * 90 - this.sloshV * 7) * dt;
    this.slosh += this.sloshV * dt;
    this.amp = Math.max(1.2 + this.crown * 2, this.amp - this.amp * 2.4 * dt);
    this.phase += dt * (5 + this.crown * 5);
    if (!this.detail) return;
    const a = this.art;
    const surface = a.innerFloor - this.shown * (a.innerFloor - a.innerTop);
    for (const p of this.bubbles) {
      p.y -= p.v * dt;
      p.x += Math.sin(this.phase * 0.7 + p.seed) * 6 * dt;
      if (p.y < surface + 10) this.resetBubble(p, false);
    }
  }

  private resetBubble(p: { x: number; y: number; v: number; s: number; seed: number }, anywhere: boolean) {
    const a = this.art;
    const w = a.sprite.w;
    p.x = w * (0.3 + Math.random() * 0.4);
    p.y = anywhere ? a.innerTop + Math.random() * (a.innerFloor - a.innerTop) : a.innerFloor - Math.random() * 20;
    p.v = 40 + Math.random() * 70;
    p.s = 0.45 + Math.random() * 0.6;
  }

  /** Redraws the liquid into the offscreen canvas. Returns false when there is nothing to draw. */
  draw(): boolean {
    const a = this.art;
    const c = this.ctx;
    const w = a.sprite.w;
    const h = a.sprite.h;
    if (this.shown < 0.004 && this.crown <= 0) return false;
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.clearRect(0, 0, w, h);
    const level = a.innerFloor - this.shown * (a.innerFloor - a.innerTop);
    const slope = Math.tan(this.slosh);
    const surf = (i: number) => {
      const x = (i / SEGMENTS) * w;
      return level + slope * (x - w / 2) + Math.sin(this.phase + i * 0.95) * this.amp * 0.5 + Math.sin(this.phase * 1.7 - i * 0.6) * this.amp * 0.3;
    };
    // Liquid body
    c.beginPath();
    c.moveTo(0, h);
    for (let i = 0; i <= SEGMENTS; i++) c.lineTo((i / SEGMENTS) * w, surf(i));
    c.lineTo(w, h);
    c.closePath();
    c.fillStyle = this.body;
    c.fill();
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = this.shade;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "source-over";
    if (this.detail) {
      for (const p of this.bubbles) {
        if (p.y < level + 8) continue;
        c.globalAlpha = 0.35 + 0.4 * p.s;
        c.drawImage(this.bubble.canvas, p.x - 5 * p.s, p.y - 5 * p.s, 10 * p.s, 10 * p.s);
      }
      c.globalAlpha = 1;
    }
    // Foam head riding the surface; thicker when the glass is full.
    const foamH = (6 + 16 * Math.min(1, this.shown * 1.6)) * (1 + this.crown * 0.9);
    c.beginPath();
    for (let i = 0; i <= SEGMENTS; i++) c.lineTo((i / SEGMENTS) * w, surf(i) - foamH - Math.sin(this.phase * 1.3 + i * 1.7) * 2.2);
    for (let i = SEGMENTS; i >= 0; i--) c.lineTo((i / SEGMENTS) * w, surf(i) + 3);
    c.closePath();
    c.fillStyle = this.foam;
    c.fill();
    // Lit foam top edge
    c.beginPath();
    for (let i = 0; i <= SEGMENTS; i++) c.lineTo((i / SEGMENTS) * w, surf(i) - foamH - Math.sin(this.phase * 1.3 + i * 1.7) * 2.2 + 2);
    c.strokeStyle = "rgba(255,255,255,0.8)";
    c.lineWidth = 2;
    c.stroke();
    // Clip everything to the glass interior.
    c.globalCompositeOperation = "destination-in";
    c.drawImage(a.mask, 0, 0);
    c.globalCompositeOperation = "source-over";
    return true;
  }
}

/** Drawn pint glass with the red star emblem: fallback when the glass photo fails to load. */
export function drawnGlass(): Sprite {
  const RIM_HALF = 104;
  const GLASS_H = 250;
  const w = 240;
  const h = GLASS_H + 40;
  return makeSprite(
    w,
    h,
    (ctx) => {
      const cx = w / 2;
      const top = 22;
      const bottom = h - 6;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(cx - RIM_HALF, top);
        ctx.bezierCurveTo(cx - RIM_HALF + 4, top + 120, cx - 66, bottom - 90, cx - 70, bottom - 16);
        ctx.lineTo(cx - 72, bottom);
        ctx.lineTo(cx + 72, bottom);
        ctx.lineTo(cx + 70, bottom - 16);
        ctx.bezierCurveTo(cx + 66, bottom - 90, cx + RIM_HALF - 4, top + 120, cx + RIM_HALF, top);
        ctx.closePath();
      };
      path();
      const body = ctx.createLinearGradient(cx - RIM_HALF, 0, cx + RIM_HALF, 0);
      body.addColorStop(0, "rgba(220,255,225,0.34)");
      body.addColorStop(0.18, "rgba(200,240,210,0.1)");
      body.addColorStop(0.7, "rgba(160,220,170,0.08)");
      body.addColorStop(1, "rgba(220,255,225,0.3)");
      ctx.fillStyle = body;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(235,255,240,0.75)";
      ctx.stroke();
      // Thick glass base
      const base = ctx.createLinearGradient(0, bottom - 22, 0, bottom);
      base.addColorStop(0, "rgba(220,255,230,0.15)");
      base.addColorStop(1, "rgba(220,255,230,0.55)");
      ctx.fillStyle = base;
      ctx.fillRect(cx - 70, bottom - 22, 140, 22);
      // Specular streaks
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx - RIM_HALF + 22, top + 30);
      ctx.bezierCurveTo(cx - RIM_HALF + 24, top + 120, cx - 62, bottom - 110, cx - 58, bottom - 40);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.moveTo(cx + RIM_HALF - 26, top + 40);
      ctx.lineTo(cx + 62, bottom - 60);
      ctx.stroke();
      // Rim ellipse = top of a 3D glass
      ctx.beginPath();
      ctx.ellipse(cx, top, RIM_HALF, 16, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10,40,20,0.35)";
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(245,255,248,0.9)";
      ctx.stroke();
      // Emblem
      starPath(ctx, cx, top + 62, 26);
      ctx.fillStyle = "#e3000f";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.stroke();
    },
    w / 2,
    h,
  );
}
