import { Hono } from "hono";
import type { Env } from "../../env";
import { all, first, run, fromJson } from "../../_shared/db";
import type { StoryRow } from "../../_shared/types";

/**
 * Stories admin CRUD (replaces the SPA's supabase.from("stories") calls).
 * Mounted at /api/admin; the parent admin router applies the Cloudflare Access
 * gate, so no auth gate is added here.
 *
 * Fidelity to src/hooks/useStories.ts:
 *  - LEFT JOIN sources, exposing source.{name,type} for each story.
 *  - filters: environment (skip when 'all'), status, sourceId, dateFrom/dateTo
 *    (created_at range), searchQuery (case-insensitive LIKE on title/content/source name).
 *  - results ordered by stories.created_at DESC.
 */
export const storiesAdminRouter = new Hono<{ Bindings: Env }>();

/** Row shape returned by the LEFT JOIN: stories.* plus aliased source columns. */
type StoryJoinRow = StoryRow & {
  source_name: string | null;
  source_type: string | null;
};

/** Decode JSON TEXT columns and reshape the joined source into a nested object. */
function shapeStory(row: StoryJoinRow) {
  const { source_name, source_type, structured_metadata, generation_metadata, ...story } = row;
  return {
    ...story,
    structured_metadata: fromJson<Record<string, unknown> | null>(structured_metadata, null),
    generation_metadata: fromJson<Record<string, unknown> | null>(generation_metadata, null),
    source: source_name === null && source_type === null ? null : { name: source_name, type: source_type },
  };
}

const SELECT_STORY = `
  SELECT stories.*, sources.name AS source_name, sources.type AS source_type
  FROM stories
  LEFT JOIN sources ON stories.source_id = sources.id
`;

// GET /api/admin/stories — list with optional filters.
storiesAdminRouter.get("/stories", async (c) => {
  const environment = c.req.query("environment");
  const status = c.req.query("status");
  const sourceId = c.req.query("sourceId");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");
  const searchQuery = c.req.query("searchQuery");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (environment && environment !== "all") {
    conditions.push("stories.environment = ?");
    params.push(environment);
  }
  if (status) {
    conditions.push("stories.status = ?");
    params.push(status);
  }
  if (sourceId) {
    conditions.push("stories.source_id = ?");
    params.push(sourceId);
  }
  if (dateFrom) {
    conditions.push("stories.created_at >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push("stories.created_at <= ?");
    params.push(dateTo);
  }
  if (searchQuery) {
    // Case-insensitive LIKE; SQLite LIKE is case-insensitive for ASCII by default.
    const like = `%${searchQuery}%`;
    conditions.push("(stories.title LIKE ? OR stories.content LIKE ? OR sources.name LIKE ?)");
    params.push(like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `${SELECT_STORY} ${where} ORDER BY stories.created_at DESC`;
  const rows = await all<StoryJoinRow>(c.env, sql, ...params);
  return c.json({ stories: rows.map(shapeStory) });
});

// GET /api/admin/stories/:id — single story with joined source.
storiesAdminRouter.get("/stories/:id", async (c) => {
  const id = c.req.param("id");
  const row = await first<StoryJoinRow>(c.env, `${SELECT_STORY} WHERE stories.id = ?`, id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ story: shapeStory(row) });
});

// PATCH /api/admin/stories/:id — partial update (content edit / reject) from an allowlist.
const STORY_UPDATABLE = new Set([
  "title", "content", "status", "editor_notes", "hero_image_url", "slug",
  "environment", "article_type", "featured", "story_type", "structured_metadata",
  "fact_check_notes", "published_at",
]);

storiesAdminRouter.patch("/stories/:id", async (c) => {
  const id = c.req.param("id");
  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const cols: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!STORY_UPDATABLE.has(k)) continue;
    cols.push(`${k} = ?`);
    params.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v);
  }
  if (cols.length === 0) return c.json({ error: "no updatable fields" }, 400);
  cols.push("updated_at = datetime('now')");
  params.push(id);
  await run(c.env, `UPDATE stories SET ${cols.join(", ")} WHERE id = ?`, ...params);
  const row = await first<StoryJoinRow>(c.env, `${SELECT_STORY} WHERE stories.id = ?`, id);
  return c.json({ story: row ? shapeStory(row) : null });
});

// DELETE /api/admin/stories/:id — remove junction rows first, then the story.
storiesAdminRouter.delete("/stories/:id", async (c) => {
  const id = c.req.param("id");
  await run(c.env, `DELETE FROM story_artifacts WHERE story_id = ?`, id);
  await run(c.env, `DELETE FROM stories WHERE id = ?`, id);
  return c.json({ success: true });
});
