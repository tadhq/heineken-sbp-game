export const W = 1080;
export const H = 1920;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
/** Frame-rate independent smoothing factor for "move a fraction towards target each frame". */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/**
 * World-to-backing-store transform shared by everything that draws. `s` is the render
 * scale set by the Runner each frame; `ox/oy` is camera shake. Using setTransform
 * directly (instead of save/translate/rotate/restore) keeps per-sprite cost minimal.
 */
export const view = { s: 1, ox: 0, oy: 0 };

export function place(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, rot = 0) {
  const s = view.s * scale;
  const tx = (x + view.ox) * view.s;
  const ty = (y + view.oy) * view.s;
  if (rot === 0) ctx.setTransform(s, 0, 0, s, tx, ty);
  else {
    const c = Math.cos(rot) * s;
    const n = Math.sin(rot) * s;
    ctx.setTransform(c, n, -n, c, tx, ty);
  }
}

/** Plain world transform (with shake), or screen transform for HUD when `hud` is set. */
export function resetView(ctx: CanvasRenderingContext2D, hud = false) {
  ctx.setTransform(view.s, 0, 0, view.s, hud ? 0 : view.ox * view.s, hud ? 0 : view.oy * view.s);
}
