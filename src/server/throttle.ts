import "server-only";
import { db } from "./db";

/**
 * Brute-force protection for the 4-digit PIN (only 10,000 combinations).
 * The attempt is counted atomically BEFORE the PIN is checked, so a burst of parallel
 * requests cannot all slip past a "check count, then act" gap.
 * A global bucket stops guesses spread across many IPs.
 */
const RULES = {
  ip: { limit: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  global: { limit: 30, windowMs: 60 * 60_000, lockMs: 15 * 60_000 },
};

type Row = { failures: number; lockedUntil: Date | null };

async function bump(key: string, rule: (typeof RULES)["ip"]): Promise<Row> {
  const windowStart = new Date(Date.now() - rule.windowMs);
  const rows = await db.$queryRaw<Row[]>`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE WHEN "LoginThrottle"."windowStart" < ${windowStart} THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."windowStart" < ${windowStart} THEN now() ELSE "LoginThrottle"."windowStart" END
    RETURNING "failures", "lockedUntil"`;
  return rows[0];
}

/** Records an attempt. Returns seconds to wait if the caller is locked out, else 0. */
export async function registerAttempt(ip: string): Promise<number> {
  const now = Date.now();
  for (const [key, rule] of [[`ip:${ip}`, RULES.ip], ["global", RULES.global]] as const) {
    const row = await bump(key, rule);
    if (row.lockedUntil && row.lockedUntil.getTime() > now) return Math.ceil((row.lockedUntil.getTime() - now) / 1000);
    if (row.failures > rule.limit) {
      const until = new Date(now + rule.lockMs);
      await db.loginThrottle.update({ where: { key }, data: { lockedUntil: until } });
      return Math.ceil(rule.lockMs / 1000);
    }
  }
  return 0;
}

/** A correct PIN: forget this IP's attempts and un-count it from the global bucket. */
export async function registerSuccess(ip: string): Promise<void> {
  await db.loginThrottle.deleteMany({ where: { key: `ip:${ip}` } });
  await db.$executeRaw`UPDATE "LoginThrottle" SET "failures" = GREATEST("failures" - 1, 0) WHERE "key" = 'global'`;
}

export function clientIp(req: Request): string {
  // Vercel overwrites x-forwarded-for with the real client (first entry). Elsewhere the
  // header is spoofable, which only yields fresh per-IP buckets; the global bucket still
  // applies. Capped so a junk header cannot bloat the table key.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return ip.slice(0, 64);
}
