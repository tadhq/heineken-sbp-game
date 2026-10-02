import { useEffect, useState } from "react";
import { api, fmtDate, now } from "../api";
import { Panel, Stat } from "./ui";

type OverviewData = {
  timezone: string;
  totals: { sessions: number; completionRate: number; replayRate: number; prizesAwarded: number; prizesToday: number; flaggedAwards: number; errors24h: number };
  games: { game: string; sessions: number; completed: number; avgScore: number; highScore: number; avgDurationSec: number }[];
  prizeCounts: { prizeId: string; prizeName: string; game: string; count: number }[];
  recentAwards: { id: string; awardedAt: string; game: string; score: number; prizeName: string; status: string; flagged: boolean }[];
  topScores: Record<string, { id: string; score: number; initials: string | null; endedAt: string }[]>;
  kiosks: { id: string; name: string; lastSeenAt: string | null }[];
};

const GAME_NAME: Record<string, string> = { star: "Star Catcher", crate: "Crate Stacker" };
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Overview() {
  const [d, setD] = useState<OverviewData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const load = () =>
      api<OverviewData>("/api/admin/overview")
        .then((r) => {
          setD(r);
          setErr(false);
        })
        .catch(() => setErr(true));
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);
  if (err && !d) return <p className="text-[#ffb3a8]">Could not load the overview. Check the connection.</p>;
  if (!d) return <div className="h-60 animate-pulse rounded-2xl bg-white/5" />;
  const tz = d.timezone;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Games played" value={d.totals.sessions} />
        <Stat label="Prizes awarded (all)" value={d.totals.prizesAwarded} />
        <Stat label="Prizes today" value={d.totals.prizesToday} />
        <Stat label="Completion rate" value={pct(d.totals.completionRate)} />
        <Stat label="Replay rate" value={pct(d.totals.replayRate)} />
        <Stat label="Flagged awards" value={d.totals.flaggedAwards} tone={d.totals.flaggedAwards ? "warn" : undefined} />
        <Stat label="Kiosk errors (24h)" value={d.totals.errors24h} tone={d.totals.errors24h ? "warn" : undefined} />
        <Stat label="Kiosks" value={d.kiosks.length} />
      </div>

      <Panel title="Games">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-silver">
              <tr>
                <th className="py-2">Game</th>
                <th>Sessions</th>
                <th>Valid completed</th>
                <th>Avg score</th>
                <th>High score</th>
                <th>Avg length</th>
              </tr>
            </thead>
            <tbody>
              {d.games.map((g) => (
                <tr key={g.game} className="border-t border-white/10">
                  <td className="py-2 font-bold">{GAME_NAME[g.game]}</td>
                  <td>{g.sessions}</td>
                  <td>{g.completed}</td>
                  <td>{g.avgScore}</td>
                  <td>{g.highScore}</td>
                  <td>{g.avgDurationSec}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Prizes awarded">
          {d.prizeCounts.length === 0 ? (
            <p className="text-silver">No prizes awarded yet.</p>
          ) : (
            <ul className="space-y-2">
              {d.prizeCounts.map((p) => (
                <li key={`${p.prizeId}-${p.game}`} className="flex items-center justify-between rounded-xl bg-ink/60 px-3 py-2">
                  <span>
                    <span className="font-bold">{p.prizeName}</span> <span className="text-xs text-silver">{GAME_NAME[p.game]}</span>
                  </span>
                  <span className="font-display text-2xl font-bold">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent prize events">
          {d.recentAwards.length === 0 ? (
            <p className="text-silver">Nothing yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.recentAwards.map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-xl bg-ink/60 px-3 py-2">
                  <span className="text-silver">{fmtDate(a.awardedAt, tz)}</span>
                  <span className="font-bold">{a.prizeName}</span>
                  <span className="ml-auto">{a.score}</span>
                  {a.status === "voided" && <span className="rounded bg-white/10 px-2 text-xs">voided</span>}
                  {a.flagged && <span className="rounded bg-[#4a1a10] px-2 text-xs text-[#ffb3a8]">flagged</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {Object.entries(d.topScores).map(([g, rows]) => (
          <Panel key={g} title={`Top scores: ${GAME_NAME[g]}`}>
            {rows.length === 0 ? (
              <p className="text-silver">No scores yet.</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {rows.map((r, i) => (
                  <li key={r.id} className="flex gap-3 rounded-lg bg-ink/60 px-3 py-1.5">
                    <span className="w-5 text-silver">{i + 1}</span>
                    <span className="tracking-widest">{r.initials ?? "---"}</span>
                    <span className="ml-auto font-bold">{r.score}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        ))}
      </div>

      <Panel title="Kiosks">
        {d.kiosks.length === 0 ? (
          <p className="text-silver">No kiosk registered. Open Device &amp; security on the kiosk itself to register it; until then it plays offline-only and keeps results on the device.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.kiosks.map((k) => {
              const stale = !k.lastSeenAt || now() - Date.parse(k.lastSeenAt) > 10 * 60_000;
              return (
                <li key={k.id} className="flex gap-3 rounded-lg bg-ink/60 px-3 py-2">
                  <span className="font-bold">{k.name}</span>
                  <span className={`ml-auto ${stale ? "text-[#ffb3a8]" : "text-silver"}`}>
                    {k.lastSeenAt ? `last sync ${fmtDate(k.lastSeenAt, tz)}` : "never synced"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
