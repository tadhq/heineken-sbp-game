import { easeOutBack, place } from "./math";

type Popup = { active: boolean; text: string; x: number; y: number; t: number; dur: number; color: string; size: number; rise: number };

/** Pooled floating text ("+10", "PERFECT!"). Fixed slot count: oldest is recycled. */
export class Popups {
  private pool: Popup[];
  private next = 0;

  constructor(
    slots: number,
    private readonly font: string,
  ) {
    this.pool = Array.from({ length: slots }, () => ({ active: false, text: "", x: 0, y: 0, t: 0, dur: 1, color: "#fff", size: 48, rise: 120 }));
  }

  show(text: string, x: number, y: number, color: string, size = 56, dur = 0.9, rise = 140) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.active = true;
    p.text = text;
    p.x = x;
    p.y = y;
    p.t = 0;
    p.dur = dur;
    p.color = color;
    p.size = size;
    p.rise = rise;
  }

  update(dt: number) {
    for (const p of this.pool) if (p.active && (p.t += dt) >= p.dur) p.active = false;
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const p of this.pool) {
      if (!p.active) continue;
      const k = p.t / p.dur;
      const pop = k < 0.25 ? easeOutBack(k / 0.25) : 1;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      place(ctx, p.x, p.y - p.rise * Math.sqrt(k), pop);
      ctx.font = `800 ${p.size}px ${this.font}`;
      ctx.lineWidth = p.size * 0.16;
      ctx.strokeStyle = "rgba(4,22,12,0.85)";
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    for (const p of this.pool) p.active = false;
  }
}
