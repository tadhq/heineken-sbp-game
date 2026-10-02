import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import { initialsAllowed } from "./initials";
import { checkPlausibility, type SessionPayload } from "./session";

const t0 = Date.parse("2026-10-01T12:00:00Z");
const star = (over: Partial<Extract<SessionPayload, { game: "star" }>> = {}): SessionPayload => ({
  id: "6f1c4a2e-1b7a-4c1e-9d0e-0a1b2c3d4e5f",
  game: "star",
  startedAt: new Date(t0).toISOString(),
  endedAt: new Date(t0 + 46_000).toISOString(),
  durationMs: 45_000,
  score: 620,
  completed: true,
  isReplay: false,
  configVersion: 1,
  initials: null,
  stats: { caught: 40, golden: 2, hazards: 1, dodges: 3, missed: 6, chills: 1, bestCombo: 18 },
  prize: null,
  ...over,
});
const crate = (score: number, height: number, durationMs = 40_000): SessionPayload => ({
  ...star(),
  game: "crate",
  durationMs,
  endedAt: new Date(t0 + durationMs).toISOString(),
  score,
  stats: { height, perfects: 3, bestCombo: 2 },
});

describe("checkPlausibility", () => {
  it("passes a realistic Star Catcher round", () => {
    expect(checkPlausibility(DEFAULT_CONFIG, star())).toEqual([]);
  });
  it("flags a score above what the reported catches allow", () => {
    expect(checkPlausibility(DEFAULT_CONFIG, star({ score: 999_999 })).join()).toMatch(/above bound/);
  });
  it("flags impossible catch counts and over-long rounds", () => {
    const r = checkPlausibility(DEFAULT_CONFIG, star({ stats: { caught: 5000, golden: 0, hazards: 0, dodges: 0, missed: 0, chills: 0, bestCombo: 5 } }));
    expect(r.join()).toMatch(/more objects than can spawn/);
    expect(checkPlausibility(DEFAULT_CONFIG, star({ durationMs: 200_000, endedAt: new Date(t0 + 200_000).toISOString() })).join()).toMatch(/longer than round/);
  });
  it("flags a prize the rules do not give for that score", () => {
    const p = star({ score: 100, prize: { awardId: "0b8e3f8a-2c4d-4e6f-8a0b-1c2d3e4f5a6b", prizeId: "star-t3", prizeName: "x" } });
    expect(checkPlausibility(DEFAULT_CONFIG, p).join()).toMatch(/qualifies for none/);
  });
  it("accepts a prize the rules agree with", () => {
    const p = star({ score: 620, prize: { awardId: "0b8e3f8a-2c4d-4e6f-8a0b-1c2d3e4f5a6b", prizeId: "star-t1", prizeName: "Prize Tier 1" } });
    expect(checkPlausibility(DEFAULT_CONFIG, p)).toEqual([]);
  });
  it("bounds Crate Stacker by height and time", () => {
    expect(checkPlausibility(DEFAULT_CONFIG, crate(900, 20))).toEqual([]);
    expect(checkPlausibility(DEFAULT_CONFIG, crate(900, 2)).join()).toMatch(/above bound/);
    expect(checkPlausibility(DEFAULT_CONFIG, crate(50, 500, 10_000)).join()).toMatch(/too high/);
  });
});

describe("initialsAllowed", () => {
  it("allows plain initials and blocks bad or malformed ones", () => {
    expect(initialsAllowed("TAD")).toBe(true);
    expect(initialsAllowed("KUT")).toBe(false);
    expect(initialsAllowed("ab1")).toBe(false);
    expect(initialsAllowed("ABCD")).toBe(false);
  });
});
