import { getCurrentConfig } from "@/server/config-store";
import { json, kioskOptions, kioskRoute } from "@/server/route";

// Public on purpose: thresholds must reach the kiosk so it can award prizes offline.
// Changing them requires an admin session (see /api/admin/config).
export const GET = kioskRoute(async () => json(await getCurrentConfig()));

export const OPTIONS = kioskOptions;
