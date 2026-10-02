import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, type Page, request } from "@playwright/test";
import pg from "pg";
import type { AppConfig, VersionedConfig } from "../../src/lib/config";

export const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const PIN = process.env.ADMIN_PIN ?? "";

/** Direct DB access for setup/assertions. Refuses anything but a local database. */
export async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL ?? "";
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`E2E refuses to touch non-local DB host ${host}`);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export const resetThrottle = () => withDb((c) => c.query('DELETE FROM "LoginThrottle"'));

/** Admin API context. `ip` isolates throttle buckets (x-forwarded-for, trusted only behind Vercel). */
export async function adminContext(ip = "10.0.0.1"): Promise<APIRequestContext> {
  if (!PIN) throw new Error("ADMIN_PIN must be set for e2e");
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": ip } });
  const res = await ctx.post("/api/admin/login", { data: { pin: PIN } });
  expect(res.status(), await res.text()).toBe(200);
  return ctx;
}

export async function pairKiosk(admin: APIRequestContext, name = `e2e-${Date.now()}`) {
  const res = await admin.post("/api/admin/kiosks", { data: { name } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { token: string; kiosk: { id: string } };
}

export async function getConfig(admin: APIRequestContext): Promise<VersionedConfig> {
  return (await admin.get("/api/admin/config")).json();
}

export async function putConfig(admin: APIRequestContext, config: AppConfig, note = "e2e") {
  const res = await admin.put("/api/admin/config", { data: { config, note } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as VersionedConfig;
}

export function starSession(over: Record<string, unknown> = {}) {
  const end = Date.now();
  return {
    id: randomUUID(),
    game: "star",
    startedAt: new Date(end - 46_000).toISOString(),
    endedAt: new Date(end).toISOString(),
    durationMs: 45_000,
    score: 620,
    completed: true,
    isReplay: false,
    configVersion: 0,
    initials: null,
    stats: { caught: 40, golden: 2, hazards: 1, dodges: 3, missed: 6, chills: 1, bestCombo: 18 },
    prize: null,
    ...over,
  };
}

// ---------- browser helpers ----------

export async function setKioskToken(page: Page, token: string) {
  await page.evaluate(async (t) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("heineken-kiosk", 1);
      r.onupgradeneeded = () => ["outbox", "errors", "kv"].forEach((s) => r.result.createObjectStore(s));
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(t, "kioskToken");
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
  }, token);
}

export async function outbox(page: Page): Promise<{ id: string; hold: boolean; payload: { score: number; prize: unknown; initials: string | null } }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("heineken-kiosk", 1);
        r.onsuccess = () => {
          const q = r.result.transaction("outbox", "readonly").objectStore("outbox").getAll();
          q.onsuccess = () => {
            r.result.close();
            resolve(q.result);
          };
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

export const screen = (page: Page) => page.locator("[data-screen]").getAttribute("data-screen");

export async function waitScreen(page: Page, name: string, timeout = 30_000) {
  await expect(page.locator(`[data-screen="${name}"]`)).toBeVisible({ timeout });
}

/** From the select screen: pick a game, start, skip the countdown, let the bot play. */
export async function playOnce(page: Page, game: "Star Catcher" | "Crate Stacker", timeout = 90_000) {
  await waitScreen(page, "select");
  await page.getByRole("button", { name: new RegExp(game, "i") }).first().click();
  await waitScreen(page, "intro");
  await page.getByRole("button", { name: /^(start)$/i }).click();
  await waitScreen(page, "play");
  // Tap the countdown overlay to skip it (it sits above the canvas).
  await page.locator('[data-screen="play"]').click({ position: { x: 30, y: 300 } });
  await waitScreen(page, "result", timeout);
  await page.waitForTimeout(1600); // prize card / initials sheet animate in
  await assertFitsStage(page);
}

/** Every visible, interactive or text element must sit inside the 1080x1920 stage. */
export async function assertFitsStage(page: Page) {
  const out = await page.evaluate(() => {
    const root = document.querySelector("[data-screen]") as HTMLElement;
    const stage = root.getBoundingClientRect();
    const bad: string[] = [];
    root.querySelectorAll("button, p, h1, h2, li, input, img").forEach((el) => {
      if (el.closest("[aria-hidden]")) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.bottom > stage.bottom + 1 || r.top < stage.top - 1 || r.right > stage.right + 1 || r.left < stage.left - 1)
        bad.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
    });
    return bad;
  });
  expect(out, "elements outside the stage").toEqual([]);
}
