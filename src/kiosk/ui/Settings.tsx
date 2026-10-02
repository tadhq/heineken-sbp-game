"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type AudioPrefs, audio } from "@/game/engine/audio";
import type { Dict } from "@/lib/i18n";

// ---------------------------------------------------------------- fullscreen

const fsSubscribe = (cb: () => void) => {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
};
const useFullscreen = () => useSyncExternalStore(fsSubscribe, () => !!document.fullscreenElement, () => false);

/**
 * Must run inside the tap's own event handler: browsers only grant fullscreen to a
 * fresh user activation. Resolves false (never throws) when it is not available; the
 * Stage and the game runner re-measure on the resulting resize, nothing reloads.
 */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (!document.fullscreenEnabled) return false;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- icons (one 2.5px stroke set)

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" className="h-[52px] w-[52px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
export const SpeakerIcon = ({ off }: { off?: boolean }) => (
  <Svg>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
    {off ? <path d="M16 9.5l5 5m0-5l-5 5" /> : <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />}
  </Svg>
);
const NoteIcon = ({ off }: { off?: boolean }) => (
  <Svg>
    <path d="M9 17.5V6l10-2v11.5" />
    <circle cx="6.5" cy="17.5" r="2.5" fill="currentColor" />
    <circle cx="16.5" cy="15.5" r="2.5" fill="currentColor" />
    {off && <path d="M3 3l18 18" />}
  </Svg>
);
const ExpandIcon = ({ exit }: { exit?: boolean }) => (
  <Svg>{exit ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</Svg>
);

// ---------------------------------------------------------------- hidden hotspot

const HOLD_MS = 1200;

/**
 * Invisible top-left corner for staff: press and HOLD 1.2 s to open settings. A tap,
 * a swipe through the corner or a finger that wanders off cancels, so players brushing
 * the corner never open it. A ring fills while holding, which is how staff discover it.
 * Not mounted during play.
 */
export function SettingsHotspot({ onOpen }: { onOpen: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => cancel, []);
  return (
    <div
      className="absolute left-0 top-0 z-40 h-[180px] w-[180px]"
      data-hotspot="settings"
      onPointerDown={(e) => {
        // Keep the tap from also reaching the screen below (e.g. "tap to start").
        e.stopPropagation();
        origin.current = { x: e.clientX, y: e.clientY };
        setHolding(true);
        timer.current = setTimeout(() => {
          cancel();
          onOpen();
        }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        if (timer.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 30) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {holding && (
        <svg viewBox="0 0 100 100" className="absolute left-[40px] top-[40px] h-[100px] w-[100px] -rotate-90 animate-fade-in" aria-hidden>
          <circle cx="50" cy="50" r="45" fill="rgb(3 19 10 / 0.5)" stroke="rgb(220 255 225 / 0.2)" strokeWidth="6" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="#f3f6f1" strokeWidth="6" strokeDasharray="283" className="animate-hold-ring" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- panel

type Props = {
  t: Dict;
  prefs: AudioPrefs;
  musicAllowed: boolean;
  sfxAllowed: boolean;
  onChange: (p: AudioPrefs) => void;
  onClose: () => void;
};

export function SettingsPanel({ t, prefs, musicAllowed, sfxAllowed, onChange, onClose }: Props) {
  const s = t.settings;
  const fullscreen = useFullscreen();
  const [fsFailed, setFsFailed] = useState(false);
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    audio.play("close");
    setClosing(true);
    setTimeout(onClose, 180);
  };
  useEffect(() => audio.play("open"), []);

  const slider = (key: "master" | "music" | "sfx", label: string, enabled: boolean, icon: React.ReactNode) => (
    <label className="flex items-center gap-7">
      <span className={`flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-[26px] tile ${enabled ? "text-cream" : "text-silver/40"}`}>{icon}</span>
      <span className="flex flex-1 flex-col">
        <span className="flex items-baseline justify-between font-display text-[38px] font-bold uppercase text-cream">
          {label}
          <span className="tabular font-sans text-[30px] font-bold text-silver">{enabled ? `${Math.round(prefs[key] * 100)}%` : s.off}</span>
        </span>
        <input
          type="range"
          className="range"
          min={0}
          max={100}
          step={1}
          disabled={!enabled}
          value={Math.round(prefs[key] * 100)}
          style={{ "--fill": `${prefs[key] * 100}%` } as React.CSSProperties}
          onChange={(e) => onChange({ ...prefs, [key]: Number(e.target.value) / 100 })}
          // Audible preview of the new level once the finger lifts.
          onPointerUp={() => key !== "music" && audio.play("tap")}
          aria-label={label}
        />
      </span>
    </label>
  );

  const toggle = (on: boolean, allowed: boolean, label: string, icon: (off: boolean) => React.ReactNode, flip: () => void) => (
    <button
      type="button"
      disabled={!allowed}
      onClick={() => {
        flip();
        audio.play("tap");
      }}
      aria-pressed={on && allowed}
      className={`press flex h-[150px] flex-1 flex-col items-center justify-center gap-2 rounded-[32px] font-display text-[30px] font-bold uppercase ${
        on && allowed ? "bg-bright/90 text-ink shadow-[inset_0_2px_0_rgba(255,255,255,0.35)]" : "tile text-silver"
      } disabled:opacity-50`}
    >
      {icon(!(on && allowed))}
      <span>
        {label}: {!allowed ? s.off : on ? s.on : s.off}
      </span>
    </button>
  );

  return (
    <div className={`absolute inset-0 z-50 flex items-center justify-center bg-ink/70 ${closing ? "animate-fade-out" : "animate-fade-in"}`} onPointerDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={s.title}
        className={`panel relative w-[880px] rounded-[56px] px-14 pb-14 pt-12 ${closing ? "" : "animate-modal-in"}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Brand hairline: the one red accent on this panel. */}
        <div className="absolute inset-x-24 top-0 h-[4px] rounded-b-full bg-star" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- official star */}
            <img src="/assets/brand/star.png" alt="" className="h-[72px] w-auto drop-shadow-[0_8px_16px_rgba(0,20,8,0.5)]" draggable={false} />
            <h2 className="font-display text-[64px] font-bold uppercase leading-none text-cream">{s.title}</h2>
          </div>
          <button type="button" onClick={close} aria-label={s.close} className="press flex h-[96px] w-[96px] items-center justify-center rounded-full tile text-cream">
            <svg viewBox="0 0 24 24" className="h-[44px] w-[44px]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-10 flex flex-col gap-6">
          {slider("master", s.master, true, <SpeakerIcon off={prefs.master === 0} />)}
          {slider("music", s.music, musicAllowed && prefs.musicOn, <NoteIcon off={!musicAllowed || !prefs.musicOn} />)}
          {slider("sfx", s.sfx, sfxAllowed && prefs.sfxOn, <SpeakerIcon off={!sfxAllowed || !prefs.sfxOn} />)}
        </div>

        <div className="mt-10 flex gap-5">
          {toggle(prefs.musicOn, musicAllowed, s.music, (off) => <NoteIcon off={off} />, () => onChange({ ...prefs, musicOn: !prefs.musicOn }))}
          {toggle(prefs.sfxOn, sfxAllowed, s.sfx, (off) => <SpeakerIcon off={off} />, () => onChange({ ...prefs, sfxOn: !prefs.sfxOn }))}
        </div>
        {(!musicAllowed || !sfxAllowed) && <p className="mt-4 text-center font-sans text-[26px] text-silver">{s.byAdmin}</p>}

        <button
          type="button"
          className="btn-secondary mt-8 h-[120px] w-full gap-5 text-[40px]"
          onClick={async () => {
            audio.play("tap");
            setFsFailed(!(await toggleFullscreen()));
          }}
        >
          <ExpandIcon exit={fullscreen} />
          {fullscreen ? s.exitFullscreen : s.fullscreen}
        </button>
        {fsFailed && <p className="mt-4 text-center font-sans text-[28px] text-silver">{s.fsUnavailable}</p>}

        <button type="button" onClick={close} className="btn-primary mt-6 h-[120px] w-full text-[46px]">
          {s.close}
        </button>
      </div>
    </div>
  );
}
