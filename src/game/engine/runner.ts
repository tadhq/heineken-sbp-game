import { H, W, view } from "./math";

export type QualityLevel = "high" | "low";

/** What a game needs to know about the device budget. */
export type Quality = {
  level: QualityLevel;
  /** Particle cap. */
  particles: number;
  /** Additive glows, background parallax extras. */
  extras: boolean;
  /** Screen shake / flashes (also off when admin disables effects). */
  shake: boolean;
};

export function qualityFor(level: QualityLevel, effectsEnabled: boolean): Quality {
  if (!effectsEnabled) return { level, particles: 40, extras: false, shake: false };
  return level === "high" ? { level, particles: 260, extras: true, shake: true } : { level, particles: 90, extras: false, shake: true };
}

/** Backing-store resolution relative to the 1080x1920 logical stage. */
const RENDER_SCALE: Record<QualityLevel, number> = { high: 1, low: 0.72 };

export interface Game<R> {
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  pointer(type: "down" | "move" | "up", x: number, y: number): void;
  setQuality(q: Quality): void;
  /** QA autopilot (`?bot`): plays like a decent human so soak tests run unattended. */
  autopilot?(dt: number): void;
  readonly finished: boolean;
  result(): R;
}

type RunnerOptions<R> = {
  quality: QualityLevel;
  effectsEnabled: boolean;
  /** Allow the runner to drop to "low" when frames are consistently slow. */
  autoQuality: boolean;
  onFinish: (result: R) => void;
  onQualityDrop?: () => void;
  /** Dev/QA hook: average frame time samples, roughly once a second. */
  onStats?: (s: { fps: number; frameMs: number; level: QualityLevel }) => void;
  /** A frame threw. Reported, never fatal: see tick(). */
  onError?: (e: unknown) => void;
  bot?: boolean;
};

/**
 * Owns the canvas, the requestAnimationFrame loop and input mapping for one game run.
 * Nothing here touches React state: React only hears about the run when it finishes.
 */
export class Runner<R> {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private running = false;
  private done = false;
  private level: QualityLevel;
  private rect = { left: 0, top: 0, width: 1, height: 1 };
  private scale = 1;
  // Frame-time monitor
  private frameAcc = 0;
  private frameCount = 0;
  private slowWindows = 0;
  private warmup = 45;
  private errors = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game<R>,
    private opts: RunnerOptions<R>,
  ) {
    // alpha:false lets the compositor skip blending the canvas; desynchronized trims
    // a frame of latency where supported (falls back silently elsewhere).
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.level = opts.quality;
    game.setQuality(qualityFor(this.level, opts.effectsEnabled));
    this.resize();
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  start() {
    if (this.running || this.done) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Draw one frame without advancing time (shown behind the countdown). */
  renderStatic() {
    view.s = this.scale;
    this.game.render(this.ctx);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  get qualityLevel() {
    return this.level;
  }

  private resize = () => {
    const r = this.canvas.getBoundingClientRect();
    this.rect = { left: r.left, top: r.top, width: r.width || 1, height: r.height || 1 };
    // Never render more pixels than the screen shows, nor more than the logical stage.
    const devicePx = (r.width || W) * (window.devicePixelRatio || 1);
    this.scale = Math.min(1, devicePx / W) * RENDER_SCALE[this.level];
    const bw = Math.round(W * this.scale);
    const bh = Math.round(H * this.scale);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  };

  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    let dt = (now - this.last) / 1000;
    this.last = now;
    // A hitch (GC, tab switch) must not teleport objects through the catcher.
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) return;
    this.monitor(dt);

    // A bug in one frame must never freeze the kiosk: contain it, report it, and if it
    // keeps happening end the round with whatever result exists.
    try {
      const steps = Math.ceil(dt / (1 / 60));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        if (this.opts.bot) this.game.autopilot?.(h);
        this.game.update(h);
      }
      // Report a finished round before drawing, so a render problem cannot swallow it.
      if (this.game.finished) return this.finish();
      view.s = this.scale;
      this.game.render(this.ctx);
      this.errors = 0;
    } catch (e) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = "source-over";
      if (this.errors++ === 0) this.opts.onError?.(e);
      if (this.errors > 30) this.finish();
    }
  };

  private finish() {
    if (this.done) return;
    this.done = true;
    this.stop();
    this.opts.onFinish(this.game.result());
  }

  private monitor(dt: number) {
    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    this.frameAcc += dt;
    this.frameCount++;
    if (this.frameAcc < 1) return;
    const frameMs = (this.frameAcc / this.frameCount) * 1000;
    this.opts.onStats?.({ fps: Math.round(this.frameCount / this.frameAcc), frameMs, level: this.level });
    // Two consecutive seconds under ~45 fps: shed visual load. Never auto-upgrade
    // mid-game; flip-flopping between modes looks worse than staying low.
    this.slowWindows = frameMs > 22 ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 2 && this.level === "high" && this.opts.autoQuality) {
      this.level = "low";
      this.game.setQuality(qualityFor("low", this.opts.effectsEnabled));
      this.resize();
      this.opts.onQualityDrop?.();
    }
    this.frameAcc = 0;
    this.frameCount = 0;
  }

  private toLogical(e: PointerEvent): [number, number] {
    return [((e.clientX - this.rect.left) / this.rect.width) * W, ((e.clientY - this.rect.top) / this.rect.height) * H];
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    this.resize();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no capturable pointer.
    }
    const [x, y] = this.toLogical(e);
    this.game.pointer("down", x, y);
  };
  private onMove = (e: PointerEvent) => {
    const [x, y] = this.toLogical(e);
    this.game.pointer("move", x, y);
  };
  private onUp = (e: PointerEvent) => {
    const [x, y] = this.toLogical(e);
    this.game.pointer("up", x, y);
  };

  private onVisibility = () => {
    if (document.hidden) this.stop();
    else if (!this.done) this.start();
  };
}
