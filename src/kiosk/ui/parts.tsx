"use client";


const STAR_POINTS = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 47 : 100;
  return `${100 + Math.cos(a) * r},${100 + Math.sin(a) * r}`;
}).join(" ");

export function StarSvg({ className, fill = "#e1251b" }: { className?: string; fill?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <polygon points={STAR_POINTS} fill={fill} />
    </svg>
  );
}

const LOGO = "/assets/brand/heineken-logo.svg";

/** The official star with its white keyline (cut from the logo, see ASSETS.md). */
export function OfficialStar({ size, className = "", style }: { size: number; className?: string; style?: React.CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand mark
    <img src="/assets/brand/star.png" alt="" aria-hidden draggable={false} className={className} style={{ width: size, height: "auto", ...style }} />
  );
}

/**
 * Animated menu background: Heineken's vivid green radial (sampled from heineken.com's
 * brand gradient) with slow light beams and drifting official stars. Only transform and
 * opacity animate (compositor thread). `lite` drops the moving parts.
 */
export function Backdrop({ lite = false }: { lite?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(110% 62% at 50% 36%, #4faa33 0%, #2a8a33 22%, #136528 48%, #0a4a1d 72%, #052a12 100%)" }}
      />
      {!lite &&
        [
          { left: 140, delay: "0s", opacity: 0.18 },
          { left: 540, delay: "-3s", opacity: 0.12 },
          { left: 940, delay: "-6s", opacity: 0.16 },
        ].map((b, i) => (
          <div
            key={i}
            className="motion-safe-only absolute -top-20 h-[1500px] w-[420px] origin-top animate-beam-sway"
            style={{
              left: b.left - 210,
              opacity: b.opacity,
              animationDelay: b.delay,
              background: "linear-gradient(180deg, rgba(240,255,220,0.9), rgba(240,255,220,0) 85%)",
              clipPath: "polygon(45% 0, 55% 0, 100% 100%, 0 100%)",
            }}
          />
        ))}
      {!lite &&
        Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="motion-safe-only absolute -top-24 animate-drift will-change-transform"
            style={{ left: 60 + ((i * 113) % 960), animationDuration: `${14 + (i % 4) * 5}s`, animationDelay: `${-i * 2.7}s`, opacity: 0.22 + (i % 3) * 0.1 }}
          >
            <OfficialStar size={36 + (i % 3) * 14} />
          </div>
        ))}
      <div className="absolute inset-x-0 bottom-0 h-[420px]" style={{ background: "linear-gradient(0deg, rgba(5,42,18,0.95), rgba(5,42,18,0))" }} />
    </div>
  );
}

/**
 * Attract-screen hero: the official star large and unobstructed, with the real product
 * (crate and bottle) grounded below it. The star sways in real CSS 3D, a slow light burst
 * turns behind it; all compositor-only.
 */
export function ProductHero({ lite = false }: { lite?: boolean }) {
  // Star (760 wide, centre ~420px down) is the backdrop; crate and bottle stand on one floor
  // line between its legs so they read as sitting inside the star, not pasted over it.
  return (
    <div className="relative h-[780px] w-[1080px]">
      <div
        className={`absolute left-1/2 top-[420px] h-[1000px] w-[1000px] rounded-full ${lite ? "-translate-x-1/2 -translate-y-1/2" : "motion-safe-only animate-spin-slow"}`}
        style={{ background: "repeating-conic-gradient(from 0deg, rgba(255,255,230,0.10) 0deg 7deg, rgba(255,255,230,0) 7deg 20deg)", maskImage: "radial-gradient(circle, black 20%, transparent 68%)", WebkitMaskImage: "radial-gradient(circle, black 20%, transparent 68%)" }}
      />
      <div className="absolute left-1/2 top-[20px] -translate-x-1/2" style={{ perspective: 1800 }}>
        <div className={lite ? "" : "motion-safe-only animate-star-spin"} style={{ transformStyle: "preserve-3d" }}>
          <OfficialStar size={760} className="max-w-none" style={{ filter: "drop-shadow(0 22px 30px rgba(0,30,10,0.45))" }} />
        </div>
      </div>
      <div
        className="absolute left-[250px] top-[722px] h-[60px] w-[580px] rounded-[50%]"
        style={{ background: "radial-gradient(closest-side, rgba(0,25,8,0.55), rgba(0,25,8,0))" }}
        aria-hidden
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- official crate packshot */}
      <img
        src="/assets/brand/crate.webp"
        alt="Heineken krat"
        draggable={false}
        className="absolute left-[398px] top-[457px] w-[400px] max-w-none"
        style={{ filter: "drop-shadow(0 18px 22px rgba(0,25,8,0.5))" }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- official bottle packshot */}
      <img
        src="/assets/brand/bottle.webp"
        alt="Heineken Original"
        draggable={false}
        className="absolute left-[200px] top-[427px] h-[330px] w-auto max-w-none"
        style={{ filter: "drop-shadow(0 18px 22px rgba(0,25,8,0.5))" }}
      />
    </div>
  );
}

/** Official Heineken logo (heineken.com artwork, see ASSETS.md). */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- vector logo, intrinsic size from CSS
    <img src={LOGO} alt="Heineken" className={className} draggable={false} />
  );
}

/** Responsible-drinking line with Heineken's own "enjoy responsibly" mark. */
export function ResponsibleFooter({ text, notice }: { text: string; notice: string }) {
  return (
    <div className="absolute inset-x-0 bottom-10 flex items-center justify-center gap-5 font-sans text-[30px] text-cream/85">
      <span className="rounded-full border-2 border-cream/50 px-4 py-1 font-display text-[26px] font-bold text-cream">{notice}</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny vector mark */}
      <img src="/assets/brand/enjoy-responsibly.svg" alt="" className="h-[56px] w-[56px]" draggable={false} />
      <span>{text}</span>
    </div>
  );
}
