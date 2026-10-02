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
};

export type StarResult = { game: "star"; score: number; stats: StarStats; elapsedMs: number };
export type CrateResult = { game: "crate"; score: number; stats: CrateStats; elapsedMs: number };
export type GameResult = StarResult | CrateResult;
