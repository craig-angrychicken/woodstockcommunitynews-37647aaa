import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { first } from "./_shared/db";
import { admin } from "./routes/admin";
import { pipelineAdmin } from "./routes/pipeline-admin";
import { publicApi } from "./routes/public";
import { handleScheduled } from "./cron";
import { handleQueue } from "./queue";

/**
 * WCN API Worker — entry point.
 * - Public read API + image serving (no auth)
 * - Admin CRUD + pipeline triggers (behind Cloudflare Access)
 * - scheduled(): Cron Triggers dispatcher (src/cron.ts)
 * - queue(): serial journalism queue consumer (src/queue.ts)
 */
const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, service: "wcn-api" }));

app.get("/api/db-check", async (c) => {
  try {
    const row = await first<{ now: string }>(c.env, `select datetime('now') as now`);
    return c.json({ ok: true, now: row?.now });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// Serve migrated images from R2 (key = path after /images/).
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

app.route("/api", publicApi);
app.route("/api/admin", admin);
app.route("/api/admin", pipelineAdmin);

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  scheduled: (controller: ScheduledController, env: Env, _ctx: ExecutionContext) => handleScheduled(controller, env),
  queue: (batch: MessageBatch<{ queueItemId: string }>, env: Env, _ctx: ExecutionContext) => handleQueue(batch, env),
};
