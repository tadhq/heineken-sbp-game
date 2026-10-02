import { z } from "zod";
import { getPinSetting, issueAdminSession, setPin, verifyPin } from "@/server/auth";
import { adminRoute, error, json } from "@/server/route";
import { clientIp, registerAttempt, registerSuccess } from "@/server/throttle";

const body = z.object({ currentPin: z.string(), newPin: z.string().regex(/^\d{4,8}$/) });

export const POST = adminRoute(async (req) => {
  const { currentPin, newPin } = body.parse(await req.json());
  // Same brute-force budget as login: a hijacked session cannot guess the PIN here either.
  const ip = clientIp(req);
  const wait = await registerAttempt(ip);
  if (wait > 0) return error(429, "too_many_attempts", { retryAfter: wait });
  const pin = await getPinSetting();
  if (!pin || !verifyPin(currentPin, pin.hash)) return error(401, "wrong_pin");
  await registerSuccess(ip);
  await setPin(newPin);
  // New PIN version logs out every other session; keep this one.
  await issueAdminSession(pin.version + 1);
  return json({ ok: true });
});
