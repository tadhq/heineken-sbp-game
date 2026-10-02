import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import { adminContext, BASE, pairKiosk, resetThrottle, starSession, withDb } from "./helpers";

test.beforeAll(resetThrottle);

const award = (prizeId = "star-t1", prizeName = "Prize Tier 1") => ({ awardId: randomUUID(), prizeId, prizeName });

test("sync is idempotent: replays and concurrent duplicates store one session and one award", async () => {
  const admin = await adminContext("10.3.0.1");
  const { token } = await pairKiosk(admin);
  const kiosk = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const s = starSession({ score: 620, prize: award() });

  const first = await kiosk.post("/api/kiosk/sync", { data: { sessions: [s] } });
  expect(first.status()).toBe(200);
  expect((await first.json()).accepted).toEqual([s.id]);
  // Same batch again (e.g. response lost on the way back) and five concurrent copies.
  await kiosk.post("/api/kiosk/sync", { data: { sessions: [s] } });
  const parallel = await Promise.all(Array.from({ length: 5 }, () => kiosk.post("/api/kiosk/sync", { data: { sessions: [s] } })));
  for (const r of parallel) expect((await r.json()).accepted).toEqual([s.id]);

  const counts = await withDb(async (c) => ({
    sessions: Number((await c.query('SELECT count(*) FROM "GameSession" WHERE id = $1', [s.id])).rows[0].count),
    awards: Number((await c.query('SELECT count(*) FROM "PrizeAward" WHERE "sessionId" = $1', [s.id])).rows[0].count),
    flagged: (await c.query('SELECT flagged FROM "PrizeAward" WHERE "sessionId" = $1', [s.id])).rows[0].flagged,
  }));
  expect(counts).toEqual({ sessions: 1, awards: 1, flagged: false });
});

test("hand-crafted scores and prizes are stored but flagged, and kept off the leaderboard", async () => {
  const admin = await adminContext("10.3.0.2");
  const { token } = await pairKiosk(admin);
  const kiosk = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const cheat = starSession({ score: 987_654, prize: award("star-t3", "Prize Tier 3") });
  const wrongTier = starSession({ score: 450, prize: award("star-t3", "Prize Tier 3") });
  const res = await kiosk.post("/api/kiosk/sync", { data: { sessions: [cheat, wrongTier] } });
  expect(res.status()).toBe(200);
  const rows = await withDb(async (c) => (await c.query('SELECT s.id, s.flags, s."hiddenFromBoard", a.flagged FROM "GameSession" s JOIN "PrizeAward" a ON a."sessionId" = s.id WHERE s.id = ANY($1)', [[cheat.id, wrongTier.id]])).rows);
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(r.flagged).toBe(true);
    expect(r.hiddenFromBoard).toBe(true);
    expect(r.flags.length).toBeGreaterThan(0);
  }
  const board = await (await request.newContext({ baseURL: BASE })).get("/api/kiosk/leaderboard?game=star&scope=all");
  expect((await board.json()).entries.map((e: { id: string }) => e.id)).not.toContain(cheat.id);
});

test("malformed records are rejected individually without blocking the batch", async () => {
  const admin = await adminContext("10.3.0.3");
  const { token } = await pairKiosk(admin);
  const kiosk = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const good = starSession();
  const bad = { ...starSession(), score: -5 };
  const garbage = { id: "not-a-uuid", game: "chess" };
  const res = await kiosk.post("/api/kiosk/sync", { data: { sessions: [good, bad, garbage] } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.accepted).toEqual([good.id]);
  expect(body.rejected.map((r: { id: string | null }) => r.id)).toEqual([bad.id, "not-a-uuid"]);
  // Oversized batch is a 400, not a crash.
  const huge = await kiosk.post("/api/kiosk/sync", { data: { sessions: Array.from({ length: 101 }, () => starSession()) } });
  expect(huge.status()).toBe(400);
});

test("revoking a kiosk stops its token", async () => {
  const admin = await adminContext("10.3.0.4");
  const { token, kiosk: k } = await pairKiosk(admin);
  const kiosk = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  expect((await kiosk.post("/api/kiosk/sync", { data: { sessions: [] } })).status()).toBe(200);
  expect((await admin.delete(`/api/admin/kiosks/${k.id}`)).status()).toBe(200);
  expect((await kiosk.post("/api/kiosk/sync", { data: { sessions: [] } })).status()).toBe(401);
});

test("admin reporting: prize counts, filters, void with note, CSV export", async () => {
  const admin = await adminContext("10.3.0.5");
  const { token } = await pairKiosk(admin);
  const kiosk = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const p = award("star-t2", "Prize Tier 2");
  const s = starSession({ score: 900, prize: p });
  await kiosk.post("/api/kiosk/sync", { data: { sessions: [s] } });

  const list = await (await admin.get("/api/admin/awards?game=star&prizeId=star-t2")).json();
  const mine = list.awards.find((a: { id: string }) => a.id === p.awardId);
  expect(mine).toMatchObject({ prizeName: "Prize Tier 2", score: 900, status: "awarded" });
  expect(list.counts.find((c: { prizeId: string; status: string }) => c.prizeId === "star-t2" && c.status === "awarded").count).toBeGreaterThan(0);

  const voided = await admin.patch(`/api/admin/awards/${p.awardId}`, { data: { status: "voided", notes: "Player left before collecting" } });
  expect((await voided.json()).award).toMatchObject({ status: "voided", overridden: true, notes: "Player left before collecting" });

  const csv = await admin.get("/api/admin/awards?game=star&format=csv");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text.split("\r\n")[0]).toBe("event_id,awarded_at,game,score,prize_id,prize_name,status,flagged,overridden,session_id,kiosk_id,kiosk_name,config_version,notes");
  expect(text).toContain(p.awardId);

  const overview = await (await admin.get("/api/admin/overview")).json();
  expect(overview.totals.sessions).toBeGreaterThan(0);
});

test("CSV cells cannot become spreadsheet formulas", async () => {
  const admin = await adminContext("10.3.0.6");
  const { token } = await pairKiosk(admin, "=HYPERLINK(\"http://x\")");
  const kiosk = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const p = award("star-t2", "Prize Tier 2");
  await kiosk.post("/api/kiosk/sync", { data: { sessions: [starSession({ score: 900, prize: p })] } });
  const text = await (await admin.get("/api/admin/awards?format=csv")).text();
  const line = text.split("\r\n").find((l) => l.startsWith(p.awardId))!;
  expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
});

test("a reused award id is rejected without blocking the rest of the batch", async () => {
  const admin = await adminContext("10.3.0.7");
  const { token } = await pairKiosk(admin);
  const kiosk = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const p = award();
  const a = starSession({ prize: p });
  const b = starSession({ prize: p }); // different session, same award id
  const c = starSession();
  const res = await kiosk.post("/api/kiosk/sync", { data: { sessions: [a, b, c] } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.accepted).toEqual([a.id, c.id]);
  expect(body.rejected.map((r: { id: string }) => r.id)).toEqual([b.id]);
  const n = await withDb(async (cl) => Number((await cl.query('SELECT count(*) FROM "GameSession" WHERE id = $1', [b.id])).rows[0].count));
  expect(n).toBe(0);
});

test("kiosk pairing from the device: PIN-gated, throttled, token works; CORS only for the app origin", async () => {
  await resetThrottle();
  const anon = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "10.3.0.8" } });
  expect((await anon.post("/api/kiosk/pair", { data: { pin: process.env.ADMIN_PIN === "0000" ? "1111" : "0000", name: "x" } })).status()).toBe(401);
  const ok = await anon.post("/api/kiosk/pair", { data: { pin: process.env.ADMIN_PIN, name: "e2e paired device" } });
  expect(ok.status()).toBe(200);
  const { token } = await ok.json();
  const kiosk = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  expect((await kiosk.post("/api/kiosk/sync", { data: { sessions: [starSession()] } })).status()).toBe(200);

  const pre = await anon.fetch("/api/kiosk/sync", { method: "OPTIONS", headers: { origin: "https://localhost", "access-control-request-method": "POST" } });
  expect(pre.status()).toBe(204);
  expect(pre.headers()["access-control-allow-origin"]).toBe("https://localhost");
  const evil = await anon.fetch("/api/kiosk/config", { headers: { origin: "https://evil.example" } });
  expect(evil.headers()["access-control-allow-origin"]).toBeUndefined();
  // Admin API never gets CORS.
  const adminPre = await anon.fetch("/api/admin/overview", { headers: { origin: "https://localhost" } });
  expect(adminPre.headers()["access-control-allow-origin"]).toBeUndefined();
  await resetThrottle();
});
