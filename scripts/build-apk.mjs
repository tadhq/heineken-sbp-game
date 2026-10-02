// Builds the Android kiosk APK: static kiosk export -> Capacitor sync -> Gradle.
//   NEXT_PUBLIC_API_BASE=https://your-app.vercel.app pnpm apk:build            (release)
//   NEXT_PUBLIC_API_BASE=http://10.0.2.2:3100 APK_DEBUG=1 pnpm apk:build       (emulator test)
// Release signing reads android/keystore.properties (not in git, see README).
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const api = process.env.NEXT_PUBLIC_API_BASE;
const debug = process.env.APK_DEBUG === "1";
if (!api) throw new Error("Set NEXT_PUBLIC_API_BASE to the deployed site, e.g. https://your-app.vercel.app");
if (!debug && !api.startsWith("https://")) throw new Error("Release APKs must use an https API base");

const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME ?? "/opt/homebrew/opt/openjdk@21",
  ANDROID_HOME: process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools",
};
const run = (cmd, cwd = ".") => execSync(cmd, { stdio: "inherit", env, cwd });

run("pnpm apk:web");
run("pnpm exec cap sync android");
const task = debug ? "assembleDebug" : "assembleRelease";
run(`./gradlew ${task} --no-daemon -q`, "android");

const variant = debug ? "debug" : "release";
const src = `android/app/build/outputs/apk/${variant}/app-${variant}${!debug && !existsSync("android/keystore.properties") ? "-unsigned" : ""}.apk`;
mkdirSync("dist-apk", { recursive: true });
const out = `dist-apk/heineken-games-${variant}.apk`;
copyFileSync(src, out);
console.log(`\nAPK ready: ${out}`);
