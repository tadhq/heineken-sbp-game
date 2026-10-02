import { SignJWT } from "jose";
import { expect, request, test } from "@playwright/test";
import { adminContext, BASE, getConfig, pairKiosk, resetThrottle, starSession } from "./helpers";

test.beforeAll(resetThrottle);

const ADMIN_ROUTES: [string, string][] = [
  ["GET", "/api/admin/overview"],
  ["GET", "/api/admin/awards"],
  ["GET", "/api/admin/awards?format=csv"],
  ["PATCH", "/api/admin/awards/6f1c4a2e-1b7a-4c1e-9d0e-0a1b2c3d4e5f"],
  ["GET", "/api/admin/config"],
  ["PUT", "/api/admin/config"],
  ["GET", "/api/admin/kiosks"],
  ["POST", "/api/admin/kiosks"],
  ["DELETE", "/api/admin/kiosks/6f1c4a2e-1b7a-4c1e-9d0e-0a1b2c3d4e5f"],
  ["GET", "/api/admin/leaderboard?game=crate&scope=all"],
  ["POST", "/api/admin/leaderboard"],
  ["POST", "/api/admin/pin"],
  ["GET", "/api/admin/session"],
  ["PATCH", "/api/admin/sessions/6f1c4a2e-1b7a-4c1e-9d0e-0a1b2c3d4e5f"],
];

test("every admin route refuses unauthenticated callers", async () => {
  const anon = await request.newContext({ baseURL: BASE });
  for (const [method, path] of ADMIN_ROUTES) {
    const res = await anon.fetch(path, { method, data: method === "GET" ? undefined : {} });
    expect(res.status(), `${method} ${path}`).toBe(401);
  }
});

test("forged and cross-purpose tokens are rejected", async () => {
  const admin = await adminContext("10.1.0.1");
  const { token } = await pairKiosk(admin);
  const adminCookie = (await admin.storageState()).cookies.find((c) => c.name === "kiosk_admin")!.value;
  const anon = await request.newContext({ baseURL: BASE });
  const body = { sessions: [starSession()] };

  // Admin session used as a kiosk token: wrong key + audience.
  expect((await anon.post("/api/kiosk/sync", { data: body, headers: { authorization: `Bearer ${adminCookie}` } })).status()).toBe(401);
  // Kiosk token used as the admin cookie.
  const asAdmin = await request.newContext({ baseURL: BASE, storageState: { cookies: [{ name: "kiosk_admin", value: token, domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Strict" }], origins: [] } });
  expect((await asAdmin.get("/api/admin/overview")).status()).toBe(401);
  // Token signed with a guessed secret.
  const forged = await new SignJWT({ tv: 1 }).setProtectedHeader({ alg: "HS256" }).setSubject("x").setIssuer("heineken-kiosk").setAudience("kiosk-device").setExpirationTime("1h").sign(new TextEncoder().encode("dev-secret-dev-secret-dev-secret!"));
  expect((await anon.post("/api/kiosk/sync", { data: body, headers: { authorization: `Bearer ${forged}` } })).status()).toBe(401);
  // alg:none
  const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"x","aud":"kiosk-device","iss":"heineken-kiosk","tv":1}').toString("base64url")}.`;
  expect((await anon.post("/api/kiosk/sync", { data: body, headers: { authorization: `Bearer ${none}` } })).status()).toBe(401);
  expect((await anon.post("/api/kiosk/sync", { data: body })).status()).toBe(401);
});

test("PIN brute force is throttled per client and a lockout holds even for the right PIN", async () => {
  await resetThrottle();
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
  const wrong = (i: number) => (String(1000 + i) === process.env.ADMIN_PIN ? "9998" : String(1000 + i));
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await ctx.post("/api/admin/login", { data: { pin: wrong(i) } })).status());
  expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
  expect(codes[5]).toBe(429);
  const right = await ctx.post("/api/admin/login", { data: { pin: process.env.ADMIN_PIN } });
  expect(right.status()).toBe(429);
  expect(Number((await right.json()).retryAfter)).toBeGreaterThan(0);
  // Another client is unaffected.
  await adminContext("10.9.9.10");
  await resetThrottle();
});

test("parallel guesses cannot slip past the limit", async () => {
  await resetThrottle();
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "10.8.8.8" } });
  const codes = await Promise.all(Array.from({ length: 12 }, (_, i) => ctx.post("/api/admin/login", { data: { pin: String(5000 + i) } }).then((r) => r.status())));
  expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(5);
  await resetThrottle();
});

test("malformed login bodies are 400, not 500", async () => {
  const anon = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "10.7.7.7" } });
  expect((await anon.post("/api/admin/login", { data: { pin: "12" } })).status()).toBe(400);
  expect((await anon.post("/api/admin/login", { headers: { "content-type": "application/json" }, data: "{not json" })).status()).toBe(400);
});

test("config writes are validated and cross-origin writes refused", async () => {
  const admin = await adminContext("10.2.0.1");
  const { config } = await getConfig(admin);
  const evil = structuredClone(config);
  evil.prizes[0].imageUrl = "javascript:alert(document.cookie)";
  expect((await admin.put("/api/admin/config", { data: { config: evil } })).status()).toBe(400);
  const res = await admin.put("/api/admin/config", { data: { config }, headers: { origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
});

test("public endpoints leak no secrets", async () => {
  const anon = await request.newContext({ baseURL: BASE });
  const text = await (await anon.get("/api/kiosk/config")).text();
  expect(text).not.toMatch(/scrypt|adminPin|SESSION_SECRET/);
  const bad = await anon.get("/api/kiosk/leaderboard?game=evil&scope=all");
  expect(bad.status()).toBe(400);
  expect(await bad.text()).not.toMatch(/at .*\.ts|node_modules/);
});
