import { z } from "zod";
import { db } from "@/server/db";
import { adminRoute, error, json } from "@/server/route";

const body = z.object({ status: z.enum(["awarded", "voided"]), notes: z.string().max(500).optional() });

/** Manual override: void an award (e.g. prize not handed out) or restore it, with a note. */
export const PATCH = adminRoute<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error(400, "invalid_id");
  const { status, notes } = body.parse(await req.json());
  const existing = await db.prizeAward.findUnique({ where: { id } });
  if (!existing) return error(404, "not_found");
  const award = await db.prizeAward.update({
    where: { id },
    data: { status, overridden: true, ...(notes !== undefined && { notes }) },
  });
  return json({ award });
});
