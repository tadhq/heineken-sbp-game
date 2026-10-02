import { useCallback, useEffect, useState } from "react";
import type { GameId } from "@/lib/config";
import { api, fmtDate } from "../api";
import { btnDanger, btnGhost, btnPrimary, Notice, Panel } from "./ui";

type Entry = { id: string; score: number; initials: string | null; endedAt: string };

export function LeaderboardAdmin({ timeZone }: { timeZone: string }) {
  const [game, setGame] = useState<GameId>("crate");
  const [scope, setScope] = useState<"daily" | "all">("daily");
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [confirm, setConfirm] = useState<"daily" | "all" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => api<{ entries: Entry[] }>(`/api/admin/leaderboard?game=${game}&scope=${scope}`).then((r) => setRows(r.entries)), [game, scope]);
  useEffect(() => {
    load().catch(() => setRows([]));
  }, [load]);

  const reset = async (s: "daily" | "all") => {
    await api("/api/admin/leaderboard", { method: "POST", body: { game, scope: s } });
    setConfirm(null);
    setMsg(s === "all" ? "All-time board cleared. Sessions and prize records are kept." : "Today's board reset.");
    load();
  };
  const hide = async (id: string) => {
    await api(`/api/admin/sessions/${id}`, { method: "PATCH", body: { hiddenFromBoard: true } });
    load();
  };

  return (
    <Panel
      title="Leaderboard"
      actions={
        <>
          {(["crate", "star"] as const).map((g) => (
            <button key={g} type="button" className={game === g ? btnPrimary : btnGhost} onClick={() => setGame(g)}>
              {g === "star" ? "Star Catcher" : "Crate Stacker"}
            </button>
          ))}
          <button type="button" className={scope === "daily" ? btnPrimary : btnGhost} onClick={() => setScope("daily")}>
            Today
          </button>
          <button type="button" className={scope === "all" ? btnPrimary : btnGhost} onClick={() => setScope("all")}>
            All time
          </button>
        </>
      }
    >
      {!rows ? (
        <div className="h-32 animate-pulse rounded-xl bg-white/5" />
      ) : rows.length === 0 ? (
        <p className="text-silver">No entries.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 rounded-lg bg-ink/60 px-3 py-1.5">
              <span className="w-6 text-silver">{i + 1}</span>
              <span className="w-14 tracking-widest">{r.initials ?? "---"}</span>
              <span className="text-silver">{fmtDate(r.endedAt, timeZone)}</span>
              <span className="ml-auto font-bold">{r.score}</span>
              <button type="button" className={btnGhost} onClick={() => hide(r.id)}>
                Hide
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {confirm ? (
          <>
            <span className="self-center text-sm">{confirm === "all" ? "Clear the all-time board for this game?" : "Reset today's board for this game?"}</span>
            <button type="button" className={btnDanger} onClick={() => reset(confirm)}>
              Yes, {confirm === "all" ? "clear" : "reset"}
            </button>
            <button type="button" className={btnGhost} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className={btnGhost} onClick={() => setConfirm("daily")}>
              Reset today
            </button>
            <button type="button" className={btnGhost} onClick={() => setConfirm("all")}>
              Clear all-time
            </button>
          </>
        )}
      </div>
      {msg && <Notice kind="ok">{msg}</Notice>}
    </Panel>
  );
}
