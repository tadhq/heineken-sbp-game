import { useState } from "react";
import type { AppConfig, VersionedConfig } from "@/lib/config";
import { api, ApiError } from "../api";

/** Edit a copy of the config; saving creates a new immutable version on the server. */
export function useConfigDraft(vc: VersionedConfig, onSaved: (v: VersionedConfig) => void) {
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(vc.config));
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(vc.config);

  const save = async (note: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const saved = await api<VersionedConfig>("/api/admin/config", { method: "PUT", body: { config: draft, note } });
      onSaved(saved);
      setDraft(structuredClone(saved.config));
      setStatus({ kind: "ok", text: `Saved as config v${saved.version}. Kiosks pick it up between games (within 5 minutes).` });
    } catch (e) {
      const issues = e instanceof ApiError ? (e.body.issues as { path: (string | number)[]; message: string }[] | undefined) : undefined;
      setStatus({
        kind: "error",
        text: issues?.length ? issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : e instanceof ApiError ? e.code : "Save failed",
      });
    } finally {
      setBusy(false);
    }
  };
  const reset = () => setDraft(structuredClone(vc.config));
  return { draft, setDraft, save, reset, dirty, status, busy };
}
