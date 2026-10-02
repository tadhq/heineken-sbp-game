import "server-only";
import { z } from "zod";
import { gameIdSchema } from "@/lib/config-schema";
import { startOfDayKey } from "@/lib/time";
import type { Prisma } from "../../generated/prisma/client";

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const awardFilterSchema = z.object({
  from: dayKey.optional(),
  to: dayKey.optional(),
  game: gameIdSchema.optional(),
  prizeId: z.string().max(40).optional(),
  status: z.enum(["awarded", "voided"]).optional(),
});
export type AwardFilter = z.infer<typeof awardFilterSchema>;

/** Inclusive day range in the event timezone. */
export function dateRange(from: string | undefined, to: string | undefined, timeZone: string) {
  const range: { gte?: Date; lt?: Date } = {};
  if (from) range.gte = startOfDayKey(from, timeZone);
  if (to) {
    const [y, m, d] = to.split("-").map(Number);
    range.lt = startOfDayKey(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10), timeZone);
  }
  return range;
}

export function awardWhere(f: AwardFilter, timeZone: string): Prisma.PrizeAwardWhereInput {
  const range = dateRange(f.from, f.to, timeZone);
  return {
    ...(range.gte || range.lt ? { awardedAt: range } : {}),
    ...(f.game && { game: f.game }),
    ...(f.prizeId && { prizeId: f.prizeId }),
    ...(f.status && { status: f.status }),
  };
}

/** CSV cell that cannot be interpreted as a spreadsheet formula. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
