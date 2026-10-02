import type { AudioPrefs } from "@/game/engine/audio";
import type { KioskConfig } from "@/lib/config";

const KEY = "kiosk.audio";

type Stored = { basis: string; prefs: AudioPrefs };

/** Fingerprint of the admin defaults a player's changes were made against. */
const basisOf = (a: KioskConfig["audio"]) => `${a.master}|${a.music}|${a.sfx}`;

const unit = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/**
 * The mix to use: the player's saved changes, unless an admin has since changed the
 * defaults (then the new defaults win, so a remote change actually reaches the kiosk).
 * Pure, so it is unit-tested.
 */
export function resolveAudioPrefs(defaults: KioskConfig["audio"], stored: unknown): AudioPrefs {
  const base: AudioPrefs = { ...defaults, musicOn: true, sfxOn: true };
  const s = stored as Partial<Stored> | null;
  if (!s || typeof s !== "object" || s.basis !== basisOf(defaults) || !s.prefs || typeof s.prefs !== "object") return base;
  const p = s.prefs;
  return {
    master: unit(p.master, base.master),
    music: unit(p.music, base.music),
    sfx: unit(p.sfx, base.sfx),
    musicOn: typeof p.musicOn === "boolean" ? p.musicOn : true,
    sfxOn: typeof p.sfxOn === "boolean" ? p.sfxOn : true,
  };
}

export function loadAudioPrefs(defaults: KioskConfig["audio"]): AudioPrefs {
  try {
    return resolveAudioPrefs(defaults, JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return resolveAudioPrefs(defaults, null);
  }
}

export function saveAudioPrefs(defaults: KioskConfig["audio"], prefs: AudioPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ basis: basisOf(defaults), prefs } satisfies Stored));
  } catch {
    // Storage full or blocked: the change still applies for this session.
  }
}
