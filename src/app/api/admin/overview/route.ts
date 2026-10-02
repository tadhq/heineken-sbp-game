import { GAME_IDS } from "@/lib/config";
import { startOfDay } from "@/lib/time";
import { getCurrentConfig } from "@/server/config-store";
import { db } from "@/server/db";
import { awardFilterSchema, dateRange } from "@/server/reports";
import { adminRoute, json } from "@/server/route";

/** Aggregated, anonymous analytics. Optional ?from&to (event-timezone days) scope the numbers. */
export const GET = adminRoute(async (req) => {
  const url = new URL(req.url);
  const { from, to } = awardFilterSchema.parse(Object.fromEntries(url.searchParams));
  const { config, version } = await getCurrentConfig();
  const tz = config.kiosk.timezone;
  const range = dateRange(from, to, tz);
  const sessionWhere = range.gte || range.lt ? { endedAt: range } : {};
  const awardWhere = range.gte || range.lt ? { awardedAt: range } : {};
  const todayStart = startOfDay(Date.now(), tz);

  const [perGame, completedPerGame, completedAll, replays, prizeCounts, awardsToday, flagged, recent, kiosks, errors24h] = await Promise.all([
    // Flagged (implausible) sessions are counted as played but never feed score stats.
    db.gameSession.groupBy({
      by: ["game"],
      where: sessionWhere,
      _count: { _all: true },
      _avg: { durationMs: true },
    }),
    db.gameSession.groupBy({
      by: ["game"],
      where: { ...sessionWhere, completed: true, flags: { isEmpty: true } },
      _count: { _all: true },
      _avg: { score: true },
      _max: { score: true },
    }),
    db.gameSession.count({ where: { ...sessionWhere, completed: true } }),
    db.gameSession.count({ where: { ...sessionWhere, isReplay: true } }),
    db.prizeAward.groupBy({ by: ["prizeId", "prizeName", "game"], where: { ...awardWhere, status: "awarded" }, _count: { _all: true } }),
    db.prizeAward.count({ where: { status: "awarded", awardedAt: { gte: todayStart } } }),
    db.prizeAward.count({ where: { ...awardWhere, flagged: true, status: "awarded" } }),
    db.prizeAward.findMany({ where: awardWhere, orderBy: { awardedAt: "desc" }, take: 8 }),
    db.kiosk.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, lastSeenAt: true } }),
    db.clientError.count({ where: { at: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
  ]);

  const topScores = Object.fromEntries(
    await Promise.all(
      GAME_IDS.map(async (g) => [
        g,
        await db.gameSession.findMany({
          where: { ...sessionWhere, game: g, hiddenFromBoard: false },
          orderBy: { score: "desc" },
          take: 5,
          select: { id: true, score: true, initials: true, endedAt: true },
        }),
      ]),
    ),
  );

  const games = GAME_IDS.map((g) => {
    const all = perGame.find((p) => p.game === g);
    const done = completedPerGame.find((p) => p.game === g);
    return {
      game: g,
      sessions: all?._count._all ?? 0,
      completed: done?._count._all ?? 0,
      avgScore: Math.round(done?._avg.score ?? 0),
      highScore: done?._max.score ?? 0,
      avgDurationSec: Math.round((all?._avg.durationMs ?? 0) / 100) / 10,
    };
  });
  const totalSessions = games.reduce((a, g) => a + g.sessions, 0);

  return json({
    configVersion: version,
    timezone: tz,
    totals: {
      sessions: totalSessions,
      completionRate: totalSessions ? completedAll / totalSessions : 0,
      replayRate: totalSessions ? replays / totalSessions : 0,
      prizesAwarded: prizeCounts.reduce((a, p) => a + p._count._all, 0),
      prizesToday: awardsToday,
      flaggedAwards: flagged,
      errors24h,
    },
    games,
    prizeCounts: prizeCounts
      .map((p) => ({ prizeId: p.prizeId, prizeName: p.prizeName, game: p.game, count: p._count._all }))
      .sort((a, b) => b.count - a.count),
    recentAwards: recent,
    topScores,
    kiosks,
  });
});
