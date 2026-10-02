import { useCallback, useEffect, useState } from "react";
import { dayKey } from "@/lib/time";
import type { Dict } from "@/lib/i18n";
import { hasLocalPin, kioskName, lockedFor, pairKiosk, verifyLocalPin } from "../staff";
import { store, type LedgerEntry } from "../store";
import { flush, kioskToken, lastSyncAt, refreshConfig } from "../sync";
import { TARGET } from "../target";
import { Backdrop } from "./parts";

type Mode = "checking" | "locked" | "pair" | "open";
const now = () => Date.now();

/**
 * Staff screen on the kiosk itself. Works fully offline: shows what this device has
 * awarded (codes, counts) and what still has to upload. Unlock uses the PIN hash stored
 * when the kiosk was paired; pairing itself needs internet once.
 */
export function Staff({ t, timeZone, onClose, onOpenAdmin }: { t: Dict; timeZone: string; onClose: () => void; onOpenAdmin: () => void }) {
  const s = t.staff;
  const [mode, setMode] = useState<Mode>("checking");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("Kiosk 1");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasLocalPin().then((has) => setMode(has ? "locked" : "pair"));
    kioskName().then((n) => n && setName(n));
  }, []);

  const unlock = async () => {
    const wait = await lockedFor();
    if (wait) return setMsg(s.lockedFor(wait));
    setBusy(true);
    const ok = await verifyLocalPin(pin);
    setBusy(false);
    setPin("");
    if (ok) {
      setMsg(null);
      setMode("open");
    } else setMsg((await lockedFor()) ? s.lockedFor(await lockedFor()) : s.wrongPin);
  };

  const pair = async () => {
    setBusy(true);
    const r = await pairKiosk(pin, name.trim() || "Kiosk");
    setBusy(false);
    setPin("");
    if (r.ok) {
      setMsg(s.paired(r.name));
      setMode("open");
    } else
      setMsg(r.reason === "wrong_pin" ? s.wrongPin : r.reason === "offline" ? s.needOnline : r.reason === "locked" ? s.lockedFor(r.retryAfter ?? 900) : s.pairFailed);
  };

  if (mode === "open") return <StaffDashboard t={t} timeZone={timeZone} note={msg} onClose={onClose} onOpenAdmin={onOpenAdmin} onRepair={() => (setMsg(null), setMode("pair"))} />;

  return (
    <div className="absolute inset-0">
      <Backdrop lite />
      <div className="relative flex h-full flex-col items-center px-20 pt-[260px]">
        <h1 className="font-display text-[110px] font-bold uppercase text-cream">{mode === "pair" ? s.pairTitle : s.title}</h1>
        {mode === "pair" && <p className="mt-4 max-w-[860px] text-center font-sans text-[36px] text-cream/85">{s.notPaired}</p>}
        {mode === "pair" && (
          <label className="mt-10 flex w-[760px] flex-col gap-3 font-sans text-[32px] text-cream/80">
            {s.kioskName}
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-[110px] rounded-[28px] border-2 border-cream/40 bg-ink/60 px-8 font-sans text-[44px] text-cream outline-none focus:border-bright" />
          </label>
        )}
        <p className="mt-10 font-sans text-[34px] text-cream/80">{s.enterPin}</p>
        <div className="mt-4 flex h-[120px] w-[520px] items-center justify-center rounded-[28px] border-2 border-cream/40 bg-ink/60 font-display text-[80px] tracking-[0.4em] text-cream">
          {"•".repeat(pin.length)}
        </div>
        <p role="status" className="mt-4 min-h-[48px] font-sans text-[34px] text-[#ffd2cc]">
          {msg}
        </p>
        <div className="mt-2 grid w-[560px] grid-cols-3 gap-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "ok"].map((k) => (
            <button
              key={k}
              type="button"
              disabled={busy || mode === "checking" || (k === "ok" && pin.length < 4)}
              onClick={() => {
                if (k === "⌫") setPin((p) => p.slice(0, -1));
                else if (k === "ok") void (mode === "pair" ? pair() : unlock());
                else setPin((p) => (p.length < 8 ? p + k : p));
              }}
              className={`h-[120px] rounded-[28px] font-display text-[56px] font-bold active:scale-95 disabled:opacity-40 ${k === "ok" ? "bg-bright text-ink" : "bg-ink/60 text-cream"}`}
            >
              {k === "ok" ? (mode === "pair" ? s.pair : s.unlock) : k}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="btn-secondary mt-12 h-[110px] w-[420px] text-[40px]">
          {s.close}
        </button>
      </div>
    </div>
  );
}

function StaffDashboard({
  t,
  timeZone,
  note,
  onClose,
  onOpenAdmin,
  onRepair,
}: {
  t: Dict;
  timeZone: string;
  note: string | null;
  onClose: () => void;
  onOpenAdmin: () => void;
  onRepair: () => void;
}) {
  const s = t.staff;
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [lastSync, setLastSync] = useState<number | null>(null);
  // navigator.onLine is unreliable in Android WebView (stays true in airplane mode), so
  // "online" here means: the server actually answered recently.
  const [online, setOnline] = useState<boolean | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);

  const refresh = useCallback(async () => {
    const [l, out, token, n] = await Promise.all([store.ledger(), store.outbox(), kioskToken.get(), kioskName()]);
    setLedger(l.sort((a, b) => b.endedAt.localeCompare(a.endedAt)));
    setPendingIds(new Set(out.map((o) => o.id)));
    setPaired(!!token);
    setName(n ?? null);
    setLastSync(await lastSyncAt());
  }, []);
  useEffect(() => {
    const probe = () => refreshConfig().then((r) => setOnline(r !== null));
    const first = setTimeout(probe, 0);
    const id = setInterval(probe, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const today = dayKey(now(), timeZone);
  const todays = ledger.filter((e) => dayKey(Date.parse(e.endedAt), timeZone) === today);
  const counts = new Map<string, number>();
  for (const e of todays) if (e.prize) counts.set(e.prize.prizeName, (counts.get(e.prize.prizeName) ?? 0) + 1);
  const prizes = ledger.filter((e) => e.prize).slice(0, 12);
  const time = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="absolute inset-0">
      <Backdrop lite />
      <div className="relative flex h-full flex-col px-14 pt-[110px]">
        <div className="flex items-end justify-between">
          <h1 className="font-display text-[96px] font-bold uppercase leading-none text-cream">{s.title}</h1>
          <span className="font-sans text-[30px] text-cream/80">{paired && name ? s.paired(name) : s.notPaired}</span>
        </div>
        {note && <p className="mt-4 font-sans text-[30px] text-gold">{note}</p>}

        <section className="mt-10 rounded-[36px] bg-ink/55 p-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[48px] font-bold uppercase text-cream">{s.sync}</h2>
            {online !== null && (
              <span className={`rounded-full px-5 py-1 font-display text-[30px] font-bold ${online ? "bg-bright text-ink" : "bg-star text-cream"}`}>{online ? s.online : s.offlineNow}</span>
            )}
          </div>
          <p className="mt-4 font-sans text-[36px] text-cream">{pendingIds.size ? s.pending(pendingIds.size) : s.allSynced}</p>
          <p className="mt-1 font-sans text-[30px] text-cream/75">
            {s.lastSync}: {lastSync ? time(new Date(lastSync).toISOString()) : s.never}
          </p>
          <div className="mt-6 flex gap-5">
            <button type="button" onClick={() => void flush().then(refresh)} className="h-[100px] flex-1 rounded-full bg-bright font-display text-[40px] font-bold uppercase text-ink active:scale-[0.98]">
              {s.syncNow}
            </button>
            <button type="button" onClick={onRepair} className="btn-secondary h-[100px] flex-1 text-[36px]">
              {paired ? s.repair : s.pair}
            </button>
          </div>
        </section>

        <section className="mt-8 rounded-[36px] bg-ink/55 p-8">
          <h2 className="font-display text-[48px] font-bold uppercase text-cream">{s.prizesToday}</h2>
          <p className="mt-1 font-sans text-[30px] text-cream/75">{s.gamesToday(todays.length)}</p>
          {counts.size === 0 ? (
            <p className="mt-4 font-sans text-[34px] text-cream/80">{s.noPrizes}</p>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-4">
              {[...counts.entries()].map(([prize, n]) => (
                <div key={prize} className="flex items-center justify-between rounded-[24px] bg-deep px-6 py-4">
                  <span className="font-sans text-[34px] text-cream">{prize}</span>
                  <span className="font-display text-[56px] font-bold text-gold">{n}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 min-h-0 flex-1 overflow-hidden rounded-[36px] bg-ink/55 p-8">
          <h2 className="font-display text-[48px] font-bold uppercase text-cream">{s.recent}</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {prizes.map((e) => (
              <li key={e.sessionId} className="grid grid-cols-[200px_170px_1fr_120px] items-center gap-4 rounded-[20px] bg-deep px-5 py-3 font-sans text-[28px] text-cream">
                <span className="text-cream/80">{time(e.endedAt)}</span>
                <span className="font-mono font-bold tracking-[0.15em]">{e.prize!.code}</span>
                <span className="truncate">
                  {e.prize!.prizeName} <span className="text-cream/70">({e.score})</span>
                </span>
                <span className={`text-right text-[24px] ${pendingIds.has(e.sessionId) ? "text-gold" : "text-cream/70"}`}>{pendingIds.has(e.sessionId) ? s.notSynced : s.synced}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex gap-5 py-10">
          {TARGET === "web" && (
            <button type="button" onClick={onOpenAdmin} className="btn-secondary h-[110px] flex-1 text-[38px]">
              {s.openAdmin}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-primary h-[110px] flex-1 text-[42px]">
            {s.close}
          </button>
        </div>
      </div>
    </div>
  );
}
