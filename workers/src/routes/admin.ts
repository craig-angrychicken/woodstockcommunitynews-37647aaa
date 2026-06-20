import { Hono } from "hono";
import type { Env } from "../env";
import { verifyAccess } from "../_shared/auth";
import { first } from "../_shared/db";
import { sourcesRouter } from "./admin/sources";
import { storiesAdminRouter } from "./admin/stories";
import { artifactsRouter } from "./admin/artifacts";
import { promptsRouter } from "./admin/prompts";
import { historyRouter } from "./admin/history";
import { configRouter } from "./admin/config";
import { monitoringRouter } from "./admin/monitoring";

/**
 * Admin CRUD API — replaces the SPA's direct supabase.from() access.
 * Cloudflare Access gates the host; verifyAccess here is defense-in-depth.
 * Sub-routers use full /api/admin-relative paths and are mounted at "/".
 */
export const admin = new Hono<{ Bindings: Env }>();

admin.use("*", async (c, next) => {
  if (!(await verifyAccess(c.req.raw, c.env))) return c.json({ error: "unauthorized" }, 401);
  await next();
});

// Dashboard summary counts (replaces the SPA's 3 count:exact queries).
admin.get("/dashboard-stats", async (c) => {
  const row = await first<{ stories: number; artifacts: number; sources: number; total_size_mb: number }>(
    c.env,
    `select
       (select count(*) from stories) as stories,
       (select count(*) from artifacts) as artifacts,
       (select count(*) from sources) as sources,
       (select coalesce(sum(size_mb), 0) from artifacts) as total_size_mb`,
  );
  return c.json(row ?? { stories: 0, artifacts: 0, sources: 0, total_size_mb: 0 });
});

admin.route("/", sourcesRouter);
admin.route("/", storiesAdminRouter);
admin.route("/", artifactsRouter);
admin.route("/", promptsRouter);
admin.route("/", historyRouter);
admin.route("/", configRouter);
admin.route("/", monitoringRouter);
