import "dotenv/config";
import { defineConfig } from "@playwright/test";

// Runs against a production build (`pnpm build`), never the dev server: the service
// worker and real bundle sizes only exist there.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 1,
    hasTouch: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/kiosk/config`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
