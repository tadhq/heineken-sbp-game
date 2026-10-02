import type { CrateConfig } from "@/lib/config";
import type { CrateStats } from "@/lib/session";
import { CRATE, CRATE_STAGES, type CrateStage, crateStageAt } from "./balance";
import { audio } from "./engine/audio";
import { CRATE_RIM } from "./engine/brand-assets";
import { drawNumber, drawPlate, Juice, makeChip, makePlate } from "./engine/hud";
import { clamp, damp, easeOutCubic, H, lerp, place, rand, resetView, view, W } from "./engine/math";
import { PALETTE as P } from "./engine/palette";
import { Particles } from "./engine/particles";
import { Popups } from "./engine/popups";
import type { Game, Quality } from "./engine/runner";
import { brandBackdrop, makeSprite, type SharedSprites, type Sprite, starPath, vignette } from "./engine/sprites";
import { drawCones } from "./engine/stage-lights";
import type { CrateResult, GameLabels } from "./types";

/*
 * CRATE STACKER (redesign, GAME_DESIGN.md §4)
 * A crate moves above the stack; tap to drop it. Overhang is sliced off, so width is the
 * resource. Each drop is graded: PERFECT (no width lost, streak grows), GREAT (streak
 * kept), GOOD/OFF (multiplier drops one step). Stages change HOW the crate moves (steady,
 * eased, crane swing, surges), golden crates pay out for a perfect drop, and the camera
 * zooms out as the tower grows. Placement stays deterministic arithmetic; sway, tremble
 * and the topple are presentation only.
 */

const CRATE_H = 96;
const DX = 34; // oblique depth of the procedural crate: top face shifts right…
const DY = 30; // …and up
const GROUND_Y = 1660;
const HOVER = 70;
// Text slots sit between the rig and the hovering crate, never on the crate.
const MOVER_SCREEN_Y = 1060;
const SLOT_GRADE = 430;
const SLOT_MULT = 515;
const SLOT_BANNER = 625;
const MIN_X = 70;
const MAX_X = W - 70 - DX;
const OUTRO_S = 2.8;
const IDLE_END_S = 15;
const SCORE_AT = { x: 170, y: 160 };
const RIG_Y = 196;
const METER = { x: W / 2, y: 292, w: 420 };

type Grade = "perfect" | "great" | "good" | "off";

/** u0..u1: which horizontal slice of the crate photo this crate shows (slicing cuts the photo). */
type Crate = { x: number; w: number; u0: number; u1: number; golden: boolean };
type Debris = { on: boolean; x: number; y: number; w: number; vx: number; vy: number; rot: number; vrot: number; shade: number; u0: number; u1: number; golden: boolean; fatal: boolean };

export class CrateStacker implements Game<CrateResult> {
  private stack: Crate[] = [];
  private mover: Crate = { x: 0, w: 0, u0: 0, u1: 1, golden: false };
  private dir = 1;
  private dropping = false;
  private dropY = 0;
  private dropV = 0;
  private debris: Debris[] = Array.from({ length: 6 }, () => ({ on: false, x: 0, y: 0, w: 0, vx: 0, vy: 0, rot: 0, vrot: 0, shade: 0, u0: 0, u1: 1, golden: false, fatal: false }));
  /** Crate photo pre-scaled to its on-screen width (no per-frame resampling of the source). */
  private img: HTMLCanvasElement | null = null;
  private goldImg: HTMLCanvasElement | null = null;
  /** Height of one stack level (the crate's front face) and of the open top above it. */
  private crateH = CRATE_H;
  private crateTop = DY;
  private particles: Particles;
  private popups: Popups;
  private bg: Sprite;
  private bgLow: Sprite | null = null;
  private far: Sprite;
  private mid: Sprite;
  private pallet: Sprite;
  private body: Sprite;
  private badge: Sprite;
  private q!: Quality;

  private elapsed = 0;
  private score = 0;
  private shown = 0;
  private combo = 0;
  /** Perfects toward the multiplier; an OFF drop takes it back one step. */
  private streak = 0;
  private mult = 1;
  private stats: CrateStats = { height: 0, perfects: 0, bestCombo: 0, greats: 0, goldens: 0 };
  private stageIdx = 0;
  /** Camera: world offset (oy) and zoom (z), both eased. */
  private cam = 0;
  private zoom = 1;
  private wob = 0;
  private wobV = 0;
  private landT = 0;
  private perfectT = 0;
  private shakeT = 0;
  private flashT = 0;
  private bannerT = 0;
  private bannerDur = 1.1;
  private banner = "";
  private bannerSub = "";
  private hintT = 0;
  private outro = 0;
  private done = false;
  private bonusShown = false;
  /** Seconds since the last tap: a walked-away player ends the run instead of blocking the kiosk. */
  private idle = 0;
  /** Motion state: phase for eased/crane, surge factor and its timer. */
  private motionT = 0;
  private surgeK = 1;
  private surgeT = 0;
  private swing = 0;
  private juice = new Juice();
  private scorePlate: Sprite;
  private heightPlate: Sprite;
  private chips = new Map<number, Sprite>();
  /** Contact shadow where a crate sits on the one below. */
  private ao: Sprite;
  private scoreBump = 0;
  private multPop = 0;
  /** Camera "kick" on landing: a damped spring, render-only. */
  private kick = 0;
  private kickV = 0;
  private zoomPulse = 0;
  /** Narrow or leaning tower: extra render-only sway and a one-time warning. */
  private unstable = false;
  /** Last drop for the precision meter: offset as a fraction of the crate width, grade, age. */
  private meter = { off: 0, grade: "off" as Grade, t: 0, tol: 0 };
  private impactDone = false;

  constructor(
    private cfg: CrateConfig,
    private sprites: SharedSprites,
    private font: string,
    private labels: GameLabels,
  ) {
    this.particles = new Particles(220, sprites.particles);
    this.popups = new Popups(14, font);
    this.bg = makeSprite(W, H, (ctx) => this.paintBackground(ctx, false));
    this.far = makeSprite(W, H, (ctx) => this.paintRacking(ctx, 0.62, 0.38, 11));
    this.mid = makeSprite(W, H, (ctx) => this.paintRacking(ctx, 1, 0.6, 23));
    this.pallet = makeSprite(cfg.startWidth + 120, 70, (ctx) => {
      const w = cfg.startWidth + 120;
      // Wooden pallet: deck boards over three blocks, lit from above.
      ctx.fillStyle = "#4a3418";
      for (const x of [10, w / 2 - 30, w - 70]) ctx.fillRect(x, 26, 60, 40);
      for (let i = 0; i < 6; i++) {
        const g = ctx.createLinearGradient(0, 4, 0, 26);
        g.addColorStop(0, "#b98a4e");
        g.addColorStop(1, "#7a5528");
        ctx.fillStyle = g;
        ctx.fillRect(i * (w / 6) + 3, 4, w / 6 - 6, 22);
      }
      ctx.fillStyle = "rgba(255,240,200,0.35)";
      ctx.fillRect(0, 4, w, 2);
    });
    this.body = makeSprite(8, CRATE_H, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, CRATE_H);
      g.addColorStop(0, "#3fb04a");
      g.addColorStop(0.1, "#16862f");
      g.addColorStop(1, "#0a5a22");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 8, CRATE_H);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      for (const y of [30, 58, 80]) ctx.fillRect(0, y, 8, 4);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      for (const y of [34, 62, 84]) ctx.fillRect(0, y, 8, 2);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(0, 0, 8, 3);
    });
    this.badge = makeSprite(90, 60, (ctx) => {
      ctx.fillStyle = P.cream;
      ctx.beginPath();
      ctx.ellipse(45, 30, 42, 27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.forest;
      ctx.stroke();
      starPath(ctx, 45, 31, 19);
      ctx.fillStyle = P.starRed;
      ctx.fill();
    });
    const photo = sprites.crateImage;
    if (photo) {
      const aspect = photo.naturalHeight / photo.naturalWidth;
      const w = Math.round(cfg.startWidth);
      const h = Math.round(cfg.startWidth * aspect);
      this.img = makeSprite(w, h, (c) => {
        c.imageSmoothingQuality = "high";
        c.drawImage(photo, 0, 0, w, h);
      }).canvas;
      // Golden crate: the same packshot, gilded (multiply gold, then a light sheen).
      this.goldImg = makeSprite(w, h, (c) => {
        c.drawImage(this.img!, 0, 0);
        c.globalCompositeOperation = "source-atop";
        c.globalAlpha = 0.62;
        const g = c.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, "#fff0b0");
        g.addColorStop(0.45, "#ffc94a");
        g.addColorStop(1, "#b97d10");
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 0.3;
        c.globalCompositeOperation = "lighter";
        c.fillRect(0, 0, w, h * 0.3);
      }).canvas;
      this.crateH = cfg.startWidth * aspect * (1 - CRATE_RIM);
      this.crateTop = cfg.startWidth * aspect * CRATE_RIM;
    }
    this.scorePlate = makePlate(620, 168, 34, P.starRed);
    this.heightPlate = makePlate(320, 168, 34);
    this.ao = makeSprite(4, 32, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 32);
      g.addColorStop(0, "rgba(0,18,6,0.55)");
      g.addColorStop(1, "rgba(0,18,6,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 32);
    });
    this.stack.push({ x: W / 2 - cfg.startWidth / 2 - (this.img ? 0 : DX / 2), w: cfg.startWidth, u0: 0, u1: 1, golden: false });
    this.spawnMover();
    this.hintT = 99;
  }

  /** Screen-fixed hall: brand green, back wall, stage rig. Baked. */
  private paintBackground(ctx: CanvasRenderingContext2D, withLights: boolean) {
    brandBackdrop(ctx, W / 2, H * 0.28);
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgba(2,20,9,0.35)");
    shade.addColorStop(0.5, "rgba(2,20,9,0.1)");
    shade.addColorStop(1, "rgba(2,20,9,0.5)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
    vignette(ctx, 0.5);
    if (withLights) drawCones(ctx, this.sprites.lights, 0, 0.3, "stage", 0, RIG_Y, 0.7);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.sprites.lights.rig.canvas, 0, RIG_Y);
  }

  /** Tileable warehouse racking stocked with multipacks; two depths for parallax. */
  private paintRacking(ctx: CanvasRenderingContext2D, scale: number, light: number, seed: number) {
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const mp = this.sprites.multipack;
    const bay = 300 * scale;
    const level = 300 * scale;
    // Racks only at the sides: the tower's column stays clean.
    const xs = scale < 1 ? [-40, 230, W - 230 - bay + 40, W - bay + 40] : [-bay * 0.55, W - bay * 0.45];
    for (const x0 of xs) {
      for (let y = 0; y < H; y += level) {
        if (mp && rnd() > 0.2) {
          const mw = bay * 0.82;
          const mh = (mp.naturalHeight / mp.naturalWidth) * mw;
          ctx.filter = `brightness(${light}) saturate(0.8)${scale < 1 ? " blur(1.5px)" : ""}`;
          ctx.drawImage(mp, x0 + bay * 0.08, y + level - mh - 6, mw, mh);
          ctx.filter = "none";
        }
        ctx.fillStyle = `rgba(${scale < 1 ? "150,40,30" : "190,50,35"},${0.35 * light + 0.2})`;
        ctx.fillRect(x0, y + level - 8, bay, 8);
      }
      ctx.fillStyle = `rgba(30,60,45,${0.5 + light * 0.3})`;
      ctx.fillRect(x0, 0, 10 * scale, H);
      ctx.fillRect(x0 + bay - 10 * scale, 0, 10 * scale, H);
    }
    // Atmospheric haze toward the far layer.
    ctx.fillStyle = `rgba(6,45,22,${scale < 1 ? 0.45 : 0.15})`;
    ctx.fillRect(0, 0, W, H);
  }

  private chip(n: number) {
    let c = this.chips.get(n);
    if (!c) this.chips.set(n, (c = makeChip(`x${n}`, this.font)));
    return c;
  }

  setQuality(q: Quality) {
    this.q = q;
    this.particles.limit = q.particles;
    if (!q.extras && !this.bgLow) this.bgLow = makeSprite(W, H, (ctx) => this.paintBackground(ctx, true));
  }

  get finished() {
    return this.done;
  }

  result(): CrateResult {
    return { game: "crate", score: this.score, stats: { ...this.stats }, elapsedMs: Math.round(this.elapsed * 1000) };
  }

  pointer(type: "down" | "move" | "up") {
    if (type !== "down" || this.dropping || this.outro > 0) return;
    this.idle = 0;
    this.dropping = true;
    this.dropY = 0;
    this.dropV = 900;
    this.hintT = Math.min(this.hintT, 0.3);
    audio.play("drop", 1, 0.8, ((this.mover.x + this.mover.w / 2) / W - 0.5) * 0.8);
  }

  /** QA/balance bot. `skill` 0-1: timing error and reaction scatter, as a human's. */
  skill = 0.75;
  private botAim: number | null = null;
  autopilot() {
    if (this.dropping || this.outro > 0 || this.elapsed < 0.4) return;
    const top = this.stack[this.stack.length - 1];
    // Timing error in px grows with crate speed (harder stages) and shrinks with skill.
    if (this.botAim === null) {
      const err = (5 + 43 * (1 - this.skill) ** 1.6) * (0.6 + this.speed / 900) * (this.stage.motion === "crane" || this.stage.motion === "surge" ? 1.4 : 1);
      this.botAim = rand(-err, err) + rand(-err, err) * 0.5;
    }
    if (Math.abs(this.mover.x - (top.x + this.botAim)) < Math.max(3, this.speed / 120)) {
      this.botAim = null;
      this.pointer("down");
    }
  }

  private get level() {
    return this.stack.length;
  }
  private get stage(): CrateStage {
    return CRATE_STAGES[this.stageIdx];
  }
  private yOf(level: number) {
    return GROUND_Y - level * this.crateH;
  }
  private get speed() {
    const c = this.cfg;
    return Math.min(c.maxSpeed, c.startSpeed + (this.level - 1) * c.speedPerLevel) * this.stage.speed;
  }
  private get tolerance() {
    return this.cfg.perfectTolerance * this.stage.tolerance;
  }

  private spawnMover() {
    const top = this.stack[this.stack.length - 1];
    this.dir = this.level % 2 ? 1 : -1;
    const golden = this.stage.golden && Math.random() < this.cfg.goldenChance;
    this.mover = { w: top.w, x: this.dir > 0 ? MIN_X : MAX_X - top.w, u0: top.u0, u1: top.u1, golden };
    this.motionT = this.dir > 0 ? 0 : 1;
    this.surgeK = 1;
    this.surgeT = 0;
    this.dropping = false;
    if (golden) {
      audio.play("goldCrate");
      this.popups.show(this.labels.goldCrate, W / 2, SLOT_MULT, P.gold, 72, 1, 30);
    }
  }

  // ---------------- simulation ----------------

  update(dt: number) {
    this.landT = Math.max(0, this.landT - dt);
    this.perfectT = Math.max(0, this.perfectT - dt);
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.hintT = Math.max(0, this.hintT - dt);
    this.meter.t = Math.max(0, this.meter.t - dt);
    this.shown += (this.score - this.shown) * damp(10, dt);
    if (Math.abs(this.score - this.shown) < 0.5) this.shown = this.score;

    // Damped spring sway
    this.wobV += (-90 * this.wob - 7 * this.wobV) * dt;
    this.wob += this.wobV * dt;
    this.kickV += (-260 * this.kick - 20 * this.kickV) * dt;
    this.kick += this.kickV * dt;
    this.scoreBump = Math.max(0, this.scoreBump - dt * 2.2);
    this.multPop = Math.max(0, this.multPop - dt * 2);
    this.zoomPulse = Math.max(0, this.zoomPulse - dt * 2.5);
    this.juice.update(dt);

    for (const d of this.debris) {
      if (!d.on) continue;
      d.vy += 2400 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.vrot * dt;
      // The failed crate hits the floor: the run ends on an impact, not a cut.
      if (d.fatal && !this.impactDone && d.y + this.crateH > GROUND_Y) {
        this.impactDone = true;
        audio.play("topple");
        this.shakeT = this.q.shake ? 0.45 : 0;
        const [sx, sy] = this.toScreen(d.x + d.w / 2, GROUND_Y);
        this.particles.burst(sx, sy, 26, 9, 520, { life: 0.9, up: 220, gravity: 300 });
        this.particles.burst(sx, sy, 12, 5, 300, { life: 0.6, size: 1.3, gravity: -60 });
        d.vy = -d.vy * 0.25;
        d.vx *= 0.4;
        d.vrot *= 0.4;
      }
      if (d.y > GROUND_Y + 600) d.on = false;
    }
    this.particles.update(dt);
    this.popups.update(dt);

    // Camera: zoom out with height; keep the floor pinned until the mover needs the room.
    const z = lerp(1, CRATE.zoomMin, clamp(this.stats.height / CRATE.zoomFullAt, 0, 1));
    this.zoom += (z - this.zoom) * damp(3, dt);
    const moverY = this.yOf(this.level) - HOVER;
    this.cam += (Math.max(GROUND_Y / this.zoom - GROUND_Y, MOVER_SCREEN_Y / this.zoom - moverY) - this.cam) * damp(5, dt);

    if (this.outro > 0) {
      this.outro -= dt;
      if (!this.bonusShown && this.outro < OUTRO_S - 1.1) {
        this.bonusShown = true;
        if (this.stats.height > 0 && this.cfg.heightBonus > 0) {
          const bonus = this.stats.height * this.cfg.heightBonus;
          this.score += bonus;
          this.popups.show(`${this.labels.height} +${bonus}`, W / 2, 1000, P.gold, 84, 1.4, 80);
          audio.play("milestone");
        }
      }
      if (this.outro <= 0) this.done = true;
      return;
    }

    this.elapsed += dt;
    this.idle += dt;
    // Adaptive music: multiplier, tower height, instability and late stages raise the energy.
    const multFrac = (this.mult - 1) / Math.max(1, this.cfg.maxMultiplier - 1);
    audio.intensity(Math.max(multFrac, clamp((this.stats.height - 4) / 20, 0, 1), this.unstable ? 0.7 : 0, this.stageIdx >= 4 ? 0.85 : 0));
    if (this.cfg.maxDurationSec > 0 && this.elapsed >= this.cfg.maxDurationSec) return this.gameOver(this.labels.timeUp);
    if (this.idle > IDLE_END_S) return this.gameOver(this.labels.gameOver);

    if (this.dropping) {
      this.dropV += 5200 * dt;
      this.dropY += this.dropV * dt;
      this.swing *= 1 - damp(14, dt);
      if (this.dropY >= HOVER) this.land();
      return;
    }
    this.move(dt);
  }

  private move(dt: number) {
    const m = this.mover;
    const span = MAX_X - m.w - MIN_X;
    const sp = this.speed;
    switch (this.stage.motion) {
      case "pingpong":
      case "surge": {
        if (this.stage.motion === "surge") {
          this.surgeT -= dt;
          if (this.surgeT <= 0) {
            this.surgeT = CRATE.surgeEvery * rand(0.7, 1.3);
            this.surgeK = 1 + rand(-CRATE.surge, CRATE.surge);
          }
        }
        m.x += this.dir * sp * this.surgeK * dt;
        if (m.x <= MIN_X) {
          m.x = MIN_X;
          this.dir = 1;
          audio.play("slide", 1, 0.7, -0.6);
        } else if (m.x >= MIN_X + span) {
          m.x = MIN_X + span;
          this.dir = -1;
          audio.play("slide", 1, 0.7, 0.6);
        }
        break;
      }
      case "eased": {
        // Same average speed as ping-pong, but sinusoidal: quick through the middle,
        // lingering at the ends. Linear timing habits stop working.
        this.motionT += (this.dir * sp * dt) / Math.max(1, span);
        if (this.motionT >= 1 || this.motionT <= 0) {
          this.motionT = clamp(this.motionT, 0, 1);
          this.dir = -this.dir;
          audio.play("slide", 1, 0.6, this.motionT > 0.5 ? 0.6 : -0.6);
        }
        m.x = MIN_X + span * (0.5 - 0.5 * Math.cos(Math.PI * this.motionT));
        break;
      }
      case "crane": {
        // Pendulum from a hook over the centre. Amplitude fits the crate on screen.
        const amp = Math.min(CRATE.craneAmp, span / 2);
        const period = CRATE.cranePeriod * (this.cfg.startSpeed / Math.max(1, sp)) ** 0.5 * 1.25;
        this.motionT += dt / period;
        const th = Math.sin(this.motionT * Math.PI * 2);
        m.x = MIN_X + span / 2 + amp * th;
        this.swing = Math.cos(this.motionT * Math.PI * 2) * 0.09;
        break;
      }
    }
  }

  private land() {
    const c = this.cfg;
    const prev = this.stack[this.stack.length - 1];
    const cur = this.mover;
    const offset = cur.x - prev.x;
    const left = Math.max(cur.x, prev.x);
    const right = Math.min(cur.x + cur.w, prev.x + prev.w);
    const overlap = right - left;
    const y = this.yOf(this.level);
    const tol = this.tolerance;

    if (overlap <= 0) {
      this.spawnDebris(cur.x, y, cur.w, offset > 0 ? 1 : -1, cur.u0, cur.u1, cur.golden, true);
      this.wobV += Math.sign(offset) * 10;
      this.meterShow(offset / cur.w, "off");
      audio.play("fall");
      return this.gameOver(this.labels.gameOver);
    }

    const grade: Grade = Math.abs(offset) <= tol ? "perfect" : Math.abs(offset) <= tol * CRATE.greatFactor ? "great" : overlap / cur.w >= 0.8 ? "good" : "off";
    const perfect = grade === "perfect";
    let placed: Crate;
    if (perfect) {
      placed = { ...prev, golden: cur.golden };
      this.combo++;
      this.streak++;
      this.stats.perfects++;
      const regrow = (this.combo % c.regrowAfter === 0 ? c.regrowAmount : 0) + (cur.golden ? c.regrowAmount : 0);
      if (regrow > 0 && placed.w < c.startWidth) {
        const grow = Math.min(regrow, c.startWidth - placed.w);
        // The photo slice widens with the crate, never past the full crate.
        const du = (grow / c.startWidth) * 0.5;
        placed.u0 = Math.max(0, placed.u0 - du);
        placed.u1 = Math.min(1, placed.u1 + du);
        const nw = (placed.u1 - placed.u0) * c.startWidth;
        placed.x = clamp(placed.x - (nw - placed.w) / 2, MIN_X, MAX_X - nw);
        placed.w = nw;
      }
    } else {
      // Keep the part of the photo that overlaps; the overhang's slice falls off.
      const span = cur.u1 - cur.u0;
      const uL = cur.u0 + ((left - cur.x) / cur.w) * span;
      const uR = cur.u0 + ((right - cur.x) / cur.w) * span;
      placed = { x: left, w: overlap, u0: uL, u1: uR, golden: cur.golden };
      const cutW = cur.w - overlap;
      if (offset > 0) this.spawnDebris(right, y, cutW, 1, uR, cur.u1, cur.golden);
      else this.spawnDebris(cur.x, y, cutW, -1, cur.u0, uL, cur.golden);
      if (grade === "great") this.stats.greats++;
      else {
        if (this.combo >= c.comboStep) this.popups.show(this.labels.comboLost, W / 2, SLOT_MULT, P.silver, 60, 0.9, 40);
        this.combo = 0;
        // Breaking precision costs one multiplier step, not everything.
        this.streak = Math.max(0, (this.mult - 2) * c.comboStep);
      }
      this.wobV += Math.sign(offset) * Math.min(1, Math.abs(offset) / prev.w) * 14;
      audio.play("slice", 1 + rand(-0.05, 0.05));
    }
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    this.stack.push(placed);
    this.stats.height++;
    this.meterShow(offset / cur.w, grade);

    const prevMult = this.mult;
    this.mult = Math.min(c.maxMultiplier, 1 + Math.floor(this.streak / c.comboStep));
    const accuracy = overlap / cur.w;
    const gradeBonus = perfect ? c.perfectBonus : grade === "great" ? Math.round(c.perfectBonus * 0.4) : 0;
    let pts = (c.placePoints + Math.round(accuracy * c.accuracyBonus) + gradeBonus) * this.mult;
    if (perfect && cur.golden) {
      this.stats.goldens++;
      pts += c.goldenBonus * this.mult;
    }
    this.score += pts;
    this.landT = 0.18;
    const [sx, sy] = this.toScreen(placed.x + placed.w / 2, y - this.crateH);
    const [, floorY] = this.toScreen(0, y);
    const pan = (sx / W - 0.5) * 0.8;
    audio.play(perfect ? "perfect" : grade === "great" ? "great" : "land", perfect ? Math.min(2, 1 + (this.combo - 1) * 0.06) : 1 + rand(-0.03, 0.03), 1, pan);
    // Dust kicks out from under both corners; the camera dips with the impact.
    for (const cx of [placed.x + 8, placed.x + placed.w - 8]) {
      const [dx] = this.toScreen(cx, y);
      this.particles.burst(dx, floorY - 4, 4, 5, 240, { life: 0.45, size: 0.8, gravity: -80, up: 60 });
    }
    if (this.q.shake) this.kickV += perfect ? 420 : 240;
    this.juice.fly(this.sprites.particles[perfect ? 7 : 5], sx, sy, SCORE_AT.x, SCORE_AT.y, perfect ? 1.3 : 0.9, 0.42, () => (this.scoreBump = 1));

    const gradeText = perfect ? (this.combo > 1 ? `${this.labels.perfect} x${this.combo}` : this.labels.perfect) : grade === "great" ? this.labels.great : grade === "good" ? this.labels.good : this.labels.sloppy;
    const gradeColor = perfect ? P.gold : grade === "great" ? P.bright : grade === "good" ? P.cream : P.silver;
    this.popups.show(gradeText, W / 2, SLOT_GRADE, gradeColor, perfect ? 100 : 76, 0.9, 40);
    if (perfect) {
      this.perfectT = 0.45;
      this.zoomPulse = this.q.shake ? 1 : 0;
      this.flashT = this.q.shake ? 0.1 : 0;
      this.particles.burst(sx, sy, 26, 7, 820, { life: 0.8, up: 380 });
      this.particles.burst(sx, sy, 14, 2, 520, { life: 0.6, size: 1.2 });
      this.juice.ring(this.sprites.glowGold, sx, floorY, 2.2, 0.5, 0.75);
      this.juice.ring(this.sprites.ring, sx, floorY, 2.4, 0.45, 0.6);
      if (cur.golden) {
        this.particles.burst(sx, sy, 30, 1, 900, { life: 1, size: 1.4, up: 300 });
        this.popups.show(`+${c.goldenBonus * this.mult}`, sx, sy - 80, P.gold, 90, 1.1, 120);
        audio.play("golden", 0.9, 1, pan);
      }
    } else {
      this.particles.burst(sx, sy + this.crateH * this.zoom - 6, 8, 5, 300, { life: 0.4, gravity: 600 });
    }
    if (this.mult > prevMult) {
      this.multPop = 1;
      this.popups.show(`${this.labels.combo} x${this.mult}`, W / 2, SLOT_MULT, P.bright, 96, 1.1, 30);
      audio.play("combo", 1 + this.mult * 0.05);
    } else if (this.mult < prevMult) {
      this.popups.show(`x${this.mult}`, 550, 230, P.silver, 56, 0.8, 30);
    }
    // Instability is presentation only: narrow or leaning towers sway and warn once.
    const base = this.stack[0];
    const lean = Math.abs(placed.x + placed.w / 2 - (base.x + base.w / 2));
    const unstable = placed.w < c.startWidth * 0.38 || lean > c.startWidth * 0.5;
    if (unstable && !this.unstable) {
      this.popups.show(this.labels.unstable, W / 2, SLOT_MULT + 90, P.heat, 80, 1.1, 30);
      audio.play("unstable");
    }
    this.unstable = unstable;
    // Beside the stack, not on it: the next crate hovers right over the placed one.
    const px = sx + (placed.w * this.zoom) / 2 + 120 < W - 60 ? sx + (placed.w * this.zoom) / 2 + 90 : sx - (placed.w * this.zoom) / 2 - 90;
    this.popups.show(`+${pts}`, px, Math.max(700, sy + 20), P.cream, 58);

    if (placed.w < c.minWidth) {
      this.wobV += 18;
      return this.gameOver(this.labels.gameOver);
    }
    const st = crateStageAt(this.stats.height);
    if (st !== this.stageIdx) {
      this.stageIdx = st;
      this.banner = this.labels.stage(st + 1);
      this.bannerSub = this.labels.stageName(st + 1);
      this.bannerT = this.bannerDur = 1.5;
      audio.play("stage");
    } else if (this.stats.height % 10 === 0) {
      this.banner = String(this.stats.height);
      this.bannerSub = "";
      this.bannerT = this.bannerDur = 1.1;
      audio.play("milestone");
    }
    this.spawnMover();
  }

  private meterShow(off: number, grade: Grade) {
    this.meter = { off: clamp(off, -0.5, 0.5), grade, t: 1.6, tol: this.tolerance / Math.max(1, this.mover.w) };
  }

  /** World point to HUD (screen) coordinates under the current camera. */
  private toScreen(x: number, y: number): [number, number] {
    const z = this.zoom;
    return [(x + W / 2 / z - W / 2) * z, (y + this.cam) * z];
  }

  private spawnDebris(x: number, y: number, w: number, dir: number, u0 = 0, u1 = 1, golden = false, fatal = false) {
    const d = this.debris.find((d) => !d.on) ?? this.debris[0];
    d.on = true;
    d.x = x;
    d.y = y - this.crateH;
    d.u0 = u0;
    d.u1 = u1;
    d.w = w;
    d.vx = dir * rand(140, 260);
    d.vy = -rand(80, 200);
    d.rot = 0;
    d.vrot = dir * rand(2, 4);
    d.shade = this.level % 2;
    d.golden = golden;
    d.fatal = fatal;
  }

  private gameOver(text: string) {
    this.outro = OUTRO_S;
    this.banner = text;
    this.bannerSub = "";
    this.bannerT = this.bannerDur = OUTRO_S;
    this.shakeT = this.q.shake ? 0.4 : 0;
    this.combo = 0;
    audio.play("end");
  }

  // ---------------- rendering ----------------

  render(ctx: CanvasRenderingContext2D) {
    const baseS = view.s;
    const shake = this.shakeT > 0 ? this.shakeT * 30 : 0;

    // Layers 1-3: hall (baked), parallax racking, stage lights.
    resetView(ctx, true);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage((this.q.extras ? this.bg : (this.bgLow ?? this.bg)).canvas, 0, 0);
    const farOff = (this.cam * 0.25) % H;
    ctx.drawImage(this.far.canvas, 0, farOff - H);
    ctx.drawImage(this.far.canvas, 0, farOff);
    if (this.q.extras) {
      const midOff = (this.cam * 0.55) % H;
      ctx.drawImage(this.mid.canvas, 0, midOff - H);
      ctx.drawImage(this.mid.canvas, 0, midOff);
      const multFrac = (this.mult - 1) / Math.max(1, this.cfg.maxMultiplier - 1);
      const energy = Math.max(multFrac, this.stageIdx / (CRATE_STAGES.length - 1));
      drawCones(ctx, this.sprites.lights, this.elapsed, energy, this.stageIdx >= CRATE_STAGES.length - 1 ? "red" : "gold", this.perfectT > 0 ? 1 : this.stageIdx >= CRATE_STAGES.length - 1 ? 0.8 : 0, RIG_Y);
      resetView(ctx, true);
      ctx.drawImage(this.sprites.lights.rig.canvas, 0, RIG_Y);
    }

    // World camera follows the stack; in the outro it eases out to frame the whole tower
    // (ground pinned near the screen bottom, horizontal centre fixed).
    let z = this.zoom;
    let oy = this.cam;
    if (this.outro > 0) {
      const blend = easeOutCubic(clamp((OUTRO_S - this.outro - 0.5) / 1.1, 0, 1));
      const span = GROUND_Y + 160 - (this.yOf(this.level) - this.crateTop - 60);
      const zt = clamp(1450 / span, 0.16, 1);
      oy = lerp(this.cam, 1780 / zt - (GROUND_Y + 160), blend);
      z = lerp(this.zoom, zt, blend);
    }
    z *= 1 + 0.025 * Math.sin(this.zoomPulse * Math.PI);
    view.s = baseS * z;
    view.ox = W / 2 / z - W / 2 + (shake ? rand(-shake, shake) : 0);
    view.oy = oy + this.kick * 0.04 + (shake ? rand(-shake, shake) : 0);

    this.renderHeightMarks(ctx, z);
    this.renderGround(ctx);

    const n = this.stack.length;
    const from = Math.max(0, n - Math.ceil(H / (this.crateH * z)) - 3);
    for (let i = from; i < n; i++) {
      const c = this.stack[i];
      // Sway grows toward the top of the stack.
      const k = n > 1 ? ((i - from) / Math.max(1, n - 1 - from)) ** 2 : 0;
      const tremble = this.unstable && this.outro <= 0 ? Math.sin(this.elapsed * 5.5) * 0.3 : 0;
      const sway = (this.wob + tremble) * 26 * k;
      const squash = i === n - 1 && this.landT > 0 ? Math.sin((this.landT / 0.18) * Math.PI) * 0.08 : 0;
      if (i > 0) {
        // Contact shadow on the crate below, only where they overlap.
        const below = this.stack[i - 1];
        const l = Math.max(c.x, below.x) + sway;
        const r = Math.min(c.x + c.w, below.x + below.w) + sway;
        if (r > l) ctx.drawImage(this.ao.canvas, l, this.yOf(i), r - l, 26);
      }
      this.drawCrate(ctx, c.x + sway, this.yOf(i), c.w, i === n - 1, i % 2, squash, c);
      if (i === n - 1 && this.perfectT > 0) {
        ctx.globalAlpha = this.perfectT / 0.45;
        resetView(ctx);
        ctx.strokeStyle = P.gold;
        ctx.lineWidth = 6;
        ctx.strokeRect(c.x + sway - 6, this.yOf(i) - this.crateH - 6, c.w + 12, this.crateH + 12);
        ctx.globalAlpha = 1;
      }
    }

    if (this.outro <= 0) this.renderMover(ctx);

    for (const d of this.debris) {
      if (!d.on) continue;
      place(ctx, d.x + d.w / 2, d.y + this.crateH / 2, 1, d.rot);
      if (this.img) this.drawPhoto(ctx, -d.w / 2, this.crateH / 2, d.w, d.u0, d.u1, 0, d.golden);
      else this.drawCrateLocal(ctx, -d.w / 2, -CRATE_H / 2, d.w, d.shade);
    }

    view.s = baseS;
    view.ox = 0;
    view.oy = 0;
    if (this.q.extras) ctx.globalCompositeOperation = "lighter";
    this.particles.render(ctx);
    ctx.globalCompositeOperation = "lighter";
    this.juice.render(ctx);
    ctx.globalCompositeOperation = "source-over";
    this.popups.render(ctx);
    this.renderHud(ctx);
  }

  private renderMover(ctx: CanvasRenderingContext2D) {
    const m = this.mover;
    const y = this.yOf(this.level) - HOVER + (this.dropping ? this.dropY : 0);
    // Drop guide: faint column showing where the crate will land, and its shadow on the stack.
    resetView(ctx);
    ctx.fillStyle = m.golden ? "rgba(255,201,74,0.08)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(m.x, y, m.w, this.yOf(this.level) - y);
    ctx.globalAlpha = this.dropping ? 0.5 + 0.5 * (this.dropY / HOVER) : 0.45;
    ctx.drawImage(this.ao.canvas, m.x, this.yOf(this.level), m.w, 26);
    ctx.globalAlpha = 1;
    if (this.stage.motion === "crane" && !this.dropping) {
      // Rope from the hook overhead down to the crate's lifting point.
      const topY = y - this.crateH - this.crateTop - 520;
      const hx = MIN_X + (MAX_X - m.w - MIN_X) / 2 + m.w / 2;
      resetView(ctx);
      ctx.strokeStyle = "rgba(200,210,205,0.75)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hx, topY);
      ctx.lineTo(m.x + m.w / 2, y - this.crateH - this.crateTop - 4);
      ctx.stroke();
      ctx.fillStyle = "#c9cfcb";
      ctx.fillRect(m.x + m.w / 2 - 10, y - this.crateH - this.crateTop - 18, 20, 16);
    }
    if (m.golden && this.q.extras) {
      const gg = this.sprites.glowGold;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.45 + 0.2 * Math.sin(this.elapsed * 8);
      place(ctx, m.x + m.w / 2, y - this.crateH / 2, (m.w / gg.w) * 1.6);
      ctx.drawImage(gg.canvas, -gg.cx, -gg.cy);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    if (this.swing) {
      // Swinging crate tilts about its lifting point (render-only; lands square).
      const px = m.x + m.w / 2;
      const py = y - this.crateH - this.crateTop;
      place(ctx, px, py, 1, this.swing);
      if (this.img) this.drawPhoto(ctx, -m.w / 2, this.crateH + this.crateTop, m.w, m.u0, m.u1, 0, m.golden);
      else this.drawCrateLocal(ctx, -m.w / 2, this.crateTop, m.w, 0);
      return;
    }
    this.drawCrate(ctx, m.x, y, m.w, true, this.level % 2, 0, m);
  }

  /** Photo crate whose front face bottom is at y; the open top sits above the face. */
  private drawPhoto(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, u0: number, u1: number, squash: number, golden = false) {
    const img = golden && this.goldImg ? this.goldImg : this.img!;
    const iw = img.width;
    const fullH = (this.crateH + this.crateTop) * (1 - squash);
    ctx.drawImage(img, u0 * iw, 0, Math.max(1, (u1 - u0) * iw), img.height, x, y - fullH, w, fullH);
  }

  /** Crate whose front face spans y-crateH..y in world space. */
  private drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, top: boolean, shade: number, squash: number, c?: Crate) {
    if (this.img) {
      resetView(ctx);
      this.drawPhoto(ctx, x, y, w, c?.u0 ?? 0, c?.u1 ?? 1, squash, c?.golden);
      return;
    }
    const h = CRATE_H * (1 - squash);
    const fy = y - h;
    resetView(ctx);
    // Side face (right) then top face: oblique projection, solid fills, no gradients.
    ctx.fillStyle = shade ? "#08401a" : "#0a4a1d";
    ctx.beginPath();
    ctx.moveTo(x + w, fy);
    ctx.lineTo(x + w + DX, fy - DY);
    ctx.lineTo(x + w + DX, y - DY);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    if (top) {
      ctx.fillStyle = shade ? "#2c9b3b" : "#33a843";
      ctx.beginPath();
      ctx.moveTo(x, fy);
      ctx.lineTo(x + DX, fy - DY);
      ctx.lineTo(x + w + DX, fy - DY);
      ctx.lineTo(x + w, fy);
      ctx.closePath();
      ctx.fill();
    }
    this.drawFront(ctx, x, fy, w, h, shade);
    if (c?.golden) {
      ctx.fillStyle = "rgba(255,201,74,0.45)";
      ctx.fillRect(x, fy, w, h);
    }
  }

  private drawFront(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shade: number) {
    ctx.drawImage(this.body.canvas, x, y, w, h);
    if (shade) {
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x, y, 6, h);
    ctx.fillRect(x + w - 6, y, 6, h);
    if (w > 120) ctx.drawImage(this.badge.canvas, x + w / 2 - 45, y + h / 2 - 26, 90, 60 * (h / CRATE_H));
  }

  private drawCrateLocal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, shade: number) {
    ctx.fillStyle = "#33a843";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + DX, y - DY);
    ctx.lineTo(x + w + DX, y - DY);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    this.drawFront(ctx, x, y, w, CRATE_H, shade);
  }

  private renderGround(ctx: CanvasRenderingContext2D) {
    resetView(ctx);
    const y = GROUND_Y;
    // Polished warehouse floor with a soft reflection pool under the tower.
    const g = ctx.createLinearGradient(0, y, 0, y + 500);
    g.addColorStop(0, "#1b4a2c");
    g.addColorStop(1, "#020d06");
    ctx.fillStyle = g;
    ctx.fillRect(-600, y, W + 1200, 2400);
    ctx.fillStyle = "rgba(220,255,225,0.28)";
    ctx.fillRect(-600, y, W + 1200, 3);
    // Floor markings: a safety line framing the stacking bay.
    ctx.fillStyle = "rgba(255,201,74,0.35)";
    ctx.fillRect(-600, y + 70, W + 1200, 6);
    const s = this.sprites.shadow;
    const base = this.stack[0];
    ctx.globalAlpha = 0.85;
    ctx.drawImage(s.canvas, base.x - 70, y - 22, base.w + 180, 56);
    ctx.globalAlpha = 1;
    const p = this.pallet;
    ctx.drawImage(p.canvas, base.x + base.w / 2 - p.w / 2, y - 6, p.w, p.h);
  }

  private renderHeightMarks(ctx: CanvasRenderingContext2D, z: number) {
    resetView(ctx);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(30 / z)}px ${this.font}`;
    const top = Math.max(1, this.level - 20);
    for (let lvl = Math.ceil(top / 5) * 5; lvl <= this.level + 8; lvl += 5) {
      if (lvl <= 0) continue;
      const y = this.yOf(lvl);
      const stageEdge = CRATE_STAGES.some((s) => s.from === lvl);
      ctx.fillStyle = stageEdge ? "rgba(255,201,74,0.45)" : "rgba(201,207,203,0.18)";
      ctx.fillRect(W - 120, y, 90, stageEdge ? 4 : 2);
      ctx.fillStyle = "rgba(201,207,203,0.45)";
      ctx.fillText(String(lvl), W - 30, y - 22);
    }
  }

  private renderHud(ctx: CanvasRenderingContext2D) {
    resetView(ctx, true);
    if (this.flashT > 0) {
      ctx.globalAlpha = this.flashT * 2;
      ctx.fillStyle = P.gold;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    drawPlate(ctx, this.scorePlate, 40, 48, !this.q.extras);
    resetView(ctx, true);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = P.silver;
    ctx.font = `700 32px ${this.font}`;
    ctx.fillText(this.labels.score, 80, 100);
    drawNumber(ctx, this.font, String(Math.round(this.shown)), 76, 194, 100, this.scoreBump);
    if (this.mult > 1) {
      const chip = this.chip(this.mult);
      place(ctx, 550, 138, 1 + 0.35 * this.multPop * this.multPop);
      ctx.drawImage(chip.canvas, -chip.w / 2, -chip.h / 2);
    }
    // Height plate with the stage underneath.
    drawPlate(ctx, this.heightPlate, 720, 48, !this.q.extras);
    resetView(ctx, true);
    ctx.textAlign = "center";
    ctx.fillStyle = P.silver;
    ctx.font = `700 32px ${this.font}`;
    ctx.fillText(this.labels.height, 880, 100);
    drawNumber(ctx, this.font, String(this.stats.height), 880, 194, 100, this.landT > 0 ? this.landT / 0.18 : 0, "center");
    resetView(ctx, true);
    ctx.font = `800 26px ${this.font}`;
    ctx.fillStyle = this.stageIdx >= CRATE_STAGES.length - 1 ? "#ff6b5e" : P.gold;
    ctx.fillText(`${this.labels.stage(this.stageIdx + 1)} · ${this.labels.stageName(this.stageIdx + 1)}`, 880, 248);
    this.renderMeter(ctx);
    // Time cap warning in the last 10 s only: no clock pressure for normal runs.
    const cap = this.cfg.maxDurationSec;
    if (cap > 0 && this.outro <= 0 && cap - this.elapsed < 10) {
      ctx.textAlign = "center";
      ctx.fillStyle = P.starRed;
      ctx.font = `800 56px ${this.font}`;
      ctx.fillText(String(Math.ceil(cap - this.elapsed)), W / 2, 420);
    }
    // Perfect streak pips under the score.
    if (this.combo > 0 && this.outro <= 0) {
      const n = Math.min(this.combo, 12);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = P.gold;
        starPath(ctx, 80 + i * 40, 252, 14);
        ctx.fill();
      }
    }
    if (this.bannerT > 0) {
      const intro = clamp((this.bannerDur - this.bannerT) / 0.2, 0, 1);
      ctx.globalAlpha = Math.min(1, this.bannerT / 0.25);
      place(ctx, W / 2, this.outro > 0 ? 560 : SLOT_BANNER, lerp(0.6, 1, easeOutCubic(intro)));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${this.bannerSub ? 112 : 128}px ${this.font}`;
      ctx.lineWidth = 18;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(3,19,10,0.85)";
      ctx.strokeText(this.banner, 0, 0);
      ctx.fillStyle = P.cream;
      ctx.fillText(this.banner, 0, 0);
      if (this.bannerSub) {
        ctx.font = `800 56px ${this.font}`;
        ctx.lineWidth = 12;
        ctx.strokeText(this.bannerSub, 0, 92);
        ctx.fillStyle = P.gold;
        ctx.fillText(this.bannerSub, 0, 92);
      }
      ctx.globalAlpha = 1;
    }
    if (this.hintT > 0 && this.stats.height === 0) {
      // Pulsing "tap to drop" until the first drop: no instructions screen required.
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.elapsed * 6);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 64px ${this.font}`;
      ctx.fillStyle = P.cream;
      ctx.fillText(this.labels.tapToDrop, W / 2, 1820);
      ctx.globalAlpha = 1;
    }
  }

  /** Precision meter: where the last crate landed relative to the one below. */
  private renderMeter(ctx: CanvasRenderingContext2D) {
    const m = this.meter;
    if (m.t <= 0) return;
    resetView(ctx, true);
    ctx.globalAlpha = Math.min(1, m.t * 2);
    const { x, y, w } = METER;
    const half = w / 2;
    // Scale: ±50% of the crate width across the bar; zones from the current tolerances.
    const zone = (frac: number) => Math.min(half, frac * 2 * half);
    ctx.fillStyle = "rgba(3,19,10,0.7)";
    ctx.fillRect(x - half - 6, y - 14, w + 12, 28);
    ctx.fillStyle = "rgba(201,207,203,0.25)";
    ctx.fillRect(x - half, y - 8, w, 16);
    const great = zone(m.tol * CRATE.greatFactor);
    ctx.fillStyle = "rgba(18,164,21,0.85)";
    ctx.fillRect(x - great, y - 8, great * 2, 16);
    const perfect = Math.max(3, zone(m.tol));
    ctx.fillStyle = P.gold;
    ctx.fillRect(x - perfect, y - 8, perfect * 2, 16);
    const mx = x + m.off * 2 * half;
    ctx.fillStyle = m.grade === "perfect" ? P.cream : m.grade === "off" ? P.starRed : P.cream;
    ctx.beginPath();
    ctx.moveTo(mx, y + 10);
    ctx.lineTo(mx - 12, y + 26);
    ctx.lineTo(mx + 12, y + 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(mx - 2, y - 14, 4, 28);
    ctx.globalAlpha = 1;
  }
}
