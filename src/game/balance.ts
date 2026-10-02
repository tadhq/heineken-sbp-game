/**
 * Developer tuning tables for both games (GAME_DESIGN.md). Operator knobs (points, speeds,
 * fill amounts, durations) stay in the admin config; these shape how a round unfolds.
 * `src/game/balance.test.ts` plays bot rounds against these values and checks that scores
 * land in the prize bands and never trip the server's plausibility checks.
 */

export type StarPhase = {
  /** Start, as a fraction of the round. */
  at: number;
  /** Position between config start and max fall speed (0-1). */
  speed: number;
  /** Position between config start and min spawn interval (0-1). */
  interval: number;
  /** Position between config hazard chance start and end; null = no heat at all. */
  hazard: number | null;
  /** Multipliers on the config golden and ice chances. */
  golden: number;
  chill: number;
  /** Max sideways drift of stars (px/s); they bounce off the side walls. */
  drift: number;
  /** Chance a spawn is a group of 2-3 objects spread across the screen. */
  group: number;
  /** Heat weaves side to side. */
  heatWeave: boolean;
  /** Seconds between star showers (dense diagonal lines of red stars); 0 = none. */
  shower: number;
};

export const STAR_PHASES: StarPhase[] = [
  // 1 Warm-up: learn to catch.
  { at: 0, speed: 0, interval: 0, hazard: null, golden: 0, chill: 0, drift: 0, group: 0, heatWeave: false, shower: 0 },
  // 2 Momentum: more stars, first golden, ice.
  { at: 0.13, speed: 0.25, interval: 0.2, hazard: null, golden: 1, chill: 1, drift: 70, group: 0.12, heatWeave: false, shower: 0 },
  // 3 Pressure: heat arrives, stars drift.
  { at: 0.28, speed: 0.45, interval: 0.3, hazard: 0.35, golden: 1, chill: 1, drift: 150, group: 0.18, heatWeave: false, shower: 0 },
  // 4 Chaos: groups, weaving heat.
  { at: 0.46, speed: 0.65, interval: 0.45, hazard: 0.7, golden: 1.2, chill: 1.3, drift: 210, group: 0.42, heatWeave: true, shower: 0 },
  // 5 Combo Rush: showers worth chasing, little heat.
  { at: 0.65, speed: 0.72, interval: 0.3, hazard: 0.15, golden: 1.7, chill: 0.4, drift: 110, group: 0.15, heatWeave: false, shower: 2.6 },
  // 6 Final Push: everything, fastest.
  { at: 0.83, speed: 1, interval: 0.75, hazard: 1, golden: 1.8, chill: 1, drift: 240, group: 0.35, heatWeave: true, shower: 0 },
];

export const STAR = {
  /** On-screen glass height (px); width follows the art. */
  glassHeight: 380,
  /** Glass follows the finger, but no faster than this (px/s): far jumps take time. */
  glassMaxSpeed: 2100,
  glassFollow: 20,
  /** Catch window around the mouth, beyond the inner rim (px). */
  catchMargin: 6,
  /** Perfect catch: within this fraction of the mouth half-width from its centre. */
  perfectZone: 0.32,
  /** Fill multiplier for a perfect catch. */
  perfectFill: 1.5,
  /** "FULL GLASS" celebration before the glass is served (s). */
  fullHold: 0.55,
  /** Bonus window multiplier on the first serve; each serve inside the window adds one. */
  bonusBase: 2,
  /** A heat object passing this close (px) beyond the catch window is a near-miss dodge. */
  dodgeMargin: 110,
  /** Golden stars fall a little faster and weave wider: worth the risk, not free. */
  goldenSpeed: 1.12,
  goldenWeave: 140,
  /** Score interval between milestone chimes. */
  milestoneEvery: 500,
} as const;

export type CrateMotion = "pingpong" | "eased" | "crane" | "surge";

export type CrateStage = {
  /** First stack height (crates placed) of this stage. */
  from: number;
  motion: CrateMotion;
  /** Multiplier on the config slide speed at this height. */
  speed: number;
  /** Multiplier on the config perfect tolerance. */
  tolerance: number;
  /** Golden crates possible in this stage. */
  golden: boolean;
};

export const CRATE_STAGES: CrateStage[] = [
  { from: 0, motion: "pingpong", speed: 1, tolerance: 1.25, golden: false },
  { from: 6, motion: "pingpong", speed: 1.12, tolerance: 1, golden: true },
  { from: 12, motion: "eased", speed: 1.12, tolerance: 1, golden: true },
  { from: 18, motion: "crane", speed: 1, tolerance: 1, golden: true },
  { from: 24, motion: "surge", speed: 1.1, tolerance: 0.9, golden: true },
  { from: 32, motion: "surge", speed: 1.4, tolerance: 0.6, golden: true },
];

export const CRATE = {
  /** GREAT: within this many perfect tolerances. Keeps the streak, no width lost below tolerance. */
  greatFactor: 3,
  /** Crane: swing amplitude (px) and period (s) at stage start. */
  craneAmp: 330,
  cranePeriod: 2.3,
  /** Surge: speed changes by up to this factor, every surgeEvery seconds. */
  surge: 0.55,
  surgeEvery: 0.7,
  /** Camera zooms out with height so more of the tower stays in view. */
  zoomMin: 0.82,
  zoomFullAt: 30,
} as const;

export function starPhaseAt(p: number): number {
  let i = 0;
  while (i + 1 < STAR_PHASES.length && p >= STAR_PHASES[i + 1].at) i++;
  return i;
}

export function crateStageAt(height: number): number {
  let i = 0;
  while (i + 1 < CRATE_STAGES.length && height >= CRATE_STAGES[i + 1].from) i++;
  return i;
}
