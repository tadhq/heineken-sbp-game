import { store } from "./store";
import { apiUrl } from "./target";
import { flush, kioskToken } from "./sync";

/**
 * Offline staff access. The admin PIN is verified by the server once, when the kiosk is
 * paired; the device then keeps only a salted PBKDF2 hash of it, so staff can unlock the
 * staff screen without internet. After a PIN change on the server, re-pair the kiosk.
 * Local lockout: 5 wrong PINs lock the screen for 5 minutes.
 */

type PinRecord = { salt: string; hash: string; iterations: number };
const PIN_KEY = "staffPin";
const LOCK_KEY = "staffLock";
const NAME_KEY = "kioskName";
const ITERATIONS = 210_000;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return b64(bits);
}

export const hasLocalPin = async () => !!(await store.get<PinRecord>(PIN_KEY));
export const kioskName = () => store.get<string>(NAME_KEY);

export async function lockedFor(): Promise<number> {
  const lock = await store.get<{ fails: number; until: number }>(LOCK_KEY);
  return lock && lock.until > Date.now() ? Math.ceil((lock.until - Date.now()) / 1000) : 0;
}

/** true = correct. Counts failures toward the local lockout. */
export async function verifyLocalPin(pin: string): Promise<boolean> {
  const rec = await store.get<PinRecord>(PIN_KEY);
  if (!rec) return false;
  const ok = (await derive(pin, unb64(rec.salt), rec.iterations)) === rec.hash;
  const lock = (await store.get<{ fails: number; until: number }>(LOCK_KEY)) ?? { fails: 0, until: 0 };
  if (ok) await store.set(LOCK_KEY, { fails: 0, until: 0 });
  else {
    const fails = lock.fails + 1;
    await store.set(LOCK_KEY, { fails: fails >= 5 ? 0 : fails, until: fails >= 5 ? Date.now() + 5 * 60_000 : 0 });
  }
  return ok;
}

export type PairResult = { ok: true; name: string } | { ok: false; reason: "wrong_pin" | "locked" | "offline" | "error"; retryAfter?: number };

/** Online: verify the admin PIN with the server, register this device, keep a local PIN hash. */
export async function pairKiosk(pin: string, name: string): Promise<PairResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/kiosk/pair"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, name }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "offline" };
  }
  const data = (await res.json().catch(() => ({}))) as { token?: string; kiosk?: { name: string }; retryAfter?: number };
  if (res.status === 401) return { ok: false, reason: "wrong_pin" };
  if (res.status === 429) return { ok: false, reason: "locked", retryAfter: data.retryAfter };
  if (!res.ok || !data.token) return { ok: false, reason: "error" };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await store.set(PIN_KEY, { salt: b64(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS } satisfies PinRecord);
  await kioskToken.set(data.token);
  await store.set(NAME_KEY, data.kiosk?.name ?? name);
  void flush();
  return { ok: true, name: data.kiosk?.name ?? name };
}
