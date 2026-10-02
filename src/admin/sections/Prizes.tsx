import type { GameId, Prize, VersionedConfig } from "@/lib/config";
import { btnDanger, btnGhost, btnPrimary, Field, input, Notice, Panel } from "./ui";
import { useConfigDraft } from "./useConfigDraft";

const GAMES: { id: GameId; name: string }[] = [
  { id: "star", name: "Star Catcher" },
  { id: "crate", name: "Crate Stacker" },
];

export function PrizesEditor({ vc, onSaved }: { vc: VersionedConfig; onSaved: (v: VersionedConfig) => void }) {
  const { draft, setDraft, save, reset, dirty, status, busy } = useConfigDraft(vc, onSaved);
  const update = (i: number, patch: Partial<Prize>) =>
    setDraft((d) => ({ ...d, prizes: d.prizes.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const add = () =>
    setDraft((d) => ({
      ...d,
      prizes: [...d.prizes, { id: `prize-${d.prizes.length + 1}-${Date.now().toString(36).slice(-4)}`, name: "New prize", description: "", imageUrl: "", minScore: 0, maxScore: null, games: ["star", "crate"], active: false }],
    }));
  const remove = (i: number) => setDraft((d) => ({ ...d, prizes: d.prizes.filter((_, j) => j !== i) }));

  return (
    <Panel
      title="Prize tiers"
      actions={
        <>
          <button type="button" className={btnGhost} onClick={add}>
            Add prize
          </button>
          <button type="button" className={btnGhost} disabled={!dirty || busy} onClick={reset}>
            Discard
          </button>
          <button type="button" className={btnPrimary} disabled={!dirty || busy} onClick={() => save("Prizes edited")}>
            Save prizes
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-silver">
        A player wins the active prize with the highest minimum score that their score falls into, for the game they played. No stock is tracked: counts of what was won are on the
        Prize history tab. Prize IDs are used in reports, so keep them stable once the event starts.
      </p>
      <label className="mb-4 flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={draft.kiosk.prizesEnabled}
          onChange={(e) => setDraft((d) => ({ ...d, kiosk: { ...d.kiosk, prizesEnabled: e.target.checked } }))}
        />
        Prize system enabled (off = players only see their score)
      </label>
      <div className="space-y-4">
        {draft.prizes.map((p, i) => (
          <div key={i} className={`rounded-2xl border p-4 ${p.active ? "border-bright/40 bg-ink/60" : "border-white/10 bg-ink/30"}`}>
            <div className="grid gap-3 md:grid-cols-6">
              <div className="md:col-span-2">
                <Field label="Name">
                  <input className={input} value={p.name} maxLength={60} onChange={(e) => update(i, { name: e.target.value })} />
                </Field>
              </div>
              <Field label="ID" hint="a-z, 0-9, -">
                <input className={input} value={p.id} maxLength={40} onChange={(e) => update(i, { id: e.target.value.toLowerCase() })} />
              </Field>
              <Field label="Min score">
                <input className={input} type="number" min={0} value={p.minScore} onChange={(e) => update(i, { minScore: Math.max(0, Math.round(+e.target.value)) })} />
              </Field>
              <Field label="Max score" hint="empty = no limit">
                <input
                  className={input}
                  type="number"
                  min={0}
                  value={p.maxScore ?? ""}
                  onChange={(e) => update(i, { maxScore: e.target.value === "" ? null : Math.max(0, Math.round(+e.target.value)) })}
                />
              </Field>
              <div className="flex items-end gap-4">
                <label className="flex min-h-[44px] items-center gap-2 text-sm">
                  <input type="checkbox" className="h-6 w-6" checked={p.active} onChange={(e) => update(i, { active: e.target.checked })} />
                  Active
                </label>
              </div>
              <div className="md:col-span-3">
                <Field label="Description">
                  <input className={input} value={p.description} maxLength={200} onChange={(e) => update(i, { description: e.target.value })} />
                </Field>
              </div>
              <div className="md:col-span-3">
                <Field label="Image URL" hint="/path on this site or https:// only">
                  <input className={input} value={p.imageUrl} maxLength={500} onChange={(e) => update(i, { imageUrl: e.target.value.trim() })} />
                </Field>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <span className="text-silver">Games:</span>
              {GAMES.map((g) => (
                <label key={g.id} className="flex min-h-[44px] items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    checked={p.games.includes(g.id)}
                    onChange={(e) => update(i, { games: e.target.checked ? [...p.games, g.id] : p.games.filter((x) => x !== g.id) })}
                  />
                  {g.name}
                </label>
              ))}
              <button type="button" className={`${btnDanger} ml-auto`} onClick={() => remove(i)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      {status && <Notice kind={status.kind}>{status.text}</Notice>}
    </Panel>
  );
}
