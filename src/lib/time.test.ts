import { describe, expect, it } from "vitest";
import { dayKey, startOfDay, startOfDayKey } from "./time";

describe("timezone day boundaries", () => {
  it("Paramaribo (UTC-3, no DST)", () => {
    const noonUtc = Date.parse("2026-10-01T12:00:00Z");
    expect(startOfDay(noonUtc, "America/Paramaribo").toISOString()).toBe("2026-10-01T03:00:00.000Z");
    // 01:00 UTC is still the previous local day there.
    expect(dayKey(Date.parse("2026-10-02T01:00:00Z"), "America/Paramaribo")).toBe("2026-10-01");
  });
  it("Amsterdam across DST changes", () => {
    expect(startOfDayKey("2026-03-29", "Europe/Amsterdam").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfDayKey("2026-03-30", "Europe/Amsterdam").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(startOfDayKey("2026-10-25", "Europe/Amsterdam").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(startOfDayKey("2026-10-26", "Europe/Amsterdam").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
  it("supports day offsets", () => {
    expect(startOfDay(Date.parse("2026-10-01T12:00:00Z"), "UTC", -1).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
});
