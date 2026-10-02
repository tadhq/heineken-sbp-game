"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { type AudioPrefs, audio, type TrackId } from "@/game/engine/audio";
import type { QualityLevel } from "@/game/engine/runner";
import type { GameResult } from "@/game/types";
import { DEFAULT_CONFIG, type GameId, resolvePrize, type VersionedConfig } from "@/lib/config";
import { DICTS } from "@/lib/i18n";
import type { SessionPayload } from "@/lib/session";
import { getIcons, preloadAssets } from "./assets";
import { loadAudioPrefs, saveAudioPrefs } from "./audio-prefs";
import { store, uuid } from "./store";
import { flush, getBoard, loadCachedConfig, logError, refreshConfig } from "./sync";
import { GameView } from "./ui/GameView";
import { AgeGate, Attract, Board, Countdown, Denied, InitialsEntry, Intro, Result, type ResultData, Select } from "./ui/screens";
import { SettingsHotspot, SettingsPanel, SpeakerIcon } from "./ui/Settings";
import { Stage } from "./ui/Stage";
import { Staff } from "./ui/Staff";

type Screen =
  | { name: "attract" }
  | { name: "select" }
  | { name: "age"; game: GameId }
  | { name: "denied" }
  | { name: "intro"; game: GameId }
  | { name: "play"; game: GameId; run: number; started: boolean }
  | { name: "result"; game: GameId; data: ResultData; sessionId: string; initials: "no" | "ask" | "done" }
  | { name: "board"; game?: GameId; highlight?: string }
  | { name: "staff" };

const QUALITY_KEY = "kiosk.quality";
const REPLAY_WINDOW_MS = 60_000;
const SYNC_EVERY_MS = 30_000;
const CONFIG_EVERY_MS = 5 * 60_000;
const HIDDEN_ABORT_MS = 20_000;
// Fresh page every few hours, only ever from the attract screen: cheap insurance against
// slow memory growth in a browser tab that runs all day (assets come from the SW cache).
const RELOAD_AFTER_MS = 6 * 3600_000;

// Five-point star filling the viewBox: the iris that closes over the menu on game entry.
const IRIS_STAR = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 42 : 100;
  return `${100 + Math.cos(a) * r},${100 + Math.sin(a) * r}`;
}).join(" ");

function readQuality(): QualityLevel {
  try {
    return localStorage.getItem(QUALITY_KEY) === "low" ? "low" : "high";
  } catch {
    return "high";
  }
}

export function KioskApp() {
  const [vc, setVc] = useState<VersionedConfig>({ version: 0, config: DEFAULT_CONFIG });
  const [screen, setScreen] = useState<Screen>({ name: "attract" });
  // Client-only component (see KioskEntry), so reading the browser here is safe.
  const [quality, setQuality] = useState<QualityLevel>(readQuality);
  const [icons, setIcons] = useState(getIcons);
  const [best, setBest] = useState<Partial<Record<GameId, number>>>({});
  const [online, setOnline] = useState(() => navigator.onLine);
  const router = useRouter();
  const deniedUntil = useRef(0);
  const resultGetter = useRef<(() => GameResult) | null>(null);

  const run = useRef({ startedAt: 0, lastEndedAt: 0, counter: 0 });
  const pendingConfig = useRef<VersionedConfig | null>(null);
  const lastActivity = useRef(0);

  const cfg = vc.config;
  const k = cfg.kiosk;
  const t = DICTS[k.language];
  const effectiveQuality: QualityLevel = k.quality === "auto" ? quality : k.quality;
  const lite = effectiveQuality === "low" || !k.effectsEnabled;
  const screenName = screen.name;
  const inGame = screenName === "play";

  // ---------- boot ----------
  useEffect(() => {
    // Brand art decodes in the background; menu icons switch to it as soon as it is ready.
    preloadAssets().then(() => setIcons(getIcons()));
    loadCachedConfig().then(setVc);
    refreshConfig().then((fresh) => fresh && setVc(fresh));
    // Release any initials hold left by a crash, then upload what is waiting.
    store.outbox().then(async (items) => {
      for (const i of items.filter((i) => i.hold)) await store.updateSession(i.id, {}, false);
      flush();
    });
    // Long-press must never open the browser's image/link menu on a public touchscreen.
    const noMenu = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", noMenu);
    // QA hook (soak test reads audio diagnostics); only with the ?bot autopilot flag.
    if (new URLSearchParams(window.location.search).has("bot")) (window as unknown as { __kioskAudio: typeof audio }).__kioskAudio = audio;
    const onErr = (e: ErrorEvent) => logError(e.message || "error", e.filename);
    const onRej = (e: PromiseRejectionEvent) => logError(String(e.reason).slice(0, 300), "unhandledrejection");
    const onOnline = () => {
      setOnline(true);
      flush();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const syncTimer = setInterval(flush, SYNC_EVERY_MS);
    return () => {
      document.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(syncTimer);
    };
  }, []);

  // Config refresh: fetched in the background, applied only between games.
  useEffect(() => {
    const id = setInterval(async () => {
      const fresh = await refreshConfig();
      if (fresh && fresh.version !== vc.version) pendingConfig.current = fresh;
    }, CONFIG_EVERY_MS);
    return () => clearInterval(id);
  }, [vc.version]);

  useEffect(() => {
    document.documentElement.lang = k.language;
  }, [k.language]);

  // ---------- audio: admin policy, player mix, one track per screen ----------
  const [settingsOpen, setSettingsOpen] = useState(false);
  const audioDefaults = k.audio;
  const [prefsState, setPrefsState] = useState(() => ({ basis: audioDefaults, prefs: loadAudioPrefs(audioDefaults) }));
  // New admin defaults (config update) replace the player's mix: re-read during render.
  const prefs: AudioPrefs = prefsState.basis === audioDefaults ? prefsState.prefs : loadAudioPrefs(audioDefaults);
  if (prefsState.basis !== audioDefaults) setPrefsState({ basis: audioDefaults, prefs });
  const changePrefs = (p: AudioPrefs) => {
    setPrefsState({ basis: audioDefaults, prefs: p });
    saveAudioPrefs(audioDefaults, p);
  };
  useEffect(() => {
    audio.setPolicy(k.musicEnabled, k.soundEnabled);
    audio.setPrefs(prefs);
  }, [k.musicEnabled, k.soundEnabled, prefs]);
  // Lobby loop on menus, the game's own track from GO, silence on attract (nobody there)
  // and during the countdown (tension before the drop).
  const track: TrackId | null =
    screen.name === "attract" || screen.name === "staff" ? null : screen.name === "play" ? (screen.started ? screen.game : null) : "lobby";
  useEffect(() => audio.music(track), [track]);
  const introGame = screen.name === "intro" ? screen.game : null;
  useEffect(() => {
    if (introGame) audio.preload(introGame);
  }, [introGame]);
  // Any tap keeps the audio context alive (Android may suspend it while idle).
  useEffect(() => {
    const wake = () => void audio.unlock();
    window.addEventListener("pointerdown", wake, { passive: true });
    return () => window.removeEventListener("pointerdown", wake);
  }, []);

  // ---------- attract-mode housekeeping ----------
  useEffect(() => {
    if (screenName !== "attract") return;
    if (pendingConfig.current) {
      setVc(pendingConfig.current);
      pendingConfig.current = null;
    }
    if (performance.now() > RELOAD_AFTER_MS) window.location.reload();
    refreshConfig().then((fresh) => fresh && fresh.version !== vc.version && setVc(fresh));
  }, [screenName, vc.version]);

  // ---------- inactivity: back to attract ----------
  useEffect(() => {
    if (screenName === "attract" || inGame || screenName === "result") return;
    const onAct = () => (lastActivity.current = Date.now());
    lastActivity.current = Date.now();
    window.addEventListener("pointerdown", onAct);
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current > k.attractDelaySec * 1000) setScreen({ name: "attract" });
    }, 1000);
    return () => {
      window.removeEventListener("pointerdown", onAct);
      clearInterval(id);
    };
  }, [screenName, inGame, k.attractDelaySec]);

  // ---------- wake lock: keep the screen on (re-acquired whenever visible) ----------
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const acquire = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
        if (wl && !document.hidden) lock = await wl.request("screen");
      } catch {
        // Not granted (no gesture yet / insecure context): MDM keeps the screen on instead.
      }
    };
    acquire();
    const onVis = () => !document.hidden && acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [screenName === "attract"]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- best-of-today for the select cards ----------
  const loadBoard = useCallback((g: GameId, scope: "daily" | "all") => getBoard(g, scope, k.leaderboardSize, k.timezone), [k.leaderboardSize, k.timezone]);
  useEffect(() => {
    if (screenName !== "select") return;
    Promise.all(
      (["star", "crate"] as const).map(async (g) => [g, (await getBoard(g, "daily", 1, k.timezone))[0]?.score] as const),
    ).then((pairs) => setBest(Object.fromEntries(pairs.filter(([, v]) => v))));
  }, [screenName, k.timezone]);

  // ---------- flow ----------
  const firstTap = () => {
    // Confirmation chime as soon as the effects are decoded (first tap of the page) or right away.
    void audio.unlock().then(() => audio.play("select"));
    if (k.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    }
    if (k.defaultGame) pick(k.defaultGame);
    else setScreen({ name: "select" });
  };

  const pick = (game: GameId) => {
    if (k.ageGate.enabled) {
      if (Date.now() < deniedUntil.current) return setScreen({ name: "denied" });
      return setScreen({ name: "age", game });
    }
    setScreen({ name: "intro", game });
  };

  // Game entry: the star iris closes over the menu, the game mounts underneath, the iris
  // fades. Hides the canvas set-up frame and makes the game feel like a place you enter.
  const [iris, setIris] = useState<"in" | "out" | null>(null);
  const play = (game: GameId) => {
    audio.unlock();
    run.current.counter++;
    const runId = run.current.counter;
    setIris("in");
    // Normally resolved long ago (boot preload); never start a round with fallback art.
    void Promise.all([preloadAssets(), new Promise((r) => setTimeout(r, 420))]).then(() => {
      setScreen({ name: "play", game, run: runId, started: false });
      setIris("out");
      setTimeout(() => setIris(null), 340);
    });
  };

  const begin = () => {
    run.current.startedAt = Date.now();
    setScreen((s) => (s.name === "play" ? { ...s, started: true } : s));
  };

  const boardEligible = (g: GameId) => k.leaderboardEnabled && k.leaderboardGames.includes(g);

  const finish = async (game: GameId, result: GameResult) => {
    const endedAt = Date.now();
    const startedAt = run.current.startedAt || endedAt - result.elapsedMs;
    const isReplay = run.current.lastEndedAt > 0 && startedAt - run.current.lastEndedAt < REPLAY_WINDOW_MS;
    run.current.lastEndedAt = endedAt;
    const prize = resolvePrize(cfg, game, result.score);
    const awardId = prize ? uuid() : null;
    const payload = {
      id: uuid(),
      game,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: result.elapsedMs,
      score: result.score,
      completed: true,
      isReplay,
      configVersion: vc.version,
      initials: null,
      stats: result.stats,
      prize: prize && awardId ? { awardId, prizeId: prize.id, prizeName: prize.name } : null,
    } as SessionPayload;
    const askInitials = boardEligible(game) && k.leaderboardInitials && result.score > 0;
    // Persist BEFORE revealing anything: the prize record must survive a crash or refresh.
    if (!(await store.addSession(payload, askInitials))) logError(`session ${payload.id} could not be stored`, "storage");
    void store.addLedger({
      sessionId: payload.id,
      endedAt: payload.endedAt,
      game,
      score: result.score,
      prize: prize && awardId ? { awardId, code: awardId.slice(0, 6).toUpperCase(), prizeId: prize.id, prizeName: prize.name } : null,
    });

    let isBest = false;
    let initials: "no" | "ask" = "no";
    try {
      const board = await getBoard(game, "daily", k.leaderboardSize, k.timezone);
      isBest = board[0]?.id === payload.id;
      if (askInitials && board.some((e) => e.id === payload.id)) initials = "ask";
    } catch {
      // leaderboard is a nicety; never block the result
    }
    if (initials === "no") {
      await store.updateSession(payload.id, {}, false);
      flush();
    }
    setScreen({
      name: "result",
      game,
      sessionId: payload.id,
      initials,
      data: { result, prize, awardCode: awardId ? awardId.slice(0, 6).toUpperCase() : null, isBest },
    });
  };

  const abandon = () => {
    const get = resultGetter.current;
    setScreen({ name: "attract" });
    if (!get || !run.current.startedAt) return;
    const r = get();
    const now = Date.now();
    void store
      .addSession(
        {
          id: uuid(),
          game: r.game,
          startedAt: new Date(run.current.startedAt).toISOString(),
          endedAt: new Date(now).toISOString(),
          durationMs: r.elapsedMs,
          score: r.score,
          completed: false,
          isReplay: false,
          configVersion: vc.version,
          initials: null,
          stats: r.stats,
          prize: null,
        } as SessionPayload,
        false,
      )
      .then(() => flush());
  };

  // ---------- page hidden mid-game: abandon after a while ----------
  const onAbandon = useEffectEvent(() => abandon());
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        audio.suspend();
        return;
      }
      audio.resume();
      if (inGame && hiddenAt && Date.now() - hiddenAt > HIDDEN_ABORT_MS) onAbandon();
      hiddenAt = 0;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [inGame]);

  const closeInitials = async (game: GameId, sessionId: string, value: string | null) => {
    await store.updateSession(sessionId, value ? { initials: value } : {}, false);
    flush();
    // Saved initials: show them on the board straight away. Skipped: stay on the result.
    setScreen(value ? { name: "board", game, highlight: sessionId } : (s) => (s.name === "result" ? { ...s, initials: "done" } : s));
  };

  const dropQuality = () => {
    setQuality("low");
    try {
      localStorage.setItem(QUALITY_KEY, "low");
    } catch {}
    logError("quality dropped to low", "perf");
  };

  const icon = icons ?? null;
  const resultSessionId = screen.name === "result" ? screen.sessionId : null;
  const resultInitials = screen.name === "result" ? screen.initials : "no";

  // Leaving the result screen without answering the initials prompt releases the hold.
  useEffect(() => {
    if (!resultSessionId || resultInitials !== "ask") return;
    return () => {
      store.updateSession(resultSessionId, {}, false).then(() => flush());
    };
  }, [resultSessionId, resultInitials]);

  return (
    <Stage>
      {/* data-screen: stable hook for the e2e suite. */}
      {/* Keyed per screen: every screen enters with the same short scale/fade. */}
      <div key={screen.name} data-screen={screen.name} className={`absolute inset-0 ${screen.name === "play" ? "" : "animate-screen-in"}`}>
      {screen.name === "attract" && <Attract t={t} lite={lite} onStart={firstTap} onAdmin={() => setScreen({ name: "staff" })} />}
      {screen.name === "select" && (
        <Select t={t} lite={lite} best={best} onPick={pick} onBoard={() => setScreen({ name: "board" })} leaderboard={k.leaderboardEnabled && k.leaderboardGames.length > 0} />
      )}
      {screen.name === "age" && (
        <AgeGate
          t={t}
          minAge={k.ageGate.minAge}
          onPass={() => setScreen({ name: "intro", game: screen.game })}
          onFail={() => {
            deniedUntil.current = Date.now() + k.ageGate.denyCooldownSec * 1000;
            setScreen({ name: "denied" });
            setTimeout(() => setScreen({ name: "attract" }), 6000);
          }}
        />
      )}
      {screen.name === "denied" && <Denied t={t} />}
      {screen.name === "intro" && icon && <Intro t={t} game={screen.game} icons={icon} onStart={() => play(screen.game)} onBack={() => setScreen({ name: "select" })} />}
      {screen.name === "play" && (
        <div className="absolute inset-0">
          <GameView
            key={screen.run}
            game={screen.game}
            config={cfg}
            labels={t.game}
            quality={effectiveQuality}
            autoQuality={k.quality === "auto"}
            running={screen.started}
            onFinish={(r) => void finish(screen.game, r)}
            onQualityDrop={dropQuality}
            resultRef={resultGetter}
          />
          {/* Starts once the iris has cleared, so "3" is never hidden under it. */}
          {!screen.started && !iris && <Countdown t={t} onDone={begin} />}
        </div>
      )}
      {screen.name === "result" && (
        <Result
          key={screen.sessionId}
          t={t}
          data={screen.data}
          autoReturnSec={screen.data.prize ? 90 : 25}
          onReplay={() => play(screen.game)}
          onOther={() => setScreen({ name: "select" })}
          onTimeout={() => setScreen({ name: "attract" })}
          initialsSlot={
            screen.initials === "ask" ? (
              <InitialsEntry t={t} onSave={(v) => closeInitials(screen.game, screen.sessionId, v)} onSkip={() => closeInitials(screen.game, screen.sessionId, null)} />
            ) : null
          }
        />
      )}
      {screen.name === "board" && (
        <Board
          t={t}
          games={k.leaderboardGames.length ? k.leaderboardGames : ["crate"]}
          load={loadBoard}
          highlight={screen.highlight}
          initialGame={screen.game}
          onBack={() => setScreen({ name: "select" })}
        />
      )}
      {screen.name === "staff" && (
        <Staff t={t} timeZone={k.timezone} onClose={() => setScreen({ name: "attract" })} onOpenAdmin={() => router.push("/admin")} />
      )}
      {!online && screen.name !== "play" && screen.name !== "staff" && (
        <div className="absolute right-6 top-6 rounded-full bg-ink/80 px-6 py-3 font-sans text-[24px] text-silver">{t.offline}</div>
      )}
      </div>
      {iris && (
        <div className={`pointer-events-none absolute inset-0 z-30 overflow-hidden ${iris === "out" ? "animate-fade-out" : ""}`} aria-hidden>
          <svg viewBox="0 0 200 200" className="absolute left-1/2 top-1/2 h-[4200px] w-[4200px] animate-iris-in">
            <polygon points={IRIS_STAR} fill="#062a14" />
          </svg>
        </div>
      )}
      {/* Muted state stays visible (shape, not colour) so staff notice a silent kiosk. */}
      {!inGame && (prefs.master === 0 || ((!k.soundEnabled || !prefs.sfxOn) && (!k.musicEnabled || !prefs.musicOn))) && (
        <div className="pointer-events-none absolute bottom-[44px] right-[44px] text-cream/40">
          <SpeakerIcon off />
        </div>
      )}
      {screen.name !== "play" && screen.name !== "staff" && !settingsOpen && <SettingsHotspot onOpen={() => setSettingsOpen(true)} />}
      {settingsOpen && (
        <SettingsPanel
          t={t}
          prefs={prefs}
          musicAllowed={k.musicEnabled}
          sfxAllowed={k.soundEnabled}
          onChange={changePrefs}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </Stage>
  );
}
