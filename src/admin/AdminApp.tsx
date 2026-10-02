"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { VersionedConfig } from "@/lib/config";
import { api, ApiError, setUnauthorizedHandler } from "./api";
import { Awards } from "./sections/Awards";
import { DeviceSection } from "./sections/Device";
import { GameSettings, KioskSettings } from "./sections/Settings";
import { LeaderboardAdmin } from "./sections/Leaderboard";
import { Overview } from "./sections/Overview";
import { PrizesEditor } from "./sections/Prizes";

const TABS = ["Overview", "Prize history", "Prizes", "Game settings", "Kiosk settings", "Leaderboard", "Device & security"] as const;
type Tab = (typeof TABS)[number];
/** Client-side auto-lock; the server session (15 min sliding) is the hard limit. */
const IDLE_LOCK_MS = 3 * 60_000;

export function AdminApp() {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");
  const [tab, setTab] = useState<Tab>("Overview");
  const [vc, setVc] = useState<VersionedConfig | null>(null);

  const lock = useCallback(() => {
    setState("locked");
    setVc(null);
  }, []);

  useEffect(() => {
    document.body.classList.add("admin-page");
    setUnauthorizedHandler(lock);
    api("/api/admin/session")
      .then(() => setState("open"))
      .catch(() => setState("locked"));
    return () => document.body.classList.remove("admin-page");
  }, [lock]);

  const logout = useCallback(async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    lock();
  }, [lock]);

  const loadConfig = useCallback(() => api<VersionedConfig>("/api/admin/config").then(setVc), []);
  useEffect(() => {
    if (state === "open") loadConfig().catch(() => {});
  }, [state, loadConfig]);

  // Auto-lock after inactivity: an unattended dashboard on a kiosk is an open door.
  useEffect(() => {
    if (state !== "open") return;
    let last = Date.now();
    const bump = () => (last = Date.now());
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - last > IDLE_LOCK_MS) logout();
    }, 5000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(id);
    };
  }, [state, logout]);

  if (state === "checking") return <div className="min-h-[100dvh] bg-ink" />;
  if (state === "locked") return <PinPad onUnlock={() => setState("open")} />;

  return (
    <div className="min-h-[100dvh] bg-ink font-sans text-cream">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <span className="font-display text-2xl font-bold uppercase tracking-wide">Kiosk admin</span>
          {vc && <span className="rounded-full bg-deep px-3 py-1 text-xs text-silver">config v{vc.version}</span>}
          <Link href="/" className="ml-auto rounded-full border border-white/20 px-4 py-2 text-sm text-silver hover:text-cream">
            Back to kiosk
          </Link>
          <button type="button" onClick={logout} className="rounded-full bg-star px-4 py-2 text-sm font-bold">
            Lock
          </button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-bold ${tab === t ? "bg-cream text-ink" : "text-silver hover:bg-white/5"}`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {!vc ? (
          <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
        ) : (
          <>
            {tab === "Overview" && <Overview />}
            {tab === "Prize history" && <Awards prizes={vc.config.prizes} timeZone={vc.config.kiosk.timezone} />}
            {tab === "Prizes" && <PrizesEditor vc={vc} onSaved={setVc} />}
            {tab === "Game settings" && <GameSettings vc={vc} onSaved={setVc} />}
            {tab === "Kiosk settings" && <KioskSettings vc={vc} onSaved={setVc} />}
            {tab === "Leaderboard" && <LeaderboardAdmin timeZone={vc.config.kiosk.timezone} />}
            {tab === "Device & security" && <DeviceSection timeZone={vc.config.kiosk.timezone} />}
          </>
        )}
      </main>
    </div>
  );
}

function PinPad({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    if (busy || value.length < 4) return;
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/login", { method: "POST", body: { pin: value } });
      onUnlock();
    } catch (e) {
      setPin("");
      if (e instanceof ApiError && e.status === 429) setMsg(`Too many attempts. Try again in ${Math.ceil(Number(e.body.retryAfter ?? 60) / 60)} min.`);
      else if (e instanceof ApiError && e.status === 503) setMsg("Admin PIN not configured. Run the seed script.");
      else if (e instanceof ApiError && e.status === 401) setMsg("Wrong PIN");
      else setMsg("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => setPin((p) => (p.length < 8 ? p + d : p));

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-ink px-4 font-sans text-cream">
      <form
        className="w-full max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          submit(pin);
        }}
      >
        <h1 className="text-center font-display text-4xl font-bold uppercase">Staff only</h1>
        <p className="mt-2 text-center text-silver">Enter the admin PIN</p>
        <label className="sr-only" htmlFor="pin">
          PIN
        </label>
        {/* Masked, never echoed. A real input so hardware keyboards also work. */}
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          className="mt-6 h-16 w-full rounded-2xl border border-white/20 bg-deep text-center text-4xl tracking-[0.5em] outline-none focus:border-bright"
        />
        <p role="alert" className="mt-3 min-h-6 text-center text-sm text-[#ff8a7d]">
          {msg}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} type="button" onClick={() => press(d)} className="h-16 rounded-2xl bg-deep text-2xl font-bold active:scale-95">
              {d}
            </button>
          ))}
          <button type="button" onClick={() => setPin("")} className="h-16 rounded-2xl bg-white/5 text-sm font-bold text-silver active:scale-95">
            Clear
          </button>
          <button type="button" onClick={() => press("0")} className="h-16 rounded-2xl bg-deep text-2xl font-bold active:scale-95">
            0
          </button>
          <button type="submit" disabled={busy || pin.length < 4} className="h-16 rounded-2xl bg-bright text-lg font-bold text-ink active:scale-95 disabled:opacity-40">
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}
