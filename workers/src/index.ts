import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { first } from "./_shared/db";
import { admin } from "./routes/admin";

/**
 * WCN API Worker — entry point.
 * Hosts the admin API (behind Cloudflare Access) and, in later phases, the
 * pipeline HTTP triggers. The scheduled() handler (Cron Triggers) and queue()
 * consumer are added in Phase 4.
 */
const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, service: "wcn-api" }));

// Connectivity check: proves the D1 binding works end-to-end.
app.get("/api/db-check", async (c) => {
  try {
    const row = await first<{ now: string }>(c.env, `select datetime('now') as now`);
    return c.json({ ok: true, now: row?.now });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// Serve migrated images from R2 (key = path after /images/). Replaces the
// public Supabase Storage bucket; D1 image URLs were rewritten to /images/<key>.
app.get("/images/*", async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/images\//, ""));
  if (!key) return c.notFound();
  const obj = await c.env.ARTIFACT_IMAGES.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

app.route("/api/admin", admin);

export default app;
