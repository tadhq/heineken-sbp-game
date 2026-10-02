import { z } from "zod";
import { db } from "@/server/db";
import { adminRoute, error, json } from "@/server/route";

/** Revoke: bumping tokenVersion invalidates every token issued to this kiosk. */
export const DELETE = adminRoute<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error(400, "invalid_id");
  const res = await db.kiosk.updateMany({ where: { id }, data: { tokenVersion: { increment: 1 } } });
  if (!res.count) return error(404, "not_found");
  return json({ ok: true });
});
