# Game design: redesign pass (2026-10-02)

This document records the audit of the first playable versions and the design that replaced them. Tuning values live in `src/game/balance.ts` (developer knobs) and the admin config (`src/lib/config.ts`, operator knobs).

## 1. Audit of the foundation

### What works and is kept

- **Engine:** the rAF Runner, the fixed sub-steps, the contained frame errors, and the quality auto-drop.
- **Rendering:** pooled particles, popups and juice; sprites are baked once and blitted. This is why the kiosk holds frame rate, so new art follows the same rule.
- **Infrastructure:** the kiosk state machine, the offline outbox and sync, prize resolution, the server plausibility checks, the admin panel and the service worker.
- **Audio:** the bus architecture, sample-locked base/energy stems with `intensity()`, and in-code composition.
- **Brand:** the official star, the crate packshot, the palette and the responsible-drinking footer.

### Star Catcher: why it was too easy and repetitive

| Problem | Cause in the code |
|---|---|
| Trivial to catch | Catch zone was `rimHalf + 18` = 244 px of 1080 (23% of the screen), with a finger-follow of `damp(26)` (instant). Standing under the lowest star always works. |
| No decisions | Every non-hazard object is good. Heat is 8-30% of spawns and easy to sidestep. Nothing competes for the player's position. |
| No skill ceiling | Catching at the centre or at the edge scored the same. The multiplier reached x5 at a 25-streak and then stayed flat. |
| Repetitive | All objects fell straight down (only golden and ice wobbled). "Stages" were labels on a smooth ramp. There were only two patterns, a column and a zigzag. |
| Visually basic | A drawn glass with no state, baked beams and a flat counter. The environment never reacted to progress. |

### Crate Stacker: why it was too easy and repetitive

| Problem | Cause in the code |
|---|---|
| Rhythm-solvable | Constant ping-pong speed (480 px/s + 22 per crate). After a few crates the timing is memorised. |
| Flat progression | No stages and identical crates. The only change was speed, and that came slowly (900 px/s at crate 20). |
| Shallow precision | Results were binary: perfect (≤ 9 px) or not. A near-perfect drop broke the streak like a sloppy one. There was no feedback on how far off a drop was. |
| Abrupt failure | The last crate fell, the camera pulled out and the banner appeared. The tower itself never reacted. |
| Blank environment | Faint racking lines on the green gradient: "blocks floating on a screen". |

### Shared visual problems

- **Top lighting:** three CSS beams and five baked canvas beams. They are flat wedges with no source, no fixture and no depth.
- **HUD plates:** competent, but generic dark-green boxes.
- **Brand presence:** a giant faint star and green everywhere. The red and metallic accents carry little meaning.

## 2. Design goals

1. Readable in one look, hard to master: the first round makes sense; a high score needs precision and choices.
2. The two games differ in kind. **Star Catcher** is about reaction, positioning and risk/reward. **Crate Stacker** is about timing, precision and keeping a streak alive.
3. Score scale stays where it was. Today's prize thresholds (Star 400/800/1500, Crate 300/700/1400) map to average, good and great play. A bot-driven simulation (`src/game/balance.test.ts`) verifies this and checks that legitimate runs never trip the server plausibility checks.
4. No new hardware cost. Everything is baked sprites, a few blits per frame and one small offscreen canvas for the beer.

## 3. Star Catcher

**Loop:** catch, fill the glass, serve it for a bonus window, then decide whether to risk the next fill.

- **Glass.** The supplied Heineken glass photo is the catcher. The catch zone is the real mouth of the glass. Within 30% of the centre a catch is **PERFECT**; nearer the edge it is normal.
- **Beer fill (0-100%).** It rises with catches and is drawn as a liquid column clipped to the glass interior. The surface is wavy and tilts against motion (slosh). It has a foam head and a few rising bubbles. Fill cues sound at 25/50/75%.
  - **Spill:** heat costs fill.
  - **Miss:** a missed red star costs a little fill.
- **FULL GLASS → served.** The full glass gets a foam crown, then is *served*: it slides off the counter and a fresh empty glass slides in. Nothing is drunk (Responsible Marketing Code, see §6). Each serve opens a **BONUS window**: x2 points for a few seconds. Filling another glass inside that window steps it to x3. Serves are counted (stat `served`).
- **Combo.** Consecutive catches raise a streak multiplier. A miss or a heat hit breaks it. A perfect catch counts double toward the streak.
- **Objects** (each one earns its place):
  - **Red star:** points plus fill.
  - **Golden star:** big points and big fill. It drifts sideways and falls faster, so chasing it risks the streak.
  - **Heat:** spills beer and breaks the streak. A close dodge earns a small bonus.
  - **Ice cube:** slows the world, which buys time in chaotic phases.
- **Phases** (fractions of the round, shown with a banner):

| Phase | What changes |
|---|---|
| 1 Warm-up | Red stars only, slow and single. |
| 2 Momentum | More stars, the first golden, ice. |
| 3 Pressure | Heat starts; stars drift sideways. |
| 4 Chaos | Objects arrive in pairs and triples; heat wobbles; spacing is uneven. |
| 5 Combo Rush | Star showers: dense lines of red worth taking, with little heat. |
| 6 Final Push | Fastest speeds, everything mixed, music at full energy. |

- **Environment reacts.**
  - **Spotlights:** cones brighten with the streak.
  - **Bonus window:** the counter glows gold.
  - **Final Push:** the beams turn red.

## 4. Crate Stacker

- **Stages by height,** each with its own movement:

| Stage | Crates | Movement |
|---|---|---|
| 1 | 0-5 | Steady ping-pong. Learn the timing. |
| 2 | 6-11 | Faster ping-pong. |
| 3 | 12-17 | Eased motion: fast in the middle, slow at the edges. Timing is no longer linear. |
| 4 | 18-23 | Crane swing: the crate hangs from a hook and swings as a pendulum. |
| 5 | 24-31 | Surges: speed changes mid-pass. |
| 6 | 32+ | Extreme: fastest, with a tighter perfect window. |

- **Precision grades.** Each drop is graded **PERFECT** (≤ tolerance, no width lost), **GREAT** (≤ 3x tolerance), **GOOD** or **OFF**. A precision meter under the HUD shows where the drop landed.
  - **PERFECT** builds the streak.
  - **GREAT** keeps it.
  - **GOOD** or **OFF** breaks the streak and drops the multiplier one step, not to zero.
- **Golden crate** (rare, from stage 2). Perfect on it gives a big bonus plus regrown width; otherwise it scores as normal. This is the one special crate: it adds a risk/reward moment without cluttering the read.
- **Camera.** The camera follows the tower and zooms out slowly with height, so more of the tower stays visible. Height marks sit on the side. The tower sways when narrow or leaning.
- **Failure.** The last crate tips off and tumbles, the tower shudders and settles, and a ground impact kicks up dust. Then the camera pulls out over the whole tower before the result.
- **Environment.** A warehouse and event hall:
  - pallet racking at two parallax depths, stocked with the Heineken multipack;
  - a stage truss with fixtures;
  - a polished floor.

## 5. Visual system

- **Six layers:** deep environment (baked) → atmosphere (haze, dust motes) → lighting (fixtures + additive cones) → gameplay → HUD → effects.
- **Stage lighting replaces the top beams.**
  - **Rig:** a curved metallic truss with lens-lit fixtures, under-lit by a green LED strip with a red star centrepiece.
  - **Cones:** soft additive volumes that sweep slowly.
  - **Floor:** a reflection pool.
  - **Cost:** baked once, so each cone costs one transformed blit. The menus get the same rig as images animated by CSS transform only.
- **HUD:** metallic-rim plates with a red brand accent, and a beer gauge in the glass's own colours.

## 6. Responsible marketing

The beer fill reverses an earlier "empty glass" choice. The owner decided this on 2026-10-02. The Heineken Responsible Marketing Code (March 2026) says:

- **§2.1:** no portrayal of excessive drinking; portion sizes appropriate to the setting.
- **Promotions:** no "drinking games that encourage rapid or excessive drinking".

The design keeps to that:

- One glass at a time, never drunk; full glasses are *served* away.
- No speed or quantity wording ("chug", "down it", litres); copy says FULL GLASS, SERVED, BONUS.
- The responsible-drinking footer stays on every menu screen.

**Legal must sign off on the fill mechanic before the event.**
