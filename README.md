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

The kiosk keeps working without internet. Results wait on the device and upload when the connection returns.

## Tests

```bash
pnpm test         # unit tests (vitest)
pnpm build && pnpm test:e2e    # Playwright: flows, security, offline, layout (needs local DB + ADMIN_PIN)
pnpm test:soak    # 120 bot games in one session, heap/DOM stability, 6x CPU throttle phase
```

The e2e suites refuse to run against a non-local database.

## Brand assets

Official Heineken artwork (logo, star, responsible-drinking mark, product photos) lives in `public/assets/brand/` and comes from heineken.com. Sources and licence status are in [ASSETS.md](ASSETS.md). **The client must confirm the licence before public use.** To swap any file, keep its name. Effects and sounds are Kenney CC0 (`public/assets/fx`, `public/assets/sfx`).
