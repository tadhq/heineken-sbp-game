# Research and technical decisions

Heineken kiosk game platform: Star Catcher and Crate Stacker on an Android 11 Chrome kiosk, portrait 1080x1920.
Research done 2026-10-01. Sources are linked inline. **UNVERIFIED** marks anything without a primary source, or anything that depends on the actual kiosk hardware (which was not available).

Fixed inputs from the client conversation:

- Portrait, 1080x1920.
- Hosting on Vercel with Neon Postgres.
- **No prize stock system.** Prizes are score thresholds, and the admin sees counts of what was won. The kiosk must keep working offline.
- No access to the real device during development.

---

## 1. Target hardware and browser

| Topic | Finding | Source | Consequence for the build |
|---|---|---|---|
| Chrome on Android 11 | Current Chrome requires Android 10+. M138 was the last version for Android 8/9. No announced drop of 10 or 11. | [Chrome requirements](https://support.google.com/chrome/a/answer/7100626), [chromium-dev PSA](https://groups.google.com/a/chromium.org/g/chromium-dev/c/vEZz0721rUY/m/pUIgqXxNBQAJ) | Next.js 16 targets Chrome 111+ (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`). That is fine *if the kiosk runs an up-to-date Chrome*. **On-device check: `chrome://version` must be 111 or higher.** The risk of Android 10/11 being dropped in 2026-27 is UNVERIFIED. |
| Kiosk browser | Fully Kiosk and similar apps use **Android WebView**, not Chrome. Lock-task / dedicated-device mode needs an MDM. | [Fully Kiosk](https://www.fully-kiosk.com/en/), [Lock task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode) | The app does not rely on PWA install. It works in Chrome or WebView. |
| Fullscreen / orientation | `requestFullscreen` needs a user gesture. `screen.orientation.lock` only works in fullscreen and is not Baseline. | [MDN requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen), [MDN orientation.lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock) | The first tap on the attract screen goes fullscreen (admin toggle). Orientation is locked by the OS/MDM, and the manifest says `portrait`. |
| Audio autoplay | An AudioContext created before a gesture starts suspended. | [Chrome autoplay](https://developer.chrome.com/blog/autoplay) | The attract screen is silent. Audio unlocks on the first tap, and the SFX buffers are built then. |
| rAF when hidden | rAF pauses in hidden tabs. Hidden timers are throttled. | [MDN rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), [timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) | The game pauses on `visibilitychange` and frame delta is clamped to 50 ms. A run hidden for more than 20 s is recorded as abandoned and the kiosk returns to attract. |
| Page lifecycle / OOM | Pages can be frozen or discarded. On low-RAM devices the realistic risk is a renderer crash. | [Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) | Results are persisted to IndexedDB **before** the result screen shows. The page self-reloads from the attract screen after 6 h. The service worker makes a reload work offline. |
| Storage | Chromium allows up to 60% of disk per origin. Best-effort data can be evicted. | [MDN quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | The outbox only holds unsynced games (small). The server is the source of record. Fallbacks: localStorage, then memory. |
| Touch | `touch-action: none` prevents pan/zoom and `pointercancel`. Passive listeners ignore `preventDefault`. | [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action), [scrolling intervention](https://developer.chrome.com/blog/scrolling-intervention) | `touch-action: none` on the game canvas and `manipulation` elsewhere. Pointer Events with capture. No hover-dependent UI. |
| Input latency | The `desynchronized` canvas hint can cut a frame of latency. On Android it is UNVERIFIED. | [desynchronized](https://developer.chrome.com/blog/desynchronized) | Used with `alpha:false`. It falls back silently. **A/B it on the device.** |
| DPR / fill rate | A 1080x1920 frame is about 2.07 MPx, roughly 124 MPx/s at 60 fps per full-screen pass. The kiosk DPR is UNVERIFIED. | [Android densities](https://developer.android.com/training/multiscreen/screendensities), [web.dev canvas perf](https://web.dev/articles/canvas-performance) | The backing store is capped at the logical 1080x1920, and at 0.72x of it in low quality. |
| Wake lock | Released on minimise. | [Wake Lock](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock) | Re-acquired on `visibilitychange`. The MDM should keep the screen on as well. |

## 2. Rendering engine comparison

Sizes are min+gzip from bundlephobia (2026-10-01):

| Option | Size | Strengths | Weaknesses for this project |
|---|---|---|---|
| **Canvas 2D (custom)** | 0 KB | Built in and GPU-rasterised in Chrome. Trivial to own inside React. Enough for this load (max about 48 objects, 260 particles, 15 crates). | No automatic batching, so draw discipline is our job. Fill rate is the limit. |
| PixiJS 8 | 261 KB (less when tree-shaken) | Real WebGL batching, filters, Canvas fallback since 8.16. | 100-260 KB to parse on a slow CPU. Another lifecycle to bridge with React. WebGL context loss to handle. |
| Phaser 4 | 356 KB | Complete framework. | Framework inside a framework (scenes and loader duplicate Next/React). Largest. Canvas renderer deprecated. |
| Raw WebGL | 0 KB | Fastest possible. | Most code (shaders, batching, context loss). Not justified at about 300 objects. |

No published low-end Android benchmark exists at this object count ([Shirajuki benchmark](https://github.com/Shirajuki/js-game-rendering-benchmark) is laptop-only).

**Decision: Canvas 2D.** It's the smallest, its cost is predictable, and it's enough for the scene. The Runner/Game interface (`src/game/engine/runner.ts`) is the boundary where a PixiJS renderer could be swapped in if on-device numbers demand it.

Rules followed in the build:

- All art is pre-rendered once to offscreen canvases.
- There is no `shadowBlur` and no per-frame gradients for sprites.
- Particles live in typed-array pools.
- `setTransform` is used per sprite instead of save/restore.
- The render scale is capped.

### 2.5D style

Depth is faked with cheap tricks instead of 3D:

- Extruded (stacked-layer) stars.
- Oblique-projection crates with top and side faces.
- A perspective floor grid with ground shadows.
- A parallax far layer (drifting stars, tiled bokeh scrolled at 30% of camera speed).
- Light beams baked into the background, and a camera zoom-out in the Crate Stacker game-over outro.

Menu screens use CSS `transform`/`opacity` animations only, so they run on the compositor. The hero star is real CSS 3D: 7 layers with `translateZ` and a `rotateY` sway.

## 3. Game mechanics research

**Crate Stacker** builds on the Ketchapp *Stack* mechanic: overhang is trimmed off, so width is the resource and failure explains itself ([Game Developer: hyper-casual design](https://www.gamedeveloper.com/design/admiring-the-game-design-in-hyper-casual-games)). The exact Stack perfect tolerance is UNVERIFIED (clone sites only), so ours is configurable. The default is 9 px, about 1.7% of the starting width.

Choices:

- **Tap anywhere to drop.** Hold-and-release adds latency and a concept to learn; a single tap is how the reference game works, and it needs no instruction beyond the on-canvas "TAP TO DROP" hint.
- **Perfect streak.** A rising pitch, a multiplier every 3 perfects, and regrowth after 3 in a row.
- **Speed.** It ramps with height and is capped.
- **Idle end.** 15 s without a tap ends the run, so the kiosk is never blocked.
- **Sway.** A damped spring sways the stack after sloppy drops. It is visual only, never random: the outcome is deterministic and skill-based.

**Star Catcher** uses flow-channel theory: a "waved" difficulty beats a linear ramp ([flow channel](https://www.gamedeveloper.com/design/game-design-theory-applied-the-flow-channel), [difficulty curves](https://www.gamedeveloper.com/design/difficulty-curves)). Spawn rate and speed rise with smoothstep(progress) plus a gentle sine wave. Six stages are announced on screen and the music tempo rises with them. From stage 2, patterns (5-star columns, zigzags) reward movement. A combo multiplier resets on a miss or a heat hit. Golden stars wobble sideways, giving the rare bonus a skill component. The ice cube slows the world (not the clock) for 3.5 s.

Game feel follows ["Juice it or lose it"](https://www.gdcvault.com/play/1016487/juice-it-or-lose) and ["The Art of Screenshake"](https://archive.org/details/the-art-of-screenshake):

- Hit-stop (slow-mo) on golden stars.
- Squash on catch and landing.
- Shake only on hazard hits and game over.
- Particle bursts in brand colours.
- Rising pitch on streaks.
- Count-up score.

Shake is kept subtle for a large portrait screen viewed up close. That is a judgement call.

**Near-miss.** The Heineken Responsible Marketing Code §4.5 says not to portray or encourage gambling behaviour. So near-miss is used only as skill feedback (a "DODGED +5" for heat passing close). The result screen never says "you almost won a prize".

**Session length.** Star Catcher has 45 s rounds; Crate Stacker ends on failure with a 150 s safety cap. Vendor guidance (not authoritative) suggests very short rounds for high-traffic booths ([example](https://portadecor.com/how-to-design-interactive-booth-games/)). Both are admin-tunable.

## 4. Heineken visual identity and constraints

- **Colours.** No public brand spec exists.
  - Greens from heineken.com's live stylesheet (`app.brand2.hnk.css`, fetched 2026-10-01): `#13670b`, `#005d1f`→`#277816`, `#12a415`.
  - Star red **`#E3000F`** is read from Heineken's own logo SVG (`class st0`).
  - The vivid brand-green radial (`#4FAA33` → `#105D25`) is sampled from heineken.com's gradient image.
  - Confirm all of these against the client's brand book.
- **Type.** Heineken Sans/Serif are proprietary to Heineken ([LucasFonts](https://www.lucasfonts.com/custom/heineken)). heineken.com falls back to **PT Sans** (OFL), so this build uses PT Sans plus PT Sans Narrow (bold) for display, self-hosted via `next/font`.
- **Logo, star and product photography** are trademarked and copyrighted ([heineken.com terms](https://www.heineken.com/global/en/terms-and-conditions/)), and there is no public licensed asset kit. **Update 2026-10-01:** at the project owner's request, the official logo SVG, the star, the "enjoy responsibly" mark and product photos were taken from heineken.com, on the basis that this is a Heineken-commissioned activation. Every file and its source is listed in [ASSETS.md](ASSETS.md), and the client must confirm the licence before public use.
- **Responsible Marketing Code** (March 2026, [PDF](https://www.theheinekencompany.com/sites/heineken-corp/files/heineken-corp/sustainability-and-responsibility/responsibility/heineken-responsible-marketing-code-final.pdf)):
  - The responsible-drinking line is on every menu screen (§2.3).
  - The art is adult and premium: no mascots or childlike characters (§3.5).
  - The glass is deliberately **empty**: no filling or drinking mechanic (§2.1).
  - No chance-based prize mechanics (§4.5).
  - An optional date-of-birth gate with lock-out after refusal; nothing is stored, and it is off by default (decision for the client's Legal team).
  - Competitions need Legal sign-off: **flagged to the client.**
- **Not researched:** local alcohol-advertising law where the kiosk is deployed. The Dutch responsible line used for `nl` ("Geniet, maar drink met mate") is the standard NL industry line; confirm locally.

## 5. Assets and licensing

The first build used only original procedural art. The project owner judged it too basic and asked for real brand assets, so the asset approach is now:

- **Official Heineken artwork** from heineken.com: logo, star, "enjoy responsibly" mark, draught glass, bottle and other product photos. These carry the brand. The licence must be confirmed by the client; see the note in ASSETS.md.
- **Kenney CC0** particle textures and sound effects ([licence](https://kenney.nl/support): public domain, commercial use OK, no attribution required). These replace the procedural particles and the ZzFX synthesis.
- **PT Sans / PT Sans Narrow** (SIL OFL), heineken.com's own fallback typeface. The proprietary Heineken fonts were not copied.
- **Procedural code** still draws the crate geometry, the hazard and ice sprites, and the backgrounds, and provides a full fallback if an asset fails to load.

**Optimisation.** Photos were converted to WebP at on-screen size (the original bottle went from 2 MB to 91 KB). Particles were resized to 128 px. In total there are 672 KB of assets, all precached by the service worker. The full per-file record (source, URL, licence, optimisation, use) is in [ASSETS.md](ASSETS.md).

## 6. Data and backend

- **Database:** Postgres (Neon in production, Docker locally) through **Prisma 7** with the `pg` driver adapter. Prisma 8 was still an RC on 2026-10-01, so the stable 7.10 was pinned.
- **Model:** see ARCHITECTURE.md. Key choices:
  - Config is stored as **immutable versions**, so every award can be traced back to the rules that produced it.
  - Client-generated UUIDs make sync idempotent.
  - A unique `sessionId` on awards blocks duplicate prize records at the database level.
  - Login throttling lives in the database because serverless instances share no memory.
- **Prize authority offline.** The client asked for offline "just works" and no stock. So the kiosk decides the prize from its cached config, records it before revealing it, and syncs later. The server **re-derives** the prize and runs plausibility bounds. Disagreements are stored and **flagged**, never silently dropped: the record reflects what staff physically handed out. Accepted trade-off: an offline kiosk is trusted for the moment of award. Forgery from outside is blocked by per-kiosk device tokens.

## 7. Skills and tools inventory

| Skill / tool | Purpose | Used when |
|---|---|---|
| `design-taste-frontend` | Visual direction, anti-template rules | Kiosk UI direction (loaded before UI work) |
| `web-design-guidelines` | UI/accessibility review | Final polish audit |
| `vercel-react-best-practices` | React rendering performance | Keeping the game loop outside React |
| Next.js 16 bundled docs (`node_modules/next/dist/docs`) | Framework truth over training data | Tailwind v3 setup, PWA/offline, browser targets |
| Prisma bundled skills (`prisma-orm-setup`) | Prisma 7 setup | DB layer |
| Claude in Chrome | Real-browser visual QA | Menu and admin screens |
| Project Playwright suite (`pnpm test:e2e`, `test:soak`) | Repeatable functional, security, offline and soak tests | QA phase |
| vitest | Pure-logic unit tests | Prize resolution, plausibility, timezone maths |
| General-purpose research subagent | Primary-source research with citations | This document |

Not used:

- Image-generation skills: there is no image-generation tool in this environment, and procedural art suited the performance goal better.
- Phaser/Pixi: see §2.

**Dependencies added, each with a reason:**

- `zod`: validation at every trust boundary.
- `jose`: signed tokens.
- `@prisma/*` and `pg`: database access.
- `server-only`: keeps server modules out of the client bundle.
- Dev only: Tailwind 3.4, Playwright, vitest.

No animation library and no UI kit were added: the CSS keyframes and the canvas cover everything.

## 8. Final recommendations

1. Run the on-device checklist in QA_REPORT.md before the event:
   - Chrome version.
   - `?fps` frame times in both games.
   - The `desynchronized` A/B.
   - Touch latency.
   - Audio.
   - A 2-hour soak.
2. Replace the placeholder red hex and add the official logo file once brand approves.
3. Legal to confirm the prize competition, the age-gate setting and the responsible-drinking lines for the deployment country.
4. If the kiosk can't hold about 45 fps at "low" quality, port the Runner's renderer to PixiJS v8. The game logic does not change.
