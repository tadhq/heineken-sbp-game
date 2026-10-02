import { z } from "zod";
import { db } from "@/server/db";
import { adminRoute, error, json } from "@/server/route";

const body = z.object({ hiddenFromBoard: z.boolean() });

/** Hide/show one leaderboard entry (e.g. rude initials) without deleting the session. */
export const PATCH = adminRoute<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error(400, "invalid_id");
  const { hiddenFromBoard } = body.parse(await req.json());
  const res = await db.gameSession.updateMany({ where: { id }, data: { hiddenFromBoard } });
  if (!res.count) return error(404, "not_found");
  return json({ ok: true });
});
