import type { CrateConfig, GameId, KioskConfig, StarConfig, VersionedConfig } from "@/lib/config";
import { btnGhost, btnPrimary, Field, input, Notice, Panel } from "./ui";
import { useConfigDraft } from "./useConfigDraft";

type NumField<T> = { key: keyof T & string; label: string; hint?: string; step?: number };

const STAR_FIELDS: NumField<StarConfig>[] = [
  { key: "durationSec", label: "Round length (s)" },
  { key: "starPoints", label: "Red star points" },
  { key: "goldenPoints", label: "Golden star points" },
  { key: "hazardPenalty", label: "Heat penalty" },
  { key: "dodgeBonus", label: "Close-dodge bonus" },
  { key: "startSpeed", label: "Start fall speed", hint: "px/s on the 1080x1920 stage" },
  { key: "maxSpeed", label: "Max fall speed", hint: "px/s at the end of the round" },
  { key: "startSpawnInterval", label: "Start spawn interval (s)", step: 0.01 },
  { key: "minSpawnInterval", label: "End spawn interval (s)", step: 0.01 },
  { key: "goldenChance", label: "Golden chance (0-0.5)", step: 0.005 },
  { key: "hazardChanceStart", label: "Heat chance at start", step: 0.01 },
  { key: "hazardChanceEnd", label: "Heat chance at end", step: 0.01 },
  { key: "chillChance", label: "Ice cube chance", step: 0.005 },
  { key: "chillDurationSec", label: "Ice slow-down (s)", step: 0.1 },
  { key: "comboStep", label: "Catches per multiplier step" },
  { key: "maxMultiplier", label: "Max multiplier" },
];

const CRATE_FIELDS: NumField<CrateConfig>[] = [
  { key: "maxDurationSec", label: "Time cap (s)", hint: "0 = no cap" },
  { key: "startWidth", label: "Start crate width (px)" },
  { key: "minWidth", label: "Game over below width (px)" },
  { key: "startSpeed", label: "Start slide speed (px/s)" },
  { key: "speedPerLevel", label: "Speed added per crate" },
  { key: "maxSpeed", label: "Max slide speed" },
  { key: "perfectTolerance", label: "Perfect tolerance (px)", step: 0.5 },
  { key: "regrowAfter", label: "Perfects in a row to regrow" },
  { key: "regrowAmount", label: "Regrow amount (px)" },
  { key: "placePoints", label: "Points per crate" },
  { key: "perfectBonus", label: "Perfect bonus" },
  { key: "accuracyBonus", label: "Max accuracy bonus" },
  { key: "heightBonus", label: "Height bonus per crate (end)" },
  { key: "comboStep", label: "Perfects per multiplier step" },
  { key: "maxMultiplier", label: "Max multiplier" },
];

function NumGrid<T extends Record<string, unknown>>({ fields, value, onChange }: { fields: NumField<T>[]; value: T; onChange: (k: keyof T, v: number) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          <input
            className={input}
            type="number"
            step={f.step ?? 1}
            value={value[f.key] as number}
            onChange={(e) => onChange(f.key, e.target.value === "" ? 0 : Number(e.target.value))}
          />
        </Field>
      ))}
    </div>
  );
}

function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <>
      <button type="button" className={btnGhost} disabled={!dirty || busy} onClick={onReset}>
        Discard
      </button>
      <button type="button" className={btnPrimary} disabled={!dirty || busy} onClick={onSave}>
        Save
      </button>
    </>
  );
}

export function GameSettings({ vc, onSaved }: { vc: VersionedConfig; onSaved: (v: VersionedConfig) => void }) {
  const { draft, setDraft, save, reset, dirty, status, busy } = useConfigDraft(vc, onSaved);
  return (
    <>
      <Panel title="Star Catcher" actions={<SaveBar dirty={dirty} busy={busy} onReset={reset} onSave={() => save("Game settings edited")} />}>
        <NumGrid fields={STAR_FIELDS} value={draft.star} onChange={(k, v) => setDraft((d) => ({ ...d, star: { ...d.star, [k]: v } }))} />
      </Panel>
      <Panel title="Crate Stacker" actions={<SaveBar dirty={dirty} busy={busy} onReset={reset} onSave={() => save("Game settings edited")} />}>
        <NumGrid fields={CRATE_FIELDS} value={draft.crate} onChange={(k, v) => setDraft((d) => ({ ...d, crate: { ...d.crate, [k]: v } }))} />
      </Panel>
      {status && <Notice kind={status.kind}>{status.text}</Notice>}
    </>
  );
}

export function KioskSettings({ vc, onSaved }: { vc: VersionedConfig; onSaved: (v: VersionedConfig) => void }) {
  const { draft, setDraft, save, reset, dirty, status, busy } = useConfigDraft(vc, onSaved);
  const k = draft.kiosk;
  const set = (patch: Partial<KioskConfig>) => setDraft((d) => ({ ...d, kiosk: { ...d.kiosk, ...patch } }));
  const toggle = (key: keyof KioskConfig, label: string) => (
    <label className="flex min-h-[44px] items-center gap-3 text-sm">
      <input type="checkbox" className="h-6 w-6" checked={k[key] as boolean} onChange={(e) => set({ [key]: e.target.checked } as Partial<KioskConfig>)} />
      {label}
    </label>
  );
  const games: { id: GameId; name: string }[] = [
    { id: "star", name: "Star Catcher" },
    { id: "crate", name: "Crate Stacker" },
  ];
  return (
    <>
      <Panel title="Kiosk" actions={<SaveBar dirty={dirty} busy={busy} onReset={reset} onSave={() => save("Kiosk settings edited")} />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Language">
            <select className={input} value={k.language} onChange={(e) => set({ language: e.target.value as KioskConfig["language"] })}>
              <option value="nl">Nederlands</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label="Timezone" hint="IANA name, e.g. Europe/Amsterdam">
            <input className={input} value={k.timezone} onChange={(e) => set({ timezone: e.target.value.trim() })} />
          </Field>
          <Field label="Back to attract after (s idle)">
            <input className={input} type="number" min={10} value={k.attractDelaySec} onChange={(e) => set({ attractDelaySec: Number(e.target.value) })} />
          </Field>
          <Field label="Graphics quality" hint="auto drops to low if the device struggles">
            <select className={input} value={k.quality} onChange={(e) => set({ quality: e.target.value as KioskConfig["quality"] })}>
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </Field>
          <Field label="Skip game choice">
            <select className={input} value={k.defaultGame ?? ""} onChange={(e) => set({ defaultGame: (e.target.value || null) as KioskConfig["defaultGame"] })}>
              <option value="">No, show both games</option>
              <option value="star">Always Star Catcher</option>
              <option value="crate">Always Crate Stacker</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 grid gap-1 sm:grid-cols-2">
          {toggle("soundEnabled", "Sound effects")}
          {toggle("musicEnabled", "Music during play")}
          {toggle("effectsEnabled", "Visual effects (shake, flashes, glows)")}
          {toggle("requestFullscreen", "Go fullscreen on first tap")}
          {toggle("prizesEnabled", "Prize system")}
        </div>
      </Panel>
      <Panel title="Leaderboard">
        <div className="grid gap-1 sm:grid-cols-2">
          {toggle("leaderboardEnabled", "Leaderboard enabled")}
          {toggle("leaderboardInitials", "Ask top players for 3 initials")}
          {games.map((g) => (
            <label key={g.id} className="flex min-h-[44px] items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={k.leaderboardGames.includes(g.id)}
                onChange={(e) => set({ leaderboardGames: e.target.checked ? [...k.leaderboardGames, g.id] : k.leaderboardGames.filter((x) => x !== g.id) })}
              />
              Show {g.name} on the leaderboard
            </label>
          ))}
        </div>
        <div className="mt-3 max-w-xs">
          <Field label="Entries shown">
            <input className={input} type="number" min={3} max={50} value={k.leaderboardSize} onChange={(e) => set({ leaderboardSize: Number(e.target.value) })} />
          </Field>
        </div>
      </Panel>
      <Panel title="Age check">
        <p className="mb-3 text-sm text-silver">
          Date-of-birth check before each game (Heineken Responsible Marketing Code, digital). Nothing entered is stored. Leave off if age is checked at the venue entrance; your Legal
          team decides.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex min-h-[44px] items-center gap-3 text-sm">
            <input type="checkbox" className="h-6 w-6" checked={k.ageGate.enabled} onChange={(e) => set({ ageGate: { ...k.ageGate, enabled: e.target.checked } })} />
            Ask date of birth
          </label>
          <Field label="Minimum age">
            <input className={input} type="number" min={16} max={25} value={k.ageGate.minAge} onChange={(e) => set({ ageGate: { ...k.ageGate, minAge: Number(e.target.value) } })} />
          </Field>
          <Field label="Lock-out after refusal (s)">
            <input
              className={input}
              type="number"
              min={0}
              value={k.ageGate.denyCooldownSec}
              onChange={(e) => set({ ageGate: { ...k.ageGate, denyCooldownSec: Number(e.target.value) } })}
            />
          </Field>
        </div>
      </Panel>
      {status && <Notice kind={status.kind}>{status.text}</Notice>}
    </>
  );
}
