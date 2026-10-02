"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { audio } from "@/game/engine/audio";
import type { GameResult } from "@/game/types";
import type { GameId, Prize } from "@/lib/config";
import type { Dict, RuleIcon } from "@/lib/i18n";
import { initialsAllowed } from "@/lib/initials";
import { getGlassIcon } from "../assets";
import type { BoardEntry } from "../sync";
import { Backdrop, BrandMark, OfficialStar, ProductHero, ResponsibleFooter } from "./parts";

const tap = () => audio.play("tap");
const back = () => audio.play("back");

const PlayGlyph = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </svg>
);

// ---------------------------------------------------------------- attract

export function Attract({ t, lite, onStart, onAdmin }: { t: Dict; lite: boolean; onStart: () => void; onAdmin: () => void }) {
  // Hidden staff access: hold the brand mark for 3 s.
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Promo line cycles slowly: one tiny text swap every few seconds, no running animation loop.
  const [promo, setPromo] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPromo((p) => (p + 1) % t.promos.length), 3600);
    return () => clearInterval(id);
  }, [t.promos.length]);
  return (
    <div className="absolute inset-0" onPointerDown={onStart}>
      <Backdrop lite={lite} />
      <div
        className="absolute left-0 top-0 z-10 h-[270px] w-full"
        onPointerDown={(e) => {
          e.stopPropagation();
          hold.current = setTimeout(onAdmin, 3000);
        }}
        onPointerUp={() => hold.current && clearTimeout(hold.current)}
        onPointerLeave={() => hold.current && clearTimeout(hold.current)}
      >
        <div className="flex h-full items-end justify-center">
          <BrandMark className="h-[210px] w-auto drop-shadow-[0_10px_30px_rgba(0,30,10,0.45)]" />
        </div>
      </div>
      <div className="absolute inset-x-0 top-[290px]">
        <ProductHero lite={lite} />
      </div>
      <div className="absolute inset-x-0 top-[1135px] flex flex-col items-center px-16 text-center">
        <h1 className="font-display text-[168px] font-bold uppercase leading-[0.9] tracking-tight text-cream drop-shadow-[0_8px_24px_rgba(0,30,10,0.5)]">
          {t.playAndWin}
        </h1>
        <div className="mt-6 flex items-center gap-5 font-display text-[44px] font-bold uppercase text-cream/90">
          <span>{t.games.star.name}</span>
          <OfficialStar size={46} />
          <span>{t.games.crate.name}</span>
        </div>
      </div>
      <div className="absolute inset-x-0 top-[1420px] flex h-[60px] justify-center overflow-hidden">
        <p key={promo} className="eyebrow animate-promo text-[34px] text-gold">
          {t.promos[promo]}
        </p>
      </div>
      <div className="absolute inset-x-0 top-[1530px] flex justify-center">
        <div className={`relative ${lite ? "" : "motion-safe-only animate-cta-beat"}`}>
          {!lite &&
            ["0s", "-0.8s"].map((delay) => (
              <span key={delay} className="motion-safe-only absolute inset-0 animate-cta-ring rounded-full bg-cream/45" style={{ animationDelay: delay }} aria-hidden />
            ))}
          <div className="btn-primary h-[156px] w-[740px] text-[60px]">
            {t.tapToStart}
            {!lite && <span className="motion-safe-only absolute inset-y-0 left-0 w-1/3 animate-shine bg-white/35" aria-hidden />}
          </div>
        </div>
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
    </div>
  );
}

// ---------------------------------------------------------------- game select

const CARD_FRAME = "inset 0 3px 0 rgba(255,255,255,0.16), inset 0 0 0 2px rgba(220,255,225,0.14), 0 40px 70px -30px rgba(0,22,9,0.9)";

export function Select({
  t,
  lite,
  best,
  onPick,
  onBoard,
  leaderboard,
}: {
  t: Dict;
  lite: boolean;
  best: Partial<Record<GameId, number>>;
  onPick: (g: GameId) => void;
  onBoard: () => void;
  leaderboard: boolean;
}) {
  // The chosen card swells and the other recedes for a beat before the screen changes.
  const [picked, setPicked] = useState<GameId | null>(null);
  const choose = (g: GameId) => {
    if (picked) return;
    audio.play("select");
    setPicked(g);
    setTimeout(() => onPick(g), 220);
  };
  const card = (g: GameId, art: React.ReactNode, background: string, delay: string) => (
    <button
      type="button"
      onClick={() => choose(g)}
      className={`group relative flex h-[520px] w-[960px] animate-rise-in items-center overflow-hidden rounded-[52px] text-left transition-[transform,opacity,filter] duration-200 ease-out active:scale-[0.97] ${
        picked === g ? "scale-[1.03] brightness-110" : picked ? "scale-[0.97] opacity-40" : ""
      }`}
      style={{ animationDelay: delay, background, boxShadow: CARD_FRAME }}
    >
      <div className="absolute inset-y-0 right-0 w-[480px]">{art}</div>
      <div className="relative z-10 flex h-full flex-col justify-center pl-16 pr-[430px]">
        <h2 className="font-display text-[104px] font-bold uppercase leading-[0.9] text-cream drop-shadow-[0_6px_18px_rgba(0,20,8,0.5)]">{t.games[g].name}</h2>
        <p className="mt-5 font-sans text-[36px] leading-snug text-cream/85">{t.games[g].tagline}</p>
        <div className="mt-9 flex items-center gap-6">
          <span className="flex h-[96px] w-[96px] items-center justify-center rounded-full text-cream" style={{ background: "linear-gradient(180deg,#ff4a3c,#c4000c)", boxShadow: "inset 0 2px 0 rgba(255,255,255,0.35), 0 12px 24px -8px rgba(160,8,4,0.8)" }}>
            <PlayGlyph className="ml-1 h-[52px] w-[52px]" />
          </span>
          {best[g] ? (
            <span className="rounded-full px-6 py-3 tile">
              <span className="eyebrow text-[24px] text-silver">{t.today}</span>
              <span className="tabular ml-3 font-display text-[40px] font-bold text-gold">{best[g]}</span>
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
  const glassIcon = getGlassIcon();
  const starArt = (
    <>
      {/* Stars keep falling into the glass: the game explained in one look. */}
      {!lite &&
        [
          { left: 110, size: 92, dur: "3.4s", delay: "0s" },
          { left: 290, size: 70, dur: "4.1s", delay: "-1.6s" },
          { left: 200, size: 58, dur: "3.7s", delay: "-2.7s" },
        ].map((s) => (
          <div key={s.left} className="motion-safe-only absolute top-0 animate-fall-loop" style={{ left: s.left, animationDuration: s.dur, animationDelay: s.delay }}>
            <OfficialStar size={s.size} />
          </div>
        ))}
      {lite && <OfficialStar size={100} className="absolute left-[90px] top-[50px] rotate-[-12deg]" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL: the in-game glass */}
      <img src={glassIcon} alt="" draggable={false} className="absolute bottom-[34px] left-1/2 h-[300px] w-auto -translate-x-1/2" style={{ filter: "drop-shadow(0 22px 22px rgba(0,25,8,0.45))" }} />
    </>
  );
  // Real crates stacked on a warehouse floor grid; each covers the open top of the one below.
  const crateArt = (
    <div className="absolute inset-0">
      <div
        className="absolute -right-20 bottom-[-40px] h-[260px] w-[700px] origin-bottom opacity-70"
        style={{
          transform: "perspective(500px) rotateX(58deg)",
          background: "repeating-linear-gradient(90deg, rgba(200,255,200,0.14) 0 2px, transparent 2px 70px), repeating-linear-gradient(0deg, rgba(200,255,200,0.12) 0 2px, transparent 2px 46px)",
        }}
      />
      {[0, 1, 2].map((i) => (
        // eslint-disable-next-line @next/next/no-img-element -- official crate packshot
        <img
          key={i}
          src="/assets/brand/crate.webp"
          alt=""
          draggable={false}
          className="absolute w-[250px]"
          style={{ left: 115 + [0, 26, -14][i], bottom: 24 + i * 146, filter: "drop-shadow(0 16px 18px rgba(0,25,8,0.45))" }}
        />
      ))}
    </div>
  );
  return (
    <div className="absolute inset-0">
      <Backdrop lite={lite} />
      <div className="relative flex h-full flex-col items-center pt-[110px]">
        <BrandMark className="h-[150px] w-auto" />
        <h1 className="mb-12 mt-10 font-display text-[96px] font-bold uppercase leading-none text-cream">{t.chooseGame}</h1>
        <div className="flex flex-col gap-12">
          {card("star", starArt, "radial-gradient(120% 140% at 88% 22%, #c0170d 0%, #6e1410 32%, #0d4c20 70%, #062d14 100%)", "0.05s")}
          {card("crate", crateArt, "linear-gradient(160deg, #23843a 0%, #0d5022 52%, #052812 100%)", "0.15s")}
        </div>
        {leaderboard && (
          <button
            type="button"
            onClick={() => {
              tap();
              onBoard();
            }}
            className="btn-secondary mt-14 h-[120px] w-[560px] gap-5 text-[44px]"
          >
            <svg viewBox="0 0 24 24" className="h-[48px] w-[48px] text-gold" fill="currentColor" aria-hidden>
              <path d="M7 3h10v2h3v3a4 4 0 01-4 4h-.3A5 5 0 0113 14.9V18h3v3H8v-3h3v-3.1A5 5 0 018.3 12H8a4 4 0 01-4-4V5h3zm0 4H6v1a2 2 0 001 1.7zm10 0v2.7A2 2 0 0018 8V7z" />
            </svg>
            {t.leaderboard}
          </button>
        )}
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
    </div>
  );
}

// ---------------------------------------------------------------- age gate

export function AgeGate({ t, minAge, onPass, onFail }: { t: Dict; minAge: number; onPass: () => void; onFail: () => void }) {
  const [d, setD] = useState("");
  const [m, setM] = useState("");
  const [y, setY] = useState("");
  const field = "h-[150px] rounded-[32px] tile text-center font-display text-[72px] font-bold text-cream outline-none ring-bright focus:ring-4";
  const valid = (() => {
    const dn = +d;
    const mn = +m;
    const yn = +y;
    if (!dn || !mn || y.length !== 4) return null;
    const date = new Date(Date.UTC(yn, mn - 1, dn));
    if (date.getUTCDate() !== dn || date.getUTCMonth() !== mn - 1 || yn < 1900) return null;
    return date;
  })();
  const submit = () => {
    if (!valid) return;
    const now = new Date();
    let age = now.getFullYear() - valid.getUTCFullYear();
    if (now.getMonth() < valid.getUTCMonth() || (now.getMonth() === valid.getUTCMonth() && now.getDate() < valid.getUTCDate())) age--;
    // Nothing is stored; the values only live in this component's memory.
    if (age >= minAge) onPass();
    else onFail();
  };
  return (
    <div className="absolute inset-0">
      <Backdrop lite />
      <div className="relative flex h-full flex-col items-center px-20 pt-[360px] text-center">
        <h1 className="font-display text-[110px] font-bold uppercase leading-none text-cream">{t.ageGate.title}</h1>
        <p className="mt-6 font-sans text-[38px] text-silver">{t.ageGate.body}</p>
        <div className="panel mt-16 grid w-full grid-cols-[1fr_1fr_1.6fr] gap-6 rounded-[48px] p-10">
          {[
            [t.ageGate.day, d, setD, 2],
            [t.ageGate.month, m, setM, 2],
            [t.ageGate.year, y, setY, 4],
          ].map(([label, v, set, len]) => (
            <label key={label as string} className="eyebrow flex flex-col gap-3 text-left text-[26px] text-silver">
              {label as string}
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={v as string}
                maxLength={len as number}
                onChange={(e) => (set as (s: string) => void)(e.target.value.replace(/\D/g, ""))}
                className={field}
              />
            </label>
          ))}
        </div>
        <button type="button" disabled={!valid} onClick={submit} className="btn-primary mt-16 h-[160px] w-[640px] text-[60px]">
          {t.ageGate.confirm}
        </button>
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
    </div>
  );
}

export function Denied({ t }: { t: Dict }) {
  return (
    <div className="absolute inset-0">
      <Backdrop lite />
      <div className="relative flex h-full items-center justify-center px-24 text-center">
        <p className="font-display text-[84px] font-bold uppercase leading-tight text-cream">{t.ageGate.denied}</p>
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
    </div>
  );
}

// ---------------------------------------------------------------- instructions

export function Intro({ t, game, icons, onStart, onBack }: { t: Dict; game: GameId; icons: Record<RuleIcon, string>; onStart: () => void; onBack: () => void }) {
  const g = t.games[game];
  const [starting, setStarting] = useState(false);
  return (
    <div className="absolute inset-0">
      <Backdrop lite tint={game} />
      <div className="relative flex h-full flex-col px-20 pt-[150px]">
        <div className="flex items-center gap-5">
          <span className="h-[6px] w-[64px] rounded-full bg-star" />
          <p className="eyebrow text-[40px] text-cream/80">{t.howToPlay}</p>
        </div>
        <h1 className="mt-4 font-display text-[140px] font-bold uppercase leading-[0.88] text-cream drop-shadow-[0_8px_24px_rgba(0,30,10,0.5)]">{g.name}</h1>
        <ul className="mt-14 flex flex-col gap-6">
          {g.rules.map((r, i) => (
            <li key={r.text} className="panel flex animate-slide-up items-center gap-10 rounded-[44px] py-5 pl-5 pr-10" style={{ animationDelay: `${0.1 + 0.08 * i}s` }}>
              <span className="flex h-[156px] w-[156px] shrink-0 items-center justify-center rounded-[34px] tile">
                {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
                <img src={icons[r.icon]} alt="" className="h-[124px] w-[124px] object-contain" draggable={false} />
              </span>
              <span className="font-sans text-[50px] font-bold leading-tight text-cream">{r.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-12 flex items-center justify-center gap-4 text-center font-sans text-[38px] text-cream/80">
          <svg viewBox="0 0 24 24" className="h-[52px] w-[52px] shrink-0 text-gold" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 11V5.5a1.5 1.5 0 013 0V10m0-1.5a1.5 1.5 0 013 0V11m0-1a1.5 1.5 0 013 0v4.5a6.5 6.5 0 01-6.5 6.5h-.7a6 6 0 01-4.6-2.2L4.6 15a1.5 1.5 0 012.3-1.9L9 15" />
          </svg>
          {g.control}
        </p>
        <div className="mt-auto flex flex-col items-center gap-8 pb-[170px]">
          <div className="relative">
            <span className="motion-safe-only absolute inset-0 animate-cta-ring rounded-full bg-cream/30" aria-hidden />
            <button
              type="button"
              onClick={() => {
                if (starting) return;
                setStarting(true);
                audio.play("select");
                onStart();
              }}
              className="btn-primary relative h-[180px] w-[760px] gap-6 text-[84px]"
            >
              <PlayGlyph className="h-[72px] w-[72px]" />
              {t.start}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              back();
              onBack();
            }}
            className="btn-secondary h-[110px] w-[400px] text-[40px]"
          >
            {t.back}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- countdown

/** 3-2-1 climb in pitch toward GO (rates of the same tick sample). */
const COUNT_RATE: Record<number, number> = { 3: 1, 2: 2 ** (2 / 12), 1: 2 ** (4 / 12) };

export function Countdown({ t, onDone }: { t: Dict; onDone: () => void }) {
  const [n, setN] = useState(3);
  const done = useRef(false);
  const finish = useEffectEvent(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  });
  useEffect(() => {
    audio.play("tick", COUNT_RATE[3]);
    const id = setInterval(() => {
      setN((v) => {
        const next = v - 1;
        if (next > 0) audio.play("tick", COUNT_RATE[next]);
        else if (next === 0) audio.play("go");
        return next;
      });
    }, 650);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (n < 0) finish();
  }, [n]);
  // Tap to skip straight to play.
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-ink/50"
      onPointerDown={() => {
        if (done.current) return;
        done.current = true;
        onDone();
      }}
    >
      {n > 0 && (
        <>
          <span key={`r${n}`} className="absolute left-1/2 top-1/2 h-[560px] w-[560px] animate-burst rounded-full border-[12px] border-cream/40" aria-hidden />
          <span key={n} className="tabular animate-count-in font-display text-[440px] font-bold leading-none text-cream" style={{ textShadow: "0 0 60px rgba(160,255,140,0.35), 0 14px 50px rgba(0,20,8,0.7)" }}>
            {n}
          </span>
        </>
      )}
      {n === 0 && (
        <>
          <svg viewBox="0 0 200 200" className="absolute left-1/2 top-1/2 h-[1400px] w-[1400px] animate-burst" aria-hidden>
            <polygon points="100,0 123,68 195,69 137,111 159,181 100,138 41,181 63,111 5,69 77,68" fill="#e3000f" opacity="0.55" />
          </svg>
          <span className="text-gold-foil relative animate-go-in font-display text-[380px] font-bold uppercase leading-none" style={{ filter: "drop-shadow(0 12px 40px rgba(120,60,0,0.6))" }}>
            {t.go}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- result

export type ResultData = {
  result: GameResult;
  prize: Prize | null;
  awardCode: string | null;
  isBest: boolean;
};

function CountUp({ to, ms = 1100 }: { to: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Writes the DOM directly: animating via React state would re-render every frame.
    const start = performance.now();
    let raf = 0;
    let lastTick = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      if (ref.current) ref.current.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
      // Rolling counter ticks, rising in pitch as the number climbs.
      if (to > 0 && k < 1 && now - lastTick > 75) {
        lastTick = now;
        audio.play("count", 1 + k * 0.6);
      }
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <span ref={ref}>{to}</span>;
}

/**
 * Score lands, locks in, then the stats and the "show staff" line settle: about two seconds.
 * No prize is shown on the kiosk: the organiser decides on site from the score.
 */
const LOCK_MS = 1150;
const REVEAL_MS = 1900;

export function Result({
  t,
  data,
  autoReturnSec,
  initialsSlot,
  onReplay,
  onOther,
  onTimeout,
}: {
  t: Dict;
  data: ResultData;
  autoReturnSec: number;
  initialsSlot: React.ReactNode;
  onReplay: () => void;
  onOther: () => void;
  onTimeout: () => void;
}) {
  const { result } = data;
  const [left, setLeft] = useState(autoReturnSec);
  const [phase, setPhase] = useState(0);
  const timeout = useEffectEvent(onTimeout);
  useEffect(() => {
    const id = setInterval(() => setLeft((v) => v - 1), 1000);
    const lock = setTimeout(() => {
      setPhase(1);
      audio.play("reveal");
    }, LOCK_MS);
    const reveal = setTimeout(() => {
      setPhase(2);
      audio.play("milestone");
    }, REVEAL_MS);
    return () => {
      clearInterval(id);
      clearTimeout(lock);
      clearTimeout(reveal);
    };
  }, []);
  useEffect(() => {
    if (left <= 0) timeout();
  }, [left]);
  // Any interaction restarts the auto-return clock.
  const touch = () => setLeft(autoReturnSec);

  const stats =
    result.game === "star"
      ? [
          [t.stats.caught, result.stats.caught],
          [t.stats.served, result.stats.served],
          [t.stats.bestCombo, `x${result.stats.bestCombo}`],
        ]
      : [
          [t.stats.height, result.stats.height],
          [t.stats.perfects, result.stats.perfects],
          [t.stats.bestCombo, `x${result.stats.bestCombo}`],
        ];

  return (
    <div className="absolute inset-0" onPointerDown={touch}>
      <Backdrop lite tint={result.game} />
      {/* Slow light rays behind the score once it locks in. */}
      {phase >= 1 && (
        <div
          className="motion-safe-only pointer-events-none absolute left-1/2 top-[760px] h-[1500px] w-[1500px] animate-spin-slow rounded-full"
          style={{
            background: "repeating-conic-gradient(from 0deg, rgba(255,214,100,0.12) 0deg 8deg, rgba(255,214,100,0) 8deg 22deg)",
            maskImage: "radial-gradient(circle, black 15%, transparent 65%)",
            WebkitMaskImage: "radial-gradient(circle, black 15%, transparent 65%)",
          }}
          aria-hidden
        />
      )}
      {/* Score centre stage: staff decide any prize on site from this number. */}
      <div className="relative flex h-full flex-col items-center px-16 text-center">
        <div className="flex flex-1 flex-col items-center justify-center pt-[120px]">
          <p className="eyebrow text-[48px] text-silver">{t.finalScore}</p>
          <p
            key={phase >= 1 ? "locked" : "counting"}
            className={`tabular font-display text-[340px] font-bold leading-[0.9] ${phase >= 1 ? "animate-stamp" : "animate-pop-in"} ${data.isBest ? "text-gold-foil" : "text-cream"}`}
            style={{ filter: "drop-shadow(0 14px 44px rgba(0,30,10,0.55))" }}
          >
            {phase >= 1 ? result.score : <CountUp to={result.score} />}
          </p>
          <div className="mt-4 flex h-[76px] items-center gap-4">
            {phase >= 1 && (
              <span className="flex animate-fade-in items-center gap-3 rounded-full px-6 py-2 tile">
                <svg viewBox="0 0 24 24" className="h-[34px] w-[34px] text-bright" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V8a4 4 0 018 0v3" />
                </svg>
                <span className="eyebrow text-[24px] text-cream/90">{t.scoreLocked}</span>
              </span>
            )}
            {phase >= 1 && data.isBest && <span className="eyebrow animate-stamp rounded-full bg-gold px-6 py-2 text-[26px] text-ink">{t.newBest}</span>}
          </div>
          <div className="mt-10 grid h-[190px] w-[940px] grid-cols-3 gap-6">
            {phase >= 1 &&
              stats.map(([label, v], i) => (
                <div key={label} className="flex animate-slide-up flex-col justify-center rounded-[36px] panel" style={{ animationDelay: `${i * 0.07}s` }}>
                  <p className="tabular font-display text-[92px] font-bold leading-none text-cream">{v}</p>
                  <p className="eyebrow mt-2 text-[24px] text-silver">{label}</p>
                </div>
              ))}
          </div>
          <p className={`mt-12 font-sans text-[40px] text-cream/85 transition-opacity duration-500 ${phase >= 2 ? "opacity-100" : "opacity-0"}`}>{t.showStaff}</p>
        </div>

        <div className="mt-auto flex w-full gap-8 pb-[150px]">
          <button
            type="button"
            onClick={() => {
              audio.play("select");
              onReplay();
            }}
            className="btn-primary h-[160px] flex-1 gap-5 text-[60px]"
          >
            <PlayGlyph className="h-[56px] w-[56px]" />
            {t.playAgain}
          </button>
          <button
            type="button"
            onClick={() => {
              tap();
              onOther();
            }}
            className="btn-secondary h-[160px] flex-1 text-[52px]"
          >
            {t.otherGame}
          </button>
        </div>
        <p className="tabular absolute bottom-[96px] font-sans text-[26px] text-silver/60">{left}s</p>
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
      {/* Bottom sheet over the result, so the screen never grows past 1920px. */}
      {initialsSlot && <div className="absolute inset-0 z-20 flex animate-fade-in items-end bg-ink/75 px-10 pb-16">{initialsSlot}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- initials

const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function InitialsEntry({ t, onSave, onSkip }: { t: Dict; onSave: (v: string) => void; onSkip: () => void }) {
  const [v, setV] = useState("");
  const [shake, setShake] = useState(false);
  const save = () => {
    if (!initialsAllowed(v)) {
      setShake(true);
      setV("");
      setTimeout(() => setShake(false), 400);
      return;
    }
    audio.play("select");
    onSave(v);
  };
  return (
    <div className="panel w-full animate-slide-up rounded-[52px] px-10 py-10">
      <p className="eyebrow text-[40px] text-gold">{t.enterInitials}</p>
      <div className={`mt-6 flex justify-center gap-5 ${shake ? "translate-x-3" : ""} transition-transform`}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`flex h-[136px] w-[116px] items-center justify-center rounded-[26px] font-display text-[100px] font-bold text-cream tile ${i === v.length ? "ring-4 ring-bright/70" : ""}`}
          >
            {v[i] ?? ""}
          </div>
        ))}
      </div>
      <div className="mt-7 grid grid-cols-9 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              tap();
              setV((s) => (s.length < 3 ? s + k : s));
            }}
            className="press h-[92px] rounded-[20px] font-display text-[48px] font-bold text-cream tile active:bg-forest"
          >
            {k}
          </button>
        ))}
        <button type="button" onClick={() => setV((s) => s.slice(0, -1))} className="press h-[92px] rounded-[20px] bg-ink font-display text-[40px] font-bold text-silver" aria-label="Backspace">
          ⌫
        </button>
      </div>
      <div className="mt-7 flex gap-6">
        <button type="button" onClick={onSkip} className="btn-secondary h-[110px] flex-1 text-[40px]">
          {t.skip}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={v.length !== 3}
          className="press h-[110px] flex-1 rounded-full font-display text-[44px] font-bold uppercase text-ink disabled:opacity-40"
          style={{ background: "linear-gradient(180deg,#5ee05a,#12a415)", boxShadow: "inset 0 2px 0 rgba(255,255,255,0.4)" }}
        >
          {t.save}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- leaderboard

const MEDAL = ["linear-gradient(180deg,#fff0b0,#ffc94a 50%,#c98a10)", "linear-gradient(180deg,#ffffff,#c9cfcb 55%,#8d968f)", "linear-gradient(180deg,#ffd2a8,#c77b3a 55%,#8a4b18)"];

export function Board({
  t,
  games,
  load,
  highlight,
  initialGame,
  onBack,
}: {
  t: Dict;
  games: GameId[];
  load: (g: GameId, scope: "daily" | "all") => Promise<BoardEntry[]>;
  highlight?: string;
  initialGame?: GameId;
  onBack: () => void;
}) {
  const [game, setGame] = useState<GameId>(initialGame && games.includes(initialGame) ? initialGame : games[0]);
  const [scope, setScope] = useState<"daily" | "all">("daily");
  // Rows are tagged with the tab they belong to, so switching tabs shows the skeleton
  // until that tab's data arrives (no setState-in-effect reset needed).
  const key = `${game}:${scope}`;
  const [data, setData] = useState<{ key: string; rows: BoardEntry[] } | null>(null);
  const rows = data?.key === key ? data.rows : null;
  useEffect(() => {
    let live = true;
    load(game, scope).then((r) => live && setData({ key: `${game}:${scope}`, rows: r }));
    return () => {
      live = false;
    };
  }, [game, scope, load]);
  const seg = (active: boolean) =>
    `press h-[96px] flex-1 rounded-full font-display text-[38px] font-bold uppercase transition-colors duration-150 ${active ? "bg-cream text-ink shadow-[0_8px_20px_-8px_rgba(0,0,0,0.5)]" : "text-silver"}`;
  return (
    <div className="absolute inset-0">
      <Backdrop lite />
      <div className="relative flex h-full flex-col px-16 pt-[140px]">
        <h1 className="text-center font-display text-[116px] font-bold uppercase leading-none text-cream">{t.leaderboard}</h1>
        {games.length > 1 && (
          <div className="mt-10 flex gap-2 rounded-full p-2 tile">
            {games.map((g) => (
              <button
                key={g}
                type="button"
                className={seg(g === game)}
                onClick={() => {
                  tap();
                  setGame(g);
                }}
              >
                {t.games[g].name}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-2 rounded-full p-2 tile">
          <button
            type="button"
            className={seg(scope === "daily")}
            onClick={() => {
              tap();
              setScope("daily");
            }}
          >
            {t.today}
          </button>
          <button
            type="button"
            className={seg(scope === "all")}
            onClick={() => {
              tap();
              setScope("all");
            }}
          >
            {t.allTime}
          </button>
        </div>
        <ol key={key} className="mt-10 flex flex-col gap-3">
          {rows === null && Array.from({ length: 6 }, (_, i) => <li key={i} className="h-[100px] animate-pulse rounded-[30px] tile" />)}
          {rows?.length === 0 && <li className="py-20 text-center font-sans text-[44px] text-silver">{t.noScores}</li>}
          {rows?.map((r, i) => (
            <li
              key={r.id}
              className={`flex h-[100px] animate-slide-up items-center gap-8 rounded-[30px] px-8 font-display text-[54px] font-bold ${
                r.id === highlight ? "bg-gold text-ink shadow-[0_0_40px_rgba(255,201,74,0.55)]" : i < 3 ? "panel text-cream" : "tile text-cream"
              }`}
              style={{ animationDelay: `${Math.min(i, 10) * 0.04}s` }}
            >
              {i < 3 ? (
                <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full text-[38px] text-ink shadow-[inset_0_2px_0_rgba(255,255,255,0.6)]" style={{ background: MEDAL[i] }}>
                  {i + 1}
                </span>
              ) : (
                <span className={`w-[68px] text-center ${r.id === highlight ? "text-ink/70" : "text-silver/70"}`}>{i + 1}</span>
              )}
              <span className="flex-1 tracking-[0.2em]">{r.initials ?? "---"}</span>
              <span className="tabular">{r.score}</span>
            </li>
          ))}
        </ol>
        <div className="mt-auto flex justify-center pb-[160px]">
          <button
            type="button"
            onClick={() => {
              back();
              onBack();
            }}
            className="btn-secondary h-[130px] w-[520px] text-[48px]"
          >
            {t.back}
          </button>
        </div>
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
    </div>
  );
}
