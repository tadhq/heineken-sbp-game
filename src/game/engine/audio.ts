/**
 * One Web Audio graph for the whole page (AudioContexts are a limited resource):
 *
 *   sfx voices ─▶ sfxBus ─┐
 *   track stems ─▶ fader ─▶ duck ─▶ musicBus ─┴─▶ master ─▶ speakers
 *
 * Sound effects and music are original, rendered by scripts/compose-audio.mjs (see
 * ASSETS.md). Effects are decoded once when audio is unlocked by the first tap; playing
 * one is a single buffer-source node. Music is a set of loop stems per track: a base stem
 * plus an "energy" stem whose gain follows gameplay. Only the stems of the current track
 * and the lobby loop stay decoded.
 *
 * Every call is a no-op when audio is unavailable: a broken audio stack never breaks a
 * game. Without Web Audio it falls back to plain <audio> elements.
 */

const SFX = [
  "tap",
  "select",
  "back",
  "open",
  "close",
  "tick",
  "go",
  "catch",
  "golden",
  "hazard",
  "chill",
  "dodge",
  "combo",
  "miss",
  "milestone",
  "end",
  "slide",
  "drop",
  "land",
  "slice",
  "perfect",
  "unstable",
  "fall",
  "count",
  "reveal",
  "unlock",
  "prize",
  // Redesign pass
  "perfectCatch",
  "fill",
  "full",
  "serve",
  "bonus",
  "phase",
  "spill",
  "riser",
  "great",
  "stage",
  "goldCrate",
  "topple",
] as const;

export type SfxName = (typeof SFX)[number];
export type TrackId = "lobby" | "star" | "crate";

const TRACKS: Record<TrackId, { stems: string[]; level: number }> = {
  lobby: { stems: ["lobby"], level: 0.55 },
  star: { stems: ["star-base", "star-energy"], level: 0.85 },
  crate: { stems: ["crate-base", "crate-energy"], level: 0.85 },
};

/** Player-facing mix. Volumes are 0-1 slider positions (mapped to a perceptual curve). */
export type AudioPrefs = { master: number; music: number; sfx: number; musicOn: boolean; sfxOn: boolean };

/** Most simultaneous effect voices; beyond this new non-essential sounds are dropped. */
const MAX_VOICES = 12;
const MUSIC_TRIM = 0.75;

type Playing = { id: TrackId; fader: GainNode; energy: GainNode | null; sources: AudioBufferSourceNode[] };

const curve = (v: number) => Math.max(0, Math.min(1, v)) ** 2;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckNode: GainNode | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private stems = new Map<string, Promise<AudioBuffer | null>>();
  private lastPlayed = new Map<SfxName, number>();
  private voices = 0;
  private unlocking: Promise<void> | null = null;
  private fallback = false;
  private fallbackMusic: HTMLAudioElement | null = null;

  /** Admin switches: when off, the player cannot turn that channel on. */
  private policy = { music: true, sfx: true };
  private prefs: AudioPrefs = { master: 0.9, music: 0.6, sfx: 0.85, musicOn: true, sfxOn: true };

  /** Track the kiosk wants right now; kept even while music is muted so unmuting resumes it. */
  private wanted: TrackId | null = null;
  private playing: Playing | null = null;
  private intensityValue = 0;

  // ---------- setup ----------

  /** Call from a user gesture (first tap). Safe to call repeatedly; also resumes a suspended context. */
  unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return this.unlocking ?? Promise.resolve();
    }
    this.unlocking ??= this.init().catch((e) => {
      console.warn("[audio] Web Audio unavailable, using <audio> fallback", e);
      this.fallback = true;
      this.syncMusic();
    });
    return this.unlocking;
  }

  private async init() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("no AudioContext");
    const ctx = new Ctx({ latencyHint: "interactive" });
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.duckNode = ctx.createGain();
    this.duckNode.connect(this.musicBus);
    this.musicBus.connect(this.master);
    this.ctx = ctx;
    this.applyGains(0);
    // The current track can start while the effects are still decoding.
    this.syncMusic();
    // Decode in parallel; a missing file only silences that one effect.
    await Promise.all(
      SFX.map(async (name) => {
        const buf = await this.decode(`/assets/sfx/${name}.ogg`);
        if (buf) this.buffers.set(name, buf);
      }),
    );
  }

  private async decode(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return await this.ctx!.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      console.warn("[audio] could not load", url, e);
      return null;
    }
  }

  // ---------- mix ----------

  setPolicy(music: boolean, sfx: boolean) {
    if (music === this.policy.music && sfx === this.policy.sfx) return;
    this.policy = { music, sfx };
    this.applyGains();
    this.syncMusic();
  }

  setPrefs(p: AudioPrefs) {
    const musicWasOn = this.musicAudible;
    this.prefs = { ...p };
    this.applyGains();
    if (musicWasOn !== this.musicAudible) this.syncMusic();
  }

  get soundEnabled() {
    return this.policy.sfx && this.prefs.sfxOn;
  }

  private get musicAudible() {
    return this.policy.music && this.prefs.musicOn && this.prefs.music > 0;
  }

  private applyGains(smooth = 0.03) {
    const ctx = this.ctx;
    if (this.fallbackMusic) this.fallbackMusic.volume = curve(this.prefs.master) * curve(this.prefs.music) * MUSIC_TRIM;
    if (!ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const now = ctx.currentTime;
    const set = (g: GainNode, v: number) => (smooth ? g.gain.setTargetAtTime(v, now, smooth) : g.gain.setValueAtTime(v, now));
    set(this.master, curve(this.prefs.master));
    set(this.sfxBus, this.soundEnabled ? curve(this.prefs.sfx) : 0);
    set(this.musicBus, this.musicAudible ? curve(this.prefs.music) * MUSIC_TRIM : 0);
  }

  // ---------- effects ----------

  /** `rate` shifts pitch (combo ladders, countdown); `pan` is -1..1. Same sound is rate-limited. */
  play(name: SfxName, rate = 1, volume = 1, pan = 0) {
    if (!this.soundEnabled) return;
    if (this.fallback) return this.playFallback(name, volume);
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.sfxBus) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.03) return;
    // Big moments always play; small ones yield when the mix is already busy.
    if (this.voices >= MAX_VOICES && !BIG.has(name)) return;
    this.lastPlayed.set(name, now);
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      let out: AudioNode = src;
      if (volume !== 1) {
        const g = ctx.createGain();
        g.gain.value = volume;
        out = out.connect(g);
      }
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        out = out.connect(p);
      }
      out.connect(this.sfxBus);
      this.voices++;
      src.onended = () => {
        this.voices--;
        src.disconnect();
      };
      src.start();
    } catch {
      // Audio failures are never fatal.
    }
  }

  private fallbackPool = new Map<SfxName, HTMLAudioElement>();
  private playFallback(name: SfxName, volume: number) {
    try {
      let a = this.fallbackPool.get(name);
      if (!a) this.fallbackPool.set(name, (a = new Audio(`/assets/sfx/${name}.ogg`)));
      a.volume = Math.min(1, curve(this.prefs.master) * curve(this.prefs.sfx) * volume);
      a.currentTime = 0;
      void a.play().catch(() => {});
    } catch {}
  }

  // ---------- music ----------

  /** Crossfade to a track (null = fade out). Cheap to call repeatedly with the same id. */
  music(id: TrackId | null) {
    if (id === this.wanted) return;
    this.wanted = id;
    this.intensityValue = 0;
    this.syncMusic();
  }

  /** Prefetch a track's stems (e.g. on the instructions screen) so the game starts with music. */
  preload(id: TrackId) {
    if (this.ctx && this.policy.music) for (const s of TRACKS[id].stems) this.stem(s);
  }

  /** 0..1: how much of the energy layer is mixed in. */
  intensity(x: number) {
    x = Math.max(0, Math.min(1, x));
    if (Math.abs(x - this.intensityValue) < 0.02) return;
    this.intensityValue = x;
    const p = this.playing;
    if (p?.energy && this.ctx) p.energy.gain.setTargetAtTime(x, this.ctx.currentTime, 0.35);
  }

  /** Dip the music for a moment (prize reveal, big result), then recover. */
  duck(depth = 0.5, holdSec = 1.2) {
    const ctx = this.ctx;
    if (!ctx || !this.duckNode) return;
    const g = this.duckNode.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(1 - depth, now, 0.06);
    g.setTargetAtTime(1, now + holdSec, 0.5);
  }

  private stem(name: string) {
    let p = this.stems.get(name);
    if (!p) this.stems.set(name, (p = this.decode(`/assets/music/${name}.ogg`)));
    return p;
  }

  private syncMusic() {
    if (this.fallback) return this.syncFallbackMusic();
    const ctx = this.ctx;
    if (!ctx || !this.duckNode) return;
    const target = this.musicAudible ? this.wanted : null;
    if (this.playing?.id === target) return;
    this.fadeOut(this.playing);
    this.playing = null;
    if (!target) return;
    const def = TRACKS[target];
    // Entering a game frees the other game's stems (each 30 s stereo stem is ~12 MB of PCM).
    // Returning to the lobby keeps the last game's: "play again" must not decode again.
    if (target !== "lobby") for (const k of [...this.stems.keys()]) if (!def.stems.includes(k) && !TRACKS.lobby.stems.includes(k)) this.stems.delete(k);
    void Promise.all(def.stems.map((s) => this.stem(s))).then((bufs) => {
      // Another track (or silence) was requested while these decoded.
      if (this.wanted !== target || !this.musicAudible || this.playing || !bufs[0]) return;
      const fader = ctx.createGain();
      const start = ctx.currentTime + 0.06;
      fader.gain.setValueAtTime(0, start);
      fader.gain.linearRampToValueAtTime(def.level, start + 0.5);
      fader.connect(this.duckNode!);
      let energy: GainNode | null = null;
      const sources = bufs.flatMap((b, i) => {
        if (!b) return [];
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        if (i > 0) {
          energy = ctx.createGain();
          energy.gain.value = this.intensityValue;
          src.connect(energy).connect(fader);
        } else src.connect(fader);
        // Same start time on the audio clock keeps the stems sample-locked forever.
        src.start(start);
        return [src];
      });
      this.playing = { id: target, fader, energy, sources };
    });
  }

  private fadeOut(p: Playing | null) {
    if (!p || !this.ctx) return;
    const now = this.ctx.currentTime;
    p.fader.gain.cancelScheduledValues(now);
    p.fader.gain.setValueAtTime(p.fader.gain.value, now);
    p.fader.gain.linearRampToValueAtTime(0, now + 0.6);
    for (const s of p.sources) {
      try {
        s.stop(now + 0.65);
      } catch {}
      s.onended = () => s.disconnect();
    }
    setTimeout(() => p.fader.disconnect(), 800);
  }

  private syncFallbackMusic() {
    const id = this.musicAudible ? this.wanted : null;
    try {
      if (!id) return this.fallbackMusic?.pause();
      const src = `/assets/music/${TRACKS[id].stems[0]}.ogg`;
      if (!this.fallbackMusic) {
        this.fallbackMusic = new Audio();
        this.fallbackMusic.loop = true;
      }
      if (!this.fallbackMusic.src.endsWith(src)) this.fallbackMusic.src = src;
      this.applyGains();
      void this.fallbackMusic.play().catch(() => {});
    } catch {}
  }

  // ---------- lifecycle ----------

  /** Pause all audio while the page is hidden; the kiosk resumes on return. */
  suspend() {
    this.ctx?.suspend().catch(() => {});
    this.fallbackMusic?.pause();
  }
  resume() {
    if (this.ctx?.state === "suspended") this.ctx.resume().catch(() => {});
    if (this.fallbackMusic && this.wanted && this.musicAudible) void this.fallbackMusic.play().catch(() => {});
  }

  /** Diagnostics for the soak test: nothing here should grow over a long session. */
  stats() {
    return {
      state: this.ctx?.state ?? (this.fallback ? "fallback" : "locked"),
      voices: this.voices,
      track: this.playing?.id ?? null,
      musicSources: this.playing?.sources.length ?? 0,
      decodedStems: this.stems.size,
    };
  }
}

const BIG = new Set<SfxName>(["golden", "hazard", "perfect", "fall", "end", "prize", "reveal", "unlock", "go", "full", "bonus", "phase", "stage", "topple"]);

/** One engine per page. */
export const audio = new AudioEngine();
