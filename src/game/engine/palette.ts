/**
 * Brand palette. Greens are taken from heineken.com's live stylesheet (no public brand
 * spec exists, see RESEARCH.md §3). starRed is the fill of the star in Heineken's own
 * logo artwork (heineken.com/media/zmnkoinc/heineken-logo.svg, class st0). The vivid
 * greens are sampled from heineken.com's brand gradient image.
 * Mirrored in tailwind.config.ts; keep both in sync.
 */
export const PALETTE = {
  ink: "#03130a",
  deep: "#062a14",
  forest: "#005d1f",
  heading: "#13670b",
  leaf: "#277816",
  bright: "#12a415",
  starRed: "#e3000f",
  starRedDark: "#8f1009",
  silver: "#c9cfcb",
  cream: "#f3f6f1",
  gold: "#ffc94a",
  goldDeep: "#c98a10",
  heat: "#ff7a1a",
  ice: "#9fe3ff",
  brandCenter: "#4faa33",
  brandEdge: "#105d25",
} as const;
