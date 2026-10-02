import { place, W } from "./math";
import { makeSprite, type Sprite } from "./sprites";

/*
 * Event-stage lighting, shared by both games and the menus. Replaces the old flat beams.
 * Everything expensive happens once at bake time (gradients, blur, the truss); per frame
 * a light costs one transformed additive blit of a pre-blurred cone.
 *
 *   rig   curved aluminium truss, hanging fixtures with lit lenses, green LED strip with
 *         the red star at its centre
 *   cone  soft volumetric beam (blur baked in), in three tints: stage white-green,
 *         bonus gold, final-push red
 */

export const RIG_H = 230;
/** Fixture x positions and their resting aim (radians, 0 = straight down). */
export const FIXTURES = [
  { x: 150, aim: 0.36 },
  { x: 365, aim: 0.14 },
  { x: 715, aim: -0.14 },
  { x: 930, aim: -0.36 },
] as const;
/** Truss arc: y of the truss bottom chord at x (gently curved, lower in the middle). */
export const trussY = (x: number) => 92 + 26 * Math.sin((x / W) * Math.PI);

export type ConeTint = "stage" | "gold" | "red";
const TINTS: Record<ConeTint, [string, string]> = {
  stage: ["rgba(235,255,225,0.55)", "rgba(150,255,150,0)"],
  gold: ["rgba(255,226,150,0.6)", "rgba(255,190,60,0)"],
  red: ["rgba(255,150,140,0.55)", "rgba(227,0,15,0)"],
};

export const CONE_W = 520;
export const CONE_H = 1500;

function cone(tint: ConeTint): Sprite {
  const [c0, c1] = TINTS[tint];
  // Drawn at half size and upscaled when blitted: it is all soft gradient anyway.
  const w = CONE_W / 2;
  const h = CONE_H / 2;
  return makeSprite(
    w,
    h,
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, c0);
      g.addColorStop(0.55, c0.replace(/[\d.]+\)$/, "0.16)"));
      g.addColorStop(1, c1);
      ctx.filter = "blur(10px)";
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 9, 6);
      ctx.lineTo(w / 2 + 9, 6);
      ctx.lineTo(w - 18, h - 10);
      ctx.lineTo(18, h - 10);
      ctx.closePath();
      ctx.fill();
      ctx.filter = "none";
      // Hot core along the axis: reads as a beam in haze rather than a flat wedge.
      ctx.globalCompositeOperation = "lighter";
      const core = ctx.createLinearGradient(0, 0, 0, h * 0.7);
      core.addColorStop(0, "rgba(255,255,255,0.35)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.filter = "blur(14px)";
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 4, 6);
      ctx.lineTo(w / 2 + 4, 6);
      ctx.lineTo(w / 2 + 50, h * 0.7);
      ctx.lineTo(w / 2 - 50, h * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.filter = "none";
    },
    w / 2,
    0,
  );
}

function metal(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#f2f5f3");
  g.addColorStop(0.35, "#9aa49e");
  g.addColorStop(0.6, "#5d6761");
  g.addColorStop(1, "#c6ccc8");
  return g;
}

function rig(star: Sprite | null): Sprite {
  return makeSprite(W, RIG_H, (ctx) => {
    // Truss: two chords following the arc, zig-zag webbing between them.
    const top = (x: number) => trussY(x) - 34;
    const chord = (f: (x: number) => number, thick: number) => {
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 20) ctx.lineTo(x, f(x));
      ctx.lineWidth = thick;
      ctx.strokeStyle = metal(ctx, f(W / 2) - thick, f(W / 2) + thick);
      ctx.stroke();
    };
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,18,6,0.6)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 8;
    ctx.beginPath();
    for (let x = 0, k = 0; x <= W; x += 36, k++) {
      ctx.moveTo(x, k % 2 ? top(x) : trussY(x));
      ctx.lineTo(x + 36, k % 2 ? trussY(x + 36) : top(x + 36));
    }
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#87918b";
    ctx.stroke();
    chord(top, 7);
    chord(trussY, 8);
    ctx.shadowColor = "transparent";

    // LED strip under the truss: brand green glow line.
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = "blur(8px)";
    ctx.beginPath();
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, trussY(x) + 9);
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(60,220,80,0.55)";
    ctx.stroke();
    ctx.filter = "none";
    ctx.beginPath();
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, trussY(x) + 9);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(200,255,200,0.9)";
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // Fixtures: yoke, can body, lit lens.
    for (const f of FIXTURES) {
      const y = trussY(f.x) + 8;
      ctx.save();
      ctx.translate(f.x, y);
      ctx.fillStyle = "#3a433e";
      ctx.fillRect(-3, 0, 6, 16);
      ctx.rotate(f.aim);
      ctx.translate(0, 18);
      const body = ctx.createLinearGradient(-22, 0, 22, 0);
      body.addColorStop(0, "#1b211e");
      body.addColorStop(0.35, "#56605a");
      body.addColorStop(0.5, "#7d8781");
      body.addColorStop(1, "#141a17");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(-22, 0, 44, 46, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 46, 24, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#fffdf2";
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      const lens = ctx.createRadialGradient(0, 46, 2, 0, 46, 60);
      lens.addColorStop(0, "rgba(255,255,240,0.9)");
      lens.addColorStop(0.3, "rgba(200,255,200,0.35)");
      lens.addColorStop(1, "rgba(200,255,200,0)");
      ctx.fillStyle = lens;
      ctx.fillRect(-60, -14, 120, 120);
      ctx.restore();
    }

    // Centre plate with the official star, lit from below by the strip.
    const cx = W / 2;
    const cy = trussY(cx) + 4;
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(cx, cy, 6, cx, cy, 110);
    halo.addColorStop(0, "rgba(255,60,40,0.45)");
    halo.addColorStop(1, "rgba(255,60,40,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(cx - 110, cy - 110, 220, 220);
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fillStyle = metal(ctx, cy - 46, cy + 46);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, Math.PI * 2);
    ctx.fillStyle = "#06331a";
    ctx.fill();
    if (star) ctx.drawImage(star.canvas, cx - 40, cy - 40 * (star.h / star.w), 80, 80 * (star.h / star.w));
  });
}

export type StageLightArt = { rig: Sprite; cones: Record<ConeTint, Sprite> };

export function makeStageLights(star: Sprite | null): StageLightArt {
  return { rig: rig(star), cones: { stage: cone("stage"), gold: cone("gold"), red: cone("red") } };
}

/**
 * Draws the cones (additive) for the current moment. `energy` 0-1 brightens and widens the
 * sweep; `tint` cross-fades via `mix` (0 = stage, 1 = full tint). `y` shifts the rig down.
 */
export function drawCones(ctx: CanvasRenderingContext2D, art: StageLightArt, t: number, energy: number, tint: ConeTint, mix: number, y = 0, alpha = 1) {
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < FIXTURES.length; i++) {
    const f = FIXTURES[i];
    const sweep = Math.sin(t * (0.35 + energy * 0.5) + i * 1.7) * (0.1 + energy * 0.12);
    const a = (0.32 + 0.45 * energy) * alpha;
    const fx = f.x + Math.sin(f.aim) * -64;
    const fy = trussY(f.x) + 8 + 64 + y;
    const scale = 1 + energy * 0.15;
    if (mix < 1) {
      ctx.globalAlpha = a * (1 - mix);
      drawCone(ctx, art.cones.stage, fx, fy, f.aim + sweep, scale);
    }
    if (mix > 0 && tint !== "stage") {
      ctx.globalAlpha = a * mix;
      drawCone(ctx, art.cones[tint], fx, fy, f.aim + sweep, scale);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawCone(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, rot: number, scale: number) {
  place(ctx, x, y, 2 * scale, rot);
  ctx.drawImage(s.canvas, -s.cx, 0);
}
