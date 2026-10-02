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
