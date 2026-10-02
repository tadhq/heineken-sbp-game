/**
 * Real brand and effect images (see ASSETS.md for sources and licences). Loaded once at
 * boot, decoded, then baked into right-sized offscreen canvases by sprites.ts, so the
 * game loop never touches an <img> or decodes anything mid-play.
 */

export const LOGO_SVG = "/assets/brand/heineken-logo.svg";
// Logo viewBox is 428.98 x 220.98. Regions measured with getBBox in Chromium.
const LOGO_SCALE = 4; // rasterise the SVG at 4x so crops stay crisp
export const LOGO_VIEW = { w: 428.98, h: 220.98 };
export const LOGO_WORDMARK = { x: 0, y: 150, w: 428.98, h: 71 }; // "Heineken®"
/**
 * Crate packshot geometry, as fractions of the image: the top rim of the front face sits
 * at 20% of the height (measured on the 2246x1644 original); above it is the open top
 * with bottle caps, which the next crate in a stack covers.
 */
export const CRATE_RIM = 0.2007;

export const FX = ["star_09", "flare_01", "light_02", "star_08", "star_06", "spark_03", "star_04"] as const;
export type FxName = (typeof FX)[number];

export type BrandImages = {
  /** Logo rasterised at LOGO_SCALE; use logoRect() for crops. */
  logo: HTMLCanvasElement;
  /** Official 24x30cl crate packshot, 3/4 view (public/assets/brand/crate.webp). */
  crate: HTMLImageElement;
  /** Official star with keyline, cut from the logo (public/assets/brand/star.png, see ASSETS.md). */
  star: HTMLImageElement;
  /** Supplied Heineken pint glass, transparent (Star Catcher catcher). */
  glass: HTMLImageElement;
  /** Supplied multipack photo (environment, hero, prize). */
  multipack: HTMLImageElement;
  fx: Record<FxName, HTMLImageElement>;
};

export function logoRect(r: { x: number; y: number; w: number; h: number }) {
  return [r.x * LOGO_SCALE, r.y * LOGO_SCALE, r.w * LOGO_SCALE, r.h * LOGO_SCALE] as const;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => img.decode().then(() => resolve(img), () => resolve(img));
    img.onerror = () => reject(new Error(`asset failed: ${src}`));
    img.src = src;
  });
}

/** SVGs without width/height rasterise at 300x150 in canvas; give it a real size first. */
async function rasteriseSvg(src: string, scale: number): Promise<HTMLCanvasElement> {
  const text = await (await fetch(src)).text();
  const sized = text.replace("<svg ", `<svg width="${LOGO_VIEW.w * scale}" height="${LOGO_VIEW.h * scale}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas");
    c.width = Math.ceil(LOGO_VIEW.w * scale);
    c.height = Math.ceil(LOGO_VIEW.h * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

let loading: Promise<BrandImages> | null = null;

/** Idempotent. Rejects only if an asset is missing; callers fall back to procedural art. */
export function loadBrandImages(): Promise<BrandImages> {
  loading ??= (async () => {
    const [logo, crate, star, glass, multipack, ...fx] = await Promise.all([
      rasteriseSvg(LOGO_SVG, LOGO_SCALE),
      loadImage("/assets/brand/crate.webp"),
      loadImage("/assets/brand/star.png"),
      loadImage("/assets/brand/glass.webp"),
      loadImage("/assets/brand/multipack.webp"),
      ...FX.map((n) => loadImage(`/assets/fx/${n}.png`)),
    ]);
    return { logo, crate, star, glass, multipack, fx: Object.fromEntries(FX.map((n, i) => [n, fx[i]])) as Record<FxName, HTMLImageElement> };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

let ready: BrandImages | null = null;
export const brandImages = () => ready;
export async function ensureBrandImages(): Promise<BrandImages | null> {
  try {
    ready = await loadBrandImages();
  } catch (e) {
    console.warn("[assets] brand images unavailable, using procedural fallback", e);
  }
  return ready;
}
