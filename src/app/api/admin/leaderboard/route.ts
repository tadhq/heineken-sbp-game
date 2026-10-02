import { z } from "zod";
import { gameIdSchema } from "@/lib/config";
import { getCurrentConfig } from "@/server/config-store";
import { getBoard, resetBoard } from "@/server/leaderboard";
import { adminRoute, json } from "@/server/route";

export const GET = adminRoute(async (req) => {
  const url = new URL(req.url);
  const { game, scope } = z.object({ game: gameIdSchema, scope: z.enum(["daily", "all"]) }).parse(Object.fromEntries(url.searchParams));
  const { config } = await getCurrentConfig();
  return json({ entries: await getBoard(game, scope, config.kiosk.leaderboardSize, config.kiosk.timezone) });
});

const body = z.object({ game: gameIdSchema, scope: z.enum(["daily", "all"]) });

export const POST = adminRoute(async (req) => {
  const { game, scope } = body.parse(await req.json());
  await resetBoard(game, scope);
  return json({ ok: true });
});
