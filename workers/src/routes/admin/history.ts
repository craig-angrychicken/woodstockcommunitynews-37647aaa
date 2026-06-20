import { Hono } from "hono";
import type { Env } from "../../env";
import { all, first, run, insert, fromJson, toJson } from "../../_shared/db";

/**
 * Admin API sub-router: query_history + journalism_queue read endpoints.
 *
 * Mounted under /api/admin by the parent admin router (which applies the
 * Cloudflare Access gate — do NOT re-gate here). Routes use full
 * /api/admin-relative paths.
 *
 * Replaces the Supabase surface used by:
 *  - src/hooks/useQueryHistory.ts (useQueryHistory / useQueryRun / useRecentQueryHistory)
 *  - src/components/ai-journalist/QueueProcessor.tsx (realtime subscribe → polling)
 */
export const historyRouter = new Hono<{ Bindings: Env }>();

// GET /api/admin/query-history/recent — most recent runs (used by useRecentQueryHistory).
// MUST be registered before "/query-history/:id" so "recent" isn't swallowed by :id.
historyRouter.get("/query-history/recent", async (c) => {
  const limitParam = c.req.query("limit");
  const limit = limitParam != null && Number.isFinite(Number(limitParam)) ? Number(limitParam) : 10;
  const rows = await all(
    c.env,
    `SELECT * FROM query_history ORDER BY created_at DESC LIMIT ?`,
    limit,
  );
  return c.json(rows);
});

// GET /api/admin/query-history — filtered list (used by useQueryHistory).
// Filters: environment ('production' | 'test' | 'all'), status, dateFrom, dateTo.
historyRouter.get("/query-history", async (c) => {
  const environment = c.req.query("environment");
  const status = c.req.query("status");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");

  const clauses: string[] = [];
  const params: unknown[] = [];

  // environment: 'all' (or omitted) → no filter; otherwise exact match.
  if (environment && environment !== "all") {
    clauses.push(`environment = ?`);
    params.push(environment);
  }

  if (status) {
    clauses.push(`status = ?`);
    params.push(status);
  }

  if (dateFrom) {
    clauses.push(`created_at >= ?`);
    params.push(dateFrom);
  }

  if (dateTo) {
    clauses.push(`created_at <= ?`);
    params.push(dateTo);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await all(
    c.env,
    `SELECT * FROM query_history ${where} ORDER BY created_at DESC`,
    ...params,
  );
  return c.json(rows);
});

// GET /api/admin/query-history/:id — single run (used by useQueryRun).
historyRouter.get("/query-history/:id", async (c) => {
  const id = c.req.param("id");
  const row = await first(c.env, `SELECT * FROM query_history WHERE id = ?`, id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

// GET /api/admin/journalism-queue — queue items for a run, joined to their artifact.
// Replaces the Supabase realtime subscription (query_history_id=eq.{historyId}) with
// a polled query. QueueProcessor.tsx expects each item's artifact under
// `artifact: { title, name }`, so we nest the joined columns to match that shape.
historyRouter.get("/journalism-queue", async (c) => {
  const historyId = c.req.query("historyId");
  if (!historyId) return c.json({ error: "historyId is required" }, 400);

  const rows = await all<Record<string, unknown>>(
    c.env,
    `SELECT journalism_queue.*, artifacts.title AS artifact_title, artifacts.name AS artifact_name
       FROM journalism_queue
       LEFT JOIN artifacts ON journalism_queue.artifact_id = artifacts.id
      WHERE journalism_queue.query_history_id = ?
      ORDER BY journalism_queue.position ASC`,
    historyId,
  );

  const items = rows.map((row) => {
    const { artifact_title, artifact_name, ...queue } = row;
    return {
      ...queue,
      artifact:
        artifact_title != null || artifact_name != null
          ? { title: artifact_title ?? null, name: artifact_name ?? null }
          : null,
    };
  });

  return c.json(items);
});
