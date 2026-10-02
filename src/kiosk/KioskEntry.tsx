"use client";

import dynamic from "next/dynamic";

// The kiosk is pure client state (canvas, IndexedDB, audio): server-rendering it buys
// nothing and would force hydration-safe workarounds for every browser read.
const KioskApp = dynamic(() => import("./KioskApp").then((m) => m.KioskApp), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-ink" />,
});

export function KioskEntry() {
  return <KioskApp />;
}
