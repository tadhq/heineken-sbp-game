import "server-only";
import { z } from "zod";
import type { AppConfig } from "@/lib/config";
import { checkPlausibility, clientErrorSchema, initialsAllowed, type SessionPayload, sessionPayloadSchema } from "@/lib/session";
import { Prisma } from "../../generated/prisma/client";
import { getConfigVersion } from "./config-store";
import { db } from "./db";

export const rawBatchSchema = z.object({
  sessions: z.array(z.unknown()).max(100),
  errors: z.array(z.unknown()).max(100).optional(),
});

export type SyncResult = {
  /** Stored now or already stored earlier: the kiosk can drop these from its outbox. */
  accepted: string[];
  /** Malformed records the server will never accept: the kiosk should not retry them. */
  rejected: { id: string | null; reason: string }[];
};

type Outcome = "stored" | "duplicate";

async function storeSession(kioskId: string, s: SessionPayload, config: AppConfig): Promise<Outcome> {
  const flags = checkPlausibility(config, s);
  try {
    await db.$transaction(async (tx) => {
      await tx.gameSession.create({
        data: {
          id: s.id,
          kioskId,
          game: s.game,
          startedAt: new Date(s.startedAt),
          endedAt: new Date(s.endedAt),
          durationMs: s.durationMs,
          score: s.score,
          completed: s.completed,
          isReplay: s.isReplay,
          configVersion: s.configVersion,
          stats: s.stats,
          initials: s.initials && initialsAllowed(s.initials) ? s.initials : null,
          flags,
          hiddenFromBoard: flags.length > 0 || !s.completed,
        },
      });
      if (s.prize) {
        await tx.prizeAward.create({
          data: {
            id: s.prize.awardId,
            sessionId: s.id,
            kioskId,
            game: s.game,
            score: s.score,
            prizeId: s.prize.prizeId,
            prizeName: s.prize.prizeName,
            configVersion: s.configVersion,
            awardedAt: new Date(s.endedAt),
            flagged: flags.length > 0,
          },
        });
      }
    });
    return "stored";
  } catch (e) {
    // Unique violation on the session or award id: this record was synced before.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    throw e;
  }
}

export async function ingestBatch(kioskId: string, batch: z.infer<typeof rawBatchSchema>): Promise<SyncResult> {
  const result: SyncResult = { accepted: [], rejected: [] };
  const configs = new Map<number, AppConfig>();

  for (const raw of batch.sessions) {
    const parsed = sessionPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      const id = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : null;
      result.rejected.push({ id, reason: parsed.error.issues[0]?.message ?? "invalid" });
      continue;
    }
    const config = await getConfigVersion(parsed.data.configVersion, configs);
    await storeSession(kioskId, parsed.data, config);
    result.accepted.push(parsed.data.id);
  }

  const errors = (batch.errors ?? []).flatMap((e) => {
    const p = clientErrorSchema.safeParse(e);
    return p.success ? [{ ...p.data, at: new Date(p.data.at), kioskId }] : [];
  });
  if (errors.length) await db.clientError.createMany({ data: errors, skipDuplicates: true });

  return result;
}
