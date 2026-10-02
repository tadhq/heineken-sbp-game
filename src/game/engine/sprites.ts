import { H, W } from "./math";
import { type BrandImages, CRATE_RIM, LOGO_WORDMARK, logoRect } from "./brand-assets";
import { PALETTE as P } from "./palette";

/**
 * All game art is drawn procedurally ONCE into offscreen canvases, then blitted with
 * drawImage each frame. No image files to download, decode or license, and no per-frame
 * path filling or shadowBlur (both expensive on weak mobile GPUs).
 * Placeholder art: swap for client-supplied brand artwork when available.
 */
export type Sprite = { canvas: HTMLCanvasElement; cx: number; cy: number; w: number; h: number };

export function makeSprite(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, cx = w / 2, cy = h / 2): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  return { canvas, cx, cy, w, h };
}

export function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inner = 0.47) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * inner;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** Bevelled star: extruded edge for depth, gradient face, top-left highlight. */
function bevelStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, face: [string, string, string], edge: string) {
  for (let i = 4; i >= 1; i--) {
    starPath(ctx, x, y + i * r * 0.035, r);
    ctx.fillStyle = edge;
    ctx.fill();
  }
  starPath(ctx, x, y, r);
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r * 1.05);
  g.addColorStop(0, face[0]);
  g.addColorStop(0.45, face[1]);
  g.addColorStop(1, face[2]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  starPath(ctx, x, y, r);
  ctx.clip();
  const hl = ctx.createLinearGradient(x - r, y - r, x + r * 0.2, y + r * 0.2);
  hl.addColorStop(0, "rgba(255,255,255,0.55)");
  hl.addColorStop(0.5, "rgba(255,255,255,0.08)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hl;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
  starPath(ctx, x, y, r);
  ctx.lineWidth = Math.max(1.5, r * 0.04);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.stroke();
}

function softDot(color: string, size: number): Sprite {
  return makeSprite(size, size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.25, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

function glow(color: string, size: number, alpha = 0.6): Sprite {
  return makeSprite(size, size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

function miniStar(color: string, size: number): Sprite {
  return makeSprite(size, size, (ctx) => {
    starPath(ctx, size / 2, size / 2, size / 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

export const STAR_R = 56;

function proceduralSprites() {
  const redStar = makeSprite(STAR_R * 2.4, STAR_R * 2.4, (ctx) =>
    bevelStar(ctx, STAR_R * 1.2, STAR_R * 1.15, STAR_R, ["#ff8a78", P.starRed, "#a8150c"], P.starRedDark),
  );
  const goldStar = makeSprite(STAR_R * 4.2, STAR_R * 4.2, (ctx) => {
    const c = STAR_R * 2.1;
    const g = ctx.createRadialGradient(c, c, STAR_R * 0.4, c, c, c);
    g.addColorStop(0, "rgba(255,214,90,0.55)");
    g.addColorStop(1, "rgba(255,190,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c * 2, c * 2);
    bevelStar(ctx, c, c, STAR_R * 1.08, ["#fff7c8", P.gold, P.goldDeep], "#8a5a05");
  });
  const sun = makeSprite(STAR_R * 3.6, STAR_R * 3.6, (ctx) => {
    const c = STAR_R * 1.8;
    const halo = ctx.createRadialGradient(c, c, STAR_R * 0.6, c, c, c);
    halo.addColorStop(0, "rgba(255,120,20,0.55)");
    halo.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, c * 2, c * 2);
    ctx.fillStyle = "#ff8f1f";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const len = i % 2 ? STAR_R * 1.35 : STAR_R * 1.6;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a - 0.13) * STAR_R * 0.8, c + Math.sin(a - 0.13) * STAR_R * 0.8);
      ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      ctx.lineTo(c + Math.cos(a + 0.13) * STAR_R * 0.8, c + Math.sin(a + 0.13) * STAR_R * 0.8);
      ctx.fill();
    }
    const disc = ctx.createRadialGradient(c - STAR_R * 0.25, c - STAR_R * 0.3, 4, c, c, STAR_R * 0.92);
    disc.addColorStop(0, "#fff6b8");
    disc.addColorStop(0.45, "#ffb52e");
    disc.addColorStop(1, "#ee4d00");
    ctx.beginPath();
    ctx.arc(c, c, STAR_R * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = disc;
    ctx.fill();
    // Heat shimmer bands make it read as "hot", not as a friendly sun.
    ctx.strokeStyle = "rgba(170,30,0,0.45)";
    ctx.lineWidth = 5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      const y = c + i * STAR_R * 0.32;
      ctx.moveTo(c - STAR_R * 0.5, y);
      ctx.bezierCurveTo(c - STAR_R * 0.2, y - 10, c + STAR_R * 0.1, y + 10, c + STAR_R * 0.5, y);
      ctx.stroke();
    }
  });
  const ice = makeSprite(STAR_R * 2.6, STAR_R * 2.6, (ctx) => {
    const c = STAR_R * 1.3;
    const s = STAR_R * 0.78;
    const face = (pts: number[], fill: string) => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    };
    const g = ctx.createRadialGradient(c, c, 4, c, c, c);
    g.addColorStop(0, "rgba(160,230,255,0.45)");
    g.addColorStop(1, "rgba(160,230,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c * 2, c * 2);
    face([c, c - s, c + s, c - s / 2, c, c, c - s, c - s / 2], "rgba(230,250,255,0.92)");
    face([c - s, c - s / 2, c, c, c, c + s, c - s, c + s / 2], "rgba(140,215,250,0.85)");
    face([c + s, c - s / 2, c, c, c, c + s, c + s, c + s / 2], "rgba(90,180,235,0.85)");
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(c - s * 0.55, c - s * 0.05, 6, s * 0.5);
  });

  const particles = [
    softDot(P.starRed, 28), // 0 red
    softDot(P.gold, 34), // 1 gold
    softDot(P.bright, 28), // 2 green
    softDot(P.ice, 30), // 3 ice
    softDot(P.heat, 30), // 4 heat
    softDot("#ffffff", 22), // 5 white
    miniStar(P.starRed, 26), // 6 red mini star
    miniStar(P.gold, 30), // 7 gold mini star
  ];

  return {
    redStar,
    goldStar,
    sun,
    ice,
    particles,
    glowGold: glow(P.gold, 420, 0.7),
    glowRed: glow(P.starRed, 260, 0.6),
    glowGreen: glow(P.bright, 360, 0.55),
    glowIce: glow(P.ice, 300, 0.6),
    ring: glow("#ffffff", 256, 0.5),
    shadow: makeSprite(240, 60, (ctx) => {
      ctx.scale(1, 0.25);
      const g = ctx.createRadialGradient(120, 120, 10, 120, 120, 120);
      g.addColorStop(0, "rgba(0,0,0,0.55)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 240, 240);
    }),
  };
}

// Crate wordmark baked at 1.4x logo units (about 600x100 px): crisp at crate size.
const LOGO_SCALE_FOR_CRATE = 4 / 1.4;

/**
 * Heineken's signature vivid-green radial (sampled from heineken.com's brand gradient),
 * darkening to deep green at the edges so red stars and white type keep contrast.
 */
export function brandBackdrop(ctx: CanvasRenderingContext2D, cx = W / 2, cy = H * 0.38) {
  const g = ctx.createRadialGradient(cx, cy, 40, cx, cy, H * 0.78);
  g.addColorStop(0, "#3f9b35");
  g.addColorStop(0.35, "#1f7a2c");
  g.addColorStop(0.7, P.brandEdge);
  g.addColorStop(1, "#063218");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** White texture tinted to a colour (Kenney particles ship white). */
function tint(img: CanvasImageSource, size: number, color: string, alpha = 1): Sprite {
  return makeSprite(size, size, (ctx) => {
    ctx.drawImage(img, 0, 0, size, size);
    ctx.globalCompositeOperation = "source-in";
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    // Keep a hot white core so tinted sparks still read as light.
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.35;
    ctx.drawImage(img, size * 0.2, size * 0.2, size * 0.6, size * 0.6);
    // Fade to zero at the edges: some source textures never quite reach full transparency,
    // which shows up as a square when drawn additively.
    ctx.globalCompositeOperation = "destination-in";
    ctx.globalAlpha = 1;
    const m = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    m.addColorStop(0.55, "rgba(0,0,0,1)");
    m.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, size, size);
  });
}

/** The official star (red with white keyline) cut from the logo artwork. */
function officialStar(img: BrandImages, width: number, recolor?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Sprite {
  const h = (width * img.star.naturalHeight) / img.star.naturalWidth;
  const pad = width * 0.18;
  return makeSprite(width + pad * 2, h + pad * 2, (ctx) => {
    const star = makeSprite(width, h, (c) => {
      c.drawImage(img.star, 0, 0, width, h);
      recolor?.(c, width, h);
    });
    // Baked soft shadow and a glossy sheen: depth without any per-frame cost.
    ctx.shadowColor = "rgba(0,20,8,0.45)";
    ctx.shadowBlur = width * 0.08;
    ctx.shadowOffsetY = width * 0.05;
    ctx.drawImage(star.canvas, pad, pad);
    ctx.shadowColor = "transparent";
    ctx.globalCompositeOperation = "source-atop";
    const g = ctx.createLinearGradient(pad, pad, pad + width * 0.7, pad + h * 0.7);
    g.addColorStop(0, "rgba(255,255,255,0.38)");
    g.addColorStop(0.45, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width + pad * 2, h + pad * 2);
  });
}

/**
 * Sprite set for both games. With brand images (normal case) the stars are the official
 * Heineken star, the catcher is the real draught glass and effects use Kenney CC0
 * textures; without them (asset load failed) the procedural art keeps the kiosk playable.
 */
export function createSharedSprites(img: BrandImages | null) {
  const base = proceduralSprites();
  if (!img) return { ...base, glass: null as GlassSprite | null, wordmark: null as Sprite | null, crateImage: null as HTMLImageElement | null };
  const fx = img.fx;
  const width = STAR_R * 2.15;
  const redStar = officialStar(img, width);
  const goldStar = (() => {
    const core = officialStar(img, width * 1.08, (c, w, h) => {
      // Recolour the red to gold, keep the keyline light.
      c.globalCompositeOperation = "source-atop";
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#fff4c2");
      g.addColorStop(0.45, "#ffc94a");
      g.addColorStop(1, "#c98a10");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = "screen";
      c.globalAlpha = 0.35;
      c.drawImage(img.star, 0, 0, w, h);
    });
    const size = core.w * 1.9;
    return makeSprite(size, size, (ctx) => {
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(tint(fx.light_02, size, "#ffcc55", 0.9).canvas, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(core.canvas, (size - core.w) / 2, (size - core.h) / 2);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(fx.star_09, size * 0.58, size * 0.16, size * 0.3, size * 0.3);
    });
  })();
  // Star Catcher catcher: the real crate, 300 px wide, anchored at its bottom centre.
  const cw = 300;
  const ch = (cw * img.crate.naturalHeight) / img.crate.naturalWidth;
  const catcher = {
    ...makeSprite(cw, ch, (ctx) => ctx.drawImage(img.crate, 0, 0, cw, ch), cw / 2, ch),
    rimHalf: cw * 0.46,
    rimHeight: ch * (1 - CRATE_RIM),
  } as GlassSprite;
  const [wx, wy, ww, wh] = logoRect(LOGO_WORDMARK);
  return {
    ...base,
    redStar,
    goldStar,
    sun: base.sun,
    ice: base.ice,
    particles: [
      tint(fx.star_08, 40, P.starRed), // 0 red glow dot
      tint(fx.star_08, 46, P.gold), // 1 gold glow dot
      tint(fx.star_08, 40, P.bright), // 2 green
      tint(fx.star_08, 40, P.ice), // 3 ice
      tint(fx.star_08, 40, P.heat), // 4 heat
      tint(fx.star_09, 34, "#ffffff"), // 5 white sparkle
      tint(fx.flare_01, 44, "#ff4a3a"), // 6 red flare
      tint(fx.star_09, 48, P.gold), // 7 gold sparkle
    ],
    glowGold: tint(fx.light_02, 420, P.gold, 0.85),
    glowRed: tint(fx.light_02, 260, "#ff3b1f", 0.8),
    glowGreen: tint(fx.light_02, 360, "#7dff7a", 0.6),
    glowIce: tint(fx.light_02, 300, P.ice, 0.8),
    ring: tint(fx.star_06, 256, "#ffffff"),
    // Real glass photo, baked at on-screen size (the source has wide transparent margins).
    glass: catcher as GlassSprite | null,
    /** Crate packshot for Crate Stacker (drawn with per-crate source crops when sliced). */
    crateImage: img.crate as HTMLImageElement | null,
    wordmark: makeSprite(ww / LOGO_SCALE_FOR_CRATE, wh / LOGO_SCALE_FOR_CRATE, (ctx) => ctx.drawImage(img.logo, wx, wy, ww, wh, 0, 0, ww / LOGO_SCALE_FOR_CRATE, wh / LOGO_SCALE_FOR_CRATE)),
  };
}

export type SharedSprites = ReturnType<typeof createSharedSprites>;
/** Catcher art plus its play geometry: anchor at the catcher base, rim relative to it. */
export type GlassSprite = Sprite & { rimHalf: number; rimHeight: number };

/** Soft cinematic vignette shared by both games' backgrounds. */
export function vignette(ctx: CanvasRenderingContext2D, strength = 0.6) {
  const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Light beams fanning down from the top: cheap "event stage" atmosphere, baked once. */
export function beams(ctx: CanvasRenderingContext2D, count: number, alpha: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const x = (W / (count + 1)) * (i + 1) + (i % 2 ? 60 : -60);
    const spread = 260 + (i % 3) * 90;
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.85);
    g.addColorStop(0, `rgba(170,255,170,${alpha})`);
    g.addColorStop(1, "rgba(170,255,170,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 30, -10);
    ctx.lineTo(x + 30, -10);
    ctx.lineTo(x + spread + (i - count / 2) * 120, H * 0.85);
    ctx.lineTo(x - spread + (i - count / 2) * 120, H * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Out-of-focus light orbs for depth. Deterministic so both quality modes look alike. */
export function bokeh(ctx: CanvasRenderingContext2D, n: number, yMax: number, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W;
    const y = rnd() * yMax;
    const r = 20 + rnd() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = rnd() > 0.8 ? "255,80,60" : rnd() > 0.5 ? "120,230,120" : "255,240,200";
    g.addColorStop(0, `rgba(${c},${0.05 + rnd() * 0.1})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
