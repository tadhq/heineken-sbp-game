/**
 * Build target. "web": served from the Next.js server (same origin as the API).
 * "apk": static export packed into the Android app; talks to the API at NEXT_PUBLIC_API_BASE.
 */
export const TARGET: "web" | "apk" = process.env.NEXT_PUBLIC_TARGET === "apk" ? "apk" : "web";
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
