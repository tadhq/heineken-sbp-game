import { z } from "zod";
import { getPinSetting, issueAdminSession, verifyPin } from "@/server/auth";
import { clientIp, registerAttempt, registerSuccess } from "@/server/throttle";
import { error, json, route } from "@/server/route";

const body = z.object({ pin: z.string().regex(/^\d{4,8}$/) });

export const POST = route(async (req) => {
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return error(400, "invalid_pin_format");

  const ip = clientIp(req);
  const wait = await registerAttempt(ip);
  if (wait > 0) return error(429, "too_many_attempts", { retryAfter: wait });

  const pin = await getPinSetting();
  if (!pin) return error(503, "admin_not_configured");
  if (!verifyPin(parsed.data.pin, pin.hash)) return error(401, "wrong_pin");

  await registerSuccess(ip);
  await issueAdminSession(pin.version);
  return json({ ok: true });
});
