import { test } from "@playwright/test";
import { adminContext, getConfig, putConfig, resetThrottle, waitScreen } from "./helpers";

/*
 * Visual QA captures (pnpm exec playwright test --grep @shots): every screen at the real
 * kiosk resolution, including mid-game frames, into test-results/shots/.
 */
const OUT = "test-results/shots";

test("@shots kiosk screens at 1080x1920", async ({ page }) => {
  test.setTimeout(240_000);
  await resetThrottle();
  const admin = await adminContext("10.7.0.1");
  const original = (await getConfig(admin)).config;
  const cfg = structuredClone(original);
  cfg.kiosk.language = (process.env.SHOT_LANG as "nl" | "en") ?? "nl";
  cfg.prizes = cfg.prizes.map((p) => ({ ...p, minScore: Math.round(p.minScore / 20), maxScore: p.maxScore === null ? null : Math.round(p.maxScore / 20) }));
  await putConfig(admin, cfg, "shots");
  try {
    await page.setViewportSize({ width: 1080, height: 1920 });
    await page.goto("/?bot&fps");
    await waitScreen(page, "attract");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/01-attract.png` });
    await page.locator('[data-screen="attract"]').click({ position: { x: 540, y: 1500 } });
    await waitScreen(page, "select");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/02-select.png` });

    for (const [n, name] of [
      ["star", /star catcher/i],
      ["crate", /crate stacker/i],
    ] as const) {
      await page.getByRole("button", { name }).first().click();
      await waitScreen(page, "intro");
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/03-${n}-intro.png` });
      await page.getByRole("button", { name: /^start$/i }).click();
      await waitScreen(page, "play");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/04-${n}-countdown.png` });
      await page.waitForTimeout(2200);
      for (const t of [3, 9, 18]) {
        await page.waitForTimeout(t === 3 ? 3000 : 6000);
        if (await page.locator('[data-screen="play"]').isVisible()) await page.screenshot({ path: `${OUT}/05-${n}-play-${t}s.png` });
      }
      await waitScreen(page, "result", 200_000);
      await page.waitForTimeout(2200);
      await page.screenshot({ path: `${OUT}/06-${n}-result.png` });
      const skip = page.getByRole("button", { name: /overslaan|skip/i });
      if (await skip.isVisible().catch(() => false)) await skip.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/07-${n}-result-closed.png` });
      await page.getByRole("button", { name: /ander spel|other game/i }).click();
      await waitScreen(page, "select");
    }
    await page.getByRole("button", { name: /ranglijst|leaderboard/i }).click();
    await waitScreen(page, "board");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/08-board.png` });
  } finally {
    await putConfig(admin, original, "shots restore");
  }
});
