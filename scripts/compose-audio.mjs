#!/usr/bin/env node
/*
 * Original music and sound effects for the kiosk, composed and synthesised in code, then
 * encoded to Opus. Nothing is sampled or licensed: every sound comes from the oscillators,
 * filters and effects below, so the output is ours and fully reproducible (seeded noise).
 *
 *   node scripts/compose-audio.mjs        (needs ffmpeg with libopus on PATH)
 *
 * Music is rendered as loop stems (base + energy layer per game) that the runtime layers
 * and crossfades. Each loop is rendered with a tail that is folded back onto its start, so
 * reverb and delay ring across the loop point and the loop is gapless.
 *
 * Shared identity: every cue uses the same five-note "star motif" (E-A-G-E-D in A minor,
 * transposed per track), the prize sting resolves it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SR = 48000;
const OUT = new URL("../public/assets/", import.meta.url).pathname;

// ---------------------------------------------------------------- primitives

let seed = 1873;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const noise = () => rnd() * 2 - 1;
const NOTE = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const midi = (n) => (typeof n === "number" ? n : 12 * (Number(n.slice(-1)) + 1) + NOTE[n.slice(0, -1)]);
const hz = (n) => 440 * 2 ** ((midi(n) - 69) / 12);
const db = (d) => 10 ** (d / 20);

function polyblep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}
const OSC = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  tri: (p) => 1 - 4 * Math.abs(p - 0.5),
  saw: (p, dt) => 2 * p - 1 - polyblep(p, dt),
  square: (p, dt) => (p < 0.5 ? 1 : -1) + polyblep(p, dt) - polyblep((p + 0.5) % 1, dt),
};

class Biquad {
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  set(type, f, q = 0.707) {
    const w = (2 * Math.PI * Math.min(Math.max(f, 20), SR * 0.45)) / SR;
    const c = Math.cos(w);
    const a = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === "lp") [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else if (type === "hp") [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    else [b0, b1, b2] = [a, 0, -a];
    const a0 = 1 + a;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - a) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const bus = (sec) => ({ L: new Float32Array(Math.ceil(sec * SR)), R: new Float32Array(Math.ceil(sec * SR)) });
function put(b, i, v, pan = 0) {
  if (i < 0 || i >= b.L.length) return;
  const th = ((pan + 1) * Math.PI) / 4;
  b.L[i] += v * Math.cos(th) * Math.SQRT2;
  b.R[i] += v * Math.sin(th) * Math.SQRT2;
}

/** ADSR with exponential decay/release; `dur` is the gate length in seconds. */
function adsr(t, dur, a, d, s, r) {
  if (t < a) return t / a;
  if (t < dur) return s + (1 - s) * Math.exp(-(t - a) / Math.max(d, 1e-4));
  const atGate = dur < a ? dur / a : s + (1 - s) * Math.exp(-(dur - a) / Math.max(d, 1e-4));
  return atGate * Math.exp(-(t - dur) / Math.max(r, 1e-4));
}

/**
 * One synth note into a stereo bus. Options: wave, voices/detune (supersaw), a/d/s/r,
 * cutoff + env (filter sweep), q, gain, pan, spread, vib (vibrato depth in semitones).
 */
function note(b, t0, dur, n, o = {}) {
  const f0 = hz(n);
  const wave = OSC[o.wave ?? "saw"];
  const voices = o.voices ?? 1;
  const det = o.detune ?? 0.12;
  const a = o.a ?? 0.005;
  const d = o.d ?? 0.2;
  const s = o.s ?? 0.6;
  const r = o.r ?? 0.12;
  const len = Math.ceil((dur + r * 5) * SR);
  const start = Math.round(t0 * SR);
  const fl = new Biquad();
  const fr = new Biquad();
  const ph = Array.from({ length: voices }, () => rnd());
  const pans = Array.from({ length: voices }, (_, i) => (voices === 1 ? 0 : -1 + (2 * i) / (voices - 1)) * (o.spread ?? 0.7));
  const ratios = Array.from({ length: voices }, (_, i) => 2 ** (((voices === 1 ? 0 : -1 + (2 * i) / (voices - 1)) * det) / 12));
  const gain = (o.gain ?? 0.3) / Math.sqrt(voices);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if (i % 32 === 0) {
      const cut = (o.cutoff ?? 8000) + (o.env ?? 0) * Math.exp(-t / (o.envDecay ?? 0.15));
      fl.set("lp", cut, o.q ?? 0.8);
      fr.b0 = fl.b0;
      fr.b1 = fl.b1;
      fr.b2 = fl.b2;
      fr.a1 = fl.a1;
      fr.a2 = fl.a2;
    }
    const vib = o.vib ? 2 ** ((o.vib * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.25)) / 12) : 1;
    const glide = o.glideFrom ? 2 ** (((midi(o.glideFrom) - midi(n)) * Math.exp(-t / 0.05)) / 12) : 1;
    let l = 0;
    let rr = 0;
    for (let v = 0; v < voices; v++) {
      const f = f0 * ratios[v] * vib * glide;
      const dt = f / SR;
      ph[v] = (ph[v] + dt) % 1;
      const x = wave(ph[v], dt);
      const th = ((pans[v] + 1) * Math.PI) / 4;
      l += x * Math.cos(th);
      rr += x * Math.sin(th);
    }
    if (o.sub) {
      const x = Math.sin(2 * Math.PI * f0 * 0.5 * t) * o.sub;
      l += x;
      rr += x;
    }
    const e = adsr(t, dur, a, d, s, r) * gain;
    const pan = o.pan ?? 0;
    const th = ((pan + 1) * Math.PI) / 4;
    const j = start + i;
    if (j >= b.L.length) break;
    b.L[j] += fl.run(l) * e * Math.cos(th) * Math.SQRT2;
    b.R[j] += fr.run(rr) * e * Math.sin(th) * Math.SQRT2;
  }
}

/** FM bell: glassy, inharmonic when ratio is not an integer. */
function bell(b, t0, n, o = {}) {
  const f = typeof n === "number" && n > 200 ? n : hz(n);
  const dur = o.dur ?? 0.8;
  const ratio = o.ratio ?? 3.5;
  const idx = o.index ?? 2.2;
  const start = Math.round(t0 * SR);
  for (let i = 0; i < dur * SR; i++) {
    const t = i / SR;
    const env = Math.exp(-t / (o.decay ?? 0.25)) * Math.min(1, t / 0.002);
    const mod = Math.sin(2 * Math.PI * f * ratio * t) * idx * Math.exp(-t / ((o.decay ?? 0.25) * 0.4));
    put(b, start + i, Math.sin(2 * Math.PI * f * t + mod) * env * (o.gain ?? 0.3), o.pan ?? 0);
  }
}

function kick(b, t0, o = {}) {
  const start = Math.round(t0 * SR);
  let p = 0;
  const hp = new Biquad().set("hp", 2000);
  for (let i = 0; i < 0.45 * SR; i++) {
    const t = i / SR;
    const f = (o.low ?? 47) + ((o.high ?? 160) - (o.low ?? 47)) * Math.exp(-t / 0.032);
    p += f / SR;
    const body = Math.sin(2 * Math.PI * p) * Math.exp(-t / (o.decay ?? 0.17));
    const click = t < 0.006 ? hp.run(noise()) * (1 - t / 0.006) * 0.6 : 0;
    put(b, start + i, Math.tanh((body + click) * 1.6) * (o.gain ?? 0.9));
  }
}

// 808-style metallic source: six detuned squares, band-limited.
const HAT_F = [2, 3, 4.16, 5.43, 6.79, 8.21].map((r) => r * 41);
function hat(b, t0, o = {}) {
  const start = Math.round(t0 * SR);
  const bp = new Biquad().set("bp", 10000, 0.9);
  const hp = new Biquad().set("hp", o.open ? 6500 : 7500);
  const ph = HAT_F.map(() => rnd());
  const decay = o.open ? 0.16 : 0.035;
  for (let i = 0; i < decay * 6 * SR; i++) {
    const t = i / SR;
    let x = 0;
    for (let k = 0; k < 6; k++) {
      ph[k] = (ph[k] + HAT_F[k] / SR) % 1;
      x += ph[k] < 0.5 ? 1 : -1;
    }
    x = x / 6 + noise() * 0.4;
    put(b, start + i, hp.run(bp.run(x)) * Math.exp(-t / decay) * (o.gain ?? 0.25), o.pan ?? 0.15);
  }
}

function clap(b, t0, o = {}) {
  const start = Math.round(t0 * SR);
  const bp = new Biquad().set("bp", o.freq ?? 1300, 0.9);
  for (let i = 0; i < 0.35 * SR; i++) {
    const t = i / SR;
    // Three tight bursts, then the body: the classic hand-clap shape.
    const burst = [0, 0.011, 0.022].some((s) => t >= s && t < s + 0.009) ? 1 : 0;
    const env = burst * 0.9 + (t > 0.022 ? Math.exp(-(t - 0.022) / (o.decay ?? 0.09)) : 0);
    put(b, start + i, bp.run(noise()) * env * (o.gain ?? 0.5), o.pan ?? 0);
  }
}

function snare(b, t0, o = {}) {
  const start = Math.round(t0 * SR);
  const hp = new Biquad().set("hp", 1800);
  for (let i = 0; i < 0.3 * SR; i++) {
    const t = i / SR;
    const tone = Math.sin(2 * Math.PI * (190 + 60 * Math.exp(-t / 0.02)) * t) * Math.exp(-t / 0.05);
    put(b, start + i, (tone * 0.5 + hp.run(noise()) * Math.exp(-t / (o.decay ?? 0.08))) * (o.gain ?? 0.4), o.pan ?? 0);
  }
}

/** Woodblock-ish knock: the "crate" percussion voice. */
function knock(b, t0, o = {}) {
  const start = Math.round(t0 * SR);
  const f = o.freq ?? 1450;
  const bp = new Biquad().set("bp", f * 1.2, 4);
  for (let i = 0; i < 0.12 * SR; i++) {
    const t = i / SR;
    const x = (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.76 * t)) * Math.exp(-t / 0.022) + bp.run(noise()) * Math.exp(-t / 0.006) * 0.8;
    put(b, start + i, x * (o.gain ?? 0.3), o.pan ?? 0);
  }
}

function shaker(b, t0, o = {}) {
  const start = Math.round(t0 * SR);
  const bp = new Biquad().set("bp", 6200, 1.2);
  for (let i = 0; i < 0.09 * SR; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.03);
    put(b, start + i, bp.run(noise()) * env * (o.gain ?? 0.2), o.pan ?? -0.3);
  }
}

/** Filtered-noise sweep: risers, whooshes, swooshes. */
function sweep(b, t0, dur, f0, f1, o = {}) {
  const start = Math.round(t0 * SR);
  const bl = new Biquad();
  const br = new Biquad();
  for (let i = 0; i < dur * SR; i++) {
    const t = i / SR;
    const k = t / dur;
    if (i % 32 === 0) {
      bl.set("bp", f0 * (f1 / f0) ** k, o.q ?? 1.4);
      Object.assign(br, { b0: bl.b0, b1: bl.b1, b2: bl.b2, a1: bl.a1, a2: bl.a2 });
    }
    const shape = o.shape === "swell" ? k ** 2 : o.shape === "fall" ? (1 - k) ** 1.5 : Math.sin(Math.PI * k) ** 1.5;
    const g = shape * (o.gain ?? 0.4);
    const j = start + i;
    if (j >= b.L.length) break;
    b.L[j] += bl.run(noise()) * g;
    b.R[j] += br.run(noise()) * g;
  }
}

function crash(b, t0, o = {}) {
  const start = Math.round(t0 * SR);
  const hp = new Biquad().set("hp", 4500);
  const hp2 = new Biquad().set("hp", 4500);
  for (let i = 0; i < 2.2 * SR; i++) {
    const t = i / SR;
    const e = Math.exp(-t / (o.decay ?? 0.7)) * (o.gain ?? 0.18);
    const j = start + i;
    if (j >= b.L.length) break;
    b.L[j] += hp.run(noise()) * e;
    b.R[j] += hp2.run(noise()) * e;
  }
}

// ---------------------------------------------------------------- effects

/** Freeverb (Jezar's tunings): mono in, stereo out. */
function reverb(inp, len, o = {}) {
  const out = bus(len / SR);
  const k = SR / 44100;
  const room = o.room ?? 0.82;
  const damp = o.damp ?? 0.3;
  const mk = (d) => ({ buf: new Float32Array(Math.round(d * k)), i: 0, f: 0 });
  const combsL = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(mk);
  const combsR = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => mk(d + 23));
  const apL = [556, 441, 341, 225].map(mk);
  const apR = [556, 441, 341, 225].map((d) => mk(d + 23));
  const comb = (c, x) => {
    const y = c.buf[c.i];
    c.f = y * (1 - damp) + c.f * damp;
    c.buf[c.i] = x + c.f * room;
    c.i = (c.i + 1) % c.buf.length;
    return y;
  };
  const ap = (a, x) => {
    const y = a.buf[a.i];
    a.buf[a.i] = x + y * 0.5;
    a.i = (a.i + 1) % a.buf.length;
    return y - x;
  };
  for (let i = 0; i < len; i++) {
    const x = ((inp.L[i] + inp.R[i]) / 2) * 0.03;
    let l = 0;
    let r = 0;
    for (const c of combsL) l += comb(c, x);
    for (const c of combsR) r += comb(c, x);
    for (const a of apL) l = ap(a, l);
    for (const a of apR) r = ap(a, r);
    out.L[i] = l;
    out.R[i] = r;
  }
  return out;
}

/** Ping-pong delay with a darkening feedback path. */
function delay(inp, len, time, o = {}) {
  const out = bus(len / SR);
  const n = Math.round(time * SR);
  const bl = new Float32Array(n);
  const br = new Float32Array(n);
  const lp = new Biquad().set("lp", o.tone ?? 3500);
  const fb = o.feedback ?? 0.38;
  for (let i = 0; i < len; i++) {
    const j = i % n;
    const yl = bl[j];
    const yr = br[j];
    const x = (inp.L[i] + inp.R[i]) / 2;
    bl[j] = lp.run(x + yr * fb);
    br[j] = yl * fb;
    out.L[i] = yl;
    out.R[i] = yr;
  }
  return out;
}

/** Kick-keyed gain curve: the house "pump". */
function sidechain(len, times, depth, release = 0.16) {
  const g = new Float32Array(len).fill(1);
  for (const t of times) {
    const s = Math.round(t * SR);
    for (let i = 0; i < release * 3 * SR; i++) {
      const j = s + i;
      if (j >= len) break;
      const v = 1 - depth * Math.exp(-i / SR / release) * Math.min(1, i / (0.004 * SR));
      if (v < g[j]) g[j] = v;
    }
  }
  return g;
}

// ---------------------------------------------------------------- arrangement helpers

/**
 * A loop stem: named groups mixed with per-group reverb/delay sends and sidechain depth,
 * rendered with a tail that is folded back onto the start (seamless loop).
 */
function mixLoop(loopSec, groups, { kicks = [], delayTime = 0.3, room = 0.82 } = {}) {
  const TAIL = 2.5;
  const len = Math.ceil((loopSec + TAIL) * SR);
  const out = bus(len / SR);
  const revIn = bus(len / SR);
  const delIn = bus(len / SR);
  for (const g of Object.values(groups)) {
    const sc = g.duck ? sidechain(len, kicks, g.duck) : null;
    for (let i = 0; i < len; i++) {
      const k = (sc ? sc[i] : 1) * (g.gain ?? 1);
      const l = g.b.L[i] * k;
      const r = g.b.R[i] * k;
      out.L[i] += l;
      out.R[i] += r;
      if (g.rev) {
        revIn.L[i] += l * g.rev;
        revIn.R[i] += r * g.rev;
      }
      if (g.del) {
        delIn.L[i] += l * g.del;
        delIn.R[i] += r * g.del;
      }
    }
  }
  const rv = reverb(revIn, len, { room });
  const dl = delay(delIn, len, delayTime);
  for (let i = 0; i < len; i++) {
    out.L[i] += rv.L[i] + dl.L[i];
    out.R[i] += rv.R[i] + dl.R[i];
  }
  const n = Math.round(loopSec * SR);
  // Second fold catches anything longer than one tail (long reverb on the last bar).
  for (let i = n; i < len; i++) {
    out.L[i - n] += out.L[i];
    out.R[i - n] += out.R[i];
  }
  return { L: out.L.slice(0, n), R: out.R.slice(0, n) };
}

function grid(bpm) {
  const step = 60 / bpm / 4;
  return { step, at: (bar, s = 0) => (bar * 16 + s) * step, bar: step * 16 };
}

const groupsOf = (sec, names) => Object.fromEntries(names.map((n) => [n, { b: bus(sec + 2.5) }]));

// Chord voicings (voice-led) and roots.
const CH = {
  Am: ["A3", "C4", "E4"],
  F: ["A3", "C4", "F4"],
  C: ["G3", "C4", "E4"],
  G: ["G3", "B3", "D4"],
  Dm: ["D4", "F4", "A4"],
  Bb: ["D4", "F4", "Bb4"],
  Gm: ["D4", "G4", "Bb4"],
  A: ["C#4", "E4", "A4"],
};
const ROOT = { Am: "A1", F: "F1", C: "C2", G: "G1", Dm: "D2", Bb: "Bb1", Gm: "G1", A: "A1" };

// The star motif: [step, note, length in steps] per bar, one phrase per chord cycle.
const HOOK_A = [
  [[0, "E5", 2], [3, "A5", 2], [6, "G5", 2], [8, "E5", 4], [12, "D5", 2]],
  [[0, "C5", 3], [3, "D5", 3], [6, "E5", 2], [8, "A4", 6]],
  [[0, "E5", 2], [3, "A5", 2], [6, "G5", 2], [8, "C6", 4], [12, "B5", 2]],
  [[0, "G5", 3], [3, "A5", 3], [6, "B5", 2], [8, "D5", 6]],
];
const HOOK_D = [
  [[0, "A5", 2], [3, "D6", 2], [6, "C6", 2], [8, "A5", 4], [12, "G5", 2]],
  [[0, "F5", 3], [3, "G5", 3], [6, "A5", 2], [8, "D5", 6]],
  [[0, "A5", 2], [3, "D6", 2], [6, "C6", 2], [8, "Bb5", 4], [12, "A5", 2]],
  [[0, "E5", 3], [3, "G5", 3], [6, "A5", 2], [8, "C#6", 6]],
];

// ---------------------------------------------------------------- tracks

/** Star Catcher: bright four-on-the-floor house, 126 BPM, Am-F-C-G, 16 bars. */
function starTrack() {
  const bpm = 126;
  const g = grid(bpm);
  const sec = g.bar * 16;
  const prog = ["Am", "F", "C", "G"];
  const kicks = [];
  const base = groupsOf(sec, ["kick", "perc", "bass", "pad"]);
  const energy = groupsOf(sec, ["perc", "arp", "lead", "fx"]);
  for (let bar = 0; bar < 16; bar++) {
    const ch = prog[bar % 4];
    for (let beat = 0; beat < 4; beat++) {
      // Fill bars drop the last kick for a breath before the loop turns over.
      if (!((bar === 7 || bar === 15) && beat === 3)) {
        kick(base.kick.b, g.at(bar, beat * 4));
        kicks.push(g.at(bar, beat * 4));
      }
      hat(base.perc.b, g.at(bar, beat * 4 + 2), { open: true, gain: 0.16 });
      for (const s of [0, 1, 3]) hat(energy.perc.b, g.at(bar, beat * 4 + s), { gain: s === 0 ? 0.07 : 0.1, pan: -0.25 });
    }
    clap(base.perc.b, g.at(bar, 4), { gain: 0.42 });
    clap(base.perc.b, g.at(bar, 12), { gain: 0.42 });
    // Offbeat bass, octave pop on the last offbeat.
    for (const [s, oct] of [[2, 0], [6, 0], [10, 0], [14, 12]]) {
      note(base.bass.b, g.at(bar, s), g.step * 1.6, midi(ROOT[ch]) + 12 + oct, { wave: "saw", cutoff: 260, env: 1400, envDecay: 0.06, q: 1.1, s: 0.5, d: 0.08, r: 0.04, gain: 0.34, sub: 0.6 });
    }
    // Wide supersaw pad, pumped by the sidechain.
    for (const n of CH[ch]) note(base.pad.b, g.at(bar), g.bar * 0.98, n, { voices: 5, detune: 0.16, a: 0.02, d: 0.6, s: 0.7, r: 0.3, cutoff: 2400, env: 900, envDecay: 0.4, gain: 0.11 });
    // Energy: 16th pluck arpeggio over two octaves.
    const tones = [...CH[ch], ...CH[ch].map((n) => midi(n) + 12)].map(midi);
    const order = [0, 2, 4, 5, 3, 1, 2, 4];
    for (let s = 0; s < 16; s++) note(energy.arp.b, g.at(bar, s), g.step * 0.7, tones[order[s % 8]] + 12, { wave: "square", cutoff: 900, env: 3200, envDecay: 0.05, s: 0.1, d: 0.06, r: 0.05, gain: 0.07, pan: s % 2 ? 0.35 : -0.35 });
    // Hook in the second half of each eight-bar phrase.
    if (bar % 8 >= 4) for (const [s, n, l] of HOOK_A[bar % 4]) note(energy.lead.b, g.at(bar, s), g.step * l * 0.92, n, { wave: "saw", voices: 3, detune: 0.08, cutoff: 1800, env: 2600, envDecay: 0.12, s: 0.65, a: 0.006, r: 0.1, vib: 0.18, gain: 0.13 });
    clap(energy.perc.b, g.at(bar, 12), { gain: 0.2, freq: 1700, pan: 0.3 });
    for (let s = 0; s < 16; s += 2) shaker(energy.perc.b, g.at(bar, s + 1), { gain: 0.12 });
  }
  for (const bar of [7, 15]) for (let s = 8; s < 16; s++) snare(energy.perc.b, g.at(bar, s), { gain: 0.08 + (s - 8) * 0.03 });
  sweep(energy.fx.b, g.at(14), g.bar * 2, 300, 7000, { shape: "swell", gain: 0.16 });
  crash(energy.fx.b, g.at(0));
  crash(energy.fx.b, g.at(8), { gain: 0.12 });
  // The energy layer sits about 6 dB under the base: present when faded in, never a second song.
  for (const gr of Object.values(energy)) gr.gain = 2.6;
  const mix = (gr, room) => mixLoop(sec, gr, { kicks, delayTime: g.step * 3, room });
  base.kick.gain = 1;
  base.perc.rev = 0.15;
  base.bass.duck = 0.55;
  base.pad.duck = 0.7;
  base.pad.rev = 0.35;
  energy.arp.del = 0.4;
  energy.arp.rev = 0.25;
  energy.arp.duck = 0.4;
  energy.lead.del = 0.25;
  energy.lead.rev = 0.3;
  energy.perc.rev = 0.1;
  energy.fx.rev = 0.3;
  return { bpm, bars: 16, stems: { "star-base": mix(base), "star-energy": mix(energy) } };
}

/** Crate Stacker: tighter, syncopated, 116 BPM, Dm-Bb-Gm-A (tension on the dominant), 16 bars. */
function crateTrack() {
  const bpm = 116;
  const g = grid(bpm);
  const sec = g.bar * 16;
  const prog = ["Dm", "Bb", "Gm", "A"];
  const kicks = [];
  const base = groupsOf(sec, ["kick", "perc", "bass", "stab"]);
  const energy = groupsOf(sec, ["perc", "arp", "lead", "fx"]);
  for (let bar = 0; bar < 16; bar++) {
    const ch = prog[bar % 4];
    const kickSteps = bar % 2 ? [0, 6, 10, 13] : [0, 6, 10];
    for (const s of kickSteps) {
      kick(base.kick.b, g.at(bar, s), { decay: 0.14, high: 180 });
      kicks.push(g.at(bar, s));
    }
    snare(base.perc.b, g.at(bar, 4), { gain: 0.36 });
    snare(base.perc.b, g.at(bar, 12), { gain: 0.36 });
    // Ticking 16ths: the precision clock.
    for (let s = 0; s < 16; s++) hat(base.perc.b, g.at(bar, s), { gain: s % 4 === 2 ? 0.13 : 0.06, pan: 0.2 });
    // Crate knocks: the theme's own percussion.
    for (const [s, f] of [[3, 1450], [7, 1100], [14, 1450]]) knock(base.perc.b, g.at(bar, s), { freq: f, gain: 0.22, pan: s === 7 ? -0.4 : 0.4 });
    // Staccato ostinato bass.
    const r = midi(ROOT[ch]) + 12;
    [0, 0, 12, 0, 0, 7, 12, 0].forEach((iv, k) => note(base.bass.b, g.at(bar, k * 2), g.step * 1.1, r + iv, { wave: "square", cutoff: 300, env: 1100, envDecay: 0.05, s: 0.3, d: 0.06, r: 0.03, gain: 0.26, sub: 0.7 }));
    // Tresillo stabs.
    for (const s of [0, 3, 6, 8, 11, 14]) for (const n of CH[ch]) note(base.stab.b, g.at(bar, s), g.step * 0.6, n, { voices: 3, detune: 0.1, cutoff: 1200, env: 2800, envDecay: 0.05, s: 0.2, d: 0.07, r: 0.06, gain: 0.07 });
    // Energy: sixteenth arp, a little lower and darker than Star Catcher's.
    const tones = [...CH[ch], ...CH[ch].map((n) => midi(n) + 12)].map(midi);
    const order = [0, 1, 2, 3, 2, 1, 4, 5];
    for (let s = 0; s < 16; s++) note(energy.arp.b, g.at(bar, s), g.step * 0.6, tones[order[s % 8]], { wave: "saw", cutoff: 700, env: 2400, envDecay: 0.04, s: 0.1, d: 0.05, r: 0.04, gain: 0.07, pan: s % 2 ? 0.3 : -0.3 });
    if (bar >= 8) for (const [s, n, l] of HOOK_D[bar % 4]) note(energy.lead.b, g.at(bar, s), g.step * l * 0.9, midi(n) - 12, { wave: "square", voices: 2, detune: 0.06, cutoff: 1500, env: 2200, envDecay: 0.1, s: 0.6, r: 0.1, vib: 0.12, gain: 0.12 });
    clap(energy.perc.b, g.at(bar, 12), { gain: 0.24 });
    for (let s = 0; s < 16; s += 2) shaker(energy.perc.b, g.at(bar, s + 1), { gain: 0.1 });
    if (bar % 4 === 3) for (const s of [12, 13, 14, 15]) knock(energy.perc.b, g.at(bar, s), { freq: 900 + s * 60, gain: 0.18 });
  }
  sweep(energy.fx.b, g.at(15), g.bar, 400, 6000, { shape: "swell", gain: 0.14 });
  crash(energy.fx.b, g.at(0), { gain: 0.12 });
  for (const gr of Object.values(energy)) gr.gain = 2.6;
  const mix = (gr) => mixLoop(sec, gr, { kicks, delayTime: g.step * 3, room: 0.7 });
  base.perc.rev = 0.08;
  base.bass.duck = 0.35;
  base.stab.duck = 0.35;
  base.stab.rev = 0.2;
  base.stab.del = 0.15;
  energy.arp.del = 0.35;
  energy.arp.rev = 0.2;
  energy.lead.del = 0.2;
  energy.lead.rev = 0.25;
  energy.fx.rev = 0.3;
  return { bpm, bars: 16, stems: { "crate-base": mix(base), "crate-energy": mix(energy) } };
}

/** Menus: the same chords, half-time and warm, so the games feel like the "drop". 104 BPM, 8 bars. */
function lobbyTrack() {
  const bpm = 104;
  const g = grid(bpm);
  const sec = g.bar * 8;
  const prog = ["Am", "F", "C", "G"];
  const kicks = [];
  const gr = groupsOf(sec, ["kick", "perc", "bass", "pad", "lead"]);
  for (let bar = 0; bar < 8; bar++) {
    const ch = prog[bar % 4];
    for (const s of [0, 10]) {
      kick(gr.kick.b, g.at(bar, s), { gain: 0.6, decay: 0.2 });
      kicks.push(g.at(bar, s));
    }
    clap(gr.perc.b, g.at(bar, 8), { gain: 0.22, decay: 0.14 });
    for (let s = 2; s < 16; s += 4) hat(gr.perc.b, g.at(bar, s), { open: true, gain: 0.08 });
    for (let s = 0; s < 16; s += 2) shaker(gr.perc.b, g.at(bar, s + 1), { gain: 0.08 });
    note(gr.bass.b, g.at(bar), g.bar * 0.9, midi(ROOT[ch]) + 12, { wave: "tri", cutoff: 500, s: 0.8, a: 0.01, r: 0.2, gain: 0.32, sub: 0.5 });
    for (const n of CH[ch]) note(gr.pad.b, g.at(bar), g.bar, n, { voices: 4, detune: 0.12, a: 0.25, d: 1, s: 0.8, r: 0.6, cutoff: 1500, gain: 0.1 });
    if (bar >= 4) for (const [s, n, l] of HOOK_A[bar % 4]) bell(gr.lead.b, g.at(bar, s), n, { dur: g.step * l + 0.6, decay: 0.35, ratio: 2, index: 1.2, gain: 0.12, pan: s % 2 ? 0.2 : -0.2 });
  }
  gr.pad.duck = 0.3;
  gr.pad.rev = 0.4;
  gr.lead.rev = 0.45;
  gr.lead.del = 0.35;
  gr.perc.rev = 0.2;
  return { bpm, bars: 8, stems: { lobby: mixLoop(sec, gr, { kicks, delayTime: g.step * 3, room: 0.86 }) } };
}

// ---------------------------------------------------------------- sound effects

/** One-shot with optional reverb tail; returns trimmed stereo. */
function fx(sec, draw, rev = 0) {
  const b = bus(sec + (rev ? 1.5 : 0));
  draw(b);
  if (rev) {
    const len = b.L.length;
    const r = reverb({ L: b.L.map((x) => x * rev), R: b.R.map((x) => x * rev) }, len, { room: 0.78 });
    for (let i = 0; i < len; i++) {
      b.L[i] += r.L[i];
      b.R[i] += r.R[i];
    }
  }
  return b;
}

const clink = (b, t, gain = 0.12) => {
  for (let k = 0; k < 3; k++) bell(b, t + k * (0.012 + rnd() * 0.02), 2600 + rnd() * 2200, { ratio: 2.71, index: 1.5, decay: 0.05, dur: 0.25, gain: gain * (1 - k * 0.25), pan: rnd() - 0.5 });
};
function thud(b, t, f = 90, gain = 0.8) {
  kick(b, t, { high: f * 2.2, low: f * 0.6, decay: 0.09, gain });
  const bp = new Biquad().set("bp", 420, 1.2);
  for (let i = 0; i < 0.08 * SR; i++) put(b, Math.round(t * SR) + i, bp.run(noise()) * Math.exp(-i / SR / 0.02) * 0.6);
}

const SFX = {
  // UI
  tap: { gain: -14, mono: true, draw: () => fx(0.12, (b) => {
    bell(b, 0, 2200, { ratio: 1.5, index: 0.8, decay: 0.03, dur: 0.12, gain: 0.3 });
    kick(b, 0, { high: 300, low: 160, decay: 0.02, gain: 0.25 });
  }) },
  select: { gain: -10, draw: () => fx(0.45, (b) => {
    bell(b, 0, "E5", { ratio: 2, index: 1, decay: 0.12, dur: 0.4, gain: 0.25, pan: -0.15 });
    bell(b, 0.07, "A5", { ratio: 2, index: 1, decay: 0.18, dur: 0.4, gain: 0.3, pan: 0.15 });
    sweep(b, 0, 0.12, 2000, 6000, { gain: 0.08 });
  }, 0.25) },
  back: { gain: -12, draw: () => fx(0.35, (b) => {
    bell(b, 0, "A5", { ratio: 2, index: 1, decay: 0.1, dur: 0.3, gain: 0.25 });
    bell(b, 0.06, "E5", { ratio: 2, index: 1, decay: 0.14, dur: 0.3, gain: 0.25 });
  }, 0.2) },
  open: { gain: -12, draw: () => fx(0.45, (b) => {
    sweep(b, 0, 0.28, 500, 3500, { gain: 0.25, q: 1.1 });
    bell(b, 0.2, "A5", { ratio: 3, index: 0.8, decay: 0.15, dur: 0.25, gain: 0.2 });
  }, 0.3) },
  close: { gain: -13, draw: () => fx(0.35, (b) => {
    sweep(b, 0, 0.22, 3000, 500, { gain: 0.22, q: 1.1 });
    bell(b, 0.12, "E5", { ratio: 3, index: 0.8, decay: 0.1, dur: 0.2, gain: 0.18 });
  }, 0.2) },
  // Countdown (rate-shifted 3-2-1 by the caller) and the start stab.
  tick: { gain: -7, draw: () => fx(0.5, (b) => {
    bell(b, 0, "A4", { ratio: 2, index: 1.6, decay: 0.16, dur: 0.45, gain: 0.35 });
    kick(b, 0, { high: 140, low: 60, decay: 0.08, gain: 0.5 });
  }, 0.25) },
  go: { gain: -4, draw: () => fx(1.1, (b) => {
    kick(b, 0, { gain: 0.9 });
    for (const n of ["C4", "E4", "G4", "B4", "E5"]) note(b, 0, 0.32, n, { voices: 5, detune: 0.18, cutoff: 1800, env: 6000, envDecay: 0.12, s: 0.4, d: 0.15, r: 0.2, gain: 0.12 });
    crash(b, 0, { gain: 0.2, decay: 0.5 });
    sweep(b, 0, 0.25, 6000, 1500, { gain: 0.15, shape: "fall" });
  }, 0.35) },
  // Star Catcher
  catch: { gain: -6, draw: () => fx(0.45, (b) => {
    bell(b, 0, "A5", { ratio: 3.01, index: 1.4, decay: 0.12, dur: 0.4, gain: 0.32 });
    bell(b, 0, "E6", { ratio: 2, index: 0.6, decay: 0.08, dur: 0.3, gain: 0.14 });
    sweep(b, 0, 0.06, 7000, 9000, { gain: 0.08 });
  }, 0.2) },
  golden: { gain: -3, draw: () => fx(1.3, (b) => {
    kick(b, 0, { high: 120, low: 45, decay: 0.25, gain: 0.6 });
    ["A5", "C#6", "E6", "A6", "C#7"].forEach((n, i) => bell(b, i * 0.05, n, { ratio: 2, index: 1.3, decay: 0.3, dur: 1, gain: 0.2, pan: -0.5 + i * 0.25 }));
    sweep(b, 0, 1.1, 5000, 11000, { gain: 0.1, shape: "fall" });
  }, 0.45) },
  hazard: { gain: -4, mono: true, draw: () => fx(0.6, (b) => {
    thud(b, 0, 70, 0.9);
    note(b, 0, 0.3, "A2", { wave: "saw", glideFrom: "A3", cutoff: 900, env: 2500, envDecay: 0.08, s: 0.3, d: 0.1, r: 0.1, gain: 0.35 });
    sweep(b, 0.02, 0.4, 3500, 1800, { gain: 0.3, shape: "fall", q: 0.8 });
  }) },
  chill: { gain: -7, draw: () => fx(0.9, (b) => {
    sweep(b, 0, 0.35, 2000, 9000, { gain: 0.12, shape: "swell" });
    ["E7", "B6", "G#6"].forEach((n, i) => bell(b, 0.3 + i * 0.06, n, { ratio: 1.41, index: 1, decay: 0.25, dur: 0.6, gain: 0.14, pan: (i - 1) * 0.5 }));
  }, 0.5) },
  dodge: { gain: -11, draw: () => fx(0.3, (b) => sweep(b, 0, 0.24, 2600, 700, { gain: 0.35, q: 1.6 })) },
  combo: { gain: -6, draw: () => fx(0.8, (b) => {
    sweep(b, 0, 0.25, 800, 6000, { gain: 0.15, shape: "swell" });
    for (const n of ["A4", "C#5", "E5", "A5"]) note(b, 0.22, 0.25, n, { voices: 4, detune: 0.14, cutoff: 2000, env: 5000, envDecay: 0.1, s: 0.4, r: 0.18, gain: 0.1 });
  }, 0.35) },
  miss: { gain: -16, mono: true, draw: () => fx(0.3, (b) => note(b, 0, 0.14, "E4", { wave: "sine", glideFrom: "B4", s: 0.6, d: 0.1, r: 0.06, gain: 0.4 })) },
  milestone: { gain: -8, draw: () => fx(0.9, (b) => ["A5", "C#6", "E6"].forEach((n, i) => bell(b, i * 0.03, n, { ratio: 2, index: 1, decay: 0.3, dur: 0.8, gain: 0.16, pan: (i - 1) * 0.4 })), 0.35) },
  end: { gain: -5, draw: () => fx(1.8, (b) => {
    ["E5", "D5", "C5", "A4"].forEach((n, i) => bell(b, i * 0.14, n, { ratio: 2, index: 1.2, decay: i === 3 ? 0.6 : 0.2, dur: 1.2, gain: 0.24 }));
    for (const n of ["A3", "C4", "E4"]) note(b, 0.42, 0.9, n, { voices: 4, a: 0.05, cutoff: 1400, s: 0.7, r: 0.4, gain: 0.07 });
  }, 0.4) },
  // Crate Stacker
  slide: { gain: -20, mono: true, draw: () => fx(0.18, (b) => sweep(b, 0, 0.16, 1200, 2400, { gain: 0.3, q: 2 })) },
  drop: { gain: -12, mono: true, draw: () => fx(0.2, (b) => sweep(b, 0, 0.18, 3000, 900, { gain: 0.35, q: 1.4, shape: "fall" })) },
  land: { gain: -5, mono: true, draw: () => fx(0.4, (b) => {
    thud(b, 0, 95, 0.85);
    clink(b, 0.01, 0.1);
  }) },
  slice: { gain: -8, mono: true, draw: () => fx(0.4, (b) => {
    const bp = new Biquad().set("bp", 1600, 2);
    for (let i = 0; i < 0.3 * SR; i++) {
      const t = i / SR;
      put(b, i, bp.run(noise()) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 38 * t)) * Math.exp(-t / 0.1) * 0.5);
    }
    sweep(b, 0.05, 0.3, 2000, 500, { gain: 0.2, shape: "fall" });
  }) },
  perfect: { gain: -4, draw: () => fx(1.1, (b) => {
    thud(b, 0, 100, 0.8);
    clink(b, 0.01, 0.1);
    ["A5", "E6", "A6"].forEach((n, i) => bell(b, 0.02 + i * 0.035, n, { ratio: 2, index: 1.4, decay: 0.28, dur: 0.9, gain: 0.2, pan: (i - 1) * 0.45 }));
    sweep(b, 0.02, 0.6, 7000, 12000, { gain: 0.06, shape: "fall" });
  }, 0.4) },
  unstable: { gain: -9, mono: true, draw: () => fx(0.9, (b) => {
    const bp = new Biquad();
    for (let i = 0; i < 0.8 * SR; i++) {
      const t = i / SR;
      if (i % 32 === 0) bp.set("bp", 260 + 120 * Math.sin(2 * Math.PI * 3.1 * t), 9);
      const crk = (Math.sin(2 * Math.PI * 23 * t) > 0.6 ? 1 : 0.25) * Math.sin((Math.PI * t) / 0.8);
      put(b, i, bp.run(noise()) * crk * 0.9);
    }
  }) },
  fall: { gain: -5, draw: () => fx(1.5, (b) => {
    sweep(b, 0, 0.7, 2500, 300, { gain: 0.3, shape: "fall" });
    thud(b, 0.65, 70, 0.8);
    for (let k = 0; k < 9; k++) clink(b, 0.66 + rnd() * 0.25, 0.08);
  }, 0.25) },
  // Star Catcher, beer glass and phases (redesign pass)
  perfectCatch: { gain: -5, draw: () => fx(0.7, (b) => {
    bell(b, 0, "E6", { ratio: 3.01, index: 1.2, decay: 0.16, dur: 0.5, gain: 0.3 });
    bell(b, 0.03, "B6", { ratio: 2, index: 0.8, decay: 0.2, dur: 0.6, gain: 0.18, pan: 0.3 });
    clink(b, 0, 0.09);
    sweep(b, 0, 0.3, 6000, 12000, { gain: 0.07, shape: "fall" });
  }, 0.3) },
  // Fill cue, played at rising rates for 25/50/75%: fizz swell plus rising bubble pops.
  fill: { gain: -10, draw: () => fx(0.55, (b) => {
    sweep(b, 0, 0.4, 1500, 5000, { gain: 0.12, shape: "swell", q: 0.7 });
    for (let k = 0; k < 6; k++) note(b, 0.04 + k * 0.05, 0.05, 72 + k * 2 + Math.round(rnd() * 2), { wave: "sine", glideFrom: 66 + k * 2, s: 0.3, d: 0.03, r: 0.03, gain: 0.16, pan: rnd() - 0.5 });
  }, 0.2) },
  full: { gain: -3, draw: () => fx(1.6, (b) => {
    sweep(b, 0, 0.5, 800, 9000, { gain: 0.16, shape: "swell" });
    kick(b, 0.42, { high: 130, low: 50, decay: 0.3, gain: 0.7 });
    ["A5", "C#6", "E6", "A6"].forEach((n, i) => bell(b, 0.42 + i * 0.04, n, { ratio: 2, index: 1.2, decay: 0.35, dur: 1.1, gain: 0.18, pan: -0.45 + i * 0.3 }));
    const bp = new Biquad().set("bp", 5200, 0.8);
    for (let i = 0; i < 1.0 * SR; i++) {
      const t = i / SR;
      // Foam crackle: sparse noise grains, decaying.
      if (rnd() < 0.04) put(b, Math.round(0.42 * SR) + i, bp.run(noise()) * Math.exp(-t / 0.4) * 0.5, rnd() - 0.5);
    }
  }, 0.4) },
  serve: { gain: -8, draw: () => fx(0.7, (b) => {
    sweep(b, 0, 0.45, 600, 3200, { gain: 0.22, q: 1.2 });
    clink(b, 0.36, 0.14);
  }, 0.25) },
  bonus: { gain: -4, draw: () => fx(1.2, (b) => {
    sweep(b, 0, 0.35, 400, 7000, { gain: 0.16, shape: "swell" });
    kick(b, 0.32, { gain: 0.8, decay: 0.25 });
    for (const n of ["A4", "E5", "A5", "C#6"]) note(b, 0.32, 0.45, n, { voices: 5, detune: 0.16, cutoff: 2600, env: 6000, envDecay: 0.15, s: 0.5, r: 0.3, gain: 0.09 });
    crash(b, 0.32, { gain: 0.12, decay: 0.5 });
  }, 0.35) },
  phase: { gain: -6, draw: () => fx(1.0, (b) => {
    sweep(b, 0, 0.5, 300, 6000, { gain: 0.2, shape: "swell", q: 0.9 });
    kick(b, 0.48, { high: 100, low: 40, decay: 0.35, gain: 0.8 });
    bell(b, 0.48, "E5", { ratio: 2, index: 1.4, decay: 0.3, dur: 0.6, gain: 0.16 });
  }, 0.35) },
  spill: { gain: -7, mono: true, draw: () => fx(0.6, (b) => {
    const bp = new Biquad();
    for (let i = 0; i < 0.5 * SR; i++) {
      const t = i / SR;
      if (i % 64 === 0) bp.set("bp", 2400 - t * 3200, 1.4);
      put(b, i, bp.run(noise()) * Math.exp(-t / 0.14) * 0.7);
    }
  }) },
  riser: { gain: -8, draw: () => fx(1.8, (b) => {
    sweep(b, 0, 1.6, 200, 8000, { gain: 0.22, shape: "swell", q: 1.1 });
    for (let k = 0; k < 8; k++) knock(b, 0.8 + k * 0.1 * (1 - k * 0.06), { freq: 1600 + k * 120, gain: 0.08 + k * 0.02 });
  }, 0.3) },
  // Crate Stacker (redesign pass)
  great: { gain: -6, draw: () => fx(0.8, (b) => {
    thud(b, 0, 98, 0.8);
    clink(b, 0.01, 0.1);
    ["E5", "A5"].forEach((n, i) => bell(b, 0.02 + i * 0.04, n, { ratio: 2, index: 1.2, decay: 0.2, dur: 0.6, gain: 0.16, pan: (i - 0.5) * 0.6 }));
  }, 0.3) },
  stage: { gain: -4, draw: () => fx(1.4, (b) => {
    kick(b, 0, { gain: 0.8 });
    ["D5", "F5", "A5", "D6"].forEach((n, i) => note(b, i * 0.08, 0.22, n, { voices: 4, detune: 0.14, cutoff: 2400, env: 5000, envDecay: 0.1, s: 0.5, r: 0.2, gain: 0.11 }));
    crash(b, 0.24, { gain: 0.14, decay: 0.7 });
  }, 0.4) },
  goldCrate: { gain: -7, draw: () => fx(1.0, (b) => {
    ["D6", "F#6", "A6", "D7"].forEach((n, i) => bell(b, i * 0.06, n, { ratio: 2, index: 1.1, decay: 0.3, dur: 0.8, gain: 0.15, pan: -0.5 + i * 0.33 }));
  }, 0.45) },
  topple: { gain: -3, draw: () => fx(1.6, (b) => {
    thud(b, 0, 55, 1);
    kick(b, 0.02, { high: 90, low: 32, decay: 0.45, gain: 0.8 });
    for (let k = 0; k < 14; k++) clink(b, 0.03 + rnd() * 0.5, 0.07);
    const lp = new Biquad().set("lp", 900, 0.7);
    for (let i = 0; i < 0.9 * SR; i++) put(b, i, lp.run(noise()) * Math.exp(-i / SR / 0.25) * 0.5);
  }, 0.3) },
  // Result and prize
  count: { gain: -20, mono: true, draw: () => fx(0.05, (b) => bell(b, 0, 1900, { ratio: 1, index: 0.3, decay: 0.012, dur: 0.05, gain: 0.4 })) },
  reveal: { gain: -4, draw: () => fx(1.2, (b) => {
    sweep(b, 0, 0.4, 400, 5000, { gain: 0.15, shape: "swell" });
    kick(b, 0.4, { high: 110, low: 38, decay: 0.4, gain: 0.9 });
    knock(b, 0.4, { freq: 2400, gain: 0.3 });
    crash(b, 0.4, { gain: 0.12, decay: 0.6 });
  }, 0.4) },
  unlock: { gain: -6, draw: () => fx(1.3, (b) => {
    ["A4", "C#5", "E5", "A5", "C#6", "E6"].forEach((n, i) => bell(b, i * 0.055, n, { ratio: 2, index: 1.1, decay: 0.25, dur: 0.9, gain: 0.17, pan: -0.6 + i * 0.24 }));
    sweep(b, 0.2, 0.9, 6000, 12000, { gain: 0.07, shape: "fall" });
  }, 0.45) },
  // Signature sting: the star motif, resolved to A major.
  prize: { gain: -2, draw: () => fx(3.2, (b) => {
    [["E5", 0], ["A5", 0.16], ["G5", 0.32], ["E5", 0.48]].forEach(([n, t]) => {
      note(b, t, 0.14, n, { voices: 3, detune: 0.1, cutoff: 1800, env: 3500, envDecay: 0.1, s: 0.6, r: 0.12, gain: 0.14 });
      bell(b, t, n, { ratio: 2, index: 1, decay: 0.2, dur: 0.6, gain: 0.12 });
    });
    kick(b, 0.68, { gain: 0.9, decay: 0.3 });
    for (const n of ["A3", "E4", "A4", "C#5", "E5", "A5"]) note(b, 0.68, 1.3, n, { voices: 5, detune: 0.16, a: 0.01, cutoff: 2600, env: 5000, envDecay: 0.3, s: 0.65, r: 0.7, gain: 0.07 });
    ["A6", "E6", "C#7", "A6", "E7"].forEach((n, i) => bell(b, 0.75 + i * 0.09, n, { ratio: 3, index: 0.9, decay: 0.2, dur: 0.7, gain: 0.07, pan: -0.6 + i * 0.3 }));
    crash(b, 0.68, { gain: 0.16, decay: 1 });
  }, 0.5) },
};

// ---------------------------------------------------------------- output

function peak(...chs) {
  let p = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p;
}

function wav(path, chans) {
  const n = chans[0].length;
  const buf = Buffer.alloc(44 + n * chans.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * chans.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(chans.length, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * chans.length * 2, 28);
  buf.writeUInt16LE(chans.length * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * chans.length * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (const c of chans) {
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), o);
      o += 2;
    }
  writeFileSync(path, buf);
}

function encode(tmp, name, chans, dir, kbps) {
  const w = join(tmp, `${name}.wav`);
  wav(w, chans);
  mkdirSync(join(OUT, dir), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", w, "-c:a", "libopus", "-b:a", `${kbps}k`, "-vbr", "on", "-application", "audio", join(OUT, dir, `${name}.ogg`)]);
}

const tmp = mkdtempSync(join(tmpdir(), "kiosk-audio-"));
try {
  const only = process.argv[2];
  if (!only || only === "music") {
    for (const make of [lobbyTrack, starTrack, crateTrack]) {
      const t = make();
      const names = Object.keys(t.stems);
      // One gain for all stems of a track so their sum (what plays at full energy) peaks at -1 dBFS.
      const sumL = t.stems[names[0]].L.map((_, i) => names.reduce((s, n) => s + t.stems[n].L[i], 0));
      const sumR = t.stems[names[0]].R.map((_, i) => names.reduce((s, n) => s + t.stems[n].R[i], 0));
      const g = db(-1) / peak(sumL, sumR);
      for (const n of names) {
        const s = t.stems[n];
        encode(tmp, n, [s.L.map((x) => x * g), s.R.map((x) => x * g)], "music", 112);
        console.log(`music/${n}.ogg  ${t.bpm} BPM, ${t.bars} bars, ${(s.L.length / SR).toFixed(3)} s`);
      }
    }
  }
  if (!only || only === "sfx") {
    for (const [name, def] of Object.entries(SFX)) {
      seed = 1873 + name.length * 97;
      const b = def.draw();
      // Trim silence at the end.
      let end = b.L.length;
      while (end > 1 && Math.abs(b.L[end - 1]) < 1e-4 && Math.abs(b.R[end - 1]) < 1e-4) end--;
      const L = b.L.slice(0, end + 64);
      const R = b.R.slice(0, end + 64);
      const g = db(def.gain) / peak(L, R);
      const fade = (c) => c.map((x, i) => x * g * Math.min(1, (c.length - i) / 480));
      encode(tmp, name, def.mono ? [fade(L.map((x, i) => (x + R[i]) / 2))] : [fade(L), fade(R)], "sfx", def.mono ? 48 : 80);
    }
    console.log(`sfx: ${Object.keys(SFX).length} files`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
