import { z } from "zod";
import { getPinSetting, issueKioskToken, verifyPin } from "@/server/auth";
import { db } from "@/server/db";
import { error, json, kioskOptions, kioskRoute } from "@/server/route";
import { clientIp, registerAttempt, registerSuccess } from "@/server/throttle";

const body = z.object({ pin: z.string().regex(/^\d{4,8}$/), name: z.string().trim().min(1).max(60) });

/**
 * Pair a kiosk from the device itself (used by the Android app, which has no admin
 * session): the admin PIN authorizes creating a kiosk and returns its token. Same
 * brute-force budget as the admin login.
 */
export const POST = kioskRoute(async (req) => {
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return error(400, "invalid_request");
  const ip = clientIp(req);
  const wait = await registerAttempt(ip);
  if (wait > 0) return error(429, "too_many_attempts", { retryAfter: wait });
  const pin = await getPinSetting();
  if (!pin) return error(503, "admin_not_configured");
  if (!verifyPin(parsed.data.pin, pin.hash)) return error(401, "wrong_pin");
  await registerSuccess(ip);
  const kiosk = await db.kiosk.create({ data: { name: parsed.data.name } });
  return json({ kiosk: { id: kiosk.id, name: kiosk.name }, token: await issueKioskToken(kiosk.id, kiosk.tokenVersion) });
});

export const OPTIONS = kioskOptions;
