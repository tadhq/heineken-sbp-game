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

Removed after review: the draught glass (a beer-filled glass is the wrong object to catch stars in), the keg, the can and the 0.0 bottle (unused).

Brand colours taken from these files: the star red `#E3000F` (logo SVG, class `st0`), and the brand-green radial `#4FAA33` → `#105D25`, sampled from https://www.heineken.com/media/wzsdqeus/gradient-wide-green.jpg.

**Fonts.** The Heineken typefaces are proprietary (LucasFonts, exclusive to Heineken) and were **not** copied. The UI uses PT Sans and PT Sans Narrow, which is heineken.com's own fallback font (SIL OFL).

## Effects and sound (Kenney, CC0)

Kenney packs are public domain (CC0 1.0): commercial use is allowed and no attribution is required. Credit is given in CREDITS.md anyway.

| File(s) | Pack and source | Optimisation | Used for |
|---|---|---|---|
| `fx/star_09.png`, `star_04.png`, `star_06.png`, `star_08.png`, `flare_01.png`, `light_02.png`, `spark_03.png` | Particle Pack 1.1, https://kenney.nl/assets/particle-pack | 512x512 → 128x128, metadata stripped. White textures are tinted to brand colours at load. | Particles, glows, golden-star sparkle, twinkles |
| `sfx/tap`, `tick`, `go`, `dodge`, `miss`, `slice`, `perfect`, `milestone` (.ogg) | Interface Sounds, https://kenney.nl/assets/interface-sounds | Original Vorbis, 0.02-0.6 s each | UI and game feedback |
| `sfx/catch`, `chill`, `drop` (.ogg) | Impact Sounds, https://kenney.nl/assets/impact-sounds | Original | Glass clink on catch, ice, crate landing |
| `sfx/golden`, `hazard`, `fall`, `combo` (.ogg) | Digital Audio, https://kenney.nl/assets/digital-audio | Original | Bonus, penalty, crate falling, multiplier |
| `sfx/end`, `prize` (.ogg) | Music Jingles, https://kenney.nl/assets/music-jingles | Original | Round end, prize reveal |

The Kenney Casino Audio pack was downloaded but **deliberately not used**: casino sounds would suggest gambling (Responsible Marketing Code §4.5).

The sound choices were made by file name and duration, without listening. **Have someone listen on the kiosk speaker.** Any effect can be remapped by replacing a file in `public/assets/sfx/` with the same name.

## Generated in code

- Sun/heat hazard and ice cube sprites (`src/game/engine/sprites.ts`).
- Crate geometry: faces, ribs, bottle caps.
- Bokeh, light beams, the bar counter.
- The music sequencer.
- Fallback versions of all game art, used only if the files above fail to load.

## Totals

`public/assets` is 480 KB: brand 224 KB, effects 68 KB, sound 188 KB. All of it is precached by the service worker for offline play.
