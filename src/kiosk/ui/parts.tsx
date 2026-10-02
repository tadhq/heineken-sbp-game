"use client";

import { useState } from "react";

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

/**
 * Animated menu background. Only transform/opacity animate (compositor thread), so it
 * costs almost no main-thread time even on a weak CPU. `lite` drops the moving parts.
 */
export function Backdrop({ lite = false }: { lite?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 70% at 50% 38%, #0b4a20 0%, #062a14 42%, #03130a 78%)" }}
      />
      {!lite &&
        [
          { left: 140, delay: "0s", opacity: 0.16 },
          { left: 520, delay: "-3s", opacity: 0.12 },
          { left: 880, delay: "-6s", opacity: 0.15 },
        ].map((b, i) => (
          <div
            key={i}
            className="motion-safe-only absolute -top-20 h-[1500px] w-[420px] origin-top animate-beam-sway"
            style={{
              left: b.left - 210,
              opacity: b.opacity,
              animationDelay: b.delay,
              background: "linear-gradient(180deg, rgba(180,255,180,0.9), rgba(180,255,180,0) 85%)",
              clipPath: "polygon(45% 0, 55% 0, 100% 100%, 0 100%)",
            }}
          />
        ))}
      {!lite &&
        Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="motion-safe-only absolute -top-24 animate-drift will-change-transform"
            style={{ left: 60 + ((i * 113) % 960), animationDuration: `${14 + (i % 4) * 5}s`, animationDelay: `${-i * 2.7}s`, opacity: 0.18 + (i % 3) * 0.08 }}
          >
            <StarSvg className="h-12 w-12" />
          </div>
        ))}
      <div className="absolute inset-x-0 bottom-0 h-[420px]" style={{ background: "linear-gradient(0deg, rgba(3,19,10,0.95), rgba(3,19,10,0))" }} />
    </div>
  );
}

/** 2.5D spinning red star: stacked layers in real 3D space, rotated by the compositor. */
export function HeroStar({ size = 520, lite = false }: { size?: number; lite?: boolean }) {
  const layers = lite ? 1 : 7;
  return (
    <div className="relative" style={{ width: size, height: size, perspective: 1600 }}>
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(225,37,27,0.45) 0%, rgba(225,37,27,0) 65%)", transform: "scale(1.4)" }}
      />
      <div className={`absolute inset-0 ${lite ? "" : "motion-safe-only animate-star-spin"}`} style={{ transformStyle: "preserve-3d" }}>
        {/* Back layers form the extruded edge; the front layer carries the gradient. */}
        {Array.from({ length: layers }, (_, i) => (
          <div key={i} className="absolute inset-0" style={{ transform: `translateZ(${(i - layers + 1) * 5}px)` }}>
            <StarSvg className="h-full w-full" fill={i === layers - 1 ? "url(#starFace)" : "#8f1009"} />
          </div>
        ))}
      </div>
      <svg width="0" height="0" className="absolute">
        <defs>
          <radialGradient id="starFace" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#ff8a78" />
            <stop offset="45%" stopColor="#e1251b" />
            <stop offset="100%" stopColor="#a8150c" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}

/**
 * Brand wordmark slot. Official Heineken artwork is trademarked and must come from the
 * client (RESEARCH.md §3): drop it at public/brand/logo.svg. Until then a plain-text
 * placeholder renders; it is NOT the logo.
 */
export function BrandMark({ className = "" }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return <div className={`font-display font-bold uppercase tracking-[0.12em] text-cream ${className}`}>Heineken</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- optional client asset, may be absent
    <img src="/brand/logo.svg" alt="Heineken" className={className} onError={() => setFailed(true)} draggable={false} />
  );
}

export function ResponsibleFooter({ text, notice }: { text: string; notice: string }) {
  return (
    <div className="absolute inset-x-0 bottom-10 flex items-center justify-center gap-6 font-sans text-[30px] text-silver/80">
      <span className="rounded-full border-2 border-silver/40 px-4 py-1 font-display text-[26px] font-bold text-silver">{notice}</span>
      <span>{text}</span>
    </div>
  );
}
