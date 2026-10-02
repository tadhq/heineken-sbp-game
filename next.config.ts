import type { NextConfig } from "next";

/**
 * Two build targets from one codebase:
 * - default: the full app (kiosk + admin + API) served by Next.js on Vercel.
 * - BUILD_TARGET=apk: a static export of the kiosk only, packed into the Android app by
 *   Capacitor. pageExtensions ["tsx"] leaves out the API route handlers (route.ts), which
 *   a static export cannot contain; the app calls the online API via NEXT_PUBLIC_API_BASE.
 */
const apk = process.env.BUILD_TARGET === "apk";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(apk
    ? { output: "export", distDir: ".next-apk", pageExtensions: ["tsx"], images: { unoptimized: true } }
    : {
        async headers() {
          return [
            { source: "/:path*", headers: securityHeaders },
            {
              // The service worker must never be served stale, or kiosks keep old code forever.
              source: "/sw.js",
              headers: [
                { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
                { key: "Content-Type", value: "application/javascript; charset=utf-8" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
