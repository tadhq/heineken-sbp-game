import { authenticateKiosk } from "@/server/auth";
import { error, json, route } from "@/server/route";
import { ingestBatch, rawBatchSchema } from "@/server/sync";

/** Kiosk outbox upload. Idempotent: re-sending a batch never duplicates sessions or awards. */
export const POST = route(async (req) => {
  const kioskId = await authenticateKiosk(req);
  if (!kioskId) return error(401, "kiosk_unauthorized");
  const batch = rawBatchSchema.parse(await req.json());
  return json(await ingestBatch(kioskId, batch));
});
