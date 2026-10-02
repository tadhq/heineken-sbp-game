import { createSharedSprites, makeSprite, type SharedSprites, starPath } from "@/game/engine/sprites";
import { PALETTE as P } from "@/game/engine/palette";
import type { RuleIcon } from "@/lib/i18n";

/** Sprites are generated once per page load and shared by both games and the menus. */
let sprites: SharedSprites | null = null;
export function getSprites(): SharedSprites {
  sprites ??= createSharedSprites();
  return sprites;
}

let icons: Record<RuleIcon, string> | null = null;

/** Menu icons rendered from the exact in-game art, so instructions match what falls. */
export function getIcons(): Record<RuleIcon, string> {
  if (icons) return icons;
  const s = getSprites();
  const crate = makeSprite(200, 160, (ctx) => {
    ctx.fillStyle = "#0a4a1d";
    ctx.beginPath();
    ctx.moveTo(160, 60);
    ctx.lineTo(190, 34);
    ctx.lineTo(190, 124);
    ctx.lineTo(160, 150);
    ctx.fill();
    ctx.fillStyle = "#33a843";
    ctx.beginPath();
    ctx.moveTo(10, 60);
    ctx.lineTo(40, 34);
    ctx.lineTo(190, 34);
    ctx.lineTo(160, 60);
    ctx.fill();
    const g = ctx.createLinearGradient(0, 60, 0, 150);
    g.addColorStop(0, "#2d9a3a");
    g.addColorStop(1, "#0b4d1a");
    ctx.fillStyle = g;
    ctx.fillRect(10, 60, 150, 90);
    starPath(ctx, 85, 105, 22);
    ctx.fillStyle = P.starRed;
    ctx.fill();
  });
  const url = (c: HTMLCanvasElement) => c.toDataURL("image/png");
  icons = { redStar: url(s.redStar.canvas), goldStar: url(s.goldStar.canvas), sun: url(s.sun.canvas), ice: url(s.ice.canvas), crate: url(crate.canvas) };
  return icons;
}

/** Canvas needs the real (hashed) family name next/font generated. */
export function displayFontFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
  return v || "sans-serif";
}
