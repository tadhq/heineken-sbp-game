import { z } from "zod";
import { appConfigSchema } from "@/lib/config-schema";
import { isValidTimeZone } from "@/lib/time";
import { getCurrentConfig, saveConfig } from "@/server/config-store";
import { adminRoute, error, json } from "@/server/route";

const body = z.object({ config: appConfigSchema, note: z.string().max(200).optional() });

export const GET = adminRoute(async () => json(await getCurrentConfig()));

export const PUT = adminRoute(async (req) => {
  const { config, note } = body.parse(await req.json());
  if (!isValidTimeZone(config.kiosk.timezone)) return error(400, "invalid_timezone");
  return json(await saveConfig(config, note));
});
