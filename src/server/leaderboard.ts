import "server-only";
import type { GameId } from "@/lib/config";
import { startOfDay } from "@/lib/time";
import { db } from "./db";

export type BoardScope = "daily" | "all";
export type BoardEntry = { id: string; score: number; initials: string | null; endedAt: string };

const CUTOFF_KEY = "leaderboardCutoffs";
type Cutoffs = Partial<Record<`${GameId}:${BoardScope}`, string>>;

export async function getCutoffs(): Promise<Cutoffs> {
  const row = await db.setting.findUnique({ where: { key: CUTOFF_KEY } });
  return (row?.value as Cutoffs | undefined) ?? {};
}

/** "Clearing" a board hides everything before now; the sessions themselves stay for reporting. */
export async function resetBoard(game: GameId, scope: BoardScope): Promise<void> {
  const cutoffs = await getCutoffs();
  const now = new Date().toISOString();
  cutoffs[`${game}:${scope}`] = now;
  // Clearing all-time also clears today's board.
  if (scope === "all") cutoffs[`${game}:daily`] = now;
  await db.setting.upsert({ where: { key: CUTOFF_KEY }, create: { key: CUTOFF_KEY, value: cutoffs }, update: { value: cutoffs } });
}

export async function getBoard(game: GameId, scope: BoardScope, limit: number, timeZone: string): Promise<BoardEntry[]> {
  const cutoffs = await getCutoffs();
  const bounds = [cutoffs[`${game}:${scope}`], cutoffs[`${game}:all`]].filter(Boolean).map((v) => Date.parse(v!));
  if (scope === "daily") bounds.push(startOfDay(Date.now(), timeZone).getTime());
  const since = bounds.length ? new Date(Math.max(...bounds)) : undefined;

  const rows = await db.gameSession.findMany({
    where: { game, hiddenFromBoard: false, ...(since && { endedAt: { gte: since } }) },
    orderBy: [{ score: "desc" }, { endedAt: "asc" }],
    take: limit,
    select: { id: true, score: true, initials: true, endedAt: true },
  });
  return rows.map((r) => ({ ...r, endedAt: r.endedAt.toISOString() }));
}
