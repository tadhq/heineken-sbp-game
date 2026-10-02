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
- zod, jose, zzfx.

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
- **Hidden gesture:** holding the brand mark for 3 s opens `/admin`.
- **First tap** on attract unlocks audio and requests fullscreen.
- **Config updates** are fetched in the background and applied only between games, never mid-round.

## Game engine and rendering

```
GameView (React, mounts once per run)
  └─ Runner            rAF loop · fixed ≤1/60 s sub-steps · dt clamp 50 ms
       │               pointer→logical coords · visibility pause · frame monitor
       │               try/catch: a throwing frame is logged, never freezes the kiosk
       └─ Game         update(dt) / render(ctx) / pointer() / result()
            ├─ Particles   typed-array pool (no allocation while playing)
            ├─ Popups      fixed slot pool
            └─ Sprites     pre-rendered offscreen canvases
```

- **React never sees frames.** `GameView` creates the Runner once. The game calls back exactly once, on finish. The HUD is drawn on the canvas. The `?fps` readout writes `textContent` directly.
- **Draw path.** Each sprite costs one `setTransform` and one `drawImage`. There is no `shadowBlur`, no save/restore per sprite, and gradients are only baked into sprites at start-up. The canvas uses `alpha:false` and `desynchronized:true`.
- **Quality.** `auto` starts high. Two consecutive seconds above 22 ms per frame switch to **low**: render scale 0.72, about a third of the particles, no additive glows, no parallax extras. That choice is persisted in localStorage. Admin can force high or low. "Effects off" also disables shake and flashes.
- **Determinism.** Crate placement is pure arithmetic (no physics engine). Sway is a damped spring that only affects drawing.
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

## Performance architecture (summary)

- The game loop is outside React. All allocations are pooled. Art is pre-rendered, and the render resolution is capped.
- Menus animate only `transform` and `opacity`.
- **Bundle:** see QA_REPORT for the measured numbers. No game framework and no animation library.
- **Long-running safety:**
  - An exception-contained frame loop.
  - The abandoned-run handler.
  - A 6-hourly reload from attract.
  - A soak test asserts heap, DOM-node and listener stability over 120 games.
