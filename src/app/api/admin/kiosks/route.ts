import { z } from "zod";
import { issueKioskToken } from "@/server/auth";
import { db } from "@/server/db";
import { adminRoute, json } from "@/server/route";

export const GET = adminRoute(async () =>
  json({ kiosks: await db.kiosk.findMany({ orderBy: { createdAt: "asc" } }) }),
);

const body = z.object({ name: z.string().trim().min(1).max(60) });

/**
 * Registers the device the admin is using as a kiosk. The token goes back to this
 * browser only (it is stored on-device by the admin page) and authorizes session sync.
 */
export const POST = adminRoute(async (req) => {
  const { name } = body.parse(await req.json());
  const kiosk = await db.kiosk.create({ data: { name } });
  return json({ kiosk, token: await issueKioskToken(kiosk.id, kiosk.tokenVersion) });
});
