import { getCurrentConfig } from "@/server/config-store";
import { json, route } from "@/server/route";

// Public on purpose: thresholds must reach the kiosk so it can award prizes offline.
// Changing them requires an admin session (see /api/admin/config).
export const GET = route(async () => json(await getCurrentConfig()));
