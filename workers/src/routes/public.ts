import { Hono } from "hono";
import type { Env } from "../env";
import { all, first, fromJson } from "../_shared/db";

/**
 * Public read API — published stories for the news site (no auth).
 * Serves the queries the Next.js site/ pages need
 * (status='published', environment='production', slug present).
 */
export const publicApi = new Hono<{ Bindings: Env }>();

const LIST_COLS =
  "id, title, content, slug, hero_image_url, published_at, structured_metadata";

type StoryRow = Record<string, unknown> & { structured_metadata?: string | null };

// Parse the structured_metadata JSON text column back into an object for clients.
function hydrate<T extends StoryRow>(row: T) {
  return { ...row, structured_metadata: fromJson(row.structured_metadata, null) };
}

// GET /api/stories?limit=30 — latest non-council published stories.
publicApi.get("/stories", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 30, 100);
  const rows = await all<StoryRow>(
    c.env,
    `select ${LIST_COLS} from stories
       where status='published' and environment='production'
         and slug is not null and council_meeting_id is null
       order by published_at desc limit ?`,
    limit,
  );
  return c.json({ stories: rows.map(hydrate) });
});

// GET /api/stories/council?limit=6 — latest published council-meeting stories.
publicApi.get("/stories/council", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 6, 100);
  const rows = await all<StoryRow>(
    c.env,
    `select ${LIST_COLS} from stories
       where status='published' and environment='production'
         and slug is not null and council_meeting_id is not null
       order by published_at desc limit ?`,
    limit,
  );
  return c.json({ stories: rows.map(hydrate) });
});

// GET /api/stories/:slug — single published story by slug.
publicApi.get("/stories/:slug", async (c) => {
  const row = await first<StoryRow>(
    c.env,
    `select id, title, content, slug, hero_image_url, published_at, content_updated_at,
            structured_metadata, word_count, council_meeting_id, story_type
       from stories
       where slug=? and status='published' and environment='production' limit 1`,
    c.req.param("slug"),
  );
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ story: hydrate(row) });
});

// GET /api/stories/:id/related — recent published stories excluding :id.
publicApi.get("/stories/:id/related", async (c) => {
  const rows = await all<StoryRow>(
    c.env,
    `select ${LIST_COLS} from stories
       where status='published' and environment='production'
         and id != ? and slug is not null
       order by published_at desc limit 4`,
    c.req.param("id"),
  );
  return c.json({ stories: rows.map(hydrate) });
});

// GET /api/council/:meetingId/chain?exclude=:id — sibling stories in a council chain.
publicApi.get("/council/:meetingId/chain", async (c) => {
  const rows = await all<StoryRow>(
    c.env,
    `select id, title, slug, story_type from stories
       where council_meeting_id=? and status='published'
         and id != ? and slug is not null
       order by published_at asc`,
    c.req.param("meetingId"),
    c.req.query("exclude") ?? "",
  );
  return c.json({ stories: rows });
});
