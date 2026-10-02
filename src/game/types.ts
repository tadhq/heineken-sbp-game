import type { CrateStats, StarStats } from "@/lib/session";

/** In-canvas strings, injected so games stay language-agnostic. */
export type GameLabels = {
  timeUp: string;
  stage: (n: number) => string;
  golden: string;
  comboLost: string;
  dodge: string;
  chill: string;
  perfect: string;
  gameOver: string;
  score: string;
  height: string;
  tapToDrop: string;
  combo: string;
  unstable: string;
  // Redesign pass
  phase: (n: number) => string;
  phaseName: (n: number) => string;
  stageName: (n: number) => string;
  spill: string;
  fullGlass: string;
  bonus: string;
  served: string;
  great: string;
  good: string;
  sloppy: string;
  goldCrate: string;
};

export type StarResult = { game: "star"; score: number; stats: StarStats; elapsedMs: number };
export type CrateResult = { game: "crate"; score: number; stats: CrateStats; elapsedMs: number };
export type GameResult = StarResult | CrateResult;
