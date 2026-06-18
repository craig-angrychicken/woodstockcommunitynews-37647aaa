import { Hono } from "hono";
import type { Env } from "../env";
import { all } from "../_shared/db";
import { verifyAccess } from "../_shared/auth";

/**
 * Admin API — replaces the Supabase admin surface (RLS + functions.invoke).
 * Every route is gated by Cloudflare Access (verified here as defense-in-depth).
 * This file holds the first ported endpoints; Phase 3 expands it to cover all
 * `supabase.from(...)` CRUD and pipeline triggers the admin SPA uses.
 */
export const admin = new Hono<{ Bindings: Env }>();

// Auth gate for the whole admin router.
admin.use("*", async (c, next) => {
  const identity = await verifyAccess(c.req.raw, c.env);
  if (!identity) return c.json({ error: "unauthorized" }, 401);
  await next();
});

// GET /api/admin/sources — list configured RSS/web sources.
admin.get("/sources", async (c) => {
  const sources = await all(c.env, `select * from sources order by created_at desc`);
  return c.json({ sources });
});
