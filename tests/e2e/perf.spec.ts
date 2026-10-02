import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { adminContext, getConfig, putConfig, resetThrottle, waitScreen } from "./helpers";

/*
 * Low-end proxy (pnpm exec playwright test --grep @perf): 6x CPU throttling, real kiosk
 * resolution, quality "auto" (the default). Records fps per game and which quality level
 * the runner settled on. Writes test-results/perf.json.
 */
test("@perf auto quality under 6x CPU throttle", async ({ page, context }) => {
  test.setTimeout(300_000);
  await resetThrottle();
  const admin = await adminContext("10.8.0.1");
  const original = (await getConfig(admin)).config;
  const cfg = structuredClone(original);
  cfg.kiosk.quality = "auto";
  cfg.kiosk.language = "en";
  cfg.star.durationSec = 20;
  cfg.crate.maxDurationSec = 20;
  await putConfig(admin, cfg, "perf");
  const results: Record<string, { fps: number[]; level: string[] }> = {};
  try {
    await page.setViewportSize({ width: 1080, height: 1920 });
    await page.goto("/?bot&fps");
    await page.evaluate(() => localStorage.removeItem("kiosk.quality"));
    const cdp = await context.newCDPSession(page);
    await page.locator('[data-screen="attract"]').click({ position: { x: 540, y: 1500 } });
    for (const game of ["Star Catcher", "Crate Stacker"]) {
      await waitScreen(page, "select");
      await page.getByRole("button", { name: new RegExp(game, "i") }).first().click();
      await page.getByRole("button", { name: /^start$/i }).click();
      await waitScreen(page, "play", 60_000);
      await page.locator('[data-screen="play"]').click({ position: { x: 30, y: 300 } });
      // Throttle only while playing: that is the frame budget that matters.
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      const r = (results[game] = { fps: [] as number[], level: [] as string[] });
      while (!(await page.locator('[data-screen="result"]').isVisible())) {
        const [fps, , , , level] = ((await page.locator(".font-mono").textContent().catch(() => "")) ?? "").split(/\s+/);
        if (Number(fps) > 0) {
          r.fps.push(Number(fps));
          r.level.push(level);
        }
        await page.waitForTimeout(1000);
      }
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const skip = page.getByRole("button", { name: "Skip" });
      if (await skip.isVisible({ timeout: 2500 }).catch(() => false)) await skip.click();
      await page.getByRole("button", { name: "Other game" }).click();
    }
  } finally {
    await putConfig(await adminContext("10.8.0.2"), original, "perf restore");
  }
  writeFileSync("test-results/perf.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([g, r]) => [g, { levels: [...new Set(r.level)], fps: r.fps.join(" ") }])), null, 1));
  for (const r of Object.values(results)) expect(r.fps.length).toBeGreaterThan(5);
});
