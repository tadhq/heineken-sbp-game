import "server-only";
import { hkdfSync } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import { env } from "./env";
import { hashPin, verifyPin } from "./pin-hash";

export { verifyPin };

const ISSUER = "heineken-kiosk";
const ADMIN_AUD = "kiosk-admin";
const KIOSK_AUD = "kiosk-device";
export const ADMIN_COOKIE = "kiosk_admin";
/** Sliding server-side expiry; the dashboard also locks itself after inactivity. */
export const ADMIN_SESSION_SECONDS = 15 * 60;
const KIOSK_TOKEN_DAYS = 365;

// Separate signing key per token purpose, so one kind can never verify as the other
// even before the audience check.
function keyFor(purpose: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", env.SESSION_SECRET, "heineken-kiosk", purpose, 32));
}

// ---------- PIN ----------

export const PIN_SETTING = "adminPin";
export type PinSetting = { hash: string; version: number };

export async function getPinSetting(): Promise<PinSetting | null> {
  const row = await db.setting.findUnique({ where: { key: PIN_SETTING } });
  return (row?.value as PinSetting | undefined) ?? null;
}

export async function setPin(pin: string): Promise<void> {
  const current = await getPinSetting();
  const value: PinSetting = { hash: hashPin(pin), version: (current?.version ?? 0) + 1 };
  await db.setting.upsert({ where: { key: PIN_SETTING }, create: { key: PIN_SETTING, value }, update: { value } });
}

// ---------- Admin session ----------

export async function issueAdminSession(pinVersion: number): Promise<void> {
  const token = await new SignJWT({ pv: pinVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin")
    .setIssuer(ISSUER)
    .setAudience(ADMIN_AUD)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_SECONDS}s`)
    .sign(keyFor(ADMIN_AUD));
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

/**
 * True when the request carries a valid admin session issued under the current PIN.
 * Changing the PIN bumps its version, which logs out every other session.
 * Refreshes the cookie (sliding expiry) when `refresh` is set.
 */
export async function isAdmin({ refresh = false } = {}): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, keyFor(ADMIN_AUD), { issuer: ISSUER, audience: ADMIN_AUD });
    const pin = await getPinSetting();
    if (!pin || payload.pv !== pin.version) return false;
    if (refresh) await issueAdminSession(pin.version);
    return true;
  } catch {
    return false;
  }
}

// ---------- Kiosk device token ----------

export async function issueKioskToken(kioskId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(kioskId)
    .setIssuer(ISSUER)
    .setAudience(KIOSK_AUD)
    .setIssuedAt()
    .setExpirationTime(`${KIOSK_TOKEN_DAYS}d`)
    .sign(keyFor(KIOSK_AUD));
}

/** Returns the kiosk id for a valid, unrevoked `Authorization: Bearer` kiosk token. */
export async function authenticateKiosk(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(header.slice(7), keyFor(KIOSK_AUD), { issuer: ISSUER, audience: KIOSK_AUD });
    if (!payload.sub) return null;
    const kiosk = await db.kiosk.findUnique({ where: { id: payload.sub } });
    if (!kiosk || kiosk.tokenVersion !== payload.tv) return null;
    await db.kiosk.update({ where: { id: kiosk.id }, data: { lastSeenAt: new Date() } });
    return kiosk.id;
  } catch {
    return null;
  }
}
