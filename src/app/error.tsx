"use client";

import { useEffect } from "react";
import { logError } from "@/kiosk/sync";

/**
 * Last line of defence: an unexpected React error must never leave the kiosk on a blank
 * or broken screen. Log it (rides along with the next sync) and reload to the attract
 * screen; the service worker serves the shell even when offline.
 */
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    logError(`${error.name}: ${error.message}`, `boundary${error.digest ? `:${error.digest}` : ""}`);
    const id = setTimeout(() => window.location.replace(window.location.pathname), 4000);
    return () => clearTimeout(id);
  }, [error]);
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-ink px-8 text-center font-display text-cream">
      <div className="h-16 w-16 animate-spin rounded-full border-4 border-bright border-t-transparent" aria-hidden />
      <p className="text-3xl font-bold uppercase">One moment / Even geduld</p>
    </div>
  );
}
