import { Hono } from "hono";
import type { Env } from "../../env";
import { all, first, run, insert, fromJson, toJson } from "../../_shared/db";
import type { SourceRow } from "../../_shared/types";

/**
 * Admin CRUD for `sources` (RSS feeds / web pages).
 * Mounted under /api/admin — Cloudflare Access is applied by the parent router,
 * so no auth gate here. Replaces the SPA's supabase.from("sources") calls
 * (useSources hooks, AddSourceForm, EditSourceModal, Sources.tsx mutations).
 *
 * `parser_config` is a TEXT JSON column — decoded to an object on read so the
 * SPA receives the shape it expects, and encoded on write.
 */
export const sourcesRouter = new Hono<{ Bindings: Env }>();

/** Shape a raw source row for the SPA: decode the parser_config JSON column. */
function decodeSource(row: SourceRow): Omit<SourceRow, "parser_config"> & {
  parser_config: Record<string, unknown> | null;
} {
  return {
    ...row,
    parser_config: fromJson<Record<string, unknown> | null>(row.parser_config, null),
  };
}

// GET /sources — list by status. status: 'active' | 'testing' | 'all' (default 'all').
// useActiveSources / useTestSources / useAllSources.
sourcesRouter.get("/sources", async (c) => {
  const status = c.req.query("status") ?? "all";
  const rows =
    status === "all"
      ? await all<SourceRow>(c.env, `SELECT * FROM sources ORDER BY name`)
      : await all<SourceRow>(c.env, `SELECT * FROM sources WHERE status = ? ORDER BY name`, status);
  return c.json(rows.map(decodeSource));
});

// GET /sources/type/:type — list sources of a given type. useSourcesByType.
// Registered before /sources/:id so the literal segment wins.
sourcesRouter.get("/sources/type/:type", async (c) => {
  const rows = await all<SourceRow>(
    c.env,
    `SELECT * FROM sources WHERE type = ? ORDER BY name`,
    c.req.param("type"),
  );
  return c.json(rows.map(decodeSource));
});

// GET /sources/:id — single source. useSource.
sourcesRouter.get("/sources/:id", async (c) => {
  const row = await first<SourceRow>(c.env, `SELECT * FROM sources WHERE id = ?`, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(decodeSource(row));
});

// POST /sources — create a new source. AddSourceForm.
sourcesRouter.post("/sources", async (c) => {
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await run(
    c.env,
    `INSERT INTO sources (id, name, url, type, status, items_fetched, parser_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    String(b.name ?? ""),
    b.url == null ? null : String(b.url),
    String(b.type ?? "RSS Feed"),
    String(b.status ?? "testing"),
    typeof b.items_fetched === "number" ? b.items_fetched : 0,
    toJson(b.parser_config ?? {}),
    now,
    now,
  );
  const row = await first<SourceRow>(c.env, `SELECT * FROM sources WHERE id = ?`, id);
  return c.json(row ? decodeSource(row) : { id }, 201);
});

// PATCH /sources/:id/status — update status only. Sources.tsx updateStatusMutation.
// Registered before /sources/:id.
sourcesRouter.patch("/sources/:id/status", async (c) => {
  const id = c.req.param("id");
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  await run(
    c.env,
    `UPDATE sources SET status = ?, updated_at = ? WHERE id = ?`,
    String(b.status ?? ""),
    new Date().toISOString(),
    id,
  );
  const row = await first<SourceRow>(c.env, `SELECT * FROM sources WHERE id = ?`, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(decodeSource(row));
});

// PATCH /sources/:id — update name + url. EditSourceModal.
sourcesRouter.patch("/sources/:id", async (c) => {
  const id = c.req.param("id");
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  await run(
    c.env,
    `UPDATE sources SET name = ?, url = ?, updated_at = ? WHERE id = ?`,
    String(b.name ?? ""),
    b.url == null ? null : String(b.url),
    new Date().toISOString(),
    id,
  );
  const row = await first<SourceRow>(c.env, `SELECT * FROM sources WHERE id = ?`, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(decodeSource(row));
});

// DELETE /sources/:id — cascade: nullify stories.source_id, then delete the source.
// Run atomically via env.DB.batch. Sources.tsx deleteMutation.
sourcesRouter.delete("/sources/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE stories SET source_id = NULL WHERE source_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM sources WHERE id = ?`).bind(id),
  ]);
  return c.json({ success: true, id });
});
