import { useCallback, useEffect, useMemo, useState } from "react";
import type { Prize } from "@/lib/config";
import { api, fmtDate, todayKey } from "../api";
import { btnGhost, btnPrimary, Field, input, Panel } from "./ui";

type Award = {
  id: string;
  sessionId: string;
  awardedAt: string;
  game: "star" | "crate";
  score: number;
  prizeId: string;
  prizeName: string;
  status: "awarded" | "voided";
  flagged: boolean;
  overridden: boolean;
  notes: string | null;
  kioskName: string;
  configVersion: number;
};
type Resp = { awards: Award[]; truncated: boolean; counts: { prizeId: string; prizeName: string; status: string; count: number }[] };

type Preset = "today" | "yesterday" | "range" | "all";

export function Awards({ prizes, timeZone }: { prizes: Prize[]; timeZone: string }) {
  const [preset, setPreset] = useState<Preset>("today");
  const [from, setFrom] = useState(() => todayKey(timeZone));
  const [to, setTo] = useState(() => todayKey(timeZone));
  const [game, setGame] = useState("");
  const [prizeId, setPrizeId] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState(false);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    const day = preset === "today" ? todayKey(timeZone) : preset === "yesterday" ? todayKey(timeZone, 1) : null;
    const [f, t] = day ? [day, day] : preset === "range" ? [from, to] : ["", ""];
    if (f) q.set("from", f);
    if (t) q.set("to", t);
    if (game) q.set("game", game);
    if (prizeId) q.set("prizeId", prizeId);
    if (status) q.set("status", status);
    return q.toString();
  }, [preset, from, to, game, prizeId, status, timeZone]);

  const load = useCallback(
    () =>
      api<Resp>(`/api/admin/awards?${query}`)
        .then((r) => {
          setData(r);
          setError(false);
        })
        .catch(() => setError(true)),
    [query],
  );
  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const m = new Map<string, { name: string; awarded: number; voided: number }>();
    for (const c of data?.counts ?? []) {
      const e = m.get(c.prizeId) ?? { name: c.prizeName, awarded: 0, voided: 0 };
      if (c.status === "awarded") e.awarded += c.count;
      else e.voided += c.count;
      m.set(c.prizeId, e);
    }
    return [...m.entries()];
  }, [data]);

  const presetBtn = (p: Preset, label: string) => (
    <button key={p} type="button" onClick={() => setPreset(p)} className={preset === p ? btnPrimary : btnGhost}>
      {label}
    </button>
  );

  return (
    <>
      <Panel
        title="Filter"
        actions={
          <a href={`/api/admin/awards?${query}&format=csv`} className={`${btnGhost} inline-flex items-center`} download>
            Export CSV
          </a>
        }
      >
        <div className="flex flex-wrap gap-2">
          {presetBtn("today", "Today")}
          {presetBtn("yesterday", "Yesterday")}
          {presetBtn("range", "Date range")}
          {presetBtn("all", "All time")}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {preset === "range" && (
            <>
              <Field label="From">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
              </Field>
              <Field label="To">
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
              </Field>
            </>
          )}
          <Field label="Game">
            <select value={game} onChange={(e) => setGame(e.target.value)} className={input}>
              <option value="">All games</option>
              <option value="star">Star Catcher</option>
              <option value="crate">Crate Stacker</option>
            </select>
          </Field>
          <Field label="Prize">
            <select value={prizeId} onChange={(e) => setPrizeId(e.target.value)} className={input}>
              <option value="">All prizes</option>
              {prizes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
              <option value="">Any</option>
              <option value="awarded">Awarded</option>
              <option value="voided">Voided</option>
            </select>
          </Field>
        </div>
        <p className="mt-3 text-xs text-silver">Days are in the event timezone ({timeZone}).</p>
      </Panel>

      <Panel title="Totals for this filter">
        {totals.length === 0 ? (
          <p className="text-silver">No prizes in this period.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {totals.map(([id, t]) => (
              <div key={id} className="rounded-xl bg-ink/60 px-4 py-3">
                <div className="font-bold">{t.name}</div>
                <div className="text-sm text-silver">
                  <span className="font-display text-2xl font-bold text-cream">{t.awarded}</span> awarded
                  {t.voided > 0 && <span> · {t.voided} voided</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Prize events">
        {error && <p className="text-[#ffb3a8]">Could not load prize events.</p>}
        {!data ? (
          <div className="h-40 animate-pulse rounded-xl bg-white/5" />
        ) : data.awards.length === 0 ? (
          <p className="text-silver">No prize events match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-silver">
                <tr>
                  <th className="py-2">Time</th>
                  <th>Code</th>
                  <th>Game</th>
                  <th>Score</th>
                  <th>Prize</th>
                  <th>Status</th>
                  <th>Kiosk</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.awards.map((a) => (
                  <AwardRow key={a.id} a={a} timeZone={timeZone} onChanged={load} />
                ))}
              </tbody>
            </table>
            {data.truncated && <p className="mt-2 text-xs text-silver">Showing the latest 500. Use CSV export for everything.</p>}
          </div>
        )}
      </Panel>
    </>
  );
}

function AwardRow({ a, timeZone, onChanged }: { a: Award; timeZone: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(a.notes ?? "");
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/awards/${a.id}`, { method: "PATCH", body: { status: a.status === "awarded" ? "voided" : "awarded", notes } });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <tr className="border-t border-white/10">
        <td className="py-2">{fmtDate(a.awardedAt, timeZone)}</td>
        {/* Same 6-char code the player was shown on the kiosk. */}
        <td className="font-mono">{a.id.slice(0, 6).toUpperCase()}</td>
        <td>{a.game === "star" ? "Star Catcher" : "Crate Stacker"}</td>
        <td>{a.score}</td>
        <td className="font-bold">{a.prizeName}</td>
        <td>
          <span className={a.status === "voided" ? "text-silver line-through" : ""}>{a.status}</span>
          {a.flagged && <span className="ml-2 rounded bg-[#4a1a10] px-2 text-xs text-[#ffb3a8]" title="Server checks disagreed with the kiosk">flagged</span>}
          {a.overridden && <span className="ml-2 rounded bg-white/10 px-2 text-xs">edited</span>}
        </td>
        <td className="text-silver">{a.kioskName}</td>
        <td>
          <button type="button" onClick={() => setEditing((v) => !v)} className={btnGhost}>
            {editing ? "Close" : "Edit"}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={8} className="pb-3">
            <div className="flex flex-wrap items-end gap-3 rounded-xl bg-ink/60 p-3">
              <div className="min-w-[240px] flex-1">
                <Field label="Note (why)">
                  <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={input} />
                </Field>
              </div>
              <button type="button" disabled={busy} onClick={toggle} className={a.status === "awarded" ? `${btnGhost} border-star text-[#ffb3a8]` : btnPrimary}>
                {a.status === "awarded" ? "Void award" : "Restore award"}
              </button>
              <span className="w-full font-mono text-xs text-silver">
                event {a.id} · session {a.sessionId} · config v{a.configVersion}
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
