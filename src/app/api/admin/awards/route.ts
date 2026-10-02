import { getCurrentConfig } from "@/server/config-store";
import { db } from "@/server/db";
import { awardFilterSchema, awardWhere, csvCell } from "@/server/reports";
import { adminRoute, json } from "@/server/route";

const TABLE_LIMIT = 500;
const CSV_LIMIT = 100_000;

export const GET = adminRoute(async (req) => {
  const url = new URL(req.url);
  const filter = awardFilterSchema.parse(Object.fromEntries([...url.searchParams].filter(([k]) => k !== "format")));
  const { config } = await getCurrentConfig();
  const where = awardWhere(filter, config.kiosk.timezone);
  const csv = url.searchParams.get("format") === "csv";

  const [rows, counts] = await Promise.all([
    db.prizeAward.findMany({
      where,
      orderBy: { awardedAt: "desc" },
      take: csv ? CSV_LIMIT : TABLE_LIMIT,
      include: { kiosk: { select: { name: true } } },
    }),
    db.prizeAward.groupBy({ by: ["prizeId", "prizeName", "status"], where, _count: { _all: true } }),
  ]);

  if (csv) {
    const header = ["event_id", "awarded_at", "game", "score", "prize_id", "prize_name", "status", "flagged", "overridden", "session_id", "kiosk_id", "kiosk_name", "config_version", "notes"];
    const lines = rows.map((r) =>
      [r.id, r.awardedAt.toISOString(), r.game, r.score, r.prizeId, r.prizeName, r.status, r.flagged, r.overridden, r.sessionId, r.kioskId, r.kiosk.name, r.configVersion, r.notes]
        .map(csvCell)
        .join(","),
    );
    return new Response([header.join(","), ...lines].join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="prize-awards-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return json({
    awards: rows.map(({ kiosk, ...r }) => ({ ...r, kioskName: kiosk.name })),
    truncated: rows.length === TABLE_LIMIT,
    counts: counts.map((c) => ({ prizeId: c.prizeId, prizeName: c.prizeName, status: c.status, count: c._count._all })),
  });
});
