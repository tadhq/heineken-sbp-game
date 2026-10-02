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
    // overflow:clip (not hidden): hidden boxes can still be scrolled by focus() or
    // scrollIntoView, which would shift the whole kiosk off-screen.
    <div className="fixed inset-0 flex items-center justify-center bg-ink" style={{ overflow: "clip" }}>
      <div
        className="relative shrink-0 bg-ink"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, overflow: "clip" }}
      >
        {children}
      </div>
    </div>
  );
}
