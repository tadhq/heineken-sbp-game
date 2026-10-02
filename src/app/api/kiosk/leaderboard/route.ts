import { z } from "zod";
import { gameIdSchema } from "@/lib/config-schema";
import { getCurrentConfig } from "@/server/config-store";
import { getBoard } from "@/server/leaderboard";
import { json, kioskOptions, kioskRoute } from "@/server/route";

const query = z.object({ game: gameIdSchema, scope: z.enum(["daily", "all"]) });

export const GET = kioskRoute(async (req) => {
  const url = new URL(req.url);
  const { game, scope } = query.parse(Object.fromEntries(url.searchParams));
  const { config } = await getCurrentConfig();
  if (!config.kiosk.leaderboardEnabled) return json({ entries: [] });
  return json({ entries: await getBoard(game, scope, config.kiosk.leaderboardSize, config.kiosk.timezone) });
});

export const OPTIONS = kioskOptions;
