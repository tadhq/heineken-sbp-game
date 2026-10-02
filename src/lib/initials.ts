/** Shared by kiosk (input) and server (sync); kept zod-free so it is cheap on the client. */

// Small blocklist for 3-letter leaderboard initials (EN/NL). Admins can also hide any
// entry from the dashboard; this only stops the obvious ones from ever showing.
const BLOCKED_INITIALS = new Set(["ASS", "FUK", "FUC", "FCK", "SEX", "CUM", "DIK", "KUT", "LUL", "NAZ", "KKK", "TIT", "POO", "GAY", "FAG", "NIG", "WTF", "PIK", "HOE"]);

export function initialsAllowed(v: string): boolean {
  return /^[A-Z]{3}$/.test(v) && !BLOCKED_INITIALS.has(v);
}
