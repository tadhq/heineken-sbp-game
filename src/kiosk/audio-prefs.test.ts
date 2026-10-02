import { describe, expect, it } from "vitest";
import { resolveAudioPrefs } from "./audio-prefs";

const defaults = { master: 0.9, music: 0.6, sfx: 0.85 };
const saved = (prefs: object, basis = "0.9|0.6|0.85") => ({ basis, prefs });

describe("resolveAudioPrefs", () => {
  it("uses admin defaults when nothing is stored", () => {
    expect(resolveAudioPrefs(defaults, null)).toEqual({ ...defaults, musicOn: true, sfxOn: true });
  });

  it("keeps the player's changes while the admin defaults are unchanged", () => {
    const p = resolveAudioPrefs(defaults, saved({ master: 0.5, music: 0, sfx: 1, musicOn: false, sfxOn: true }));
    expect(p).toEqual({ master: 0.5, music: 0, sfx: 1, musicOn: false, sfxOn: true });
  });

  it("drops the player's changes once the admin defaults change", () => {
    const p = resolveAudioPrefs({ ...defaults, music: 0.3 }, saved({ master: 0.5, music: 1, sfx: 1, musicOn: false, sfxOn: false }));
    expect(p).toEqual({ master: 0.9, music: 0.3, sfx: 0.85, musicOn: true, sfxOn: true });
  });

  it("repairs corrupt values field by field", () => {
    const p = resolveAudioPrefs(defaults, saved({ master: 7, music: "loud", sfx: Number.NaN, musicOn: "yes" }));
    expect(p).toEqual({ master: 1, music: 0.6, sfx: 0.85, musicOn: true, sfxOn: true });
  });
});
