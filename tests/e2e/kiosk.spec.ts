import { expect, test } from "@playwright/test";
import { type AppConfig, resolvePrize } from "../../src/lib/config";
import { adminContext, getConfig, outbox, pairKiosk, playOnce, putConfig, resetThrottle, setKioskToken, waitScreen, withDb } from "./helpers";

/*
 * Full kiosk journeys in a real (headless) Chromium against the production build.
 * `?bot` turns on the in-game autopilot so rounds play themselves.
 */

let original: AppConfig;
let testConfig: AppConfig;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await resetThrottle();
  const admin = await adminContext("10.4.0.1");
  original = (await getConfig(admin)).config;
  testConfig = structuredClone(original);
  testConfig.star.durationSec = 15;
  testConfig.crate.maxDurationSec = 12;
  testConfig.kiosk.attractDelaySec = 10;
  testConfig.kiosk.ageGate.enabled = false;
  testConfig.kiosk.defaultGame = null;
  testConfig.kiosk.language = "en";
  testConfig.kiosk.leaderboardEnabled = true;
  testConfig.kiosk.leaderboardInitials = true;
  // Low thresholds so a bot round reliably wins something.
  testConfig.prizes = testConfig.prizes.map((p) => ({ ...p, minScore: Math.round(p.minScore / 10), maxScore: p.maxScore === null ? null : Math.round(p.maxScore / 10) }));
  await putConfig(admin, testConfig, "e2e: short rounds");
});

test.afterAll(async () => {
  const admin = await adminContext("10.4.0.2");
  await putConfig(admin, original, "e2e: restore");
});

test("Star Catcher: attract to result, prize matches the rules, record saved before reveal", async ({ page }) => {
  await page.goto("/?bot");
  await waitScreen(page, "attract");
  await page.locator('[data-screen="attract"]').click({ position: { x: 270, y: 700 } });
  await playOnce(page, "Star Catcher", 60_000);

  const items = await outbox(page);
  expect(items).toHaveLength(1);
  const { score, prize } = items[0].payload;
  expect(score).toBeGreaterThan(0);
  const expected = resolvePrize(testConfig, "star", score);
  if (expected) {
    expect(prize).toMatchObject({ prizeId: expected.id });
    await expect(page.getByText("Congratulations!")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(expected.name, { exact: true })).toBeVisible();
    await expect(page.getByText(/Code: [0-9A-F]{6}/)).toBeVisible();
  } else {
    expect(prize).toBeNull();
    await expect(page.getByText("Thanks for playing!")).toBeVisible();
  }
});

test("Crate Stacker offline: plays, keeps the result, syncs exactly once when back online", async ({ page, context }) => {
  const admin = await adminContext("10.4.0.3");
  const { token } = await pairKiosk(admin, "e2e offline kiosk");
  await page.goto("/?bot");
  await setKioskToken(page, token);
  await page.reload();
  await waitScreen(page, "attract");

  await context.setOffline(true);
  await page.locator('[data-screen="attract"]').click({ position: { x: 270, y: 700 } });
  await playOnce(page, "Crate Stacker", 60_000);
  // Skip the initials prompt if it appears.
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.getByText(/Offline/)).toBeVisible();
  const queued = await outbox(page);
  expect(queued.length).toBeGreaterThanOrEqual(1);
  const id = queued[queued.length - 1].id;

  await context.setOffline(false);
  await expect.poll(async () => (await outbox(page)).length, { timeout: 20_000 }).toBe(0);
  const row = await withDb(async (c) => (await c.query('SELECT s.score, a.id AS award FROM "GameSession" s LEFT JOIN "PrizeAward" a ON a."sessionId" = s.id WHERE s.id = $1', [id])).rows);
  expect(row).toHaveLength(1);
  expect(row[0].score).toBe(queued[queued.length - 1].payload.score);
  expect(!!row[0].award).toBe(!!queued[queued.length - 1].payload.prize);
});

test("leaderboard initials: entered on the kiosk, shown highlighted on the board", async ({ page }) => {
  // Empty today's board so any score qualifies (earlier runs leave high scores behind).
  const admin = await adminContext("10.4.0.4");
  expect((await admin.post("/api/admin/leaderboard", { data: { game: "crate", scope: "daily" } })).status()).toBe(200);
  await page.goto("/?bot");
  await page.locator('[data-screen="attract"]').click({ position: { x: 270, y: 700 } });
  await playOnce(page, "Crate Stacker", 60_000);
  await expect(page.getByText("You made the top! Your initials?")).toBeVisible();
  for (const k of ["Q", "A", "Z"]) await page.getByRole("button", { name: k, exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await waitScreen(page, "board");
  await expect(page.locator("li.bg-gold")).toContainText("QAZ");
  const items = await outbox(page);
  expect(items.find((i) => i.payload.initials === "QAZ")?.hold ?? false).toBe(false);
});

test("inactivity returns to the attract screen", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-screen="attract"]').click({ position: { x: 270, y: 700 } });
  await waitScreen(page, "select");
  await waitScreen(page, "attract", 20_000);
});

test("replay goes straight back into the same game and is counted as a replay", async ({ page }) => {
  await page.goto("/?bot");
  await page.locator('[data-screen="attract"]').click({ position: { x: 270, y: 700 } });
  await playOnce(page, "Crate Stacker", 60_000);
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: "Play again" }).click();
  await waitScreen(page, "play");
  await page.locator('[data-screen="play"]').click({ position: { x: 30, y: 300 } });
  await waitScreen(page, "result", 60_000);
  const items = await outbox(page);
  expect(items.some((i) => (i.payload as unknown as { isReplay: boolean }).isReplay)).toBe(true);
});

test("a reload while offline still opens the kiosk (service worker)", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Second load runs under the worker's control and caches everything it fetched.
  await page.reload();
  await waitScreen(page, "attract");
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();
  await waitScreen(page, "attract", 15_000);
  await page.locator('[data-screen="attract"]').click({ position: { x: 270, y: 700 } });
  await waitScreen(page, "select");
  await context.setOffline(false);
});

for (const vp of [
  { width: 1080, height: 1920 },
  { width: 540, height: 960 },
  { width: 1920, height: 1080 },
  { width: 360, height: 740 },
]) {
  test(`no scrolling or overflow at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/");
    for (const step of ["attract", "select"]) {
      await waitScreen(page, step);
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        sh: document.documentElement.scrollHeight,
        w: innerWidth,
        h: innerHeight,
      }));
      expect(m.sw, step).toBeLessThanOrEqual(m.w);
      expect(m.sh, step).toBeLessThanOrEqual(m.h);
      if (step === "attract") {
        // Positions are relative to the (letterboxed, scaled) stage, not the viewport.
        const box = (await page.locator('[data-screen="attract"]').boundingBox())!;
        await page.locator('[data-screen="attract"]').click({ position: { x: box.width / 2, y: box.height * 0.78 } });
      }
    }
  });
}

test("admin: wrong PIN refused, right PIN opens the dashboard, device registration works", async ({ page }) => {
  await resetThrottle();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.4.0.9" });
  await page.goto("/admin");
  await page.getByLabel("PIN").fill("0000" === process.env.ADMIN_PIN ? "1111" : "0000");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Wrong PIN", { exact: true })).toBeVisible(); // Next also renders a route announcer with role=alert
  // Keypad entry, as on the touchscreen.
  for (const d of process.env.ADMIN_PIN!) await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Kiosk admin")).toBeVisible();
  await expect(page.getByText("Games played")).toBeVisible();
  await page.getByRole("button", { name: "Prize history" }).click();
  await page.getByRole("button", { name: "All time" }).click();
  await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
  await page.getByRole("button", { name: "Device & security" }).click();
  await page.getByRole("button", { name: /Register this device/ }).click();
  await expect(page.getByText(/This device is now/)).toBeVisible();
  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByText("Staff only")).toBeVisible();
  // The session is really gone server-side.
  expect((await page.request.get("/api/admin/overview")).status()).toBe(401);
});
