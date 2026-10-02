import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAdmin } from "./auth";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...init?.headers } });
}

export function error(status: number, code: string, extra?: Record<string, unknown>) {
  return json({ error: code, ...extra }, { status });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Every route goes through this: structured errors, never a leaked stack trace. */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ZodError) return error(400, "invalid_request", { issues: e.issues.slice(0, 5) });
      if (e instanceof SyntaxError) return error(400, "invalid_json");
      console.error("[api]", req.method, new URL(req.url).pathname, e);
      return error(500, "server_error");
    }
  };
}

/** Admin-only route. Authorizes inside the handler; there is no middleware to rely on. */
export function adminRoute<C>(fn: Handler<C>): Handler<C> {
  return route(async (req, ctx) => {
    // Belt and braces next to the SameSite=Strict cookie: refuse cross-origin writes.
    const origin = req.headers.get("origin");
    if (req.method !== "GET" && origin && new URL(origin).host !== new URL(req.url).host) return error(403, "bad_origin");
    if (!(await isAdmin({ refresh: true }))) return error(401, "unauthorized");
    return fn(req, ctx);
  });
}

/**
 * Origins of the packaged Android app (Capacitor serves bundled files from
 * https://localhost). Only these may call the kiosk API cross-origin; auth is a Bearer
 * token, never a cookie, so allowing them exposes nothing a kiosk could not already do.
 */
const APP_ORIGINS = new Set((process.env.KIOSK_APP_ORIGINS ?? "https://localhost,capacitor://localhost").split(",").map((o) => o.trim()));

function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get("origin");
  if (origin && APP_ORIGINS.has(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.headers.set("Access-Control-Max-Age", "600");
  }
  return res;
}

/** Kiosk API route: structured errors (as route()) plus CORS for the packaged app. */
export function kioskRoute<C>(fn: Handler<C>): Handler<C> {
  const inner = route(fn);
  return async (req, ctx) => withCors(req, await inner(req, ctx));
}

/** Preflight for kiosk routes called from the packaged app. */
export const kioskOptions = async (req: Request) => withCors(req, new Response(null, { status: 204 }));
