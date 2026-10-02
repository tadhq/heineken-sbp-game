"use client";

import { useEffect } from "react";

/** Registers the offline service worker (production only; dev uses HMR). `?nosw` opts out. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" || window.location.search.includes("nosw")) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(async () => {
        const reg = await navigator.serviceWorker.ready;
        // Hand over everything this page already loaded so it is available offline.
        const urls = performance.getEntriesByType("resource").map((e) => e.name);
        reg.active?.postMessage({ type: "cache-urls", urls });
      })
      .catch((e) => console.warn("[sw] registration failed", e));
  }, []);
  return null;
}
