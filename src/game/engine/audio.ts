/**
 * Procedural audio. SFX are ZzFX parameter sets (MIT, see CREDITS.md) rendered into
 * AudioBuffers ONCE when audio is unlocked by the first tap; playing one during the game
 * is just a buffer-source node, no synthesis on the hot path. Music is a tiny step
 * sequencer on the same AudioContext. Every call is a no-op when audio is unavailable,
 * so a broken audio stack can never break the game.
 */

// ZzFX parameter order: volume, randomness, frequency, attack, sustain, release, shape,
// shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation,
// bitCrush, delay, sustainVolume, decay, tremolo, filter
const SFX = {
  tap: [0.6, 0, 520, 0, 0.02, 0.06, 1, 1.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.01],
  tick: [0.7, 0, 880, 0, 0.03, 0.08, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.02],
  go: [1, 0, 660, 0.01, 0.12, 0.3, 1, 1.4, 0, 0, 330, 0.06, 0, 0, 0, 0, 0, 0.8, 0.04],
  catch: [0.8, 0, 760, 0, 0.03, 0.12, 0, 1.4, 0, 0, 260, 0.03, 0, 0, 0, 0, 0, 0.6, 0.02],
  golden: [1, 0, 523, 0.01, 0.2, 0.45, 0, 1.2, 0, 0, 523, 0.07, 0.07, 0, 0, 0, 0.06, 0.7, 0.05],
  hazard: [1.1, 0, 140, 0.01, 0.12, 0.35, 3, 2.4, -6, 0, 0, 0, 0, 0.8, 0, 0.2, 0, 0.6, 0.05],
  chill: [0.8, 0, 1400, 0.02, 0.2, 0.5, 0, 1.8, -2, 0, 0, 0, 0.09, 0, 0, 0, 0.12, 0.5, 0.05],
  dodge: [0.5, 0, 1200, 0, 0.02, 0.06, 0, 1, 18, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0.01],
  combo: [0.9, 0, 880, 0.01, 0.08, 0.25, 0, 1.5, 0, 0, 440, 0.05, 0, 0, 0, 0, 0, 0.7, 0.03],
  miss: [0.45, 0, 300, 0, 0.04, 0.15, 2, 1, -8, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0.02],
  drop: [1, 0, 90, 0, 0.04, 0.22, 0, 2.6, -2.5, 0, 0, 0, 0, 0.35, 0, 0, 0, 0.7, 0.03],
  slice: [0.6, 0, 400, 0, 0.03, 0.12, 4, 1, -5, 0, 0, 0, 0, 1.4, 0, 0, 0, 0.5, 0.02],
  perfect: [0.9, 0, 1046, 0, 0.06, 0.32, 0, 1.6, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.65, 0.03],
  fall: [0.9, 0, 220, 0.02, 0.25, 0.6, 1, 1.4, -1.2, 0, 0, 0, 0, 0.2, 0, 0, 0, 0.6, 0.1],
  milestone: [0.9, 0, 784, 0.01, 0.1, 0.3, 0, 1.3, 0, 0, 392, 0.08, 0.08, 0, 0, 0, 0, 0.7, 0.03],
  end: [1, 0, 392, 0.02, 0.25, 0.6, 0, 1.2, 0, 0, -98, 0.15, 0, 0, 0, 0, 0.1, 0.7, 0.1],
  prize: [1, 0, 523, 0.02, 0.35, 0.6, 0, 1.2, 0, 0, 262, 0.1, 0.1, 0, 0, 0, 0.08, 0.8, 0.08],
} satisfies Record<string, number[]>;

export type SfxName = keyof typeof SFX;

type ZzfxModule = typeof import("zzfx");

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
    // Dynamic import: ZzFX creates its AudioContext at module load, which must happen
    // inside the user-gesture window and never during server rendering.
    const { ZZFX } = (await import("zzfx")) as ZzfxModule;
    const ctx: AudioContext = ZZFX.audioContext;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    // ZzFX samples are full scale; its own player applies ~0.3 gain, so match that.
    this.sfxBus.gain.value = 0.35;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.32;
    this.musicBus.connect(this.master);

    for (const [name, params] of Object.entries(SFX) as [SfxName, number[]][]) {
      const samples: number[] = ZZFX.buildSamples(...params);
      const buf = ctx.createBuffer(1, samples.length, ZZFX.sampleRate);
      buf.getChannelData(0).set(samples);
      this.buffers.set(name, buf);
    }
    const n = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    this.ctx = ctx;
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
