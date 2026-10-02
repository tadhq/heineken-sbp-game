# QA report

Date: 2026-10-01/02. Build: Next.js 16.3.8 production build (`pnpm build && pnpm start`), commit at the end of the git log.

## Environment

| Item | Value |
|---|---|
| **Target** | Android 11 Chrome kiosk, portrait 1080x1920. **Not available during development: every on-device test below is marked NOT RUN.** |
| Automated browser | Chromium headless shell 153 (Playwright 1.63), viewports 1080x1920 / 540x960 / 1920x1080 / 360x740, touch enabled, DPR 1 |
| Manual browser | Desktop Google Chrome (owner's profile, via Claude in Chrome) for menu and admin screens. That window was occluded (`visibilityState: hidden`), so rAF-driven gameplay could not be judged there; gameplay frames come from the headless captures. |
| Low-end proxy | Chrome DevTools CPU throttling at 6x during the soak. **This is a proxy, not the device:** headless Chromium renders canvas through SwiftShader/Metal on an Apple M-series machine, so the GPU and fill-rate behaviour of the kiosk SoC is not represented. |
| Host | macOS 27.0.1 (Apple silicon), Node 25.2.1, Postgres 17 (Docker) |

## Test suites

| Suite | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS, 0 errors |
| Lint | `pnpm lint` | PASS, 0 errors, 0 warnings |
| Unit (vitest) | `pnpm test` | PASS, 26/26 |
| E2E functional, security, offline, layout (Playwright) | `pnpm test:e2e` | PASS, 25/25 |
| Soak, 120 games, one page | `pnpm test:soak` | see Performance results |
| Visual captures at 1080x1920 | `playwright test --grep @shots` | captured, reviewed (see Polish) |

## Tests

| Test | Result | Evidence / notes |
|---|---|---|
| Attract → select → instructions → countdown → play → result | PASS | e2e `Star Catcher: attract to result…`; captures 01-08 |
| Star Catcher controls (drag/follow) | PASS (desktop/headless) | autopilot drives `pointer move`; manual drag in Chrome moved the glass. **On-device touch: NOT RUN** |
| Star spawning, waves, stages | PASS | stage banners and pattern spawns visible in captures; scores 365-1870 across runs |
| Golden star, hazard, ice | PASS | soak stats include golden > 0; hazard penalty and combo reset covered by bot runs (stats.hazards) |
| Combo / multiplier | PASS | HUD x-chip and combo pips in captures; bestCombo recorded |
| Crate Stacker drop, slice, perfect, regrow, speed ramp | PASS | captures 05-crate; bot heights 7-32 |
| Crate game over / time cap / idle end | PASS | soak (8 s cap) ended 100+ runs; idle 15 s end implemented |
| Score shown = score stored | PASS | e2e compares the outbox payload score with the DB row |
| Prize assignment matches rules | PASS | e2e uses `resolvePrize` on the actual score; unit tests on tier boundaries, inactive tiers, overlaps, disabled system |
| Prize code shown to staff matches admin record | PASS | 6-character code = first 6 of the event id; shown in the admin table and CSV |
| Prize records saved before reveal | PASS | e2e checks the outbox immediately at the result screen |
| Inventory | N/A by design | the owner chose **no stock system**; per-prize counts by day, game and filter are tested (e2e "admin reporting") |
| Duplicate protection | PASS | e2e: replay plus 5 concurrent copies of a batch → 1 session, 1 award; reused award id rejected without blocking the batch |
| Forged scores / prizes | PASS | e2e: score 987654 and a wrong-tier prize stored but **flagged** and hidden from the leaderboard |
| Admin login / wrong PIN | PASS | e2e via the touch keypad; "Wrong PIN" shown |
| Rate limiting | PASS | e2e: 5 wrong → 429; lockout holds even for the right PIN; 12 parallel guesses → at most 5 evaluated |
| Logout / session expiry / auto-lock | PASS (logout, server expiry) | "Lock" kills the session server-side (e2e checks for 401). The 15 min sliding expiry was observed: the first soak run's admin context expired. The 3 min client auto-lock is implemented but not timed in a test. |
| Unauthenticated admin API | PASS | e2e: all 14 admin routes return 401 |
| Token confusion (admin↔kiosk, alg:none, guessed secret) | PASS | e2e |
| Cross-origin admin writes | PASS | e2e: 403 |
| Config validation (`javascript:`/`data:`/`//`/`/\` image URLs) | PASS | unit and e2e |
| CSV export and formula injection | PASS | e2e |
| Game and kiosk settings saved | PASS | the e2e suites save configs through the API; the admin UI was exercised manually |
| Leaderboard (daily, all-time, reset, hide, initials) | PASS | e2e initials flow (QAZ highlighted); reset via API in e2e; hide via admin UI |
| Offline play and sync | PASS | e2e: offline → play → record queued → online → outbox empties → exactly one DB row with an award matching the payload |
| Reload while offline (service worker) | PASS | e2e |
| Inactivity → attract | PASS | e2e |
| Replay flagged as replay | PASS | e2e |
| No scroll/overflow at 4 viewports; everything inside the stage | PASS | e2e layout tests plus `assertFitsStage` after every played round |
| Malformed sync records | PASS | e2e: rejected individually, batch still 200; batch over 100 → 400 |
| Kiosk revocation | PASS | e2e |
| Long-session stability | see below | soak |
| Android 11 Chrome compatibility, touch latency, audio, fullscreen, orientation on device | **NOT RUN** | no device; see the checklist below |

## Bugs found

| # | Severity | Bug | Found by |
|---|---|---|---|
| 1 | **Critical** | Crate Stacker froze at game over when the last crate was under 10 px wide: a negative `ellipse()` radius threw every frame, and because the runner checked `finished` after rendering, the round never ended | e2e replay test (frozen frame) |
| 2 | **High** | With the initials prompt open, the result screen was taller than 1920 px; focus/scroll-into-view shifted the whole `overflow:hidden` stage off-screen | e2e (initials) |
| 3 | High | A single bad record (DB error other than a unique violation) failed the whole sync batch with a 500, blocking every later prize record on that kiosk | security review |
| 4 | High | Service worker returned a 5xx page instead of the cached shell during a backend outage | security review |
| 5 | Medium | Kiosk timestamps trusted: a clock running ahead would misdate awards | security review |
| 6 | Medium | A reused award id (crafted payload) was acknowledged and the session silently dropped | security review |
| 7 | Medium | An IndexedDB write failure mid-run would have shown a prize with no stored record | security review |
| 8 | Medium | Rejected sync records vanished quietly | security review |
| 9 | Medium | Admin analytics averaged and maxed scores including flagged (forged) sessions | manual admin review |
| 10 | Low | `/\host` image URLs passed validation (protocol-relative) | security review |
| 11 | Low | PIN change endpoint not throttled | security review |
| 12 | Low | Out-of-range report dates gave 500 instead of 400 | security review |
| 13 | Low | Prize totals showed identical tier names for both games ambiguously | manual admin review |
| 14 | Low | zod (91 KB gzip) shipped to the kiosk and admin clients only to re-validate server data | bundle audit |
| 15 | Visual | The owner rejected the first art pass as basic. Murky dark palette, invented placeholder art. | owner feedback |
| 16 | Visual | The hero star's full 360° spin showed its dark back face | manual Chrome review |
| 17 | Visual | Official-star crop picked up fragments of "EST."/"1873"; glow textures showed square edges | 1080x1920 captures |
| 18 | Visual | Crate score popups covered the crate wordmark | captures |
| 19 | Visual | Hero: bottle and glass covered the big star | owner feedback |
| 20 | Visual | Star Catcher catcher was a beer-filled glass (wrong object; also off-message for responsible marketing) | owner feedback |
| 21 | Visual | Crates were drawn, not the real Heineken crate | owner feedback |
| 22 | Visual | Crate Stacker feedback text (PERFECT, xN, streak, milestone) overlapped each other and the hovering crate | 1080x1920 captures |
| 23 | Visual | Owner wants an empty Heineken glass as the Star Catcher catcher (not a crate, not a filled glass) | owner feedback |

Test-harness bugs (fixed, not app bugs):

- Stale server on the port.
- Click offsets relative to the letterboxed stage.
- Ambiguous `role=alert` (Next's route announcer).
- Soak loop played one extra game.
- Soak admin session outlived its 15 min expiry.
- Initials test depended on leftover scores.

## Bugs fixed

All 18 are fixed and re-tested:

1. Defensive drawing. The runner now reports a finished round before rendering, and contains frame exceptions: they are logged and the round is force-ended after 30 consecutive errors.
2. The initials prompt is now a bottom-sheet overlay. Stage containers use `overflow: clip`. `assertFitsStage` runs after every e2e round.
3. Per-record try/catch in sync. Failures come back as `rejected`.
4. The service worker falls back to the cached shell on non-OK responses.
5. `endedAt` more than 5 min in the future is flagged. ISO timestamps are bounded to 2020-2100.
6. On a unique violation, the server acks only if the session itself exists; otherwise the record is rejected.
7. `durablePut` falls back to localStorage/memory and retries; a failure is logged.
8. Rejected records are logged as kiosk errors, so they are visible in the admin.
9. Score stats exclude flagged sessions. The completion rate still counts every session.
10. Stricter own-path regex.
11. The PIN change endpoint shares the login throttle.
12. Date params are validated, so bad dates now return 400.
13. Prize id shown next to the name.
14. Schemas moved to server-only `config-schema.ts`, plus a tiny client normaliser. Admin initial JS went from 279 KB to 197 KB gzip.
15. Real assets: the official logo, star and responsible mark, and product photography from heineken.com, plus Kenney CC0 particles and sounds. Vivid brand-green art direction. See ASSETS.md.
16. The hero star sways ±38° instead of spinning.
17. A clean `star.png` was generated with the text erased. Glow textures got a radial edge mask.
18. Popup moved beside the stack.
19. The star sits unobstructed above the product; the crate and bottle are grounded below it.
20. The catcher is the official Heineken crate (3/4 packshot). Stars drop into its open top, and the play geometry comes from the photo.
21. Official GS1 packshot of the Heineken 24x30cl crate (EAN 8712000033040). Crate Stacker stacks the photo, and slicing cuts through the photo itself, so the overhang falls off as part of the real crate.
22. Fixed text slots between the HUD and the crate.
23. A photo-derived empty glass was tried and rejected by the owner. Reverted to the drawn empty glass (shorter, wider, red star emblem), which is also used on the select card.

## Remaining known issues

- **No on-device testing.** Frame rate, touch latency, `desynchronized` canvas, audio output, fullscreen and wake lock are unverified on the Android 11 kiosk.
- **Heineken asset licence** must be confirmed by the client (ASSETS.md). The proprietary Heineken fonts are not used; PT Sans stands in.
- **Sounds were picked by name and duration, without listening.** Someone should listen on the kiosk speaker. Swapping a sound means replacing a file in `public/assets/sfx/`.
- Music is a simple procedural loop. A licensed music bed would raise the quality.
- The hazard (heat) and ice sprites are still procedural.
- The crate packshot comes from a retailer CDN (Jumbo). It is Heineken's own GS1 product image, but the licence still has to come from Heineken.
- 4-digit PIN (per the brief): about 30 guesses per hour globally makes brute force a matter of days, not minutes, and there are no alerts. Recommend 6+ digits; the code already accepts 4-8.
- A global lockout can be triggered by anyone guessing PINs. That's an accepted trade-off: it denies admin access, not play.
- No Content-Security-Policy header (Next inline scripts would need nonces).
- The admin UI is English only. The kiosk is Dutch/English, switchable in the admin.
- The default event timezone `America/Paramaribo` is an assumption. Set the real one in Kiosk settings.
- The age gate is off by default; that's a decision for the client's Legal team.

## Performance results

(see the soak section below)

## On-device checklist (run before the event)

1. `chrome://version` must be 111 or higher.
2. Open `/?fps`. Play both games and note the fps and ms readout. **Target: 55-60 fps, never below 45.** If it drops below 45, set Kiosk settings → Graphics quality to Low and re-measure.
3. Measure touch latency (slow-motion phone video of a finger drag versus the glass) and check that the glass follows without lag.
4. Check that audio plays after the first tap, at a sensible volume; listen to every effect.
5. Check that fullscreen engages on the first tap, orientation is locked by the MDM, and the screen stays on.
6. Register the kiosk (Device & security). Play a game, then check that it appears in the admin within 30 s.
7. Pull the network, play 3 games, restore the network, and check that all 3 appear exactly once.
8. Run a 2-hour unattended loop using `?bot`. Check memory in `chrome://inspect` remote DevTools, then check the admin for errors.
9. Have a staff member read a prize code on the screen and find it in Prize history.

## Final recommendation

The software is functionally complete and passes 26 unit tests and 25 end-to-end tests: flows, security, offline, duplicate protection and layout.

**It is not yet event-ready.** Three things remain:

- The on-device checklist above.
- The client's brand and legal sign-off on the Heineken assets, the prize competition and the age-gate setting.
- A listen-through of the sounds on the kiosk speaker.
