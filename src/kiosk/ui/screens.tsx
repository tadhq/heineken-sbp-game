"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { audio } from "@/game/engine/audio";
import type { GameResult } from "@/game/types";
import type { GameId, Prize } from "@/lib/config";
import type { Dict, RuleIcon } from "@/lib/i18n";
import { initialsAllowed } from "@/lib/session";
import type { BoardEntry } from "../sync";
import { Backdrop, BrandMark, HeroStar, ResponsibleFooter, StarSvg } from "./parts";

const tap = () => audio.play("tap");

// ---------------------------------------------------------------- attract

export function Attract({ t, lite, onStart, onAdmin }: { t: Dict; lite: boolean; onStart: () => void; onAdmin: () => void }) {
  // Hidden staff access: hold the brand mark for 3 s.
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div className="absolute inset-0" onPointerDown={onStart}>
      <Backdrop lite={lite} />
      <div
        className="absolute left-0 top-0 z-10 h-[200px] w-full"
        onPointerDown={(e) => {
          e.stopPropagation();
          hold.current = setTimeout(onAdmin, 3000);
        }}
        onPointerUp={() => hold.current && clearTimeout(hold.current)}
        onPointerLeave={() => hold.current && clearTimeout(hold.current)}
      >
        <div className="flex h-full items-end justify-center">
          <BrandMark className="h-[96px] text-[88px] leading-none" />
        </div>
      </div>
      <div className="absolute inset-x-0 top-[300px] flex justify-center">
        <div className={lite ? "" : "motion-safe-only animate-float"}>
          <HeroStar size={560} lite={lite} />
        </div>
      </div>
      <div className="absolute inset-x-0 top-[980px] flex flex-col items-center px-16 text-center">
        <h1 className="font-display text-[176px] font-bold uppercase leading-[0.9] tracking-tight text-cream">{t.playAndWin}</h1>
        <div className="mt-8 flex gap-5 font-display text-[44px] font-bold uppercase text-silver">
          <span>{t.games.star.name}</span>
          <StarSvg className="h-11 w-11 self-center" />
          <span>{t.games.crate.name}</span>
        </div>
      </div>
      <div className="absolute inset-x-0 top-[1480px] flex justify-center">
        <div className={`btn-primary h-[168px] w-[720px] text-[64px] ${lite ? "" : "motion-safe-only animate-pulse-soft"}`}>
          {t.tapToStart}
          {!lite && <span className="motion-safe-only absolute inset-y-0 left-0 w-1/3 animate-shine bg-white/20" aria-hidden />}
        </div>
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
    </div>
  );
}

// ---------------------------------------------------------------- game select

export function Select({
  t,
  icons,
  lite,
  best,
  onPick,
  onBoard,
  leaderboard,
}: {
  t: Dict;
  icons: Record<RuleIcon, string>;
  lite: boolean;
  best: Partial<Record<GameId, number>>;
  onPick: (g: GameId) => void;
  onBoard: () => void;
  leaderboard: boolean;
}) {
  const card = (g: GameId, icon: RuleIcon, accent: string, delay: string) => (
    <button
      type="button"
      onClick={() => {
        tap();
        onPick(g);
      }}
      className="group relative flex h-[560px] w-[940px] animate-rise-in items-center overflow-hidden rounded-[48px] border-2 border-silver/20 text-left transition-transform duration-150 active:scale-[0.98]"
      style={{ animationDelay: delay, background: `linear-gradient(135deg, ${accent} 0%, #062a14 70%)` }}
    >
      <div className="absolute -right-24 top-1/2 h-[560px] w-[560px] -translate-y-1/2 rounded-full bg-black/20" />
      {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
      <img src={icons[icon]} alt="" className="absolute right-6 top-1/2 h-[380px] w-[380px] -translate-y-1/2 object-contain" draggable={false} />
      <div className="relative z-10 flex h-full flex-col justify-center pl-16 pr-[420px]">
        <h2 className="font-display text-[100px] font-bold uppercase leading-[0.92] text-cream">{t.games[g].name}</h2>
        <p className="mt-5 font-sans text-[38px] leading-tight text-cream/85">{t.games[g].tagline}</p>
        {best[g] ? (
          <p className="mt-8 font-display text-[34px] font-bold uppercase text-gold">
            {t.today}: {best[g]}
          </p>
        ) : null}
      </div>
    </button>
  );
  return (
    <div className="absolute inset-0">
      <Backdrop lite={lite} />
      <div className="relative flex h-full flex-col items-center pt-[150px]">
        <BrandMark className="h-[70px] text-[64px] leading-none" />
        <h1 className="mb-14 mt-12 font-display text-[96px] font-bold uppercase text-cream">{t.chooseGame}</h1>
        <div className="flex flex-col gap-12">
          {card("star", "goldStar", "#7a1410", "0.05s")}
          {card("crate", "crate", "#13670b", "0.15s")}
        </div>
        {leaderboard && (
          <button
            type="button"
            onClick={() => {
              tap();
              onBoard();
            }}
            className="btn-secondary mt-14 h-[120px] w-[520px] text-[44px]"
          >
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
  const field = "h-[150px] rounded-[32px] border-2 border-silver/40 bg-ink/70 text-center font-display text-[72px] font-bold text-cream outline-none focus:border-bright";
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
        <div className="mt-16 grid w-full grid-cols-[1fr_1fr_1.6fr] gap-6">
          {[
            [t.ageGate.day, d, setD, 2],
            [t.ageGate.month, m, setM, 2],
            [t.ageGate.year, y, setY, 4],
          ].map(([label, v, set, len]) => (
            <label key={label as string} className="flex flex-col gap-3 text-left font-sans text-[30px] text-silver">
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
        <button type="button" disabled={!valid} onClick={submit} className="btn-primary mt-16 h-[160px] w-[640px] text-[60px] disabled:opacity-40">
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
  return (
    <div className="absolute inset-0">
      <Backdrop lite />
      <div className="relative flex h-full flex-col px-20 pt-[200px]">
        <p className="font-display text-[44px] font-bold uppercase text-bright">{t.howToPlay}</p>
        <h1 className="mt-2 font-display text-[132px] font-bold uppercase leading-[0.9] text-cream">{g.name}</h1>
        <ul className="mt-16 flex flex-col gap-8">
          {g.rules.map((r, i) => (
            <li
              key={r.text}
              className="flex animate-rise-in items-center gap-10 rounded-[40px] bg-ink/55 px-10 py-6"
              style={{ animationDelay: `${0.08 * i}s` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
              <img src={icons[r.icon]} alt="" className="h-[150px] w-[150px] object-contain" draggable={false} />
              <span className="font-sans text-[52px] font-bold leading-tight text-cream">{r.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-14 text-center font-sans text-[40px] text-silver">{g.control}</p>
        <div className="mt-auto flex flex-col items-center gap-8 pb-[200px]">
          <button
            type="button"
            onClick={() => {
              tap();
              onStart();
            }}
            className="btn-primary h-[180px] w-[760px] text-[80px]"
          >
            {t.start}
          </button>
          <button type="button" onClick={onBack} className="btn-secondary h-[110px] w-[400px] text-[40px]">
            {t.back}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- countdown

export function Countdown({ t, onDone }: { t: Dict; onDone: () => void }) {
  const [n, setN] = useState(3);
  const done = useRef(false);
  const finish = useEffectEvent(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  });
  useEffect(() => {
    audio.play("tick");
    const id = setInterval(() => {
      setN((v) => {
        const next = v - 1;
        if (next > 0) audio.play("tick");
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
      className="absolute inset-0 flex items-center justify-center bg-ink/45"
      onPointerDown={() => {
        if (done.current) return;
        done.current = true;
        onDone();
      }}
    >
      {n >= 0 && (
        <span key={n} className="animate-count font-display text-[420px] font-bold uppercase leading-none text-cream" style={{ textShadow: "0 12px 60px rgba(0,0,0,0.6)" }}>
          {n === 0 ? t.go : n}
        </span>
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

function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Writes the DOM directly: animating via React state would re-render every frame.
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 1100);
      if (ref.current) ref.current.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span ref={ref}>{to}</span>;
}

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
  const { result, prize } = data;
  const [left, setLeft] = useState(autoReturnSec);
  const timeout = useEffectEvent(onTimeout);
  useEffect(() => {
    const id = setInterval(() => setLeft((v) => v - 1), 1000);
    const reveal = setTimeout(() => audio.play(prize ? "prize" : "milestone"), 1300);
    return () => {
      clearInterval(id);
      clearTimeout(reveal);
    };
  }, [prize]);
  useEffect(() => {
    if (left <= 0) timeout();
  }, [left]);
  // Any interaction restarts the auto-return clock.
  const touch = () => setLeft(autoReturnSec);

  const stats =
    result.game === "star"
      ? [
          [t.stats.caught, result.stats.caught],
          [t.stats.golden, result.stats.golden],
          [t.stats.bestCombo, result.stats.bestCombo],
        ]
      : [
          [t.stats.height, result.stats.height],
          [t.stats.perfects, result.stats.perfects],
          [t.stats.bestCombo, result.stats.bestCombo],
        ];

  return (
    <div className="absolute inset-0" onPointerDown={touch}>
      <Backdrop lite />
      <div className="relative flex h-full flex-col items-center px-16 pt-[150px] text-center">
        <p className="font-display text-[52px] font-bold uppercase text-silver">{t.finalScore}</p>
        <p className="animate-pop-in font-display text-[260px] font-bold leading-[0.95] text-cream">
          <CountUp to={result.score} />
        </p>
        {data.isBest && <p className="mt-2 animate-rise-in font-display text-[48px] font-bold uppercase text-gold">{t.newBest}</p>}
        <div className="mt-10 grid w-full grid-cols-3 gap-6">
          {stats.map(([label, v]) => (
            <div key={label} className="rounded-[36px] bg-ink/60 px-6 py-6">
              <p className="font-display text-[80px] font-bold leading-none text-cream">{v}</p>
              <p className="mt-2 font-sans text-[30px] uppercase text-silver">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 w-full animate-rise-in" style={{ animationDelay: "1.2s" }}>
          {prize ? (
            <div className="relative overflow-hidden rounded-[56px] border-4 border-gold px-12 py-12" style={{ background: "linear-gradient(160deg, #3a2a05 0%, #062a14 65%)" }}>
              <p className="font-display text-[84px] font-bold uppercase leading-none text-gold">{t.congrats}</p>
              <p className="mt-4 font-sans text-[40px] text-cream/90">{t.youWon}</p>
              <div className="mt-6 flex items-center justify-center gap-10">
                {prize.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-configured URL (https or own path only, validated)
                  <img src={prize.imageUrl} alt="" className="h-[200px] w-[200px] rounded-[32px] object-cover" draggable={false} />
                )}
                <div>
                  <p className="font-display text-[110px] font-bold uppercase leading-[0.95] text-cream">{prize.name}</p>
                  {prize.description && <p className="mt-3 font-sans text-[36px] text-cream/80">{prize.description}</p>}
                </div>
              </div>
              <p className="mt-8 font-sans text-[34px] text-silver">{t.showStaff}</p>
              {data.awardCode && (
                <p className="mt-3 font-mono text-[56px] font-bold tracking-[0.2em] text-cream">
                  {t.code}: {data.awardCode}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-[56px] bg-ink/60 px-12 py-12">
              <p className="font-display text-[84px] font-bold uppercase leading-none text-cream">{t.thanks}</p>
              <p className="mt-5 font-sans text-[40px] text-silver">{t.tryAgainHint}</p>
            </div>
          )}
        </div>

        {initialsSlot}

        <div className="mt-auto flex w-full gap-8 pb-[150px]">
          <button
            type="button"
            onClick={() => {
              tap();
              onReplay();
            }}
            className="btn-primary h-[160px] flex-1 text-[60px]"
          >
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
        <p className="absolute bottom-[90px] font-sans text-[28px] text-silver/60">{left}s</p>
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
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
    onSave(v);
  };
  return (
    <div className="mt-10 w-full animate-rise-in rounded-[48px] border-2 border-bright/50 bg-ink/80 px-10 py-8">
      <p className="font-display text-[48px] font-bold uppercase text-bright">{t.enterInitials}</p>
      <div className={`mt-5 flex justify-center gap-5 ${shake ? "translate-x-3" : ""} transition-transform`}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-[130px] w-[110px] items-center justify-center rounded-[24px] border-2 border-silver/40 font-display text-[96px] font-bold text-cream">
            {v[i] ?? ""}
          </div>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-9 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              tap();
              setV((s) => (s.length < 3 ? s + k : s));
            }}
            className="h-[92px] rounded-[20px] bg-deep font-display text-[48px] font-bold text-cream active:scale-95 active:bg-forest"
          >
            {k}
          </button>
        ))}
        <button type="button" onClick={() => setV((s) => s.slice(0, -1))} className="h-[92px] rounded-[20px] bg-ink font-display text-[40px] font-bold text-silver active:scale-95" aria-label="Backspace">
          ⌫
        </button>
      </div>
      <div className="mt-6 flex gap-6">
        <button type="button" onClick={onSkip} className="btn-secondary h-[110px] flex-1 text-[40px]">
          {t.skip}
        </button>
        <button type="button" onClick={save} disabled={v.length !== 3} className="h-[110px] flex-1 rounded-full bg-bright font-display text-[44px] font-bold uppercase text-ink transition-transform active:scale-[0.97] disabled:opacity-40">
          {t.save}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- leaderboard

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
  const pill = (active: boolean) =>
    `h-[100px] flex-1 rounded-full font-display text-[40px] font-bold uppercase transition-colors ${active ? "bg-cream text-ink" : "bg-ink/60 text-silver"}`;
  return (
    <div className="absolute inset-0">
      <Backdrop lite />
      <div className="relative flex h-full flex-col px-16 pt-[150px]">
        <h1 className="text-center font-display text-[110px] font-bold uppercase text-cream">{t.leaderboard}</h1>
        {games.length > 1 && (
          <div className="mt-8 flex gap-4">
            {games.map((g) => (
              <button key={g} type="button" className={pill(g === game)} onClick={() => setGame(g)}>
                {t.games[g].name}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-4">
          <button type="button" className={pill(scope === "daily")} onClick={() => setScope("daily")}>
            {t.today}
          </button>
          <button type="button" className={pill(scope === "all")} onClick={() => setScope("all")}>
            {t.allTime}
          </button>
        </div>
        <ol className="mt-10 flex flex-col gap-3">
          {rows === null &&
            Array.from({ length: 6 }, (_, i) => <li key={i} className="h-[96px] animate-pulse rounded-[28px] bg-ink/50" />)}
          {rows?.length === 0 && <li className="py-20 text-center font-sans text-[44px] text-silver">{t.noScores}</li>}
          {rows?.map((r, i) => (
            <li
              key={r.id}
              className={`flex h-[96px] items-center gap-8 rounded-[28px] px-10 font-display text-[52px] font-bold ${
                r.id === highlight ? "bg-gold text-ink" : i < 3 ? "bg-deep text-cream" : "bg-ink/50 text-cream"
              }`}
            >
              <span className="w-[80px] text-silver/80">{i + 1}</span>
              <span className="flex-1 tracking-[0.2em]">{r.initials ?? "---"}</span>
              <span>{r.score}</span>
            </li>
          ))}
        </ol>
        <div className="mt-auto flex justify-center pb-[160px]">
          <button type="button" onClick={onBack} className="btn-secondary h-[130px] w-[520px] text-[48px]">
            {t.back}
          </button>
        </div>
      </div>
      <ResponsibleFooter text={t.responsible} notice={t.ageNotice} />
    </div>
  );
}
