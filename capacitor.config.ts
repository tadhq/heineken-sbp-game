import type { CapacitorConfig } from "@capacitor/cli";

// Android kiosk app: the static kiosk export (pnpm apk:web) is bundled inside the APK and
// served from https://localhost, so the games run with no network at all.
const config: CapacitorConfig = {
  appId: "com.activation.heinekengames",
  appName: "Heineken Games",
  webDir: ".next-apk",
  android: {
    // Never load http content into the https app shell.
    allowMixedContent: false,
    // Remote debugging (chrome://inspect) only in debug builds.
    webContentsDebuggingEnabled: process.env.APK_DEBUG === "1",
  },
};

export default config;
