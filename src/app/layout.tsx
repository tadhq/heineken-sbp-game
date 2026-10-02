import type { Metadata, Viewport } from "next";
import { PT_Sans, PT_Sans_Narrow } from "next/font/google";
import { ServiceWorker } from "@/kiosk/ServiceWorker";
import "./globals.css";

// PT Sans is heineken.com's own fallback face (OFL); the Heineken typefaces are
// proprietary (RESEARCH.md §3). next/font self-hosts them, so they work offline.
const sans = PT_Sans({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-sans", display: "swap" });
const display = PT_Sans_Narrow({ subsets: ["latin"], weight: ["700"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Heineken Games",
  description: "Star Catcher and Crate Stacker kiosk games",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
};

// Kiosk: no pinch-zoom; the stage scales itself to the screen.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#03130a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${sans.variable} ${display.variable}`}>
      <body className="font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
