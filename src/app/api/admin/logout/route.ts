import { clearAdminSession } from "@/server/auth";
import { json, route } from "@/server/route";

export const POST = route(async () => {
  await clearAdminSession();
  return json({ ok: true });
});
