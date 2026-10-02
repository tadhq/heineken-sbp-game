import { ADMIN_SESSION_SECONDS } from "@/server/auth";
import { adminRoute, json } from "@/server/route";

/** Keep-alive / auth probe for the dashboard. */
export const GET = adminRoute(async () => json({ ok: true, expiresIn: ADMIN_SESSION_SECONDS }));
