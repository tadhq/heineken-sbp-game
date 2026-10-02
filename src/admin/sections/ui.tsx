import type { ReactNode } from "react";

/** Small shared admin primitives (kept local: one dashboard, one style). */
export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-deep/60 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-bold uppercase tracking-wide">{title}</h2>
        <div className="ml-auto flex flex-wrap gap-2">{actions}</div>
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === "warn" ? "border-[#7a2a1a] bg-[#4a1a10]" : "border-white/10 bg-deep/70"}`}>
      <div className="font-display text-3xl font-bold">{value}</div>
      <div className="mt-1 text-sm text-silver">{label}</div>
    </div>
  );
}

export const btn = "min-h-[44px] rounded-full px-4 text-sm font-bold active:scale-[0.98] disabled:opacity-40";
export const btnPrimary = `${btn} bg-bright text-ink`;
export const btnGhost = `${btn} border border-white/20 text-cream`;
export const btnDanger = `${btn} bg-star text-cream`;
export const input = "min-h-[44px] w-full rounded-xl border border-white/20 bg-ink px-3 text-cream outline-none focus:border-bright";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-bold text-silver">{label}</span>
      {children}
      {hint && <span className="text-xs text-silver/70">{hint}</span>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "error"; children: ReactNode }) {
  return (
    <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-sm ${kind === "ok" ? "bg-forest/60 text-cream" : "bg-[#4a1a10] text-[#ffb3a8]"}`}>
      {children}
    </p>
  );
}
