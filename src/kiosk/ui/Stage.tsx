"use client";

import { type ReactNode, useLayoutEffect, useState } from "react";

export const STAGE_W = 1080;
export const STAGE_H = 1920;

/**
 * Fixed 1080x1920 design surface scaled to fit any screen (letterboxed). The kiosk is
 * exactly this size, so scale is 1 there; other screens just get a uniform scale and the
 * composition never reflows.
 */
export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-ink">
      <div
        className="relative shrink-0 overflow-hidden bg-ink"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
