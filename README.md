# Heineken kiosk games

Star Catcher and Crate Stacker, built for a portrait 1080x1920 Android 11 Chrome kiosk, with a PIN-protected admin dashboard, prize tracking and offline play.

Further reading: [RESEARCH.md](RESEARCH.md) (decisions and sources), [ARCHITECTURE.md](ARCHITECTURE.md), [QA_REPORT.md](QA_REPORT.md).

## Requirements

- Node 20+ and **pnpm** (the lockfile is `pnpm-lock.yaml`; don't use npm or yarn).
- Postgres 15+. Production uses Neon; locally, Docker works.

## Local setup

```bash
pnpm install
docker run -d --name heineken_kiosk_pg -e POSTGRES_USER=kiosk -e POSTGRES_PASSWORD=kiosk_dev_pw \
  -e POSTGRES_DB=kiosk -p 55432:5432 postgres:17-alpine
cp .env.example .env            # then fill in SESSION_SECRET (openssl rand -base64 48) and ADMIN_PIN
pnpm db:migrate                 # applies prisma/migrations to DATABASE_URL
pnpm db:seed                    # creates config v1 and the hashed admin PIN (idempotent)
pnpm dev                        # http://localhost:3000, admin at /admin
```

The service worker only registers in production builds: `pnpm build && pnpm start`.

URL flags for QA: `?fps` shows frame times, and `?bot` makes the games play themselves. A browser without a kiosk token cannot upload results.

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `DATABASE_URL` | server, CLI | Neon **pooled** connection string in production. |
| `SESSION_SECRET` | server | At least 32 random characters. **Required: the app refuses to run without it.** It signs the admin and kiosk tokens; rotating it logs everyone out and un-registers every kiosk. |
| `ADMIN_PIN` | seed script only | Initial PIN, 4-8 digits. It is stored hashed and only read when no PIN exists yet. Change it in `/admin` afterwards. |

## Deploying to Vercel + Neon

1. Create the Neon database and set the three variables in Vercel (Production).
2. Apply migrations and seed **deliberately, against the database you mean**. The build does not migrate, by design.
   ```bash
   DATABASE_URL="<neon url>" pnpm db:deploy
   DATABASE_URL="<neon url>" ADMIN_PIN=<pin> pnpm db:seed
   ```
3. Deploy. The build command is `pnpm build` (`prisma generate && next build`).

## Setting up a kiosk

1. On the kiosk's Chrome (must be Chrome 111 or later, check `chrome://version`), open the site.
2. Open the admin: hold the Heineken mark at the top of the attract screen for 3 seconds, or go to `/admin`. Enter the PIN.
3. Go to **Device & security**, choose **Register this device as kiosk**, and name it. Results now upload automatically.
4. Lock the device to Chrome in portrait with your MDM (lock task / dedicated device), keep the screen on, and disable system gestures.
5. Tap the attract screen once: this goes fullscreen and enables sound.
6. Staff settings on the kiosk itself: press and hold the top-left corner for about a second. Adjust master, music and effects volume, switch music or effects off, or toggle fullscreen. These stay on that device until an admin saves new audio defaults.

The kiosk keeps working without internet. Results wait on the device and upload when the connection returns.

## Android app (offline kiosk)

For venues where wifi drops out for long periods, the kiosk also ships as an Android app. The game files are **inside the APK**, so it starts and plays with no network at all. Results queue on the device and upload to the online backend whenever a connection appears; the server ignores duplicates.

**Build** (needs JDK 21 and the Android SDK; `brew install openjdk@21 && brew install --cask android-commandlinetools`, then `sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"`):

```bash
NEXT_PUBLIC_API_BASE=https://<your-deployment>.vercel.app pnpm apk:build   # → dist-apk/heineken-games-release.apk
```

- **Release signing:** create a keystore once (`keytool -genkeypair -v -keystore kiosk.jks -alias kiosk -keyalg RSA -keysize 2048 -validity 10000`). Then put `storeFile`, `storePassword`, `keyAlias` and `keyPassword` in `android/keystore.properties`. That file is not in git. **Keep the keystore safe: updates must be signed with the same key.**
- **Emulator / local test build:** `APK_DEBUG=1 NEXT_PUBLIC_API_BASE=http://10.0.2.2:3100 pnpm apk:build` (10.0.2.2 is the Mac as seen from the emulator; plain HTTP is allowed only for that host).
- **CORS:** the backend accepts kiosk API calls only from the app origin (`https://localhost`; override with `KIOSK_APP_ORIGINS`).

**Install on the kiosk:**

1. Enable "Install unknown apps", or push it with your MDM (`adb install dist-apk/heineken-games-release.apk` over USB also works).
2. Open the app once **with internet**, hold the Heineken logo for 3 s, and enter the admin PIN plus a kiosk name. This pairs the device and stores the PIN securely on it for offline staff access.
3. Make it the kiosk app. The app can act as the home screen (Android asks "use as home app"). For a full lock-down, set it as the dedicated/lock-task app in your MDM. It keeps the screen on and hides the system bars by itself.
4. Make sure **Android System WebView** on the kiosk is up to date (version 111 or newer; check under Settings → Apps). The app renders with it.

**Offline staff screen** (hold the logo for 3 s, then enter the PIN): shows this kiosk's prizes today (counts and award codes), recent prize events, what is still waiting to upload, and an "Upload now" button. It works without internet. After changing the admin PIN online, re-pair the kiosk so the offline PIN matches.

**Updating:** game code changes need a new APK (same signing key). Prize tiers and game settings still update over the air from the admin whenever the kiosk is online.

## Tests

```bash
pnpm test         # unit tests (vitest)
pnpm build && pnpm test:e2e    # Playwright: flows, security, offline, layout (needs local DB + ADMIN_PIN)
pnpm vitest run src/game/balance.test.ts --reporter=verbose --silent=false   # bot score bands per skill level
pnpm test:soak    # 120 bot games in one session, heap/DOM/audio stability, 6x CPU throttle phase
pnpm exec playwright test --grep @perf     # fps under 6x CPU throttle (PERF_AUDIO=0 to exclude audio)
pnpm exec playwright test --grep @shots    # screenshots of every screen into test-results/shots
node scripts/compose-audio.mjs             # re-render all music and sound effects (needs ffmpeg with libopus)
```

The e2e suites refuse to run against a non-local database: if `.env` points at Neon, prefix the commands with `DATABASE_URL=postgresql://…@localhost:…/kiosk`.

Visual QA in a browser window that is not in front: add `?qa` (with `?bot` to autoplay) and call `__qa.step(2)` in the console to advance and draw frames by hand.

## Brand assets

Official Heineken artwork (logo, star, responsible-drinking mark, product photos) lives in `public/assets/brand/` and comes from heineken.com. Sources and licence status are in [ASSETS.md](ASSETS.md). **The client must confirm the licence before public use.** To swap any file, keep its name. Particle textures are Kenney CC0 (`public/assets/fx`). Music and sound effects are original, generated by `scripts/compose-audio.mjs` (`public/assets/music`, `public/assets/sfx`).
