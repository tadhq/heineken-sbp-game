import "server-only";
import { type AppConfig, DEFAULT_CONFIG, type VersionedConfig } from "@/lib/config";
import { appConfigSchema } from "@/lib/config-schema";
import { db } from "./db";

/** Latest saved config. Falls back to built-in defaults (version 0) on an empty DB. */
export async function getCurrentConfig(): Promise<VersionedConfig> {
  const row = await db.configVersion.findFirst({ orderBy: { version: "desc" } });
  if (!row) return { version: 0, config: DEFAULT_CONFIG };
  return { version: row.version, config: appConfigSchema.parse(row.data) };
}

/** Config a session was played under; unknown versions fall back to the current one. */
export async function getConfigVersion(version: number, cache: Map<number, AppConfig>): Promise<AppConfig> {
  const hit = cache.get(version);
  if (hit) return hit;
  const row = version === 0 ? null : await db.configVersion.findUnique({ where: { version } });
  const config = row ? appConfigSchema.parse(row.data) : version === 0 ? DEFAULT_CONFIG : (await getCurrentConfig()).config;
  cache.set(version, config);
  return config;
}

/** Saves a new immutable version. Retries once if another save took the same number. */
export async function saveConfig(config: AppConfig, note?: string): Promise<VersionedConfig> {
  const parsed = appConfigSchema.parse(config);
  for (let attempt = 0; ; attempt++) {
    const { version } = await getCurrentConfig();
    try {
      await db.configVersion.create({ data: { version: version + 1, data: parsed, note } });
      return { version: version + 1, config: parsed };
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
}
