import type { z } from "zod";
import type { appConfigSchema, prizeSchema } from "./config-schema";

/**
 * Central configuration. Everything an admin can tune lives here, validated by one
 * schema (./config-schema, server-side) when saving and when reading stored versions.
 * A saved config is immutable: every admin save creates a new version, so a prize
 * award can always be traced back to the exact rules that produced it.
 * This module stays zod-free at runtime so client bundles stay small.
 */

export const GAME_IDS = ["star", "crate"] as const;
export type GameId = (typeof GAME_IDS)[number];

export type Prize = z.infer<typeof prizeSchema>;

export type AppConfig = z.infer<typeof appConfigSchema>;
export type StarConfig = AppConfig["star"];
export type CrateConfig = AppConfig["crate"];
export type KioskConfig = AppConfig["kiosk"];

/** What the kiosk caches: the rules plus the version they belong to. */
export type VersionedConfig = { version: number; config: AppConfig };

/**
 * Defaults used to seed version 1 and as the kiosk's built-in fallback before it ever
 * reached the server. Prize tiers are placeholders: real prizes are not known yet.
 */
export const DEFAULT_CONFIG: AppConfig = {
  star: {
    durationSec: 45,
    starPoints: 10,
    goldenPoints: 50,
    hazardPenalty: 30,
    dodgeBonus: 5,
    startSpeed: 420,
    maxSpeed: 1050,
    startSpawnInterval: 0.75,
    minSpawnInterval: 0.32,
    goldenChance: 0.05,
    hazardChanceStart: 0.08,
    hazardChanceEnd: 0.3,
    chillChance: 0.025,
    chillDurationSec: 3.5,
    comboStep: 5,
    maxMultiplier: 5,
  },
  crate: {
    maxDurationSec: 150,
    startWidth: 440,
    minWidth: 40,
    startSpeed: 480,
    speedPerLevel: 22,
    maxSpeed: 1500,
    perfectTolerance: 9,
    regrowAfter: 3,
    regrowAmount: 30,
    placePoints: 10,
    perfectBonus: 25,
    heightBonus: 5,
    accuracyBonus: 10,
    comboStep: 3,
    maxMultiplier: 5,
  },
  kiosk: {
    language: "nl",
    timezone: "America/Paramaribo",
    attractDelaySec: 45,
    soundEnabled: true,
    musicEnabled: true,
    effectsEnabled: true,
    quality: "auto",
    requestFullscreen: true,
    defaultGame: null,
    prizesEnabled: true,
    leaderboardEnabled: true,
    leaderboardGames: ["crate", "star"],
    leaderboardSize: 10,
    leaderboardInitials: true,
    ageGate: { enabled: false, minAge: 18, denyCooldownSec: 60 },
    audio: { master: 0.9, music: 0.6, sfx: 0.85 },
  },
  prizes: [
    { id: "star-t1", name: "Prize Tier 1", description: "Placeholder prize", imageUrl: "", minScore: 400, maxScore: 799, games: ["star"], active: true },
    { id: "star-t2", name: "Prize Tier 2", description: "Placeholder prize", imageUrl: "", minScore: 800, maxScore: 1499, games: ["star"], active: true },
    { id: "star-t3", name: "Prize Tier 3", description: "Placeholder prize", imageUrl: "", minScore: 1500, maxScore: null, games: ["star"], active: true },
    { id: "crate-t1", name: "Prize Tier 1", description: "Placeholder prize", imageUrl: "", minScore: 300, maxScore: 699, games: ["crate"], active: true },
    { id: "crate-t2", name: "Prize Tier 2", description: "Placeholder prize", imageUrl: "", minScore: 700, maxScore: 1399, games: ["crate"], active: true },
    { id: "crate-t3", name: "Prize Tier 3", description: "Placeholder prize", imageUrl: "", minScore: 1400, maxScore: null, games: ["crate"], active: true },
  ],
};

/**
 * Highest-threshold active prize the score qualifies for. Shared by kiosk (to show the
 * result immediately, even offline) and server (to re-derive it independently on sync).
 */
export function resolvePrize(config: AppConfig, game: GameId, score: number): Prize | null {
  if (!config.kiosk.prizesEnabled) return null;
  let best: Prize | null = null;
  for (const p of config.prizes) {
    if (!p.active || !p.games.includes(game)) continue;
    if (score < p.minScore || (p.maxScore !== null && score > p.maxScore)) continue;
    if (!best || p.minScore > best.minScore) best = p;
  }
  return best;
}

/**
 * Client-side sanity pass for config read from device storage (no zod in the bundle).
 * Keeps every known field whose type matches the defaults and fills in anything missing,
 * so a corrupted cache or one saved before a new setting existed can never crash the
 * kiosk. Returns null when the value is not config-shaped at all.
 */
export function normalizeConfig(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.prizes)) return null;
  type Obj = Record<string, unknown>;
  const merge = (def: Obj, val: unknown): Obj => {
    if (!val || typeof val !== "object" || Array.isArray(val)) return { ...def };
    const v = val as Obj;
    const out: Obj = { ...def };
    for (const [k, d] of Object.entries(def)) {
      const x = v[k];
      if (Array.isArray(d)) out[k] = Array.isArray(x) ? x : d;
      else if (d !== null && typeof d === "object") out[k] = merge(d as Obj, x);
      else if (d === null) out[k] = x === null || typeof x === "string" ? x : d;
      else if (typeof x === typeof d && (typeof x !== "number" || Number.isFinite(x))) out[k] = x;
    }
    return out;
  };
  const prizes = r.prizes.filter(
    (p): p is Prize =>
      !!p && typeof p === "object" && typeof (p as Prize).id === "string" && typeof (p as Prize).name === "string" && Number.isFinite((p as Prize).minScore) && Array.isArray((p as Prize).games),
  );
  return {
    star: merge(DEFAULT_CONFIG.star, r.star) as StarConfig,
    crate: merge(DEFAULT_CONFIG.crate, r.crate) as CrateConfig,
    kiosk: merge(DEFAULT_CONFIG.kiosk, r.kiosk) as KioskConfig,
    prizes: prizes.map((p) => Object.assign({ description: "", imageUrl: "", maxScore: null, active: true }, p)),
  };
}
