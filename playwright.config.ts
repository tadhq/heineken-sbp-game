import "dotenv/config";
import { defineConfig } from "@playwright/test";

// Runs against a production build (`pnpm build`), never the dev server: the service
// worker and real bundle sizes only exist there.
const PORT = Number(process.env.E2E_PORT ?? 3100);

// The test server writes sessions, configs and kiosks through the API: never let it point
// at a shared database. `.env` may hold the Neon URL; override DATABASE_URL for e2e.
const dbHost = new URL(process.env.DATABASE_URL ?? "postgresql://missing").hostname;
if (!["localhost", "127.0.0.1"].includes(dbHost))
  throw new Error(`E2E refuses to run against non-local DB host "${dbHost}". Set DATABASE_URL to a local database.`);

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
