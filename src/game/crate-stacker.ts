import type { CrateConfig } from "@/lib/config";
import type { CrateStats } from "@/lib/session";
import { audio } from "./engine/audio";
import { drawNumber, drawPlate, Juice, makeChip, makePlate } from "./engine/hud";
import { clamp, damp, easeOutCubic, H, lerp, place, rand, resetView, view, W } from "./engine/math";
import { PALETTE as P } from "./engine/palette";
import { Particles } from "./engine/particles";
import { Popups } from "./engine/popups";
import type { Game, Quality } from "./engine/runner";
import { CRATE_RIM } from "./engine/brand-assets";
import { beams, bokeh, brandBackdrop, makeSprite, type SharedSprites, type Sprite, starPath, vignette } from "./engine/sprites";
import type { CrateResult, GameLabels } from "./types";

/*
 * CRATE STACKER
 * A crate slides across above the stack; tap to drop it. Whatever overhangs is sliced
 * off and falls, so the stack narrows with every imprecise drop: width is the resource
 * and failure explains itself. A drop within the tolerance is PERFECT: no width lost,
 * streak grows, multiplier climbs, and every few perfects the crate regains width.
 * Speed rises with height. Placement is deterministic (no physics engine): sway after a
 * sloppy drop is a damped spring that only affects rendering, never the outcome.
 */

const CRATE_H = 96;
const DX = 34; // oblique depth: top face shifts right…
const DY = 30; // …and up
const GROUND_Y = 1660;
const HOVER = 70;
const MOVER_SCREEN_Y = 940;
// Feedback text lives in fixed slots between the HUD and the hovering crate, never on it.
const SLOT_PERFECT = 330;
const SLOT_MULT = 440;
const SLOT_BANNER = 430;
const MIN_X = 70;
const MAX_X = W - 70 - DX;
const OUTRO_S = 2.4;
const IDLE_END_S = 15;
const SCORE_AT = { x: 170, y: 160 };

/** u0..u1: which horizontal slice of the crate photo this crate shows (slicing cuts the photo). */
type Crate = { x: number; w: number; u0: number; u1: number };
type Debris = { on: boolean; x: number; y: number; w: number; vx: number; vy: number; rot: number; vrot: number; shade: number; u0: number; u1: number };

export class CrateStacker implements Game<CrateResult> {
  private stack: Crate[] = [];
  private mover: Crate = { x: 0, w: 0, u0: 0, u1: 1 };
  private dir = 1;
  private dropping = false;
  private dropY = 0;
  private dropV = 0;
  private debris: Debris[] = Array.from({ length: 6 }, () => ({ on: false, x: 0, y: 0, w: 0, vx: 0, vy: 0, rot: 0, vrot: 0, shade: 0, u0: 0, u1: 1 }));
  /** Official crate packshot when loaded; procedural crate otherwise. */
  /** Crate photo pre-scaled to its on-screen width (no per-frame resampling of the 1000 px source). */
  private img: HTMLCanvasElement | null = null;
  /** Height of one stack level (the crate's front face) and of the open top above it. */
  private crateH = CRATE_H;
  private crateTop = DY;
  private particles: Particles;
  private popups: Popups;
  private bg: Sprite;
  private far: Sprite;
  private body: Sprite;
  private badge: Sprite;
  private q!: Quality;

  private elapsed = 0;
  private score = 0;
  private shown = 0;
  private combo = 0;
  private mult = 1;
  private stats: CrateStats = { height: 0, perfects: 0, bestCombo: 0 };
  private cam = 0;
  private wob = 0;
  private wobV = 0;
  private landT = 0;
  private perfectT = 0;
  private shakeT = 0;
  private flashT = 0;
  private bannerT = 0;
  private banner = "";
  private hintT = 0;
  private outro = 0;
  private done = false;
  private bonusShown = false;
  /** Seconds since the last tap: a walked-away player ends the run instead of blocking the kiosk. */
  private idle = 0;
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

  constructor(
    private cfg: CrateConfig,
    private sprites: SharedSprites,
    private font: string,
    private labels: GameLabels,
  ) {
    this.particles = new Particles(220, sprites.particles);
    this.popups = new Popups(12, font);
    this.bg = makeSprite(W, H, (ctx) => {
      brandBackdrop(ctx, W / 2, H * 0.3);
      beams(ctx, 4, 0.05);
      vignette(ctx, 0.45);
    });
    // Tileable far layer, scrolled at a fraction of camera speed for parallax.
    this.far = makeSprite(W, H, (ctx) => {
      bokeh(ctx, 22, H, 42);
      // Distant warehouse racking: tall uprights with cross-bracing, barely there.
      ctx.strokeStyle = "rgba(170,255,170,0.05)";
      ctx.lineWidth = 6;
      for (const x of [90, 300, 780, 990]) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      ctx.lineWidth = 3;
      for (const [a, b] of [[90, 300], [780, 990]])
        for (let y = 0; y < H; y += 320) {
          ctx.beginPath();
          ctx.moveTo(a, y);
          ctx.lineTo(b, y + 160);
          ctx.lineTo(a, y + 320);
          ctx.moveTo(a, y + 160);
          ctx.lineTo(b, y + 160);
          ctx.stroke();
        }
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      let s = 9;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 60; i++) ctx.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 2, 2 + rnd() * 2);
    });
    this.body = makeSprite(8, CRATE_H, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, CRATE_H);
      // Heineken crate green, moulded plastic: bright lip, darker body.
      g.addColorStop(0, "#3fb04a");
      g.addColorStop(0.1, "#16862f");
      g.addColorStop(1, "#0a5a22");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 8, CRATE_H);
      // Slat grooves
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
      this.img = makeSprite(Math.round(cfg.startWidth), Math.round(cfg.startWidth * aspect), (c) => {
        c.imageSmoothingQuality = "high";
        c.drawImage(photo, 0, 0, Math.round(cfg.startWidth), Math.round(cfg.startWidth * aspect));
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
    this.stack.push({ x: W / 2 - cfg.startWidth / 2 - (this.img ? 0 : DX / 2), w: cfg.startWidth, u0: 0, u1: 1 });
    this.spawnMover();
    this.hintT = 99;
  }

  private chip(n: number) {
    let c = this.chips.get(n);
    if (!c) this.chips.set(n, (c = makeChip(`x${n}`, this.font)));
    return c;
  }

  setQuality(q: Quality) {
    this.q = q;
    this.particles.limit = q.particles;
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

  private botAim = 0;
  autopilot() {
    if (this.dropping || this.outro > 0) return;
    const top = this.stack[this.stack.length - 1];
    // Aim error grows with height, so runs end on their own like a human's would.
    if (!this.botAim) this.botAim = rand(2, 10 + this.level * 2.5);
    if (Math.abs(this.mover.x - top.x) < this.botAim && this.elapsed > 0.4) {
      this.botAim = 0;
      this.pointer("down");
    }
  }

  private get level() {
    return this.stack.length;
  }
  private yOf(level: number) {
    return GROUND_Y - level * this.crateH;
  }
  private get speed() {
    const c = this.cfg;
    return Math.min(c.maxSpeed, c.startSpeed + (this.level - 1) * c.speedPerLevel);
  }

  private spawnMover() {
    const top = this.stack[this.stack.length - 1];
    this.dir = this.level % 2 ? 1 : -1;
    this.mover = { w: top.w, x: this.dir > 0 ? MIN_X : MAX_X - top.w, u0: top.u0, u1: top.u1 };
    this.dropping = false;
  }

  // ---------------- simulation ----------------

  update(dt: number) {
    this.landT = Math.max(0, this.landT - dt);
    this.perfectT = Math.max(0, this.perfectT - dt);
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.hintT = Math.max(0, this.hintT - dt);
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
      if (d.y > this.yOf(0) + H) d.on = false;
    }
    this.particles.update(dt);
    this.popups.update(dt);

    if (this.outro > 0) {
      this.outro -= dt;
      if (!this.bonusShown && this.outro < OUTRO_S - 0.9) {
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
    // Adaptive music: energy rises with the multiplier and the height of the tower.
    const multFrac = (this.mult - 1) / Math.max(1, this.cfg.maxMultiplier - 1);
    audio.intensity(Math.max(multFrac, clamp((this.stats.height - 4) / 20, 0, 1), this.unstable ? 0.7 : 0));
    if (this.cfg.maxDurationSec > 0 && this.elapsed >= this.cfg.maxDurationSec) return this.gameOver(this.labels.timeUp);
    if (this.idle > IDLE_END_S) return this.gameOver(this.labels.gameOver);

    const moverY = this.yOf(this.level) - HOVER;
    this.cam += (Math.max(0, MOVER_SCREEN_Y - moverY) - this.cam) * damp(5, dt);

    if (this.dropping) {
      this.dropV += 5200 * dt;
      this.dropY += this.dropV * dt;
      if (this.dropY >= HOVER) this.land();
      return;
    }
    const m = this.mover;
    m.x += this.dir * this.speed * dt;
    if (m.x <= MIN_X) {
      m.x = MIN_X;
      this.dir = 1;
      audio.play("slide", 1, 0.7, -0.6);
    } else if (m.x + m.w >= MAX_X) {
      m.x = MAX_X - m.w;
      this.dir = -1;
      audio.play("slide", 1, 0.7, 0.6);
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

    if (overlap <= 0) {
      this.spawnDebris(cur.x, y, cur.w, offset > 0 ? 1 : -1, cur.u0, cur.u1);
      audio.play("fall");
      return this.gameOver(this.labels.gameOver);
    }

    const perfect = Math.abs(offset) <= c.perfectTolerance;
    let placed: Crate;
    if (perfect) {
      placed = { ...prev };
      this.combo++;
      this.stats.perfects++;
      if (this.combo % c.regrowAfter === 0 && placed.w < c.startWidth) {
        const grow = Math.min(c.regrowAmount, c.startWidth - placed.w);
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
      placed = { x: left, w: overlap, u0: uL, u1: uR };
      const cutW = cur.w - overlap;
      if (offset > 0) this.spawnDebris(right, y, cutW, 1, uR, cur.u1);
      else this.spawnDebris(cur.x, y, cutW, -1, cur.u0, uL);
      if (this.combo >= c.comboStep) this.popups.show(this.labels.comboLost, W / 2, SLOT_PERFECT, P.silver, 60, 0.9, 40);
      this.combo = 0;
      this.wobV += Math.sign(offset) * Math.min(1, Math.abs(offset) / prev.w) * 14;
      audio.play("slice", 1 + rand(-0.05, 0.05));
    }
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    this.stack.push(placed);
    this.stats.height++;

    const accuracy = overlap / cur.w;
    this.mult = Math.min(c.maxMultiplier, 1 + Math.floor(this.combo / c.comboStep));
    const pts = (c.placePoints + Math.round(accuracy * c.accuracyBonus) + (perfect ? c.perfectBonus : 0)) * this.mult;
    this.score += pts;
    this.landT = 0.18;
    // Effects render in screen space: world y + camera offset.
    const sx = placed.x + placed.w / 2;
    const sy = y - this.crateH + this.cam;
    const pan = (sx / W - 0.5) * 0.8;
    audio.play("land", 1 + Math.min(this.level, 30) * 0.004 + rand(-0.03, 0.03), 1, pan);
    // Dust kicks out from under both corners; the camera dips with the impact.
    for (const cx of [placed.x + 8, placed.x + placed.w - 8]) this.particles.burst(cx, y + this.cam - 4, 4, 5, 240, { life: 0.45, size: 0.8, gravity: -80, up: 60 });
    if (this.q.shake) this.kickV += perfect ? 420 : 240;
    this.juice.fly(this.sprites.particles[perfect ? 7 : 5], sx, sy, SCORE_AT.x, SCORE_AT.y, perfect ? 1.3 : 0.9, 0.42, () => (this.scoreBump = 1));

    if (perfect) {
      this.perfectT = 0.45;
      this.zoomPulse = this.q.shake ? 1 : 0;
      this.flashT = this.q.shake ? 0.1 : 0;
      audio.play("perfect", Math.min(2, 1 + (this.combo - 1) * 0.06), 1, pan);
      this.particles.burst(sx, sy, 26, 7, 820, { life: 0.8, up: 380 });
      this.particles.burst(sx, sy, 14, 2, 520, { life: 0.6, size: 1.2 });
      this.juice.ring(this.sprites.glowGold, sx, y + this.cam, 2.2, 0.5, 0.75);
      this.juice.ring(this.sprites.ring, sx, y + this.cam, 2.4, 0.45, 0.6);
      this.popups.show(this.combo > 1 ? `${this.labels.perfect} x${this.combo}` : this.labels.perfect, W / 2, SLOT_PERFECT, P.gold, 100, 0.9, 40);
      if (this.combo % c.comboStep === 0 && this.mult > 1) {
        this.multPop = 1;
        this.popups.show(`${this.labels.combo} x${this.mult}`, W / 2, SLOT_MULT, P.bright, 96, 1.1, 30);
        audio.play("combo", 1 + this.mult * 0.05);
      }
    } else {
      this.particles.burst(sx, sy + this.crateH - 6, 8, 5, 300, { life: 0.4, gravity: 600 });
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
    const px = placed.x + placed.w + DX + 90 < W - 60 ? placed.x + placed.w + DX + 90 : placed.x - 90;
    this.popups.show(`+${pts}`, px, Math.max(320, sy + 20), P.cream, 58);

    if (placed.w < c.minWidth) return this.gameOver(this.labels.gameOver);
    if (this.level % 10 === 1 && this.level > 1) {
      this.banner = String(this.level - 1);
      this.bannerT = 1.1;
      audio.play("milestone");
    }
    this.spawnMover();
  }

  private spawnDebris(x: number, y: number, w: number, dir: number, u0 = 0, u1 = 1) {
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
  }

  private gameOver(text: string) {
    this.outro = OUTRO_S;
    this.banner = text;
    this.bannerT = OUTRO_S;
    this.shakeT = this.q.shake ? 0.4 : 0;
    this.combo = 0;
    audio.play("end");
  }

  // ---------------- rendering ----------------

  render(ctx: CanvasRenderingContext2D) {
    const baseS = view.s;
    const shake = this.shakeT > 0 ? this.shakeT * 30 : 0;

    resetView(ctx, true);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.bg.canvas, 0, 0);
    // Parallax far layer at 30% camera speed, tiled vertically.
    const off = (this.cam * 0.3) % H;
    // Parallax layer only when the device has headroom: two extra full-screen blits.
    if (this.q.extras) {
      ctx.drawImage(this.far.canvas, 0, off - H);
      ctx.drawImage(this.far.canvas, 0, off);
    }

    // World camera follows the stack; in the outro it eases out to frame the whole tower
    // (ground pinned near the screen bottom, horizontal centre fixed).
    let z = 1;
    let oy = this.cam;
    if (this.outro > 0) {
      const blend = easeOutCubic(clamp((OUTRO_S - this.outro) / 1.1, 0, 1));
      const span = GROUND_Y + 160 - (this.yOf(this.level) - this.crateTop - 60);
      z = lerp(1, clamp(1450 / span, 0.16, 1), blend);
      oy = lerp(this.cam, 1780 / z - (GROUND_Y + 160), blend);
    }
    z *= 1 + 0.025 * Math.sin(this.zoomPulse * Math.PI);
    view.s = baseS * z;
    view.ox = W / 2 / z - W / 2 + (shake ? rand(-shake, shake) : 0);
    view.oy = oy + this.kick * 0.04 + (shake ? rand(-shake, shake) : 0);

    this.renderHeightMarks(ctx);
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

    if (this.outro <= 0) {
      const y = this.yOf(this.level) - HOVER + (this.dropping ? this.dropY : 0);
      // Drop guide: faint column showing where the crate will land, and its shadow on the stack.
      resetView(ctx);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(this.mover.x, y, this.mover.w, this.yOf(this.level) - y);
      ctx.globalAlpha = this.dropping ? 0.5 + 0.5 * (this.dropY / HOVER) : 0.45;
      ctx.drawImage(this.ao.canvas, this.mover.x, this.yOf(this.level), this.mover.w, 26);
      ctx.globalAlpha = 1;
      this.drawCrate(ctx, this.mover.x, y, this.mover.w, true, this.level % 2, 0, this.mover);
    }

    for (const d of this.debris) {
      if (!d.on) continue;
      place(ctx, d.x + d.w / 2, d.y + this.crateH / 2, 1, d.rot);
      if (this.img) this.drawPhoto(ctx, -d.w / 2, this.crateH / 2, d.w, d.u0, d.u1, 0);
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

  /** Photo crate whose front face bottom is at y; the open top sits above the face. */
  private drawPhoto(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, u0: number, u1: number, squash: number) {
    const img = this.img!;
    const iw = img.width;
    const fullH = (this.crateH + this.crateTop) * (1 - squash);
    ctx.drawImage(img, u0 * iw, 0, Math.max(1, (u1 - u0) * iw), img.height, x, y - fullH, w, fullH);
  }

  /** Crate whose front face spans y-crateH..y in world space. */
  private drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, top: boolean, shade: number, squash: number, c?: Crate) {
    if (this.img) {
      resetView(ctx);
      this.drawPhoto(ctx, x, y, w, c?.u0 ?? 0, c?.u1 ?? 1, squash);
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
      // Bottle caps peeking out of the top crate: reads instantly as a beer crate.
      // Skipped on slivers (a negative ellipse radius throws).
      const cols = w >= 40 ? Math.max(1, Math.floor((w - 10) / 44)) : 0;
      const gap = (w - 10) / cols;
      for (let r = 0; r < 2; r++) {
        const ry = fy - DY * (0.3 + r * 0.42);
        const rx = x + 5 + DX * (0.3 + r * 0.42);
        for (let c = 0; c < cols; c++) {
          const cx = rx + gap * (c + 0.5);
          ctx.fillStyle = "#0b3d17";
          ctx.beginPath();
          ctx.ellipse(cx, ry + 2, gap * 0.36, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          // Heineken caps: silver crimp ring, green crown, red star dot.
          ctx.fillStyle = r ? "#b9c1bc" : "#dfe6e1";
          ctx.beginPath();
          ctx.ellipse(cx, ry, gap * 0.3, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#13873a";
          ctx.beginPath();
          ctx.ellipse(cx, ry - 0.5, gap * 0.22, 4.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = P.starRed;
          ctx.fillRect(cx - 2, ry - 2, 4, 3);
        }
      }
    }
    this.drawFront(ctx, x, fy, w, h, shade);
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
    // Hand-hold slots near the edges, emblem in the middle when there is room.
    if (w > 150) {
      ctx.fillStyle = "#05230d";
      ctx.beginPath();
      ctx.roundRect(x + 22, y + 12, 58, 14, 7);
      ctx.roundRect(x + w - 80, y + 12, 58, 14, 7);
      ctx.fill();
    }
    this.drawLabel(ctx, x, y, w, h);
  }

  /** Recessed label panel with the real white wordmark and red star (brand assets). */
  private drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const wm = this.sprites.wordmark;
    if (!wm) {
      if (w > 120) ctx.drawImage(this.badge.canvas, x + w / 2 - 45, y + h / 2 - 26, 90, 60 * (h / CRATE_H));
      return;
    }
    if (w < 70) return;
    const panelW = Math.min(w - 24, 380);
    const panelH = h * 0.5;
    const px = x + (w - panelW) / 2;
    const py = y + h * 0.36;
    ctx.fillStyle = "rgba(0,40,12,0.45)";
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(px + 8, py + panelH - 2, panelW - 16, 2);
    const star = this.sprites.redStar;
    const starH = panelH * 0.86;
    const starW = (star.w / star.h) * starH;
    const textH = panelH * 0.62;
    const textW = Math.min(panelW - starW - 24, (wm.w / wm.h) * textH);
    const th = (wm.h / wm.w) * textW;
    const total = (panelW > 160 ? starW + 8 : 0) + textW;
    let cx = px + (panelW - total) / 2;
    if (panelW > 160) {
      ctx.drawImage(star.canvas, cx, py + (panelH - starH) / 2, starW, starH);
      cx += starW + 8;
    }
    ctx.drawImage(wm.canvas, cx, py + (panelH - th) / 2, textW, th);
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
    // Pallet / platform the first crate sits on
    ctx.fillStyle = "#0d2a17";
    ctx.beginPath();
    ctx.moveTo(-200, y);
    ctx.lineTo(-200 + DX, y - DY);
    ctx.lineTo(W + 200 + DX, y - DY);
    ctx.lineTo(W + 200, y);
    ctx.closePath();
    ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + 400);
    g.addColorStop(0, "#14462a");
    g.addColorStop(1, "#020d06");
    ctx.fillStyle = g;
    ctx.fillRect(-400, y, W + 800, 2000);
    ctx.fillStyle = "rgba(160,255,160,0.35)";
    ctx.fillRect(-400, y, W + 800, 3);
    const s = this.sprites.shadow;
    const base = this.stack[0];
    ctx.globalAlpha = 0.8;
    ctx.drawImage(s.canvas, base.x - 40, y - 20, base.w + 120, 48);
    ctx.globalAlpha = 1;
  }

  private renderHeightMarks(ctx: CanvasRenderingContext2D) {
    resetView(ctx);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `700 30px ${this.font}`;
    const top = Math.max(1, this.level - 14);
    for (let lvl = Math.ceil(top / 5) * 5; lvl <= this.level + 6; lvl += 5) {
      if (lvl <= 0) continue;
      const y = this.yOf(lvl);
      ctx.fillStyle = "rgba(201,207,203,0.18)";
      ctx.fillRect(W - 120, y, 90, 2);
      ctx.fillStyle = "rgba(201,207,203,0.4)";
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
    // Height plate
    drawPlate(ctx, this.heightPlate, 720, 48, !this.q.extras);
    resetView(ctx, true);
    ctx.textAlign = "center";
    ctx.fillStyle = P.silver;
    ctx.font = `700 32px ${this.font}`;
    ctx.fillText(this.labels.height, 880, 100);
    drawNumber(ctx, this.font, String(this.stats.height), 880, 194, 100, this.landT > 0 ? this.landT / 0.18 : 0, "center");
    resetView(ctx, true);
    // Time cap warning in the last 10 s only: no clock pressure for normal runs.
    const cap = this.cfg.maxDurationSec;
    if (cap > 0 && this.outro <= 0 && cap - this.elapsed < 10) {
      ctx.fillStyle = P.starRed;
      ctx.font = `800 56px ${this.font}`;
      ctx.fillText(String(Math.ceil(cap - this.elapsed)), W / 2, 300);
    }
    // Streak pips
    if (this.combo > 0 && this.outro <= 0) {
      const n = Math.min(this.combo, 12);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = P.gold;
        starPath(ctx, W / 2 - (n - 1) * 22 + i * 44, 268, 15);
        ctx.fill();
      }
    }
    if (this.bannerT > 0) {
      const dur = this.outro > 0 ? OUTRO_S : 1.1;
      const intro = clamp((dur - this.bannerT) / 0.2, 0, 1);
      ctx.globalAlpha = Math.min(1, this.bannerT / 0.25);
      place(ctx, W / 2, this.outro > 0 ? 560 : SLOT_BANNER, lerp(0.6, 1, easeOutCubic(intro)));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 128px ${this.font}`;
      ctx.lineWidth = 18;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(3,19,10,0.85)";
      ctx.strokeText(this.banner, 0, 0);
      ctx.fillStyle = P.cream;
      ctx.fillText(this.banner, 0, 0);
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
}
