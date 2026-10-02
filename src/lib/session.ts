import { z } from "zod";
import { type AppConfig, type GameId, gameIdSchema, resolvePrize } from "./config";

/**
 * A finished (or abandoned) game as the kiosk records it. The kiosk generates the ids,
 * so re-sending the same record is harmless: the server keys on `id` and `prize.awardId`.
 */

export const starStatsSchema = z.object({
  caught: z.number().int().min(0),
  golden: z.number().int().min(0),
  hazards: z.number().int().min(0),
  dodges: z.number().int().min(0),
  missed: z.number().int().min(0),
  chills: z.number().int().min(0),
  bestCombo: z.number().int().min(0),
});
export const crateStatsSchema = z.object({
  height: z.number().int().min(0),
  perfects: z.number().int().min(0),
  bestCombo: z.number().int().min(0),
});
export type StarStats = z.infer<typeof starStatsSchema>;
export type CrateStats = z.infer<typeof crateStatsSchema>;

const iso = z.iso.datetime({ offset: true });

const base = {
  id: z.uuid(),
  startedAt: iso,
  endedAt: iso,
  durationMs: z.number().int().min(0).max(60 * 60 * 1000),
  score: z.number().int().min(0).max(10_000_000),
  /** false = player walked away / game was interrupted before the natural end. */
  completed: z.boolean(),
  /** Started within a short window after the previous result on this kiosk. */
  isReplay: z.boolean(),
  configVersion: z.number().int().min(0),
  initials: z.string().regex(/^[A-Z]{3}$/).nullable(),
  prize: z
    .object({ awardId: z.uuid(), prizeId: z.string().min(1).max(40), prizeName: z.string().min(1).max(60) })
    .nullable(),
};

export const sessionPayloadSchema = z.discriminatedUnion("game", [
  z.object({ ...base, game: z.literal("star"), stats: starStatsSchema }),
  z.object({ ...base, game: z.literal("crate"), stats: crateStatsSchema }),
]);
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

export const clientErrorSchema = z.object({
  id: z.uuid(),
  at: iso,
  message: z.string().max(500),
  context: z.string().max(200).optional(),
});
export type ClientError = z.infer<typeof clientErrorSchema>;

export const syncBatchSchema = z.object({
  sessions: z.array(sessionPayloadSchema).max(100),
  errors: z.array(clientErrorSchema).max(100).default([]),
});

// Slack for clock jitter between the kiosk's timer and the recorded timestamps.
const DURATION_SLACK_MS = 5000;
// Patterns can drop a few objects at once; this caps how many can exist per spawn tick.
const MAX_OBJECTS_PER_SPAWN = 3;
// No human can aim and drop a crate faster than this.
const MIN_SECONDS_PER_DROP = 0.2;

/**
 * Upper-bound sanity checks. Not a replay of the game (that would need an input log),
 * but enough that a hand-written payload with an arbitrary score gets flagged.
 * Returns the reasons a session looks implausible; empty = plausible.
 */
export function checkPlausibility(config: AppConfig, s: SessionPayload): string[] {
  const reasons: string[] = [];
  const start = Date.parse(s.startedAt);
  const end = Date.parse(s.endedAt);
  if (end < start) reasons.push("endedAt before startedAt");
  if (Math.abs(end - start - s.durationMs) > DURATION_SLACK_MS + s.durationMs * 0.5)
    reasons.push("durationMs inconsistent with timestamps");
  const seconds = s.durationMs / 1000;

  if (s.game === "star") {
    const c = config.star;
    const st = s.stats;
    if (s.durationMs > c.durationSec * 1000 + DURATION_SLACK_MS) reasons.push("longer than round duration");
    const maxObjects = Math.ceil(seconds / c.minSpawnInterval + 1) * MAX_OBJECTS_PER_SPAWN;
    if (st.caught + st.golden + st.hazards + st.missed + st.dodges > maxObjects) reasons.push("more objects than can spawn");
    if (st.golden > st.caught) reasons.push("golden exceeds caught");
    const maxScore = (st.caught - st.golden) * c.starPoints * c.maxMultiplier + st.golden * c.goldenPoints * c.maxMultiplier + st.dodges * c.dodgeBonus;
    if (s.score > maxScore) reasons.push(`score ${s.score} above bound ${maxScore}`);
    if (st.bestCombo > st.caught) reasons.push("combo exceeds catches");
  } else {
    const c = config.crate;
    const st = s.stats;
    if (c.maxDurationSec > 0 && s.durationMs > c.maxDurationSec * 1000 + DURATION_SLACK_MS) reasons.push("longer than time cap");
    if (st.height > seconds / MIN_SECONDS_PER_DROP + 1) reasons.push("stack too high for duration");
    if (st.perfects > st.height || st.bestCombo > st.height) reasons.push("perfects/combo exceed height");
    const perDrop = (c.placePoints + c.perfectBonus + c.accuracyBonus) * c.maxMultiplier;
    const maxScore = st.height * (perDrop + c.heightBonus);
    if (s.score > maxScore) reasons.push(`score ${s.score} above bound ${maxScore}`);
  }

  if (s.prize) {
    const expected = resolvePrize(config, s.game, s.score);
    if (!expected) reasons.push(`prize ${s.prize.prizeId} claimed but score qualifies for none`);
    else if (expected.id !== s.prize.prizeId) reasons.push(`prize ${s.prize.prizeId} claimed, rules give ${expected.id}`);
  }
  return reasons;
}

export function isGameId(v: unknown): v is GameId {
  return gameIdSchema.safeParse(v).success;
}

// Small blocklist for 3-letter leaderboard initials (EN/NL). Admins can also hide any
// entry from the dashboard; this only stops the obvious ones from ever showing.
const BLOCKED_INITIALS = new Set(["ASS", "FUK", "FUC", "FCK", "SEX", "CUM", "DIK", "KUT", "LUL", "NAZ", "KKK", "TIT", "POO", "GAY", "FAG", "NIG", "WTF", "PIK", "HOE"]);

export function initialsAllowed(v: string): boolean {
  return /^[A-Z]{3}$/.test(v) && !BLOCKED_INITIALS.has(v);
}
