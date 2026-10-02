"use client";

import { CONE_H, CONE_W, FIXTURES, trussY } from "@/game/engine/stage-lights";
import { getHeroGlass, getStageArt } from "../assets";

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

/** The game's stage rig over every menu: same truss, fixtures and cones as in play. */
function StageRig({ lite }: { lite: boolean }) {
  const art = getStageArt();
  return (
    <>
      {FIXTURES.map((f, i) => (
        <div
          key={f.x}
          className="absolute origin-top"
          style={{ left: f.x - Math.sin(f.aim) * 64 - CONE_W / 2, top: trussY(f.x) + 8 + 64 - 40, width: CONE_W, height: CONE_H, transform: `rotate(${f.aim}rad)`, opacity: 0.5 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- baked light cone (data URL) */}
          <img
            src={art.cone}
            alt=""
            draggable={false}
            className={`h-full w-full origin-top ${lite ? "" : "motion-safe-only animate-cone-sway"}`}
            style={{ animationDelay: `${-i * 2.1}s` }}
          />
        </div>
      ))}
      {/* eslint-disable-next-line @next/next/no-img-element -- baked truss (data URL) */}
      <img src={art.rig} alt="" draggable={false} className="absolute left-0 w-[1080px] max-w-none" style={{ top: -40 }} />
    </>
  );
}

/**
 * Menu background: Heineken's vivid green radial (sampled from heineken.com's brand
 * gradient), the stage rig with its light cones, and drifting official stars. Only
 * transform and opacity animate (compositor thread). `lite` drops the moving parts.
 */
/** Per-game light: warm gold spotlight for Star Catcher, cooler deep "warehouse" green for Crate Stacker. */
const TINT = {
  star: "radial-gradient(60% 34% at 88% 4%, rgba(255,214,110,0.26), rgba(255,214,110,0) 70%), radial-gradient(60% 40% at 10% 90%, rgba(255,201,74,0.12), rgba(255,201,74,0) 70%)",
  crate: "radial-gradient(80% 50% at 15% 15%, rgba(159,227,255,0.10), rgba(159,227,255,0) 70%), linear-gradient(180deg, rgba(2,26,10,0) 40%, rgba(2,26,10,0.55) 100%)",
} as const;

export function Backdrop({ lite = false, tint }: { lite?: boolean; tint?: keyof typeof TINT }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(110% 62% at 50% 36%, #4faa33 0%, #2a8a33 22%, #136528 48%, #0a4a1d 72%, #052a12 100%)" }}
      />
      {tint && <div className="absolute inset-0" style={{ background: TINT[tint] }} />}
      <StageRig lite={lite} />
      {!lite &&
        Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="motion-safe-only absolute -top-24 animate-drift will-change-transform"
            style={{ left: 80 + ((i * 173) % 920), animationDuration: `${16 + (i % 3) * 5}s`, animationDelay: `${-i * 3.1}s`, opacity: 0.2 + (i % 3) * 0.08 }}
          >
            <OfficialStar size={34 + (i % 3) * 12} />
          </div>
        ))}
      <div className="absolute inset-x-0 bottom-0 h-[420px]" style={{ background: "linear-gradient(0deg, rgba(5,42,18,0.95), rgba(5,42,18,0))" }} />
    </div>
  );
}

/**
 * Attract-screen hero: the official star large and unobstructed, with the real product
 * grounded below it: the supplied multipack and the game's own glass, nearly full.
 * The star sways in real CSS 3D, a slow light burst turns behind it; all compositor-only.
 */
export function ProductHero({ lite = false }: { lite?: boolean }) {
  return (
    <div className="relative h-[780px] w-[1080px]">
      <div
        className={`absolute left-1/2 top-[420px] h-[1000px] w-[1000px] rounded-full ${lite ? "-translate-x-1/2 -translate-y-1/2" : "motion-safe-only animate-spin-slow"}`}
        style={{ background: "repeating-conic-gradient(from 0deg, rgba(255,255,230,0.10) 0deg 7deg, rgba(255,255,230,0) 7deg 20deg)", maskImage: "radial-gradient(circle, black 20%, transparent 68%)", WebkitMaskImage: "radial-gradient(circle, black 20%, transparent 68%)" }}
      />
      <div className="absolute left-1/2 top-[20px] -translate-x-1/2" style={{ perspective: 1800 }}>
        <div className={lite ? "" : "motion-safe-only animate-star-spin"} style={{ transformStyle: "preserve-3d" }}>
          <OfficialStar size={720} className="max-w-none" style={{ filter: "drop-shadow(0 22px 30px rgba(0,30,10,0.45))" }} />
        </div>
      </div>
      {/* Floor: contact shadow and a soft reflection pool under the products. */}
      <div className="absolute left-[150px] top-[722px] h-[70px] w-[780px] rounded-[50%]" style={{ background: "radial-gradient(closest-side, rgba(0,25,8,0.6), rgba(0,25,8,0))" }} aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element -- supplied multipack photo */}
      <img
        src="/assets/brand/multipack.webp"
        alt="Heineken multipack"
        draggable={false}
        className="absolute left-[130px] top-[392px] w-[600px] max-w-none"
        style={{ filter: "drop-shadow(0 20px 24px rgba(0,25,8,0.55))" }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- the game's glass, rendered with beer */}
      <img
        src={getHeroGlass()}
        alt="Heineken glas"
        draggable={false}
        className="absolute left-[742px] top-[400px] h-[350px] w-auto max-w-none"
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
