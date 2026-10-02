import { easeOutBack, easeOutCubic, H, place, resetView, W } from "./math";
import { PALETTE as P } from "./palette";
import { makeSprite, type Sprite } from "./sprites";

/*
 * Shared HUD and "juice" pieces for both games. Plates are baked once (gradient, lit top
 * edge, tinted shadow): per frame a plate is one drawImage, never a path fill.
 */

/** Raised glass plate matching the menu `.panel` style. */
export function makePlate(w: number, h: number, r: number, accent: string | null = null): Sprite {
  const pad = 30;
  return makeSprite(
    w + pad * 2,
    h + pad * 2,
    (ctx) => {
      ctx.translate(pad, pad);
      ctx.shadowColor = "rgba(0,22,9,0.7)";
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 12;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, r);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(18,78,38,0.86)");
      g.addColorStop(1, "rgba(3,28,13,0.9)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowColor = "transparent";
      // Lit top edge and hairline: reads as a physical panel, not a flat box.
      ctx.save();
      ctx.clip();
      const hl = ctx.createLinearGradient(0, 0, 0, h * 0.5);
      hl.addColorStop(0, "rgba(220,255,225,0.16)");
      hl.addColorStop(1, "rgba(220,255,225,0)");
      ctx.fillStyle = hl;
      ctx.fillRect(0, 0, w, h * 0.5);
      if (accent) {
        ctx.fillStyle = accent;
        ctx.fillRect(0, h * 0.22, 7, h * 0.56);
      }
      ctx.restore();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(220,255,225,0.16)";
      ctx.stroke();
    },
    pad,
    pad,
  );
}

/**
 * Draws a baked plate with its top-left at (x, y) in HUD space. `cheap` (low quality) is a
 * flat fill of the plate area: the baked sprite's soft shadow margin is a large blend on
 * software-rasterised devices.
 */
export function drawPlate(ctx: CanvasRenderingContext2D, p: Sprite, x: number, y: number, cheap = false) {
  resetView(ctx, true);
  if (!cheap) return ctx.drawImage(p.canvas, x - p.cx, y - p.cy);
  ctx.fillStyle = "rgba(5,36,17,0.78)";
  ctx.beginPath();
  ctx.roundRect(x, y, p.w - 2 * p.cx, p.h - 2 * p.cy, 34);
  ctx.fill();
}

/** Glowing pill for the multiplier ("x3"), baked per level so drawing it is one blit. */
export function makeChip(text: string, font: string, color: string = P.bright): Sprite {
  const w = 170;
  const h = 96;
  const pad = 26;
  return makeSprite(w + pad * 2, h + pad * 2, (ctx) => {
    ctx.translate(pad, pad);
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h / 2);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#7dff6a");
    g.addColorStop(0.5, color);
    g.addColorStop(1, "#0a6e12");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(h / 2, 6, w - h, 3);
    ctx.fillStyle = P.ink;
    ctx.font = `800 66px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

/** Big number with a pop (scale) and a warm flash when it just went up. */
export function drawNumber(ctx: CanvasRenderingContext2D, font: string, text: string, x: number, y: number, size: number, bump: number, align: CanvasTextAlign = "left") {
  // bump: 1 right after a gain, decays to 0.
  const s = 1 + 0.14 * easeOutBack(Math.min(1, bump * 1.3)) * bump;
  place(ctx, x, y, s);
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${size}px ${font}`;
  ctx.fillStyle = bump > 0.05 ? mix(P.cream, P.gold, Math.min(1, bump * 1.6)) : P.cream;
  ctx.fillText(text, 0, 0);
}

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

/** Soft red edge vignette (hazard hits, final seconds): baked, so a pulse costs one blit. */
export function makeEdgeGlow(color: string): Sprite {
  // Quarter-size and stretched when drawn; an ellipse so the glow hugs all four edges.
  const w = W / 4;
  const h = H / 4;
  return makeSprite(w, h, (ctx) => {
    ctx.scale(1, h / w);
    const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.36, w / 2, w / 2, w * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/**
 * Pooled one-shot effects: expanding rings and "flyers" that travel from a catch to the
 * score plate (the score visibly receives the points). Fixed slots, no allocation.
 */
type Ring = { t: number; dur: number; x: number; y: number; size: number; alpha: number; sprite: Sprite | null };
type Flyer = { t: number; dur: number; x0: number; y0: number; x1: number; y1: number; sprite: Sprite | null; size: number; onArrive: (() => void) | null };

export class Juice {
  private rings: Ring[] = Array.from({ length: 8 }, () => ({ t: 1, dur: 1, x: 0, y: 0, size: 1, alpha: 1, sprite: null }));
  private flyers: Flyer[] = Array.from({ length: 10 }, () => ({ t: 1, dur: 1, x0: 0, y0: 0, x1: 0, y1: 0, sprite: null, size: 1, onArrive: null }));
  private ri = 0;
  private fi = 0;

  ring(sprite: Sprite, x: number, y: number, size: number, dur = 0.45, alpha = 0.9) {
    const r = this.rings[this.ri];
    this.ri = (this.ri + 1) % this.rings.length;
    Object.assign(r, { t: 0, dur, x, y, size, alpha, sprite });
  }

  fly(sprite: Sprite, x0: number, y0: number, x1: number, y1: number, size = 0.8, dur = 0.42, onArrive: (() => void) | null = null) {
    const f = this.flyers[this.fi];
    this.fi = (this.fi + 1) % this.flyers.length;
    // A recycled flyer still in flight delivers its effect now rather than never.
    if (f.t < f.dur) f.onArrive?.();
    Object.assign(f, { t: 0, dur, x0, y0, x1, y1, sprite, size, onArrive });
  }

  update(dt: number) {
    for (const r of this.rings) r.t += dt;
    for (const f of this.flyers) {
      if (f.t >= f.dur) continue;
      f.t += dt;
      if (f.t >= f.dur) f.onArrive?.();
    }
  }

  /** Additive; call with the HUD (screen) transform state. */
  render(ctx: CanvasRenderingContext2D) {
    for (const r of this.rings) {
      if (r.t >= r.dur || !r.sprite) continue;
      const k = r.t / r.dur;
      ctx.globalAlpha = r.alpha * (1 - k) ** 1.4;
      place(ctx, r.x, r.y, r.size * (0.25 + 0.75 * easeOutCubic(k)));
      ctx.drawImage(r.sprite.canvas, -r.sprite.cx, -r.sprite.cy);
    }
    for (const f of this.flyers) {
      if (f.t >= f.dur || !f.sprite) continue;
      const k = f.t / f.dur;
      // Ease-in along a slight arc: leaves gently, arrives fast.
      const e = k * k;
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(k * Math.PI) * 120;
      ctx.globalAlpha = 0.5 + 0.5 * k;
      place(ctx, x, y, f.size * (1 - 0.45 * k), k * 6);
      ctx.drawImage(f.sprite.canvas, -f.sprite.cx, -f.sprite.cy);
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    for (const r of this.rings) r.t = r.dur;
    for (const f of this.flyers) f.t = f.dur;
  }
}
