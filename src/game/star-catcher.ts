import type { StarConfig } from "@/lib/config";
import type { StarStats } from "@/lib/session";
import { audio } from "./engine/audio";
import { clamp, damp, easeOutCubic, H, lerp, place, rand, resetView, view, W } from "./engine/math";
import { PALETTE as P } from "./engine/palette";
import { Particles } from "./engine/particles";
import { Popups } from "./engine/popups";
import type { Game, Quality } from "./engine/runner";
import { beams, bokeh, brandBackdrop, makeSprite, type SharedSprites, type Sprite, starPath, vignette } from "./engine/sprites";
import type { GameLabels, StarResult } from "./types";

/*
 * STAR CATCHER
 * Catch falling red stars in the glass, grab rare golden stars, dodge the heat.
 * Difficulty follows a "waved" ramp (flow-channel research, RESEARCH.md §4): spawn rate
 * and speed rise with round progress plus a gentle oscillation, so pressure comes in
 * swells rather than a flat climb. Patterns (columns, zigzags) reward movement skill.
 */

const enum Kind {
  Star,
  Golden,
  Hazard,
  Chill,
}

type Obj = {
  on: boolean;
  kind: Kind;
  x: number;
  y: number;
  vy: number;
  rot: number;
  vrot: number;
  baseX: number;
  wobble: number;
  phase: number;
  /** Below the rim: can no longer be caught. */
  passed: boolean;
};

const MAX_OBJECTS = 48;
/** The glass stands on the bar counter; the counter top is the floor for shadows. */
const BASE_Y = 1880;
const FLOOR_Y = BASE_Y;
// Fallback geometry for the procedural glass (real glass geometry comes from the sprite).
const FALLBACK_RIM_HALF = 104;
const FALLBACK_GLASS_H = 250;
const OUTRO_S = 1.5;
const MILESTONE_EVERY = 500;

type Spawn = { at: number; kind: Kind; x: number };

export class StarCatcher implements Game<StarResult> {
  private objs: Obj[] = Array.from({ length: MAX_OBJECTS }, () => ({
    on: false,
    kind: Kind.Star,
    x: 0,
    y: 0,
    vy: 0,
    rot: 0,
    vrot: 0,
    baseX: 0,
    wobble: 0,
    phase: 0,
    passed: false,
  }));
  private queue: Spawn[] = [];
  private particles: Particles;
  private popups: Popups;
  private bg: Sprite;
  private glass: Sprite;
  /** Catch line and half-width, from the glass art in use. */
  private rimY: number;
  private rimHalf: number;
  private q!: Quality;

  private elapsed = 0;
  private spawnT = 0.6;
  private nextPatternAt = 7;
  private stage = 1;
  private score = 0;
  private shown = 0;
  private combo = 0;
  private mult = 1;
  private nextMilestone = MILESTONE_EVERY;
  private lastTick = 0;
  private stats: StarStats = { caught: 0, golden: 0, hazards: 0, dodges: 0, missed: 0, chills: 0, bestCombo: 0 };

  private glassX = W / 2;
  private glassV = 0;
  private targetX = W / 2;
  private tilt = 0;
  private bounce = 0;
  private heat = 0;
  private chill = 0;
  private slowmo = 0;
  private shakeT = 0;
  private shakeMag = 0;
  private flashT = 0;
  private flashColor = "#fff";
  private bannerT = 0;
  private banner = "";
  private outro = 0;
  private done = false;
  private deco: { x: number; y: number; v: number; s: number }[] = [];

  constructor(
    private cfg: StarConfig,
    private sprites: SharedSprites,
    private font: string,
    private labels: GameLabels,
  ) {
    this.particles = new Particles(260, sprites.particles);
    this.popups = new Popups(14, font);
    this.bg = makeSprite(W, H, (ctx) => {
      brandBackdrop(ctx, W / 2, H * 0.34);
      // Giant faint official star behind the action: brand presence without clutter.
      ctx.globalAlpha = 0.07;
      const st = sprites.redStar;
      ctx.drawImage(st.canvas, W / 2 - st.w * 3.4, H * 0.34 - st.h * 3.4, st.w * 6.8, st.h * 6.8);
      ctx.globalAlpha = 1;
      beams(ctx, 5, 0.05);
      bokeh(ctx, 30, FLOOR_Y - 160);
      // Bar counter the glass stands on: polished dark green with a highlight edge.
      const top = FLOOR_Y - 6;
      const counter = ctx.createLinearGradient(0, top, 0, H);
      counter.addColorStop(0, "#0c4a1f");
      counter.addColorStop(0.25, "#073516");
      counter.addColorStop(1, "#021208");
      ctx.fillStyle = counter;
      ctx.fillRect(0, top, W, H - top);
      const edge = ctx.createLinearGradient(0, top - 4, 0, top + 6);
      edge.addColorStop(0, "rgba(220,255,220,0)");
      edge.addColorStop(0.5, "rgba(220,255,220,0.55)");
      edge.addColorStop(1, "rgba(220,255,220,0)");
      ctx.fillStyle = edge;
      ctx.fillRect(0, top - 4, W, 10);
      vignette(ctx, 0.45);
    });
    // Real draught glass when brand assets loaded; procedural glass as fallback.
    const real = sprites.glass;
    this.glass = real ?? makeGlass();
    this.rimHalf = real ? real.rimHalf : FALLBACK_RIM_HALF;
    this.rimY = BASE_Y - (real ? real.rimHeight : FALLBACK_GLASS_H);
    for (let i = 0; i < 18; i++) this.deco.push({ x: rand(0, W), y: rand(0, H), v: rand(30, 90), s: rand(0.12, 0.3) });
  }

  setQuality(q: Quality) {
    this.q = q;
    this.particles.limit = q.particles;
  }

  get finished() {
    return this.done;
  }

  result(): StarResult {
    return { game: "star", score: this.score, stats: { ...this.stats }, elapsedMs: Math.round(Math.min(this.elapsed, this.cfg.durationSec) * 1000) };
  }

  pointer(type: "down" | "move" | "up", x: number) {
    if (type !== "up") this.targetX = x;
  }

  autopilot() {
    // Chase the good object that reaches the rim soonest; sidestep heat close to it.
    let best: Obj | null = null;
    let bestT = Infinity;
    for (const o of this.objs) {
      if (!o.on || o.passed || o.kind === Kind.Hazard) continue;
      const t = (this.rimY - o.y) / o.vy;
      if (t > 0 && t < bestT && Math.abs(o.x - this.glassX) / 2600 < t + 0.15) {
        bestT = t;
        best = o;
      }
    }
    let x = best ? best.x : W / 2;
    for (const o of this.objs) {
      if (!o.on || o.passed || o.kind !== Kind.Hazard) continue;
      const t = (this.rimY - o.y) / o.vy;
      if (t > 0 && t < 0.6 && Math.abs(o.x - x) < this.rimHalf + 70) x = o.x + (x < o.x ? -1 : 1) * (this.rimHalf + 120);
    }
    this.targetX = x;
  }

  // ---------------- simulation ----------------

  update(realDt: number) {
    // Golden-star hit-stop: world slows briefly, the round timer does not.
    const worldScale = (this.slowmo > 0 ? 0.3 : 1) * (this.chill > 0 ? 0.55 : 1);
    const dt = realDt * worldScale;
    this.slowmo = Math.max(0, this.slowmo - realDt);
    this.chill = Math.max(0, this.chill - realDt);
    this.heat = Math.max(0, this.heat - realDt);
    this.bounce = Math.max(0, this.bounce - realDt);
    this.flashT = Math.max(0, this.flashT - realDt);
    this.bannerT = Math.max(0, this.bannerT - realDt);
    this.shakeT = Math.max(0, this.shakeT - realDt);

    // Glass follows the finger with heavy smoothing: responsive but never jittery.
    const prev = this.glassX;
    // Keep the whole catcher on screen, not just its opening.
    const half = Math.max(this.rimHalf, this.glass.w / 2);
    this.glassX += (clamp(this.targetX, half, W - half) - this.glassX) * damp(26, realDt);
    this.glassV = (this.glassX - prev) / realDt;
    // Tall glass pivots at its base, so keep the lean subtle.
    this.tilt += (clamp(this.glassV * 0.00012, -0.1, 0.1) - this.tilt) * damp(12, realDt);

    this.shown += (this.score - this.shown) * damp(10, realDt);
    if (Math.abs(this.score - this.shown) < 0.5) this.shown = this.score;

    for (const d of this.deco) {
      d.y += d.v * dt;
      if (d.y > FLOOR_Y) {
        d.y = -20;
        d.x = rand(0, W);
      }
    }

    if (this.outro > 0) {
      this.outro -= realDt;
      if (this.outro <= 0) this.done = true;
      this.particles.update(realDt);
      this.popups.update(realDt);
      return;
    }

    this.elapsed += realDt;
    const remaining = this.cfg.durationSec - this.elapsed;
    if (remaining <= 0) return this.endRound();
    if (remaining < 5.5 && Math.ceil(remaining) !== this.lastTick) {
      this.lastTick = Math.ceil(remaining);
      if (this.lastTick <= 5) audio.play("tick", 1 + (5 - this.lastTick) * 0.06);
    }

    const p = this.elapsed / this.cfg.durationSec;
    const stage = Math.min(6, 1 + Math.floor(p * 6));
    if (stage !== this.stage) {
      this.stage = stage;
      this.showBanner(this.labels.stage(stage));
      audio.setTempo(112 + (stage - 1) * 6);
      audio.play("milestone", 0.9 + stage * 0.04);
    }

    this.spawn(dt, p);
    this.step(dt);
    this.particles.update(realDt);
    this.popups.update(realDt);
  }

  private spawn(dt: number, p: number) {
    const c = this.cfg;
    const wave = 0.1 * Math.sin(this.elapsed * 0.8);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const ease = p * p * (3 - 2 * p);
      this.spawnT = lerp(c.startSpawnInterval, c.minSpawnInterval, ease) * (1 - wave);
      const r = Math.random();
      const golden = c.goldenChance * (p > 0.55 ? 1.7 : 1);
      const hazard = lerp(c.hazardChanceStart, c.hazardChanceEnd, p);
      let kind = Kind.Star;
      if (r < golden) kind = Kind.Golden;
      else if (r < golden + hazard) kind = Kind.Hazard;
      else if (r < golden + hazard + c.chillChance && p > 0.15 && this.chill <= 0) kind = Kind.Chill;
      this.add(kind, rand(80, W - 80), p, wave);
    }
    // Patterns from stage 2: a vertical "rain" column, or a zigzag that demands sweeping.
    if (this.stage >= 2 && this.elapsed >= this.nextPatternAt) {
      this.nextPatternAt = this.elapsed + rand(5.5, 7.5);
      const zig = Math.random() < 0.5;
      const x0 = rand(180, W - 180);
      for (let i = 0; i < 5; i++) {
        const x = zig ? clamp(x0 + (i % 2 ? 230 : -230), 90, W - 90) : x0;
        this.queue.push({ at: this.elapsed + i * (zig ? 0.32 : 0.2), kind: Kind.Star, x });
      }
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].at <= this.elapsed) {
        this.add(this.queue[i].kind, this.queue[i].x, p, wave);
        this.queue.splice(i, 1);
      }
    }
  }

  private add(kind: Kind, x: number, p: number, wave: number) {
    const o = this.objs.find((o) => !o.on);
    if (!o) return; // pool full: skip, never allocate mid-game
    const c = this.cfg;
    o.on = true;
    o.kind = kind;
    o.x = o.baseX = x;
    o.y = -80;
    o.vy = lerp(c.startSpeed, c.maxSpeed, p ** 1.15) * (1 + wave * 0.5) * rand(0.9, 1.1) * (kind === Kind.Golden ? 1.12 : 1);
    o.rot = rand(0, Math.PI);
    o.vrot = rand(-1.6, 1.6) * (kind === Kind.Hazard ? 0.5 : 1);
    o.wobble = kind === Kind.Golden ? 110 : kind === Kind.Chill ? 50 : 0;
    o.phase = rand(0, Math.PI * 2);
    o.passed = false;
  }

  private step(dt: number) {
    const gx = this.glassX;
    for (const o of this.objs) {
      if (!o.on) continue;
      o.y += o.vy * dt;
      o.rot += o.vrot * dt;
      if (o.wobble) o.x = clamp(o.baseX + Math.sin(o.y * 0.006 + o.phase) * o.wobble, 60, W - 60);

      if (!o.passed && o.y >= this.rimY - 26) {
        if (o.y <= this.rimY + 46 && Math.abs(o.x - gx) <= this.rimHalf + 18) {
          o.on = false;
          this.collect(o);
          continue;
        }
        if (o.y > this.rimY + 46) {
          o.passed = true;
          if (o.kind === Kind.Hazard && Math.abs(o.x - gx) < this.rimHalf + 120) this.dodged(o);
        }
      }
      if (o.y > H + 90) {
        o.on = false;
        if (o.kind === Kind.Star || o.kind === Kind.Golden) this.missed();
      }
    }
  }

  private collect(o: Obj) {
    const c = this.cfg;
    const x = o.x;
    const y = this.rimY - 10;
    this.bounce = 0.22;
    switch (o.kind) {
      case Kind.Star:
      case Kind.Golden: {
        const golden = o.kind === Kind.Golden;
        this.stats.caught++;
        if (golden) this.stats.golden++;
        this.combo++;
        this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
        const newMult = Math.min(c.maxMultiplier, 1 + Math.floor(this.combo / c.comboStep));
        const pts = (golden ? c.goldenPoints : c.starPoints) * newMult;
        this.addScore(pts);
        if (golden) {
          this.slowmo = 0.35;
          this.flash(P.gold, 0.35);
          this.particles.burst(x, y, 34, 7, 900, { life: 1, size: 1.3, up: 300 });
          this.particles.burst(x, y, 18, 1, 600, { life: 0.8, size: 1.6, gravity: 200 });
          this.popups.show(`+${pts}`, x, y - 60, P.gold, 92, 1.2, 220);
          this.popups.show(this.labels.golden, W / 2, 760, P.gold, 110, 1.2, 60);
          audio.play("golden");
        } else {
          this.particles.burst(x, y, 12, 6, 620, { life: 0.6, up: 260 });
          this.particles.burst(x, y, 6, 5, 380, { life: 0.4, size: 0.8 });
          this.popups.show(`+${pts}`, x, y - 50, P.cream, 60);
          // Rising pitch through the combo ladder: the classic audible "streak".
          audio.play("catch", 1 + Math.min(this.combo % c.comboStep, 8) * 0.06);
        }
        if (newMult > this.mult) {
          this.popups.show(`x${newMult}`, this.glassX, this.rimY - 210, P.bright, 120, 1.1, 120);
          this.particles.burst(this.glassX, this.rimY - 80, 24, 2, 800, { life: 0.8, up: 400 });
          audio.play("combo", 1 + newMult * 0.05);
        }
        this.mult = newMult;
        break;
      }
      case Kind.Hazard: {
        this.stats.hazards++;
        const lost = Math.min(this.score, c.hazardPenalty);
        this.score -= lost;
        this.shown = this.score;
        if (this.combo >= c.comboStep) this.popups.show(this.labels.comboLost, W / 2, 900, P.heat, 70, 1);
        this.combo = 0;
        this.mult = 1;
        this.heat = 0.7;
        this.shake(0.35, 22);
        this.flash(P.heat, 0.3);
        this.particles.burst(x, y, 26, 4, 900, { life: 0.7, up: 200 });
        this.popups.show(`-${c.hazardPenalty}`, x, y - 60, P.heat, 84, 1.1);
        audio.play("hazard");
        break;
      }
      case Kind.Chill: {
        this.stats.chills++;
        this.chill = c.chillDurationSec;
        this.flash(P.ice, 0.25);
        this.particles.burst(x, y, 22, 3, 700, { life: 0.9, up: 250 });
        this.popups.show(this.labels.chill, W / 2, 820, P.ice, 96, 1.2, 60);
        audio.play("chill");
        break;
      }
    }
  }

  private dodged(o: Obj) {
    this.stats.dodges++;
    this.addScore(this.cfg.dodgeBonus);
    this.popups.show(`${this.labels.dodge} +${this.cfg.dodgeBonus}`, o.x, this.rimY - 120, P.cream, 44, 0.8, 80);
    audio.play("dodge");
  }

  private missed() {
    this.stats.missed++;
    if (this.combo >= 3) {
      if (this.combo >= this.cfg.comboStep) this.popups.show(this.labels.comboLost, W / 2, 900, P.silver, 64, 0.9);
      audio.play("miss");
    }
    this.combo = 0;
    this.mult = 1;
  }

  private addScore(pts: number) {
    this.score += pts;
    if (this.score >= this.nextMilestone) {
      this.showBanner(String(this.nextMilestone));
      this.nextMilestone += MILESTONE_EVERY;
      audio.play("milestone");
    }
  }

  private endRound() {
    this.outro = OUTRO_S;
    this.showBanner(this.labels.timeUp, OUTRO_S);
    for (const o of this.objs) if (o.on) this.particles.burst(o.x, o.y, 4, 5, 200, { life: 0.4, gravity: 0 });
    for (const o of this.objs) o.on = false;
    this.queue.length = 0;
    audio.play("end");
  }

  private showBanner(text: string, dur = 1.1) {
    this.banner = text;
    this.bannerT = dur;
  }
  private shake(t: number, mag: number) {
    if (!this.q.shake) return;
    this.shakeT = t;
    this.shakeMag = mag;
  }
  private flash(color: string, t: number) {
    if (!this.q.shake) return;
    this.flashColor = color;
    this.flashT = t;
  }

  // ---------------- rendering ----------------

  render(ctx: CanvasRenderingContext2D) {
    const s = this.sprites;
    const k = this.shakeT > 0 ? (this.shakeT / 0.35) * this.shakeMag : 0;
    view.ox = k ? rand(-k, k) : 0;
    view.oy = k ? rand(-k, k) : 0;

    resetView(ctx, true);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.bg.canvas, 0, 0);

    // Far layer: small twinkles drifting slowly = parallax depth.
    if (this.q.extras) {
      const tw = s.particles[5];
      ctx.globalCompositeOperation = "lighter";
      for (const d of this.deco) {
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(this.elapsed * 3 + d.x);
        place(ctx, d.x, d.y, d.s * 3.2, d.y * 0.004);
        ctx.drawImage(tw.canvas, -tw.cx, -tw.cy);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // Shadows on the floor give falling objects a ground reference.
    for (const o of this.objs) {
      if (!o.on || o.y > FLOOR_Y) continue;
      const t = clamp(o.y / FLOOR_Y, 0, 1);
      ctx.globalAlpha = 0.15 + t * 0.4;
      place(ctx, o.x, FLOOR_Y + 4, 0.25 + t * 0.35);
      ctx.drawImage(s.shadow.canvas, -s.shadow.cx, -s.shadow.cy);
    }
    ctx.globalAlpha = 0.7;
    place(ctx, this.glassX, FLOOR_Y + 2, 1.1);
    ctx.drawImage(s.shadow.canvas, -s.shadow.cx, -s.shadow.cy);
    ctx.globalAlpha = 1;

    for (const o of this.objs) {
      if (!o.on) continue;
      const sp = o.kind === Kind.Star ? s.redStar : o.kind === Kind.Golden ? s.goldStar : o.kind === Kind.Hazard ? s.sun : s.ice;
      if (o.kind === Kind.Hazard && this.q.extras) {
        ctx.globalCompositeOperation = "lighter";
        place(ctx, o.x, o.y, 0.6 + 0.08 * Math.sin(this.elapsed * 12));
        ctx.drawImage(s.glowRed.canvas, -s.glowRed.cx, -s.glowRed.cy);
        ctx.globalCompositeOperation = "source-over";
      }
      place(ctx, o.x, o.y, 1, o.kind === Kind.Hazard ? o.rot * 0.5 : o.rot);
      ctx.drawImage(sp.canvas, -sp.cx, -sp.cy);
    }

    this.renderGlass(ctx);
    if (this.q.extras) ctx.globalCompositeOperation = "lighter";
    this.particles.render(ctx);
    ctx.globalCompositeOperation = "source-over";
    this.popups.render(ctx);
    this.renderOverlays(ctx);
    this.renderHud(ctx);
  }

  private renderGlass(ctx: CanvasRenderingContext2D) {
    const g = this.glass;
    const b = this.bounce > 0 ? Math.sin((this.bounce / 0.22) * Math.PI) * 0.06 : 0;
    // Pivot at the glass base so tilt reads as momentum, squash on catch.
    const baseY = BASE_Y;
    const c = Math.cos(this.tilt);
    const n = Math.sin(this.tilt);
    const sx = (1 + b) * view.s;
    const sy = (1 - b) * view.s;
    ctx.setTransform(c * sx, n * sx, -n * sy, c * sy, (this.glassX + view.ox) * view.s, (baseY + view.oy) * view.s);
    if (this.mult > 1 && this.q.extras) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(1, 0.25 + this.mult * 0.12);
      const gg = this.sprites.glowGreen;
      ctx.drawImage(gg.canvas, -gg.cx, -(BASE_Y - this.rimY) * 0.55 - gg.cy, gg.w, gg.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.drawImage(g.canvas, -g.cx, -g.cy);
    if (this.heat > 0) {
      ctx.globalAlpha = this.heat / 0.7;
      ctx.globalCompositeOperation = "lighter";
      const gr = this.sprites.glowRed;
      ctx.drawImage(gr.canvas, -gr.cx, -(BASE_Y - this.rimY) - gr.cy * 0.4);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  }

  private renderOverlays(ctx: CanvasRenderingContext2D) {
    resetView(ctx, true);
    if (this.flashT > 0) {
      ctx.globalAlpha = Math.min(0.35, this.flashT);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (this.chill > 0) {
      // Frosted edges while time is slowed: clear, colour-independent cue (plus label).
      const a = Math.min(1, this.chill) * 0.5;
      ctx.globalAlpha = a;
      ctx.strokeStyle = P.ice;
      ctx.lineWidth = 36;
      ctx.strokeRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (this.bannerT > 0) {
      const t = this.bannerT;
      const intro = clamp((1.1 - t) / 0.18, 0, 1);
      const sc = 0.6 + 0.4 * easeOutCubic(intro);
      ctx.globalAlpha = Math.min(1, t / 0.25);
      place(ctx, W / 2, 640, sc);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 132px ${this.font}`;
      ctx.lineWidth = 18;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(3,19,10,0.85)";
      ctx.strokeText(this.banner, 0, 0);
      ctx.fillStyle = P.cream;
      ctx.fillText(this.banner, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  private renderHud(ctx: CanvasRenderingContext2D) {
    resetView(ctx, true);
    const remaining = Math.max(0, this.cfg.durationSec - this.elapsed);
    // Score plate
    ctx.fillStyle = "rgba(3,19,10,0.62)";
    ctx.beginPath();
    ctx.roundRect(40, 48, 620, 168, 34);
    ctx.fill();
    ctx.strokeStyle = "rgba(201,207,203,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = P.silver;
    ctx.font = `700 34px ${this.font}`;
    ctx.fillText(this.labels.score, 80, 104);
    ctx.fillStyle = P.cream;
    ctx.font = `800 96px ${this.font}`;
    ctx.fillText(String(Math.round(this.shown)), 76, 192);
    // Multiplier chip
    if (this.mult > 1) {
      ctx.fillStyle = P.bright;
      ctx.beginPath();
      ctx.roundRect(470, 92, 160, 92, 46);
      ctx.fill();
      ctx.fillStyle = "#03130a";
      ctx.textAlign = "center";
      ctx.font = `800 64px ${this.font}`;
      ctx.fillText(`x${this.mult}`, 550, 160);
    }
    // Combo meter: one star per catch toward the next multiplier.
    const step = this.cfg.comboStep;
    const filled = this.mult >= this.cfg.maxMultiplier ? step : this.combo % step;
    const pip = this.sprites.redStar;
    for (let i = 0; i < step && i < 10; i++) {
      ctx.globalAlpha = i < filled ? 1 : 0.22;
      ctx.drawImage(pip.canvas, 270 + i * 40, 146, 34, (34 * pip.h) / pip.w);
    }
    ctx.globalAlpha = 1;
    // Timer ring
    const cx = 930;
    const cy = 132;
    const frac = remaining / this.cfg.durationSec;
    const urgent = remaining <= 5 && this.outro <= 0;
    ctx.fillStyle = "rgba(3,19,10,0.62)";
    ctx.beginPath();
    ctx.arc(cx, cy, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(201,207,203,0.18)";
    ctx.beginPath();
    ctx.arc(cx, cy, 76, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = urgent ? P.starRed : P.bright;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, 76, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.lineCap = "butt";
    const pulse = urgent ? 1 + 0.12 * Math.max(0, Math.sin(this.elapsed * Math.PI * 2)) : 1;
    place(ctx, cx, cy + 4, pulse);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = urgent ? "#ff6b5e" : P.cream;
    ctx.font = `800 72px ${this.font}`;
    ctx.fillText(String(Math.ceil(remaining)), 0, 0);
  }
}

/** Tall lager glass with the red star emblem. Empty on purpose: the game is about
 * collecting stars, never about filling or drinking (Responsible Marketing Code §2.1). */
function makeGlass(): Sprite {
  const RIM_HALF = FALLBACK_RIM_HALF;
  const GLASS_H = FALLBACK_GLASS_H;
  const w = 240;
  const h = GLASS_H + 40;
  return makeSprite(
    w,
    h,
    (ctx) => {
      const cx = w / 2;
      const top = 22;
      const bottom = h - 6;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(cx - RIM_HALF, top);
        ctx.bezierCurveTo(cx - RIM_HALF + 4, top + 120, cx - 66, bottom - 90, cx - 70, bottom - 16);
        ctx.lineTo(cx - 72, bottom);
        ctx.lineTo(cx + 72, bottom);
        ctx.lineTo(cx + 70, bottom - 16);
        ctx.bezierCurveTo(cx + 66, bottom - 90, cx + RIM_HALF - 4, top + 120, cx + RIM_HALF, top);
        ctx.closePath();
      };
      path();
      const body = ctx.createLinearGradient(cx - RIM_HALF, 0, cx + RIM_HALF, 0);
      body.addColorStop(0, "rgba(220,255,225,0.34)");
      body.addColorStop(0.18, "rgba(200,240,210,0.1)");
      body.addColorStop(0.7, "rgba(160,220,170,0.08)");
      body.addColorStop(1, "rgba(220,255,225,0.3)");
      ctx.fillStyle = body;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(235,255,240,0.75)";
      ctx.stroke();
      // Thick glass base
      const base = ctx.createLinearGradient(0, bottom - 22, 0, bottom);
      base.addColorStop(0, "rgba(220,255,230,0.15)");
      base.addColorStop(1, "rgba(220,255,230,0.55)");
      ctx.fillStyle = base;
      ctx.fillRect(cx - 70, bottom - 22, 140, 22);
      // Specular streaks
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx - RIM_HALF + 22, top + 30);
      ctx.bezierCurveTo(cx - RIM_HALF + 24, top + 120, cx - 62, bottom - 110, cx - 58, bottom - 40);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.moveTo(cx + RIM_HALF - 26, top + 40);
      ctx.lineTo(cx + 62, bottom - 60);
      ctx.stroke();
      // Rim ellipse = top of a 3D glass
      ctx.beginPath();
      ctx.ellipse(cx, top, RIM_HALF, 16, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10,40,20,0.35)";
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(245,255,248,0.9)";
      ctx.stroke();
      // Emblem
      starPath(ctx, cx, top + 62, 26);
      ctx.fillStyle = P.starRed;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.stroke();
    },
    w / 2,
    h,
  );
}
