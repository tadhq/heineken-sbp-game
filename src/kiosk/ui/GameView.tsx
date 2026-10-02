"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { audio } from "@/game/engine/audio";
import { type QualityLevel, Runner } from "@/game/engine/runner";
import { CrateStacker } from "@/game/crate-stacker";
import { StarCatcher } from "@/game/star-catcher";
import type { GameLabels, GameResult } from "@/game/types";
import type { AppConfig, GameId } from "@/lib/config";
import { displayFontFamily, getSprites } from "../assets";

type Props = {
  game: GameId;
  config: AppConfig;
  labels: GameLabels;
  quality: QualityLevel;
  autoQuality: boolean;
  running: boolean;
  onFinish: (r: GameResult) => void;
  onQualityDrop: () => void;
  /** Lets the parent read the partial result when a run is abandoned. */
  resultRef: React.RefObject<(() => GameResult) | null>;
};

/**
 * React mounts the canvas once per run and hands it to the Runner. From then on the game
 * loop never touches React state: no per-frame re-renders. `?fps` in the URL shows a
 * frame-time readout for on-device performance checks.
 */
export function GameView({ game, config, labels, quality, autoQuality, running, onFinish, onQualityDrop, resultRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const runnerRef = useRef<Runner<GameResult> | null>(null);
  const finish = useEffectEvent((r: GameResult) => onFinish(r));
  const qualityDrop = useEffectEvent(() => onQualityDrop());

  useEffect(() => {
    const canvas = canvasRef.current!;
    const sprites = getSprites();
    const font = displayFontFamily();
    const instance = game === "star" ? new StarCatcher(config.star, sprites, font, labels) : new CrateStacker(config.crate, sprites, font, labels);
    const showFps = new URLSearchParams(window.location.search).has("fps");
    const runner = new Runner<GameResult>(canvas, instance, {
      quality,
      autoQuality,
      effectsEnabled: config.kiosk.effectsEnabled,
      onFinish: (r) => finish(r),
      onQualityDrop: () => qualityDrop(),
      onStats: showFps
        ? (s) => {
            if (fpsRef.current) fpsRef.current.textContent = `${s.fps} fps  ${s.frameMs.toFixed(1)} ms  ${s.level}`;
          }
        : undefined,
    });
    runnerRef.current = runner;
    resultRef.current = () => instance.result();
    runner.renderStatic();
    return () => {
      runner.dispose();
      runnerRef.current = null;
      resultRef.current = null;
      audio.stopMusic();
    };
    // One runner per mount: the parent remounts (key) for a new game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) return;
    runnerRef.current?.start();
    if (config.kiosk.musicEnabled) audio.startMusic(game === "star" ? 112 : 104);
  }, [running, config.kiosk.musicEnabled, game]);

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ touchAction: "none" }} />
      <div ref={fpsRef} className="pointer-events-none absolute bottom-3 left-3 font-mono text-[22px] text-white/70" />
    </>
  );
}
