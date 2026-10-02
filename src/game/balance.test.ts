import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/lib/config";
import { DICTS } from "@/lib/i18n";
import { checkPlausibility, type SessionPayload } from "@/lib/session";
import type { Game } from "./engine/runner";
import { qualityFor } from "./engine/runner";
import type { SharedSprites } from "./engine/sprites";
import type { GameResult } from "./types";

/*
 * Balance check: bots of three skill levels play full rounds through the real game code
 * (headless: a no-op canvas). Their scores must land in today's prize bands (GAME_DESIGN.md
 * §2) and no legitimate run may trip the server's plausibility checks.
 * Run with `pnpm vitest run src/game/balance.test.ts` and read the printed table to retune.
 */

const RUNS = 50;
const DT = 1 / 60;

function noopCanvas() {
  const ctx: Record<string | symbol, unknown> = {};
  const proxy: unknown = new Proxy(ctx, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 0 });
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  return { width: 0, height: 0, getContext: () => proxy, toDataURL: () => "" };
}

let sprites: SharedSprites;
beforeAll(async () => {
  (globalThis as unknown as { document: unknown }).document = { createElement: () => noopCanvas() };
  const { createSharedSprites } = await import("./engine/sprites");
  sprites = createSharedSprites(null);
  // The no-op canvas cannot measure the glass; use the supplied glass's measured geometry.
  const g = sprites.glass;
  sprites.glass = { ...g, mouthHalf: 83, rimHeight: 363, sprite: { ...g.sprite, w: 195, cx: 97.5 } };
});

function play<R extends GameResult>(game: Game<R> & { skill: number }, skill: number): R {
  game.setQuality(qualityFor("high", true));
  game.skill = skill;
  for (let i = 0; i < 60 * 60 * 5 && !game.finished; i++) {
    game.autopilot?.(DT);
    game.update(DT);
  }
  return game.result();
}

function payload(r: GameResult): SessionPayload {
  const end = Date.parse("2026-10-02T12:00:00Z");
  return {
    id: "6f1c4a2e-1b7a-4c1e-9d0e-0a1b2c3d4e5f",
    startedAt: new Date(end - r.elapsedMs).toISOString(),
    endedAt: new Date(end).toISOString(),
    durationMs: r.elapsedMs,
    score: r.score,
    completed: true,
    isReplay: false,
    configVersion: 1,
    initials: null,
    prize: null,
    ...(r.game === "star" ? { game: "star", stats: r.stats } : { game: "crate", stats: r.stats }),
  } as SessionPayload;
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

function summary(label: string, rs: GameResult[]) {
  const scores = rs.map((r) => r.score);
  const avg = (f: (r: GameResult) => number) => (rs.reduce((s, r) => s + f(r), 0) / rs.length).toFixed(1);
  const extra =
    rs[0].game === "star"
      ? `caught ${avg((r) => (r.game === "star" ? r.stats.caught : 0))} perfect ${avg((r) => (r.game === "star" ? r.stats.perfects : 0))} served ${avg((r) => (r.game === "star" ? r.stats.served : 0))} heat ${avg((r) => (r.game === "star" ? r.stats.hazards : 0))} best ${avg((r) => r.stats.bestCombo)}`
      : `height ${avg((r) => (r.game === "crate" ? r.stats.height : 0))} perfect ${avg((r) => (r.game === "crate" ? r.stats.perfects : 0))} great ${avg((r) => (r.game === "crate" ? r.stats.greats : 0))} gold ${avg((r) => (r.game === "crate" ? r.stats.goldens : 0))} t ${avg((r) => r.elapsedMs / 1000)}s`;
  console.log(`${label.padEnd(12)} p10 ${pct(scores, 0.1)}  median ${pct(scores, 0.5)}  p90 ${pct(scores, 0.9)}  | ${extra}`);
  return { p10: pct(scores, 0.1), median: pct(scores, 0.5), p90: pct(scores, 0.9) };
}

describe("Star Catcher balance", () => {
  it("lands bot skill levels in the prize bands, all plausible", async () => {
    const { StarCatcher } = await import("./star-catcher");
    const out: Record<string, ReturnType<typeof summary>> = {};
    for (const [label, skill] of [["casual", 0.25], ["decent", 0.55], ["skilled", 0.9]] as const) {
      const rs: GameResult[] = [];
      for (let i = 0; i < RUNS; i++) {
        const r = play(new StarCatcher(DEFAULT_CONFIG.star, sprites, "x", DICTS.en.game), skill);
        expect(checkPlausibility(DEFAULT_CONFIG, payload(r)), JSON.stringify(r)).toEqual([]);
        rs.push(r);
      }
      out[label] = summary(`star ${label}`, rs);
    }
    // Tiers: 400 / 800 / 1500 (DEFAULT_CONFIG.prizes).
    // Average player around tier 1, good player in tier 2, great player reaches tier 3.
    // Margins absorb run-to-run noise (random spawns); the printed table is the real read.
    expect(out.casual.median).toBeGreaterThanOrEqual(400);
    expect(out.casual.median).toBeLessThan(900);
    expect(out.decent.median).toBeGreaterThanOrEqual(800);
    expect(out.decent.median).toBeLessThan(1500);
    expect(out.skilled.median).toBeGreaterThanOrEqual(1350);
    expect(out.skilled.median).toBeGreaterThan(out.casual.median * 1.7);
  }, 120_000);
});

describe("Crate Stacker balance", () => {
  it("lands bot skill levels in the prize bands, all plausible", async () => {
    const { CrateStacker } = await import("./crate-stacker");
    const out: Record<string, ReturnType<typeof summary>> = {};
    for (const [label, skill] of [["casual", 0.25], ["decent", 0.55], ["skilled", 0.9]] as const) {
      const rs: GameResult[] = [];
      for (let i = 0; i < RUNS; i++) {
        const r = play(new CrateStacker(DEFAULT_CONFIG.crate, sprites, "x", DICTS.en.game), skill);
        expect(checkPlausibility(DEFAULT_CONFIG, payload(r)), JSON.stringify(r)).toEqual([]);
        rs.push(r);
      }
      out[label] = summary(`crate ${label}`, rs);
    }
    // Tiers: 300 / 700 / 1400 (DEFAULT_CONFIG.prizes).
    expect(out.casual.median).toBeGreaterThanOrEqual(200);
    expect(out.casual.median).toBeLessThan(800);
    expect(out.decent.median).toBeGreaterThanOrEqual(600);
    expect(out.decent.median).toBeLessThan(1400);
    expect(out.skilled.median).toBeGreaterThanOrEqual(1250);
    expect(out.skilled.median).toBeGreaterThan(out.casual.median * 1.7);
  }, 120_000);
});
