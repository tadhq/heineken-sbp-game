/**
 * Sample-based sound effects (Kenney CC0 packs, see ASSETS.md) decoded into AudioBuffers
 * once, when audio is unlocked by the first tap; playing one during the game is just a
 * buffer-source node. Music is a tiny step sequencer on the same AudioContext. Every call
 * is a no-op when audio is unavailable, so a broken audio stack can never break the game.
 */

const SFX = [
  "tap",
  "tick",
  "go",
  "catch",
  "golden",
  "hazard",
  "chill",
  "dodge",
  "combo",
  "miss",
  "drop",
  "slice",
  "perfect",
  "fall",
  "milestone",
  "end",
  "prize",
] as const;

export type SfxName = (typeof SFX)[number];

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<SfxName, number>();
  private unlocking: Promise<void> | null = null;
  soundEnabled = true;
  musicEnabled = true;

  // Music sequencer state
  private seqTimer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private bpm = 112;

  /** Call from a user gesture (first tap). Safe to call repeatedly. */
  unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return Promise.resolve();
    }
    this.unlocking ??= this.init().catch((e) => {
      console.warn("[audio] unavailable", e);
    });
    return this.unlocking;
  }

  private async init() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.28;
    this.musicBus.connect(this.master);

    const n = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    this.ctx = ctx;
    // Decode in parallel; a missing file only silences that one effect.
    await Promise.all(
      SFX.map(async (name) => {
        try {
          const res = await fetch(`/assets/sfx/${name}.ogg`);
          this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (e) {
          console.warn("[audio] could not load", name, e);
        }
      }),
    );
  }

  /** `rate` shifts pitch (used for rising combo tones). Same sound is rate-limited. */
  play(name: SfxName, rate = 1, volume = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.soundEnabled || ctx.state !== "running") return;
    const buf = this.buffers.get(name);
    if (!buf || !this.sfxBus) return;
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.03) return;
    this.lastPlayed.set(name, now);
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      if (volume !== 1) {
        const g = ctx.createGain();
        g.gain.value = volume;
        src.connect(g).connect(this.sfxBus);
      } else src.connect(this.sfxBus);
      src.start();
    } catch {
      // Audio failures are never fatal.
    }
  }

  // ---------- music ----------

  startMusic(bpm = 112) {
    this.bpm = bpm;
    if (!this.ctx || !this.musicEnabled || this.seqTimer) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    // Lookahead scheduling: a coarse timer queues notes slightly ahead on the audio
    // clock, so timing stays tight even when the main thread is busy rendering.
    this.seqTimer = setInterval(() => this.schedule(), 25);
  }

  setTempo(bpm: number) {
    this.bpm = bpm;
  }

  stopMusic() {
    if (this.seqTimer) clearInterval(this.seqTimer);
    this.seqTimer = null;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    if (ctx.state !== "running") return;
    // Catch up if the timer was throttled (e.g. tab hidden): skip, don't burst.
    if (this.nextNoteTime < ctx.currentTime - 0.2) this.nextNoteTime = ctx.currentTime + 0.05;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 32;
    }
  }

  // A minor pentatonic groove: kick on beats, offbeat hats, a walking bass.
  private static BASS = [45, 0, 45, 0, 48, 0, 45, 0, 52, 0, 50, 0, 48, 0, 45, 0, 41, 0, 41, 0, 43, 0, 45, 0, 48, 0, 45, 0, 43, 0, 40, 0];

  private playStep(step: number, t: number) {
    const ctx = this.ctx!;
    const bus = this.musicBus!;
    if (step % 4 === 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.21);
    }
    if (step % 4 === 2 && this.noise) {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      s.connect(f).connect(g).connect(bus);
      s.start(t, 0, 0.06);
    }
    const note = AudioEngine.BASS[step];
    if (note) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = 440 * 2 ** ((note - 69) / 12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.2);
    }
  }

  /** Pause all audio while the page is hidden; the kiosk resumes on return. */
  suspend() {
    this.ctx?.suspend().catch(() => {});
  }
  resume() {
    if (this.ctx?.state === "suspended") this.ctx.resume().catch(() => {});
  }
}

/** One engine per page: AudioContexts are a limited resource. */
export const audio = new AudioEngine();
