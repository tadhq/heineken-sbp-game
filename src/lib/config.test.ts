import { describe, expect, it } from "vitest";
import { type AppConfig, DEFAULT_CONFIG, normalizeConfig, resolvePrize } from "./config";
import { appConfigSchema } from "./config-schema";

const cfg = (patch: Partial<AppConfig> = {}): AppConfig => structuredClone({ ...DEFAULT_CONFIG, ...patch });

describe("resolvePrize", () => {
  it("returns null below every threshold", () => {
    expect(resolvePrize(cfg(), "star", 399)).toBeNull();
  });
  it("picks the tier containing the score, inclusive bounds", () => {
    expect(resolvePrize(cfg(), "star", 400)?.id).toBe("star-t1");
    expect(resolvePrize(cfg(), "star", 799)?.id).toBe("star-t1");
    expect(resolvePrize(cfg(), "star", 800)?.id).toBe("star-t2");
    expect(resolvePrize(cfg(), "star", 99999)?.id).toBe("star-t3");
  });
  it("only considers prizes for the game played", () => {
    expect(resolvePrize(cfg(), "crate", 450)?.id).toBe("crate-t1");
  });
  it("skips inactive prizes and falls back to the next eligible tier", () => {
    const c = cfg();
    c.prizes = c.prizes.map((p) => (p.id === "star-t3" ? { ...p, active: false } : p.id === "star-t2" ? { ...p, maxScore: null } : p));
    expect(resolvePrize(c, "star", 5000)?.id).toBe("star-t2");
  });
  it("prefers the highest minimum when tiers overlap", () => {
    const c = cfg();
    c.prizes.push({ ...c.prizes[0], id: "star-overlap", minScore: 600, maxScore: null });
    expect(resolvePrize(c, "star", 700)?.id).toBe("star-overlap");
  });
  it("awards nothing when the prize system is disabled", () => {
    const c = cfg();
    c.kiosk.prizesEnabled = false;
    expect(resolvePrize(c, "star", 5000)).toBeNull();
  });
});

describe("appConfigSchema", () => {
  it("accepts the defaults", () => {
    expect(appConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });
  it("rejects javascript: and data: prize images", () => {
    for (const imageUrl of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "//evil.example/x.png", "http://insecure.example/x.png"]) {
      const c = cfg();
      c.prizes[0] = { ...c.prizes[0], imageUrl };
      expect(appConfigSchema.safeParse(c).success, imageUrl).toBe(false);
    }
  });
  it("accepts own paths and https images", () => {
    const c = cfg();
    c.prizes[0] = { ...c.prizes[0], imageUrl: "/brand/prize.png" };
    c.prizes[1] = { ...c.prizes[1], imageUrl: "https://cdn.example.com/p.png" };
    expect(appConfigSchema.safeParse(c).success).toBe(true);
  });
  it("rejects duplicate ids and inverted ranges", () => {
    const c = cfg();
    c.prizes[1] = { ...c.prizes[1], id: c.prizes[0].id };
    expect(appConfigSchema.safeParse(c).success).toBe(false);
    const d = cfg();
    d.prizes[0] = { ...d.prizes[0], minScore: 500, maxScore: 100 };
    expect(appConfigSchema.safeParse(d).success).toBe(false);
  });
  it("fills in the age gate for configs saved before it existed", () => {
    const old = structuredClone(DEFAULT_CONFIG) as Record<string, unknown> & { kiosk: Record<string, unknown> };
    delete old.kiosk.ageGate;
    const parsed = appConfigSchema.parse(old);
    expect(parsed.kiosk.ageGate.enabled).toBe(false);
  });
});

describe("normalizeConfig (client cache guard)", () => {
  it("round-trips a valid config", () => {
    expect(normalizeConfig(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });
  it("rejects non-config values", () => {
    expect(normalizeConfig(null)).toBeNull();
    expect(normalizeConfig("x")).toBeNull();
    expect(normalizeConfig({ star: {} })).toBeNull();
  });
  it("repairs wrong types and fills fields added after the cache was written", () => {
    const old = structuredClone(DEFAULT_CONFIG) as unknown as { star: Record<string, unknown>; kiosk: Record<string, unknown>; prizes: unknown[] };
    old.star.durationSec = "45";
    delete old.kiosk.ageGate;
    old.prizes.push({ junk: true });
    const n = normalizeConfig(old)!;
    expect(n.star.durationSec).toBe(DEFAULT_CONFIG.star.durationSec);
    expect(n.kiosk.ageGate).toEqual(DEFAULT_CONFIG.kiosk.ageGate);
    expect(n.prizes).toHaveLength(DEFAULT_CONFIG.prizes.length);
  });
});
