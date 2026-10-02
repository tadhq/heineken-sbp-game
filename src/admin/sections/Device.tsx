import { useEffect, useState } from "react";
import { kioskToken } from "@/kiosk/sync";
import { api, ApiError, fmtDate } from "../api";
import { btnDanger, btnGhost, btnPrimary, Field, input, Notice, Panel } from "./ui";

type Kiosk = { id: string; name: string; createdAt: string; lastSeenAt: string | null; tokenVersion: number };

export function DeviceSection({ timeZone }: { timeZone: string }) {
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [paired, setPaired] = useState<boolean | null>(null);
  const [name, setName] = useState("Kiosk 1");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pin, setPin] = useState({ current: "", next: "", repeat: "" });

  const load = () => api<{ kiosks: Kiosk[] }>("/api/admin/kiosks").then((r) => setKiosks(r.kiosks));
  useEffect(() => {
    load().catch(() => {});
    kioskToken.get().then((t) => setPaired(!!t));
  }, []);

  const register = async () => {
    try {
      const r = await api<{ token: string; kiosk: Kiosk }>("/api/admin/kiosks", { method: "POST", body: { name } });
      // The token is stored in this browser's IndexedDB, where the kiosk app reads it.
      await kioskToken.set(r.token);
      setPaired(true);
      setMsg({ kind: "ok", text: `This device is now "${r.kiosk.name}". Waiting results upload within 30 seconds.` });
      load();
    } catch {
      setMsg({ kind: "error", text: "Registration failed" });
    }
  };
  const revoke = async (id: string) => {
    await api(`/api/admin/kiosks/${id}`, { method: "DELETE" });
    setMsg({ kind: "ok", text: "Kiosk revoked. It keeps its results locally until it is registered again." });
    load();
  };
  const changePin = async () => {
    if (pin.next !== pin.repeat) return setMsg({ kind: "error", text: "New PINs do not match" });
    try {
      await api("/api/admin/pin", { method: "POST", body: { currentPin: pin.current, newPin: pin.next } });
      setPin({ current: "", next: "", repeat: "" });
      setMsg({ kind: "ok", text: "PIN changed. Other admin sessions were signed out." });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof ApiError && e.code === "wrong_pin" ? "Current PIN is wrong" : "New PIN must be 4-8 digits" });
    }
  };

  return (
    <>
      <Panel title="This device">
        <p className="mb-3 text-sm text-silver">
          {paired === null ? "Checking..." : paired ? "This browser is registered as a kiosk and uploads its results." : "This browser is not registered. Games still work, but results stay on the device until you register it."}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Field label="Kiosk name">
              <input className={input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <button type="button" className={btnPrimary} onClick={register} disabled={!name.trim()}>
            {paired ? "Register again (new token)" : "Register this device as kiosk"}
          </button>
        </div>
      </Panel>
      <Panel title="Registered kiosks">
        {kiosks.length === 0 ? (
          <p className="text-silver">None yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {kiosks.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink/60 px-3 py-2">
                <span className="font-bold">{k.name}</span>
                <span className="text-silver">{k.lastSeenAt ? `last sync ${fmtDate(k.lastSeenAt, timeZone)}` : "never synced"}</span>
                <button type="button" className={`${btnDanger} ml-auto`} onClick={() => revoke(k.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Change admin PIN">
        <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
          {(
            [
              ["current", "Current PIN"],
              ["next", "New PIN (4-8 digits)"],
              ["repeat", "Repeat new PIN"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                className={input}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin[k]}
                onChange={(e) => setPin((p) => ({ ...p, [k]: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
              />
            </Field>
          ))}
        </div>
        <button type="button" className={`${btnGhost} mt-3`} disabled={pin.next.length < 4 || !pin.current} onClick={changePin}>
          Change PIN
        </button>
      </Panel>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </>
  );
}
