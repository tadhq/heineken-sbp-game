# Asset and source record

Every external asset in `public/assets/`. Downloaded 2026-10-01.

## Licensing note for Heineken material

The Heineken name, logo, red star and product photography are trademarks and copyright of Heineken Brouwerijen B.V. heineken.com's terms ([terms and conditions](https://www.heineken.com/global/en/terms-and-conditions/)) allow no non-personal use without a written licence.

These assets were included **at the project owner's request**, on the basis that this is a Heineken-commissioned activation. **Before any public deployment, the client's brand or legal team must confirm the licence, or supply their own approved files.** All Heineken files are isolated in `public/assets/brand/`, so they can be swapped without code changes as long as the file names are kept.

## Heineken brand assets (source: heineken.com)

| File | Source URL | Type | Licence / restrictions | Optimisation | Used for |
|---|---|---|---|---|---|
| `brand/heineken-logo.svg` | https://www.heineken.com/media/zmnkoinc/heineken-logo.svg | Vector logo (white wordmark, red star, "EST. 1873") | Heineken trademark, client licence required | None (13.8 KB vector) | Attract and select screens; crate wordmark (cropped at runtime) |
| `brand/star.png` | Derived from the logo above | Official red star with white keyline, 512x488 PNG | As above | "EST."/"1873" erased, tight-cropped (script in git history, commit "Real brand assets") | All in-game stars, the golden-star variant, menu stars |
| `brand/enjoy-responsibly.svg` | https://www.heineken.com/media/e0uigisg/enjoy-responsibly.svg | Responsible-consumption "e" mark | As above | None (7.4 KB) | Footer of every player screen |
| `brand/crate.webp` | https://www.jumbo.com/dam-images/Products/25032024_1711381870774_1711381878587_8712000033040_5.png (official GS1 packshot of Heineken 24x30cl crate, EAN 8712000033040, as distributed to retailers) | Product photo, 3/4 view crate with bottle caps | Heineken trademark/copyright, client licence required | 2246x1644 PNG (5 MB) → 1000x732 WebP q88 (68 KB) | Crate Stacker crates (sliced through the photo), Star Catcher catcher, menus and hero |
| `brand/bottle.webp` | https://www.heineken.com/media/iene2ygx/heineken-original-bottle.png | Product photo, Heineken Original bottle | As above | 1506x2258 PNG (2.0 MB) → 733x1100 WebP q84 (91 KB) | Attract hero, next to the crate |

Removed after review: the filled draught glass and a photo-derived "emptied" glass (the owner preferred the drawn glass: shorter, wider, empty, red star emblem), the keg, the can and the 0.0 bottle (unused). The Star Catcher glass is drawn in code (`makeGlass` in `src/game/star-catcher.ts`).

Brand colours taken from these files: the star red `#E3000F` (logo SVG, class `st0`), and the brand-green radial `#4FAA33` → `#105D25`, sampled from https://www.heineken.com/media/wzsdqeus/gradient-wide-green.jpg.

**Fonts.** The Heineken typefaces are proprietary (LucasFonts, exclusive to Heineken) and were **not** copied. The UI uses PT Sans and PT Sans Narrow, which is heineken.com's own fallback font (SIL OFL).

## Particle textures (Kenney, CC0)

Kenney packs are public domain (CC0 1.0): commercial use is allowed and no attribution is required. Credit is given in CREDITS.md anyway.

| File(s) | Pack and source | Optimisation | Used for |
|---|---|---|---|
| `fx/star_09.png`, `star_04.png`, `star_06.png`, `star_08.png`, `flare_01.png`, `light_02.png`, `spark_03.png` | Particle Pack 1.1, https://kenney.nl/assets/particle-pack | 512x512 → 128x128, metadata stripped. White textures are tinted to brand colours at load. | Particles, glows, golden-star sparkle, twinkles |

## Music and sound effects (original, composed in code)

Every sound is original to this project: composed and synthesised by `scripts/compose-audio.mjs` (oscillators, filters, FM bells, Freeverb-style reverb, ping-pong delay, sidechain), then encoded to Opus with ffmpeg. No samples, no generated-by-service audio, no licence to clear. Re-render with `node scripts/compose-audio.mjs` (or `... music` / `... sfx`); output is deterministic (seeded noise).

Why this approach (2026-10-02): a music-generation service would need its own licence review and an internet round trip per change; runtime synthesis (Tone.js or a Web Audio sequencer) costs CPU on the kiosk every frame. Pre-rendered loop stems cost nothing at runtime beyond mixing two buffers, play offline from the service-worker cache, and still allow adaptive layering.

| Files | What | Format | Size |
|---|---|---|---|
| `music/lobby.ogg` | Menu loop: half-time, warm pads, bell motif. 104 BPM, 8 bars, Am-F-C-G | Opus 112 kbps stereo, 18.46 s | 2.3 MB for all five |
| `music/star-base.ogg`, `star-energy.ogg` | Star Catcher: four-on-the-floor house, 126 BPM, 16 bars. Energy stem = pluck arp, hook, shaker, fills | as above, 30.48 s each | |
| `music/crate-base.ogg`, `crate-energy.ogg` | Crate Stacker: syncopated, "crate knock" percussion, 116 BPM, 16 bars, Dm-Bb-Gm-A | as above, 33.10 s each | |
| `sfx/*.ogg` (27) | UI (tap, select, back, open, close), countdown (tick, go), Star Catcher (catch, golden, hazard, chill, dodge, combo, miss, milestone, end), Crate Stacker (slide, drop, land, slice, perfect, unstable, fall), result (count, reveal, unlock, prize) | Opus 48-80 kbps | 428 KB total |

All cues share one five-note "star motif" (E-A-G-E-D in A minor, transposed for Crate Stacker); the prize sting resolves it to A major. Loops are rendered with a 2.5 s tail folded back onto the start, so reverb and delay ring across the loop point; decoded lengths match the bar grid exactly.

Measured (ffmpeg ebur128): game base stems -15 to -16 LUFS integrated, energy stems ~5 dB below, lobby -13.8 LUFS; summed stems peak at -1 dBFS. SFX peaks are set per cue (-2 dBFS for the prize sting down to -20 dBFS for the count tick).

**Nobody has listened to these yet** (they were designed and checked by measurement: loudness, peaks, loop seams, spectrogram). Have someone listen on the kiosk speaker before the event; any cue can be re-tuned in the script or replaced by a file with the same name.

The Kenney sound effects used before this pass were removed.

## Generated in code

- Sun/heat hazard and ice cube sprites (`src/game/engine/sprites.ts`).
- Crate geometry: faces, ribs, bottle caps.
- Bokeh, light beams, the bar counter.
- All music and sound effects (`scripts/compose-audio.mjs`).
- Fallback versions of all game art, used only if the files above fail to load.

## Totals

`public/assets` is about 3.0 MB: brand 224 KB, effects 68 KB, sound effects 428 KB, music 2.3 MB. All of it is precached by the service worker for offline play.
