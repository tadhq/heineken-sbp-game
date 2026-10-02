import type { StarConfig } from "@/lib/config";
import { STAR_MAX_BONUS_MULT } from "@/lib/config";
import type { StarStats } from "@/lib/session";
import { STAR, STAR_PHASES, starPhaseAt } from "./balance";
import { audio } from "./engine/audio";
import { BeerGlass, type GlassArt } from "./engine/beer-glass";
import { drawNumber, drawPlate, Juice, makeChip, makeEdgeGlow, makePlate } from "./engine/hud";
import { clamp, damp, easeOutBack, easeOutCubic, H, lerp, place, rand, resetView, view, W } from "./engine/math";
import { PALETTE as P } from "./engine/palette";
import { Particles } from "./engine/particles";
import { Popups } from "./engine/popups";
import type { Game, Quality } from "./engine/runner";
import { bokeh, brandBackdrop, makeSprite, type SharedSprites, type Sprite, vignette } from "./engine/sprites";
import { type ConeTint, drawCones } from "./engine/stage-lights";
import type { GameLabels, StarResult } from "./types";

/*
 * STAR CATCHER (redesign, GAME_DESIGN.md §3)
 * Catch falling stars in the Heineken glass. Every catch pours beer into it; a full glass
 * is served (never drunk) and opens a bonus window. Catches near the centre are PERFECT.
 * Heat spills beer and breaks the streak. Six phases change what falls and how, so the
 * round keeps changing shape instead of only speeding up.
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
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  baseX: number;
  weave: number;
  phase: number;
  /** Below the rim: can no longer be caught. */
  passed: boolean;
};

const MAX_OBJECTS = 48;
/** The glass stands on the bar counter; the counter top is the floor for shadows. */
const BASE_Y = 1862;
const FLOOR_Y = BASE_Y;
const OUTRO_S = 1.6;
/** Rig hangs below the HUD so its fixtures stay visible. */
const RIG_Y = 196;
/** Combo catches climb a major pentatonic (as playback rates): a streak sounds like a melody. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19].map((n) => 2 ** (n / 12));
const SCORE_AT = { x: 170, y: 160 };
const FILL_MARKS = [0.25, 0.5, 0.75];

type Spawn = { at: number; kind: Kind; x: number };

export class StarCatcher implements Game<StarResult> {
  private objs: Obj[] = Array.from({ length: MAX_OBJECTS }, () => ({
    on: false,
    kind: Kind.Star,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    vrot: 0,
    baseX: 0,
    weave: 0,
    phase: 0,
    passed: false,
  }));
  private queue: Spawn[] = [];
  private particles: Particles;
  private popups: Popups;
  private bg: Sprite;
  private bgLow: Sprite | null = null;
  private art: GlassArt;
  private beer: BeerGlass;
  /** Catch line (world y) and the mouth's inner half-width. */
  private rimY: number;
  private mouthHalf: number;
  private q!: Quality;

  private elapsed = 0;
  private spawnT = 0.9;
  private nextShower = 0;
  private phaseIdx = 0;
  private score = 0;
  private shown = 0;
  private combo = 0;
  /** Streak progress toward the multiplier: a perfect catch counts double. */
  private streak = 0;
  private mult = 1;
  private bonusMult = 1;
  private bonusT = 0;
  private nextMilestone: number = STAR.milestoneEvery;
  private lastTick = 0;
  private stats: StarStats = { caught: 0, golden: 0, hazards: 0, dodges: 0, missed: 0, chills: 0, bestCombo: 0, perfects: 0, served: 0 };

  /** Logical fill 0-1 (the beer eases toward it). */
  private fill = 0;
  /** FULL GLASS celebration countdown; the glass is served when it ends. */
  private fullT = 0;
  private servedGhost = { t: 1, x: 0, dir: 1 };
  private dropIn = 1;
  private glassX = W / 2;
  private glassV = 0;
  private glassA = 0;
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
  private bannerDur = 1.1;
  private banner = "";
  private bannerSub = "";
  private outro = 0;
  private done = false;
  private deco: { x: number; y: number; v: number; s: number }[] = [];
  private juice = new Juice();
  private scorePlate: Sprite;
  private timerPlate: Sprite;
  private bonusPlate: Sprite;
  private chips = new Map<string, Sprite>();
  private edgeRed: Sprite;
  private edgeGold: Sprite;
  private scoreBump = 0;
  private multPop = 0;
  private bonusPop = 0;
  private edgeT = 0;
  private edgeGolden = false;
  private goldenT = 0;
  private sparkleT = 0;
  /** Stage-light state: energy follows the streak, tint marks bonus and the final push. */
  private energy = 0;
  private tint: ConeTint = "stage";
  private tintMix = 0;

  constructor(
    private cfg: StarConfig,
    private sprites: SharedSprites,
    private font: string,
    private labels: GameLabels,
  ) {
    this.particles = new Particles(260, sprites.particles);
    this.popups = new Popups(16, font);
    this.bg = makeSprite(W, H, (ctx) => this.paintBackground(ctx, false));
    this.art = sprites.glass;
    this.beer = new BeerGlass(this.art);
    this.mouthHalf = this.art.mouthHalf;
    this.rimY = BASE_Y - this.art.rimHeight;
    for (let i = 0; i < 18; i++) this.deco.push({ x: rand(0, W), y: rand(RIG_Y + 100, H), v: rand(14, 40), s: rand(0.12, 0.3) });
    this.scorePlate = makePlate(620, 168, 34, P.starRed);
    this.bonusPlate = makePlate(300, 84, 42, P.gold);
    this.timerPlate = makeSprite(212, 212, (ctx) => {
      ctx.shadowColor = "rgba(0,22,9,0.7)";
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 10;
      ctx.beginPath();
      ctx.arc(106, 100, 92, 0, Math.PI * 2);
      const g = ctx.createLinearGradient(0, 8, 0, 192);
      g.addColorStop(0, "rgba(18,78,38,0.9)");
      g.addColorStop(1, "rgba(3,28,13,0.94)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowColor = "transparent";
      // Brushed-metal bezel: the "premium" edge every plate shares.
      ctx.lineWidth = 5;
      const m = ctx.createLinearGradient(0, 8, 0, 192);
      m.addColorStop(0, "rgba(240,246,242,0.75)");
      m.addColorStop(0.5, "rgba(120,132,125,0.35)");
      m.addColorStop(1, "rgba(200,208,203,0.55)");
      ctx.strokeStyle = m;
      ctx.stroke();
    });
    this.edgeRed = makeEdgeGlow("rgba(227,0,15,0.7)");
    this.edgeGold = makeEdgeGlow("rgba(255,201,74,0.6)");
  }

  /** Deep environment: brand-green hall, back bar with multipacks, the counter. Baked. */
  private paintBackground(ctx: CanvasRenderingContext2D, withLights: boolean) {
    const s = this.sprites;
    brandBackdrop(ctx, W / 2, H * 0.3);
    // Back wall: tall slatted panels catching the light, darker toward the edges.
    for (let x = 0; x < W; x += 60) {
      const k = 1 - Math.abs(x + 30 - W / 2) / (W / 2);
      ctx.fillStyle = `rgba(0,25,10,${0.1 + (1 - k) * 0.12})`;
      ctx.fillRect(x, RIG_Y + 60, 6, H);
    }
    ctx.globalAlpha = 0.06;
    const st = s.redStar;
    ctx.drawImage(st.canvas, W / 2 - st.w * 3.2, H * 0.4 - st.h * 3.2, st.w * 6.4, st.h * 6.4);
    ctx.globalAlpha = 1;
    bokeh(ctx, 26, FLOOR_Y - 260);
    // Back-bar shelf with multipacks, out of focus behind the counter: depth plus brand.
    const shelfY = FLOOR_Y - 170;
    if (s.multipack) {
      const mp = s.multipack;
      const mw = 300;
      const mh = (mp.naturalHeight / mp.naturalWidth) * mw;
      ctx.filter = "blur(2.5px) brightness(0.55) saturate(0.85)";
      for (const x of [-40, 250, 540, 830]) ctx.drawImage(mp, x, shelfY - mh + 8, mw, mh);
      ctx.filter = "none";
    }
    const shelf = ctx.createLinearGradient(0, shelfY, 0, shelfY + 22);
    shelf.addColorStop(0, "#5d6a63");
    shelf.addColorStop(0.2, "#2a3530");
    shelf.addColorStop(1, "#0b1a12");
    ctx.fillStyle = shelf;
    ctx.fillRect(0, shelfY, W, 22);
    // Haze over the back bar so it sits behind the action.
    const haze = ctx.createLinearGradient(0, shelfY - 260, 0, FLOOR_Y);
    haze.addColorStop(0, "rgba(6,50,24,0)");
    haze.addColorStop(1, "rgba(6,50,24,0.75)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, shelfY - 260, W, FLOOR_Y - shelfY + 260);
    // Bar counter: polished dark green top, chrome nosing, front panel.
    const top = FLOOR_Y - 6;
    const counter = ctx.createLinearGradient(0, top, 0, H);
    counter.addColorStop(0, "#0e5424");
    counter.addColorStop(0.2, "#073516");
    counter.addColorStop(1, "#021208");
    ctx.fillStyle = counter;
    ctx.fillRect(0, top, W, H - top);
    const edge = ctx.createLinearGradient(0, top - 4, 0, top + 8);
    edge.addColorStop(0, "rgba(235,250,240,0)");
    edge.addColorStop(0.5, "rgba(235,250,240,0.75)");
    edge.addColorStop(1, "rgba(235,250,240,0)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, top - 4, W, 12);
    // The star rail on the counter front (a brand detail, not a HUD element).
    ctx.fillStyle = "rgba(227,0,15,0.85)";
    ctx.fillRect(0, top + 20, W, 3);
    vignette(ctx, 0.42);
    if (withLights) drawCones(ctx, s.lights, 0, 0.3, "stage", 0, RIG_Y, 0.7);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(s.lights.rig.canvas, 0, RIG_Y);
  }

  private chip(text: string, color?: string) {
    let c = this.chips.get(text);
    if (!c) this.chips.set(text, (c = makeChip(text, this.font, color)));
    return c;
  }

  setQuality(q: Quality) {
    this.q = q;
    this.particles.limit = q.particles;
    this.beer.detail = q.extras;
    // Low quality: cones are baked into the background instead of animated.
    if (!q.extras && !this.bgLow) this.bgLow = makeSprite(W, H, (ctx) => this.paintBackground(ctx, true));
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

  /** QA/balance bot. `skill` 0-1 scales reaction, reach, aim, judgement and lapses. */
  skill = 0.75;
  private botAim = 0;
  private botNext = 0;
  private botTarget: Obj | null = null;
  autopilot(dt: number) {
    this.botNext -= dt;
    if (this.botNext > 0) return;
    // Humans re-target a few times a second, not every frame, and sometimes pick badly.
    const k = this.skill;
    this.botNext = lerp(0.45, 0.12, k);
    const reach = STAR.glassMaxSpeed * lerp(0.4, 0.9, k);
    const lapse = Math.random() < lerp(0.3, 0.04, k);
    if (this.botTarget && (!this.botTarget.on || this.botTarget.passed)) this.botTarget = null;
    let best: Obj | null = null;
    let bestScore = -Infinity;
    for (const o of this.objs) {
      if (!o.on || o.passed || o.kind === Kind.Hazard) continue;
      const t = (this.rimY - o.y) / o.vy;
      if (t <= 0.05) continue;
      const travel = Math.abs(o.x + o.vx * t * k - this.glassX) / reach;
      if (travel > t) continue;
      const value = o.kind === Kind.Golden ? 2.5 * k : o.kind === Kind.Chill ? 0.6 : 1;
      const sc = lapse ? Math.random() : value - t * 0.8 - travel * 0.5;
      if (sc > bestScore) {
        bestScore = sc;
        best = o;
      }
    }
    if (best) {
      if (best !== this.botTarget) this.botAim = rand(-1, 1) * this.mouthHalf * lerp(1.05, 0.22, k);
      this.botTarget = best;
      const t = (this.rimY - best.y) / best.vy;
      this.targetX = best.x + best.vx * t * k + this.botAim;
    }
    for (const o of this.objs) {
      if (!o.on || o.passed || o.kind !== Kind.Hazard) continue;
      const t = (this.rimY - o.y) / o.vy;
      if (t > 0 && t < lerp(0.3, 0.7, k) && Math.abs(o.x - this.targetX) < this.mouthHalf + 80 && Math.random() < lerp(0.3, 0.95, k))
        this.targetX = o.x + (this.targetX < o.x ? -1 : 1) * (this.mouthHalf + 140);
    }
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
    this.scoreBump = Math.max(0, this.scoreBump - realDt * 2.2);
    this.multPop = Math.max(0, this.multPop - realDt * 2);
    this.bonusPop = Math.max(0, this.bonusPop - realDt * 2);
    this.edgeT = Math.max(0, this.edgeT - realDt);
    this.goldenT = Math.max(0, this.goldenT - realDt);
    this.servedGhost.t = Math.min(1, this.servedGhost.t + realDt / 0.7);
    this.dropIn = Math.min(1, this.dropIn + realDt / 0.4);
    this.juice.update(realDt);

    // Glass follows the finger with smoothing and a top speed: far jumps cost time.
    const prev = this.glassX;
    const prevV = this.glassV;
    const half = this.art.sprite.w / 2;
    const want = (clamp(this.targetX, half, W - half) - this.glassX) * damp(STAR.glassFollow, realDt);
    const maxStep = STAR.glassMaxSpeed * realDt;
    this.glassX += clamp(want, -maxStep, maxStep);
    this.glassV = (this.glassX - prev) / realDt;
    this.glassA = this.glassA + ((this.glassV - prevV) / realDt - this.glassA) * damp(20, realDt);
    // Tall glass pivots at its base, so keep the lean subtle.
    this.tilt += (clamp(this.glassV * 0.00009, -0.08, 0.08) - this.tilt) * damp(12, realDt);
    this.beer.level = this.fill;
    this.beer.crown = Math.max(0, this.beer.crown - realDt * 1.5);
    if (this.fullT > 0) this.beer.crown = 1;
    this.beer.update(realDt, this.glassA, this.tilt);

    this.shown += (this.score - this.shown) * damp(10, realDt);
    if (Math.abs(this.score - this.shown) < 0.5) this.shown = this.score;

    for (const d of this.deco) {
      d.y -= d.v * dt;
      if (d.y < RIG_Y + 60) {
        d.y = FLOOR_Y - 40;
        d.x = rand(0, W);
      }
    }

    // Stage lights react: streak = energy; bonus = gold; final push = red.
    const finalPush = this.phaseIdx === STAR_PHASES.length - 1;
    const wantTint: ConeTint = this.bonusT > 0 ? "gold" : finalPush ? "red" : "stage";
    if (wantTint !== this.tint && this.tintMix <= 0.02) this.tint = wantTint;
    this.tintMix = clamp(this.tintMix + (wantTint === this.tint && wantTint !== "stage" ? 1 : -1) * realDt * 2.5, 0, 1);
    const multFrac = (this.mult - 1) / Math.max(1, this.cfg.maxMultiplier - 1);
    this.energy += (Math.max(multFrac, this.bonusT > 0 ? 0.8 : 0, finalPush ? 0.9 : 0) - this.energy) * damp(2, realDt);

    if (this.outro > 0) {
      this.outro -= realDt;
      if (this.outro <= 0) this.done = true;
      this.particles.update(realDt);
      this.popups.update(realDt);
      return;
    }

    if (this.fullT > 0) {
      this.fullT -= realDt;
      if (this.fullT <= 0) this.serve();
    }
    if (this.bonusT > 0) {
      this.bonusT -= realDt;
      if (this.bonusT <= 0) this.bonusMult = 1;
    }

    this.elapsed += realDt;
    const remaining = this.cfg.durationSec - this.elapsed;
    if (remaining <= 0) return this.endRound();
    if (remaining < 5.5 && Math.ceil(remaining) !== this.lastTick) {
      this.lastTick = Math.ceil(remaining);
      if (this.lastTick <= 5) {
        audio.play("tick", 1 + (5 - this.lastTick) * 0.06);
        this.edge(false, 0.45);
      }
    }
    // Adaptive music: streak, bonus, golden and the final push all lift the energy layer.
    audio.intensity(remaining < 10 || this.goldenT > 0 || finalPush ? 1 : Math.max(0.15 + 0.85 * multFrac, this.bonusT > 0 ? 0.85 : 0, this.phaseIdx * 0.12));

    const p = this.elapsed / this.cfg.durationSec;
    const phase = starPhaseAt(p);
    if (phase !== this.phaseIdx) {
      this.phaseIdx = phase;
      this.nextShower = this.elapsed + 0.8;
      this.showBanner(this.labels.phase(phase + 1), 1.4, this.labels.phaseName(phase + 1));
      audio.play(phase === STAR_PHASES.length - 1 ? "riser" : "phase");
    }

    this.spawn(dt, p);
    this.step(dt);
    this.particles.update(realDt);
    this.popups.update(realDt);
  }

  private spawn(dt: number, p: number) {
    const c = this.cfg;
    const ph = STAR_PHASES[this.phaseIdx];
    const wave = 0.1 * Math.sin(this.elapsed * 0.8);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = lerp(c.startSpawnInterval, c.minSpawnInterval, ph.interval) * (1 - wave) * (this.phaseIdx === 0 ? 1.15 : 1);
      if (Math.random() < ph.group) {
        // A spread group forces a choice: there is rarely time to take every one.
        const n = Math.random() < 0.35 ? 3 : 2;
        const gap = rand(260, 360);
        const x0 = rand(110, W - 110 - gap * (n - 1));
        // One star plus company (heat, gold, ice): a routing decision, not a missed-star tax.
        const star = Math.floor(Math.random() * n);
        for (let i = 0; i < n; i++) this.add(i === star ? Kind.Star : this.companion(), x0 + i * gap + rand(-30, 30), p, wave);
      } else this.add(this.pickKind(p), rand(90, W - 90), p, wave);
    }
    // Combo Rush: diagonal showers of red stars, sweeping the whole width.
    if (ph.shower > 0 && this.elapsed >= this.nextShower) {
      this.nextShower = this.elapsed + ph.shower + rand(-0.3, 0.3);
      const ltr = Math.random() < 0.5;
      for (let i = 0; i < 5; i++) {
        const x = 150 + i * 195;
        this.queue.push({ at: this.elapsed + i * 0.15, kind: i === 4 && Math.random() < 0.25 ? Kind.Golden : Kind.Star, x: ltr ? x : W - x });
      }
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].at <= this.elapsed) {
        this.add(this.queue[i].kind, this.queue[i].x, p, wave, true);
        this.queue.splice(i, 1);
      }
    }
  }

  private companion(): Kind {
    const ph = STAR_PHASES[this.phaseIdx];
    const r = Math.random();
    if (ph.hazard !== null && r < 0.6) return Kind.Hazard;
    if (r < 0.85 && ph.golden > 0) return Kind.Golden;
    return this.chill > 0 || ph.chill === 0 ? Kind.Golden : Kind.Chill;
  }

  private pickKind(p: number): Kind {
    const c = this.cfg;
    const ph = STAR_PHASES[this.phaseIdx];
    const golden = c.goldenChance * ph.golden;
    const hazard = ph.hazard === null ? 0 : lerp(c.hazardChanceStart, c.hazardChanceEnd, ph.hazard);
    const chill = this.chill > 0 || p < 0.1 ? 0 : c.chillChance * ph.chill;
    const r = Math.random();
    if (r < golden) return Kind.Golden;
    if (r < golden + hazard) return Kind.Hazard;
    if (r < golden + hazard + chill) return Kind.Chill;
    return Kind.Star;
  }

  private add(kind: Kind, x: number, p: number, wave: number, straight = false) {
    const o = this.objs.find((o) => !o.on);
    if (!o) return; // pool full: skip, never allocate mid-game
    const c = this.cfg;
    const ph = STAR_PHASES[this.phaseIdx];
    const next = STAR_PHASES[this.phaseIdx + 1];
    // Gentle ramp inside a phase toward the next one, so a phase never feels static.
    const within = next ? clamp((p - ph.at) / (next.at - ph.at), 0, 1) : 0;
    const sp = lerp(ph.speed, next ? next.speed : ph.speed, within * 0.4);
    o.on = true;
    o.kind = kind;
    o.x = o.baseX = clamp(x, 70, W - 70);
    o.y = RIG_Y + 40;
    o.vy = lerp(c.startSpeed, c.maxSpeed, sp) * (1 + wave * 0.5) * rand(0.92, 1.08) * (kind === Kind.Golden ? STAR.goldenSpeed : 1);
    o.vx = straight || kind !== Kind.Star ? 0 : rand(-ph.drift, ph.drift);
    o.rot = rand(0, Math.PI);
    o.vrot = rand(-1.6, 1.6) * (kind === Kind.Hazard ? 0.5 : 1);
    o.weave = kind === Kind.Golden ? STAR.goldenWeave : kind === Kind.Chill ? 50 : kind === Kind.Hazard && ph.heatWeave ? 90 : 0;
    o.phase = rand(0, Math.PI * 2);
    o.passed = false;
  }

  private step(dt: number) {
    const gx = this.glassX;
    this.sparkleT -= dt;
    const sparkle = this.sparkleT <= 0 && this.q.extras;
    if (sparkle) this.sparkleT = 0.05;
    const reach = this.mouthHalf + STAR.catchMargin;
    for (const o of this.objs) {
      if (!o.on) continue;
      if (sparkle && o.kind === Kind.Golden) this.particles.burst(o.x + rand(-30, 30), o.y + rand(-20, 20), 1, 7, 50, { life: 0.55, size: 0.7, gravity: -40 });
      o.y += o.vy * dt;
      o.rot += o.vrot * dt;
      if (o.vx) {
        o.baseX += o.vx * dt;
        if (o.baseX < 70 || o.baseX > W - 70) o.vx = -o.vx;
        o.baseX = clamp(o.baseX, 70, W - 70);
      }
      o.x = o.weave ? clamp(o.baseX + Math.sin(o.y * 0.006 + o.phase) * o.weave, 60, W - 60) : o.baseX;

      if (!o.passed && o.y >= this.rimY - 30) {
        if (o.y <= this.rimY + 40 && Math.abs(o.x - gx) <= reach) {
          o.on = false;
          this.collect(o, Math.abs(o.x - gx) <= this.mouthHalf * STAR.perfectZone);
          continue;
        }
        if (o.y > this.rimY + 40) {
          o.passed = true;
          if (o.kind === Kind.Hazard && Math.abs(o.x - gx) < reach + STAR.dodgeMargin) this.dodged(o);
        }
      }
      if (o.y > H + 90) {
        o.on = false;
        if (o.kind === Kind.Star || o.kind === Kind.Golden) this.missed(o.kind === Kind.Golden);
      }
    }
  }

  private collect(o: Obj, perfect: boolean) {
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
        if (perfect) this.stats.perfects++;
        this.combo++;
        this.streak += perfect ? 2 : 1;
        this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
        const newMult = Math.min(c.maxMultiplier, 1 + Math.floor(this.streak / c.comboStep));
        const base = (golden ? c.goldenPoints : c.starPoints) + (perfect ? c.perfectBonus : 0);
        const pts = base * newMult * this.bonusMult;
        this.addScore(pts);
        this.pour((golden ? c.fillPerGolden : c.fillPerStar) * (perfect ? STAR.perfectFill : 1));
        this.beer.impulse(golden ? 9 : perfect ? 6 : 4);
        const pan = (x / W - 0.5) * 1.2;
        const bump = () => (this.scoreBump = 1);
        // Beer splashes up from the mouth: the catch lands *in* the glass.
        this.particles.burst(this.glassX + (x - this.glassX) * 0.5, this.rimY + 6, perfect ? 10 : 6, 8, 420, { life: 0.5, size: 0.7, up: 320, gravity: 900 });
        if (golden) {
          this.slowmo = 0.35;
          this.goldenT = 2.5;
          this.flash(P.gold, 0.22);
          this.edge(true, 0.9);
          this.shake(0.3, 12);
          this.particles.burst(x, y, 34, 7, 900, { life: 1, size: 1.3, up: 300 });
          this.particles.burst(x, y, 18, 1, 600, { life: 0.8, size: 1.6, gravity: 200 });
          this.juice.ring(this.sprites.ring, x, y, 2.6, 0.6);
          this.juice.ring(this.sprites.glowGold, x, y, 1.6, 0.5, 0.8);
          for (let i = 0; i < 3; i++) this.juice.fly(this.sprites.particles[7], x + (i - 1) * 40, y, SCORE_AT.x, SCORE_AT.y, 1.4, 0.45 + i * 0.07, bump);
          this.popups.show(`+${pts}`, x, y - 70, P.gold, 100, 1.2, 220);
          this.popups.show(this.labels.golden, W / 2, 760, P.gold, 130, 1.2, 60);
          audio.play("golden", 1, 1, pan);
        } else {
          this.particles.burst(x, y, perfect ? 16 : 10, perfect ? 7 : 6, 620, { life: 0.6, up: 260 });
          this.juice.ring(this.sprites.ring, x, this.rimY, perfect ? 1.3 : 0.9, 0.3, perfect ? 0.8 : 0.5);
          this.juice.fly(this.sprites.particles[perfect ? 7 : 6], x, y - 20, SCORE_AT.x, SCORE_AT.y, 0.9, 0.4, bump);
          this.popups.show(`+${pts}`, x, y - 60, perfect ? P.gold : P.cream, perfect ? 70 : 60);
          // The streak climbs a pentatonic scale: catching in a row plays a little melody.
          const rate = PENTA[Math.min(this.combo - 1, PENTA.length - 1)];
          audio.play(perfect ? "perfectCatch" : "catch", rate, 1, pan);
        }
        if (perfect) this.popups.show(this.labels.perfect, this.glassX, this.rimY - 150, P.gold, 58, 0.7, 90);
        if (newMult > this.mult) {
          this.multPop = 1;
          this.popups.show(`${this.labels.combo} x${newMult}`, W / 2, 560, P.bright, 116, 1.2, 70);
          this.particles.burst(this.glassX, this.rimY - 80, 24, 2, 800, { life: 0.8, up: 400 });
          this.juice.ring(this.sprites.glowGreen, this.glassX, this.rimY - 60, 1.4, 0.5, 0.7);
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
        this.breakStreak();
        this.heat = 0.7;
        this.shake(0.35, 16);
        this.edge(false, 0.7);
        // The glass flinches away from the hit and beer slops over the rim.
        this.tilt += x < this.glassX ? 0.1 : -0.1;
        this.beer.impulse(14);
        if (this.fullT <= 0 && this.fill > 0) {
          this.fill = Math.max(0, this.fill - c.fillHeatLoss);
          this.particles.burst(this.glassX, this.rimY, 22, 8, 700, { life: 0.8, up: 300, gravity: 1400 });
          this.popups.show(this.labels.spill, this.glassX, this.rimY - 140, P.heat, 64, 0.9, 80);
          audio.play("spill");
        }
        this.particles.burst(x, y, 26, 4, 900, { life: 0.7, up: 200 });
        if (lost > 0) this.popups.show(`-${lost}`, x, y - 60, P.heat, 84, 1.1);
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

  /** Adds beer; crossing 25/50/75% chimes, 100% starts the FULL GLASS moment. */
  private pour(amount: number) {
    if (this.fullT > 0) return;
    const before = this.fill;
    this.fill = Math.min(1, this.fill + amount);
    for (let i = 0; i < FILL_MARKS.length; i++) {
      if (before < FILL_MARKS[i] && this.fill >= FILL_MARKS[i] && this.fill < 1) {
        audio.play("fill", 1 + i * 0.12);
        this.popups.show(`${FILL_MARKS[i] * 100}%`, this.glassX, this.rimY - 100, P.cream, 44, 0.6, 60);
      }
    }
    if (this.fill >= 1) {
      this.fullT = STAR.fullHold;
      this.bounce = 0.3;
      this.flash(P.gold, 0.18);
      this.showBanner(this.labels.fullGlass, 1.1);
      this.particles.burst(this.glassX, this.rimY - 10, 30, 9, 520, { life: 0.9, up: 420, gravity: 500 });
      this.juice.ring(this.sprites.glowGold, this.glassX, this.rimY - 40, 1.8, 0.55, 0.85);
      audio.play("full");
    }
  }

  /** The full glass slides away along the counter, a fresh one drops in, bonus opens. */
  private serve() {
    const c = this.cfg;
    this.stats.served++;
    this.bonusMult = this.bonusT > 0 ? Math.min(STAR_MAX_BONUS_MULT, this.bonusMult + 1) : STAR.bonusBase;
    this.bonusT = c.bonusSec;
    this.bonusPop = 1;
    const pts = c.serveBonus * this.bonusMult;
    this.addScore(pts);
    this.servedGhost = { t: 0, x: this.glassX, dir: this.glassX < W / 2 ? 1 : -1 };
    this.dropIn = 0;
    this.fill = 0;
    this.beer.shown = 0;
    this.edge(true, 0.8);
    this.popups.show(`${this.labels.bonus} x${this.bonusMult}`, W / 2, 640, P.gold, 128, 1.3, 70);
    this.popups.show(`${this.labels.served} +${pts}`, W / 2, 770, P.cream, 60, 1.1, 60);
    for (let i = 0; i < 3; i++) this.juice.fly(this.sprites.particles[7], this.glassX + (i - 1) * 50, this.rimY, SCORE_AT.x, SCORE_AT.y, 1.3, 0.5 + i * 0.06, () => (this.scoreBump = 1));
    audio.play("serve");
    audio.play("bonus", this.bonusMult >= 3 ? 1.19 : 1);
  }

  private dodged(o: Obj) {
    this.stats.dodges++;
    this.addScore(this.cfg.dodgeBonus);
    this.popups.show(`${this.labels.dodge} +${this.cfg.dodgeBonus}`, o.x, this.rimY - 120, P.cream, 44, 0.8, 80);
    audio.play("dodge");
  }

  private missed(golden: boolean) {
    this.stats.missed++;
    // A golden star is optional: chasing it is the risk, missing it costs nothing.
    if (golden) return;
    if (this.combo >= 3) {
      if (this.combo >= this.cfg.comboStep) this.popups.show(this.labels.comboLost, W / 2, 900, P.silver, 64, 0.9);
      audio.play("miss");
    }
    this.breakStreak();
    if (this.fullT <= 0) this.fill = Math.max(0, this.fill - this.cfg.fillMissLoss);
  }

  /** Streak over: multiplier resets and an open bonus window closes with it. */
  private breakStreak() {
    this.combo = 0;
    this.streak = 0;
    this.mult = 1;
    if (this.bonusT > 0) {
      this.bonusT = 0;
      this.bonusMult = 1;
      this.popups.show(`${this.labels.bonus} ✕`, 190, 330, P.silver, 40, 0.8, 30);
    }
  }

  private addScore(pts: number) {
    this.score += pts;
    if (this.score >= this.nextMilestone) {
      this.nextMilestone += STAR.milestoneEvery;
      audio.play("milestone");
      this.juice.ring(this.sprites.glowGold, SCORE_AT.x + 140, SCORE_AT.y - 20, 1.2, 0.5, 0.6);
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

  private showBanner(text: string, dur = 1.1, sub = "") {
    this.banner = text;
    this.bannerSub = sub;
    this.bannerT = dur;
    this.bannerDur = dur;
  }
  private shake(t: number, mag: number) {
    if (!this.q.shake) return;
    this.shakeT = t;
    this.shakeMag = mag;
  }
  private edge(golden: boolean, t: number) {
    if (!this.q.shake) return;
    this.edgeGolden = golden;
    this.edgeT = t;
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

    // Layers 1-3: environment (baked), atmosphere, lighting.
    resetView(ctx, true);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage((this.q.extras ? this.bg : (this.bgLow ?? this.bg)).canvas, 0, 0);
    if (this.q.extras) {
      drawCones(ctx, s.lights, this.elapsed, this.energy, this.tint, this.tintMix, RIG_Y);
      // Dust motes drifting up through the beams.
      const tw = s.particles[5];
      ctx.globalCompositeOperation = "lighter";
      for (const d of this.deco) {
        ctx.globalAlpha = (0.18 + 0.2 * Math.sin(this.elapsed * 2 + d.x)) * (0.6 + this.energy * 0.6);
        place(ctx, d.x, d.y, d.s * 2.4);
        ctx.drawImage(tw.canvas, -tw.cx, -tw.cy);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      // Rig on top of its own cones (lenses read as the light source).
      resetView(ctx, true);
      ctx.drawImage(s.lights.rig.canvas, 0, RIG_Y);
    }

    // Layer 4: gameplay.
    for (const o of this.objs) {
      if (!o.on || o.y > FLOOR_Y) continue;
      const t = clamp((o.y - RIG_Y) / (FLOOR_Y - RIG_Y), 0, 1);
      ctx.globalAlpha = 0.12 + t * 0.4;
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
      if (this.q.extras && o.kind === Kind.Star) {
        // One fading ghost: reads as speed for the price of one small blit.
        ctx.globalAlpha = 0.14;
        place(ctx, o.x - o.vx * 0.06, o.y - o.vy * 0.06, 0.84, o.rot - o.vrot * 0.06);
        ctx.drawImage(sp.canvas, -sp.cx, -sp.cy);
        ctx.globalAlpha = 1;
      } else if (o.kind === Kind.Golden) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.elapsed * 10 + o.phase);
        place(ctx, o.x, o.y, 0.62);
        ctx.drawImage(s.glowGold.canvas, -s.glowGold.cx, -s.glowGold.cy);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      place(ctx, o.x, o.y, 1, o.kind === Kind.Hazard ? o.rot * 0.5 : o.rot);
      ctx.drawImage(sp.canvas, -sp.cx, -sp.cy);
    }

    this.renderServed(ctx);
    this.renderGlass(ctx);
    // Layer 6 (effects) sits under the HUD here so numbers stay readable.
    if (this.q.extras) ctx.globalCompositeOperation = "lighter";
    this.particles.render(ctx);
    ctx.globalCompositeOperation = "lighter";
    this.juice.render(ctx);
    ctx.globalCompositeOperation = "source-over";
    this.popups.render(ctx);
    this.renderOverlays(ctx);
    this.renderHud(ctx);
  }

  /** Glass transform: pivot at the base so tilt reads as momentum; squash on catch. */
  private glassTransform(ctx: CanvasRenderingContext2D, x: number, y: number, tilt: number, b: number, scale = 1) {
    const c = Math.cos(tilt);
    const n = Math.sin(tilt);
    const sx = (1 + b) * view.s * scale;
    const sy = (1 - b) * view.s * scale;
    ctx.setTransform(c * sx, n * sx, -n * sy, c * sy, (x + view.ox) * view.s, (y + view.oy) * view.s);
  }

  private renderServed(ctx: CanvasRenderingContext2D) {
    const g = this.servedGhost;
    if (g.t >= 1) return;
    // Slides along the counter toward the nearer edge, a little smaller as it goes.
    const e = easeOutCubic(g.t);
    const x = g.x + g.dir * e * (W * 0.75);
    const sp = this.art.sprite;
    ctx.globalAlpha = 1 - g.t * g.t;
    this.glassTransform(ctx, x, BASE_Y, -g.dir * 0.04 * (1 - e), 0, 1 - 0.12 * e);
    ctx.drawImage(this.beerFull().canvas, -sp.cx, -sp.cy);
    ctx.globalAlpha = 1;
  }

  private fullSprite: Sprite | null = null;
  /** A full glass, baked once: what the served glass looks like as it leaves. */
  private beerFull() {
    if (this.fullSprite) return this.fullSprite;
    const b = new BeerGlass(this.art);
    b.level = b.shown = 1;
    b.crown = 1;
    b.draw();
    const a = this.art;
    const crown = this.sprites.crown;
    this.fullSprite = makeSprite(a.sprite.w, a.sprite.h, (ctx) => {
      ctx.drawImage(b.canvas, 0, 0);
      ctx.drawImage(a.sprite.canvas, 0, 0);
      const cw = a.mouthHalf * 2.3;
      ctx.drawImage(crown.canvas, a.sprite.w / 2 - cw / 2, a.innerTop - cw * 0.34, cw, (cw * crown.h) / crown.w);
    });
    return this.fullSprite;
  }

  private renderGlass(ctx: CanvasRenderingContext2D) {
    const a = this.art;
    const g = a.sprite;
    const b = this.bounce > 0 ? Math.sin((this.bounce / 0.22) * Math.PI) * (this.fullT > 0 ? 0.08 : 0.05) : 0;
    const drop = this.dropIn < 1 ? (1 - easeOutBack(this.dropIn)) * -160 : 0;
    this.glassTransform(ctx, this.glassX, BASE_Y + drop, this.tilt, b);
    if (this.q.extras && (this.mult > 1 || this.bonusT > 0)) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(1, 0.25 + this.mult * 0.1 + (this.bonusT > 0 ? 0.35 : 0));
      const gg = this.bonusT > 0 ? this.sprites.glowGold : this.sprites.glowGreen;
      ctx.drawImage(gg.canvas, -gg.cx, -g.h * 0.5 - gg.cy, gg.w, gg.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    if (this.beer.draw()) ctx.drawImage(this.beer.canvas, -g.cx, -g.cy);
    ctx.drawImage(g.canvas, -g.cx, -g.cy);
    if (this.beer.crown > 0) {
      // Foam crown swelling over the rim when the glass is full.
      const cr = this.sprites.crown;
      const cw = a.mouthHalf * 2.3 * (0.7 + 0.3 * easeOutBack(Math.min(1, this.beer.crown)));
      ctx.globalAlpha = Math.min(1, this.beer.crown * 2);
      ctx.drawImage(cr.canvas, -cw / 2, -g.h + a.innerTop - cw * 0.34, cw, (cw * cr.h) / cr.w);
      ctx.globalAlpha = 1;
    }
    if (this.heat > 0) {
      ctx.globalAlpha = this.heat / 0.7;
      ctx.globalCompositeOperation = "lighter";
      const gr = this.sprites.glowRed;
      ctx.drawImage(gr.canvas, -gr.cx, -a.rimHeight - gr.cy * 0.4);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  }

  private renderOverlays(ctx: CanvasRenderingContext2D) {
    resetView(ctx, true);
    if (this.flashT > 0) {
      ctx.globalAlpha = Math.min(0.22, this.flashT);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (this.edgeT > 0) {
      const e = this.edgeGolden ? this.edgeGold : this.edgeRed;
      ctx.globalAlpha = Math.min(1, this.edgeT * 1.6);
      ctx.drawImage(e.canvas, 0, 0, W, H);
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
      const intro = clamp((this.bannerDur - t) / 0.18, 0, 1);
      const sc = 0.6 + 0.4 * easeOutCubic(intro);
      ctx.globalAlpha = Math.min(1, t / 0.25);
      place(ctx, W / 2, 640, sc);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${this.bannerSub ? 112 : 132}px ${this.font}`;
      ctx.lineWidth = 18;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(3,19,10,0.85)";
      ctx.strokeText(this.banner, 0, 0);
      ctx.fillStyle = P.cream;
      ctx.fillText(this.banner, 0, 0);
      if (this.bannerSub) {
        ctx.font = `800 56px ${this.font}`;
        ctx.lineWidth = 12;
        ctx.strokeText(this.bannerSub, 0, 96);
        ctx.fillStyle = this.phaseIdx === STAR_PHASES.length - 1 ? "#ff6b5e" : P.gold;
        ctx.fillText(this.bannerSub, 0, 96);
      }
      ctx.globalAlpha = 1;
    }
  }

  private renderHud(ctx: CanvasRenderingContext2D) {
    const remaining = Math.max(0, this.cfg.durationSec - this.elapsed);
    drawPlate(ctx, this.scorePlate, 40, 48, !this.q.extras);
    resetView(ctx, true);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = P.silver;
    ctx.font = `700 32px ${this.font}`;
    ctx.fillText(this.labels.score, 80, 100);
    drawNumber(ctx, this.font, String(Math.round(this.shown)), 76, 194, 100, this.scoreBump);
    // Streak multiplier chip, glowing hotter as it climbs.
    if (this.mult > 1) {
      if (this.mult >= 3 && this.q.extras) {
        const gl = this.mult >= this.cfg.maxMultiplier ? this.sprites.glowGold : this.sprites.glowRed;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.elapsed * 8);
        place(ctx, 550, 138, 0.9);
        ctx.drawImage(gl.canvas, -gl.cx, -gl.cy);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      const c = this.chip(`x${this.mult}`);
      place(ctx, 550, 138, 1 + 0.35 * this.multPop * this.multPop);
      ctx.drawImage(c.canvas, -c.w / 2, -c.h / 2);
    }
    // Streak meter: one star per catch toward the next multiplier.
    resetView(ctx, true);
    const step = this.cfg.comboStep;
    const filled = this.mult >= this.cfg.maxMultiplier ? step : this.streak % step;
    const pip = this.sprites.redStar;
    for (let i = 0; i < step && i < 10; i++) {
      const on = i < filled;
      ctx.globalAlpha = on ? 1 : 0.2;
      const sz = on && i === filled - 1 ? 40 + 8 * this.scoreBump : 36;
      ctx.drawImage(pip.canvas, 262 + i * 40 - (sz - 36) / 2, 140 - (sz - 36) / 2, sz, (sz * pip.h) / pip.w);
    }
    ctx.globalAlpha = 1;
    // Bonus window: gold plate with the multiplier and a draining bar.
    if (this.bonusT > 0) {
      const pop = 1 + 0.25 * this.bonusPop * this.bonusPop;
      drawPlate(ctx, this.bonusPlate, 40, 238, !this.q.extras);
      resetView(ctx, true);
      ctx.fillStyle = "rgba(255,201,74,0.22)";
      ctx.fillRect(64, 300, 252, 8);
      ctx.fillStyle = P.gold;
      ctx.fillRect(64, 300, 252 * clamp(this.bonusT / this.cfg.bonusSec, 0, 1), 8);
      place(ctx, 190, 276, pop);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 46px ${this.font}`;
      ctx.fillStyle = P.gold;
      ctx.fillText(`${this.labels.bonus} x${this.bonusMult}`, 0, 0);
    }
    // Timer ring with phase ticks: the round's structure, readable at a glance.
    resetView(ctx, true);
    const cx = 930;
    const cy = 132;
    const frac = remaining / this.cfg.durationSec;
    const urgent = remaining <= 5 && this.outro <= 0;
    const tp = this.timerPlate;
    if (this.q.extras) ctx.drawImage(tp.canvas, cx - 106, cy - 100);
    else {
      ctx.fillStyle = "rgba(5,36,17,0.85)";
      ctx.beginPath();
      ctx.arc(cx, cy, 92, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(201,207,203,0.16)";
    ctx.beginPath();
    ctx.arc(cx, cy, 74, 0, Math.PI * 2);
    ctx.stroke();
    const finalPush = this.phaseIdx === STAR_PHASES.length - 1;
    ctx.strokeStyle = urgent || finalPush ? P.starRed : this.bonusT > 0 ? P.gold : P.bright;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, 74, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.fillStyle = "rgba(3,19,10,0.9)";
    for (let i = 1; i < STAR_PHASES.length; i++) {
      // Ring runs down from full: a phase boundary at fraction `at` sits at 1 - at.
      const a = -Math.PI / 2 + Math.PI * 2 * (1 - STAR_PHASES[i].at);
      ctx.fillRect(cx + Math.cos(a) * 74 - 3, cy + Math.sin(a) * 74 - 3, 6, 6);
    }
    const pulse = urgent ? 1 + 0.14 * Math.max(0, Math.sin(this.elapsed * Math.PI * 2)) : 1;
    place(ctx, cx, cy + 4, pulse);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = urgent ? "#ff6b5e" : P.cream;
    ctx.font = `800 76px ${this.font}`;
    ctx.fillText(String(Math.ceil(remaining)), 0, 0);
  }
}
