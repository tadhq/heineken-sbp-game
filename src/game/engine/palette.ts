/**
 * Brand palette. Greens are taken from heineken.com's live stylesheet (no public brand
 * spec exists, see RESEARCH.md §3). STAR_RED is a placeholder: the official red-star value
 * was not publicly verifiable and must come from the client's brand team.
 * Mirrored in tailwind.config.ts; keep both in sync.
 */
export const PALETTE = {
  ink: "#03130a",
  deep: "#062a14",
  forest: "#005d1f",
  heading: "#13670b",
  leaf: "#277816",
  bright: "#12a415",
  starRed: "#e1251b",
  starRedDark: "#8f1009",
  silver: "#c9cfcb",
  cream: "#f3f6f1",
  gold: "#ffc94a",
  goldDeep: "#c98a10",
  heat: "#ff7a1a",
  ice: "#9fe3ff",
} as const;
