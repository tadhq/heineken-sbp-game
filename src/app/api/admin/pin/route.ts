import { z } from "zod";
import { getPinSetting, issueAdminSession, setPin, verifyPin } from "@/server/auth";
import { adminRoute, error, json } from "@/server/route";

const body = z.object({ currentPin: z.string(), newPin: z.string().regex(/^\d{4,8}$/) });

export const POST = adminRoute(async (req) => {
  const { currentPin, newPin } = body.parse(await req.json());
  const pin = await getPinSetting();
  if (!pin || !verifyPin(currentPin, pin.hash)) return error(401, "wrong_pin");
  await setPin(newPin);
  // New PIN version logs out every other session; keep this one.
  await issueAdminSession(pin.version + 1);
  return json({ ok: true });
});
