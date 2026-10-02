# Architecture

```
Android 11 kiosk (Chrome)                          Vercel                     Neon Postgres
┌──────────────────────────────────────┐   HTTPS   ┌───────────────────────┐  ┌──────────────┐
│ /  KioskApp (client-only React)      │──────────▶│ /api/kiosk/config     │─▶│ ConfigVersion│
│   screens: attract→select→intro→     │  Bearer   │ /api/kiosk/sync       │─▶│ GameSession  │
│   countdown→play→result→board        │  kiosk    │ /api/kiosk/leaderboard│  │ PrizeAward   │
│   GameView ─▶ Runner ─▶ Game (canvas)│  token    │ /api/admin/* (PIN +   │─▶│ Kiosk        │
│   IndexedDB: outbox, errors, kv      │           │   cookie session)     │  │ Setting      │
│   Service worker: shell + assets     │           └───────────────────────┘  │ LoginThrottle│
│ /admin  AdminApp (PIN pad, dashboard)│                                       │ ClientError  │
└──────────────────────────────────────┘                                       └──────────────┘
```

Stack:

- Next.js 16 (App Router), React 19, TypeScript strict, **Tailwind CSS 3.4.19** compiled by PostCSS (no v4, no CDN).
- Prisma 7 with the `pg` adapter.
- zod and jose. Sound effects are Kenney CC0 OGG samples, played through Web Audio.

## Directory map

| Path | Role |
|---|---|
| `src/lib/config.ts` | **Single config schema** (zod), defaults, `resolvePrize`. Shared by kiosk and server. |
| `src/lib/session.ts` | Session payload schema, server plausibility checks, initials blocklist. |
| `src/lib/time.ts` | Timezone day boundaries without a date library. |
| `src/lib/i18n.ts` | Player-facing strings, `nl` and `en`. |
| `src/game/engine/` | Runner (rAF loop, input, quality), particles, popups, sprites, audio, palette, view transform. |
| `src/game/star-catcher.ts`, `crate-stacker.ts` | Game logic and rendering. No React, no DOM besides the canvas. |
| `src/kiosk/` | `KioskApp` state machine, screens, `store.ts` (IndexedDB), `sync.ts`, service worker registration. |
| `src/admin/` | Admin dashboard (client) and its sections. |
| `src/server/` | `server-only` modules: env, db, auth, throttle, config store, sync ingestion, reports, leaderboard. |
| `src/app/api/` | Route handlers. Each one is wrapped in `route()`/`adminRoute()` and authorises itself. |
| `prisma/` | Schema, migrations, idempotent seed. |
| `public/sw.js` | Hand-written service worker. |
| `tests/e2e/` | Playwright suites (functional, security, offline, layout, soak). |

## Frontend structure

`src/app/page.tsx` renders `KioskEntry`, which loads `KioskApp` with `ssr:false`. The kiosk is pure client state (canvas, IndexedDB, audio), so server rendering would only add hydration hazards.

**Stage.** Everything is designed on a fixed 1080x1920 surface. `Stage` scales it uniformly to the viewport and letterboxes it. The composition never reflows. The kiosk is exactly 1080x1920, so its scale is 1.

**State machine** (`KioskApp`): `attract → select → [age gate] → intro → play (countdown overlay) → result (+ initials sheet) → board`.

- **Inactivity:** after `attractDelaySec` without a tap, menus return to attract.
- **Result timeout:** the result screen returns after 25 s, or 90 s when a prize is shown, so staff can see the code.
- **Hidden gestures:** holding the brand mark for 3 s opens the staff screen; holding the top-left corner (180x180 px) for 1.2 s opens the settings panel (volumes, music/effects on-off, fullscreen). A tap, a swipe through the corner or a finger that moves more than 30 px cancels; a ring fills while holding. Not mounted during play.
- **First tap** on attract unlocks audio, plays a confirmation chime and requests fullscreen (the Fullscreen API needs that user activation; the settings panel can toggle it again).
- **Motion system:** every screen enters with the same 340 ms scale/fade (`animate-screen-in`, keyed by screen); entering a game closes a star-shaped iris over the menu, mounts the canvas underneath, then fades; the countdown starts once the iris has cleared. Surfaces use shared `.panel`, `.tile`, `.btn-primary`, `.btn-secondary` and `.press` classes (globals.css), no backdrop blur.
- **Result sequence:** score counts up (ticking), locks in at 1.15 s, the prize card (or thank-you panel) reveals at 1.9 s with the music ducked under the prize sting.
- **Config updates** are fetched in the background and applied only between games, never mid-round.

## Audio

```
sfx voices ─▶ sfxBus ─┐
track stems ─▶ fader ─▶ duck ─▶ musicBus ─┴─▶ master ─▶ speakers
```

- **One AudioContext per page**, created on the first tap and never recreated; any later tap resumes it if Android suspended it. Without Web Audio it falls back to `<audio>` elements. Every call is a no-op on failure.
- **Effects:** 27 Opus files decoded once into AudioBuffers; a sound is one buffer source (+ gain/panner only when needed). Same-sound rate limit 30 ms, at most 12 voices (big moments always play). Catches climb a pentatonic scale by playback rate and pan with the catch position.
- **Music:** `audio.music(track)` crossfades (0.5 s in, 0.6 s out). Tracks: `lobby` on menus, the game's own track from GO, silence on attract and during the countdown. Each game track is a base and an energy stem started at the same audio-clock time (sample-locked loops); `audio.intensity(0..1)` sets the energy stem's gain from the multiplier, a golden star, tower height and the last 10 s. `audio.duck()` dips music for the prize reveal. Only the current track's and the lobby's stems stay decoded (~12 MB PCM per 30 s stereo stem).
- **Mix and settings:** master / music / effects volumes (slider position squared = gain) plus music and effects on/off. Admin sets defaults (`kiosk.audio`) and can lock music or effects off (`musicEnabled`, `soundEnabled`). Player changes are kept in localStorage per device until the admin defaults change (`src/kiosk/audio-prefs.ts`, unit-tested).
- **Content:** composed in code by `scripts/compose-audio.mjs` (see ASSETS.md).

## Game engine and rendering

```
GameView (React, mounts once per run)
  └─ Runner            rAF loop · fixed ≤1/60 s sub-steps · dt clamp 50 ms
       │               pointer→logical coords · visibility pause · frame monitor
       │               try/catch: a throwing frame is logged, never freezes the kiosk
       └─ Game         update(dt) / render(ctx) / pointer() / result()
            ├─ Particles   typed-array pool (no allocation while playing)
            ├─ Popups      fixed slot pool
            ├─ Sprites     pre-rendered offscreen canvases
            └─ Juice       pooled rings and "flyers" (points travel to the score plate), baked HUD plates and chips (engine/hud.ts)
```

- **React never sees frames.** `GameView` creates the Runner once. The game calls back exactly once, on finish. The HUD is drawn on the canvas. The `?fps` readout writes `textContent` directly.
- **Draw path.** Each sprite costs one `setTransform` and one `drawImage`. There is no `shadowBlur`, no save/restore per sprite, and gradients are only baked into sprites at start-up. The canvas uses `alpha:false` and `desynchronized:true`.
- **Quality.** `auto` starts high. Two consecutive seconds above 22 ms per frame switch to **low**: render scale 0.72, about a third of the particles, no additive glows, no parallax extras. That choice is persisted in localStorage. Admin can force high or low. "Effects off" also disables shake and flashes.
- **Determinism.** Crate placement is pure arithmetic (no physics engine). Sway, landing camera kick, perfect-drop zoom pulse and the "wobbly tower" tremble (narrow or leaning stack) only affect drawing, never placement or score.
- **Feedback budget.** High quality adds star motion ghosts, golden-star light, baked shadowed HUD plates; low quality falls back to flat plates. Hazard and final-seconds warnings are a baked red edge glow (one stretched blit), not a full-screen flash; golden flash is capped at 22% opacity.
- **QA autopilot.** `?bot` lets each game play itself through the real code path. The soak test uses it. It is harmless in production: a browser without a kiosk token cannot sync.

## Backend

Route handlers rather than server actions: they are easy to curl and to attack in tests.

**Wrappers:**

- `route()` turns zod errors into 400 and anything else into a generic 500 (logged, no stack to the client).
- `adminRoute()` checks the admin session inside the handler, refreshes the sliding cookie, and rejects cross-origin writes.

**Kiosk API:**

- `GET /api/kiosk/config`: public. The thresholds have to reach the kiosk for offline awards.
- `POST /api/kiosk/sync`: requires a **kiosk device token**.
- `GET /api/kiosk/leaderboard`: public, read-only.

**Admin API:** login/logout/session, overview, awards (list, CSV, void/restore), config, kiosks (register/revoke), leaderboard (view, reset, clear), per-session hide, PIN change.

### Data model

| Table | Key points |
|---|---|
| `ConfigVersion` | `version` PK and `data` JSON (validated by the zod schema on read and write). Every save inserts a new version. Current = max. |
| `Kiosk` | A registered device. `tokenVersion` revokes all of its tokens. |
| `GameSession` | `id` = kiosk-generated UUID (idempotency key). Has score, stats JSON, completed, isReplay, configVersion, initials, `flags[]` (plausibility failures), `hiddenFromBoard`. Indexes: (game, score desc), endedAt, (kioskId, endedAt). |
| `PrizeAward` | `id` = kiosk-generated event UUID. **`sessionId` unique**, so there is at most one award per game, enforced by the database. Stores a snapshot of prize id/name, configVersion, `status` (awarded/voided), `flagged`, `overridden`, notes. Indexes on awardedAt, (prizeId, awardedAt), (game, awardedAt). |
| `ClientError` | Errors reported by kiosks (no PII). |
| `Setting` | `adminPin` (scrypt hash + version) and leaderboard reset cutoffs. |
| `LoginThrottle` | Per-IP and global failure counters with lockout. |

There is no user or account table, and nothing personal is stored. Initials are optional, 3 letters, blocklist-filtered, and an admin can hide them.

### Prize system

`resolvePrize(config, game, score)` picks the active prize for that game whose `[minScore, maxScore]` contains the score, preferring the highest minimum. There is **no stock**, as the client requested; the dashboard counts awards per prize, per day and per game.

1. When a round ends, the kiosk resolves the prize from its cached config and generates the award event id.
2. It writes the session to the IndexedDB outbox.
3. Only then does it reveal the result. The 6-character award code shown to the player is the first 6 characters of the event id, so staff can match it in the dashboard and the CSV.
4. On sync the server **re-derives** the prize from the stored config version and runs plausibility bounds: score against catches or height, object counts against spawn rate, duration against round length.
5. If anything disagrees, the session gets `flags`, the award is `flagged`, and the score is kept off the leaderboard. Nothing is silently dropped, because the record must match what was physically handed out.
6. Admins can void or restore an award with a note (`overridden`).

### Sync and offline

- **Outbox.** Every game is written before its result is shown. A record is on `hold` only while initials are being entered; holds are released when the initials are submitted or skipped, when the screen is left, or at boot.
- **Flush.** Runs after each game, every 30 s, and on the `online` event. It is single-flight and uploads batches of 50. Accepted ids, including ones the server already had, are deleted locally. Rejected (malformed) records are parked under `rejected:<id>` and not retried forever. A 401 keeps everything and waits for re-registration.
- **Server idempotency.** Session and award creation run in one transaction per session. A unique violation means "already stored" and is answered as accepted. A concurrent duplicate upload therefore yields one session and one award (covered by an e2e test).
- **Service worker** (`public/sw.js`):
  - `/` is network-first with a 4 s timeout, then the cached copy.
  - `/_next/static` is cache-first; the files are immutable and hashed.
  - The page posts the URLs it already loaded so they get cached.
  - `/api/*` and `/admin` are never cached.
  - The cache is capped at 300 entries.
- **Config cache.** The last good config is kept in IndexedDB. If that copy is corrupt or missing, the built-in defaults are used (version 0, and the server maps version 0 to the same defaults).

### Leaderboard

Leaderboards are queries over `GameSession`; there is no extra table to keep in sync.

- **Daily** means since local midnight in the configured event timezone.
- **"Clear"** stores a cutoff timestamp, so the history used for reporting is kept.
- **On the kiosk**, the board merges the server list with unsynced local games, so a new score shows immediately even offline.

### Admin and security

- **PIN storage.** The PIN is stored as a scrypt hash in `Setting.adminPin`, seeded from `ADMIN_PIN` by `pnpm db:seed`, and changeable in the dashboard. It is never shipped to the client and never displayed.
- **Throttle.** The attempt is counted **atomically before** the PIN is verified (an `INSERT … ON CONFLICT … RETURNING`), so parallel guesses cannot exceed the limit.
  - Per IP: 5 attempts per 15 min, then a 15 min lock.
  - Global: 30 per hour.
- **Sessions.** These are JWTs (HS256) with **separate HKDF-derived keys per purpose** and a checked `aud`/`iss`:
  - The admin cookie is httpOnly, SameSite=Strict and Secure in production. It has a 15 min sliding expiry and carries the PIN version, so changing the PIN logs out every other session.
  - The kiosk token is a 365-day Bearer token, revocable through `tokenVersion`.
- **Auto-lock.** The dashboard locks itself after 3 min without input.
- **Secrets.** `SESSION_SECRET` must be at least 32 characters and has **no fallback**; the app throws if it is missing.
- **Input handling:**
  - Every request body and query is validated with zod.
  - Prize image URLs are restricted to `/path` or `https://`.
  - CSV cells are neutralised against formula injection.
- **Headers:** nosniff, `X-Frame-Options: DENY`, same-origin referrer, restrictive `Permissions-Policy`. A CSP was not added, because Next inline scripts would need nonces; it is listed in QA_REPORT as a known gap.

## Android app (offline kiosk)

```
APK (Capacitor 8, Android WebView)            Vercel (same backend)
┌─────────────────────────────────┐  HTTPS   ┌──────────────────────────┐
│ https://localhost = bundled     │─────────▶│ /api/kiosk/config, sync, │
│ static export of the kiosk only │  Bearer  │ leaderboard, pair (CORS: │
│ IndexedDB outbox + ledger       │  token   │ app origin only)         │
│ Staff screen (offline PIN hash) │          └──────────────────────────┘
└─────────────────────────────────┘
```

- **Build.** `BUILD_TARGET=apk next build` produces a static export to `.next-apk`. `pageExtensions: ["tsx"]` leaves out the `route.ts` API handlers. Capacitor copies the export into `android/`, and Gradle builds the APK (`pnpm apk:build`).
- **Network.** The app calls `NEXT_PUBLIC_API_BASE`. The kiosk routes answer CORS only for `https://localhost` and `capacitor://localhost`. Auth is a Bearer token, never a cookie, so this grants nothing a kiosk could not already do.
- **Pairing.** `POST /api/kiosk/pair` (admin PIN, same throttle as login) returns a kiosk token. On success, the device stores a PBKDF2-SHA256 (210k) hash of the PIN for offline staff unlock, with a local lockout of 5 tries per 5 min.
- **Ledger.** A local IndexedDB `ledger` store keeps the last 5,000 finished games, even after they sync, for the staff screen.
- **Native shell** (`MainActivity`): screen kept on, immersive (system bars hidden), portrait. It can be the device's HOME app for kiosk lock-down. Plain HTTP is allowed only to emulator/dev hosts, and mixed content only in debug builds.
- **Compatibility.** `browserslist: chrome 90` plus a `roundRect` polyfill, so it runs on Android 11's stock WebView (91).

## Performance architecture (summary)

- The game loop is outside React. All allocations are pooled. Art is pre-rendered, and the render resolution is capped.
- Menus animate only `transform` and `opacity`.
- **Bundle:** see QA_REPORT for the measured numbers. No game framework and no animation library.
- **Long-running safety:**
  - An exception-contained frame loop.
  - The abandoned-run handler.
  - A 6-hourly reload from attract.
  - A soak test asserts heap, DOM-node and listener stability over 120 games.
