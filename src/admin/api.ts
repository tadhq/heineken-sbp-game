import { dayKey } from "@/lib/time";

/** Admin fetch helper: JSON in/out, and a single hook for "session expired". */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && path !== "/api/admin/login") onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? "error"), data);
  return data as T;
}

/** Wall-clock helpers kept outside components (render must stay pure). */
export const now = () => Date.now();
export const todayKey = (timeZone: string, daysAgo = 0) => dayKey(now() - daysAgo * 24 * 3600_000, timeZone);

/** Times are always shown in the event timezone, not the admin device's. */
export const fmtDate = (iso: string | Date, timeZone: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
