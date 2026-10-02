import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { adminContext, getConfig, outbox, pairKiosk, putConfig, resetThrottle, setKioskToken, waitScreen, withDb } from "./helpers";

/*
 * Long-session soak: one page, many back-to-back bot games, like a kiosk all day.
 * Run: pnpm test:soak (SOAK_GAMES=120 by default). Writes test-results/soak.json.
 * Heap numbers are taken after a forced GC so they show retained memory, not garbage.
 */

const GAMES = Number(process.env.SOAK_GAMES ?? 120);
const THROTTLED_FROM = GAMES - 12; // last games under 6x CPU slowdown (low-end proxy)

test("@soak long session stays stable", async ({ page, context }) => {
  test.setTimeout(GAMES * 40_000 + 120_000);
  await resetThrottle();
  const admin = await adminContext("10.6.0.1");
  const original = (await getConfig(admin)).config;
  const cfg = structuredClone(original);
  cfg.crate.maxDurationSec = 8;
  cfg.star.durationSec = 15;
  cfg.kiosk.language = "en";
  cfg.kiosk.leaderboardInitials = false;
  cfg.kiosk.quality = "high"; // measure the expensive path; auto-drop is tested separately
  await putConfig(admin, cfg, "soak");
  const { token, kiosk } = await pairKiosk(admin, "soak kiosk");

  await page.setViewportSize({ width: 1080, height: 1920 });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");

  await page.goto("/?bot&fps");
  await setKioskToken(page, token);
  await page.reload();
  await waitScreen(page, "attract");
  await page.locator('[data-screen="attract"]').click({ position: { x: 540, y: 1500 } });

  const samples: { game: number; heapMB: number; nodes: number; listeners: number; fps: number[]; throttled: boolean }[] = [];
  const metric = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners };
  };

  let current: "Star Catcher" | "Crate Stacker" = "Crate Stacker";
  await waitScreen(page, "select");
  await page.getByRole("button", { name: /crate stacker/i }).first().click();
  await page.getByRole("button", { name: /^start$/i }).click();

  for (let i = 1; i <= GAMES; i++) {
    if (i === THROTTLED_FROM) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await waitScreen(page, "play");
    await page.locator('[data-screen="play"]').click({ position: { x: 30, y: 300 } });
    const fps: number[] = [];
    const deadline = Date.now() + 60_000;
    while (!(await page.locator('[data-screen="result"]').isVisible())) {
      if (Date.now() > deadline) throw new Error(`game ${i} did not finish`);
      const txt = await page.locator(".font-mono").textContent().catch(() => "");
      const f = Number(txt?.split(" ")[0]);
      if (f > 0) fps.push(f);
      await page.waitForTimeout(1500);
    }
    if (i % 10 === 0 || i === 1 || i >= THROTTLED_FROM) samples.push({ game: i, ...(await metric()), fps, throttled: i >= THROTTLED_FROM });
    if (i === GAMES) break;
    // Mostly replays (the common kiosk loop), every 8th game switch titles via the menu.
    if (i % 8 === 0) {
      current = current === "Crate Stacker" ? "Star Catcher" : "Crate Stacker";
      await page.getByRole("button", { name: "Other game" }).click();
      await waitScreen(page, "select");
      await page.getByRole("button", { name: new RegExp(current, "i") }).first().click();
      await page.getByRole("button", { name: /^start$/i }).click();
    } else {
      await page.getByRole("button", { name: "Play again" }).click();
    }
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.getByRole("button", { name: "Other game" }).click();

  // Everything uploaded, nothing lost, nothing duplicated.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await outbox(page)).length, { timeout: 60_000 }).toBe(0);
  const stored = await withDb(async (c) => Number((await c.query('SELECT count(*) FROM "GameSession" WHERE "kioskId" = $1', [kiosk.id])).rows[0].count));
  const errorsLogged = await withDb(async (c) => Number((await c.query('SELECT count(*) FROM "ClientError" WHERE "kioskId" = $1', [kiosk.id])).rows[0].count));


  const first = samples.find((s) => s.game >= 10) ?? samples[0];
  const lastUnthrottled = [...samples].reverse().find((s) => !s.throttled)!;
  const fpsOf = (pred: (s: (typeof samples)[number]) => boolean) => samples.filter(pred).flatMap((s) => s.fps);
  const avg = (a: number[]) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 0);
  const report = {
    games: GAMES,
    stored,
    errorsLogged,
    pageErrors,
    heapMB: { atGame10: first.heapMB, atEnd: lastUnthrottled.heapMB },
    nodes: { atGame10: first.nodes, atEnd: lastUnthrottled.nodes },
    listeners: { atGame10: first.listeners, atEnd: lastUnthrottled.listeners },
    fps: {
      unthrottledAvg: avg(fpsOf((s) => !s.throttled)),
      unthrottledMin: Math.min(...fpsOf((s) => !s.throttled)),
      throttled6xAvg: avg(fpsOf((s) => s.throttled)),
      throttled6xMin: Math.min(...fpsOf((s) => s.throttled)),
    },
    samples,
  };
  writeFileSync("test-results/soak.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, samples: undefined }, null, 2));
  // Fresh login: the run outlives the 15-minute admin session.
  await putConfig(await adminContext("10.6.0.2"), original, "soak restore");

  expect(pageErrors).toEqual([]);
  expect(errorsLogged).toBe(0);
  expect(stored).toBe(GAMES);
  // Retained memory and DOM must not creep game over game.
  expect(lastUnthrottled.heapMB).toBeLessThan(first.heapMB * 1.3 + 4);
  expect(lastUnthrottled.nodes).toBeLessThan(first.nodes + 300);
  expect(lastUnthrottled.listeners).toBeLessThan(first.listeners + 100);
});
