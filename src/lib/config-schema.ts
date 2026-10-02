import { z } from "zod";
import { GAME_IDS } from "./config";

/**
 * zod schemas for the central configuration. Server-side (and tests) only: the kiosk and
 * admin bundles import types from ./config and never ship zod. The server validates every
 * write and every read of stored config, so clients receive already-valid data.
 */

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const num = (min: number, max: number) => z.number().min(min).max(max);

export const gameIdSchema = z.enum(GAME_IDS);

export const starConfigSchema = z.object({
  durationSec: int(15, 180),
  starPoints: int(1, 1000),
  goldenPoints: int(1, 5000),
  hazardPenalty: int(0, 5000),
  /** Bonus for a hazard that passes the glass within the near-miss margin. */
  dodgeBonus: int(0, 500),
  /** Fall speed in logical px/s (stage is 1080x1920). */
  startSpeed: num(100, 2000),
  maxSpeed: num(100, 3000),
  /** Seconds between spawns at the start and at the end of the round. */
  startSpawnInterval: num(0.1, 5),
  minSpawnInterval: num(0.08, 5),
  goldenChance: num(0, 0.5),
  hazardChanceStart: num(0, 0.8),
  hazardChanceEnd: num(0, 0.8),
  chillChance: num(0, 0.3),
  chillDurationSec: num(0, 10),
  /** Catches needed per multiplier step; multiplier = 1 + floor(combo / comboStep), capped. */
  comboStep: int(1, 50),
  maxMultiplier: int(1, 10),
});

export const crateConfigSchema = z.object({
  /** Safety cap so one player cannot hold the kiosk forever. 0 = no cap. */
  maxDurationSec: int(0, 600),
  startWidth: num(150, 900),
  minWidth: num(20, 400),
  /** Horizontal slide speed in logical px/s at height 0 and how much it grows per crate. */
  startSpeed: num(100, 3000),
  speedPerLevel: num(0, 200),
  maxSpeed: num(100, 5000),
  /** Offset (px) that still counts as a perfect drop. */
  perfectTolerance: num(0, 60),
  /** Width regained after `regrowAfter` perfect drops in a row. */
  regrowAfter: int(1, 20),
  regrowAmount: num(0, 200),
  placePoints: int(0, 1000),
  perfectBonus: int(0, 5000),
  /** Bonus per crate of height, added once at game over. */
  heightBonus: int(0, 1000),
  /** Up to this many points per drop, scaled by how well it overlapped. */
  accuracyBonus: int(0, 1000),
  comboStep: int(1, 50),
  maxMultiplier: int(1, 10),
});

export const prizeSchema = z.object({
  id: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  description: z.string().max(200),
  /** Own path or https only: rendered into <img src>, so never javascript:/data:. */
  imageUrl: z
    .string()
    .max(500)
    .refine((v) => v === "" || v.startsWith("/") || v.startsWith("https://"), "Must be empty, a /path or an https:// URL")
    .refine((v) => !v.startsWith("//"), "Protocol-relative URLs are not allowed"),
  minScore: int(0, 10_000_000),
  /** null = no upper bound. */
  maxScore: int(0, 10_000_000).nullable(),
  games: z.array(gameIdSchema).min(1),
  active: z.boolean(),
});

export const kioskConfigSchema = z.object({
  language: z.enum(["nl", "en"]),
  /** IANA zone used for "today", daily leaderboards and report filters. */
  timezone: z.string().min(1).max(64),
  attractDelaySec: int(10, 600),
  soundEnabled: z.boolean(),
  musicEnabled: z.boolean(),
  effectsEnabled: z.boolean(),
  /** auto = measure frame times and drop to low when the device struggles. */
  quality: z.enum(["auto", "high", "low"]),
  requestFullscreen: z.boolean(),
  defaultGame: gameIdSchema.nullable(),
  prizesEnabled: z.boolean(),
  leaderboardEnabled: z.boolean(),
  leaderboardGames: z.array(gameIdSchema),
  leaderboardSize: int(3, 50),
  /** Ask players in the top N for 3 initials. */
  leaderboardInitials: z.boolean(),
  /**
   * Date-of-birth gate before play (Heineken Responsible Marketing Code, digital
   * section). Off by default because staffed venues usually check age at the door;
   * the client's Legal team decides. Nothing entered is stored.
   */
  ageGate: z
    .object({ enabled: z.boolean(), minAge: int(16, 25), denyCooldownSec: int(0, 600) })
    .default({ enabled: false, minAge: 18, denyCooldownSec: 60 }),
});

export const appConfigSchema = z
  .object({
    star: starConfigSchema,
    crate: crateConfigSchema,
    kiosk: kioskConfigSchema,
    prizes: z.array(prizeSchema).max(50),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.prizes.forEach((p, i) => {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", path: ["prizes", i, "id"], message: "Duplicate prize id" });
      ids.add(p.id);
      if (p.maxScore !== null && p.maxScore < p.minScore)
        ctx.addIssue({ code: "custom", path: ["prizes", i, "maxScore"], message: "maxScore below minScore" });
    });
    if (c.star.maxSpeed < c.star.startSpeed)
      ctx.addIssue({ code: "custom", path: ["star", "maxSpeed"], message: "maxSpeed below startSpeed" });
    if (c.star.minSpawnInterval > c.star.startSpawnInterval)
      ctx.addIssue({ code: "custom", path: ["star", "minSpawnInterval"], message: "minSpawnInterval above startSpawnInterval" });
    if (c.crate.minWidth > c.crate.startWidth)
      ctx.addIssue({ code: "custom", path: ["crate", "minWidth"], message: "minWidth above startWidth" });
  });

