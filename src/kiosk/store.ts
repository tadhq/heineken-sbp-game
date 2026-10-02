import type { ClientError, SessionPayload } from "@/lib/session";

/**
 * Durable on-device storage (IndexedDB). Finished sessions go into the outbox BEFORE the
 * result is shown, so a crash, refresh or network loss can never lose a prize record.
 * If IndexedDB is unavailable (corrupted profile, private mode), falls back to
 * localStorage; if that fails too, to memory, so the kiosk keeps running regardless.
 */

export type OutboxItem = { id: string; payload: SessionPayload; /** Waiting for initials. */ hold: boolean; createdAt: number };

const DB_NAME = "heineken-kiosk";
const DB_VERSION = 1;
const STORES = ["outbox", "errors", "kv"] as const;
type StoreName = (typeof STORES)[number];

interface Backend {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  del(store: StoreName, key: string): Promise<void>;
  all<T>(store: StoreName): Promise<T[]>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function openIdb(): Promise<Backend> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
  const tx = (store: StoreName, mode: IDBTransactionMode) => db.transaction(store, mode).objectStore(store);
  return {
    get: (s, k) => req(tx(s, "readonly").get(k)),
    put: async (s, k, v) => {
      const t = db.transaction(s, "readwrite");
      t.objectStore(s).put(v, k);
      // Resolve on commit, not on request success: the write is durable only then.
      await new Promise<void>((res, rej) => {
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    },
    del: async (s, k) => {
      await req(tx(s, "readwrite").delete(k));
    },
    all: (s) => req(tx(s, "readonly").getAll()),
  };
}

function localBackend(): Backend {
  const mem = new Map<string, unknown>();
  const key = (s: StoreName, k: string) => `hk:${s}:${k}`;
  const read = (full: string) => {
    try {
      const v = localStorage.getItem(full);
      return v === null ? mem.get(full) : JSON.parse(v);
    } catch {
      return mem.get(full);
    }
  };
  return {
    get: async (s, k) => read(key(s, k)),
    put: async (s, k, v) => {
      mem.set(key(s, k), v);
      try {
        localStorage.setItem(key(s, k), JSON.stringify(v));
      } catch {
        // quota/denied: memory copy keeps the session alive
      }
    },
    del: async (s, k) => {
      mem.delete(key(s, k));
      try {
        localStorage.removeItem(key(s, k));
      } catch {}
    },
    all: async (s) => {
      const prefix = `hk:${s}:`;
      const keys = new Set<string>([...mem.keys()].filter((k) => k.startsWith(prefix)));
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(prefix)) keys.add(k);
        }
      } catch {}
      return [...keys].map(read).filter((v) => v !== undefined);
    },
  };
}

let backend: Promise<Backend> | null = null;
export let storageMode: "indexeddb" | "localstorage" = "indexeddb";

function getBackend(): Promise<Backend> {
  backend ??= openIdb().catch((e) => {
    console.warn("[store] IndexedDB unavailable, falling back", e);
    storageMode = "localstorage";
    return localBackend();
  });
  return backend;
}

/** Wrap every call: a storage failure is logged, never thrown into the UI. */
async function safe<T>(fn: (b: Backend) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn(await getBackend());
  } catch (e) {
    console.error("[store]", e);
    return fallback;
  }
}

export const store = {
  addSession: (payload: SessionPayload, hold: boolean) =>
    safe((b) => b.put("outbox", payload.id, { id: payload.id, payload, hold, createdAt: Date.now() } satisfies OutboxItem), undefined),
  updateSession: (id: string, patch: Partial<SessionPayload>, hold = false) =>
    safe(async (b) => {
      const item = await b.get<OutboxItem>("outbox", id);
      if (item) await b.put("outbox", id, { ...item, payload: { ...item.payload, ...patch }, hold });
    }, undefined),
  outbox: () => safe((b) => b.all<OutboxItem>("outbox"), [] as OutboxItem[]),
  removeSession: (id: string) => safe((b) => b.del("outbox", id), undefined),
  addError: (e: ClientError) => safe((b) => b.put("errors", e.id, e), undefined),
  errors: () => safe((b) => b.all<ClientError>("errors"), [] as ClientError[]),
  removeError: (id: string) => safe((b) => b.del("errors", id), undefined),
  get: <T>(key: string) => safe((b) => b.get<T>("kv", key), undefined),
  set: (key: string, value: unknown) => safe((b) => b.put("kv", key, value), undefined),
  del: (key: string) => safe((b) => b.del("kv", key), undefined),
};

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context; plain-HTTP LAN testing still gets RFC 4122 v4.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
