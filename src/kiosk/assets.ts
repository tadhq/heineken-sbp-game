import { brandImages, ensureBrandImages } from "@/game/engine/brand-assets";
import { BeerGlass } from "@/game/engine/beer-glass";
import { createSharedSprites, makeSprite, type SharedSprites, type Sprite, STAR_R } from "@/game/engine/sprites";
import type { RuleIcon } from "@/lib/i18n";

/**
 * Sprites are baked once per page load and shared by both games and the menus. If they
 * were baked before the brand images arrived (procedural fallback), they are rebuilt as
 * soon as the images are available.
 */
let sprites: SharedSprites | null = null;
let builtWithImages = false;

export function getSprites(): SharedSprites {
  const img = brandImages();
  if (!sprites || (img && !builtWithImages)) {
    sprites = createSharedSprites(img);
    builtWithImages = !!img;
    icons = null;
    glassIcon = null;
    heroGlass = null;
    stageArt = null;
  }
  return sprites;
}

/** Call at boot; resolves when brand art is decoded (or failed, then fallback art). */
export const preloadAssets = () => ensureBrandImages();

let icons: Record<RuleIcon, string> | null = null;

/** Menu icons rendered from the exact in-game art, so instructions match what falls. */
export function getIcons(): Record<RuleIcon, string> {
  const s = getSprites();
  if (icons) return icons;
  const url = (c: HTMLCanvasElement) => c.toDataURL("image/png");
  // Glowing sprites carry halo padding; crop to the core so every icon reads the same size.
  const crop = (sp: Sprite, core: number) =>
    url(makeSprite(200, 200, (ctx) => ctx.drawImage(sp.canvas, sp.cx - core / 2, sp.cy - core / 2, core, core, 0, 0, 200, 200)).canvas);
  // Real crate packshot when loaded, otherwise a simple drawn crate.
  const crateUrl = s.crateImage ? "/assets/brand/crate.webp" : null;
  const crate = makeSprite(220, 180, (ctx) => {
    ctx.fillStyle = "#16862f";
    ctx.fillRect(10, 50, 200, 120);
    ctx.drawImage(s.redStar.canvas, 92, 70, 36, (36 * s.redStar.h) / s.redStar.w);
  });
  const glassIcon = makeSprite(200, 200, (ctx) => {
    const g = filledGlass(0.6);
    const h = 190;
    const w = (g.width / g.height) * h;
    ctx.drawImage(g, 100 - w / 2, 5, w, h);
  });
  const goldCrate = makeSprite(220, 180, (ctx) => {
    if (s.crateImage) ctx.drawImage(s.crateImage, 10, 18, 200, (200 * s.crateImage.naturalHeight) / s.crateImage.naturalWidth);
    else ctx.drawImage(crate.canvas, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255,190,50,0.55)";
    ctx.fillRect(0, 0, 220, 180);
  });
  icons = {
    glass: url(glassIcon.canvas),
    goldCrate: url(goldCrate.canvas),
    redStar: crop(s.redStar, STAR_R * 2.6),
    goldStar: crop(s.goldStar, Math.max(s.goldStar.w, s.goldStar.h)), // include the whole glow: no hard edge
    sun: crop(s.sun, STAR_R * 3.4),
    ice: crop(s.ice, STAR_R * 2.2),
    crate: crateUrl ?? url(crate.canvas),
  };
  return icons;
}

/** The game's glass with beer at `level` (0-1), as one canvas. */
function filledGlass(level: number): HTMLCanvasElement {
  const art = getSprites().glass;
  const beer = new BeerGlass(art);
  beer.level = beer.shown = level;
  beer.draw();
  return makeSprite(art.sprite.w, art.sprite.h, (ctx) => {
    ctx.drawImage(beer.canvas, 0, 0);
    ctx.drawImage(art.sprite.canvas, 0, 0);
  }).canvas;
}

let heroGlass: string | null = null;
/** A nearly full glass for the attract hero. */
export function getHeroGlass(): string {
  heroGlass ??= filledGlass(0.9).toDataURL("image/png");
  return heroGlass;
}

let glassIcon: string | null = null;
/** The game's own glass, half full, for the menu card. */
export function getGlassIcon(): string {
  glassIcon ??= filledGlass(0.62).toDataURL("image/png");
  return glassIcon;
}

let stageArt: { rig: string; cone: string } | null = null;
/** Stage rig and one light cone as images for the menus (same art as in the games). */
export function getStageArt() {
  const s = getSprites();
  stageArt ??= { rig: s.lights.bareRig.canvas.toDataURL("image/png"), cone: s.lights.cones.stage.canvas.toDataURL("image/png") };
  return stageArt;
}

/** Canvas needs the real (hashed) family name next/font generated. */
export function displayFontFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
  return v || "sans-serif";
}
