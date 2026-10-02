import { DEFAULT_CONFIG, type GameId, normalizeConfig, type VersionedConfig } from "@/lib/config";
import { startOfDay } from "@/lib/time";
import { store, uuid } from "./store";
import { apiUrl } from "./target";

/**
 * Kiosk <-> server traffic. The kiosk works fully offline: config is cached, finished
 * games sit in the outbox until the server confirms them. Uploads are idempotent (the
 * server keys on the kiosk-generated ids), so retrying after a timeout cannot double-count.
 */

const TOKEN_KEY = "kioskToken";
const CONFIG_KEY = "config";
const BOARD_KEY = (g: GameId, s: string) => `board:${g}:${s}`;
const TIMEOUT_MS = 8000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    const data = res.headers.get("content-type")?.includes("json") ? ((await res.json()) as T) : null;
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

/** Cached config immediately; a valid server copy replaces it when reachable. */
export async function loadCachedConfig(): Promise<VersionedConfig> {
  const cached = await store.get<VersionedConfig>(CONFIG_KEY);
  const config = cached ? normalizeConfig(cached.config) : null;
  // Corrupted cache: fall back to built-in defaults rather than a blank kiosk.
  return cached && config ? { version: cached.version, config } : { version: 0, config: DEFAULT_CONFIG };
}

export async function refreshConfig(): Promise<VersionedConfig | null> {
  try {
    const { status, data } = await fetchJson<VersionedConfig>(apiUrl("/api/kiosk/config"));
    if (status !== 200 || !data) return null;
    // The server validated this with the full schema; normalise defensively anyway.
    const config = normalizeConfig(data.config);
    if (!config || !Number.isInteger(data.version)) return null;
    const vc = { version: data.version, config };
    await store.set(CONFIG_KEY, vc);
    return vc;
  } catch {
    return null;
  }
}

export const kioskToken = {
  get: () => store.get<string>(TOKEN_KEY),
  set: (t: string) => store.set(TOKEN_KEY, t),
  clear: () => store.del(TOKEN_KEY),
};

export type SyncStatus = { pending: number; lastSyncAt: number | null; paired: boolean; lastError: string | null };
let status: SyncStatus = { pending: 0, lastSyncAt: null, paired: false, lastError: null };
let inflight: Promise<SyncStatus> | null = null;

export function getSyncStatus() {
  return status;
}

/** Upload everything not on hold. Single-flight: concurrent callers share one run. */
export function flush(): Promise<SyncStatus> {
  inflight ??= doFlush().finally(() => (inflight = null));
  return inflight;
}

async function doFlush(): Promise<SyncStatus> {
  const [items, errors, token] = await Promise.all([store.outbox(), store.errors(), kioskToken.get()]);
  const ready = items.filter((i) => !i.hold).sort((a, b) => a.createdAt - b.createdAt);
  status = { ...status, pending: items.length, paired: !!token };
  if (!token) return (status = { ...status, lastError: "not_paired" });
  if (!ready.length && !errors.length) return status;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return (status = { ...status, lastError: "offline" });

  try {
    for (let i = 0; i < Math.max(ready.length, 1); i += 50) {
      const batch = ready.slice(i, i + 50);
      const errBatch = i === 0 ? errors.slice(0, 100) : [];
      const { status: code, data } = await fetchJson<{ accepted: string[]; rejected: { id: string | null; reason: string }[] }>(
        apiUrl("/api/kiosk/sync"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessions: batch.map((b) => b.payload), errors: errBatch }),
        },
      );
      if (code === 401) {
        // Revoked/expired token: keep every record, wait for an admin to re-pair.
        status = { ...status, paired: false, lastError: "unauthorized" };
        return status;
      }
      if (code !== 200 || !data) throw new Error(`sync HTTP ${code}`);
      for (const id of data.accepted) await store.removeSession(id);
      for (const r of data.rejected) {
        // Malformed forever: park it for inspection instead of retrying endlessly.
        if (!r.id) continue;
        const item = batch.find((b) => b.id === r.id);
        if (item) await store.set(`rejected:${r.id}`, { ...item, reason: r.reason });
        // Make it visible in the admin "kiosk errors" count instead of vanishing quietly.
        logError(`sync rejected ${r.id}: ${r.reason}`, "sync");
        await store.removeSession(r.id);
      }
      for (const e of errBatch) await store.removeError(e.id);
    }
    const left = await store.outbox();
    status = { pending: left.length, lastSyncAt: Date.now(), paired: true, lastError: null };
  } catch (e) {
    status = { ...status, lastError: e instanceof Error ? e.message : "sync_failed" };
  }
  return status;
}

/** Log a client-side problem; it rides along with the next sync. */
export function logError(message: string, context?: string) {
  void store.addError({ id: uuid(), at: new Date().toISOString(), message: message.slice(0, 500), context: context?.slice(0, 200) });
}

// ---------- leaderboard ----------

export type BoardEntry = { id: string; score: number; initials: string | null; endedAt: string; pending?: boolean };

/** Server board merged with this kiosk's unsynced games, so new scores show instantly offline. */
export async function getBoard(game: GameId, scope: "daily" | "all", limit: number, timeZone: string): Promise<BoardEntry[]> {
  let entries = (await store.get<BoardEntry[]>(BOARD_KEY(game, scope))) ?? [];
  try {
    const { status: code, data } = await fetchJson<{ entries: BoardEntry[] }>(apiUrl(`/api/kiosk/leaderboard?game=${game}&scope=${scope}`));
    if (code === 200 && data) {
      entries = data.entries;
      await store.set(BOARD_KEY(game, scope), entries);
    }
  } catch {
    // offline: cached board
  }
  const since = scope === "daily" ? startOfDay(Date.now(), timeZone).getTime() : 0;
  const pending = (await store.outbox())
    .map((i) => i.payload)
    .filter((p) => p.game === game && p.completed && Date.parse(p.endedAt) >= since)
    .map((p) => ({ id: p.id, score: p.score, initials: p.initials, endedAt: p.endedAt, pending: true }));
  const seen = new Set(entries.map((e) => e.id));
  return [...entries, ...pending.filter((p) => !seen.has(p.id))]
    .sort((a, b) => b.score - a.score || Date.parse(a.endedAt) - Date.parse(b.endedAt))
    .slice(0, limit);
}
